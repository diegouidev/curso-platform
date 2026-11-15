"""Daily study reminder, sent by the scheduler (see `manage.py scheduled_tasks`).

Channels come from environment variables, so no secret is stored in the database:
- Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (a bot of your own).
- E-mail: EMAIL_HOST (+ user/password) + REMINDER_EMAIL_TO.

The reminder goes out once per day, after the chosen time, only if the day doesn't count
as studied yet (same rule as the streak).
"""

import json
import logging
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from . import progress as study
from .models import ReviewCard, StudyPreferences
from .stats import studied_on, study_stats

logger = logging.getLogger(__name__)

TELEGRAM_URL = "https://api.telegram.org/bot{token}/sendMessage"
TIMEOUT_SECONDS = 15


def configured_channels() -> list[str]:
    channels = []
    if settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_CHAT_ID:
        channels.append("telegram")
    if settings.EMAIL_HOST and settings.REMINDER_EMAIL_TO:
        channels.append("email")
    return channels


def _send_telegram(text: str) -> None:
    body = json.dumps(
        {"chat_id": settings.TELEGRAM_CHAT_ID, "text": text, "disable_web_page_preview": True}
    ).encode()
    request = urllib.request.Request(  # noqa: S310 - fixed https URL
        TELEGRAM_URL.format(token=settings.TELEGRAM_BOT_TOKEN),
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        response.read()


def _send_email(subject: str, text: str) -> None:
    send_mail(subject, text, None, [settings.REMINDER_EMAIL_TO], fail_silently=False)


@dataclass
class SendResult:
    sent: list[str] = field(default_factory=list)
    errors: dict[str, str] = field(default_factory=dict)


def send(subject: str, text: str) -> SendResult:
    """Sends on every configured channel; one failing doesn't stop the others."""
    result = SendResult()
    for channel in configured_channels():
        try:
            if channel == "telegram":
                _send_telegram(f"{subject}\n\n{text}")
            else:
                _send_email(subject, text)
        except Exception as exc:  # network, SMTP, bad token... reported, never raised
            logger.warning("Reminder via %s failed: %s", channel, exc)
            result.errors[channel] = "Não foi possível enviar. Confira a configuração."
        else:
            result.sent.append(channel)
    return result


def reminder_message() -> tuple[str, str]:
    stats = study_stats()
    lines: list[str] = []
    if stats["streak_days"] > 0:
        days = stats["streak_days"]
        lines.append(
            f"Sua sequência de {days} {'dia' if days == 1 else 'dias'} termina hoje se você "
            "não estudar."
        )
    else:
        lines.append("Você ainda não estudou hoje.")
    if stats["daily_goal_minutes"]:
        done = stats["study_seconds_today"] // 60
        lines.append(f"Meta do dia: {done} de {stats['daily_goal_minutes']} min.")
    due = ReviewCard.objects.filter(due_on__lte=timezone.localdate()).count()
    if due:
        lines.append(f"{due} {'cartão' if due == 1 else 'cartões'} para revisar.")

    found = study.continue_lesson()
    if found:
        lesson, _ = found
        lines += [
            "",
            f"Continuar: {lesson.title} ({lesson.module.course.title})",
            f"{settings.FRONTEND_URL}/courses/{lesson.module.course_id}/lessons/{lesson.pk}",
        ]
    else:
        lines += ["", settings.FRONTEND_URL]
    return "Hora de estudar", "\n".join(lines)


def maybe_send_reminder(now: datetime | None = None) -> str:
    """Sends today's reminder if it's due. Returns what happened (for the command output)."""
    now = timezone.localtime(now or timezone.now())
    preferences = StudyPreferences.load()
    today = now.date()
    if not preferences.reminder_enabled:
        return "lembrete desligado"
    if preferences.reminder_last_sent_on == today:
        return "lembrete de hoje já enviado"
    if now.time() < preferences.reminder_time:
        return "ainda não é hora do lembrete"
    if not configured_channels():
        return "nenhum canal de lembrete configurado"
    if studied_on(today):
        return "já estudou hoje"

    result = send(*reminder_message())
    if result.sent:
        StudyPreferences.objects.filter(pk=preferences.pk).update(reminder_last_sent_on=today)
        return f"lembrete enviado ({', '.join(result.sent)})"
    return "falha ao enviar o lembrete"
