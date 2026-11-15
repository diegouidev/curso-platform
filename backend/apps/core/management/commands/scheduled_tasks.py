import logging
import time

from django.core.management.base import BaseCommand, CommandParser
from django.db import close_old_connections

from apps.courses.autosync import run_auto_sync
from apps.courses.reminders import maybe_send_reminder

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        "Periodic tasks: the daily study reminder and the automatic Drive sync. Run it every "
        "few minutes (cron), or with --loop to keep it running (the `scheduler` service)."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument(
            "--loop",
            type=int,
            default=0,
            metavar="SECONDS",
            help="Run forever, waiting this long between runs (0 = run once).",
        )

    def handle(self, *args: object, loop: int, **options: object) -> None:
        while True:
            self.run_once()
            if loop <= 0:
                return
            time.sleep(loop)
            # A long-running process: don't keep a connection that went stale meanwhile.
            close_old_connections()

    def run_once(self) -> None:
        for name, task in [("lembrete", maybe_send_reminder), ("sync", run_auto_sync)]:
            try:
                outcome = task()
            except Exception:  # one failing task must not stop the scheduler
                logger.exception("Scheduled task %s crashed", name)
                continue
            self.stdout.write(f"{name}: {outcome}")
