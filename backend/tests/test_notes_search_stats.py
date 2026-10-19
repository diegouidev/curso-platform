from datetime import datetime, timedelta

import pytest
from django.utils import timezone

from apps.courses import stats
from apps.courses.models import (
    Course,
    Lesson,
    LessonProgress,
    Module,
    Note,
    StudySession,
)
from apps.courses.search import fold, snippet

pytestmark = pytest.mark.django_db


@pytest.fixture
def course(db) -> Course:
    course = Course.objects.create(
        title="Engenharia de Software", drive_folder_id="root", description="Arquitetura e IA"
    )
    m1 = Module.objects.create(course=course, title="Módulo 1 - Fundamentos", order=0)
    m2 = Module.objects.create(course=course, title="Módulo 2 - Ação", order=1, is_hidden=True)
    for module, file_id, title, order, extra in [
        (m1, "a", "Aula 1 - Introdução à Arquitetura", 0, {}),
        (m1, "b", "Aula 2 - Padrões de Projeto", 1, {}),
        (m1, "h", "Aula 3 - Arquitetura oculta", 2, {"is_hidden": True}),
        (m2, "c", "Aula 4 - Arquitetura do módulo oculto", 0, {}),
    ]:
        Lesson.objects.create(
            module=module,
            title=title,
            drive_file_id=file_id,
            drive_name_original=f"{title}.mp4",
            mime_type="video/mp4",
            order=order,
            **extra,
        )
    return course


def lesson(file_id: str) -> Lesson:
    return Lesson.objects.get(drive_file_id=file_id)


# --- Notes --------------------------------------------------------------------------------


def test_note_is_empty_until_written(auth_client, course):
    data = auth_client.get(f"/api/lessons/{lesson('a').pk}/note").json()

    assert data == {"content": "", "updated_at": None}
    assert not Note.objects.exists()


def test_note_upsert_keeps_whitespace(auth_client, course):
    url = f"/api/lessons/{lesson('a').pk}/note"

    first = auth_client.put(url, {"content": "# Título\n\n- item\n"}, format="json")
    second = auth_client.put(url, {"content": "  editado  "}, format="json")

    assert first.status_code == second.status_code == 200
    assert second.json()["content"] == "  editado  "
    assert Note.objects.get().content == "  editado  "
    assert auth_client.get(url).json()["updated_at"] is not None


def test_has_note_flag_on_course_detail(auth_client, course):
    auth_client.put(f"/api/lessons/{lesson('a').pk}/note", {"content": "x"}, format="json")
    auth_client.put(f"/api/lessons/{lesson('b').pk}/note", {"content": ""}, format="json")

    modules = auth_client.get(f"/api/courses/{course.pk}").json()["modules"]
    flags = {x["title"]: x["has_note"] for x in modules[0]["lessons"]}

    assert flags["Aula 1 - Introdução à Arquitetura"] is True
    assert flags["Aula 2 - Padrões de Projeto"] is False


def test_note_requires_content_and_existing_lesson(auth_client, course):
    assert (
        auth_client.put("/api/lessons/9999/note", {"content": "x"}, format="json").status_code
        == 404
    )
    response = auth_client.put(f"/api/lessons/{lesson('a').pk}/note", {}, format="json")
    assert response.status_code == 400


# --- Search -------------------------------------------------------------------------------


def test_fold_removes_accents_and_case():
    assert fold("Módulo AÇÃO Straße") == "modulo acao strasse"


def test_search_is_accent_and_case_insensitive(auth_client, course):
    data = auth_client.get("/api/search", {"q": "introducao ARQUITETURA"}).json()

    assert [x["title"] for x in data["lessons"]] == ["Aula 1 - Introdução à Arquitetura"]
    assert data["lessons"][0]["course_title"] == "Engenharia de Software"
    assert data["lessons"][0]["module_title"] == "Módulo 1 - Fundamentos"


def test_search_skips_hidden_lessons_and_modules(auth_client, course):
    titles = [x["title"] for x in auth_client.get("/api/search?q=arquitetura").json()["lessons"]]

    assert titles == ["Aula 1 - Introdução à Arquitetura"]


def test_search_ranks_title_prefix_first(auth_client, course):
    titles = [x["title"] for x in auth_client.get("/api/search?q=aula").json()["lessons"]]

    assert titles == ["Aula 1 - Introdução à Arquitetura", "Aula 2 - Padrões de Projeto"]


def test_search_matches_courses_by_title_and_description(auth_client, course):
    data = auth_client.get("/api/search?q=ia").json()

    assert [x["title"] for x in data["courses"]] == ["Engenharia de Software"]


def test_search_in_notes_with_snippet(auth_client, course):
    content = "Resumo da aula.\n\nO **padrão Observer** desacopla quem publica de quem assina."
    Note.objects.create(lesson=lesson("b"), content=content)

    notes = auth_client.get("/api/search?q=observer").json()["notes"]

    assert len(notes) == 1
    note = notes[0]
    assert note["lesson_title"] == "Aula 2 - Padrões de Projeto"
    match = note["snippet"][note["match_start"] : note["match_start"] + note["match_length"]]
    assert match == "Observer"
    assert "\n" not in note["snippet"]


def test_short_query_returns_nothing(auth_client, course):
    data = auth_client.get("/api/search?q=a").json()

    assert data == {"query": "a", "courses": [], "lessons": [], "notes": []}


def test_snippet_is_cut_on_words_with_ellipses():
    text = ("palavra " * 30) + "alvo encontrado " + ("depois " * 30)

    excerpt, start, length = snippet(text, ["alvo"])

    assert excerpt.startswith("…") and excerpt.endswith("…")
    assert excerpt[start : start + length] == "alvo"
    assert "palavr " not in excerpt  # no split words


def test_snippet_maps_back_through_accents():
    excerpt, start, length = snippet("Introdução à Arquitetura", ["arquitetura"])

    assert excerpt[start : start + length] == "Arquitetura"


# --- Stats --------------------------------------------------------------------------------


def at(day: datetime, hour: int = 10) -> datetime:
    return day.replace(hour=hour, minute=0, second=0, microsecond=0)


@pytest.fixture
def frozen_today(monkeypatch):
    """Wednesday 2026-10-14, 15:00 local time."""
    now = timezone.make_aware(datetime(2026, 10, 14, 15, 0))
    monkeypatch.setattr("apps.courses.stats.timezone.now", lambda: now)
    monkeypatch.setattr(
        "apps.courses.stats.timezone.localdate",
        lambda value=None: timezone.localtime(value or now).date(),
    )
    return now


def study(lesson_obj: Lesson, when: datetime, seconds: int) -> None:
    StudySession.objects.create(
        lesson=lesson_obj,
        started_at=when,
        ended_at=when + timedelta(seconds=seconds),
        seconds=seconds,
    )
    progress, _ = LessonProgress.objects.get_or_create(lesson=lesson_obj)
    progress.time_on_page_seconds += seconds
    progress.save()


def complete(lesson_obj: Lesson, when: datetime) -> None:
    progress, _ = LessonProgress.objects.get_or_create(lesson=lesson_obj)
    progress.completed, progress.completed_at = True, when
    progress.save()


def test_stats_empty(auth_client, frozen_today):
    data = auth_client.get("/api/stats").json()

    assert data["streak_days"] == 0
    assert data["study_seconds_total"] == 0
    assert data["week_start"] == "2026-10-12"
    assert len(data["recent_days"]) == 7
    assert data["recent_days"][-1] == {"date": "2026-10-14", "study_seconds": 0, "completed": 0}


def test_stats_week_streak_and_totals(auth_client, course, frozen_today):
    today = frozen_today
    a, b = lesson("a"), lesson("b")
    study(a, at(today - timedelta(days=9)), 600)  # old, separate streak of 1
    study(a, at(today - timedelta(days=3)), 300)  # Sunday (last week)
    study(a, at(today - timedelta(days=2)), 30)  # Monday: 30 s only, but a completion
    complete(a, at(today - timedelta(days=2)))
    study(b, at(today - timedelta(days=1)), 1200)  # Tuesday
    complete(b, at(today - timedelta(days=1)))

    data = auth_client.get("/api/stats").json()

    assert data["completed_this_week"] == 2
    assert data["completed_total"] == 2
    assert data["study_seconds_this_week"] == 1230
    assert data["study_seconds_total"] == 2130
    assert data["studied_today"] is False
    assert data["streak_days"] == 3  # Sun, Mon, Tue; still alive today
    assert data["longest_streak_days"] == 3
    assert data["recent_days"][-2] == {"date": "2026-10-13", "study_seconds": 1200, "completed": 1}


def test_short_visit_does_not_count_as_a_study_day(auth_client, course, frozen_today):
    study(lesson("a"), at(frozen_today), stats.MIN_STUDY_SECONDS_PER_DAY - 1)

    data = auth_client.get("/api/stats").json()

    assert data["studied_today"] is False
    assert data["streak_days"] == 0


def test_streak_breaks_after_a_missed_day(auth_client, course, frozen_today):
    study(lesson("a"), at(frozen_today - timedelta(days=2)), 600)

    assert auth_client.get("/api/stats").json()["streak_days"] == 0


def test_stats_require_auth(api_client):
    assert api_client.get("/api/stats").status_code == 401
    assert api_client.get("/api/search?q=abc").status_code == 401
