#!/usr/bin/env bash
set -Eeuo pipefail
export COPYFILE_DISABLE=1

usage() {
  cat >&2 <<'EOF'
usage: prepare-release.sh --version VERSION --architecture arm64|x64 --base-url HTTPS_URL \
  --desktop-app '/path/BMS POS.app' --private-key FILE --key-id ID \
  [--output-dir DIR] [--cache-dir DIR] [--reuse-images]

Builds the architecture-specific macOS release components consumed by the small online bootstrap,
then writes and signs release.jws.json. The private key is used only by this release-preparation step
and is never copied into an installer or release component.
EOF
  exit 2
}

version=
architecture=
base_url=
desktop_app=
private_key=
key_id=
output_dir=
cache_dir=artifacts/retail-local/managed-runtime/cache
reuse_images=false
while (($#)); do
  case "$1" in
    --version) version=${2:-}; shift 2 ;;
    --architecture) architecture=${2:-}; shift 2 ;;
    --base-url) base_url=${2:-}; shift 2 ;;
    --desktop-app) desktop_app=${2:-}; shift 2 ;;
    --private-key) private_key=${2:-}; shift 2 ;;
    --key-id) key_id=${2:-}; shift 2 ;;
    --output-dir) output_dir=${2:-}; shift 2 ;;
    --cache-dir) cache_dir=${2:-}; shift 2 ;;
    --reuse-images) reuse_images=true; shift ;;
    *) usage ;;
  esac
done

[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || usage
[[ $architecture == arm64 || $architecture == x64 ]] || usage
[[ $key_id =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || usage
[[ -d $desktop_app && -f $private_key ]] || usage
[[ $base_url =~ ^https://[^/@:]+(:[0-9]{1,5})?([/?#].*)?$ && $base_url != *'@'* ]] || {
  echo "base URL ต้องเป็น HTTPS และไม่มี credential" >&2; exit 2;
}
base_url=${base_url%/}

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)
managed_root="$repo_root/deploy/retail-local/managed-runtime"
macos_root="$managed_root/macos"
[[ -z $(git -C "$repo_root" status --porcelain --untracked-files=normal) ]] || {
  echo "working tree ต้องสะอาดก่อนสร้าง signed release" >&2
  exit 1
}
commit=$(git -C "$repo_root" rev-parse HEAD)
[[ $commit =~ ^[a-f0-9]{40}$ ]] || { echo "อ่าน source commit ไม่สำเร็จ" >&2; exit 1; }
output_dir=${output_dir:-"$repo_root/artifacts/retail-local/managed-runtime/releases/$version/macos-15-$architecture"}
mkdir -p "$output_dir" "$cache_dir"
output_dir=$(cd "$output_dir" && pwd)
cache_dir=$(cd "$cache_dir" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/bms-macos-release.XXXXXX")
release_complete=false
cleanup_outputs=false
cleanup() {
  if [[ $release_complete != true && $cleanup_outputs == true ]]; then
    rm -f -- "$output_dir"/{web,ws,postgres,redis,runtime,compose,desktop,shop-archetypes}.artifact \
      "$output_dir/release-descriptor.json" "$output_dir/release.jws.json" "$output_dir/SHA256SUMS" \
      2>/dev/null || true
  fi
  find "$work" -depth -delete >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

for command in curl ditto docker file gzip node shasum tar; do
  command -v "$command" >/dev/null || { echo "ไม่พบ $command" >&2; exit 1; }
done
[[ $(uname -s) == Darwin ]] || { echo "macOS release ต้องเตรียมบน macOS" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker build engine ไม่พร้อม" >&2; exit 1; }
desktop_executable="$desktop_app/Contents/MacOS/BMS POS"
[[ -x $desktop_executable && -f $desktop_app/Contents/Info.plist ]] || {
  echo "desktop app ไม่ใช่ BMS POS.app ที่สมบูรณ์: $desktop_app" >&2; exit 1;
}
desktop_file=$(file "$desktop_executable")
if [[ $architecture == arm64 ]]; then
  [[ $desktop_file == *arm64* ]] || { echo "BMS POS.app ไม่ใช่ Apple Silicon build" >&2; exit 1; }
else
  [[ $desktop_file == *x86_64* ]] || { echo "BMS POS.app ไม่ใช่ Intel build" >&2; exit 1; }
fi
for name in web ws postgres redis runtime compose desktop shop-archetypes; do
  [[ ! -e $output_dir/$name.artifact ]] || { echo "artifact มีอยู่แล้ว: $output_dir/$name.artifact" >&2; exit 1; }
done
[[ ! -e $output_dir/release-descriptor.json && ! -e $output_dir/release.jws.json ]] || {
  echo "release metadata มีอยู่แล้วใน $output_dir" >&2; exit 1;
}
cleanup_outputs=true

readonly LIMA_VERSION=2.2.0
readonly UBUNTU_RELEASE=release-20260926
readonly DOCKER_VERSION=29.4.1
readonly COMPOSE_VERSION=5.0.2
readonly AGE_VERSION=1.2.1
if [[ $architecture == arm64 ]]; then
  lima_host_arch=arm64; lima_guest_arch=aarch64; linux_platform=linux/arm64
  ubuntu_arch=arm64; docker_arch=aarch64; compose_arch=aarch64; age_arch=arm64
  LIMA_SHA=bbdef91774885a0d05f7b048c4eb89ae2bcf3a0c252ae7ca7934e63df76d93c3
  UBUNTU_SHA=1d6bffe64b848468ac97f821d369a4846d983de1800ccf6b5ec8853e85cefc55
  DOCKER_SHA=53cfa1de79155f27643014a84f1de94e2185239726b179b5c30523d62e565bb0
  COMPOSE_SHA=ac7810e0cd56a5b58576688196fafa843e07e8241fb91018a736d549ea20a3f3
  AGE_SHA=57fd79a7ece5fe501f351b9dd51a82fbee1ea8db65a8839db17f5c080245e99f
else
  lima_host_arch=x86_64; lima_guest_arch=x86_64; linux_platform=linux/amd64
  ubuntu_arch=amd64; docker_arch=x86_64; compose_arch=x86_64; age_arch=amd64
  LIMA_SHA=0d6f99c19f6e4bc3c92730c4c29d929e6927f0cb0a0ba1a84383367135a8ff31
  UBUNTU_SHA=6a81c37564db9b1ee84e141922625e1d7c5b389b99bb3c572e0243607d5bb4d2
  DOCKER_SHA=0fb3d2b72414ab862d68517f0b17b78c93c149d1c5c461acb969aacde1a2189d
  COMPOSE_SHA=2d880f723d3da7c779c54fdaea91a842fca8af55d1397f1ed8d7cbab3dd7af67
  AGE_SHA=7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50
fi

fetch() {
  local url=$1 destination=$2 expected=$3 actual
  if [[ ! -f $destination ]]; then
    curl -fL --retry 3 --connect-timeout 20 -o "$destination.part" "$url"
    mv "$destination.part" "$destination"
  fi
  actual=$(shasum -a 256 "$destination" | awk '{print $1}')
  [[ $actual == "$expected" ]] || { echo "checksum ไม่ตรง: $destination" >&2; exit 1; }
}

lima_archive="$cache_dir/lima-$LIMA_VERSION-Darwin-$lima_host_arch.tar.gz"
ubuntu_image="$cache_dir/ubuntu-24.04-$UBUNTU_RELEASE-server-cloudimg-$ubuntu_arch.img"
docker_archive="$cache_dir/docker-$DOCKER_VERSION-$docker_arch.tgz"
compose_binary="$cache_dir/docker-compose-linux-$compose_arch"
age_archive="$cache_dir/age-v$AGE_VERSION-linux-$age_arch.tar.gz"
fetch "https://github.com/lima-vm/lima/releases/download/v$LIMA_VERSION/lima-$LIMA_VERSION-Darwin-$lima_host_arch.tar.gz" "$lima_archive" "$LIMA_SHA"
fetch "https://cloud-images.ubuntu.com/releases/noble/$UBUNTU_RELEASE/ubuntu-24.04-server-cloudimg-$ubuntu_arch.img" "$ubuntu_image" "$UBUNTU_SHA"
fetch "https://download.docker.com/linux/static/stable/$docker_arch/docker-$DOCKER_VERSION.tgz" "$docker_archive" "$DOCKER_SHA"
fetch "https://github.com/docker/compose/releases/download/v$COMPOSE_VERSION/docker-compose-linux-$compose_arch" "$compose_binary" "$COMPOSE_SHA"
fetch "https://github.com/FiloSottile/age/releases/download/v$AGE_VERSION/age-v$AGE_VERSION-linux-$age_arch.tar.gz" "$age_archive" "$AGE_SHA"

web_ref="bms/retail-local-web:$version-$architecture"
ws_ref="bms/retail-local-ws:$version-$architecture"
postgres_ref="bms/retail-local-postgres:16-alpine-$version-$architecture"
redis_ref="bms/retail-local-redis:7-alpine-$version-$architecture"
if [[ $reuse_images == true ]]; then
  for image_ref in "$web_ref" "$ws_ref" "$postgres_ref" "$redis_ref"; do
    docker image inspect "$image_ref" >/dev/null 2>&1 || { echo "ไม่พบ image: $image_ref" >&2; exit 1; }
  done
else
  docker buildx build --platform "$linux_platform" --provenance=false --load \
    --build-arg BMS_SOURCE_COMMIT="$commit" \
    --build-arg NEXT_BUILD_CPUS="${NEXT_BUILD_CPUS:-2}" \
    --build-arg NODE_BUILD_MAX_OLD_SPACE_SIZE="${NODE_BUILD_MAX_OLD_SPACE_SIZE:-4096}" \
    --build-arg NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3100 \
    --build-arg NEXT_PUBLIC_GRAPHQL_HTTP=http://127.0.0.1:3100/api/graphql \
    --build-arg NEXT_PUBLIC_GRAPHQL_WS=ws://127.0.0.1:3101/graphql \
    --build-arg COOKIE_SECURE=0 --build-arg 'WEB_NAME=BMS Retail Local' \
    -f "$repo_root/apps/web/Dockerfile" -t "$web_ref" "$repo_root"
  docker buildx build --platform "$linux_platform" --provenance=false --load \
    --build-arg BMS_SOURCE_COMMIT="$commit" \
    -f "$repo_root/apps/ws/Dockerfile" -t "$ws_ref" "$repo_root"
  printf 'FROM postgres:16-alpine\n' | docker buildx build --platform "$linux_platform" \
    --provenance=false --load -f - -t "$postgres_ref" .
  printf 'FROM redis:7-alpine\n' | docker buildx build --platform "$linux_platform" \
    --provenance=false --load -f - -t "$redis_ref" .
fi

for image_ref in "$web_ref" "$ws_ref"; do
  image_commit=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_ref")
  [[ $image_commit == "$commit" ]] || {
    echo "ปฏิเสธ image ที่ไม่ตรง source commit: $image_ref (image=$image_commit source=$commit)" >&2
    echo "build release ใหม่โดยไม่ใช้ --reuse-images" >&2
    exit 1
  }
done
# The sample-data runner executes TypeScript directly rather than through the Next server bundle.
# Verify its runtime-only import before signing gigabytes of otherwise unusable release bytes.
docker run --rm --platform "$linux_platform" --entrypoint sh "$web_ref" -lc '
  set -eu
  test -f scripts/retail-local-sample-data.mts
  test -f lib/bms/onboardingSampleData.ts
  test -f lib/bms/restaurantSampleData.ts
  node --conditions=react-server --input-type=module -e "await import(\"server-only\")"
' >/dev/null

docker image save "$web_ref" | gzip -6 >"$output_dir/web.artifact"
docker image save "$ws_ref" | gzip -6 >"$output_dir/ws.artifact"
docker image save "$postgres_ref" | gzip -6 >"$output_dir/postgres.artifact"
docker image save "$redis_ref" | gzip -6 >"$output_dir/redis.artifact"
cp "$managed_root/compose.managed.yml" "$output_dir/compose.artifact"
cp "$repo_root/packages/retail-local-contract/shop-archetypes.json" "$output_dir/shop-archetypes.artifact"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$desktop_app" "$output_dir/desktop.artifact"

runtime_root="$work/runtime-root"
mkdir -p "$runtime_root/runtime/lima" "$runtime_root/payload/runtime"
tar -xzf "$lima_archive" -C "$runtime_root/runtime/lima"
cp "$ubuntu_image" "$runtime_root/payload/ubuntu-24.04-server-cloudimg.img"
cp "$docker_archive" "$runtime_root/payload/runtime/docker.tgz"
cp "$compose_binary" "$runtime_root/payload/runtime/docker-compose"
cp "$age_archive" "$runtime_root/payload/runtime/age.tar.gz"
cp "$managed_root/runtime-rootfs/bms-localctl" "$runtime_root/payload/bms-localctl"
printf '%s\n' "macos-15-$architecture" >"$runtime_root/payload/PLATFORM_TARGET"
chmod 0755 "$runtime_root/payload/runtime/docker-compose" "$runtime_root/payload/bms-localctl"
xattr -cr "$runtime_root"
(cd "$runtime_root" && tar -czf "$output_dir/runtime.artifact" runtime payload)

web_digest=$(docker image inspect --format '{{.Id}}' "$web_ref")
ws_digest=$(docker image inspect --format '{{.Id}}' "$ws_ref")
postgres_digest=$(docker image inspect --format '{{.Id}}' "$postgres_ref")
redis_digest=$(docker image inspect --format '{{.Id}}' "$redis_ref")
created_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
node --input-type=module - "$output_dir" "$base_url" "$version" "$key_id" "$commit" "$created_at" \
  "$architecture" "$web_ref" "$web_digest" "$ws_ref" "$ws_digest" \
  "$postgres_ref" "$postgres_digest" "$redis_ref" "$redis_digest" <<'EOF'
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const [output, baseUrl, version, keyId, sourceCommit, createdAt, architecture,
  webRef, webDigest, wsRef, wsDigest, postgresRef, postgresDigest, redisRef, redisDigest] = process.argv.slice(2);
const component = (name, kind, extra = {}) => ({
  name, kind, path: join(output, `${name}.artifact`), url: `${baseUrl}/${name}.artifact`, ...extra,
});
const descriptor = {
  releaseVersion: version, channel: "pilot", platformTarget: `macos-15-${architecture}`,
  minimumAgentVersion: "0.5.6", schemaVersion: "10.36", rollbackSafe: false,
  createdAt, sourceCommit, keyId,
  components: [
    component("web", "oci-image", { imageRef: webRef, ociDigest: webDigest }),
    component("ws", "oci-image", { imageRef: wsRef, ociDigest: wsDigest }),
    component("postgres", "oci-image", { imageRef: postgresRef, ociDigest: postgresDigest }),
    component("redis", "oci-image", { imageRef: redisRef, ociDigest: redisDigest }),
    component("runtime", "runtime"), component("compose", "support-file"),
    component("desktop", "desktop"), component("shop-archetypes", "support-file"),
  ],
};
writeFileSync(join(output, "release-descriptor.json"), JSON.stringify(descriptor, null, 2) + "\n", { mode: 0o600, flag: "wx" });
EOF

BMS_ALLOW_LOCAL_RELEASE_SIGNING=1 node "$managed_root/sign-release.mjs" \
  "$output_dir/release-descriptor.json" "$private_key" "$output_dir/release.jws.json"
shasum -a 256 "$output_dir"/*.artifact "$output_dir/release.jws.json" >"$output_dir/SHA256SUMS"
release_complete=true
printf 'macOS signed release พร้อม: %s\n' "$output_dir"
