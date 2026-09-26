#!/usr/bin/env bash
set -Eeuo pipefail

pkg=${1:-}
[[ -f $pkg ]] || { echo "usage: smoke-test-pkg.sh FULL_INSTALLER.pkg" >&2; exit 2; }
[[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || {
  echo "smoke test ต้องรันบน macOS Apple Silicon" >&2; exit 1;
}

work="/tmp/brl-smoke.$$"
[[ ! -e $work ]] || { echo "smoke path มีอยู่แล้ว: $work" >&2; exit 1; }
mkdir -m 0700 "$work"
expanded="$work/expanded"
archive_expanded="$work/archive-expanded"
state="$work/state"
lima_home="$work/lima"
instance="brl-smoke-$$"
system_root=
cleanup() {
  local status=$?
  if [[ -n $system_root && -x $system_root/runtime/lima/bin/limactl ]]; then
    LIMA_HOME="$lima_home" "$system_root/runtime/lima/bin/limactl" stop "$instance" >/dev/null 2>&1 || true
    LIMA_HOME="$lima_home" "$system_root/runtime/lima/bin/limactl" delete --force "$instance" >/dev/null 2>&1 || true
  fi
  find "$work" -depth -delete >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

echo "Expand package payload"
pkgutil --expand "$pkg" "$archive_expanded"
payload_archive="$archive_expanded/BMSRetailLocal.component.pkg/Payload"
package_info="$archive_expanded/BMSRetailLocal.component.pkg/PackageInfo"
[[ -f $payload_archive ]] || {
  echo "component Payload ต้องเป็น archive ไม่ใช่ directory" >&2; exit 1;
}
[[ -f $package_info ]] || { echo "ไม่พบ component PackageInfo" >&2; exit 1; }
if grep -q '<relocate>' "$package_info"; then
  echo "application bundle ใน package ต้องห้าม relocate ออกจาก /Applications" >&2; exit 1
fi
file "$payload_archive" | grep -q 'gzip compressed data' || {
  echo "component Payload ไม่ใช่ gzip archive ที่ macOS Installer รองรับ" >&2; exit 1;
}
pkgutil --expand-full "$pkg" "$expanded"
component_payload=$(find "$expanded" -type d -path '*/BMSRetailLocal.component.pkg/Payload' -print -quit)
[[ -n $component_payload ]] || { echo "ไม่พบ component payload" >&2; exit 1; }
system_root="$component_payload/Library/Application Support/BMS/RetailLocal"
[[ -n $system_root ]] || { echo "ไม่พบ Retail Local payload" >&2; exit 1; }
control="$system_root/control/bms-retail-local"
app="$component_payload/Applications/BMS Retail Local.app"
[[ -x $app/Contents/MacOS/BMS\ Retail\ Local ]] || { echo "ไม่พบ app launcher" >&2; exit 1; }
[[ -f $app/Contents/Resources/BMSRetailLocal.icns ]] || { echo "ไม่พบ app icon" >&2; exit 1; }
plutil -lint "$app/Contents/Info.plist" >/dev/null

runtime_env=(
  BMS_RETAIL_LOCAL_SYSTEM_ROOT="$system_root"
  BMS_RETAIL_LOCAL_STATE_ROOT="$state"
  BMS_RETAIL_LOCAL_LIMA_HOME="$lima_home"
  BMS_RETAIL_LOCAL_INSTANCE="$instance"
  BMS_RETAIL_LOCAL_HOST_WEB_PORT=13100
  BMS_RETAIL_LOCAL_HOST_WS_PORT=13101
  BMS_RETAIL_LOCAL_TEST_MODE=1
)

env "${runtime_env[@]}" BMS_SMOKE_CONTROL="$control" expect <<'EOF'
set timeout 1800
spawn -noecho $env(BMS_SMOKE_CONTROL) setup
expect "ชื่อร้าน: "
send -- "BMS Smoke Shop\r"
expect "ชื่อผู้ดูแลร้าน: "
send -- "Smoke Admin\r"
expect "อีเมลผู้ดูแลร้าน: "
send -- "smoke@example.invalid\r"
expect "รหัสผ่านผู้ดูแล (อย่างน้อย 8 ตัวอักษร): "
send -- "RetailLocalSmoke!2026\r"
expect "PIN ขายหน้าร้าน (ตัวเลข 4-8 หลัก): "
send -- "2468\r"
expect eof
lassign [wait] pid spawnid os_error exit_code
exit $exit_code
EOF
env "${runtime_env[@]}" "$control" doctor
curl --fail --silent --max-time 10 http://127.0.0.1:13100/admin/login >/dev/null
curl --fail --silent --max-time 10 http://127.0.0.1:13101/readyz >/dev/null
echo "macOS full installer smoke test: passed"
