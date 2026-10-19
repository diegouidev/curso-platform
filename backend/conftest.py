import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

PASSWORD = "s3nha-Forte!"


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def superuser(db):
    return get_user_model().objects.create_superuser("diego", "diego@example.com", PASSWORD)


@pytest.fixture
def auth_client(api_client, superuser) -> APIClient:
    response = api_client.post(
        "/api/auth/login", {"username": "diego", "password": PASSWORD}, format="json"
    )
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
    return api_client
