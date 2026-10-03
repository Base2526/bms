#!/usr/bin/env bash
set -euo pipefail

# Read-only candidate check for the first Managed Runtime Linux target. Package
# installation and system mutation belong to the future signed .deb installer.

failures=()
warnings=()

fail() { failures+=("$1"); }
warn() { warnings+=("$1"); }

architecture="$(uname -m)"
if [[ "$architecture" != "x86_64" ]]; then
  fail "Only Linux x86_64 is supported in this milestone (detected $architecture)"
fi

if [[ ! -r /etc/os-release ]]; then
  fail "Could not read /etc/os-release"
  distribution="unknown"
  version="unknown"
else
  # Read the operating system's standard metadata file.
  # shellcheck disable=SC1091
  source /etc/os-release
  distribution="${ID:-unknown}"
  version="${VERSION_ID:-unknown}"
  if [[ "$distribution" != "ubuntu" ]]; then
    fail "Only Ubuntu is supported in this milestone (detected $distribution)"
  elif [[ "$version" != "24.04" && "$version" != "22.04" ]]; then
    fail "Only Ubuntu 24.04 LTS or 22.04 LTS is supported (detected $version)"
  elif [[ "$version" == "22.04" ]]; then
    warn "Ubuntu 22.04 is a transition target; Ubuntu 24.04 is the primary target"
  fi
fi

if ! command -v systemctl >/dev/null 2>&1; then
  fail "systemd/systemctl was not found"
elif [[ "$(ps -p 1 -o comm= 2>/dev/null | tr -d ' ')" != "systemd" ]]; then
  fail "PID 1 is not systemd"
fi

if [[ ! -r /proc/meminfo ]]; then
  fail "Could not read memory size"
else
  memory_kib="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
  if [[ -z "$memory_kib" || "$memory_kib" -lt 8388608 ]]; then
    fail "At least 8 GiB of RAM is required"
  fi
fi

free_kib="$(df -Pk /var/lib 2>/dev/null | awk 'NR == 2 { print $4 }')"
if [[ -z "$free_kib" || "$free_kib" -lt 8388608 ]]; then
  fail "At least 8 GiB of free space is required on the /var/lib filesystem"
elif [[ "$free_kib" -lt 15728640 ]]; then
  warn "At least 15 GiB of free space is recommended for updates and backups"
fi

if [[ ! -d /sys/fs/cgroup ]]; then
  fail "Linux cgroup filesystem was not found"
fi

for command_name in curl tar sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    fail "Required installer command was not found: $command_name"
  fi
done

printf 'BMS Retail Local Managed Runtime preflight\n'
printf 'platform=linux distribution=%s version=%s architecture=%s\n' "$distribution" "$version" "$architecture"
for message in "${warnings[@]}"; do printf '[WARN] %s\n' "$message"; done
for message in "${failures[@]}"; do printf '[FAIL] %s\n' "$message"; done

if (( ${#failures[@]} > 0 )); then
  printf 'result=unsupported\n'
  exit 1
fi

printf 'result=candidate\n'
printf 'A candidate result is not production approval; hardware and failure testing must also pass\n'
