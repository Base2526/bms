// สัญญาของการตัดสินว่าตะกร้าร้านยาขายได้หรือไม่
//
// ทำไมต้องมีชุดนี้: ฟังก์ชันนี้เป็นด่านที่ orders.ts เรียกก่อน reserve สต็อกและก่อน
// รับเงิน ถ้ามันปล่อยของที่ต้องให้เภสัชกรตรวจผ่านไปได้แม้กรณีเดียว = ขายยาที่ต้อง
// ควบคุมโดยไม่มีใครตรวจ · การเปลี่ยนล่าสุดเป็นการ "รายงานให้ครบ" ไม่ใช่ "ปล่อยผ่าน"
// เทสจึงต้องยืนยันทั้งสองอย่าง: ยังบล็อกทั้งตะกร้า และรายงานครบทุกตัว
//
// productPolicyDecision.ts ไม่ import อะไรเลย จึงรันได้ตรง ๆ ไม่ต้องมี DB
//
//   node --experimental-strip-types --test scripts/pharmacy-policy-decision-contract.test.mts

import assert from "node:assert/strict";
import test from "node:test";

import {
  approvedSkusFromCheckoutDraft,
  evaluatePharmacySale,
  type PharmacyPolicyForDecision,
} from "../apps/web/lib/bms/pharmacy/productPolicyDecision.ts";

function policy(
  productSku: string,
  salePolicy: PharmacyPolicyForDecision["salePolicy"],
  overrides: Partial<PharmacyPolicyForDecision> = {}
): PharmacyPolicyForDecision {
  return { productSku, salePolicy, status: "APPROVED", maxQuantity: null, ...overrides };
}

test("ตะกร้าที่ทุกตัวขายตรงได้ → ผ่าน", () => {
  const decision = evaluatePharmacySale(
    [
      { sku: "PARA", qty: 1 },
      { sku: "REDMED", qty: 1 },
    ],
    [policy("PARA", "DIRECT_SALE"), policy("REDMED", "DIRECT_SALE")]
  );
  assert.equal(decision.allowed, true);
});

test("ติดตัวเดียว → บล็อกทั้งตะกร้า และรายงานตัวนั้น", () => {
  const decision = evaluatePharmacySale(
    [
      { sku: "PARA", qty: 1 },
      { sku: "TRAMADOL", qty: 1 },
    ],
    [policy("PARA", "DIRECT_SALE"), policy("TRAMADOL", "PRESCRIPTION_REQUIRED")]
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.status, "PHARMACY_PRESCRIPTION_REQUIRED");
  assert.equal(decision.sku, "TRAMADOL");
  assert.equal(decision.blockers.length, 1);
});

test("ติด 2 ตัว → รายงานครบทั้ง 2 ในรอบเดียว (เดิมได้ทีละตัว)", () => {
  const decision = evaluatePharmacySale(
    [
      { sku: "PARA", qty: 1 },
      { sku: "TRAMADOL", qty: 1 },
      { sku: "CODEINE", qty: 1 },
    ],
    [
      policy("PARA", "DIRECT_SALE"),
      policy("TRAMADOL", "PRESCRIPTION_REQUIRED"),
      policy("CODEINE", "ONLINE_SALE_PROHIBITED"),
    ]
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.deepEqual(
    decision.blockers.map((b) => [b.sku, b.status]),
    [
      ["TRAMADOL", "PHARMACY_PRESCRIPTION_REQUIRED"],
      ["CODEINE", "PHARMACY_ONLINE_SALE_PROHIBITED"],
    ]
  );
});

test("status/sku ระดับบนสุดยังเท่ากับตัวแรกเป๊ะ (ผู้เรียกเดิมไม่กระทบ)", () => {
  const decision = evaluatePharmacySale(
    [
      { sku: "TRAMADOL", qty: 1 },
      { sku: "CODEINE", qty: 1 },
    ],
    [policy("TRAMADOL", "PHARMACIST_APPROVAL"), policy("CODEINE", "ONLINE_SALE_PROHIBITED")]
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.status, decision.blockers[0].status);
  assert.equal(decision.sku, decision.blockers[0].sku);
  assert.equal(decision.salePolicy, decision.blockers[0].salePolicy);
});

test("ไม่มี policy row ที่ APPROVED → บล็อก (fail closed)", () => {
  for (const status of ["MISSING", "DRAFT", "PENDING_REVIEW", "RETIRED"] as const) {
    const decision = evaluatePharmacySale(
      [{ sku: "MYSTERY", qty: 1 }],
      [policy("MYSTERY", "DIRECT_SALE", { status })]
    );
    assert.equal(decision.allowed, false, `status ${status} ต้องไม่ผ่าน`);
    if (decision.allowed) return;
    assert.equal(decision.status, "PHARMACY_POLICY_UNKNOWN");
  }
  // ไม่มีแถวเลย
  const missing = evaluatePharmacySale([{ sku: "NOROW", qty: 1 }], []);
  assert.equal(missing.allowed, false);
});

test("จำนวนรวมทุกบรรทัดต่อ SKU เทียบเพดาน ไม่ใช่ต่อบรรทัด", () => {
  // สองบรรทัดละ 3 = 6 เกินเพดาน 5 · คิดต่อบรรทัดจะปล่อยผ่านทั้งคู่
  const decision = evaluatePharmacySale(
    [
      { sku: "PSEUDO", qty: 3 },
      { sku: "PSEUDO", qty: 3 },
    ],
    [policy("PSEUDO", "DIRECT_SALE", { maxQuantity: 5 })]
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.status, "PHARMACY_QUANTITY_LIMIT_EXCEEDED");
  assert.equal(decision.requested, 6);
  assert.equal(decision.maxQuantity, 5);
});

test("เคสที่เภสัชกร approve แล้วผ่านได้ แต่ตัวอื่นในตะกร้ายังบล็อกได้", () => {
  const decision = evaluatePharmacySale(
    [
      { sku: "APPROVED_ONE", qty: 1 },
      { sku: "NOT_APPROVED", qty: 1 },
    ],
    [
      policy("APPROVED_ONE", "PHARMACIST_APPROVAL"),
      policy("NOT_APPROVED", "PHARMACIST_APPROVAL"),
    ],
    new Set(["APPROVED_ONE"])
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.deepEqual(
    decision.blockers.map((b) => b.sku),
    ["NOT_APPROVED"],
    "ตัวที่ผ่านการอนุมัติแล้วต้องไม่ถูกนับเป็น blocker"
  );
});

test("ตะกร้าว่างไม่ถือว่าติดอะไร", () => {
  assert.equal(evaluatePharmacySale([], []).allowed, true);
});

// ---------------------------------------------------------------
// ONLINE_SALE_PROHIBITED กับ channel
// ---------------------------------------------------------------
// ชื่อ policy บอกว่าห้ามขาย "ออนไลน์" แต่เดิมตัวประเมินไม่รู้จัก channel เลย
// จึงบล็อกหน้าร้านไปด้วย ทำให้ยาที่กฎหมายกำหนดให้ต้องจ่ายแบบเจอตัว
// ขายที่เคาน์เตอร์ไม่ได้เลยแม้เภสัชกรยืนอยู่ตรงนั้น

test("ออนไลน์: ONLINE_SALE_PROHIBITED บล็อกแข็งเหมือนเดิม", () => {
  const decision = evaluatePharmacySale(
    [{ sku: "OFFLINE_ONLY", qty: 1 }],
    [policy("OFFLINE_ONLY", "ONLINE_SALE_PROHIBITED")]
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.status, "PHARMACY_ONLINE_SALE_PROHIBITED");
});

test("ค่าปริยายต้องเป็นออนไลน์ — ผู้เรียกที่ยังไม่รู้เรื่อง channel ต้องไม่ได้สิทธิ์ยกเว้นเงียบ ๆ", () => {
  const withoutChannel = evaluatePharmacySale(
    [{ sku: "OFFLINE_ONLY", qty: 1 }],
    [policy("OFFLINE_ONLY", "ONLINE_SALE_PROHIBITED")]
  );
  const explicitOnline = evaluatePharmacySale(
    [{ sku: "OFFLINE_ONLY", qty: 1 }],
    [policy("OFFLINE_ONLY", "ONLINE_SALE_PROHIBITED")],
    new Set(),
    "online"
  );
  assert.deepEqual(withoutChannel, explicitOnline);
});

test("เคาน์เตอร์: ไม่บล็อกแข็ง แต่ต้องให้เภสัชกรตรวจ — ห้ามกลายเป็นขายฟรี", () => {
  const decision = evaluatePharmacySale(
    [{ sku: "OFFLINE_ONLY", qty: 1 }],
    [policy("OFFLINE_ONLY", "ONLINE_SALE_PROHIBITED")],
    new Set(),
    "counter"
  );
  assert.equal(decision.allowed, false, "ห้ามปล่อยผ่านโดยไม่มีเภสัชกร");
  if (decision.allowed) return;
  assert.equal(decision.status, "PHARMACY_REVIEW_REQUIRED");
});

test("เคาน์เตอร์: เภสัชกร approve แล้วต้องขายได้ ไม่ใช่ติดวนอยู่ที่เดิม", () => {
  const decision = evaluatePharmacySale(
    [{ sku: "OFFLINE_ONLY", qty: 1 }],
    [policy("OFFLINE_ONLY", "ONLINE_SALE_PROHIBITED")],
    new Set(["OFFLINE_ONLY"]),
    "counter"
  );
  assert.equal(decision.allowed, true);
});

test("ออนไลน์: ใบอนุมัติปลด ONLINE_SALE_PROHIBITED ไม่ได้", () => {
  const decision = evaluatePharmacySale(
    [{ sku: "OFFLINE_ONLY", qty: 1 }],
    [policy("OFFLINE_ONLY", "ONLINE_SALE_PROHIBITED")],
    new Set(["OFFLINE_ONLY"]),
    "online"
  );
  assert.equal(decision.allowed, false, "ช่องทางออนไลน์ห้ามขายตัวนี้ ไม่ว่าจะมีใบอนุมัติหรือไม่");
  if (decision.allowed) return;
  assert.equal(decision.status, "PHARMACY_ONLINE_SALE_PROHIBITED");
});

test("เคาน์เตอร์ไม่ทำให้ policy ตัวอื่นหลวมลง", () => {
  for (const [salePolicy, expected] of [
    ["PRESCRIPTION_REQUIRED", "PHARMACY_PRESCRIPTION_REQUIRED"],
    ["SHORT_SAFETY_CHECK", "PHARMACY_SAFETY_CHECK_REQUIRED"],
    ["PHARMACIST_APPROVAL", "PHARMACY_REVIEW_REQUIRED"],
  ] as const) {
    const decision = evaluatePharmacySale(
      [{ sku: "X", qty: 1 }],
      [policy("X", salePolicy)],
      new Set(),
      "counter"
    );
    assert.equal(decision.allowed, false, salePolicy);
    if (decision.allowed) return;
    assert.equal(decision.status, expected, salePolicy);
  }
});

// ---------------------------------------------------------------
// จำนวนที่เภสัชกรอนุมัติ = เพดานของบิล ไม่ใช่เพดานของบรรทัด
// ---------------------------------------------------------------
// ตั้งแต่ 9.21 บิลใบเดียวถือ SKU+ไซซ์เดียวกันได้สองหน่วยขาย ("1 กล่อง + 3 เม็ด")
// เดิม checkPharmacySaleInTx เทียบทีละบรรทัดกับ draft item ตัวแรกที่เจอ จึงปล่อย
// ให้จ่ายยาเกินใบอนุมัติได้โดยแต่ละบรรทัดดู "ไม่เกิน"
test("รวมจำนวนต่อ sku+size ทั้งสองฝั่งก่อนเทียบ — สองบรรทัดหน่วยขายต่างกันบวกกัน", () => {
  const approved = approvedSkusFromCheckoutDraft(
    [
      { sku: "AMOX", size: "500MG", qty: 10 },
      { sku: "AMOX", size: "500MG", qty: 10 },
    ],
    [{ sku: "AMOX", size: "500MG", qty: 10 }]
  );
  assert.equal(approved.has("AMOX"), false, "อนุมัติ 10 เม็ด ห้ามเคลียร์บิลที่ถือ 20 เม็ด");
});

test("จำนวนพอดีตามที่อนุมัติ → ผ่าน", () => {
  const approved = approvedSkusFromCheckoutDraft(
    [
      { sku: "AMOX", size: "500MG", qty: 4 },
      { sku: "AMOX", size: "500MG", qty: 6 },
    ],
    [{ sku: "AMOX", size: "500MG", qty: 10 }]
  );
  assert.equal(approved.has("AMOX"), true);
});

test("draft ที่เภสัชกรใส่สินค้าเดียวกันสองแถว ต้องนับรวม ไม่ใช่นับแถวแรก", () => {
  const approved = approvedSkusFromCheckoutDraft(
    [{ sku: "AMOX", size: "500MG", qty: 10 }],
    [
      { sku: "AMOX", size: "500MG", qty: 6 },
      { sku: "AMOX", size: "500MG", qty: 4 },
    ]
  );
  assert.equal(approved.has("AMOX"), true, "6+4 ครอบ 10 ได้");
});

test("ใบอนุมัติของไซซ์หนึ่ง ไม่ครอบอีกไซซ์", () => {
  const approved = approvedSkusFromCheckoutDraft(
    [{ sku: "AMOX", size: "250MG", qty: 1 }],
    [{ sku: "AMOX", size: "500MG", qty: 99 }]
  );
  assert.equal(approved.has("AMOX"), false);
});

test("ไซซ์ที่ไม่ผ่านตัวเดียว ทำให้ SKU นั้นไม่ผ่านทั้งตัว", () => {
  const approved = approvedSkusFromCheckoutDraft(
    [
      { sku: "AMOX", size: "250MG", qty: 1 },
      { sku: "AMOX", size: "500MG", qty: 1 },
    ],
    [{ sku: "AMOX", size: "250MG", qty: 1 }]
  );
  assert.equal(approved.has("AMOX"), false, "อนุมัติแค่ไซซ์เดียว ห้ามปล่อยอีกไซซ์ตามไปด้วย");
});

test("draft ว่าง/เคสที่ถูกใช้ไปแล้ว = ไม่มี SKU ไหนได้รับอนุมัติ", () => {
  const approved = approvedSkusFromCheckoutDraft([{ sku: "AMOX", size: "500MG", qty: 1 }], []);
  assert.equal(approved.size, 0);
});

test("แถวใน draft ที่ qty พัง (0/ลบ/ไม่ใช่ตัวเลข) ไม่นับเป็นการอนุมัติ", () => {
  for (const qty of [0, -5, "มาก", null, undefined]) {
    const approved = approvedSkusFromCheckoutDraft(
      [{ sku: "AMOX", size: "500MG", qty: 1 }],
      [{ sku: "AMOX", size: "500MG", qty }]
    );
    assert.equal(approved.has("AMOX"), false, String(qty));
  }
});

test("ไซซ์ว่างของบิลจับคู่กับไซซ์ว่างของ draft ได้ (ทั้งคู่คือ 'ไม่ระบุไซซ์')", () => {
  const approved = approvedSkusFromCheckoutDraft(
    [{ sku: "GAUZE", qty: 2 }],
    [{ sku: "GAUZE", qty: 2 }]
  );
  assert.equal(approved.has("GAUZE"), true);
});

// ---------------------------------------------------------------
// เภสัชกรกด PIN อนุมัติที่เครื่อง (9.29)
// ---------------------------------------------------------------
// ร้านยาทั่วไปไม่ได้ส่งเคสเข้าคิวทุกครั้ง — เภสัชกรยืนอยู่ตรงนั้นแล้วอนุมัติเลย
// เทสชุดนี้คุมขอบของอำนาจนั้น: ปลดอะไรได้ ปลดอะไรไม่ได้ และใช้ได้แค่ที่เคาน์เตอร์
test("เคาน์เตอร์: เภสัชกรอนุมัติแล้วจ่ายยาที่ต้องมีใบสั่งแพทย์ได้", () => {
  const decision = evaluatePharmacySale(
    [{ sku: "AMOX", qty: 1 }],
    [policy("AMOX", "PRESCRIPTION_REQUIRED")],
    new Set(),
    "counter",
    new Set(["AMOX"])
  );
  assert.equal(decision.allowed, true);
});

test("เคาน์เตอร์: สินค้าที่ยังไม่มี policy อนุมัติ ก็จ่ายได้เมื่อเภสัชกรรับผิดชอบ", () => {
  const decision = evaluatePharmacySale(
    [{ sku: "NEWDRUG", qty: 1 }],
    [],
    new Set(),
    "counter",
    new Set(["NEWDRUG"])
  );
  assert.equal(decision.allowed, true, "SKU ที่ไม่มีแถว policy เลยต้องปลดได้ด้วย PIN เภสัชกร");
});

test("เคาน์เตอร์: policy ที่ยังเป็นร่าง/รอตรวจ ก็ปลดได้ด้วย PIN เภสัชกร", () => {
  for (const status of ["DRAFT", "PENDING_REVIEW", "RETIRED"] as const) {
    const decision = evaluatePharmacySale(
      [{ sku: "X", qty: 1 }],
      [policy("X", "DIRECT_SALE", { status })],
      new Set(),
      "counter",
      new Set(["X"])
    );
    assert.equal(decision.allowed, true, status);
  }
});

test("เคาน์เตอร์: ทุก policy ที่ต้องให้เภสัชกรดู ถูกปลดด้วย PIN ครบ", () => {
  for (const salePolicy of [
    "SHORT_SAFETY_CHECK",
    "PHARMACIST_APPROVAL",
    "ONLINE_SALE_PROHIBITED",
    "PRESCRIPTION_REQUIRED",
  ] as const) {
    const decision = evaluatePharmacySale(
      [{ sku: "X", qty: 1 }],
      [policy("X", salePolicy)],
      new Set(),
      "counter",
      new Set(["X"])
    );
    assert.equal(decision.allowed, true, salePolicy);
  }
});

test("ออนไลน์: PIN เภสัชกรไม่มีผลเลย — ไม่มีใครยืนอยู่ที่เครื่อง", () => {
  for (const salePolicy of ["PRESCRIPTION_REQUIRED", "PHARMACIST_APPROVAL"] as const) {
    const decision = evaluatePharmacySale(
      [{ sku: "X", qty: 1 }],
      [policy("X", salePolicy)],
      new Set(),
      "online",
      new Set(["X"])
    );
    assert.equal(decision.allowed, false, salePolicy);
  }
});

test("ค่าปริยายของช่องทางยังเป็นออนไลน์ — ส่ง set มาเฉย ๆ ไม่ทำให้หลุด", () => {
  const decision = evaluatePharmacySale(
    [{ sku: "X", qty: 1 }],
    [policy("X", "PRESCRIPTION_REQUIRED")],
    new Set(),
    undefined as any,
    new Set(["X"])
  );
  assert.equal(decision.allowed, false);
});

test("PIN เภสัชกรปลดเพดานจำนวนต่อครั้งไม่ได้ (ต้องไปแก้ policy)", () => {
  const decision = evaluatePharmacySale(
    [{ sku: "X", qty: 5 }],
    [policy("X", "DIRECT_SALE", { maxQuantity: 2 })],
    new Set(),
    "counter",
    new Set(["X"])
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.status, "PHARMACY_QUANTITY_LIMIT_EXCEEDED");
  assert.equal(decision.requested, 5);
});

test("อนุมัติเฉพาะ SKU ที่ระบุ — ตัวอื่นในตะกร้ายังบล็อกตามเดิม", () => {
  const decision = evaluatePharmacySale(
    [
      { sku: "OKAY", qty: 1 },
      { sku: "OTHER", qty: 1 },
    ],
    [policy("OKAY", "PRESCRIPTION_REQUIRED"), policy("OTHER", "PHARMACIST_APPROVAL")],
    new Set(),
    "counter",
    new Set(["OKAY"])
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.blockers.length, 1);
  assert.equal(decision.blockers[0].sku, "OTHER");
});
