-- =============================================================
-- 9.42  Allow WASTAGE in the stock movement ledger
-- -------------------------------------------------------------
-- `9.40` shipped the wastage ledger and `movements.ts` gained the `WASTAGE`
-- movement type, but nothing extended `bms_stock_movements_type_check`. The
-- constraint still listed the eleven types from `7.98`, so every call to
-- `recordInventoryWastage()` rolled back at the movement insert:
--
--   new row for relation "bms_stock_movements" violates check constraint
--   "bms_stock_movements_type_check"
--
-- The stock UPDATE, the `bms_inventory_wastage` row and the audit row all live
-- in that same transaction, so nothing was half-written — the whole write-off
-- path was simply dead, and the failure surfaced at the counter as an opaque
-- constraint error. `9.40`'s own DB contract never exercised wastage, which is
-- why it passed.
--
-- Drop-and-recreate is the same shape `7.98` used to add the transfer types.
-- Keep this list in sync with `MovementType` in apps/web/lib/bms/movements.ts:
-- a type the code can emit but the constraint refuses is a write path that only
-- fails in production.
-- =============================================================

ALTER TABLE bms_stock_movements
  DROP CONSTRAINT IF EXISTS bms_stock_movements_type_check;

ALTER TABLE bms_stock_movements
  ADD CONSTRAINT bms_stock_movements_type_check CHECK (type IN (
    'STOCK_IN', 'STOCK_OUT', 'RESERVE', 'RELEASE', 'SHIP', 'RETURN',
    'TRANSFER_IN', 'TRANSFER_OUT', 'COUNT_ADJUST', 'QUARANTINE_IN',
    'TRANSFER_LOST', 'WASTAGE'
  ));
