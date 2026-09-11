import { mockMenuStations } from './menu';
import type { KitchenTicketItem, TicketStatus } from '../lib/kitchenBoard';

/**
 * ตั๋วตั้งต้นของจอครัว
 *
 * ⚠️ สถานีใช้ลิสต์เดียวกับแคตตาล็อกเมนู (`mockMenuStations`) — ของเดิมประกาศไว้เอง 3 ชื่อ
 * ขณะที่เมนูมี 4 สถานี ตั๋วของ "ของหวาน" จึงอยู่บนกระดานแต่กรองหาไม่เจอเลยสักครั้ง
 */
export const mockKitchenStations = mockMenuStations;

export interface MockKitchenSeedTicket {
  id: string;
  tableCode: string;
  roundNo: number;
  station: string;
  status: TicketStatus;
  /** กี่นาทีก่อนตอนเปิดแอป — context แปลงเป็น createdAt จริงตอน mount */
  minutesAgo: number;
  items: KitchenTicketItem[];
  note?: string;
}

export const mockKitchenSeedTickets: MockKitchenSeedTicket[] = [
  {
    id: 'kt1',
    tableCode: 'T01',
    roundNo: 1,
    station: 'ครัวร้อน',
    status: 'PREPARING',
    minutesAgo: 6,
    items: [{ name: 'ผัดไทยกุ้งสด', qty: 2 }],
  },
  {
    id: 'kt2',
    tableCode: 'T03',
    roundNo: 1,
    station: 'ครัวเย็น',
    status: 'NEW',
    minutesAgo: 1,
    items: [{ name: 'ส้มตำไทย', qty: 3 }],
    note: 'เผ็ดน้อย 2 ที่',
  },
  {
    id: 'kt3',
    tableCode: 'T01',
    roundNo: 1,
    station: 'บาร์เครื่องดื่ม',
    status: 'READY',
    minutesAgo: 4,
    items: [{ name: 'ชามะนาวเย็น', qty: 2 }],
  },
];
