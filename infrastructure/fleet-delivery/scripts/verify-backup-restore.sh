#!/bin/sh
set -eu

compose_file=${FLEET_DELIVERY_COMPOSE_FILE:-infrastructure/fleet-delivery/docker-compose.yml}
source_db=${FLEET_DELIVERY_POSTGRES_DB:?missing FLEET_DELIVERY_POSTGRES_DB}
owner=${FLEET_DELIVERY_POSTGRES_OWNER:?missing FLEET_DELIVERY_POSTGRES_OWNER}
restore_db=${FLEET_DELIVERY_RESTORE_VERIFY_DB:-fleet_delivery_restore_verify}
backup_path=
restore_created=false

if [ "$restore_db" = "$source_db" ]; then
  echo "Restore verification database must differ from the source database" >&2
  exit 2
fi
case "$restore_db" in
  ''|*[!a-zA-Z0-9_]*) echo "Invalid restore verification database name" >&2; exit 2 ;;
esac

case "$restore_db" in
  *_restore_verify) ;;
  *) echo "Restore verification database must end with _restore_verify" >&2; exit 2 ;;
esac

cleanup() {
  if [ "$restore_created" = true ]; then
    docker compose -f "$compose_file" exec -T postgres \
      dropdb --if-exists --force -U "$owner" "$restore_db" >/dev/null 2>&1 || true
  fi
  if [ -n "$backup_path" ]; then
    docker compose -f "$compose_file" exec -T postgres \
      rm -f "$backup_path" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

# Do not overwrite or delete a pre-existing verification database. Only this run's
# successful createdb grants cleanup ownership, including when restore fails.
docker compose -f "$compose_file" exec -T postgres \
  createdb -U "$owner" "$restore_db"
restore_created=true
backup_path=$(docker compose -f "$compose_file" exec -T postgres \
  mktemp /tmp/fleet-delivery-restore-verify.XXXXXXXX.dump)
docker compose -f "$compose_file" exec -T postgres \
  pg_dump -U "$owner" -d "$source_db" --format=custom --file="$backup_path"
docker compose -f "$compose_file" exec -T postgres \
  pg_restore -U "$owner" -d "$restore_db" --exit-on-error "$backup_path"

latest_migration=$(docker compose -f "$compose_file" exec -T postgres \
  psql -U "$owner" -d "$restore_db" -Atqc \
  "SELECT filename FROM public.fleet_delivery_schema_migrations ORDER BY filename DESC LIMIT 1")
[ "$latest_migration" = "0017_restore_delivery_amount_balance_invariant.sql" ]

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

service_requirement_guards=$(docker compose -f "$compose_file" exec -T postgres \
  psql -U "$owner" -d "$restore_db" -Atqc \
  "SELECT count(*) FROM pg_constraint WHERE conname IN ('delivery_quotes_service_requirement_check','deliveries_service_requirement_check')")
[ "$service_requirement_guards" = "2" ]

customer_grant_guards=$(docker compose -f "$compose_file" exec -T postgres \
  psql -U "$owner" -d "$restore_db" -Atqc \
  "SELECT count(*) FROM pg_class WHERE oid='fleet_delivery.customer_grants'::regclass AND relrowsecurity AND relforcerowsecurity")
[ "$customer_grant_guards" = "1" ]

customer_grant_resolver=$(docker compose -f "$compose_file" exec -T postgres \
  psql -U "$owner" -d "$restore_db" -Atqc \
  "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='fleet_delivery' AND p.proname='resolve_customer_grant' AND p.prosecdef")
[ "$customer_grant_resolver" = "1" ]

customer_tracking_guard=$(docker compose -f "$compose_file" exec -T postgres \
  psql -U "$owner" -d "$restore_db" -Atqc \
  "SELECT count(*) FROM pg_constraint WHERE conrelid='fleet_delivery.customer_grants'::regclass AND conname='customer_grants_allowed_actions_check' AND pg_get_constraintdef(oid) LIKE '%TRACK%'")
[ "$customer_tracking_guard" = "1" ]

post_pickup_guards=$(docker compose -f "$compose_file" exec -T postgres \
  psql -U "$owner" -d "$restore_db" -Atqc \
  "SELECT count(*) FROM pg_constraint WHERE conrelid='fleet_delivery.deliveries'::regclass AND conname IN ('deliveries_terminal_state_check','deliveries_amount_balance_check')")
[ "$post_pickup_guards" = "2" ]

post_pickup_tables=$(docker compose -f "$compose_file" exec -T postgres \
  psql -U "$owner" -d "$restore_db" -Atqc \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fleet_delivery' AND c.relname IN ('synthetic_pod_evidence','delivery_failures','delivery_returns','delivery_disputes','notification_intents') AND c.relkind='r'")
[ "$post_pickup_tables" = "5" ]

echo "backup_restore_verification=PASS latest_migration=$latest_migration"
