import { useWindowDimensions } from 'react-native';

// เกณฑ์ความกว้าง — เครื่องขาย/แท็บเล็ตหน้าร้านมักเป็นอุปกรณ์ที่กว้างกว่ามือถือมาก
// (POS ทั่วไปวางเป็นแท็บเล็ตแนวนอน ไม่ใช่มือถือ) เลข breakpoint จึงต้องคิดจากกริดที่แน่น
// พอสำหรับนิ้ว ไม่ใช่ตัวเลขมาตรฐานของเว็บ
const TABLET_BREAKPOINT = 700;
const LARGE_TABLET_BREAKPOINT = 1000;

export interface Responsive {
  width: number;
  height: number;
  isTablet: boolean;
  /** จำนวนคอลัมน์ของกริด (เมนู/ผังโต๊ะ/ตั๋วครัว) ตามความกว้างจอ */
  gridColumns: number;
}

// ⚠️ เคยมี `contentMaxWidth` + `<ConstrainedPane>` ที่บีบหน้าฟอร์มให้แคบแล้ววางกลางจอ — ถอดออกแล้ว
// เพราะบนไอแพดมันอ่านออกมาเป็น "แอปมือถือที่ถูกยืดใส่จอใหญ่" ไม่ใช่แอปของเครื่องขาย (ผู้ใช้ทักสองรอบ)
// ทุกหน้าตอนนี้ใช้พื้นที่จริงของจอ: จอที่มีรายการ+การกระทำแยกเป็นสองแผง ส่วนกริดเพิ่มคอลัมน์

/** จำนวนคอลัมน์ของกริดตามความกว้าง "ของพื้นที่กริดจริง" — ไม่ใช่ความกว้างจอเสมอไป
 *  (จอเมนูบนแท็บเล็ตมีแผงตะกร้ากินที่ไปส่วนหนึ่ง กริดจึงต้องคิดจากที่ที่เหลือ) */
export function columnsForWidth(width: number): number {
  if (width >= LARGE_TABLET_BREAKPOINT) return 4;
  if (width >= TABLET_BREAKPOINT) return 3;
  return 2;
}

/**
 * เติมช่องว่างท้ายลิสต์ให้แถวสุดท้ายเต็มคอลัมน์
 *
 * ⚠️ จำเป็นกับทุกกริดที่การ์ดใช้ `flex: 1` — FlatList ของ RN ไม่ได้กันช่องของคอลัมน์ที่ไม่มีข้อมูล
 * ไว้ให้ ถ้าแถวสุดท้ายมี 2 ใบในกริด 4 คอลัมน์ สองใบนั้นจะยืดเป็นใบละครึ่งจอ (เห็นจริงบนไอแพด
 * 2026-09-10 ทั้งกริดเมนูและผังโต๊ะ) ซึ่งไม่ตรงกับกริดบนเว็บที่รางกว้างคงที่
 *
 * ตัวเติมเป็น null — ผู้เรียกเรนเดอร์เป็น View เปล่า จึงไม่มีอะไรให้แตะโดนพลาด
 * ลิสต์ว่างคืนลิสต์ว่างเหมือนเดิม เพื่อให้ `ListEmptyComponent` ยังทำงาน
 */
export function padGrid<T>(items: T[], columns: number): Array<T | null> {
  if (items.length === 0 || columns <= 1) return items;
  const filler = (columns - (items.length % columns)) % columns;
  return [...items, ...Array<null>(filler).fill(null)];
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  const gridColumns = columnsForWidth(width);
  const isTablet = width >= TABLET_BREAKPOINT;

  return { width, height, isTablet, gridColumns };
}
