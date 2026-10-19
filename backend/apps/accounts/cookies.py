from django.conf import settings
from rest_framework.response import Response


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.AUTH_COOKIE_NAME,
        token,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        httponly=True,
        secure=settings.AUTH_COOKIE_SECURE,
        samesite=settings.AUTH_COOKIE_SAMESITE,
        path="/",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        settings.AUTH_COOKIE_NAME, path="/", samesite=settings.AUTH_COOKIE_SAMESITE
    )
