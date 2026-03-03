-- ============================================================================
-- SAFE ADDITIVE MIGRATION: sync production schema to match local schema dump
--
-- Local dump:  ../compare/local_schema_20260302_195556.sql
-- Server dump: ../compare/server_schema_20260302_125149.sql
-- GeneratedAt: 2026-03-02T15:33:15.787806+00:00
--
-- Safety: no DROP/TRUNCATE/DELETE; only additive DDL + safe backfills.
-- Idempotent: guarded with IF NOT EXISTS / catalog checks.
-- ============================================================================

BEGIN;

-- 1) Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

-- 2) Types / enums
-- (none detected in dumps)

-- 3) Tables (create missing)
CREATE TABLE IF NOT EXISTS public.scam_bank_account (
    account_norm character varying(32) NOT NULL,
    bank_name text,
    report_count integer DEFAULT 0 NOT NULL,
    last_report_at timestamp with time zone,
    risk_level integer DEFAULT 0 NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    post_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    ctx jsonb
);

CREATE TABLE IF NOT EXISTS public.scam_bank_account_report (
    id bigint NOT NULL,
    account_norm character varying(32) NOT NULL,
    bank_name text,
    category text NOT NULL,
    note text,
    user_id uuid,
    client_id text,
    device_model text,
    os_version text,
    app_version text,
    local_blocked boolean DEFAULT false NOT NULL,
    post_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.scam_bank_account_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bank_name text NOT NULL,
    account_no text NOT NULL,
    account_norm text NOT NULL,
    note text,
    client_id text NOT NULL,
    device_model text,
    os_version text,
    app_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

CREATE TABLE IF NOT EXISTS public.scam_bank_accounts_summary (
    bank_name text NOT NULL,
    account_no text NOT NULL,
    account_norm text NOT NULL,
    report_count integer DEFAULT 0 NOT NULL,
    last_report_at timestamp with time zone,
    risk_level integer DEFAULT 10 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.scam_phone_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    phone text NOT NULL,
    phone_normalized text NOT NULL,
    category text,
    note text,
    client_id uuid,
    device_model text,
    os_version text,
    app_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    local_blocked boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS public.scam_phone_unblocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    phone text NOT NULL,
    client_id uuid NOT NULL,
    device_model text,
    os_version text,
    app_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_blocked_phones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    phone text NOT NULL,
    phone_normalized text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 3.1) Sequences / defaults for new tables
-- local schema uses a bigserial-like id for scam_bank_account_report
CREATE SEQUENCE IF NOT EXISTS public.scam_bank_account_report_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

DO $$
BEGIN
  IF to_regclass('public.scam_bank_account_report') IS NOT NULL
     AND to_regclass('public.scam_bank_account_report_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.scam_bank_account_report_id_seq
      OWNED BY public.scam_bank_account_report.id;

    ALTER TABLE ONLY public.scam_bank_account_report
      ALTER COLUMN id SET DEFAULT nextval('public.scam_bank_account_report_id_seq'::regclass);

    -- If the table already has rows, advance the sequence to avoid duplicates.
    IF EXISTS (SELECT 1 FROM public.scam_bank_account_report) THEN
      PERFORM setval(
        'public.scam_bank_account_report_id_seq'::regclass,
        (SELECT max(id) FROM public.scam_bank_account_report),
        true
      );
    ELSE
      PERFORM setval('public.scam_bank_account_report_id_seq'::regclass, 1, false);
    END IF;
  END IF;
END $$;

-- 4) Columns (add missing)
-- chats.updated_at exists locally; add + backfill safely
ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone;
ALTER TABLE public.chats ALTER COLUMN updated_at SET DEFAULT now();
UPDATE public.chats SET updated_at = COALESCE(updated_at, now()) WHERE updated_at IS NULL;
ALTER TABLE public.chats ALTER COLUMN updated_at SET NOT NULL;

-- 5) Indexes (create missing)
CREATE INDEX IF NOT EXISTS idx_bank_report_account_time ON public.scam_bank_account_report USING btree (account_norm, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_report_created_at ON public.scam_bank_account_report USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_report_user ON public.scam_bank_account_report USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_sbar_user_created ON public.scam_bank_account_reports USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scam_bank_account_prefix ON public.scam_bank_account USING btree (account_norm varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_scam_bank_account_report_count ON public.scam_bank_account USING btree (report_count DESC);
CREATE INDEX IF NOT EXISTS idx_scam_bank_account_updated_at ON public.scam_bank_account USING btree (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scam_phone_reports_created ON public.scam_phone_reports USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_scam_phone_reports_norm ON public.scam_phone_reports USING btree (phone_normalized);
CREATE INDEX IF NOT EXISTS idx_scam_phone_unblocks_phone ON public.scam_phone_unblocks USING btree (phone);
CREATE INDEX IF NOT EXISTS idx_scam_phone_unblocks_user ON public.scam_phone_unblocks USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_scam_phones_summary_updated ON public.scam_phones_summary USING btree (updated_at);
CREATE INDEX IF NOT EXISTS idx_user_blocked_phones_norm ON public.user_blocked_phones USING btree (phone_normalized);
CREATE INDEX IF NOT EXISTS idx_user_blocked_phones_user ON public.user_blocked_phones USING btree (user_id);
CREATE INDEX IF NOT EXISTS scam_bank_account_reports_bank_idx ON public.scam_bank_account_reports USING btree (bank_name);
CREATE UNIQUE INDEX IF NOT EXISTS scam_bank_account_reports_client_id_ux ON public.scam_bank_account_reports USING btree (client_id);
CREATE INDEX IF NOT EXISTS scam_bank_account_reports_norm_idx ON public.scam_bank_account_reports USING btree (account_norm);
CREATE INDEX IF NOT EXISTS scam_bank_accounts_summary_norm_idx ON public.scam_bank_accounts_summary USING btree (account_norm);
CREATE INDEX IF NOT EXISTS scam_bank_accounts_summary_updated_idx ON public.scam_bank_accounts_summary USING btree (updated_at);

-- 6) Constraints / FKs (add missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'chats_direct_key_chk'
  ) THEN
    ALTER TABLE public.chats
    ADD CONSTRAINT chats_direct_key_chk CHECK (((is_group = true) OR (direct_key IS NOT NULL))) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'scam_bank_account_pkey'
  ) THEN
    ALTER TABLE ONLY public.scam_bank_account
    ADD CONSTRAINT scam_bank_account_pkey PRIMARY KEY (account_norm);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'scam_bank_account_report_account_norm_fkey'
  ) THEN
    ALTER TABLE ONLY public.scam_bank_account_report
    ADD CONSTRAINT scam_bank_account_report_account_norm_fkey FOREIGN KEY (account_norm) REFERENCES public.scam_bank_account(account_norm) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'scam_bank_account_report_pkey'
  ) THEN
    ALTER TABLE ONLY public.scam_bank_account_report
    ADD CONSTRAINT scam_bank_account_report_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'scam_bank_account_reports_client_bank_ux'
  ) THEN
    ALTER TABLE ONLY public.scam_bank_account_reports
    ADD CONSTRAINT scam_bank_account_reports_client_bank_ux UNIQUE (client_id, bank_name, account_norm);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'scam_bank_account_reports_pkey'
  ) THEN
    ALTER TABLE ONLY public.scam_bank_account_reports
    ADD CONSTRAINT scam_bank_account_reports_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'scam_bank_accounts_summary_pkey'
  ) THEN
    ALTER TABLE ONLY public.scam_bank_accounts_summary
    ADD CONSTRAINT scam_bank_accounts_summary_pkey PRIMARY KEY (bank_name, account_norm);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'scam_phone_reports_pkey'
  ) THEN
    ALTER TABLE ONLY public.scam_phone_reports
    ADD CONSTRAINT scam_phone_reports_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'scam_phone_reports_user_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.scam_phone_reports
    ADD CONSTRAINT scam_phone_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'scam_phone_unblocks_pkey'
  ) THEN
    ALTER TABLE ONLY public.scam_phone_unblocks
    ADD CONSTRAINT scam_phone_unblocks_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'user_blocked_phones_pkey'
  ) THEN
    ALTER TABLE ONLY public.user_blocked_phones
    ADD CONSTRAINT user_blocked_phones_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'user_blocked_phones_user_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.user_blocked_phones
    ADD CONSTRAINT user_blocked_phones_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
      AND c.conname = 'user_blocked_phones_user_id_phone_normalized_key'
  ) THEN
    ALTER TABLE ONLY public.user_blocked_phones
    ADD CONSTRAINT user_blocked_phones_user_id_phone_normalized_key UNIQUE (user_id, phone_normalized);
  END IF;
END $$;

-- 7) Views
CREATE OR REPLACE VIEW public.chat_last_read AS
 SELECT r.user_id,
    m.chat_id,
    max(r.read_at) AS last_read_at
   FROM (public.message_receipts r
     JOIN public.messages m ON ((m.id = r.message_id)))
  GROUP BY r.user_id, m.chat_id;

CREATE OR REPLACE VIEW public.chat_unread_counts AS
 SELECT cm.user_id,
    m.chat_id,
    count(*) AS unread_count
   FROM ((public.messages m
     JOIN public.chat_members cm ON ((cm.chat_id = m.chat_id)))
     LEFT JOIN public.message_receipts r ON (((r.message_id = m.id) AND (r.user_id = cm.user_id))))
  WHERE ((cm.user_id <> m.sender_id) AND (r.read_at IS NULL))
  GROUP BY cm.user_id, m.chat_id;

-- 8) Functions
CREATE OR REPLACE FUNCTION public.calc_phone_risk(blocked_cnt integer, report_cnt integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  score int;
BEGIN
  score := (blocked_cnt * 4) + (report_cnt * 6);
  IF score > 100 THEN score := 100; END IF;
  IF score < 0 THEN score := 0; END IF;
  RETURN score;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_revision_trigger(p_table text) RETURNS void
    LANGUAGE plpgsql
    AS $_$

DECLARE

  rev_table text := p_table || '_revisions';

  trg_name text := p_table || '_rev_trg';

BEGIN

  -- 2.1 สร้าง revision table ถ้ายังไม่มี

  EXECUTE format($fmt$

    CREATE TABLE IF NOT EXISTS %I (

      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

      %I_id uuid REFERENCES %I(id) ON DELETE CASCADE,

      editor_id uuid,

      snapshot jsonb NOT NULL,

      created_at timestamptz DEFAULT now()

    )$fmt$, rev_table, p_table, p_table);



  -- 2.2 ลบ trigger เก่า (ถ้ามี) แล้วสร้างใหม่

  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trg_name, p_table);

  EXECUTE format($fmt$

    CREATE TRIGGER %I

    BEFORE UPDATE ON %I

    FOR EACH ROW

    EXECUTE FUNCTION trg_generic_revision()

  $fmt$, trg_name, p_table);



  RAISE NOTICE '✅ Trigger created for table %', p_table;

END;

$_$;

CREATE OR REPLACE FUNCTION public.recalc_scam_phone_from_posts(p_phone text) RETURNS void
    LANGUAGE plpgsql
    AS $$

DECLARE

  agg_phone text;

  agg_count int;

  agg_last  timestamptz;

  agg_posts uuid[];

  agg_risk  int;

BEGIN

  -- รวมข้อมูลจาก post_tel_numbers ของเบอร์นี้

  SELECT

    tel AS phone,

    COUNT(*)::int AS report_count,

    MAX(created_at) AS last_report_at,

    ARRAY_AGG(DISTINCT post_id)::uuid[] AS post_ids

  INTO

    agg_phone, agg_count, agg_last, agg_posts

  FROM post_tel_numbers

  WHERE tel = p_phone

  GROUP BY tel;



  -- ถ้าไม่มี row ใน post_tel_numbers แล้ว

  IF agg_phone IS NULL THEN

    -- mark ว่า deleted (ยังเก็บ row ไว้เพื่อให้ client sync ลบ)

    UPDATE scam_phones_summary

    SET

      report_count   = 0,

      last_report_at = NULL,

      post_ids       = '{}',

      risk_level     = 0,

      is_deleted     = true,

      updated_at     = now()

    WHERE phone = p_phone;



    -- ถ้าอยากลบ row ทิ้งจริง ๆ ก็ใช้ DELETE แทน UPDATE ด้านบน

    RETURN;

  END IF;



  -- คำนวณ risk จาก count (จะใช้สูตรอะไรก็ได้)

  IF agg_count >= 20 THEN

    agg_risk := 90;

  ELSIF agg_count >= 10 THEN

    agg_risk := 60;

  ELSIF agg_count >= 5 THEN

    agg_risk := 40;

  ELSE

    agg_risk := 10;

  END IF;



  -- upsert summary row

  INSERT INTO scam_phones_summary

    (phone, report_count, last_report_at, post_ids, risk_level, is_deleted, updated_at)

  VALUES

    (agg_phone, agg_count, agg_last, agg_posts, agg_risk, false, now())

  ON CONFLICT (phone) DO UPDATE

  SET

    report_count   = EXCLUDED.report_count,

    last_report_at = EXCLUDED.last_report_at,

    post_ids       = EXCLUDED.post_ids,

    risk_level     = EXCLUDED.risk_level,

    is_deleted     = false,

    updated_at     = now();

END;

$$;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_agg_scam_bank_account() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  new_count int;
BEGIN
  INSERT INTO scam_bank_accounts_summary (
    bank_name, account_no, account_norm,
    report_count, last_report_at, risk_level, updated_at
  )
  VALUES (
    NEW.bank_name, NEW.account_no, NEW.account_norm,
    1, NEW.created_at, 10, NEW.created_at
  )
  ON CONFLICT (bank_name, account_norm)
  DO UPDATE SET
    report_count   = scam_bank_accounts_summary.report_count + 1,
    last_report_at = GREATEST(scam_bank_accounts_summary.last_report_at, NEW.created_at),
    updated_at     = GREATEST(scam_bank_accounts_summary.updated_at, NEW.created_at),
    -- risk_level จะให้คุณคุมที่ app ก็ได้ แต่ใส่ logic เบื้องต้นไว้ก่อน
    risk_level     = GREATEST(
      scam_bank_accounts_summary.risk_level,
      CASE
        WHEN (scam_bank_accounts_summary.report_count + 1) >= 20 THEN 90
        WHEN (scam_bank_accounts_summary.report_count + 1) >= 10 THEN 60
        WHEN (scam_bank_accounts_summary.report_count + 1) >= 5  THEN 40
        ELSE 10
      END
    );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_generic_revision() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$

DECLARE

  v_editor uuid;

  v_rev_table text := TG_TABLE_NAME || '_revisions';

  v_exists bool;

BEGIN

  -- หา editor_id จาก session variable (GUC)

  BEGIN

    v_editor := NULLIF(current_setting('app.editor_id', true), '')::uuid;

  EXCEPTION WHEN others THEN

    v_editor := NULL;

  END;



  -- ตรวจว่าตาราง revision มีจริงไหม

  SELECT EXISTS (

    SELECT 1 FROM information_schema.tables

     WHERE table_name = v_rev_table

  ) INTO v_exists;



  IF NOT v_exists THEN

    RAISE NOTICE 'Revision table % does not exist, skip insert', v_rev_table;

    RETURN NEW;

  END IF;



  -- บันทึก snapshot เก่า (ใช้ BEFORE UPDATE เพื่อเก็บค่า OLD)

  IF TG_OP = 'UPDATE' THEN

    EXECUTE format(

      'INSERT INTO %I (id, %I_id, editor_id, snapshot, created_at)

       VALUES (uuid_generate_v4(), $1, $2, row_to_json($3), now())',

      v_rev_table, TG_TABLE_NAME

    )

    USING OLD.id, v_editor, OLD;

  END IF;



  RETURN NEW;

END;

$_$;

CREATE OR REPLACE FUNCTION public.trg_messages_after_insert__create_receipts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  INSERT INTO message_receipts (message_id, user_id)

  SELECT NEW.id, cm.user_id

  FROM chat_members cm

  WHERE cm.chat_id = NEW.chat_id

    AND cm.user_id <> NEW.sender_id;

  RETURN NEW;

END;

$$;

CREATE OR REPLACE FUNCTION public.trg_post_seller_accounts_unaccent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  NEW.account_unaccent := unaccent(coalesce(NEW.seller_account, ''));

  NEW.bank_unaccent    := unaccent(coalesce(NEW.bank_name,      ''));

  RETURN NEW;

END;

$$;

CREATE OR REPLACE FUNCTION public.trg_post_tel_numbers_scam_summary() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  IF TG_OP = 'INSERT' THEN

    PERFORM recalc_scam_phone_from_posts(NEW.tel);



  ELSIF TG_OP = 'UPDATE' THEN

    -- ถ้าเบอร์โดนเปลี่ยน: ต้อง recalc ทั้งเบอร์เก่า + เบอร์ใหม่

    IF NEW.tel IS DISTINCT FROM OLD.tel THEN

      PERFORM recalc_scam_phone_from_posts(OLD.tel);

      PERFORM recalc_scam_phone_from_posts(NEW.tel);

    ELSE

      PERFORM recalc_scam_phone_from_posts(NEW.tel);

    END IF;



  ELSIF TG_OP = 'DELETE' THEN

    PERFORM recalc_scam_phone_from_posts(OLD.tel);

  END IF;



  RETURN NULL;

END;

$$;

CREATE OR REPLACE FUNCTION public.trg_posts_unaccent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  NEW.title_unaccent  := unaccent(coalesce(NEW.title,  ''));

  NEW.detail_unaccent := unaccent(coalesce(NEW.detail, ''));

  RETURN NEW;

END;

$$;

CREATE OR REPLACE FUNCTION public.trg_users_unaccent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  NEW.name_unaccent  := unaccent(coalesce(NEW.name,  ''));

  NEW.email_unaccent := unaccent(coalesce(NEW.email, ''));

  RETURN NEW;

END;

$$;

CREATE OR REPLACE FUNCTION public.upsert_bank_account_aggregate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  new_count integer;
  last_at timestamptz;
  risk integer;
begin
  -- ensure master exists
  insert into scam_bank_account(account_norm, bank_name)
  values (new.account_norm, new.bank_name)
  on conflict (account_norm) do update
    set bank_name = coalesce(excluded.bank_name, scam_bank_account.bank_name);

  select count(*), max(created_at)
    into new_count, last_at
  from scam_bank_account_report
  where account_norm = new.account_norm;

  -- simple risk model: clamp(report_count * 10)
  risk := greatest(0, least(100, new_count * 10));

  update scam_bank_account
  set report_count = new_count,
      last_report_at = last_at,
      risk_level = risk,
      updated_at = now()
  where account_norm = new.account_norm;

  return new;
end $$;

-- 9) Triggers (create missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class r ON r.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'scam_bank_account_reports'
      AND t.tgname = 'scam_bank_account_reports_agg_tg'
      AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER scam_bank_account_reports_agg_tg AFTER INSERT ON public.scam_bank_account_reports FOR EACH ROW EXECUTE FUNCTION public.trg_agg_scam_bank_account();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class r ON r.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'scam_bank_account_report'
      AND t.tgname = 'trg_bank_report_agg'
      AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER trg_bank_report_agg AFTER INSERT ON public.scam_bank_account_report FOR EACH ROW EXECUTE FUNCTION public.upsert_bank_account_aggregate();
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verification (read-only)
-- ============================================================================

-- Verify new tables exist
WITH expected(table_name) AS (
  VALUES
  ('scam_bank_account'),
  ('scam_bank_account_report'),
  ('scam_bank_account_reports'),
  ('scam_bank_accounts_summary'),
  ('scam_phone_reports'),
  ('scam_phone_unblocks'),
  ('user_blocked_phones')
)
SELECT e.table_name
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = e.table_name
WHERE t.table_name IS NULL;

-- Verify columns exist
WITH expected(table_name, column_name) AS (
  VALUES
  ('chats','updated_at')
)
SELECT e.table_name, e.column_name
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema='public' AND c.table_name=e.table_name AND c.column_name=e.column_name
WHERE c.column_name IS NULL;

-- Verify indexes exist
WITH expected(index_name) AS (
  VALUES
  ('idx_bank_report_account_time'),
  ('idx_bank_report_created_at'),
  ('idx_bank_report_user'),
  ('idx_sbar_user_created'),
  ('idx_scam_bank_account_prefix'),
  ('idx_scam_bank_account_report_count'),
  ('idx_scam_bank_account_updated_at'),
  ('idx_scam_phone_reports_created'),
  ('idx_scam_phone_reports_norm'),
  ('idx_scam_phone_unblocks_phone'),
  ('idx_scam_phone_unblocks_user'),
  ('idx_scam_phones_summary_updated'),
  ('idx_user_blocked_phones_norm'),
  ('idx_user_blocked_phones_user'),
  ('scam_bank_account_reports_bank_idx'),
  ('scam_bank_account_reports_client_id_ux'),
  ('scam_bank_account_reports_norm_idx'),
  ('scam_bank_accounts_summary_norm_idx'),
  ('scam_bank_accounts_summary_updated_idx')
)
SELECT e.index_name
FROM expected e
LEFT JOIN pg_class c ON c.relname = e.index_name
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.oid IS NULL OR n.nspname <> 'public';

-- Verify constraints exist (by name)
WITH expected(conname) AS (
  VALUES
  ('chats_direct_key_chk'),
  ('scam_bank_account_pkey'),
  ('scam_bank_account_report_account_norm_fkey'),
  ('scam_bank_account_report_pkey'),
  ('scam_bank_account_reports_client_bank_ux'),
  ('scam_bank_account_reports_pkey'),
  ('scam_bank_accounts_summary_pkey'),
  ('scam_phone_reports_pkey'),
  ('scam_phone_reports_user_id_fkey'),
  ('scam_phone_unblocks_pkey'),
  ('user_blocked_phones_pkey'),
  ('user_blocked_phones_user_id_fkey'),
  ('user_blocked_phones_user_id_phone_normalized_key')
)
SELECT e.conname
FROM expected e
LEFT JOIN pg_constraint c ON c.conname = e.conname
LEFT JOIN pg_namespace n ON n.oid = c.connamespace
WHERE c.oid IS NULL OR n.nspname <> 'public';

-- Verify triggers exist
WITH expected(tgname) AS (
  VALUES
  ('scam_bank_account_reports_agg_tg'),
  ('trg_bank_report_agg')
)
SELECT e.tgname
FROM expected e
LEFT JOIN pg_trigger t ON t.tgname = e.tgname
WHERE t.oid IS NULL;

-- ============================================================================
-- Skipped / manual notes
-- - This migration is additive only. If any existing object differs in definition
--   (e.g., an index expression changed), it is not dropped/recreated here.
-- - If a UNIQUE constraint/index creation fails due to existing duplicates,
--   you must deduplicate data first, then re-run.
-- ============================================================================
