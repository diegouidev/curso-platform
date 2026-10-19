from django.shortcuts import get_object_or_404
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    inline_serializer,
)
from rest_framework import serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.drive.client import drive_client

from . import jobs
from . import progress as study
from .models import Course, ImportJob, Lesson, Note, StudyPreferences
from .naming import make_title
from .queries import course_detail_queryset, course_list_queryset, lesson_detail_queryset
from .scanner import get_root_folder
from .search import search
from .serializers import (
    ContinueSerializer,
    CourseDetailSerializer,
    CourseImportResponseSerializer,
    CourseImportSerializer,
    CourseSerializer,
    CourseUpdateSerializer,
    HeartbeatSerializer,
    ImportJobSerializer,
    LessonDetailSerializer,
    LessonProgressSerializer,
    NoteSerializer,
    SearchResultsSerializer,
    StudyPreferencesSerializer,
    StudyStatsSerializer,
)
from .stats import study_stats

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
        return Response(CourseSerializer(course_list_queryset(), many=True).data)


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


class LessonNoteView(APIView):
    @extend_schema(responses=NoteSerializer, tags=["notes"])
    def get(self, request: Request, pk: int) -> Response:
        lesson = get_object_or_404(Lesson, pk=pk)
        note = Note.objects.filter(lesson=lesson).first()
        data = {"content": note.content, "updated_at": note.updated_at} if note else None
        return Response(NoteSerializer(data or {"content": "", "updated_at": None}).data)

    @extend_schema(request=NoteSerializer, responses=NoteSerializer, tags=["notes"])
    def put(self, request: Request, pk: int) -> Response:
        lesson = get_object_or_404(Lesson, pk=pk)
        payload = NoteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        note, _ = Note.objects.update_or_create(
            lesson=lesson, defaults={"content": payload.validated_data["content"]}
        )
        return Response(NoteSerializer(note).data)


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
