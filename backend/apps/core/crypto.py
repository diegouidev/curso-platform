"""Symmetric encryption for secrets stored in the database (Fernet / MultiFernet)."""

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

__all__ = ["InvalidToken", "decrypt", "encrypt"]


@lru_cache(maxsize=1)
def _fernet() -> MultiFernet:
    keys = settings.FIELD_ENCRYPTION_KEYS
    if not keys:
        raise ImproperlyConfigured(
            "FIELD_ENCRYPTION_KEY is not set. Generate one with: "
            'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )
    try:
        return MultiFernet([Fernet(key.encode()) for key in keys])
    except ValueError as exc:
        raise ImproperlyConfigured("FIELD_ENCRYPTION_KEY is not a valid Fernet key.") from exc


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()
