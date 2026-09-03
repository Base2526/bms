// =============================================================
// กระดานครัว — การรวมใบ, ตัวนับเวลา, การนับงาน (ไม่ต้องมี DB)
// -------------------------------------------------------------
//   cd apps/web && npx tsx --test ../../scripts/kitchen-board-contract.test.mts
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import {
  KITCHEN_LATE_MINUTES,
  KITCHEN_WARN_MINUTES,
  countKitchenDishes,
  formatKitchenElapsed,
  groupKitchenTickets,
  kitchenElapsedSeconds,
  kitchenGroupLabel,
  kitchenBoardStationFilters,
  kitchenStations,
  kitchenUrgency,
  slaForStationRef,
  ticketMatchesStation,
  pickReferenceAt,
  slaForStation,
  DEFAULT_KITCHEN_SLA,
  PREVIOUS_KITCHEN_STATUS,
  type KitchenBoardTicket,
} from "../apps/web/lib/bms/kitchenBoard.ts";

const NOW = Date.parse("2026-09-02T15:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

let seq = 0;
function ticket(over: Partial<KitchenBoardTicket> = {}): KitchenBoardTicket {
  seq += 1;
  return {
    id: `t${seq}`,
    checkId: "check-1",
    tableName: "โต๊ะ 3",
    roundNo: 1,
    station: "บาร์เครื่องดื่ม",
    status: "NEW",
    modifierCodes: [],
    productName: "ชามะนาวเย็น",
    size: "S",
    qty: 1,
    createdAt: minutesAgo(3),
    updatedAt: minutesAgo(3),
    ...over,
  };
}

test("รายการเหมือนกันในโต๊ะ+รอบ+สถานีเดียวกัน ยุบเป็นใบเดียวและบวกจำนวน", () => {
  const groups = groupKitchenTickets([ticket(), ticket(), ticket()]);
  assert.equal(groups.length, 1, "3 แก้วเดียวกันคืองานเดียว");
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[0].items[0].qty, 3);
  assert.equal(groups[0].totalQty, 3);
  assert.deepEqual(groups[0].ticketIds.length, 3, "ปุ่มเดียวต้องขยับได้ทั้งสามแถว");
});

test("⚠️ ตัวเลือกต่างกันห้ามยุบรวม — คนละงานของคนชง", () => {
  const groups = groupKitchenTickets([
    ticket(), ticket(),
    ticket({ modifierCodes: ["หวานน้อย"] }),
  ]);
  assert.equal(groups.length, 1, "ยังเป็นใบเดียวของโต๊ะนั้น");
  assert.equal(groups[0].items.length, 2, "แต่ต้องเป็นสองบรรทัด");
  const plain = groups[0].items.find((item) => item.modifierCodes.length === 0);
  const sweet = groups[0].items.find((item) => item.modifierCodes.length === 1);
  assert.equal(plain?.qty, 2);
  assert.equal(sweet?.qty, 1);
});

test("โน้ตถึงครัวต่างกันก็แยกบรรทัด และโน้ตติดอยู่กับรายการของมัน", () => {
  const groups = groupKitchenTickets([
    ticket({ productName: "ผัดไทยกุ้งสด", station: "ครัวร้อน" }),
    ticket({ productName: "ผัดไทยกุ้งสด", station: "ครัวร้อน", kitchenNote: "ไม่เผ็ด, แยกน้ำ" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].items.filter((item) => item.kitchenNote === "ไม่เผ็ด, แยกน้ำ").length, 1);
});

test("⚠️ สถานีต่างกันต้องเป็นคนละใบ แม้โต๊ะและรอบเดียวกัน", () => {
  const groups = groupKitchenTickets([
    ticket({ station: "บาร์เครื่องดื่ม" }),
    ticket({ station: "ครัวร้อน", productName: "ผัดไทยกุ้งสด" }),
  ]);
  assert.equal(groups.length, 2, "ครัวร้อนกับบาร์เป็นคนละคน ปุ่มของคนหนึ่งห้ามขยับงานของอีกคน");
  assert.deepEqual(new Set(groups.map((group) => group.station)), new Set(["บาร์เครื่องดื่ม", "ครัวร้อน"]));
});

test("รอบต่างกัน บิลต่างกัน และสถานะต่างกัน แยกใบกันทั้งหมด", () => {
  const groups = groupKitchenTickets([
    ticket({ roundNo: 1 }),
    ticket({ roundNo: 2 }),
    ticket({ roundNo: 1, checkId: "check-2", tableName: "โต๊ะ 9" }),
    ticket({ roundNo: 1, status: "PREPARING" }),
  ]);
  assert.equal(groups.length, 4);
});

test("ใบที่รอนานที่สุดอยู่บนสุด และตัวนับยึดตั๋วที่เก่าที่สุดในใบ", () => {
  const groups = groupKitchenTickets([
    ticket({ checkId: "c-new", tableName: "โต๊ะ 5", createdAt: minutesAgo(1) }),
    ticket({ checkId: "c-old", tableName: "โต๊ะ 1", createdAt: minutesAgo(12) }),
    ticket({ checkId: "c-old", tableName: "โต๊ะ 1", createdAt: minutesAgo(20) }),
  ]);
  assert.deepEqual(groups.map((group) => group.tableLabel), ["โต๊ะ 1", "โต๊ะ 5"]);
  assert.equal(groups[0].referenceAt, minutesAgo(20), "ใบเดียวหลายตั๋ว = ยึดตัวที่รอนานสุด");
});

test("⚠️ ช่องพร้อมเสิร์ฟนับจากตอนทำเสร็จ ไม่ใช่ตอนสั่ง", () => {
  // สั่งมา 40 นาที แต่เพิ่งทำเสร็จ 1 นาที — ถ้านับจากตอนสั่งจะแดงค้างทุกใบตลอดเวลา
  // แล้วสีเลิกมีความหมาย ทั้งที่คำถามของช่องนี้คือ "อาหารวางรอนานแค่ไหน"
  assert.equal(pickReferenceAt("READY", minutesAgo(40), minutesAgo(1)), minutesAgo(1));
  assert.equal(pickReferenceAt("NEW", minutesAgo(40), minutesAgo(1)), minutesAgo(40));
  assert.equal(pickReferenceAt("PREPARING", minutesAgo(40), minutesAgo(1)), minutesAgo(40));
  const groups = groupKitchenTickets([
    ticket({ status: "READY", createdAt: minutesAgo(40), updatedAt: minutesAgo(1) }),
  ]);
  assert.equal(kitchenUrgency(kitchenElapsedSeconds(groups[0].referenceAt, NOW)), "ok");
});

test("ระดับความเร่งเปลี่ยนตรงเกณฑ์ 5 และ 10 นาที", () => {
  assert.equal(kitchenUrgency(0), "ok");
  assert.equal(kitchenUrgency(KITCHEN_WARN_MINUTES * 60 - 1), "ok");
  assert.equal(kitchenUrgency(KITCHEN_WARN_MINUTES * 60), "warn");
  assert.equal(kitchenUrgency(KITCHEN_LATE_MINUTES * 60 - 1), "warn");
  assert.equal(kitchenUrgency(KITCHEN_LATE_MINUTES * 60), "late");
});

test("เวลาที่เพี้ยนหรืออ่านไม่ออกต้องไม่ทำให้ตัวนับติดลบหรือ NaN", () => {
  assert.equal(kitchenElapsedSeconds(new Date(NOW + 60_000).toISOString(), NOW), 0);
  assert.equal(kitchenElapsedSeconds("ไม่ใช่วันที่", NOW), 0);
  assert.equal(formatKitchenElapsed(-5), "0:00");
});

test("รูปแบบตัวเลขบนป้ายอ่านจบในสายตาเดียว", () => {
  assert.equal(formatKitchenElapsed(48), "0:48");
  assert.equal(formatKitchenElapsed(6 * 60 + 3), "6:03");
  assert.equal(formatKitchenElapsed(12 * 60 + 41), "12:41");
  assert.equal(formatKitchenElapsed(60 * 60 + 5 * 60), "1 ชม. 5 น.");
});

test("⚠️ ป้ายบนหัวเลนนับ ‘จาน’ ไม่ใช่จำนวนใบ", () => {
  const tickets = [ticket(), ticket(), ticket(), ticket({ modifierCodes: ["หวานน้อย"] })];
  const groups = groupKitchenTickets(tickets);
  assert.equal(groups.length, 1, "ยุบเป็นใบเดียว");
  assert.equal(countKitchenDishes(tickets), 4, "แต่ปริมาณงานคือ 4 แก้ว");
  assert.equal(groups.reduce((sum, group) => sum + group.totalQty, 0), 4);
});

test("ใบของบิลค้าปลีกที่ไม่มีโต๊ะ ยังมีหัวใบที่บอกได้ว่าของใคร", () => {
  assert.equal(kitchenGroupLabel(ticket({ tableName: null, tableCode: "T07" })), "T07");
  assert.equal(
    kitchenGroupLabel(ticket({ tableName: null, tableCode: null, checkId: null, orderId: "9f8e7d6c-1234" })),
    "บิล #9f8e7d6c"
  );
  assert.equal(kitchenGroupLabel(ticket({ tableName: "  ", tableCode: null, checkId: null, orderId: null })), null);
});

test("รายชื่อสถานีมาจากงานที่ค้างจริง และไม่ซ้ำ", () => {
  const stations = kitchenStations([
    ticket({ station: "ครัวร้อน" }),
    ticket({ station: "ครัวร้อน" }),
    ticket({ station: "บาร์เครื่องดื่ม" }),
    ticket({ station: null }),
  ]);
  assert.equal(stations.length, 2);
  assert.ok(stations.includes("ครัวร้อน") && stations.includes("บาร์เครื่องดื่ม"));
});

test("⚠️ เกณฑ์เวลาแยกตามสถานี — เกณฑ์เดียวทั้งร้านทำให้ครัวร้อนแดงตลอด", () => {
  const slas = {
    "บาร์เครื่องดื่ม": { warnMinutes: 2, lateMinutes: 4 },
    "ครัวร้อน": { warnMinutes: 8, lateMinutes: 15 },
  };
  const at5min = 5 * 60;
  assert.equal(kitchenUrgency(at5min, slaForStation("บาร์เครื่องดื่ม", slas)), "late", "บาร์ 5 นาทีคือสาย");
  assert.equal(kitchenUrgency(at5min, slaForStation("ครัวร้อน", slas)), "ok", "ครัวร้อน 5 นาทียังปกติ");
  assert.equal(kitchenUrgency(at5min, slaForStation("ครัวเย็น", slas)), "warn", "สถานีที่ไม่ตั้งใช้ค่าปริยาย 5/10");
});

test("ค่าเกณฑ์ที่ใช้ไม่ได้ต้องตกกลับค่าปริยาย ไม่ใช่ทำให้ทุกใบสีเดียว", () => {
  assert.deepEqual(slaForStation("x", null), DEFAULT_KITCHEN_SLA);
  assert.deepEqual(slaForStation(null, { x: { warnMinutes: 1, lateMinutes: 2 } }), DEFAULT_KITCHEN_SLA);
  // เหลืองต้องมาก่อนแดง ถ้าสลับกันมาให้ทิ้งค่านั้น
  assert.deepEqual(slaForStation("x", { x: { warnMinutes: 9, lateMinutes: 3 } }), DEFAULT_KITCHEN_SLA);
  assert.deepEqual(slaForStation("x", { x: { warnMinutes: 0, lateMinutes: 0 } }), DEFAULT_KITCHEN_SLA);
  assert.deepEqual(slaForStation("x", { x: { warnMinutes: NaN, lateMinutes: 5 } } as any), DEFAULT_KITCHEN_SLA);
  // ค่าที่ใช้ได้ต้องถูกใช้จริง รวมถึง warn = 0 (เตือนทันที)
  assert.deepEqual(slaForStation("x", { x: { warnMinutes: 0, lateMinutes: 3 } }), { warnMinutes: 0, lateMinutes: 3 });
});

test("⚠️ ย้อนสถานะได้ทีละขั้น แต่ใบที่ยกเลิกแล้วย้อนไม่ได้", () => {
  assert.equal(PREVIOUS_KITCHEN_STATUS.PREPARING, "NEW");
  assert.equal(PREVIOUS_KITCHEN_STATUS.READY, "PREPARING");
  assert.equal(PREVIOUS_KITCHEN_STATUS.SERVED, "READY");
  assert.equal(PREVIOUS_KITCHEN_STATUS.NEW, null, "ขั้นแรกไม่มีที่ให้ถอย");
  // การยกเลิกตัดบรรทัดออกจากบิลไปแล้ว การย้อนคือการแก้บิล ไม่ใช่การแก้สถานะครัว
  assert.equal(PREVIOUS_KITCHEN_STATUS.CANCELLED, null);
});

// =============================================================
// ทะเบียนสถานี (9.54) — ตัวกรอง, การจับคู่ตั๋ว, และเกณฑ์เวลาเมื่อสถานีถูกเปลี่ยนชื่อ
// =============================================================

test("ตัวกรองสถานีมาจากทะเบียน + สถานีที่มีตั๋วจริง เรียงตามลำดับที่ร้านตั้ง", () => {
  // ครัวที่ว่างต้องยังมีปุ่มของตัวเอง — "ครัวร้อนไม่มีงาน" กับ "ระบบไม่ส่งงานมาให้ครัวร้อน"
  // เป็นคนละเรื่อง แต่กระดานที่ซ่อนสถานีว่างทำให้อ่านออกมาเหมือนกัน
  const filters = kitchenBoardStationFilters(
    [ticket({ stationId: "s-bar", station: "บาร์" })],
    [
      { id: "s-hot", name: "ครัวร้อน", sortOrder: 1, active: true },
      { id: "s-bar", name: "บาร์", sortOrder: 0, active: true },
      { id: "s-old", name: "ครัวเก่า", sortOrder: 2, active: false },
    ]
  );
  assert.deepEqual(filters.map((filter) => filter.name), ["บาร์", "ครัวร้อน"]);
  assert.equal(filters.some((filter) => filter.name === "ครัวเก่า"), false, "สถานีที่ปิดและไม่มีงานต้องไม่มีปุ่ม");
});

test("สถานีที่ถูกปิดแต่ยังมีของค้างในครัวต้องมีปุ่ม และอยู่ท้ายลิสต์", () => {
  // ตั๋วที่ไม่มีปุ่มกรองของตัวเอง = อาหารที่ครัวหาไม่เจอเวลากรอง
  const filters = kitchenBoardStationFilters(
    [ticket({ stationId: "s-old", station: "ครัวเก่า" }), ticket({ stationId: null, station: "สถานีไร้ทะเบียน" })],
    [{ id: "s-hot", name: "ครัวร้อน", sortOrder: 5, active: true }]
  );
  assert.deepEqual(filters.map((filter) => filter.name), ["ครัวร้อน", "ครัวเก่า", "สถานีไร้ทะเบียน"]);
});

test("การจับคู่ตั๋วกับปุ่มกรองใช้ id ก่อนชื่อ — เปลี่ยนชื่อระหว่างกะแล้วของต้องไม่หายจากจอ", () => {
  const renamed = ticket({ stationId: "s-bar", station: "บาร์ (ชื่อเก่า)" });
  const byId = { id: "s-bar", name: "บาร์เครื่องดื่ม", sortOrder: 0 };
  assert.equal(ticketMatchesStation(renamed, byId), true);
  // ตั๋วที่มี id อยู่แล้วต้องไม่ไปตกใต้ปุ่มของสถานีไร้ทะเบียนที่บังเอิญชื่อเหมือนกัน
  const legacyButton = { id: null, name: "บาร์ (ชื่อเก่า)", sortOrder: 10 };
  assert.equal(ticketMatchesStation(renamed, legacyButton), false);
  assert.equal(ticketMatchesStation({ stationId: null, station: "บาร์ (ชื่อเก่า)" }, legacyButton), true);
  assert.equal(ticketMatchesStation(renamed, null), true, "ไม่เลือกตัวกรอง = เห็นทุกใบ");
});

test("ตั๋วรอบเดียวกันของสถานีเดียวกันไม่แตกเป็นสองใบเพราะชื่อคนละยุค", () => {
  // ชื่อบนตั๋วเป็น snapshot · ใบที่ออกก่อนและหลังการเปลี่ยนชื่อถือชื่อคนละชื่อแต่เป็นครัว
  // เดียวกัน ถ้าจับกลุ่มด้วยชื่อ ครัวจะเห็นงานเดียวโผล่สองใบพร้อมกัน
  const groups = groupKitchenTickets([
    ticket({ stationId: "s-bar", station: "บาร์", productName: "ชามะนาว" }),
    ticket({ stationId: "s-bar", station: "บาร์เครื่องดื่ม", productName: "ชาเย็น" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].stationId, "s-bar");
});

test("เกณฑ์เวลาหาด้วย id ก่อน แล้วค่อยชื่อ", () => {
  // แถวเกณฑ์เวลาย้ายไปอยู่กับชื่อใหม่ตอนเปลี่ยนชื่อ ส่วนใบที่ยังทำอยู่ถือชื่อเก่า —
  // หาแต่ชื่อ = ใบนั้นตกกลับไปค่าปริยาย 5/10 กลางกะโดยไม่มีใครสั่ง
  const map = {
    "s-bar": { warnMinutes: 1, lateMinutes: 2 },
    "บาร์เครื่องดื่ม": { warnMinutes: 1, lateMinutes: 2 },
    "ครัวร้อน": { warnMinutes: 8, lateMinutes: 12 },
  };
  assert.deepEqual(slaForStationRef({ stationId: "s-bar", station: "บาร์ (ชื่อเก่า)" }, map), { warnMinutes: 1, lateMinutes: 2 });
  assert.deepEqual(slaForStationRef({ stationId: null, station: "ครัวร้อน" }, map), { warnMinutes: 8, lateMinutes: 12 });
  assert.deepEqual(slaForStationRef({ stationId: "s-unknown", station: "ไม่รู้จัก" }, map), DEFAULT_KITCHEN_SLA);
  assert.deepEqual(slaForStationRef({}, map), DEFAULT_KITCHEN_SLA);
});

test("ตั๋วยุคก่อน 9.54 (มีแต่ชื่อ ไม่มี id) ยังอยู่ใต้ปุ่มของครัวตัวเอง", () => {
  // ตั๋วที่โค้ดรุ่นเก่าเขียนไว้ระหว่าง deploy มีชื่อแต่ยังไม่มี station_id · ถ้ายืนกรานว่าต้องมี
  // id อาหารที่ครัวกำลังทำอยู่จะหลุดจากปุ่มของตัวเองไปอยู่ปุ่มตกค้าง ทั้งที่เป็นครัวเดียวกัน
  const legacy = { stationId: null, station: "บาร์" };
  const master = { id: "s-bar", name: "บาร์", sortOrder: 0 };
  assert.equal(ticketMatchesStation(legacy, master), true);

  // และต้องไม่งอกปุ่มที่สองที่เขียนว่า "บาร์" เหมือนกัน — ครัวกดปุ่มหนึ่งแล้วเจอครึ่งเดียวของงาน
  const filters = kitchenBoardStationFilters(
    [ticket({ stationId: null, station: "บาร์" }), ticket({ stationId: "s-bar", station: "บาร์" })],
    [{ id: "s-bar", name: "บาร์", sortOrder: 0, active: true }]
  );
  assert.deepEqual(filters.map((f) => `${f.id ?? "-"}:${f.name}`), ["s-bar:บาร์"]);
});
