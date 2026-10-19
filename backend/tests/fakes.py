"""In-memory stand-in for the Drive v3 service object (`build("drive", "v3")`).

Implements only what DriveClient uses — `files().list`, `files().get`, `about().get` — and
asserts on every call that the read-only/shared-drive parameters are sent. Pages are tiny
by default so pagination is always exercised.
"""

import json
import re
from dataclasses import dataclass, field

import httplib2
from googleapiclient.errors import HttpError

FOLDER = "application/vnd.google-apps.folder"
SHORTCUT = "application/vnd.google-apps.shortcut"
LIST_QUERY = re.compile(r"^'(?P<parent>[^']+)' in parents and trashed = false$")
EXPECTED_LIST_FIELDS = (
    "nextPageToken, files(id, name, mimeType, videoMediaMetadata(durationMillis), "
    "modifiedTime, shortcutDetails(targetId, targetMimeType))"
)


def http_error(status: int, reason: str = "") -> HttpError:
    errors = [{"reason": reason, "message": reason}] if reason else []
    content = json.dumps({"error": {"code": status, "errors": errors}}).encode()
    return HttpError(httplib2.Response({"status": status}), content)


@dataclass
class Item:
    id: str
    name: str
    mime_type: str
    parent: str | None
    duration_ms: int | None = None
    modified: str = "2026-01-10T12:00:00.000Z"
    target_id: str | None = None
    target_mime: str | None = None
    forbidden: bool = False

    def as_api(self) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "mimeType": self.mime_type,
            "modifiedTime": self.modified,
        }
        if self.duration_ms is not None:
            data["videoMediaMetadata"] = {"durationMillis": str(self.duration_ms)}
        if self.mime_type == SHORTCUT:
            data["shortcutDetails"] = {
                "targetId": self.target_id,
                "targetMimeType": self.target_mime,
            }
        return data


class _Request:
    def __init__(self, drive: "FakeDrive", fn):
        self._drive, self._fn = drive, fn

    def execute(self):
        if self._drive.pending_errors:
            raise self._drive.pending_errors.pop(0)
        return self._fn()


class _Files:
    def __init__(self, drive: "FakeDrive"):
        self._drive = drive

    def list(self, **kwargs):
        self._drive.calls.append(("files.list", kwargs))
        assert kwargs["supportsAllDrives"] is True
        assert kwargs["includeItemsFromAllDrives"] is True
        assert kwargs["fields"] == EXPECTED_LIST_FIELDS
        match = LIST_QUERY.match(kwargs["q"])
        assert match, f"unexpected query: {kwargs['q']}"
        return _Request(
            self._drive, lambda: self._drive._list(match["parent"], kwargs.get("pageToken"))
        )

    def get(self, **kwargs):
        self._drive.calls.append(("files.get", kwargs))
        assert kwargs["supportsAllDrives"] is True
        return _Request(self._drive, lambda: self._drive._get(kwargs["fileId"]))


class _About:
    def __init__(self, drive: "FakeDrive"):
        self._drive = drive

    def get(self, **kwargs):
        self._drive.calls.append(("about.get", kwargs))
        return _Request(self._drive, lambda: {"user": {"emailAddress": self._drive.email}})


@dataclass
class FakeDrive:
    page_size: int = 2
    email: str = "diegocoelho44@gmail.com"
    items: dict[str, Item] = field(default_factory=dict)
    calls: list[tuple[str, dict]] = field(default_factory=list)
    pending_errors: list[Exception] = field(default_factory=list)

    # --- tree building ---------------------------------------------------------------
    def folder(self, id: str, name: str, parent: str | None = None) -> str:
        self.items[id] = Item(id, name, FOLDER, parent)
        return id

    def file(self, id: str, name: str, parent: str, mime: str = "video/mp4", **extra) -> str:
        self.items[id] = Item(id, name, mime, parent, **extra)
        return id

    def shortcut(self, id: str, name: str, parent: str, target_id: str, target_mime: str) -> str:
        self.items[id] = Item(
            id, name, SHORTCUT, parent, target_id=target_id, target_mime=target_mime
        )
        return id

    def remove(self, id: str) -> None:
        del self.items[id]

    def rename(self, id: str, name: str) -> None:
        self.items[id].name = name

    def move(self, id: str, parent: str) -> None:
        self.items[id].parent = parent

    def fail_next(self, status: int, reason: str = "", times: int = 1) -> None:
        self.pending_errors.extend(http_error(status, reason) for _ in range(times))

    # --- service API -------------------------------------------------------------------
    def files(self) -> _Files:
        return _Files(self)

    def about(self) -> _About:
        return _About(self)

    def _get(self, file_id: str) -> dict:
        item = self.items.get(file_id)
        if item is None:
            raise http_error(404, "notFound")
        if item.forbidden:
            raise http_error(403, "insufficientFilePermissions")
        return item.as_api()

    def _list(self, parent: str, page_token: str | None) -> dict:
        folder = self.items.get(parent)
        if folder is None:
            raise http_error(404, "notFound")
        if folder.forbidden:
            raise http_error(403, "insufficientFilePermissions")
        children = [i.as_api() for i in self.items.values() if i.parent == parent]
        start = int(page_token or 0)
        page = children[start : start + self.page_size]
        response = {"files": page}
        if start + self.page_size < len(children):
            response["nextPageToken"] = str(start + self.page_size)
        return response

    @property
    def list_calls(self) -> list[dict]:
        return [kwargs for name, kwargs in self.calls if name == "files.list"]
