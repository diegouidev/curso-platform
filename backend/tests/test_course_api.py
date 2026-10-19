import pytest
from django.utils import timezone

from apps.courses.models import Course, Lesson, LessonProgress, Module, Note

pytestmark = pytest.mark.django_db


@pytest.fixture
def course(db) -> Course:
    """2 modules; durations 100/200/300 s; one hidden, one missing, one without duration."""
    course = Course.objects.create(
        title="Curso", drive_folder_id="root", drive_name_original="Curso"
    )
    m1 = Module.objects.create(course=course, title="M1", drive_folder_id="m1", order=0)
    m2 = Module.objects.create(course=course, title="M2", drive_folder_id="m2", order=1)

    def lesson(module, file_id, order, **kw):
        return Lesson.objects.create(
            module=module,
            title=file_id.upper(),
            drive_file_id=file_id,
            drive_name_original=f"{file_id}.mp4",
            mime_type="video/mp4",
            order=order,
            **kw,
        )

    done = lesson(m1, "a", 0, duration_seconds=100)
    lesson(m1, "b", 1, duration_seconds=200)
    lesson(m1, "hidden", 2, duration_seconds=999, is_hidden=True)
    lesson(m2, "c", 0, duration_seconds=300)
    lesson(m2, "gone", 1, duration_seconds=999, missing_in_drive=True)
    lesson(m2, "nodur", 2)
    LessonProgress.objects.create(lesson=done, completed=True, completed_at=timezone.now())
    Note.objects.create(lesson=done, content="anotação")
    Note.objects.create(lesson=Lesson.objects.get(drive_file_id="b"), content="")
    return course


def test_course_list_requires_auth(api_client):
    assert api_client.get("/api/courses").status_code == 401


def test_course_list_with_aggregated_progress(auth_client, course):
    data = auth_client.get("/api/courses").json()

    assert len(data) == 1
    assert data[0]["progress"] == {
        "lessons_total": 4,  # hidden and missing lessons don't count
        "lessons_completed": 1,
        "percent": 25,
        "duration_total_seconds": 600,
        "duration_remaining_seconds": 500,
        "has_durations": True,
    }
    assert data[0]["drive_url"] == "https://drive.google.com/drive/folders/root"
    assert data[0]["latest_job"] is None


def test_hidden_module_is_excluded_from_progress(auth_client, course):
    Module.objects.filter(title="M2").update(is_hidden=True)

    progress = auth_client.get("/api/courses").json()[0]["progress"]

    assert progress["lessons_total"] == 2
    assert progress["percent"] == 50


def test_course_detail_nests_modules_lessons_and_flags(auth_client, course):
    data = auth_client.get(f"/api/courses/{course.pk}").json()

    assert [m["title"] for m in data["modules"]] == ["M1", "M2"]
    m1 = data["modules"][0]
    assert m1["progress"]["lessons_total"] == 2
    assert m1["progress"]["lessons_completed"] == 1
    lessons = {lesson["drive_file_id"]: lesson for lesson in m1["lessons"]}
    assert lessons["a"]["completed"] is True
    assert lessons["a"]["has_note"] is True
    assert lessons["b"]["completed"] is False
    assert lessons["b"]["has_note"] is False  # empty note doesn't count
    assert lessons["hidden"]["is_hidden"] is True  # still listed; the UI decides


def test_course_detail_404(auth_client):
    assert auth_client.get("/api/courses/999").status_code == 404


def test_patch_title_marks_it_custom(auth_client, course):
    response = auth_client.patch(
        f"/api/courses/{course.pk}",
        {"title": "  Meu curso  ", "description": "Notas"},
        format="json",
    )

    assert response.status_code == 200
    course.refresh_from_db()
    assert course.title == "Meu curso"
    assert course.title_is_custom is True
    assert course.description == "Notas"


def test_patch_blank_title_restores_drive_name(auth_client, course):
    course.drive_name_original = "Curso_de_Python"
    course.title, course.title_is_custom = "Outro", True
    course.save()

    auth_client.patch(f"/api/courses/{course.pk}", {"title": ""}, format="json")

    course.refresh_from_db()
    assert course.title == "Curso de Python"
    assert course.title_is_custom is False


def test_patch_archive(auth_client, course):
    auth_client.patch(f"/api/courses/{course.pk}", {"is_archived": True}, format="json")

    course.refresh_from_db()
    assert course.is_archived is True


def test_patch_ignores_read_only_fields(auth_client, course):
    auth_client.patch(f"/api/courses/{course.pk}", {"drive_folder_id": "hack"}, format="json")

    course.refresh_from_db()
    assert course.drive_folder_id == "root"
