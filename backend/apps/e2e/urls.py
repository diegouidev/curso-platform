from django.urls import path

from .views import ResetView

urlpatterns = [
    path("reset", ResetView.as_view(), name="e2e-reset"),
]
