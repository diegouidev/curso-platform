import pytest

from apps.drive.client import DriveClient
from apps.drive.errors import (
    DriveAccessDenied,
    DriveApiDisabled,
    DriveError,
    DriveNotFound,
    DriveRateLimited,
    GoogleReconnectRequired,
)
from tests.fakes import FakeDrive


@pytest.fixture
def drive() -> FakeDrive:
    drive = FakeDrive(page_size=2)
    drive.folder("root", "Curso")
    for n in range(5):
        drive.file(f"v{n}", f"Aula {n}.mp4", "root")
    return drive


def test_list_children_follows_every_page(drive):
    files = list(DriveClient(drive).list_children("root"))

    assert [f["id"] for f in files] == ["v0", "v1", "v2", "v3", "v4"]
    tokens = [call.get("pageToken") for call in drive.list_calls]
    assert tokens == [None, "2", "4"]
    assert all(call["q"] == "'root' in parents and trashed = false" for call in drive.list_calls)


@pytest.mark.parametrize(
    ("status", "reason"),
    [(429, ""), (403, "rateLimitExceeded"), (403, "userRateLimitExceeded"), (500, ""), (503, "")],
)
def test_transient_errors_are_retried_with_backoff(drive, no_retry_sleep, status, reason):
    drive.fail_next(status, reason, times=3)

    files = list(DriveClient(drive).list_children("root"))

    assert len(files) == 5
    assert len(no_retry_sleep) == 3
    assert no_retry_sleep[0] < no_retry_sleep[1] < no_retry_sleep[2]


def test_rate_limit_gives_up_after_max_retries(drive, no_retry_sleep):
    drive.fail_next(429, times=10)

    with pytest.raises(DriveRateLimited):
        list(DriveClient(drive, max_retries=3).list_children("root"))
    assert len(no_retry_sleep) == 3


def test_server_errors_give_up_as_drive_error(drive):
    drive.fail_next(500, times=10)

    with pytest.raises(DriveError) as exc:
        DriveClient(drive, max_retries=2).get_file("root")
    assert type(exc.value) is DriveError


@pytest.mark.parametrize(
    ("status", "reason", "error"),
    [
        (404, "notFound", DriveNotFound),
        (403, "insufficientFilePermissions", DriveAccessDenied),
        (403, "accessNotConfigured", DriveApiDisabled),
    ],
)
def test_permanent_errors_are_not_retried(drive, no_retry_sleep, status, reason, error):
    drive.fail_next(status, reason)

    with pytest.raises(error):
        DriveClient(drive).get_file("root")
    assert no_retry_sleep == []


def test_unknown_file_is_not_found(drive):
    with pytest.raises(DriveNotFound):
        DriveClient(drive).get_file("nope")


def test_401_refreshes_once_then_retries(drive):
    refreshed = []
    drive.fail_next(401)

    result = DriveClient(drive, on_unauthorized=lambda: refreshed.append(True)).get_file("root")

    assert result["id"] == "root"
    assert refreshed == [True]


def test_repeated_401_requires_reconnect(drive):
    drive.fail_next(401, times=2)

    with pytest.raises(GoogleReconnectRequired):
        DriveClient(drive, on_unauthorized=lambda: None).get_file("root")


def test_network_errors_are_retried(drive, no_retry_sleep):
    drive.pending_errors.append(TimeoutError("read timed out"))

    assert DriveClient(drive).get_file("root")["id"] == "root"
    assert len(no_retry_sleep) == 1
