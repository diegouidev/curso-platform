"""Domain errors with a user-facing (pt-BR) message and a stable machine code.

Raised from services/jobs and translated into `{"detail", "code"}` responses by
`exception_handler`, so the same error can be shown in the API and stored on a job.
"""

from typing import Any

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler


class AppError(Exception):
    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "error"
    message: str = "Algo deu errado."

    def __init__(self, message: str | None = None, *, code: str | None = None) -> None:
        self.message = message or self.message
        self.code = code or self.code
        super().__init__(self.message)


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    if isinstance(exc, AppError):
        return Response({"detail": exc.message, "code": exc.code}, status=exc.status_code)
    return drf_exception_handler(exc, context)
