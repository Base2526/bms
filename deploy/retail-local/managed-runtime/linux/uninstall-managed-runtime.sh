#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -eq 0 ]] || { echo "กรุณารันด้วย sudo" >&2; exit 1; }

progress() { printf '\n[BMS Uninstall %s/4] %s\n' "$1" "$2"; }
stop_unit_bounded() {
  local unit=$1 seconds=$2
  if timeout "${seconds}s" systemctl stop "$unit" >/dev/null 2>&1; then
    return 0
  fi
  printf 'คำเตือน: %s หยุดไม่ทัน %s วินาที กำลังบังคับหยุดและทำขั้นตอนถัดไป\n' \
    "$unit" "$seconds" >&2
  timeout 3s systemctl kill --kill-who=all "$unit" >/dev/null 2>&1 || true
  systemctl reset-failed "$unit" >/dev/null 2>&1 || true
  return 1
}
force_stop_containers() {
  [[ -f /var/lib/bms-retail-local/compose.yml && -f /var/lib/bms-retail-local/.env ]] || return 0
  timeout 5s docker compose --env-file /var/lib/bms-retail-local/.env \
    -f /var/lib/bms-retail-local/compose.yml kill >/dev/null 2>&1 || true
}

progress 1 "ปิด startup, timer และงานเบื้องหลัง"
for unit in \
  bms-retail-local.service \
  bms-retail-local-license-evidence.timer \
  bms-retail-local-license-ui.timer \
  bms-retail-local-offhost-backup.timer; do
  systemctl disable "$unit" >/dev/null 2>&1 || true
done
stop_unit_bounded bms-retail-local-license-evidence.timer 3 || true
stop_unit_bounded bms-retail-local-license-ui.timer 3 || true
stop_unit_bounded bms-retail-local-offhost-backup.timer 3 || true
stop_unit_bounded bms-retail-local-license-evidence.service 5 || true
stop_unit_bounded bms-retail-local-license-ui.service 5 || true
stop_unit_bounded bms-retail-local-offhost-backup.service 5 || true

progress 2 "บันทึกการถอนการติดตั้งและหยุดบริการ"
# Commercial evidence is best-effort and must never hold up uninstall.
timeout 3s /opt/bms-retail-local/bms-runtime-agent license-pulse \
  -root /var/lib/bms-retail-local -event INSTALLATION_DEACTIVATED >/dev/null 2>&1 || true
if [[ -s /etc/bms-retail-local/activation-url && -f /var/lib/bms-retail-local/installation.json ]]; then
  timeout 5s /opt/bms-retail-local/bms-runtime-agent installation-report \
    -root /var/lib/bms-retail-local -control-uri "$(tr -d '\r\n' </etc/bms-retail-local/activation-url)" \
    -event UNINSTALLED -package-type "$(jq -r '.packageType // "server-pos"' /var/lib/bms-retail-local/installation.json)" \
    -target "$(jq -r '.platformTarget' /var/lib/bms-retail-local/installation.json)" \
    -release-version "$(jq -r '.version' /var/lib/bms-retail-local/installation.json)" \
    -tenant-reference "$(jq -r '.tenantId // empty' /var/lib/bms-retail-local/installation.json)" \
    -license-reference "$(jq -r '.licenseCode // empty' /var/lib/bms-retail-local/installation.json)" -force \
    >/dev/null 2>&1 || true
fi
if ! stop_unit_bounded bms-retail-local.service 10; then
  force_stop_containers
fi

progress 3 "นำรายการเริ่มอัตโนมัติออก"
rm -f /etc/systemd/system/bms-retail-local.service
rm -f /etc/systemd/system/bms-retail-local-offhost-backup.service \
  /etc/systemd/system/bms-retail-local-offhost-backup.timer \
  /etc/systemd/system/bms-retail-local-license-evidence.service \
  /etc/systemd/system/bms-retail-local-license-ui.service \
  /etc/systemd/system/bms-retail-local-license-ui.timer \
  /etc/systemd/system/bms-retail-local-license-evidence.timer
systemctl daemon-reload

if [[ ${1:-} != --erase-data ]]; then
  progress 4 "เสร็จสิ้น โดยเก็บข้อมูลร้านไว้"
  echo "หยุดและถอด startup แล้ว ข้อมูลร้านและ secrets ยังอยู่ใน /var/lib/bms-retail-local"
  echo "ใช้ bms-localctl backup ก่อน และ --erase-data เฉพาะเมื่อต้องการลบถาวร"
  exit 0
fi

read -r -p 'การลบถาวรกู้คืนไม่ได้ พิมพ์ ERASE-BMS-RETAIL-LOCAL: ' answer
[[ $answer == ERASE-BMS-RETAIL-LOCAL ]] || { echo "ยกเลิกการลบข้อมูล" >&2; exit 1; }
if [[ -f /var/lib/bms-retail-local/compose.yml && -f /var/lib/bms-retail-local/.env ]]; then
  timeout 45s docker compose --env-file /var/lib/bms-retail-local/.env \
    -f /var/lib/bms-retail-local/compose.yml down --timeout 5 --volumes --remove-orphans || {
      echo "ลบ container/volume ไม่สำเร็จ จึงยังไม่ลบข้อมูลร้าน กรุณาลองใหม่หรือติดต่อ Support" >&2
      exit 1
    }
fi
rm -rf -- /var/lib/bms-retail-local
rm -rf -- /opt/bms-retail-local
rm -f /usr/local/bin/bms-localctl /usr/local/sbin/bms-retail-local-uninstall \
  /usr/local/sbin/bms-retail-local-offhost-backup
progress 4 "ลบระบบและข้อมูลร้านแล้ว"
echo "ลบ BMS Retail Local และข้อมูลในเครื่องแล้ว"
