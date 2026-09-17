import time
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt

from config import settings

ALGORITHM = "HS256"
TOKEN_TTL_SECONDS = 12 * 3600


def create_token(user_id: str, role: str, name: str, email: str) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "role": role,
        "name": name,
        "email": email,
        "iat": now,
        "exp": now + TOKEN_TTL_SECONDS,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token(token)
    return {
        "id": payload.get("sub"),
        "role": payload.get("role", "viewer"),
        "name": payload.get("name"),
        "email": payload.get("email"),
    }


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required for this operation",
        )
    return user
