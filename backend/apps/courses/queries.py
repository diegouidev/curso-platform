from django.db.models import (
    BooleanField,
    Case,
    Count,
    Exists,
    F,
    OuterRef,
    Prefetch,
    Q,
    QuerySet,
    Sum,
    Value,
    When,
)
from django.db.models.functions import Coalesce

from .models import Course, ImportJob, Lesson, Module, Note

_L = "modules__lessons__"

# Lessons that count towards progress: visible, in a visible module, still in the Drive.
COUNTED = Q(modules__is_hidden=False, **{f"{_L}is_hidden": False, f"{_L}missing_in_drive": False})
DONE = Q(**{f"{_L}progress__completed": True})
# Added by a sync after the user last dismissed the "new lessons" notice, and never opened.
NEW = Q(
    **{
        f"{_L}created_at__gt": F("new_lessons_seen_at"),
        f"{_L}progress__last_opened_at__isnull": True,
    }
)


def with_progress(queryset: QuerySet[Course]) -> QuerySet[Course]:
    return queryset.annotate(
        lessons_total=Count(f"{_L}id", filter=COUNTED),
        lessons_completed=Count(f"{_L}id", filter=COUNTED & DONE),
        lessons_with_duration=Count(
            f"{_L}id", filter=COUNTED & Q(**{f"{_L}duration_seconds__isnull": False})
        ),
        duration_total=Coalesce(Sum(f"{_L}duration_seconds", filter=COUNTED), 0),
        duration_completed=Coalesce(Sum(f"{_L}duration_seconds", filter=COUNTED & DONE), 0),
        new_lessons=Count(f"{_L}id", filter=COUNTED & NEW),
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
        watched_seconds=Coalesce(F("progress__time_on_page_seconds"), Value(0)),
        starred=Coalesce(F("progress__starred"), Value(False)),
        review_later=Coalesce(F("progress__review_later"), Value(False)),
        difficult=Coalesce(F("progress__difficult"), Value(False)),
        is_new=Case(
            When(
                Q(created_at__gt=F("module__course__new_lessons_seen_at"))
                & Q(progress__last_opened_at__isnull=True),
                then=Value(True),
            ),
            default=Value(False),
            output_field=BooleanField(),
        ),
        has_note=Exists(Note.objects.filter(lesson=OuterRef("pk")).exclude(content="")),
    ).prefetch_related("attachments")


def course_list_queryset() -> QuerySet[Course]:
    return with_progress(Course.objects.all()).prefetch_related(latest_job_prefetch(), "tags")


def course_detail_queryset() -> QuerySet[Course]:
    return with_progress(Course.objects.all()).prefetch_related(
        latest_job_prefetch(),
        "tags",
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
