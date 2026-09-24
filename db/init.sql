BEGIN;

-- ===========================================================
--  Enable required extensions
-- ===========================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  avatar TEXT,
  phone TEXT,
  email TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'Subscriber',
  meta TEXT,
  fake_test BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'public',
  meta TEXT,
  fake_test BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_muted BOOLEAN NOT NULL DEFAULT FALSE,
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===========================================================
--  SCHEMA VERSION
-- ===========================================================
CREATE TABLE IF NOT EXISTS schema_version (
  id INT PRIMARY KEY DEFAULT 1,
  version TEXT NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO schema_version (id, version)
VALUES (1, '1.0')
ON CONFLICT (id) DO NOTHING;

UPDATE schema_version
SET version = '1.1',
    applied_at = NOW()
WHERE id = 1;

-- Do not create a built-in administrator here.  The old seed referenced
-- roles/role_id before the role migration had created them and used a public
-- default password.  Every deployment now provisions its first tenant and
-- administrator explicitly after all migrations have completed.

COMMIT;
