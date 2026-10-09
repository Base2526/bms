#!/bin/bash
set -Eeuo pipefail

finish() {
  local status=$?
  trap - EXIT
  printf '\nPress Enter to close this window...'
  read -r || true
  exit "$status"
}
trap finish EXIT

clear
printf 'Uninstall BMS Retail Local\n\n'
printf '1) Stop the system and preserve shop data for recovery\n'
printf '2) Permanently delete the system and shop data from this computer\n'
printf '3) Cancelled\n\n'
read -r -p 'Select 1, 2, or 3: ' choice

case "$choice" in
  1)
    /usr/local/bin/bms-retail-local uninstall
    ;;
  2)
    printf '\nHave a verified backup before permanently deleting data\n'
    read -r -p 'Type BACKUP-VERIFIED to continue: ' backup_confirmation
    if [[ $backup_confirmation != BACKUP-VERIFIED ]]; then
      printf 'Data deletion cancelled\n'
    else
      /usr/local/bin/bms-retail-local uninstall --erase-data
    fi
    ;;
  *)
    printf 'Cancelled\n'
    ;;
esac
