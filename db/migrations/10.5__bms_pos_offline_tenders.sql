-- 10.5 POS offline tender evidence
--
-- The sale remains authoritative only after normal POS settlement commits. These timestamps record
-- when cash was physically accepted while the register could not reach BMS, and when that pending
-- intent was later committed. They do not create a second payment or tax-document path.

ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS pos_offline_tendered_at timestamptz,
  ADD COLUMN IF NOT EXISTS pos_offline_synced_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'bms_orders_offline_tender_sync_chk'
       AND conrelid = 'bms_orders'::regclass
  ) THEN
    ALTER TABLE bms_orders
      ADD CONSTRAINT bms_orders_offline_tender_sync_chk
      CHECK (pos_offline_synced_at IS NULL OR pos_offline_tendered_at IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_orders_offline_tender_recent
  ON bms_orders (tenant_id, pos_offline_tendered_at DESC)
  WHERE pos_offline_tendered_at IS NOT NULL;

COMMENT ON COLUMN bms_orders.pos_offline_tendered_at IS
  'Client-captured time cash was accepted during an eligible offline retail sale; not an issue/commit timestamp.';
COMMENT ON COLUMN bms_orders.pos_offline_synced_at IS
  'Server time the offline tender was committed through the normal atomic POS settlement path.';
