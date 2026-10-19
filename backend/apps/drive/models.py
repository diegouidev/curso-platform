from datetime import timedelta

from django.db import models
from django.utils import timezone

from apps.core.fields import EncryptedTextField


class GoogleCredential(models.Model):
    """The single connected Google account. Tokens are Fernet-encrypted at rest."""

    SINGLETON_ID = 1

    id = models.PositiveSmallIntegerField(primary_key=True, default=SINGLETON_ID, editable=False)
    email = models.EmailField(blank=True)
    access_token = EncryptedTextField(blank=True)
    refresh_token = EncryptedTextField()
    scopes = models.JSONField(default=list)
    expires_at = models.DateTimeField(null=True, blank=True)
    # Set when Google rejects the refresh token (revoked, expired testing-mode token...).
    needs_reconnect = models.BooleanField(default=False)
    last_error = models.TextField(blank=True)
    connected_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(id=1), name="google_credential_singleton"),
        ]

    def __str__(self) -> str:
        return self.email or "Google account"

    @classmethod
    def load(cls) -> "GoogleCredential | None":
        return cls.objects.filter(pk=cls.SINGLETON_ID).first()


class OAuthState(models.Model):
    """Pending authorization request: binds Google's callback to a request we started."""

    TTL = timedelta(minutes=10)

    state = models.CharField(max_length=128, unique=True)
    code_verifier = EncryptedTextField()
    next_path = models.CharField(max_length=200, default="/settings")
    created_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return self.state[:8]

    @property
    def is_expired(self) -> bool:
        return timezone.now() - self.created_at > self.TTL

    @classmethod
    def purge_expired(cls) -> None:
        cls.objects.filter(created_at__lt=timezone.now() - cls.TTL).delete()
