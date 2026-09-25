#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
usage: prepare-release.sh --version VERSION --base-url HTTPS_URL --desktop-deb FILE \
  --private-key FILE --key-id ID [--output-dir DIR]

Builds Linux/amd64 Web, WS, PostgreSQL and Redis OCI archives, prepares the managed Compose and
runtime contract, writes release-descriptor.json, and signs release.jws.json.
EOF
  exit 2
}

version=
base_url=
desktop_deb=
private_key=
key_id=
output_dir=
while (($#)); do
  case "$1" in
    --version) version=${2:-}; shift 2 ;;
    --base-url) base_url=${2:-}; shift 2 ;;
    --desktop-deb) desktop_deb=${2:-}; shift 2 ;;
    --private-key) private_key=${2:-}; shift 2 ;;
    --key-id) key_id=${2:-}; shift 2 ;;
    --output-dir) output_dir=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

[[ $version =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || usage
[[ $key_id =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || usage
[[ -f $desktop_deb && -f $private_key ]] || usage
[[ $base_url =~ ^https://[^/@:]+([/:?#]|$) && $base_url != *'@'* ]] || {
  echo "base URL ต้องเป็น HTTPS และไม่มี credential" >&2; exit 2;
}
base_url=${base_url%/}

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)
managed_root="$repo_root/deploy/retail-local/managed-runtime"
output_dir=${output_dir:-"$repo_root/artifacts/retail-local/managed-runtime/releases/$version/ubuntu-24.04-lts-x64"}
mkdir -p "$output_dir"
output_dir=$(cd "$output_dir" && pwd)

command -v docker >/dev/null || { echo "ไม่พบ Docker build engine" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker build engine ไม่พร้อม" >&2; exit 1; }
for name in web ws postgres redis runtime compose desktop; do
  [[ ! -e $output_dir/$name.artifact ]] || { echo "artifact มีอยู่แล้ว: $output_dir/$name.artifact" >&2; exit 1; }
done
[[ ! -e $output_dir/release-descriptor.json && ! -e $output_dir/release.jws.json ]] || {
  echo "release metadata มีอยู่แล้วใน $output_dir" >&2; exit 1
}

web_ref="bms/retail-local-web:$version"
ws_ref="bms/retail-local-ws:$version"
postgres_ref="bms/retail-local-postgres:16-alpine-$version"
redis_ref="bms/retail-local-redis:7-alpine-$version"

docker buildx build --platform linux/amd64 --provenance=false --load \
  --build-arg NEXT_BUILD_CPUS="${NEXT_BUILD_CPUS:-2}" \
  --build-arg NODE_BUILD_MAX_OLD_SPACE_SIZE="${NODE_BUILD_MAX_OLD_SPACE_SIZE:-4096}" \
  --build-arg NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3100 \
  --build-arg NEXT_PUBLIC_GRAPHQL_HTTP=http://127.0.0.1:3100/api/graphql \
  --build-arg NEXT_PUBLIC_GRAPHQL_WS=ws://127.0.0.1:3101/graphql \
  --build-arg COOKIE_SECURE=0 --build-arg 'WEB_NAME=BMS Retail Local' \
  -f "$repo_root/apps/web/Dockerfile" -t "$web_ref" "$repo_root"
docker buildx build --platform linux/amd64 --provenance=false --load \
  -f "$repo_root/apps/ws/Dockerfile" -t "$ws_ref" "$repo_root"
printf 'FROM postgres:16-alpine\n' | docker buildx build --platform linux/amd64 \
  --provenance=false --load -f - -t "$postgres_ref" .
printf 'FROM redis:7-alpine\n' | docker buildx build --platform linux/amd64 \
  --provenance=false --load -f - -t "$redis_ref" .

docker image save --output "$output_dir/web.artifact" "$web_ref"
docker image save --output "$output_dir/ws.artifact" "$ws_ref"
docker image save --output "$output_dir/postgres.artifact" "$postgres_ref"
docker image save --output "$output_dir/redis.artifact" "$redis_ref"
cp "$managed_root/compose.managed.yml" "$output_dir/compose.artifact"
cp "$desktop_deb" "$output_dir/desktop.artifact"

commit=$(git -C "$repo_root" rev-parse HEAD)
created_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
cat >"$output_dir/runtime.artifact" <<EOF
{"formatVersion":1,"platformTarget":"ubuntu-24.04-lts-x64","engine":"ubuntu-docker.io","sourceCommit":"$commit","createdAt":"$created_at"}
EOF

web_digest=$(docker image inspect --format '{{.Id}}' "$web_ref")
ws_digest=$(docker image inspect --format '{{.Id}}' "$ws_ref")
postgres_digest=$(docker image inspect --format '{{.Id}}' "$postgres_ref")
redis_digest=$(docker image inspect --format '{{.Id}}' "$redis_ref")

node --input-type=module - "$output_dir" "$base_url" "$version" "$key_id" "$commit" "$created_at" \
  "$web_ref" "$web_digest" "$ws_ref" "$ws_digest" "$postgres_ref" "$postgres_digest" \
  "$redis_ref" "$redis_digest" <<'EOF'
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const [output, baseUrl, version, keyId, sourceCommit, createdAt,
  webRef, webDigest, wsRef, wsDigest, postgresRef, postgresDigest, redisRef, redisDigest] = process.argv.slice(2);
const component = (name, kind, extra = {}) => ({
  name, kind, path: join(output, `${name}.artifact`), url: `${baseUrl}/${name}.artifact`, ...extra,
});
const descriptor = {
  releaseVersion: version,
  channel: "pilot",
  platformTarget: "ubuntu-24.04-lts-x64",
  minimumAgentVersion: "0.2.0",
  schemaVersion: "10.15",
  rollbackSafe: false,
  createdAt,
  sourceCommit,
  keyId,
  components: [
    component("web", "oci-image", { imageRef: webRef, ociDigest: webDigest }),
    component("ws", "oci-image", { imageRef: wsRef, ociDigest: wsDigest }),
    component("postgres", "oci-image", { imageRef: postgresRef, ociDigest: postgresDigest }),
    component("redis", "oci-image", { imageRef: redisRef, ociDigest: redisDigest }),
    component("runtime", "runtime"),
    component("compose", "support-file"),
    component("desktop", "desktop"),
  ],
};
writeFileSync(join(output, "release-descriptor.json"), JSON.stringify(descriptor, null, 2) + "\n", { mode: 0o600, flag: "wx" });
EOF

BMS_ALLOW_LOCAL_RELEASE_SIGNING=1 node "$managed_root/sign-release.mjs" \
  "$output_dir/release-descriptor.json" "$private_key" "$output_dir/release.jws.json"
shasum -a 256 "$output_dir"/*.artifact "$output_dir/release.jws.json" >"$output_dir/SHA256SUMS"
printf 'Release พร้อม: %s\n' "$output_dir"
