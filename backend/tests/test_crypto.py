import pytest
from cryptography.fernet import Fernet
from django.core.exceptions import ImproperlyConfigured

from apps.core import crypto
from apps.core.fields import EncryptedTextField


@pytest.fixture(autouse=True)
def _reset_fernet_cache():
    crypto._fernet.cache_clear()
    yield
    crypto._fernet.cache_clear()


def test_field_roundtrip_stores_ciphertext():
    field = EncryptedTextField()

    stored = field.get_prep_value("ya29.secret-access-token")

    assert stored != "ya29.secret-access-token"
    assert "secret" not in stored
    assert field.from_db_value(stored, None, None) == "ya29.secret-access-token"


@pytest.mark.parametrize("value", [None, ""])
def test_field_passes_through_empty_values(value):
    field = EncryptedTextField()

    assert field.get_prep_value(value) == value
    assert field.from_db_value(value, None, None) == value


def test_key_rotation_decrypts_with_old_key(settings):
    old_key, new_key = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    settings.FIELD_ENCRYPTION_KEYS = [old_key]
    token = crypto.encrypt("refresh-token")

    crypto._fernet.cache_clear()
    settings.FIELD_ENCRYPTION_KEYS = [new_key, old_key]

    assert crypto.decrypt(token) == "refresh-token"


def test_wrong_key_raises_invalid_token(settings):
    token = crypto.encrypt("x")
    crypto._fernet.cache_clear()
    settings.FIELD_ENCRYPTION_KEYS = [Fernet.generate_key().decode()]

    with pytest.raises(crypto.InvalidToken):
        crypto.decrypt(token)


def test_missing_key_is_a_configuration_error(settings):
    settings.FIELD_ENCRYPTION_KEYS = []

    with pytest.raises(ImproperlyConfigured):
        crypto.encrypt("x")
