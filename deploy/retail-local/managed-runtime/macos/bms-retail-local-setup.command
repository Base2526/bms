#!/bin/bash
set -u

clear
printf 'BMS Retail Local Server (macOS)\n\n'
receipt="$HOME/Library/Application Support/BMS/RetailLocal/installation.json"
if [[ -f $receipt ]]; then
  /usr/local/bin/bms-retail-local start
else
  /usr/local/bin/bms-retail-local setup
fi
exit_code=$?
if (( exit_code == 0 )); then
  printf '\nเปิด BMS Retail Local ที่ http://127.0.0.1:3100\n'
  open http://127.0.0.1:3100/admin/login
else
  printf '\nSetup ยังไม่สำเร็จ กรุณาอ่านข้อความ [ต้องแก้ไข] ด้านบน\n'
  printf 'เมื่อแก้ไขแล้ว ให้เปิด Applications > BMS Retail Local อีกครั้ง\n'
fi
printf '\nกด Enter เพื่อปิดหน้าต่างนี้...'
read -r
exit "$exit_code"
