-- =============================================================
-- 7.96  BMS membership (tier) + loyalty points + order discount breakdown
-- -------------------------------------------------------------
-- ก่อนหน้านี้ POS ขายแบบไม่ผูกลูกค้าเลย (createOrder ได้ channel='pos' โดยไม่มี
-- customerRef → customer_id = NULL ทุกบิล) ผลข้างเคียงคือ per_customer_limit
-- ของคูปองไม่มีผลที่หน้าร้าน migration นี้เปิดทางให้ POS ผูกลูกค้าได้ และเพิ่ม
-- สมาชิก 3 ชั้น:
--   1) tier      → ส่วนลดอัตโนมัติทุกบิล (auto-apply)
--   2) คูปอง     → ของเดิม (bms_coupons) ไม่แตะ
--   3) แต้มสะสม  → แลกเป็นส่วนลดตามอัตราที่ร้านตั้ง
--
-- หลักการที่ยึด (ตรงกับ Square Loyalty API และข้อกำหนดบัญชี IFRS 15):
--   * balance เป็น cache ความจริงคือ SUM(points) ใน bms_loyalty_ledger
--   * ledger เป็น append-only ทุกแถวอ้าง order/return ที่ทำให้เกิด
--   * UNIQUE (tenant_id, order_id, kind) กันแต้มซ้ำจาก POS replay (idempotencyKey)
--   * แต้มค้าง = หนี้สิน → ต้องรายงานได้ตลอดเวลา
--   * ยอดส่วนลดทุกชั้นต้องรวมอยู่ใน bms_orders.discount_amount เพื่อให้ฐาน VAT
--     และใบกำกับ (7.88) ถูกต้อง — bms_order_discounts เป็นแค่รายละเอียดว่ายอดนั้น
--     มาจากไหน ไม่ใช่แหล่งความจริงของยอดรวม
-- =============================================================

-- ---- 1. ตั้งค่าโปรแกรมสะสมแต้ม (1 แถวต่อร้าน) -----------------------
CREATE TABLE IF NOT EXISTS bms_loyalty_settings (
  tenant_id               UUID PRIMARY KEY REFERENCES bms_tenants(id) ON DELETE CASCADE,
  enabled                 BOOLEAN NOT NULL DEFAULT FALSE,
  -- SPEND = ได้แต้มตามยอด · VISIT = ได้แต้มต่อครั้งที่ซื้อถึงยอดขั้นต่ำ
  earn_mode               TEXT NOT NULL DEFAULT 'SPEND' CHECK (earn_mode IN ('SPEND','VISIT')),
  -- SPEND: แต้มที่ได้ = floor(ฐาน × earn_points_per_baht)
  earn_points_per_baht    NUMERIC(10,4) NOT NULL DEFAULT 1 CHECK (earn_points_per_baht >= 0),
  -- VISIT: ได้ visit_points ต่อบิล เมื่อยอดถึง earn_min_spend
  visit_points            INTEGER NOT NULL DEFAULT 1 CHECK (visit_points >= 0),
  earn_min_spend          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (earn_min_spend >= 0),
  -- ฐานคิดแต้ม: AFTER_DISCOUNT = หลังหักส่วนลดทุกชั้น (default — กันส่วนลดปั๊มแต้ม)
  earn_base               TEXT NOT NULL DEFAULT 'AFTER_DISCOUNT'
                          CHECK (earn_base IN ('AFTER_DISCOUNT','BEFORE_DISCOUNT')),
  -- อัตราแลก: redeem_points_per_unit แต้ม = redeem_baht_per_unit บาท
  redeem_points_per_unit  INTEGER NOT NULL DEFAULT 100 CHECK (redeem_points_per_unit > 0),
  redeem_baht_per_unit    NUMERIC(12,2) NOT NULL DEFAULT 10 CHECK (redeem_baht_per_unit > 0),
  redeem_min_points       INTEGER NOT NULL DEFAULT 100 CHECK (redeem_min_points >= 0),
  -- เพดานส่วนลดรวมทุกชั้นต่อบิล (% ของค่าสินค้า) — 100 = ไม่จำกัด
  max_discount_pct        NUMERIC(5,2) NOT NULL DEFAULT 100
                          CHECK (max_discount_pct > 0 AND max_discount_pct <= 100),
  -- อายุแต้มนับจากวันที่ได้ · 0 = ไม่หมดอายุ
  points_expire_months    INTEGER NOT NULL DEFAULT 24 CHECK (points_expire_months >= 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN bms_loyalty_settings.max_discount_pct IS
  'เพดานส่วนลดรวม (tier + คูปอง + แต้ม + ส่วนลดมือ) ต่อบิล คิดเป็น % ของค่าสินค้า';

-- ---- 2. ชั้นสมาชิก --------------------------------------------------
CREATE TABLE IF NOT EXISTS bms_membership_tiers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  discount_type     TEXT NOT NULL DEFAULT 'NONE' CHECK (discount_type IN ('NONE','PERCENT','FIXED')),
  discount_value    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  -- เกณฑ์เข้าชั้น: ยอดซื้อสะสม 12 เดือน หรือ แต้มสะสมตลอดชีพ (อันไหนถึงก่อนก็ได้)
  qualify_spend_12m NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (qualify_spend_12m >= 0),
  qualify_points    INTEGER NOT NULL DEFAULT 0 CHECK (qualify_points >= 0),
  -- ชั้นสูงกว่า = sort_order มากกว่า · ชั้นเริ่มต้นของสมาชิกใหม่คือ sort_order ต่ำสุด
  sort_order        INTEGER NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  -- PERCENT ต้องไม่เกิน 100 ไม่งั้นบิลติดลบ
  CHECK (discount_type <> 'PERCENT' OR discount_value <= 100)
);

CREATE INDEX IF NOT EXISTS idx_bms_membership_tiers_tenant
  ON bms_membership_tiers (tenant_id, sort_order);

-- ---- 3. ลูกค้า → สมาชิก --------------------------------------------
-- ไม่แตะ users และไม่เปิด revision ให้ตารางนี้ (ดู 7.22/7.24)
ALTER TABLE bms_customers
  ADD COLUMN IF NOT EXISTS member_no         TEXT,
  ADD COLUMN IF NOT EXISTS member_since      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier_id           UUID REFERENCES bms_membership_tiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tier_reviewed_at  TIMESTAMPTZ,
  -- cache เท่านั้น — ยอดจริงคือ SUM(points) จาก ledger (ติดลบได้เมื่อคืนสินค้า)
  ADD COLUMN IF NOT EXISTS points_balance    INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN bms_customers.points_balance IS
  'cache ของ SUM(bms_loyalty_ledger.points) — ติดลบได้ (คืนสินค้าหลังใช้แต้มไปแล้ว)';

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_customers_member_no
  ON bms_customers (tenant_id, member_no) WHERE member_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_customers_tier
  ON bms_customers (tenant_id, tier_id) WHERE tier_id IS NOT NULL;

-- ---- 4. ledger แต้ม (append-only) -----------------------------------
CREATE TABLE IF NOT EXISTS bms_loyalty_ledger (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES bms_customers(id) ON DELETE CASCADE,
  -- EARN   ได้แต้มจากการซื้อ (+)
  -- REDEEM แลกแต้มเป็นส่วนลด (−)
  -- REVERSE ดึงแต้มคืนเพราะคืนสินค้า/ยกเลิกบิล (+/−)
  -- EXPIRE แต้มหมดอายุ (−)
  -- ADJUST ปรับด้วยมือโดยผู้มีสิทธิ์ (+/−)
  kind            TEXT NOT NULL CHECK (kind IN ('EARN','REDEEM','REVERSE','EXPIRE','ADJUST')),
  points          INTEGER NOT NULL CHECK (points <> 0),
  order_id        UUID REFERENCES bms_orders(id) ON DELETE SET NULL,
  pos_return_id   UUID REFERENCES bms_pos_returns(id) ON DELETE SET NULL,
  -- เฉพาะแถวที่ให้แต้ม (points > 0): วันหมดอายุของก้อนนี้ · NULL = ไม่หมดอายุ
  expires_at      TIMESTAMPTZ,
  -- เฉพาะแถวที่ให้แต้ม: ถูกใช้/หมดอายุไปแล้วกี่แต้ม (FIFO consume)
  -- ไม่ใช่ยอดคงเหลือรวมของลูกค้า — ยอดนั้นคือ SUM(points) ทั้ง ledger
  consumed_points INTEGER NOT NULL DEFAULT 0 CHECK (consumed_points >= 0),
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- EARN ต้องเป็นบวก · REDEEM/EXPIRE ต้องเป็นลบ (REVERSE/ADJUST ไปได้ 2 ทาง)
  CHECK (kind <> 'EARN'   OR points > 0),
  CHECK (kind <> 'REDEEM' OR points < 0),
  CHECK (kind <> 'EXPIRE' OR points < 0),
  -- consumed_points ใช้ได้กับ "แถวที่ให้แต้ม" ทุกชนิด (EARN, ADJUST บวก,
  -- REVERSE บวกจากการคืนแต้มที่แลกไป) ไม่ใช่เฉพาะ EARN
  CHECK (consumed_points = 0 OR points > 0),
  CHECK (points <= 0 OR consumed_points <= points)
);

-- กันแต้มซ้ำเมื่อเครื่อง POS ยิงบิลเดิมซ้ำ (idempotencyKey → order เดิม)
-- REVERSE ไม่รวมเพราะ partial return หลายครั้งต่อบิลเดียวเป็นเรื่องปกติ
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_loyalty_ledger_order_kind
  ON bms_loyalty_ledger (tenant_id, order_id, kind)
  WHERE order_id IS NOT NULL AND kind IN ('EARN','REDEEM');

-- partial return 1 ครั้ง = REVERSE ได้ชุดเดียว
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_loyalty_ledger_return
  ON bms_loyalty_ledger (tenant_id, pos_return_id, kind)
  WHERE pos_return_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_loyalty_ledger_customer
  ON bms_loyalty_ledger (tenant_id, customer_id, created_at DESC);
-- คิว FIFO ของแต้มที่ยังใช้ได้ (ใช้ตอนแลกแต้มและตอนตัดแต้มหมดอายุ)
-- ก้อนที่หมดอายุก่อนต้องถูกใช้ก่อน ก้อนไม่มีวันหมดอายุอยู่ท้ายคิว
CREATE INDEX IF NOT EXISTS idx_bms_loyalty_ledger_open_grants
  ON bms_loyalty_ledger (tenant_id, customer_id, expires_at NULLS LAST, id)
  WHERE points > 0;

-- ---- 5. รายละเอียดส่วนลดต่อบิล -------------------------------------
-- bms_orders.discount_amount ยังเป็นยอดรวมเหมือนเดิม (ใบกำกับ/VAT ใช้ค่านั้น)
-- ตารางนี้ตอบว่า "ยอดนั้นมาจากอะไร" ซึ่งเดิมตอบไม่ได้เมื่อมีส่วนลดหลายชั้น
CREATE TABLE IF NOT EXISTS bms_order_discounts (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES bms_orders(id) ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN ('TIER','COUPON','POINTS','MANUAL')),
  -- tier_id / coupon_id ตาม source · POINTS/MANUAL ไม่มี ref
  ref_id        UUID,
  -- ข้อความที่พิมพ์บนใบเสร็จ เช่น "สมาชิก Gold −5%" (snapshot ตอนขาย)
  label         TEXT NOT NULL,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  -- เฉพาะ source='POINTS'
  points_used   INTEGER NOT NULL DEFAULT 0 CHECK (points_used >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, source),
  CHECK (points_used = 0 OR source = 'POINTS')
);

CREATE INDEX IF NOT EXISTS idx_bms_order_discounts_order
  ON bms_order_discounts (tenant_id, order_id);

-- ---- 6. RLS + GRANT (copy 4.2 / 4.3) -------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_loyalty_settings',
    'bms_membership_tiers',
    'bms_loyalty_ledger',
    'bms_order_discounts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_loyalty_settings,
  bms_membership_tiers,
  bms_loyalty_ledger,
  bms_order_discounts
TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- 7. permission ใหม่ + seed ให้ทุกร้าน --------------------------
-- ลืมข้อนี้ = หน้าใหม่โดน 403 เงียบ ๆ โดยไม่ logout (apollo errorLink เตะเฉพาะ 401)
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','member.view'),
  ('Manager','member.manage'),
  ('Manager','loyalty.adjust'),
  ('Manager','loyalty.settings'),
  ('Sales','member.view'),
  ('Sales','member.manage'),
  ('Cashier','member.view'),
  ('Cashier','member.manage')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

-- ---- 8. ค่าเริ่มต้นต่อร้าน (ปิดไว้ก่อน ร้านค่อยเปิดเอง) -------------
INSERT INTO bms_loyalty_settings (tenant_id)
SELECT id FROM bms_tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- ชั้นสมาชิกตั้งต้น 3 ชั้น — ร้านแก้/ลบได้ ไม่มีชั้นไหนถูกอ้างจากโค้ดด้วย code
INSERT INTO bms_membership_tiers
  (tenant_id, code, name, discount_type, discount_value, qualify_spend_12m, qualify_points, sort_order)
SELECT t.id, v.code, v.name, v.dtype, v.dvalue, v.spend, 0, v.sort
FROM bms_tenants t
CROSS JOIN (VALUES
  ('SILVER', 'Silver', 'NONE',       0::numeric,     0::numeric, 0),
  ('GOLD',   'Gold',   'PERCENT',    3::numeric,  5000::numeric, 1),
  ('PLATINUM','Platinum','PERCENT',  5::numeric, 20000::numeric, 2)
) AS v(code, name, dtype, dvalue, spend, sort)
ON CONFLICT (tenant_id, code) DO NOTHING;
