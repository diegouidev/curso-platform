"""Settings for the Playwright E2E stack (docker-compose.e2e.yml). Never use in production.

Adds apps.e2e, which swaps the Google Drive client for an in-memory fake and mounts
/api/e2e/reset. Everything else is the production configuration.
"""

from .settings import *  # noqa: F403

INSTALLED_APPS = [*INSTALLED_APPS, "apps.e2e"]  # noqa: F405

# "Configured" so the UI offers the import; nothing ever reaches Google.
GOOGLE_CLIENT_ID = "e2e-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET = "e2e-client-secret"  # noqa: S105

# Many logins per run: keep the throttle out of the way.
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {"login": "10000/min"}  # noqa: F405
