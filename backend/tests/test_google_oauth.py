from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from django.conf import settings
from django.db import connection
from django.utils import timezone
from oauthlib.oauth2.rfc6749.errors import InvalidGrantError

from apps.drive.models import GoogleCredential, OAuthState
from apps.drive.oauth import DRIVE_READONLY_SCOPE
from conftest import PASSWORD

pytestmark = pytest.mark.django_db

FRONTEND = settings.FRONTEND_URL
FETCH_TOKEN = "google_auth_oauthlib.flow.Flow.fetch_token"


def token_response(**overrides) -> dict:
    data = {
        "access_token": "ya29.new-access",
        "refresh_token": "1//new-refresh",
        "scope": [DRIVE_READONLY_SCOPE],
        "expires_at": (timezone.now() + timedelta(hours=1)).timestamp(),
        "token_type": "Bearer",
    }
    data.update(overrides)
    return data


@pytest.fixture
def cookie_client(api_client, superuser):
    """Browser-like client: only the refresh cookie, no Authorization header."""
    api_client.post("/api/auth/login", {"username": "diego", "password": PASSWORD}, format="json")
    return api_client


def start_flow(client, next_path="/setup") -> OAuthState:
    response = client.get("/api/google/connect", {"next": next_path})
    assert response.status_code == 302
    return OAuthState.objects.get()


def assert_frontend_redirect(response, path: str, **params: str) -> None:
    assert response.status_code == 302
    url = urlparse(response["Location"])
    assert f"{url.scheme}://{url.netloc}" == FRONTEND
    assert url.path == path
    assert {k: v[0] for k, v in parse_qs(url.query).items()} == params


# --- status ------------------------------------------------------------------------------
def test_status_requires_app_session(api_client):
    assert api_client.get("/api/google/status").status_code == 401


def test_status_when_not_connected(auth_client):
    data = auth_client.get("/api/google/status").json()

    assert data["configured"] is True
    assert data["connected"] is False
    assert data["email"] is None


def test_status_when_connected(auth_client, google_connected):
    data = auth_client.get("/api/google/status").json()

    assert data["connected"] is True
    assert data["needs_reconnect"] is False
    assert data["email"] == "diegocoelho44@gmail.com"
    assert data["scopes"] == [DRIVE_READONLY_SCOPE]


# --- connect -------------------------------------------------------------------------------
def test_connect_without_session_redirects_to_login(api_client):
    response = api_client.get("/api/google/connect", {"next": "/setup"})

    assert_frontend_redirect(response, "/login", next="/setup")


def test_connect_redirects_to_google_with_readonly_scope_only(cookie_client):
    response = cookie_client.get("/api/google/connect", {"next": "/setup"})

    assert response.status_code == 302
    url = urlparse(response["Location"])
    params = {k: v[0] for k, v in parse_qs(url.query).items()}
    assert url.netloc == "accounts.google.com"
    assert params["scope"] == DRIVE_READONLY_SCOPE
    assert params["access_type"] == "offline"
    assert params["prompt"] == "consent"
    assert params["redirect_uri"] == settings.GOOGLE_REDIRECT_URI
    assert params["client_id"] == settings.GOOGLE_CLIENT_ID
    assert params["code_challenge_method"] == "S256"
    assert "include_granted_scopes" not in params

    pending = OAuthState.objects.get()
    assert pending.state == params["state"]
    assert pending.next_path == "/setup"
    assert pending.code_verifier


def test_connect_with_jwt_header_also_works(auth_client):
    assert auth_client.get("/api/google/connect").status_code == 302
    assert OAuthState.objects.get().next_path == "/settings"


def test_connect_rejects_logged_out_cookie(cookie_client):
    refresh = cookie_client.cookies[settings.AUTH_COOKIE_NAME].value
    cookie_client.post("/api/auth/logout")
    cookie_client.cookies[settings.AUTH_COOKIE_NAME] = refresh  # blacklisted token

    response = cookie_client.get("/api/google/connect")

    assert_frontend_redirect(response, "/login", next="/settings")


@pytest.mark.parametrize("unsafe", ["//evil.example", "https://evil.example", "/\\evil"])
def test_connect_ignores_unsafe_next(cookie_client, unsafe):
    start = start_flow(cookie_client, next_path=unsafe)

    assert start.next_path == "/settings"


def test_connect_when_not_configured(cookie_client, settings):
    settings.GOOGLE_CLIENT_ID = ""

    response = cookie_client.get("/api/google/connect", {"next": "/setup"})

    assert_frontend_redirect(response, "/setup", google="error", reason="google_not_configured")
    assert not OAuthState.objects.exists()


def test_code_verifier_is_encrypted_at_rest(cookie_client):
    pending = start_flow(cookie_client)

    with connection.cursor() as cursor:
        cursor.execute("SELECT code_verifier FROM drive_oauthstate WHERE id = %s", [pending.pk])
        raw = cursor.fetchone()[0]
    assert raw != pending.code_verifier


# --- callback --------------------------------------------------------------------------------
def test_callback_success_stores_encrypted_tokens(api_client, cookie_client, fake_drive):
    pending = start_flow(cookie_client, "/setup")

    with patch(FETCH_TOKEN, return_value=token_response()) as fetch:
        response = api_client.get(
            "/api/google/callback", {"state": pending.state, "code": "auth-code"}
        )

    assert_frontend_redirect(response, "/setup", google="connected")
    fetch.assert_called_once_with(code="auth-code")
    credential = GoogleCredential.load()
    assert credential.email == "diegocoelho44@gmail.com"
    assert credential.access_token == "ya29.new-access"
    assert credential.refresh_token == "1//new-refresh"
    assert credential.scopes == [DRIVE_READONLY_SCOPE]
    assert credential.expires_at > timezone.now()
    assert not OAuthState.objects.exists()  # one-time use

    with connection.cursor() as cursor:
        cursor.execute("SELECT access_token, refresh_token FROM drive_googlecredential")
        raw_access, raw_refresh = cursor.fetchone()
    assert "ya29" not in raw_access and "new-refresh" not in raw_refresh
    assert [name for name, _ in fake_drive.calls] == ["about.get"]


def test_callback_reconnect_replaces_tokens_and_clears_flag(
    api_client, cookie_client, fake_drive, google_connected
):
    google_connected.needs_reconnect = True
    google_connected.save()
    pending = start_flow(cookie_client)

    with patch(FETCH_TOKEN, return_value=token_response()):
        api_client.get("/api/google/callback", {"state": pending.state, "code": "c"})

    credential = GoogleCredential.load()
    assert credential.needs_reconnect is False
    assert credential.refresh_token == "1//new-refresh"
    assert GoogleCredential.objects.count() == 1


def test_callback_unknown_state(api_client):
    response = api_client.get("/api/google/callback", {"state": "forged", "code": "c"})

    assert_frontend_redirect(response, "/settings", google="error", reason="invalid_state")


def test_callback_expired_state(api_client, cookie_client):
    pending = start_flow(cookie_client)
    OAuthState.objects.filter(pk=pending.pk).update(
        created_at=timezone.now() - timedelta(minutes=11)
    )

    response = api_client.get("/api/google/callback", {"state": pending.state, "code": "c"})

    assert_frontend_redirect(response, "/settings", google="error", reason="invalid_state")
    assert not OAuthState.objects.exists()


def test_callback_state_cannot_be_replayed(api_client, cookie_client, fake_drive):
    pending = start_flow(cookie_client, "/setup")
    with patch(FETCH_TOKEN, return_value=token_response()):
        api_client.get("/api/google/callback", {"state": pending.state, "code": "c"})

    response = api_client.get("/api/google/callback", {"state": pending.state, "code": "c"})

    assert_frontend_redirect(response, "/settings", google="error", reason="invalid_state")


def test_callback_user_denied_consent(api_client, cookie_client):
    pending = start_flow(cookie_client, "/setup")

    response = api_client.get(
        "/api/google/callback", {"state": pending.state, "error": "access_denied"}
    )

    assert_frontend_redirect(response, "/setup", google="error", reason="access_denied")
    assert not GoogleCredential.objects.exists()


def test_callback_rejects_token_without_drive_scope(api_client, cookie_client):
    pending = start_flow(cookie_client, "/setup")

    with patch(FETCH_TOKEN, return_value=token_response(scope=[])):
        response = api_client.get("/api/google/callback", {"state": pending.state, "code": "c"})

    assert_frontend_redirect(response, "/setup", google="error", reason="google_scope_denied")
    assert not GoogleCredential.objects.exists()


def test_callback_requires_refresh_token(api_client, cookie_client):
    pending = start_flow(cookie_client, "/setup")

    with patch(FETCH_TOKEN, return_value=token_response(refresh_token=None)):
        response = api_client.get("/api/google/callback", {"state": pending.state, "code": "c"})

    assert_frontend_redirect(response, "/setup", google="error", reason="google_no_refresh_token")


def test_callback_token_exchange_failure(api_client, cookie_client):
    pending = start_flow(cookie_client, "/setup")

    with patch(FETCH_TOKEN, side_effect=InvalidGrantError("bad code")):
        response = api_client.get("/api/google/callback", {"state": pending.state, "code": "c"})

    assert_frontend_redirect(response, "/setup", google="error", reason="exchange_failed")


def test_callback_detects_drive_api_disabled(api_client, cookie_client, fake_drive):
    pending = start_flow(cookie_client, "/setup")
    fake_drive.fail_next(403, "accessNotConfigured")

    with patch(FETCH_TOKEN, return_value=token_response()):
        response = api_client.get("/api/google/callback", {"state": pending.state, "code": "c"})

    assert_frontend_redirect(response, "/setup", google="error", reason="drive_api_disabled")
    assert not GoogleCredential.objects.exists()


# --- disconnect -------------------------------------------------------------------------------
def test_disconnect_revokes_and_deletes(auth_client, google_connected):
    with patch("apps.drive.oauth.requests.post") as post:
        post.return_value.status_code = 200
        response = auth_client.post("/api/google/disconnect")

    assert response.status_code == 204
    assert not GoogleCredential.objects.exists()
    post.assert_called_once()
    assert post.call_args.kwargs["data"] == {"token": "1//refresh-token"}


def test_disconnect_still_deletes_when_revoke_fails(auth_client, google_connected):
    import requests

    with patch("apps.drive.oauth.requests.post", side_effect=requests.ConnectionError):
        response = auth_client.post("/api/google/disconnect")

    assert response.status_code == 204
    assert not GoogleCredential.objects.exists()


def test_disconnect_requires_session(api_client, google_connected):
    assert api_client.post("/api/google/disconnect").status_code == 401
    assert GoogleCredential.objects.exists()
