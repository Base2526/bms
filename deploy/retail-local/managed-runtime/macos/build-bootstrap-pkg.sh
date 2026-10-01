#!/usr/bin/env bash
set -Eeuo pipefail
export COPYFILE_DISABLE=1

usage() {
  cat >&2 <<'EOF'
usage: build-bootstrap-pkg.sh --version VERSION --architecture arm64|x64 \
  --manifest-url HTTPS_URL --keyring FILE [--activation-url HTTPS_URL] \
  [--package-type server-pos|server] \
  [--output-dir DIR] [--allow-test-endpoints] [--test-ca FILE] [--force] [--skip-tests]

Builds the small macOS Retail Local online bootstrap. It contains only the native agent,
public release keyring and installer controls. Lima, Ubuntu, Moby and service images are downloaded
from the signed release manifest during first-run setup. Server + POS also downloads POS Desktop;
Server-only does not.
EOF
  exit 2
}

version=
architecture=
manifest_url=
activation_url=
keyring=
package_type=server-pos
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
    --package-type) package_type=${2:-}; shift 2 ;;
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
[[ $package_type == server-pos || $package_type == server ]] || usage
[[ -f $keyring ]] || usage

is_https_url() { [[ ${1:-} =~ ^https://[^/@:]+(:[0-9]{1,5})?([/?#].*)?$ && ${1:-} != *'@'* ]]; }
is_placeholder_url() {
  [[ ${1:-} =~ ^https://(localhost|127\.0\.0\.1|\[::1\]|[^/]*\.example\.(com|invalid)|example\.(com|invalid)|[^/]*\.invalid)([/:?#]|$) ]]
}
is_https_url "$manifest_url" || { echo "manifest URL ต้องเป็น HTTPS และไม่มี credential" >&2; exit 2; }
if [[ -n $activation_url ]]; then
  is_https_url "$activation_url" || { echo "activation URL ต้องเป็น HTTPS และไม่มี credential" >&2; exit 2; }
fi
test_build=false
if is_placeholder_url "$manifest_url" || { [[ -n $activation_url ]] && is_placeholder_url "$activation_url"; }; then
  test_build=true
  [[ $allow_test_endpoints == true ]] || {
    echo "ปฏิเสธ example/invalid endpoint; ใช้ --allow-test-endpoints ได้เฉพาะ smoke test" >&2; exit 2;
  }
fi
if [[ -n $test_ca ]]; then
  [[ $test_build == true && $allow_test_endpoints == true && -f $test_ca ]] || {
    echo "--test-ca ใช้ได้เฉพาะ smoke build ที่เป็น localhost/example endpoint" >&2; exit 2;
  }
  grep -q 'BEGIN CERTIFICATE' "$test_ca" || { echo "test CA ไม่ใช่ PEM certificate" >&2; exit 2; }
  ! grep -q 'PRIVATE KEY' "$test_ca" || { echo "ห้ามใส่ private key ใน bootstrap" >&2; exit 2; }
fi
grep -q 'BEGIN PUBLIC KEY' "$keyring" || { echo "keyring ไม่มี public key" >&2; exit 2; }
! grep -q 'PRIVATE KEY' "$keyring" || { echo "ห้ามใส่ private key ใน bootstrap" >&2; exit 2; }
[[ $(/usr/bin/plutil -extract formatVersion raw -o - "$keyring" 2>/dev/null || true) == 1 ]] || {
  echo "keyring ต้องเป็น JSON formatVersion 1" >&2; exit 2;
}
[[ -n $(/usr/bin/plutil -extract keys raw -o - "$keyring" 2>/dev/null || true) ]] || {
  echo "keyring ต้องมี trusted public key อย่างน้อยหนึ่ง key" >&2; exit 2;
}

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)
macos_root="$repo_root/deploy/retail-local/managed-runtime/macos"
agent_root="$repo_root/apps/retail-local-agent"
output_dir=$(mkdir -p "$output_dir" && cd "$output_dir" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/bms-macos-bootstrap.XXXXXX")
build_complete=false
cleanup_outputs=false
cleanup() {
  if [[ $build_complete != true && $cleanup_outputs == true && -n ${package_path:-} ]]; then
    rm -f -- "$package_path" "$package_path.sha256" "$package_path.json" 2>/dev/null || true
  fi
  find "$work" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

for command in file go pkgbuild pkgutil plutil productbuild shasum; do
  command -v "$command" >/dev/null || { echo "ไม่พบ $command" >&2; exit 1; }
done
[[ $(uname -s) == Darwin ]] || { echo "macOS bootstrap ต้อง build บน macOS" >&2; exit 1; }

case "$architecture" in
  arm64) go_arch=arm64; installer_host_arch=arm64 ;;
  x64) go_arch=amd64; installer_host_arch=x86_64 ;;
esac
qualifier=
[[ $test_build != true ]] || qualifier=-SMOKE-ONLY
case "$package_type" in
  server-pos) package_label=Server-POS ;;
  server) package_label=Server ;;
esac
package_name="BMS-Retail-Local-$package_label-$version-$architecture$qualifier.pkg"
package_path="$output_dir/$package_name"
for candidate in "$package_path" "$package_path.sha256" "$package_path.json"; do
  [[ ! -e $candidate || $force == true ]] || { echo "artifact มีอยู่แล้ว: $candidate" >&2; exit 1; }
done
if [[ $force == true ]]; then
  rm -f -- "$package_path" "$package_path.sha256" "$package_path.json"
fi
cleanup_outputs=true

if [[ $skip_tests != true ]]; then
  (cd "$agent_root" && go test ./...)
fi

package_root="$work/package-root"
install_root="$package_root/Library/Application Support/BMS/RetailLocal"
bootstrap_root="$install_root/bootstrap"
control_root="$install_root/control"
app_root="$package_root/Applications/BMS Retail Local.app"
app_contents="$app_root/Contents"
mkdir -p "$bootstrap_root" "$control_root" "$package_root/usr/local/bin" \
  "$app_contents/MacOS" "$app_contents/Resources"

(cd "$agent_root" && CGO_ENABLED=0 GOOS=darwin GOARCH="$go_arch" go build \
  -trimpath -ldflags='-s -w' -o "$bootstrap_root/bms-runtime-agent" .)
cp "$keyring" "$bootstrap_root/trusted-release-keys.json"
if [[ -n $test_ca ]]; then cp "$test_ca" "$bootstrap_root/test-release-ca.pem"; fi
printf '%s\n' "$manifest_url" >"$bootstrap_root/manifest-url"
printf '%s\n' "$activation_url" >"$bootstrap_root/activation-url"
printf '%s\n' "$version" >"$bootstrap_root/BOOTSTRAP_VERSION"
printf '%s\n' "macos-15-$architecture" >"$bootstrap_root/PLATFORM_TARGET"
printf '%s\n' "$package_type" >"$bootstrap_root/PACKAGE_TYPE"

cp "$macos_root/lima.yaml.template" "$control_root/lima.yaml.template"
cp "$macos_root/com.bms.retail-local.plist.template" "$control_root/com.bms.retail-local.plist.template"
cp "$macos_root/bms-retail-local" "$control_root/bms-retail-local"
install -m 0644 "$macos_root/../setup-diagnostics.sh" "$control_root/setup-diagnostics.sh"
printf '%s\n' "$version" >"$control_root/BOOTSTRAP_VERSION"
chmod 0644 "$control_root/BOOTSTRAP_VERSION"
cp "$macos_root/bms-retail-local" "$package_root/usr/local/bin/bms-retail-local"
cp "$macos_root/bms-retail-local-app" "$app_contents/MacOS/BMS Retail Local"
cp "$macos_root/bms-retail-local-setup.command" "$app_contents/Resources/BMS Retail Local Setup.command"
cp "$macos_root/BMS Retail Local Uninstall.command" "$package_root/Applications/BMS Retail Local Uninstall.command"
cp "$macos_root/BMSRetailLocal.icns" "$app_contents/Resources/BMSRetailLocal.icns"
readme_path="$macos_root/README.txt"
[[ $package_type != server ]] || readme_path="$macos_root/README-Server.txt"
cp "$readme_path" "$install_root/README.txt"
cp "$macos_root/THIRD_PARTY_NOTICES.txt" "$install_root/THIRD_PARTY_NOTICES.txt"

pkg_version=$(printf '%s' "$version" | awk -F '[^0-9]+' '{out=""; for(i=1;i<=NF;i++) if($i!="") out=out (out==""?"":".") $i; print out}')
cat >"$app_contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>BMS Retail Local</string>
  <key>CFBundleExecutable</key><string>BMS Retail Local</string>
  <key>CFBundleIconFile</key><string>BMSRetailLocal</string>
  <key>CFBundleIdentifier</key><string>com.base2526.bms.retail-local.app</string>
  <key>CFBundleName</key><string>BMS Retail Local</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$pkg_version</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
EOF

chmod 0755 "$bootstrap_root/bms-runtime-agent" "$control_root/bms-retail-local" \
  "$package_root/usr/local/bin/bms-retail-local" "$app_contents/MacOS/BMS Retail Local" \
  "$app_contents/Resources/BMS Retail Local Setup.command" \
  "$package_root/Applications/BMS Retail Local Uninstall.command"
# These files contain only public verification material and bootstrap settings. The setup app
# runs as the signed-in shop operator after pkg installation, so it must be able to read them even
# when the package builder's source files were created with a restrictive umask (for example 0600).
chmod 0644 "$bootstrap_root/trusted-release-keys.json" "$bootstrap_root/manifest-url" \
  "$bootstrap_root/activation-url" "$bootstrap_root/BOOTSTRAP_VERSION" \
  "$bootstrap_root/PLATFORM_TARGET" "$bootstrap_root/PACKAGE_TYPE"
if [[ -f $bootstrap_root/test-release-ca.pem ]]; then
  chmod 0644 "$bootstrap_root/test-release-ca.pem"
fi
chmod -R go-w "$install_root"
xattr -cr "$package_root"

scripts="$work/scripts"
mkdir -p "$scripts"
cp "$macos_root/postinstall-bootstrap" "$scripts/postinstall"
chmod 0755 "$scripts/postinstall"

component_pkg="$work/BMSRetailLocal.component.pkg"
component_plist="$work/components.plist"
pkgbuild --analyze --root "$package_root" "$component_plist" >/dev/null
component_index=0
found_app=false
while component_path=$(plutil -extract "$component_index.RootRelativeBundlePath" raw -o - "$component_plist" 2>/dev/null); do
  if [[ $component_path == "Applications/BMS Retail Local.app" ]]; then
    plutil -replace "$component_index.BundleIsRelocatable" -bool false "$component_plist"
    found_app=true
  fi
  component_index=$((component_index + 1))
done
[[ $found_app == true ]] || { echo "component policy ไม่พบ application bundle" >&2; exit 1; }
pkgbuild --root "$package_root" --scripts "$scripts" --component-plist "$component_plist" \
  --identifier com.base2526.bms.retail-local --version "$pkg_version" --install-location / \
  "$component_pkg" >/dev/null

cat >"$work/distribution.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>BMS Retail Local $package_label Online Setup $version</title>
  <organization>com.base2526.bms</organization>
  <domains enable_localSystem="true" enable_currentUserHome="false" enable_anywhere="false"/>
  <options customize="never" require-scripts="true" hostArchitectures="$installer_host_arch"/>
  <allowed-os-versions><os-version min="15.0"/></allowed-os-versions>
  <welcome file="README.txt"/>
  <license file="THIRD_PARTY_NOTICES.txt"/>
  <choices-outline><line choice="default"/></choices-outline>
  <choice id="default" visible="false"><pkg-ref id="com.base2526.bms.retail-local"/></choice>
  <pkg-ref id="com.base2526.bms.retail-local" version="$pkg_version">BMSRetailLocal.component.pkg</pkg-ref>
</installer-gui-script>
EOF
cp "$readme_path" "$work/README.txt"
cp "$macos_root/THIRD_PARTY_NOTICES.txt" "$work/THIRD_PARTY_NOTICES.txt"
productbuild --distribution "$work/distribution.xml" --resources "$work" \
  --package-path "$work" "$package_path" >/dev/null

"$macos_root/smoke-test-bootstrap-pkg.sh" "$package_path"

size=$(stat -f %z "$package_path")
((size <= 25 * 1024 * 1024)) || { echo "online bootstrap ใหญ่เกิน 25 MiB: $size bytes" >&2; exit 1; }
sha256=$(shasum -a 256 "$package_path" | awk '{print $1}')
embedded_test_ca=false
[[ -z $test_ca ]] || embedded_test_ca=true
printf '%s  %s\n' "$sha256" "$package_name" >"$package_path.sha256"
source_commit=$(git -C "$repo_root" rev-parse HEAD)
cat >"$package_path.json" <<EOF
{"artifact":"$package_path","version":"$version","sourceCommit":"$source_commit","platform":"macos-$architecture","architecture":"$architecture","packageType":"$package_type","distribution":"online-bootstrap","testBuild":$test_build,"embeddedTestCa":$embedded_test_ca,"manifestUri":"$manifest_url","sizeBytes":$size,"sha256":"$sha256","signed":false,"notarized":false,"dockerDesktopRequired":false,"firstInstallInternetRequired":true}
EOF

build_complete=true
printf 'macOS online bootstrap พร้อม: %s (%s bytes)\n' "$package_path" "$size"
