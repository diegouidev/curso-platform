"""Global search (Ctrl+K) over course titles, lesson titles and note text.

Matching runs in Python on accent-free, case-folded text: SQLite's LIKE is only
case-insensitive for ASCII ("Módulo" vs "módulo"), and a personal library is small enough
(a few thousand rows) to scan per request. Every word of the query must match.
"""

import unicodedata
from dataclasses import dataclass, field

from .models import Course, Lesson, Note

MIN_QUERY_LENGTH = 2
COURSE_LIMIT = 5
LESSON_LIMIT = 12
NOTE_LIMIT = 8
SNIPPET_RADIUS = 70


def fold(text: str) -> str:
    """Lowercase without accents: "Módulo Ação" -> "modulo acao"."""
    return _fold_with_positions(text)[0]


def _fold_with_positions(text: str) -> tuple[str, list[int]]:
    """Folded text plus, for each folded char, the index of the original char it came from."""
    chars: list[str] = []
    positions: list[int] = []
    for index, char in enumerate(text):
        for part in unicodedata.normalize("NFKD", char):
            if unicodedata.combining(part):
                continue
            folded = part.casefold()
            chars.append(folded)
            positions.extend([index] * len(folded))
    return "".join(chars), positions


def _matches(haystack: str, terms: list[str]) -> bool:
    return all(term in haystack for term in terms)


def snippet(text: str, terms: list[str]) -> tuple[str, int, int]:
    """An excerpt around the first matched term, and the match's (start, length) in it."""
    folded, positions = _fold_with_positions(text)
    hits = [(folded.find(term), term) for term in terms if term in folded]
    if not hits:
        excerpt = text[: SNIPPET_RADIUS * 2].strip()
        return excerpt + ("…" if len(text) > len(excerpt) else ""), 0, 0
    folded_start, term = min(hits)
    start = positions[folded_start]
    end = positions[folded_start + len(term) - 1] + 1

    left = max(start - SNIPPET_RADIUS, 0)
    right = min(end + SNIPPET_RADIUS, len(text))
    # Cut on whitespace so words aren't split.
    if left > 0:
        space = text.find(" ", left, start)
        left = space + 1 if space != -1 else left
    if right < len(text):
        space = text.rfind(" ", end, right)
        right = space if space != -1 else right

    prefix = "…" if left > 0 else ""
    suffix = "…" if right < len(text) else ""
    raw = text[left:right]
    excerpt = " ".join(raw.split())  # collapse newlines/markdown spacing
    # Locate the match again in the collapsed excerpt (whitespace collapsing shifts it).
    match_text = " ".join(text[start:end].split())
    offset = excerpt.find(match_text)
    if offset == -1:
        offset, match_text = 0, ""
    return f"{prefix}{excerpt}{suffix}", len(prefix) + offset, len(match_text)


@dataclass
class SearchResults:
    query: str
    courses: list[Course] = field(default_factory=list)
    lessons: list[Lesson] = field(default_factory=list)
    notes: list[dict] = field(default_factory=list)


def search(query: str) -> SearchResults:
    query = query.strip()
    results = SearchResults(query=query)
    terms = fold(query).split()
    if len(fold(query).replace(" ", "")) < MIN_QUERY_LENGTH:
        return results
    phrase = " ".join(terms)

    for course in Course.objects.order_by("is_archived", "-created_at"):
        if _matches(fold(f"{course.title} {course.description}"), terms):
            results.courses.append(course)
            if len(results.courses) == COURSE_LIMIT:
                break

    lessons = (
        Lesson.objects.filter(is_hidden=False, module__is_hidden=False)
        .select_related("module__course", "progress")
        .order_by("-module__course__created_at", "module__order", "module__id", "order", "id")
    )
    ranked: list[tuple[int, int, Lesson]] = []
    for position, lesson in enumerate(lessons):
        title = fold(lesson.title)
        if not _matches(f"{title} {fold(lesson.module.title)}", terms):
            continue
        rank = 0 if title.startswith(phrase) else 1 if phrase in title else 2
        ranked.append((rank, position, lesson))
    results.lessons = [lesson for *_, lesson in sorted(ranked, key=lambda x: x[:2])][:LESSON_LIMIT]

    notes = (
        Note.objects.exclude(content="")
        .select_related("lesson__module__course")
        .order_by("-updated_at")
    )
    for note in notes:
        if not _matches(fold(note.content), terms):
            continue
        text, start, length = snippet(note.content, terms)
        results.notes.append(
            {
                "lesson": note.lesson,
                "snippet": text,
                "match_start": start,
                "match_length": length,
                "updated_at": note.updated_at,
            }
        )
        if len(results.notes) == NOTE_LIMIT:
            break

    return results
