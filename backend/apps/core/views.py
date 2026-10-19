from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = ()

    @extend_schema(
        responses=inline_serializer("Health", {"status": serializers.CharField()}),
        tags=["core"],
    )
    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})
