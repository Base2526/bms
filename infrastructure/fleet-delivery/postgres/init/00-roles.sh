#!/bin/sh
set -eu

: "${POSTGRES_USER:?missing POSTGRES_USER}"
: "${POSTGRES_DB:?missing POSTGRES_DB}"
: "${FLEET_DELIVERY_APP_DB_PASSWORD:?missing FLEET_DELIVERY_APP_DB_PASSWORD}"
: "${FLEET_DELIVERY_WORKER_DB_PASSWORD:?missing FLEET_DELIVERY_WORKER_DB_PASSWORD}"

psql --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="$FLEET_DELIVERY_APP_DB_PASSWORD" \
  --set=worker_password="$FLEET_DELIVERY_WORKER_DB_PASSWORD" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet_delivery_app') THEN
    CREATE ROLE fleet_delivery_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet_delivery_worker') THEN
    CREATE ROLE fleet_delivery_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
SELECT format('ALTER ROLE fleet_delivery_app LOGIN PASSWORD %L', :'app_password') \gexec
SELECT format('ALTER ROLE fleet_delivery_worker LOGIN PASSWORD %L', :'worker_password') \gexec
SQL
