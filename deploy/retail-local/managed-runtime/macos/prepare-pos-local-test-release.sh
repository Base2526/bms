#!/usr/bin/env bash
set -Eeuo pipefail
export COPYFILE_DISABLE=1

usage() {
  cat >&2 <<'EOF'
usage: prepare-pos-local-test-release.sh --version SEMVER --architecture arm64|x64 \
  --source-dmg FULL_POS_DMG --base-url https://localhost:PORT/PATH \
  --private-key FILE --public-key FILE --keyring FILE --key-id ID --output-dir DIR [--force]

Creates a production-format signed local test release whose real desktop component comes from the
full Electron DMG. Other required manifest components are inert placeholders because stage-desktop
is the only allowed consumer for this POS-only smoke release.
EOF
  exit 2
}

version=
architecture=
source_dmg=
base_url=
private_key=
public_key=
keyring=
key_id=
output_dir=
force=false
while (($#)); do
  case "$1" in
    --version) version=${2:-}; shift 2 ;;
    --architecture) architecture=${2:-}; shift 2 ;;
    --source-dmg) source_dmg=${2:-}; shift 2 ;;
    --base-url) base_url=${2:-}; shift 2 ;;
    --private-key) private_key=${2:-}; shift 2 ;;
    --public-key) public_key=${2:-}; shift 2 ;;
    --keyring) keyring=${2:-}; shift 2 ;;
    --key-id) key_id=${2:-}; shift 2 ;;
    --output-dir) output_dir=${2:-}; shift 2 ;;
    --force) force=true; shift ;;
    *) usage ;;
  esac
done

[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || usage
[[ $architecture == arm64 || $architecture == x64 ]] || usage
[[ -f $source_dmg && -f $private_key && -f $public_key && -f $keyring && -n $output_dir ]] || usage
[[ $key_id =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || usage
[[ $base_url =~ ^https://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/[^[:space:]#]*)?$ ]] || {
  echo "local test base URL ต้องเป็น HTTPS loopback" >&2; exit 2;
}
base_url=${base_url%/}
absolute_file() {
  local path=$1 directory name
  directory=$(cd -- "$(dirname -- "$path")" && pwd)
  name=$(basename -- "$path")
  printf '%s/%s' "$directory" "$name"
}
source_dmg=$(absolute_file "$source_dmg")
private_key=$(absolute_file "$private_key")
public_key=$(absolute_file "$public_key")
keyring=$(absolute_file "$keyring")

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)
managed_root="$repo_root/deploy/retail-local/managed-runtime"
agent_root="$repo_root/apps/retail-local-agent"
[[ $output_dir == /* ]] || output_dir="$repo_root/$output_dir"
if [[ -e $output_dir ]]; then
  [[ $force == true ]] || { echo "output มีอยู่แล้ว: $output_dir" >&2; exit 1; }
  [[ $output_dir == *'/artifacts/retail-local/test-server/'* ]] || {
    echo "ปฏิเสธลบ output นอก test-server: $output_dir" >&2; exit 1;
  }
  find "$output_dir" -depth -delete
fi
mkdir -p "$output_dir"

work=$(mktemp -d "${TMPDIR:-/tmp}/bms-pos-local-release.XXXXXX")
mount="$work/mount"
mounted=false
cleanup() {
  [[ $mounted != true ]] || hdiutil detach "$mount" -quiet >/dev/null 2>&1 || true
  find "$work" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
mkdir -p "$mount"
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$source_dmg" -quiet
mounted=true
desktop_app=$(find "$mount" -maxdepth 2 -type d -name 'BMS POS.app' -print -quit)
[[ -n $desktop_app && -x $desktop_app/Contents/MacOS/BMS\ POS ]] || {
  echo "source DMG ไม่มี BMS POS.app" >&2; exit 1;
}
desktop_file=$(file "$desktop_app/Contents/MacOS/BMS POS")
if [[ $architecture == arm64 ]]; then
  [[ $desktop_file == *arm64* ]] || { echo "source app ไม่ใช่ arm64" >&2; exit 1; }
else
  [[ $desktop_file == *x86_64* ]] || { echo "source app ไม่ใช่ x64" >&2; exit 1; }
fi
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$desktop_app" "$output_dir/desktop.artifact"
hdiutil detach "$mount" -quiet
mounted=false

for name in web ws postgres redis runtime compose; do
  printf 'POS-only local smoke placeholder: %s\n' "$name" >"$output_dir/$name.artifact"
done
cp "$repo_root/packages/retail-local-contract/shop-archetypes.json" "$output_dir/shop-archetypes.artifact"

commit=$(git -C "$repo_root" rev-parse HEAD)
created_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
digest="sha256:$(printf '0%.0s' {1..64})"
descriptor="$output_dir/release-descriptor.json"
node --input-type=module - "$output_dir" "$base_url" "$version" "$architecture" "$key_id" "$commit" "$created_at" "$digest" <<'EOF'
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const [output, baseUrl, version, architecture, keyId, sourceCommit, createdAt, digest] = process.argv.slice(2);
const component = (name, kind, extra = {}) => ({
  name, kind, path: join(output, `${name}.artifact`), url: `${baseUrl}/${name}.artifact`, ...extra,
});
const descriptor = {
  releaseVersion: version,
  channel: "pilot",
  platformTarget: `macos-15-${architecture}`,
  minimumAgentVersion: "0.5.2",
  schemaVersion: "10.30",
  rollbackSafe: false,
  createdAt,
  sourceCommit,
  keyId,
  components: [
    component("web", "oci-image", { imageRef: `bms/web:${version}`, ociDigest: digest }),
    component("ws", "oci-image", { imageRef: `bms/ws:${version}`, ociDigest: digest }),
    component("postgres", "oci-image", { imageRef: "postgres:16-alpine", ociDigest: digest }),
    component("redis", "oci-image", { imageRef: "redis:7-alpine", ociDigest: digest }),
    component("runtime", "runtime"),
    component("compose", "support-file"),
    component("desktop", "desktop"),
    component("shop-archetypes", "support-file"),
  ],
};
writeFileSync(join(output, "release-descriptor.json"), JSON.stringify(descriptor, null, 2) + "\n", { mode: 0o600 });
EOF

BMS_ALLOW_LOCAL_RELEASE_SIGNING=1 node "$managed_root/sign-release.mjs" \
  "$descriptor" "$private_key" "$output_dir/release.jws.json"
node "$managed_root/verify-release.mjs" --manifest "$output_dir/release.jws.json" \
  --public-key "$public_key" --key-id "$key_id" --target "macos-15-$architecture" >/dev/null
(cd "$agent_root" && go run . verify-release -manifest "$output_dir/release.jws.json" \
  -keyring "$keyring" -target "macos-15-$architecture" >/dev/null)
shasum -a 256 "$output_dir"/*.artifact "$output_dir/release.jws.json" >"$output_dir/SHA256SUMS"
printf 'POS local test release พร้อม: %s (%s)\n' "$output_dir" "macos-15-$architecture"
