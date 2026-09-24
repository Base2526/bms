#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -eq 0 ]] || { echo "กรุณารันด้วย sudo" >&2; exit 1; }
systemctl disable --now bms-retail-local.service 2>/dev/null || true
rm -f /etc/systemd/system/bms-retail-local.service
systemctl daemon-reload

if [[ ${1:-} != --erase-data ]]; then
  echo "หยุดและถอด startup แล้ว ข้อมูลร้านและ secrets ยังอยู่ใน /var/lib/bms-retail-local"
  echo "ใช้ bms-localctl backup ก่อน และ --erase-data เฉพาะเมื่อต้องการลบถาวร"
  exit 0
fi

read -r -p 'การลบถาวรกู้คืนไม่ได้ พิมพ์ ERASE-BMS-RETAIL-LOCAL: ' answer
[[ $answer == ERASE-BMS-RETAIL-LOCAL ]] || { echo "ยกเลิกการลบข้อมูล" >&2; exit 1; }
if [[ -f /var/lib/bms-retail-local/compose.yml && -f /var/lib/bms-retail-local/.env ]]; then
  docker compose --env-file /var/lib/bms-retail-local/.env \
    -f /var/lib/bms-retail-local/compose.yml down --volumes --remove-orphans
fi
rm -rf -- /var/lib/bms-retail-local
rm -rf -- /opt/bms-retail-local
rm -f /usr/local/bin/bms-localctl /usr/local/sbin/bms-retail-local-uninstall
echo "ลบ BMS Retail Local และข้อมูลในเครื่องแล้ว"
