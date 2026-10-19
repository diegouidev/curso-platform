from django.urls import path

from .views import CourseDetailView, CourseImportView, CourseListView, CourseSyncView, ImportJobView

urlpatterns = [
    path("courses", CourseListView.as_view(), name="course-list"),
    path("courses/import", CourseImportView.as_view(), name="course-import"),
    path("courses/<int:pk>", CourseDetailView.as_view(), name="course-detail"),
    path("courses/<int:pk>/sync", CourseSyncView.as_view(), name="course-sync"),
    path("import-jobs/<int:pk>", ImportJobView.as_view(), name="import-job-detail"),
]
