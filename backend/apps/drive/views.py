import logging

from django.conf import settings
from django.http import HttpResponseRedirect
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from oauthlib.oauth2.rfc6749.errors import OAuth2Error
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.accounts.authentication import RefreshCookieAuthentication
from apps.core.exceptions import AppError
from apps.core.redirects import frontend_redirect, safe_next_path

from . import oauth
from .client import DriveClient, build_service
from .credentials import save_token_result, to_google_credentials
from .models import GoogleCredential, OAuthState
from .serializers import GoogleStatusSerializer

logger = logging.getLogger(__name__)

DEFAULT_NEXT = "/settings"


class GoogleStatusView(APIView):
    @extend_schema(responses=GoogleStatusSerializer, tags=["google"])
    def get(self, request: Request) -> Response:
        credential = GoogleCredential.load()
        data = {
            "configured": bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET),
            "connected": credential is not None,
            "needs_reconnect": bool(credential and credential.needs_reconnect),
            "email": credential.email if credential else None,
            "scopes": credential.scopes if credential else [],
            "expires_at": credential.expires_at if credential else None,
            "connected_at": credential.connected_at if credential else None,
        }
        return Response(GoogleStatusSerializer(data).data)


class GoogleConnectView(APIView):
    """Starts the OAuth flow. Opened as a full-page navigation, hence the cookie auth and
    redirects (never JSON) for every outcome."""

    authentication_classes = (JWTAuthentication, RefreshCookieAuthentication)
    permission_classes = (AllowAny,)  # checked manually to redirect instead of 401

    @extend_schema(
        parameters=[OpenApiParameter("next", str, description="Frontend path to return to.")],
        responses={302: OpenApiResponse(description="Redirect to Google consent screen.")},
        tags=["google"],
    )
    def get(self, request: Request) -> HttpResponseRedirect:
        next_path = safe_next_path(request.query_params.get("next"), DEFAULT_NEXT)
        if not request.user.is_authenticated:
            return frontend_redirect("/login", next=next_path)
        try:
            auth_request = oauth.build_authorization_request()
        except AppError as exc:
            return frontend_redirect(next_path, google="error", reason=exc.code)

        OAuthState.purge_expired()
        OAuthState.objects.create(
            state=auth_request.state,
            code_verifier=auth_request.code_verifier,
            next_path=next_path,
        )
        return HttpResponseRedirect(auth_request.url)


class GoogleCallbackView(APIView):
    """Google redirects here (directly on the backend). Authenticated by the one-time
    `state` created in GoogleConnectView, not by the app session."""

    authentication_classes = ()
    permission_classes = (AllowAny,)

    @extend_schema(
        parameters=[
            OpenApiParameter("state", str),
            OpenApiParameter("code", str),
            OpenApiParameter("error", str),
        ],
        responses={302: OpenApiResponse(description="Redirect back to the frontend.")},
        tags=["google"],
    )
    def get(self, request: Request) -> HttpResponseRedirect:
        state_value = request.query_params.get("state", "")
        pending = OAuthState.objects.filter(state=state_value).first() if state_value else None
        if pending is None or pending.is_expired:
            if pending:
                pending.delete()
            return frontend_redirect(DEFAULT_NEXT, google="error", reason="invalid_state")
        pending.delete()  # one-time use
        next_path = pending.next_path

        if request.query_params.get("error") or not request.query_params.get("code"):
            return frontend_redirect(next_path, google="error", reason="access_denied")

        try:
            result = oauth.exchange_code(
                request.query_params["code"],
                state=pending.state,
                code_verifier=pending.code_verifier,
            )
            email = fetch_account_email(result)
        except AppError as exc:
            return frontend_redirect(next_path, google="error", reason=exc.code)
        except OAuth2Error as exc:
            logger.warning("Google token exchange failed: %s", exc)
            return frontend_redirect(next_path, google="error", reason="exchange_failed")

        save_token_result(result, email=email)
        return frontend_redirect(next_path, google="connected")


class GoogleDisconnectView(APIView):
    @extend_schema(request=None, responses={204: None}, tags=["google"])
    def post(self, request: Request) -> Response:
        credential = GoogleCredential.load()
        if credential:
            oauth.revoke(credential.refresh_token)
            credential.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def fetch_account_email(result: oauth.TokenResult) -> str:
    """Reads the account e-mail through Drive `about.get` (no extra scopes needed). This
    also proves the Drive API is enabled before we store anything."""
    unsaved = GoogleCredential(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        expires_at=result.expires_at,
    )
    client = DriveClient(build_service(to_google_credentials(unsaved)), max_retries=2)
    return client.about().get("user", {}).get("emailAddress", "")
