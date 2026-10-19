"""Pure helpers for Drive names: folder-link parsing, natural sort and title cleanup."""

import re
import unicodedata

_ID = r"[A-Za-z0-9_-]{10,}"
_FOLDER_LINK_PATTERNS = [
    re.compile(rf"/folders/({_ID})"),  # /drive/folders/<id>, /drive/u/0/folders/<id>
    re.compile(rf"[?&]id=({_ID})"),  # /open?id=<id>, /folderview?id=<id>
]
_RAW_ID = re.compile(rf"^{_ID}$")

VIDEO_EXTENSIONS = {
    ".mp4",
    ".mkv",
    ".mov",
    ".avi",
    ".webm",
    ".m4v",
    ".wmv",
    ".flv",
    ".mpg",
    ".mpeg",
}
# Extensions start with a letter, so "Aula 1.2" keeps its ".2".
_EXTENSION = re.compile(r"\.[A-Za-z][A-Za-z0-9]{0,4}$")
_TOKENS = re.compile(r"(\d+)")
_SPACES = re.compile(r"\s+")
# "01 - 01 - Intro" / "01. 01 - Intro" -> "01 - Intro". Deliberately conservative: both
# copies must be followed by a separator, so "1.1 Intro", "1_1_Intro" (hierarchical numbering)
# and "10 - 10 Anos" (a title starting with a number) are left alone.
_DUPLICATED_PREFIX = re.compile(r"^(\d+)\s*[-.)]?\s+\1\s*[-.)]\s+")


def extract_folder_id(value: str) -> str | None:
    """Accepts a Drive folder link (`/folders/<id>`, `?id=<id>`) or a bare id."""
    value = (value or "").strip()
    if not value:
        return None
    if _RAW_ID.match(value):
        return value
    if "drive.google.com" not in value and "docs.google.com" not in value:
        return None
    for pattern in _FOLDER_LINK_PATTERNS:
        if match := pattern.search(value):
            return match.group(1)
    return None


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def natural_key(name: str) -> tuple:
    """`Aula 2` < `Aula 10`, `01 - x` < `2 - y`, accent/case-insensitive."""
    parts = _TOKENS.split(_fold(name).strip())
    return tuple((0, int(p), "") if p.isdigit() else (1, 0, p) for p in parts if p != "")


def path_key(path: list[str]) -> tuple:
    return tuple(natural_key(part) for part in path)


def strip_extension(name: str) -> str:
    return _EXTENSION.sub("", name).strip() or name


def stem_key(name: str) -> str:
    """Comparable base name, used to pair attachments with the video of the same name."""
    return _SPACES.sub(" ", _fold(strip_extension(name)).replace("_", " ")).strip()


def clean_title(name: str, *, is_file: bool) -> str:
    title = strip_extension(name) if is_file else name.strip()
    title = _DUPLICATED_PREFIX.sub(lambda m: f"{m.group(1)} - ", title, count=1)
    title = title.replace("_", " ")
    title = _SPACES.sub(" ", title).strip()
    return title or name


def make_title(name: str, *, is_file: bool, clean: bool) -> str:
    if clean:
        return clean_title(name, is_file=is_file)
    return strip_extension(name) if is_file else name


def is_video(mime_type: str, name: str) -> bool:
    if mime_type.startswith("video/"):
        return True
    # Some uploads (e.g. .mkv) are reported as octet-stream.
    match = _EXTENSION.search(name)
    return (
        mime_type in {"application/octet-stream", ""}
        and match is not None
        and match.group(0).lower() in VIDEO_EXTENSIONS
    )
