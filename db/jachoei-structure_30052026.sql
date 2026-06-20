--
-- PostgreSQL database dump
--

\restrict waWk1n4bj2ogsQkm4u3Il5dSy8fHxfsjMYfyhJJZpi66O6If4X5aybB0OakhY5A

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: btree_gin; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA public;


--
-- Name: EXTENSION btree_gin; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gin IS 'support for indexing common datatypes in GIN';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: calc_phone_risk(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calc_phone_risk(blocked_cnt integer, report_cnt integer) RETURNS integer
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


--
-- Name: create_revision_trigger(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_revision_trigger(p_table text) RETURNS void
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


--
-- Name: recalc_scam_phone_from_posts(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalc_scam_phone_from_posts(p_phone text) RETURNS void
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


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: set_updated_at_device_push_tokens(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at_device_push_tokens() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: sync_user_role_and_role_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_user_role_and_role_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_role_name text;
    v_role_id uuid;
BEGIN
    -- INSERT case
    IF TG_OP = 'INSERT' THEN
        IF NEW.role_id IS NOT NULL THEN
            SELECT name INTO v_role_name
            FROM public.roles
            WHERE id = NEW.role_id;

            IF v_role_name IS NOT NULL THEN
                NEW.role = v_role_name;
            END IF;

        ELSIF NEW.role IS NOT NULL AND trim(NEW.role) <> '' THEN
            SELECT id INTO v_role_id
            FROM public.roles
            WHERE name = trim(NEW.role);

            IF v_role_id IS NULL THEN
                INSERT INTO public.roles (name, description, created_at, updated_at)
                VALUES (trim(NEW.role), 'Auto-created from legacy role column', now(), now())
                ON CONFLICT (name) DO UPDATE SET updated_at = now()
                RETURNING id INTO v_role_id;
            END IF;

            NEW.role_id = v_role_id;

        ELSE
            SELECT id, name INTO NEW.role_id, NEW.role
            FROM public.roles
            WHERE name = 'Subscriber';
        END IF;

        RETURN NEW;
    END IF;

    -- UPDATE case: role_id changed
    IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
        SELECT name INTO v_role_name
        FROM public.roles
        WHERE id = NEW.role_id;

        IF v_role_name IS NOT NULL THEN
            NEW.role = v_role_name;
        END IF;

        RETURN NEW;
    END IF;

    -- UPDATE case: role text changed
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        IF NEW.role IS NULL OR trim(NEW.role) = '' THEN
            SELECT id, name INTO NEW.role_id, NEW.role
            FROM public.roles
            WHERE name = 'Subscriber';
        ELSE
            SELECT id INTO v_role_id
            FROM public.roles
            WHERE name = trim(NEW.role);

            IF v_role_id IS NULL THEN
                INSERT INTO public.roles (name, description, created_at, updated_at)
                VALUES (trim(NEW.role), 'Auto-created from legacy role column', now(), now())
                ON CONFLICT (name) DO UPDATE SET updated_at = now()
                RETURNING id INTO v_role_id;
            END IF;

            NEW.role = trim(NEW.role);
            NEW.role_id = v_role_id;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: trg_agg_scam_bank_account(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_agg_scam_bank_account() RETURNS trigger
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


--
-- Name: trg_generic_revision(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_generic_revision() RETURNS trigger
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


--
-- Name: trg_messages_after_insert__create_receipts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_messages_after_insert__create_receipts() RETURNS trigger
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


--
-- Name: trg_post_seller_accounts_unaccent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_post_seller_accounts_unaccent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.account_unaccent := unaccent(coalesce(NEW.seller_account, ''));
  NEW.bank_unaccent    := unaccent(coalesce(NEW.bank_name,      ''));
  RETURN NEW;
END;
$$;


--
-- Name: trg_post_tel_numbers_scam_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_post_tel_numbers_scam_summary() RETURNS trigger
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


--
-- Name: trg_posts_unaccent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_posts_unaccent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.title_unaccent  := unaccent(coalesce(NEW.title,  ''));
  NEW.detail_unaccent := unaccent(coalesce(NEW.detail, ''));
  RETURN NEW;
END;
$$;


--
-- Name: trg_users_unaccent(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_users_unaccent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.name_unaccent  := unaccent(coalesce(NEW.name,  ''));
  NEW.email_unaccent := unaccent(coalesce(NEW.email, ''));
  RETURN NEW;
END;
$$;


--
-- Name: upsert_bank_account_aggregate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_bank_account_aggregate() RETURNS trigger
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bookmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookmarks (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: call_history_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_history_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    normalized_number text NOT NULL,
    type text NOT NULL,
    source text NOT NULL,
    action text NOT NULL,
    matched_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: message_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_receipts (
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    delivered_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chat_id uuid,
    sender_id uuid,
    text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    reply_to_id uuid,
    client_message_id text,
    audio_file_id integer,
    audio_mime text,
    audio_duration_sec integer,
    message_type text DEFAULT 'TEXT'::text,
    location_json jsonb
);


--
-- Name: chat_last_read; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.chat_last_read AS
 SELECT r.user_id,
    m.chat_id,
    max(r.read_at) AS last_read_at
   FROM (public.message_receipts r
     JOIN public.messages m ON ((m.id = r.message_id)))
  GROUP BY r.user_id, m.chat_id;


--
-- Name: chat_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_members (
    chat_id uuid NOT NULL,
    user_id uuid NOT NULL,
    is_muted boolean DEFAULT false NOT NULL,
    notifications_enabled boolean DEFAULT true NOT NULL
);


--
-- Name: chat_unread_counts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.chat_unread_counts AS
 SELECT cm.user_id,
    m.chat_id,
    count(*) AS unread_count
   FROM ((public.messages m
     JOIN public.chat_members cm ON ((cm.chat_id = m.chat_id)))
     LEFT JOIN public.message_receipts r ON (((r.message_id = m.id) AND (r.user_id = cm.user_id))))
  WHERE ((cm.user_id <> m.sender_id) AND (r.read_at IS NULL))
  GROUP BY cm.user_id, m.chat_id;


--
-- Name: chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chats (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text,
    is_group boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    direct_key text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id uuid NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    parent_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: comments_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments_revisions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    comments_id uuid,
    editor_id uuid,
    snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: community_spam_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_spam_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    normalized_number text NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: device_push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    platform text NOT NULL,
    fcm_token text NOT NULL,
    device_id text,
    app_version text,
    locale text,
    is_active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    locale text DEFAULT 'en'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_published boolean DEFAULT true NOT NULL,
    subject_tpl text NOT NULL,
    html_tpl text NOT NULL,
    text_tpl text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_verify_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verify_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.files (
    id integer NOT NULL,
    filename text NOT NULL,
    original_name text,
    mimetype text,
    size bigint,
    checksum text,
    relpath text NOT NULL,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone
);


--
-- Name: files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.files_id_seq OWNED BY public.files.id;


--
-- Name: message_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    url text NOT NULL,
    mime text,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now(),
    file_id integer
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    data jsonb,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.password_reset_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;


--
-- Name: post_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_images (
    id integer NOT NULL,
    post_id uuid NOT NULL,
    file_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: post_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.post_images_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: post_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.post_images_id_seq OWNED BY public.post_images.id;


--
-- Name: post_seller_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_seller_accounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    post_id uuid,
    bank_id text,
    bank_name text,
    seller_account text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    account_unaccent text,
    bank_unaccent text
);


--
-- Name: post_seller_accounts_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_seller_accounts_revisions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    post_seller_accounts_id uuid,
    editor_id uuid,
    snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: post_tel_numbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_tel_numbers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    post_id uuid,
    tel text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: post_tel_numbers_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_tel_numbers_revisions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    post_tel_numbers_id uuid,
    editor_id uuid,
    snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    author_id uuid,
    status text DEFAULT 'public'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    meta text,
    fake_test boolean,
    first_last_name text,
    id_card text,
    title text,
    transfer_amount numeric(12,2) DEFAULT 0,
    transfer_date timestamp with time zone,
    website text,
    province_id uuid,
    detail text,
    title_unaccent text,
    detail_unaccent text,
    auto_publish boolean DEFAULT false NOT NULL
);


--
-- Name: posts_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posts_revisions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    posts_id uuid,
    editor_id uuid,
    snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: provinces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provinces (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name_th text NOT NULL,
    name_en text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roles_name_not_empty CHECK ((length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: TABLE roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.roles IS 'Normalized roles table - replaces text-based users.role column';


--
-- Name: COLUMN roles.name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.name IS 'Role name - must match existing users.role values for backward compatibility';


--
-- Name: COLUMN roles.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.is_active IS 'Inactive roles cannot be assigned to new users';


--
-- Name: scam_bank_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scam_bank_account (
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


--
-- Name: scam_bank_account_report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scam_bank_account_report (
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


--
-- Name: scam_bank_account_report_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scam_bank_account_report_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scam_bank_account_report_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scam_bank_account_report_id_seq OWNED BY public.scam_bank_account_report.id;


--
-- Name: scam_bank_account_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scam_bank_account_reports (
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


--
-- Name: scam_bank_accounts_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scam_bank_accounts_summary (
    bank_name text NOT NULL,
    account_no text NOT NULL,
    account_norm text NOT NULL,
    report_count integer DEFAULT 0 NOT NULL,
    last_report_at timestamp with time zone,
    risk_level integer DEFAULT 10 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scam_phone_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scam_phone_reports (
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


--
-- Name: scam_phone_unblocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scam_phone_unblocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    phone text NOT NULL,
    client_id uuid NOT NULL,
    device_model text,
    os_version text,
    app_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scam_phones_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scam_phones_summary (
    phone text NOT NULL,
    report_count integer DEFAULT 0 NOT NULL,
    last_report_at timestamp with time zone,
    risk_level integer DEFAULT 0 NOT NULL,
    post_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_version (
    id integer DEFAULT 1 NOT NULL,
    version text NOT NULL,
    applied_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    token text NOT NULL,
    user_id uuid NOT NULL,
    user_agent text,
    ip text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    expired_at timestamp without time zone NOT NULL
);


--
-- Name: slack_alert_dedupe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slack_alert_dedupe (
    dedupe_key text NOT NULL,
    last_sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: social_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    platform text NOT NULL,
    social_post_id text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    permalink_url text,
    published_at timestamp with time zone,
    CONSTRAINT social_posts_platform_check CHECK ((platform = ANY (ARRAY['facebook'::text, 'x'::text]))),
    CONSTRAINT social_posts_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'PUBLISHED'::text, 'FAILED'::text, 'SKIPPED'::text])))
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id text NOT NULL,
    name text,
    email text NOT NULL,
    phone text,
    topic text NOT NULL,
    subject text NOT NULL,
    message text NOT NULL,
    ref text,
    page_url text,
    user_agent text,
    ip text,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: system_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_logs (
    id bigint NOT NULL,
    level text DEFAULT 'info'::text NOT NULL,
    category text DEFAULT 'app'::text NOT NULL,
    message text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb,
    created_by integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    action text,
    status text,
    correlation_id text,
    session_id text,
    screen_name text,
    route_name text,
    platform text,
    app_version text,
    duration_ms integer,
    error_message text,
    stack text,
    device_info jsonb
);


--
-- Name: system_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_logs_id_seq OWNED BY public.system_logs.id;


--
-- Name: user_blocked_numbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_blocked_numbers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    normalized_number text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_blocked_phones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_blocked_phones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    phone text NOT NULL,
    phone_normalized text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_contact_spam_marks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_contact_spam_marks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    phone_normalized text NOT NULL,
    contact_name text,
    source text DEFAULT 'MANUAL'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT user_contact_spam_marks_source_check CHECK ((source = ANY (ARRAY['MANUAL'::text, 'SUGGESTED'::text, 'AUTO'::text])))
);


--
-- Name: user_contact_spam_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_contact_spam_settings (
    user_id uuid NOT NULL,
    mode text DEFAULT 'PROMPT'::text NOT NULL,
    risk_threshold integer DEFAULT 75 NOT NULL,
    sync_enabled boolean DEFAULT true NOT NULL,
    auto_mark_enabled boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_contact_spam_settings_mode_check CHECK ((mode = ANY (ARRAY['OFF'::text, 'PROMPT'::text, 'AUTO'::text]))),
    CONSTRAINT user_contact_spam_settings_threshold_check CHECK (((risk_threshold >= 0) AND (risk_threshold <= 100)))
);


--
-- Name: user_notification_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notification_settings (
    user_id uuid NOT NULL,
    chat_enabled boolean DEFAULT true NOT NULL,
    post_enabled boolean DEFAULT true NOT NULL,
    email_enabled boolean DEFAULT false NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    avatar text,
    phone text,
    email text,
    role text DEFAULT 'Subscriber'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    password_hash text NOT NULL,
    meta text,
    fake_test boolean,
    username text,
    language text DEFAULT 'en'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    provider text DEFAULT 'password'::text NOT NULL,
    provider_id text,
    name_unaccent text,
    email_unaccent text,
    notifications_enabled boolean DEFAULT true NOT NULL,
    role_id uuid,
    role_legacy text
);


--
-- Name: COLUMN users.role_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.role_id IS 'Foreign key to roles table - new normalized approach';


--
-- Name: COLUMN users.role_legacy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.role_legacy IS 'Backup of original role value before migration';


--
-- Name: users_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users_revisions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    users_id uuid,
    editor_id uuid,
    snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: v_users_with_roles; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_users_with_roles AS
 SELECT u.id,
    u.name,
    u.email,
    u.username,
    u.role AS role_text_legacy,
    u.role_id,
    r.name AS role_name,
    r.description AS role_description,
    r.is_active AS role_is_active,
    u.created_at,
    u.updated_at
   FROM (public.users u
     LEFT JOIN public.roles r ON ((u.role_id = r.id)));


--
-- Name: VIEW v_users_with_roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_users_with_roles IS 'Convenient view combining users and roles - use during migration period';


--
-- Name: whale_exchange_flow_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whale_exchange_flow_daily (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    token_id uuid NOT NULL,
    stat_date date NOT NULL,
    exchange_inflow numeric(78,18) DEFAULT 0 NOT NULL,
    exchange_outflow numeric(78,18) DEFAULT 0 NOT NULL,
    netflow numeric(78,18) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whale_holder_daily_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whale_holder_daily_stats (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    token_id uuid NOT NULL,
    stat_date date NOT NULL,
    holder_count integer DEFAULT 0 NOT NULL,
    whale_holder_count integer DEFAULT 0 NOT NULL,
    top10_concentration numeric(24,12) DEFAULT 0 NOT NULL,
    top20_concentration numeric(24,12) DEFAULT 0 NOT NULL,
    top50_concentration numeric(24,12) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whale_holder_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whale_holder_snapshots (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    token_id uuid NOT NULL,
    chain text NOT NULL,
    wallet_address text NOT NULL,
    balance numeric(78,18) NOT NULL,
    pct_supply numeric(24,12) NOT NULL,
    snapshot_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whale_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whale_signals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    token_id uuid NOT NULL,
    signal_type text NOT NULL,
    signal_score numeric(6,2) DEFAULT 0 NOT NULL,
    signal_reason text,
    signal_date date NOT NULL,
    metadata_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whale_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whale_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chain text NOT NULL,
    token_address text NOT NULL,
    symbol text NOT NULL,
    name text NOT NULL,
    decimals integer NOT NULL,
    total_supply numeric(78,18),
    circulating_supply numeric(78,18),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whale_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whale_transfers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    token_id uuid NOT NULL,
    chain text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    block_time timestamp with time zone NOT NULL,
    from_address text NOT NULL,
    to_address text NOT NULL,
    amount_raw numeric(78,0),
    amount_decimal numeric(78,18),
    usd_value numeric(32,8),
    from_label_type text,
    to_label_type text,
    is_exchange_in boolean DEFAULT false NOT NULL,
    is_exchange_out boolean DEFAULT false NOT NULL,
    is_internal_like boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whale_unlock_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whale_unlock_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    token_id uuid NOT NULL,
    unlock_date date NOT NULL,
    amount numeric(78,18) NOT NULL,
    pct_supply numeric(24,12),
    source text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whale_wallet_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whale_wallet_labels (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    chain text NOT NULL,
    wallet_address text NOT NULL,
    label_type text NOT NULL,
    label_name text,
    confidence_score numeric(5,2),
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files ALTER COLUMN id SET DEFAULT nextval('public.files_id_seq'::regclass);


--
-- Name: password_reset_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);


--
-- Name: post_images id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_images ALTER COLUMN id SET DEFAULT nextval('public.post_images_id_seq'::regclass);


--
-- Name: scam_bank_account_report id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scam_bank_account_report ALTER COLUMN id SET DEFAULT nextval('public.scam_bank_account_report_id_seq'::regclass);


--
-- Name: system_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_logs ALTER COLUMN id SET DEFAULT nextval('public.system_logs_id_seq'::regclass);


--
-- Name: bookmarks bookmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_pkey PRIMARY KEY (id);


--
-- Name: bookmarks bookmarks_post_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_post_id_user_id_key UNIQUE (post_id, user_id);


--
-- Name: call_history_logs call_history_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_history_logs
    ADD CONSTRAINT call_history_logs_pkey PRIMARY KEY (id);


--
-- Name: chat_members chat_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT chat_members_pkey PRIMARY KEY (chat_id, user_id);


--
-- Name: chats chats_direct_key_chk; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.chats
    ADD CONSTRAINT chats_direct_key_chk CHECK (((is_group = true) OR (direct_key IS NOT NULL))) NOT VALID;


--
-- Name: chats chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: comments_revisions comments_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments_revisions
    ADD CONSTRAINT comments_revisions_pkey PRIMARY KEY (id);


--
-- Name: community_spam_reports community_spam_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_spam_reports
    ADD CONSTRAINT community_spam_reports_pkey PRIMARY KEY (id);


--
-- Name: device_push_tokens device_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_push_tokens
    ADD CONSTRAINT device_push_tokens_pkey PRIMARY KEY (id);


--
-- Name: device_push_tokens device_push_tokens_unique_token; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_push_tokens
    ADD CONSTRAINT device_push_tokens_unique_token UNIQUE (fcm_token);


--
-- Name: email_templates email_templates_key_locale_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_key_locale_version_key UNIQUE (key, locale, version);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: email_verify_tokens email_verify_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verify_tokens
    ADD CONSTRAINT email_verify_tokens_pkey PRIMARY KEY (id);


--
-- Name: email_verify_tokens email_verify_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verify_tokens
    ADD CONSTRAINT email_verify_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: message_images message_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_images
    ADD CONSTRAINT message_images_pkey PRIMARY KEY (id);


--
-- Name: message_receipts message_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_receipts
    ADD CONSTRAINT message_receipts_pkey PRIMARY KEY (message_id, user_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_key UNIQUE (token);


--
-- Name: post_images post_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_images
    ADD CONSTRAINT post_images_pkey PRIMARY KEY (id);


--
-- Name: post_seller_accounts post_seller_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_seller_accounts
    ADD CONSTRAINT post_seller_accounts_pkey PRIMARY KEY (id);


--
-- Name: post_seller_accounts_revisions post_seller_accounts_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_seller_accounts_revisions
    ADD CONSTRAINT post_seller_accounts_revisions_pkey PRIMARY KEY (id);


--
-- Name: post_tel_numbers post_tel_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_tel_numbers
    ADD CONSTRAINT post_tel_numbers_pkey PRIMARY KEY (id);


--
-- Name: post_tel_numbers_revisions post_tel_numbers_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_tel_numbers_revisions
    ADD CONSTRAINT post_tel_numbers_revisions_pkey PRIMARY KEY (id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: posts_revisions posts_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts_revisions
    ADD CONSTRAINT posts_revisions_pkey PRIMARY KEY (id);


--
-- Name: provinces provinces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provinces
    ADD CONSTRAINT provinces_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: scam_bank_account scam_bank_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scam_bank_account
    ADD CONSTRAINT scam_bank_account_pkey PRIMARY KEY (account_norm);


--
-- Name: scam_bank_account_report scam_bank_account_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scam_bank_account_report
    ADD CONSTRAINT scam_bank_account_report_pkey PRIMARY KEY (id);


--
-- Name: scam_bank_account_reports scam_bank_account_reports_client_bank_ux; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scam_bank_account_reports
    ADD CONSTRAINT scam_bank_account_reports_client_bank_ux UNIQUE (client_id, bank_name, account_norm);


--
-- Name: scam_bank_account_reports scam_bank_account_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scam_bank_account_reports
    ADD CONSTRAINT scam_bank_account_reports_pkey PRIMARY KEY (id);


--
-- Name: scam_bank_accounts_summary scam_bank_accounts_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scam_bank_accounts_summary
    ADD CONSTRAINT scam_bank_accounts_summary_pkey PRIMARY KEY (bank_name, account_norm);


--
-- Name: scam_phone_reports scam_phone_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scam_phone_reports
    ADD CONSTRAINT scam_phone_reports_pkey PRIMARY KEY (id);


--
-- Name: scam_phone_unblocks scam_phone_unblocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scam_phone_unblocks
    ADD CONSTRAINT scam_phone_unblocks_pkey PRIMARY KEY (id);


--
-- Name: scam_phones_summary scam_phones_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scam_phones_summary
    ADD CONSTRAINT scam_phones_summary_pkey PRIMARY KEY (phone);


--
-- Name: schema_version schema_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_version
    ADD CONSTRAINT schema_version_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token);


--
-- Name: slack_alert_dedupe slack_alert_dedupe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slack_alert_dedupe
    ADD CONSTRAINT slack_alert_dedupe_pkey PRIMARY KEY (dedupe_key);


--
-- Name: social_posts social_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_pkey PRIMARY KEY (id);


--
-- Name: social_posts social_posts_post_id_platform_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_post_id_platform_key UNIQUE (post_id, platform);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_ticket_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_ticket_id_key UNIQUE (ticket_id);


--
-- Name: system_logs system_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_pkey PRIMARY KEY (id);


--
-- Name: user_blocked_numbers user_blocked_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocked_numbers
    ADD CONSTRAINT user_blocked_numbers_pkey PRIMARY KEY (id);


--
-- Name: user_blocked_numbers user_blocked_numbers_user_id_normalized_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocked_numbers
    ADD CONSTRAINT user_blocked_numbers_user_id_normalized_number_key UNIQUE (user_id, normalized_number);


--
-- Name: user_blocked_phones user_blocked_phones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocked_phones
    ADD CONSTRAINT user_blocked_phones_pkey PRIMARY KEY (id);


--
-- Name: user_blocked_phones user_blocked_phones_user_id_phone_normalized_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocked_phones
    ADD CONSTRAINT user_blocked_phones_user_id_phone_normalized_key UNIQUE (user_id, phone_normalized);


--
-- Name: user_contact_spam_marks user_contact_spam_marks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contact_spam_marks
    ADD CONSTRAINT user_contact_spam_marks_pkey PRIMARY KEY (id);


--
-- Name: user_contact_spam_marks user_contact_spam_marks_unique_phone; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contact_spam_marks
    ADD CONSTRAINT user_contact_spam_marks_unique_phone UNIQUE (user_id, phone_normalized);


--
-- Name: user_contact_spam_settings user_contact_spam_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contact_spam_settings
    ADD CONSTRAINT user_contact_spam_settings_pkey PRIMARY KEY (user_id);


--
-- Name: user_notification_settings user_notification_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notification_settings
    ADD CONSTRAINT user_notification_settings_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users_revisions users_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users_revisions
    ADD CONSTRAINT users_revisions_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: whale_exchange_flow_daily whale_exchange_flow_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_exchange_flow_daily
    ADD CONSTRAINT whale_exchange_flow_daily_pkey PRIMARY KEY (id);


--
-- Name: whale_exchange_flow_daily whale_exchange_flow_daily_token_id_stat_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_exchange_flow_daily
    ADD CONSTRAINT whale_exchange_flow_daily_token_id_stat_date_key UNIQUE (token_id, stat_date);


--
-- Name: whale_holder_daily_stats whale_holder_daily_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_holder_daily_stats
    ADD CONSTRAINT whale_holder_daily_stats_pkey PRIMARY KEY (id);


--
-- Name: whale_holder_daily_stats whale_holder_daily_stats_token_id_stat_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_holder_daily_stats
    ADD CONSTRAINT whale_holder_daily_stats_token_id_stat_date_key UNIQUE (token_id, stat_date);


--
-- Name: whale_holder_snapshots whale_holder_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_holder_snapshots
    ADD CONSTRAINT whale_holder_snapshots_pkey PRIMARY KEY (id);


--
-- Name: whale_holder_snapshots whale_holder_snapshots_token_id_wallet_address_snapshot_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_holder_snapshots
    ADD CONSTRAINT whale_holder_snapshots_token_id_wallet_address_snapshot_at_key UNIQUE (token_id, wallet_address, snapshot_at);


--
-- Name: whale_signals whale_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_signals
    ADD CONSTRAINT whale_signals_pkey PRIMARY KEY (id);


--
-- Name: whale_tokens whale_tokens_chain_token_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_tokens
    ADD CONSTRAINT whale_tokens_chain_token_address_key UNIQUE (chain, token_address);


--
-- Name: whale_tokens whale_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_tokens
    ADD CONSTRAINT whale_tokens_pkey PRIMARY KEY (id);


--
-- Name: whale_transfers whale_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_transfers
    ADD CONSTRAINT whale_transfers_pkey PRIMARY KEY (id);


--
-- Name: whale_transfers whale_transfers_token_id_tx_hash_log_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_transfers
    ADD CONSTRAINT whale_transfers_token_id_tx_hash_log_index_key UNIQUE (token_id, tx_hash, log_index);


--
-- Name: whale_unlock_events whale_unlock_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_unlock_events
    ADD CONSTRAINT whale_unlock_events_pkey PRIMARY KEY (id);


--
-- Name: whale_unlock_events whale_unlock_events_token_id_unlock_date_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_unlock_events
    ADD CONSTRAINT whale_unlock_events_token_id_unlock_date_source_key UNIQUE (token_id, unlock_date, source);


--
-- Name: whale_wallet_labels whale_wallet_labels_chain_wallet_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_wallet_labels
    ADD CONSTRAINT whale_wallet_labels_chain_wallet_address_key UNIQUE (chain, wallet_address);


--
-- Name: whale_wallet_labels whale_wallet_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_wallet_labels
    ADD CONSTRAINT whale_wallet_labels_pkey PRIMARY KEY (id);


--
-- Name: chat_members_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chat_members_uq ON public.chat_members USING btree (chat_id, user_id);


--
-- Name: chats_direct_key_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chats_direct_key_uq ON public.chats USING btree (direct_key);


--
-- Name: device_push_tokens_platform_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_push_tokens_platform_idx ON public.device_push_tokens USING btree (platform);


--
-- Name: device_push_tokens_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_push_tokens_user_active_idx ON public.device_push_tokens USING btree (user_id, is_active);


--
-- Name: idx_bank_report_account_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_report_account_time ON public.scam_bank_account_report USING btree (account_norm, created_at DESC);


--
-- Name: idx_bank_report_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_report_created_at ON public.scam_bank_account_report USING btree (created_at DESC);


--
-- Name: idx_bank_report_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_report_user ON public.scam_bank_account_report USING btree (user_id);


--
-- Name: idx_call_history_logs_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_logs_norm ON public.call_history_logs USING btree (normalized_number);


--
-- Name: idx_call_history_logs_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_history_logs_user_time ON public.call_history_logs USING btree (user_id, created_at DESC);


--
-- Name: idx_comments_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_parent ON public.comments USING btree (parent_id);


--
-- Name: idx_comments_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_post ON public.comments USING btree (post_id, created_at);


--
-- Name: idx_community_spam_reports_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_spam_reports_norm ON public.community_spam_reports USING btree (normalized_number);


--
-- Name: idx_community_spam_reports_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_community_spam_reports_user_time ON public.community_spam_reports USING btree (user_id, created_at DESC);


--
-- Name: idx_email_templates_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_templates_lookup ON public.email_templates USING btree (key, locale, is_active, is_published, version DESC);


--
-- Name: idx_files_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_created_at ON public.files USING btree (created_at DESC);


--
-- Name: idx_message_images_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_images_message_id ON public.message_images USING btree (message_id);


--
-- Name: idx_messages_chat_audio_file; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_chat_audio_file ON public.messages USING btree (chat_id, audio_file_id);


--
-- Name: idx_messages_chat_created_id_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_chat_created_id_desc ON public.messages USING btree (chat_id, created_at DESC, id DESC);


--
-- Name: idx_messages_chat_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_chat_deleted ON public.messages USING btree (chat_id, deleted_at);


--
-- Name: idx_messages_message_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_message_type ON public.messages USING btree (chat_id, message_type);


--
-- Name: idx_messages_reply_to_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_reply_to_id ON public.messages USING btree (reply_to_id);


--
-- Name: idx_notifications_user_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created_at ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_notifications_user_is_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_is_read ON public.notifications USING btree (user_id, is_read);


--
-- Name: idx_post_seller_accounts_acc_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_seller_accounts_acc_trgm ON public.post_seller_accounts USING gin (account_unaccent public.gin_trgm_ops);


--
-- Name: idx_post_seller_accounts_bank_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_seller_accounts_bank_trgm ON public.post_seller_accounts USING gin (bank_unaccent public.gin_trgm_ops);


--
-- Name: idx_post_tel_numbers_phone_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_tel_numbers_phone_trgm ON public.post_tel_numbers USING gin (tel public.gin_trgm_ops);


--
-- Name: idx_posts_detail_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_detail_trgm ON public.posts USING gin (detail_unaccent public.gin_trgm_ops);


--
-- Name: idx_posts_search_tsv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_search_tsv ON public.posts USING gin (tsvector_concat(setweight(to_tsvector('simple'::regconfig, COALESCE(title_unaccent, ''::text)), 'A'::"char"), setweight(to_tsvector('simple'::regconfig, COALESCE(detail_unaccent, ''::text)), 'C'::"char")));


--
-- Name: idx_posts_title_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_title_trgm ON public.posts USING gin (title_unaccent public.gin_trgm_ops);


--
-- Name: idx_prt_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prt_token ON public.password_reset_tokens USING btree (token);


--
-- Name: idx_prt_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prt_userid ON public.password_reset_tokens USING btree (user_id);


--
-- Name: idx_receipts_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipts_message ON public.message_receipts USING btree (message_id);


--
-- Name: idx_receipts_user_read_null; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipts_user_read_null ON public.message_receipts USING btree (user_id) WHERE (read_at IS NULL);


--
-- Name: idx_roles_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_active ON public.roles USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_roles_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_name ON public.roles USING btree (name);


--
-- Name: idx_sbar_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sbar_user_created ON public.scam_bank_account_reports USING btree (user_id, created_at DESC);


--
-- Name: idx_scam_bank_account_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scam_bank_account_prefix ON public.scam_bank_account USING btree (account_norm varchar_pattern_ops);


--
-- Name: idx_scam_bank_account_report_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scam_bank_account_report_count ON public.scam_bank_account USING btree (report_count DESC);


--
-- Name: idx_scam_bank_account_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scam_bank_account_updated_at ON public.scam_bank_account USING btree (updated_at DESC);


--
-- Name: idx_scam_phone_reports_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scam_phone_reports_created ON public.scam_phone_reports USING btree (created_at);


--
-- Name: idx_scam_phone_reports_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scam_phone_reports_norm ON public.scam_phone_reports USING btree (phone_normalized);


--
-- Name: idx_scam_phone_unblocks_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scam_phone_unblocks_phone ON public.scam_phone_unblocks USING btree (phone);


--
-- Name: idx_scam_phone_unblocks_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scam_phone_unblocks_user ON public.scam_phone_unblocks USING btree (user_id);


--
-- Name: idx_scam_phones_summary_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scam_phones_summary_updated ON public.scam_phones_summary USING btree (updated_at);


--
-- Name: idx_slack_alert_dedupe_last_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_slack_alert_dedupe_last_sent_at ON public.slack_alert_dedupe USING btree (last_sent_at DESC);


--
-- Name: idx_support_tickets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_status ON public.support_tickets USING btree (status);


--
-- Name: idx_system_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_action ON public.system_logs USING btree (action);


--
-- Name: idx_system_logs_app_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_app_version ON public.system_logs USING btree (app_version);


--
-- Name: idx_system_logs_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_category ON public.system_logs USING btree (category);


--
-- Name: idx_system_logs_correlation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_correlation_id ON public.system_logs USING btree (correlation_id);


--
-- Name: idx_system_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_created_at ON public.system_logs USING btree (created_at DESC);


--
-- Name: idx_system_logs_created_by_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_created_by_created_at ON public.system_logs USING btree (created_by, created_at DESC);


--
-- Name: idx_system_logs_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_level ON public.system_logs USING btree (level);


--
-- Name: idx_system_logs_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_platform ON public.system_logs USING btree (platform);


--
-- Name: idx_system_logs_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_session_id ON public.system_logs USING btree (session_id);


--
-- Name: idx_system_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_logs_status ON public.system_logs USING btree (status);


--
-- Name: idx_user_blocked_numbers_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_blocked_numbers_norm ON public.user_blocked_numbers USING btree (normalized_number);


--
-- Name: idx_user_blocked_numbers_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_blocked_numbers_user ON public.user_blocked_numbers USING btree (user_id);


--
-- Name: idx_user_blocked_phones_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_blocked_phones_norm ON public.user_blocked_phones USING btree (phone_normalized);


--
-- Name: idx_user_blocked_phones_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_blocked_phones_user ON public.user_blocked_phones USING btree (user_id);


--
-- Name: idx_user_contact_spam_marks_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_contact_spam_marks_phone ON public.user_contact_spam_marks USING btree (phone_normalized);


--
-- Name: idx_user_contact_spam_marks_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_contact_spam_marks_user_active ON public.user_contact_spam_marks USING btree (user_id, updated_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email_trgm ON public.users USING gin (email_unaccent public.gin_trgm_ops);


--
-- Name: idx_users_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_name_trgm ON public.users USING gin (name_unaccent public.gin_trgm_ops);


--
-- Name: idx_users_phone_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone_trgm ON public.users USING gin (phone public.gin_trgm_ops);


--
-- Name: idx_users_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role_id ON public.users USING btree (role_id);


--
-- Name: idx_users_search_tsv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_search_tsv ON public.users USING gin (tsvector_concat(setweight(to_tsvector('simple'::regconfig, COALESCE(name_unaccent, ''::text)), 'A'::"char"), setweight(to_tsvector('simple'::regconfig, COALESCE(email_unaccent, ''::text)), 'B'::"char")));


--
-- Name: idx_whale_holder_snapshots_token_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whale_holder_snapshots_token_snapshot ON public.whale_holder_snapshots USING btree (token_id, snapshot_at DESC);


--
-- Name: idx_whale_holder_snapshots_wallet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whale_holder_snapshots_wallet ON public.whale_holder_snapshots USING btree (chain, wallet_address);


--
-- Name: idx_whale_signals_token_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whale_signals_token_date ON public.whale_signals USING btree (token_id, signal_date DESC);


--
-- Name: idx_whale_transfers_exchange_flags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whale_transfers_exchange_flags ON public.whale_transfers USING btree (token_id, is_exchange_in, is_exchange_out, block_time DESC);


--
-- Name: idx_whale_transfers_token_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whale_transfers_token_time ON public.whale_transfers USING btree (token_id, block_time DESC);


--
-- Name: idx_whale_unlock_events_token_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whale_unlock_events_token_date ON public.whale_unlock_events USING btree (token_id, unlock_date);


--
-- Name: idx_whale_wallet_labels_chain_wallet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whale_wallet_labels_chain_wallet ON public.whale_wallet_labels USING btree (chain, wallet_address);


--
-- Name: scam_bank_account_reports_bank_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scam_bank_account_reports_bank_idx ON public.scam_bank_account_reports USING btree (bank_name);


--
-- Name: scam_bank_account_reports_norm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scam_bank_account_reports_norm_idx ON public.scam_bank_account_reports USING btree (account_norm);


--
-- Name: scam_bank_accounts_summary_norm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scam_bank_accounts_summary_norm_idx ON public.scam_bank_accounts_summary USING btree (account_norm);


--
-- Name: scam_bank_accounts_summary_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX scam_bank_accounts_summary_updated_idx ON public.scam_bank_accounts_summary USING btree (updated_at);


--
-- Name: uq_messages_client_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_messages_client_message_id ON public.messages USING btree (chat_id, sender_id, client_message_id);


--
-- Name: comments comments_rev_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER comments_rev_trg BEFORE UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.trg_generic_revision();


--
-- Name: messages messages_after_insert__create_receipts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_after_insert__create_receipts AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.trg_messages_after_insert__create_receipts();


--
-- Name: post_seller_accounts post_seller_accounts_rev_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER post_seller_accounts_rev_trg BEFORE UPDATE ON public.post_seller_accounts FOR EACH ROW EXECUTE FUNCTION public.trg_generic_revision();


--
-- Name: post_tel_numbers post_tel_numbers_rev_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER post_tel_numbers_rev_trg BEFORE UPDATE ON public.post_tel_numbers FOR EACH ROW EXECUTE FUNCTION public.trg_generic_revision();


--
-- Name: post_tel_numbers post_tel_numbers_scam_summary_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER post_tel_numbers_scam_summary_trg AFTER INSERT OR DELETE OR UPDATE ON public.post_tel_numbers FOR EACH ROW EXECUTE FUNCTION public.trg_post_tel_numbers_scam_summary();


--
-- Name: posts posts_rev_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER posts_rev_trg BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.trg_generic_revision();


--
-- Name: scam_bank_account_reports scam_bank_account_reports_agg_tg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER scam_bank_account_reports_agg_tg AFTER INSERT ON public.scam_bank_account_reports FOR EACH ROW EXECUTE FUNCTION public.trg_agg_scam_bank_account();


--
-- Name: scam_bank_account_report trg_bank_report_agg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bank_report_agg AFTER INSERT ON public.scam_bank_account_report FOR EACH ROW EXECUTE FUNCTION public.upsert_bank_account_aggregate();


--
-- Name: device_push_tokens trg_device_push_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_device_push_tokens_updated_at BEFORE UPDATE ON public.device_push_tokens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_device_push_tokens();


--
-- Name: email_templates trg_email_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_email_templates_updated_at BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: post_seller_accounts trg_post_seller_accounts_unaccent_insupd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_post_seller_accounts_unaccent_insupd BEFORE INSERT OR UPDATE OF seller_account, bank_name ON public.post_seller_accounts FOR EACH ROW EXECUTE FUNCTION public.trg_post_seller_accounts_unaccent();


--
-- Name: posts trg_posts_unaccent_insupd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_posts_unaccent_insupd BEFORE INSERT OR UPDATE OF title, detail ON public.posts FOR EACH ROW EXECUTE FUNCTION public.trg_posts_unaccent();


--
-- Name: roles trg_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: social_posts trg_social_posts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_social_posts_updated_at BEFORE UPDATE ON public.social_posts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_sync_role_and_role_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_sync_role_and_role_id BEFORE INSERT OR UPDATE OF role, role_id ON public.users FOR EACH ROW EXECUTE FUNCTION public.sync_user_role_and_role_id();


--
-- Name: users trg_users_unaccent_insupd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_unaccent_insupd BEFORE INSERT OR UPDATE OF name, email ON public.users FOR EACH ROW EXECUTE FUNCTION public.trg_users_unaccent();


--
-- Name: users users_rev_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_rev_trg BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.trg_generic_revision();


--
-- Name: bookmarks bookmarks_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: bookmarks bookmarks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: call_history_logs call_history_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_history_logs
    ADD CONSTRAINT call_history_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_members chat_members_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT chat_members_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: chat_members chat_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_members
    ADD CONSTRAINT chat_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chats chats_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: comments comments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.comments(id) ON DELETE CASCADE;


--
-- Name: comments comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: comments_revisions comments_revisions_comments_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments_revisions
    ADD CONSTRAINT comments_revisions_comments_id_fkey FOREIGN KEY (comments_id) REFERENCES public.comments(id) ON DELETE CASCADE;


--
-- Name: comments comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: community_spam_reports community_spam_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_spam_reports
    ADD CONSTRAINT community_spam_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_push_tokens device_push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_push_tokens
    ADD CONSTRAINT device_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: email_verify_tokens email_verify_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verify_tokens
    ADD CONSTRAINT email_verify_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users fk_users_role_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_role_id FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;


--
-- Name: message_images message_images_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_images
    ADD CONSTRAINT message_images_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.files(id);


--
-- Name: message_images message_images_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_images
    ADD CONSTRAINT message_images_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_receipts message_receipts_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_receipts
    ADD CONSTRAINT message_receipts_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_receipts message_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_receipts
    ADD CONSTRAINT message_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messages messages_audio_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_audio_file_id_fkey FOREIGN KEY (audio_file_id) REFERENCES public.files(id) ON DELETE SET NULL;


--
-- Name: messages messages_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: messages messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: post_images post_images_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_images
    ADD CONSTRAINT post_images_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.files(id) ON DELETE CASCADE;


--
-- Name: post_images post_images_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_images
    ADD CONSTRAINT post_images_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_seller_accounts post_seller_accounts_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_seller_accounts
    ADD CONSTRAINT post_seller_accounts_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_seller_accounts_revisions post_seller_accounts_revisions_post_seller_accounts_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_seller_accounts_revisions
    ADD CONSTRAINT post_seller_accounts_revisions_post_seller_accounts_id_fkey FOREIGN KEY (post_seller_accounts_id) REFERENCES public.post_seller_accounts(id) ON DELETE CASCADE;


--
-- Name: post_tel_numbers post_tel_numbers_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_tel_numbers
    ADD CONSTRAINT post_tel_numbers_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_tel_numbers_revisions post_tel_numbers_revisions_post_tel_numbers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_tel_numbers_revisions
    ADD CONSTRAINT post_tel_numbers_revisions_post_tel_numbers_id_fkey FOREIGN KEY (post_tel_numbers_id) REFERENCES public.post_tel_numbers(id) ON DELETE CASCADE;


--
-- Name: posts posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: posts_revisions posts_revisions_posts_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts_revisions
    ADD CONSTRAINT posts_revisions_posts_id_fkey FOREIGN KEY (posts_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: scam_bank_account_report scam_bank_account_report_account_norm_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scam_bank_account_report
    ADD CONSTRAINT scam_bank_account_report_account_norm_fkey FOREIGN KEY (account_norm) REFERENCES public.scam_bank_account(account_norm) ON DELETE CASCADE;


--
-- Name: scam_phone_reports scam_phone_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scam_phone_reports
    ADD CONSTRAINT scam_phone_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: social_posts social_posts_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: user_blocked_numbers user_blocked_numbers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocked_numbers
    ADD CONSTRAINT user_blocked_numbers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_blocked_phones user_blocked_phones_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_blocked_phones
    ADD CONSTRAINT user_blocked_phones_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_contact_spam_marks user_contact_spam_marks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contact_spam_marks
    ADD CONSTRAINT user_contact_spam_marks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_contact_spam_settings user_contact_spam_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_contact_spam_settings
    ADD CONSTRAINT user_contact_spam_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users_revisions users_revisions_users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users_revisions
    ADD CONSTRAINT users_revisions_users_id_fkey FOREIGN KEY (users_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: whale_exchange_flow_daily whale_exchange_flow_daily_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_exchange_flow_daily
    ADD CONSTRAINT whale_exchange_flow_daily_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.whale_tokens(id) ON DELETE CASCADE;


--
-- Name: whale_holder_daily_stats whale_holder_daily_stats_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_holder_daily_stats
    ADD CONSTRAINT whale_holder_daily_stats_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.whale_tokens(id) ON DELETE CASCADE;


--
-- Name: whale_holder_snapshots whale_holder_snapshots_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_holder_snapshots
    ADD CONSTRAINT whale_holder_snapshots_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.whale_tokens(id) ON DELETE CASCADE;


--
-- Name: whale_signals whale_signals_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_signals
    ADD CONSTRAINT whale_signals_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.whale_tokens(id) ON DELETE CASCADE;


--
-- Name: whale_transfers whale_transfers_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_transfers
    ADD CONSTRAINT whale_transfers_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.whale_tokens(id) ON DELETE CASCADE;


--
-- Name: whale_unlock_events whale_unlock_events_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whale_unlock_events
    ADD CONSTRAINT whale_unlock_events_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.whale_tokens(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict waWk1n4bj2ogsQkm4u3Il5dSy8fHxfsjMYfyhJJZpi66O6If4X5aybB0OakhY5A

