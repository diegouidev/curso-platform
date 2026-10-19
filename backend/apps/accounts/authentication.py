from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.authentication import BaseAuthentication
from rest_framework.request import Request
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken


class RefreshCookieAuthentication(BaseAuthentication):
    """Authenticate top-level browser navigations (e.g. starting the Google OAuth flow),
    which cannot carry the in-memory access token, using the httpOnly refresh cookie.

    Only meant for GET endpoints that redirect. The token is validated (signature, expiry,
    blacklist) but not rotated.
    """

    def authenticate(self, request: Request):
        raw = request.COOKIES.get(settings.AUTH_COOKIE_NAME)
        if not raw:
            return None
        try:
            token = RefreshToken(raw)
        except TokenError:
            return None
        claim = settings.SIMPLE_JWT.get("USER_ID_CLAIM", "user_id")
        user = (
            get_user_model()
            .objects.filter(pk=token.get(claim), is_active=True, is_superuser=True)
            .first()
        )
        return (user, None) if user else None
