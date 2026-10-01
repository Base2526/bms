#!/usr/bin/env bash
set -Eeuo pipefail

readonly RUNTIME_ROOT=/var/lib/bms-retail-local
readonly BOOTSTRAP_ROOT=/opt/bms-retail-local
die() { printf 'BMS Retail Local Update: %s\n' "$*" >&2; exit 1; }
is_https_url() { [[ ${1:-} =~ ^https://[^/@:]+([/:?#]|$) ]] && [[ ${1:-} != *'@'* ]]; }
artifact_path() {
  local name=$1
  jq -er --arg name "$name" '.components[] | select(.name == $name) | .name' <<<"$release_json" >/dev/null
  printf '%s/%s.artifact' "$release_directory" "${name//./-}"
}
run_agent_json_progress() {
  local agent_path=$1
  shift
  local output_file status
  output_file=$(mktemp)
  set +e
  "$agent_path" "$@" 2>&1 | {
    local line event phase component percent completed total heartbeat now_epoch
    local last_percent=-1 last_print=0
    while IFS= read -r line; do
      if [[ $line == BMS_PROGRESS\ * ]]; then
        event=${line#BMS_PROGRESS }
        phase=$(jq -r '.phase // "working"' <<<"$event" 2>/dev/null) || continue
        component=$(jq -r '.component // "release"' <<<"$event")
        percent=$(jq -r '.percent // 0' <<<"$event")
        completed=$(jq -r '.componentCompletedBytes // .completedBytes // 0' <<<"$event")
        total=$(jq -r '.componentTotalBytes // .totalBytes // 0' <<<"$event")
        heartbeat=$(jq -r '.heartbeat // false' <<<"$event")
        now_epoch=$(date +%s)
        if (( percent > last_percent || now_epoch - last_print >= 5 )) ||
            [[ $phase == retry || $phase == verify || $phase == staged ]]; then
          printf '  [%3d%%] %s %s - %d/%d MiB%s - %s\n' \
            "$percent" "$phase" "$component" "$((completed / 1048576))" "$((total / 1048576))" \
            "$([[ $heartbeat == true ]] && printf ' - ยังทำงานอยู่ รอข้อมูลจากเครือข่าย')" \
            "$(date '+%H:%M:%S')" >&2
          last_percent=$percent
          last_print=$now_epoch
        fi
      else
        printf '%s\n' "$line" >>"$output_file"
      fi
    done
  }
  status=${PIPESTATUS[0]}
  set -e
  if (( status != 0 )); then
    cat "$output_file" >&2
    rm -f -- "$output_file"
    return "$status"
  fi
  cat "$output_file"
  rm -f -- "$output_file"
}

[[ ${EUID} -eq 0 ]] || die "กรุณารันด้วย sudo"
manifest_uri=${1:-}
bundle_root=${2:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}
mode=${3:-apply}
is_https_url "$manifest_uri" || die "ต้องระบุ HTTPS release-manifest URL ที่ไม่มี credential"
[[ $mode == apply || $mode == check || $mode == yes ]] || die "update mode ไม่ถูกต้อง"
[[ -f $RUNTIME_ROOT/installation.json ]] || die "ยังไม่ได้ติดตั้ง BMS Retail Local"

agent_source="$bundle_root/bms-runtime-agent"
keyring_source="$bundle_root/trusted-release-keys.json"
localctl_source="$bundle_root/bms-localctl"
transaction_source="$bundle_root/bms-update-transaction"
[[ -x $agent_source && -f $keyring_source && -f $localctl_source && -f $transaction_source ]] || \
  die "bootstrap package ไม่มี updater controls ครบ"
agent="$agent_source"
"$agent" preflight >/dev/null

current_version=$(jq -er '.version' "$RUNTIME_ROOT/installation.json")
target=$(jq -er '.platformTarget' "$RUNTIME_ROOT/installation.json")
old_desktop="$RUNTIME_ROOT/releases/$current_version/desktop.artifact"
[[ -f $old_desktop ]] || die "ไม่พบ Desktop artifact เวอร์ชันเดิมสำหรับ rollback"
manifest_path="$RUNTIME_ROOT/release/update-release.jws.json"
curl --fail --location --proto '=https' --tlsv1.2 --max-redirs 5 \
  --connect-timeout 20 --max-time 60 --speed-limit 1 --speed-time 20 \
  --retry 2 --retry-max-time 180 --output "$manifest_path.tmp" "$manifest_uri"
chmod 0600 "$manifest_path.tmp"
mv -f "$manifest_path.tmp" "$manifest_path"

verify_command=verify-update
[[ $mode != check ]] || verify_command=check-update
release_json=$($agent "$verify_command" -manifest "$manifest_path" \
  -keyring "$keyring_source" -target "$target" -current-version "$current_version")
if [[ $mode == check && $(jq -r '.updateAvailable' <<<"$release_json") != true ]]; then
  printf 'BMS Retail Local เป็นเวอร์ชันล่าสุดแล้ว: %s\n' "$current_version"
  exit 0
fi
version=$(jq -er '.releaseVersion' <<<"$release_json")
channel=$(jq -er '.channel' <<<"$release_json")
schema_version=$(jq -er '.schemaVersion' <<<"$release_json")
created_at=$(jq -er '.createdAt' <<<"$release_json")
total_bytes=$(jq -er '[.components[].sizeBytes] | add' <<<"$release_json")
rollback_mode=$(jq -r 'if .rollbackSafe then "image-only" else "full database/files/secrets restore" end' <<<"$release_json")
printf 'พบ BMS Retail Local update ที่ตรวจลายเซ็นแล้ว\n'
printf '  version: %s -> %s\n' "$current_version" "$version"
printf '  channel: %s\n' "$channel"
printf '  schema: %s\n' "$schema_version"
printf '  download: %s bytes\n' "$total_bytes"
printf '  rollback: %s\n' "$rollback_mode"
printf '  published: %s\n' "$created_at"
if [[ $mode == check ]]; then
  printf 'ยังไม่ได้ดาวน์โหลด component หรือติดตั้ง update\n'
  exit 0
fi
if [[ $mode != yes ]]; then
  [[ -t 0 ]] || die "ต้องยืนยันแบบ interactive หรือเรียกด้วย --yes หลังแสดงรายละเอียดให้ operator แล้ว"
  read -r -p 'พิมพ์ UPDATE เพื่อสร้าง backup และเริ่มติดตั้ง: ' confirmation
  [[ $confirmation == UPDATE ]] || die "ยกเลิก update"
fi
install -d -m 0700 -o root -g root "$BOOTSTRAP_ROOT"
install -m 0755 -o root -g root "$agent_source" "$BOOTSTRAP_ROOT/bms-runtime-agent"
install -m 0644 -o root -g root "$keyring_source" "$BOOTSTRAP_ROOT/trusted-release-keys.json"
install -m 0755 -o root -g root "$localctl_source" /usr/local/bin/bms-localctl
install -m 0755 -o root -g root "$transaction_source" /usr/local/sbin/bms-update-transaction
agent="$BOOTSTRAP_ROOT/bms-runtime-agent"
/usr/local/sbin/bms-update-transaction prepare
stage_json=$(run_agent_json_progress "$agent" stage-release -manifest "$manifest_path" \
  -keyring "$BOOTSTRAP_ROOT/trusted-release-keys.json" -target "$target" -root "$RUNTIME_ROOT" -progress)
release_directory=$(jq -er '.releaseDirectory' <<<"$stage_json")
[[ $release_directory == "$RUNTIME_ROOT"/releases/* ]] || die "release directory อยู่นอก runtime root"

while IFS=$'\t' read -r name image_ref digest; do
  "$agent" engine-load -engine linux-native -artifact "$(artifact_path "$name")" \
    -image-ref "$image_ref" -digest "$digest"
done < <(jq -r '.components[] | select(.kind == "oci-image") | [.name,.imageRef,.ociDigest] | @tsv' <<<"$release_json")

transaction_dir="$RUNTIME_ROOT/updates/$version"
install -d -m 0700 -o root -g root "$transaction_dir"
install -m 0600 "$(artifact_path compose)" "$transaction_dir/compose.next.yml"
jq --arg version "$version" --arg updatedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg sourceCommit "$(jq -r '.sourceCommit' <<<"$release_json")" \
  --arg schemaVersion "$(jq -r '.schemaVersion' <<<"$release_json")" \
  '.version=$version | .updatedAt=$updatedAt | .sourceCommit=$sourceCommit | .schemaVersion=$schemaVersion' \
  "$RUNTIME_ROOT/installation.json" >"$transaction_dir/installation.next.json"
chmod 0600 "$transaction_dir/installation.next.json"

declare -A ref
while IFS=$'\t' read -r name image_ref; do ref[$name]=$image_ref; done \
  < <(jq -r '.components[] | select(.kind == "oci-image") | [.name,.imageRef] | @tsv' <<<"$release_json")
rollback_safe=$(jq -r 'if .rollbackSafe then "1" else "0" end' <<<"$release_json")

if ! /usr/local/sbin/bms-update-transaction begin "$version" "$rollback_safe" \
  "${ref[web]}" "${ref[ws]}" "${ref[postgres]}" "${ref[redis]}"; then
  die "runtime update ไม่สำเร็จ; ระบบ rollback แล้วหรือเก็บ transaction ไว้ให้ recover"
fi

desktop_artifact=$(artifact_path desktop)
if ! dpkg -i "$desktop_artifact"; then
  if ! apt-get install -f -y || ! dpkg -i "$desktop_artifact"; then
    /usr/local/sbin/bms-update-transaction rollback "$version" || true
    dpkg -i "$old_desktop" >/dev/null 2>&1 || true
    die "Desktop update ไม่สำเร็จ; runtime ถูก rollback"
  fi
fi
/usr/local/sbin/bms-update-transaction commit "$version"

profile="$RUNTIME_ROOT/license-evidence/profile.json"
if [[ -f $profile ]]; then
  license_args=(license-record -root "$RUNTIME_ROOT" -event UPDATE_INSTALLED
    -license-id "$(jq -er '.licenseId' "$profile")" -tenant-id "$(jq -r '.tenantId // empty' "$profile")"
    -pos-device-id "$(jq -r '.posDeviceId // empty' "$profile")" -target "$target" -release-version "$version")
  endpoint=$(jq -r '.evidenceEndpoint // empty' "$profile")
  evidence_token=$(jq -r '.evidenceToken // empty' "$profile")
  [[ -z $endpoint || -z $evidence_token ]] || license_args+=(-endpoint "$endpoint")
  BMS_LICENSE_EVIDENCE_TOKEN="$evidence_token" "$agent" "${license_args[@]}" >/dev/null 2>&1 || true
fi

printf 'BMS Retail Local update สำเร็จ: %s -> %s\n' "$current_version" "$version"
