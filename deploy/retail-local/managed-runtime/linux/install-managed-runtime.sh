#!/usr/bin/env bash
set -Eeuo pipefail

readonly RUNTIME_ROOT="/var/lib/bms-retail-local"
readonly BOOTSTRAP_ROOT="/opt/bms-retail-local"
readonly SERVICE_NAME="bms-retail-local.service"

die() { BMS_DIAG_REASON=$*; BMS_DIAG_LINE=${BASH_LINENO[0]}; printf 'BMS Retail Local Setup: %s\n' "$*" >&2; exit 1; }
step() { BMS_DIAG_STAGE="step-$1-of-7"; printf '\n[BMS %s/7] %s\n' "$1" "$2"; }
require_root() { [[ ${EUID} -eq 0 ]] || die "Run this command with sudo"; }
is_https_url() { [[ ${1:-} =~ ^https://[^/@:]+([/:?#]|$) ]] && [[ ${1:-} != *'@'* ]]; }
random_hex() { od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'; }
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
            "$([[ $heartbeat == true ]] && printf ' - Still working; waiting for network data')" \
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
shell_export() {
  local name=$1 value=$2 encoded
  encoded=$(printf '%s' "$value" | base64 -w 0)
  printf "export %s=\"\$(printf '%%s' '%s' | base64 -d)\"\n" "$name" "$encoded"
}
choose_archetype() {
  local manifest=$archetype_manifest
  [[ -f $manifest ]] || die "The signed release shop-archetypes manifest was not found"
  jq -e '
    .defaultArchetype as $default |
    .formatVersion == 1 and
    (.defaultArchetype | type == "string") and
    ([.archetypes[].id] | length == (unique | length)) and
    ([.archetypes[] | select(.enabledForNewInstall == true and .deprecated != true)] | length > 0) and
    ([.archetypes[] | select(.enabledForNewInstall == true and .deprecated != true) | .id] | index($default) != null)
  ' "$manifest" >/dev/null || die "Invalid shop-archetypes manifest"
  local labels=() values=() default_value default_index=1 id label
  default_value=$(jq -r '.defaultArchetype' "$manifest")
  while IFS=$'\t' read -r id label; do
    [[ $id =~ ^[a-z][a-z0-9_]{1,63}$ && -n $label ]] || die "Invalid data in shop-archetypes manifest"
    values+=("$id"); labels+=("$label")
    [[ $id == "$default_value" ]] && default_index=${#values[@]}
  done < <(jq -r '.archetypes[] | select(.enabledForNewInstall == true and .deprecated != true) | [.id, ((.labels.en | select(type == "string" and test("\\S"))) // .id)] | @tsv' "$manifest")
  printf '\nShop type (used for defaults and sample products)\n' >&2
  local index
  for index in "${!labels[@]}"; do printf '  %d. %s\n' "$((index + 1))" "${labels[$index]}" >&2; done
  while true; do
    read -r -p "Select a number [$default_index]: " index
    index=${index:-$default_index}
    if [[ $index =~ ^[0-9]+$ ]] && (( index >= 1 && index <= ${#values[@]} )); then
      printf '%s' "${values[$((index - 1))]}"
      return
    fi
    printf 'Enter a number from 1 to %d\n' "${#values[@]}" >&2
  done
}
choose_sample_mode() {
  local choice
  printf '\nStarter Catalog creates draft sample products with zero stock, not ready for sale\n' >&2
  while true; do
    read -r -p 'Create a Starter Catalog for this shop type? [Y/n]: ' choice
    case ${choice:-Y} in
      Y|y) printf 'STARTER_CATALOG'; return ;;
      N|n) printf 'NONE'; return ;;
      *) printf 'Enter Y or N\n' >&2 ;;
    esac
  done
}
sample_result_is_complete() {
  local result=$1 archetype=$2
  jq -e --arg archetype "$archetype" '
    (.status == "COMPLETED" or .status == "ALREADY_COMPLETED") and
    (.completedSteps | type == "array") and
    (.completedSteps | index("products") != null) and
    ($archetype != "restaurant" or (.completedSteps | index("restaurant_layout") != null))
  ' <<<"$result" >/dev/null 2>&1
}
cleanup() {
  [[ -n ${provision_script:-} ]] && rm -f -- "$provision_script"
  [[ -n ${handoff_path:-} && ! -e ${handoff_path:-} ]] || true
}
write_runtime_text() {
  local destination=$1 temporary
  temporary=$(mktemp "$RUNTIME_ROOT/.setup-write.XXXXXX")
  cat >"$temporary"
  "$agent" runtime-write -engine linux-native -source "$temporary" -destination "$destination" -mode 0600
  rm -f -- "$temporary"
}
bundle_root=${2:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}
package_type=server-pos
if [[ -f $RUNTIME_ROOT/installation.json ]]; then
  installed_package_type=$(jq -r '.packageType // empty' "$RUNTIME_ROOT/installation.json" 2>/dev/null || true)
  [[ -z $installed_package_type ]] || package_type=$installed_package_type
elif [[ -f $bundle_root/PACKAGE_TYPE ]]; then
  package_type=$(tr -d '\r\n' <"$bundle_root/PACKAGE_TYPE")
fi
[[ $package_type == server-pos || $package_type == server ]] || die "Invalid bootstrap package type: $package_type"
diagnostics_helper="$bundle_root/setup-diagnostics.sh"
[[ -f $diagnostics_helper ]] || diagnostics_helper="$bundle_root/../setup-diagnostics.sh"
# shellcheck source=../setup-diagnostics.sh
source "$diagnostics_helper"
bms_diagnostics_init "$package_type" "$RUNTIME_ROOT" "$bundle_root/BOOTSTRAP_VERSION"
finish_setup() {
  local status=$?
  trap - EXIT ERR
  bms_diagnostics_finish "$status" || true
  cleanup || true
  exit "$status"
}
trap finish_setup EXIT
trap 'exit 130' HUP INT TERM

require_root
[[ -n ${SUDO_USER:-} && $SUDO_USER != root ]] || die "Run through sudo from the desktop user account; do not sign in directly as root"
operator_uid_preflight=$(id -u "$SUDO_USER")
if [[ $package_type == server-pos ]]; then
  [[ -d /run/user/$operator_uid_preflight ]] || die "No graphical user session found for $SUDO_USER"
  [[ -n ${DISPLAY:-} || -n ${WAYLAND_DISPLAY:-} ]] || die "Install Server + POS from an Ubuntu Desktop session"
fi
manifest_uri=${1:-}
is_https_url "$manifest_uri" || die "The first argument must be an HTTPS release-manifest URL without credentials"
agent_source="$bundle_root/bms-runtime-agent"
localctl_source="$bundle_root/bms-localctl"
[[ -f $localctl_source ]] || localctl_source="$bundle_root/../runtime-rootfs/bms-localctl"
transaction_source="$bundle_root/bms-update-transaction"
[[ -f $transaction_source ]] || transaction_source="$bundle_root/../runtime-rootfs/bms-update-transaction"
if [[ -f $RUNTIME_ROOT/installation.json ]]; then
  BMS_DIAG_STAGE=repair-existing-install
  jq -e '.version and .tenantId and .posDeviceId' "$RUNTIME_ROOT/installation.json" >/dev/null || \
    die "Could not read the installation receipt. Preserve shop data and contact Support; do not delete the database or .env"
  # Uninstall removes these controls and disables startup while keeping the receipt and data.
  install -m 0755 -o root -g root "$localctl_source" /usr/local/bin/bms-localctl
  install -m 0755 -o root -g root "$transaction_source" /usr/local/sbin/bms-update-transaction
  install -m 0644 -o root -g root "$bundle_root/bms-retail-local.service" "/etc/systemd/system/$SERVICE_NAME"
  install -m 0755 -o root -g root "$agent_source" "$BOOTSTRAP_ROOT/bms-runtime-agent"
  for unit in bms-retail-local-license-ui.service bms-retail-local-license-ui.timer; do
    install -m 0644 -o root -g root "$bundle_root/$unit" "/etc/systemd/system/$unit"
  done
  systemctl daemon-reload
  systemctl enable --now docker.service
  systemctl enable --now "$SERVICE_NAME"
  systemctl enable --now bms-retail-local-license-evidence.timer >/dev/null 2>&1 || true
  systemctl enable --now bms-retail-local-license-ui.timer >/dev/null 2>&1 || true
  for attempt in {1..60}; do
    if bms-localctl doctor; then
      printf 'BMS Retail Local is installed and ready. Existing shop data has been preserved\n'
      exit 0
    fi
    printf 'Waiting for existing shop services (%s/60)...\n' "$attempt"
    sleep 3
  done
  die "Existing shop services are not ready. Data has been preserved; check the service log"
fi
keyring_source="$bundle_root/trusted-release-keys.json"
[[ -x $agent_source && -f $keyring_source && -f $localctl_source && -f $transaction_source ]] || die "Installer bundle is missing the agent, keyring, or runtime controls"

install -d -m 0700 -o root -g root "$BOOTSTRAP_ROOT" "$RUNTIME_ROOT" "$RUNTIME_ROOT/release"
install -m 0755 -o root -g root "$agent_source" "$BOOTSTRAP_ROOT/bms-runtime-agent"
install -m 0644 -o root -g root "$keyring_source" "$BOOTSTRAP_ROOT/trusted-release-keys.json"
agent="$BOOTSTRAP_ROOT/bms-runtime-agent"

step 1 "Checking Ubuntu, CPU, RAM, systemd, and free disk space"
if preflight_json=$($agent preflight); then
  preflight_status=0
else
  preflight_status=$?
fi
jq -e . >/dev/null <<<"$preflight_json" || die "Could not read preflight results"
jq -r '.warnings[]? | "[WARN] \(.)"' <<<"$preflight_json"
jq -r '.failures[]? | "[FAIL] \(.)"' <<<"$preflight_json" >&2
(( preflight_status == 0 )) || die "Cannot install yet. Resolve the preflight issues above, then run Setup again"
target=$(jq -er '.target' <<<"$preflight_json")

# Registration is an explicit post-install action, including on setup retries.
printf 'You can install and try the system without an Activation Code\n'

provision_checkpoint="$RUNTIME_ROOT/provision-result.json"
shop_name=''
admin_name=''
admin_email=''
admin_password=''
admin_pin=''
business_archetype=''
sample_mode='NONE'

step 3 "Installing the private runtime and required tools"
export DEBIAN_FRONTEND=noninteractive
dpkg --configure -a
apt-get update
runtime_packages=(age ca-certificates curl jq docker.io util-linux)
if [[ $package_type == server-pos ]]; then
  runtime_packages+=(gnome-keyring libsecret-1-0)
fi
apt-get -o DPkg::Lock::Timeout=60 install -y --no-install-recommends "${runtime_packages[@]}"
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends docker-compose-v2 || \
    apt-get install -y --no-install-recommends docker-compose-plugin || \
    die "Failed to install Docker Compose v2 from the Ubuntu repository"
fi
systemctl enable --now docker.service
docker info >/dev/null 2>&1 || die "Moby/Docker runtime is not ready"
install -m 0755 -o root -g root "$localctl_source" /usr/local/bin/bms-localctl
install -m 0755 -o root -g root "$transaction_source" /usr/local/sbin/bms-update-transaction
install -m 0755 -o root -g root "$bundle_root/uninstall-managed-runtime.sh" /usr/local/sbin/bms-retail-local-uninstall
install -m 0755 -o root -g root "$bundle_root/update-managed-runtime.sh" /usr/local/sbin/bms-retail-local-update
install -m 0755 -o root -g root "$bundle_root/run-offhost-backup.sh" /usr/local/sbin/bms-retail-local-offhost-backup
install -m 0644 -o root -g root "$bundle_root/bms-retail-local-offhost-backup.service" \
  /etc/systemd/system/bms-retail-local-offhost-backup.service
install -m 0644 -o root -g root "$bundle_root/bms-retail-local-offhost-backup.timer" \
  /etc/systemd/system/bms-retail-local-offhost-backup.timer
install -m 0644 -o root -g root "$bundle_root/bms-retail-local-license-evidence.service" \
  /etc/systemd/system/bms-retail-local-license-evidence.service
install -m 0644 -o root -g root "$bundle_root/bms-retail-local-license-evidence.timer" \
  /etc/systemd/system/bms-retail-local-license-evidence.timer
for unit in bms-retail-local-license-ui.service bms-retail-local-license-ui.timer; do
  install -m 0644 -o root -g root "$bundle_root/$unit" "/etc/systemd/system/$unit"
done

manifest_path="$RUNTIME_ROOT/release/release.jws.json"
step 4 "Downloading and verifying the signed release"
curl --fail --location --proto '=https' --tlsv1.2 --max-redirs 5 \
  --connect-timeout 20 --max-time 60 --speed-limit 1 --speed-time 20 \
  --retry 2 --retry-max-time 180 --output "$manifest_path" "$manifest_uri"
chmod 0600 "$manifest_path"
stage_command=stage-release
[[ $package_type == server-pos ]] || stage_command=stage-server
stage_json=$(run_agent_json_progress "$agent" "$stage_command" -manifest "$manifest_path" \
  -keyring "$BOOTSTRAP_ROOT/trusted-release-keys.json" -target "$target" -root "$RUNTIME_ROOT" -progress)
release_json=$($agent verify-release -manifest "$manifest_path" \
  -keyring "$BOOTSTRAP_ROOT/trusted-release-keys.json" -target "$target")
release_directory=$(jq -er '.releaseDirectory' <<<"$stage_json")
[[ $release_directory == "$RUNTIME_ROOT"/releases/* ]] || die "Release directory is outside the runtime root"
archetype_manifest=$(artifact_path shop-archetypes)
[[ -f $archetype_manifest ]] || die "Signed release is missing the shop-archetypes component"

step 5 "Loading Web, WS, PostgreSQL, and Redis"
while IFS=$'\t' read -r name image_ref digest; do
  artifact=$(artifact_path "$name")
  [[ -f $artifact ]] || die "Artifact not found: $name"
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
cat <<EOF | write_runtime_text "$RUNTIME_ROOT/.env"
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

if [[ -f $provision_checkpoint ]]; then
  step 2 "Existing shop data found. Resuming setup from the checkpoint"
  provision_result=$(<"$provision_checkpoint")
  jq -e . >/dev/null <<<"$provision_result" || die "Could not read the shop checkpoint. Contact Support"
  business_archetype=$(jq -r '.businessArchetype // empty' <<<"$provision_result")
  sample_mode=$(jq -r '.sampleData.mode // "NONE"' <<<"$provision_result")
else
  step 2 "Collecting shop and administrator details"
  read -r -p 'Shop name: ' shop_name
  business_archetype=$(choose_archetype)
  if jq -e --arg id "$business_archetype" '.archetypes[] | select(.id == $id) | .starterCatalog == true' \
      "$archetype_manifest" >/dev/null; then
    sample_mode=$(choose_sample_mode)
  else
    sample_mode=NONE
    printf 'This release has no Starter Catalog for this shop type; starting with an empty shop\n'
  fi
  while [[ -z $admin_name ]]; do read -r -p 'Shop administrator name: ' admin_name; done
  while [[ ! $admin_email =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; do
    read -r -p 'Shop administrator email: ' admin_email
    [[ $admin_email =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || \
      printf 'Invalid email address. Please try again\n' >&2
  done
  while :; do
    read -r -s -p 'Administrator password (at least 8 characters): ' admin_password; printf '\n'
    read -r -s -p 'Confirm password: ' password_confirm; printf '\n'
    [[ ${#admin_password} -ge 8 && $admin_password == "$password_confirm" ]] && break
    printf 'Passwords must match and contain at least 8 characters. Please try again\n' >&2
  done
  while :; do
    read -r -s -p 'POS PIN (4-8 digits): ' admin_pin; printf '\n'
    read -r -s -p 'Confirm PIN: ' pin_confirm; printf '\n'
    [[ $admin_pin =~ ^[0-9]{4,8}$ && $admin_pin == "$pin_confirm" ]] && break
    printf 'PINs must match and contain 4-8 digits. Please try again\n' >&2
  done
  for value in "$shop_name" "$admin_name" "$admin_email" "$admin_password" "$admin_pin"; do
    [[ -n $value && $value != *$'\n'* && $value != *$'\r'* ]] || die "Invalid setup data"
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
    shell_export BMS_LOCAL_BUSINESS_ARCHETYPE "$business_archetype"
    shell_export BMS_LOCAL_SAMPLE_MODE "$sample_mode"
    printf 'cd %s\ndocker compose --env-file .env -f compose.yml --profile setup run --rm provision\n' "$RUNTIME_ROOT"
  } >"$provision_script"
  chmod 0700 "$provision_script"
  unset admin_password admin_pin password_confirm pin_confirm
  provision_output=$($provision_script) || die "Shop provisioning failed. Review the messages above, then run Setup again"
  rm -f -- "$provision_script"; provision_script=
  provision_result=$(grep -E '^\{"status"' <<<"$provision_output" | tail -n 1)
  jq -e . >/dev/null <<<"$provision_result" || die "No readable provisioning result was found"
  printf '%s\n' "$provision_result" | write_runtime_text "$provision_checkpoint"
fi

sample_status=$(jq -r '.sampleData.status // "SKIPPED"' <<<"$provision_result")
if [[ $sample_mode == STARTER_CATALOG && $sample_status != COMPLETED && $sample_status != ALREADY_COMPLETED ]]; then
  # The provisioning checkpoint above already contains the one-time token. Sample generation may
  # now be retried safely after a process interruption or power loss without recreating the shop.
  if [[ $sample_status != PENDING ]]; then
    printf '[WARN] Provisioning did not report completed sample data. Retrying the selected sample data setup\n' >&2
  fi
  sample_output=$(cd "$RUNTIME_ROOT" && \
    docker compose --env-file .env -f compose.yml --profile setup run --rm sample-data 2>&1) || true
  sample_result=$(grep -E '^\{"status"' <<<"$sample_output" | tail -n 1)
  if ! jq -e . >/dev/null 2>&1 <<<"$sample_result"; then
    sample_result='{"status":"FAILED","requested":true,"message":"sample data process did not return a readable result"}'
  elif [[ $(jq -r '.status // "FAILED"' <<<"$sample_result") =~ ^(COMPLETED|ALREADY_COMPLETED)$ ]] && \
       ! sample_result_is_complete "$sample_result" "$business_archetype"; then
    sample_result='{"status":"FAILED","requested":true,"message":"sample data result is incomplete"}'
  fi
  provision_result=$(jq -c --argjson sample "$sample_result" --arg mode "$sample_mode" '.sampleData = ($sample + {mode:$mode})' <<<"$provision_result")
  printf '%s\n' "$provision_result" | write_runtime_text "$provision_checkpoint"
  sample_status=$(jq -r '.sampleData.status' <<<"$provision_result")
fi
case "$sample_status" in
  COMPLETED|ALREADY_COMPLETED) printf '[BMS] Sample data created for the selected shop type\n' ;;
  FAILED) printf 'Note: Sample data setup is incomplete. The shop is usable; retry from the onboarding page\n' >&2 ;;
esac

install -m 0644 -o root -g root "$bundle_root/bms-retail-local.service" "/etc/systemd/system/$SERVICE_NAME"
step 6 "Starting services and checking system health"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl enable --now bms-retail-local-license-evidence.timer >/dev/null 2>&1 || \
  printf 'Warning: Could not schedule licensing evidence; the shop can continue operating\n' >&2

deadline=$((SECONDS + 240))
until curl --fail --silent --max-time 5 http://127.0.0.1:3100/admin/login >/dev/null && \
      curl --fail --silent --max-time 5 http://127.0.0.1:3101/readyz >/dev/null; do
  (( SECONDS < deadline )) || die "Services failed the HTTP health check"
  sleep 3
done

if [[ $package_type == server-pos ]]; then
  desktop_artifact=$(artifact_path desktop)
  dpkg -i "$desktop_artifact" || { apt-get install -f -y; dpkg -i "$desktop_artifact"; }
  command -v bms-pos >/dev/null 2>&1 || die "POS was installed but the bms-pos command was not found"
fi

operator=${SUDO_USER:-root}
operator_uid=$(id -u "$operator")
operator_gid=$(id -g "$operator")
device_token=$(jq -er '.deviceToken // empty' <<<"$provision_result" || true)
tenant_id=$(jq -er '.tenantId' <<<"$provision_result")
pos_device_id=$(jq -er '.deviceId' <<<"$provision_result")
sample_status=$(jq -r '.sampleData.status // "SKIPPED"' <<<"$provision_result")

if [[ $package_type == server-pos && -n $device_token && $operator != root ]]; then
  handoff_path="/run/user/$operator_uid/bms-pairing-handoff.json"
  install -d -m 0700 -o "$operator_uid" -g "$operator_gid" "/run/user/$operator_uid"
  expires_at=$(date -u -d '+10 minutes' '+%Y-%m-%dT%H:%M:%SZ')
  jq -n --arg token "$device_token" --arg expiresAt "$expires_at" \
    '{version:1,serverUrl:"http://127.0.0.1:3100",token:$token,expiresAt:$expiresAt}' >"$handoff_path"
  chown "$operator_uid:$operator_gid" "$handoff_path"; chmod 0600 "$handoff_path"
  desktop_log="$RUNTIME_ROOT/desktop-launch.log"
  runuser -u "$operator" -- env DISPLAY="${DISPLAY:-}" WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-}" \
    XDG_RUNTIME_DIR="/run/user/$operator_uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$operator_uid/bus" \
    bms-pos "--pairing-handoff=$handoff_path" >"$desktop_log" 2>&1 &
  desktop_pid=$!
  sleep 3
  kill -0 "$desktop_pid" 2>/dev/null || die "Could not open BMS POS. See $desktop_log for details"
fi
unset device_token provision_result provision_output

jq -n --arg version "$(jq -r '.releaseVersion' <<<"$release_json")" --arg target "$target" \
  --arg installedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg sourceCommit "$(jq -r '.sourceCommit' <<<"$release_json")" \
  --arg schemaVersion "$(jq -r '.schemaVersion' <<<"$release_json")" \
  --arg tenantId "$tenant_id" --arg posDeviceId "$pos_device_id" \
  --arg businessArchetype "$business_archetype" --arg sampleMode "$sample_mode" \
  --arg sampleStatus "$sample_status" \
  --arg packageType "$package_type" \
  --arg licenseCode "${BMS_LICENSE_ID:-}" \
  '{product:"BMS Retail Local",version:$version,platformTarget:$target,packageType:$packageType,installedAt:$installedAt,updatedAt:$installedAt,sourceCommit:$sourceCommit,schemaVersion:$schemaVersion,url:"http://127.0.0.1:3100",tenantId:$tenantId,posDeviceId:$posDeviceId,businessArchetype:$businessArchetype,sampleMode:$sampleMode,sampleStatus:$sampleStatus,licenseCode:(if $licenseCode == "" then null else $licenseCode end)}' \
  | write_runtime_text "$RUNTIME_ROOT/installation.json"
rm -f -- "$provision_checkpoint"

# Best-effort anonymous installation inventory. It uses a random local id and
# never collects hardware serials, MAC addresses, customer or transaction data.
if [[ -n ${BMS_ACTIVATION_URI:-} ]]; then
  "$agent" installation-report -root "$RUNTIME_ROOT" -control-uri "$BMS_ACTIVATION_URI" \
    -event INSTALLED -package-type "$package_type" -target "$target" \
    -release-version "$(jq -r '.releaseVersion' <<<"$release_json")" \
    -tenant-reference "$tenant_id" -license-reference "${BMS_LICENSE_ID:-}" -force \
    >/dev/null 2>&1 || printf 'Warning: Could not send minimal installation data; reporting will retry later\n' >&2
fi

# Licensing is evidence-only and deliberately outside the install/runtime success path. A missing
# endpoint, unreachable control plane, rejected event, or local evidence error must never stop the
# shop. Set these variables through the commercial bootstrap when licensing has been issued.
if [[ -n ${BMS_LICENSE_ID:-} ]]; then
  license_args=(license-record -root "$RUNTIME_ROOT" -event INSTALLATION_REGISTERED
    -license-id "$BMS_LICENSE_ID" -tenant-id "$tenant_id" -pos-device-id "$pos_device_id"
    -target "$target" -release-version "$(jq -r '.releaseVersion' <<<"$release_json")")
  if [[ -n ${BMS_LICENSE_EVIDENCE_ENDPOINT:-} && -n ${BMS_LICENSE_EVIDENCE_TOKEN:-} ]]; then
    license_args+=(-endpoint "$BMS_LICENSE_EVIDENCE_ENDPOINT")
  elif [[ -n ${BMS_LICENSE_EVIDENCE_ENDPOINT:-} ]]; then
    printf 'Warning: Licensing endpoint configured without an ingestion token; evidence will be stored locally only\n' >&2
  fi
  if ! license_result=$(BMS_LICENSE_EVIDENCE_TOKEN="${BMS_LICENSE_EVIDENCE_TOKEN:-}" \
    "$agent" "${license_args[@]}" 2>&1); then
    printf 'Warning: Could not store licensing evidence. The shop can continue operating: %s\n' "$license_result" >&2
  fi
fi
step 7 "Installation complete"
systemctl enable --now bms-retail-local-license-ui.timer >/dev/null 2>&1 || true
printf 'BMS Retail Local is ready: http://127.0.0.1:3100\n'
printf 'You can try the system immediately without an Activation Code\n'
if [[ -n ${BMS_ACTIVATION_URI:-} ]]; then
  printf 'Register later: Admin > License or sudo bms-retail-local-activate\n'
fi
if [[ $package_type == server ]]; then
  printf 'Server-only installation: BMS POS Desktop was not installed or launched\n'
fi
