from django.db import models
from django.utils import timezone


class Course(models.Model):
    title = models.CharField(max_length=255)
    title_is_custom = models.BooleanField(
        default=False, help_text="Edited by the user: sync keeps it instead of the Drive name."
    )
    drive_folder_id = models.CharField(max_length=128, unique=True)
    drive_name_original = models.CharField(max_length=255, blank=True)
    thumbnail = models.ImageField(upload_to="thumbnails/", null=True, blank=True)
    description = models.TextField(blank=True)
    is_archived = models.BooleanField(default=False)
    clean_titles = models.BooleanField(
        default=True, help_text="Tidy Drive names into titles (extension, underscores...)."
    )
    modules_order_is_custom = models.BooleanField(default=False)
    last_imported_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["is_archived", "-created_at"]

    def __str__(self) -> str:
        return self.title


class Module(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="modules")
    title = models.CharField(max_length=255)
    title_is_custom = models.BooleanField(default=False)
    # Root folder id for the "Geral" module (videos placed directly in the course folder).
    # NULL (not "") so the unique (course, folder) constraint allows several folder-less modules.
    drive_folder_id = models.CharField(max_length=128, null=True, blank=True)  # noqa: DJ001
    drive_name_original = models.CharField(max_length=255, blank=True)
    order = models.PositiveIntegerField(default=0)
    is_hidden = models.BooleanField(default=False)
    missing_in_drive = models.BooleanField(default=False)
    lessons_order_is_custom = models.BooleanField(default=False)

    class Meta:
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["course", "drive_folder_id"], name="unique_module_folder_per_course"
            )
        ]

    def __str__(self) -> str:
        return self.title


class Lesson(models.Model):
    module = models.ForeignKey(Module, on_delete=models.CASCADE, related_name="lessons")
    title = models.CharField(max_length=500)
    title_is_custom = models.BooleanField(default=False)
    drive_file_id = models.CharField(max_length=128, db_index=True)
    drive_name_original = models.CharField(max_length=500)
    # Folder path inside the module for nested sub-folders ("Parte 1 / Extras").
    drive_path = models.CharField(max_length=1000, blank=True)
    mime_type = models.CharField(max_length=128)
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    drive_modified_at = models.DateTimeField(null=True, blank=True)
    order = models.PositiveIntegerField(default=0)
    is_hidden = models.BooleanField(default=False)
    missing_in_drive = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self) -> str:
        return self.title


class Attachment(models.Model):
    """Non-video file (PDF, Docs, Slides...) found next to the videos."""

    module = models.ForeignKey(
        Module, on_delete=models.CASCADE, related_name="attachments", null=True, blank=True
    )
    lesson = models.ForeignKey(
        Lesson, on_delete=models.CASCADE, related_name="attachments", null=True, blank=True
    )
    title = models.CharField(max_length=500)
    drive_file_id = models.CharField(max_length=128, db_index=True)
    mime_type = models.CharField(max_length=128)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(module__isnull=False, lesson__isnull=True)
                    | models.Q(module__isnull=True, lesson__isnull=False)
                ),
                name="attachment_belongs_to_module_xor_lesson",
            )
        ]

    def __str__(self) -> str:
        return self.title


class LessonProgress(models.Model):
    lesson = models.OneToOneField(Lesson, on_delete=models.CASCADE, related_name="progress")
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    last_opened_at = models.DateTimeField(null=True, blank=True)
    time_on_page_seconds = models.PositiveIntegerField(default=0)

    def __str__(self) -> str:
        return f"{self.lesson_id}: {'done' if self.completed else 'open'}"


class Note(models.Model):
    lesson = models.OneToOneField(Lesson, on_delete=models.CASCADE, related_name="note")
    content = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Note for {self.lesson_id}"


class ImportJob(models.Model):
    class Kind(models.TextChoices):
        IMPORT = "import", "Importação"
        SYNC = "sync", "Sincronização"

    class Status(models.TextChoices):
        PENDING = "pending", "Na fila"
        RUNNING = "running", "Em andamento"
        SUCCESS = "success", "Concluída"
        ERROR = "error", "Erro"

    # A running job not updated for this long is considered dead (e.g. server restart).
    STALE_AFTER_SECONDS = 600

    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="import_jobs")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    folders_scanned = models.PositiveIntegerField(default=0)
    files_found = models.PositiveIntegerField(default=0)
    stats = models.JSONField(default=dict, blank=True)
    error_code = models.CharField(max_length=64, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.kind} #{self.pk} ({self.status})"

    @property
    def is_active(self) -> bool:
        return self.status in {self.Status.PENDING, self.Status.RUNNING}

    def fail_if_stale(self) -> None:
        if (
            self.is_active
            and (timezone.now() - self.updated_at).total_seconds() > self.STALE_AFTER_SECONDS
        ):
            self.status = self.Status.ERROR
            self.error_code = "stale"
            self.error_message = "A importação foi interrompida. Tente sincronizar novamente."
            self.finished_at = timezone.now()
            self.save(update_fields=["status", "error_code", "error_message", "finished_at"])
