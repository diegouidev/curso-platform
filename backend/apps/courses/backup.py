"""Export and restore the user's own data: progress and marks, notes, study sessions,
review card schedules, course tags and deadlines, preferences.

Course content is not exported (it comes from the Drive). Lessons are matched by course
folder id + lesson file id, so a backup restores onto a fresh install once the same
courses are imported again.

Restoring merges and never loses data: a lesson is never un-completed nor un-marked, the
most recent note wins, times keep the maximum, sessions are added once, a card keeps the
schedule of its latest review, tags are added and a deadline is only set when there's none.
Importing the same file twice changes nothing the second time.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime

from django.db import transaction
from django.utils import timezone

from .cards import sync_cards
from .models import (
    Course,
    Lesson,
    LessonProgress,
    Note,
    ReviewCard,
    StudyPreferences,
    StudySession,
)
from .serializers import set_course_tags

FORMAT = "curso-platform-backup"
VERSION = 1
PREFERENCE_FIELDS = [
    "suggest_completion",
    "suggest_completion_percent",
    "daily_goal_minutes",
    "weekly_goal_minutes",
    "reminder_enabled",
    "reminder_time",
    "auto_sync",
]
CARD_FIELDS = ["ease", "interval_days", "repetitions", "lapses", "due_on", "last_reviewed_at"]


def export_data() -> dict:
    preferences = StudyPreferences.load()
    courses = []
    for course in Course.objects.prefetch_related("tags").order_by("created_at"):
        lessons = (
            Lesson.objects.filter(module__course=course)
            .select_related("module", "progress", "note")
            .prefetch_related("study_sessions", "cards")
            .order_by("module__order", "module__id", "order", "id")
        )
        items = [item for item in (_lesson_data(lesson) for lesson in lessons) if item]
        tags = [tag.name for tag in course.tags.all()]
        if items or tags or course.target_date:
            courses.append(
                {
                    "drive_folder_id": course.drive_folder_id,
                    "title": course.title,
                    "tags": tags,
                    "target_date": course.target_date and course.target_date.isoformat(),
                    "lessons": items,
                }
            )
    return {
        "format": FORMAT,
        "version": VERSION,
        "exported_at": timezone.now().isoformat(),
        "preferences": {name: _plain(getattr(preferences, name)) for name in PREFERENCE_FIELDS},
        "courses": courses,
    }


def _plain(value: object) -> object:
    """JSON-friendly value (dates and times as ISO strings)."""
    return value.isoformat() if hasattr(value, "isoformat") else value


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _lesson_data(lesson: Lesson) -> dict | None:
    progress = lesson.progress if _has(lesson, "progress") else None
    note = lesson.note if _has(lesson, "note") and lesson.note.content else None
    sessions = list(lesson.study_sessions.all())
    # Only the schedule of reviewed cards matters: the cards themselves live in the note.
    cards = [card for card in lesson.cards.all() if card.last_reviewed_at]
    if not (progress or note or sessions or cards):
        return None
    return {
        "drive_file_id": lesson.drive_file_id,
        "title": lesson.title,
        "module": lesson.module.title,
        "progress": progress
        and {
            "completed": progress.completed,
            "completed_at": _iso(progress.completed_at),
            "last_opened_at": _iso(progress.last_opened_at),
            "time_on_page_seconds": progress.time_on_page_seconds,
            "starred": progress.starred,
            "review_later": progress.review_later,
            "difficult": progress.difficult,
        },
        "note": note and {"content": note.content, "updated_at": _iso(note.updated_at)},
        "sessions": [
            {
                "started_at": _iso(s.started_at),
                "ended_at": _iso(s.ended_at),
                "seconds": s.seconds,
            }
            for s in sorted(sessions, key=lambda s: s.started_at)
        ],
        "cards": [
            {"key": card.key, **{name: _plain(getattr(card, name)) for name in CARD_FIELDS}}
            for card in cards
        ],
    }


def _has(lesson: Lesson, relation: str) -> bool:
    try:
        getattr(lesson, relation)
    except (LessonProgress.DoesNotExist, Note.DoesNotExist):
        return False
    return True


def export_notes_markdown(course_id: int | None = None) -> str:
    """Every non-empty note as one Markdown document, in course order (or one course)."""
    now = timezone.localtime()
    lines = ["# Minhas anotações", "", f"_Exportado em {now:%d/%m/%Y %H:%M}._", ""]
    courses = Course.objects.order_by("created_at")
    if course_id is not None:
        courses = courses.filter(pk=course_id)
    for course in courses:
        notes = (
            Note.objects.filter(lesson__module__course=course)
            .exclude(content="")
            .select_related("lesson__module", "lesson__progress")
            .order_by("lesson__module__order", "lesson__module__id", "lesson__order", "lesson__id")
        )
        if not notes:
            continue
        lines += [f"## {course.title}", ""]
        module_id = None
        for note in notes:
            lesson = note.lesson
            if lesson.module_id != module_id:
                module_id = lesson.module_id
                lines += [f"### {lesson.module.title}", ""]
            done = _has(lesson, "progress") and lesson.progress.completed
            lines += [f"#### {lesson.title}{' ✓' if done else ''}", "", note.content.strip(), ""]
    return "\n".join(lines).rstrip() + "\n"


@dataclass
class RestoreStats:
    lessons_matched: int = 0
    lessons_not_found: int = 0
    progress_updated: int = 0
    notes_restored: int = 0
    sessions_added: int = 0
    cards_restored: int = 0
    preferences_restored: bool = False
    courses_not_found: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


def restore(data: dict) -> RestoreStats:
    """`data` is a validated backup (see BackupSerializer)."""
    stats = RestoreStats()
    with transaction.atomic():
        if data.get("preferences"):
            preferences = StudyPreferences.load()
            for name, value in data["preferences"].items():
                setattr(preferences, name, value)
            preferences.save()
            stats.preferences_restored = True

        for course_data in data["courses"]:
            course = Course.objects.filter(drive_folder_id=course_data["drive_folder_id"]).first()
            if course is None:
                stats.courses_not_found.append(course_data["title"])
                stats.lessons_not_found += len(course_data["lessons"])
                continue
            _merge_course(course, course_data)
            lessons = {
                lesson.drive_file_id: lesson
                for lesson in Lesson.objects.filter(module__course=course)
            }
            for item in course_data["lessons"]:
                lesson = lessons.get(item["drive_file_id"])
                if lesson is None:
                    stats.lessons_not_found += 1
                    continue
                stats.lessons_matched += 1
                if item.get("progress") and _merge_progress(lesson, item["progress"]):
                    stats.progress_updated += 1
                if item.get("note") and _merge_note(lesson, item["note"]):
                    stats.notes_restored += 1
                stats.sessions_added += _merge_sessions(lesson, item.get("sessions", []))
                stats.cards_restored += _merge_cards(lesson, item.get("cards", []))
    return stats


def _merge_course(course: Course, backup: dict) -> None:
    if backup.get("tags"):
        current = [tag.name for tag in course.tags.all()]
        set_course_tags(course, [*current, *backup["tags"]])
    if backup.get("target_date") and course.target_date is None:
        course.target_date = backup["target_date"]
        course.save(update_fields=["target_date"])


def _merge_progress(lesson: Lesson, backup: dict) -> bool:
    progress, _ = LessonProgress.objects.get_or_create(lesson=lesson)
    before = (
        progress.completed,
        progress.completed_at,
        progress.last_opened_at,
        progress.time_on_page_seconds,
        *(getattr(progress, mark) for mark in LessonProgress.MARKS),
    )
    if backup["completed"]:
        backup_at = backup.get("completed_at") or timezone.now()
        if not progress.completed or progress.completed_at is None:
            progress.completed, progress.completed_at = True, backup_at
        elif backup.get("completed_at") and backup["completed_at"] < progress.completed_at:
            progress.completed_at = backup["completed_at"]  # keep the earliest completion
    opened = backup.get("last_opened_at")
    if opened and (progress.last_opened_at is None or opened > progress.last_opened_at):
        progress.last_opened_at = opened
    progress.time_on_page_seconds = max(
        progress.time_on_page_seconds, backup["time_on_page_seconds"]
    )
    for mark in LessonProgress.MARKS:
        if backup.get(mark):
            setattr(progress, mark, True)
    after = (
        progress.completed,
        progress.completed_at,
        progress.last_opened_at,
        progress.time_on_page_seconds,
        *(getattr(progress, mark) for mark in LessonProgress.MARKS),
    )
    if after == before:
        return False
    progress.save()
    return True


def _merge_note(lesson: Lesson, backup: dict) -> bool:
    content, updated_at = backup["content"], backup.get("updated_at")
    note = Note.objects.filter(lesson=lesson).first()
    if note and note.content == content:
        return False
    newer = note is None or not note.content or (updated_at and updated_at > note.updated_at)
    if not newer:
        return False
    note, _ = Note.objects.update_or_create(lesson=lesson, defaults={"content": content})
    if updated_at:  # keep the original edit time (auto_now would stamp "now")
        Note.objects.filter(pk=note.pk).update(updated_at=updated_at)
    sync_cards(lesson, content)
    return True


def _merge_cards(lesson: Lesson, cards: list[dict]) -> int:
    """Applies reviewed schedules to the note's cards, when the backup's review is newer."""
    if not cards:
        return 0
    existing = {card.key: card for card in ReviewCard.objects.filter(lesson=lesson)}
    restored = 0
    for data in cards:
        card = existing.get(data["key"])
        if card is None:
            continue
        if card.last_reviewed_at and card.last_reviewed_at >= data["last_reviewed_at"]:
            continue
        for name in CARD_FIELDS:
            setattr(card, name, data[name])
        card.save(update_fields=CARD_FIELDS)
        restored += 1
    return restored


def _merge_sessions(lesson: Lesson, sessions: list[dict]) -> int:
    existing = set(lesson.study_sessions.values_list("started_at", flat=True))
    new = [
        StudySession(lesson=lesson, **session)
        for session in sessions
        if session["started_at"] not in existing
    ]
    StudySession.objects.bulk_create(new)
    return len(new)
