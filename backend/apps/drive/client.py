"""Read-only Google Drive client.

This is the ONLY module allowed to talk to the Drive API, and it only exposes metadata
reads: `files.list`, `files.get` (metadata, never media) and `about.get`. A test scans
this file and fails on any write/download method, so keep it that way.
"""

import json
import logging
import random
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import httplib2
from google.auth.exceptions import RefreshError
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from .credentials import google_credentials, refresh
from .errors import (
    DriveAccessDenied,
    DriveApiDisabled,
    DriveError,
    DriveNotFound,
    DriveRateLimited,
    GoogleReconnectRequired,
)
from .models import GoogleCredential

logger = logging.getLogger(__name__)

FOLDER_MIME = "application/vnd.google-apps.folder"
SHORTCUT_MIME = "application/vnd.google-apps.shortcut"

LIST_FIELDS = (
    "nextPageToken, files(id, name, mimeType, videoMediaMetadata(durationMillis), "
    "modifiedTime, shortcutDetails(targetId, targetMimeType))"
)
GET_FIELDS = "id, name, mimeType, shortcutDetails(targetId, targetMimeType)"

RATE_LIMIT_REASONS = {"rateLimitExceeded", "userRateLimitExceeded"}
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


def _reason(error: HttpError) -> str:
    try:
        payload = json.loads(error.content.decode() if error.content else "{}")
        errors = payload.get("error", {}).get("errors") or []
        return errors[0].get("reason", "") if errors else ""
    except (ValueError, AttributeError):
        return ""


def _status(error: HttpError) -> int:
    return int(getattr(error.resp, "status", 0) or 0)


class DriveClient:
    def __init__(
        self,
        service: Any,
        *,
        on_unauthorized: Callable[[], None] | None = None,
        max_retries: int = 5,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        self._service = service
        self._on_unauthorized = on_unauthorized
        self._max_retries = max_retries
        self._sleep = sleep

    # --- public, read-only API ---------------------------------------------------
    def about(self) -> dict:
        return self._execute(lambda: self._service.about().get(fields="user(emailAddress)"))

    def get_file(self, file_id: str) -> dict:
        return self._execute(
            lambda: self._service.files().get(
                fileId=file_id, fields=GET_FIELDS, supportsAllDrives=True
            )
        )

    def list_children(self, folder_id: str) -> Iterator[dict]:
        """Yield every non-trashed direct child of a folder, following all pages."""
        page_token: str | None = None
        while True:
            response = self._execute(
                lambda token=page_token: self._service.files().list(
                    q=f"'{folder_id}' in parents and trashed = false",
                    fields=LIST_FIELDS,
                    pageSize=1000,
                    pageToken=token,
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                )
            )
            yield from response.get("files", [])
            page_token = response.get("nextPageToken")
            if not page_token:
                return

    # --- internals ---------------------------------------------------------------
    def _execute(self, make_request: Callable[[], Any]) -> dict:
        attempt = 0
        refreshed = False
        while True:
            try:
                return make_request().execute()
            except HttpError as error:
                status, reason = _status(error), _reason(error)
                if status == 401 and not refreshed and self._on_unauthorized:
                    refreshed = True
                    self._on_unauthorized()
                    continue
                if status == 401:
                    raise GoogleReconnectRequired() from error
                retryable = status in RETRYABLE_STATUS or (
                    status == 403 and reason in RATE_LIMIT_REASONS
                )
                if not retryable:
                    raise self._translate(status, reason) from error
                if attempt >= self._max_retries:
                    if status == 429 or reason in RATE_LIMIT_REASONS:
                        raise DriveRateLimited() from error
                    raise DriveError() from error
            except RefreshError as error:
                raise GoogleReconnectRequired() from error
            except (OSError, httplib2.HttpLib2Error) as error:  # network blips, timeouts
                if attempt >= self._max_retries:
                    raise DriveError() from error
            delay = min(2**attempt, 32) + random.uniform(0, 1)  # noqa: S311 - jitter only
            logger.info("Drive request retry %s in %.1fs", attempt + 1, delay)
            (self._sleep or time.sleep)(delay)
            attempt += 1

    @staticmethod
    def _translate(status: int, reason: str) -> DriveError:
        if reason in {"accessNotConfigured", "SERVICE_DISABLED"}:
            return DriveApiDisabled()
        if status == 404:
            return DriveNotFound()
        if status == 403:
            return DriveAccessDenied()
        return DriveError()


def build_service(credentials: Any) -> Any:
    # cache_discovery=False: the discovery document ships with the library (no network).
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


@contextmanager
def drive_client() -> Iterator[tuple[GoogleCredential, DriveClient]]:
    """Authenticated read-only client; refreshed tokens are persisted on exit."""
    with google_credentials() as (credential, creds):
        service = build_service(creds)
        client = DriveClient(service, on_unauthorized=lambda: refresh(credential, creds))
        yield credential, client
