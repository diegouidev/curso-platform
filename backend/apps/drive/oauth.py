"""Google OAuth web flow, restricted to the read-only Drive scope.

Only `drive.readonly` is ever requested; the account e-mail is read through Drive's
`about.get` instead of asking for the `email`/`openid` scopes.
"""

import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

import requests
from django.conf import settings
from google_auth_oauthlib.flow import Flow

from .errors import GoogleError, GoogleNotConfigured

# With granular consent the user may untick the Drive checkbox; oauthlib would raise a bare
# Warning on the scope mismatch. We check the granted scopes ourselves in exchange_code().
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
SCOPES = [DRIVE_READONLY_SCOPE]

TOKEN_URI = "https://oauth2.googleapis.com/token"  # noqa: S105 - URL, not a secret
AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
REVOKE_URI = "https://oauth2.googleapis.com/revoke"


class ScopeNotGranted(GoogleError):
    code = "google_scope_denied"
    message = (
        "A permissão de leitura do Google Drive não foi concedida. "
        "Conecte novamente e marque a opção de acesso ao Drive."
    )


class MissingRefreshToken(GoogleError):
    code = "google_no_refresh_token"
    message = "O Google não retornou um refresh token. Tente conectar novamente."


@dataclass(frozen=True)
class AuthorizationRequest:
    url: str
    state: str
    code_verifier: str


@dataclass(frozen=True)
class TokenResult:
    access_token: str
    refresh_token: str
    scopes: list[str]
    expires_at: datetime | None


def ensure_configured() -> None:
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise GoogleNotConfigured()


def client_config() -> dict:
    return {
        "web": {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "auth_uri": AUTH_URI,
            "token_uri": TOKEN_URI,
            "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
        }
    }


def _flow(*, state: str | None = None, code_verifier: str | None = None) -> Flow:
    ensure_configured()
    return Flow.from_client_config(
        client_config(),
        scopes=SCOPES,
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
        state=state,
        code_verifier=code_verifier,
        autogenerate_code_verifier=True,
    )


def build_authorization_request() -> AuthorizationRequest:
    flow = _flow()
    url, state = flow.authorization_url(
        state=secrets.token_urlsafe(32),
        access_type="offline",  # we need a refresh token
        prompt="consent",  # always return a refresh token, even on reconnect
    )
    return AuthorizationRequest(url=url, state=state, code_verifier=flow.code_verifier)


def exchange_code(code: str, *, state: str, code_verifier: str) -> TokenResult:
    flow = _flow(state=state, code_verifier=code_verifier)
    # Passing `code` directly (not the full callback URL) keeps oauthlib from rejecting
    # the plain-http localhost redirect URI.
    token = flow.fetch_token(code=code)

    raw_scopes = token.get("scope") or []
    scopes = raw_scopes.split() if isinstance(raw_scopes, str) else list(raw_scopes)
    if DRIVE_READONLY_SCOPE not in scopes:
        raise ScopeNotGranted()

    refresh_token = token.get("refresh_token")
    if not refresh_token:
        raise MissingRefreshToken()

    expires_at = None
    if token.get("expires_at"):
        expires_at = datetime.fromtimestamp(float(token["expires_at"]), tz=UTC)

    return TokenResult(
        access_token=token["access_token"],
        refresh_token=refresh_token,
        scopes=scopes,
        expires_at=expires_at,
    )


def revoke(token: str) -> bool:
    """Best-effort revocation at Google (an OAuth call; it does not touch the Drive)."""
    try:
        response = requests.post(
            REVOKE_URI,
            data={"token": token},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
    except requests.RequestException:
        return False
    return response.status_code == 200
