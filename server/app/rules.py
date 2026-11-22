"""The shared label rules from shared/field-rules.json.

The extension resolves labels from this same table, so "sensitive" and "answer wording"
cannot drift between the page and the server.
"""

import json
import re

from .config import SHARED_DIR

_data = json.loads((SHARED_DIR / "field-rules.json").read_text(encoding="utf-8"))

SENSITIVE = re.compile(_data["sensitivePattern"], re.IGNORECASE)

_guards = {name: re.compile(source) for name, source in _data["guards"].items()}
# Order is match priority, exactly as the extension evaluates it.
PROFILE_MATCHES: tuple[tuple[re.Pattern[str], str, re.Pattern[str] | None], ...] = tuple(
    (re.compile(entry["pattern"]), entry["key"], _guards.get(entry.get("guard", "")))
    for entry in _data["profileMatches"]
)

_preference_text: dict[str, str] = _data["preferenceAnswers"]


def is_sensitive(label: str) -> bool:
    return SENSITIVE.search(label) is not None


def preference_text(value: str) -> str:
    clean = value.strip()
    if not clean:
        return ""
    return _preference_text.get(clean, clean)
