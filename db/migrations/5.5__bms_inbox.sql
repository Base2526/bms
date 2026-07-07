-- =============================================================
-- 5.5  BMS Omnichannel Inbox — conversations + messages + notes
-- -------------------------------------------------------------
-- ตาม CLAUDE.md §2: chat history, assign staff, internal notes, tags,
--   customer timeline, search — รวมทุกช่องทางไว้ที่เดียว
--
-- 1 conversation = (tenant, channel, customer_ref) — dedup ต่อลูกค้า/ช่องทาง
-- ทุกข้อความเข้า-ออก (รวมคำตอบ AI) ถูกบันทึกใน bms_messages
-- notes = โน้ตภายในทีม (ลูกค้าไม่เห็น)
-- multi-tenant + RLS เหมือนตาราง BMS อื่น (idempotent)
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,                 -- line / tiktok / facebook / test
  customer_ref    TEXT,                          -- external user id ของช่องทาง
  customer_id     UUID REFERENCES bms_customers(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN','PENDING','CLOSED')),
  assigned_to     TEXT,                          -- email/id ของ staff
  tags            TEXT[] NOT NULL DEFAULT '{}',
  unread          INTEGER NOT NULL DEFAULT 0 CHECK (unread >= 0),
  last_message    TEXT,                          -- preview ข้อความล่าสุด
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, customer_ref)
);

CREATE TABLE IF NOT EXISTS bms_messages (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES bms_conversations(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  body            TEXT NOT NULL,
  sender          TEXT,                          -- customer / ai / staff:<email>
  meta            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bms_conversation_notes (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES bms_conversations(id) ON DELETE CASCADE,
  author          TEXT,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_conv_tenant    ON bms_conversations(tenant_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_conv_assigned  ON bms_conversations(tenant_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_bms_conv_customer  ON bms_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_bms_conv_tags      ON bms_conversations USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_bms_messages_conv  ON bms_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bms_conv_notes     ON bms_conversation_notes(conversation_id, created_at DESC);

-- ---- Row-Level Security (เหมือน 4.2) ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_conversations','bms_messages','bms_conversation_notes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t||'_tenant_isolation', t);
  END LOOP;
END $$;

-- ---- grant ให้ RLS role (เหมือน 4.3) ----
GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_conversations, bms_messages, bms_conversation_notes
  TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
