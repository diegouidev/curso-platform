from datetime import timedelta

import pytest
from django.utils import timezone

from apps.courses.models import (
    Attachment,
    Course,
    Lesson,
    LessonProgress,
    Module,
    StudyPreferences,
    StudySession,
)

pytestmark = pytest.mark.django_db


def make_lesson(module: Module, file_id: str, order: int, **kw) -> Lesson:
    return Lesson.objects.create(
        module=module,
        title=file_id.upper(),
        drive_file_id=file_id,
        drive_name_original=f"{file_id}.mp4",
        mime_type="video/mp4",
        order=order,
        **kw,
    )


@pytest.fixture
def course(db) -> Course:
    """M1: a, b, hidden · M2 (order 1): c, gone (missing) · M3 hidden: x · M4: d."""
    course = Course.objects.create(title="Curso", drive_folder_id="root")
    m1 = Module.objects.create(course=course, title="M1", drive_folder_id="m1", order=0)
    m2 = Module.objects.create(course=course, title="M2", drive_folder_id="m2", order=1)
    m3 = Module.objects.create(
        course=course, title="M3", drive_folder_id="m3", order=2, is_hidden=True
    )
    m4 = Module.objects.create(course=course, title="M4", drive_folder_id="m4", order=3)
    make_lesson(m1, "a", 0, duration_seconds=600)
    make_lesson(m1, "b", 1)
    make_lesson(m1, "hidden", 2, is_hidden=True)
    make_lesson(m2, "c", 0)
    make_lesson(m2, "gone", 1, missing_in_drive=True)
    make_lesson(m3, "x", 0)
    make_lesson(m4, "d", 0)
    return course


def lesson(file_id: str) -> Lesson:
    return Lesson.objects.get(drive_file_id=file_id)


def open_lesson(client, file_id: str, seconds: int = 0) -> None:
    response = client.post(
        f"/api/lessons/{lesson(file_id).pk}/heartbeat", {"seconds": seconds}, format="json"
    )
    assert response.status_code == 200


# --- Detail and navigation ------------------------------------------------------------


def test_lesson_endpoints_require_auth(api_client, course):
    pk = lesson("a").pk
    assert api_client.get(f"/api/lessons/{pk}").status_code == 401
    assert api_client.post(f"/api/lessons/{pk}/complete").status_code == 401
    assert api_client.post(f"/api/lessons/{pk}/heartbeat", {"seconds": 1}).status_code == 401
    assert api_client.get("/api/continue").status_code == 401
    assert api_client.get("/api/preferences").status_code == 401


def test_lesson_detail_for_the_player(auth_client, course):
    a = lesson("a")
    Attachment.objects.create(
        lesson=a, title="Slides", drive_file_id="s1", mime_type="application/pdf"
    )
    Attachment.objects.create(
        module=a.module,
        title="Apostila",
        drive_file_id="doc1",
        mime_type="application/vnd.google-apps.document",
    )

    data = auth_client.get(f"/api/lessons/{a.pk}").json()

    assert data["embed_url"] == "https://drive.google.com/file/d/a/preview"
    assert data["drive_url"] == "https://drive.google.com/file/d/a/view"
    assert data["course"] == {"id": course.pk, "title": "Curso"}
    assert data["module"] == {"id": a.module_id, "title": "M1"}
    assert data["progress"] == {
        "completed": False,
        "completed_at": None,
        "last_opened_at": None,
        "time_on_page_seconds": 0,
    }
    assert [x["preview_url"] for x in data["attachments"]] == [
        "https://drive.google.com/file/d/s1/preview"
    ]
    assert [x["preview_url"] for x in data["module_attachments"]] == [
        "https://docs.google.com/document/d/doc1/preview"
    ]
    assert data["previous"] is None
    assert data["next"] == {"id": lesson("b").pk, "title": "B", "module_title": "M1"}
    assert (data["position"], data["total"]) == (1, 4)  # a, b, c, d


def test_navigation_crosses_modules_and_skips_hidden_and_missing(auth_client, course):
    b = auth_client.get(f"/api/lessons/{lesson('b').pk}").json()
    c = auth_client.get(f"/api/lessons/{lesson('c').pk}").json()
    d = auth_client.get(f"/api/lessons/{lesson('d').pk}").json()

    assert b["next"]["id"] == lesson("c").pk  # skips the hidden lesson
    assert c["previous"]["id"] == lesson("b").pk
    assert c["next"]["id"] == lesson("d").pk  # skips the missing lesson and the hidden module
    assert d["next"] is None
    assert (c["position"], d["position"]) == (3, 4)


def test_hidden_lesson_opened_directly_still_has_neighbors(auth_client, course):
    data = auth_client.get(f"/api/lessons/{lesson('gone').pk}").json()

    assert data["missing_in_drive"] is True
    assert data["position"] is None
    assert data["previous"]["id"] == lesson("c").pk
    assert data["next"]["id"] == lesson("d").pk


def test_lesson_detail_has_no_side_effects(auth_client, course):
    auth_client.get(f"/api/lessons/{lesson('a').pk}")

    assert not LessonProgress.objects.exists()


def test_unknown_lesson_is_404(auth_client, course):
    assert auth_client.get("/api/lessons/9999").status_code == 404
    assert auth_client.post("/api/lessons/9999/complete").status_code == 404


# --- Completion -------------------------------------------------------------------------


def test_complete_and_undo(auth_client, course):
    pk = lesson("a").pk

    first = auth_client.post(f"/api/lessons/{pk}/complete").json()
    again = auth_client.post(f"/api/lessons/{pk}/complete").json()

    assert first["completed"] is True
    assert first["completed_at"] is not None
    assert again["completed_at"] == first["completed_at"]  # idempotent
    course_data = auth_client.get(f"/api/courses/{course.pk}").json()
    assert course_data["progress"]["lessons_completed"] == 1

    undone = auth_client.delete(f"/api/lessons/{pk}/complete").json()

    assert undone["completed"] is False
    assert undone["completed_at"] is None
    assert auth_client.delete(f"/api/lessons/{pk}/complete").status_code == 200


# --- Time on page -----------------------------------------------------------------------


@pytest.fixture
def clock(monkeypatch):
    """Controls timezone.now() inside the progress module."""

    class Clock:
        now = timezone.now()

        def advance(self, seconds: int) -> None:
            self.now += timedelta(seconds=seconds)

    clock = Clock()
    monkeypatch.setattr("apps.courses.progress.timezone.now", lambda: clock.now)
    return clock


def test_opening_ping_marks_last_opened_without_time(auth_client, course, clock):
    data = auth_client.post(
        f"/api/lessons/{lesson('a').pk}/heartbeat", {"seconds": 0}, format="json"
    ).json()

    assert data["last_opened_at"] is not None
    assert data["time_on_page_seconds"] == 0
    assert not StudySession.objects.exists()


def test_heartbeats_accumulate_into_one_session(auth_client, course, clock):
    pk = lesson("a").pk
    for _ in range(3):
        clock.advance(15)
        auth_client.post(f"/api/lessons/{pk}/heartbeat", {"seconds": 15}, format="json")

    progress = LessonProgress.objects.get(lesson_id=pk)
    session = StudySession.objects.get()
    assert progress.time_on_page_seconds == 45
    assert session.seconds == 45
    assert session.ended_at - session.started_at == timedelta(seconds=45)


def test_long_gap_starts_a_new_session(auth_client, course, clock):
    pk = lesson("a").pk
    auth_client.post(f"/api/lessons/{pk}/heartbeat", {"seconds": 15}, format="json")
    clock.advance(StudySession.MAX_GAP_SECONDS + 60)  # tab hidden for a while
    auth_client.post(f"/api/lessons/{pk}/heartbeat", {"seconds": 15}, format="json")

    assert StudySession.objects.count() == 2
    assert LessonProgress.objects.get(lesson_id=pk).time_on_page_seconds == 30


def test_short_gap_extends_the_session(auth_client, course, clock):
    pk = lesson("a").pk
    auth_client.post(f"/api/lessons/{pk}/heartbeat", {"seconds": 15}, format="json")
    clock.advance(60)
    auth_client.post(f"/api/lessons/{pk}/heartbeat", {"seconds": 15}, format="json")

    session = StudySession.objects.get()
    assert session.seconds == 30


def test_heartbeat_is_capped_and_validated(auth_client, course, clock):
    pk = lesson("a").pk

    capped = auth_client.post(f"/api/lessons/{pk}/heartbeat", {"seconds": 5000}, format="json")
    negative = auth_client.post(f"/api/lessons/{pk}/heartbeat", {"seconds": -1}, format="json")

    assert capped.json()["time_on_page_seconds"] == 60
    assert negative.status_code == 400


# --- Continue where I left off ------------------------------------------------------------


def test_continue_starts_with_the_newest_course_when_nothing_was_opened(auth_client, course):
    older = Course.objects.create(title="Antigo", drive_folder_id="old")
    Course.objects.filter(pk=older.pk).update(created_at=timezone.now() - timedelta(days=30))
    make_lesson(Module.objects.create(course=older, title="M", order=0), "old1", 0)

    data = auth_client.get("/api/continue").json()

    assert data["reason"] == "start"
    assert data["lesson"]["id"] == lesson("a").pk
    assert data["lesson"]["course"] == {"id": course.pk, "title": "Curso", "thumbnail_url": None}
    assert data["lesson"]["module"]["title"] == "M1"


def test_continue_resumes_the_last_opened_lesson(auth_client, course, clock):
    open_lesson(auth_client, "a")
    clock.advance(60)
    open_lesson(auth_client, "c", seconds=30)

    data = auth_client.get("/api/continue").json()

    assert (data["reason"], data["lesson"]["id"]) == ("resume", lesson("c").pk)
    assert data["lesson"]["progress"]["time_on_page_seconds"] == 30


def test_continue_moves_on_after_completing_the_last_lesson(auth_client, course, clock):
    open_lesson(auth_client, "a")
    clock.advance(60)
    open_lesson(auth_client, "b")
    auth_client.post(f"/api/lessons/{lesson('b').pk}/complete")

    data = auth_client.get("/api/continue").json()

    # c, not the older half-watched a.
    assert (data["reason"], data["lesson"]["id"]) == ("next", lesson("c").pk)


def test_continue_falls_back_to_older_unfinished_lesson(auth_client, course, clock):
    open_lesson(auth_client, "a")
    for file_id in ("b", "c", "d"):
        auth_client.post(f"/api/lessons/{lesson(file_id).pk}/complete")
    clock.advance(60)
    open_lesson(auth_client, "d")

    data = auth_client.get("/api/continue").json()

    assert (data["reason"], data["lesson"]["id"]) == ("resume", lesson("a").pk)


def test_continue_is_null_when_everything_is_done(auth_client, course):
    for file_id in ("a", "b", "c", "d"):
        auth_client.post(f"/api/lessons/{lesson(file_id).pk}/complete")

    assert auth_client.get("/api/continue").json() == {"lesson": None, "reason": None}


def test_continue_ignores_archived_courses_unless_asked(auth_client, course, clock):
    open_lesson(auth_client, "c")
    Course.objects.filter(pk=course.pk).update(is_archived=True)

    assert auth_client.get("/api/continue").json()["lesson"] is None
    scoped = auth_client.get(f"/api/continue?course={course.pk}").json()
    assert scoped["lesson"]["id"] == lesson("c").pk


def test_continue_scoped_to_a_course(auth_client, course, clock):
    other = Course.objects.create(title="Outro", drive_folder_id="other")
    make_lesson(Module.objects.create(course=other, title="M", order=0), "o1", 0)
    open_lesson(auth_client, "c")
    clock.advance(60)
    open_lesson(auth_client, "o1")

    scoped = auth_client.get(f"/api/continue?course={course.pk}").json()

    assert (scoped["reason"], scoped["lesson"]["id"]) == ("resume", lesson("c").pk)
    assert auth_client.get("/api/continue?course=abc").status_code == 400


def test_continue_skips_lessons_no_longer_playable(auth_client, course, clock):
    open_lesson(auth_client, "a")
    clock.advance(60)
    open_lesson(auth_client, "c")
    Lesson.objects.filter(drive_file_id="c").update(missing_in_drive=True)

    data = auth_client.get("/api/continue").json()

    assert data["lesson"]["id"] == lesson("a").pk


# --- Preferences --------------------------------------------------------------------------


def test_preferences_defaults_and_update(auth_client):
    assert auth_client.get("/api/preferences").json() == {
        "suggest_completion": True,
        "suggest_completion_percent": 90,
    }

    response = auth_client.patch(
        "/api/preferences", {"suggest_completion_percent": 75}, format="json"
    )

    assert response.status_code == 200
    assert StudyPreferences.load().suggest_completion_percent == 75


@pytest.mark.parametrize("percent", [49, 101])
def test_preferences_percent_range(auth_client, percent):
    response = auth_client.patch(
        "/api/preferences", {"suggest_completion_percent": percent}, format="json"
    )

    assert response.status_code == 400
