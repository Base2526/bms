-- =============================================================
-- 9.93  Board-game identity holds: the card at the counter while a box is out
-- -------------------------------------------------------------
-- A cafe hands a 2,000-baht boxed game to a stranger who sat down twenty
-- minutes ago, and holds an ID card until the box comes back.  Today that card
-- is a slip of paper in the drawer: the shop cannot answer "whose card is this"
-- or "did we give it back", and the number is written in the open.
--
-- Shape, and why:
--   * A hold belongs to the **visit**, not to the member.  The question it
--     answers is "which cards are in the drawer right now", which is about a
--     physical object at the counter, not about a CRM row.  `customer_id` is a
--     convenience link and is `SET NULL` on purpose: deleting a customer must
--     never be blocked by a card the shop already handed back.
--   * The number is stored with `encryptSecret()` (`lib/bms/crypto.ts`), the
--     same envelope channel tokens use.  Production refuses to encrypt without
--     `BMS_SECRET_KEY`, which is the right answer here: an ID number must not
--     be sealed with a key that is readable in the source.
--   * `document_number_tail` is the last 4 characters in the clear.  Without it
--     every "find this card in the drawer" would need a decrypt, and a reveal
--     that happens forty times a day stops being an exceptional act.
--   * **Releasing a hold purges it.**  The number exists to answer "who walked
--     out with our game"; once the card is back in the guest's hand there is no
--     question left, so the number, the tail and the holder's name are cleared
--     in the same transaction and `purged_at` is stamped.  The row survives as a
--     tombstone: kind, times and the two staff members stay, so "did we give it
--     back, and who handed it over" is still answerable (the `9.28` lesson —
--     erasing the evidence that evidence existed answers nothing).
--     A hold that is still HELD deliberately keeps its number: that is the open
--     incident the number was recorded for.
--   * Reading a stored number is its own act with its own permission
--     (`board_game.identity.reveal`, Manager only) and its own audit row.
--     Taking a card is counter work; reading the number back out is not.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_board_game_identity_holds (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id               UUID NOT NULL,
  -- การ์ดผูกกับ "การมาเล่นครั้งนี้" · session ตายเมื่อไร แถวนี้ตายตาม (เหมือนผู้เล่นและใบยืม)
  session_id                UUID NOT NULL,
  -- ใบยืมที่การ์ดนี้ค้ำไว้ ถ้าระบุ · ไม่บังคับ เพราะร้านมักรับบัตรใบเดียวต่อกลุ่ม ไม่ใช่ต่อกล่อง
  loan_id                   UUID,
  -- ลิงก์ไป CRM เมื่อผู้ถือเป็นสมาชิก · SET NULL โดยตั้งใจ (อ่านหัวไฟล์)
  customer_id               UUID,
  document_kind             TEXT NOT NULL
                              CHECK (document_kind IN
                                ('NATIONAL_ID', 'PASSPORT', 'STUDENT_ID', 'DRIVER_LICENSE', 'OTHER')),
  -- ชื่อบนบัตร — จำเป็นตอนหาบัตรใบที่ถูกในลิ้นชัก · NULL ได้เฉพาะหลัง purge
  holder_name               TEXT,
  -- ซอง `enc:` ของ `encryptSecret()` · NULL = ไม่ได้บันทึกเลขไว้ หรือถูกล้างหลังคืนบัตร
  document_number_encrypted TEXT,
  document_number_tail      TEXT CHECK (document_number_tail IS NULL
                                        OR length(document_number_tail) BETWEEN 1 AND 8),
  status                    TEXT NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'RETURNED')),
  note                      TEXT,
  taken_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  taken_by                  UUID REFERENCES users(id),
  returned_at               TIMESTAMPTZ,
  returned_by               UUID REFERENCES users(id),
  purged_at                 TIMESTAMPTZ,
  take_idempotency_key      TEXT,
  take_request_hash         TEXT,
  version                   INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id)
    REFERENCES bms_board_game_sessions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, loan_id)
    REFERENCES bms_board_game_session_games(tenant_id, id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id)
    REFERENCES bms_customers(tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT bms_board_game_identity_holds_return_shape
    CHECK ((status = 'RETURNED') = (returned_at IS NOT NULL)),
  -- ล้างเลขของบัตรที่ยังอยู่ในลิ้นชักไม่ได้ — เลขคือสิ่งเดียวที่ตอบได้ว่าใครถือของร้านไป
  CONSTRAINT bms_board_game_identity_holds_purge_after_return
    CHECK (purged_at IS NULL OR status = 'RETURNED'),
  -- purge แล้วต้องไม่เหลือข้อมูลส่วนบุคคลสักช่อง · เหลือช่องเดียวก็คือยังเก็บอยู่
  CONSTRAINT bms_board_game_identity_holds_purge_is_complete
    CHECK (purged_at IS NULL
           OR (holder_name IS NULL
               AND document_number_encrypted IS NULL
               AND document_number_tail IS NULL))
);

-- คีย์รับบัตรซ้ำ — คำขอเดิมที่ยิงซ้ำต้องได้แถวเดิม ไม่ใช่บัตรใบที่สองของคนเดียวกัน
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_identity_holds_take_key
  ON bms_board_game_identity_holds (tenant_id, take_idempotency_key)
  WHERE take_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_board_game_identity_holds_session
  ON bms_board_game_identity_holds (tenant_id, session_id, taken_at);
-- คำถามประจำวันของเคาน์เตอร์: "ตอนนี้เราถือบัตรใครอยู่บ้าง"
CREATE INDEX IF NOT EXISTS idx_bms_board_game_identity_holds_open
  ON bms_board_game_identity_holds (tenant_id, location_id, taken_at)
  WHERE status = 'HELD';

ALTER TABLE bms_board_game_identity_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_identity_holds FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bms_board_game_identity_holds_tenant_isolation
  ON bms_board_game_identity_holds;
CREATE POLICY bms_board_game_identity_holds_tenant_isolation
  ON bms_board_game_identity_holds
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_board_game_identity_holds TO bms_app;

SELECT public.create_revision_trigger('bms_board_game_identity_holds');

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager', 'board_game.identity.reveal')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

COMMENT ON TABLE bms_board_game_identity_holds IS
  'An identity document held at the counter while a game copy is out. Releasing it purges the number, the tail and the name in the same transaction; the row stays as proof the card was taken and given back.';
COMMENT ON COLUMN bms_board_game_identity_holds.document_number_encrypted IS
  'enc: envelope from encryptSecret(). Never leaves the server except through the audited reveal action.';
COMMENT ON COLUMN bms_board_game_identity_holds.document_number_tail IS
  'Last 4 characters in the clear so staff can find the card in the drawer without a reveal.';
COMMENT ON COLUMN bms_board_game_identity_holds.purged_at IS
  'Set when the card went back to the guest. A HELD hold keeps its number on purpose: that is the open incident.';

COMMIT;

-- ROLLBACK:
-- Only while no card is still HELD -- dropping the table while a drawer holds
-- cards destroys the only record of whose they are.
-- DROP TABLE IF EXISTS bms_board_game_identity_holds;
-- DELETE FROM bms_role_permissions WHERE permission = 'board_game.identity.reveal';
