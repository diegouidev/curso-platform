from django.urls import path

from .views import GoogleCallbackView, GoogleConnectView, GoogleDisconnectView, GoogleStatusView

urlpatterns = [
    path("status", GoogleStatusView.as_view(), name="google-status"),
    path("connect", GoogleConnectView.as_view(), name="google-connect"),
    path("callback", GoogleCallbackView.as_view(), name="google-callback"),
    path("disconnect", GoogleDisconnectView.as_view(), name="google-disconnect"),
]
