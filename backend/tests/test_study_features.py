"""Deadlines, goals, calendar, marks, review cards, new lessons, notebook, recap, tags,
reminders and the automatic sync."""

import json
from datetime import date, datetime, time, timedelta

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone

from apps.courses import autosync, cards, reminders
from apps.courses.models import (
    Course,
    ImportJob,
    Lesson,
    LessonProgress,
    Module,
    Note,
    ReviewCard,
    StudyPreferences,
    StudySession,
    Tag,
)
from tests.fakes import FakeDrive

pytestmark = pytest.mark.django_db


def make_lesson(module: Module, file_id: str, order: int, **kw) -> Lesson:
    return Lesson.objects.create(
        module=module,
        title=kw.pop("title", f"Aula {file_id}"),
        drive_file_id=file_id,
        drive_name_original=f"{file_id}.mp4",
        mime_type="video/mp4",
        order=order,
        **kw,
    )


@pytest.fixture
def course(db) -> Course:
    course = Course.objects.create(title="Curso", drive_folder_id="root")
    module = Module.objects.create(course=course, title="Módulo 1", drive_folder_id="m1")
    for index, file_id in enumerate(["a", "b", "c", "d"]):
        make_lesson(module, file_id, index, duration_seconds=600)
    # Imported a while ago: these lessons are not "new".
    Lesson.objects.update(created_at=timezone.now() - timedelta(days=1))
    Course.objects.filter(pk=course.pk).update(
        new_lessons_seen_at=timezone.now() - timedelta(hours=1)
    )
    return course


def lesson(file_id: str) -> Lesson:
    return Lesson.objects.get(drive_file_id=file_id)


def complete(file_id: str, when: datetime) -> None:
    LessonProgress.objects.update_or_create(
        lesson=lesson(file_id), defaults={"completed": True, "completed_at": when}
    )


# --- Review cards: parsing ------------------------------------------------------------------


def test_parse_cards_formats():
    note = """# Resumo

P: O que é idempotência?
R: Repetir não muda o resultado.

- **Pergunta:** Qual a ordem natural?
- **Resposta:** Aula 2 antes de Aula 10,
  mesmo com números.

P: Sem resposta

```
P: dentro de código
R: ignorado
```
p: minúsculo
r: também vale
"""
    parsed = cards.parse_cards(note)

    assert [(c.question, c.answer) for c in parsed] == [
        ("O que é idempotência?", "Repetir não muda o resultado."),
        ("Qual a ordem natural?", "Aula 2 antes de Aula 10,\n  mesmo com números."),
        ("minúsculo", "também vale"),
    ]


def test_parse_cards_ignores_repeated_questions_and_question_case():
    parsed = cards.parse_cards("P: Olá\nR: 1\n\nP: olá \nR: 2")

    assert len(parsed) == 1
    assert cards.card_key("Ação  rápida") == cards.card_key("acao rapida")


def test_sync_cards_keeps_schedule_when_only_the_answer_changes(course):
    a = lesson("a")
    cards.sync_cards(a, "P: Pergunta 1\nR: resposta\n\nP: Pergunta 2\nR: x")
    card = ReviewCard.objects.get(question="Pergunta 1")
    cards.review(card, "good")

    stats = cards.sync_cards(a, "P: Pergunta 1\nR: resposta melhor\n\nP: Nova\nR: y")

    card.refresh_from_db()
    assert (stats.created, stats.updated, stats.removed) == (1, 1, 1)
    assert card.answer == "resposta melhor"
    assert card.repetitions == 1
    assert set(ReviewCard.objects.values_list("question", flat=True)) == {"Pergunta 1", "Nova"}


# --- Review cards: scheduling and API ---------------------------------------------------------


def test_sm2_schedule_grows_and_resets():
    card = ReviewCard(ease=2.5)
    today = date(2026, 1, 1)

    cards.schedule(card, "good", today)
    assert (card.interval_days, card.due_on) == (1, date(2026, 1, 2))
    cards.schedule(card, "good", today)
    assert card.interval_days == 3
    cards.schedule(card, "good", today)
    assert card.interval_days == 8  # round(3 * 2.5)
    cards.schedule(card, "easy", today)
    assert card.interval_days == 26  # round(8 * 2.5 * 1.3)
    assert card.ease == pytest.approx(2.65)

    cards.schedule(card, "again", today)
    assert (card.interval_days, card.repetitions, card.lapses) == (0, 0, 1)
    assert card.due_on == today
    assert card.ease == pytest.approx(2.45)


def test_note_save_creates_cards_and_review_flow(auth_client, course):
    url = f"/api/lessons/{lesson('a').pk}/note"
    saved = auth_client.put(
        url, {"content": "P: 2+2?\nR: 4\n\nP: Capital?\nR: Brasília"}, format="json"
    )

    assert saved.json()["cards"] == 2
    session = auth_client.get("/api/review").json()
    assert (session["due"], session["new"], session["total"]) == (2, 2, 2)
    assert session["cards"][0]["lesson"]["course_title"] == "Curso"

    card_id = session["cards"][0]["id"]
    answered = auth_client.post(f"/api/review/cards/{card_id}", {"rating": "good"}, format="json")
    again = session["cards"][1]["id"]
    auth_client.post(f"/api/review/cards/{again}", {"rating": "again"}, format="json")

    assert answered.json()["due_on"] == (timezone.localdate() + timedelta(days=1)).isoformat()
    after = auth_client.get("/api/review").json()
    assert after["due"] == 1  # "again" stays due today
    assert after["reviewed_today"] == 2
    assert after["next_due_on"] == (timezone.localdate() + timedelta(days=1)).isoformat()


def test_review_validation_and_course_filter(auth_client, course):
    cards.sync_cards(lesson("a"), "P: x\nR: y")
    card = ReviewCard.objects.get()

    bad = auth_client.post(f"/api/review/cards/{card.pk}", {"rating": "meh"}, format="json")
    other = auth_client.get("/api/review?course=9999").json()

    assert bad.status_code == 400
    assert other["due"] == 0
    assert auth_client.get("/api/review?course=x").status_code == 400


# --- Marks ------------------------------------------------------------------------------------


def test_marks_show_on_course_and_marked_list(auth_client, course):
    response = auth_client.patch(
        f"/api/lessons/{lesson('b').pk}/marks", {"starred": True, "difficult": True}, format="json"
    )
    auth_client.patch(f"/api/lessons/{lesson('c').pk}/marks", {"review_later": True}, format="json")

    assert response.json()["starred"] is True
    rows = auth_client.get(f"/api/courses/{course.pk}").json()["modules"][0]["lessons"]
    b = next(x for x in rows if x["drive_file_id"] == "b")
    assert (b["starred"], b["review_later"], b["difficult"]) == (True, False, True)

    marked = auth_client.get("/api/marked").json()
    assert [x["title"] for x in marked] == ["Aula b", "Aula c"]
    assert [x["title"] for x in auth_client.get("/api/marked?mark=review_later").json()] == [
        "Aula c"
    ]
    assert auth_client.get("/api/marked?mark=x").status_code == 400

    auth_client.patch(f"/api/lessons/{lesson('b').pk}/marks", {"starred": False}, format="json")
    assert [x["title"] for x in auth_client.get("/api/marked?mark=starred").json()] == []


def test_watched_seconds_feeds_in_progress_state(auth_client, course):
    auth_client.post(f"/api/lessons/{lesson('a').pk}/heartbeat", {"seconds": 45}, format="json")

    rows = auth_client.get(f"/api/courses/{course.pk}").json()["modules"][0]["lessons"]

    assert rows[0]["watched_seconds"] == 45
    assert rows[1]["watched_seconds"] == 0


# --- Tags -------------------------------------------------------------------------------------


def test_tags_are_cleaned_reused_and_dropped_when_unused(auth_client, course):
    other = Course.objects.create(title="Outro", drive_folder_id="other")
    auth_client.patch(f"/api/courses/{other.pk}", {"tags": ["Inglês"]}, format="json")

    data = auth_client.patch(
        f"/api/courses/{course.pk}",
        {"tags": ["  Programação  web ", "ingles", "programação WEB", ""]},
        format="json",
    ).json()

    assert data["tags"] == ["Inglês", "Programação web"]
    assert Tag.objects.count() == 2
    auth_client.patch(f"/api/courses/{course.pk}", {"tags": []}, format="json")
    assert list(Tag.objects.values_list("name", flat=True)) == ["Inglês"]
    listed = {x["title"]: x["tags"] for x in auth_client.get("/api/courses").json()}
    assert listed == {"Curso": [], "Outro": ["Inglês"]}


# --- Deadline and pace ------------------------------------------------------------------------


def test_plan_without_target_projects_from_recent_pace(auth_client, course):
    Course.objects.filter(pk=course.pk).update(created_at=timezone.now() - timedelta(days=30))
    complete("a", timezone.now() - timedelta(days=1))
    complete("b", timezone.now() - timedelta(days=40))  # outside the pace window

    plan = auth_client.get(f"/api/courses/{course.pk}").json()["plan"]

    assert plan["status"] == "no_target"
    assert plan["lessons_left"] == 2
    assert plan["seconds_left"] == 1200
    assert plan["pace_window_days"] == 14
    # 600 s in 14 days -> 1200 s left take 28 days.
    assert plan["projected_finish"] == (timezone.localdate() + timedelta(days=27)).isoformat()


def test_plan_status_with_target(auth_client, course):
    url = f"/api/courses/{course.pk}"
    today = timezone.localdate()
    complete("a", timezone.now())

    on_track = auth_client.patch(
        url, {"target_date": (today + timedelta(days=10)).isoformat()}, format="json"
    ).json()["plan"]
    behind = auth_client.patch(url, {"target_date": today.isoformat()}, format="json").json()
    overdue = auth_client.patch(
        url, {"target_date": (today - timedelta(days=1)).isoformat()}, format="json"
    ).json()["plan"]

    assert on_track["status"] == "on_track"  # 600 s/day since import, 1800 s left -> 3 days
    assert on_track["days_left"] == 11
    assert on_track["required_lessons_per_day"] == 0.3
    assert on_track["required_seconds_per_day"] == 164
    assert behind["plan"]["status"] == "behind"
    assert behind["target_date"] == today.isoformat()
    assert overdue["status"] == "overdue"
    cleared = auth_client.patch(url, {"target_date": None}, format="json").json()["plan"]
    assert cleared["status"] == "no_target"


def test_plan_done(auth_client, course):
    for file_id in "abcd":
        complete(file_id, timezone.now())

    assert auth_client.get("/api/courses").json()[0]["plan"]["status"] == "done"


# --- New lessons ------------------------------------------------------------------------------


def test_lessons_added_after_seen_are_new_until_opened_or_dismissed(auth_client, course):
    module = Module.objects.get()
    new = make_lesson(module, "e", 5)
    make_lesson(module, "f", 6)

    listed = auth_client.get("/api/courses").json()[0]
    rows = auth_client.get(f"/api/courses/{course.pk}").json()["modules"][0]["lessons"]
    assert listed["new_lessons"] == 2
    assert [x["drive_file_id"] for x in rows if x["is_new"]] == ["e", "f"]

    auth_client.post(f"/api/lessons/{new.pk}/heartbeat", {"seconds": 0}, format="json")
    assert auth_client.get("/api/courses").json()[0]["new_lessons"] == 1

    dismissed = auth_client.post(f"/api/courses/{course.pk}/mark-seen").json()
    assert dismissed["new_lessons"] == 0
    assert not any(x["is_new"] for x in dismissed["modules"][0]["lessons"])


def test_first_import_is_not_new_but_a_later_sync_is(auth_client, google_connected, fake_drive):
    root = "rootnew0000001"
    fake_drive.folder(root, "Curso")
    fake_drive.file("v1", "Aula 1.mp4", root)
    imported = auth_client.post("/api/courses/import", {"folder": root}, format="json").json()
    course_id = imported["course"]["id"]
    assert auth_client.get("/api/courses").json()[0]["new_lessons"] == 0

    fake_drive.file("v2", "Aula 2.mp4", root)
    auth_client.post(f"/api/courses/{course_id}/sync")

    assert auth_client.get("/api/courses").json()[0]["new_lessons"] == 1


# --- Stats: goals and calendar ---------------------------------------------------------------


def test_stats_include_today_and_goals(auth_client, course):
    StudyPreferences.objects.update_or_create(
        pk=1, defaults={"daily_goal_minutes": 30, "weekly_goal_minutes": 180}
    )
    auth_client.post(f"/api/lessons/{lesson('a').pk}/heartbeat", {"seconds": 50}, format="json")

    data = auth_client.get("/api/stats").json()

    assert data["study_seconds_today"] == 50
    assert (data["daily_goal_minutes"], data["weekly_goal_minutes"]) == (30, 180)


def test_goal_validation(auth_client):
    response = auth_client.patch("/api/preferences", {"daily_goal_minutes": 9999}, format="json")

    assert response.status_code == 400


def test_calendar_lists_active_days_of_the_last_year(auth_client, course):
    now = timezone.now()
    for days_ago, seconds in [(0, 300), (10, 60), (500, 900)]:
        started = now - timedelta(days=days_ago)
        StudySession.objects.create(
            lesson=lesson("a"), started_at=started, ended_at=started, seconds=seconds
        )
    complete("b", now - timedelta(days=3))

    data = auth_client.get("/api/stats/calendar").json()

    start = date.fromisoformat(data["start"])
    assert start.weekday() == 0
    assert (timezone.localdate() - start).days < 53 * 7
    assert [d["study_seconds"] for d in data["days"]] == [60, 0, 300]
    assert data["days_studied"] == 3
    assert data["study_seconds"] == 360


# --- Notebook, Markdown per course and recap -------------------------------------------------


def test_notebook_groups_notes_by_module(auth_client, course):
    other = Course.objects.create(title="Outro", drive_folder_id="other")
    make_lesson(Module.objects.create(course=other, title="X"), "z", 0)
    Note.objects.create(lesson=lesson("c"), content="Nota C")
    Note.objects.create(lesson=lesson("a"), content="Nota A")
    Note.objects.create(lesson=lesson("b"), content="")
    Note.objects.create(lesson=lesson("z"), content="De outro curso")

    data = auth_client.get(f"/api/courses/{course.pk}/notebook").json()
    md = auth_client.get(f"/api/export?type=md&course={course.pk}")

    assert data["notes"] == 2
    assert [x["content"] for x in data["modules"][0]["lessons"]] == ["Nota A", "Nota C"]
    assert "Nota A" in md.content.decode() and "De outro curso" not in md.content.decode()
    assert f"curso-{course.pk}" in md["Content-Disposition"]


def test_recap_summarizes_the_course(auth_client, course):
    now = timezone.now()
    for file_id in "abcd":
        complete(file_id, now)
    LessonProgress.objects.filter(lesson=lesson("c")).update(time_on_page_seconds=900)
    StudySession.objects.create(
        lesson=lesson("c"), started_at=now - timedelta(days=2), ended_at=now, seconds=900
    )
    Note.objects.create(lesson=lesson("a"), content="P: q\nR: a")
    cards.sync_cards(lesson("a"), "P: q\nR: a")

    data = auth_client.get(f"/api/courses/{course.pk}/recap").json()

    assert data["is_complete"] is True
    assert data["days_studied"] == 2
    assert data["started_on"] == timezone.localdate(now - timedelta(days=2)).isoformat()
    assert data["finished_on"] == timezone.localdate(now).isoformat()
    assert data["top_lesson"]["title"] == "Aula c"
    assert (data["notes_count"], data["cards_count"]) == (1, 1)


# --- Backup of the new data -------------------------------------------------------------------


def upload(client, data: dict):
    file = SimpleUploadedFile(
        "backup.json", json.dumps(data).encode(), content_type="application/json"
    )
    return client.post("/api/import-backup", {"file": file}, format="multipart")


def test_backup_roundtrip_with_marks_tags_deadline_goals_and_cards(auth_client, course):
    target = timezone.localdate() + timedelta(days=30)
    auth_client.patch(
        f"/api/courses/{course.pk}",
        {"tags": ["Python"], "target_date": target.isoformat()},
        format="json",
    )
    auth_client.patch(f"/api/lessons/{lesson('b').pk}/marks", {"starred": True}, format="json")
    auth_client.put(f"/api/lessons/{lesson('a').pk}/note", {"content": "P: q\nR: a"}, format="json")
    card = ReviewCard.objects.get()
    cards.review(card, "easy")
    auth_client.patch(
        "/api/preferences", {"daily_goal_minutes": 25, "reminder_time": "21:30"}, format="json"
    )
    exported = json.loads(auth_client.get("/api/export").content)

    LessonProgress.objects.all().delete()
    ReviewCard.objects.all().delete()
    Note.objects.all().delete()
    StudyPreferences.objects.all().delete()
    auth_client.patch(f"/api/courses/{course.pk}", {"tags": [], "target_date": None}, format="json")

    stats = upload(auth_client, exported).json()

    restored = ReviewCard.objects.get()
    assert stats["cards_restored"] == 1
    assert (restored.repetitions, restored.interval_days) == (1, 4)
    assert LessonProgress.objects.get(lesson=lesson("b")).starred is True
    course.refresh_from_db()
    assert course.target_date == target
    assert [tag.name for tag in course.tags.all()] == ["Python"]
    preferences = StudyPreferences.load()
    assert (preferences.daily_goal_minutes, preferences.reminder_time) == (25, time(21, 30))


# --- Reminders --------------------------------------------------------------------------------


@pytest.fixture
def email_channel(settings):
    settings.EMAIL_HOST = "smtp.example.com"
    settings.REMINDER_EMAIL_TO = "eu@example.com"
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"


def at(hour: int, minute: int = 0) -> datetime:
    return timezone.make_aware(datetime.combine(timezone.localdate(), time(hour, minute)))


def test_reminder_rules(course, email_channel):
    StudyPreferences.objects.update_or_create(
        pk=1, defaults={"reminder_enabled": True, "reminder_time": time(20, 0)}
    )

    assert reminders.maybe_send_reminder(at(19, 59)) == "ainda não é hora do lembrete"
    assert reminders.maybe_send_reminder(at(20, 5)).startswith("lembrete enviado")
    assert reminders.maybe_send_reminder(at(21)) == "lembrete de hoje já enviado"
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["eu@example.com"]
    assert "Você ainda não estudou hoje." in mail.outbox[0].body


def test_no_reminder_after_studying_or_when_disabled(course, email_channel):
    assert reminders.maybe_send_reminder(at(23)) == "lembrete desligado"
    StudyPreferences.objects.update_or_create(pk=1, defaults={"reminder_enabled": True})
    complete("a", at(10))

    assert reminders.maybe_send_reminder(at(23)) == "já estudou hoje"
    assert mail.outbox == []


def test_reminder_test_endpoint(auth_client, course, settings, monkeypatch):
    assert auth_client.post("/api/reminders/test").status_code == 400

    settings.TELEGRAM_BOT_TOKEN, settings.TELEGRAM_CHAT_ID = "123:abc", "42"
    sent: list[str] = []
    monkeypatch.setattr(reminders, "_send_telegram", sent.append)
    data = auth_client.post("/api/reminders/test").json()

    assert data == {"sent": ["telegram"], "errors": {}}
    assert sent[0].startswith("Hora de estudar (teste)")
    assert auth_client.get("/api/preferences").json()["reminder_channels"] == ["telegram"]


def test_reminder_reports_channel_failures(course, email_channel, monkeypatch):
    def boom(*args):
        raise OSError("smtp down")

    monkeypatch.setattr(reminders, "_send_email", boom)

    result = reminders.send("x", "y")

    assert result.sent == []
    assert "email" in result.errors


# --- Automatic sync ---------------------------------------------------------------------------


@pytest.fixture
def drive_course(google_connected, fake_drive: FakeDrive) -> Course:
    fake_drive.folder("R", "Curso")
    fake_drive.file("v1", "Aula 1.mp4", "R")
    course = Course.objects.create(title="Curso", drive_folder_id="R")
    return course


def test_auto_sync_runs_once_a_day(drive_course, fake_drive):
    fake_drive.file("v2", "Aula 2.mp4", "R")

    first = autosync.run_auto_sync()
    second = autosync.run_auto_sync()

    assert first == "sincronização automática: 1 sincronizado(s)"
    assert second == "nenhum curso para sincronizar"
    assert Lesson.objects.count() == 2
    ImportJob.objects.update(created_at=timezone.now() - timedelta(hours=24))
    assert autosync.run_auto_sync().endswith("1 sincronizado(s)")


def test_auto_sync_skips(drive_course, google_connected):
    Course.objects.create(title="Arquivado", drive_folder_id="old", is_archived=True)
    ImportJob.objects.create(course=drive_course, kind="sync", status="running")
    assert autosync.run_auto_sync() == "já existe uma importação em andamento"

    StudyPreferences.objects.update_or_create(pk=1, defaults={"auto_sync": False})
    assert autosync.run_auto_sync() == "sincronização automática desligada"

    StudyPreferences.objects.update_or_create(pk=1, defaults={"auto_sync": True})
    google_connected.needs_reconnect = True
    google_connected.save()
    assert autosync.run_auto_sync() == "Google não conectado"


def test_auto_sync_failure_waits_for_tomorrow(drive_course, fake_drive):
    fake_drive.remove("R")

    assert autosync.run_auto_sync().endswith("1 com erro")
    assert autosync.run_auto_sync() == "nenhum curso para sincronizar"


def test_scheduled_tasks_command_runs_both_tasks(drive_course, capsys):
    call_command("scheduled_tasks")

    out = capsys.readouterr().out
    assert "lembrete: lembrete desligado" in out
    assert "sync: sincronização automática: 1 sincronizado(s)" in out
