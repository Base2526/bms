#!/usr/bin/env bash
set -Eeuo pipefail

pkg=${1:-}
[[ -f $pkg ]] || { echo "usage: smoke-test-pkg.sh FULL_INSTALLER.pkg" >&2; exit 2; }
[[ $(uname -s) == Darwin ]] || { echo "Smoke test must run on macOS" >&2; exit 1; }

work="/tmp/brl-smoke.$$"
[[ ! -e $work ]] || { echo "Smoke path already exists: $work" >&2; exit 1; }
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
  echo "component Payload must be an archive, not a directory" >&2; exit 1;
}
[[ -f $package_info ]] || { echo "Component PackageInfo was not found" >&2; exit 1; }
if grep -q '<relocate>' "$package_info"; then
  echo "Application bundles in the package must not be relocatable outside /Applications" >&2; exit 1
fi
file "$payload_archive" | grep -q 'gzip compressed data' || {
  echo "component Payload is not a gzip archive supported by macOS Installer" >&2; exit 1;
}
pkgutil --expand-full "$pkg" "$expanded"
component_payload=$(find "$expanded" -type d -path '*/BMSRetailLocal.component.pkg/Payload' -print -quit)
[[ -n $component_payload ]] || { echo "Component payload was not found" >&2; exit 1; }
system_root="$component_payload/Library/Application Support/BMS/RetailLocal"
[[ -n $system_root ]] || { echo "Retail Local payload was not found" >&2; exit 1; }
control="$system_root/control/bms-retail-local"
[[ -s $system_root/control/setup-diagnostics.sh && -s $system_root/control/BOOTSTRAP_VERSION ]] || {
  echo "package is missing error reporting files" >&2; exit 1;
}
bash -n "$system_root/control/setup-diagnostics.sh"
platform_target=$(cat "$system_root/payload/PLATFORM_TARGET")
case "$platform_target" in
  macos-15-arm64) required_host_arch=arm64 ;;
  macos-15-x64) required_host_arch=x86_64 ;;
  *) echo "Platform target in the package is invalid: $platform_target" >&2; exit 1 ;;
esac
[[ $(uname -m) == "$required_host_arch" ]] || {
  echo "Smoke test for this package must run on a $required_host_arch Mac" >&2; exit 1;
}
app="$component_payload/Applications/BMS Retail Local.app"
[[ -x $app/Contents/MacOS/BMS\ Retail\ Local ]] || { echo "App launcher was not found" >&2; exit 1; }
[[ -f $app/Contents/Resources/BMSRetailLocal.icns ]] || { echo "App icon was not found" >&2; exit 1; }
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
expect "Shop name: "
send -- "BMS Smoke Shop\r"
expect "Shop administrator name: "
send -- "Smoke Admin\r"
expect "Shop administrator email: "
send -- "smoke@example.invalid\r"
expect -ex "Select a shop type "
send -- "\r"
expect -ex {Create sample data for this shop type? [y/N]: }
send -- "n\r"
expect "Administrator password (at least 8 characters): "
send -- "RetailLocalSmoke!2026\r"
expect "Confirm password: "
send -- "RetailLocalSmoke!2026\r"
expect "POS PIN (4-8 digits): "
send -- "2468\r"
expect "Confirm PIN: "
send -- "2468\r"
expect eof
lassign [wait] pid spawnid os_error exit_code
exit $exit_code
EOF
env "${runtime_env[@]}" "$control" doctor
curl --fail --silent --max-time 10 http://127.0.0.1:13100/admin/login >/dev/null
curl --fail --silent --max-time 10 http://127.0.0.1:13101/readyz >/dev/null
echo "macOS full installer smoke test: passed"
