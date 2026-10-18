#!/bin/sh
set -eu

compose_file=${FLEET_DELIVERY_COMPOSE_FILE:-infrastructure/fleet-delivery/docker-compose.yml}
source_db=${FLEET_DELIVERY_POSTGRES_DB:?missing FLEET_DELIVERY_POSTGRES_DB}
owner=${FLEET_DELIVERY_POSTGRES_OWNER:?missing FLEET_DELIVERY_POSTGRES_OWNER}
restore_db=${FLEET_DELIVERY_RESTORE_VERIFY_DB:-fleet_delivery_restore_verify}
backup_path=/tmp/fleet-delivery-restore-verify.dump

case "$restore_db" in
  *_restore_verify) ;;
  *) echo "Restore verification database must end with _restore_verify" >&2; exit 2 ;;
esac

cleanup() {
  docker compose -f "$compose_file" exec -T postgres \
    dropdb --if-exists --force -U "$owner" "$restore_db" >/dev/null 2>&1 || true
  docker compose -f "$compose_file" exec -T postgres \
    rm -f "$backup_path" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
docker compose -f "$compose_file" exec -T postgres \
  pg_dump -U "$owner" -d "$source_db" --format=custom --file="$backup_path"
docker compose -f "$compose_file" exec -T postgres \
  createdb -U "$owner" "$restore_db"
docker compose -f "$compose_file" exec -T postgres \
  pg_restore -U "$owner" -d "$restore_db" --exit-on-error "$backup_path"

latest_migration=$(docker compose -f "$compose_file" exec -T postgres \
  psql -U "$owner" -d "$restore_db" -Atqc \
  "SELECT filename FROM public.fleet_delivery_schema_migrations ORDER BY filename DESC LIMIT 1")
[ "$latest_migration" = "0010_phase7_operations_read_models.sql" ]

forced_rls=$(docker compose -f "$compose_file" exec -T postgres \
  psql -U "$owner" -d "$restore_db" -Atqc \
  "SELECT relforcerowsecurity FROM pg_class WHERE oid='fleet_delivery.deliveries'::regclass")
[ "$forced_rls" = "t" ]

finance_guard=$(docker compose -f "$compose_file" exec -T postgres \
  psql -U "$owner" -d "$restore_db" -Atqc \
  "SELECT count(*) FROM pg_constraint WHERE conname IN ('ledger_accounts_shadow_code_check','ledger_accounts_shadow_type_check')")
[ "$finance_guard" = "2" ]

operations_indexes=$(docker compose -f "$compose_file" exec -T postgres \
  psql -U "$owner" -d "$restore_db" -Atqc \
  "SELECT count(*) FROM pg_indexes WHERE schemaname='fleet_delivery' AND indexname IN ('deliveries_operations_list_idx','deliveries_operations_state_list_idx','dispatch_manual_queue_open_operations_idx')")
[ "$operations_indexes" = "3" ]

echo "backup_restore_verification=PASS latest_migration=$latest_migration"
