#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
usage: build-deb.sh --keyring FILE [--manifest-url HTTPS_URL] [--version VERSION] [--output-dir DIR]

Builds the small Ubuntu x64 bootstrap package. The keyring must contain only trusted Ed25519 public
keys. Private keys and application images are never copied into this package.
EOF
  exit 2
}

keyring=
manifest_url=
version=0.2.0-internal.1
output_dir=artifacts/retail-local/managed-runtime
while (($#)); do
  case "$1" in
    --keyring) keyring=${2:-}; shift 2 ;;
    --manifest-url) manifest_url=${2:-}; shift 2 ;;
    --version) version=${2:-}; shift 2 ;;
    --output-dir) output_dir=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

[[ -f $keyring ]] || usage
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+([.+~-][A-Za-z0-9.+~-]+)*$ ]] || {
  echo "version ไม่ใช่ Debian-compatible version" >&2; exit 2;
}
if [[ -n $manifest_url && ! $manifest_url =~ ^https://[^/@:]+([/:?#]|$) ]]; then
  echo "manifest URL ต้องเป็น HTTPS และไม่มี credential" >&2; exit 2
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../.." && pwd)
linux_root="$repo_root/deploy/retail-local/managed-runtime/linux"
runtime_root="$repo_root/deploy/retail-local/managed-runtime/runtime-rootfs"
agent_root="$repo_root/apps/retail-local-agent"
output_dir=$(mkdir -p "$output_dir" && cd "$output_dir" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/bms-linux-deb.XXXXXX")
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT HUP INT TERM

package_root="$work/package"
mkdir -p "$package_root/DEBIAN" \
  "$package_root/usr/bin" \
  "$package_root/usr/lib/bms-retail-local/bootstrap" \
  "$package_root/usr/share/doc/bms-retail-local-bootstrap" \
  "$package_root/etc/bms-retail-local"

(cd "$agent_root" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
  -trimpath -ldflags='-s -w' -o "$package_root/usr/lib/bms-retail-local/bootstrap/bms-runtime-agent" .)
install -m 0755 "$linux_root/install-managed-runtime.sh" \
  "$package_root/usr/lib/bms-retail-local/bootstrap/install-managed-runtime.sh"
install -m 0755 "$linux_root/uninstall-managed-runtime.sh" \
  "$package_root/usr/lib/bms-retail-local/bootstrap/uninstall-managed-runtime.sh"
install -m 0755 "$runtime_root/bms-localctl" \
  "$package_root/usr/lib/bms-retail-local/bootstrap/bms-localctl"
install -m 0644 "$linux_root/bms-retail-local.service" \
  "$package_root/usr/lib/bms-retail-local/bootstrap/bms-retail-local.service"
install -m 0644 "$keyring" \
  "$package_root/usr/lib/bms-retail-local/bootstrap/trusted-release-keys.json"
install -m 0755 "$linux_root/bms-retail-local-setup" \
  "$package_root/usr/bin/bms-retail-local-setup"

if [[ -n $manifest_url ]]; then
  printf '%s\n' "$manifest_url" >"$package_root/etc/bms-retail-local/release-manifest-url"
else
  : >"$package_root/etc/bms-retail-local/release-manifest-url"
fi
chmod 0644 "$package_root/etc/bms-retail-local/release-manifest-url"

cat >"$package_root/usr/share/doc/bms-retail-local-bootstrap/README" <<'EOF'
BMS Retail Local Managed Runtime bootstrap

Run: sudo bms-retail-local-setup [SIGNED_RELEASE_MANIFEST_HTTPS_URL]
The package contains no private signing key, database, shop credential, or application image.
EOF

installed_size=$(du -sk "$package_root" | awk '{print $1}')
cat >"$package_root/DEBIAN/control" <<EOF
Package: bms-retail-local-bootstrap
Version: $version
Section: admin
Priority: optional
Architecture: amd64
Installed-Size: $installed_size
Maintainer: BMS <release@bms.local>
Depends: bash, ca-certificates, curl, jq, systemd
Description: BMS Retail Local Managed Runtime bootstrap
 Small signed-release bootstrap for supported Ubuntu x64 shop computers.
EOF

cat >"$package_root/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
chmod 0755 /usr/bin/bms-retail-local-setup
echo "BMS Retail Local bootstrap installed. Run: sudo bms-retail-local-setup"
EOF
chmod 0755 "$package_root/DEBIAN/postinst"

cat >"$package_root/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = remove ] || [ "$1" = deconfigure ]; then
  systemctl disable --now bms-retail-local.service >/dev/null 2>&1 || true
fi
exit 0
EOF
chmod 0755 "$package_root/DEBIAN/prerm"

package_name="bms-retail-local-bootstrap_${version}_amd64.deb"
package_path="$output_dir/$package_name"
rm -f -- "$package_path"

if command -v dpkg-deb >/dev/null 2>&1; then
  dpkg-deb --root-owner-group --build "$package_root" "$package_path" >/dev/null
else
  tar_flags=(--format=ustar --uid=0 --gid=0 --uname=root --gname=root)
  printf '2.0\n' >"$work/debian-binary"
  (cd "$package_root/DEBIAN" && COPYFILE_DISABLE=1 tar "${tar_flags[@]}" -czf "$work/control.tar.gz" .)
  rm -rf -- "$package_root/DEBIAN"
  (cd "$package_root" && COPYFILE_DISABLE=1 tar "${tar_flags[@]}" -czf "$work/data.tar.gz" .)
  (cd "$work" && ZERO_AR_DATE=1 ar -rc "$package_path" debian-binary control.tar.gz data.tar.gz)
fi

sha256=$(shasum -a 256 "$package_path" | awk '{print $1}')
size=$(wc -c <"$package_path" | tr -d ' ')
printf '{"artifact":"%s","sha256":"%s","sizeBytes":%s,"version":"%s","architecture":"amd64"}\n' \
  "$package_path" "$sha256" "$size" "$version"
