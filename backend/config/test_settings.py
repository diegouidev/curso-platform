"""Settings for pytest: deterministic, isolated from the developer's .env values."""

import os
import tempfile

from cryptography.fernet import Fernet

os.environ.setdefault("DJANGO_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="curso-platform-test-")
# A real file (WAL + busy timeout, like production), not the in-memory default: in-memory
# shared-cache SQLite fails with "table is locked" when the import thread writes while the
# request reads, instead of waiting.
os.environ["DATABASE_URL"] = f"sqlite:///{os.environ['DATA_DIR']}/db.sqlite3"
os.environ["DJANGO_DEBUG"] = "false"

from .settings import *

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
AUTH_COOKIE_SECURE = False
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {"login": "1000/min"}
COURSE_IMPORT_ASYNC = False
GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET = "test-client-secret"
DATABASES["default"]["TEST"] = {"NAME": os.path.join(os.environ["DATA_DIR"], "test.sqlite3")}
