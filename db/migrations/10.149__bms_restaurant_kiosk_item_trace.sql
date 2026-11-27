-- Immutable line identity for a kiosk proposal accepted into a restaurant check.
-- A later kitchen round replaces the order, and split/merge can move a check item.
-- Do not infer legacy identities from names, timestamps or the original order.
CREATE TABLE IF NOT EXISTS bms_restaurant_kiosk_submission_items (
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL,
  submission_id UUID NOT NULL,
  line_no INTEGER NOT NULL CHECK (line_no BETWEEN 1 AND 20),
  check_item_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, submission_id, line_no),
  UNIQUE (tenant_id, check_item_id),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, submission_id)
    REFERENCES bms_restaurant_kiosk_submissions(tenant_id, id),
  FOREIGN KEY (tenant_id, check_item_id)
    REFERENCES bms_restaurant_check_items(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_bms_restaurant_kiosk_submission_items_branch
  ON bms_restaurant_kiosk_submission_items (tenant_id, location_id, submission_id);

CREATE OR REPLACE FUNCTION public.bms_restaurant_kiosk_item_trace_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bms_restaurant_kiosk_submissions s
      JOIN bms_restaurant_check_items i ON i.tenant_id = s.tenant_id
        AND i.id = NEW.check_item_id AND i.check_id = s.check_id AND i.status = 'SENT'
      JOIN bms_restaurant_checks c ON c.tenant_id = i.tenant_id AND c.id = i.check_id
     WHERE s.tenant_id = NEW.tenant_id AND s.location_id = NEW.location_id
       AND s.id = NEW.submission_id AND s.status = 'ACCEPTED'
       AND c.location_id = NEW.location_id
       AND NEW.line_no <= jsonb_array_length(s.items)
  ) THEN
    RAISE EXCEPTION 'kiosk line must belong to the accepted branch check';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bms_restaurant_kiosk_item_trace_guard_trg
  ON bms_restaurant_kiosk_submission_items;
CREATE TRIGGER bms_restaurant_kiosk_item_trace_guard_trg
  BEFORE INSERT ON bms_restaurant_kiosk_submission_items
  FOR EACH ROW EXECUTE FUNCTION public.bms_restaurant_kiosk_item_trace_guard();

ALTER TABLE bms_restaurant_kiosk_submission_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_restaurant_kiosk_submission_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_restaurant_kiosk_submission_items_tenant
  ON bms_restaurant_kiosk_submission_items;
CREATE POLICY bms_restaurant_kiosk_submission_items_tenant
  ON bms_restaurant_kiosk_submission_items
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);
REVOKE ALL ON bms_restaurant_kiosk_submission_items FROM PUBLIC;
GRANT SELECT, INSERT ON bms_restaurant_kiosk_submission_items TO bms_app;
SELECT public.create_revision_trigger('bms_restaurant_kiosk_submission_items');
DROP POLICY IF EXISTS bms_restaurant_kiosk_submission_items_revisions_tenant_isolation
  ON bms_restaurant_kiosk_submission_items_revisions;
CREATE POLICY bms_restaurant_kiosk_submission_items_revisions_tenant_isolation
  ON bms_restaurant_kiosk_submission_items_revisions
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);
COMMENT ON TABLE bms_restaurant_kiosk_submission_items IS
  'Append-only kiosk proposal line to check-item identities; current check/order/payment are resolved on read after split or later rounds.';
-- Rollback: deploy old readers first, then revoke grants and drop this table and
-- its revision table only after exporting accepted-line evidence for retention.
