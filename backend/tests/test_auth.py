import pytest
from django.conf import settings
from django.contrib.auth import get_user_model

from conftest import PASSWORD

COOKIE = settings.AUTH_COOKIE_NAME

pytestmark = pytest.mark.django_db


def login(client, username="diego", password=PASSWORD):
    return client.post(
        "/api/auth/login", {"username": username, "password": password}, format="json"
    )


def test_login_returns_access_and_sets_httponly_refresh_cookie(api_client, superuser):
    response = login(api_client)

    assert response.status_code == 200
    assert response.data["access"]
    assert response.data["user"]["username"] == "diego"
    assert "refresh" not in response.data
    cookie = response.cookies[COOKIE]
    assert cookie.value
    assert cookie["httponly"]
    assert cookie["samesite"] == "Lax"
    assert cookie["path"] == "/"


def test_login_with_wrong_password_is_rejected(api_client, superuser):
    response = login(api_client, password="errada")

    assert response.status_code == 401
    assert response.data["detail"] == "Usuário ou senha inválidos."
    assert COOKIE not in response.cookies


def test_login_rejects_non_superuser(api_client):
    get_user_model().objects.create_user("intruso", password=PASSWORD)

    assert login(api_client, username="intruso").status_code == 401


def test_login_rejects_inactive_superuser(api_client, superuser):
    superuser.is_active = False
    superuser.save()

    assert login(api_client).status_code == 401


def test_login_validates_payload(api_client, superuser):
    response = api_client.post("/api/auth/login", {}, format="json")

    assert response.status_code == 400


def test_protected_endpoint_requires_token(api_client):
    assert api_client.get("/api/auth/me").status_code == 401


def test_protected_endpoint_with_token(auth_client):
    response = auth_client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.data["username"] == "diego"


def test_refresh_uses_cookie_and_rotates_it(api_client, superuser):
    first_refresh = login(api_client).cookies[COOKIE].value

    response = api_client.post("/api/auth/refresh")

    assert response.status_code == 200
    assert response.data["access"]
    assert response.data["user"]["username"] == "diego"
    new_refresh = response.cookies[COOKIE].value
    assert new_refresh and new_refresh != first_refresh


def test_rotated_refresh_token_cannot_be_reused(api_client, superuser):
    old_refresh = login(api_client).cookies[COOKIE].value
    api_client.post("/api/auth/refresh")

    api_client.cookies[COOKIE] = old_refresh
    response = api_client.post("/api/auth/refresh")

    assert response.status_code == 401


def test_refresh_without_cookie_returns_401(api_client):
    response = api_client.post("/api/auth/refresh")

    assert response.status_code == 401
    assert response.data["detail"] == "Sessão expirada. Faça login novamente."


def test_refresh_with_garbage_cookie_returns_401_and_clears_it(api_client):
    api_client.cookies[COOKIE] = "not-a-jwt"

    response = api_client.post("/api/auth/refresh")

    assert response.status_code == 401
    assert response.cookies[COOKIE].value == ""


def test_refresh_fails_after_user_loses_superuser(api_client, superuser):
    login(api_client)
    superuser.is_superuser = False
    superuser.save()

    assert api_client.post("/api/auth/refresh").status_code == 401


def test_logout_blacklists_refresh_and_clears_cookie(api_client, superuser):
    refresh = login(api_client).cookies[COOKIE].value

    response = api_client.post("/api/auth/logout")

    assert response.status_code == 204
    assert response.cookies[COOKIE].value == ""
    api_client.cookies[COOKIE] = refresh
    assert api_client.post("/api/auth/refresh").status_code == 401


def test_logout_without_cookie_is_noop(api_client):
    assert api_client.post("/api/auth/logout").status_code == 204


def test_health_is_public(api_client):
    response = api_client.get("/api/health")

    assert response.status_code == 200
    assert response.data == {"status": "ok"}
