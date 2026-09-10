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
  assert.notEqual(settings.tones.ORDER_ACTION, settings.tones.ORDER_NEW);
  assert.notEqual(settings.tones.INBOX_MESSAGE, settings.tones.ORDER_ACTION);
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
  assert.match(feed, /loadTickets\(signal\)/);
  // หัวใจของบั๊ก: enabled ห้ามผูกกับจอที่เปิดอยู่ — ผูกเมื่อไรป้ายจำนวนบนแถบซ้าย
  // (ซึ่งมองเห็นได้จากทุกจอ) จะไม่มีวันขยับตอนพนักงานยืนหน้าผังโต๊ะ
  const enabledClause = feed.slice(feed.indexOf("enabled:"), feed.indexOf("intervalMs:"));
  assert.ok(enabledClause.length > 0);
  assert.doesNotMatch(enabledClause, /screen/, "ตั๋วครัวกลับไปผูกกับแท็บครัวอีกแล้ว");
  // รอบยังต้องมีอยู่บนจออื่น แค่ช้าลง
  assert.match(feed, /alertPollIntervalMs\(/);
  // เสียงทั้งสี่ต้องมาจากจุดของตัวเอง — ถอดตัวใดตัวหนึ่งออกต้องแดง ไม่ใช่รอดเพราะยังมี
  // คำว่า notify เหลืออยู่ที่อื่นในไฟล์เดียวกัน
  assert.match(source, /newAlertIds\(knownTicketIds\.current, openIds\)[\s\S]{0,40}alerts\.notify\("ORDER_NEW"\)/);
  assert.match(source, /newAlertIds\(knownReadyTicketIds\.current, readyIds\)[\s\S]{0,40}alerts\.notify\("FOOD_READY"\)/);
  assert.match(source, /newAlertIds\(knownQrSubmissionIds\.current, pendingIds\)[\s\S]{0,40}alerts\.notify\("QR_PENDING"\)/);
  assert.match(source, /newAlertIds\(knownLateTicketIds\.current, late\)[\s\S]{0,40}alerts\.notify\("SLA_LATE"\)/);
  assert.equal((source.match(/repeat\.play\) alerts\.notify\(/g) ?? []).length, 2,
    "ต้องย้ำทั้งตั๋วครัวและคิว QR — สองกองนี้รอคนละคนมากด");
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
  assert.match(source, /newAlertIds\(knownNewIds\.current, newIds\)[\s\S]{0,40}alerts\.notify\("ORDER_NEW"\)/);
  assert.match(source, /newAlertIds\(knownReadyIds\.current, readyIds\)[\s\S]{0,40}alerts\.notify\("FOOD_READY"\)/);
  assert.match(source, /repeat\.play\) alerts\.notify\("ORDER_NEW"\)/);
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
  assert.match(source, /pendingCount/);
  // ⚠️ ต้องแยกสองเสียงออกจากกัน: เสียงตอน "ของใหม่เข้ามา" กับเสียง "ย้ำจนกว่าจะมีคนรับ"
  // assert แค่ว่ามีคำว่า notify อยู่ไหน ๆ ในไฟล์ = ถอดตัวใดตัวหนึ่งออกแล้วยังเขียว
  assert.match(source, /newAlertIds\(knownPendingIds\.current,\s*pending\)[\s\S]{0,60}alerts\.notify\('CHAT_REQUEST'\)/);
  assert.match(source, /repeat\.play\) alerts\.notify\('CHAT_REQUEST'\)/);
});

test("ออร์เดอร์ออนไลน์ที่เครื่องขายค้าปลีกต้องมีป้ายนับและดึงจากทุกแท็บ", async () => {
  const source = withoutComments(await read("../apps/web/app/(pos)/pos/page.tsx"));
  assert.doesNotMatch(source, /tab !== "incoming" \|\| !token/, "กลับไปดึงเฉพาะตอนเปิดแท็บออร์เดอร์เข้า");
  assert.match(source, /incomingWaitingCount/);
  assert.match(source, /newAlertIds\(knownIncomingIds\.current, waiting\)[\s\S]{0,40}alerts\.notify\("CHAT_REQUEST"\)/);
  assert.match(source, /repeat\.play\) alerts\.notify\("CHAT_REQUEST"\)/);
  // ป้ายต้องนับเฉพาะออร์เดอร์ที่ "ยังไม่มีใครกดรับ" (PAID) ไม่ใช่ทุกใบบนจอ —
  // PACKING คือรับแล้วและครัวมีตั๋วไปแล้ว การนับรวมทำให้ป้ายไม่มีวันเป็นศูนย์
  assert.match(source, /incomingOrders\.filter\(\(row\) => row\.status === "PAID"\)/);
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
    // ⚠️ ต้องมี \b — /alerts\.blocked/ เปล่า ๆ ไปแมตช์คีย์ i18n `pos_alerts.blocked_banner`
    // ด้วย แล้วเทสเขียวทั้งที่แถบเตือนถูกถอดออกไปแล้ว (เจอจาก mutation test จริง)
    assert.match(source, /\balerts\.blocked\b/, `${path} ไม่มีทางบอกผู้ใช้ว่าเสียงถูกบล็อก`);
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
  const suspended = play.slice(play.indexOf('state === "suspended"'), play.indexOf("blocked = false;"));
  assert.ok(suspended.length > 0, "หากิ่ง suspended ไม่เจอ");
  // ⚠️ ต้องเล็งเข้าไปใน "กิ่ง suspended" เท่านั้น — assert /return false/ กับทั้งเมธอดจะเขียว
  // ด้วย `return false` ของบล็อก catch ท้ายเมธอด แล้วมิวเทชันที่กลับค่าเป็น true รอดไปได้
  assert.match(suspended, /return false;/);
  assert.doesNotMatch(suspended, /return true;/, "กิ่งที่ถูกบล็อกต้องไม่รายงานว่าดังสำเร็จ");
});

// ---------------------------------------------------------------------------
// ทำไมจอครัวช้าได้ทั้งที่จอเปิดค้างอยู่ (สาเหตุที่หก)
// ---------------------------------------------------------------------------
//
// รายงานรอบสอง: จอครัวเปิดค้างที่แท็บครัวและ **จอไม่ดับ** แต่ยังรอ 3-5 นาที
// → ตัดเรื่องเบราว์เซอร์หรี่ timer ทิ้งได้ ต้นเหตุที่เหลืออยู่ที่ต้นทุนของคำขอ ไม่ใช่จังหวะของมัน

test("คิวครัวต้องกรองใน UNION แต่ละกิ่ง ไม่ใช่กรองข้างนอกหลังรวมทั้งประวัติแล้ว", async () => {
  const source = withoutComments(await read("../apps/web/lib/bms/kitchen.ts"));
  const sql = source.slice(source.indexOf("SELECT * FROM ("), source.indexOf("ORDER BY recent."));
  assert.ok(sql.length > 0, "หา SQL ของกระดานไม่เจอ — เทสนี้เลิกตรวจอะไรแล้ว");
  // ⚠️ ของเดิมกรองสถานะ *หลัง* UNION → Postgres ต้องอ่านตั๋วทั้งประวัติของร้าน + join
  // order items/checks/tables ก่อนถึงจะตัดเหลือ 200 ใบ · ต้นทุนจึงโตทุกวันที่ร้านเปิด
  // ร้านที่ขายมาสามเดือนอ่านตั๋วหลายหมื่นใบทุก 5 วินาที
  assert.doesNotMatch(sql, /WHERE \(\$2::text IS NULL OR all_tickets\.status/, "กลับไปกรองข้างนอก UNION แล้ว");
  assert.equal((sql.match(/status IN \(\$\{KITCHEN_OPEN_STATUS_SQL\}\)/g) ?? []).length, 2,
    "ตัวกรองต้องอยู่ครบทั้งสองกิ่งของ UNION — ขาดกิ่งใดกิ่งหนึ่งคือกิ่งนั้นยังอ่านทั้งประวัติ");
  assert.equal((sql.match(/updated_at > now\(\) - \(\$4 \|\| ' hours'\)::interval/g) ?? []).length, 2);
});

test("รายการสถานะต้องเป็น literal ใน SQL และตรงกับ predicate ของ partial index", async () => {
  const source = withoutComments(await read("../apps/web/lib/bms/kitchen.ts"));
  const declared = source.match(/const KITCHEN_OPEN_STATUSES = \[([^\]]+)\]/);
  assert.ok(declared, "หา KITCHEN_OPEN_STATUSES ไม่เจอ");
  const statuses = [...declared![1].matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(statuses, ["NEW", "PREPARING", "READY"]);
  // ⚠️ ต้องเป็น literal ไม่ใช่ `= ANY($n)` — planner พิสูจน์ไม่ได้ว่าพารามิเตอร์ตรงกับ
  // predicate ของ partial index เพราะค่าเพิ่งรู้ตอนรัน แล้วดัชนีที่สร้างไว้จะไม่ถูกใช้เลย
  assert.match(source, /KITCHEN_OPEN_STATUS_SQL = KITCHEN_OPEN_STATUSES\.map/);
  const boardSql = source.slice(source.indexOf("SELECT * FROM ("), source.indexOf("ORDER BY recent."));
  assert.ok(boardSql.length > 0);
  // เล็งเฉพาะ SQL ของกระดาน — ฟังก์ชันอื่นในไฟล์เดียวกัน (ยกเลิกตั๋วของบิล) ใช้ ANY($n)
  // อย่างถูกต้อง การห้ามทั้งไฟล์จะแดงด้วยเหตุผลผิด
  assert.doesNotMatch(boardSql, /status = ANY\(\$\d::text\[\]\)/, "กลับไปส่งสถานะเป็นพารามิเตอร์แล้ว");

  const migration = await read("../db/migrations/9.68__bms_kitchen_board_indexes.sql");
  const openPredicates = [...migration.matchAll(/WHERE status IN \(([^)]+)\)/g)]
    .map((match) => [...match[1].matchAll(/'([A-Z_]+)'/g)].map((inner) => inner[1]));
  assert.equal(openPredicates.length, 2, "ต้องมีดัชนีของตั๋วที่ยังไม่จบทั้งสองตาราง");
  // predicate ที่ไม่ตรงกับ SQL เป๊ะ ๆ = ดัชนีที่ถูกสร้างทิ้งไว้โดยไม่มีใครใช้
  for (const predicate of openPredicates) assert.deepEqual(predicate, statuses);
  assert.equal((migration.match(/WHERE status = 'SERVED'/g) ?? []).length, 2,
    "ช่องเสิร์ฟแล้วกรองด้วย updated_at จึงต้องมีดัชนีของตัวเอง");
  // ตั๋วที่ยังไม่จบไม่มีขอบเวลา จึงต้องเรียงด้วย created_at ส่วนช่องเสิร์ฟแล้วกรองด้วย updated_at
  assert.equal((migration.match(/\(tenant_id, created_at DESC\)/g) ?? []).length, 2);
  assert.equal((migration.match(/\(tenant_id, updated_at DESC\)/g) ?? []).length, 2);
});

test("คิวครัวต้องห้ามแคชทุกชั้น ไม่ใช่แค่ปิดแคชของ Next", async () => {
  const route = withoutComments(await read("../apps/web/app/api/pos/kitchen/tickets/route.ts"));
  // `force-dynamic` คุมแค่แคชของ Next เอง ไม่ได้ประกาศอะไรกับ reverse proxy หน้าแอป
  assert.match(route, /dynamic = "force-dynamic"/);
  assert.match(route, /"Cache-Control": "no-store/);
});

test("รอบ poll ต้องมีตัวจับเวลา และต้องปลดด่านกันรอบซ้อนเสมอ", async () => {
  const hook = withoutComments(await read("../apps/web/app/hooks/useLiveRefresh.ts"));
  // ⚠️ ด่านกันรอบซ้อนที่ไม่มี timeout อันตรายกว่าไม่มีด่าน: คำขอที่ค้าง (เน็ตร้านหลุดครึ่งทาง —
  // fetch ไม่มี timeout ในตัวเลย) จะทำให้ inFlight ค้าง true ตลอดกาล = จอหยุดอัปเดตถาวร
  assert.match(hook, /inFlight\.current = true/);
  assert.match(hook, /AbortController/);
  assert.match(hook, /controller\.abort\(\)/);
  assert.match(hook, /Promise\.race/, "ต้อง race ไม่ใช่แค่ abort — ผู้เรียกที่ไม่ส่ง signal ต่อจะยังค้าง");
  const release = hook.slice(hook.indexOf("} finally {"), hook.indexOf("const refreshNow"));
  assert.match(release, /inFlight\.current = false/, "ด่านต้องถูกปลดใน finally ไม่ใช่ในทางที่สำเร็จเท่านั้น");
});

test("ทุกจอที่ poll ต้องส่ง signal ต่อให้ fetch จริง", async () => {
  // คำขอที่ยกเลิกไม่ได้ยังกินคิว 6 connection ของเบราว์เซอร์ต่อไปแม้เราเลิกรอคำตอบแล้ว
  // ซึ่งเป็นครึ่งหนึ่งของอาการ "จอเปิดค้างอยู่แต่ข้อมูลช้าเป็นนาที"
  const restaurant = withoutComments(await read("../apps/web/app/(pos)/pos/restaurant/page.tsx"));
  for (const loader of ["loadTickets", "loadFloor", "loadQrSubmissions", "loadWaitlist"]) {
    assert.match(restaurant, new RegExp(`async function ${loader}\\(signal\\?: AbortSignal\\)`), `${loader} ไม่รับ signal`);
    assert.match(restaurant, new RegExp(`onRefresh: \\(signal\\) => ${loader}\\(signal\\)`), `${loader} ไม่ถูกต่อ signal`);
  }
  const queue = withoutComments(await read("../apps/web/components/RestaurantRequestQueue.tsx"));
  assert.match(queue, /cache:'no-store',signal,/);
  const pos = withoutComments(await read("../apps/web/app/(pos)/pos/page.tsx"));
  assert.match(pos, /cache: "no-store", signal/);
});

test("ผังโต๊ะต้องมีรอบของตัวเอง ไม่ยิงคู่กับตั๋วครัวทุกรอบ", async () => {
  const source = withoutComments(await read("../apps/web/app/(pos)/pos/restaurant/page.tsx"));
  // ยิงสองคำขอต่อรอบ = ชนเพดาน 6 connection ต่อโดเมนเร็วเป็นสองเท่าเมื่อ server ช้า
  // และจอครัวไม่ได้ต้องการผังโต๊ะใหม่ทุก 5 วินาทีอยู่แล้ว
  assert.doesNotMatch(source, /Promise\.all\(\[loadTickets\(\), loadFloor\(\)\]\)/, "กลับไปยิงคู่กันทุกรอบแล้ว");
  assert.match(source, /onRefresh: \(signal\) => loadFloor\(signal\)/);
  assert.match(source, /focused: screen === "FLOOR"/, "ผังโต๊ะต้องไวขึ้นตอนคนกำลังดูผังอยู่");
});

// ---------------------------------------------------------------------------
// recheck: ของที่งานรอบนี้ทำพังเอง
// ---------------------------------------------------------------------------

test("การตั้งค่าเสียงต้องมีชุดเดียวต่อหน้า ไม่ใช่ชุดใครชุดมัน", async () => {
  const hook = withoutComments(await read("../apps/web/app/hooks/useOrderAlerts.ts"));
  // ⚠️ `/pos` เรียก hook เอง แล้วยังเรนเดอร์ RestaurantRequestQueue ซึ่งเรียกอีกตัว
  // ถ้าต่างคนต่างถือ state จะได้สองอย่างที่ผิดพร้อมกัน: AudioContext สองตัวต่อหน้า และ
  // การตั้งค่าเขียนทับกันด้วยค่าที่ค้าง (ปรับความดังที่แผงหนึ่ง แล้วกดปิดเสียงที่อีกแผง
  // → แผงที่สอง merge patch เข้ากับ settings ชุดเก่าที่มันถืออยู่ ความดังเด้งกลับเงียบ ๆ)
  assert.match(hook, /useSyncExternalStore/, "state ต้องอยู่ระดับโมดูล ไม่ใช่ใน component");
  assert.doesNotMatch(hook, /useState<OrderAlertSettings>/, "กลับไปถือ settings แยกกันต่อ component แล้ว");
  assert.match(hook, /let snapshot: Snapshot/);
  // ตัวเล่นเสียงต้องมีตัวเดียวเช่นกัน — AudioContext เป็นทรัพยากรของเครื่องเสียง
  assert.match(hook, /if \(player\) return;/, "activate ต้องกันการสร้างตัวเล่นเสียงซ้ำ");
});

test("จอที่ไม่มีเหตุการณ์ให้ดังต้องไม่ไปแตะเครื่องเสียงของแท็บเล็ต", async () => {
  const hook = withoutComments(await read("../apps/web/app/hooks/useOrderAlerts.ts"));
  assert.match(hook, /export function useOrderAlerts\(active = true\)/);
  assert.match(hook, /if \(!active\) return;/, "consumer ที่ไม่ active ต้องไม่ activate ตัวเล่นเสียง");

  const pos = withoutComments(await read("../apps/web/app/(pos)/pos/page.tsx"));
  // จอค้าปลีกของร้านทั่วไปไม่มีออร์เดอร์ออนไลน์ให้เตือนเลย
  assert.match(pos, /useOrderAlerts\(session\?\.businessArchetype === "restaurant"\)/);
  const queue = withoutComments(await read("../apps/web/components/RestaurantRequestQueue.tsx"));
  // `/admin/orders` เรนเดอร์คิวนี้ให้ทุกร้านแล้วค่อยคืน null ทีหลัง — hook ทำงานไปแล้ว
  assert.match(queue, /useOrderAlerts\(enabled === true\)/);
});

test("รอบที่คนกดเองต้องไม่โยน error ทับข้อความว่าทำรายการสำเร็จแล้ว", async () => {
  const source = withoutComments(await read("../apps/web/app/(pos)/pos/page.tsx"));
  const fn = source.slice(source.indexOf("async function refreshIncomingOrders"), source.indexOf("async function mutateIncomingOrder"));
  assert.ok(fn.length > 0, "หา refreshIncomingOrders ไม่เจอ");
  // ⚠️ `mutateIncomingOrder` เรียกตัวนี้ต่อท้าย **ในบล็อก try ของมันเอง** หลังจากรับออร์เดอร์
  // สำเร็จไปแล้ว · ถ้ารอบรีเฟรชโยน error ข้อความจะกลายเป็น "ทำรายการไม่สำเร็จ" ทั้งที่สำเร็จ
  // แล้วแคชเชียร์จะกดซ้ำกับงานที่ทำไปแล้ว
  assert.match(fn, /if \(!silent\) \{[\s\S]{0,220}?return;/, "รอบที่คนกดต้องจบด้วย return ไม่ใช่ throw");
  assert.match(fn, /throw error;/, "รอบอัตโนมัติต้องโยนต่อ ไม่งั้น hook ไม่รู้ว่ารอบนั้นล้ม");
});

test("heartbeat ของเครื่องขายต้องไม่เขียนแถวเดิมทุกคำขอ", async () => {
  const source = withoutComments(await read("../apps/web/lib/bms/pos.ts"));
  const update = source.slice(source.indexOf("UPDATE bms_pos_devices SET last_seen_at"), source.indexOf("UPDATE bms_pos_devices SET last_seen_at") + 320);
  assert.ok(update.length > 0);
  // ทุกคำขอที่ผ่าน device token เขียนแถวนี้หนึ่งครั้ง — รอบนี้เพิ่มจำนวน poll ต่อจอ
  // การเขียนแถวเดิมซ้ำ ๆ สร้าง dead tuple ให้ autovacuum ตามเก็บโดยไม่ได้อะไรเพิ่ม
  // (หน้าเครื่องขายแสดงแค่ "เห็นล่าสุดเมื่อไร" ความละเอียดกว่า 1 นาทีไม่มีใครใช้)
  assert.match(update, /last_seen_at IS NULL OR last_seen_at < now\(\) - interval/,
    "กลับไปเขียน heartbeat ทุกคำขอแล้ว");
});

test("รอบแรกต้องยิงทันทีตอน feed เริ่ม แต่ต้องไม่ยิงรัวตอนสลับจอ", async () => {
  const hook = withoutComments(await read("../apps/web/app/hooks/useLiveRefresh.ts"));
  // ⚠️ สองปัญหาคนละเรื่องที่ต้องแก้พร้อมกัน:
  //   1. `lastOkAt` เริ่มเป็น null ซึ่ง feedHealth ตีเป็น STALE โดยตั้งใจ → จอขึ้น
  //      "ขาดการเชื่อมต่อ" สีแดงคู่กับตั๋วที่แสดงอยู่เต็มจอ = จอเดียวกันขัดกันเอง
  //   2. `intervalMs` เปลี่ยนตามจอที่เปิดอยู่ → interval ถูกตั้งใหม่ตั้งแต่ศูนย์ทุกครั้ง
  //      สลับแท็บถี่กว่ารอบ = ไม่มีรอบไหนได้ยิงเลยสักครั้ง
  assert.match(hook, /const since = lastRunAt\.current === null \? Infinity/);
  assert.match(hook, /if \(since >= intervalMs\) void run\(\);/,
    "ต้องยิงเฉพาะตอนรอบก่อนห่างพอแล้ว ไม่งั้นสลับแท็บหนึ่งครั้งยิงพร้อมกันทุก feed");
  assert.match(hook, /lastRunAt\.current = Date\.now\(\);/);
});
