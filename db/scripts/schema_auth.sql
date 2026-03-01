-- =============================================
-- AUTO-GENERATED SCHEMA FILE (DO NOT EDIT)
-- Output: db/schema_auth.sql
-- GeneratedAt: 2026-03-01T10:44:20.255843+00:00
-- Included migrations:
--  - 1.2__create_sessions.sql
--  - 1.8__password_reset_tokens.sql
--  - 1.13__users_username-language.sql
--  - 1.15__users-provider.sql
--  - 1.21__email_templates.sql
--  - 1.22__email_verify_tokens.sql
--  - 1.24__roles.sql
-- =============================================

BEGIN;

-- =====================================================
-- MIGRATION: 1.2__create_sessions.sql
-- =====================================================


CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expired_at TIMESTAMP NOT NULL
);

-- ล้าง session ที่หมดอายุอัตโนมัติ (รันด้วย cron/job ฝั่งแอปก็ได้)
-- DELETE FROM sessions WHERE expired_at <= NOW();


-- =====================================================
-- MIGRATION: 1.8__password_reset_tokens.sql
-- =====================================================

-- รันอันนี้ก่อน (กันมีตารางหลงเหลือ)
DROP TABLE IF EXISTS password_reset_tokens CASCADE;

-- จากนั้นสร้างใหม่ด้วยชนิด uuid
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,      -- ใช้ timestamptz จะชัดเจนเรื่อง timezone
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prt_userid ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_prt_token  ON password_reset_tokens(token);

-- =====================================================
-- MIGRATION: 1.13__users_username-language.sql
-- =====================================================


-- ✅ เพิ่มคอลัมน์ใหม่ ถ้ายังไม่มี
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

-- ✅ อัปเดต username ให้ผู้ใช้เดิม (ถ้ายังไม่มี)
-- เช่น ใช้ email ก่อน @ เป็นค่าเริ่มต้น
UPDATE users
SET username = SPLIT_PART(email, '@', 1)
WHERE (username IS NULL OR username = '')
  AND email IS NOT NULL;

-- ✅ กำหนดค่า language เริ่มต้นให้ผู้ใช้เก่าที่ว่าง
UPDATE users
SET language = 'en'
WHERE language IS NULL OR language = '';

-- ✅ อัปเดต timestamp
ALTER TABLE users ALTER COLUMN language SET NOT NULL;

-- ✅ อัปเดตเวอร์ชันในตาราง schema_version
INSERT INTO schema_version (id, version, applied_at)
VALUES (1, '1.2', NOW())
ON CONFLICT (id) DO UPDATE
SET version = '1.2', applied_at = NOW();


-- =====================================================
-- MIGRATION: 1.15__users-provider.sql
-- =====================================================

ALTER TABLE users
ADD COLUMN provider TEXT NOT NULL DEFAULT 'password',  -- password | google | facebook
ADD COLUMN provider_id TEXT;                           -- google.sub | facebook.id

-- =====================================================
-- MIGRATION: 1.21__email_templates.sql
-- =====================================================

-- 001_create_email_templates.sql
CREATE TABLE IF NOT EXISTS email_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT NOT NULL,              -- e.g. "auth.verify", "auth.reset"
  locale        TEXT NOT NULL DEFAULT 'en', -- e.g. "en", "th"
  version       INT  NOT NULL DEFAULT 1,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_published  BOOLEAN NOT NULL DEFAULT TRUE,

  subject_tpl   TEXT NOT NULL,              -- handlebars template
  html_tpl      TEXT NOT NULL,              -- handlebars template
  text_tpl      TEXT,                       -- optional

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(key, locale, version)
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_templates_updated_at ON email_templates;
CREATE TRIGGER trg_email_templates_updated_at
BEFORE UPDATE ON email_templates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ช่วยให้ query เร็ว
CREATE INDEX IF NOT EXISTS idx_email_templates_lookup
ON email_templates (key, locale, is_active, is_published, version DESC);

-- =====================================================
-- MIGRATION: 1.22__email_verify_tokens.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS email_verify_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- MIGRATION: 1.24__roles.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS public.roles (
    id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    key text UNIQUE NOT NULL,          -- admin, staff, subscriber
    name text NOT NULL,
    description text,
    is_system boolean DEFAULT false,
    created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.permissions (
    id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    key text UNIQUE NOT NULL,          -- user.read, report.export
    description text,
    created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id uuid REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id uuid REFERENCES public.permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    role_id uuid REFERENCES public.roles(id) ON DELETE CASCADE,
    assigned_by uuid REFERENCES public.users(id),
    assigned_at timestamptz DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id, role_id)
);

INSERT INTO roles (key, name, description, is_system) VALUES
('admin', 'Administrator', 'Full access', true),
('staff', 'Staff', 'Backoffice staff', true),
('subscriber', 'Subscriber', 'Normal user', true);

INSERT INTO permissions (key, description) VALUES
('user.read', 'Read users'),
('user.update', 'Update users'),
('user.delete', 'Delete users'),

('role.manage', 'Manage roles'),
('content.read', 'Read content'),
('content.create', 'Create content'),
('content.update', 'Update content');

/*
-- admin = everything
INSERT INTO role_permissions
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.key = 'admin';

-- staff
INSERT INTO role_permissions
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key IN (
  'user.read',
  'content.read',
  'content.create',
  'content.update'
)
WHERE r.key = 'staff';

-- subscriber
INSERT INTO role_permissions
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'content.read'
WHERE r.key = 'subscriber';

*/

/*
Migration จาก users.role เดิม (ครั้งเดียวจบ)
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.key = lower(u.role);


หลังจาก verify เสร็จ:
ALTER TABLE users DROP COLUMN role;


เช็ค permission
SELECT EXISTS (
  SELECT 1
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = $1
    AND p.key = $2
);
*/

COMMIT;
