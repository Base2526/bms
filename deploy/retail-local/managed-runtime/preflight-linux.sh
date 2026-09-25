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
  fail "รองรับเฉพาะ Linux x86_64 ใน milestone แรก (พบ $architecture)"
fi

if [[ ! -r /etc/os-release ]]; then
  fail "อ่าน /etc/os-release ไม่ได้"
  distribution="unknown"
  version="unknown"
else
  # shellcheck disable=SC1091 -- this is the operating system's standard metadata file.
  source /etc/os-release
  distribution="${ID:-unknown}"
  version="${VERSION_ID:-unknown}"
  if [[ "$distribution" != "ubuntu" ]]; then
    fail "milestone แรกรองรับ Ubuntu เท่านั้น (พบ $distribution)"
  elif [[ "$version" != "24.04" && "$version" != "22.04" ]]; then
    fail "รองรับ Ubuntu 24.04 LTS หรือ 22.04 LTS เท่านั้น (พบ $version)"
  elif [[ "$version" == "22.04" ]]; then
    warn "Ubuntu 22.04 เป็น transition target; Ubuntu 24.04 เป็น target หลัก"
  fi
fi

if ! command -v systemctl >/dev/null 2>&1; then
  fail "ไม่พบ systemd/systemctl"
elif [[ "$(ps -p 1 -o comm= 2>/dev/null | tr -d ' ')" != "systemd" ]]; then
  fail "PID 1 ไม่ใช่ systemd"
fi

if [[ ! -r /proc/meminfo ]]; then
  fail "อ่านขนาดหน่วยความจำไม่ได้"
else
  memory_kib="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
  if [[ -z "$memory_kib" || "$memory_kib" -lt 8388608 ]]; then
    fail "ต้องมี RAM อย่างน้อย 8 GiB"
  fi
fi

free_kib="$(df -Pk /var/lib 2>/dev/null | awk 'NR == 2 { print $4 }')"
if [[ -z "$free_kib" || "$free_kib" -lt 8388608 ]]; then
  fail "ต้องมีพื้นที่ว่างอย่างน้อย 8 GiB บน filesystem ของ /var/lib"
elif [[ "$free_kib" -lt 15728640 ]]; then
  warn "ควรมีพื้นที่ว่างอย่างน้อย 15 GiB สำหรับ update และ backup"
fi

if [[ ! -d /sys/fs/cgroup ]]; then
  fail "ไม่พบ Linux cgroup filesystem"
fi

for command_name in curl tar sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    fail "ไม่พบคำสั่งที่ installer ต้องใช้: $command_name"
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
printf 'หมายเหตุ: candidate ยังไม่ใช่การรับรอง production จนกว่าจะผ่าน hardware/failure matrix\n'
