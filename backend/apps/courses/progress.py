"""Lesson navigation, completion, time on page and "continue where I left off"."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from django.db import transaction
from django.db.models import F, QuerySet
from django.utils import timezone

from .models import Lesson, LessonProgress, StudySession

# Upper bound for one heartbeat. The client sends every 15 s; anything above this is a
# client bug or a tab that was frozen, and must not inflate the stats.
MAX_HEARTBEAT_SECONDS = 60

ContinueReason = Literal["resume", "next", "start"]
CONTINUE_REASONS = [
    ("resume", "Aula aberta e não concluída"),
    ("next", "Próxima aula depois da última concluída"),
    ("start", "Primeira aula, nada aberto ainda"),
]


def playable_lessons() -> QuerySet[Lesson]:
    """Lessons that can be watched and navigated to, in course order."""
    return Lesson.objects.filter(
        module__is_hidden=False, is_hidden=False, missing_in_drive=False
    ).order_by("module__order", "module__id", "order", "id")


def _sort_key(lesson: Lesson) -> tuple[int, int, int, int]:
    return (lesson.module.order, lesson.module_id, lesson.order, lesson.pk)


@dataclass(frozen=True)
class Neighbors:
    previous: Lesson | None
    next: Lesson | None
    position: int | None  # 1-based; None when the lesson itself is hidden or missing
    total: int


def neighbors(lesson: Lesson) -> Neighbors:
    """Previous/next playable lessons of the course, crossing module boundaries.

    Works for hidden or missing lessons too (opened from a direct link): their neighbors
    are the closest playable lessons around their position.
    """
    playlist = list(
        playable_lessons()
        .filter(module__course_id=lesson.module.course_id)
        .select_related("module")
        .only("id", "title", "order", "module__id", "module__order", "module__title")
    )
    key = _sort_key(lesson)
    before = [item for item in playlist if _sort_key(item) < key]
    after = [item for item in playlist if _sort_key(item) > key]
    is_playable = len(before) + len(after) < len(playlist)
    return Neighbors(
        previous=before[-1] if before else None,
        next=after[0] if after else None,
        position=len(before) + 1 if is_playable else None,
        total=len(playlist),
    )


def get_progress(lesson: Lesson) -> LessonProgress:
    """The lesson's progress row, or an unsaved blank one (nothing recorded yet)."""
    try:
        return lesson.progress
    except LessonProgress.DoesNotExist:
        return LessonProgress(lesson=lesson)


def set_completed(lesson: Lesson, completed: bool) -> LessonProgress:
    """Idempotent: completing twice keeps the first completed_at."""
    progress, _ = LessonProgress.objects.get_or_create(lesson=lesson)
    if progress.completed != completed:
        progress.completed = completed
        progress.completed_at = timezone.now() if completed else None
        progress.save(update_fields=["completed", "completed_at"])
    return progress


def record_heartbeat(lesson: Lesson, seconds: int) -> LessonProgress:
    """Adds visible time on the lesson page and marks the lesson as the last one opened.

    `seconds=0` is the "page opened" ping. Time is also recorded as a StudySession: the
    lesson's latest session is extended when it ended less than MAX_GAP_SECONDS before
    this chunk of time started, otherwise a new one is opened.
    """
    seconds = max(0, min(seconds, MAX_HEARTBEAT_SECONDS))
    now = timezone.now()
    with transaction.atomic():
        progress, _ = LessonProgress.objects.get_or_create(lesson=lesson)
        LessonProgress.objects.filter(pk=progress.pk).update(
            last_opened_at=now, time_on_page_seconds=F("time_on_page_seconds") + seconds
        )
        if seconds:
            _add_session_time(lesson, now, seconds)
    progress.refresh_from_db()
    return progress


def _add_session_time(lesson: Lesson, now: datetime, seconds: int) -> None:
    started = now - timedelta(seconds=seconds)
    latest = StudySession.objects.filter(lesson=lesson).order_by("-ended_at").first()
    if latest and latest.ended_at >= started - timedelta(seconds=StudySession.MAX_GAP_SECONDS):
        StudySession.objects.filter(pk=latest.pk).update(
            ended_at=now, seconds=F("seconds") + seconds
        )
    else:
        StudySession.objects.create(
            lesson=lesson, started_at=started, ended_at=now, seconds=seconds
        )


def continue_lesson(course_id: int | None = None) -> tuple[Lesson, ContinueReason] | None:
    """Where to pick up studying, across all active courses or within one course.

    1. The most recently opened lesson, if it isn't completed ("resume").
    2. If it is completed: the next uncompleted lesson after it in its course ("next").
    3. Otherwise the most recently opened lesson that isn't completed ("resume").
    4. Nothing opened yet: the first uncompleted lesson of the course, or of the most
       recently imported course when no course is given ("start").
    Archived courses are ignored unless asked for explicitly. None when everything is done.
    """
    lessons = playable_lessons().select_related("module__course")
    if course_id is not None:
        lessons = lessons.filter(module__course_id=course_id)
    else:
        lessons = lessons.filter(module__course__is_archived=False)
    uncompleted = lessons.exclude(progress__completed=True)
    opened = lessons.filter(progress__last_opened_at__isnull=False).order_by(
        "-progress__last_opened_at"
    )

    last = opened.select_related("progress").first()
    if last is not None:
        if not last.progress.completed:
            return last, "resume"
        after = _next_uncompleted(last, uncompleted)
        if after is not None:
            return after, "next"
        fallback = opened.exclude(progress__completed=True).first()
        if fallback is not None:
            return fallback, "resume"

    if course_id is None:
        uncompleted = uncompleted.order_by(
            "-module__course__created_at", "module__order", "module__id", "order", "id"
        )
    first = uncompleted.first()
    return (first, "start") if first is not None else None


def _next_uncompleted(lesson: Lesson, uncompleted: QuerySet[Lesson]) -> Lesson | None:
    key = _sort_key(lesson)
    candidates = uncompleted.filter(module__course_id=lesson.module.course_id)
    return next((item for item in candidates if _sort_key(item) > key), None)
