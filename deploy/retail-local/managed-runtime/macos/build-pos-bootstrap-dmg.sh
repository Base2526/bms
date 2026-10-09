#!/usr/bin/env bash
set -Eeuo pipefail
export COPYFILE_DISABLE=1

usage() {
  cat >&2 <<'EOF'
usage: build-pos-bootstrap-dmg.sh --version VERSION --architecture arm64|x64 \
  --manifest-url HTTPS_URL --keyring FILE [--control-url HTTPS_URL] [--output-dir DIR] \
  [--allow-test-endpoints] [--test-ca FILE] [--force] [--skip-tests]

Builds the small POS-only macOS online bootstrap DMG. Electron is not embedded; first launch
downloads only the desktop component from the publisher-signed platform release manifest.
EOF
  exit 2
}

version=
architecture=
manifest_url=
keyring=
control_url=
output_dir=artifacts/retail-local
allow_test_endpoints=false
test_ca=
force=false
skip_tests=false
while (($#)); do
  case "$1" in
    --version) version=${2:-}; shift 2 ;;
    --architecture) architecture=${2:-}; shift 2 ;;
    --manifest-url) manifest_url=${2:-}; shift 2 ;;
    --keyring) keyring=${2:-}; shift 2 ;;
    --control-url) control_url=${2:-}; shift 2 ;;
    --output-dir) output_dir=${2:-}; shift 2 ;;
    --allow-test-endpoints) allow_test_endpoints=true; shift ;;
    --test-ca) test_ca=${2:-}; shift 2 ;;
    --force) force=true; shift ;;
    --skip-tests) skip_tests=true; shift ;;
    *) usage ;;
  esac
done

[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || usage
[[ $architecture == arm64 || $architecture == x64 ]] || usage
[[ -f $keyring ]] || usage
is_https_url() { [[ ${1:-} =~ ^https://[^/@:]+(:[0-9]{1,5})?([/?#].*)?$ && ${1:-} != *'@'* ]]; }
is_placeholder_url() {
  [[ ${1:-} =~ ^https://(localhost|127\.0\.0\.1|\[::1\]|[^/]*\.example\.(com|invalid)|example\.(com|invalid)|[^/]*\.invalid)([/:?#]|$) ]]
}
is_https_url "$manifest_url" || { echo "manifest URL must use HTTPS and contain no credentials" >&2; exit 2; }
[[ -z $control_url ]] || is_https_url "$control_url" || { echo "control URL must use HTTPS and contain no credentials" >&2; exit 2; }
test_build=false
if is_placeholder_url "$manifest_url" || { [[ -n $control_url ]] && is_placeholder_url "$control_url"; }; then
  test_build=true
  [[ $allow_test_endpoints == true ]] || {
    echo "Refusing localhost/example endpoints; use --allow-test-endpoints only for smoke tests" >&2; exit 2;
  }
fi
if [[ -n $test_ca ]]; then
  [[ $test_build == true && $allow_test_endpoints == true && -f $test_ca ]] || {
    echo "--test-ca is allowed only for smoke builds using localhost/example endpoints" >&2; exit 2;
  }
  grep -q 'BEGIN CERTIFICATE' "$test_ca" || { echo "Test CA is not a PEM certificate" >&2; exit 2; }
  ! grep -q 'PRIVATE KEY' "$test_ca" || { echo "Do not include private keys in the bootstrap" >&2; exit 2; }
fi
grep -q 'BEGIN PUBLIC KEY' "$keyring" || { echo "Keyring has no public key" >&2; exit 2; }
! grep -q 'PRIVATE KEY' "$keyring" || { echo "Do not include private keys in the bootstrap" >&2; exit 2; }
[[ $(/usr/bin/plutil -extract formatVersion raw -o - "$keyring" 2>/dev/null || true) == 1 ]] || {
  echo "Keyring must use JSON formatVersion 1" >&2; exit 2;
}

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)
macos_root="$repo_root/deploy/retail-local/managed-runtime/macos"
agent_root="$repo_root/apps/retail-local-agent"
output_dir=$(mkdir -p "$output_dir" && cd "$output_dir" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/bms-pos-bootstrap.XXXXXX")
build_complete=false
cleanup_outputs=false
cleanup() {
  if [[ $build_complete != true && $cleanup_outputs == true && -n ${dmg_path:-} ]]; then
    rm -f -- "$dmg_path" "$dmg_path.sha256" "$dmg_path.json" 2>/dev/null || true
  fi
  find "$work" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

for command in file go hdiutil plutil shasum; do
  command -v "$command" >/dev/null || { echo "Command was not found: $command" >&2; exit 1; }
done
[[ $(uname -s) == Darwin ]] || { echo "macOS POS bootstrap must be built on macOS" >&2; exit 1; }

case "$architecture" in
  arm64) go_arch=arm64 ;;
  x64) go_arch=amd64 ;;
esac
qualifier=
[[ $test_build != true ]] || qualifier=-SMOKE-ONLY
dmg_name="BMS-Retail-Local-POS-$version-macos-$architecture$qualifier.dmg"
dmg_path="$output_dir/$dmg_name"
for candidate in "$dmg_path" "$dmg_path.sha256" "$dmg_path.json"; do
  [[ ! -e $candidate || $force == true ]] || { echo "Artifact already exists: $candidate" >&2; exit 1; }
done
if [[ $force == true ]]; then rm -f -- "$dmg_path" "$dmg_path.sha256" "$dmg_path.json"; fi
cleanup_outputs=true

if [[ $skip_tests != true ]]; then (cd "$agent_root" && go test ./...); fi

image_root="$work/image"
app="$image_root/Install BMS POS.app"
contents="$app/Contents"
resources="$contents/Resources"
bootstrap="$resources/bootstrap"
mkdir -p "$contents/MacOS" "$bootstrap"

(cd "$agent_root" && CGO_ENABLED=0 GOOS=darwin GOARCH="$go_arch" go build \
  -trimpath -ldflags='-s -w' -o "$bootstrap/bms-runtime-agent" .)
cp "$keyring" "$bootstrap/trusted-release-keys.json"
install -m 0644 "$macos_root/../setup-diagnostics.sh" "$bootstrap/setup-diagnostics.sh"
printf '%s\n' "$manifest_url" >"$bootstrap/manifest-url"
printf '%s\n' "$control_url" >"$bootstrap/control-url"
printf '%s\n' "$version" >"$bootstrap/BOOTSTRAP_VERSION"
printf '%s\n' "macos-15-$architecture" >"$bootstrap/PLATFORM_TARGET"
if [[ -n $test_ca ]]; then cp "$test_ca" "$bootstrap/test-release-ca.pem"; fi
cp "$macos_root/bms-pos-online-app" "$contents/MacOS/Install BMS POS"
cp "$macos_root/bms-pos-online-setup.command" "$resources/BMS POS Online Setup.command"
cp "$repo_root/apps/web/public/icons/ios-icon-1024.png" "$resources/BMSPOS.png"

pkg_version=$(printf '%s' "$version" | awk -F '[^0-9]+' '{out=""; for(i=1;i<=NF;i++) if($i!="") out=out (out==""?"":".") $i; print out}')
cat >"$contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>Install BMS POS</string>
  <key>CFBundleExecutable</key><string>Install BMS POS</string>
  <key>CFBundleIconFile</key><string>BMSPOS.png</string>
  <key>CFBundleIdentifier</key><string>com.base2526.bms.pos-online-setup.$architecture</string>
  <key>CFBundleName</key><string>Install BMS POS</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$pkg_version</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
EOF
cat >"$image_root/README.txt" <<'EOF'
BMS POS Online Setup

1. Double-click “Install BMS POS”.
2. Keep the Mac connected to the internet during first installation.
3. Setup verifies the signed BMS release and SHA-256 before installing BMS POS in Applications.

POS Desktop supports macOS 12 Monterey or newer. Retail Local Server has separate requirements.
The DMG intentionally does not contain Electron or the full POS application.
EOF

chmod 0755 "$contents/MacOS/Install BMS POS" "$resources/BMS POS Online Setup.command" \
  "$bootstrap/bms-runtime-agent"
chmod 0644 "$bootstrap/trusted-release-keys.json" "$bootstrap/manifest-url" \
  "$bootstrap/control-url" "$bootstrap/BOOTSTRAP_VERSION" "$bootstrap/PLATFORM_TARGET" "$resources/BMSPOS.png" \
  "$contents/Info.plist" "$image_root/README.txt"
if [[ -f $bootstrap/test-release-ca.pem ]]; then chmod 0644 "$bootstrap/test-release-ca.pem"; fi
chmod -R go-w "$app"
xattr -cr "$image_root"
plutil -lint "$contents/Info.plist" >/dev/null

hdiutil create -quiet -fs HFS+ -format UDZO -volname "BMS POS Online Setup $version" \
  -srcfolder "$image_root" "$dmg_path"
"$macos_root/smoke-test-pos-bootstrap-dmg.sh" "$dmg_path"

size=$(stat -f %z "$dmg_path")
sha256=$(shasum -a 256 "$dmg_path" | awk '{print $1}')
printf '%s  %s\n' "$sha256" "$dmg_name" >"$dmg_path.sha256"
source_commit=$(git -C "$repo_root" rev-parse HEAD)
embedded_test_ca=false
[[ -z $test_ca ]] || embedded_test_ca=true
cat >"$dmg_path.json" <<EOF
{"artifact":"$dmg_path","version":"$version","sourceCommit":"$source_commit","platform":"macos-$architecture","architecture":"$architecture","packageType":"pos","distribution":"online-bootstrap","minimumOs":"macOS 12","testBuild":$test_build,"embeddedTestCa":$embedded_test_ca,"manifestUri":"$manifest_url","sizeBytes":$size,"sha256":"$sha256","signed":false,"notarized":false,"electronEmbedded":false,"firstInstallInternetRequired":true}
EOF

build_complete=true
printf 'macOS POS online bootstrap ready: %s (%s bytes)\n' "$dmg_path" "$size"
