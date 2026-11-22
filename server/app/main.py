from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .config import Settings, get_settings

# A wildcard origin would let any page drive a signed-in session with the user's tokens,
# so development allows only the extension and loopback origins.
_DEV_ORIGIN = r"^(chrome-extension://[a-p]{32}|http://localhost(:\d+)?|http://127\.0\.0\.1(:\d+)?)$"

_ALLOWED_HEADERS = ["authorization", "content-type", "x-firebase-appcheck"]
_ALLOWED_METHODS = ["GET", "POST", "OPTIONS"]


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="ApplyAI API", version=settings.version)
    if settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.allowed_origins,
            allow_methods=_ALLOWED_METHODS,
            allow_headers=_ALLOWED_HEADERS,
        )
    else:
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=_DEV_ORIGIN,
            allow_methods=_ALLOWED_METHODS,
            allow_headers=_ALLOWED_HEADERS,
        )
    app.include_router(router)
    return app


app = create_app()
