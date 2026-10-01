#!/usr/bin/env bash
set -Eeuo pipefail

# Run only in the disposable CI container: these paths model a shop installation.
[[ -f /.dockerenv ]] || { echo 'This test requires a disposable Docker container' >&2; exit 2; }
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/bin" /var/lib/bms-retail-local /etc/systemd/system
export PATH="$work/bin:$PATH"
export BMS_TEST_CALLS="$work/calls"
cat >"$work/bin/systemctl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$BMS_TEST_CALLS"
if [ "$1" = stop ] && [ "$2" = bms-retail-local.service ]; then
  exec sleep 60
fi
exit 0
EOF
cat >"$work/bin/docker" <<'EOF'
#!/bin/sh
printf 'docker %s\n' "$*" >>"$BMS_TEST_CALLS"
EOF
chmod +x "$work/bin/systemctl" "$work/bin/docker"

for script in /workspace/deploy/retail-local/managed-runtime/linux/uninstall-managed-runtime.sh /package/DEBIAN/prerm; do
  : >"$BMS_TEST_CALLS"
  printf 'keep shop data\n' >/var/lib/bms-retail-local/data-sentinel
  printf 'keep secrets\n' >/var/lib/bms-retail-local/.env
  printf 'fixture\n' >/var/lib/bms-retail-local/compose.yml
  printf 'fixture\n' >/etc/systemd/system/bms-retail-local.service
  SECONDS=0
  timeout 30s bash "$script" remove
  ((SECONDS < 30))
  grep -Fx 'keep shop data' /var/lib/bms-retail-local/data-sentinel
  grep -Fx 'keep secrets' /var/lib/bms-retail-local/.env
  test ! -e /etc/systemd/system/bms-retail-local.service
  grep -Fx 'disable bms-retail-local.service' "$BMS_TEST_CALLS"
  grep -Fx 'kill --kill-who=all bms-retail-local.service' "$BMS_TEST_CALLS"
  grep -F 'docker compose ' "$BMS_TEST_CALLS" | grep -F ' kill'
  printf 'Uninstall preserved data and bounded a stuck stop: %s (%ss)\n' "$script" "$SECONDS"
done
