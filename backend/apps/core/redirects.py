from urllib.parse import urlencode

from django.conf import settings
from django.http import HttpResponseRedirect


def safe_next_path(value: str | None, default: str = "/") -> str:
    """Same-origin relative paths only (no open redirects)."""
    if not value or not value.startswith("/") or value.startswith(("//", "/\\")):
        return default
    return value


def frontend_redirect(path: str, **params: str) -> HttpResponseRedirect:
    query = f"?{urlencode(params)}" if params else ""
    return HttpResponseRedirect(f"{settings.FRONTEND_URL}{path}{query}")
