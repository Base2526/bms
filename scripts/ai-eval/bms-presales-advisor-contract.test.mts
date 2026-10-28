import assert from "node:assert/strict";
import test from "node:test";
import { extractPresalesNeeds, composePresalesRecommendation, presalesContact } from "../../apps/web/lib/bms/presalesAdvisor.ts";
import type { PublicPlan } from "../../apps/web/lib/bms/platformPresales.ts";
import { searchBmsPresalesKnowledge } from "../../apps/web/lib/bms/platformPresales.ts";
const plan = (code: string, price: number, devices: number, branches: number): PublicPlan => ({
  code, name: code, price_monthly: price, price_yearly: price * 10, max_devices: devices, max_branches: branches,
  max_users: 10, max_channels: 5, max_products: 5000, max_orders_month: -1,
  ai_credits_monthly: 1000, feature_keys: [], verifiedAt: new Date().toISOString(),
});
const plans = [plan("free", 0, 1, 1), plan("pro", 990, 3, 1), plan("business", 4900, 10, 5)];
const reply = (text: string, catalog = plans) => composePresalesRecommendation(catalog, extractPresalesNeeds([text]), "th")!;

test("four POS devices recommends cheapest actual fit and explains smaller plans", () => {
  const text = reply("ร้านขนาดใหญ่ ใช้ POS 4 เครื่อง แนะนำ package");
  assert.match(text, /business 4,900/);
  assert.match(text, /pro: เครื่อง POS 3 < 4/);
  assert.match(text, /เครื่อง POS 4 \/ 10/);
  assert.doesNotMatch(text, /กี่เครื่อง POS/);
  assert.equal(composePresalesRecommendation(plans, extractPresalesNeeds(["ร้านใหญ่"]), "th"), null);
  assert.match(reply("POS 4 เครื่อง", [plan("custom", 200, 4, 1), ...plans]), /custom 200/);
});

test("monthly budget before or after amount offers entry paid option with complete live details", () => {
  for (const message of ["มีงบ เดือนละ 2500 มี package ไหนแนะนำ", "งบเดือนละ 2,500 บาท", "งบประมาณต่อเดือน ๒๕๐๐", "งบ 2500 บาทต่อเดือน", "monthly budget of 2500 THB"]) {
    assert.equal(extractPresalesNeeds([message]).budgetMonthly, 2500, message);
    const text = reply(message, [{ ...plans[1], feature_keys: ["REPORT_SCHEDULE"] }, plans[0], plans[2]]);
    assert.match(text, /pro 990 บาท\/เดือน/);
    assert.match(text, /งบ 2,500/);
    assert.match(text, /• เครื่อง POS 3/);
    assert.match(text, /• สาขา 1/);
    assert.match(text, /• บัญชีผู้ใช้ 10/);
    assert.match(text, /• สินค้า 5,000/);
    assert.match(text, /• ช่องทาง 5/);
    assert.match(text, /• ออร์เดอร์\/เดือน ไม่จำกัด/);
    assert.match(text, /• แต้ม AI\/เดือน 1,000/);
    assert.match(text, /ตั้งเวลารายงาน/);
    assert.match(text, /ตัวเลือกฟรี/);
    assert.doesNotMatch(text, /business 4,900|รองรับจำนวนที่ระบุได้ครบ/);
  }
});

test("budget advice respects actual prices, zero budget, no affordable plan and existing device needs", () => {
  assert.match(reply("งบเดือนละ 2500", [plan("changed", 1499, 2, 1)]), /changed 1,499/);
  assert.match(reply("งบเดือนละ 0"), /free 0 บาท/);
  assert.match(reply("งบเดือนละ 500", [plans[1], plans[2]]), /ยังไม่พบแพ็กเกจ.*อยู่ในงบ/);
  assert.match(reply("งบเดือนละ 2500 ใช้ POS 4 เครื่อง"), /เกินงบ 2,500/);
  assert.match(reply("งบเดือนละ 2500", []), /ตรวจสอบรายการล่าสุดไม่สำเร็จ/);
  assert.equal(extractPresalesNeeds(["monthly budget 2500 USD"]).budgetMonthly, undefined);
});
test("Thai words, Thai digits, English, follow-up updates and monthly counts are understood", () => {
  for (const value of ["POS สี่เครื่อง", "POS ๔ เครื่อง", "four POS devices", "4 เครื่องครับ"]) {
    assert.equal(extractPresalesNeeds([value]).counts.max_devices, 4, value);
  }
  const needs = extractPresalesNeeds(["POS 4 เครื่อง 2 สาขา", "POS 6 เครื่อง"]);
  assert.equal(needs.counts.max_devices, 6);
  assert.equal(needs.counts.max_branches, 2);
  assert.equal(extractPresalesNeeds(["1,000,000 orders/month"]).counts.max_orders_month, 1000000);
  assert.equal(extractPresalesNeeds(["20 orders/day"]).counts.max_orders_month, undefined);
  assert.match(reply("POS 4 เครื่อง 6 สาขา"), /ยังไม่พบแพ็กเกจ/);
});
test("ranges and per-branch numbers request confirmation rather than under-sizing", () => {
  for (const value of ["POS 3-4 เครื่อง", "2 สาขา สาขาละ POS 4 เครื่อง", "4.5 POS devices"]) {
    assert.match(reply(value), /ขอจำนวนเครื่อง POS รวม/);
  }
  assert.equal(extractPresalesNeeds(["2 สาขา สาขาละ POS 4 เครื่อง", "รวมทุกสาขา POS 8 เครื่อง"]).ambiguous, false);
});
test("requested features, budget and AI allowance remain independent of device capacity", () => {
  const featurePlan = { ...plans[2], feature_keys: ["RETENTION_ENGINE"] as PublicPlan["feature_keys"] };
  assert.match(reply("POS 1 เครื่อง ต้องการ retention", [plans[0], featurePlan]), /business/);
  assert.match(reply("POS 4 เครื่อง งบไม่เกิน 1,000 บาท/เดือน"), /เกินงบ 1,000/);
  assert.match(reply("POS 4 เครื่อง 2000 แต้ม AI/เดือน"), /ยังไม่พบแพ็กเกจ/);
  assert.match(reply("POS 4 เครื่อง", []), /ตรวจสอบรายการล่าสุดไม่สำเร็จ/);
});
test("unlimited is the explicit sentinel, malformed limits never grant capacity", () => {
  assert.match(reply("POS 100 เครื่อง", [plan("enterprise", 29900, -1, -1)]), /เริ่ม 29,900/);
  assert.match(reply("POS 4 เครื่อง", [plan("broken", 1, NaN, 1)]), /ยังไม่พบแพ็กเกจ/);
  assert.match(reply("POS 4 เครื่อง", [plan("broken", 1, -2, 1)]), /ยังไม่พบแพ็กเกจ/);
  assert.match(reply("POS 4 เครื่อง", [plan("enterprise", 29900, 100, 50)]), /สัญญารายปี/);
});
test("fallback offers the verified LINE contact and never invents a telephone or a booked handoff", () => {
  assert.match(presalesContact("th", "web"), /@168tnlzi.*https:\/\/line.me/);
  assert.match(presalesContact("th", "line"), /คุณอยู่ใน LINE/);
  assert.match(presalesContact("en", "web"), /does not create a ticket/);
});

test("mobile stock retrieval includes limitations and unrelated SKU identifiers are not capacity", () => {
  for (const query of ["เช็คสต็อกผ่านมือถือได้ไหม", "mobile stock", "Stock Mode"]) {
    const found = searchBmsPresalesKnowledge(query, "th", 5).find(entry => entry.id === "mobile-stock");
    assert.ok(found, query);
    assert.match(found.answer.th, /หน่วยฐาน/);
    assert.match(found.answer.th, /ยังไม่รองรับ Serial/);
    assert.match(found.answer.en, /offline counting are not confirmed/);
  }
  assert.deepEqual(extractPresalesNeeds(["ราคา SKU123"]).counts, {});
  const changed = extractPresalesNeeds(["ต้องการ retention", "ไม่ต้องการ retention"]);
  assert.deepEqual(changed.features, []);
});
