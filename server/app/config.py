from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVER_ROOT.parent
SHARED_DIR = REPO_ROOT / "shared"


class Settings(BaseSettings):
    """Runtime configuration. Every field can be overridden from the environment."""

    model_config = SettingsConfigDict(env_prefix="APPLYAI_", env_file=SERVER_ROOT / ".env", extra="ignore")

    version: str = "0.1.0"
    require_app_check: bool = False
    # Explicit origins win; when the list is empty, development allows the extension and
    # loopback only, because a wildcard would let any site drive a signed-in session.
    allowed_origins: list[str] = []
    session_ttl_hours: int = 72
    credentials_path: str = Field(
        default="sa_creds.json",
        validation_alias=AliasChoices("GOOGLE_APPLICATION_CREDENTIALS", "APPLYAI_CREDENTIALS_PATH"),
    )

    @property
    def credentials_file(self) -> Path:
        path = Path(self.credentials_path)
        return path if path.is_absolute() else REPO_ROOT / path


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
