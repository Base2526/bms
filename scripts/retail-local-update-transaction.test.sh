#!/usr/bin/env bash
set -Eeuo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
transaction="$repo_root/deploy/retail-local/managed-runtime/runtime-rootfs/bms-update-transaction"
work=$(mktemp -d "${TMPDIR:-/tmp}/bms-update-test.XXXXXX")
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT HUP INT TERM
fake_bin="$work/bin"
runtime_root="$work/runtime"
mkdir -p "$fake_bin" "$runtime_root/updates/1.1.0"

cat >"$fake_bin/docker" <<'EOF'
#!/bin/sh
case " $* " in
  *" run --rm migrate "*) [ ! -f "$BMS_RUNTIME_ROOT/fail-migrate" ] ;;
  *) exit 0 ;;
esac
EOF
cat >"$fake_bin/bms-localctl" <<'EOF'
#!/bin/sh
case "${1:-}" in
  doctor|start) exit 0 ;;
  backup) : >"$2" ;;
  restore) : >"$BMS_RUNTIME_ROOT/restore-called" ;;
  *) exit 1 ;;
esac
EOF
cat >"$fake_bin/age-keygen" <<'EOF'
#!/bin/sh
if [ "${1:-}" = -o ]; then printf 'AGE-SECRET-KEY-TEST\n' >"$2"; exit 0; fi
if [ "${1:-}" = -y ]; then printf 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq\n'; exit 0; fi
exit 1
EOF
cat >"$fake_bin/age" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$fake_bin"/*

write_old_runtime() {
  cat >"$runtime_root/.env" <<'EOF'
BMS_WEB_IMAGE_REF=bms/web:1.0.0
BMS_WS_IMAGE_REF=bms/ws:1.0.0
BMS_POSTGRES_IMAGE_REF=bms/postgres:1.0.0
BMS_REDIS_IMAGE_REF=bms/redis:1.0.0
EOF
  printf 'old-compose\n' >"$runtime_root/compose.yml"
  printf '{"product":"BMS Retail Local","version":"1.0.0"}\n' >"$runtime_root/installation.json"
  printf 'new-compose\n' >"$runtime_root/updates/1.1.0/compose.next.yml"
  printf '{"product":"BMS Retail Local","version":"1.1.0"}\n' >"$runtime_root/updates/1.1.0/installation.next.json"
}

write_old_runtime
PATH="$fake_bin:$PATH" BMS_RUNTIME_ROOT="$runtime_root" "$transaction" begin 1.1.0 0 \
  bms/web:1.1.0 bms/ws:1.1.0 bms/postgres:1.1.0 bms/redis:1.1.0
grep -Fqx runtime-healthy "$runtime_root/updates/1.1.0/phase"
grep -Fqx 'BMS_WEB_IMAGE_REF=bms/web:1.1.0' "$runtime_root/.env"
PATH="$fake_bin:$PATH" BMS_RUNTIME_ROOT="$runtime_root" "$transaction" commit 1.1.0
grep -Fq '"version":"1.1.0"' "$runtime_root/installation.json"
test ! -e "$runtime_root/update-active"

rm -rf -- "$runtime_root"
mkdir -p "$runtime_root/updates/1.1.0"
write_old_runtime
: >"$runtime_root/fail-migrate"
if PATH="$fake_bin:$PATH" BMS_RUNTIME_ROOT="$runtime_root" "$transaction" begin 1.1.0 0 \
  bms/web:1.1.0 bms/ws:1.1.0 bms/postgres:1.1.0 bms/redis:1.1.0; then
  echo "expected failed migration to fail the update" >&2
  exit 1
fi
grep -Fqx rolled-back "$runtime_root/updates/1.1.0/phase"
grep -Fqx 'BMS_WEB_IMAGE_REF=bms/web:1.0.0' "$runtime_root/.env"
grep -Fqx old-compose "$runtime_root/compose.yml"
test -f "$runtime_root/restore-called"
test ! -e "$runtime_root/update-active"

rm -rf -- "$runtime_root"
mkdir -p "$runtime_root/updates/1.1.0" "$runtime_root/backups"
write_old_runtime
cp "$runtime_root/.env" "$runtime_root/updates/1.1.0/old.env"
cp "$runtime_root/compose.yml" "$runtime_root/updates/1.1.0/old.compose.yml"
cp "$runtime_root/installation.json" "$runtime_root/updates/1.1.0/old.installation.json"
printf '0\n' >"$runtime_root/updates/1.1.0/rollback-safe"
printf '%s\n' "$runtime_root/backups/pre-update-1.1.0.age" >"$runtime_root/updates/1.1.0/backup-path"
: >"$runtime_root/backups/pre-update-1.1.0.age"
printf 'AGE-SECRET-KEY-TEST\n' >"$runtime_root/update-recovery.agekey"
printf 'switched\n' >"$runtime_root/updates/1.1.0/phase"
printf '1.1.0\n' >"$runtime_root/update-active"
mkdir "$runtime_root/.update-transaction.lock"
printf '999999\n' >"$runtime_root/.update-transaction.lock/pid"
sed -i.bak 's/:1\.0\.0/:1.1.0/g' "$runtime_root/.env" && rm -f "$runtime_root/.env.bak"
printf 'new-compose\n' >"$runtime_root/compose.yml"
PATH="$fake_bin:$PATH" BMS_RUNTIME_ROOT="$runtime_root" "$transaction" recover
grep -Fqx rolled-back "$runtime_root/updates/1.1.0/phase"
grep -Fqx 'BMS_WEB_IMAGE_REF=bms/web:1.0.0' "$runtime_root/.env"
grep -Fqx old-compose "$runtime_root/compose.yml"
test ! -e "$runtime_root/update-active"

echo "retail-local update transaction tests: pass"
