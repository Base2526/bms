-- =============================================================
-- 9.6 — POS keyboard-wedge scan manager + retry-safe PO receiving
-- -------------------------------------------------------------
-- A Bluetooth HID scanner is a keyboard.  Prefix mode gives the browser a
-- positive signal before it captures keys globally; FOCUS preserves the
-- existing focus-owned input for devices that have not been programmed yet.
--
-- POS purchase receipts keep a stable device key in the same transaction as
-- inventory + PO changes so a lost HTTP response cannot receive the same box
-- twice.
-- =============================================================

ALTER TABLE bms_pos_devices
  ADD COLUMN IF NOT EXISTS scanner_mode TEXT NOT NULL DEFAULT 'FOCUS',
  ADD COLUMN IF NOT EXISTS scanner_prefix_key TEXT NOT NULL DEFAULT 'F9',
  ADD COLUMN IF NOT EXISTS scanner_suffix_key TEXT NOT NULL DEFAULT 'Enter',
  ADD COLUMN IF NOT EXISTS scanner_max_gap_ms INTEGER NOT NULL DEFAULT 80;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_pos_devices_scanner_mode_check'
       AND conrelid = 'bms_pos_devices'::regclass
  ) THEN
    ALTER TABLE bms_pos_devices
      ADD CONSTRAINT bms_pos_devices_scanner_mode_check
      CHECK (scanner_mode IN ('FOCUS', 'PREFIX'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_pos_devices_scanner_keys_check'
       AND conrelid = 'bms_pos_devices'::regclass
  ) THEN
    ALTER TABLE bms_pos_devices
      ADD CONSTRAINT bms_pos_devices_scanner_keys_check
      CHECK (
        scanner_prefix_key ~ '^F([1-9]|1[0-9]|2[0-4])$'
        AND scanner_suffix_key IN ('Enter', 'Tab')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_pos_devices_scanner_gap_check'
       AND conrelid = 'bms_pos_devices'::regclass
  ) THEN
    ALTER TABLE bms_pos_devices
      ADD CONSTRAINT bms_pos_devices_scanner_gap_check
      CHECK (scanner_max_gap_ms BETWEEN 20 AND 1000);
  END IF;
END $$;

COMMENT ON COLUMN bms_pos_devices.scanner_mode IS
  'FOCUS keeps legacy input ownership; PREFIX globally captures only after scanner_prefix_key';
COMMENT ON COLUMN bms_pos_devices.scanner_prefix_key IS
  'Positive keyboard-wedge prefix configured on the physical scanner, e.g. F9';
COMMENT ON COLUMN bms_pos_devices.scanner_suffix_key IS
  'Keyboard-wedge terminator, normally Enter';
COMMENT ON COLUMN bms_pos_devices.scanner_max_gap_ms IS
  'Maximum inter-key delay after the positive prefix before capture is abandoned';

CREATE TABLE IF NOT EXISTS bms_pos_purchase_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  -- Receipt/idempotency history must survive device retirement or deletion.
  device_id         UUID NOT NULL REFERENCES bms_pos_devices(id),
  location_id       UUID NOT NULL REFERENCES bms_locations(id),
  po_id             UUID NOT NULL REFERENCES bms_purchase_orders(id),
  actor_user_id     UUID NOT NULL REFERENCES users(id),
  idempotency_key   TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  result            JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_bms_pos_purchase_receipts_po
  ON bms_pos_purchase_receipts (tenant_id, po_id, created_at DESC);

COMMENT ON TABLE bms_pos_purchase_receipts IS
  'Retry ledger for PO receipts submitted by a POS device; inventory mutation remains in purchase service';
COMMENT ON COLUMN bms_pos_purchase_receipts.request_hash IS
  'Hash of normalized PO/location/line input; one key cannot be reused for a different receipt';

ALTER TABLE bms_pos_purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pos_purchase_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pos_purchase_receipts_tenant_isolation ON bms_pos_purchase_receipts;
CREATE POLICY bms_pos_purchase_receipts_tenant_isolation ON bms_pos_purchase_receipts
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pos_purchase_receipts TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
