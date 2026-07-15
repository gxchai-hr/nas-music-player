"""
Authentication module – JWT tokens, password hashing, role checks.
"""
import os
import json
import time
from datetime import datetime, timedelta, timezone
from functools import wraps
from collections import defaultdict

import bcrypt
import jwt
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

import config
from models import get_user_by_id, create_user, get_user_by_username

security = HTTPBearer()


# ---------------------------------------------------------------------------
# Rate limiter (simple in-memory)
# ---------------------------------------------------------------------------
_login_attempts: dict = defaultdict(list)  # ip -> [timestamp, ...]
_MAX_LOGIN_ATTEMPTS = 10
_LOGIN_WINDOW = 300  # 5 minutes


def _check_rate_limit(ip: str):
    """Raise 429 if too many login attempts from same IP."""
    now = time.time()
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < _LOGIN_WINDOW]
    if len(_login_attempts[ip]) >= _MAX_LOGIN_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many login attempts, try again later")


def _record_login_attempt(ip: str):
    _login_attempts[ip].append(time.time())


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_token(user_id: int, role: str = "user") -> str:
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=config.JWT_EXPIRY_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, config.SECRET_KEY, algorithm=config.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, config.SECRET_KEY, algorithms=[config.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Extract and validate current user from Bearer token."""
    payload = decode_token(credentials.credentials)
    user_id = int(payload.get("sub", 0))
    user = get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    user.pop("password_hash", None)
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Dependency that ensures the current user is an admin."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ---------------------------------------------------------------------------
# Bootstrap: create default admin on first run
# ---------------------------------------------------------------------------

def bootstrap_admin():
    """Create users from config/users.json (plaintext passwords, hashed on first run)."""
    users_json_path = os.path.join(config.CONFIG_DIR, "users.json")

    if os.path.exists(users_json_path):
        try:
            with open(users_json_path, "r", encoding="utf-8") as f:
                users_data = json.load(f)
            # Support both formats: {"users": [...]} or [...]
            if isinstance(users_data, dict):
                users_list = users_data.get("users", [])
            else:
                users_list = users_data
            for u in users_list:
                existing = get_user_by_username(u["username"])
                if not existing:
                    pw = u.get("password", "")
                    if not pw:
                        continue
                    create_user(u["username"], hash_password(pw), u.get("role", "admin"))
            return
        except (json.JSONDecodeError, KeyError):
            pass

    # Fallback: create admin only if no users exist at all
    from models import get_db
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    conn.close()
    if count == 0:
        import secrets
        initial_pw = secrets.token_urlsafe(8)
        create_user("admin", hash_password(initial_pw), "admin")
        print(f"\n{'='*60}")
        print(f"  初始管理员账户已创建:")
        print(f"  用户名: admin")
        print(f"  密码:   {initial_pw}")
        print(f"  请登录后立即修改密码！")
        print(f"{'='*60}\n")
# Force rebuild 2026年07月15日 12:01:49
