#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -eq 0 ]] || { echo "Run this command with sudo" >&2; exit 1; }

progress() { printf '\n[BMS Uninstall %s/4] %s\n' "$1" "$2"; }
stop_unit_bounded() {
  local unit=$1 seconds=$2
  if timeout "${seconds}s" systemctl stop "$unit" >/dev/null 2>&1; then
    return 0
  fi
  printf 'Warning: %s did not stop within %s seconds. Forcing it to stop and continuing\n' \
    "$unit" "$seconds" >&2
  timeout 3s systemctl kill --kill-who=all "$unit" >/dev/null 2>&1 || true
  systemctl reset-failed "$unit" >/dev/null 2>&1 || true
  return 1
}
force_stop_containers() {
  [[ -f /var/lib/bms-retail-local/compose.yml && -f /var/lib/bms-retail-local/.env ]] || return 0
  timeout 5s docker compose --env-file /var/lib/bms-retail-local/.env \
    -f /var/lib/bms-retail-local/compose.yml kill >/dev/null 2>&1 || true
}

progress 1 "Disable startup, timers, and background tasks"
for unit in \
  bms-retail-local.service \
  bms-retail-local-license-evidence.timer \
  bms-retail-local-license-ui.timer \
  bms-retail-local-offhost-backup.timer; do
  systemctl disable "$unit" >/dev/null 2>&1 || true
done
stop_unit_bounded bms-retail-local-license-evidence.timer 3 || true
stop_unit_bounded bms-retail-local-license-ui.timer 3 || true
stop_unit_bounded bms-retail-local-offhost-backup.timer 3 || true
stop_unit_bounded bms-retail-local-license-evidence.service 5 || true
stop_unit_bounded bms-retail-local-license-ui.service 5 || true
stop_unit_bounded bms-retail-local-offhost-backup.service 5 || true

progress 2 "Record uninstall status and stop services"
# Commercial evidence is best-effort and must never hold up uninstall.
timeout 3s /opt/bms-retail-local/bms-runtime-agent license-pulse \
  -root /var/lib/bms-retail-local -event INSTALLATION_DEACTIVATED >/dev/null 2>&1 || true
if [[ -s /etc/bms-retail-local/activation-url && -f /var/lib/bms-retail-local/installation.json ]]; then
  timeout 5s /opt/bms-retail-local/bms-runtime-agent installation-report \
    -root /var/lib/bms-retail-local -control-uri "$(tr -d '\r\n' </etc/bms-retail-local/activation-url)" \
    -event UNINSTALLED -package-type "$(jq -r '.packageType // "server-pos"' /var/lib/bms-retail-local/installation.json)" \
    -target "$(jq -r '.platformTarget' /var/lib/bms-retail-local/installation.json)" \
    -release-version "$(jq -r '.version' /var/lib/bms-retail-local/installation.json)" \
    -tenant-reference "$(jq -r '.tenantId // empty' /var/lib/bms-retail-local/installation.json)" \
    -license-reference "$(jq -r '.licenseCode // empty' /var/lib/bms-retail-local/installation.json)" -force \
    >/dev/null 2>&1 || true
fi
if ! stop_unit_bounded bms-retail-local.service 10; then
  force_stop_containers
fi

progress 3 "Remove automatic startup entries"
rm -f /etc/systemd/system/bms-retail-local.service
rm -f /etc/systemd/system/bms-retail-local-offhost-backup.service \
  /etc/systemd/system/bms-retail-local-offhost-backup.timer \
  /etc/systemd/system/bms-retail-local-license-evidence.service \
  /etc/systemd/system/bms-retail-local-license-ui.service \
  /etc/systemd/system/bms-retail-local-license-ui.timer \
  /etc/systemd/system/bms-retail-local-license-evidence.timer
systemctl daemon-reload

if [[ ${1:-} != --erase-data ]]; then
  progress 4 "Completed; shop data retained"
  echo "Automatic startup stopped and disabled. Shop data and secrets remain in /var/lib/bms-retail-local"
  echo "Run bms-localctl backup first. Use --erase-data only for permanent deletion"
  exit 0
fi

read -r -p 'Permanent deletion cannot be undone. Type ERASE-BMS-RETAIL-LOCAL: ' answer
[[ $answer == ERASE-BMS-RETAIL-LOCAL ]] || { echo "Data deletion cancelled" >&2; exit 1; }
if [[ -f /var/lib/bms-retail-local/compose.yml && -f /var/lib/bms-retail-local/.env ]]; then
  timeout 45s docker compose --env-file /var/lib/bms-retail-local/.env \
    -f /var/lib/bms-retail-local/compose.yml down --timeout 5 --volumes --remove-orphans || {
      echo "Failed to remove containers/volumes. Shop data has not been deleted. Try again or contact Support" >&2
      exit 1
    }
fi
rm -rf -- /var/lib/bms-retail-local
rm -rf -- /opt/bms-retail-local
rm -f /usr/local/bin/bms-localctl /usr/local/sbin/bms-retail-local-uninstall \
  /usr/local/sbin/bms-retail-local-offhost-backup
progress 4 "System and shop data deleted"
echo "BMS Retail Local and its local data have been deleted"
