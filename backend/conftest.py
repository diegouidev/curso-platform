from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from tests.fakes import FakeDrive

PASSWORD = "s3nha-Forte!"


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def superuser(db):
    return get_user_model().objects.create_superuser("diego", "diego@example.com", PASSWORD)


@pytest.fixture
def auth_client(api_client, superuser) -> APIClient:
    response = api_client.post(
        "/api/auth/login", {"username": "diego", "password": PASSWORD}, format="json"
    )
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return api_client


# --- Google / Drive -------------------------------------------------------------------


@pytest.fixture
def google_connected(db):
    from apps.drive.models import GoogleCredential

    return GoogleCredential.objects.create(
        email="diegocoelho44@gmail.com",
        access_token="ya29.valid-access",
        refresh_token="1//refresh-token",
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
        expires_at=timezone.now() + timedelta(hours=1),
    )


@pytest.fixture
def fake_drive(monkeypatch) -> FakeDrive:
    """Every DriveClient built by the app talks to this in-memory Drive."""
    drive = FakeDrive()
    monkeypatch.setattr("apps.drive.client.build_service", lambda credentials: drive)
    monkeypatch.setattr("apps.drive.views.build_service", lambda credentials: drive)
    return drive


@pytest.fixture(autouse=True)
def no_retry_sleep(monkeypatch) -> list[float]:
    """Retries/backoff never really sleep in tests; the delays are recorded instead."""
    delays: list[float] = []
    monkeypatch.setattr("apps.drive.client.time.sleep", delays.append)
    return delays
