#!/usr/bin/env bash
set -Eeuo pipefail

readonly CONFIG_DIR=/etc/bms-retail-local
readonly CONFIG_PATH=$CONFIG_DIR/offhost-backup.json
readonly SERVICE=bms-retail-local-offhost-backup.timer
die() { printf 'BMS Off-host Backup Setup: %s\n' "$*" >&2; exit 1; }

[[ ${EUID} -eq 0 ]] || die "กรุณารันด้วย sudo"
recipient=${1:-}
destination=${2:-}
retention_days=${3:-35}
[[ $recipient =~ ^age1[0-9a-z]{58}$ ]] || die "AGE_RECIPIENT ไม่ถูกต้อง"
[[ $destination == /* && $destination != / && $destination != *$'\n'* && $destination != *$'\r'* ]] || \
  die "destination ต้องเป็น absolute path ที่ไม่ใช่ filesystem root"
if [[ ! $retention_days =~ ^[0-9]+$ ]] || (( retention_days < 7 || retention_days > 365 )); then
  die "retention days ต้องอยู่ระหว่าง 7-365 วัน"
fi
[[ -d $destination ]] || die "ไม่พบ destination directory: $destination"
[[ ! -L $destination ]] || die "destination ห้ามเป็น symbolic link"
mountpoint -q "$destination" || die "destination ต้องเป็น mount point ของ NAS/removable/off-host storage"
runtime_device=$(stat -c '%d' /var/lib/bms-retail-local)
destination_device=$(stat -c '%d' "$destination")
[[ $runtime_device != "$destination_device" ]] || die "destination อยู่บน filesystem เดียวกับข้อมูลร้าน จึงไม่ใช่ off-host backup"

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
printf 'ตั้ง off-host backup สำเร็จ: %s (เก็บ %s วัน)\n' "$destination" "$retention_days"
