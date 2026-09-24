#!/usr/bin/env bash
set -Eeuo pipefail

readonly RUNTIME_ROOT="/var/lib/bms-retail-local"
readonly BOOTSTRAP_ROOT="/opt/bms-retail-local"
readonly SERVICE_NAME="bms-retail-local.service"

die() { printf 'BMS Retail Local Setup: %s\n' "$*" >&2; exit 1; }
require_root() { [[ ${EUID} -eq 0 ]] || die "กรุณารันด้วย sudo"; }
is_https_url() { [[ ${1:-} =~ ^https://[^/@:]+([/:?#]|$) ]] && [[ ${1:-} != *'@'* ]]; }
random_hex() { od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'; }
artifact_path() {
  local name=$1
  jq -er --arg name "$name" '.components[] | select(.name == $name) | .name' <<<"$release_json" >/dev/null
  printf '%s/%s.artifact' "$release_directory" "${name//./-}"
}
shell_export() {
  local name=$1 value=$2 encoded
  encoded=$(printf '%s' "$value" | base64 -w 0)
  printf "export %s=\"\$(printf '%%s' '%s' | base64 -d)\"\n" "$name" "$encoded"
}
cleanup() {
  [[ -n ${provision_script:-} ]] && rm -f -- "$provision_script"
  [[ -n ${handoff_path:-} && ! -e ${handoff_path:-} ]] || true
}
trap cleanup EXIT

require_root
[[ -n ${SUDO_USER:-} && $SUDO_USER != root ]] || die "ให้ผู้ใช้หน้าเครื่องรันผ่าน sudo; ห้าม login เป็น root โดยตรง"
operator_uid_preflight=$(id -u "$SUDO_USER")
[[ -d /run/user/$operator_uid_preflight ]] || die "ไม่พบ graphical user session ของ $SUDO_USER"
[[ -n ${DISPLAY:-} || -n ${WAYLAND_DISPLAY:-} ]] || die "ต้องติดตั้งจาก Ubuntu Desktop session"
manifest_uri=${1:-}
bundle_root=${2:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}
is_https_url "$manifest_uri" || die "ต้องระบุ HTTPS release-manifest URL ที่ไม่มี credential เป็น argument แรก"
[[ ! -f $RUNTIME_ROOT/installation.json ]] || die "ติดตั้งอยู่แล้ว; ห้ามรัน installer ซ้ำ ให้ใช้ updater ที่ผ่านการ verify"
agent_source="$bundle_root/bms-runtime-agent"
keyring_source="$bundle_root/trusted-release-keys.json"
localctl_source="$bundle_root/bms-localctl"
[[ -f $localctl_source ]] || localctl_source="$bundle_root/../runtime-rootfs/bms-localctl"
[[ -x $agent_source && -f $keyring_source && -f $localctl_source ]] || die "installer bundle ไม่มี agent/keyring/localctl"

install -d -m 0700 -o root -g root "$BOOTSTRAP_ROOT" "$RUNTIME_ROOT" "$RUNTIME_ROOT/release"
install -m 0755 -o root -g root "$agent_source" "$BOOTSTRAP_ROOT/bms-runtime-agent"
install -m 0644 -o root -g root "$keyring_source" "$BOOTSTRAP_ROOT/trusted-release-keys.json"
agent="$BOOTSTRAP_ROOT/bms-runtime-agent"

preflight_json=$($agent preflight) || die "เครื่องนี้ไม่ผ่าน preflight"
target=$(jq -er '.target' <<<"$preflight_json")

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends age ca-certificates curl gnome-keyring jq libsecret-1-0 docker.io
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends docker-compose-v2 || \
    apt-get install -y --no-install-recommends docker-compose-plugin || \
    die "ติดตั้ง Docker Compose v2 จาก Ubuntu repository ไม่สำเร็จ"
fi
systemctl enable --now docker.service
docker info >/dev/null 2>&1 || die "Moby/Docker runtime ไม่พร้อม"
install -m 0755 -o root -g root "$localctl_source" /usr/local/bin/bms-localctl
install -m 0755 -o root -g root "$bundle_root/uninstall-managed-runtime.sh" /usr/local/sbin/bms-retail-local-uninstall

manifest_path="$RUNTIME_ROOT/release/release.jws.json"
curl --fail --location --proto '=https' --tlsv1.2 --max-redirs 5 --output "$manifest_path" "$manifest_uri"
chmod 0600 "$manifest_path"
stage_json=$($agent stage-release -manifest "$manifest_path" \
  -keyring "$BOOTSTRAP_ROOT/trusted-release-keys.json" -target "$target" -root "$RUNTIME_ROOT")
release_json=$($agent verify-release -manifest "$manifest_path" \
  -keyring "$BOOTSTRAP_ROOT/trusted-release-keys.json" -target "$target")
release_directory=$(jq -er '.releaseDirectory' <<<"$stage_json")
[[ $release_directory == "$RUNTIME_ROOT"/releases/* ]] || die "release directory อยู่นอก runtime root"

while IFS=$'\t' read -r name image_ref digest; do
  artifact=$(artifact_path "$name")
  [[ -f $artifact ]] || die "ไม่พบ artifact $name"
  "$agent" engine-load -engine linux-native -artifact "$artifact" -image-ref "$image_ref" -digest "$digest"
done < <(jq -r '.components[] | select(.kind == "oci-image") | [.name,.imageRef,.ociDigest] | @tsv' <<<"$release_json")

compose_artifact=$(artifact_path compose)
"$agent" runtime-write -engine linux-native -source "$compose_artifact" \
  -destination "$RUNTIME_ROOT/compose.yml" -mode 0600

declare -A image_ref
while IFS=$'\t' read -r name ref; do image_ref[$name]=$ref; done \
  < <(jq -r '.components[] | select(.kind == "oci-image") | [.name,.imageRef] | @tsv' <<<"$release_json")
umask 077
if [[ ! -f $RUNTIME_ROOT/.env ]]; then
cat >"$RUNTIME_ROOT/.env" <<EOF
POSTGRES_DB=bms_local
POSTGRES_PASSWORD=$(random_hex 24)
REDIS_PASSWORD=$(random_hex 24)
JWT_SECRET=$(random_hex 48)
BMS_SECRET_KEY=$(random_hex 32)
BMS_CHECKOUT_SECRET=$(random_hex 48)
BMS_CRON_SECRET=$(random_hex 32)
BMS_JOB_TOKEN=$(random_hex 32)
BMS_LOCAL_WEB_PORT=3100
BMS_LOCAL_WS_PORT=3101
BMS_WEB_IMAGE_REF=${image_ref[web]}
BMS_WS_IMAGE_REF=${image_ref[ws]}
BMS_POSTGRES_IMAGE_REF=${image_ref[postgres]}
BMS_REDIS_IMAGE_REF=${image_ref[redis]}
EOF
fi

read -r -p 'ชื่อร้าน: ' shop_name
read -r -p 'ชื่อผู้ดูแลร้าน: ' admin_name
read -r -p 'อีเมลผู้ดูแลร้าน: ' admin_email
read -r -s -p 'รหัสผ่านผู้ดูแล (อย่างน้อย 8 ตัวอักษร): ' admin_password; printf '\n'
read -r -s -p 'PIN ขายหน้าร้าน (ตัวเลข 4-8 หลัก): ' admin_pin; printf '\n'
for value in "$shop_name" "$admin_name" "$admin_email" "$admin_password" "$admin_pin"; do
  [[ -n $value && $value != *$'\n'* && $value != *$'\r'* ]] || die "ข้อมูล setup ไม่ถูกต้อง"
done

provision_script="$RUNTIME_ROOT/provision-once.sh"
{
  printf '#!/bin/sh\nset -eu\n'
  shell_export BMS_LOCAL_SHOP_NAME "$shop_name"
  shell_export BMS_LOCAL_SHOP_SLUG local-shop
  shell_export BMS_LOCAL_ADMIN_NAME "$admin_name"
  shell_export BMS_LOCAL_ADMIN_EMAIL "$admin_email"
  shell_export BMS_LOCAL_ADMIN_PASSWORD "$admin_password"
  shell_export BMS_LOCAL_ADMIN_PIN "$admin_pin"
  printf 'cd %s\ndocker compose --env-file .env -f compose.yml --profile setup run --rm provision\n' "$RUNTIME_ROOT"
} >"$provision_script"
chmod 0700 "$provision_script"
unset admin_password admin_pin
provision_output=$($provision_script) || die "provision ร้านไม่สำเร็จ"
rm -f -- "$provision_script"; provision_script=
provision_result=$(grep -E '^\{"status"' <<<"$provision_output" | tail -n 1)
jq -e . >/dev/null <<<"$provision_result" || die "ไม่พบผล provisioning ที่อ่านได้"

install -m 0644 -o root -g root "$bundle_root/bms-retail-local.service" "/etc/systemd/system/$SERVICE_NAME"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

deadline=$((SECONDS + 240))
until curl --fail --silent --max-time 5 http://127.0.0.1:3100/admin/login >/dev/null && \
      curl --fail --silent --max-time 5 http://127.0.0.1:3101/readyz >/dev/null; do
  (( SECONDS < deadline )) || die "บริการไม่ผ่าน HTTP health check"
  sleep 3
done

desktop_artifact=$(artifact_path desktop)
dpkg -i "$desktop_artifact" || { apt-get install -f -y; dpkg -i "$desktop_artifact"; }

operator=${SUDO_USER:-root}
operator_uid=$(id -u "$operator")
operator_gid=$(id -g "$operator")
device_token=$(jq -er '.deviceToken // empty' <<<"$provision_result" || true)
if [[ -n $device_token && $operator != root ]]; then
  handoff_path="/run/user/$operator_uid/bms-pairing-handoff.json"
  install -d -m 0700 -o "$operator_uid" -g "$operator_gid" "/run/user/$operator_uid"
  expires_at=$(date -u -d '+10 minutes' '+%Y-%m-%dT%H:%M:%SZ')
  jq -n --arg token "$device_token" --arg expiresAt "$expires_at" \
    '{version:1,serverUrl:"http://127.0.0.1:3100",token:$token,expiresAt:$expiresAt}' >"$handoff_path"
  chown "$operator_uid:$operator_gid" "$handoff_path"; chmod 0600 "$handoff_path"
  runuser -u "$operator" -- env DISPLAY="${DISPLAY:-}" WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-}" \
    XDG_RUNTIME_DIR="/run/user/$operator_uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$operator_uid/bus" \
    bms-pos "--pairing-handoff=$handoff_path" >/dev/null 2>&1 &
fi
unset device_token provision_result provision_output

jq -n --arg version "$(jq -r '.releaseVersion' <<<"$release_json")" --arg target "$target" \
  --arg installedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  '{product:"BMS Retail Local",version:$version,platformTarget:$target,installedAt:$installedAt,url:"http://127.0.0.1:3100"}' \
  >"$RUNTIME_ROOT/installation.json"
chmod 0600 "$RUNTIME_ROOT/installation.json"
printf 'BMS Retail Local พร้อมใช้งาน: http://127.0.0.1:3100\n'
