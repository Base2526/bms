#!/usr/bin/env bash

set -euo pipefail

readonly BMS_RUNTIME_ROOT=/var/lib/bms-retail-local
readonly BMS_PAYLOAD_ROOT=/opt/bms-retail-local
readonly BMS_ENV_FILE="$BMS_RUNTIME_ROOT/.env"
readonly BMS_COMPOSE_FILE="$BMS_RUNTIME_ROOT/compose.yml"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ ${EUID:-$(id -u)} -eq 0 ]] || die "กรุณารันด้วย sudo"
}

require_installed() {
  [[ -f $BMS_ENV_FILE && -f $BMS_COMPOSE_FILE ]] || \
    die "ยังไม่ได้ตั้งค่าระบบ กรุณารัน sudo bms-retail-local-setup"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "ไม่พบ Docker Engine"
  docker info >/dev/null 2>&1 || die "Docker Engine ยังไม่พร้อม"
  docker compose version >/dev/null 2>&1 || die "ไม่พบ Docker Compose v2"
}

compose() {
  docker compose --env-file "$BMS_ENV_FILE" -f "$BMS_COMPOSE_FILE" "$@"
}

env_value() {
  local name=$1
  sed -n "s/^${name}=//p" "$BMS_ENV_FILE" | tail -n 1
}

wait_healthy() {
  local deadline=$((SECONDS + 240))
  local web_port ws_port
  web_port=$(env_value BMS_LOCAL_WEB_PORT)
  ws_port=$(env_value BMS_LOCAL_WS_PORT)
  while (( SECONDS < deadline )); do
    if curl --fail --silent --show-error --max-time 4 \
        "http://127.0.0.1:${web_port}/admin/login" >/dev/null 2>&1 && \
       curl --fail --silent --show-error --max-time 4 \
        "http://127.0.0.1:${ws_port}/readyz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  compose ps >&2 || true
  die "ระบบไม่ healthy ภายใน 240 วินาที กรุณารัน sudo bms-retail-local-doctor"
}
