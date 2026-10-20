import sqlite3
import tarfile
import tempfile
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError, CommandParser


class Command(BaseCommand):
    help = (
        "Consistent snapshot of the SQLite database plus uploaded files (covers) into a "
        ".tar.gz. Safe while the app is running (SQLite online backup API)."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("output", help="Path of the .tar.gz to create.")

    def handle(self, *args: object, output: str, **options: object) -> None:
        database = settings.DATABASES["default"]
        if database["ENGINE"] != "django.db.backends.sqlite3":
            raise CommandError("Only SQLite is supported here; for PostgreSQL use pg_dump.")

        target = Path(output)
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            snapshot = Path(tmp) / "db.sqlite3"
            source = sqlite3.connect(database["NAME"])
            copy = sqlite3.connect(snapshot)
            try:
                source.backup(copy)  # consistent even with the WAL and concurrent writes
            finally:
                copy.close()
                source.close()
            with tarfile.open(target, "w:gz") as archive:
                archive.add(snapshot, arcname="db.sqlite3")
                media = Path(settings.MEDIA_ROOT)
                if media.exists():
                    archive.add(media, arcname="media")
        self.stdout.write(str(target))
