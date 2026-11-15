"""Spaced repetition: question/answer cards written inside lesson notes.

A card is a "P:" (pergunta) line followed by an "R:" (resposta) line:

    P: O que é idempotência?
    R: Repetir a operação não muda o resultado.

The answer goes on until a blank line or the next "P:". Labels are case-insensitive, accept
the long forms ("Pergunta:", "Resposta:"), list markers ("- P:") and bold ("**P:**"). Lines
inside code fences are ignored. A question without an answer is not a card.

Cards are matched to the note by a hash of the normalized question: editing the answer or
moving the card keeps its schedule; changing the question starts a new card.

Scheduling is SM-2 with four buttons, like Anki: "again" keeps the card due today (the
review screen shows it again at the end), "hard", "good" and "easy" push it out.
"""

import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from django.db import transaction
from django.utils import timezone

from .models import Lesson, ReviewCard
from .search import fold

MAX_CARDS_PER_NOTE = 200
MIN_EASE = 1.3
MAX_INTERVAL_DAYS = 3650

Rating = Literal["again", "hard", "good", "easy"]
RATINGS: list[tuple[Rating, str]] = [
    ("again", "Errei"),
    ("hard", "Difícil"),
    ("good", "Bom"),
    ("easy", "Fácil"),
]

_LABEL = re.compile(
    r"^\s*(?:[-*+]\s+)?(?:\*\*|__)?(?P<label>p|pergunta|r|resposta)\s*:(?:\*\*|__)?\s?(?P<text>.*)$",
    re.IGNORECASE,
)
_FENCE = re.compile(r"^\s*(```|~~~)")


@dataclass(frozen=True)
class ParsedCard:
    question: str
    answer: str

    @property
    def key(self) -> str:
        return card_key(self.question)


def card_key(question: str) -> str:
    normalized = " ".join(fold(question).split())
    return hashlib.sha1(normalized.encode("utf-8"), usedforsecurity=False).hexdigest()[:32]


def parse_cards(content: str) -> list[ParsedCard]:
    """Every complete P/R pair in the note, in order, without repeated questions."""
    cards: list[ParsedCard] = []
    seen: set[str] = set()
    question: list[str] | None = None
    answer: list[str] | None = None
    in_fence = False

    def close() -> None:
        nonlocal question, answer
        if question is not None and answer is not None:
            card = ParsedCard("\n".join(question).strip(), "\n".join(answer).strip())
            if card.question and card.answer and card.key not in seen:
                seen.add(card.key)
                cards.append(card)
        question = answer = None

    for line in content.splitlines():
        if _FENCE.match(line):
            in_fence = not in_fence
            close()
            continue
        if in_fence:
            continue
        match = _LABEL.match(line)
        label = match["label"].lower()[0] if match else None
        if label == "p":
            close()
            question = [match["text"].strip()]
        elif label == "r" and question is not None and answer is None:
            answer = [match["text"].strip()]
        elif not line.strip():
            close()  # a blank line ends the card (or drops a question with no answer)
        elif answer is not None:
            answer.append(line.rstrip())
        elif question is not None:
            question.append(line.strip())
    close()
    return cards[:MAX_CARDS_PER_NOTE]


@dataclass
class CardSyncStats:
    created: int = 0
    updated: int = 0
    removed: int = 0


def sync_cards(lesson: Lesson, content: str) -> CardSyncStats:
    """Makes the lesson's cards match its note. Schedules of kept questions are untouched."""
    stats = CardSyncStats()
    parsed = parse_cards(content)
    with transaction.atomic():
        existing = {card.key: card for card in ReviewCard.objects.filter(lesson=lesson)}
        for position, item in enumerate(parsed):
            card = existing.pop(item.key, None)
            if card is None:
                ReviewCard.objects.create(
                    lesson=lesson,
                    key=item.key,
                    question=item.question,
                    answer=item.answer,
                    position=position,
                )
                stats.created += 1
            elif (card.question, card.answer, card.position) != (
                item.question,
                item.answer,
                position,
            ):
                card.question, card.answer, card.position = item.question, item.answer, position
                card.save(update_fields=["question", "answer", "position"])
                stats.updated += 1
        if existing:
            ReviewCard.objects.filter(pk__in=[card.pk for card in existing.values()]).delete()
            stats.removed = len(existing)
    return stats


def schedule(card: ReviewCard, rating: Rating, today: date) -> None:
    """SM-2 step. Sets ease, interval, repetitions, lapses and due_on (not saved)."""
    if rating == "again":
        if card.repetitions > 0:
            card.lapses += 1
        card.repetitions = 0
        card.interval_days = 0
        card.ease = max(MIN_EASE, card.ease - 0.2)
    else:
        if rating == "hard":
            interval = 1 if card.repetitions == 0 else max(1, round(card.interval_days * 1.2))
            card.ease = max(MIN_EASE, card.ease - 0.15)
        elif rating == "good":
            interval = (
                1
                if card.repetitions == 0
                else 3 if card.repetitions == 1 else round(card.interval_days * card.ease)
            )
        else:  # easy
            interval = 4 if card.repetitions == 0 else round(card.interval_days * card.ease * 1.3)
            card.ease += 0.15
        # "Good" and "easy" never shorten the previous interval.
        floor = 1 if rating == "hard" else card.interval_days
        card.interval_days = min(max(interval, floor), MAX_INTERVAL_DAYS)
        card.repetitions += 1
    card.due_on = today + timedelta(days=card.interval_days)


def review(card: ReviewCard, rating: Rating, now: datetime | None = None) -> ReviewCard:
    now = now or timezone.now()
    schedule(card, rating, timezone.localdate(now))
    card.last_reviewed_at = now
    card.save(
        update_fields=[
            "ease",
            "interval_days",
            "repetitions",
            "lapses",
            "due_on",
            "last_reviewed_at",
        ]
    )
    return card
