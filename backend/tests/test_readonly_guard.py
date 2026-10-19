"""Guards for the project's hard rule: never write to (or download from) the Drive."""

import re
from pathlib import Path

from apps.drive.oauth import SCOPES

APPS = Path(__file__).resolve().parent.parent / "apps"
CLIENT = APPS / "drive" / "client.py"

FORBIDDEN_METHODS = re.compile(
    r"\.(create|update|delete|copy|emptyTrash|untrash|insert|patch|get_media|export|"
    r"export_media|watch|modifyLabels|generateIds|generateCseToken)\("
)
FORBIDDEN_RESOURCES = re.compile(
    r"\.(permissions|comments|replies|revisions|drives|changes|teamdrives|channels|apps)\(\)"
)


def python_sources() -> list[Path]:
    return [p for p in APPS.rglob("*.py") if "migrations" not in p.parts]


def test_only_the_readonly_scope_is_requested():
    assert SCOPES == ["https://www.googleapis.com/auth/drive.readonly"]


def test_only_the_drive_client_talks_to_the_google_api():
    offenders = [
        str(p.relative_to(APPS))
        for p in python_sources()
        if p != CLIENT and "googleapiclient" in p.read_text()
    ]
    assert offenders == []


def test_drive_client_has_no_write_or_download_calls():
    source = CLIENT.read_text()

    assert FORBIDDEN_METHODS.findall(source) == []
    assert FORBIDDEN_RESOURCES.findall(source) == []
    assert "MediaIoBaseDownload" not in source


def test_scope_strings_never_widen():
    """No other Google scope may appear anywhere in the app code."""
    scope = re.compile(r"https://www\.googleapis\.com/auth/[\w.]+")
    found = {m for p in python_sources() for m in scope.findall(p.read_text())}
    assert found == {"https://www.googleapis.com/auth/drive.readonly"}
