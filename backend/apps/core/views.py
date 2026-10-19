from django.conf import settings
from django.http import FileResponse
from django.views.static import serve
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.accounts.authentication import RefreshCookieAuthentication


class HealthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = ()

    @extend_schema(
        responses=inline_serializer("Health", {"status": serializers.CharField()}),
        tags=["core"],
    )
    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})


class MediaView(APIView):
    """Uploaded files (course covers). `<img>` tags can't send the in-memory access token,
    so the httpOnly refresh cookie also authenticates here. Read-only; `serve` rejects
    paths outside MEDIA_ROOT. File names are unique per upload, hence the long cache."""

    authentication_classes = (JWTAuthentication, RefreshCookieAuthentication)

    @extend_schema(exclude=True)
    def get(self, request: Request, path: str) -> FileResponse:
        response = serve(request, path, document_root=settings.MEDIA_ROOT)
        response["Cache-Control"] = "private, max-age=31536000, immutable"
        return response
