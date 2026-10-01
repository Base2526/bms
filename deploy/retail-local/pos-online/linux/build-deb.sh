#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "usage: build-deb.sh VERSION AGENT KEYRING MANIFEST_URL PLATFORM_TARGET OUTPUT_DIR" >&2
  exit 2
}
[[ $# -eq 6 ]] || usage
version=$1
agent=$2
keyring=$3
manifest_url=$4
platform_target=$5
output_dir=$6
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

[[ $version =~ ^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$ ]] || usage
[[ -f $agent && -f $keyring ]] || usage
[[ $manifest_url =~ ^https://[^/@:]+([/:?#]|$) && $manifest_url != *'@'* ]] || usage
[[ $platform_target =~ ^[a-z0-9._-]{1,80}$ ]] || usage

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
stage="$work/package"
install -d -m 0755 "$stage/DEBIAN" "$stage/usr/bin" "$stage/usr/lib/bms-pos-bootstrap"
install -m 0755 "$agent" "$stage/usr/lib/bms-pos-bootstrap/bms-runtime-agent"
install -m 0644 "$keyring" "$stage/usr/lib/bms-pos-bootstrap/trusted-release-keys.json"
install -m 0755 "$source_root/bms-pos-online-setup" "$stage/usr/bin/bms-pos-online-setup"
diagnostics_helper="$source_root/setup-diagnostics.sh"
[[ -f $diagnostics_helper ]] || diagnostics_helper="$source_root/../../managed-runtime/setup-diagnostics.sh"
install -m 0644 "$diagnostics_helper" "$stage/usr/lib/bms-pos-bootstrap/setup-diagnostics.sh"
printf '%s\n' "$version" >"$stage/usr/lib/bms-pos-bootstrap/BOOTSTRAP_VERSION"
printf '%s\n' "$manifest_url" >"$stage/usr/lib/bms-pos-bootstrap/manifest-url"
printf '%s\n' "$platform_target" >"$stage/usr/lib/bms-pos-bootstrap/platform-target"
cat >"$stage/DEBIAN/control" <<EOF
Package: bms-pos-online-bootstrap
Version: $version
Section: utils
Priority: optional
Architecture: amd64
Maintainer: BMS
Depends: bash, ca-certificates, curl, python3
Description: BMS POS signed online bootstrap
 Downloads and verifies BMS POS during first installation.
EOF
cat >"$stage/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
echo "Run: sudo bms-pos-online-setup"
EOF
chmod 0755 "$stage/DEBIAN/postinst"
mkdir -p "$output_dir"
package_path="$output_dir/bms-pos-online-bootstrap_${version}_amd64.deb"
if command -v dpkg-deb >/dev/null 2>&1; then
  dpkg-deb --root-owner-group -Zxz --build "$stage" "$package_path"
else
  tar_flags=(--format=ustar --uid=0 --gid=0 --uname=root --gname=root)
  printf '2.0\n' >"$work/debian-binary"
  (cd "$stage/DEBIAN" && COPYFILE_DISABLE=1 tar "${tar_flags[@]}" -czf "$work/control.tar.gz" .)
  rm -rf -- "$stage/DEBIAN"
  (cd "$stage" && COPYFILE_DISABLE=1 tar "${tar_flags[@]}" -czf "$work/data.tar.gz" .)
  (cd "$work" && ZERO_AR_DATE=1 ar -rc "$package_path" debian-binary control.tar.gz data.tar.gz)
fi
