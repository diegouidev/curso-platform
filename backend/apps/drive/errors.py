from rest_framework import status

from apps.core.exceptions import AppError


class GoogleError(AppError):
    pass


class GoogleNotConfigured(GoogleError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "google_not_configured"
    message = (
        "A integração com o Google não está configurada no servidor "
        "(GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Veja docs/google-oauth.md."
    )


# 409 (not 401) on purpose: 401 is reserved for the app's own JWT session.
class GoogleNotConnected(GoogleError):
    status_code = status.HTTP_409_CONFLICT
    code = "google_not_connected"
    message = "Conecte sua conta Google antes de continuar."


class GoogleReconnectRequired(GoogleError):
    status_code = status.HTTP_409_CONFLICT
    code = "google_reconnect_required"
    message = "A conexão com o Google expirou ou foi revogada. Reconecte sua conta."


class DriveError(GoogleError):
    status_code = status.HTTP_502_BAD_GATEWAY
    code = "drive_error"
    message = "Não foi possível falar com o Google Drive. Tente novamente."


class DriveNotFound(DriveError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "drive_not_found"
    message = "Pasta não encontrada. Confira o link e se a conta Google conectada tem acesso a ela."


class DriveAccessDenied(DriveError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "drive_access_denied"
    message = "A conta Google conectada não tem permissão para ler esta pasta."


class DriveRateLimited(DriveError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "drive_rate_limited"
    message = "O Google Drive está limitando as requisições. Tente de novo em alguns minutos."


class DriveApiDisabled(DriveError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "drive_api_disabled"
    message = (
        "A Google Drive API não está ativada no projeto do Google Cloud. "
        "Ative-a (docs/google-oauth.md, passo 2) e tente de novo."
    )
