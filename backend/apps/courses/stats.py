"""Study statistics for the dashboard, computed in the configured TIME_ZONE (local days)."""

from collections import defaultdict
from datetime import date, timedelta

from django.db.models import Sum
from django.utils import timezone

from .models import LessonProgress, StudySession

# A day counts towards the streak with this much time on lesson pages, or any completion.
MIN_STUDY_SECONDS_PER_DAY = 60
RECENT_DAYS = 7


def _streaks(active: set[date], today: date) -> tuple[int, int]:
    """(current, longest). The current streak survives until the end of the day after the
    last study day, so it doesn't read 0 every morning before studying."""
    current = 0
    day = today if today in active else today - timedelta(days=1)
    while day in active:
        current += 1
        day -= timedelta(days=1)

    longest = run = 0
    previous: date | None = None
    for day in sorted(active):
        run = run + 1 if previous and day - previous == timedelta(days=1) else 1
        longest = max(longest, run)
        previous = day
    return current, longest


def study_stats() -> dict:
    today = timezone.localdate()
    week_start = today - timedelta(days=today.weekday())  # Monday

    seconds_by_day: dict[date, int] = defaultdict(int)
    for started_at, seconds in StudySession.objects.values_list("started_at", "seconds"):
        seconds_by_day[timezone.localdate(started_at)] += seconds

    completed_by_day: dict[date, int] = defaultdict(int)
    completed_at_values = LessonProgress.objects.filter(
        completed=True, completed_at__isnull=False
    ).values_list("completed_at", flat=True)
    for completed_at in completed_at_values:
        completed_by_day[timezone.localdate(completed_at)] += 1

    active = {
        day for day, seconds in seconds_by_day.items() if seconds >= MIN_STUDY_SECONDS_PER_DAY
    } | set(completed_by_day)
    current_streak, longest_streak = _streaks(active, today)

    recent = [today - timedelta(days=offset) for offset in range(RECENT_DAYS - 1, -1, -1)]
    totals = LessonProgress.objects.aggregate(seconds=Sum("time_on_page_seconds"))

    return {
        "today": today,
        "week_start": week_start,
        "completed_this_week": sum(n for day, n in completed_by_day.items() if day >= week_start),
        "completed_total": LessonProgress.objects.filter(completed=True).count(),
        "study_seconds_this_week": sum(s for day, s in seconds_by_day.items() if day >= week_start),
        "study_seconds_total": totals["seconds"] or 0,
        "streak_days": current_streak,
        "longest_streak_days": longest_streak,
        "studied_today": today in active,
        "recent_days": [
            {
                "date": day,
                "study_seconds": seconds_by_day.get(day, 0),
                "completed": completed_by_day.get(day, 0),
            }
            for day in recent
        ],
    }
