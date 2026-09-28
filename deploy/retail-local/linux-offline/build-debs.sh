#!/usr/bin/env bash

set -euo pipefail

[[ $# -eq 4 ]] || {
  echo "usage: build-debs.sh VERSION BUNDLE_ROOT POS_DEB OUTPUT_DIR" >&2
  exit 2
}

version=$1
bundle_root=$2
pos_deb=$3
output_dir=$4
source_root=$(cd "$(dirname "$0")" && pwd)

[[ $version =~ ^[A-Za-z0-9.+~-]{1,64}$ ]] || { echo "invalid version" >&2; exit 2; }
[[ -f $bundle_root/compose.yml && -f $bundle_root/release.json ]] || { echo "invalid server bundle" >&2; exit 2; }
[[ -f $pos_deb ]] || { echo "missing POS deb" >&2; exit 2; }
image_archive=$(find "$bundle_root/images" -maxdepth 1 -type f -name '*.tar' -print -quit)
[[ -n $image_archive ]] || { echo "missing image archive" >&2; exit 2; }

mkdir -p "$output_dir"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

pos_dependencies=$(dpkg-deb -f "$pos_deb" Depends | tr '\n' ' ')

write_control_scripts() {
  local stage=$1
  cat >"$stage/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi
echo "ติดตั้งไฟล์สำเร็จ: รัน sudo bms-retail-local-setup เพื่อตั้งค่าร้าน"
EOF
  cat >"$stage/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now bms-retail-local.service >/dev/null 2>&1 || true
fi
EOF
  cat >"$stage/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi
echo "ข้อมูลร้านใน /var/lib/bms-retail-local ถูกเก็บไว้และไม่ได้ถูกลบ"
EOF
  chmod 0755 "$stage/DEBIAN/postinst" "$stage/DEBIAN/prerm" "$stage/DEBIAN/postrm"
}

stage_payload() {
  local stage=$1
  install -d -m 0755 \
    "$stage/DEBIAN" \
    "$stage/opt/bms-retail-local/images" \
    "$stage/usr/lib/bms-retail-local" \
    "$stage/usr/bin" \
    "$stage/lib/systemd/system"
  install -m 0644 "$bundle_root/compose.yml" "$stage/opt/bms-retail-local/compose.yml"
  install -m 0644 "$bundle_root/release.json" "$stage/opt/bms-retail-local/release.json"
  install -m 0644 "$image_archive" "$stage/opt/bms-retail-local/images/$(basename "$image_archive")"
  (
    cd "$stage/opt/bms-retail-local"
    sha256sum "images/$(basename "$image_archive")" >image.sha256
  )
  install -m 0644 "$source_root/common.sh" "$stage/usr/lib/bms-retail-local/common.sh"
  for command in setup start stop status doctor backup; do
    install -m 0755 "$source_root/bms-retail-local-$command" "$stage/usr/bin/bms-retail-local-$command"
  done
  install -m 0644 "$source_root/bms-retail-local.service" "$stage/lib/systemd/system/bms-retail-local.service"
  write_control_scripts "$stage"
}

build_package() {
  local kind=$1
  local stage="$work/$kind"
  local package_name output_name description dependencies
  stage_payload "$stage"

  dependencies='bash, ca-certificates, curl, jq, openssl, tar'
  if [[ $kind == server-pos ]]; then
    package_name=bms-retail-local-server-pos
    output_name="BMS-Retail-Local-Server-POS-$version-linux-x64.deb"
    description='BMS Retail Local offline server with BMS POS installer'
    install -m 0644 "$pos_deb" "$stage/opt/bms-retail-local/BMS-POS.deb"
    dependencies="$dependencies, $pos_dependencies"
    conflicts='bms-retail-local-server'
  else
    package_name=bms-retail-local-server
    output_name="BMS-Retail-Local-Server-$version-linux-x64.deb"
    description='BMS Retail Local offline server'
    conflicts='bms-retail-local-server-pos'
  fi

  cat >"$stage/DEBIAN/control" <<EOF
Package: $package_name
Version: $version
Section: utils
Priority: optional
Architecture: amd64
Maintainer: BMS
Depends: $dependencies
Recommends: docker.io, docker-compose-v2
Conflicts: $conflicts
Provides: bms-retail-local
Description: $description
 Includes pinned Web, WebSocket, PostgreSQL and Redis images for an offline
 single-shop Retail Local deployment. Application services bind to loopback.
EOF

  chmod -R go-w "$stage"
  dpkg-deb --root-owner-group -Znone --build "$stage" "$output_dir/$output_name"
  sha256sum "$output_dir/$output_name" >"$output_dir/$output_name.sha256"
}

build_package server
build_package server-pos
