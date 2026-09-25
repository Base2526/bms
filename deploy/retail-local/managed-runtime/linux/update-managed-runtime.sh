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

[[ ${EUID} -eq 0 ]] || die "กรุณารันด้วย sudo"
manifest_uri=${1:-}
bundle_root=${2:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}
is_https_url "$manifest_uri" || die "ต้องระบุ HTTPS release-manifest URL ที่ไม่มี credential"
[[ -f $RUNTIME_ROOT/installation.json ]] || die "ยังไม่ได้ติดตั้ง BMS Retail Local"

agent_source="$bundle_root/bms-runtime-agent"
keyring_source="$bundle_root/trusted-release-keys.json"
localctl_source="$bundle_root/bms-localctl"
transaction_source="$bundle_root/bms-update-transaction"
[[ -x $agent_source && -f $keyring_source && -f $localctl_source && -f $transaction_source ]] || \
  die "bootstrap package ไม่มี updater controls ครบ"
install -d -m 0700 -o root -g root "$BOOTSTRAP_ROOT"
install -m 0755 -o root -g root "$agent_source" "$BOOTSTRAP_ROOT/bms-runtime-agent"
install -m 0644 -o root -g root "$keyring_source" "$BOOTSTRAP_ROOT/trusted-release-keys.json"
install -m 0755 -o root -g root "$localctl_source" /usr/local/bin/bms-localctl
install -m 0755 -o root -g root "$transaction_source" /usr/local/sbin/bms-update-transaction
agent="$BOOTSTRAP_ROOT/bms-runtime-agent"

current_version=$(jq -er '.version' "$RUNTIME_ROOT/installation.json")
target=$(jq -er '.platformTarget' "$RUNTIME_ROOT/installation.json")
old_desktop="$RUNTIME_ROOT/releases/$current_version/desktop.artifact"
[[ -f $old_desktop ]] || die "ไม่พบ Desktop artifact เวอร์ชันเดิมสำหรับ rollback"
manifest_path="$RUNTIME_ROOT/release/update-release.jws.json"
curl --fail --location --proto '=https' --tlsv1.2 --max-redirs 5 --output "$manifest_path.tmp" "$manifest_uri"
chmod 0600 "$manifest_path.tmp"
mv -f "$manifest_path.tmp" "$manifest_path"

release_json=$($agent verify-update -manifest "$manifest_path" \
  -keyring "$BOOTSTRAP_ROOT/trusted-release-keys.json" -target "$target" -current-version "$current_version")
stage_json=$($agent stage-release -manifest "$manifest_path" \
  -keyring "$BOOTSTRAP_ROOT/trusted-release-keys.json" -target "$target" -root "$RUNTIME_ROOT")
release_directory=$(jq -er '.releaseDirectory' <<<"$stage_json")
[[ $release_directory == "$RUNTIME_ROOT"/releases/* ]] || die "release directory อยู่นอก runtime root"
version=$(jq -er '.releaseVersion' <<<"$release_json")

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
