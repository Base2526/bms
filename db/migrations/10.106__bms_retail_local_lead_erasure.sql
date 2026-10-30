-- ROLLBACK (manual; erasures already performed cannot be undone and must stay erased):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.bms_erase_retail_local_lead(uuid);
-- -- Restore the 10.105 trigger body from 10.105__bms_retail_local_leads.sql.
-- -- Only if no row has erased_at set:
-- ALTER TABLE public.bms_retail_local_leads DROP CONSTRAINT IF EXISTS bms_retail_local_leads_erased_scrubbed_check;
-- ALTER TABLE public.bms_retail_local_leads DROP CONSTRAINT IF EXISTS bms_retail_local_leads_contact_check;
-- ALTER TABLE public.bms_retail_local_leads ADD CONSTRAINT bms_retail_local_leads_contact_check
--   CHECK (NULLIF(btrim(phone), '') IS NOT NULL OR NULLIF(btrim(line_id), '') IS NOT NULL);
-- ALTER TABLE public.bms_retail_local_leads DROP COLUMN IF EXISTS erased_by, DROP COLUMN IF EXISTS erased_at;
-- (restore bms_retail_local_lead_events action CHECK to 'LEAD_UPDATED' only if no LEAD_ERASED rows exist)
-- COMMIT;

-- =============================================================
-- 10.106  Retail Local lead erasure (PDPA right to erasure)
-- -------------------------------------------------------------
-- 10.105 made identity and contact fields immutable and copied the whole row,
-- contact details included, into the revision table on every status edit. With
-- no erase path, a person who asks BMS to delete their phone/LINE could only be
-- served by hand-editing the database, which the immutability trigger blocks.
--
-- This adds one erase operation, platform administrators only, that in a single
-- transaction:
--   * clears every free-text and contact field on the lead (shop, contact name,
--     phone, LINE ID, business type, admin note, follow-up date);
--   * replaces every earlier revision snapshot of that lead with a marker, since
--     those snapshots hold the same contact details;
--   * records who erased it and when, and appends a LEAD_ERASED event (events
--     carry status and actor only, never contact details).
-- Platform, locale, consent time/version and status stay: they are not personal
-- data and they show the contact was collected lawfully and later erased.
-- An erased lead can never be edited again.
-- =============================================================

BEGIN;

ALTER TABLE public.bms_retail_local_leads
  ADD COLUMN IF NOT EXISTS erased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS erased_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- A live lead still needs a phone or LINE ID; an erased one has neither.
ALTER TABLE public.bms_retail_local_leads DROP CONSTRAINT IF EXISTS bms_retail_local_leads_contact_check;
ALTER TABLE public.bms_retail_local_leads ADD CONSTRAINT bms_retail_local_leads_contact_check
  CHECK (erased_at IS NOT NULL OR NULLIF(btrim(phone), '') IS NOT NULL OR NULLIF(btrim(line_id), '') IS NOT NULL);

ALTER TABLE public.bms_retail_local_leads DROP CONSTRAINT IF EXISTS bms_retail_local_leads_erased_scrubbed_check;
ALTER TABLE public.bms_retail_local_leads ADD CONSTRAINT bms_retail_local_leads_erased_scrubbed_check
  CHECK (erased_at IS NULL OR (
    shop_name IS NULL AND contact_name IS NULL AND phone IS NULL AND line_id IS NULL
    AND business_type IS NULL AND note IS NULL AND follow_up_at IS NULL
  ));

-- Allow LEAD_ERASED alongside LEAD_UPDATED. The 10.105 CHECK was unnamed, so find
-- it by the single column it covers instead of guessing its generated name.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.bms_retail_local_lead_events'::regclass
      AND con.contype = 'c'
      AND array_length(con.conkey, 1) = 1
      AND att.attname = 'action'
  LOOP
    EXECUTE format('ALTER TABLE public.bms_retail_local_lead_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.bms_retail_local_lead_events ADD CONSTRAINT bms_retail_local_lead_events_action_check
  CHECK (action IN ('LEAD_UPDATED', 'LEAD_ERASED'));

-- Same rules as 10.105 for ordinary edits, plus: an erased lead is frozen, and the
-- one erasure transition may clear identity fields without copying them into a
-- new revision snapshot.
CREATE OR REPLACE FUNCTION public.bms_retail_local_lead_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_editor UUID := NULLIF(current_setting('app.editor_id', true), '')::uuid;
  v_revision UUID := NULLIF(current_setting('app.revision_id', true), '')::uuid;
BEGIN
  IF OLD.erased_at IS NOT NULL THEN
    RAISE EXCEPTION 'Retail Local lead % was erased and cannot be changed', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.erased_at IS NOT NULL THEN
    INSERT INTO public.bms_retail_local_leads_revisions
      (lead_id, editor_id, revision_id, snapshot)
    VALUES (OLD.id, v_editor, v_revision,
            jsonb_build_object('erased', true, 'status', OLD.status));
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF ROW(
    NEW.shop_name, NEW.contact_name, NEW.phone, NEW.line_id,
    NEW.business_type, NEW.platform, NEW.locale, NEW.consent_at,
    NEW.consent_text_version, NEW.source, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.shop_name, OLD.contact_name, OLD.phone, OLD.line_id,
    OLD.business_type, OLD.platform, OLD.locale, OLD.consent_at,
    OLD.consent_text_version, OLD.source, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Retail Local lead identity and consent fields are immutable';
  END IF;

  INSERT INTO public.bms_retail_local_leads_revisions
    (lead_id, editor_id, revision_id, snapshot)
  VALUES (OLD.id, v_editor, v_revision, to_jsonb(OLD));

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Returns FALSE when the lead does not exist or was already erased (idempotent
-- for the caller). Raises 42501 unless app.editor_id is a platform administrator.
CREATE OR REPLACE FUNCTION public.bms_erase_retail_local_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor UUID := NULLIF(current_setting('app.editor_id', true), '')::uuid;
  v_status VARCHAR(24);
BEGIN
  IF NOT public.bms_is_current_platform_admin() THEN
    RAISE EXCEPTION 'platform administrator required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT status INTO v_status
  FROM public.bms_retail_local_leads
  WHERE id = p_lead_id AND erased_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.bms_retail_local_leads
  SET erased_at = now(), erased_by = v_actor,
      shop_name = NULL, contact_name = NULL, phone = NULL, line_id = NULL,
      business_type = NULL, note = NULL, follow_up_at = NULL
  WHERE id = p_lead_id;

  -- Earlier snapshots hold the same contact details; keep the timeline, drop the data.
  UPDATE public.bms_retail_local_leads_revisions
  SET snapshot = jsonb_build_object('erased', true, 'status', snapshot->>'status')
  WHERE lead_id = p_lead_id
    AND NOT (snapshot ? 'erased');

  INSERT INTO public.bms_retail_local_lead_events
    (lead_id, actor_id, action, previous_status, next_status, note_changed, follow_up_changed)
  VALUES (p_lead_id, v_actor, 'LEAD_ERASED', v_status, v_status, TRUE, TRUE);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.bms_erase_retail_local_lead(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_erase_retail_local_lead(uuid) TO bms_app;

COMMENT ON FUNCTION public.bms_erase_retail_local_lead(uuid) IS
  'PDPA erasure for one Retail Local lead: clears contact fields and revision snapshots, records actor and event. Platform administrators only.';

COMMIT;
