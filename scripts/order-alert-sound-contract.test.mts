// =============================================================
// เสียงเตือน "มีงานเข้า" + รอบ poll ที่รู้ว่าตัวเองถูกมองอยู่หรือเปล่า
// -------------------------------------------------------------
// เคสจริงจากหน้าร้าน (2026-09-08): "ส่ง order เข้าครัว ต้องรอ 3-5 นาทีกว่าจะเด้ง"
// ไล่แล้วพบว่า **ฝั่ง server ไม่ผิดเลย** (ตั๋วถูก INSERT ในทรานแซกชันเดียวกับการส่งครัว
// แล้ว commit ทันที · route เป็น force-dynamic · client ยิงด้วย cache: "no-store")
// เวลาที่หายไปทั้งหมดอยู่ที่จอ 3 อย่าง ซึ่งไฟล์นี้ตรึงไว้ทั้งสาม:
//
//   1. ตั๋วครัวถูก poll **เฉพาะตอนเปิดแท็บครัวอยู่** → ป้ายจำนวนบนแถบซ้ายไม่มีวันขยับ
//      ตอนพนักงานยืนหน้าผังโต๊ะ และผังโต๊ะเองก็ไม่ refresh (loadFloor อยู่ effect เดียวกัน)
//   2. ไม่มี `visibilitychange` handler เลย → กลับมามองจอแล้วยังต้องรอ tick ถัดไป ซึ่งเป็น
//      รอบที่เพิ่งถูกเบราว์เซอร์หรี่ (Chrome เหลือราว 1 ครั้ง/นาทีเมื่อแท็บถูกซ่อนครบ 5 นาที)
//   3. ป้าย "อัปเดตอัตโนมัติ" อ่านจาก **นาฬิกาของเครื่อง** จึงเดินสวยตลอดแม้เน็ตตายไปแล้ว
//
//   cd apps/web && npx tsx --test ../../scripts/order-alert-sound-contract.test.mts
// =============================================================
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ALERT_KINDS,
  ALERT_TONES,
  ALERT_TONE_IDS,
  alertPollIntervalMs,
  alertToneDurationMs,
  defaultOrderAlertSettings,
  describeAgo,
  evaluateAlertRepeat,
  feedHealth,
  findAlertTone,
  newAlertIds,
  normalizeOrderAlertSettings,
  toneForKind,
  willSound,
  IDLE_ALERT_REPEAT,
  LEGACY_CHIME_STORAGE_KEY,
  ORDER_ALERT_STORAGE_KEY,
} from "../apps/web/lib/pos/orderAlertSound.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

/** เทสสแกนซอร์สต้องไม่เขียวเพราะคอมเมนต์ที่อธิบายกฎเก่า — กับดักเดิมของไฟล์กลุ่มนี้ */
function withoutComments(source: string): string {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

// ---------------------------------------------------------------------------
// กติกาของเสียง
// ---------------------------------------------------------------------------

test("ค่าปริยายคือเปิดเสียง — แท็บเล็ตเครื่องใหม่ต้องไม่เงียบโดยไม่มีอะไรบอก", () => {
  // 9.53 ตั้งค่าปริยายเป็นปิด ด้วยเหตุผลว่าเบราว์เซอร์บล็อกเสียงอยู่แล้ว — แต่นั่นเป็นเหตุผล
  // ให้ "บอกผู้ใช้ว่าต้องแตะ" ไม่ใช่เหตุผลให้จอครัวเงียบ ผลของค่าเดิมคือทุกเครื่องที่เพิ่ง
  // pair เริ่มต้นแบบไม่มีเสียง ซึ่งอ่านไม่ต่างจาก "ระบบไม่มีเสียงเตือน"
  assert.equal(defaultOrderAlertSettings().enabled, true);
  assert.equal(normalizeOrderAlertSettings(null).enabled, true);
});

test("ร้านที่เคยกดปิดเสียงไว้ตั้งแต่ 9.53 ต้องไม่เจอเสียงเด้งขึ้นมาเอง", () => {
  assert.equal(normalizeOrderAlertSettings(null, false).enabled, false);
  assert.equal(normalizeOrderAlertSettings(null, true).enabled, true);
  // มีค่าของเวอร์ชันใหม่แล้ว ค่าเก่าต้องไม่ทับ
  assert.equal(normalizeOrderAlertSettings({ enabled: true }, false).enabled, true);
});

test("ค่าที่อ่านมาผิดรูปต้องตกกลับค่าปริยาย ไม่ใช่ทำให้จอเงียบหรือพัง", () => {
  const base = defaultOrderAlertSettings();
  assert.deepEqual(normalizeOrderAlertSettings("ขยะ"), base);
  assert.deepEqual(normalizeOrderAlertSettings(42), base);
  assert.equal(normalizeOrderAlertSettings({ volume: "ไม่ใช่ตัวเลข" }).volume, base.volume);
  assert.equal(normalizeOrderAlertSettings({ tones: { ORDER_NEW: "ไม่มีเสียงนี้" } }).tones.ORDER_NEW, base.tones.ORDER_NEW);
  // ค่าที่เกินขอบต้องถูกหนีบ ไม่ใช่ถูกทิ้ง
  assert.equal(normalizeOrderAlertSettings({ volume: 9 }).volume, 1);
  assert.equal(normalizeOrderAlertSettings({ volume: -3 }).volume, 0);
  assert.equal(normalizeOrderAlertSettings({ repeatSeconds: 99999 }).repeatSeconds, 300);
  assert.equal(normalizeOrderAlertSettings({ repeatSeconds: -5 }).repeatSeconds, 0);
  assert.equal(normalizeOrderAlertSettings({ maxRepeats: 1000 }).maxRepeats, 50);
});

test("ทุกเหตุการณ์ต้องมีเสียงของตัวเอง และเสียงต้องแยกออกจากกันจริง", () => {
  const settings = defaultOrderAlertSettings();
  for (const kind of ALERT_KINDS) {
    assert.ok(settings.tones[kind], `ไม่มีเสียงปริยายของ ${kind}`);
    assert.ok((ALERT_TONE_IDS as readonly string[]).includes(settings.tones[kind]));
  }
  // ตั๋วใหม่ กับ "เลยเวลาแล้ว" ต้องไม่ใช่เสียงเดียวกัน ไม่งั้นครัวแยกไม่ออกว่าต้องทำอะไร
  assert.notEqual(settings.tones.ORDER_NEW, settings.tones.SLA_LATE);
  assert.notEqual(settings.tones.ORDER_NEW, settings.tones.QR_PENDING);
  assert.notEqual(settings.tones.ORDER_NEW, settings.tones.FOOD_READY);
  // เสียงแต่ละแบบต้องต่างกันด้วย "รูปทำนอง" ไม่ใช่แค่ต่างชื่อ
  const shapes = ALERT_TONES.filter((tone) => tone.steps.length > 0)
    .map((tone) => tone.steps.map((step) => `${step.hz}@${step.atMs}`).join("-"));
  assert.equal(new Set(shapes).size, shapes.length, "มีเสียงสองแบบที่เหมือนกันทุกโน้ต");
});

test("เลือก “ไม่มีเสียง” ให้เหตุการณ์หนึ่งต้องเงียบเฉพาะเหตุการณ์นั้น", () => {
  const settings = normalizeOrderAlertSettings({ tones: { FOOD_READY: "NONE" } });
  assert.equal(willSound(settings, "FOOD_READY"), false);
  assert.equal(willSound(settings, "ORDER_NEW"), true);
  assert.equal(findAlertTone("NONE").steps.length, 0);
  assert.equal(alertToneDurationMs("NONE"), 0);
  // ปิดทั้งเครื่องแล้วต้องเงียบทุกเหตุการณ์
  const off = normalizeOrderAlertSettings({ enabled: false });
  for (const kind of ALERT_KINDS) assert.equal(willSound(off, kind), false);
});

test("toneForKind ต้องตกกลับค่าปริยายเมื่อค่าที่เก็บไว้หายไป", () => {
  const broken = { ...defaultOrderAlertSettings(), tones: {} as never };
  assert.equal(toneForKind(broken, "ORDER_NEW"), defaultOrderAlertSettings().tones.ORDER_NEW);
});

// ---------------------------------------------------------------------------
// ของใหม่เทียบรอบก่อน
// ---------------------------------------------------------------------------

test("รอบแรกหลังเปิดจอเป็นการตั้งต้น ห้ามดังรัวเพราะงานที่ค้างอยู่ก่อนแล้ว", () => {
  assert.deepEqual(newAlertIds(null, ["a", "b", "c"]), []);
  assert.deepEqual(newAlertIds(new Set(["a"]), ["a"]), []);
  assert.deepEqual(newAlertIds(new Set(["a"]), ["a", "b"]), ["b"]);
  // ของที่หายไปแล้วกลับมาใหม่ถือเป็นของใหม่ (ตั๋วถูกย้อนสถานะกลับมา NEW)
  assert.deepEqual(newAlertIds(new Set(["a"]), ["b"]), ["b"]);
});

// ---------------------------------------------------------------------------
// ย้ำจนกว่าจะมีคนรับ
// ---------------------------------------------------------------------------

test("ไม่มีงานค้าง = ล้างนาฬิกา ไม่ใช่แค่หยุดดัง", () => {
  const armed = { lastPlayedAt: 1_000, repeats: 3 };
  const result = evaluateAlertRepeat(armed, { pending: false, now: 99_000, repeatSeconds: 20, maxRepeats: 10 });
  assert.equal(result.play, false);
  assert.deepEqual(result.state, IDLE_ALERT_REPEAT, "กองถัดไปต้องเริ่มนับใหม่ ไม่ใช่ต่อจากกองเก่า");
});

test("เห็นงานค้างครั้งแรกยังไม่ดัง — เสียงแรกมาจากของใหม่แล้ว", () => {
  const first = evaluateAlertRepeat(IDLE_ALERT_REPEAT, { pending: true, now: 1_000, repeatSeconds: 20, maxRepeats: 10 });
  assert.equal(first.play, false, "ดังซ้อนกับเสียงของ newAlertIds");
  assert.equal(first.state.lastPlayedAt, 1_000);
  assert.equal(first.state.repeats, 0);
});

test("ครบรอบแล้วย้ำ และย้ำได้ไม่เกินเพดาน", () => {
  let state = { lastPlayedAt: 1_000, repeats: 0 };
  // ยังไม่ครบ 20 วินาที
  let step = evaluateAlertRepeat(state, { pending: true, now: 20_000, repeatSeconds: 20, maxRepeats: 3 });
  assert.equal(step.play, false);
  // ครบพอดีต้องดัง (ขอบต้องนับเป็น "ถึงแล้ว" ไม่ใช่ "ยังไม่ถึง")
  step = evaluateAlertRepeat(state, { pending: true, now: 21_000, repeatSeconds: 20, maxRepeats: 3 });
  assert.equal(step.play, true);
  assert.equal(step.state.repeats, 1);
  state = step.state;
  for (let round = 2; round <= 3; round += 1) {
    step = evaluateAlertRepeat(state, { pending: true, now: state.lastPlayedAt! + 20_000, repeatSeconds: 20, maxRepeats: 3 });
    assert.equal(step.play, true, `รอบที่ ${round} ต้องยังดัง`);
    state = step.state;
  }
  // เพดาน 3 ครั้งแล้วต้องเงียบ แม้ยังมีงานค้าง — จอที่ไม่มีคนอยู่ต้องไม่ร้องทั้งคืน
  step = evaluateAlertRepeat(state, { pending: true, now: state.lastPlayedAt! + 999_000, repeatSeconds: 20, maxRepeats: 3 });
  assert.equal(step.play, false);
});

test("ตั้งเป็น “ดังครั้งเดียว” แล้วต้องไม่ย้ำเลย", () => {
  const step = evaluateAlertRepeat({ lastPlayedAt: 0, repeats: 0 }, { pending: true, now: 999_000, repeatSeconds: 0, maxRepeats: 10 });
  assert.equal(step.play, false);
  const capped = evaluateAlertRepeat({ lastPlayedAt: 0, repeats: 0 }, { pending: true, now: 999_000, repeatSeconds: 20, maxRepeats: 0 });
  assert.equal(capped.play, false);
});

// ---------------------------------------------------------------------------
// สายข้อมูลยังเดินอยู่ไหม
// ---------------------------------------------------------------------------

test("ยังไม่เคยโหลดสำเร็จ = STALE ไม่ใช่ LIVE", () => {
  // ⚠️ "ตรวจไม่ได้" ต้องไม่ถูกนับเป็น "ไม่มีปัญหา" — จอครัวที่ค้างเงียบ ๆ อ่านไม่ต่างจาก
  // จอครัวที่ไม่มีออร์เดอร์เลย ซึ่งเป็นความล้มเหลวที่แพงที่สุดของเรื่องนี้ทั้งเรื่อง
  assert.equal(feedHealth(null, 100_000, 5_000), "STALE");
});

test("สถานะสายข้อมูลไล่จาก LIVE → SLOW → STALE ตามอายุจริง", () => {
  const now = 1_000_000;
  assert.equal(feedHealth(now - 1_000, now, 5_000), "LIVE");
  assert.equal(feedHealth(now - 15_000, now, 5_000), "LIVE");
  assert.equal(feedHealth(now - 40_000, now, 5_000), "SLOW");
  assert.equal(feedHealth(now - 120_000, now, 5_000), "STALE");
  // รอบที่ยาวโดยตั้งใจ (จอที่ไม่ได้เปิดอยู่) ต้องไม่ถูกตัดสินว่าช้าเพียงเพราะรอบมันยาว
  assert.equal(feedHealth(now - 100_000, now, 60_000), "LIVE");
  // นาฬิกาเครื่องเดินถอยหลังต้องไม่กลายเป็น STALE
  assert.equal(feedHealth(now + 5_000, now, 5_000), "LIVE");
});

test("describeAgo เปลี่ยนหน่วยตามอายุ และไม่มีค่าเมื่อยังไม่เคยโหลด", () => {
  const now = 1_000_000;
  assert.equal(describeAgo(null, now), null);
  assert.deepEqual(describeAgo(now - 3_000, now), { unit: "seconds", value: 3 });
  assert.deepEqual(describeAgo(now - 240_000, now), { unit: "minutes", value: 4 });
});

test("รอบ poll ต้องช้าลงเมื่อจอถูกซ่อน แต่ห้ามหยุดสนิท", () => {
  const focused = alertPollIntervalMs({ focused: true, visible: true });
  const background = alertPollIntervalMs({ focused: false, visible: true });
  const hidden = alertPollIntervalMs({ focused: true, visible: false });
  assert.ok(focused < background, "จอที่กำลังถูกมองต้องไวที่สุด");
  assert.ok(background < hidden);
  assert.ok(hidden > 0 && Number.isFinite(hidden), "แท็บที่ถูกซ่อนต้องยังมีรอบของตัวเอง");
  // ป้ายตัวเลขบนแถบซ้ายมองเห็นได้จากทุกจอ — รอบของ "จออื่น" จึงต้องไม่ยาวจนป้ายไร้ความหมาย
  assert.ok(background <= 20_000);
});

// ---------------------------------------------------------------------------
// จอที่ใช้กติกาเหล่านี้จริง
// ---------------------------------------------------------------------------

test("ตั๋วครัวต้องถูกดึงจากทุกจอ ไม่ใช่เฉพาะตอนเปิดแท็บครัว", async () => {
  const source = withoutComments(await read("../apps/web/app/(pos)/pos/restaurant/page.tsx"));
  // ⚠️ นี่คือบั๊กหลักของรอบนี้: ป้ายจำนวนข้างเมนู "ครัว" คำนวณจาก `tickets` ซึ่งถูกโหลด
  // เฉพาะใน effect ที่ guard ด้วย screen === "KITCHEN" — ป้ายจึงไม่มีวันขยับตอนยืนหน้าผังโต๊ะ
  // และ loadFloor() ที่อยู่ใน effect เดียวกันก็ไม่ทำงานด้วย (ผังโต๊ะค้าง)
  const start = source.indexOf("const ticketPollMs");
  assert.ok(start > 0, "หา ticketPollMs ไม่เจอ — เทสนี้เลิกตรวจอะไรแล้ว");
  // ตัดถึง useLiveRefresh ตัวถัดไป (ของคิว QR) เพื่อไม่ให้ช่วงที่สแกนกินบล็อกอื่นเข้ามา
  const nextHook = source.indexOf("useLiveRefresh({", source.indexOf("useLiveRefresh({", start) + 1);
  const feed = source.slice(start, nextHook > start ? nextHook : start + 800);
  assert.match(feed, /loadTickets\(\)/);
  assert.match(feed, /loadFloor\(\)/, "ผังโต๊ะต้องรีเฟรชคู่กับตั๋ว ไม่งั้นเครื่องอื่นเปิดโต๊ะแล้วจอนี้ไม่เห็น");
  // หัวใจของบั๊ก: enabled ห้ามผูกกับจอที่เปิดอยู่ — ผูกเมื่อไรป้ายจำนวนบนแถบซ้าย
  // (ซึ่งมองเห็นได้จากทุกจอ) จะไม่มีวันขยับตอนพนักงานยืนหน้าผังโต๊ะ
  const enabledClause = feed.slice(feed.indexOf("enabled:"), feed.indexOf("intervalMs:"));
  assert.ok(enabledClause.length > 0);
  assert.doesNotMatch(enabledClause, /screen/, "ตั๋วครัวกลับไปผูกกับแท็บครัวอีกแล้ว");
  // รอบยังต้องมีอยู่บนจออื่น แค่ช้าลง
  assert.match(feed, /alertPollIntervalMs\(/);
});

test("ทุกรอบอัตโนมัติของจอร้านอาหารต้องผ่าน useLiveRefresh ไม่ใช่ setInterval เปล่า", async () => {
  const source = withoutComments(await read("../apps/web/app/(pos)/pos/restaurant/page.tsx"));
  // setInterval เปล่า ๆ ไม่มีทางรู้ว่าแท็บถูกซ่อนอยู่ และไม่โหลดทันทีตอนกลับมามองเห็น
  // ที่เหลือได้คือนาฬิกาบนจอ (setNow/setBoardNow) ซึ่งไม่ได้ยิงเครือข่าย
  for (const match of source.matchAll(/window\.setInterval\(([\s\S]{0,120}?)\)/g)) {
    assert.doesNotMatch(match[1], /load[A-Z]/, `ยังมี poll ที่ไม่ผ่าน useLiveRefresh: ${match[1].slice(0, 60)}`);
  }
  assert.match(source, /useLiveRefresh\(/);
});

test("ป้ายสถานะของจอครัวต้องอ่านจากเวลาที่โหลดสำเร็จ ไม่ใช่จากนาฬิกา", async () => {
  const source = withoutComments(await read("../apps/web/app/(pos)/pos/restaurant/page.tsx"));
  // ของเดิม: t("pos_restaurant.auto_updated_at", { time: timeOf(new Date(boardNow)...) })
  // = นาฬิกาของเครื่อง จึงเดินสวยตลอดแม้เน็ตตายไปแล้วสิบนาที
  assert.doesNotMatch(source, /auto_updated_at/, "ป้ายกลับไปโชว์นาฬิกาของเครื่องแล้ว");
  assert.match(source, /feedHealth\(ticketFeed\.lastOkAt/);
  assert.match(source, /describeAgo\(ticketFeed\.lastOkAt/);
});

test("จอครัวหลังบ้านต้องมีเสียง และต้องไม่กลับไปใช้ pollInterval ของ Apollo", async () => {
  const source = withoutComments(await read("../apps/web/app/(admin)/admin/kitchen/page.tsx"));
  // จอนี้เคยไม่มีเสียงเลย ทั้งที่ทำงานเดียวกับจอครัวที่เครื่องขาย
  assert.match(source, /useOrderAlerts\(/);
  assert.match(source, /alerts\.notify\("ORDER_NEW"\)/);
  // pollInterval ของ Apollo เป็น timer ธรรมดา โดนหรี่ตอนแท็บถูกซ่อนเหมือนกัน และไม่มี
  // การโหลดทันทีตอนกลับมามองเห็น
  assert.doesNotMatch(source, /pollInterval/, "กลับไปใช้ pollInterval ของ Apollo แล้ว");
  assert.match(source, /useLiveRefresh\(/);
});

test("คิวคำขอจากแชทต้องดึงเอง ไม่ใช่รอให้คนกดปุ่มโหลด", async () => {
  const source = withoutComments(await read("../apps/web/components/RestaurantRequestQueue.tsx"));
  // เส้นทางนี้เคยเป็นเส้นเดียวในสามเส้นที่ไม่มีสัญญาณอะไรเลย: ไม่ poll ไม่มีป้าย ไม่มีเสียง
  // แปลว่ารอได้ไม่จำกัด ไม่ใช่แค่ช้า
  assert.match(source, /useLiveRefresh\(/);
  assert.match(source, /alerts\.notify\('CHAT_REQUEST'\)/);
  assert.match(source, /pendingCount/);
});

test("ออร์เดอร์ออนไลน์ที่เครื่องขายค้าปลีกต้องมีป้ายนับและดึงจากทุกแท็บ", async () => {
  const source = withoutComments(await read("../apps/web/app/(pos)/pos/page.tsx"));
  assert.doesNotMatch(source, /tab !== "incoming" \|\| !token/, "กลับไปดึงเฉพาะตอนเปิดแท็บออร์เดอร์เข้า");
  assert.match(source, /incomingWaitingCount/);
  assert.match(source, /alerts\.notify\("CHAT_REQUEST"\)/);
});

test("ทุกจอที่มีเสียงต้องบอกได้เมื่อเบราว์เซอร์บล็อกเสียงอยู่", async () => {
  // ⚠️ บั๊กเดิมของ 9.53: AudioContext ถูกสร้างครั้งแรกจากใน setInterval ซึ่งไม่ใช่ user
  // gesture → ปุ่มโชว์ว่า "เปิดเสียงอยู่" แต่เงียบสนิทหลังรีเฟรชหน้า **โดยไม่มีอะไรบอกเลย**
  for (const path of [
    "../apps/web/app/(pos)/pos/restaurant/page.tsx",
    "../apps/web/app/(admin)/admin/kitchen/page.tsx",
    "../apps/web/components/RestaurantRequestQueue.tsx",
    "../apps/web/app/(pos)/pos/page.tsx",
  ]) {
    const source = withoutComments(await read(path));
    assert.match(source, /alerts\.blocked/, `${path} ไม่มีทางบอกผู้ใช้ว่าเสียงถูกบล็อก`);
  }
});

test("การตั้งค่าเสียงเป็นของอุปกรณ์ และคีย์ที่ใช้ต้องคงที่", async () => {
  // คีย์ที่เปลี่ยนไปเงียบ ๆ = ทุกเครื่องในร้านกลับไปเป็นค่าปริยายพร้อมกันหลัง deploy
  assert.equal(ORDER_ALERT_STORAGE_KEY, "bms.pos.orderAlert.v1");
  assert.equal(LEGACY_CHIME_STORAGE_KEY, "bms.pos.kitchenChime");
  const hook = withoutComments(await read("../apps/web/app/hooks/useOrderAlerts.ts"));
  assert.match(hook, /localStorage/);
  // PIN/ตัวกรอง/ผู้ปฏิบัติงานห้ามหลุดลงเครื่องพร้อมกับการตั้งค่าเสียง
  assert.doesNotMatch(hook, /\bpin\b/i);
});

test("ตัวเล่นเสียงต้องรายงานตรง ๆ เมื่อดังไม่ออก ไม่ใช่บอกว่าสำเร็จ", async () => {
  const player = withoutComments(await read("../apps/web/lib/pos/orderAlertPlayer.ts"));
  const play = player.slice(player.indexOf("play(tone, volume)"), player.indexOf("async unlock()"));
  assert.ok(play.length > 0, "หาเมธอด play ไม่เจอ — เทสนี้เลิกตรวจอะไรแล้ว");
  // context ที่ยัง suspended ต้องคืน false เพื่อให้จอขึ้นแถบ "แตะเพื่อเปิดเสียง"
  // การรายงานว่าดังแล้วทั้งที่เงียบคือสิ่งที่ทำให้บั๊กเดิมอยู่ได้นานโดยไม่มีใครเห็น
  assert.match(play, /state === "suspended"/);
  assert.match(play, /return false/);
});
