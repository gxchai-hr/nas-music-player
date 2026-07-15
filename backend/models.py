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


def list_artists():
    conn = get_db()
    rows = conn.execute(
        "SELECT DISTINCT artist FROM songs WHERE artist != '' ORDER BY artist"
    ).fetchall()
    conn.close()
    return [dict(r)["artist"] for r in rows]


def list_albums(artist: str = None):
    conn = get_db()
    if artist:
        rows = conn.execute(
            "SELECT DISTINCT album FROM songs WHERE artist = ? AND album != '' ORDER BY album",
            (artist,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT DISTINCT album FROM songs WHERE album != '' ORDER BY album"
        ).fetchall()
    conn.close()
    return [dict(r)["album"] for r in rows]


def list_songs(artist: str = None, album: str = None):
    conn = get_db()
    query = "SELECT * FROM songs WHERE 1=1"
    params: list = []
    if artist:
        query += " AND artist = ?"
        params.append(artist)
    if album:
        query += " AND album = ?"
        params.append(album)
    query += " ORDER BY title"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def search_songs(q: str):
    conn = get_db()
    like = f"%{q}%"
    rows = conn.execute(
        "SELECT * FROM songs WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? ORDER BY title",
        (like, like, like),
    ).fetchall()
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

def get_directory_structure(subpath: str = ""):
    """Get directory structure for browsing.
    Returns list of {name, type, path, song_count} items.
    """
    conn = get_db()
    base_dir = os.path.normpath(config.MUSIC_DIR)
    
    # Get all song paths
    rows = conn.execute("SELECT path FROM songs ORDER BY path").fetchall()
    conn.close()
    
    # Extract unique directories
    dirs = set()
    songs_in_path = []
    
    for row in rows:
        song_path = row[0]
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
            try:
                rel = os.path.relpath(row[0], base_dir)
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


def get_songs_by_directory(subpath: str):
    """Get all songs in a directory (recursively)."""
    conn = get_db()
    base_dir = os.path.normpath(config.MUSIC_DIR)
    
    rows = conn.execute("SELECT * FROM songs ORDER BY path").fetchall()
    conn.close()
    
    songs = []
    for row in rows:
        try:
            rel_path = os.path.relpath(row["path"], base_dir)
            if rel_path.startswith(subpath.replace('/', os.sep)):
                songs.append(dict(row))
        except ValueError:
            continue
    
    return songs
