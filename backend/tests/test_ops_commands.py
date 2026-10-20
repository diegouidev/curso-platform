import sqlite3
import tarfile
from datetime import timedelta

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone

from apps.courses.models import Course, ImportJob

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def course(db) -> Course:
    return Course.objects.create(title="Curso de backup", drive_folder_id="root-folder-1")


def test_backup_data_has_a_readable_database_and_the_covers(tmp_path, settings, course):
    cover = settings.MEDIA_ROOT / "thumbnails" / "capa.png"
    cover.parent.mkdir(parents=True, exist_ok=True)
    cover.write_bytes(b"png")
    output = tmp_path / "out" / "backup.tar.gz"

    call_command("backup_data", str(output))

    with tarfile.open(output) as archive:
        names = archive.getnames()
        archive.extractall(tmp_path / "x", filter="data")
    assert "db.sqlite3" in names
    assert "media/thumbnails/capa.png" in names
    copy = sqlite3.connect(tmp_path / "x" / "db.sqlite3")
    titles = copy.execute("select title from courses_course").fetchall()
    copy.close()
    assert titles == [("Curso de backup",)]


def test_imports_idle_blocks_while_an_import_runs(course):
    ImportJob.objects.create(course=course, kind="import", status="running")

    with pytest.raises(CommandError, match="Curso de backup"):
        call_command("imports_idle")


def test_imports_idle_ignores_finished_and_stale_jobs(course):
    ImportJob.objects.create(course=course, kind="import", status="success")
    stale = ImportJob.objects.create(course=course, kind="sync", status="running")
    ImportJob.objects.filter(pk=stale.pk).update(
        updated_at=timezone.now() - timedelta(seconds=ImportJob.STALE_AFTER_SECONDS + 60)
    )

    call_command("imports_idle")  # no error

    stale.refresh_from_db()
    assert stale.status == "error"
