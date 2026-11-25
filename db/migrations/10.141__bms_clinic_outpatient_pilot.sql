-- 10.141: opt-in outpatient clinic pilot. No patient data is stored in CRM.
-- The application flag is empty by default; applying this migration does not enable the pilot.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_id_id_key') THEN
    ALTER TABLE users ADD CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bms_clinic_staff (
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  user_id uuid NOT NULL,
  access_role text NOT NULL CHECK (access_role IN ('REGISTRAR','NURSE','CLINICIAN','CASHIER')),
  active boolean NOT NULL DEFAULT true,
  licence_no text,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,user_id,access_role),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,granted_by) REFERENCES users(tenant_id,id),
  CHECK (access_role <> 'CLINICIAN' OR length(btrim(coalesce(licence_no,''))) BETWEEN 3 AND 80)
);

CREATE TABLE IF NOT EXISTS bms_clinic_hn_counters (
  tenant_id uuid PRIMARY KEY REFERENCES bms_tenants(id),
  next_no bigint NOT NULL CHECK (next_no > 0)
);

CREATE TABLE IF NOT EXISTS bms_clinic_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  hn text NOT NULL CHECK (hn ~ '^HN-[0-9]{6,}$'),
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 200),
  dob date,
  sex text NOT NULL DEFAULT 'UNKNOWN' CHECK (sex IN ('FEMALE','MALE','OTHER','UNKNOWN')),
  phone text CHECK (phone IS NULL OR length(phone) <= 40),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,hn),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_clinic_patients_name_idx ON bms_clinic_patients(tenant_id,lower(full_name));

CREATE TABLE IF NOT EXISTS bms_clinic_patient_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  patient_id uuid NOT NULL,
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 200),
  relationship text NOT NULL CHECK (relationship IN ('PARENT','GUARDIAN','OTHER')),
  phone text CHECK (phone IS NULL OR length(phone) <= 40),
  verified_by uuid NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,patient_id) REFERENCES bms_clinic_patients(tenant_id,id),
  FOREIGN KEY (tenant_id,verified_by) REFERENCES users(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS bms_clinic_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  location_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  practitioner_id uuid NOT NULL,
  room_code text NOT NULL CHECK (length(btrim(room_code)) BETWEEN 1 AND 40),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'CONFIRMED'
    CHECK (status IN ('CONFIRMED','CHECKED_IN','CANCELLED','NO_SHOW','COMPLETED')),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 160),
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,request_key),
  CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '12 hours'),
  FOREIGN KEY (tenant_id,location_id) REFERENCES bms_locations(tenant_id,id),
  FOREIGN KEY (tenant_id,patient_id) REFERENCES bms_clinic_patients(tenant_id,id),
  FOREIGN KEY (tenant_id,practitioner_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_clinic_practitioner_no_overlap') THEN
    ALTER TABLE bms_clinic_appointments ADD CONSTRAINT bms_clinic_practitioner_no_overlap
      EXCLUDE USING gist (tenant_id WITH =, practitioner_id WITH =,
        tstzrange(starts_at,ends_at,'[)') WITH &&)
      WHERE (status IN ('CONFIRMED','CHECKED_IN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_clinic_room_no_overlap') THEN
    ALTER TABLE bms_clinic_appointments ADD CONSTRAINT bms_clinic_room_no_overlap
      EXCLUDE USING gist (tenant_id WITH =, location_id WITH =, room_code WITH =,
        tstzrange(starts_at,ends_at,'[)') WITH &&)
      WHERE (status IN ('CONFIRMED','CHECKED_IN'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS bms_clinic_appointments_day_idx
  ON bms_clinic_appointments(tenant_id,location_id,starts_at,id);

CREATE TABLE IF NOT EXISTS bms_clinic_encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  patient_id uuid NOT NULL,
  location_id uuid NOT NULL,
  appointment_id uuid,
  practitioner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SIGNED')),
  draft_record jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(draft_record)='object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  signed_by uuid,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,appointment_id),
  CHECK ((status='SIGNED') = (signed_by IS NOT NULL AND signed_at IS NOT NULL)),
  FOREIGN KEY (tenant_id,patient_id) REFERENCES bms_clinic_patients(tenant_id,id),
  FOREIGN KEY (tenant_id,location_id) REFERENCES bms_locations(tenant_id,id),
  FOREIGN KEY (tenant_id,appointment_id) REFERENCES bms_clinic_appointments(tenant_id,id),
  FOREIGN KEY (tenant_id,practitioner_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,signed_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_clinic_encounters_patient_idx
  ON bms_clinic_encounters(tenant_id,patient_id,created_at DESC);

CREATE TABLE IF NOT EXISTS bms_clinic_break_glass (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  patient_id uuid NOT NULL,
  clinician_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,patient_id) REFERENCES bms_clinic_patients(tenant_id,id),
  FOREIGN KEY (tenant_id,clinician_id) REFERENCES users(tenant_id,id),
  CHECK (expires_at > granted_at AND expires_at <= granted_at + interval '15 minutes')
);
CREATE INDEX IF NOT EXISTS bms_clinic_break_glass_access_idx
  ON bms_clinic_break_glass(tenant_id,patient_id,clinician_id,expires_at DESC);

CREATE TABLE IF NOT EXISTS bms_clinic_care_team (
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  encounter_id uuid NOT NULL,
  user_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,encounter_id,user_id),
  FOREIGN KEY (tenant_id,encounter_id) REFERENCES bms_clinic_encounters(tenant_id,id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,assigned_by) REFERENCES users(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS bms_clinic_signed_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  encounter_id uuid NOT NULL,
  note_kind text NOT NULL CHECK (note_kind IN ('PRIMARY','ADDENDUM')),
  parent_note_id uuid,
  amendment_reason text,
  content jsonb NOT NULL CHECK (jsonb_typeof(content)='object'),
  signed_by uuid NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,encounter_id,id),
  FOREIGN KEY (tenant_id,encounter_id) REFERENCES bms_clinic_encounters(tenant_id,id),
  FOREIGN KEY (tenant_id,encounter_id,parent_note_id)
    REFERENCES bms_clinic_signed_notes(tenant_id,encounter_id,id),
  FOREIGN KEY (tenant_id,signed_by) REFERENCES users(tenant_id,id),
  CHECK ((note_kind='PRIMARY' AND parent_note_id IS NULL AND amendment_reason IS NULL)
      OR (note_kind='ADDENDUM' AND parent_note_id IS NOT NULL
          AND length(btrim(coalesce(amendment_reason,''))) BETWEEN 5 AND 500))
);
CREATE UNIQUE INDEX IF NOT EXISTS bms_clinic_one_primary_note
  ON bms_clinic_signed_notes(tenant_id,encounter_id) WHERE note_kind='PRIMARY';

CREATE OR REPLACE FUNCTION bms_clinic_refuse_signed_note_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'A signed clinical note is immutable' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS bms_clinic_signed_note_immutable ON bms_clinic_signed_notes;
CREATE TRIGGER bms_clinic_signed_note_immutable
  BEFORE UPDATE OR DELETE ON bms_clinic_signed_notes
  FOR EACH ROW EXECUTE FUNCTION bms_clinic_refuse_signed_note_change();

CREATE OR REPLACE FUNCTION bms_clinic_validate_note_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE encounter_status text; owner_id uuid;
BEGIN
  SELECT status,practitioner_id INTO encounter_status,owner_id
    FROM bms_clinic_encounters WHERE tenant_id=NEW.tenant_id AND id=NEW.encounter_id FOR UPDATE;
  IF owner_id IS DISTINCT FROM NEW.signed_by OR
     (NEW.note_kind='PRIMARY' AND encounter_status IS DISTINCT FROM 'OPEN') OR
     (NEW.note_kind='ADDENDUM' AND encounter_status IS DISTINCT FROM 'SIGNED') THEN
    RAISE EXCEPTION 'Invalid clinical note author or state' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bms_clinic_note_insert_guard ON bms_clinic_signed_notes;
CREATE TRIGGER bms_clinic_note_insert_guard
  BEFORE INSERT ON bms_clinic_signed_notes
  FOR EACH ROW EXECUTE FUNCTION bms_clinic_validate_note_insert();

CREATE OR REPLACE FUNCTION bms_clinic_guard_encounter_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='SIGNED' OR
     (NEW.status='SIGNED' AND (NEW.draft_record <> '{}'::jsonb OR NOT EXISTS (
       SELECT 1 FROM bms_clinic_signed_notes
        WHERE tenant_id=NEW.tenant_id AND encounter_id=NEW.id
          AND note_kind='PRIMARY' AND signed_by=NEW.signed_by
     ))) THEN
    RAISE EXCEPTION 'Signed clinical encounter is immutable or lacks a signed note' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bms_clinic_encounter_sign_guard ON bms_clinic_encounters;
CREATE TRIGGER bms_clinic_encounter_sign_guard
  BEFORE UPDATE ON bms_clinic_encounters
  FOR EACH ROW EXECUTE FUNCTION bms_clinic_guard_encounter_transition();

CREATE TABLE IF NOT EXISTS bms_clinic_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  encounter_id uuid NOT NULL,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 120),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/png','image/jpeg')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
  sha256 text NOT NULL CHECK (length(sha256)=64),
  content bytea NOT NULL,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,encounter_id) REFERENCES bms_clinic_encounters(tenant_id,id),
  FOREIGN KEY (tenant_id,uploaded_by) REFERENCES users(tenant_id,id),
  CHECK (octet_length(content)=byte_size)
);
CREATE INDEX IF NOT EXISTS bms_clinic_attachments_encounter_idx
  ON bms_clinic_attachments(tenant_id,encounter_id,uploaded_at,id);
DROP TRIGGER IF EXISTS bms_clinic_attachment_immutable ON bms_clinic_attachments;
CREATE TRIGGER bms_clinic_attachment_immutable
  BEFORE UPDATE OR DELETE ON bms_clinic_attachments
  FOR EACH ROW EXECUTE FUNCTION bms_clinic_refuse_signed_note_change();

CREATE TABLE IF NOT EXISTS bms_clinic_charge_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  encounter_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY','ORDER_CREATED')),
  order_id uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,encounter_id),
  UNIQUE (tenant_id,order_id),
  FOREIGN KEY (tenant_id,encounter_id) REFERENCES bms_clinic_encounters(tenant_id,id),
  FOREIGN KEY (tenant_id,order_id) REFERENCES bms_orders(tenant_id,id),
  FOREIGN KEY (tenant_id,reviewed_by) REFERENCES users(tenant_id,id),
  CHECK ((status='ORDER_CREATED') = (order_id IS NOT NULL)),
  CHECK ((reviewed_by IS NULL AND reviewed_at IS NULL) OR
         (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS bms_clinic_charge_lines (
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  sheet_id uuid NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_sku text NOT NULL,
  size text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  reviewed_unit_price numeric(12,2) NOT NULL CHECK (reviewed_unit_price >= 0),
  reviewed_vat_category text NOT NULL CHECK (reviewed_vat_category = 'N'),
  PRIMARY KEY (tenant_id,sheet_id,line_no),
  FOREIGN KEY (tenant_id,sheet_id) REFERENCES bms_clinic_charge_sheets(tenant_id,id),
  FOREIGN KEY (tenant_id,product_sku,size) REFERENCES bms_product_variants(tenant_id,product_sku,code)
);

CREATE OR REPLACE FUNCTION bms_clinic_guard_charge_sheet() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NOT ((OLD.status='DRAFT' AND NEW.status IN ('DRAFT','READY') AND NEW.order_id IS NULL)
     OR (OLD.status='READY' AND NEW.status='ORDER_CREATED' AND NEW.order_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Invalid clinic charge sheet transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bms_clinic_charge_sheet_guard ON bms_clinic_charge_sheets;
CREATE TRIGGER bms_clinic_charge_sheet_guard BEFORE UPDATE ON bms_clinic_charge_sheets
  FOR EACH ROW EXECUTE FUNCTION bms_clinic_guard_charge_sheet();

CREATE OR REPLACE FUNCTION bms_clinic_guard_charge_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE sheet_status text; target_tenant uuid; target_sheet uuid;
BEGIN
  IF TG_OP='DELETE' THEN target_tenant:=OLD.tenant_id; target_sheet:=OLD.sheet_id;
  ELSE target_tenant:=NEW.tenant_id; target_sheet:=NEW.sheet_id; END IF;
  SELECT status INTO sheet_status FROM bms_clinic_charge_sheets
    WHERE tenant_id=target_tenant AND id=target_sheet FOR UPDATE;
  IF sheet_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Reviewed clinic charge lines are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bms_clinic_charge_line_guard ON bms_clinic_charge_lines;
CREATE TRIGGER bms_clinic_charge_line_guard
  BEFORE INSERT OR UPDATE OR DELETE ON bms_clinic_charge_lines
  FOR EACH ROW EXECUTE FUNCTION bms_clinic_guard_charge_line();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_clinic_staff','bms_clinic_hn_counters','bms_clinic_patients',
    'bms_clinic_break_glass',
    'bms_clinic_patient_contacts','bms_clinic_appointments','bms_clinic_encounters',
    'bms_clinic_care_team','bms_clinic_attachments',
    'bms_clinic_signed_notes','bms_clinic_charge_sheets','bms_clinic_charge_lines'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS clinic_tenant ON %I',t);
    EXECUTE format('CREATE POLICY clinic_tenant ON %I USING (tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid)',t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO bms_app',t);
  END LOOP;
END $$;
GRANT UPDATE(active,licence_no,granted_by,granted_at) ON bms_clinic_staff TO bms_app;
GRANT UPDATE(next_no) ON bms_clinic_hn_counters TO bms_app;
GRANT UPDATE(full_name,dob,sex,phone,updated_at) ON bms_clinic_patients TO bms_app;
GRANT UPDATE(starts_at,ends_at,status,room_code,updated_at) ON bms_clinic_appointments TO bms_app;
GRANT UPDATE(status,draft_record,version,signed_by,signed_at,updated_at) ON bms_clinic_encounters TO bms_app;
GRANT UPDATE(active,assigned_by,assigned_at) ON bms_clinic_care_team TO bms_app;
GRANT UPDATE(status,order_id,reviewed_by,reviewed_at,updated_at) ON bms_clinic_charge_sheets TO bms_app;
GRANT UPDATE(product_sku,size,qty,reviewed_unit_price,reviewed_vat_category) ON bms_clinic_charge_lines TO bms_app;
GRANT DELETE ON bms_clinic_charge_lines TO bms_app;

-- Signed notes intentionally have no UPDATE/DELETE grant to the runtime role.
COMMENT ON TABLE bms_clinic_signed_notes IS 'Immutable signed outpatient records; later corrections are ADDENDUM rows.';
COMMIT;

-- ROLLBACK: deploy the previous app, revoke clinic grants and retain clinical tables
-- for a reviewed data migration. Never drop a table containing patient data casually.
