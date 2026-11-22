"""Firebase ID token verification, plus App Check enforcement when it is switched on.

The uid comes from the verified token and nowhere else, so a caller cannot name the
account it wants to act as.
"""

from fastapi import Depends, Header, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from firebase_admin import app_check, auth
from pydantic import BaseModel

from .config import Settings, get_settings
from .firebase import firebase_app


class Principal(BaseModel):
    uid: str


def _bearer_token(authorization: str | None) -> str:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token.")
    return token.strip()


async def require_user(
    authorization: str | None = Header(default=None),
    x_firebase_appcheck: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> Principal:
    token = _bearer_token(authorization)
    app = firebase_app(settings)

    if settings.require_app_check:
        if not x_firebase_appcheck:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing App Check token.")
        try:
            await run_in_threadpool(app_check.verify_token, x_firebase_appcheck, app=app)
        except Exception:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid App Check token.") from None

    try:
        claims = await run_in_threadpool(auth.verify_id_token, token, app=app, check_revoked=True)
    except Exception:
        # Any verification failure is the same answer to the caller: no usable credentials.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired credentials.") from None

    uid = claims.get("uid") or claims.get("sub")
    if not uid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token has no subject.")
    return Principal(uid=str(uid))
