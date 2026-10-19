from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from . import progress as study
from .models import Attachment, Course, ImportJob, Lesson, LessonProgress, Module, StudyPreferences
from .naming import extract_folder_id, make_title

DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/{}"
DRIVE_FILE_VIEW_URL = "https://drive.google.com/file/d/{}/view"
# Official Drive embed. Plays because the browser is signed in to the account with access.
DRIVE_FILE_PREVIEW_URL = "https://drive.google.com/file/d/{}/preview"
# Native Google files preview on docs.google.com; everything else on the Drive viewer.
NATIVE_PREVIEW_URLS = {
    "application/vnd.google-apps.document": "https://docs.google.com/document/d/{}/preview",
    "application/vnd.google-apps.presentation": "https://docs.google.com/presentation/d/{}/preview",
    "application/vnd.google-apps.spreadsheet": "https://docs.google.com/spreadsheets/d/{}/preview",
}


class ProgressSerializer(serializers.Serializer):
    lessons_total = serializers.IntegerField()
    lessons_completed = serializers.IntegerField()
    percent = serializers.IntegerField(help_text="0-100, rounded down.")
    duration_total_seconds = serializers.IntegerField()
    duration_remaining_seconds = serializers.IntegerField()
    has_durations = serializers.BooleanField(
        help_text="True when at least one counted lesson has a known duration."
    )


def progress_data(
    *, total: int, completed: int, duration_total: int, duration_completed: int, with_duration: int
) -> dict:
    return {
        "lessons_total": total,
        "lessons_completed": completed,
        "percent": (completed * 100 // total) if total else 0,
        "duration_total_seconds": duration_total,
        "duration_remaining_seconds": max(duration_total - duration_completed, 0),
        "has_durations": with_duration > 0,
    }


class ImportStatsSerializer(serializers.Serializer):
    modules_created = serializers.IntegerField()
    modules_missing = serializers.IntegerField()
    lessons_created = serializers.IntegerField()
    lessons_updated = serializers.IntegerField()
    lessons_missing = serializers.IntegerField()
    lessons_restored = serializers.IntegerField()
    attachments = serializers.IntegerField()
    warnings = serializers.ListField(child=serializers.CharField())


class ImportJobSerializer(serializers.ModelSerializer):
    stats = serializers.SerializerMethodField(help_text="Only set once the job succeeded.")

    class Meta:
        model = ImportJob
        fields = [
            "id",
            "course",
            "kind",
            "status",
            "folders_scanned",
            "files_found",
            "stats",
            "error_code",
            "error_message",
            "created_at",
            "updated_at",
            "finished_at",
        ]
        read_only_fields = fields

    @extend_schema_field(ImportStatsSerializer(allow_null=True))
    def get_stats(self, obj: ImportJob) -> dict | None:
        return obj.stats or None


class AttachmentSerializer(serializers.ModelSerializer):
    view_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField(help_text="Embeddable preview (iframe).")

    class Meta:
        model = Attachment
        fields = ["id", "title", "drive_file_id", "mime_type", "view_url", "preview_url"]
        read_only_fields = fields

    def get_view_url(self, obj: Attachment) -> str:
        return DRIVE_FILE_VIEW_URL.format(obj.drive_file_id)

    def get_preview_url(self, obj: Attachment) -> str:
        template = NATIVE_PREVIEW_URLS.get(obj.mime_type, DRIVE_FILE_PREVIEW_URL)
        return template.format(obj.drive_file_id)


class LessonSummarySerializer(serializers.ModelSerializer):
    completed = serializers.BooleanField(read_only=True)
    has_note = serializers.BooleanField(read_only=True)
    attachments = AttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = Lesson
        fields = [
            "id",
            "title",
            "title_is_custom",
            "drive_file_id",
            "drive_name_original",
            "duration_seconds",
            "order",
            "is_hidden",
            "missing_in_drive",
            "completed",
            "has_note",
            "attachments",
        ]
        read_only_fields = fields


class ModuleSerializer(serializers.ModelSerializer):
    lessons = LessonSummarySerializer(many=True, read_only=True)
    attachments = AttachmentSerializer(many=True, read_only=True)
    progress = serializers.SerializerMethodField()

    class Meta:
        model = Module
        fields = [
            "id",
            "title",
            "title_is_custom",
            "drive_folder_id",
            "order",
            "is_hidden",
            "missing_in_drive",
            "progress",
            "lessons",
            "attachments",
        ]
        read_only_fields = fields

    @extend_schema_field(ProgressSerializer)
    def get_progress(self, obj: Module) -> dict:
        counted = [x for x in obj.lessons.all() if not x.is_hidden and not x.missing_in_drive]
        done = [x for x in counted if x.completed]
        return progress_data(
            total=len(counted),
            completed=len(done),
            duration_total=sum(x.duration_seconds or 0 for x in counted),
            duration_completed=sum(x.duration_seconds or 0 for x in done),
            with_duration=sum(1 for x in counted if x.duration_seconds is not None),
        )


class CourseSerializer(serializers.ModelSerializer):
    progress = serializers.SerializerMethodField()
    latest_job = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()
    drive_url = serializers.SerializerMethodField()

    class Meta:
        model = Course
        fields = [
            "id",
            "title",
            "title_is_custom",
            "description",
            "drive_folder_id",
            "drive_name_original",
            "drive_url",
            "thumbnail_url",
            "is_archived",
            "clean_titles",
            "last_imported_at",
            "created_at",
            "progress",
            "latest_job",
        ]
        read_only_fields = fields

    @extend_schema_field(ProgressSerializer)
    def get_progress(self, obj: Course) -> dict:
        return progress_data(
            total=obj.lessons_total,
            completed=obj.lessons_completed,
            duration_total=obj.duration_total,
            duration_completed=obj.duration_completed,
            with_duration=obj.lessons_with_duration,
        )

    @extend_schema_field(ImportJobSerializer(allow_null=True))
    def get_latest_job(self, obj: Course) -> dict | None:
        jobs = getattr(obj, "latest_jobs", None)
        if jobs is None:
            jobs = list(obj.import_jobs.order_by("-created_at")[:1])
        if not jobs:
            return None
        jobs[0].fail_if_stale()
        return ImportJobSerializer(jobs[0]).data

    def get_thumbnail_url(self, obj: Course) -> str | None:
        return obj.thumbnail.url if obj.thumbnail else None

    def get_drive_url(self, obj: Course) -> str:
        return DRIVE_FOLDER_URL.format(obj.drive_folder_id)


class CourseDetailSerializer(CourseSerializer):
    modules = ModuleSerializer(many=True, read_only=True)

    class Meta(CourseSerializer.Meta):
        fields = [*CourseSerializer.Meta.fields, "modules"]
        read_only_fields = fields


class CourseUpdateSerializer(serializers.ModelSerializer):
    title = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=255,
        help_text="Empty string restores the title from the Drive folder name.",
    )

    class Meta:
        model = Course
        fields = ["title", "description", "is_archived", "clean_titles"]

    def update(self, instance: Course, validated_data: dict) -> Course:
        if "title" in validated_data:
            title = validated_data.pop("title").strip()
            if title:
                instance.title, instance.title_is_custom = title, True
            else:
                instance.title = make_title(
                    instance.drive_name_original or instance.title,
                    is_file=False,
                    clean=validated_data.get("clean_titles", instance.clean_titles),
                )
                instance.title_is_custom = False
        return super().update(instance, validated_data)


class CourseImportSerializer(serializers.Serializer):
    folder = serializers.CharField(
        help_text="Drive folder link (…/drive/folders/<id>, …?id=<id>) or bare folder id."
    )
    clean_titles = serializers.BooleanField(default=True)

    def validate_folder(self, value: str) -> str:
        folder_id = extract_folder_id(value)
        if not folder_id:
            raise serializers.ValidationError(
                "Link inválido. Cole o link de uma pasta do Google Drive "
                "(drive.google.com/drive/folders/…) ou o ID da pasta."
            )
        return folder_id


class CourseImportResponseSerializer(serializers.Serializer):
    course = CourseSerializer()
    job = ImportJobSerializer()


# --- Player and progress (phase 4) -------------------------------------------------------


class LessonProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = LessonProgress
        fields = ["completed", "completed_at", "last_opened_at", "time_on_page_seconds"]
        read_only_fields = fields


class RefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()


class LessonRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    module_title = serializers.CharField(source="module.title")


class LessonDetailSerializer(serializers.ModelSerializer):
    """A lesson for the player. Expects `neighbors` (progress.Neighbors) in the context."""

    embed_url = serializers.SerializerMethodField()
    drive_url = serializers.SerializerMethodField()
    course = RefSerializer(source="module.course", read_only=True)
    module = RefSerializer(read_only=True)
    progress = serializers.SerializerMethodField()
    attachments = AttachmentSerializer(many=True, read_only=True)
    module_attachments = AttachmentSerializer(
        source="module.attachments", many=True, read_only=True
    )
    previous = serializers.SerializerMethodField()
    next = serializers.SerializerMethodField()
    position = serializers.SerializerMethodField(
        help_text="1-based position among the playable lessons; null for hidden/missing ones."
    )
    total = serializers.SerializerMethodField(help_text="Playable lessons in the course.")

    class Meta:
        model = Lesson
        fields = [
            "id",
            "title",
            "title_is_custom",
            "drive_file_id",
            "drive_name_original",
            "mime_type",
            "duration_seconds",
            "is_hidden",
            "missing_in_drive",
            "embed_url",
            "drive_url",
            "course",
            "module",
            "progress",
            "attachments",
            "module_attachments",
            "previous",
            "next",
            "position",
            "total",
        ]
        read_only_fields = fields

    @property
    def _neighbors(self) -> study.Neighbors:
        return self.context["neighbors"]

    def get_embed_url(self, obj: Lesson) -> str:
        return DRIVE_FILE_PREVIEW_URL.format(obj.drive_file_id)

    def get_drive_url(self, obj: Lesson) -> str:
        return DRIVE_FILE_VIEW_URL.format(obj.drive_file_id)

    @extend_schema_field(LessonProgressSerializer)
    def get_progress(self, obj: Lesson) -> dict:
        return LessonProgressSerializer(study.get_progress(obj)).data

    @extend_schema_field(LessonRefSerializer(allow_null=True))
    def get_previous(self, obj: Lesson) -> dict | None:
        lesson = self._neighbors.previous
        return LessonRefSerializer(lesson).data if lesson else None

    @extend_schema_field(LessonRefSerializer(allow_null=True))
    def get_next(self, obj: Lesson) -> dict | None:
        lesson = self._neighbors.next
        return LessonRefSerializer(lesson).data if lesson else None

    @extend_schema_field(serializers.IntegerField(allow_null=True))
    def get_position(self, obj: Lesson) -> int | None:
        return self._neighbors.position

    def get_total(self, obj: Lesson) -> int:
        return self._neighbors.total


class HeartbeatSerializer(serializers.Serializer):
    seconds = serializers.IntegerField(
        min_value=0,
        help_text=(
            "Seconds with the tab visible since the last heartbeat; 0 when the page opens. "
            f"Capped at {study.MAX_HEARTBEAT_SECONDS}."
        ),
    )


class CourseRefSerializer(serializers.ModelSerializer):
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = Course
        fields = ["id", "title", "thumbnail_url"]
        read_only_fields = fields

    def get_thumbnail_url(self, obj: Course) -> str | None:
        return obj.thumbnail.url if obj.thumbnail else None


class ContinueLessonSerializer(serializers.ModelSerializer):
    course = CourseRefSerializer(source="module.course", read_only=True)
    module = RefSerializer(read_only=True)
    progress = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = ["id", "title", "duration_seconds", "course", "module", "progress"]
        read_only_fields = fields

    @extend_schema_field(LessonProgressSerializer)
    def get_progress(self, obj: Lesson) -> dict:
        return LessonProgressSerializer(study.get_progress(obj)).data


class ContinueSerializer(serializers.Serializer):
    lesson = ContinueLessonSerializer(allow_null=True, help_text="Null when everything is done.")
    reason = serializers.ChoiceField(
        choices=[
            ("resume", "Aula aberta e não concluída"),
            ("next", "Próxima aula depois da última concluída"),
            ("start", "Primeira aula, nada aberto ainda"),
        ],
        allow_null=True,
    )


class StudyPreferencesSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudyPreferences
        fields = ["suggest_completion", "suggest_completion_percent"]
