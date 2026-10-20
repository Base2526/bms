#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed. Install Docker Desktop and run this script again." >&2
    exit 1
fi

if [ ! -f .env.dev ]; then
    echo "Missing .env.dev in $PROJECT_DIR. Configure the local development environment first." >&2
    exit 1
fi

docker compose version >/dev/null

if ! docker info >/dev/null 2>&1; then
    # Only start Desktop for a local Mac context; never change a remote context.
    docker_endpoint="${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}"
    if [ "$(uname -s)" = "Darwin" ] && [[ "$docker_endpoint" == unix://* ]]; then
        echo "Starting Docker Desktop..."
        open -a Docker
        deadline=$((SECONDS + 120))
        until docker info >/dev/null 2>&1; do
            if [ "$SECONDS" -ge "$deadline" ]; then
                echo "Docker did not become ready within 120 seconds. Check Docker Desktop and retry." >&2
                exit 1
            fi
            sleep 2
        done
    else
        echo "Docker daemon is unavailable. Start Docker or check the selected Docker context." >&2
        exit 1
    fi
fi

# Validate without printing the resolved configuration (which contains secrets).
docker compose --env-file .env.dev -f docker-compose.yml -f docker-compose.dev.yml config --quiet

# Preserve the optional Claude terminal on macOS, after Docker is ready.
if [ "$(uname -s)" = "Darwin" ] && command -v claude >/dev/null 2>&1; then
    osascript - "$PROJECT_DIR" <<'APPLESCRIPT'
on run argv
    tell application "Terminal"
        do script "cd " & quoted form of (item 1 of argv) & " && claude"
    end tell
end run
APPLESCRIPT
fi

# Foreground by default; pass -d to keep the stack running in the background.
exec docker compose \
    --env-file .env.dev \
    -f docker-compose.yml \
    -f docker-compose.dev.yml \
    up "$@"
