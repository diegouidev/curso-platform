from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from google.auth.exceptions import RefreshError

from apps.drive.credentials import get_credentials, google_credentials
from apps.drive.errors import GoogleNotConnected, GoogleReconnectRequired
from apps.drive.models import GoogleCredential

pytestmark = pytest.mark.django_db

REFRESH = "google.oauth2.credentials.Credentials.refresh"


def fake_refresh(self, request):
    self.token = "ya29.refreshed"
    self.expiry = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)


def test_not_connected():
    with pytest.raises(GoogleNotConnected):
        get_credentials()


def test_valid_token_is_used_without_refresh(google_connected):
    with patch(REFRESH) as refresh:
        _, creds = get_credentials()

    refresh.assert_not_called()
    assert creds.token == "ya29.valid-access"
    assert creds.refresh_token == "1//refresh-token"


def test_expiring_token_is_refreshed_and_persisted(google_connected):
    google_connected.expires_at = timezone.now() + timedelta(minutes=2)
    google_connected.save()

    with patch(REFRESH, autospec=True, side_effect=fake_refresh) as refresh:
        _, creds = get_credentials()

    refresh.assert_called_once()
    assert creds.token == "ya29.refreshed"
    stored = GoogleCredential.load()
    assert stored.access_token == "ya29.refreshed"
    assert stored.expires_at > timezone.now() + timedelta(minutes=50)


def test_rejected_refresh_token_flags_reconnect(google_connected):
    google_connected.expires_at = timezone.now() - timedelta(minutes=1)
    google_connected.save()

    with (
        patch(REFRESH, side_effect=RefreshError("invalid_grant: Token has been expired")),
        pytest.raises(GoogleReconnectRequired),
    ):
        get_credentials()

    stored = GoogleCredential.load()
    assert stored.needs_reconnect is True
    assert "invalid_grant" in stored.last_error


def test_flagged_credential_fails_fast_without_calling_google(google_connected):
    google_connected.needs_reconnect = True
    google_connected.save()

    with patch(REFRESH) as refresh, pytest.raises(GoogleReconnectRequired):
        get_credentials()
    refresh.assert_not_called()


def test_status_shows_reconnect_needed(auth_client, google_connected):
    google_connected.needs_reconnect = True
    google_connected.save()

    assert auth_client.get("/api/google/status").json()["needs_reconnect"] is True


def test_token_refreshed_by_google_client_is_persisted_on_exit(google_connected):
    with google_credentials() as (_, creds):
        creds.token = "ya29.refreshed-mid-import"
        creds.expiry = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)

    assert GoogleCredential.load().access_token == "ya29.refreshed-mid-import"
