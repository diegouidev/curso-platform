"""Import/sync jobs. No Celery: a job runs in a plain background thread and reports its
progress on the ImportJob row, which the frontend polls."""

import logging
import threading

from django.conf import settings
from django.db import close_old_connections, connections, transaction
from django.utils import timezone
from rest_framework import status

from apps.core.exceptions import AppError
from apps.drive.client import drive_client

from .models import Course, ImportJob
from .scanner import scan_course
from .sync import apply_scan

logger = logging.getLogger(__name__)


class JobAlreadyRunning(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "import_running"
    message = "Já existe uma importação em andamento para este curso."


def create_job(course: Course, kind: str) -> ImportJob:
    with transaction.atomic():
        for job in course.import_jobs.filter(
            status__in=[ImportJob.Status.PENDING, ImportJob.Status.RUNNING]
        ):
            job.fail_if_stale()
            if job.is_active:
                raise JobAlreadyRunning()
        return ImportJob.objects.create(course=course, kind=kind)


def start_job(job: ImportJob) -> None:
    if settings.COURSE_IMPORT_ASYNC:
        thread = threading.Thread(
            target=_thread_main, args=(job.pk,), name=f"import-job-{job.pk}", daemon=True
        )
        thread.start()
    else:
        run_job(job.pk)


def _thread_main(job_id: int) -> None:
    close_old_connections()
    try:
        run_job(job_id)
    finally:
        connections.close_all()


def run_job(job_id: int) -> None:
    job = ImportJob.objects.select_related("course").get(pk=job_id)
    _update(job_id, status=ImportJob.Status.RUNNING)

    def on_progress(folders: int, files: int) -> None:
        _update(job_id, folders_scanned=folders, files_found=files)

    try:
        with drive_client() as (_, client):
            scan = scan_course(client, job.course.drive_folder_id, on_progress=on_progress)
        stats = apply_scan(job.course, scan)
    except AppError as exc:
        logger.info("Import job %s failed: %s", job_id, exc.code)
        _finish(job_id, ImportJob.Status.ERROR, error_code=exc.code, error_message=exc.message)
    except Exception:
        logger.exception("Import job %s crashed", job_id)
        _finish(
            job_id,
            ImportJob.Status.ERROR,
            error_code="unexpected",
            error_message="Erro inesperado durante a importação. Veja os logs do backend.",
        )
    else:
        _finish(
            job_id,
            ImportJob.Status.SUCCESS,
            stats=stats.as_dict(),
            folders_scanned=scan.folders_scanned,
            files_found=scan.files_found,
        )


def _update(job_id: int, **fields) -> None:
    # .update() skips auto_now, so the heartbeat is set explicitly.
    ImportJob.objects.filter(pk=job_id).update(updated_at=timezone.now(), **fields)


def _finish(job_id: int, status_value: str, **fields) -> None:
    _update(job_id, status=status_value, finished_at=timezone.now(), **fields)
