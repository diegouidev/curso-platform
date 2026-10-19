"""Load the stored Google credential, refreshing and persisting tokens as needed."""

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

from django.conf import settings
from google.auth.exceptions import RefreshError, TransportError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

from .errors import DriveError, GoogleNotConnected, GoogleReconnectRequired
from .models import GoogleCredential
from .oauth import SCOPES, TOKEN_URI, TokenResult, ensure_configured

logger = logging.getLogger(__name__)

# Refresh a bit before the real expiry so long imports don't start with a dying token.
EXPIRY_MARGIN = timedelta(minutes=5)


def save_token_result(result: TokenResult, *, email: str) -> GoogleCredential:
    credential, _ = GoogleCredential.objects.update_or_create(
        pk=GoogleCredential.SINGLETON_ID,
        defaults={
            "email": email,
            "access_token": result.access_token,
            "refresh_token": result.refresh_token,
            "scopes": result.scopes,
            "expires_at": result.expires_at,
            "needs_reconnect": False,
            "last_error": "",
            "connected_at": datetime.now(UTC),
        },
    )
    return credential


def to_google_credentials(credential: GoogleCredential) -> Credentials:
    expiry = None
    if credential.expires_at:
        # google-auth compares expiry against naive UTC datetimes.
        expiry = credential.expires_at.astimezone(UTC).replace(tzinfo=None)
    return Credentials(
        token=credential.access_token or None,
        refresh_token=credential.refresh_token,
        token_uri=TOKEN_URI,
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=SCOPES,
        expiry=expiry,
    )


def _expiring(creds: Credentials) -> bool:
    if not creds.token or not creds.expiry:
        return True
    return creds.expiry - EXPIRY_MARGIN <= datetime.now(UTC).replace(tzinfo=None)


def _persist_if_changed(credential: GoogleCredential, creds: Credentials) -> None:
    if creds.token and creds.token != credential.access_token:
        credential.access_token = creds.token
        credential.expires_at = creds.expiry.replace(tzinfo=UTC) if creds.expiry else None
        credential.save(update_fields=["access_token", "expires_at", "updated_at"])


def _mark_reconnect(credential: GoogleCredential, error: Exception) -> None:
    credential.needs_reconnect = True
    credential.last_error = str(error)[:500]
    credential.save(update_fields=["needs_reconnect", "last_error", "updated_at"])


def refresh(credential: GoogleCredential, creds: Credentials) -> None:
    try:
        creds.refresh(Request())
    except RefreshError as exc:
        logger.warning("Google refresh token rejected: %s", exc)
        _mark_reconnect(credential, exc)
        raise GoogleReconnectRequired() from exc
    except TransportError as exc:
        raise DriveError() from exc
    _persist_if_changed(credential, creds)


def get_credentials() -> tuple[GoogleCredential, Credentials]:
    """Return valid credentials or raise GoogleNotConnected / GoogleReconnectRequired."""
    ensure_configured()
    credential = GoogleCredential.load()
    if credential is None:
        raise GoogleNotConnected()
    if credential.needs_reconnect:
        raise GoogleReconnectRequired()

    creds = to_google_credentials(credential)
    if _expiring(creds):
        refresh(credential, creds)
    return credential, creds


@contextmanager
def google_credentials() -> Iterator[tuple[GoogleCredential, Credentials]]:
    """Yield credentials and persist any token the Google client refreshed meanwhile."""
    credential, creds = get_credentials()
    try:
        yield credential, creds
    finally:
        _persist_if_changed(credential, creds)
