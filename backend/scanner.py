import threading
_scan_lock = threading.Lock()

"""
Music directory scanner.
Walks MUSIC_DIR, extracts metadata via mutagen, stores in SQLite.
"""
import os
import logging
from datetime import datetime, timezone

import mutagen
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4
from mutagen.flac import FLAC
from mutagen.oggvorbis import OggVorbis
from mutagen.oggopus import OggOpus
from mutagen.wave import WAVE

import config
from models import insert_song, remove_deleted_songs, get_db

logger = logging.getLogger("scanner")

AUDIO_EXTENSIONS = set(config.SUPPORTED_FORMATS)


def _extract_metadata(filepath: str) -> dict:
    """Extract title, artist, album, duration from an audio file."""
    title = ""
    artist = ""
    album = ""
    duration = 0.0
    fmt = os.path.splitext(filepath)[1].lower()

    try:
        audio = mutagen.File(filepath, easy=True)
        if audio is not None:
            title = audio.get("title", [""])[0] if audio.get("title") else ""
            artist = audio.get("artist", [""])[0] if audio.get("artist") else ""
            album = audio.get("album", [""])[0] if audio.get("album") else ""

            # Duration
            audio_info = mutagen.File(filepath)
            if audio_info and audio_info.info:
                duration = audio_info.info.length
    except Exception as e:
        logger.debug("mutagen failed for %s: %s", filepath, e)

    # Fallback: parse directory structure /artist/album/song.ext
    # Always try if metadata is empty or contains default values
    try:
        rel = os.path.relpath(filepath, config.MUSIC_DIR)
        parts = rel.split(os.sep)
        if len(parts) >= 2:
            dir_artist = parts[0]
            # Use directory artist if current is empty or Unknown
            if not artist or artist in ('Unknown', 'Unknown Artist', ''):
                artist = dir_artist
        if len(parts) >= 3:
            dir_album = parts[1]
            # Use directory album if current is empty or Unknown
            if not album or album in ('Unknown', 'Unknown Album', ''):
                album = dir_album
    except ValueError:
        pass

    # Fallback: title from filename
    if not title:
        title = os.path.splitext(os.path.basename(filepath))[0]

    return {
        "title": title.strip() or "Unknown",
        "artist": artist.strip() or "Unknown Artist",
        "album": album.strip() or "Unknown Album",
        "duration": duration,
        "fmt": fmt,
    }


def scan_music_directory(force_update: bool = False):
    """Recursively scan MUSIC_DIR and update the database.
    If force_update=True, update metadata for existing songs too.
    """
    if _scan_lock.locked():
        return {"scanned": 0, "skipped": 0, "removed": 0, "message": "Scan already in progress"}
    with _scan_lock:
        logger.info("Starting scan of %s (force_update=%s)", config.MUSIC_DIR, force_update)

        if not os.path.isdir(config.MUSIC_DIR):
            logger.warning("Music directory does not exist: %s", config.MUSIC_DIR)
            return {"scanned": 0, "skipped": 0, "removed": 0}

        scanned = 0
        skipped = 0
        existing_paths = set()

        for root, _dirs, files in os.walk(config.MUSIC_DIR):
            for filename in files:
                ext = os.path.splitext(filename)[1].lower()
                if ext not in AUDIO_EXTENSIONS:
                    continue

                filepath = os.path.abspath(os.path.join(root, filename))
                existing_paths.add(filepath)

                try:
                    file_size = os.path.getsize(filepath)
                except OSError:
                    skipped += 1
                    continue

                meta = _extract_metadata(filepath)
                try:
                    # Check if song already exists and needs update
                    existing = song_exists(filepath)
                    if existing and not force_update:
                        scanned += 1
                        continue

                    insert_song(
                        title=meta["title"],
                        artist=meta["artist"],
                        album=meta["album"],
                        path=filepath,
                        duration=meta["duration"],
                        fmt=meta["fmt"],
                        file_size=file_size,
                    )
                    scanned += 1
                except Exception as e:
                    logger.error("Failed to insert %s: %s", filepath, e)
                    skipped += 1

    removed = remove_deleted_songs(existing_paths)
    logger.info("Scan complete: %d scanned, %d skipped, %d removed", scanned, skipped, removed)
    return {"scanned": scanned, "skipped": skipped, "removed": removed}
