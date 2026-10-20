from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.views import HealthView, MediaView

urlpatterns = [
    path("api/health", HealthView.as_view(), name="health"),
    path("api/media/<path:path>", MediaView.as_view(), name="media"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/google/", include("apps.drive.urls")),
    path("api/", include("apps.courses.urls")),
]

if settings.DEBUG:
    urlpatterns += [
        path("api/schema", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
    ]

if settings.ADMIN_ENABLED:
    urlpatterns.append(path("admin/", admin.site.urls))

# Only in the Playwright stack (config.e2e_settings); production never installs apps.e2e.
if "apps.e2e" in settings.INSTALLED_APPS:
    urlpatterns.append(path("api/e2e/", include("apps.e2e.urls")))
