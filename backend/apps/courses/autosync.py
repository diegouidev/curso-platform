"""Automatic daily sync with the Drive, run by the scheduler (`manage.py scheduled_tasks`).

Each active (not archived) course is synced when it had no import/sync job in the last
SYNC_EVERY hours, manual ones included, and failures wait for the next day as well, so a
broken folder isn't retried every few minutes. Jobs run one at a time, inline in the
scheduler process; while one runs, later scheduler ticks skip the whole sync.
New lessons then show up as "new" until opened (see Course.new_lessons_seen_at).
"""

import logging
from datetime import datetime, timedelta

from django.db.models import Exists, OuterRef
from django.utils import timezone

from apps.drive.models import GoogleCredential

from . import jobs
from .models import Course, ImportJob, StudyPreferences

logger = logging.getLogger(__name__)

SYNC_EVERY = timedelta(hours=23)
# Errors that will fail every course the same way: stop instead of trying the rest.
STOP_CODES = {"google_not_configured", "google_not_connected", "google_reconnect_required"}


def _any_job_running() -> bool:
    active = list(
        ImportJob.objects.filter(status__in=[ImportJob.Status.PENDING, ImportJob.Status.RUNNING])
    )
    for job in active:
        job.fail_if_stale()
    return any(job.is_active for job in active)


def courses_due(now: datetime) -> list[Course]:
    recent = ImportJob.objects.filter(course=OuterRef("pk"), created_at__gte=now - SYNC_EVERY)
    return list(
        Course.objects.filter(is_archived=False)
        .exclude(Exists(recent))
        .order_by("last_imported_at", "pk")
    )


def run_auto_sync(now: datetime | None = None) -> str:
    now = now or timezone.now()
    if not StudyPreferences.load().auto_sync:
        return "sincronização automática desligada"
    credential = GoogleCredential.load()
    if credential is None or credential.needs_reconnect:
        return "Google não conectado"
    if _any_job_running():
        return "já existe uma importação em andamento"

    synced, failed = [], []
    for course in courses_due(now):
        try:
            job = jobs.create_job(course, ImportJob.Kind.SYNC)
        except jobs.JobAlreadyRunning:
            continue
        jobs.run_job(job.pk)
        job.refresh_from_db()
        if job.status == ImportJob.Status.SUCCESS:
            synced.append(course.title)
            continue
        failed.append(course.title)
        logger.info("Auto sync of course %s failed: %s", course.pk, job.error_code)
        if job.error_code in STOP_CODES:
            break
    if not synced and not failed:
        return "nenhum curso para sincronizar"
    parts = []
    if synced:
        parts.append(f"{len(synced)} sincronizado(s)")
    if failed:
        parts.append(f"{len(failed)} com erro")
    return "sincronização automática: " + ", ".join(parts)
