#!/usr/bin/env bash
set -Eeuo pipefail

readonly CONFIG_PATH=/etc/bms-retail-local/offhost-backup.json
readonly RUNTIME_ROOT=/var/lib/bms-retail-local
readonly STATUS_PATH=$RUNTIME_ROOT/offhost-backup-status.json
local_backup=
destination=
destination_partial=
checksum_partial=
write_status() {
  local status=$1 message=$2 output=${3:-} now temporary
  now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  temporary="$STATUS_PATH.tmp"
  jq -n --arg status "$status" --arg at "$now" --arg message "$message" --arg output "$output" \
    '{formatVersion:1,status:$status,at:$at,message:$message} + (if $output == "" then {} else {output:$output} end)' >"$temporary"
  chmod 0600 "$temporary"
  mv -f "$temporary" "$STATUS_PATH"
}
failure() {
  code=$?
  write_status failed "off-host backup ไม่สำเร็จ; ตรวจ journalctl -u bms-retail-local-offhost-backup.service" || true
  [[ -z ${local_backup:-} ]] || rm -f -- "$local_backup"
  [[ -z ${destination_partial:-} ]] || rm -f -- "$destination_partial"
  [[ -z ${checksum_partial:-} ]] || rm -f -- "$checksum_partial"
  exit "$code"
}
trap failure ERR

[[ ${EUID} -eq 0 ]] || { echo "ต้องรันด้วย root" >&2; exit 1; }
[[ -f $CONFIG_PATH ]] || { echo "ยังไม่ได้ configure off-host backup" >&2; exit 1; }
recipient=$(jq -er '.recipient' "$CONFIG_PATH")
destination=$(jq -er '.destination' "$CONFIG_PATH")
retention_days=$(jq -er '.retentionDays' "$CONFIG_PATH")
[[ $recipient =~ ^age1[0-9a-z]{58}$ ]]
[[ $destination == /* && $destination != / && -d $destination && ! -L $destination ]]
[[ $retention_days =~ ^[0-9]+$ ]]
(( retention_days >= 7 && retention_days <= 365 ))
mountpoint -q "$destination"
[[ $(stat -c '%d' "$RUNTIME_ROOT") != "$(stat -c '%d' "$destination")" ]]
[[ -w $destination ]]
install -d -m 0700 "$RUNTIME_ROOT/backups"
find "$RUNTIME_ROOT/backups" -maxdepth 1 -type f -name 'scheduled-*.age' -mmin +60 -delete
find "$destination" -maxdepth 1 -type f -name '.bms-retail-local-*.partial.*' -mmin +60 -delete

timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
name="bms-retail-local-$timestamp.age"
local_backup="$RUNTIME_ROOT/backups/scheduled-$timestamp.age"
destination_partial="$destination/.$name.partial.$$"
checksum_partial="$destination/.$name.sha256.partial.$$"
bms-localctl backup "$local_backup" --recipient "$recipient" >/dev/null
install -m 0600 "$local_backup" "$destination_partial"
sync -f "$destination_partial"
mv -f "$destination_partial" "$destination/$name"
sha256=$(sha256sum "$destination/$name" | awk '{print $1}')
printf '%s  %s\n' "$sha256" "$name" >"$checksum_partial"
chmod 0600 "$checksum_partial"
mv -f "$checksum_partial" "$destination/$name.sha256"
sync -f "$destination"
destination_partial=
checksum_partial=
rm -f -- "$local_backup"
local_backup=

find "$destination" -maxdepth 1 -type f \
  \( -name 'bms-retail-local-*.age' -o -name 'bms-retail-local-*.age.sha256' \) \
  -mtime "+$retention_days" -delete
write_status passed "off-host backup สำเร็จ" "$destination/$name"
trap - ERR
printf '%s\n' "$destination/$name"
