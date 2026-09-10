export type TicketStatus = 'NEW' | 'PREPARING' | 'READY' | 'SERVED';

export interface MockKitchenTicket {
  id: string;
  tableCode: string;
  roundNo: number;
  station: string;
  status: TicketStatus;
  elapsedMinutes: number;
  items: { name: string; qty: number }[];
  note?: string;
}

export const mockKitchenStations = ['ครัวร้อน', 'ครัวเย็น', 'บาร์เครื่องดื่ม'];

export const mockKitchenTickets: MockKitchenTicket[] = [
  {
    id: 'kt1',
    tableCode: 'T01',
    roundNo: 1,
    station: 'ครัวร้อน',
    status: 'PREPARING',
    elapsedMinutes: 6,
    items: [{ name: 'ผัดไทยกุ้งสด', qty: 2 }],
  },
  {
    id: 'kt2',
    tableCode: 'T03',
    roundNo: 1,
    station: 'ครัวเย็น',
    status: 'NEW',
    elapsedMinutes: 1,
    items: [{ name: 'ส้มตำไทย', qty: 3 }],
    note: 'เผ็ดน้อย 2 ที่',
  },
  {
    id: 'kt3',
    tableCode: 'T01',
    roundNo: 1,
    station: 'บาร์เครื่องดื่ม',
    status: 'READY',
    elapsedMinutes: 4,
    items: [{ name: 'ชามะนาวเย็น', qty: 2 }],
  },
];
