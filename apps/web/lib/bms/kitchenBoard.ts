// =============================================================
// กระดานครัว — การจัดกลุ่มและระดับความเร่ง (pure, ไม่ import อะไรเลย)
// -------------------------------------------------------------
// ตั้งใจไม่ import อะไรเลยแบบ `loyaltyMath.ts`/`arCredit.ts` เพื่อให้เทสได้โดยไม่ต้องมี
// Postgres — ตรรกะนี้ตัดสินว่าครัวเห็นอะไรก่อน ซึ่งพังแล้วรู้ยากกว่าพังแล้ว error
//
// เหตุผลของการรวมใบ: ฐานข้อมูลเก็บ 1 แถวต่อ "รายการที่สั่ง" (bms_kitchen_tickets /
// bms_restaurant_kitchen_tickets) ซึ่งถูกสำหรับการตัดสต็อกและการคิดเงิน แต่ผิดสำหรับ
// คนทำอาหาร — ชามะนาว 3 แก้วของโต๊ะเดียวรอบเดียวคือ "งานเดียว" ที่ทำทีเดียวเสร็จ
// การแสดงเป็น 3 ใบทำให้จอเต็มด้วยงานเดิมซ้ำ ๆ แล้วงานของโต๊ะอื่นถูกดันตกจอ
// =============================================================

/** เกินกี่นาทีถือว่า "เริ่มช้า" (เหลือง) และ "สาย" (แดง) นับจากเวลาอ้างอิงของใบนั้น */
export const KITCHEN_WARN_MINUTES = 5;
export const KITCHEN_LATE_MINUTES = 10;

export type KitchenBoardTicket = {
  id: string;
  orderId?: string | null;
  checkId?: string | null;
  tableName?: string | null;
  tableCode?: string | null;
  roundNo?: number | null;
  kitchenNote?: string | null;
  /** id ของสถานีจากแถวหลัก (9.54) — null สำหรับตั๋วเก่าหรือสถานีที่ยังไม่ถูกยกระดับ */
  stationId?: string | null;
  /** ชื่อสถานี ณ เวลาที่ตั๋วถูกสร้าง (snapshot) — เปลี่ยนชื่อสถานีแล้วใบเก่าต้องไม่เปลี่ยนตาม */
  station?: string | null;
  status: string;
  modifierCodes?: string[] | null;
  productName: string;
  size?: string | null;
  qty?: number | null;
  createdAt: string;
  updatedAt?: string | null;
};

export type KitchenBoardItem = {
  key: string;
  productName: string;
  size: string | null;
  qty: number;
  modifierCodes: string[];
  kitchenNote: string | null;
  ticketIds: string[];
};

export type KitchenBoardGroup = {
  key: string;
  status: string;
  stationId: string | null;
  station: string | null;
  tableLabel: string | null;
  roundNo: number | null;
  items: KitchenBoardItem[];
  ticketIds: string[];
  /** เวลาที่ตัวนับใช้เป็นจุดตั้งต้น (ดู pickReferenceAt) */
  referenceAt: string;
  totalQty: number;
};

const clean = (value: string | null | undefined) => {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
};

/**
 * เวลาอ้างอิงของตัวนับ ต่างกันตามเลนโดยตั้งใจ:
 *
 * - NEW/PREPARING นับจาก "ตอนสั่ง" (createdAt) = ลูกค้ารอมานานแค่ไหนแล้ว
 * - READY/SERVED นับจาก "ตอนที่สถานะเปลี่ยน" (updatedAt) = อาหารวางรอบน pass นานแค่ไหน /
 *   เสิร์ฟไปเมื่อกี้หรือเมื่อวาน
 *
 * ถ้า READY นับจากตอนสั่งเหมือนกัน ทุกใบบนช่องพร้อมเสิร์ฟจะแดงค้างตลอดเวลาแล้วเลิกมี
 * ความหมาย ทั้งที่คำถามของช่องนั้นคือ "อาหารเย็นหรือยัง" ไม่ใช่ "สั่งมานานเท่าไร"
 *
 * ⚠️ SERVED เดิมตกมาใช้ createdAt ทั้งที่เหตุผลเดียวกันทุกประการ — ตั๋วที่สั่งเมื่อวานแล้ว
 * เพิ่งกดเสิร์ฟเมื่อกี้ ขึ้นเป็น "65 ชม." สีแดงบนกระดาน (เจอจริงบน production) · ช่อง
 * "เสิร์ฟแล้ว" เป็นแถบประวัติ 12 ชม. คำถามของมันคือ "เสิร์ฟไปนานหรือยัง" ไม่ใช่ "สั่งมานานเท่าไร"
 */
const KITCHEN_ELAPSED_FROM_UPDATED = new Set(["READY", "SERVED"]);

export function pickReferenceAt(status: string, createdAt: string, updatedAt?: string | null): string {
  if (KITCHEN_ELAPSED_FROM_UPDATED.has(String(status).toUpperCase()) && clean(updatedAt)) {
    return String(updatedAt);
  }
  return createdAt;
}

/** วินาทีที่ผ่านไปจากเวลาอ้างอิง — ค่าติดลบ (นาฬิกาเครื่องเพี้ยน) ถูกปัดเป็น 0 */
export function kitchenElapsedSeconds(referenceAt: string, nowMs: number): number {
  const at = Date.parse(referenceAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((nowMs - at) / 1000));
}

export type KitchenUrgency = "ok" | "warn" | "late";

/** เกณฑ์ของสถานีหนึ่ง (9.53) — ร้านที่ไม่ตั้งค่าใช้ค่าปริยาย 5/10 */
export type KitchenSla = { warnMinutes: number; lateMinutes: number };
export const DEFAULT_KITCHEN_SLA: KitchenSla = {
  warnMinutes: KITCHEN_WARN_MINUTES,
  lateMinutes: KITCHEN_LATE_MINUTES,
};

/**
 * เกณฑ์ต่างกันตามสถานีโดยตั้งใจ — บาร์ชงชาเย็นเสร็จใน 2 นาที ครัวร้อนผัดกับข้าว 8-12 นาที
 * เป็นเรื่องปกติ · ใช้เกณฑ์เดียวทั้งร้านแปลว่าครัวร้อนแดงตลอดเวลา (สีเลิกมีความหมาย)
 * หรือไม่ก็บาร์ไม่เคยเตือนเลย
 */
export function slaForStation(
  station: string | null | undefined,
  slas?: Record<string, KitchenSla> | null
): KitchenSla {
  const key = clean(station);
  return normalizeSla(key && slas ? slas[key] : null);
}

/**
 * เกณฑ์เวลาของตั๋วที่ถือทั้ง id และชื่อ (9.54) — **หา id ก่อนเสมอ**
 *
 * เปลี่ยนชื่อสถานีตอนที่ยังมีตั๋วค้างอยู่บนกระดาน: ใบเก่าถือชื่อเดิม (snapshot) ส่วนแถวเกณฑ์
 * เวลาย้ายไปอยู่กับชื่อใหม่แล้ว · หาแต่ชื่อ = ใบที่ครัวกำลังทำอยู่ตกกลับไปค่าปริยาย 5/10
 * เงียบ ๆ กลางกะ แล้วสีบนจอเปลี่ยนความหมายโดยไม่มีใครสั่ง
 */
export function slaForStationRef(
  ref: { stationId?: string | null; station?: string | null },
  slas?: Record<string, KitchenSla> | null
): KitchenSla {
  const id = clean(ref.stationId);
  const byId = id && slas ? slas[id] : null;
  if (byId) return normalizeSla(byId);
  return slaForStation(ref.station, slas);
}

function normalizeSla(found: KitchenSla | null | undefined): KitchenSla {
  if (!found) return DEFAULT_KITCHEN_SLA;
  const warnMinutes = Number(found.warnMinutes);
  const lateMinutes = Number(found.lateMinutes);
  // ค่าที่อ่านมาแล้วใช้ไม่ได้ต้องตกกลับไปค่าปริยาย ไม่ใช่ทำให้ทุกใบเป็นสีเดียว
  if (!Number.isFinite(warnMinutes) || !Number.isFinite(lateMinutes)) return DEFAULT_KITCHEN_SLA;
  if (!(warnMinutes < lateMinutes) || lateMinutes <= 0) return DEFAULT_KITCHEN_SLA;
  return { warnMinutes, lateMinutes };
}

export function kitchenUrgency(elapsedSeconds: number, sla: KitchenSla = DEFAULT_KITCHEN_SLA): KitchenUrgency {
  if (elapsedSeconds >= sla.lateMinutes * 60) return "late";
  if (elapsedSeconds >= sla.warnMinutes * 60) return "warn";
  return "ok";
}

/** `M:SS` จนถึง 59:59 แล้วเปลี่ยนเป็นชั่วโมง — ตัวเลขบนจอครัวต้องอ่านจบในสายตาเดียว */
export function formatKitchenElapsed(elapsedSeconds: number): string {
  const total = Math.max(0, Math.floor(elapsedSeconds));
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ชม. ${minutes % 60} น.`;
}

/**
 * ป้ายชื่อหัวใบ — บิลโต๊ะใช้ชื่อโต๊ะ ส่วนบิลค้าปลีกที่เข้าครัว (ร้านที่เปิด KITCHEN_WORKFLOW
 * แต่ขายหน้าเคาน์เตอร์) ไม่มีโต๊ะ จึงใช้เลขบิลย่อ · ไม่คืน "-" เพราะหัวใบที่ว่างทำให้
 * ครัวไม่รู้ว่าอาหารจานนี้ของใคร
 */
export function kitchenGroupLabel(ticket: KitchenBoardTicket): string | null {
  const table = clean(ticket.tableName) ?? clean(ticket.tableCode);
  if (table) return table;
  const order = clean(ticket.orderId);
  return order ? `บิล #${order.slice(0, 8)}` : null;
}

const itemKeyOf = (ticket: KitchenBoardTicket) => [
  clean(ticket.productName) ?? "",
  clean(ticket.size) ?? "",
  // ตัวเลือกต่างกัน = คนละงาน ("หวานน้อย" กับแก้วธรรมดาชงไม่เหมือนกัน)
  // รวมสองอย่างนี้เข้าด้วยกันคือการบอกครัวผิด
  [...(ticket.modifierCodes ?? [])].map((code) => String(code).toUpperCase()).sort().join("+"),
  clean(ticket.kitchenNote) ?? "",
].join(" ");

/**
 * รวมตั๋วเป็นใบเดียวต่อ (สถานะ, บิล/โต๊ะ, รอบ, สถานี)
 *
 * **สถานีอยู่ในคีย์โดยตั้งใจ** — ครัวร้อนกับบาร์เป็นคนละคนและอยู่คนละที่ ถ้ารวมข้ามสถานี
 * ใบเดียวจะสั่งงานสองคนพร้อมกัน แล้วปุ่ม "เริ่มทำ" ของคนหนึ่งไปขยับงานของอีกคน
 */
export function groupKitchenTickets(tickets: KitchenBoardTicket[]): KitchenBoardGroup[] {
  const groups = new Map<string, KitchenBoardGroup>();
  const itemsByGroup = new Map<string, Map<string, KitchenBoardItem>>();

  for (const ticket of tickets) {
    const status = String(ticket.status ?? "").toUpperCase();
    const stationId = clean(ticket.stationId);
    const station = clean(ticket.station);
    const bill = clean(ticket.checkId) ?? clean(ticket.orderId) ?? ticket.id;
    const roundNo = ticket.roundNo == null ? null : Number(ticket.roundNo);
    const groupKey = [status, bill, roundNo ?? "-", stationId ?? station ?? "-"].join(" ");
    const referenceAt = pickReferenceAt(status, ticket.createdAt, ticket.updatedAt);

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        status,
        stationId,
        station,
        tableLabel: kitchenGroupLabel(ticket),
        roundNo,
        items: [],
        ticketIds: [],
        referenceAt,
        totalQty: 0,
      };
      groups.set(groupKey, group);
      itemsByGroup.set(groupKey, new Map());
    }
    // ใบหนึ่งใบถือหลายตั๋ว — ตัวนับต้องยึด "ตั๋วที่รอนานที่สุด" ไม่ใช่ตัวล่าสุดที่เพิ่มเข้ามา
    if (Date.parse(referenceAt) < Date.parse(group.referenceAt)) group.referenceAt = referenceAt;

    const qty = Number(ticket.qty ?? 0) || 0;
    group.ticketIds.push(ticket.id);
    group.totalQty += qty;

    const bucket = itemsByGroup.get(groupKey)!;
    const itemKey = itemKeyOf(ticket);
    const existing = bucket.get(itemKey);
    if (existing) {
      existing.qty += qty;
      existing.ticketIds.push(ticket.id);
    } else {
      const item: KitchenBoardItem = {
        key: itemKey,
        productName: ticket.productName,
        size: clean(ticket.size),
        qty,
        modifierCodes: [...(ticket.modifierCodes ?? [])],
        kitchenNote: clean(ticket.kitchenNote),
        ticketIds: [ticket.id],
      };
      bucket.set(itemKey, item);
      group.items.push(item);
    }
  }

  // เก่าก่อน = คิวการทำอาหาร · ใบที่รอนานที่สุดต้องอยู่บนสุดเสมอ
  return [...groups.values()].sort((a, b) => {
    const left = Date.parse(a.referenceAt);
    const right = Date.parse(b.referenceAt);
    if (left !== right) return left - right;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/**
 * จำนวน "จาน" ไม่ใช่จำนวนใบ — ป้ายบนหัวเลนและตัวเลขข้างชื่อสถานีคือปริมาณงานที่ค้างอยู่
 * ถ้านับใบ ชามะนาว 3 แก้วที่ยุบเป็นใบเดียวจะขึ้นเป็น 1 แล้วครัวประเมินงานผิด ซึ่งกลับหัว
 * กับเหตุผลที่รวมใบตั้งแต่แรก (รวมเพื่อให้ "ทำทีเดียว" ไม่ใช่เพื่อให้ดูเหมือนงานน้อยลง)
 */
export function countKitchenDishes(tickets: KitchenBoardTicket[]): number {
  return tickets.reduce((sum, ticket) => sum + (Number(ticket.qty ?? 0) || 0), 0);
}

/**
 * สถานีที่ควรมีปุ่มกรองบนกระดาน (9.54)
 *
 * รวมสองแหล่งเข้าด้วยกันโดยตั้งใจ:
 *   1. **สถานีที่ร้านตั้งไว้และยังเปิดใช้งาน** — ขึ้นแม้ยังไม่มีงานค้าง เพราะ "ครัวร้อนว่าง"
 *      กับ "ระบบไม่ส่งงานมาให้ครัวร้อน" เป็นคนละเรื่อง แต่กระดานที่ซ่อนสถานีว่างทำให้
 *      อ่านออกมาเหมือนกัน
 *   2. **สถานีที่โผล่บนตั๋วจริง** แม้จะถูกปิดใช้งานไปแล้วหรือไม่มีแถวหลัก — ตั๋วที่ไม่มีปุ่ม
 *      กรองของตัวเองคืออาหารที่ครัวหาไม่เจอเวลากรอง
 *
 * เรียงตาม `sortOrder` ของร้านก่อน (ลำดับที่ครัวเรียงจริง) แล้วค่อยเป็นสถานีตกค้างท้ายสุด
 */
export type KitchenStationFilter = { id: string | null; name: string; sortOrder: number };

export function kitchenBoardStationFilters(
  tickets: KitchenBoardTicket[],
  masters?: ReadonlyArray<{ id: string; name: string; sortOrder?: number | null; active?: boolean | null }> | null
): KitchenStationFilter[] {
  const byId = new Map<string, KitchenStationFilter>();
  const byName = new Map<string, KitchenStationFilter>();
  const push = (entry: KitchenStationFilter) => {
    if (entry.id) {
      if (byId.has(entry.id)) return;
      byId.set(entry.id, entry);
    } else {
      if (byName.has(entry.name)) return;
      byName.set(entry.name, entry);
    }
  };
  for (const master of masters ?? []) {
    const name = clean(master.name);
    if (!name || master.active === false) continue;
    push({ id: String(master.id), name, sortOrder: Number(master.sortOrder ?? 0) });
  }
  // ⚠️ ตั๋วที่ไม่มี id แต่ชื่อตรงกับสถานีในทะเบียน **ต้องไม่ได้ปุ่มของตัวเอง** — ไม่งั้นแถบกรอง
  // มีปุ่มสองปุ่มที่เขียนว่า "บาร์" เหมือนกัน แล้วครัวกดปุ่มหนึ่งเจอครึ่งเดียวของงานตัวเอง
  // (เกิดกับตั๋วที่โค้ดรุ่นก่อน 9.54 เขียนไว้ระหว่าง deploy ซึ่งมีชื่อแต่ยังไม่มี station_id)
  const masterNames = new Set([...byId.values()].map((entry) => entry.name));
  for (const ticket of tickets) {
    const id = clean(ticket.stationId);
    const name = clean(ticket.station);
    if (!id && !name) continue;
    if (id && byId.has(id)) continue;
    if (!id && name && masterNames.has(name)) continue;
    // สถานีที่ปิดไปแล้วแต่ยังมีของค้างในครัว ต้องอยู่ท้ายลิสต์ ไม่ใช่แทรกกลางลำดับที่ร้านตั้ง
    push({ id, name: name ?? id!, sortOrder: KITCHEN_ORPHAN_STATION_SORT });
  }
  return [...byId.values(), ...byName.values()].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name, "th");
  });
}

/** ท้ายสุดเสมอ — เกินเพดาน sort_order ของฐาน (9999) ไปหนึ่งขั้น */
const KITCHEN_ORPHAN_STATION_SORT = 10_000;

/**
 * ตั๋วใบนี้อยู่ใต้ปุ่มกรองอันนี้ไหม — **เทียบ id ก่อน ชื่อทีหลัง**
 *
 * ตั๋วที่ออกก่อนการเปลี่ยนชื่อสถานีถือชื่อเก่า ถ้าเทียบด้วยชื่ออย่างเดียว กดกรองสถานีนั้น
 * แล้วอาหารที่กำลังทำอยู่จะหายไปจากจอทันทีที่มีคนแก้ชื่อ
 *
 * **ตั๋วที่ไม่มี id เลยยังจับคู่ด้วยชื่อได้** — ตั๋วที่โค้ดรุ่นก่อน `9.54` เขียนไว้ (ระหว่าง deploy
 * หรือก่อน apply migration) มีแต่ชื่อ · ถ้ายืนกรานว่าต้องมี id อาหารที่ครัวกำลังทำอยู่จะหลุด
 * จากปุ่มของตัวเองไปอยู่ปุ่มตกค้าง ทั้งที่มันคือครัวเดียวกัน
 */
export function ticketMatchesStation(
  ticket: Pick<KitchenBoardTicket, "stationId" | "station">,
  filter: KitchenStationFilter | null
): boolean {
  if (!filter) return true;
  const id = clean(ticket.stationId);
  if (filter.id) return id === filter.id || (id === null && clean(ticket.station) === filter.name);
  return id === null && clean(ticket.station) === filter.name;
}

/** สถานีทั้งหมดที่มีงานค้างอยู่จริง เรียงตามตัวอักษร (ไม่ระบุสถานีไปท้ายสุด) */
export function kitchenStations(tickets: KitchenBoardTicket[]): string[] {
  const seen = new Set<string>();
  for (const ticket of tickets) {
    const station = clean(ticket.station);
    if (station) seen.add(station);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "th"));
}

/**
 * ขั้นก่อนหน้าของแต่ละสถานะ — จอใช้ตัดสินว่าจะยื่นปุ่ม "ย้อนกลับ" ไหม และ service ใช้เป็น
 * ที่มาเดียวของทางถอย · อยู่ในโมดูล pure เพราะหน้าจอเป็น client component: ถ้าประกาศไว้ใน
 * kitchen.ts (ซึ่ง import ตัวต่อฐานข้อมูล) การ import จากจอจะลาก pg เข้า bundle ของเบราว์เซอร์
 *
 * **CANCELLED ไม่มีทางกลับโดยตั้งใจ** — การยกเลิกตัดบรรทัดออกจากบิลไปแล้ว การย้อนคือการ
 * แก้บิล ไม่ใช่การแก้สถานะครัว
 */
export const PREVIOUS_KITCHEN_STATUS: Record<string, string | null> = {
  NEW: null,
  PREPARING: "NEW",
  READY: "PREPARING",
  SERVED: "READY",
  CANCELLED: null,
};
