from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.drive.client import drive_client

from . import jobs
from .models import Course, ImportJob
from .naming import make_title
from .queries import course_detail_queryset, course_list_queryset
from .scanner import get_root_folder
from .serializers import (
    CourseDetailSerializer,
    CourseImportResponseSerializer,
    CourseImportSerializer,
    CourseSerializer,
    CourseUpdateSerializer,
    ImportJobSerializer,
)

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
