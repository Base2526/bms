// =============================================================
// คูปอง — กติกาการใช้และเลขส่วนลด ต้องไม่เปลี่ยนเพราะฟีเจอร์ใหม่
// -------------------------------------------------------------
// ก่อนไฟล์นี้ `lib/bms/coupons.ts` (885 บรรทัด) **ไม่มีเทสสักตัวในทั้ง repo** —
// ที่ชุด loyalty แตะคำว่า coupon คือการส่ง `couponDiscount` ที่คำนวณเสร็จแล้วเข้าไป
// เป็น input ของตัวเกลี่ยส่วนลด ไม่ใช่การตรวจว่าเลขนั้นมาถูกต้องหรือเปล่า
//
// ที่ต้องกันเป็นพิเศษ:
//   - โค้ดที่ถูกปฏิเสธ **ห้ามนับ redemption** ไม่งั้นโค้ดจำกัด 100 ครั้งจะถูกเผาทิ้ง
//     โดยลูกค้าที่ยังไม่ได้ซื้ออะไรเลย
//   - ส่วนลดต้องไม่เกินยอดบิล ไม่ว่าจะแบบ % หรือแบบจำนวนเงิน
//   - เพดานเวลา/ยอดขั้นต่ำ/จำนวนครั้ง ต้องตัดสินก่อนแตะฐานข้อมูล
//
// วิธีเทส: `applyCouponInTx` รับ PoolClient เข้ามา จึงป้อน client จำลองที่ตอบตาม SQL
// ที่ถูกถามได้ — เทสนี้จึงตรวจ "กติกา" โดยไม่ต้องมี Postgres ส่วนการล็อกแถว (FOR UPDATE)
// และ RLS เป็นหน้าที่ของชุด -db-contract ไม่ใช่ของไฟล์นี้
//
// ไม่ต้องมี DB รันจาก apps/web:
//   npx tsx --test ../../scripts/coupon-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { applyCouponInTx, couponCodeFromShareText } from "../apps/web/lib/bms/coupons.ts";

const TENANT = "11111111-1111-1111-1111-111111111111";
const CUSTOMER = "22222222-2222-2222-2222-222222222222";
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;

/** แถวคูปองตามคอลัมน์จริงของ bms_coupons (7.21) — ค่าปริยายคือคูปองที่ใช้ได้ */
function couponRow(over: Row = {}): Row {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    code: "SAVE10",
    type: "PERCENT",
    value: "10.00",
    min_order_amount: null,
    max_redemptions: null,
    redemptions_count: 0,
    per_customer_limit: null,
    starts_at: null,
    expires_at: null,
    active: true,
    note: null,
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    ...over,
  };
}

type Stub = {
  query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: Row[] }>;
  sql: string[];
  params: unknown[][];
};

function stubClient(row: Row | null, usedByCustomer = 0): Stub {
  const stub: Stub = {
    sql: [],
    params: [],
    query: async (sql: string, params?: unknown[]) => {
      stub.sql.push(sql);
      stub.params.push(params ?? []);
      if (/FROM bms_coupons/i.test(sql)) {
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (/COUNT\(\*\)/i.test(sql)) {
        return { rowCount: 1, rows: [{ n: String(usedByCustomer) }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  return stub;
}

const apply = (stub: Stub, code: string, subtotal: number, customerId: string | null = CUSTOMER) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyCouponInTx(stub as any, TENANT, code, customerId, subtotal);

/** โค้ดที่ถูกปฏิเสธต้องไม่ไปแตะ redemptions_count — ใช้ซ้ำในเกือบทุกเทสด้านล่าง */
function assertNoRedemptionBurned(stub: Stub) {
  const wrote = stub.sql.some((s) => /UPDATE bms_coupons/i.test(s));
  assert.equal(wrote, false, "โค้ดที่ใช้ไม่ได้ต้องไม่ถูกนับว่าใช้ไปแล้ว");
}

// ---------------------------------------------------------------
// รูปแบบโค้ด
// ---------------------------------------------------------------

test("โค้ดว่างถูกปฏิเสธก่อนแตะฐานข้อมูล", async () => {
  for (const code of ["", "   ", "\n\t"]) {
    const stub = stubClient(couponRow());
    const r = await apply(stub, code, 500);
    assert.equal(r.ok, false);
    assert.equal(stub.sql.length, 0, "ไม่ควรมีคำสั่ง SQL ใด ๆ ถูกยิง");
  }
});

test("โค้ดถูก trim และแปลงเป็นตัวพิมพ์ใหญ่ก่อนค้นหา", async () => {
  const stub = stubClient(couponRow());
  const r = await apply(stub, "  save10  ", 500);
  assert.equal(r.ok, true);
  assert.equal(stub.params[0][1], "SAVE10", "ค้นด้วยค่าที่ normalize แล้ว ไม่ใช่ที่ผู้ใช้พิมพ์");
});

test("คืน code ที่เก็บไว้ในฐาน ไม่ใช่สตริงที่ลูกค้าพิมพ์มา", async () => {
  const stub = stubClient(couponRow({ code: "SAVE10" }));
  const r = await apply(stub, "save10", 500);
  assert.equal(r.ok && r.code, "SAVE10");
});

test("ไม่พบโค้ด", async () => {
  const stub = stubClient(null);
  const r = await apply(stub, "NOPE", 500);
  assert.equal(r.ok, false);
  assertNoRedemptionBurned(stub);
});

// ---------------------------------------------------------------
// เงื่อนไขเวลา / สถานะ
// ---------------------------------------------------------------

test("โค้ดที่ถูกปิดใช้งานใช้ไม่ได้", async () => {
  const stub = stubClient(couponRow({ active: false }));
  const r = await apply(stub, "SAVE10", 500);
  assert.equal(r.ok, false);
  assertNoRedemptionBurned(stub);
});

test("โค้ดที่ยังไม่ถึงวันเริ่มใช้ไม่ได้", async () => {
  const stub = stubClient(couponRow({ starts_at: new Date(NOW + DAY).toISOString() }));
  const r = await apply(stub, "SAVE10", 500);
  assert.equal(r.ok, false);
  assertNoRedemptionBurned(stub);
});

test("โค้ดที่หมดอายุแล้วใช้ไม่ได้", async () => {
  const stub = stubClient(couponRow({ expires_at: new Date(NOW - DAY).toISOString() }));
  const r = await apply(stub, "SAVE10", 500);
  assert.equal(r.ok, false);
  assertNoRedemptionBurned(stub);
});

test("โค้ดที่อยู่ในช่วงเวลาพอดีใช้ได้", async () => {
  const stub = stubClient(
    couponRow({
      starts_at: new Date(NOW - DAY).toISOString(),
      expires_at: new Date(NOW + DAY).toISOString(),
    })
  );
  assert.equal((await apply(stub, "SAVE10", 500)).ok, true);
});

// ---------------------------------------------------------------
// ยอดขั้นต่ำ
// ---------------------------------------------------------------

test("ยอดไม่ถึงขั้นต่ำใช้ไม่ได้ และถึงพอดีใช้ได้", async () => {
  const under = stubClient(couponRow({ min_order_amount: "500.00" }));
  const r1 = await apply(under, "SAVE10", 499.99);
  assert.equal(r1.ok, false);
  assertNoRedemptionBurned(under);

  const exact = stubClient(couponRow({ min_order_amount: "500.00" }));
  assert.equal((await apply(exact, "SAVE10", 500)).ok, true, "ถึงขั้นต่ำพอดีต้องผ่าน");
});

// ---------------------------------------------------------------
// จำนวนครั้งที่ใช้ได้
// ---------------------------------------------------------------

test("โค้ดที่ถูกใช้ครบโควตาแล้วใช้ไม่ได้ และเหลืออีกครั้งเดียวยังใช้ได้", async () => {
  const full = stubClient(couponRow({ max_redemptions: 100, redemptions_count: 100 }));
  assert.equal((await apply(full, "SAVE10", 500)).ok, false);
  assertNoRedemptionBurned(full);

  const last = stubClient(couponRow({ max_redemptions: 100, redemptions_count: 99 }));
  assert.equal((await apply(last, "SAVE10", 500)).ok, true, "ครั้งสุดท้ายต้องยังใช้ได้");
});

test("เพดานต่อลูกค้า: ใช้ครบแล้วใช้ไม่ได้ ยังไม่ครบใช้ได้", async () => {
  const done = stubClient(couponRow({ per_customer_limit: 2 }), 2);
  assert.equal((await apply(done, "SAVE10", 500)).ok, false);
  assertNoRedemptionBurned(done);

  const left = stubClient(couponRow({ per_customer_limit: 2 }), 1);
  assert.equal((await apply(left, "SAVE10", 500)).ok, true);
});

test("ไม่มีลูกค้าผูกกับบิล = ข้ามการนับต่อคน (พฤติกรรมที่มีอยู่ ไม่ใช่ช่องโหว่ที่มองไม่เห็น)", async () => {
  // บิลที่ไม่มี customer_id นับต่อคนไม่ได้เพราะไม่มี "คน" ให้นับ — ถ้าวันหนึ่งต้องการ
  // ปิดช่องนี้ ต้องบังคับให้บิลที่ใช้โค้ดแบบจำกัดต่อคนต้องมีลูกค้าเสมอ ไม่ใช่แก้ที่นี่
  const stub = stubClient(couponRow({ per_customer_limit: 1 }), 99);
  const r = await apply(stub, "SAVE10", 500, null);
  assert.equal(r.ok, true);
  assert.equal(
    stub.sql.some((s) => /COUNT\(\*\)/i.test(s)),
    false,
    "ไม่ควรถามจำนวนครั้งต่อคนเมื่อไม่มีลูกค้า"
  );
});

// ---------------------------------------------------------------
// เลขส่วนลด
// ---------------------------------------------------------------

test("PERCENT คิดจากยอดก่อนหน้าและปัดเป็นสตางค์", async () => {
  const a = stubClient(couponRow({ type: "PERCENT", value: "10.00" }));
  const ra = await apply(a, "SAVE10", 1000);
  assert.equal(ra.ok && ra.discount, 100);

  const b = stubClient(couponRow({ type: "PERCENT", value: "10.00" }));
  const rb = await apply(b, "SAVE10", 333.33);
  assert.equal(rb.ok && rb.discount, 33.33, "33.333 ต้องกลายเป็น 33.33");

  const c = stubClient(couponRow({ type: "PERCENT", value: "15.00" }));
  const rc = await apply(c, "SAVE15", 99.99);
  assert.equal(rc.ok && rc.discount, 15, "14.9985 ปัดขึ้นเป็น 15.00");
});

test("PERCENT 100% ลดได้เท่ายอดบิลพอดี ไม่เกิน", async () => {
  // DB มี CHECK (type <> 'PERCENT' OR value <= 100) และ upsertCoupon ตรวจซ้ำอีกชั้น
  // ดังนั้นเพดานของ % คือ 100 เสมอ — เทสนี้ยืนยันว่าที่เพดานแล้วยังไม่ทะลุยอดบิล
  const stub = stubClient(couponRow({ type: "PERCENT", value: "100.00" }));
  const r = await apply(stub, "FREE", 250);
  assert.equal(r.ok && r.discount, 250);
});

test("FIXED ที่มากกว่ายอดบิลถูกตัดลงเท่ายอดบิล — บิลติดลบไม่ได้", async () => {
  const stub = stubClient(couponRow({ type: "FIXED", value: "500.00" }));
  const r = await apply(stub, "CASH500", 120);
  assert.equal(r.ok && r.discount, 120);

  const normal = stubClient(couponRow({ type: "FIXED", value: "500.00" }));
  const rn = await apply(normal, "CASH500", 1200);
  assert.equal(rn.ok && rn.discount, 500);
});

test("ยอดบิล 0 ลดได้ 0 ทั้งสองแบบ", async () => {
  const pct = stubClient(couponRow({ type: "PERCENT", value: "50.00" }));
  const rp = await apply(pct, "HALF", 0);
  assert.equal(rp.ok && rp.discount, 0);
  const fixed = stubClient(couponRow({ type: "FIXED", value: "50.00" }));
  const rf = await apply(fixed, "CASH50", 0);
  assert.equal(rf.ok && rf.discount, 0);
});

// ---------------------------------------------------------------
// การนับการใช้งาน
// ---------------------------------------------------------------

test("ใช้สำเร็จนับ redemption เพิ่มหนึ่งครั้ง และห่อด้วย skip_revision", async () => {
  const stub = stubClient(couponRow());
  assert.equal((await apply(stub, "SAVE10", 500)).ok, true);

  const updates = stub.sql.filter((s) => /UPDATE bms_coupons/i.test(s));
  assert.equal(updates.length, 1, "ต้องนับครั้งเดียวต่อการใช้หนึ่งครั้ง");
  assert.match(updates[0], /redemptions_count = redemptions_count \+ 1/);

  // ตั้ง skip_revision ก่อน UPDATE แล้วล้างคืนหลังจากนั้น — ไม่งั้น revision trigger (7.22)
  // จะ snapshot ทุกครั้งที่มีคนใช้โค้ด จนตาราง revision รก (7.24)
  const set = stub.sql.findIndex((s) => /set_config\('app\.skip_revision', '1'/.test(s));
  const upd = stub.sql.findIndex((s) => /UPDATE bms_coupons/i.test(s));
  const clear = stub.sql.findIndex((s) => /set_config\('app\.skip_revision', ''/.test(s));
  assert.ok(set >= 0 && upd > set && clear > upd, "ลำดับ set → update → clear ต้องครบและเรียงถูก");
});

// ---------------------------------------------------------------
// อ่านโค้ดจากข้อความที่ร้านส่งต่อ
// ---------------------------------------------------------------

test("couponCodeFromShareText อ่านโค้ดจากบรรทัดที่ขึ้นต้นด้วย โค้ด/CODE", () => {
  assert.equal(couponCodeFromShareText("ส่วนลดพิเศษ\nโค้ด save10\nใช้ได้ถึงสิ้นเดือน"), "SAVE10");
  assert.equal(couponCodeFromShareText("CODE  summer25"), "SUMMER25");
  assert.equal(couponCodeFromShareText("code summer25"), "SUMMER25");
});

test("couponCodeFromShareText คืน null เมื่อไม่มีบรรทัดโค้ดจริง", () => {
  assert.equal(couponCodeFromShareText("ลด 10% วันนี้เท่านั้น"), null);
  assert.equal(couponCodeFromShareText(""), null);
  // "โค้ด" ต้องเป็นคำขึ้นต้นบรรทัด ไม่ใช่โผล่กลางประโยค ไม่งั้นจะจับคำมั่ว ๆ มาเป็นโค้ด
  assert.equal(couponCodeFromShareText("กรอกโค้ด SAVE10 ตอนชำระเงิน"), null);
});
