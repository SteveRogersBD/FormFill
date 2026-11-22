"""Checks every answer must pass before the panel is allowed to offer it as filled.

The same rules run for model output, stored memory and typed answers, because a typed
answer is not automatically well-formed and a stored answer may predate a form change.
"""

import re
from dataclasses import dataclass

from .models import FieldIn
from .rules import is_sensitive

SHORT_LIMIT = 800
NARRATIVE_LIMIT = 5000

_CHOICE_TYPES = frozenset({"select", "radio"})
_NARRATIVE_TYPES = frozenset({"narrative", "textarea"})

_DATE = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")
_NUMBER = re.compile(r"^-?\d+(\.\d+)?$")
_CURRENCY_NOISE = re.compile(r"[$€£,\s]")


@dataclass(frozen=True)
class Verdict:
    value: str | None
    reason: str | None = None

    @property
    def ok(self) -> bool:
        return self.value is not None


def is_choice(field: FieldIn) -> bool:
    return field.field_type in _CHOICE_TYPES


def is_narrative(field: FieldIn) -> bool:
    return field.field_type in _NARRATIVE_TYPES


def check(field: FieldIn, value: str, source: str) -> Verdict:
    """Return the value to store and fill, or why it cannot be used."""
    text = value.strip()
    if not text:
        return Verdict(None, "missing_fact")

    # A model may not answer a consequential question on the user's behalf; the user is
    # asked instead. Deterministic and user sources are allowed, since the user set them.
    if source == "model" and is_sensitive(field.label):
        return Verdict(None, "sensitive")

    if is_narrative(field) and len(text) > NARRATIVE_LIMIT:
        return Verdict(None, "invalid")
    if not is_narrative(field) and len(text) > SHORT_LIMIT:
        return Verdict(None, "invalid")

    if is_choice(field) and field.options:
        wanted = text.casefold()
        for option in field.options:
            if option.strip().casefold() == wanted:
                return Verdict(option.strip())
        return Verdict(None, "invalid")

    if field.field_type == "date" and not _DATE.match(text):
        return Verdict(None, "invalid")

    if field.field_type == "number" and not _NUMBER.match(_CURRENCY_NOISE.sub("", text)):
        return Verdict(None, "invalid")

    return Verdict(text)
