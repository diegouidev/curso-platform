import pytest
from django.test import override_settings

from apps.courses.models import Course, Lesson

pytestmark = pytest.mark.django_db


def test_e2e_routes_do_not_exist_outside_the_e2e_stack(api_client):
    assert api_client.post("/api/e2e/reset").status_code == 404


def test_e2e_reset_imports_the_fake_course(monkeypatch):
    from apps.e2e import seed
    from apps.e2e.drive import COURSE_FOLDER_ID, FAKE_DRIVE, LONG_TITLE

    monkeypatch.setattr("apps.drive.client.build_service", lambda credentials: FAKE_DRIVE)
    with override_settings(COURSE_IMPORT_ASYNC=False):
        course = seed.reset(with_course=True)

    assert course.drive_folder_id == COURSE_FOLDER_ID
    titles = list(
        Lesson.objects.filter(module__course=course)
        .order_by("module__order", "order")
        .values_list("title", flat=True)
    )
    assert titles == [
        "00 - Boas-vindas",
        "01 - Introdução",
        "02 - Variáveis",
        "10 - Revisão",
        "Aula 1",
        "Aula 2",
        LONG_TITLE,
        "Extras - Bônus",
    ]
    # Reset wipes user data but keeps the login and the Google account.
    seed.reset(with_course=False)
    assert not Course.objects.exists()
