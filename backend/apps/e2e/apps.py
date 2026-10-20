from django.apps import AppConfig


class E2EConfig(AppConfig):
    """Only installed by config.e2e_settings (the Playwright stack). Never in production."""

    name = "apps.e2e"
    label = "e2e"

    def ready(self) -> None:
        import apps.drive.client as drive_client
        import apps.drive.views as drive_views

        from .drive import FAKE_DRIVE

        # Every Drive client the app builds talks to the in-memory fake instead of Google.
        drive_client.build_service = lambda credentials: FAKE_DRIVE
        drive_views.build_service = lambda credentials: FAKE_DRIVE
