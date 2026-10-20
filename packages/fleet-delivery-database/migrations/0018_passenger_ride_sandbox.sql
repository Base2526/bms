-- Isolated local passenger sandbox. No BMS order, real payment, KYC or delivery authority.
CREATE TABLE IF NOT EXISTS fleet_delivery.ride_sandbox_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_ref text NOT NULL,
  username text NOT NULL, role text NOT NULL CHECK (role IN ('RIDER','DRIVER')),
  password_hash text NOT NULL, display_name text NOT NULL, vehicle_plate text NOT NULL DEFAULT '',
  online boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_ref, username, role), UNIQUE (id, tenant_ref),
  CHECK (role = 'DRIVER' OR NOT online), CHECK (role <> 'DRIVER' OR length(vehicle_plate) >= 2)
);
CREATE TABLE IF NOT EXISTS fleet_delivery.ride_sandbox_sessions (
  token_hash text PRIMARY KEY, tenant_ref text NOT NULL, account_id uuid NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  FOREIGN KEY (account_id, tenant_ref) REFERENCES fleet_delivery.ride_sandbox_accounts(id, tenant_ref)
);
CREATE TABLE IF NOT EXISTS fleet_delivery.ride_sandbox_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_ref text NOT NULL, rider_id uuid NOT NULL,
  pickup jsonb NOT NULL, dropoff jsonb NOT NULL, distance_m integer NOT NULL CHECK(distance_m > 0),
  fare_satang integer NOT NULL CHECK(fare_satang > 0), expires_at timestamptz NOT NULL,
  FOREIGN KEY (rider_id, tenant_ref) REFERENCES fleet_delivery.ride_sandbox_accounts(id, tenant_ref),
  UNIQUE(id, tenant_ref)
);
CREATE TABLE IF NOT EXISTS fleet_delivery.ride_sandbox_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_ref text NOT NULL,
  rider_id uuid NOT NULL, driver_id uuid, quote_id uuid NOT NULL UNIQUE,
  pickup jsonb NOT NULL, dropoff jsonb NOT NULL, fare_satang integer NOT NULL CHECK(fare_satang > 0),
  distance_m integer NOT NULL CHECK(distance_m > 0), version integer NOT NULL DEFAULT 1,
  state text NOT NULL CHECK(state IN ('SEARCHING','ACCEPTED','AT_PICKUP','IN_PROGRESS','AWAITING_PAYMENT','COMPLETED','CANCELLED')),
  payment_status text NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN ('UNPAID','DECLINED','SUCCEEDED')),
  receipt_ref text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (rider_id, tenant_ref) REFERENCES fleet_delivery.ride_sandbox_accounts(id, tenant_ref),
  FOREIGN KEY (driver_id, tenant_ref) REFERENCES fleet_delivery.ride_sandbox_accounts(id, tenant_ref),
  FOREIGN KEY (quote_id, tenant_ref) REFERENCES fleet_delivery.ride_sandbox_quotes(id, tenant_ref),
  UNIQUE(id, tenant_ref),
  CHECK ((state = 'COMPLETED') = (payment_status = 'SUCCEEDED')),
  CHECK ((payment_status = 'SUCCEEDED') = (receipt_ref IS NOT NULL)),
  CHECK (state IN ('SEARCHING','CANCELLED') OR driver_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ride_sandbox_rider_active ON fleet_delivery.ride_sandbox_trips(rider_id)
  WHERE state NOT IN ('COMPLETED','CANCELLED');
CREATE UNIQUE INDEX IF NOT EXISTS ride_sandbox_driver_active ON fleet_delivery.ride_sandbox_trips(driver_id)
  WHERE state NOT IN ('COMPLETED','CANCELLED');
CREATE TABLE IF NOT EXISTS fleet_delivery.ride_sandbox_commands (
  tenant_ref text NOT NULL, account_id uuid NOT NULL, command_key text NOT NULL,
  fingerprint text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_ref, account_id, command_key),
  FOREIGN KEY (account_id, tenant_ref) REFERENCES fleet_delivery.ride_sandbox_accounts(id, tenant_ref)
);
CREATE TABLE IF NOT EXISTS fleet_delivery.ride_sandbox_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_ref text NOT NULL,
  account_id uuid NOT NULL, trip_id uuid, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, tenant_ref) REFERENCES fleet_delivery.ride_sandbox_accounts(id, tenant_ref),
  FOREIGN KEY (trip_id, tenant_ref) REFERENCES fleet_delivery.ride_sandbox_trips(id, tenant_ref)
);
DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['ride_sandbox_accounts','ride_sandbox_sessions','ride_sandbox_quotes','ride_sandbox_trips','ride_sandbox_commands','ride_sandbox_audit'] LOOP
    EXECUTE format('ALTER TABLE fleet_delivery.%I ENABLE ROW LEVEL SECURITY',n);
    EXECUTE format('ALTER TABLE fleet_delivery.%I FORCE ROW LEVEL SECURITY',n);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON fleet_delivery.%I',n);
    EXECUTE format('CREATE POLICY tenant_isolation ON fleet_delivery.%I USING (tenant_ref = NULLIF(current_setting(''fleet_delivery.tenant_ref'',true),'''')) WITH CHECK (tenant_ref = NULLIF(current_setting(''fleet_delivery.tenant_ref'',true),''''))',n);
    EXECUTE format('GRANT SELECT, INSERT ON fleet_delivery.%I TO fleet_delivery_app',n);
  END LOOP;
END $$;
GRANT UPDATE ON fleet_delivery.ride_sandbox_accounts, fleet_delivery.ride_sandbox_sessions, fleet_delivery.ride_sandbox_trips TO fleet_delivery_app;
-- ROLLBACK: stop the separate ride sandbox server; retain sandbox rows/audit. No delivery states changed.
