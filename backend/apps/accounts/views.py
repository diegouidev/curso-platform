"""Single-user JWT auth.

The access token is returned in the body (the frontend keeps it in memory only); the
refresh token lives exclusively in an httpOnly cookie and is rotated on every refresh.
Only an active superuser may log in: there is no sign-up.
"""

import contextlib

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import update_last_login
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from .cookies import clear_refresh_cookie, set_refresh_cookie
from .serializers import AccessTokenSerializer, LoginSerializer, UserSerializer

INVALID_CREDENTIALS = "Usuário ou senha inválidos."
SESSION_EXPIRED = "Sessão expirada. Faça login novamente."


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = ()
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(
        request=LoginSerializer,
        responses={
            200: AccessTokenSerializer,
            401: OpenApiResponse(description=INVALID_CREDENTIALS),
        },
        tags=["auth"],
    )
    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(request, **serializer.validated_data)
        if user is None or not user.is_active or not user.is_superuser:
            return Response({"detail": INVALID_CREDENTIALS}, status=status.HTTP_401_UNAUTHORIZED)

        refresh = RefreshToken.for_user(user)
        update_last_login(None, user)

        response = Response(
            {"access": str(refresh.access_token), "user": UserSerializer(user).data}
        )
        set_refresh_cookie(response, str(refresh))
        return response


class RefreshView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = ()

    @extend_schema(
        request=None,
        responses={200: AccessTokenSerializer, 401: OpenApiResponse(description=SESSION_EXPIRED)},
        tags=["auth"],
    )
    def post(self, request: Request) -> Response:
        raw = request.COOKIES.get(settings.AUTH_COOKIE_NAME)
        if not raw:
            return self._expired()

        serializer = TokenRefreshSerializer(data={"refresh": raw})
        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, AuthenticationFailed, ValidationError):
            return self._expired()

        data = serializer.validated_data
        user = _superuser_from_access(data["access"])
        if user is None:
            return self._expired()

        response = Response({"access": data["access"], "user": UserSerializer(user).data})
        set_refresh_cookie(response, data.get("refresh", raw))
        return response

    @staticmethod
    def _expired() -> Response:
        response = Response({"detail": SESSION_EXPIRED}, status=status.HTTP_401_UNAUTHORIZED)
        clear_refresh_cookie(response)
        return response


class LogoutView(APIView):
    # AllowAny: logging out must work even when the access token already expired.
    permission_classes = [AllowAny]
    authentication_classes = ()

    @extend_schema(request=None, responses={204: None}, tags=["auth"])
    def post(self, request: Request) -> Response:
        raw = request.COOKIES.get(settings.AUTH_COOKIE_NAME)
        if raw:
            with contextlib.suppress(TokenError):
                RefreshToken(raw).blacklist()
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_refresh_cookie(response)
        return response


class MeView(APIView):
    @extend_schema(responses=UserSerializer, tags=["auth"])
    def get(self, request: Request) -> Response:
        return Response(UserSerializer(request.user).data)


def _superuser_from_access(access: str) -> AbstractBaseUser | None:
    user_id = AccessToken(access)[settings.SIMPLE_JWT.get("USER_ID_CLAIM", "user_id")]
    user = get_user_model().objects.filter(pk=user_id, is_active=True, is_superuser=True).first()
    return user
