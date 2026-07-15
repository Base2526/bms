#!/usr/bin/env bash

set -e

PROJECT_DIR="$(pwd)"

# เปิด Claude ก่อน
osascript <<EOF
tell application "Terminal"
    do script "cd \"$PROJECT_DIR\" && claude"
end tell
EOF

# รัน Docker แบบ foreground
exec docker compose \
    --env-file .env.dev \
    -f docker-compose.yml \
    -f docker-compose.dev.yml \
    up