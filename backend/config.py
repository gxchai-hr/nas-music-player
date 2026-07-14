"""
Configuration module for NAS Music Player backend.
All settings loaded from environment variables with sensible defaults.
"""
import os
import secrets

# Directories (expand ~ for local development)
MUSIC_DIR = os.path.expanduser(os.environ.get("MUSIC_DIR", "/music"))
DATA_DIR = os.path.expanduser(os.environ.get("DATA_DIR", "/app/data"))
CONFIG_DIR = os.path.expanduser(os.environ.get("CONFIG_DIR", "/app/config"))
FRONTEND_DIR = os.path.expanduser(os.environ.get("FRONTEND_DIR", "/app/frontend"))

# JWT secret – auto-generated random key if not provided
SECRET_KEY = os.environ.get("SECRET_KEY", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 7

# CORS origins (comma-separated in env var, or default to same-origin only)
_cors_raw = os.environ.get("CORS_ORIGINS", "")
CORS_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip()] if _cors_raw else []

# Supported audio formats
SUPPORTED_FORMATS = [
    ".mp3", ".m4a", ".aac", ".ogg", ".wav",
    ".flac", ".wma", ".opus", ".aiff", ".ape", ".wv",
]

# Database path
DATABASE_PATH = os.path.join(DATA_DIR, "music.db")

# Ensure directories exist
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(CONFIG_DIR, exist_ok=True)
os.makedirs(MUSIC_DIR, exist_ok=True)
