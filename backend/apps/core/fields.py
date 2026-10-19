from typing import Any

from django.db import models

from .crypto import decrypt, encrypt


class EncryptedTextField(models.TextField):
    """TextField whose value is Fernet-encrypted at rest and plaintext in Python."""

    def get_prep_value(self, value: Any) -> Any:
        value = super().get_prep_value(value)
        if value is None or value == "":
            return value
        return encrypt(value)

    def from_db_value(self, value: str | None, expression: Any, connection: Any) -> str | None:
        if value is None or value == "":
            return value
        return decrypt(value)
