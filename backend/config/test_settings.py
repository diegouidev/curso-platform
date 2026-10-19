"""Settings for pytest: deterministic, isolated from the developer's .env values."""

import os
import tempfile

from cryptography.fernet import Fernet

os.environ.setdefault("DJANGO_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="curso-platform-test-")
os.environ["DATABASE_URL"] = "sqlite://:memory:"
os.environ["DJANGO_DEBUG"] = "false"

from .settings import *

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
AUTH_COOKIE_SECURE = False
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {"login": "1000/min"}
COURSE_IMPORT_ASYNC = False
GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET = "test-client-secret"
