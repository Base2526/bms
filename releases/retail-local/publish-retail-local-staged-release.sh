#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: sudo bash releases/retail-local/publish-retail-local-staged-release.sh VERSION [--dry-run]

Publishes a Windows/Linux Retail Local release uploaded by FTP to:
  <repository>/releases/retail-local/VERSION

The public destination is:
  /mnt/volume_sgp1_01/releases/retail-local/VERSION

The script preserves existing macOS folders, refuses to overwrite existing runtime target folders,
publishes only public runtime files, and deletes the uploaded staging folder only after every
validation and publish step succeeds. Installer files are uploaded separately through BMS.
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

version=${1:-}
mode=${2:-}
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
  usage >&2
  die "VERSION is required and must be a semantic version"
}
[[ -z $mode || $mode == --dry-run ]] || {
  usage >&2
  die "Unknown option: $mode"
}
dry_run=false
[[ $mode == --dry-run ]] && dry_run=true

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd -- "$script_dir/../.." && pwd -P)
staging_root=${BMS_RELEASE_STAGING_ROOT:-$repo_root/releases/retail-local}
release_root=${BMS_RELEASE_TARGET_ROOT:-/mnt/volume_sgp1_01/releases/retail-local}
stage=$staging_root/$version
final=$release_root/$version
keyring=$stage/trusted-release-keys.json

[[ -d $stage ]] || die "Staging folder not found: $stage"
[[ -f $keyring ]] || die "Public release keyring not found: $keyring"
[[ $stage == "$staging_root/"* && $stage != / && $stage != "$repo_root" ]] || {
  die "Unsafe staging path: $stage"
}
if ! $dry_run && (( EUID != 0 )); then
  die "Run with sudo so the script can publish to $release_root"
fi

command -v python3 >/dev/null || die "python3 is required"
command -v openssl >/dev/null || die "openssl is required"
command -v sha256sum >/dev/null || die "sha256sum is required"
command -v flock >/dev/null || die "flock is required"

declare -A expected_targets=(
  [ubuntu-24.04-lts-x64]=ubuntu-24.04-lts-x64
  [windows-11-x64]=windows-11-x64
  [windows-10-x86]=windows-10-x86-pos
)
required_components=(web ws postgres redis runtime compose desktop shop-archetypes)

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/bms-retail-local-publish.XXXXXX")
cleanup_paths=()
cleanup() {
  local path
  for path in "${cleanup_paths[@]:-}"; do
    [[ -n $path && -e $path ]] && rm -rf -- "$path"
  done
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

verify_manifest() {
  local manifest=$1
  local expected_target=$2
  local prefix=$work_dir/$(basename -- "$(dirname -- "$manifest")")
  python3 - "$keyring" "$manifest" "$version" "$expected_target" "$prefix" <<'PY'
import base64
import json
import pathlib
import sys

keyring_path, manifest_path, expected_version, expected_target, prefix = sys.argv[1:]
keyring = json.loads(pathlib.Path(keyring_path).read_text(encoding="utf-8"))
envelope = json.loads(pathlib.Path(manifest_path).read_text(encoding="utf-8"))
if envelope.get("formatVersion") != 1:
    raise SystemExit("unsupported release envelope version")

def decode(value):
    if not isinstance(value, str) or not value:
        raise SystemExit("invalid base64url field")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

header = json.loads(decode(envelope.get("protected")).decode("utf-8"))
payload = json.loads(decode(envelope.get("payload")).decode("utf-8"))
if header.get("alg") != "EdDSA" or header.get("typ") != "application/vnd.bms.retail-local.release+json":
    raise SystemExit("invalid release signature header")
if payload.get("product") != "BMS Retail Local":
    raise SystemExit("unexpected release product")
if payload.get("releaseVersion") != expected_version:
    raise SystemExit("release version mismatch")
if payload.get("platformTarget") != expected_target:
    raise SystemExit("release target mismatch")
public_key = keyring.get("keys", {}).get(header.get("kid"))
if not isinstance(public_key, str) or "BEGIN PUBLIC KEY" not in public_key:
    raise SystemExit("manifest signing key is not in the uploaded keyring")

pathlib.Path(prefix + ".pem").write_text(public_key, encoding="utf-8")
pathlib.Path(prefix + ".input").write_bytes(
    (envelope["protected"] + "." + envelope["payload"]).encode("ascii")
)
pathlib.Path(prefix + ".sig").write_bytes(decode(envelope.get("signature")))
PY
  openssl pkeyutl -verify -pubin -inkey "$prefix.pem" -rawin \
    -in "$prefix.input" -sigfile "$prefix.sig" >/dev/null
}

printf 'Validating staged release %s\n' "$version"
for folder in "${!expected_targets[@]}"; do
  source_dir=$stage/$folder
  [[ -d $source_dir ]] || die "Missing target folder: $source_dir"
  [[ -f $source_dir/release.jws.json ]] || die "Missing release.jws.json in $folder"
  [[ -f $source_dir/SHA256SUMS ]] || die "Missing SHA256SUMS in $folder"
  for component in "${required_components[@]}"; do
    [[ -f $source_dir/$component.artifact ]] || die "Missing $folder/$component.artifact"
  done
  if find "$source_dir" -maxdepth 1 -type f \( -iname '*.pem' -o -iname '*private*' \) -print -quit | grep -q .; then
    die "Private key material is present in $source_dir"
  fi

  verify_manifest "$source_dir/release.jws.json" "${expected_targets[$folder]}" || {
    die "Signature validation failed for $folder"
  }
  (
    cd -- "$source_dir"
    sha256sum --strict --ignore-missing -c SHA256SUMS >/dev/null
  ) || die "Checksum validation failed for $folder"
  printf '  OK  %s (%s)\n' "$folder" "${expected_targets[$folder]}"
done

if $dry_run; then
  printf 'Dry run completed. No files were moved or deleted.\n'
  exit 0
fi

mkdir -p -- "$release_root"
exec 9>"$release_root/.publish.lock"
flock -n 9 || die "Another Retail Local publish is running"
mkdir -p -- "$final"

# Check every collision before the first public write so an operator error cannot publish a
# half-merged Windows/Linux runtime release alongside the existing macOS folders.
for folder in ubuntu-24.04-lts-x64 windows-11-x64 windows-10-x86; do
  [[ ! -e $final/$folder ]] || die "Destination already exists; refusing to overwrite: $final/$folder"
done
if [[ -e $final/trusted-release-keys.json ]]; then
  cmp -s -- "$keyring" "$final/trusted-release-keys.json" || {
    die "The existing public keyring differs from the uploaded keyring"
  }
fi

for folder in ubuntu-24.04-lts-x64 windows-11-x64 windows-10-x86; do
  source_dir=$stage/$folder
  destination=$final/$folder
  [[ ! -e $destination ]] || die "Destination already exists; refusing to overwrite: $destination"

  publishing_dir=$release_root/.${version}-${folder}.publishing.$$
  [[ ! -e $publishing_dir ]] || die "Temporary publish path already exists: $publishing_dir"
  mkdir -- "$publishing_dir"
  cleanup_paths+=("$publishing_dir")
  for component in "${required_components[@]}"; do
    install -m 0644 -- "$source_dir/$component.artifact" "$publishing_dir/$component.artifact"
  done
  install -m 0644 -- "$source_dir/release.jws.json" "$publishing_dir/release.jws.json"
  (
    cd -- "$publishing_dir"
    sha256sum ./*.artifact ./release.jws.json >SHA256SUMS
  )
  chmod 0755 "$publishing_dir"
  mv -- "$publishing_dir" "$destination"
  cleanup_paths=("${cleanup_paths[@]/$publishing_dir}")
  printf 'Published %s\n' "$destination"
done

if [[ -e $final/trusted-release-keys.json ]]; then
  : # Equality was checked before publishing any files.
else
  install -m 0644 -- "$keyring" "$final/trusted-release-keys.json"
fi

if [[ -d $release_root/0.2.14-pilot.2 ]]; then
  chown -R --reference="$release_root/0.2.14-pilot.2" "$final"
fi
chmod -R u=rwX,go=rX "$final"

rm -rf -- "$stage"
printf '\nPublished %s successfully.\n' "$version"
printf 'Removed staging folder: %s\n' "$stage"
