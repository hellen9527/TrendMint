"""Signed HttpOnly cookie sessions and Argon2 password hashes."""
from datetime import datetime, timedelta, timezone
import jwt
from argon2 import PasswordHasher, exceptions as argon_errors
from fastapi import HTTPException, Request, Response
from sqlalchemy.orm import Session
from app.config import settings
from app.models import User

hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=2)
COOKIE = "tm_session"

def hash_password(password: str) -> str:
    return hasher.hash(password)

def check_password(hash_: str, password: str) -> bool:
    try:
        return hasher.verify(hash_, password)
    except (argon_errors.VerifyMismatchError, argon_errors.VerificationError, argon_errors.InvalidHashError):
        return False

def set_login(response: Response, user: User) -> None:
    token = jwt.encode({"sub": str(user.id), "exp": datetime.now(timezone.utc) + timedelta(hours=12), "iss": "trendmint"}, settings.secret_key, algorithm="HS256")
    response.set_cookie(COOKIE, token, httponly=True, secure=settings.cookie_secure, samesite="lax", max_age=43200, path="/")

def clear_login(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")

def get_current_user(request: Request, db: Session) -> User:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "请先登录")
    try:
        data = jwt.decode(token, settings.secret_key, algorithms=["HS256"], issuer="trendmint")
        uid = int(data["sub"])
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise HTTPException(401, "登录已过期，请重新登录")
    user = db.get(User, uid)
    if not user:
        raise HTTPException(401, "账号不存在")
    return user

def require_admin(user: User) -> None:
    if not user.is_admin:
        raise HTTPException(403, "此操作需要管理员权限")
