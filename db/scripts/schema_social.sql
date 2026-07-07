-- =============================================
-- AUTO-GENERATED SCHEMA FILE (DO NOT EDIT)
-- Output: db/schema_social.sql
-- GeneratedAt: 2026-03-01T10:44:20.256549+00:00
-- Included migrations:
--  - 1.3__message_receipts.sql
--  - 1.5__messages_soft_delete.sql
--  - 1.6__files.sql
--  - 1.9__post_images.sql
--  - 1.10__bookmarks.sql
--  - 1.11__new-field_post.sql
--  - 1.16__notifications.sql
--  - 1.17__comments.sql
--  - 1.18__message_images.sql
--  - 1.19__messages-reply_to_id.sql
--  - 1.25__social_posts.sql
-- =============================================

BEGIN;

-- =====================================================
-- MIGRATION: 1.3__message_receipts.sql
-- =====================================================

-- 001_message_receipts.sql

CREATE TABLE IF NOT EXISTS message_receipts (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at      TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_receipts_user_read_null
  ON message_receipts (user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_message ON message_receipts (message_id);

CREATE OR REPLACE FUNCTION trg_messages_after_insert__create_receipts()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO message_receipts (message_id, user_id)
  SELECT NEW.id, cm.user_id
  FROM chat_members cm
  WHERE cm.chat_id = NEW.chat_id
    AND cm.user_id <> NEW.sender_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_after_insert__create_receipts ON messages;
CREATE TRIGGER messages_after_insert__create_receipts
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION trg_messages_after_insert__create_receipts();


-- =====================================================
-- MIGRATION: 1.5__messages_soft_delete.sql
-- =====================================================


-- 003_messages_soft_delete.sql
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_messages_chat_deleted ON messages (chat_id, deleted_at);

-- =====================================================
-- MIGRATION: 1.6__files.sql
-- =====================================================

-- Files table for file manager
CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,          -- stored file name on disk
  original_name TEXT,              -- original client name
  mimetype TEXT,
  size BIGINT,
  checksum TEXT,
  relpath TEXT NOT NULL,           -- relative path under STORAGE_DIR
  created_by INT NULL,             -- user id if available (FK to users.id)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_files_created_at ON files (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_name_trgm ON files USING GIN (LOWER(original_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_files_filename_trgm ON files USING GIN (LOWER(filename) gin_trgm_ops);

-- =====================================================
-- MIGRATION: 1.9__post_images.sql
-- =====================================================

DROP TABLE IF EXISTS post_images CASCADE;

CREATE TABLE IF NOT EXISTS post_images (
  id SERIAL PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- MIGRATION: 1.10__bookmarks.sql
-- =====================================================

DROP TABLE IF EXISTS bookmarks CASCADE;

CREATE TABLE IF NOT EXISTS bookmarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, user_id)
);

-- =====================================================
-- MIGRATION: 1.11__new-field_post.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS post_tel_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  tel TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_seller_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  bank_id TEXT,
  bank_name TEXT,
  seller_account TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- เพิ่ม field ใหม่ใน posts
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS first_last_name TEXT,
  ADD COLUMN IF NOT EXISTS id_card TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS transfer_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transfer_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS province_id UUID,
  ADD COLUMN IF NOT EXISTS detail TEXT;

-- =====================================================
-- MIGRATION: 1.16__notifications.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  data            JSONB,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_is_read
  ON notifications (user_id, is_read);

CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id         UUID PRIMARY KEY,
  chat_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  post_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled   BOOLEAN NOT NULL DEFAULT FALSE
);

-- =====================================================
-- MIGRATION: 1.17__comments.sql
-- =====================================================


-- 1) Comments
CREATE TABLE IF NOT EXISTS comments (
  id          UUID PRIMARY KEY,
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES comments(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

-- =====================================================
-- MIGRATION: 1.18__message_images.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS message_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  mime TEXT,
  width INT,
  height INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_images_message_id
  ON message_images (message_id);

ALTER TABLE message_images
ADD COLUMN file_id INTEGER REFERENCES files(id);

-- =====================================================
-- MIGRATION: 1.19__messages-reply_to_id.sql
-- =====================================================

ALTER TABLE messages
ADD COLUMN reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id ON messages(reply_to_id);

-- =====================================================
-- MIGRATION: 1.25__social_posts.sql
-- =====================================================

-- 1) เพิ่ม toggle ใน posts
ALTER TABLE posts
ADD COLUMN IF NOT EXISTS auto_publish boolean NOT NULL DEFAULT false;

-- 2) ตาราง mapping social posts
CREATE TABLE IF NOT EXISTS social_posts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,

  platform text NOT NULL CHECK (platform IN ('facebook','x')),
  social_post_id text,                 -- id ที่ได้จาก FB/X
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED','FAILED','SKIPPED')),
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (post_id, platform)
);

-- 3) updated_at trigger (ถ้าคุณมีแล้วข้ามได้)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_social_posts_updated_at ON social_posts;
CREATE TRIGGER trg_social_posts_updated_at
BEFORE UPDATE ON social_posts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();



ALTER TABLE social_posts
ADD COLUMN IF NOT EXISTS permalink_url text,
ADD COLUMN IF NOT EXISTS published_at timestamptz;

COMMIT;
