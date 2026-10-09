#!/usr/bin/env bash
set -Eeuo pipefail

readonly CONFIG_DIR=/etc/bms-retail-local
readonly CONFIG_PATH=$CONFIG_DIR/offhost-backup.json
readonly SERVICE=bms-retail-local-offhost-backup.timer
die() { printf 'BMS Off-host Backup Setup: %s\n' "$*" >&2; exit 1; }

[[ ${EUID} -eq 0 ]] || die "Run this command with sudo"
recipient=${1:-}
destination=${2:-}
retention_days=${3:-35}
[[ $recipient =~ ^age1[0-9a-z]{58}$ ]] || die "AGE_RECIPIENT is invalid"
[[ $destination == /* && $destination != / && $destination != *$'\n'* && $destination != *$'\r'* ]] || \
  die "Destination must be an absolute path other than the filesystem root"
if [[ ! $retention_days =~ ^[0-9]+$ ]] || (( retention_days < 7 || retention_days > 365 )); then
  die "Retention must be between 7 and 365 days"
fi
[[ -d $destination ]] || die "Destination directory was not found: $destination"
[[ ! -L $destination ]] || die "Destination must not be a symbolic link"
mountpoint -q "$destination" || die "Destination must be a mount point for NAS, removable, or off-host storage"
runtime_device=$(stat -c '%d' /var/lib/bms-retail-local)
destination_device=$(stat -c '%d' "$destination")
[[ $runtime_device != "$destination_device" ]] || die "Destination is on the same filesystem as shop data and cannot be used for off-host backup"

install -d -m 0700 -o root -g root "$CONFIG_DIR"
temporary=$(mktemp "$CONFIG_DIR/.offhost-backup.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
jq -n --arg recipient "$recipient" --arg destination "$destination" --argjson retentionDays "$retention_days" \
  '{formatVersion:1,recipient:$recipient,destination:$destination,retentionDays:$retentionDays}' >"$temporary"
chmod 0600 "$temporary"
mv -f "$temporary" "$CONFIG_PATH"
trap - EXIT HUP INT TERM
systemctl daemon-reload
systemctl enable --now "$SERVICE"
printf 'Off-host backup configured: %s (retained for %s days)\n' "$destination" "$retention_days"
