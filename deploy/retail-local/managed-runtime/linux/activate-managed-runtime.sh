#!/usr/bin/env bash
set -Eeuo pipefail

readonly RUNTIME_ROOT=/var/lib/bms-retail-local
readonly AGENT=/opt/bms-retail-local/bms-runtime-agent
readonly ACTIVATION_URL_FILE=/etc/bms-retail-local/activation-url

die() { printf 'BMS Retail Local Activation: %s\n' "$*" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || die "Run this command with sudo"
[[ -x $AGENT && -f $RUNTIME_ROOT/installation.json ]] || die "Managed Runtime is not installed"
[[ -f $ACTIVATION_URL_FILE ]] || die "Bootstrap package has no Activation URL"
activation_uri=$(tr -d '\r\n' <"$ACTIVATION_URL_FILE")
[[ $activation_uri =~ ^https://[^/@:]+([/:?#]|$) && $activation_uri != *'@'* ]] || die "Activation URL is unsafe"

force_transfer=false
if [[ ${1:-} == --transfer ]]; then force_transfer=true
elif [[ -n ${1:-} ]]; then die "usage: sudo bms-retail-local-activate [--transfer]"
fi

# Validate every local input before consuming the one-use code. A corrupt or incomplete restored
# receipt must leave the code available while support repairs the local installation metadata.
tenant_id=$(jq -er '.tenantId' "$RUNTIME_ROOT/installation.json")
pos_device_id=$(jq -er '.posDeviceId' "$RUNTIME_ROOT/installation.json")
target=$(jq -er '.platformTarget' "$RUNTIME_ROOT/installation.json")
release_version=$(jq -er '.version' "$RUNTIME_ROOT/installation.json")
event=INSTALLATION_REGISTERED
if [[ $force_transfer == true || -n $(jq -r '.licenseCode // empty' "$RUNTIME_ROOT/installation.json") ]]; then
  event=TRANSFER_REQUESTED
fi
[[ $activation_uri =~ ^(https://[^/@:]+)([/:?#]|$) ]]
endpoint="${BASH_REMATCH[1]}/api/bms/retail-local/license-evidence"

read -r -s -p 'Activation Code: ' activation_code
printf '\n'
[[ -n $activation_code ]] || die "Activation Code is empty"
activation_result=$(curl --fail --silent --show-error --max-time 15 \
  -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg activationCode "$activation_code" '{activationCode:$activationCode}')" \
  "$activation_uri") || die "Failed to redeem the Activation Code; the shop can continue operating. Contact Support"
unset activation_code

license_id=$(jq -er '.licenseCode' <<<"$activation_result")
token=$(jq -er '.ingestionToken' <<<"$activation_result")
BMS_LICENSE_EVIDENCE_TOKEN=$token "$AGENT" license-record -root "$RUNTIME_ROOT" -event "$event" \
  -license-id "$license_id" -tenant-id "$tenant_id" -pos-device-id "$pos_device_id" \
  -target "$target" -release-version "$release_version" -endpoint "$endpoint" >/dev/null || \
  die "Code redeemed, but local evidence configuration failed; the shop can continue operating. Please contact Support"
jq --arg licenseCode "$license_id" '.licenseCode = $licenseCode' \
  "$RUNTIME_ROOT/installation.json" >"$RUNTIME_ROOT/installation.json.tmp"
install -m 0600 -o root -g root "$RUNTIME_ROOT/installation.json.tmp" "$RUNTIME_ROOT/installation.json"
rm -f -- "$RUNTIME_ROOT/installation.json.tmp"
systemctl enable --now bms-retail-local-license-evidence.timer >/dev/null 2>&1 || \
  printf 'Warning: failed to schedule licensing evidence; the shop can continue operating\n' >&2
unset token activation_result
printf 'Activation completed; the existing shop and data are unchanged\n'
