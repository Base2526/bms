#!/usr/bin/env bash
set -Eeuo pipefail

package=${1:-}
[[ -f $package ]] || { echo "usage: smoke-test-bootstrap-pkg.sh ONLINE_BOOTSTRAP.pkg" >&2; exit 2; }
[[ $(uname -s) == Darwin ]] || { echo "smoke test ต้องรันบน macOS" >&2; exit 1; }

work=$(mktemp -d "${TMPDIR:-/tmp}/bms-macos-bootstrap-smoke.XXXXXX")
cleanup() { find "$work" -depth -delete >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM

expanded="$work/expanded"
pkgutil --expand-full "$package" "$expanded"
payload=$(find "$expanded" -type d -path '*/BMSRetailLocal.component.pkg/Payload' -print -quit)
[[ -n $payload ]] || { echo "ไม่พบ component payload" >&2; exit 1; }
root="$payload/Library/Application Support/BMS/RetailLocal"
bootstrap="$root/bootstrap"
app="$payload/Applications/BMS Retail Local.app"

[[ -x $bootstrap/bms-runtime-agent ]] || { echo "bootstrap ขาด runtime agent" >&2; exit 1; }
[[ -f $bootstrap/trusted-release-keys.json ]] || { echo "bootstrap ขาด public keyring" >&2; exit 1; }
[[ -s $bootstrap/manifest-url ]] || { echo "bootstrap ขาด manifest URL" >&2; exit 1; }
[[ $(stat -f %Lp "$bootstrap/bms-runtime-agent") == 755 ]] || {
  echo "runtime agent permission ต้องเป็น 0755" >&2; exit 1;
}
for public_file in trusted-release-keys.json manifest-url activation-url BOOTSTRAP_VERSION PLATFORM_TARGET PACKAGE_TYPE; do
  [[ $(stat -f %Lp "$bootstrap/$public_file") == 644 ]] || {
    echo "bootstrap public file permission ต้องเป็น 0644: $public_file" >&2; exit 1;
  }
done
package_type=$(cat "$bootstrap/PACKAGE_TYPE")
[[ $package_type == server || $package_type == server-pos ]] || {
  echo "bootstrap package type ไม่ถูกต้อง: $package_type" >&2; exit 1;
}
if [[ -f $bootstrap/test-release-ca.pem ]]; then
  manifest_uri=$(tr -d '\r\n' <"$bootstrap/manifest-url")
  [[ $manifest_uri =~ ^https://(localhost|127\.0\.0\.1|\[::1\])([/:?#]|$) ]] || {
    echo "test release CA ใช้ได้เฉพาะ loopback manifest" >&2; exit 1;
  }
  grep -q 'BEGIN CERTIFICATE' "$bootstrap/test-release-ca.pem" || { echo "test CA ไม่ใช่ certificate" >&2; exit 1; }
  ! grep -q 'PRIVATE KEY' "$bootstrap/test-release-ca.pem" || { echo "bootstrap มี private key" >&2; exit 1; }
  [[ $(stat -f %Lp "$bootstrap/test-release-ca.pem") == 644 ]] || {
    echo "test release CA permission ต้องเป็น 0644" >&2; exit 1;
  }
fi
[[ -x $root/control/bms-retail-local ]] || { echo "bootstrap ขาด host control" >&2; exit 1; }
[[ -s $root/control/setup-diagnostics.sh && -s $root/control/BOOTSTRAP_VERSION ]] || {
  echo "bootstrap is missing error reporting files" >&2; exit 1;
}
bash -n "$root/control/setup-diagnostics.sh"
[[ -x $app/Contents/MacOS/BMS\ Retail\ Local ]] || { echo "bootstrap ขาด setup app" >&2; exit 1; }
plutil -lint "$app/Contents/Info.plist" >/dev/null

target=$(cat "$bootstrap/PLATFORM_TARGET")
case "$target" in
  macos-15-arm64) file "$bootstrap/bms-runtime-agent" | grep -q 'arm64' ;;
  macos-15-x64) file "$bootstrap/bms-runtime-agent" | grep -Eq 'x86_64|x86-64' ;;
  *) echo "platform target ไม่ถูกต้อง: $target" >&2; exit 1 ;;
esac

for forbidden in \
  "$root/runtime" \
  "$root/payload/ubuntu-24.04-server-cloudimg.img" \
  "$root/payload/images" \
  "$payload/Applications/BMS POS.app"; do
  [[ ! -e $forbidden ]] || { echo "online bootstrap ฝัง payload ขนาดใหญ่: $forbidden" >&2; exit 1; }
done

size=$(stat -f %z "$package")
((size <= 25 * 1024 * 1024)) || { echo "online bootstrap ใหญ่เกิน 25 MiB" >&2; exit 1; }
echo "macOS online bootstrap smoke test: passed ($target, $size bytes)"
