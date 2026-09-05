// =============================================================
// Loyalty ledger contract test — against a real Postgres (migration 7.96)
// -------------------------------------------------------------
// loyalty-contract.test.mts covers the pure arithmetic. This one covers the
// parts that only a database can prove: transaction boundaries, the FIFO
// consume, the unique indexes that make POS replay idempotent, the revision
// trigger on bms_customers, and what happens to points on cancel / return /
// merge / delete.
//
// Run from apps/web (that package has tsx and reads .env):
//   npx tsx --test --test-force-exit ../../scripts/loyalty-db-contract.test.mts
//
// Needs POSTGRES_* pointing at a database with 7.96 applied. Every row it
// creates is tagged 'fake' + 'loyalty-test' and removed in the final test, so it
// is safe to run against a dev database — but never against production.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { getClient, query } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import {
  adjustPoints,
  earnPointsForOrderInTx,
  enrollMember,
  expireLoyaltyPoints,
  getMember,
  listLoyaltyLedger,
  loyaltyOutstandingReport,
  releasePointsForOrdersInTx,
  reversePointsForReturnInTx,
  redeemPointsInTx,
  reviewMemberTier,
  searchMembers,
  updateLoyaltySettings,
  upsertMembershipTier,
} from "../apps/web/lib/bms/membership.ts";
import { deleteCustomer, mergeCustomers } from "../apps/web/lib/bms/customers.ts";
import { cancelOrder, createOrder, payOrder, returnOrder } from "../apps/web/lib/bms/orders.ts";
import { upsertCoupon } from "../apps/web/lib/bms/coupons.ts";
import { listOrderDiscounts } from "../apps/web/lib/bms/membership.ts";
import { DECLARE_FAKE_SALES_SURFACES_SQL } from "./testing/salesSurfaces.mts";

const TAG = "loyalty-test";
let tenantId = "";
let locationId = "";

/** ยอดที่ใช้ได้จริงตาม ledger — ต้องตรงกับ getMember().pointsUsable เสมอ */
async function usableFromLedger(customerId: string): Promise<number> {
  const res = await query<{ n: string }>(
    `SELECT COALESCE(SUM(points - consumed_points), 0) AS n FROM bms_loyalty_ledger
      WHERE tenant_id = $1 AND customer_id = $2 AND points > 0
        AND (expires_at IS NULL OR expires_at > now())`,
    [tenantId, customerId]
  );
  return Number(res.rows[0].n);
}

async function balanceFromLedger(customerId: string): Promise<number> {
  const res = await query<{ n: string }>(
    `SELECT COALESCE(SUM(points), 0) AS n FROM bms_loyalty_ledger WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, customerId]
  );
  return Number(res.rows[0].n);
}

async function makeCustomer(name: string, phone: string): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, phone, tags) VALUES ($1,$2,$3,ARRAY['fake',$4]) RETURNING id`,
    [tenantId, name, phone, TAG]
  );
  return res.rows[0].id;
}

/** บิลปลอมที่ไม่ต้องมีสินค้า/สต็อก — ทดสอบ ledger ไม่ได้ทดสอบ createOrder */
async function makeOrder(customerId: string | null, total: number, discount = 0): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO bms_orders (tenant_id, location_id, channel, customer_id, status, total_amount, discount_amount, customer_ref)
     VALUES ($1, $6, 'web', $2, 'PENDING', $3, $4, $5) RETURNING id`,
    [tenantId, customerId, total, discount, `FAKE-${TAG}`, locationId]
  );
  return res.rows[0].id;
}

async function inTx<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

test("setup: a tenant with the program enabled and a known redemption rate", async () => {
  const t = await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`);
  assert.ok(t.rows[0], "ต้องมี tenant อย่างน้อย 1 ร้านในฐานนี้");
  tenantId = t.rows[0].id;

  const loc = await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  );
  assert.ok(loc.rows[0], "ต้องมีสาขาอย่างน้อย 1 แห่ง (migration 7.84)");
  locationId = loc.rows[0].id;

  const settings = await updateLoyaltySettings(tenantId, {
    enabled: true,
    earnMode: "SPEND",
    earnPointsPerBaht: 1,
    earnMinSpend: 0,
    earnBase: "AFTER_DISCOUNT",
    redeemPointsPerUnit: 100,
    redeemBahtPerUnit: 10,
    redeemMinPoints: 100,
    maxDiscountPct: 100,
    pointsExpireMonths: 24,
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.redeemPointsPerUnit, 100);
});

test("enrol: an existing customer keeps their row and gains a member number", async () => {
  const phone = `09${Date.now().toString().slice(-8)}`;
  const existingId = await makeCustomer(`FAKE ${TAG} enrol`, phone);

  const first = await enrollMember(tenantId, { phone, name: "ไม่ควรทับชื่อเดิม" });
  assert.equal(first.status, "ENROLLED");
  assert.ok(first.status !== "INVALID" && first.member.memberNo, "ต้องได้เลขสมาชิก");
  assert.ok(first.status !== "INVALID" && first.member.customerId === existingId,
    "ต้องผูกกับลูกค้าเดิม ไม่สร้างแถวใหม่");

  // สมัครซ้ำด้วยเบอร์เดิมต้องไม่ออกเลขใหม่
  const again = await enrollMember(tenantId, { phone });
  assert.equal(again.status, "ALREADY_MEMBER");
  assert.ok(again.status !== "INVALID"
    && first.status !== "INVALID"
    && again.member.memberNo === first.member.memberNo);

  const bad = await enrollMember(tenantId, { phone: "123" });
  assert.equal(bad.status, "INVALID");
});

test("member numbers are unique per tenant and never reused", async () => {
  const nos: string[] = [];
  for (let i = 0; i < 3; i++) {
    const phone = `08${String(Date.now()).slice(-7)}${i}`;
    const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} seq ${i}` });
    assert.notEqual(r.status, "INVALID");
    if (r.status !== "INVALID") nos.push(r.member.memberNo!);
  }
  assert.equal(new Set(nos).size, nos.length, `เลขสมาชิกซ้ำ: ${nos.join(", ")}`);
});

test("adjust: points land in the ledger and the cached balance follows", async () => {
  const phone = `07${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} adjust` });
  assert.notEqual(r.status, "INVALID");
  if (r.status === "INVALID") return;
  const id = r.member.customerId;

  await adjustPoints({ tenantId, customerId: id, points: 250, note: "test grant" });
  const m = await getMember(tenantId, id);
  assert.equal(m?.pointsBalance, 250);
  assert.equal(m?.pointsUsable, 250);
  assert.equal(await balanceFromLedger(id), 250, "cache ต้องตรงกับ ledger");

  // ปรับลบต้องกิน grant แบบ FIFO ไม่ใช่แค่ลดตัวเลข cache
  await adjustPoints({ tenantId, customerId: id, points: -100, note: "test deduct" });
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 150);
  assert.equal(await usableFromLedger(id), 150);

  await assert.rejects(() => adjustPoints({ tenantId, customerId: id, points: 10, note: "  " }),
    /เหตุผล/, "ปรับแต้มต้องบังคับเหตุผล");
  await assert.rejects(() => adjustPoints({ tenantId, customerId: id, points: 0, note: "x" }),
    /ไม่เป็น 0/);
});

test("writing points does not create a revision row on bms_customers", async () => {
  // bms_customers มี revision trigger (7.1/7.6) ถ้าไม่ตั้ง app.skip_revision
  // ตาราง revision จะโตหนึ่งแถวต่อหนึ่งบิล
  const phone = `06${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} revision` });
  assert.notEqual(r.status, "INVALID");
  if (r.status === "INVALID") return;
  const id = r.member.customerId;

  const revisionCount = async () => {
    const res = await query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM bms_customers_revisions WHERE snapshot->>'id' = $1`, [id]
    );
    return Number(res.rows[0].n);
  };
  const before = await revisionCount();
  await adjustPoints({ tenantId, customerId: id, points: 500, note: "revision probe" });
  const after = await revisionCount();
  assert.equal(after, before, "การเขียนแต้มต้องไม่เพิ่ม revision");
});

test("earn: only members earn, and a replayed order never earns twice", async () => {
  const phone = `05${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} earn` });
  assert.notEqual(r.status, "INVALID");
  if (r.status === "INVALID") return;
  const memberId = r.member.customerId;

  const plainId = await makeCustomer(`FAKE ${TAG} not a member`, `04${String(Date.now()).slice(-8)}`);

  const memberOrder = await makeOrder(memberId, 830, 170);
  const plainOrder = await makeOrder(plainId, 830, 0);

  const first = await inTx((c) => earnPointsForOrderInTx(c, { tenantId, orderId: memberOrder }));
  assert.equal(first.points, 830, "1 แต้ม/บาท จากยอดหลังส่วนลด");

  const replay = await inTx((c) => earnPointsForOrderInTx(c, { tenantId, orderId: memberOrder }));
  assert.equal(replay.points, 0, "ยิงบิลเดิมซ้ำต้องไม่ได้แต้มอีก");

  const plain = await inTx((c) => earnPointsForOrderInTx(c, { tenantId, orderId: plainOrder }));
  assert.equal(plain.points, 0, "ลูกค้าที่ไม่ได้สมัครต้องไม่ได้แต้ม");

  assert.equal((await getMember(tenantId, memberId))?.pointsUsable, 830);
});

test("earn base BEFORE_DISCOUNT uses the pre-discount amount", async () => {
  await updateLoyaltySettings(tenantId, { earnBase: "BEFORE_DISCOUNT" });
  const phone = `03${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} earnbase` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const order = await makeOrder(r.member.customerId, 830, 170);
  const out = await inTx((c) => earnPointsForOrderInTx(c, { tenantId, orderId: order }));
  assert.equal(out.points, 1000);
  await updateLoyaltySettings(tenantId, { earnBase: "AFTER_DISCOUNT" });
});

test("redeem: refuses when short, and the unique index blocks a second redeem per order", async () => {
  const phone = `02${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} redeem` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const id = r.member.customerId;
  await adjustPoints({ tenantId, customerId: id, points: 300, note: "for redeem" });

  const order = await makeOrder(id, 1000);
  const tooMany = await inTx((c) =>
    redeemPointsInTx(c, { tenantId, customerId: id, orderId: order, points: 500, discount: 50 })
  );
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.match(tooMany.reason, /แต้มไม่พอ/);
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 300, "ปฏิเสธแล้วต้องไม่หักอะไร");

  const belowMin = await inTx((c) =>
    redeemPointsInTx(c, { tenantId, customerId: id, orderId: order, points: 50, discount: 5 })
  );
  assert.equal(belowMin.ok, false);

  const ok = await inTx((c) =>
    redeemPointsInTx(c, { tenantId, customerId: id, orderId: order, points: 200, discount: 20 })
  );
  assert.equal(ok.ok, true);
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 100);

  await assert.rejects(
    () => inTx((c) => redeemPointsInTx(c, { tenantId, customerId: id, orderId: order, points: 100, discount: 10 })),
    /duplicate key|uq_bms_loyalty_ledger_order_kind/,
    "แลกแต้มซ้ำบิลเดิมต้องถูก unique index กัน"
  );
});

test("redeem: 3,045 points redeems 3,000 and preserves the 45-point remainder", async () => {
  const phone = `021${String(Date.now()).slice(-7)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} redeem remainder` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const id = r.member.customerId;
  await adjustPoints({ tenantId, customerId: id, points: 3045, note: "remainder regression" });

  const order = await makeOrder(id, 5000);
  const redeemed = await inTx((c) =>
    redeemPointsInTx(c, { tenantId, customerId: id, orderId: order, points: 3000, discount: 300 })
  );
  assert.deepEqual(redeemed, { ok: true, pointsUsed: 3000, discount: 300 });

  const member = await getMember(tenantId, id);
  assert.equal(member?.pointsUsable, 45, "เศษแต้มที่ไม่ครบหน่วยต้องยังอยู่ใช้ในอนาคต");
  assert.equal(member?.pointsBalance, 45, "cache ยอดแต้มต้องตรงกับ ledger");
  assert.equal(await usableFromLedger(id), 45);
  assert.equal(await balanceFromLedger(id), 45);
});

test("cancel: releasing an order returns redeemed points and claws back earned ones", async () => {
  const phone = `01${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} cancel` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const id = r.member.customerId;
  await adjustPoints({ tenantId, customerId: id, points: 500, note: "for cancel" });

  const order = await makeOrder(id, 900, 100);
  await inTx((c) => redeemPointsInTx(c, { tenantId, customerId: id, orderId: order, points: 200, discount: 20 }));
  await inTx((c) => earnPointsForOrderInTx(c, { tenantId, orderId: order }));
  // 500 − 200 แลก + 900 ได้ = 1200
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 1200);

  await inTx((c) => releasePointsForOrdersInTx(c, tenantId, [order], "ยกเลิกบิล"));
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 500, "ต้องกลับไปเท่าก่อนบิลนี้");

  // เรียกซ้ำต้องไม่คืนซ้ำ
  await inTx((c) => releasePointsForOrdersInTx(c, tenantId, [order], "ยกเลิกบิล"));
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 500, "release ซ้ำต้องไม่ขยับยอด");
});

test("partial return: points reverse in proportion and can drive the balance negative", async () => {
  const phone = `00${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} return` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const id = r.member.customerId;
  await adjustPoints({ tenantId, customerId: id, points: 200, note: "for return" });

  const order = await makeOrder(id, 1000);
  await inTx((c) => redeemPointsInTx(c, { tenantId, customerId: id, orderId: order, points: 200, discount: 20 }));
  await inTx((c) => earnPointsForOrderInTx(c, { tenantId, orderId: order }));
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 1000);

  // คืนครึ่งบิล: ดึงแต้มที่ได้คืน 500 และคืนแต้มที่แลกไป 100 → สุทธิ −400
  const ret = await query<{ id: string }>(
    `INSERT INTO bms_pos_returns (tenant_id, order_id, return_mode, refund_amount)
     VALUES ($1,$2,'PARTIAL',500) RETURNING id`,
    [tenantId, order]
  );
  const out = await inTx((c) => reversePointsForReturnInTx(c, {
    tenantId, orderId: order, posReturnId: ret.rows[0].id, ratio: 0.5,
  }));
  assert.equal(out.earnedReversed, 500);
  assert.equal(out.redeemedReturned, 100);
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 600);

  // ยิง return เดิมซ้ำต้องไม่คิดใหม่
  const replay = await inTx((c) => reversePointsForReturnInTx(c, {
    tenantId, orderId: order, posReturnId: ret.rows[0].id, ratio: 0.5,
  }));
  assert.equal(replay.earnedReversed, 0);
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 600);
});

test("a return after the points were spent leaves the balance negative, not clamped", async () => {
  const phone = `19${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} negative` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const id = r.member.customerId;

  const order = await makeOrder(id, 300);
  await inTx((c) => earnPointsForOrderInTx(c, { tenantId, orderId: order }));
  // ใช้แต้มที่ได้ไปกับบิลอื่นจนหมด
  const other = await makeOrder(id, 1000);
  await inTx((c) => redeemPointsInTx(c, { tenantId, customerId: id, orderId: other, points: 300, discount: 30 }));
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 0);

  const ret = await query<{ id: string }>(
    `INSERT INTO bms_pos_returns (tenant_id, order_id, return_mode, refund_amount)
     VALUES ($1,$2,'FULL',300) RETURNING id`,
    [tenantId, order]
  );
  await inTx((c) => reversePointsForReturnInTx(c, {
    tenantId, orderId: order, posReturnId: ret.rows[0].id, ratio: 1,
  }));
  const m = await getMember(tenantId, id);
  assert.equal(m?.pointsBalance, -300, "ยอดต้องติดลบ ห้าม clamp เป็น 0");
  assert.equal(m?.pointsUsable, 0);

  // แต้มที่ได้ครั้งถัดไปต้องกลบยอดติดลบก่อน
  const next = await makeOrder(id, 500);
  await inTx((c) => earnPointsForOrderInTx(c, { tenantId, orderId: next }));
  const after = await getMember(tenantId, id);
  assert.equal(after?.pointsBalance, 200);
  assert.equal(after?.pointsUsable, 200, "ต้องเหลือใช้ได้ 200 ไม่ใช่ 500");
});

test("expiry: only overdue grants are consumed, FIFO, and rerunning is a no-op", async () => {
  const phone = `18${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} expire` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const id = r.member.customerId;

  await adjustPoints({ tenantId, customerId: id, points: 400, note: "จะหมดอายุ" });
  await adjustPoints({ tenantId, customerId: id, points: 600, note: "ยังไม่หมด" });
  // ดันก้อนแรกให้หมดอายุแล้ว
  await query(
    `UPDATE bms_loyalty_ledger SET expires_at = now() - interval '1 day'
      WHERE tenant_id = $1 AND customer_id = $2 AND note = 'จะหมดอายุ'`,
    [tenantId, id]
  );
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 600, "ก้อนหมดอายุต้องหลุดจากยอดใช้ได้ทันที");

  const first = await expireLoyaltyPoints(tenantId);
  assert.ok(first.points >= 400, `ต้องตัดแต้มที่หมดอายุ (ได้ ${first.points})`);
  const m = await getMember(tenantId, id);
  assert.equal(m?.pointsUsable, 600, "ก้อนที่ยังไม่หมดต้องไม่ถูกแตะ");
  assert.equal(m?.pointsBalance, 600, "ยอดรวมต้องลดตามแต้มที่หมดอายุ");

  const second = await expireLoyaltyPoints(tenantId);
  const mine = await listLoyaltyLedger(tenantId, id, 50);
  assert.equal(mine.filter((e) => e.kind === "EXPIRE").length, 1,
    `รันซ้ำต้องไม่สร้าง EXPIRE เพิ่ม (รอบสองตัดไป ${second.points})`);
});

test("tier: review picks the highest threshold met, and non-members get no tier", async () => {
  await upsertMembershipTier(tenantId, {
    code: `${TAG}-LOW`, name: "Test Low", discountType: "NONE", discountValue: 0,
    qualifySpend12m: 0, qualifyPoints: 0, sortOrder: 90, active: true,
  });
  const high = await upsertMembershipTier(tenantId, {
    code: `${TAG}-HIGH`, name: "Test High", discountType: "PERCENT", discountValue: 7,
    qualifySpend12m: 999_999_999, qualifyPoints: 500, sortOrder: 99, active: true,
  });

  const phone = `17${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} tier` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const id = r.member.customerId;

  await adjustPoints({ tenantId, customerId: id, points: 600, note: "ให้ถึงเกณฑ์แต้ม" });
  const reviewed = await reviewMemberTier(tenantId, id);
  assert.equal(reviewed.tier?.id, high.id, "ต้องได้ชั้นสูงสุดที่ผ่านเกณฑ์");

  const plainId = await makeCustomer(`FAKE ${TAG} plain tier`, `16${String(Date.now()).slice(-8)}`);
  const plain = await reviewMemberTier(tenantId, plainId);
  assert.equal(plain.tier, null, "คนที่ไม่ได้สมัครต้องไม่ถูกตั้งชั้น");
});

test("search: members only, and an empty query lists them", async () => {
  const all = await searchMembers(tenantId, "", 5);
  assert.ok(all.length > 0, "คำค้นว่างต้องคืนรายชื่อ ไม่ใช่ []");
  assert.ok(all.every((m) => m.memberNo), "ต้องมีแต่สมาชิก");

  const byNo = await searchMembers(tenantId, all[0].memberNo!, 5);
  assert.ok(byNo.some((m) => m.customerId === all[0].customerId));
});

test("merge: points follow the customer and the merged row releases its number", async () => {
  const keepPhone = `15${String(Date.now()).slice(-8)}`;
  const mergePhone = `14${String(Date.now()).slice(-8)}`;
  const keep = await enrollMember(tenantId, { phone: keepPhone, name: `FAKE ${TAG} keep` });
  const merge = await enrollMember(tenantId, { phone: mergePhone, name: `FAKE ${TAG} merge` });
  if (keep.status === "INVALID" || merge.status === "INVALID") return assert.fail("enrol failed");

  await adjustPoints({ tenantId, customerId: keep.member.customerId, points: 100, note: "keep pts" });
  await adjustPoints({ tenantId, customerId: merge.member.customerId, points: 250, note: "merge pts" });

  await mergeCustomers(tenantId, keep.member.customerId, merge.member.customerId);

  const kept = await getMember(tenantId, keep.member.customerId);
  assert.equal(kept?.pointsUsable, 350, "แต้มของทั้งสองต้องมารวมที่คนที่เก็บไว้");
  assert.equal(kept?.pointsBalance, 350);
  assert.equal(kept?.memberNo, keep.member.memberNo, "คนที่เก็บไว้ต้องคงเลขเดิม");

  const released = await query<{ member_no: string | null }>(
    `SELECT member_no FROM bms_customers WHERE tenant_id = $1 AND id = $2`,
    [tenantId, merge.member.customerId]
  );
  assert.equal(released.rows[0].member_no, null, "แถวที่ถูกผสานต้องปล่อยเลขสมาชิกคืน");
});

test("delete: a member holding usable points cannot be soft-deleted", async () => {
  const phone = `13${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} delete` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const id = r.member.customerId;
  await adjustPoints({ tenantId, customerId: id, points: 120, note: "block delete" });

  await assert.rejects(() => deleteCustomer(tenantId, id), /แต้มใช้ได้ค้างอยู่/);

  await adjustPoints({ tenantId, customerId: id, points: -120, note: "clear before delete" });
  assert.equal(await deleteCustomer(tenantId, id), true, "เคลียร์แต้มแล้วต้องลบได้");
});

test("the outstanding report never disagrees with the ledger", async () => {
  const report = await loyaltyOutstandingReport(tenantId);
  assert.equal(report.balanceMismatchCount, 0,
    `cache ไม่ตรง ledger ${report.balanceMismatchCount} คน — ต้องเป็น 0 เสมอ`);
  assert.ok(report.outstandingPoints >= 0);
  assert.ok(report.outstandingValue >= 0);
});

// ---------------------------------------------------------------
// เส้นทางจริงของบิล: createOrder → payOrder → returnOrder
// นี่คือส่วนที่เสี่ยงที่สุด เพราะถ้าผลรวมส่วนลดไม่ตรงกับ discount_amount
// ฐาน VAT และใบกำกับจะผิด และถ้าจอ POS คิดต่างจากตรงนี้บิลจะถูกยกเลิกทิ้ง
// ---------------------------------------------------------------

const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";

async function ensureProduct(): Promise<void> {
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,100,TRUE,'V')
     ON CONFLICT (tenant_id, sku) DO UPDATE SET price = 100, active = TRUE`,
    [tenantId, SKU, `FAKE ${TAG} product`]
  );
  // สินค้าที่ INSERT ตรง ๆ เป็นฉบับร่างตั้งแต่ 9.51 — ต้องประกาศช่องทางขายเอง
  await query(DECLARE_FAKE_SALES_SURFACES_SQL, [tenantId]);
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,10000,0)
     ON CONFLICT (tenant_id, location_id, product_sku, size)
       DO UPDATE SET current_stock = 10000, reserved_stock = 0`,
    [tenantId, locationId, SKU, SIZE]
  );
}

test("createOrder: tier + coupon + points stack, and the parts sum to discount_amount", async () => {
  await ensureProduct();
  const tier = await upsertMembershipTier(tenantId, {
    code: `${TAG}-ORDER`, name: "Test Order Tier", discountType: "PERCENT", discountValue: 5,
    qualifySpend12m: 0, qualifyPoints: 0, sortOrder: 50, active: true,
  });
  await upsertCoupon(tenantId, {
    code: `${TAG.toUpperCase()}-C10`, type: "FIXED", value: 100, active: true,
    minOrderAmount: null, maxRedemptions: null, perCustomerLimit: null,
    startsAt: null, expiresAt: null, note: `FAKE ${TAG}`,
  } as any);

  const phone = `12${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} order` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const id = r.member.customerId;
  await query(`UPDATE bms_customers SET tier_id = $3 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, tier.id]);
  await adjustPoints({ tenantId, customerId: id, points: 320, note: "for order" });

  // 10 ชิ้น × 100 = 1000 · tier 5% = 50 · คูปอง 100 · แลก 200 แต้ม = 20 → สุทธิ 830
  const created = await createOrder({
    tenantId,
    channel: "web",
    customerId: id,
    locationId,
    items: [{ sku: SKU, size: SIZE, qty: 10 }],
    couponCode: `${TAG.toUpperCase()}-C10`,
    pointsToRedeem: 200,
  });
  assert.equal(created.status, "CREATED", JSON.stringify(created));
  if (created.status !== "CREATED") return;

  assert.equal(created.subtotal, 1000);
  assert.equal(created.discount, 170, "50 + 100 + 20");
  assert.equal(created.total, 830);
  assert.equal(created.pointsUsed, 200);

  // ตัวเลขบนบิลจริงต้องตรงกับที่คืนมา และผลรวมรายบรรทัดต้องเท่า discount_amount
  const row = await query<{ discount_amount: string; total_amount: string }>(
    `SELECT discount_amount, total_amount FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, created.orderId]
  );
  assert.equal(Number(row.rows[0].discount_amount), 170);
  assert.equal(Number(row.rows[0].total_amount), 830);

  const lines = await listOrderDiscounts(tenantId, created.orderId);
  assert.equal(lines.length, 3, JSON.stringify(lines));
  const sum = lines.reduce((n, l) => n + l.amount, 0);
  assert.equal(Math.round(sum * 100) / 100, 170,
    "bms_order_discounts ต้องรวมได้เท่า discount_amount ไม่งั้นสืบย้อนใบกำกับไม่ได้");
  assert.equal(lines.find((l) => l.source === "POINTS")?.pointsUsed, 200);

  // แต้มถูกหักทันทีที่สร้างบิล ไม่ต้องรอชำระเงิน
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 120);

  // จ่ายเงินแล้วต้องได้แต้มจากยอดหลังส่วนลด (830) — ไม่ใช่ 1000
  assert.equal(await payOrder(tenantId, created.orderId), true);
  await new Promise((r) => setTimeout(r, 250)); // reviewMemberTierForOrder ยิงหลัง commit
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 950, "120 + 830");

  // คืนทั้งบิล: ดึง 830 คืน และคืนแต้มที่แลก 200 → กลับไป 320
  // returnOrder รับเฉพาะ SHIPPED/COMPLETED — ข้ามขั้นแพ็ค/ส่งเพราะเทสนี้สนใจแต้ม
  await query(`UPDATE bms_orders SET status = 'COMPLETED' WHERE tenant_id = $1 AND id = $2`,
    [tenantId, created.orderId]);
  assert.equal(await returnOrder(tenantId, created.orderId), true);
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 320,
    "คืนทั้งบิลต้องกลับไปเท่าก่อนซื้อ");
});

test("createOrder: redeeming more than the member holds is refused and nothing is charged", async () => {
  await ensureProduct();
  const phone = `11${String(Date.now()).slice(-8)}`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} short` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const id = r.member.customerId;
  await adjustPoints({ tenantId, customerId: id, points: 100, note: "not enough" });

  const before = await query<{ n: string }>(
    `SELECT COALESCE(SUM(reserved_stock),0) AS n FROM bms_inventory
      WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]
  );
  const res = await createOrder({
    tenantId, channel: "web", customerId: id, locationId,
    items: [{ sku: SKU, size: SIZE, qty: 1 }],
    pointsToRedeem: 500,
  });
  assert.equal(res.status, "POINTS_INVALID", JSON.stringify(res));

  const after = await query<{ n: string }>(
    `SELECT COALESCE(SUM(reserved_stock),0) AS n FROM bms_inventory
      WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]
  );
  assert.equal(after.rows[0].n, before.rows[0].n,
    "ปฏิเสธการแลกแต้มต้อง ROLLBACK สต็อกที่จองไว้ด้วย");
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 100, "แต้มต้องไม่ถูกแตะ");
});

test("createOrder: a non-member cannot redeem, and a foreign customerId is rejected", async () => {
  await ensureProduct();
  const plainId = await makeCustomer(`FAKE ${TAG} plain order`, `10${String(Date.now()).slice(-8)}`);
  const notMember = await createOrder({
    tenantId, channel: "web", customerId: plainId, locationId,
    items: [{ sku: SKU, size: SIZE, qty: 1 }], pointsToRedeem: 100,
  });
  assert.equal(notMember.status, "POINTS_INVALID");

  const foreign = await createOrder({
    tenantId, channel: "web", customerId: "00000000-0000-0000-0000-000000000000", locationId,
    items: [{ sku: SKU, size: SIZE, qty: 1 }],
  });
  assert.equal(foreign.status, "POINTS_INVALID", "customerId ที่ไม่ใช่ลูกค้าร้านนี้ต้องถูกปฏิเสธ");
});

test("cancelOrder returns the points that were redeemed on it", async () => {
  await ensureProduct();
  const phone = `09${String(Date.now()).slice(-7)}9`;
  const r = await enrollMember(tenantId, { phone, name: `FAKE ${TAG} cancelorder` });
  if (r.status === "INVALID") return assert.fail(r.reason);
  const id = r.member.customerId;
  await adjustPoints({ tenantId, customerId: id, points: 400, note: "for cancelorder" });

  const created = await createOrder({
    tenantId, channel: "web", customerId: id, locationId,
    items: [{ sku: SKU, size: SIZE, qty: 5 }], pointsToRedeem: 300,
  });
  assert.equal(created.status, "CREATED", JSON.stringify(created));
  if (created.status !== "CREATED") return;
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 100);

  assert.equal(await cancelOrder(tenantId, created.orderId), true);
  assert.equal((await getMember(tenantId, id))?.pointsUsable, 400, "ยกเลิกบิลต้องคืนแต้มครบ");
});

test("teardown: remove every row this suite created", async () => {
  // enrollMember สร้างลูกค้าใหม่เองเมื่อไม่พบเบอร์ และตอนนั้นยังไม่มี tag 'fake'
  // จึงต้องเก็บด้วยชื่อด้วย ไม่ใช่แค่ tag ไม่งั้นบิลของคนเหล่านั้นค้าง แล้ว
  // bms_order_items จะกัน FK ตอนลบ bms_inventory
  const customers = await query<{ id: string }>(
    `SELECT id FROM bms_customers
      WHERE tenant_id = $1 AND ($2 = ANY(tags) OR name LIKE $3)`,
    [tenantId, TAG, `FAKE ${TAG}%`]
  );
  const ids = customers.rows.map((r) => r.id);

  const orders = await query<{ id: string }>(
    `SELECT id FROM bms_orders
      WHERE tenant_id = $1 AND (customer_ref = $2 OR customer_id = ANY($3::uuid[]))`,
    [tenantId, `FAKE-${TAG}`, ids]
  );
  const orderIds = orders.rows.map((r) => r.id);

  if (orderIds.length) {
    await query(`DELETE FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`,
      [tenantId, orderIds]);
    await query(`DELETE FROM bms_loyalty_ledger WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`,
      [tenantId, orderIds]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, orderIds]);
  }
  if (ids.length) {
    await query(`DELETE FROM bms_customers WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  }
  // upsertMembershipTier แปลง code เป็นตัวพิมพ์ใหญ่ ต้องลบแบบไม่สนตัวพิมพ์
  // ไม่งั้นชั้นของเทสค้างอยู่ในฐานแล้วไปเปลี่ยนชั้นของสมาชิกจริงในรอบถัดไป
  await query(`DELETE FROM bms_membership_tiers WHERE tenant_id = $1 AND upper(code) LIKE upper($2)`,
    [tenantId, `${TAG}-%`]);
  await query(`DELETE FROM bms_coupons WHERE tenant_id = $1 AND code LIKE $2`, [tenantId, `${TAG.toUpperCase()}-%`]);
  // createOrder/returnOrder เขียน ledger สต็อกไว้ ต้องเก็บก่อนจึงลบสินค้าได้
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);

  const left = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM bms_customers
      WHERE tenant_id = $1 AND ($2 = ANY(tags) OR name LIKE $3)`,
    [tenantId, TAG, `FAKE ${TAG}%`]
  );
  assert.equal(Number(left.rows[0].n), 0, "ต้องไม่เหลือลูกค้าของเทสนี้ในฐาน");

  const orphanLedger = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM bms_loyalty_ledger l
      WHERE l.tenant_id = $1
        AND NOT EXISTS (SELECT 1 FROM bms_customers c WHERE c.id = l.customer_id)`,
    [tenantId]
  );
  assert.equal(Number(orphanLedger.rows[0].n), 0, "ต้องไม่มี ledger ที่ไม่มีเจ้าของ");
});
