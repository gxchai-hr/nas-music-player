"""
SQLite database models and helper functions (raw sqlite3, no ORM).
"""
import sqlite3
import os
from datetime import datetime, timezone
import config
from config import DATABASE_PATH


def get_db():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DATABASE_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create all tables if they don't exist."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            theme TEXT NOT NULL DEFAULT 'dark',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT 'Unknown',
            artist TEXT NOT NULL DEFAULT 'Unknown Artist',
            album TEXT NOT NULL DEFAULT 'Unknown Album',
            path TEXT UNIQUE NOT NULL,
            duration REAL DEFAULT 0,
            format TEXT DEFAULT '',
            file_size INTEGER DEFAULT 0,
            scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS playlist_songs (
            playlist_id INTEGER NOT NULL,
            song_id INTEGER NOT NULL,
            added_at TEXT NOT NULL DEFAULT (datetime('now')),
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (playlist_id, song_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS lyrics_cache (
            song_id INTEGER PRIMARY KEY,
            lyrics_text TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'online',
            fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
        CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album);
        CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
        CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);
        CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist ON playlist_songs(playlist_id);

        -- v1.0.6: per-user directory permissions
        -- A user's accessible directories. dir_path is a sub-path of MUSIC_DIR
        -- (forward-slash separated, e.g. "10.钱儿爸" or "摇滚/2024").
        -- Special value "" (empty string) means "root" = all music.
        CREATE TABLE IF NOT EXISTS user_directories (
            user_id INTEGER NOT NULL,
            dir_path TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (user_id, dir_path),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    """)

    conn.commit()

    # Backfill: any existing user without a user_directories row is granted
    # access to the root ("") so they keep seeing their old library.
    # New users created via the admin UI in v1.0.6+ start with an empty set.
    conn.execute("""
        INSERT OR IGNORE INTO user_directories (user_id, dir_path)
        SELECT u.id, '' FROM users u
        WHERE u.id NOT IN (SELECT DISTINCT user_id FROM user_directories)
    """)
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# User helpers
# ---------------------------------------------------------------------------

def get_user_by_username(username: str):
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_id(user_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def create_user(username: str, password_hash: str, role: str = "user"):
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (username, password_hash, role),
        )
        conn.commit()
        user = dict(conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone())
        conn.close()
        return user
    except sqlite3.IntegrityError:
        conn.close()
        return None


def list_users():
    conn = get_db()
    rows = conn.execute("SELECT id, username, role, theme, created_at FROM users").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_user(user_id: int):
    conn = get_db()
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()


def update_user_theme(user_id: int, theme: str):
    conn = get_db()
    conn.execute("UPDATE users SET theme = ? WHERE id = ?", (theme, user_id))
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Song helpers
# ---------------------------------------------------------------------------

def get_song_by_id(song_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def list_artists(dir_paths: list = None):
    """List unique artists with song counts.

    If dir_paths is provided, restrict to songs under those sub-paths of
    MUSIC_DIR. Pass an empty list [] to get nothing (user with no perms).
    Pass None (default) for no restriction.
    """
    extra_where, extra_params = _dir_paths_to_like_clause(dir_paths or [""]) \
        if dir_paths is not None else ("", [])
    conn = get_db()
    sql = (
        "SELECT artist, COUNT(*) as song_count FROM songs "
        "WHERE artist != '' AND artist != 'Unknown Artist' "
        + extra_where +
        " GROUP BY artist ORDER BY artist"
    )
    rows = conn.execute(sql, extra_params).fetchall()
    conn.close()
    return [{"name": dict(r)["artist"], "song_count": dict(r)["song_count"]} for r in rows]


def list_albums(artist: str = None, dir_paths: list = None):
    """List unique albums with song counts. See list_artists() for dir_paths."""
    where_parts = ["album != ''", "album != 'Unknown Album'"]
    params: list = []
    if artist:
        where_parts.append("artist = ?")
        params.append(artist)
    if dir_paths is not None:
        extra, extra_params = _dir_paths_to_like_clause(dir_paths)
        if extra:
            where_parts.append("(" + extra.replace(" AND ", "", 1) + ")")
            params.extend(extra_params)
    sql = (
        f"SELECT album, COUNT(*) as song_count FROM songs "
        f"WHERE {' AND '.join(where_parts)} "
        f"GROUP BY album ORDER BY album"
    )
    conn = get_db()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [{"name": dict(r)["album"], "song_count": dict(r)["song_count"]} for r in rows]


def list_songs(artist: str = None, album: str = None, dir_paths: list = None):
    """List songs filtered by artist/album/dir_paths."""
    query = "SELECT * FROM songs WHERE 1=1"
    params: list = []
    if artist:
        query += " AND artist = ?"
        params.append(artist)
    if album:
        query += " AND album = ?"
        params.append(album)
    if dir_paths is not None:
        extra, extra_params = _dir_paths_to_like_clause(dir_paths)
        query += extra
        params.extend(extra_params)
    query += " ORDER BY title"
    conn = get_db()
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def search_songs(q: str, dir_paths: list = None):
    """Search by title/artist/album. See list_artists() for dir_paths."""
    like = f"%{q}%"
    query = "SELECT * FROM songs WHERE (title LIKE ? OR artist LIKE ? OR album LIKE ?)"
    params: list = [like, like, like]
    if dir_paths is not None:
        extra, extra_params = _dir_paths_to_like_clause(dir_paths)
        query += extra
        params.extend(extra_params)
    query += " ORDER BY title"
    conn = get_db()
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def song_exists(path: str) -> bool:
    conn = get_db()
    row = conn.execute("SELECT 1 FROM songs WHERE path = ?", (path,)).fetchone()
    conn.close()
    return row is not None


def insert_song(title: str, artist: str, album: str, path: str,
                duration: float, fmt: str, file_size: int):
    conn = get_db()
    conn.execute(
        """INSERT OR REPLACE INTO songs
           (title, artist, album, path, duration, format, file_size, scanned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
        (title, artist, album, path, duration, fmt, file_size),
    )
    conn.commit()
    conn.close()


def remove_deleted_songs(existing_paths: set):
    """Delete songs from DB whose files no longer exist."""
    conn = get_db()
    all_paths = [r[0] for r in conn.execute("SELECT path FROM songs").fetchall()]
    removed = [p for p in all_paths if p not in existing_paths]
    if removed:
        conn.executemany("DELETE FROM songs WHERE path = ?", [(p,) for p in removed])
        conn.commit()
    conn.close()
    return len(removed)


# ---------------------------------------------------------------------------
# Playlist helpers
# ---------------------------------------------------------------------------

def create_playlist(user_id: int, name: str):
    conn = get_db()
    conn.execute(
        "INSERT INTO playlists (user_id, name) VALUES (?, ?)", (user_id, name)
    )
    conn.commit()
    pl = dict(conn.execute(
        "SELECT * FROM playlists WHERE user_id = ? AND name = ?", (user_id, name)
    ).fetchone())
    conn.close()
    return pl


def get_user_playlists(user_id: int):
    conn = get_db()
    playlists = conn.execute(
        "SELECT * FROM playlists WHERE user_id = ? ORDER BY created_at", (user_id,)
    ).fetchall()
    result = []
    for pl in playlists:
        pl_dict = dict(pl)
        songs = conn.execute(
            """SELECT s.* FROM songs s
               JOIN playlist_songs ps ON s.id = ps.song_id
               WHERE ps.playlist_id = ?
               ORDER BY ps.sort_order""",
            (pl_dict["id"],),
        ).fetchall()
        pl_dict["songs"] = [dict(s) for s in songs]
        result.append(pl_dict)
    conn.close()
    return result


def add_to_playlist(playlist_id: int, song_id: int):
    conn = get_db()
    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) FROM playlist_songs WHERE playlist_id = ?",
        (playlist_id,),
    ).fetchone()[0]
    conn.execute(
        "INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, sort_order) VALUES (?, ?, ?)",
        (playlist_id, song_id, max_order + 1),
    )
    conn.commit()
    conn.close()


def remove_from_playlist(playlist_id: int, song_id: int):
    conn = get_db()
    conn.execute(
        "DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?",
        (playlist_id, song_id),
    )
    conn.commit()
    conn.close()


def delete_playlist(playlist_id: int):
    conn = get_db()
    conn.execute("DELETE FROM playlist_songs WHERE playlist_id = ?", (playlist_id,))
    conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    conn.commit()
    conn.close()


def playlist_exists(playlist_id: int, user_id: int = None) -> bool:
    conn = get_db()
    if user_id is not None:
        row = conn.execute(
            "SELECT 1 FROM playlists WHERE id = ? AND user_id = ?",
            (playlist_id, user_id),
        ).fetchone()
    else:
        row = conn.execute("SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
    conn.close()
    return row is not None


# ---------------------------------------------------------------------------
# Lyrics cache helpers
# ---------------------------------------------------------------------------

def get_cached_lyrics(song_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM lyrics_cache WHERE song_id = ?", (song_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def cache_lyrics(song_id: int, lyrics_text: str, source: str = "online"):
    conn = get_db()
    conn.execute(
        """INSERT OR REPLACE INTO lyrics_cache (song_id, lyrics_text, source, fetched_at)
           VALUES (?, ?, ?, datetime('now'))""",
        (song_id, lyrics_text, source),
    )
    conn.commit()
    conn.close()

# ---------------------------------------------------------------------------
# Directory browsing helpers
# ---------------------------------------------------------------------------

def get_directory_structure(subpath: str = "", dir_paths: list = None):
    """Get directory structure for browsing.
    Returns list of {name, type, path, song_count} items.

    v1.0.6: dir_paths (None=no filter / admin, []=nothing / no perms,
    list of sub-paths=only those directories).
    """
    conn = get_db()
    base_dir = os.path.normpath(config.MUSIC_DIR)

    # Get all song paths
    rows = conn.execute("SELECT path FROM songs ORDER BY path").fetchall()
    conn.close()

    # v1.0.6: pre-filter to user's allowed paths
    if dir_paths is not None:
        if not dir_paths:
            return []  # no perms → empty
        allowed_prefixes = tuple(
            ("" if d == "" else d.replace("/", os.sep) + os.sep) for d in dir_paths
        )
        # root ("" entry) short-circuits to all
        if "" in dir_paths:
            allowed_prefixes = None
    else:
        allowed_prefixes = None

    def _allowed(song_path: str) -> bool:
        if allowed_prefixes is None:
            return True
        for prefix in allowed_prefixes:
            if not prefix:
                return True
            # v1.0.6.2: song_path is absolute (e.g. /music/10.钱儿爸/01.mp3),
            # so we cannot rely on startswith. Match if the directory
            # appears as a sub-path anywhere in the absolute path.
            if (os.sep + prefix) in song_path:
                return True
        return False

    # Extract unique directories
    dirs = set()
    songs_in_path = []

    for row in rows:
        song_path = row[0]
        if not _allowed(song_path):
            continue
        # Get relative path from music dir
        try:
            rel_path = os.path.relpath(song_path, base_dir)
        except ValueError:
            continue

        parts = rel_path.split(os.sep)

        if subpath:
            # Filter to show only items under subpath
            subpath_parts = subpath.split('/')
            if len(parts) <= len(subpath_parts):
                continue
            if parts[:len(subpath_parts)] != subpath_parts:
                continue
            # Get the next level
            if len(parts) > len(subpath_parts) + 1:
                # This is a subdirectory
                dir_name = parts[len(subpath_parts)]
                dir_path = '/'.join(subpath_parts + [dir_name])
                dirs.add(dir_path)
            else:
                # This is a song in current directory
                songs_in_path.append(song_path)
        else:
            # Root level - get top-level directories
            if len(parts) > 1:
                dirs.add(parts[0])
            else:
                songs_in_path.append(song_path)

    # Build result
    result = []
    for dir_path in sorted(dirs):
        dir_name = dir_path.split('/')[-1]
        # Count songs in this directory (recursively)
        count = 0
        for row in rows:
            song_p = row[0]
            if not _allowed(song_p):
                continue
            try:
                rel = os.path.relpath(song_p, base_dir)
                if rel.startswith(dir_path.replace('/', os.sep)):
                    count += 1
            except ValueError:
                continue
        result.append({
            "name": dir_name,
            "type": "directory",
            "path": dir_path,
            "song_count": count
        })

    # Add songs in current directory
    for song_path in songs_in_path:
        song = get_song_by_path(song_path)
        if song:
            result.append({
                "name": os.path.basename(song_path),
                "type": "song",
                "path": song_path,
                "song": song
            })

    return result


def get_song_by_path(path: str):
    """Get a song by its file path."""
    conn = get_db()
    row = conn.execute("SELECT * FROM songs WHERE path = ?", (path,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_songs_by_directory(subpath: str, dir_paths: list = None):
    """Get all songs in a directory (recursively).

    v1.0.6: dir_paths (None=no filter / admin, []=nothing / no perms,
    list of sub-paths=only those directories).
    v1.0.6.2: enforce per-user permission filter with substring match.
    """
    if dir_paths is not None and not dir_paths:
        return []  # user has no perms → empty
    if dir_paths is not None and "" not in dir_paths:
        allowed_prefixes = [d.replace("/", os.sep) for d in dir_paths if d]
    else:
        allowed_prefixes = None  # None = no filter (admin or root grant)

    conn = get_db()
    base_dir = os.path.normpath(config.MUSIC_DIR)

    rows = conn.execute("SELECT * FROM songs ORDER BY path").fetchall()
    conn.close()

    songs = []
    for row in rows:
        try:
            rel_path = os.path.relpath(row["path"], base_dir)
        except ValueError:
            continue
        # v1.0.6.2: per-user permission check (substring match on abs path)
        if allowed_prefixes is not None:
            song_abs = row["path"].replace("\\", "/")
            ok = False
            for p in allowed_prefixes:
                if (os.sep + p + os.sep) in song_abs or song_abs.endswith(os.sep + p):
                    ok = True
                    break
            if not ok:
                continue
        if rel_path.startswith(subpath.replace('/', os.sep)):
            songs.append(dict(row))

    return songs

# ---------------------------------------------------------------------------
# v1.0.6: per-user directory permissions
# ---------------------------------------------------------------------------

def get_user_directories(user_id: int) -> list:
    """Return list of dir_paths the user is allowed to see.

    Each entry is a forward-slash sub-path of MUSIC_DIR, e.g. ["10.钱儿爸",
    "摇滚"]. An empty string "" means "root" (the whole library). An empty
    list means the user sees nothing.
    """
    conn = get_db()
    rows = conn.execute(
        "SELECT dir_path FROM user_directories WHERE user_id = ? ORDER BY dir_path",
        (user_id,),
    ).fetchall()
    conn.close()
    return [r[0] for r in rows]


def set_user_directories(user_id: int, paths: list) -> None:
    """Replace the user's full set of allowed directories."""
    # Sanitize: strip, dedupe, drop empty after strip
    clean = []
    for p in paths:
        if not isinstance(p, str):
            continue
        p = p.strip().strip("/")
        if p and p not in clean:
            clean.append(p)
    conn = get_db()
    conn.execute("DELETE FROM user_directories WHERE user_id = ?", (user_id,))
    if clean:
        conn.executemany(
            "INSERT INTO user_directories (user_id, dir_path) VALUES (?, ?)",
            [(user_id, p) for p in clean],
        )
    conn.commit()
    conn.close()


def add_user_directory(user_id: int, path: str) -> bool:
    """Add a single directory to the user's set; return False if already there."""
    path = (path or "").strip().strip("/")
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO user_directories (user_id, dir_path) VALUES (?, ?)",
            (user_id, path),
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def remove_user_directory(user_id: int, path: str) -> None:
    conn = get_db()
    conn.execute(
        "DELETE FROM user_directories WHERE user_id = ? AND dir_path = ?",
        (user_id, path),
    )
    conn.commit()
    conn.close()


def list_all_directory_paths() -> list:
    """Return all unique top-level directory names found in the songs table.

    Used by the admin UI to present checkboxes when assigning permissions.
    Returns relative paths from MUSIC_DIR (forward-slash separated).
    """
    conn = get_db()
    rows = conn.execute("SELECT DISTINCT path FROM songs").fetchall()
    conn.close()
    base_dir = os.path.normpath(config.MUSIC_DIR)
    top_dirs: set = set()
    for r in rows:
        try:
            rel = os.path.relpath(r[0], base_dir)
        except ValueError:
            continue
        if rel.startswith("..") or rel == ".":
            continue
        parts = rel.split(os.sep)
        if parts and parts[0]:
            top_dirs.add(parts[0])
    return sorted(top_dirs)


# ---------------------------------------------------------------------------
# v1.0.6: dir_paths filter for query helpers
# ---------------------------------------------------------------------------

def _dir_paths_to_like_clause(dir_paths: list) -> tuple:
    """Build a (where_clause, params) for filtering songs by allowed directories.

    An empty dir_paths list returns (" AND 1=0", []) to force zero results.
    The special value "" (root) matches every path.

    v1.0.6.2: song paths in DB are absolute (e.g. /music/10.钱儿爸/01.mp3),
    so the LIKE pattern must allow arbitrary text BEFORE the directory
    prefix. We use the "%/sub-path/%" (and "%/sub-path") pattern so the
    match works regardless of where MUSIC_DIR is mounted.
    """
    if not dir_paths:
        return (" AND 1=0", [])
    clauses = []
    params = []
    for p in dir_paths:
        # Match either the root ("") or any path under this directory.
        if not p:
            return ("", [])  # root → no filter
        prefix = p.replace("/", os.sep)
        # Match if the directory appears as a sub-path ANYWHERE in the
        # absolute file path: e.g. "/music/10.钱儿爸/01.mp3" matches
        # "%/10.钱儿爸/%" and "%/10.钱儿爸". The leading "%/" is
        # required because the song path starts with the mount root
        # (/music), not the directory itself.
        clauses.append("(path LIKE ? OR path LIKE ?)")
        params.append("%" + os.sep + prefix + os.sep + "%")
        params.append("%" + os.sep + prefix)
    return (" AND (" + " OR ".join(clauses) + ")", params)



