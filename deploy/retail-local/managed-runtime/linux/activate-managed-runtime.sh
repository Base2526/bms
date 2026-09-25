#!/usr/bin/env bash
set -Eeuo pipefail

readonly RUNTIME_ROOT=/var/lib/bms-retail-local
readonly AGENT=/opt/bms-retail-local/bms-runtime-agent
readonly ACTIVATION_URL_FILE=/etc/bms-retail-local/activation-url

die() { printf 'BMS Retail Local Activation: %s\n' "$*" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || die "กรุณารันด้วย sudo"
[[ -x $AGENT && -f $RUNTIME_ROOT/installation.json ]] || die "ยังไม่ได้ติดตั้ง Managed Runtime"
[[ -f $ACTIVATION_URL_FILE ]] || die "bootstrap package ไม่มี Activation URL"
activation_uri=$(tr -d '\r\n' <"$ACTIVATION_URL_FILE")
[[ $activation_uri =~ ^https://[^/@:]+([/:?#]|$) && $activation_uri != *'@'* ]] || die "Activation URL ไม่ปลอดภัย"

force_transfer=false
if [[ ${1:-} == --transfer ]]; then force_transfer=true
elif [[ -n ${1:-} ]]; then die "usage: sudo bms-retail-local-activate [--transfer]"
fi

read -r -s -p 'Activation Code: ' activation_code
printf '\n'
[[ -n $activation_code ]] || die "Activation Code ว่าง"
activation_result=$(curl --fail --silent --show-error --max-time 15 \
  -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg activationCode "$activation_code" '{activationCode:$activationCode}')" \
  "$activation_uri") || die "แลก Activation Code ไม่สำเร็จ; ร้านยังใช้งานได้ ให้ติดต่อ Support"
unset activation_code

license_id=$(jq -er '.licenseCode' <<<"$activation_result")
endpoint=$(jq -er '.evidenceEndpoint' <<<"$activation_result")
token=$(jq -er '.ingestionToken' <<<"$activation_result")
[[ $endpoint =~ ^https://[^/@:]+([/:?#]|$) && $endpoint != *'@'* ]] || die "evidence endpoint ไม่ปลอดภัย"

tenant_id=$(jq -er '.tenantId' "$RUNTIME_ROOT/installation.json")
pos_device_id=$(jq -er '.posDeviceId' "$RUNTIME_ROOT/installation.json")
target=$(jq -er '.platformTarget' "$RUNTIME_ROOT/installation.json")
release_version=$(jq -er '.version' "$RUNTIME_ROOT/installation.json")
event=INSTALLATION_REGISTERED
if [[ $force_transfer == true || -n $(jq -r '.licenseCode // empty' "$RUNTIME_ROOT/installation.json") ]]; then
  event=TRANSFER_REQUESTED
fi
BMS_LICENSE_EVIDENCE_TOKEN=$token "$AGENT" license-record -root "$RUNTIME_ROOT" -event "$event" \
  -license-id "$license_id" -tenant-id "$tenant_id" -pos-device-id "$pos_device_id" \
  -target "$target" -release-version "$release_version" -endpoint "$endpoint" >/dev/null || \
  die "แลก Code สำเร็จแต่ตั้งค่าหลักฐานในเครื่องไม่สำเร็จ; ร้านยังใช้งานได้ กรุณาติดต่อ Support"
jq --arg licenseCode "$license_id" '.licenseCode = $licenseCode' \
  "$RUNTIME_ROOT/installation.json" >"$RUNTIME_ROOT/installation.json.tmp"
install -m 0600 -o root -g root "$RUNTIME_ROOT/installation.json.tmp" "$RUNTIME_ROOT/installation.json"
rm -f -- "$RUNTIME_ROOT/installation.json.tmp"
unset token activation_result
printf 'Activation สำเร็จ; ร้านและข้อมูลเดิมไม่เปลี่ยนแปลง\n'
