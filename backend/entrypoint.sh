#!/usr/bin/env bash
# NAS Music Player backend entrypoint
set -e

# Ensure data directories exist
mkdir -p /app/data /app/config

echo "Starting NAS Music Player API..."
exec uvicorn app:app --host 0.0.0.0 --port 8000 --workers 4
