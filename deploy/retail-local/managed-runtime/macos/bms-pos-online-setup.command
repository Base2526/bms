#!/bin/bash
set -Eeuo pipefail
umask 077

APP_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
readonly APP_ROOT
readonly BOOTSTRAP_ROOT="$APP_ROOT/Resources/bootstrap"
readonly AGENT="$BOOTSTRAP_ROOT/bms-runtime-agent"
readonly KEYRING="$BOOTSTRAP_ROOT/trusted-release-keys.json"
readonly MANIFEST_URI_FILE="$BOOTSTRAP_ROOT/manifest-url"
readonly PACKAGED_TARGET_FILE="$BOOTSTRAP_ROOT/PLATFORM_TARGET"
readonly STATE_ROOT="$HOME/Library/Application Support/BMS/POSBootstrap"

die() { printf '\n[ต้องแก้ไข] BMS POS: %s\n' "$*" >&2; exit 1; }
note() { printf '[BMS POS] %s\n' "$*"; }
is_https_url() {
  [[ ${1:-} =~ ^https://[^/@:]+(:[0-9]{1,5})?([/?#].*)?$ && ${1:-} != *'@'* ]]
}
cleanup() {
  [[ -z ${temporary:-} ]] || rm -rf -- "$temporary"
}
finish() {
  exit_code=$?
  cleanup
  if ((exit_code == 0)); then
    printf '\nติดตั้ง BMS POS สำเร็จ และเปิดแอปให้แล้ว\n'
  else
    printf '\nติดตั้งยังไม่สำเร็จ ไฟล์ที่ดาวน์โหลดครบแล้วจะถูกเก็บไว้เพื่อ resume ครั้งถัดไป\n'
  fi
  printf 'กด Enter เพื่อปิดหน้าต่างนี้...'
  read -r
  exit "$exit_code"
}
trap finish EXIT
trap 'exit 130' HUP INT TERM

clear
printf 'BMS POS Online Setup (macOS)\n\n'
[[ -x $AGENT && -f $KEYRING && -s $MANIFEST_URI_FILE && -s $PACKAGED_TARGET_FILE ]] || \
  die "ไฟล์ bootstrap ไม่ครบ กรุณาดาวน์โหลด DMG ใหม่"

if [[ $(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || printf '0') == 1 ]]; then
  host_target=macos-15-arm64
else
  host_target=macos-15-x64
fi
packaged_target=$(tr -d '\r\n' <"$PACKAGED_TARGET_FILE")
[[ $packaged_target == "$host_target" ]] || \
  die "ไฟล์ติดตั้งไม่ตรงกับ CPU เครื่องนี้ (เครื่องเป็น $host_target แต่ DMG เป็น ${packaged_target:-unknown})"

manifest_uri=$(tr -d '\r\n' <"$MANIFEST_URI_FILE")
is_https_url "$manifest_uri" || die "Manifest URL ใน bootstrap ไม่ปลอดภัย"
local_test_ca="$BOOTSTRAP_ROOT/test-release-ca.pem"
curl_tls=()
if [[ -f $local_test_ca ]]; then
  [[ $manifest_uri =~ ^https://(localhost|127\.0\.0\.1|\[::1\])([/:?#]|$) ]] || \
    die "test release CA ใช้ได้เฉพาะ localhost"
  grep -q 'BEGIN CERTIFICATE' "$local_test_ca" && ! grep -q 'PRIVATE KEY' "$local_test_ca" || \
    die "test release CA ไม่ถูกต้อง"
  export CURL_CA_BUNDLE="$local_test_ca" SSL_CERT_FILE="$local_test_ca"
  curl_tls=(--cacert "$local_test_ca")
  note "ใช้ public test CA สำหรับ localhost เท่านั้น (SMOKE-ONLY)"
fi

mkdir -p "$STATE_ROOT/manifest"
chmod 0700 "$STATE_ROOT" "$STATE_ROOT/manifest"
manifest_path="$STATE_ROOT/manifest/release.jws.json"
note "ครั้งแรกต้องต่ออินเทอร์เน็ต กำลังดาวน์โหลด signed release manifest"
if ! curl "${curl_tls[@]}" --fail --location --proto '=https' --tlsv1.2 --max-redirs 5 \
    --connect-timeout 20 --max-time 60 --speed-limit 1 --speed-time 20 \
    --retry 2 --retry-max-time 180 --output "$manifest_path.part" "$manifest_uri"; then
  die "ดาวน์โหลด release manifest ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วเปิด Setup อีกครั้ง"
fi
chmod 0600 "$manifest_path.part"
mv -f "$manifest_path.part" "$manifest_path"

stage_output="$STATE_ROOT/stage-desktop-result.jsonl"
: >"$stage_output"
chmod 0600 "$stage_output"
note "กำลังดาวน์โหลดเฉพาะ BMS POS และตรวจ SHA-256 (สามารถ resume ได้)"
"$AGENT" stage-desktop -manifest "$manifest_path" -keyring "$KEYRING" \
  -target "$host_target" -root "$STATE_ROOT" -progress | while IFS= read -r line; do
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
    [[ $heartbeat != true ]] || progress_size="$progress_size; ยังทำงานอยู่ รอข้อมูลจากเครือข่าย"
    case "$phase" in
      connect) printf '\r[BMS POS] เชื่อมต่อ %-10s %3s%% (%s)' "$component" "$percent" "$progress_size" ;;
      download) printf '\r[BMS POS] ดาวน์โหลด %-10s %3s%% (%s)' "$component" "$percent" "$progress_size" ;;
      retry) printf '\r[BMS POS] เครือข่ายหยุด จะลอง %-10s ใหม่ใน %ss (%s)\n' "$component" "$retry_after" "$progress_size" ;;
      cached) printf '\r[BMS POS] ใช้ไฟล์เดิมที่ตรวจแล้ว %-10s %3s%%\n' "$component" "$percent" ;;
      verify) printf '\r[BMS POS] ตรวจสอบ %-10s %3s%%' "$component" "$percent" ;;
      staged) printf '\r[BMS POS] ดาวน์โหลดและตรวจสอบครบ       100%%\n' ;;
    esac
  done

version=$(tail -n 1 "$stage_output" | /usr/bin/plutil -extract releaseVersion raw -o - - 2>/dev/null || true)
[[ $version =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || die "อ่าน release version ไม่สำเร็จ"
archive="$STATE_ROOT/releases/$version/desktop.artifact"
[[ -f $archive ]] || die "signed release ไม่มี desktop artifact ที่ดาวน์โหลดครบ"

temporary="$STATE_ROOT/desktop-install.partial"
rm -rf -- "$temporary"
mkdir -p "$temporary"
while IFS= read -r entry; do
  [[ -n $entry && $entry != /* && $entry != ../* && $entry != */../* ]] || \
    die "desktop archive มี path ที่ไม่ปลอดภัย"
done < <(/usr/bin/zipinfo -1 "$archive")
/usr/bin/ditto -x -k "$archive" "$temporary"
downloaded_app="$temporary/BMS POS.app"
[[ -x $downloaded_app/Contents/MacOS/BMS\ POS && -f $downloaded_app/Contents/Info.plist ]] || \
  die "desktop component ไม่มี BMS POS.app ที่สมบูรณ์"

note "กำลังติดตั้ง BMS POS ใน Applications (macOS อาจถามรหัสผ่านผู้ดูแลเครื่อง)"
sudo /usr/bin/ditto "$downloaded_app" "/Applications/BMS POS.app"
sudo chown -R root:wheel "/Applications/BMS POS.app"
sudo chmod -R go-w "/Applications/BMS POS.app"
rm -rf -- "$temporary"
temporary=
open -a "/Applications/BMS POS.app"
