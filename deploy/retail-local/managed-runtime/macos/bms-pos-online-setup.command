#!/bin/bash
set -Eeuo pipefail
umask 077

APP_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
readonly APP_ROOT
readonly BOOTSTRAP_ROOT="$APP_ROOT/Resources/bootstrap"
readonly AGENT="$BOOTSTRAP_ROOT/bms-runtime-agent"
readonly KEYRING="$BOOTSTRAP_ROOT/trusted-release-keys.json"
readonly MANIFEST_URI_FILE="$BOOTSTRAP_ROOT/manifest-url"
readonly CONTROL_URI_FILE="$BOOTSTRAP_ROOT/control-url"
readonly PACKAGED_TARGET_FILE="$BOOTSTRAP_ROOT/PLATFORM_TARGET"
readonly STATE_ROOT="$HOME/Library/Application Support/BMS/POSBootstrap"

# shellcheck source=../setup-diagnostics.sh
source "$BOOTSTRAP_ROOT/setup-diagnostics.sh"
bms_diagnostics_init pos "$STATE_ROOT" "$BOOTSTRAP_ROOT/BOOTSTRAP_VERSION"
die() { BMS_DIAG_REASON=$*; BMS_DIAG_LINE=${BASH_LINENO[0]}; printf '\n[FAIL] BMS POS: %s\n' "$*" >&2; exit 1; }
note() { printf '[BMS POS] %s\n' "$*"; }
is_https_url() {
  [[ ${1:-} =~ ^https://[^/@:]+(:[0-9]{1,5})?([/?#].*)?$ && ${1:-} != *'@'* ]]
}
cleanup() {
  [[ -z ${temporary:-} ]] || rm -rf -- "$temporary"
}
finish() {
  exit_code=$?
  trap - EXIT ERR
  bms_diagnostics_finish "$exit_code" || true
  cleanup || true
  if ((exit_code == 0)); then
    printf '\nBMS POS installation completed and the app was launched\n'
  else
    printf '\nInstallation did not complete. Completed downloads have been kept for the next attempt\n'
    if [[ -t 0 && -d $STATE_ROOT/diagnostics ]]; then
      read -r -p 'Open error reports in Finder? [y/N]: ' show_report || true
      [[ ${show_report:-} != [yY] ]] || open "$STATE_ROOT/diagnostics" || true
    fi
  fi
  printf 'Press Enter to close this window...'
  read -r || true
  exit "$exit_code"
}
trap finish EXIT
trap 'exit 130' HUP INT TERM

clear
printf 'BMS POS Online Setup (macOS)\n\n'
[[ -x $AGENT && -f $KEYRING && -s $MANIFEST_URI_FILE && -s $PACKAGED_TARGET_FILE ]] || \
  die "Bootstrap files are incomplete. Download the DMG again"

if [[ $(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || printf '0') == 1 ]]; then
  host_target=macos-15-arm64
else
  host_target=macos-15-x64
fi
packaged_target=$(tr -d '\r\n' <"$PACKAGED_TARGET_FILE")
[[ $packaged_target == "$host_target" ]] || \
  die "Installer does not match this CPU (computer: $host_target; DMG: ${packaged_target:-unknown})"

manifest_uri=$(tr -d '\r\n' <"$MANIFEST_URI_FILE")
control_uri=$(tr -d '\r\n' <"$CONTROL_URI_FILE" 2>/dev/null || true)
is_https_url "$manifest_uri" || die "Unsafe Manifest URL in bootstrap"
[[ -z $control_uri ]] || is_https_url "$control_uri" || die "Unsafe Control URL in bootstrap"
local_test_ca="$BOOTSTRAP_ROOT/test-release-ca.pem"
if [[ -f $local_test_ca ]]; then
  [[ $manifest_uri =~ ^https://(localhost|127\.0\.0\.1|\[::1\])([/:?#]|$) ]] || \
    die "Test release CA is allowed only for localhost"
  grep -q 'BEGIN CERTIFICATE' "$local_test_ca" && ! grep -q 'PRIVATE KEY' "$local_test_ca" || \
    die "Invalid test release CA"
  export CURL_CA_BUNDLE="$local_test_ca" SSL_CERT_FILE="$local_test_ca"
  note "Using public test CA for localhost only (SMOKE-ONLY)"
fi

mkdir -p "$STATE_ROOT/manifest"
chmod 0700 "$STATE_ROOT" "$STATE_ROOT/manifest"
manifest_path="$STATE_ROOT/manifest/release.jws.json"
note "First setup requires internet access. Downloading the signed release manifest"
BMS_DIAG_STAGE=download-manifest
curl_args=(--fail --location --proto '=https' --tlsv1.2 --max-redirs 5 \
  --connect-timeout 20 --max-time 60 --speed-limit 1 --speed-time 20 \
  --retry 2 --retry-max-time 180 --output "$manifest_path.part")
[[ ! -f $local_test_ca ]] || curl_args=(--cacert "$local_test_ca" "${curl_args[@]}")
if ! curl "${curl_args[@]}" "$manifest_uri"; then
  die "Failed to download the release manifest. Check your internet connection and run Setup again"
fi
chmod 0600 "$manifest_path.part"
mv -f "$manifest_path.part" "$manifest_path"

stage_output="$STATE_ROOT/stage-desktop-result.jsonl"
: >"$stage_output"
chmod 0600 "$stage_output"
note "Downloading BMS POS and verifying SHA-256 (downloads can resume)"
BMS_DIAG_STAGE=download-desktop
stage_args=(stage-desktop -manifest "$manifest_path" -keyring "$KEYRING" \
  -target "$host_target" -root "$STATE_ROOT" -progress)
[[ ! -f $local_test_ca ]] || stage_args+=(-test-ca "$local_test_ca")
"$AGENT" "${stage_args[@]}" | while IFS= read -r line; do
    printf '%s\n' "$line" >>"$stage_output"
    [[ $line == 'BMS_PROGRESS '* ]] || continue
    payload=${line#BMS_PROGRESS }
    phase=$(printf '%s' "$payload" | /usr/bin/plutil -extract phase raw -o - - 2>/dev/null) || phase=''
    component=$(printf '%s' "$payload" | /usr/bin/plutil -extract component raw -o - - 2>/dev/null) || component='desktop'
    percent=$(printf '%s' "$payload" | /usr/bin/plutil -extract percent raw -o - - 2>/dev/null) || percent='0'
    completed=$(printf '%s' "$payload" | /usr/bin/plutil -extract componentCompletedBytes raw -o - - 2>/dev/null) || completed='0'
    total=$(printf '%s' "$payload" | /usr/bin/plutil -extract componentTotalBytes raw -o - - 2>/dev/null) || total='0'
    heartbeat=$(printf '%s' "$payload" | /usr/bin/plutil -extract heartbeat raw -o - - 2>/dev/null) || heartbeat='false'
    retry_after=$(printf '%s' "$payload" | /usr/bin/plutil -extract retryAfterSeconds raw -o - - 2>/dev/null) || retry_after='0'
    progress_size="$((completed / 1048576))/$((total / 1048576)) MiB"
    [[ $heartbeat != true ]] || progress_size="$progress_size; Still working; waiting for network data"
    case "$phase" in
      connect) printf '\r[BMS POS] Connecting %-10s %3s%% (%s)' "$component" "$percent" "$progress_size" ;;
      download) printf '\r[BMS POS] Downloading %-10s %3s%% (%s)' "$component" "$percent" "$progress_size" ;;
      retry) printf '\r[BMS POS] Connection interrupted. Retrying %-10s in %ss (%s)\n' "$component" "$retry_after" "$progress_size" ;;
      cached) printf '\r[BMS POS] Using verified cached file %-10s %3s%%\n' "$component" "$percent" ;;
      verify) printf '\r[BMS POS] Verifying %-10s %3s%%' "$component" "$percent" ;;
      staged) printf '\r[BMS POS] Download and verification complete       100%%\n' ;;
    esac
  done

version=$(tail -n 1 "$stage_output" | /usr/bin/plutil -extract releaseVersion raw -o - - 2>/dev/null || true)
[[ $version =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || die "Could not read release version"
archive="$STATE_ROOT/releases/$version/desktop.artifact"
[[ -f $archive ]] || die "Signed release has no fully downloaded desktop artifact"

BMS_DIAG_STAGE=extract-desktop
temporary="$STATE_ROOT/desktop-install.partial"
rm -rf -- "$temporary"
mkdir -p "$temporary"
while IFS= read -r entry; do
  [[ -n $entry && $entry != /* && $entry != ../* && $entry != */../* ]] || \
    die "Desktop archive contains an unsafe path"
done < <(/usr/bin/zipinfo -1 "$archive")
/usr/bin/ditto -x -k "$archive" "$temporary"
downloaded_app="$temporary/BMS POS.app"
[[ -x $downloaded_app/Contents/MacOS/BMS\ POS && -f $downloaded_app/Contents/Info.plist ]] || \
  die "Desktop component does not contain a complete BMS POS.app"

note "Installing BMS POS in Applications (macOS may ask for the computer administrator password)"
BMS_DIAG_STAGE=install-desktop
sudo /usr/bin/ditto "$downloaded_app" "/Applications/BMS POS.app"
sudo chown -R root:wheel "/Applications/BMS POS.app"
sudo chmod -R go-w "/Applications/BMS POS.app"
rm -rf -- "$temporary"
temporary=
open -a "/Applications/BMS POS.app"
if [[ -n $control_uri ]]; then
  "$AGENT" installation-report -root "$STATE_ROOT" -control-uri "$control_uri" -event INSTALLED \
    -package-type pos -target "$host_target" -release-version "$version" -force \
    >/dev/null 2>&1 || note "Could not send minimal installation data; POS installation succeeded"
fi
