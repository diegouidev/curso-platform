import io
import json
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.courses.models import (
    Course,
    Lesson,
    LessonProgress,
    Module,
    Note,
    StudyPreferences,
    StudySession,
)

pytestmark = pytest.mark.django_db


def make_lesson(module: Module, file_id: str, name: str, order: int, **kw) -> Lesson:
    return Lesson.objects.create(
        module=module,
        title=name,
        drive_file_id=file_id,
        drive_name_original=name,
        mime_type="video/mp4",
        order=order,
        **kw,
    )


@pytest.fixture
def course(db) -> Course:
    course = Course.objects.create(title="Curso", drive_folder_id="root", clean_titles=True)
    general = Module.objects.create(
        course=course, title="Geral", drive_folder_id="root", drive_name_original="", order=0
    )
    m1 = Module.objects.create(
        course=course,
        title="Módulo 2",
        drive_folder_id="m2",
        drive_name_original="Módulo 2",
        order=1,
    )
    m2 = Module.objects.create(
        course=course,
        title="Módulo 10",
        drive_folder_id="m10",
        drive_name_original="Módulo 10",
        order=2,
    )
    make_lesson(general, "g1", "Boas vindas.mp4", 0)
    make_lesson(m1, "a10", "Aula 10.mp4", 0)
    make_lesson(m1, "a2", "Aula 2.mp4", 1)
    make_lesson(m1, "deep", "Aula_3.mp4", 2, drive_path="Parte 1 / Extras")
    make_lesson(m2, "b1", "Aula 1.mp4", 0)
    return course


def lesson(file_id: str) -> Lesson:
    return Lesson.objects.get(drive_file_id=file_id)


def module(folder_id: str) -> Module:
    return Module.objects.get(drive_folder_id=folder_id)


# --- Titles and visibility ------------------------------------------------------------------


def test_rename_and_restore_module(auth_client, course):
    url = f"/api/modules/{module('m2').pk}"

    renamed = auth_client.patch(url, {"title": "  Fundamentos  "}, format="json").json()
    restored = auth_client.patch(url, {"title": ""}, format="json").json()

    assert (renamed["title"], renamed["title_is_custom"]) == ("Fundamentos", True)
    assert (restored["title"], restored["title_is_custom"]) == ("Módulo 2", False)


def test_restoring_the_root_module_title_gives_geral(auth_client, course):
    auth_client.patch(f"/api/modules/{module('root').pk}", {"title": "Extra"}, format="json")

    data = auth_client.patch(f"/api/modules/{module('root').pk}", {"title": ""}, format="json")

    assert data.json()["title"] == "Geral"


def test_restore_lesson_title_uses_drive_path_and_cleanup(auth_client, course):
    url = f"/api/lessons/{lesson('deep').pk}"
    auth_client.patch(url, {"title": "Minha aula"}, format="json")

    data = auth_client.patch(url, {"title": ""}, format="json").json()

    assert data["title"] == "Parte 1 / Extras / Aula 3"
    assert data["title_is_custom"] is False


def test_hiding_items_changes_progress_and_navigation(auth_client, course):
    auth_client.patch(f"/api/lessons/{lesson('a2').pk}", {"is_hidden": True}, format="json")
    auth_client.patch(f"/api/modules/{module('m10').pk}", {"is_hidden": True}, format="json")

    progress = auth_client.get(f"/api/courses/{course.pk}").json()["progress"]
    nav = auth_client.get(f"/api/lessons/{lesson('a10').pk}").json()

    assert progress["lessons_total"] == 3  # g1, a10, deep
    assert nav["next"]["id"] == lesson("deep").pk
    assert lesson("a2").is_hidden is True


def test_item_update_validation(auth_client, course):
    assert auth_client.patch("/api/modules/9999", {"title": "x"}, format="json").status_code == 404
    response = auth_client.patch(
        f"/api/lessons/{lesson('a2').pk}", {"title": "x" * 501}, format="json"
    )
    assert response.status_code == 400


def test_lesson_get_still_serves_the_player(auth_client, course):
    data = auth_client.get(f"/api/lessons/{lesson('a2').pk}").json()

    assert data["embed_url"].endswith("/a2/preview")


# --- Order --------------------------------------------------------------------------------


def test_reorder_modules_marks_custom_order(auth_client, course):
    ids = [module("m10").pk, module("root").pk, module("m2").pk]

    response = auth_client.post(
        "/api/reorder", {"kind": "modules", "parent_id": course.pk, "ids": ids}, format="json"
    )

    assert response.status_code == 204
    detail = auth_client.get(f"/api/courses/{course.pk}").json()
    assert [m["id"] for m in detail["modules"]] == ids
    course.refresh_from_db()
    assert course.modules_order_is_custom is True


def test_reorder_lessons(auth_client, course):
    m = module("m2")
    ids = [lesson("deep").pk, lesson("a2").pk, lesson("a10").pk]

    auth_client.post(
        "/api/reorder", {"kind": "lessons", "parent_id": m.pk, "ids": ids}, format="json"
    )

    assert list(m.lessons.values_list("pk", flat=True)) == ids
    m.refresh_from_db()
    assert m.lessons_order_is_custom is True


@pytest.mark.parametrize(
    "ids",
    [
        pytest.param(lambda: [module("m2").pk, module("root").pk], id="missing one"),
        pytest.param(
            lambda: [module("m2").pk, module("m2").pk, module("root").pk], id="duplicated"
        ),
        pytest.param(lambda: [module("m2").pk, module("root").pk, 99999], id="unknown id"),
    ],
)
def test_reorder_rejects_incomplete_lists(auth_client, course, ids):
    response = auth_client.post(
        "/api/reorder", {"kind": "modules", "parent_id": course.pk, "ids": ids()}, format="json"
    )

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_order"


def test_reset_order_goes_back_to_natural_drive_order(auth_client, course):
    auth_client.post(
        "/api/reorder",
        {
            "kind": "modules",
            "parent_id": course.pk,
            "ids": [module("m10").pk, module("m2").pk, module("root").pk],
        },
        format="json",
    )
    Lesson.objects.filter(drive_file_id="a2").update(missing_in_drive=True)

    data = auth_client.post(f"/api/courses/{course.pk}/reset-order").json()

    assert [m["title"] for m in data["modules"]] == ["Geral", "Módulo 2", "Módulo 10"]
    lessons = [x["drive_file_id"] for x in data["modules"][1]["lessons"]]
    assert lessons == ["a10", "deep", "a2"]  # "Aula 10" < "Parte 1/…"; missing last
    course.refresh_from_db()
    assert course.modules_order_is_custom is False


# --- Thumbnail ----------------------------------------------------------------------------


def png(name: str = "capa.png", size: tuple[int, int] = (32, 18)) -> SimpleUploadedFile:
    buffer = io.BytesIO()
    Image.new("RGB", size, "teal").save(buffer, format="PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


def test_thumbnail_upload_serve_and_replace(auth_client, course):
    url = f"/api/courses/{course.pk}/thumbnail"

    first = auth_client.put(url, {"file": png()}, format="multipart").json()
    path = first["thumbnail_url"]
    assert path.startswith("/api/media/thumbnails/course-")
    assert path.endswith(".png")
    served = auth_client.get(path)
    assert served.status_code == 200
    assert b"".join(served.streaming_content).startswith(b"\x89PNG")
    assert APIClient().get(path).status_code == 401  # no token, no cookie

    second = auth_client.put(url, {"file": png("nova.png")}, format="multipart").json()

    assert second["thumbnail_url"] != path
    assert auth_client.get(path).status_code == 404  # old file deleted
    assert auth_client.delete(url).json()["thumbnail_url"] is None


def test_media_accepts_the_refresh_cookie(auth_client, course):
    path = auth_client.put(
        f"/api/courses/{course.pk}/thumbnail", {"file": png()}, format="multipart"
    ).json()["thumbnail_url"]
    auth_client.credentials()  # drop the Bearer header: only the cookie is left, like an <img>

    assert auth_client.get(path).status_code == 200


def test_media_rejects_path_traversal(auth_client):
    response = auth_client.get("/api/media/../../config/settings.py")

    assert response.status_code in {400, 404}


def test_thumbnail_rejects_non_images(auth_client, course):
    fake = SimpleUploadedFile("capa.png", b"not an image", content_type="image/png")

    response = auth_client.put(
        f"/api/courses/{course.pk}/thumbnail", {"file": fake}, format="multipart"
    )

    assert response.status_code == 400


# --- Export -------------------------------------------------------------------------------


@pytest.fixture
def studied(course):
    now = timezone.now()
    a2, b1 = lesson("a2"), lesson("b1")
    LessonProgress.objects.create(
        lesson=a2,
        completed=True,
        completed_at=now - timedelta(days=2),
        last_opened_at=now - timedelta(days=2),
        time_on_page_seconds=600,
    )
    StudySession.objects.create(
        lesson=a2, started_at=now - timedelta(days=2), ended_at=now - timedelta(days=2), seconds=600
    )
    Note.objects.create(lesson=b1, content="# Resumo\n\nObserver desacopla.")
    Note.objects.create(lesson=lesson("a10"), content="")  # empty: not exported
    StudyPreferences.objects.update_or_create(pk=1, defaults={"suggest_completion_percent": 75})
    return course


def test_export_json_has_only_lessons_with_user_data(auth_client, studied):
    response = auth_client.get("/api/export?type=json")

    assert response["Content-Disposition"].startswith('attachment; filename="backup-estudos-')
    data = json.loads(response.content)
    assert data["format"] == "curso-platform-backup"
    assert data["preferences"]["suggest_completion_percent"] == 75
    lessons = {x["drive_file_id"]: x for x in data["courses"][0]["lessons"]}
    assert set(lessons) == {"a2", "b1"}
    assert lessons["a2"]["progress"]["completed"] is True
    assert len(lessons["a2"]["sessions"]) == 1
    assert lessons["b1"]["note"]["content"].startswith("# Resumo")


def test_export_markdown_has_notes_by_course_and_module(auth_client, studied):
    response = auth_client.get("/api/export?type=md")
    text = response.content.decode()

    assert response["Content-Type"].startswith("text/markdown")
    assert "## Curso" in text
    assert "### Módulo 10" in text
    assert "#### Aula 1.mp4" in text
    assert "Observer desacopla." in text


# --- Restore ------------------------------------------------------------------------------


def upload(client, data: dict | bytes):
    content = data if isinstance(data, bytes) else json.dumps(data).encode()
    file = SimpleUploadedFile("backup.json", content, content_type="application/json")
    return client.post("/api/import-backup", {"file": file}, format="multipart")


def test_backup_roundtrip_restores_everything(auth_client, studied):
    exported = json.loads(auth_client.get("/api/export").content)
    LessonProgress.objects.all().delete()
    Note.objects.all().delete()
    StudySession.objects.all().delete()
    StudyPreferences.objects.all().delete()

    stats = upload(auth_client, exported).json()

    assert stats["lessons_matched"] == 2
    assert stats["progress_updated"] == 1
    assert stats["notes_restored"] == 1
    assert stats["sessions_added"] == 1
    assert stats["preferences_restored"] is True
    assert LessonProgress.objects.get(lesson__drive_file_id="a2").completed is True
    assert Note.objects.get(lesson__drive_file_id="b1").content.startswith("# Resumo")
    assert StudyPreferences.load().suggest_completion_percent == 75


def test_restoring_twice_changes_nothing(auth_client, studied):
    exported = json.loads(auth_client.get("/api/export").content)

    stats = upload(auth_client, exported).json()

    assert (stats["progress_updated"], stats["notes_restored"], stats["sessions_added"]) == (
        0,
        0,
        0,
    )


def test_restore_merges_without_losing_newer_local_data(auth_client, studied):
    exported = json.loads(auth_client.get("/api/export").content)
    # After the backup: a2 was un-completed locally? A backup never un-completes, and a
    # newer local note must survive an older backup note.
    lessons = {x["drive_file_id"]: x for x in exported["courses"][0]["lessons"]}
    lessons["a2"]["progress"]["completed"] = False
    lessons["b1"]["note"]["updated_at"] = (timezone.now() - timedelta(days=30)).isoformat()
    lessons["b1"]["note"]["content"] = "versão antiga"

    upload(auth_client, exported)

    assert LessonProgress.objects.get(lesson__drive_file_id="a2").completed is True
    assert Note.objects.get(lesson__drive_file_id="b1").content.startswith("# Resumo")


def test_restore_reports_courses_not_imported(auth_client, studied):
    exported = json.loads(auth_client.get("/api/export").content)
    exported["courses"].append(
        {"drive_folder_id": "other", "title": "Outro curso", "lessons": [{"drive_file_id": "z"}]}
    )

    stats = upload(auth_client, exported).json()

    assert stats["courses_not_found"] == ["Outro curso"]
    assert stats["lessons_not_found"] == 1


@pytest.mark.parametrize(
    "content",
    [b"not json", json.dumps({"format": "other", "version": 1, "courses": []}).encode()],
)
def test_restore_rejects_invalid_files(auth_client, content):
    response = upload(auth_client, content)

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_backup"
