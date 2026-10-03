#!/bin/bash
set -u

clear
printf 'BMS Retail Local Server (macOS)\n\n'
# Setup also completes pairing and health checks after a late installation interruption.
/usr/local/bin/bms-retail-local setup
exit_code=$?
if (( exit_code == 0 )); then
  printf '\nOpen BMS Retail Local at http://127.0.0.1:3100\n'
  open http://127.0.0.1:3100/admin/login
else
  printf '\nSetup did not complete. Read the [FAIL] messages above\n'
  printf 'After resolving the issues, open Applications > BMS Retail Local again\n'
  reports="${BMS_RETAIL_LOCAL_STATE_ROOT:-$HOME/Library/Application Support/BMS/RetailLocal}/diagnostics"
  if [[ -t 0 && -d $reports ]]; then
    read -r -p 'Open error reports in Finder? [y/N]: ' show_report || true
    [[ ${show_report:-} != [yY] ]] || open "$reports" || true
  fi
fi
printf '\nPress Enter to close this window...'
read -r
exit "$exit_code"
