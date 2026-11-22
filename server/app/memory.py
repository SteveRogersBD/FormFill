"""Deterministic ids for stored answers.

The id has to be stable across runs, tabs and devices: it is what makes an upsert
idempotent and what a later application looks up. Company-scoped questions fold the
employer into the id so "why do you want to work here?" answered at one company cannot
resolve inside another company's application.
"""

import hashlib
import re

# Filler words say nothing about *which* question is being asked, so they are dropped
# before hashing. That is what lets "Why do you want to work here?" and "Why do you want
# to work here" share one entry.
STOPWORDS = frozenset(
    {
        "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with", "from",
        "is", "are", "am", "be", "been", "being", "do", "does", "did", "will", "would",
        "can", "could", "should", "you", "your", "yours", "we", "our", "us", "it", "its",
        "this", "that", "these", "those", "have", "has", "had", "please", "tell", "describe",
        "about", "as", "by", "if", "any", "all",
    }
)

# "here", "this company" and "... us" only mean something relative to one employer.
# A bare "us" is not enough: "tell us about a project" is reusable everywhere.
_COMPANY_HINTS = re.compile(r"\b(this company|our company|this role|this position|here)\b|\b(at|with|for|join|about) us\b")
_COMPANY_SCOPED_TAXONOMY = frozenset({"whyCompany", "previouslyEmployedHere", "previouslyApplied"})

_SIGNATURE_NOISE = re.compile(r"[^a-z0-9]+")


def signature(label: str) -> str:
    words = [word for word in _SIGNATURE_NOISE.sub(" ", label.lower()).split() if word]
    kept = [word for word in words if word not in STOPWORDS]
    return " ".join(kept or words)


def is_company_scoped(label: str, taxonomy_id: str | None = None) -> bool:
    return taxonomy_id in _COMPANY_SCOPED_TAXONOMY or bool(_COMPANY_HINTS.search(label.lower()))


def company_key(company: str) -> str:
    return _SIGNATURE_NOISE.sub("", company.lower())


def answer_doc_id(signature_value: str, *, scoped: bool, company: str) -> str:
    scope = "company" if scoped else "global"
    employer = company_key(company) if scoped else ""
    return hashlib.sha1(f"{scope}:{employer}:{signature_value}".encode()).hexdigest()[:20]
