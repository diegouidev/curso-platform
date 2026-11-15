import json
from uuid import uuid4

from django.db.models import Exists, OuterRef, Prefetch, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    inline_serializer,
)
from rest_framework import serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.drive.client import drive_client

from . import backup, cards, jobs, organize, planning, reminders
from . import progress as study
from .models import (
    Course,
    ImportJob,
    Lesson,
    LessonProgress,
    Module,
    Note,
    ReviewCard,
    StudyPreferences,
)
from .naming import make_title
from .queries import (
    course_detail_queryset,
    course_list_queryset,
    lesson_detail_queryset,
    lessons_queryset,
)
from .scanner import get_root_folder
from .search import search
from .serializers import (
    DRIVE_FILE_VIEW_URL,
    THUMBNAIL_FORMATS,
    BackupSerializer,
    BackupUploadSerializer,
    ContinueSerializer,
    CourseDetailSerializer,
    CourseImportResponseSerializer,
    CourseImportSerializer,
    CourseRecapSerializer,
    CourseSerializer,
    CourseUpdateSerializer,
    HeartbeatSerializer,
    ImportJobSerializer,
    ItemUpdateSerializer,
    LessonDetailSerializer,
    LessonMarksSerializer,
    LessonProgressSerializer,
    LessonSummarySerializer,
    MarkedLessonSerializer,
    ModuleSerializer,
    NotebookSerializer,
    NoteSerializer,
    ReminderTestSerializer,
    ReorderSerializer,
    RestoreStatsSerializer,
    ReviewAnswerSerializer,
    ReviewCardSerializer,
    ReviewSessionSerializer,
    SearchResultsSerializer,
    StudyCalendarSerializer,
    StudyPreferencesSerializer,
    StudyStatsSerializer,
    ThumbnailUploadSerializer,
)
from .stats import day_start, study_calendar, study_stats

CourseExists = inline_serializer(
    "CourseExists",
    {
        "detail": serializers.CharField(),
        "code": serializers.CharField(),
        "course_id": serializers.IntegerField(),
    },
)


class CourseListView(APIView):
    @extend_schema(responses=CourseSerializer(many=True), tags=["courses"])
    def get(self, request: Request) -> Response:
        courses = list(course_list_queryset())
        context = {"plans": planning.plans_for(courses)}
        return Response(CourseSerializer(courses, many=True, context=context).data)


class CourseImportView(APIView):
    @extend_schema(
        request=CourseImportSerializer,
        responses={
            202: CourseImportResponseSerializer,
            409: OpenApiResponse(CourseExists, description="Folder already imported."),
        },
        tags=["courses"],
    )
    def post(self, request: Request) -> Response:
        payload = CourseImportSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        folder_id = payload.validated_data["folder"]  # already reduced to the id
        clean = payload.validated_data["clean_titles"]

        # Fail fast (bad link, no access, not a folder) before creating anything.
        with drive_client() as (_, client):
            root = get_root_folder(client, folder_id)

        existing = Course.objects.filter(drive_folder_id=root.id).first()
        if existing:
            return Response(
                {
                    "detail": "Esta pasta já foi importada.",
                    "code": "course_exists",
                    "course_id": existing.pk,
                },
                status=status.HTTP_409_CONFLICT,
            )

        course = Course.objects.create(
            drive_folder_id=root.id,
            drive_name_original=root.name,
            title=make_title(root.name, is_file=False, clean=clean),
            clean_titles=clean,
        )
        job = jobs.create_job(course, ImportJob.Kind.IMPORT)
        jobs.start_job(job)
        job.refresh_from_db()

        course = course_list_queryset().get(pk=course.pk)
        return Response(
            {"course": CourseSerializer(course).data, "job": ImportJobSerializer(job).data},
            status=status.HTTP_202_ACCEPTED,
        )


class CourseDetailView(APIView):
    @extend_schema(responses=CourseDetailSerializer, tags=["courses"])
    def get(self, request: Request, pk: int) -> Response:
        course = get_object_or_404(course_detail_queryset(), pk=pk)
        return Response(CourseDetailSerializer(course).data)

    @extend_schema(
        request=CourseUpdateSerializer, responses=CourseDetailSerializer, tags=["courses"]
    )
    def patch(self, request: Request, pk: int) -> Response:
        course = get_object_or_404(Course, pk=pk)
        serializer = CourseUpdateSerializer(course, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(CourseDetailSerializer(course_detail_queryset().get(pk=pk)).data)


class CourseSyncView(APIView):
    @extend_schema(request=None, responses={202: ImportJobSerializer}, tags=["courses"])
    def post(self, request: Request, pk: int) -> Response:
        course = get_object_or_404(Course, pk=pk)
        job = jobs.create_job(course, ImportJob.Kind.SYNC)
        jobs.start_job(job)
        job.refresh_from_db()
        return Response(ImportJobSerializer(job).data, status=status.HTTP_202_ACCEPTED)


class ImportJobView(APIView):
    @extend_schema(responses=ImportJobSerializer, tags=["courses"])
    def get(self, request: Request, pk: int) -> Response:
        job = get_object_or_404(ImportJob, pk=pk)
        job.fail_if_stale()
        return Response(ImportJobSerializer(job).data)


# --- Player and progress (phase 4) -------------------------------------------------------


class LessonDetailView(APIView):
    @extend_schema(responses=LessonDetailSerializer, tags=["lessons"])
    def get(self, request: Request, pk: int) -> Response:
        # Read-only on purpose: "opened" is recorded by the first heartbeat, so prefetching
        # the next lesson doesn't count as opening it.
        lesson = get_object_or_404(lesson_detail_queryset(), pk=pk)
        serializer = LessonDetailSerializer(lesson, context={"neighbors": study.neighbors(lesson)})
        return Response(serializer.data)


class LessonCompleteView(APIView):
    @extend_schema(request=None, responses=LessonProgressSerializer, tags=["lessons"])
    def post(self, request: Request, pk: int) -> Response:
        lesson = get_object_or_404(Lesson, pk=pk)
        return Response(LessonProgressSerializer(study.set_completed(lesson, True)).data)

    @extend_schema(request=None, responses=LessonProgressSerializer, tags=["lessons"])
    def delete(self, request: Request, pk: int) -> Response:
        lesson = get_object_or_404(Lesson, pk=pk)
        return Response(LessonProgressSerializer(study.set_completed(lesson, False)).data)


class LessonHeartbeatView(APIView):
    @extend_schema(
        request=HeartbeatSerializer, responses=LessonProgressSerializer, tags=["lessons"]
    )
    def post(self, request: Request, pk: int) -> Response:
        lesson = get_object_or_404(Lesson, pk=pk)
        payload = HeartbeatSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        progress = study.record_heartbeat(lesson, payload.validated_data["seconds"])
        return Response(LessonProgressSerializer(progress).data)


class ContinueView(APIView):
    @extend_schema(
        parameters=[
            OpenApiParameter("course", int, description="Only this course (archived or not).")
        ],
        responses=ContinueSerializer,
        tags=["lessons"],
    )
    def get(self, request: Request) -> Response:
        course_id = request.query_params.get("course")
        if course_id is not None and not course_id.isdigit():
            return Response(
                {"detail": "Parâmetro course inválido.", "code": "invalid"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        found = study.continue_lesson(int(course_id) if course_id else None)
        lesson, reason = found if found else (None, None)
        return Response(ContinueSerializer({"lesson": lesson, "reason": reason}).data)


class StudyPreferencesView(APIView):
    @extend_schema(responses=StudyPreferencesSerializer, tags=["preferences"])
    def get(self, request: Request) -> Response:
        return Response(StudyPreferencesSerializer(StudyPreferences.load()).data)

    @extend_schema(
        request=StudyPreferencesSerializer,
        responses=StudyPreferencesSerializer,
        tags=["preferences"],
    )
    def patch(self, request: Request) -> Response:
        serializer = StudyPreferencesSerializer(
            StudyPreferences.load(), data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


# --- Notes, search and stats (phase 5) -----------------------------------------------------


def _note_data(lesson: Lesson, note: Note | None) -> dict:
    return {
        "content": note.content if note else "",
        "updated_at": note.updated_at if note else None,
        "cards": ReviewCard.objects.filter(lesson=lesson).count(),
    }


class LessonNoteView(APIView):
    @extend_schema(responses=NoteSerializer, tags=["notes"])
    def get(self, request: Request, pk: int) -> Response:
        lesson = get_object_or_404(Lesson, pk=pk)
        note = Note.objects.filter(lesson=lesson).first()
        return Response(NoteSerializer(_note_data(lesson, note)).data)

    @extend_schema(request=NoteSerializer, responses=NoteSerializer, tags=["notes"])
    def put(self, request: Request, pk: int) -> Response:
        lesson = get_object_or_404(Lesson, pk=pk)
        payload = NoteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        content = payload.validated_data["content"]
        note, _ = Note.objects.update_or_create(lesson=lesson, defaults={"content": content})
        cards.sync_cards(lesson, content)
        return Response(NoteSerializer(_note_data(lesson, note)).data)


class SearchView(APIView):
    @extend_schema(
        parameters=[OpenApiParameter("q", str, description="At least 2 characters.")],
        responses=SearchResultsSerializer,
        tags=["search"],
    )
    def get(self, request: Request) -> Response:
        results = search(request.query_params.get("q", ""))
        return Response(SearchResultsSerializer(results).data)


class StatsView(APIView):
    @extend_schema(responses=StudyStatsSerializer, tags=["stats"])
    def get(self, request: Request) -> Response:
        return Response(StudyStatsSerializer(study_stats()).data)


class StudyCalendarView(APIView):
    @extend_schema(responses=StudyCalendarSerializer, tags=["stats"])
    def get(self, request: Request) -> Response:
        return Response(StudyCalendarSerializer(study_calendar()).data)


# --- Organization and backup (phase 6) ----------------------------------------------------


def _course_detail(pk: int) -> Response:
    return Response(CourseDetailSerializer(course_detail_queryset().get(pk=pk)).data)


def _apply_item_update(item: Module | Lesson, data: dict) -> None:
    if "title" in data:
        organize.set_title(item, data["title"])
    if "is_hidden" in data:
        item.is_hidden = data["is_hidden"]
    item.save(update_fields=["title", "title_is_custom", "is_hidden"])


class ModuleUpdateView(APIView):
    @extend_schema(request=ItemUpdateSerializer, responses=ModuleSerializer, tags=["organize"])
    def patch(self, request: Request, pk: int) -> Response:
        module = get_object_or_404(Module.objects.select_related("course"), pk=pk)
        payload = ItemUpdateSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        _apply_item_update(module, payload.validated_data)
        module = Module.objects.prefetch_related(
            Prefetch("lessons", queryset=lessons_queryset()), "attachments"
        ).get(pk=pk)
        return Response(ModuleSerializer(module).data)


class LessonUpdateView(LessonDetailView):
    """GET (player data) comes from LessonDetailView; PATCH edits title/visibility."""

    @extend_schema(
        request=ItemUpdateSerializer, responses=LessonSummarySerializer, tags=["organize"]
    )
    def patch(self, request: Request, pk: int) -> Response:
        lesson = get_object_or_404(Lesson.objects.select_related("module__course"), pk=pk)
        payload = ItemUpdateSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        _apply_item_update(lesson, payload.validated_data)
        return Response(LessonSummarySerializer(lessons_queryset().get(pk=pk)).data)


class ReorderView(APIView):
    @extend_schema(request=ReorderSerializer, responses={204: None}, tags=["organize"])
    def post(self, request: Request) -> Response:
        payload = ReorderSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        parent = Course if data["kind"] == "modules" else Module
        get_object_or_404(parent, pk=data["parent_id"])
        organize.reorder(data["kind"], data["parent_id"], data["ids"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class CourseResetOrderView(APIView):
    @extend_schema(request=None, responses=CourseDetailSerializer, tags=["organize"])
    def post(self, request: Request, pk: int) -> Response:
        organize.reset_order(get_object_or_404(Course, pk=pk))
        return _course_detail(pk)


class CourseThumbnailView(APIView):
    parser_classes = [MultiPartParser]

    @extend_schema(
        request={"multipart/form-data": ThumbnailUploadSerializer},
        responses=CourseDetailSerializer,
        tags=["courses"],
    )
    def put(self, request: Request, pk: int) -> Response:
        course = get_object_or_404(Course, pk=pk)
        payload = ThumbnailUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        image = payload.validated_data["file"]
        previous = course.thumbnail.name if course.thumbnail else None
        extension = THUMBNAIL_FORMATS[image.image.format]
        # A new name per upload, so the long browser cache never shows a stale cover.
        course.thumbnail.save(f"course-{course.pk}-{uuid4().hex[:12]}.{extension}", image)
        if previous:
            course.thumbnail.storage.delete(previous)
        return _course_detail(pk)

    # Explicit 200: DELETE defaults to 204 in the schema, but this returns the course.
    @extend_schema(request=None, responses={200: CourseDetailSerializer}, tags=["courses"])
    def delete(self, request: Request, pk: int) -> Response:
        course = get_object_or_404(Course, pk=pk)
        if course.thumbnail:
            course.thumbnail.delete(save=True)
        return _course_detail(pk)


class ExportView(APIView):
    @extend_schema(
        parameters=[
            # Not "format": DRF reserves ?format= for content negotiation.
            OpenApiParameter(
                "type",
                str,
                enum=["json", "md"],
                description="json: full backup (progress, notes, sessions). md: notes only.",
            ),
            OpenApiParameter("course", int, description="md only: notes of this course."),
        ],
        responses={200: OpenApiResponse(OpenApiTypes.BINARY, description="File download.")},
        tags=["backup"],
    )
    def get(self, request: Request) -> HttpResponse:
        kind = request.query_params.get("type", "json")
        stamp = timezone.localdate().isoformat()
        if kind == "md":
            course_id = request.query_params.get("course")
            if course_id is not None and not course_id.isdigit():
                return Response(
                    {"detail": "Parâmetro course inválido.", "code": "invalid"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            course = get_object_or_404(Course, pk=course_id) if course_id else None
            response = HttpResponse(
                backup.export_notes_markdown(course.pk if course else None),
                content_type="text/markdown; charset=utf-8",
            )
            filename = f"anotacoes-{f'curso-{course.pk}-' if course else ''}{stamp}.md"
        else:
            content = json.dumps(backup.export_data(), ensure_ascii=False, indent=2)
            response = HttpResponse(content, content_type="application/json; charset=utf-8")
            filename = f"backup-estudos-{stamp}.json"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class ImportBackupView(APIView):
    parser_classes = [MultiPartParser]
    MAX_BYTES = 20 * 1024 * 1024

    @extend_schema(
        request={"multipart/form-data": BackupUploadSerializer},
        responses=RestoreStatsSerializer,
        tags=["backup"],
    )
    def post(self, request: Request) -> Response:
        upload = BackupUploadSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        file = upload.validated_data["file"]
        if file.size > self.MAX_BYTES:
            return _invalid_backup("O arquivo tem mais de 20 MB.")
        try:
            raw = json.loads(file.read().decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return _invalid_backup("O arquivo não é um JSON válido.")
        payload = BackupSerializer(data=raw)
        if not payload.is_valid():
            return _invalid_backup(
                "Este arquivo não é um backup desta plataforma (ou está corrompido).",
                errors=payload.errors,
            )
        stats = backup.restore(payload.validated_data)
        return Response(RestoreStatsSerializer(stats.as_dict()).data)


def _invalid_backup(message: str, errors: object = None) -> Response:
    body: dict = {"detail": message, "code": "invalid_backup"}
    if errors:
        body["errors"] = errors
    return Response(body, status=status.HTTP_400_BAD_REQUEST)


# --- Planning, marks, review, reminders ----------------------------------------------------


class CourseMarkSeenView(APIView):
    """Dismisses the "new lessons" notice: lessons added so far stop being new."""

    @extend_schema(request=None, responses=CourseDetailSerializer, tags=["courses"])
    def post(self, request: Request, pk: int) -> Response:
        course = get_object_or_404(Course, pk=pk)
        course.new_lessons_seen_at = timezone.now()
        course.save(update_fields=["new_lessons_seen_at"])
        return _course_detail(pk)


class CourseRecapView(APIView):
    @extend_schema(responses=CourseRecapSerializer, tags=["courses"])
    def get(self, request: Request, pk: int) -> Response:
        course = get_object_or_404(Course, pk=pk)
        return Response(CourseRecapSerializer(planning.course_recap(course)).data)


class CourseNotebookView(APIView):
    """Every note of the course, in course order, to read (or print) in one page."""

    @extend_schema(responses=NotebookSerializer, tags=["notes"])
    def get(self, request: Request, pk: int) -> Response:
        course = get_object_or_404(Course, pk=pk)
        notes = (
            Note.objects.filter(lesson__module__course=course)
            .exclude(content="")
            .select_related("lesson__module", "lesson__progress")
            .order_by("lesson__module__order", "lesson__module__id", "lesson__order", "lesson__id")
        )
        modules: list[dict] = []
        for note in notes:
            lesson = note.lesson
            if not modules or modules[-1]["id"] != lesson.module_id:
                modules.append(
                    {"id": lesson.module_id, "title": lesson.module.title, "lessons": []}
                )
            modules[-1]["lessons"].append(
                {
                    "id": lesson.pk,
                    "title": lesson.title,
                    "section": lesson.section,
                    "drive_url": DRIVE_FILE_VIEW_URL.format(lesson.drive_file_id),
                    "completed": study.get_progress(lesson).completed,
                    "content": note.content,
                    "updated_at": note.updated_at,
                }
            )
        data = {
            "course": {"id": course.pk, "title": course.title},
            "notes": sum(len(module["lessons"]) for module in modules),
            "modules": modules,
        }
        return Response(NotebookSerializer(data).data)


class LessonMarksView(APIView):
    @extend_schema(
        request=LessonMarksSerializer, responses=LessonProgressSerializer, tags=["lessons"]
    )
    def patch(self, request: Request, pk: int) -> Response:
        lesson = get_object_or_404(Lesson, pk=pk)
        payload = LessonMarksSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        progress, _ = LessonProgress.objects.get_or_create(lesson=lesson)
        for name, value in payload.validated_data.items():
            setattr(progress, name, value)
        progress.save(update_fields=list(payload.validated_data) or None)
        return Response(LessonProgressSerializer(progress).data)


MARK_CHOICES = list(LessonProgress.MARKS)


class MarkedLessonsView(APIView):
    @extend_schema(
        parameters=[
            OpenApiParameter(
                "mark", str, enum=MARK_CHOICES, description="Only this mark (default: any)."
            )
        ],
        responses=MarkedLessonSerializer(many=True),
        tags=["lessons"],
    )
    def get(self, request: Request) -> Response:
        mark = request.query_params.get("mark")
        if mark is not None and mark not in MARK_CHOICES:
            return Response(
                {"detail": "Parâmetro mark inválido.", "code": "invalid"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        marks = [mark] if mark else MARK_CHOICES
        condition = Q()
        for name in marks:
            condition |= Q(**{f"progress__{name}": True})
        lessons = (
            Lesson.objects.filter(condition)
            .select_related("module__course", "progress")
            .annotate(
                has_note=Exists(Note.objects.filter(lesson=OuterRef("pk")).exclude(content=""))
            )
            .order_by(
                "module__course__is_archived",
                "-module__course__created_at",
                "module__order",
                "module__id",
                "order",
                "id",
            )
        )
        return Response(MarkedLessonSerializer(lessons, many=True).data)


class ReviewView(APIView):
    """Today's review session: the due cards, the most overdue first."""

    LIMIT = 200

    @extend_schema(
        parameters=[OpenApiParameter("course", int, description="Only cards of this course.")],
        responses=ReviewSessionSerializer,
        tags=["review"],
    )
    def get(self, request: Request) -> Response:
        course_id = request.query_params.get("course")
        if course_id is not None and not course_id.isdigit():
            return Response(
                {"detail": "Parâmetro course inválido.", "code": "invalid"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        today = timezone.localdate()
        everything = ReviewCard.objects.all()
        if course_id:
            everything = everything.filter(lesson__module__course_id=int(course_id))
        due = everything.filter(due_on__lte=today)
        upcoming = everything.filter(due_on__gt=today).order_by("due_on").first()
        cards_due = due.select_related("lesson__module__course").order_by(
            "due_on", "lesson__module__course_id", "lesson_id", "position", "id"
        )[: self.LIMIT]
        data = {
            "due": due.count(),
            "new": due.filter(last_reviewed_at__isnull=True).count(),
            "total": everything.count(),
            "reviewed_today": everything.filter(last_reviewed_at__gte=day_start(today)).count(),
            "next_due_on": upcoming.due_on if upcoming else None,
            "cards": list(cards_due),
        }
        return Response(ReviewSessionSerializer(data).data)


class ReviewCardView(APIView):
    @extend_schema(request=ReviewAnswerSerializer, responses=ReviewCardSerializer, tags=["review"])
    def post(self, request: Request, pk: int) -> Response:
        card = get_object_or_404(ReviewCard.objects.select_related("lesson__module__course"), pk=pk)
        payload = ReviewAnswerSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        cards.review(card, payload.validated_data["rating"])
        return Response(ReviewCardSerializer(card).data)


class ReminderTestView(APIView):
    @extend_schema(
        request=None,
        responses={200: ReminderTestSerializer, 400: OpenApiResponse(description="No channel.")},
        tags=["preferences"],
    )
    def post(self, request: Request) -> Response:
        if not reminders.configured_channels():
            return Response(
                {
                    "detail": "Nenhum canal configurado no servidor (Telegram ou e-mail).",
                    "code": "no_reminder_channel",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        subject, text = reminders.reminder_message()
        result = reminders.send(f"{subject} (teste)", text)
        return Response(ReminderTestSerializer(result.__dict__).data)
