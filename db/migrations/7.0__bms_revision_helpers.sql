-- =============================================================
-- 7.0  BMS revision helpers
-- -------------------------------------------------------------
-- Generic helper for append-only revision snapshots.
-- Stores the previous row state on UPDATE using the current
-- session's app.editor_id and app.revision_id values.
-- =============================================================

CREATE OR REPLACE FUNCTION public.trg_generic_revision() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_editor uuid;
  v_revision uuid;
  v_rev_table text := TG_TABLE_NAME || '_revisions';
  v_exists bool;
BEGIN
  BEGIN
    v_editor := NULLIF(current_setting('app.editor_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_editor := NULL;
  END;

  BEGIN
    v_revision := NULLIF(current_setting('app.revision_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_revision := NULL;
  END;

  SELECT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = v_rev_table
  ) INTO v_exists;

  IF NOT v_exists THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    EXECUTE
      'INSERT INTO ' || quote_ident(v_rev_table) ||
      ' (id, tenant_id, editor_id, revision_id, snapshot, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now())'
    USING OLD.tenant_id, v_editor, v_revision, to_jsonb(OLD);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_revision_trigger(p_table text) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rev_table text := p_table || '_revisions';
  trg_name text := p_table || '_rev_trg';
BEGIN
  EXECUTE
    'CREATE TABLE IF NOT EXISTS ' || quote_ident(rev_table) || ' (' ||
    'id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ' ||
    'tenant_id uuid NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE, ' ||
    'editor_id uuid, ' ||
    'revision_id uuid, ' ||
    'snapshot jsonb NOT NULL, ' ||
    'created_at timestamptz NOT NULL DEFAULT now()' ||
    ')';

  EXECUTE 'ALTER TABLE ' || quote_ident(rev_table) || ' ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE ' || quote_ident(rev_table) || ' FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(rev_table || '_tenant_isolation') || ' ON ' || quote_ident(rev_table);
  EXECUTE
    'CREATE POLICY ' || quote_ident(rev_table || '_tenant_isolation') ||
    ' ON ' || quote_ident(rev_table) ||
    ' USING (tenant_id = COALESCE(NULLIF(current_setting(''bms.tenant_id'', true), '''')::uuid, tenant_id))' ||
    ' WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting(''bms.tenant_id'', true), '''')::uuid, tenant_id))';

  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ' || quote_ident(rev_table) || ' TO bms_app';

  EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(trg_name) || ' ON ' || quote_ident(p_table);
  EXECUTE
    'CREATE TRIGGER ' || quote_ident(trg_name) ||
    ' BEFORE UPDATE ON ' || quote_ident(p_table) ||
    ' FOR EACH ROW EXECUTE FUNCTION trg_generic_revision()';
END;
$$;
