import threading

import pytest

from apps.courses.models import Course, ImportJob, Lesson
from tests.test_course_import import ROOT, build_course_tree


@pytest.mark.django_db(transaction=True)
def test_import_runs_in_background_thread(auth_client, google_connected, fake_drive, settings):
    settings.COURSE_IMPORT_ASYNC = True
    build_course_tree(fake_drive)
    started: list[threading.Thread] = []
    original_start = threading.Thread.start

    def capture(thread: threading.Thread) -> None:
        started.append(thread)
        original_start(thread)

    threading.Thread.start = capture
    try:
        response = auth_client.post("/api/courses/import", {"folder": ROOT}, format="json")
    finally:
        threading.Thread.start = original_start

    assert response.status_code == 202
    assert response.json()["job"]["status"] in {"pending", "running", "success"}
    assert len(started) == 1 and started[0].name.startswith("import-job-")
    started[0].join(timeout=10)

    job = ImportJob.objects.get()
    assert job.status == "success", job.error_message
    assert Lesson.objects.filter(module__course=Course.objects.get()).count() == 8
