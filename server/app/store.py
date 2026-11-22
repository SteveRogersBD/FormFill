"""Firestore access, every path scoped by the caller's uid.

`read` is the only read used by resolution: one `get_all` covers the profile, preferences
and every memory document for the step. Reading per field is what would turn a 28-field
form into 28 round trips.
"""

from collections.abc import Iterable, Mapping
from typing import Any

from firebase_admin import firestore as admin_firestore

DocPath = tuple[str, ...]
Document = dict[str, Any]


class Store:
    """The narrow surface the API needs, so tests can swap an in-memory implementation."""

    def read(self, uid: str, paths: Iterable[DocPath]) -> dict[DocPath, Document]:
        raise NotImplementedError

    def create_session(self, uid: str, data: Mapping[str, Any]) -> str:
        raise NotImplementedError

    def get_session(self, uid: str, session_id: str) -> Document | None:
        raise NotImplementedError

    def update_session(self, uid: str, session_id: str, data: Mapping[str, Any]) -> None:
        raise NotImplementedError


class FirestoreStore(Store):
    def __init__(self, client: Any | None = None) -> None:
        self._db = client or admin_firestore.client()

    def _document(self, uid: str, path: DocPath):
        return self._db.document("users", uid, *path)

    def read(self, uid: str, paths: Iterable[DocPath]) -> dict[DocPath, Document]:
        wanted = list(dict.fromkeys(paths))
        if not wanted:
            return {}
        snapshots = self._db.get_all([self._document(uid, path) for path in wanted])
        found: dict[DocPath, Document] = {}
        # get_all keeps argument order, and a missing document comes back as a falsy
        # snapshot rather than an error, which is how "nothing stored yet" stays normal.
        for path, snapshot in zip(wanted, snapshots):
            if snapshot.exists:
                found[path] = snapshot.to_dict() or {}
        return found

    def create_session(self, uid: str, data: Mapping[str, Any]) -> str:
        reference = self._db.collection("users").document(uid).collection("sessions").document()
        reference.set(dict(data))
        return reference.id

    def get_session(self, uid: str, session_id: str) -> Document | None:
        snapshot = self._db.collection("users").document(uid).collection("sessions").document(session_id).get()
        return (snapshot.to_dict() or {}) if snapshot.exists else None

    def update_session(self, uid: str, session_id: str, data: Mapping[str, Any]) -> None:
        self._db.collection("users").document(uid).collection("sessions").document(session_id).update(dict(data))
