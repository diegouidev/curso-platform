from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.courses import jobs
from apps.courses.models import Course, ImportJob, StudyPreferences
from apps.drive.models import GoogleCredential

from .drive import ACCOUNT_EMAIL, COURSE_FOLDER_ID, FAKE_DRIVE

USERNAME = "e2e"
PASSWORD = "e2e-senha-forte-123"  # noqa: S105 (throwaway user of the E2E stack)


def seed_account() -> None:
    """The login user and a connected (fake) Google account."""
    User = get_user_model()
    if not User.objects.filter(username=USERNAME).exists():
        User.objects.create_superuser(USERNAME, "e2e@example.com", PASSWORD)
    GoogleCredential.objects.update_or_create(
        pk=GoogleCredential.SINGLETON_ID,
        defaults={
            "email": ACCOUNT_EMAIL,
            "access_token": "e2e-access-token",
            "refresh_token": "e2e-refresh-token",
            "scopes": ["https://www.googleapis.com/auth/drive.readonly"],
            # Far away: the client never tries to refresh against Google.
            "expires_at": timezone.now() + timedelta(days=3650),
            "needs_reconnect": False,
        },
    )


def reset(*, with_course: bool) -> Course | None:
    """Wipes courses and study data; optionally imports the fake course right away."""
    with transaction.atomic():
        Course.objects.all().delete()  # cascades to modules, lessons, progress, notes...
        StudyPreferences.objects.all().delete()
        seed_account()
    if not with_course:
        return None
    root = FAKE_DRIVE.items[COURSE_FOLDER_ID]
    course = Course.objects.create(
        drive_folder_id=COURSE_FOLDER_ID, drive_name_original=root.name, title=root.name
    )
    job = jobs.create_job(course, ImportJob.Kind.IMPORT)
    jobs.run_job(job.pk)  # inline: the test starts with the course ready
    return course
