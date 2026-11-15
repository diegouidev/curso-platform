"""Course deadline and pace ("finish by 15/12"), and the recap shown when a course is done.

Pace is measured on the recent past: what was completed in the course during the last
PACE_WINDOW_DAYS days (or since the course was imported, if that's more recent), as lessons
per day and, when the Drive reports durations, video seconds per day. The projection divides
what is left by that pace. Days are local (TIME_ZONE), like the dashboard stats.
"""

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Literal

from django.db.models import Count, Q, Sum
from django.utils import timezone

from .models import Course, Lesson, LessonProgress, Note, ReviewCard, StudySession

PACE_WINDOW_DAYS = 14

PlanStatus = Literal["done", "no_target", "on_track", "behind", "overdue"]
PLAN_STATUSES = [
    ("done", "Curso concluído"),
    ("no_target", "Sem prazo definido"),
    ("on_track", "No ritmo para terminar no prazo"),
    ("behind", "Abaixo do ritmo necessário"),
    ("overdue", "Prazo vencido"),
]

# Lessons that count towards progress (same rule as queries.COUNTED, from the lesson side).
COUNTED_LESSON = Q(
    lesson__is_hidden=False, lesson__missing_in_drive=False, lesson__module__is_hidden=False
)


@dataclass(frozen=True)
class RecentPace:
    lessons: int = 0
    seconds: int = 0


def recent_pace(course_ids: list[int], today: date) -> dict[int, RecentPace]:
    """Completions per course during the pace window (one query for all courses)."""
    since = today - timedelta(days=PACE_WINDOW_DAYS - 1)
    start = timezone.make_aware(datetime.combine(since, time.min))
    rows = (
        LessonProgress.objects.filter(
            COUNTED_LESSON,
            completed=True,
            completed_at__gte=start,
            lesson__module__course_id__in=course_ids,
        )
        .values("lesson__module__course_id")
        .annotate(lessons=Count("id"), seconds=Sum("lesson__duration_seconds"))
    )
    return {
        row["lesson__module__course_id"]: RecentPace(row["lessons"], row["seconds"] or 0)
        for row in rows
    }


def _ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def _window_days(course: Course, today: date) -> int:
    imported = timezone.localdate(course.created_at)
    return max(1, min(PACE_WINDOW_DAYS, (today - imported).days + 1))


def course_plan(course: Course, pace: RecentPace, today: date) -> dict:
    """`course` must carry the with_progress() annotations."""
    lessons_left = course.lessons_total - course.lessons_completed
    has_durations = course.lessons_with_duration > 0
    seconds_left = max(course.duration_total - course.duration_completed, 0)
    days = _window_days(course, today)
    pace_lessons = pace.lessons / days
    pace_seconds = pace.seconds / days if has_durations else 0

    # Project with durations when both the course and the recent pace have them. Integer
    # math: "what's left / (done / days)" without float rounding surprises.
    needed: int | None = None
    if lessons_left == 0:
        needed = None
    elif has_durations and pace.seconds > 0 and seconds_left > 0:
        needed = _ceil_div(seconds_left * days, pace.seconds)
    elif pace.lessons > 0:
        needed = _ceil_div(lessons_left * days, pace.lessons)
    projected = today + timedelta(days=needed - 1) if needed else None

    target = course.target_date
    days_left = (target - today).days + 1 if target else None  # today counts
    required_lessons = required_seconds = None
    if target and lessons_left and days_left and days_left > 0:
        required_lessons = round(lessons_left / days_left, 1)
        if has_durations:
            required_seconds = math.ceil(seconds_left / days_left)

    status: PlanStatus
    if course.lessons_total and lessons_left == 0:
        status = "done"
    elif target is None:
        status = "no_target"
    elif days_left is not None and days_left <= 0:
        status = "overdue"
    elif projected is not None and projected <= target:
        status = "on_track"
    else:
        status = "behind"

    return {
        "status": status,
        "target_date": target,
        "days_left": days_left,
        "lessons_left": lessons_left,
        "seconds_left": seconds_left if has_durations else None,
        "required_lessons_per_day": required_lessons,
        "required_seconds_per_day": required_seconds,
        "pace_lessons_per_day": round(pace_lessons, 1),
        "pace_seconds_per_day": round(pace_seconds) if has_durations else None,
        "pace_window_days": days,
        "projected_finish": projected,
    }


def plans_for(courses: list[Course]) -> dict[int, dict]:
    today = timezone.localdate()
    paces = recent_pace([course.pk for course in courses], today)
    return {
        course.pk: course_plan(course, paces.get(course.pk, RecentPace()), today)
        for course in courses
    }


# --- Recap ---------------------------------------------------------------------------------


def course_recap(course: Course) -> dict:
    """What studying this course looked like: time, days, period, standout lesson."""
    lessons = Lesson.objects.filter(module__course=course)
    counted = lessons.filter(is_hidden=False, missing_in_drive=False, module__is_hidden=False)
    total = counted.count()
    completed = counted.filter(progress__completed=True).count()

    seconds_by_day: dict[date, int] = defaultdict(int)
    for started_at, seconds in StudySession.objects.filter(
        lesson__module__course=course
    ).values_list("started_at", "seconds"):
        seconds_by_day[timezone.localdate(started_at)] += seconds

    progress = LessonProgress.objects.filter(lesson__module__course=course)
    completions = sorted(
        timezone.localdate(value)
        for value in progress.filter(completed=True, completed_at__isnull=False).values_list(
            "completed_at", flat=True
        )
    )
    active_days = {day for day, seconds in seconds_by_day.items() if seconds > 0} | set(completions)
    top = (
        progress.filter(time_on_page_seconds__gt=0)
        .select_related("lesson")
        .order_by("-time_on_page_seconds")
        .first()
    )
    busiest = max(seconds_by_day.items(), key=lambda item: item[1], default=None)
    study_seconds = progress.aggregate(total=Sum("time_on_page_seconds"))["total"] or 0

    return {
        "is_complete": total > 0 and completed == total,
        "lessons_total": total,
        "lessons_completed": completed,
        "study_seconds": study_seconds,
        "days_studied": len(active_days),
        "started_on": min(active_days) if active_days else None,
        "finished_on": completions[-1] if total and completed == total and completions else None,
        "top_lesson": (
            {"id": top.lesson_id, "title": top.lesson.title, "seconds": top.time_on_page_seconds}
            if top
            else None
        ),
        "busiest_day": (
            {"date": busiest[0], "study_seconds": busiest[1]} if busiest and busiest[1] else None
        ),
        "notes_count": Note.objects.filter(lesson__module__course=course)
        .exclude(content="")
        .count(),
        "cards_count": ReviewCard.objects.filter(lesson__module__course=course).count(),
    }
