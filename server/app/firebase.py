"""Initialise the Admin SDK once and hand the same app to every caller.

Both ID token verification and Firestore need credentials; doing this in one place keeps
the service account path out of the modules that use it.
"""

from firebase_admin import App, credentials, get_app, initialize_app

from .config import Settings


def firebase_app(settings: Settings) -> App:
    try:
        return get_app()
    except ValueError:
        pass
    path = settings.credentials_file
    if not path.is_file():
        raise RuntimeError(
            f"Firebase service account not found at {path}. Set GOOGLE_APPLICATION_CREDENTIALS "
            "or APPLYAI_CREDENTIALS_PATH to a service account JSON file."
        )
    return initialize_app(credentials.Certificate(str(path)))
