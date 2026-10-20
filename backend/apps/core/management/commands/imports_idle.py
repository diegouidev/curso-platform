from django.core.management.base import BaseCommand, CommandError

from apps.courses.models import ImportJob


class Command(BaseCommand):
    help = (
        "Exits with an error while a course import/sync is running. Used before restarting "
        "the backend: a restart kills the import thread."
    )

    def handle(self, *args: object, **options: object) -> None:
        jobs = list(
            ImportJob.objects.select_related("course").filter(
                status__in=[ImportJob.Status.PENDING, ImportJob.Status.RUNNING]
            )
        )
        for job in jobs:
            job.fail_if_stale()  # a job dead for 10+ minutes doesn't block anything
        active = [job for job in jobs if job.is_active]
        if active:
            names = ", ".join(f'"{job.course.title}"' for job in active)
            raise CommandError(
                f"Importação em andamento ({names}). Espere terminar antes de reiniciar o "
                "backend; reiniciar agora interrompe a importação."
            )
        self.stdout.write("Nenhuma importação em andamento.")
