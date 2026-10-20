from django.core.management.base import BaseCommand

from apps.e2e.seed import USERNAME, seed_account


class Command(BaseCommand):
    help = "E2E stack only: creates the login user and the fake Google account."

    def handle(self, *args: object, **options: object) -> None:
        seed_account()
        self.stdout.write(self.style.SUCCESS(f"E2E user '{USERNAME}' ready."))
