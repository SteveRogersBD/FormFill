"""Tier 0: answer from what is already known, without a model call.

Order matters. A stored preference is a fact the user deliberately set, so it wins over a
label guess; the profile answers identity and education; answer memory is the last resort
because it is the least certain of the three.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field as dataclass_field
from typing import Any

from . import memory, rules, taxonomy
from .models import Answer, FieldIn, RunStats, Unresolved
from .store import DocPath, Store
from .validation import check, is_choice

PROFILE_PATH: DocPath = ("profile", "current")
PREFERENCES_PATH: DocPath = ("preferences", "current")
ANSWER_COLLECTION = "answers"


@dataclass(frozen=True)
class Facts:
    profile: Mapping[str, Any] = dataclass_field(default_factory=dict)
    preferences: Mapping[str, Any] = dataclass_field(default_factory=dict)


@dataclass(frozen=True)
class Resolution:
    answers: list[Answer]
    unresolved: list[Unresolved]

    @property
    def status(self) -> str:
        if any(item.reason == "needs_inference" for item in self.unresolved):
            return "needs_inference"
        return "needs_user" if self.unresolved else "complete"

    def stats(self) -> RunStats:
        counts: dict[str, int] = {}
        for answer in self.answers:
            counts[answer.tier] = counts.get(answer.tier, 0) + 1
        return RunStats(fields=len(self.answers) + len(self.unresolved), resolved=len(self.answers), tier_counts=counts)


# Padding with spaces lets the shared patterns rely on \b instead of guessing at word
# edges; this mirrors normalizeLabel in the extension.
def _normalize_label(label: str) -> str:
    return f" {re.sub(r'[^a-z0-9]+', ' ', label.lower()).strip()} "


def profile_value(label: str, profile: Mapping[str, Any]) -> tuple[str, str] | None:
    """Return the saved fact for a label and the profile key it came from."""
    normalized = _normalize_label(label)
    for pattern, key, guard in rules.PROFILE_MATCHES:
        if not pattern.search(normalized) or (guard and guard.search(normalized)):
            continue
        value = _read_profile(profile, key)
        # The extension stops at the first matching row even when it is empty, so a label
        # that means "company name" never falls through to the applicant's own name.
        return (value, key) if value else None
    return None


def _read_profile(profile: Mapping[str, Any], key: str) -> str:
    if key in {"firstName", "lastName"}:
        parts = str(profile.get("fullName") or "").split()
        if key == "firstName":
            return parts[0] if parts else ""
        return parts[-1] if len(parts) > 1 else ""
    stored = profile.get(key)
    text = ", ".join(str(item) for item in stored) if isinstance(stored, list) else str(stored or "")
    text = text.strip()
    if key in {"linkedin", "portfolio"} and text and not text.lower().startswith(("http://", "https://")):
        text = f"https://{text}"
    return text


def memory_doc_ids(fields: Sequence[FieldIn], company: str) -> dict[str, DocPath]:
    """Field id to answer document, for the one batched read."""
    paths: dict[str, DocPath] = {}
    for detected in fields:
        value = memory.signature(detected.label)
        scoped = memory.is_company_scoped(detected.label, detected.taxonomy_id)
        paths[detected.field_id] = (ANSWER_COLLECTION, memory.answer_doc_id(value, scoped=scoped, company=company))
    return paths


def load_known(
    store: Store, uid: str, fields: Sequence[FieldIn], company: str
) -> tuple[Facts, dict[str, dict[str, Any]]]:
    """Read facts and candidate memories for a step in a single batch."""
    paths = memory_doc_ids(fields, company)
    requested: list[DocPath] = [PROFILE_PATH, PREFERENCES_PATH, *paths.values()]
    documents = store.read(uid, requested)
    facts = Facts(
        profile=documents.get(PROFILE_PATH, {}),
        preferences=documents.get(PREFERENCES_PATH, {}),
    )
    by_field = {
        field_id: documents[path]
        for field_id, path in paths.items()
        if path in documents
    }
    return facts, by_field


def _preference_answer(question: taxonomy.QuestionDef, preferences: Mapping[str, Any]) -> str | None:
    if question.answer_from != "preferences" or not question.pref_key:
        return None
    if question.sensitivity == "eeo" and not preferences.get("eeoOptIn"):
        return None
    stored = preferences.get(question.pref_key)
    if not isinstance(stored, str):
        return None
    return rules.preference_text(stored) or None


def _memory_answer(entry: Mapping[str, Any], detected: FieldIn) -> tuple[str, float] | None:
    value = entry.get("value")
    if not isinstance(value, str) or not value.strip():
        return None
    # A demoted entry was contradicted twice, so it is no longer served: the field falls
    # through to a person instead of quietly repeating an answer the user overrode.
    if int(entry.get("corrections") or 0) >= 2:
        return None
    if not is_choice(detected) and len(value.strip()) < 3:
        return None
    confidence = float(entry.get("confidence") or 1.0)
    return value, confidence


def resolve(
    fields: Sequence[FieldIn], facts: Facts, memories: Mapping[str, Mapping[str, Any]], company: str
) -> Resolution:
    answers: list[Answer] = []
    unresolved: list[Unresolved] = []

    for detected in fields:
        question = taxonomy.lookup(detected.taxonomy_id)
        taxonomy_id = question.id if question else None

        if question and question.sensitivity == "eeo" and not facts.preferences.get("eeoOptIn"):
            unresolved.append(Unresolved(field_id=detected.field_id, reason="needs_confirmation", taxonomy_id=taxonomy_id))
            continue

        candidate = _preference_answer(question, facts.preferences) if question else None
        if candidate is not None:
            verdict = check(detected, candidate, "preference")
            if verdict.ok:
                answers.append(
                    Answer(
                        field_id=detected.field_id,
                        value=verdict.value or "",
                        tier="0",
                        source="preference",
                        evidence=[f"preferences.{question.pref_key}"],
                        taxonomy_id=taxonomy_id,
                    )
                )
                continue
            unresolved.append(Unresolved(field_id=detected.field_id, reason="invalid", taxonomy_id=taxonomy_id))
            continue

        matched = profile_value(detected.label, facts.profile)
        if matched is not None:
            profile_text, profile_key = matched
            verdict = check(detected, profile_text, "profile")
            if verdict.ok:
                answers.append(
                    Answer(
                        field_id=detected.field_id,
                        value=verdict.value or "",
                        tier="0",
                        source="profile",
                        evidence=[f"profile.{profile_key}"],
                        taxonomy_id=taxonomy_id,
                    )
                )
                continue

        entry = memories.get(detected.field_id)
        remembered = _memory_answer(entry, detected) if entry else None
        if remembered is not None:
            verdict = check(detected, remembered[0], "memory")
            if verdict.ok:
                answers.append(
                    Answer(
                        field_id=detected.field_id,
                        value=verdict.value or "",
                        tier="0",
                        source="memory",
                        confidence=remembered[1],
                        evidence=["answer-memory"],
                        taxonomy_id=taxonomy_id,
                    )
                )
                continue

        unresolved.append(Unresolved(field_id=detected.field_id, reason=_reason(question, detected), taxonomy_id=taxonomy_id))

    return Resolution(answers=answers, unresolved=unresolved)


def _reason(question: taxonomy.QuestionDef | None, detected: FieldIn) -> str:
    if question and question.answer_from == "llm":
        return "needs_inference"
    if detected.field_type in {"narrative", "textarea"}:
        return "needs_inference"
    if question and question.pref_key:
        return "missing_fact"
    return "unknown"
