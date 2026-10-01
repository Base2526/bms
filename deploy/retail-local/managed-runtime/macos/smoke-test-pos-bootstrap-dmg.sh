#!/usr/bin/env bash
set -Eeuo pipefail

dmg=${1:-}
[[ -f $dmg ]] || { echo "usage: smoke-test-pos-bootstrap-dmg.sh POS_ONLINE_BOOTSTRAP.dmg" >&2; exit 2; }
[[ $(uname -s) == Darwin ]] || { echo "smoke test ต้องรันบน macOS" >&2; exit 1; }

mount=$(mktemp -d "${TMPDIR:-/tmp}/bms-pos-bootstrap-mount.XXXXXX")
cleanup() {
  hdiutil detach "$mount" -quiet >/dev/null 2>&1 || true
  rmdir "$mount" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$dmg" -quiet

app="$mount/Install BMS POS.app"
bootstrap="$app/Contents/Resources/bootstrap"
[[ -x $app/Contents/MacOS/Install\ BMS\ POS ]] || { echo "DMG ขาด setup app" >&2; exit 1; }
[[ -x $app/Contents/Resources/BMS\ POS\ Online\ Setup.command ]] || { echo "DMG ขาด setup command" >&2; exit 1; }
[[ -x $bootstrap/bms-runtime-agent ]] || { echo "DMG ขาด runtime agent" >&2; exit 1; }
[[ -s $bootstrap/setup-diagnostics.sh && -s $bootstrap/BOOTSTRAP_VERSION ]] || {
  echo "POS bootstrap is missing error reporting files" >&2; exit 1;
}
bash -n "$bootstrap/setup-diagnostics.sh"
[[ -f $bootstrap/trusted-release-keys.json && -s $bootstrap/manifest-url ]] || {
  echo "DMG ขาด release trust/config" >&2; exit 1;
}
plutil -lint "$app/Contents/Info.plist" >/dev/null

target=$(cat "$bootstrap/PLATFORM_TARGET")
case "$target" in
  macos-15-arm64) file "$bootstrap/bms-runtime-agent" | grep -q 'arm64' ;;
  macos-15-x64) file "$bootstrap/bms-runtime-agent" | grep -Eq 'x86_64|x86-64' ;;
  *) echo "platform target ไม่ถูกต้อง: $target" >&2; exit 1 ;;
esac

[[ ! -d "$mount/BMS POS.app" ]] || { echo "POS bootstrap ฝัง Electron app" >&2; exit 1; }
if find "$mount" -type f \( -name 'Electron Framework' -o -name '*.asar' -o -name 'desktop.artifact' \) -print -quit | grep -q .; then
  echo "POS bootstrap ฝัง Electron payload" >&2; exit 1
fi
if grep -RIlE --exclude='*.icns' --exclude='*.png' -- '-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----' "$app" | grep -q .; then
  echo "POS bootstrap มี private key" >&2; exit 1
fi
if [[ -f $bootstrap/test-release-ca.pem ]]; then
  manifest_uri=$(tr -d '\r\n' <"$bootstrap/manifest-url")
  [[ $manifest_uri =~ ^https://(localhost|127\.0\.0\.1|\[::1\])([/:?#]|$) ]] || {
    echo "test CA ใช้ได้เฉพาะ loopback manifest" >&2; exit 1;
  }
  ! grep -q 'PRIVATE KEY' "$bootstrap/test-release-ca.pem" || { echo "test CA มี private key" >&2; exit 1; }
fi

size=$(stat -f %z "$dmg")
((size <= 25 * 1024 * 1024)) || { echo "POS online bootstrap ใหญ่เกิน 25 MiB" >&2; exit 1; }
echo "macOS POS online bootstrap smoke test: passed ($target, $size bytes)"
