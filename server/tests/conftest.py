from collections.abc import Iterable, Mapping
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api import get_store
from app.auth import Principal, require_user
from app.config import Settings, get_settings
from app.main import create_app
from app.store import DocPath, Document, Store


class MemoryStore(Store):
    """In-memory stand-in that keeps the batched-read contract visible in tests."""

    def __init__(self) -> None:
        self.documents: dict[tuple[str, DocPath], Document] = {}
        self.sessions: dict[tuple[str, str], Document] = {}
        self.reads: list[list[DocPath]] = []
        self._sequence = 0

    def put(self, uid: str, path: DocPath, document: Mapping[str, Any]) -> None:
        self.documents[(uid, path)] = dict(document)

    def read(self, uid: str, paths: Iterable[DocPath]) -> dict[DocPath, Document]:
        wanted = list(dict.fromkeys(paths))
        self.reads.append(wanted)
        return {path: dict(self.documents[(uid, path)]) for path in wanted if (uid, path) in self.documents}

    def create_session(self, uid: str, data: Mapping[str, Any]) -> str:
        self._sequence += 1
        session_id = f"session{self._sequence}"
        self.sessions[(uid, session_id)] = dict(data)
        return session_id

    def get_session(self, uid: str, session_id: str) -> Document | None:
        found = self.sessions.get((uid, session_id))
        return dict(found) if found is not None else None

    def update_session(self, uid: str, session_id: str, data: Mapping[str, Any]) -> None:
        self.sessions[(uid, session_id)].update(dict(data))


@pytest.fixture
def store() -> MemoryStore:
    return MemoryStore()


@pytest.fixture
def settings() -> Settings:
    return Settings(require_app_check=False)


@pytest.fixture
def seeded(store: MemoryStore) -> MemoryStore:
    store.put(
        "alice",
        ("profile", "current"),
        {
            "fullName": "Jordan Lee",
            "email": "jordan@example.com",
            "phone": "+1 555 010 0100",
            "linkedin": "linkedin.com/in/jordan-lee",
            "city": "San Francisco",
        },
    )
    store.put(
        "alice",
        ("preferences", "current"),
        {
            "requiresSponsorship": "no",
            "desiredSalary": "120000",
            "salaryCurrency": "USD",
            "earliestStartDate": "2026-01-05",
            "eeoOptIn": False,
            "gender": "Woman",
        },
    )
    return store


def _test_app(store: MemoryStore, settings: Settings) -> Any:
    application = create_app(settings)
    application.dependency_overrides[get_store] = lambda: store
    application.dependency_overrides[get_settings] = lambda: settings
    return application


@pytest.fixture
def client(store: MemoryStore, settings: Settings) -> TestClient:
    application = _test_app(store, settings)
    application.dependency_overrides[require_user] = lambda: Principal(uid="alice")
    return TestClient(application)


@pytest.fixture
def bob_client(store: MemoryStore, settings: Settings) -> TestClient:
    application = _test_app(store, settings)
    application.dependency_overrides[require_user] = lambda: Principal(uid="bob")
    return TestClient(application)


@pytest.fixture
def anonymous_client(store: MemoryStore, settings: Settings, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """No auth override: the real dependency runs, with Firebase stubbed out."""
    monkeypatch.setattr("app.auth.firebase_app", lambda settings: object())

    def reject(*args: Any, **kwargs: Any) -> dict:
        raise ValueError("bad token")

    monkeypatch.setattr("app.auth.auth.verify_id_token", reject)
    return TestClient(_test_app(store, settings))


@pytest.fixture
def token_client(store: MemoryStore, settings: Settings, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """The real dependency runs and reports carol, proving the uid comes from the token."""
    monkeypatch.setattr("app.auth.firebase_app", lambda settings: object())
    monkeypatch.setattr("app.auth.auth.verify_id_token", lambda *args, **kwargs: {"uid": "carol"})
    return TestClient(_test_app(store, settings))


@pytest.fixture
def make_field():
    def build(field_id: str, label: str, **overrides: Any) -> dict[str, Any]:
        return {"field_id": field_id, "label": label, **overrides}

    return build
