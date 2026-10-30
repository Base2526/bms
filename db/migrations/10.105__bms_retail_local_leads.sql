-- ROLLBACK (manual; deletes lead history and must be approved before use):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.bms_submit_retail_local_lead(text,text,text,text,text,text,text,text);
-- DROP TABLE IF EXISTS public.bms_retail_local_lead_events;
-- DROP TABLE IF EXISTS public.bms_retail_local_leads_revisions;
-- DROP TABLE IF EXISTS public.bms_retail_local_leads;
-- DROP FUNCTION IF EXISTS public.bms_retail_local_lead_revision();
-- DROP FUNCTION IF EXISTS public.bms_is_current_platform_admin();
-- COMMIT;

-- =============================================================
-- 10.105  Retail Local consented download leads
-- -------------------------------------------------------------
-- Platform-global PII collected only after explicit consent. Public callers
-- can submit through one narrow SECURITY DEFINER function; direct reads and
-- updates require a database-verified platform administrator in app.editor_id.
-- These rows are sales follow-up records only and never gate a local runtime.
-- =============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bms_is_current_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = NULLIF(current_setting('app.editor_id', true), '')::uuid
      AND is_platform_admin = TRUE
  )
$$;

REVOKE ALL ON FUNCTION public.bms_is_current_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_is_current_platform_admin() TO bms_app;

CREATE TABLE IF NOT EXISTS public.bms_retail_local_leads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name            VARCHAR(120),
  contact_name         VARCHAR(120),
  phone                VARCHAR(10),
  line_id              VARCHAR(50),
  business_type        VARCHAR(80),
  platform             VARCHAR(16) NOT NULL
                         CHECK (platform IN ('windows', 'ubuntu', 'macos')),
  locale               VARCHAR(5) NOT NULL
                         CHECK (locale IN ('th', 'en')),
  consent_at           TIMESTAMPTZ NOT NULL,
  consent_text_version VARCHAR(40) NOT NULL,
  source               VARCHAR(32) NOT NULL DEFAULT 'download_page'
                         CHECK (source = 'download_page'),
  status               VARCHAR(24) NOT NULL DEFAULT 'NEW'
                         CHECK (status IN ('NEW', 'CONTACTED', 'TRIAL_ISSUED', 'PAID', 'NOT_INTERESTED')),
  follow_up_at         TIMESTAMPTZ,
  note                 VARCHAR(2000),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bms_retail_local_leads_contact_check
    CHECK (NULLIF(btrim(phone), '') IS NOT NULL OR NULLIF(btrim(line_id), '') IS NOT NULL),
  CHECK (phone IS NULL OR phone ~ '^0([689][0-9]{8}|[2-7][0-9]{7,8})$'),
  CHECK (line_id IS NULL OR line_id ~ '^[A-Za-z0-9._-]{2,50}$')
);

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_leads_queue
  ON public.bms_retail_local_leads (status, follow_up_at NULLS FIRST, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bms_retail_local_leads_revisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES public.bms_retail_local_leads(id) ON DELETE RESTRICT,
  editor_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  revision_id UUID,
  snapshot    JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_leads_revisions_timeline
  ON public.bms_retail_local_leads_revisions (lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bms_retail_local_lead_events (
  id               BIGSERIAL PRIMARY KEY,
  lead_id          UUID NOT NULL REFERENCES public.bms_retail_local_leads(id) ON DELETE RESTRICT,
  actor_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action           VARCHAR(32) NOT NULL CHECK (action = 'LEAD_UPDATED'),
  previous_status  VARCHAR(24) NOT NULL,
  next_status      VARCHAR(24) NOT NULL,
  note_changed     BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_changed BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_retail_local_lead_events_timeline
  ON public.bms_retail_local_lead_events (lead_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.bms_retail_local_lead_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_editor UUID := NULLIF(current_setting('app.editor_id', true), '')::uuid;
  v_revision UUID := NULLIF(current_setting('app.revision_id', true), '')::uuid;
BEGIN
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

DROP TRIGGER IF EXISTS bms_retail_local_leads_revision_trg ON public.bms_retail_local_leads;
CREATE TRIGGER bms_retail_local_leads_revision_trg
BEFORE UPDATE ON public.bms_retail_local_leads
FOR EACH ROW EXECUTE FUNCTION public.bms_retail_local_lead_revision();

ALTER TABLE public.bms_retail_local_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bms_retail_local_leads_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bms_retail_local_lead_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bms_retail_local_leads_platform_admin ON public.bms_retail_local_leads;
CREATE POLICY bms_retail_local_leads_platform_admin ON public.bms_retail_local_leads
  FOR ALL
  USING (public.bms_is_current_platform_admin())
  WITH CHECK (public.bms_is_current_platform_admin());

DROP POLICY IF EXISTS bms_retail_local_leads_revisions_platform_admin ON public.bms_retail_local_leads_revisions;
CREATE POLICY bms_retail_local_leads_revisions_platform_admin ON public.bms_retail_local_leads_revisions
  FOR ALL
  USING (public.bms_is_current_platform_admin())
  WITH CHECK (public.bms_is_current_platform_admin());

DROP POLICY IF EXISTS bms_retail_local_lead_events_platform_admin ON public.bms_retail_local_lead_events;
CREATE POLICY bms_retail_local_lead_events_platform_admin ON public.bms_retail_local_lead_events
  FOR ALL
  USING (public.bms_is_current_platform_admin())
  WITH CHECK (public.bms_is_current_platform_admin());

CREATE OR REPLACE FUNCTION public.bms_submit_retail_local_lead(
  p_shop_name text,
  p_contact_name text,
  p_phone text,
  p_line_id text,
  p_business_type text,
  p_platform text,
  p_locale text,
  p_consent_text_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.bms_retail_local_leads (
    shop_name, contact_name, phone, line_id, business_type, platform, locale,
    consent_at, consent_text_version, source
  ) VALUES (
    NULLIF(p_shop_name, ''), NULLIF(p_contact_name, ''), NULLIF(p_phone, ''),
    NULLIF(p_line_id, ''), NULLIF(p_business_type, ''), p_platform, p_locale,
    now(), p_consent_text_version, 'download_page'
  );
END;
$$;

REVOKE ALL ON public.bms_retail_local_leads,
  public.bms_retail_local_leads_revisions,
  public.bms_retail_local_lead_events FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bms_submit_retail_local_lead(text,text,text,text,text,text,text,text) FROM PUBLIC;

GRANT SELECT, UPDATE ON public.bms_retail_local_leads TO bms_app;
GRANT SELECT, INSERT ON public.bms_retail_local_leads_revisions,
  public.bms_retail_local_lead_events TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE public.bms_retail_local_lead_events_id_seq TO bms_app;
GRANT EXECUTE ON FUNCTION public.bms_submit_retail_local_lead(text,text,text,text,text,text,text,text) TO bms_app;

COMMENT ON TABLE public.bms_retail_local_leads IS
  'Consented Retail Local pilot sales leads. Platform-global PII; never a runtime entitlement input.';
COMMENT ON FUNCTION public.bms_submit_retail_local_lead(text,text,text,text,text,text,text,text) IS
  'Narrow public insert boundary. Returns no PII or row identifier.';

COMMIT;
