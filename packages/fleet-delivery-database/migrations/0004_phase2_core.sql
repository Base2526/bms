CREATE TABLE IF NOT EXISTS fleet_delivery.merchant_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  enabled boolean NOT NULL,
  timezone text NOT NULL CHECK (timezone = 'Asia/Bangkok'),
  readiness_policy text NOT NULL CHECK (readiness_policy = 'EXPLICIT'),
  weekly_hours jsonb NOT NULL CHECK (jsonb_typeof(weekly_hours) = 'array'),
  quote_ttl_seconds integer NOT NULL CHECK (quote_ttl_seconds BETWEEN 60 AND 1800),
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_ref, branch_ref, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS merchant_configurations_one_active_idx
  ON fleet_delivery.merchant_configurations (tenant_ref, branch_ref)
  WHERE active;

CREATE TABLE IF NOT EXISTS fleet_delivery.service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  configuration_id uuid NOT NULL REFERENCES fleet_delivery.merchant_configurations(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  area geometry(MultiPolygon, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ST_IsValid(area)),
  UNIQUE (configuration_id)
);

CREATE INDEX IF NOT EXISTS service_areas_geometry_idx
  ON fleet_delivery.service_areas USING gist (area);

CREATE TABLE IF NOT EXISTS fleet_delivery.pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  configuration_id uuid NOT NULL REFERENCES fleet_delivery.merchant_configurations(id),
  rule_version text NOT NULL,
  currency text NOT NULL CHECK (currency = 'THB'),
  base_fare_satang bigint NOT NULL CHECK (base_fare_satang >= 0),
  per_started_km_satang bigint NOT NULL CHECK (per_started_km_satang >= 0),
  minimum_fare_satang bigint NOT NULL CHECK (minimum_fare_satang > 0),
  fixed_merchant_subsidy_satang bigint NOT NULL CHECK (fixed_merchant_subsidy_satang >= 0),
  commission_bps integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  distance_rounding text NOT NULL DEFAULT 'STARTED_KILOMETRE' CHECK (distance_rounding = 'STARTED_KILOMETRE'),
  commission_rounding text NOT NULL DEFAULT 'HALF_UP_SATANG' CHECK (commission_rounding = 'HALF_UP_SATANG'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (configuration_id),
  UNIQUE (tenant_ref, branch_ref, rule_version)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.order_context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  bms_order_ref text NOT NULL,
  order_version bigint NOT NULL CHECK (order_version > 0),
  fulfillment_type text NOT NULL CHECK (fulfillment_type = 'DELIVERY'),
  payment_state text NOT NULL CHECK (payment_state IN ('UNPAID', 'PENDING', 'CONFIRMED')),
  merchant_readiness text NOT NULL CHECK (merchant_readiness IN ('NOT_ACCEPTED', 'PREPARING', 'READY')),
  eligibility_version text NOT NULL,
  eligibility_decision text NOT NULL CHECK (eligibility_decision IN ('ELIGIBLE', 'INELIGIBLE')),
  eligibility_blockers jsonb NOT NULL CHECK (jsonb_typeof(eligibility_blockers) = 'array'),
  eligibility_evaluated_at timestamptz NOT NULL,
  dropoff_point geometry(Point, 4326) NOT NULL,
  geocode_confidence numeric(4,3) NOT NULL CHECK (geocode_confidence BETWEEN 0 AND 1),
  route_provider text NOT NULL CHECK (route_provider = 'synthetic'),
  route_reference text NOT NULL,
  route_distance_m integer NOT NULL CHECK (route_distance_m BETWEEN 1 AND 200000),
  route_observed_at timestamptz NOT NULL,
  source_message_id uuid NOT NULL,
  current boolean NOT NULL DEFAULT true,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_ref, branch_ref, bms_order_ref, order_version),
  UNIQUE (source_message_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS order_context_one_current_idx
  ON fleet_delivery.order_context_snapshots (tenant_ref, branch_ref, bms_order_ref)
  WHERE current;

CREATE TABLE IF NOT EXISTS fleet_delivery.delivery_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  bms_order_ref text NOT NULL,
  order_context_id uuid NOT NULL REFERENCES fleet_delivery.order_context_snapshots(id),
  order_version bigint NOT NULL CHECK (order_version > 0),
  eligibility_version text NOT NULL,
  configuration_version bigint NOT NULL CHECK (configuration_version > 0),
  pricing_rule_version text NOT NULL,
  route_provider text NOT NULL,
  route_reference text NOT NULL,
  route_distance_m integer NOT NULL CHECK (route_distance_m > 0),
  billable_distance_m integer NOT NULL CHECK (billable_distance_m > 0),
  currency text NOT NULL CHECK (currency = 'THB'),
  base_fare_satang bigint NOT NULL CHECK (base_fare_satang >= 0),
  distance_charge_satang bigint NOT NULL CHECK (distance_charge_satang >= 0),
  gross_delivery_fee_satang bigint NOT NULL CHECK (gross_delivery_fee_satang >= 0),
  customer_contribution_satang bigint NOT NULL CHECK (customer_contribution_satang >= 0),
  merchant_subsidy_satang bigint NOT NULL CHECK (merchant_subsidy_satang >= 0),
  explicit_discount_satang bigint NOT NULL CHECK (explicit_discount_satang >= 0),
  eligible_commission_fee_satang bigint NOT NULL CHECK (eligible_commission_fee_satang >= 0),
  commission_bps integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  commission_satang bigint NOT NULL CHECK (commission_satang >= 0),
  distance_rounding text NOT NULL,
  commission_rounding text NOT NULL,
  status text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'BOUND')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  bound_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (customer_contribution_satang + merchant_subsidy_satang + explicit_discount_satang = gross_delivery_fee_satang),
  CHECK (status <> 'BOUND' OR bound_at IS NOT NULL),
  UNIQUE (id, tenant_ref)
);

CREATE INDEX IF NOT EXISTS delivery_quotes_order_idx
  ON fleet_delivery.delivery_quotes (tenant_ref, branch_ref, bms_order_ref, created_at DESC);

CREATE TABLE IF NOT EXISTS fleet_delivery.quote_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  quote_id uuid NOT NULL,
  component_type text NOT NULL CHECK (component_type IN (
    'BASE_FARE', 'DISTANCE_CHARGE', 'MINIMUM_ADJUSTMENT', 'MERCHANT_SUBSIDY',
    'EXPLICIT_DISCOUNT', 'PLATFORM_COMMISSION'
  )),
  amount_satang bigint NOT NULL CHECK (amount_satang >= 0),
  calculation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (quote_id, tenant_ref) REFERENCES fleet_delivery.delivery_quotes(id, tenant_ref),
  UNIQUE (quote_id, component_type)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  bms_order_ref text NOT NULL,
  fulfillment_kind text NOT NULL DEFAULT 'DELIVERY' CHECK (fulfillment_kind = 'DELIVERY'),
  quote_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN (
    'AWAITING_PAYMENT', 'AWAITING_MERCHANT_ACCEPTANCE', 'PREPARING',
    'READY_FOR_DISPATCH', 'CANCELLED'
  )),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  currency text NOT NULL CHECK (currency = 'THB'),
  gross_delivery_fee_satang bigint NOT NULL CHECK (gross_delivery_fee_satang >= 0),
  customer_contribution_satang bigint NOT NULL CHECK (customer_contribution_satang >= 0),
  merchant_subsidy_satang bigint NOT NULL CHECK (merchant_subsidy_satang >= 0),
  explicit_discount_satang bigint NOT NULL CHECK (explicit_discount_satang >= 0),
  commission_bps integer NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  commission_satang bigint NOT NULL CHECK (commission_satang >= 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz,
  FOREIGN KEY (quote_id, tenant_ref) REFERENCES fleet_delivery.delivery_quotes(id, tenant_ref),
  UNIQUE (quote_id),
  UNIQUE (tenant_ref, branch_ref, bms_order_ref, fulfillment_kind),
  UNIQUE (id, tenant_ref),
  CHECK (customer_contribution_satang + merchant_subsidy_satang + explicit_discount_satang = gross_delivery_fee_satang),
  CHECK ((state = 'CANCELLED') = (terminal_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS fleet_delivery.delivery_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  delivery_id uuid NOT NULL,
  from_state text,
  to_state text NOT NULL,
  from_version bigint,
  to_version bigint NOT NULL CHECK (to_version > 0),
  action text NOT NULL,
  actor_type text NOT NULL,
  actor_ref text NOT NULL,
  reason_code text NOT NULL,
  idempotency_key text NOT NULL,
  request_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (delivery_id, tenant_ref) REFERENCES fleet_delivery.deliveries(id, tenant_ref),
  UNIQUE (delivery_id, to_version),
  UNIQUE (tenant_ref, actor_ref, action, idempotency_key)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'CLEARING')),
  currency text NOT NULL CHECK (currency = 'THB'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_ref, code),
  UNIQUE (id, tenant_ref)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.ledger_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  delivery_id uuid NOT NULL,
  journal_type text NOT NULL CHECK (journal_type = 'DELIVERY_FEE_ALLOCATION_SHADOW'),
  source_event_ref text NOT NULL,
  currency text NOT NULL CHECK (currency = 'THB'),
  status text NOT NULL CHECK (status IN ('DRAFT', 'POSTED')),
  declared_debit_satang bigint NOT NULL CHECK (declared_debit_satang > 0),
  declared_credit_satang bigint NOT NULL CHECK (declared_credit_satang > 0),
  effective_at timestamptz NOT NULL,
  posted_at timestamptz,
  reversal_of_id uuid REFERENCES fleet_delivery.ledger_journals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (delivery_id, tenant_ref) REFERENCES fleet_delivery.deliveries(id, tenant_ref),
  CHECK (declared_debit_satang = declared_credit_satang),
  CHECK ((status = 'POSTED') = (posted_at IS NOT NULL)),
  UNIQUE (tenant_ref, journal_type, source_event_ref),
  UNIQUE (id, tenant_ref)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  journal_id uuid NOT NULL,
  account_id uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
  amount_satang bigint NOT NULL CHECK (amount_satang > 0),
  memo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (journal_id, tenant_ref) REFERENCES fleet_delivery.ledger_journals(id, tenant_ref),
  FOREIGN KEY (account_id, tenant_ref) REFERENCES fleet_delivery.ledger_accounts(id, tenant_ref)
);

CREATE OR REPLACE FUNCTION fleet_delivery.reject_append_only_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table % cannot be changed', TG_TABLE_NAME USING ERRCODE = '55000';
END
$$;

DROP TRIGGER IF EXISTS quote_components_append_only ON fleet_delivery.quote_components;
CREATE TRIGGER quote_components_append_only
  BEFORE UPDATE OR DELETE ON fleet_delivery.quote_components
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.reject_append_only_change();
DROP TRIGGER IF EXISTS delivery_transitions_append_only ON fleet_delivery.delivery_state_transitions;
CREATE TRIGGER delivery_transitions_append_only
  BEFORE UPDATE OR DELETE ON fleet_delivery.delivery_state_transitions
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.reject_append_only_change();

CREATE OR REPLACE FUNCTION fleet_delivery.protect_bound_quote()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'BOUND' THEN
    RAISE EXCEPTION 'bound quote is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> 'BOUND' OR NEW.bound_at IS NULL THEN
    RAISE EXCEPTION 'quote may only transition from issued to bound' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS delivery_quotes_protect_bound ON fleet_delivery.delivery_quotes;
CREATE TRIGGER delivery_quotes_protect_bound
  BEFORE UPDATE ON fleet_delivery.delivery_quotes
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.protect_bound_quote();

CREATE OR REPLACE FUNCTION fleet_delivery.protect_posted_ledger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'ledger_journals' THEN
    IF TG_OP = 'DELETE' OR OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'posted journal is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO parent_status FROM fleet_delivery.ledger_journals WHERE id = OLD.journal_id;
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'posted ledger entry is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS ledger_journals_immutable ON fleet_delivery.ledger_journals;
CREATE TRIGGER ledger_journals_immutable
  BEFORE UPDATE OR DELETE ON fleet_delivery.ledger_journals
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.protect_posted_ledger();
DROP TRIGGER IF EXISTS ledger_entries_immutable ON fleet_delivery.ledger_entries;
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON fleet_delivery.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.protect_posted_ledger();

CREATE OR REPLACE FUNCTION fleet_delivery.validate_posted_journal()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal_id_to_check uuid;
DECLARE journal_status text;
DECLARE declared_debit bigint;
DECLARE declared_credit bigint;
DECLARE actual_debit bigint;
DECLARE actual_credit bigint;
BEGIN
  journal_id_to_check := CASE WHEN TG_TABLE_NAME = 'ledger_journals' THEN COALESCE(NEW.id, OLD.id) ELSE COALESCE(NEW.journal_id, OLD.journal_id) END;
  SELECT status, declared_debit_satang, declared_credit_satang
    INTO journal_status, declared_debit, declared_credit
    FROM fleet_delivery.ledger_journals WHERE id = journal_id_to_check;
  IF journal_status = 'POSTED' THEN
    SELECT COALESCE(sum(amount_satang) FILTER (WHERE side = 'DEBIT'), 0),
           COALESCE(sum(amount_satang) FILTER (WHERE side = 'CREDIT'), 0)
      INTO actual_debit, actual_credit
      FROM fleet_delivery.ledger_entries WHERE journal_id = journal_id_to_check;
    IF actual_debit <> declared_debit OR actual_credit <> declared_credit OR actual_debit <> actual_credit THEN
      RAISE EXCEPTION 'posted journal % is not balanced', journal_id_to_check USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS ledger_entries_balance_check ON fleet_delivery.ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balance_check
  AFTER INSERT OR UPDATE OR DELETE ON fleet_delivery.ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fleet_delivery.validate_posted_journal();
DROP TRIGGER IF EXISTS ledger_journals_balance_check ON fleet_delivery.ledger_journals;
CREATE CONSTRAINT TRIGGER ledger_journals_balance_check
  AFTER INSERT OR UPDATE ON fleet_delivery.ledger_journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fleet_delivery.validate_posted_journal();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'merchant_configurations', 'service_areas', 'pricing_rules', 'order_context_snapshots',
    'delivery_quotes', 'quote_components', 'deliveries', 'delivery_state_transitions',
    'ledger_accounts', 'ledger_journals', 'ledger_entries'
  ] LOOP
    EXECUTE format('ALTER TABLE fleet_delivery.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE fleet_delivery.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON fleet_delivery.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON fleet_delivery.%I USING (tenant_ref = NULLIF(current_setting(''fleet_delivery.tenant_ref'', true), '''')) WITH CHECK (tenant_ref = NULLIF(current_setting(''fleet_delivery.tenant_ref'', true), ''''))',
      table_name
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE ON fleet_delivery.merchant_configurations TO fleet_delivery_app;
GRANT SELECT, INSERT ON fleet_delivery.service_areas TO fleet_delivery_app;
GRANT SELECT, INSERT ON fleet_delivery.pricing_rules TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.order_context_snapshots TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.delivery_quotes TO fleet_delivery_app;
GRANT SELECT, INSERT ON fleet_delivery.quote_components TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.deliveries TO fleet_delivery_app;
GRANT SELECT, INSERT ON fleet_delivery.delivery_state_transitions TO fleet_delivery_app;
GRANT SELECT, INSERT ON fleet_delivery.ledger_accounts TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.ledger_journals TO fleet_delivery_app;
GRANT SELECT, INSERT ON fleet_delivery.ledger_entries TO fleet_delivery_app;
