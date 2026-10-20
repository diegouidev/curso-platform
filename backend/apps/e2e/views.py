from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.courses.models import Lesson

from .drive import COURSE_FOLDER_ID, COURSE_LINK
from .seed import PASSWORD, USERNAME, reset


class ResetView(APIView):
    """POST /api/e2e/reset[?course=1]: fresh state for one Playwright test.

    Unauthenticated on purpose: it only exists in the throwaway E2E stack."""

    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request: Request) -> Response:
        course = reset(with_course=request.query_params.get("course") == "1")
        lessons = Lesson.objects.filter(module__course=course) if course else Lesson.objects.none()
        return Response(
            {
                "username": USERNAME,
                "password": PASSWORD,
                "course_id": course.pk if course else None,
                "course_folder_id": COURSE_FOLDER_ID,
                "course_link": COURSE_LINK,
                "lessons": {lesson.title: lesson.pk for lesson in lessons},
            }
        )
