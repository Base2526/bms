#!/usr/bin/env bash
set -Eeuo pipefail

base_image=${1:-}
output=${2:-}
[[ $base_image =~ ^ubuntu@sha256:[a-f0-9]{64}$ ]] || {
  echo "usage: build-rootfs.sh ubuntu@sha256:<digest> OUTPUT.tar" >&2
  exit 2
}
[[ -n $output && ! -e $output ]] || { echo "OUTPUT ต้องเป็นไฟล์ใหม่" >&2; exit 2; }
context=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
tag="bms-retail-local-rootfs-build:$$"
container=
cleanup() {
  [[ -z $container ]] || docker rm -f "$container" >/dev/null 2>&1 || true
  docker image rm "$tag" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker build --pull --build-arg "UBUNTU_IMAGE=$base_image" -t "$tag" "$context"
container=$(docker create "$tag" /bin/true)
docker export --output "$output" "$container"
sha256sum "$output"
