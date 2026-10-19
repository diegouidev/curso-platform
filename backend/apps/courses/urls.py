from django.urls import path

from .views import (
    ContinueView,
    CourseDetailView,
    CourseImportView,
    CourseListView,
    CourseSyncView,
    ImportJobView,
    LessonCompleteView,
    LessonDetailView,
    LessonHeartbeatView,
    LessonNoteView,
    SearchView,
    StatsView,
    StudyPreferencesView,
)

urlpatterns = [
    path("courses", CourseListView.as_view(), name="course-list"),
    path("courses/import", CourseImportView.as_view(), name="course-import"),
    path("courses/<int:pk>", CourseDetailView.as_view(), name="course-detail"),
    path("courses/<int:pk>/sync", CourseSyncView.as_view(), name="course-sync"),
    path("import-jobs/<int:pk>", ImportJobView.as_view(), name="import-job-detail"),
    path("lessons/<int:pk>", LessonDetailView.as_view(), name="lesson-detail"),
    path("lessons/<int:pk>/complete", LessonCompleteView.as_view(), name="lesson-complete"),
    path("lessons/<int:pk>/heartbeat", LessonHeartbeatView.as_view(), name="lesson-heartbeat"),
    path("lessons/<int:pk>/note", LessonNoteView.as_view(), name="lesson-note"),
    path("continue", ContinueView.as_view(), name="continue"),
    path("search", SearchView.as_view(), name="search"),
    path("stats", StatsView.as_view(), name="stats"),
    path("preferences", StudyPreferencesView.as_view(), name="preferences"),
]
