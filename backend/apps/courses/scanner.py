"""Walk a Drive folder tree into an in-memory structure. Never touches the database.

Mapping:
- root folder               -> course
- 1st-level sub-folders     -> modules (deeper folders are flattened into them, keeping
                               the relative path so titles can be prefixed with it)
- files directly in root    -> the "Geral" module (keyed by the root folder id)
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from apps.drive.client import FOLDER_MIME, SHORTCUT_MIME, DriveClient
from apps.drive.errors import DriveAccessDenied, DriveError, DriveNotFound

from .naming import is_video

logger = logging.getLogger(__name__)

MAX_DEPTH = 20

ProgressCallback = Callable[[int, int], None]


class NotAFolder(DriveError):
    status_code = 400
    code = "drive_not_a_folder"
    message = "O link aponta para um arquivo, não para uma pasta. Cole o link da pasta do curso."


@dataclass
class ScannedFile:
    id: str
    name: str
    mime_type: str
    duration_seconds: int | None = None
    modified_at: datetime | None = None
    path: list[str] = field(default_factory=list)  # sub-folders below the module folder

    @property
    def is_video(self) -> bool:
        return is_video(self.mime_type, self.name)


@dataclass
class ScannedModule:
    folder_id: str
    name: str
    is_root: bool = False
    files: list[ScannedFile] = field(default_factory=list)

    @property
    def videos(self) -> list[ScannedFile]:
        return [f for f in self.files if f.is_video]

    @property
    def others(self) -> list[ScannedFile]:
        return [f for f in self.files if not f.is_video]


@dataclass
class ScanResult:
    root_id: str
    root_name: str
    modules: list[ScannedModule]
    folders_scanned: int = 0
    files_found: int = 0


@dataclass
class _Entry:
    id: str
    name: str
    mime_type: str
    raw: dict

    @property
    def is_folder(self) -> bool:
        return self.mime_type == FOLDER_MIME


def _resolve(item: dict) -> _Entry:
    """Shortcuts are followed: their target id/mime type replace the shortcut's."""
    if item.get("mimeType") == SHORTCUT_MIME and item.get("shortcutDetails"):
        details = item["shortcutDetails"]
        return _Entry(
            id=details["targetId"],
            name=item["name"],
            mime_type=details.get("targetMimeType", ""),
            raw=item,
        )
    return _Entry(id=item["id"], name=item["name"], mime_type=item.get("mimeType", ""), raw=item)


def _to_file(entry: _Entry, path: list[str]) -> ScannedFile:
    millis = (entry.raw.get("videoMediaMetadata") or {}).get("durationMillis")
    modified = entry.raw.get("modifiedTime")
    return ScannedFile(
        id=entry.id,
        name=entry.name,
        mime_type=entry.mime_type,
        duration_seconds=round(int(millis) / 1000) if millis else None,
        modified_at=datetime.fromisoformat(modified) if modified else None,
        path=path,
    )


def get_root_folder(client: DriveClient, folder_id: str) -> _Entry:
    root = _resolve(client.get_file(folder_id))
    if not root.is_folder:
        raise NotAFolder()
    return root


class _Walker:
    def __init__(self, client: DriveClient, on_progress: ProgressCallback | None) -> None:
        self.client = client
        self.on_progress = on_progress
        self.visited: set[str] = set()
        self.folders_scanned = 0
        self.files_found = 0

    def children(self, folder_id: str) -> list[_Entry]:
        self.visited.add(folder_id)
        entries = [_resolve(item) for item in self.client.list_children(folder_id)]
        self.folders_scanned += 1
        self.files_found += sum(1 for e in entries if not e.is_folder)
        if self.on_progress:
            self.on_progress(self.folders_scanned, self.files_found)
        return entries

    def collect(self, folder_id: str, path: list[str], depth: int) -> list[ScannedFile]:
        """All files below a module folder, flattened with their relative path."""
        files: list[ScannedFile] = []
        for entry in self.children(folder_id):
            if not entry.is_folder:
                files.append(_to_file(entry, path))
                continue
            if entry.id in self.visited or depth >= MAX_DEPTH:
                logger.info("Skipping folder %s (cycle or too deep)", entry.id)
                continue
            try:
                files.extend(self.collect(entry.id, [*path, entry.name], depth + 1))
            except (DriveNotFound, DriveAccessDenied):
                # e.g. a shortcut to a folder we cannot read: skip it, keep the rest.
                logger.warning("Skipping unreadable folder %s (%s)", entry.id, entry.name)
        return files


def scan_course(
    client: DriveClient, folder_id: str, *, on_progress: ProgressCallback | None = None
) -> ScanResult:
    root = get_root_folder(client, folder_id)
    walker = _Walker(client, on_progress)

    general = ScannedModule(folder_id=root.id, name="", is_root=True)
    modules: list[ScannedModule] = []
    for entry in walker.children(root.id):
        if not entry.is_folder:
            general.files.append(_to_file(entry, []))
            continue
        if entry.id in walker.visited:
            continue
        try:
            files = walker.collect(entry.id, [], depth=1)
        except (DriveNotFound, DriveAccessDenied):
            logger.warning("Skipping unreadable module folder %s (%s)", entry.id, entry.name)
            continue
        modules.append(ScannedModule(folder_id=entry.id, name=entry.name, files=files))

    if general.files:
        modules.insert(0, general)

    return ScanResult(
        root_id=root.id,
        root_name=root.name,
        modules=modules,
        folders_scanned=walker.folders_scanned,
        files_found=walker.files_found,
    )
