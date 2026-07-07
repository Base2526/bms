-- =============================================
-- AUTO-GENERATED SCHEMA FILE (DO NOT EDIT)
-- Output: db/schema_core.sql
-- GeneratedAt: 2026-03-01T10:44:20.255118+00:00
-- Included migrations:
--  - 1.4__views_and_helpers.sql
--  - 1.7__system_logs.sql
--  - 1.12__provinces.sql
--  - 1.23__support_tickets.sql
--  - 1.26__direct_key + unique index สำหรับ 1:1.sql
--  - 1.27__.sql
--  - 1.28__sql.sql
--  - 1.29__.sql
--  - 1.30___.sql
--  - 1.31__.sql
-- =============================================

BEGIN;

-- =====================================================
-- MIGRATION: 1.4__views_and_helpers.sql
-- =====================================================

-- 002_views_and_helpers.sql

CREATE OR REPLACE VIEW chat_unread_counts AS
SELECT
  cm.user_id,
  m.chat_id,
  COUNT(*)::BIGINT AS unread_count
FROM messages m
JOIN chat_members cm ON cm.chat_id = m.chat_id
LEFT JOIN message_receipts r
  ON r.message_id = m.id AND r.user_id = cm.user_id
WHERE cm.user_id <> m.sender_id
  AND (r.read_at IS NULL)
GROUP BY cm.user_id, m.chat_id;

CREATE OR REPLACE VIEW chat_last_read AS
SELECT
  r.user_id,
  m.chat_id,
  MAX(r.read_at) AS last_read_at
FROM message_receipts r
JOIN messages m ON m.id = r.message_id
GROUP BY r.user_id, m.chat_id;


-- =====================================================
-- MIGRATION: 1.7__system_logs.sql
-- =====================================================

-- System logs for admin settings
CREATE TABLE IF NOT EXISTS system_logs (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info',        -- debug|info|warn|error
  category TEXT NOT NULL DEFAULT 'app',      -- e.g., auth, graphql, file, chat
  message TEXT NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb,
  created_by INT NULL,                       -- user id if available
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs (level);
CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs (category);

-- =====================================================
-- MIGRATION: 1.12__provinces.sql
-- =====================================================


-- ใช้ UUID ถ้าจำเป็น
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) ตาราง provinces
CREATE TABLE IF NOT EXISTS provinces (
  id UUID PRIMARY KEY,
  name_th TEXT NOT NULL,
  name_en TEXT
);

-- 2) เพิ่มคอลัมน์อ้างอิงใน posts (ถ้ายังไม่มี)
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS province_id UUID;

-- 3) FK (ถ้ายังไม่ได้เพิ่ม)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_province_id_fkey'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_province_id_fkey
      FOREIGN KEY (province_id) REFERENCES provinces(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 4) Seed ข้อมูล (UPSERT ตาม id)
INSERT INTO provinces (id, name_th, name_en) VALUES
  ('a0f9a3b6-3a42-4c61-924d-14e3a9e4c2d1','กรุงเทพมหานคร','Bangkok'),
  ('b27f6c4a-7f53-4a77-bb12-83211d9e62a3','เชียงใหม่','Chiang Mai'),
  ('c913aef8-4581-4b40-90d8-5c3efde0b61a','ขอนแก่น','Khon Kaen'),
  ('d57a89e3-f2e4-4fa4-a38a-14cc6bcbf879','ภูเก็ต','Phuket'),
  ('e89db1cf-9a12-4e7f-b354-67a8e1b58a50','ชลบุรี','Chonburi')
ON CONFLICT (id) DO UPDATE
SET name_th = EXCLUDED.name_th,
    name_en = EXCLUDED.name_en;


-- =====================================================
-- MIGRATION: 1.23__support_tickets.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id TEXT NOT NULL UNIQUE,

  name TEXT,
  email TEXT NOT NULL,
  phone TEXT,

  topic TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,

  ref TEXT,
  page_url TEXT,
  user_agent TEXT,
  ip TEXT,

  status TEXT NOT NULL DEFAULT 'open',

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status
ON support_tickets(status);

-- =====================================================
-- MIGRATION: 1.26__direct_key + unique index สำหรับ 1:1.sql
-- =====================================================

รันครั้งที่ 1

-- 1) เพิ่มคอลัมน์
ALTER TABLE chats ADD COLUMN IF NOT EXISTS direct_key text;

-- 2) (แนะนำ) ใส่ CHECK ให้ 1:1 ต้องมี direct_key
-- ALTER TABLE chats
--   ADD CONSTRAINT IF NOT EXISTS chats_direct_key_chk
--   CHECK (is_group = true OR direct_key IS NOT NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chats_direct_key_chk'
  ) THEN
    ALTER TABLE chats
      ADD CONSTRAINT chats_direct_key_chk
      CHECK (is_group = true OR direct_key IS NOT NULL);
  END IF;
END$$;


-- 3) สร้าง unique index เฉพาะห้อง 1:1
CREATE UNIQUE INDEX IF NOT EXISTS chats_direct_key_uq
ON chats (direct_key)
WHERE is_group = false;

CREATE UNIQUE INDEX IF NOT EXISTS chat_members_uq ON chat_members(chat_id, user_id);


รันครั้งที่ 2

-- 1) เพิ่มคอลัมน์
ALTER TABLE chats ADD COLUMN IF NOT EXISTS direct_key text;

-- 2) ทำ unique index แบบไม่ partial (สำคัญ)
CREATE UNIQUE INDEX IF NOT EXISTS chats_direct_key_uq
ON chats (direct_key);

-- 3) (แนะนำ) ให้ chat_members กันซ้ำ
CREATE UNIQUE INDEX IF NOT EXISTS chat_members_uq
ON chat_members(chat_id, user_id);

DROP INDEX IF EXISTS chats_direct_key_uq_partial;
-- (ชื่อ index ของคุณอาจไม่ใช่นี้ ให้ดูชื่อจริงด้วย \di ใน psql)

-- =====================================================
-- MIGRATION: 1.27__.sql
-- =====================================================

-- =========
-- 0) EXT (ถ้ายังไม่มี)
-- =========
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========
-- 1) ตารางเก็บเบอร์ที่ผู้ใช้บล็อก (ส่วนตัว)
-- =========
CREATE TABLE IF NOT EXISTS user_blocked_phones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone           text NOT NULL,
  phone_normalized text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, phone_normalized)
);

CREATE INDEX IF NOT EXISTS idx_user_blocked_phones_user
  ON user_blocked_phones (user_id);

CREATE INDEX IF NOT EXISTS idx_user_blocked_phones_norm
  ON user_blocked_phones (phone_normalized);

-- =========
-- 2) ตาราง summary แบบ community (ไม่ระบุตัวตน)
-- =========
CREATE TABLE IF NOT EXISTS scam_phones_summary (
  phone_normalized text PRIMARY KEY,
  blocked_by_count int NOT NULL DEFAULT 0,
  last_blocked_at  timestamptz,
  report_count     int NOT NULL DEFAULT 0,
  last_report_at   timestamptz,
  risk_level       int NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scam_phones_summary_updated
  ON scam_phones_summary (updated_at);

-- =========
-- 3) (Optional) ตาราง report เบอร์ (ถ้าคุณมีอยู่แล้ว ข้ามได้)
-- =========
CREATE TABLE IF NOT EXISTS scam_phone_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  phone           text NOT NULL,
  phone_normalized text NOT NULL,
  category        text,
  note            text,
  client_id       uuid,
  device_model    text,
  os_version      text,
  app_version     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scam_phone_reports_norm
  ON scam_phone_reports (phone_normalized);

CREATE INDEX IF NOT EXISTS idx_scam_phone_reports_created
  ON scam_phone_reports (created_at);

-- =========
-- 4) Helper function: calc risk (ปรับสูตรได้)
-- =========
CREATE OR REPLACE FUNCTION calc_phone_risk(blocked_cnt int, report_cnt int)
RETURNS int
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

-- =====================================================
-- MIGRATION: 1.28__sql.sql
-- =====================================================

-- =========================
-- BANK ACCOUNTS: master
-- =========================
create table if not exists scam_bank_account (
  account_norm varchar(32) primary key,            -- digits only
  bank_name text null,                              -- optional display / last known
  report_count integer not null default 0,
  last_report_at timestamptz null,
  risk_level integer not null default 0,            -- 0-100
  tags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  post_ids uuid[] not null default '{}',
  ctx jsonb null
);

create index if not exists idx_scam_bank_account_updated_at
  on scam_bank_account (updated_at desc);

create index if not exists idx_scam_bank_account_report_count
  on scam_bank_account (report_count desc);

-- optional: ถ้าอยากค้นหาแบบ LIKE prefix ได้เร็ว
create index if not exists idx_scam_bank_account_prefix
  on scam_bank_account (account_norm varchar_pattern_ops);

-- =========================
-- BANK ACCOUNTS: reports (event log)
-- =========================
create table if not exists scam_bank_account_report (
  id bigserial primary key,
  account_norm varchar(32) not null references scam_bank_account(account_norm) on delete cascade,
  bank_name text null,
  category text not null,                           -- SCAM | MONEY_MULE | SALES_ADS | DISPUTE | OTHER
  note text null,

  -- audit / meta
  user_id uuid null,                                -- เก็บ uid ได้ ถ้ามี login (แนะนำเก็บ แต่ไม่โชว์ public)
  client_id text null,
  device_model text null,
  os_version text null,
  app_version text null,
  local_blocked boolean not null default false,

  post_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists idx_bank_report_account_time
  on scam_bank_account_report (account_norm, created_at desc);

create index if not exists idx_bank_report_created_at
  on scam_bank_account_report (created_at desc);

create index if not exists idx_bank_report_user
  on scam_bank_account_report (user_id);

-- =========================
-- Upsert helper: update aggregates
-- =========================
create or replace function upsert_bank_account_aggregate()
returns trigger language plpgsql as $$
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

drop trigger if exists trg_bank_report_agg on scam_bank_account_report;
create trigger trg_bank_report_agg
after insert on scam_bank_account_report
for each row execute function upsert_bank_account_aggregate();

-- =====================================================
-- MIGRATION: 1.29__.sql
-- =====================================================

-- 1) รายงานบัญชีธนาคาร (ดิบ)
CREATE TABLE IF NOT EXISTS scam_bank_account_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name       text NOT NULL,
  account_no      text NOT NULL,
  account_norm    text NOT NULL,  -- normalize เฉพาะตัวเลข
  note            text,
  client_id       text NOT NULL,  -- UUID v4 จาก client กันยิงซ้ำ
  device_model    text,
  os_version      text,
  app_version     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- กัน duplicate report ต่อ client_id (แนะนำ)
CREATE UNIQUE INDEX IF NOT EXISTS scam_bank_account_reports_client_id_ux
ON scam_bank_account_reports (client_id);

-- สำหรับค้นหา prefix/exact เร็ว ๆ
CREATE INDEX IF NOT EXISTS scam_bank_account_reports_norm_idx
ON scam_bank_account_reports (account_norm);

CREATE INDEX IF NOT EXISTS scam_bank_account_reports_bank_idx
ON scam_bank_account_reports (bank_name);


-- 2) summary (aggregate)
CREATE TABLE IF NOT EXISTS scam_bank_accounts_summary (
  bank_name       text NOT NULL,
  account_no      text NOT NULL,      -- เก็บต้นฉบับ (ตัวเลขล้วนหรือมีขีดก็ได้)
  account_norm    text NOT NULL,      -- ตัวเลขล้วน
  report_count    int  NOT NULL DEFAULT 0,
  last_report_at  timestamptz,
  risk_level      int  NOT NULL DEFAULT 10,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bank_name, account_norm)
);

CREATE INDEX IF NOT EXISTS scam_bank_accounts_summary_norm_idx
ON scam_bank_accounts_summary (account_norm);

CREATE INDEX IF NOT EXISTS scam_bank_accounts_summary_updated_idx
ON scam_bank_accounts_summary (updated_at);


-- 3) trigger aggregate (after insert report -> upsert summary)
CREATE OR REPLACE FUNCTION trg_agg_scam_bank_account() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scam_bank_account_reports_agg_tg ON scam_bank_account_reports;

CREATE TRIGGER scam_bank_account_reports_agg_tg
AFTER INSERT ON scam_bank_account_reports
FOR EACH ROW
EXECUTE FUNCTION trg_agg_scam_bank_account();

-- =====================================================
-- MIGRATION: 1.30___.sql
-- =====================================================

CREATE UNIQUE INDEX IF NOT EXISTS scam_bank_account_reports_client_id_ux
ON scam_bank_account_reports (client_id);

-- =====================================================
-- MIGRATION: 1.31__.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS scam_phone_unblocks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  phone text NOT NULL,
  client_id uuid NOT NULL,
  device_model text,
  os_version text,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scam_phone_unblocks_phone ON scam_phone_unblocks(phone);
CREATE INDEX IF NOT EXISTS idx_scam_phone_unblocks_user ON scam_phone_unblocks(user_id);



ALTER TABLE scam_bank_account_reports
ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS idx_sbar_user_created
ON scam_bank_account_reports (user_id, created_at DESC);

COMMIT;
