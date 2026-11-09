export const QUEUE_BOARD_LAYOUTS = [
  { value: "SPOTLIGHT", label: "เรียกเด่น", description: "เลขที่เรียกล่าสุดเด่นที่สุด พร้อมรายการคิวด้านล่าง" },
  { value: "THREE_ZONE", label: "สามโซน", description: "กำลังเตรียม · กำลังเรียก · พร้อมรับ แยกคนละส่วน" },
  { value: "TICKER", label: "แถบเตรียม", description: "คิวเรียกและพร้อมรับอยู่ด้านบน กำลังเตรียมเป็นแถบด้านล่าง" },
  { value: "MINIMAL", label: "มินิมอลทีวี", description: "เน้นเลขที่เรียก เหมาะกับจอที่มองจากระยะไกล" },
  { value: "AIRPORT", label: "ป้ายรายการ", description: "แสดงหลายคิวเป็นแถว เหมาะกับร้านที่มีคิวหนาแน่น" },
  { value: "SPLIT", label: "แบ่งครึ่ง", description: "กำลังเตรียมและพร้อมรับอยู่คู่กันแบบเดิม" },
] as const;

export type QueueBoardLayout = typeof QUEUE_BOARD_LAYOUTS[number]["value"];

const QUEUE_BOARD_LAYOUT_PREFIX = "bms.pos.queueBoardLayout.";
const DEFAULT_QUEUE_BOARD_LAYOUT: QueueBoardLayout = "SPOTLIGHT";
const VALID_LAYOUTS = new Set<string>(QUEUE_BOARD_LAYOUTS.map((option) => option.value));

export function queueBoardLayoutStorageKey(namespace: string): string {
  return QUEUE_BOARD_LAYOUT_PREFIX + namespace;
}

/** A missing or invalid saved value uses the owner-facing default instead of breaking the board. */
export function readQueueBoardLayout(namespace: string): QueueBoardLayout {
  if (!namespace || typeof window === "undefined") return DEFAULT_QUEUE_BOARD_LAYOUT;
  try {
    const saved = window.localStorage.getItem(queueBoardLayoutStorageKey(namespace));
    return saved && VALID_LAYOUTS.has(saved) ? saved as QueueBoardLayout : DEFAULT_QUEUE_BOARD_LAYOUT;
  } catch {
    return DEFAULT_QUEUE_BOARD_LAYOUT;
  }
}

export function writeQueueBoardLayout(namespace: string, layout: QueueBoardLayout): void {
  if (!namespace || typeof window === "undefined" || !VALID_LAYOUTS.has(layout)) return;
  try {
    window.localStorage.setItem(queueBoardLayoutStorageKey(namespace), layout);
  } catch {
    // Blocked storage keeps the safe default. This preference never affects queue authority.
  }
}
