from django.conf import settings
from drf_spectacular.extensions import OpenApiAuthenticationExtension


class RefreshCookieAuthenticationScheme(OpenApiAuthenticationExtension):
    target_class = "apps.accounts.authentication.RefreshCookieAuthentication"
    name = "refreshCookie"

    def get_security_definition(self, auto_schema):
        return {"type": "apiKey", "in": "cookie", "name": settings.AUTH_COOKIE_NAME}
