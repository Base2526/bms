-- =============================================================
-- 9.92  Board-game member passes: time a member already paid for
-- -------------------------------------------------------------
-- A cafe sells a monthly pass ("play all you want in September") or an hour
-- bundle ("20 hours, use them any time this quarter"). Until now the only way
-- to honour one was to type a manual discount at the counter, which leaves no
-- record of what the pass actually covered, lets the same 20 hours be spent at
-- two tables at once, and makes "was this pass worth selling?" unanswerable.
--
-- Shape, and why:
--   * A pass is **not a Product**. Like play time itself (`9.80`) it has no SKU
--     and never moves stock; it is an entitlement held by a member.
--   * The minute balance lives in a **ledger**, with the row's
--     `remaining_minutes` as a cache — the same rule store credit (`8.9`) and
--     loyalty points (`7.96`) follow. A counter that some write path forgets to
--     update drifts silently and nobody learns when it started.
--   * Consumption is recorded for an UNLIMITED pass too, with no balance to
--     decrement. "What did this pass save the member?" is a question the shop
--     will ask, and it cannot be reconstructed after the fact.
--   * `remaining_minutes` is NULL for UNLIMITED. Not 0 (which reads as "used
--     up") and not a large number (which is a lie that eventually runs out).
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bms_board_game_pass_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  -- NULL = ขายได้ทุกสาขา · มีค่า = แพ็กเกจของสาขานั้นสาขาเดียว
  location_id       UUID,
  code              TEXT NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 40),
  name              TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  kind              TEXT NOT NULL CHECK (kind IN ('UNLIMITED', 'MINUTES')),
  price             NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  duration_days     INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
  included_minutes  INTEGER CHECK (included_minutes IS NULL OR included_minutes > 0),
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  version           INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id),
  -- จำนวนนาทีที่ให้มาเป็นสิ่งที่แยกสองชนิดออกจากกัน — ไม่ใช่ฟิลด์ที่เผลอเว้นได้
  CONSTRAINT bms_board_game_pass_plans_minutes_shape
    CHECK ((kind = 'MINUTES') = (included_minutes IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS bms_board_game_member_passes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  -- แพ็กเกจเป็นของคน ไม่ใช่ของโต๊ะ · RESTRICT เพราะแถวนี้คือหลักฐานว่าใครจ่ายอะไรไว้
  customer_id            UUID NOT NULL REFERENCES bms_customers(id),
  plan_id                UUID,
  -- snapshot ของแพ็กเกจ ณ วันที่ขาย · ร้านขึ้นราคาหรือเปลี่ยนชื่อแพ็กเกจแล้วต้องไม่เขียน
  -- สัญญาที่ขายไปแล้วใหม่ (กฎเดียวกับ rate snapshot ของผู้เล่นใน `9.80`)
  plan_code              TEXT NOT NULL,
  plan_name              TEXT NOT NULL,
  kind                   TEXT NOT NULL CHECK (kind IN ('UNLIMITED', 'MINUTES')),
  included_minutes       INTEGER CHECK (included_minutes IS NULL OR included_minutes > 0),
  price_paid             NUMERIC(12,2) NOT NULL CHECK (price_paid >= 0),
  -- NULL = ไม่มีโควตา (UNLIMITED) · ไม่ใช่ 0 ซึ่งอ่านว่า "ใช้หมดแล้ว"
  remaining_minutes      INTEGER CHECK (remaining_minutes IS NULL OR remaining_minutes >= 0),
  starts_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at             TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'ACTIVE'
                           CHECK (status IN ('ACTIVE', 'EXPIRED', 'CANCELLED')),
  -- บิลที่รับเงินค่าแพ็กเกจ ถ้าขายผ่านเครื่องขาย · SET NULL เหมือน ledger ของเครดิตร้าน
  order_id               UUID REFERENCES bms_orders(id) ON DELETE SET NULL,
  issue_idempotency_key  TEXT,
  issue_request_hash     TEXT,
  cancel_reason          TEXT,
  issued_by              UUID REFERENCES users(id),
  note                   TEXT,
  version                INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id)
    REFERENCES bms_board_game_pass_plans(tenant_id, id),
  CONSTRAINT bms_board_game_member_passes_minutes_shape
    CHECK ((kind = 'MINUTES') = (remaining_minutes IS NOT NULL)),
  CONSTRAINT bms_board_game_member_passes_period_shape
    CHECK (expires_at > starts_at),
  CONSTRAINT bms_board_game_member_passes_cancel_shape
    CHECK ((status = 'CANCELLED') = (cancel_reason IS NOT NULL))
);

-- คีย์ออกแพ็กเกจซ้ำ — คำขอเดิมที่ยิงซ้ำต้องได้สัญญาใบเดิม ไม่ใช่ใบที่สอง
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_member_passes_issue_key
  ON bms_board_game_member_passes (tenant_id, issue_idempotency_key)
  WHERE issue_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_board_game_member_passes_customer
  ON bms_board_game_member_passes (tenant_id, customer_id, expires_at DESC);
-- เส้นที่ร้อนที่สุด: ตอนปิดบิลต้องหาว่า "คนกลุ่มนี้ใครถือแพ็กเกจที่ยังใช้ได้อยู่บ้าง"
CREATE INDEX IF NOT EXISTS idx_bms_board_game_member_passes_active
  ON bms_board_game_member_passes (tenant_id, customer_id, starts_at, expires_at)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS bms_board_game_pass_ledger (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  pass_id           UUID NOT NULL REFERENCES bms_board_game_member_passes(id) ON DELETE CASCADE,
  -- ISSUE   = ออกแพ็กเกจ (บวก · UNLIMITED ลงเป็น 0 เพราะไม่มีโควตาให้บวก)
  -- CONSUME = แพ็กเกจจ่ายค่าเวลาให้รอบนี้ (ลบ)
  -- REVERSE = โต๊ะถูกยกเลิกหลังปิดบิล คืนนาทีกลับ (บวก)
  -- EXPIRE  = หมดอายุ · ADJUST = ปรับด้วยมือ (ต้องมีเหตุผล)
  kind              TEXT NOT NULL CHECK (kind IN ('ISSUE', 'CONSUME', 'REVERSE', 'EXPIRE', 'ADJUST')),
  minutes           INTEGER NOT NULL,
  -- มูลค่าที่แพ็กเกจจ่ายแทนลูกค้าไปจริงในรอบนั้น — ตอบ "แพ็กเกจนี้คุ้มไหม" ได้โดยไม่ต้อง
  -- ไปคูณอัตราย้อนหลัง ซึ่งอัตราอาจถูกแก้ไปแล้ว
  covered_amount    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (covered_amount >= 0),
  billing_group_id  UUID,
  participant_id    UUID,
  actor_user_id     UUID REFERENCES users(id),
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, billing_group_id)
    REFERENCES bms_board_game_billing_groups(tenant_id, id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, participant_id)
    REFERENCES bms_board_game_session_participants(tenant_id, id) ON DELETE SET NULL
);

-- หนึ่งครั้งต่อ (แพ็กเกจ, บิล, คน) ทั้งขาใช้และขาคืน
--
-- ปิดบิลซ้ำด้วยคีย์เดิม (replay) และการยกเลิกโต๊ะที่ยิงซ้ำต้องไม่หักหรือคืนนาทีสองรอบ ·
-- ดัชนีก้อนเดียวใช้ไม่ได้เพราะ CONSUME กับ REVERSE ของคู่เดียวกันต้องอยู่ร่วมกันได้
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_pass_ledger_consume
  ON bms_board_game_pass_ledger (tenant_id, pass_id, billing_group_id, participant_id)
  WHERE kind = 'CONSUME';
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_board_game_pass_ledger_reverse
  ON bms_board_game_pass_ledger (tenant_id, pass_id, billing_group_id, participant_id)
  WHERE kind = 'REVERSE';
CREATE INDEX IF NOT EXISTS idx_bms_board_game_pass_ledger_pass
  ON bms_board_game_pass_ledger (tenant_id, pass_id, created_at DESC);

ALTER TABLE bms_board_game_pass_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_pass_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_member_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_member_passes FORCE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_pass_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_board_game_pass_ledger FORCE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'bms_board_game_pass_plans',
    'bms_board_game_member_passes',
    'bms_board_game_pass_ledger'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_isolation', tbl);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, tbl || '_tenant_isolation', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO bms_app', tbl);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE bms_board_game_pass_ledger_id_seq TO bms_app;

SELECT public.create_revision_trigger('bms_board_game_pass_plans');
SELECT public.create_revision_trigger('bms_board_game_member_passes');

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager', 'board_game.pass.manage')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

COMMENT ON TABLE bms_board_game_pass_plans IS
  'Board-game pass catalogue (monthly unlimited or an hour bundle). Not a Product: it has no SKU and never moves stock.';
COMMENT ON TABLE bms_board_game_member_passes IS
  'A member''s bought pass, snapshotted at sale time. Covering play time happens when a billing group is closed, inside that transaction.';
COMMENT ON TABLE bms_board_game_pass_ledger IS
  'Every movement of pass minutes. The balance on the pass row is a cache of this; an UNLIMITED pass records what it covered with no balance to spend.';
COMMENT ON COLUMN bms_board_game_member_passes.remaining_minutes IS
  'Minutes left on a MINUTES pass. NULL for UNLIMITED — "no quota" is not zero left.';

COMMIT;

-- ROLLBACK:
-- Only while no pass has covered a bill. A settled charge snapshot records the
-- covered amount, so dropping the ledger leaves bills whose discount nothing
-- explains. Cancel outstanding passes and refund them first, then:
-- DROP TABLE IF EXISTS bms_board_game_pass_ledger;
-- DROP TABLE IF EXISTS bms_board_game_member_passes;
-- DROP TABLE IF EXISTS bms_board_game_pass_plans;
-- DELETE FROM bms_role_permissions WHERE permission = 'board_game.pass.manage';
