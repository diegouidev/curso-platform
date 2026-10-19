"""End-to-end import/sync through the API with an in-memory Drive (jobs run inline)."""

import pytest
from django.utils import timezone

from apps.courses.models import Attachment, Course, ImportJob, Lesson, LessonProgress, Module, Note
from tests.fakes import FOLDER, FakeDrive

pytestmark = pytest.mark.django_db

ROOT = "root0000000001"


def build_course_tree(drive: FakeDrive) -> None:
    """
    Curso de Python/
      00 - Boas-vindas.mp4            -> "Geral"
      Leia-me.pdf                     -> attachment of "Geral"
      Módulo 2 - Avançado/
        Aula 10.mp4, Aula 2.mp4, Aula 1.mp4
        Aula 2.pdf                    -> attachment of lesson "Aula 2"
        Slides gerais (Google Slides) -> attachment of the module
      Módulo 1 - Básico/
        01_Introducao.mp4 (125.4 s)
        Atalho.mp4 (shortcut to a video outside the course)
        Extras/
          Bônus.mp4
          Mais/
            Deep.mp4
            Volta (shortcut to "Módulo 1 - Básico" -> cycle, ignored)
      Vazia/                          -> no module
    """
    drive.folder(ROOT, "Curso de Python")
    drive.file("welcome", "00 - Boas-vindas.mp4", ROOT, duration_ms=60000)
    drive.file("readme", "Leia-me.pdf", ROOT, mime="application/pdf")

    m2 = drive.folder("mod2", "Módulo 2 - Avançado", ROOT)
    drive.file("a10", "Aula 10.mp4", m2, duration_ms=600000)
    drive.file("a2", "Aula 2.mp4", m2, duration_ms=300000)
    drive.file("a1", "Aula 1.mp4", m2, duration_ms=200000)
    drive.file("a2pdf", "Aula 2.pdf", m2, mime="application/pdf")
    drive.file("slides", "Slides gerais", m2, mime="application/vnd.google-apps.presentation")

    m1 = drive.folder("mod1", "Módulo 1 - Básico", ROOT)
    drive.file("intro", "01_Introducao.mp4", m1, duration_ms=125400)
    drive.folder("elsewhere", "Outra pasta")
    drive.file("external", "Vídeo externo.mp4", "elsewhere")
    drive.shortcut("sc-video", "Atalho.mp4", m1, target_id="external", target_mime="video/mp4")
    extras = drive.folder("extras", "Extras", m1)
    drive.file("bonus", "Bônus.mp4", extras)
    mais = drive.folder("mais", "Mais", extras)
    drive.file("deep", "Deep.mp4", mais)
    drive.shortcut("sc-cycle", "Volta", mais, target_id="mod1", target_mime=FOLDER)

    drive.folder("empty", "Vazia", ROOT)


@pytest.fixture
def drive(fake_drive: FakeDrive) -> FakeDrive:
    build_course_tree(fake_drive)
    return fake_drive


def import_course(client, folder=ROOT, **extra):
    return client.post("/api/courses/import", {"folder": folder, **extra}, format="json")


def lesson_titles(module: Module) -> list[str]:
    return list(module.lessons.order_by("order").values_list("title", flat=True))


def sync(client, course: Course):
    return client.post(f"/api/courses/{course.pk}/sync")


# --- initial import -------------------------------------------------------------------------
def test_import_maps_folders_to_modules_and_videos_to_lessons(auth_client, google_connected, drive):
    response = import_course(
        auth_client, f"https://drive.google.com/drive/folders/{ROOT}?usp=sharing"
    )

    assert response.status_code == 202, response.json()
    body = response.json()
    assert body["job"]["status"] == "success"
    assert body["job"]["stats"]["lessons_created"] == 8
    course = Course.objects.get()
    assert course.title == "Curso de Python"
    assert course.drive_folder_id == ROOT
    assert course.last_imported_at is not None

    modules = list(course.modules.order_by("order"))
    assert [m.title for m in modules] == ["Geral", "Módulo 1 - Básico", "Módulo 2 - Avançado"]
    general, mod1, mod2 = modules
    assert general.drive_folder_id == ROOT

    assert lesson_titles(general) == ["00 - Boas-vindas"]
    assert lesson_titles(mod2) == ["Aula 1", "Aula 2", "Aula 10"]
    assert lesson_titles(mod1) == [
        "01 Introducao",
        "Atalho",
        "Extras / Bônus",
        "Extras / Mais / Deep",
    ]


def test_import_reads_durations_and_shortcut_targets(auth_client, google_connected, drive):
    import_course(auth_client)

    intro = Lesson.objects.get(drive_file_id="intro")
    assert intro.duration_seconds == 125
    assert intro.drive_name_original == "01_Introducao.mp4"
    assert intro.mime_type == "video/mp4"
    assert intro.drive_modified_at is not None
    shortcut = Lesson.objects.get(title="Atalho")
    assert shortcut.drive_file_id == "external"  # embeds the real video, not the shortcut
    assert Lesson.objects.get(drive_file_id="deep").drive_path == "Extras / Mais"


def test_import_attachments(auth_client, google_connected, drive):
    import_course(auth_client)

    pdf = Attachment.objects.get(drive_file_id="a2pdf")
    assert pdf.lesson.drive_file_id == "a2"
    assert pdf.module is None
    slides = Attachment.objects.get(drive_file_id="slides")
    assert slides.module.title == "Módulo 2 - Avançado"
    assert slides.title == "Slides gerais"
    readme = Attachment.objects.get(drive_file_id="readme")
    assert readme.module.title == "Geral"
    assert readme.title == "Leia-me"


def test_import_paginates_and_sends_readonly_params(auth_client, google_connected, drive):
    import_course(auth_client)

    assert any(call.get("pageToken") for call in drive.list_calls)  # page 2+ was requested
    assert all(call["supportsAllDrives"] for call in drive.list_calls)
    listed = {call["q"].split("'")[1] for call in drive.list_calls}
    assert listed == {ROOT, "mod1", "mod2", "extras", "mais", "empty"}  # cycle not re-listed


def test_import_without_title_cleanup(auth_client, google_connected, drive):
    import_course(auth_client, clean_titles=False)

    assert Lesson.objects.get(drive_file_id="intro").title == "01_Introducao"


def test_import_reports_progress_counters(auth_client, google_connected, drive):
    job = import_course(auth_client).json()["job"]

    assert job["folders_scanned"] == 6
    assert job["files_found"] == 11  # folder shortcuts are not files


# --- import errors ------------------------------------------------------------------------
def test_import_rejects_invalid_link(auth_client, google_connected, drive):
    response = import_course(auth_client, "https://example.com/whatever")

    assert response.status_code == 400
    assert "folder" in response.json()
    assert not Course.objects.exists()


def test_import_requires_google_connection(auth_client, drive):
    response = import_course(auth_client)

    assert response.status_code == 409
    assert response.json()["code"] == "google_not_connected"


def test_import_requires_reconnect_when_flagged(auth_client, google_connected, drive):
    google_connected.needs_reconnect = True
    google_connected.save()

    response = import_course(auth_client)

    assert response.status_code == 409
    assert response.json()["code"] == "google_reconnect_required"


def test_import_folder_without_access(auth_client, google_connected, drive):
    response = import_course(auth_client, "1NoAccessFolderId000000")

    assert response.status_code == 400
    assert response.json()["code"] == "drive_not_found"
    assert not Course.objects.exists()


def test_import_forbidden_folder(auth_client, google_connected, drive):
    drive.items[ROOT].forbidden = True

    response = import_course(auth_client)

    assert response.status_code == 400
    assert response.json()["code"] == "drive_access_denied"


def test_import_link_to_a_file_is_rejected(auth_client, google_connected, drive):
    drive.file("1VideoFileIdAAAAAAAAA", "video.mp4", ROOT)

    response = import_course(auth_client, "1VideoFileIdAAAAAAAAA")

    assert response.status_code == 400
    assert response.json()["code"] == "drive_not_a_folder"


def test_import_same_folder_twice(auth_client, google_connected, drive):
    first = import_course(auth_client).json()

    response = import_course(auth_client)

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Esta pasta já foi importada.",
        "code": "course_exists",
        "course_id": first["course"]["id"],
    }


def test_rate_limit_during_scan_fails_job_without_partial_data(
    auth_client, google_connected, drive
):
    original_list = drive._list
    calls = {"n": 0}

    def flaky_list(parent, token):
        calls["n"] += 1
        if calls["n"] >= 3:  # root ok, first module ok, then Google keeps throttling
            from tests.fakes import http_error

            raise http_error(429, "rateLimitExceeded")
        return original_list(parent, token)

    drive._list = flaky_list

    job = import_course(auth_client).json()["job"]

    assert job["status"] == "error"
    assert job["error_code"] == "drive_rate_limited"
    assert "limitando" in job["error_message"]
    course = Course.objects.get()
    assert course.modules.count() == 0  # scan failed before anything was written


def test_sync_while_job_running_is_rejected(auth_client, google_connected, drive):
    import_course(auth_client)
    course = Course.objects.get()
    ImportJob.objects.create(course=course, kind="sync", status="running")

    response = sync(auth_client, course)

    assert response.status_code == 409
    assert response.json()["code"] == "import_running"


def test_stale_running_job_does_not_block_sync(auth_client, google_connected, drive):
    import_course(auth_client)
    course = Course.objects.get()
    stale = ImportJob.objects.create(course=course, kind="sync", status="running")
    ImportJob.objects.filter(pk=stale.pk).update(
        updated_at=timezone.now() - timezone.timedelta(minutes=30)
    )

    response = sync(auth_client, course)

    assert response.status_code == 202
    stale.refresh_from_db()
    assert stale.status == "error" and stale.error_code == "stale"


def test_job_detail_endpoint(auth_client, google_connected, drive):
    job_id = import_course(auth_client).json()["job"]["id"]

    response = auth_client.get(f"/api/import-jobs/{job_id}")

    assert response.status_code == 200
    assert response.json()["status"] == "success"


# --- re-import / sync -------------------------------------------------------------------------
@pytest.fixture
def imported(auth_client, google_connected, drive) -> Course:
    import_course(auth_client)
    return Course.objects.get()


def test_sync_without_changes_is_idempotent(auth_client, imported, drive):
    before = list(Lesson.objects.order_by("id").values("id", "title", "order", "module_id"))

    job = sync(auth_client, imported).json()

    assert job["status"] == "success"
    stats = job["stats"]
    assert stats["lessons_created"] == stats["lessons_updated"] == stats["lessons_missing"] == 0
    assert stats["modules_created"] == 0
    after = list(Lesson.objects.order_by("id").values("id", "title", "order", "module_id"))
    assert after == before
    assert Attachment.objects.count() == 3


def test_sync_preserves_progress_notes_and_custom_titles(auth_client, imported, drive):
    a1, a2, a10 = (Lesson.objects.get(drive_file_id=i) for i in ("a1", "a2", "a10"))
    LessonProgress.objects.create(lesson=a2, completed=True, completed_at=timezone.now())
    LessonProgress.objects.create(lesson=a10, completed=True, time_on_page_seconds=900)
    Note.objects.create(lesson=a2, content="# minhas notas")
    Note.objects.create(lesson=a10, content="nota da aula que vai sumir")
    a1.title, a1.title_is_custom = "Minha aula 1", True
    a1.save()

    drive.rename("a1", "Aula 1 - renomeada.mp4")
    drive.rename("a2", "Aula 2 - Variáveis.mp4")
    drive.remove("a10")
    drive.file("a3", "Aula 3.mp4", "mod2")
    drive.folder("mod3", "Módulo 3 - Extra", ROOT)
    drive.file("m3a1", "Aula final.mp4", "mod3")
    drive.remove("a2pdf")

    stats = sync(auth_client, imported).json()["stats"]

    assert stats["lessons_created"] == 2
    assert stats["lessons_missing"] == 1
    assert stats["modules_created"] == 1

    a1.refresh_from_db()
    a2.refresh_from_db()
    a10.refresh_from_db()
    assert a1.title == "Minha aula 1"  # user edit kept...
    assert a1.drive_name_original == "Aula 1 - renomeada.mp4"  # ...but Drive name tracked
    assert a2.title == "Aula 2 - Variáveis"
    assert a2.progress.completed is True
    assert a2.note.content == "# minhas notas"
    assert a10.missing_in_drive is True  # never deleted
    assert a10.progress.time_on_page_seconds == 900
    assert a10.note.content == "nota da aula que vai sumir"

    mod2 = Module.objects.get(drive_folder_id="mod2")
    assert lesson_titles(mod2) == ["Minha aula 1", "Aula 2 - Variáveis", "Aula 3", "Aula 10"]
    assert [m.title for m in imported.modules.order_by("order")][-1] == "Módulo 3 - Extra"
    assert not Attachment.objects.filter(drive_file_id="a2pdf").exists()


def test_sync_restores_lesson_that_comes_back(auth_client, imported, drive):
    drive.remove("a10")
    sync(auth_client, imported)
    drive.file("a10", "Aula 10.mp4", "mod2")

    stats = sync(auth_client, imported).json()["stats"]

    assert stats["lessons_restored"] == 1
    assert Lesson.objects.get(drive_file_id="a10").missing_in_drive is False
    assert Lesson.objects.filter(drive_file_id="a10").count() == 1


def test_sync_updates_course_and_module_names_unless_custom(auth_client, imported, drive):
    imported.title, imported.title_is_custom = "Python do zero", True
    imported.save()
    drive.rename(ROOT, "Curso de Python 2026")
    drive.rename("mod1", "Módulo 1 - Fundamentos")

    sync(auth_client, imported)

    imported.refresh_from_db()
    assert imported.title == "Python do zero"
    assert imported.drive_name_original == "Curso de Python 2026"
    assert Module.objects.get(drive_folder_id="mod1").title == "Módulo 1 - Fundamentos"


def test_sync_flags_removed_module(auth_client, imported, drive):
    for item_id in ["a10", "a2", "a1", "a2pdf", "slides", "mod2"]:
        drive.remove(item_id)

    stats = sync(auth_client, imported).json()["stats"]

    assert stats["modules_missing"] == 1
    module = Module.objects.get(drive_folder_id="mod2")
    assert module.missing_in_drive is True
    assert module.lessons.filter(missing_in_drive=True).count() == 3


def test_sync_moves_lesson_between_modules_keeping_identity(auth_client, imported, drive):
    lesson = Lesson.objects.get(drive_file_id="a1")
    LessonProgress.objects.create(lesson=lesson, completed=True)
    drive.move("a1", "mod1")

    sync(auth_client, imported)

    lesson.refresh_from_db()
    assert lesson.module.drive_folder_id == "mod1"
    assert lesson.progress.completed is True


def test_sync_respects_custom_lesson_order(auth_client, imported, drive):
    mod2 = Module.objects.get(drive_folder_id="mod2")
    for order, file_id in enumerate(["a10", "a1", "a2"]):
        Lesson.objects.filter(drive_file_id=file_id).update(order=order)
    mod2.lessons_order_is_custom = True
    mod2.save()
    drive.file("a3", "Aula 3.mp4", "mod2")

    sync(auth_client, imported)

    assert lesson_titles(mod2) == ["Aula 10", "Aula 1", "Aula 2", "Aula 3"]


def test_sync_respects_custom_module_order(auth_client, imported, drive):
    imported.modules_order_is_custom = True
    imported.save()
    Module.objects.filter(drive_folder_id="mod2").update(order=0)
    Module.objects.filter(drive_folder_id=ROOT).update(order=1)
    Module.objects.filter(drive_folder_id="mod1").update(order=2)
    drive.folder("mod0", "Módulo 0", ROOT)
    drive.file("m0", "Aula zero.mp4", "mod0")

    sync(auth_client, imported)

    titles = [m.title for m in imported.modules.order_by("order")]
    assert titles == ["Módulo 2 - Avançado", "Geral", "Módulo 1 - Básico", "Módulo 0"]


def test_sync_failure_keeps_existing_data(auth_client, imported, drive):
    before = Lesson.objects.count()
    drive.items[ROOT].forbidden = True

    job = sync(auth_client, imported).json()

    assert job["status"] == "error"
    assert job["error_code"] == "drive_access_denied"
    assert Lesson.objects.count() == before
    assert not Lesson.objects.filter(missing_in_drive=True).exists()
