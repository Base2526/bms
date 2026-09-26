#!/bin/bash
set -u

clear
printf 'BMS Retail Local Server (macOS Apple Silicon)\n\n'
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
fi
printf '\nกด Enter เพื่อปิดหน้าต่างนี้...'
read -r
exit "$exit_code"
