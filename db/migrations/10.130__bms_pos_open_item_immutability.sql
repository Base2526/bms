-- 10.130  Sale and return open-item evidence is append-only for the app role.
-- 10.129 granted UPDATE/DELETE by the generic table pattern. No POS workflow edits
-- these rows: corrections use a return/void row while the sale facts stay frozen.
-- ROLLBACK (manual, weakens auditability): GRANT UPDATE, DELETE on these two
-- tables to bms_app. Do not remove sale evidence during normal operation.

BEGIN;
REVOKE UPDATE, DELETE ON bms_order_open_items FROM bms_app;
REVOKE UPDATE, DELETE ON bms_pos_return_open_items FROM bms_app;
COMMIT;
