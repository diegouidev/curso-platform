from django.db.models import Count, Exists, F, OuterRef, Prefetch, Q, QuerySet, Sum, Value
from django.db.models.functions import Coalesce

from .models import Course, ImportJob, Lesson, Module, Note

_L = "modules__lessons__"

# Lessons that count towards progress: visible, in a visible module, still in the Drive.
COUNTED = Q(modules__is_hidden=False, **{f"{_L}is_hidden": False, f"{_L}missing_in_drive": False})
DONE = Q(**{f"{_L}progress__completed": True})


def with_progress(queryset: QuerySet[Course]) -> QuerySet[Course]:
    return queryset.annotate(
        lessons_total=Count(f"{_L}id", filter=COUNTED),
        lessons_completed=Count(f"{_L}id", filter=COUNTED & DONE),
        lessons_with_duration=Count(
            f"{_L}id", filter=COUNTED & Q(**{f"{_L}duration_seconds__isnull": False})
        ),
        duration_total=Coalesce(Sum(f"{_L}duration_seconds", filter=COUNTED), 0),
        duration_completed=Coalesce(Sum(f"{_L}duration_seconds", filter=COUNTED & DONE), 0),
    )


def latest_job_prefetch() -> Prefetch:
    return Prefetch(
        "import_jobs",
        queryset=ImportJob.objects.order_by("-created_at")[:1],
        to_attr="latest_jobs",
    )


def lessons_queryset() -> QuerySet[Lesson]:
    return Lesson.objects.annotate(
        completed=Coalesce(F("progress__completed"), Value(False)),
        has_note=Exists(Note.objects.filter(lesson=OuterRef("pk")).exclude(content="")),
    ).prefetch_related("attachments")


def course_list_queryset() -> QuerySet[Course]:
    return with_progress(Course.objects.all()).prefetch_related(latest_job_prefetch())


def course_detail_queryset() -> QuerySet[Course]:
    return with_progress(Course.objects.all()).prefetch_related(
        latest_job_prefetch(),
        Prefetch(
            "modules",
            queryset=Module.objects.prefetch_related(
                Prefetch("lessons", queryset=lessons_queryset()), "attachments"
            ),
        ),
    )


def lesson_detail_queryset() -> QuerySet[Lesson]:
    return Lesson.objects.select_related("module__course", "progress").prefetch_related(
        "attachments", "module__attachments"
    )
