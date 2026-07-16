"""
NAS Music Player – FastAPI main application.
All endpoints, startup logic, and static file serving.
"""
import os
import logging
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import aiofiles

import config
from models import (
    init_db,
    get_user_by_username, get_user_by_id, create_user, list_users, delete_user,
    update_user_theme,
    get_song_by_id, list_artists, list_albums, list_songs, search_songs,
    create_playlist, get_user_playlists, add_to_playlist, remove_from_playlist,
    delete_playlist, playlist_exists,
    get_directory_structure, get_songs_by_directory,
)
from auth import (
    hash_password, verify_password, create_token,
    get_current_user, require_admin, bootstrap_admin,
)
from scanner import scan_music_directory
from lyrics import get_lyrics

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    init_db()
    bootstrap_admin()
    logger.info("NAS Music Player backend ready")
    yield
    logger.info("Shutting down")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="NAS Music Player API", version="1.0.0", lifespan=lifespan)

# Security headers middleware
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    # No cache for static files in development
    if request.url.path.startswith(("/css/", "/js/")):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    if not request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str

class CreatePlaylistRequest(BaseModel):
    name: str

class PlaylistSongRequest(BaseModel):
    song_id: int

class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "user"

    # Input validation
    def __init__(self, **data):
        super().__init__(**data)
        if len(self.username) > 50:
            raise ValueError("Username too long (max 50 chars)")
        if len(self.password) > 128:
            raise ValueError("Password too long (max 128 chars)")

class ThemeRequest(BaseModel):
    theme: str


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@app.post("/api/login")
def login(req: LoginRequest, request: Request):
    from auth import _check_rate_limit, _record_login_attempt
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)
    user = get_user_by_username(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        _record_login_attempt(client_ip)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_token(user["id"], user["role"])
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "theme": user["theme"],
        },
    }


@app.get("/api/user/profile")
def get_profile(user: dict = Depends(get_current_user)):
    return user


# ---------------------------------------------------------------------------
# Music browsing endpoints
# ---------------------------------------------------------------------------

@app.get("/api/artists")
def get_artists(user: dict = Depends(get_current_user)):
    return {"artists": list_artists()}


@app.get("/api/albums")
def get_albums(
    artist: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    return {"albums": list_albums(artist=artist)}


@app.get("/api/songs")
def get_songs(
    artist: Optional[str] = Query(None),
    album: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    return {"songs": list_songs(artist=artist, album=album)}


@app.get("/api/search")
def search(
    q: str = Query(..., min_length=1),
    user: dict = Depends(get_current_user),
):
    return {"songs": search_songs(q)}


@app.get("/api/directory")
def get_directory(
    path: str = Query(""),
    user: dict = Depends(get_current_user),
):
    """Get directory structure for browsing."""
    items = get_directory_structure(subpath=path)
    return {"items": items, "path": path}


@app.get("/api/directory/songs")
def get_directory_songs(
    path: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Get all songs in a directory."""
    songs = get_songs_by_directory(subpath=path)
    return {"songs": songs}


@app.get("/api/artists/{artist_name}")
def get_artist(artist_name: str, user: dict = Depends(get_current_user)):
    songs = list_songs(artist=artist_name)
    return {"name": artist_name, "songs": songs}


@app.get("/api/albums/{album_name}")
def get_album(album_name: str, user: dict = Depends(get_current_user)):
    songs = list_songs(album=album_name)
    return {"name": album_name, "songs": songs}


@app.get("/api/songs/{song_id}")
def get_song(song_id: int, user: dict = Depends(get_current_user)):
    song = get_song_by_id(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


# ---------------------------------------------------------------------------
# Streaming & download
# ---------------------------------------------------------------------------

@app.get("/api/stream/{song_id}")
def stream_song(song_id: int, request: Request, user: dict = Depends(get_current_user)):
    song = get_song_by_id(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    file_path = song["path"]
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Audio file missing on disk")

    file_size = os.path.getsize(file_path)
    content_type = _content_type(song.get("format", ""))

    range_header = request.headers.get("range")
    if range_header:
        return _range_response(file_path, file_size, range_header, content_type)

    return FileResponse(
        path=file_path,
        media_type=content_type,
        filename=os.path.basename(file_path),
    )


@app.get("/api/download/{song_id}")
def download_song(song_id: int, user: dict = Depends(get_current_user)):
    song = get_song_by_id(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    file_path = song["path"]
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Audio file missing on disk")

    return FileResponse(
        path=file_path,
        media_type="application/octet-stream",
        filename=os.path.basename(file_path),
    )


def _content_type(ext: str) -> str:
    mapping = {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".ogg": "audio/ogg",
        ".wav": "audio/wav",
        ".flac": "audio/flac",
        ".wma": "audio/x-ms-wma",
        ".opus": "audio/opus",
        ".aiff": "audio/aiff",
        ".ape": "audio/ape",
        ".wv": "audio/x-wavpack",
    }
    return mapping.get(ext.lower(), "application/octet-stream")


def _range_response(file_path: str, file_size: int, range_header: str, content_type: str):
    """Parse Range header and return a streaming partial response."""
    import re
    match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    if not match:
        raise HTTPException(status_code=416, detail="Invalid Range header")

    start = int(match.group(1))
    end = int(match.group(2)) if match.group(2) else file_size - 1

    if start >= file_size or end >= file_size or start > end:
        raise HTTPException(status_code=416, detail="Range Not Satisfiable")

    content_length = end - start + 1

    async def file_generator():
        async with aiofiles.open(file_path, "rb") as f:
            await f.seek(start)
            remaining = content_length
            chunk_size = 64 * 1024  # 64 KB
            while remaining > 0:
                read_size = min(chunk_size, remaining)
                data = await f.read(read_size)
                if not data:
                    break
                remaining -= len(data)
                yield data

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
        "Content-Type": content_type,
    }
    return StreamingResponse(file_generator(), status_code=206, headers=headers)


# ---------------------------------------------------------------------------
# Playlist endpoints
# ---------------------------------------------------------------------------

@app.post("/api/playlist/create")
def create_playlist_endpoint(
    req: CreatePlaylistRequest,
    user: dict = Depends(get_current_user),
):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Playlist name cannot be empty")
    pl = create_playlist(user["id"], req.name.strip())
    pl["songs"] = []
    return pl


@app.get("/api/playlists")
def get_playlists(user: dict = Depends(get_current_user)):
    return {"playlists": get_user_playlists(user["id"])}


@app.get("/api/playlists/{playlist_id}")
def get_playlist(playlist_id: int, user: dict = Depends(get_current_user)):
    if not playlist_exists(playlist_id, user["id"]):
        raise HTTPException(status_code=404, detail="Playlist not found")
    playlists = get_user_playlists(user["id"])
    for pl in playlists:
        if pl["id"] == playlist_id:
            return pl
    raise HTTPException(status_code=404, detail="Playlist not found")


@app.post("/api/playlist/{playlist_id}/add")
def add_song_to_playlist(
    playlist_id: int,
    req: PlaylistSongRequest,
    user: dict = Depends(get_current_user),
):
    if not playlist_exists(playlist_id, user["id"]):
        raise HTTPException(status_code=404, detail="Playlist not found")
    song = get_song_by_id(req.song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    add_to_playlist(playlist_id, req.song_id)
    return {"message": "Song added to playlist"}


@app.post("/api/playlist/{playlist_id}/remove")
def remove_song_from_playlist(
    playlist_id: int,
    req: PlaylistSongRequest,
    user: dict = Depends(get_current_user),
):
    if not playlist_exists(playlist_id, user["id"]):
        raise HTTPException(status_code=404, detail="Playlist not found")
    remove_from_playlist(playlist_id, req.song_id)
    return {"message": "Song removed from playlist"}


@app.delete("/api/playlist/{playlist_id}")
def delete_playlist_endpoint(
    playlist_id: int,
    user: dict = Depends(get_current_user),
):
    if not playlist_exists(playlist_id, user["id"]):
        raise HTTPException(status_code=404, detail="Playlist not found")
    delete_playlist(playlist_id)
    return {"message": "Playlist deleted"}


# ---------------------------------------------------------------------------
# Scan endpoint
# ---------------------------------------------------------------------------

@app.post("/api/scan")
def trigger_scan(
    force: bool = Query(False),
    admin: dict = Depends(require_admin),
):
    result = scan_music_directory(force_update=force)
    return {"message": "Scan complete", **result}


# ---------------------------------------------------------------------------
# Lyrics endpoint
# ---------------------------------------------------------------------------

@app.get("/api/lyrics/{song_id}")
def lyrics_endpoint(song_id: int, user: dict = Depends(get_current_user)):
    song = get_song_by_id(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    result = get_lyrics(song_id)
    if result is None:
        return {"lyrics": [], "source": None}
    return result


# ---------------------------------------------------------------------------
# Admin user management
# ---------------------------------------------------------------------------

@app.get("/api/users")
def list_all_users(admin: dict = Depends(require_admin)):
    return {"users": list_users()}


@app.post("/api/users")
def create_user_endpoint(
    req: CreateUserRequest,
    admin: dict = Depends(require_admin),
):
    if not req.username.strip():
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    if req.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")

    user = create_user(req.username.strip(), hash_password(req.password), req.role)
    if user is None:
        raise HTTPException(status_code=409, detail="Username already exists")
    user.pop("password_hash", None)
    return user


@app.delete("/api/users/{user_id}")
def delete_user_endpoint(
    user_id: int,
    admin: dict = Depends(require_admin),
):
    target = get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["username"] == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete the default admin user")
    delete_user(user_id)
    return {"message": "User deleted"}


# ---------------------------------------------------------------------------
# Theme
# ---------------------------------------------------------------------------

@app.put("/api/theme")
def update_theme(
    req: ThemeRequest,
    user: dict = Depends(get_current_user),
):
    if req.theme not in ("dark", "light"):
        raise HTTPException(status_code=400, detail="Theme must be 'dark' or 'light'")
    update_user_theme(user["id"], req.theme)
    return {"theme": req.theme}


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Static file serving for frontend
# ---------------------------------------------------------------------------

frontend_dir = config.FRONTEND_DIR
if os.path.isdir(frontend_dir):
    # Serve static frontend files (css, js, etc.)
    app.mount("/css", StaticFiles(directory=os.path.join(frontend_dir, "css")), name="css")
    app.mount("/js", StaticFiles(directory=os.path.join(frontend_dir, "js")), name="js")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Serve specific files if they exist, otherwise serve index.html (SPA)
        file_path = os.path.normpath(os.path.join(frontend_dir, full_path))
        # Security: prevent path traversal
        if not file_path.startswith(os.path.normpath(frontend_dir)):
            raise HTTPException(status_code=403, detail="Forbidden")
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        index_path = os.path.join(frontend_dir, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)
        return {"message": "NAS Music Player API is running"}
else:
    @app.get("/")
    def root():
        return {"message": "NAS Music Player API is running. Frontend not built yet."}
