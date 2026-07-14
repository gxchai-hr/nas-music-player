"""
Lyrics handler.
1. Check local .lrc file (same base name as audio file).
2. If not found, fetch from a free online API.
3. Cache fetched lyrics in SQLite.
"""
import os
import re
import logging
import time
from pathlib import Path

import httpx

from models import get_cached_lyrics, cache_lyrics, get_song_by_id

logger = logging.getLogger("lyrics")

# Free Chinese lyrics API (music.163.com API proxy style)
# Using a public lyrics search endpoint
LYRICS_API_URL = "https://api.lrc.cx/lyrics"


def parse_lrc(lrc_text: str) -> list:
    """Parse .lrc format into a list of {time, text} dicts."""
    result = []
    time_pattern = re.compile(r"\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]")
    for line in lrc_text.splitlines():
        matches = time_pattern.findall(line)
        text = time_pattern.sub("", line).strip()
        if not text:
            continue
        for m in matches:
            minutes = int(m[0])
            seconds = int(m[1])
            ms = int(m[2].ljust(3, "0")) if m[2] else 0
            timestamp = minutes * 60 + seconds + ms / 1000.0
            result.append({"time": round(timestamp, 3), "text": text})
    result.sort(key=lambda x: x["time"])
    return result


def read_local_lrc(song_path: str) -> str | None:
    """Look for a .lrc file with the same base name as the audio file."""
    base = os.path.splitext(song_path)[0]
    lrc_path = base + ".lrc"
    if os.path.isfile(lrc_path):
        try:
            encodings = ["utf-8", "gbk", "gb2312", "big5", "latin-1"]
            for enc in encodings:
                try:
                    with open(lrc_path, "r", encoding=enc) as f:
                        return f.read()
                except (UnicodeDecodeError, UnicodeError):
                    continue
        except Exception as e:
            logger.error("Failed to read LRC file %s: %s", lrc_path, e)
    return None


def fetch_online_lyrics(title: str, artist: str) -> str | None:
    """Fetch lyrics from online API."""
    try:
        with httpx.Client(timeout=10) as client:
            # Try multiple search approaches
            queries = [
                f"{artist} {title}",
                title,
            ]
            for query in queries:
                try:
                    resp = client.get(
                        LYRICS_API_URL,
                        params={"q": query, "format": "lrc"},
                        follow_redirects=True,
                    )
                    if resp.status_code == 200:
                        text = resp.text.strip()
                        if text and "[" in text:
                            return text
                except Exception:
                    continue

            # Try another free endpoint as fallback
            try:
                resp = client.get(
                    "https://api.lrc.cx/search",
                    params={"q": queries[0], "format": "lrc"},
                    follow_redirects=True,
                )
                if resp.status_code == 200:
                    text = resp.text.strip()
                    if text and "[" in text:
                        return text
            except Exception:
                pass

    except Exception as e:
        logger.error("Online lyrics fetch failed: %s", e)
    return None


def get_lyrics(song_id: int) -> dict | None:
    """
    Get lyrics for a song.
    Returns: {"lyrics": [...parsed], "source": "local"|"online"|"cache"}
    """
    song = get_song_by_id(song_id)
    if not song:
        return None

    # 1. Check cache
    cached = get_cached_lyrics(song_id)
    if cached:
        try:
            parsed = parse_lrc(cached["lyrics_text"])
            if parsed:
                return {"lyrics": parsed, "source": cached["source"]}
        except Exception:
            pass

    # 2. Check local .lrc file
    song_path = song.get("path", "")
    local_lrc = read_local_lrc(song_path)
    if local_lrc:
        parsed = parse_lrc(local_lrc)
        if parsed:
            cache_lyrics(song_id, local_lrc, source="local")
            return {"lyrics": parsed, "source": "local"}

    # 3. Fetch from online API
    title = song.get("title", "")
    artist = song.get("artist", "")
    online_lrc = fetch_online_lyrics(title, artist)
    if online_lrc:
        parsed = parse_lrc(online_lrc)
        if parsed:
            cache_lyrics(song_id, online_lrc, source="online")
            return {"lyrics": parsed, "source": "online"}

    return None
