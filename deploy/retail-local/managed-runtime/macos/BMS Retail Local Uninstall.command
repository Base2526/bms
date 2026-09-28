#!/bin/bash
set -u

clear
printf 'ถอนการติดตั้ง BMS Retail Local\n\n'
printf '1) หยุดระบบและเก็บข้อมูลร้านไว้สำหรับ recovery\n'
printf '2) ลบระบบและข้อมูลร้านออกจากเครื่องอย่างถาวร\n'
printf '3) ยกเลิก\n\n'
read -r -p 'เลือก 1, 2 หรือ 3: ' choice

case "$choice" in
  1)
    /usr/local/bin/bms-retail-local uninstall
    ;;
  2)
    printf '\nควรมี backup ที่ตรวจสอบแล้วก่อนลบถาวร\n'
    read -r -p 'พิมพ์ BACKUP-VERIFIED เพื่อดำเนินการต่อ: ' backup_confirmation
    if [[ $backup_confirmation != BACKUP-VERIFIED ]]; then
      printf 'ยกเลิกการลบข้อมูล\n'
    else
      /usr/local/bin/bms-retail-local uninstall --erase-data
    fi
    ;;
  *)
    printf 'ยกเลิก\n'
    ;;
esac

printf '\nกด Enter เพื่อปิดหน้าต่างนี้...'
read -r
