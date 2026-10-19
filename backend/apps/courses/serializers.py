from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Attachment, Course, ImportJob, Lesson, Module
from .naming import extract_folder_id, make_title

DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/{}"
DRIVE_FILE_VIEW_URL = "https://drive.google.com/file/d/{}/view"


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


class ImportJobSerializer(serializers.ModelSerializer):
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


class AttachmentSerializer(serializers.ModelSerializer):
    view_url = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = ["id", "title", "drive_file_id", "mime_type", "view_url"]
        read_only_fields = fields

    def get_view_url(self, obj: Attachment) -> str:
        return DRIVE_FILE_VIEW_URL.format(obj.drive_file_id)


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
