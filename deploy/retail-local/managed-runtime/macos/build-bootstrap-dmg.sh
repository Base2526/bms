#!/usr/bin/env bash
set -Eeuo pipefail
export COPYFILE_DISABLE=1

usage() {
  cat >&2 <<'EOF'
usage: build-bootstrap-dmg.sh --version VERSION --architecture arm64|x64 \
  --manifest-url HTTPS_URL --keyring FILE --activation-url HTTPS_URL \
  [--output-dir DIR] [--allow-test-endpoints] [--test-ca FILE] [--force] [--skip-tests]

Builds a small Server + POS macOS online-bootstrap DMG. The DMG contains the architecture-specific
PKG installer, public release-verification material and setup controls only; runtime and application
components are downloaded from the signed release manifest during first-run setup.
EOF
  exit 2
}

version=
architecture=
manifest_url=
activation_url=
keyring=
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
    --activation-url) activation_url=${2:-}; shift 2 ;;
    --keyring) keyring=${2:-}; shift 2 ;;
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
[[ $manifest_url =~ ^https://[^/@:]+(:[0-9]{1,5})?([/?#].*)?$ && $manifest_url != *'@'* ]] || usage
[[ $activation_url =~ ^https://[^/@:]+(:[0-9]{1,5})?([/?#].*)?$ && $activation_url != *'@'* ]] || {
  echo "activation URL must use HTTPS and contain no credentials" >&2; exit 2
}

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)
macos_root="$repo_root/deploy/retail-local/managed-runtime/macos"
output_dir=$(mkdir -p "$output_dir" && cd "$output_dir" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/bms-macos-bootstrap-dmg.XXXXXX")
build_complete=false
cleanup_outputs=false
cleanup() {
  if [[ $build_complete != true && $cleanup_outputs == true && -n ${dmg_path:-} ]]; then
    rm -f -- "$dmg_path" "$dmg_path.sha256" "$dmg_path.json" 2>/dev/null || true
  fi
  find "$work" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

for command in hdiutil pkgutil shasum; do
  command -v "$command" >/dev/null || { echo "Command was not found: $command" >&2; exit 1; }
done
[[ $(uname -s) == Darwin ]] || { echo "macOS bootstrap DMG must be built on macOS" >&2; exit 1; }

pkg_args=(
  --version "$version"
  --architecture "$architecture"
  --manifest-url "$manifest_url"
  --keyring "$keyring"
  --activation-url "$activation_url"
  --output-dir "$work/pkg"
)
[[ $allow_test_endpoints != true ]] || pkg_args+=(--allow-test-endpoints)
[[ -z $test_ca ]] || pkg_args+=(--test-ca "$test_ca")
[[ $skip_tests != true ]] || pkg_args+=(--skip-tests)
"$macos_root/build-bootstrap-pkg.sh" "${pkg_args[@]}"

package_path=$(find "$work/pkg" -maxdepth 1 -type f -name '*.pkg' -print -quit)
[[ -n $package_path ]] || { echo "Failed to create the bootstrap PKG" >&2; exit 1; }
pkgutil --check-signature "$package_path" >/dev/null 2>&1 || true

test_build=$(node --input-type=module -e \
  'import { readFileSync } from "node:fs"; const metadata=JSON.parse(readFileSync(process.argv[1],"utf8")); process.stdout.write(String(metadata.testBuild));' \
  "$package_path.json")
qualifier=
[[ $test_build != true ]] || qualifier=-SMOKE-ONLY
dmg_name="BMS-Retail-Local-Server-POS-$version-macos-$architecture$qualifier.dmg"
dmg_path="$output_dir/$dmg_name"
for candidate in "$dmg_path" "$dmg_path.sha256" "$dmg_path.json"; do
  [[ ! -e $candidate || $force == true ]] || { echo "Artifact already exists: $candidate" >&2; exit 1; }
done
if [[ $force == true ]]; then rm -f -- "$dmg_path" "$dmg_path.sha256" "$dmg_path.json"; fi
cleanup_outputs=true

image_root="$work/image"
mkdir -p "$image_root"
cp "$package_path" "$image_root/Install BMS Retail Local.pkg"
cat >"$image_root/README.txt" <<'EOF'
BMS Retail Local Server + POS Online Setup

1. Double-click “Install BMS Retail Local.pkg”.
2. Complete the macOS Installer steps.
3. Keep the Mac connected to the internet, then open “BMS Retail Local” from Applications.

Setup verifies the signed BMS release and SHA-256 before downloading and installing each component.
The DMG intentionally does not contain the large runtime, service images, or Electron application.
EOF
chmod 0644 "$image_root/Install BMS Retail Local.pkg" "$image_root/README.txt"
xattr -cr "$image_root"

hdiutil create -quiet -fs HFS+ -format UDZO -volname "BMS Retail Local Setup $version" \
  -srcfolder "$image_root" "$dmg_path"
hdiutil verify "$dmg_path" >/dev/null

mount="$work/mount"
mkdir -p "$mount"
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$dmg_path" -quiet
[[ -f $mount/Install\ BMS\ Retail\ Local.pkg && -f $mount/README.txt ]] || {
  hdiutil detach "$mount" -quiet || true
  echo "DMG is missing the installer or README" >&2
  exit 1
}
pkgutil --expand "$mount/Install BMS Retail Local.pkg" "$work/expanded" >/dev/null
hdiutil detach "$mount" -quiet

size=$(stat -f %z "$dmg_path")
((size <= 30 * 1024 * 1024)) || { echo "Online bootstrap DMG exceeds 30 MiB: $size bytes" >&2; exit 1; }
sha256=$(shasum -a 256 "$dmg_path" | awk '{print $1}')
printf '%s  %s\n' "$sha256" "$dmg_name" >"$dmg_path.sha256"
source_commit=$(git -C "$repo_root" rev-parse HEAD)
embedded_test_ca=false
[[ -z $test_ca ]] || embedded_test_ca=true
cat >"$dmg_path.json" <<EOF
{"artifact":"$dmg_path","version":"$version","sourceCommit":"$source_commit","platform":"macos-$architecture","architecture":"$architecture","packageType":"server-pos","distribution":"online-bootstrap-dmg","testBuild":$test_build,"embeddedTestCa":$embedded_test_ca,"manifestUri":"$manifest_url","sizeBytes":$size,"sha256":"$sha256","signed":false,"notarized":false,"electronEmbedded":false,"runtimeEmbedded":false,"firstInstallInternetRequired":true}
EOF

build_complete=true
printf 'macOS Server + POS online bootstrap DMG ready: %s (%s bytes)\n' "$dmg_path" "$size"
