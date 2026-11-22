"""The shared question taxonomy, read-only.

Python never evaluates the label patterns: matching happens once on the page and arrives as
a `taxonomy_id`. This module exists so the resolver can trust that id only when it is real,
and so it can map a question to the preference key that answers it.
"""

import json
from dataclasses import dataclass
from functools import lru_cache

from .config import SHARED_DIR


@dataclass(frozen=True)
class QuestionDef:
    id: str
    label: str
    field_type: str
    answer_from: str
    pref_key: str | None
    sensitivity: str


@lru_cache(maxsize=1)
def questions() -> dict[str, QuestionDef]:
    entries = json.loads((SHARED_DIR / "questions.json").read_text(encoding="utf-8"))
    return {
        entry["id"]: QuestionDef(
            id=entry["id"],
            label=entry["label"],
            field_type=entry["fieldType"],
            answer_from=entry["answerFrom"],
            pref_key=entry.get("prefKey"),
            sensitivity=entry["sensitivity"],
        )
        for entry in entries
    }


def lookup(taxonomy_id: str | None) -> QuestionDef | None:
    """Unknown or missing ids are simply unclassified, never an error."""
    if not taxonomy_id:
        return None
    return questions().get(taxonomy_id)
