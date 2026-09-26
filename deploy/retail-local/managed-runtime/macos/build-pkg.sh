#!/usr/bin/env bash
set -Eeuo pipefail
export COPYFILE_DISABLE=1

usage() {
  cat >&2 <<'EOF'
usage: build-pkg.sh [--version VERSION] [--package-type server|server-pos] [--reuse-images] [--output-dir DIR] [--cache-dir DIR]

Builds a full, unsigned macOS Apple Silicon Retail Local technical-pilot installer. The package
contains Lima, an Ubuntu ARM64 cloud image, a private Moby engine, Compose, age, and all BMS service
images. `server-pos` also embeds the Apple Silicon BMS POS app and performs a one-time secure
pairing handoff. Docker Desktop is used only as a build engine on this workstation and is not
required by the target Mac.
EOF
  exit 2
}

version=0.4.0-internal.1
output_dir=artifacts/retail-local/managed-runtime/macos
cache_dir=artifacts/retail-local/managed-runtime/cache
package_type=server
reuse_images=false
while (($#)); do
  case "$1" in
    --version) version=${2:-}; shift 2 ;;
    --package-type) package_type=${2:-}; shift 2 ;;
    --reuse-images) reuse_images=true; shift ;;
    --output-dir) output_dir=${2:-}; shift 2 ;;
    --cache-dir) cache_dir=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done
[[ $version =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || usage
[[ $package_type == server || $package_type == server-pos ]] || usage

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)
macos_root="$repo_root/deploy/retail-local/managed-runtime/macos"
managed_root="$repo_root/deploy/retail-local/managed-runtime"
agent_root="$repo_root/apps/retail-local-agent"
desktop_root="$repo_root/apps/desktop"
output_dir=$(mkdir -p "$output_dir" && cd "$output_dir" && pwd)
cache_dir=$(mkdir -p "$cache_dir" && cd "$cache_dir" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/bms-macos-pkg.XXXXXX")
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT HUP INT TERM

for command in curl ditto docker file go gzip pkgbuild pkgutil plutil productbuild shasum tar; do
  command -v "$command" >/dev/null || { echo "ไม่พบ $command" >&2; exit 1; }
done
[[ $(uname -s) == Darwin && $(uname -m) == arm64 ]] || {
  echo "build-pkg.sh ต้องรันบน macOS Apple Silicon" >&2; exit 1;
}
docker info >/dev/null 2>&1 || { echo "Docker build engine ไม่พร้อม" >&2; exit 1; }

readonly LIMA_VERSION=2.2.0
readonly LIMA_SHA=bbdef91774885a0d05f7b048c4eb89ae2bcf3a0c252ae7ca7934e63df76d93c3
readonly UBUNTU_SHA=7b682958a67ff5de068e36de6af8b75fa645d296af5a70d6500527f6a33781db
readonly DOCKER_VERSION=29.4.1
readonly DOCKER_SHA=53cfa1de79155f27643014a84f1de94e2185239726b179b5c30523d62e565bb0
readonly COMPOSE_VERSION=5.0.2
readonly COMPOSE_SHA=ac7810e0cd56a5b58576688196fafa843e07e8241fb91018a736d549ea20a3f3
readonly AGE_VERSION=1.2.1
readonly AGE_SHA=57fd79a7ece5fe501f351b9dd51a82fbee1ea8db65a8839db17f5c080245e99f

fetch() {
  local url=$1 destination=$2 expected=$3 actual
  if [[ ! -f $destination ]]; then
    echo "Download: $url"
    curl -fL --retry 3 --connect-timeout 20 -o "$destination.part" "$url"
    mv "$destination.part" "$destination"
  fi
  actual=$(shasum -a 256 "$destination" | awk '{print $1}')
  [[ $actual == "$expected" ]] || {
    echo "checksum ไม่ตรง: $destination (ต้องการ $expected ได้ $actual)" >&2; exit 1;
  }
}

lima_archive="$cache_dir/lima-$LIMA_VERSION-Darwin-arm64.tar.gz"
ubuntu_image="$cache_dir/ubuntu-24.04-server-cloudimg-arm64.img"
docker_archive="$cache_dir/docker-$DOCKER_VERSION-aarch64.tgz"
compose_binary="$cache_dir/docker-compose-linux-aarch64"
age_archive="$cache_dir/age-v$AGE_VERSION-linux-arm64.tar.gz"
fetch "https://github.com/lima-vm/lima/releases/download/v$LIMA_VERSION/lima-$LIMA_VERSION-Darwin-arm64.tar.gz" "$lima_archive" "$LIMA_SHA"
fetch "https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-arm64.img" "$ubuntu_image" "$UBUNTU_SHA"
fetch "https://download.docker.com/linux/static/stable/aarch64/docker-$DOCKER_VERSION.tgz" "$docker_archive" "$DOCKER_SHA"
fetch "https://github.com/docker/compose/releases/download/v$COMPOSE_VERSION/docker-compose-linux-aarch64" "$compose_binary" "$COMPOSE_SHA"
fetch "https://github.com/FiloSottile/age/releases/download/v$AGE_VERSION/age-v$AGE_VERSION-linux-arm64.tar.gz" "$age_archive" "$AGE_SHA"

web_ref="bms/retail-local-web:$version-arm64"
ws_ref="bms/retail-local-ws:$version-arm64"
postgres_ref="bms/retail-local-postgres:16-alpine-$version-arm64"
redis_ref="bms/retail-local-redis:7-alpine-$version-arm64"
pkg_version=$(printf '%s' "$version" | awk -F '[^0-9]+' '{out=""; for(i=1;i<=NF;i++) if($i!="") out=out (out==""?"":".") $i; print out}')

if [[ $reuse_images == true ]]; then
  for image_ref in "$web_ref" "$ws_ref" "$postgres_ref" "$redis_ref"; do
    docker image inspect "$image_ref" >/dev/null 2>&1 || {
      echo "--reuse-images ระบุไว้แต่ไม่พบ image: $image_ref" >&2; exit 1;
    }
  done
  echo "Reuse verified local service images for $version"
else
  echo "Build Web image: $web_ref"
  docker buildx build --platform linux/arm64 --provenance=false --load \
    --build-arg NEXT_BUILD_CPUS="${NEXT_BUILD_CPUS:-2}" \
    --build-arg NODE_BUILD_MAX_OLD_SPACE_SIZE="${NODE_BUILD_MAX_OLD_SPACE_SIZE:-4096}" \
    --build-arg NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3100 \
    --build-arg NEXT_PUBLIC_GRAPHQL_HTTP=http://127.0.0.1:3100/api/graphql \
    --build-arg NEXT_PUBLIC_GRAPHQL_WS=ws://127.0.0.1:3101/graphql \
    --build-arg COOKIE_SECURE=0 --build-arg 'WEB_NAME=BMS Retail Local' \
    -f "$repo_root/apps/web/Dockerfile" -t "$web_ref" "$repo_root"
  echo "Build WS image: $ws_ref"
  docker buildx build --platform linux/arm64 --provenance=false --load \
    -f "$repo_root/apps/ws/Dockerfile" -t "$ws_ref" "$repo_root"
  printf 'FROM postgres:16-alpine\n' | docker buildx build --platform linux/arm64 \
    --provenance=false --load -f - -t "$postgres_ref" .
  printf 'FROM redis:7-alpine\n' | docker buildx build --platform linux/arm64 \
    --provenance=false --load -f - -t "$redis_ref" .
fi

package_root="$work/package-root"
install_root="$package_root/Library/Application Support/BMS/RetailLocal"
payload="$install_root/payload"
app_root="$package_root/Applications/BMS Retail Local.app"
app_contents="$app_root/Contents"
mkdir -p "$payload/images" "$payload/bin" "$payload/runtime" \
  "$install_root/control" "$install_root/runtime/lima" \
  "$package_root/usr/local/bin" "$app_contents/MacOS" "$app_contents/Resources"

if [[ $package_type == server-pos ]]; then
  desktop_builder="$desktop_root/node_modules/.bin/electron-builder"
  [[ -x $desktop_builder ]] || {
    echo "ไม่พบ electron-builder; รัน npm install ใน apps/desktop ก่อน" >&2; exit 1;
  }
  echo "Build Apple Silicon BMS POS app"
  (cd "$desktop_root" && CSC_IDENTITY_AUTO_DISCOVERY=false "$desktop_builder" \
    --mac --arm64 --dir --config.directories.output="$work/desktop-dist")
  desktop_app="$work/desktop-dist/mac-arm64/BMS POS.app"
  [[ -d $desktop_app ]] || { echo "ไม่พบ BMS POS.app หลัง build" >&2; exit 1; }
  ditto "$desktop_app" "$package_root/Applications/BMS POS.app"
fi

echo "Export ARM64 service images"
docker image save "$web_ref" | gzip -6 >"$payload/images/web.artifact"
docker image save "$ws_ref" | gzip -6 >"$payload/images/ws.artifact"
docker image save "$postgres_ref" | gzip -6 >"$payload/images/postgres.artifact"
docker image save "$redis_ref" | gzip -6 >"$payload/images/redis.artifact"
web_digest=$(docker image inspect --format '{{.Id}}' "$web_ref")
ws_digest=$(docker image inspect --format '{{.Id}}' "$ws_ref")
postgres_digest=$(docker image inspect --format '{{.Id}}' "$postgres_ref")
redis_digest=$(docker image inspect --format '{{.Id}}' "$redis_ref")
{
  printf 'web\timages/web.artifact\t%s\t%s\n' "$web_ref" "$web_digest"
  printf 'ws\timages/ws.artifact\t%s\t%s\n' "$ws_ref" "$ws_digest"
  printf 'postgres\timages/postgres.artifact\t%s\t%s\n' "$postgres_ref" "$postgres_digest"
  printf 'redis\timages/redis.artifact\t%s\t%s\n' "$redis_ref" "$redis_digest"
} >"$payload/release-images.tsv"

cp "$ubuntu_image" "$payload/ubuntu-24.04-server-cloudimg-arm64.img"
cp "$docker_archive" "$payload/runtime/docker-aarch64.tgz"
cp "$compose_binary" "$payload/runtime/docker-compose-linux-aarch64"
cp "$age_archive" "$payload/runtime/age-linux-arm64.tar.gz"
cp "$managed_root/compose.managed.yml" "$payload/compose.artifact"
cp "$managed_root/runtime-rootfs/bms-localctl" "$payload/bms-localctl"
(cd "$agent_root" && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build \
  -trimpath -ldflags='-s -w' -o "$payload/bin/bms-runtime-agent" .)
tar -xzf "$lima_archive" -C "$install_root/runtime/lima"

cp "$macos_root/lima.yaml.template" "$install_root/control/lima.yaml.template"
cp "$macos_root/com.bms.retail-local.plist.template" "$install_root/control/com.bms.retail-local.plist.template"
cp "$macos_root/bms-retail-local" "$install_root/control/bms-retail-local"
cp "$macos_root/bms-retail-local" "$package_root/usr/local/bin/bms-retail-local"
cp "$macos_root/bms-retail-local-app" "$app_contents/MacOS/BMS Retail Local"
cp "$macos_root/bms-retail-local-setup.command" "$app_contents/Resources/BMS Retail Local Setup.command"
cp "$macos_root/BMSRetailLocal.icns" "$app_contents/Resources/BMSRetailLocal.icns"
cat >"$app_contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
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
</dict>
</plist>
EOF
cp "$macos_root/README.txt" "$install_root/README.txt"
cp "$macos_root/THIRD_PARTY_NOTICES.txt" "$install_root/THIRD_PARTY_NOTICES.txt"
printf '%s\n' "$version" >"$payload/VERSION"
printf '%s\n' "$package_type" >"$payload/PACKAGE_TYPE"
git -C "$repo_root" rev-parse HEAD >"$payload/SOURCE_COMMIT"

chmod 0755 "$payload/bin/bms-runtime-agent" "$payload/bms-localctl" \
  "$payload/runtime/docker-compose-linux-aarch64" \
  "$install_root/control/bms-retail-local" "$package_root/usr/local/bin/bms-retail-local" \
  "$app_contents/MacOS/BMS Retail Local" \
  "$app_contents/Resources/BMS Retail Local Setup.command"
chmod -R go-w "$install_root"
xattr -cr "$package_root"
checksum_file="$work/SHA256SUMS"
(cd "$payload" && find . -type f -print0 | sort -z | xargs -0 shasum -a 256) >"$checksum_file"
mv "$checksum_file" "$payload/SHA256SUMS"

scripts="$work/scripts"
mkdir -p "$scripts"
cp "$macos_root/postinstall" "$scripts/postinstall"
chmod 0755 "$scripts/postinstall"

component_pkg="$work/BMSRetailLocal.component.pkg"
component_plist="$work/components.plist"
pkgbuild --analyze --root "$package_root" "$component_plist" >/dev/null
component_index=0
non_relocatable_apps=0
while component_path=$(plutil -extract "$component_index.RootRelativeBundlePath" raw -o - "$component_plist" 2>/dev/null); do
  case "$component_path" in
    "Applications/BMS Retail Local.app"|"Applications/BMS POS.app")
      plutil -replace "$component_index.BundleIsRelocatable" -bool false "$component_plist"
      non_relocatable_apps=$((non_relocatable_apps + 1))
      ;;
  esac
  component_index=$((component_index + 1))
done
expected_non_relocatable_apps=1
[[ $package_type == server-pos ]] && expected_non_relocatable_apps=2
[[ $non_relocatable_apps -eq $expected_non_relocatable_apps ]] || {
  echo "component policy ไม่พบ application bundle ครบ" >&2; exit 1;
}
pkgbuild --root "$package_root" --scripts "$scripts" \
  --component-plist "$component_plist" \
  --identifier com.base2526.bms.retail-local --version "$pkg_version" \
  --install-location / "$component_pkg" >/dev/null

package_title="BMS Retail Local Server"
package_name="BMS-Retail-Local-Server"
if [[ $package_type == server-pos ]]; then
  package_title="BMS Retail Local Server + POS"
  package_name="BMS-Retail-Local-Server-POS"
fi
cat >"$work/distribution.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>$package_title $version</title>
  <organization>com.base2526.bms</organization>
  <domains enable_localSystem="true" enable_currentUserHome="false" enable_anywhere="false"/>
  <options customize="never" require-scripts="true" hostArchitectures="arm64"/>
  <allowed-os-versions><os-version min="15.0"/></allowed-os-versions>
  <welcome file="README.txt"/>
  <license file="THIRD_PARTY_NOTICES.txt"/>
  <choices-outline><line choice="default"/></choices-outline>
  <choice id="default" visible="false"><pkg-ref id="com.base2526.bms.retail-local"/></choice>
  <pkg-ref id="com.base2526.bms.retail-local" version="$pkg_version">BMSRetailLocal.component.pkg</pkg-ref>
</installer-gui-script>
EOF
cp "$macos_root/README.txt" "$work/README.txt"
cp "$macos_root/THIRD_PARTY_NOTICES.txt" "$work/THIRD_PARTY_NOTICES.txt"

package_path="$output_dir/$package_name-$version-arm64.pkg"
[[ ! -e $package_path ]] || { echo "ไฟล์มีอยู่แล้ว: $package_path" >&2; exit 1; }
productbuild --distribution "$work/distribution.xml" --package-path "$work" \
  --resources "$work" "$package_path" >/dev/null
verify_archive="$work/verify-archive"
pkgutil --expand "$package_path" "$verify_archive"
payload_archive="$verify_archive/BMSRetailLocal.component.pkg/Payload"
[[ -f $payload_archive ]] || {
  echo "package payload ต้องเป็น archive ไม่ใช่ directory" >&2; exit 1;
}
file "$payload_archive" | grep -q 'gzip compressed data' || {
  echo "package payload ไม่ใช่ gzip archive ที่ macOS Installer รองรับ" >&2; exit 1;
}
sha256=$(shasum -a 256 "$package_path" | awk '{print $1}')
size=$(stat -f %z "$package_path")
printf '%s  %s\n' "$sha256" "$(basename "$package_path")" >"$package_path.sha256"
cat >"$package_path.json" <<EOF
{"artifact":"$package_path","version":"$version","platform":"macos-arm64","packageType":"$package_type","minimumOs":"macOS 15","sizeBytes":$size,"sha256":"$sha256","signed":false,"notarized":false,"dockerDesktopRequired":false}
EOF
printf 'Package: %s\nSize: %s bytes\nSHA-256: %s\n' "$package_path" "$size" "$sha256"
