// กติกา pure ของกระดานครัว ไม่มี network หรือ state ภายในโมดูลนี้
// ตั๋วจริงและการเปลี่ยนสถานะมาจาก GraphQL/WS โดยฐานข้อมูลเป็น source of truth
// ส่วนไฟล์นี้ดูแลเฉพาะรูปร่าง ลำดับสถานะ การจับเวลา และการจัดกลุ่มสำหรับ UI

export type TicketStatus = 'NEW' | 'PREPARING' | 'READY' | 'SERVED';

export interface KitchenTicketItem {
  name: string;
  qty: number;
}

export interface KitchenTicket {
  id: string;
  tableCode: string;
  roundNo: number;
  station: string;
  stationId?: string;
  status: TicketStatus;
  /** เวลาที่ตั๋วเข้าครัว (ISO) — จอคำนวณ "รอมากี่นาที" จากค่านี้ ไม่ใช่เลขที่ประทับไว้ตายตัว */
  createdAt: string;
  items: KitchenTicketItem[];
  note?: string;
}

/** ลำดับสถานะของตั๋ว — เดินหน้าได้ทีละขั้น */
export const TICKET_FLOW: TicketStatus[] = [
  'NEW',
  'PREPARING',
  'READY',
  'SERVED',
];

export function nextTicketStatus(status: TicketStatus): TicketStatus | null {
  const index = TICKET_FLOW.indexOf(status);
  if (index < 0 || index >= TICKET_FLOW.length - 1) return null;
  return TICKET_FLOW[index + 1];
}

/**
 * ถอยสถานะได้ทีละขั้น — กดผิดที่จอครัวเกิดจริงและบ่อย
 * (ฝั่งเว็บมีปุ่มย้อนกลับด้วยเหตุผลเดียวกัน)
 */
export function previousTicketStatus(
  status: TicketStatus,
): TicketStatus | null {
  const index = TICKET_FLOW.indexOf(status);
  if (index <= 0) return null;
  return TICKET_FLOW[index - 1];
}

/**
 * ตั๋วที่ "เสิร์ฟแล้ว" นับเวลาจากตอนกดเสิร์ฟ ไม่ใช่ตอนสั่ง
 * ถ้านับจากตอนสั่ง ทุกใบจะค้างแดงตลอดแล้วสีเลิกมีความหมาย (บทเรียนเดียวกับฝั่งเว็บ)
 */
export function elapsedMinutes(fromIso: string, now: number): number {
  const started = Date.parse(fromIso);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 60000));
}

/** ค่า fallback ของเวลารอ เมื่อสถานีนั้นยังไม่ได้ตั้ง SLA จาก server */
export const TICKET_WARN_MINUTES = 5;
export const TICKET_LATE_MINUTES = 10;

export type TicketUrgency = 'normal' | 'warn' | 'late';

export function ticketUrgency(
  minutes: number,
  status: TicketStatus,
  warnMinutes = TICKET_WARN_MINUTES,
  lateMinutes = TICKET_LATE_MINUTES,
): TicketUrgency {
  if (status === 'SERVED') return 'normal';
  if (minutes >= lateMinutes) return 'late';
  if (minutes >= warnMinutes) return 'warn';
  return 'normal';
}

/** รอบถัดไปของโต๊ะ = รอบสูงสุดที่เคยออกตั๋วไป + 1 (นับรวมตั๋วที่เสิร์ฟไปแล้ว) */
export function nextRoundNo(
  tickets: KitchenTicket[],
  tableCode: string,
): number {
  let max = 0;
  for (const ticket of tickets) {
    if (ticket.tableCode === tableCode) max = Math.max(max, ticket.roundNo);
  }
  return max + 1;
}

export interface RoundLineInput {
  sku: string;
  name: string;
  qty: number;
}

/**
 * หนึ่งรอบที่ส่งครัว = ตั๋วหนึ่งใบ "ต่อสถานี" ไม่ใช่ใบเดียวรวมทุกอย่าง
 * ครัวร้อนกับบาร์เป็นคนละคน ตั๋วใบเดียวที่ปนกันทำให้ปุ่มของคนหนึ่งไปขยับงานของอีกคน
 *
 * รายการที่หาสถานีไม่เจอไปรวมที่ `fallbackStation` แทนที่จะถูกทิ้ง —
 * อาหารที่หายจากกระดานเพราะข้อมูลแคตตาล็อกไม่ครบคือของที่ไม่มีใครทำโดยไม่มีใครรู้
 */
export function groupRoundByStation(
  lines: RoundLineInput[],
  stationOf: (sku: string) => string | undefined,
  fallbackStation: string,
): Array<{ station: string; items: KitchenTicketItem[] }> {
  const byStation = new Map<string, KitchenTicketItem[]>();
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const station = stationOf(line.sku) ?? fallbackStation;
    const bucket = byStation.get(station) ?? [];
    bucket.push({ name: line.name, qty: line.qty });
    byStation.set(station, bucket);
  }
  return Array.from(byStation.entries()).map(([station, items]) => ({
    station,
    items,
  }));
}

/**
 * รายชื่อสถานีสำหรับแถบตัวกรอง = สถานีที่ประกาศไว้ + สถานีที่มีตั๋วอยู่จริง
 *
 * ⚠️ ก่อนหน้านี้แถบนี้อ่านจากลิสต์ที่เขียนไว้ 3 ชื่อ ขณะที่เมนูมี 4 สถานี — ตั๋วของ "ของหวาน"
 * จึงกรองหาไม่เจอเลยทั้งที่อยู่บนกระดาน
 */
export function stationFilters(
  declared: string[],
  tickets: KitchenTicket[],
): string[] {
  const seen = new Set(declared);
  for (const ticket of tickets) seen.add(ticket.station);
  return Array.from(seen);
}
