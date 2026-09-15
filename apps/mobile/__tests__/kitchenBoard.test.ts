import {
  elapsedMinutes,
  groupRoundByStation,
  nextRoundNo,
  nextTicketStatus,
  previousTicketStatus,
  stationFilters,
  ticketUrgency,
  type KitchenTicket,
} from '../src/lib/kitchenBoard';

const ticket = (over: Partial<KitchenTicket>): KitchenTicket => ({
  id: 't',
  tableCode: 'T01',
  roundNo: 1,
  station: 'ครัวร้อน',
  status: 'NEW',
  createdAt: new Date().toISOString(),
  items: [],
  ...over,
});

describe('kitchenBoard', () => {
  it('สถานะเดินหน้าและถอยหลังได้ทีละขั้น และหยุดที่ปลายทาง', () => {
    expect(nextTicketStatus('NEW')).toBe('PREPARING');
    expect(nextTicketStatus('PREPARING')).toBe('READY');
    expect(nextTicketStatus('READY')).toBe('SERVED');
    expect(nextTicketStatus('SERVED')).toBeNull();

    expect(previousTicketStatus('SERVED')).toBe('READY');
    expect(previousTicketStatus('NEW')).toBeNull();
  });

  it('นับเวลารอจาก createdAt ไม่ใช่เลขที่ประทับไว้ตายตัว', () => {
    const now = Date.parse('2026-09-11T10:00:00.000Z');
    expect(elapsedMinutes('2026-09-11T09:52:00.000Z', now)).toBe(8);
    // เวลาที่อ่านไม่ออกต้องไม่กลายเป็น NaN บนจอ
    expect(elapsedMinutes('ไม่ใช่เวลา', now)).toBe(0);
    // เวลาในอนาคตไม่ทำให้ได้เลขติดลบ
    expect(elapsedMinutes('2026-09-11T10:05:00.000Z', now)).toBe(0);
  });

  it('ตั๋วที่เสิร์ฟแล้วไม่ขึ้นสีเร่ง แม้ตัวเลขจะเยอะ', () => {
    expect(ticketUrgency(3, 'NEW')).toBe('normal');
    expect(ticketUrgency(6, 'NEW')).toBe('warn');
    expect(ticketUrgency(20, 'PREPARING')).toBe('late');
    expect(ticketUrgency(99, 'SERVED')).toBe('normal');
  });

  it('รอบถัดไปของโต๊ะนับต่อจากรอบสูงสุด รวมตั๋วที่เสิร์ฟไปแล้ว', () => {
    const tickets = [
      ticket({ id: 'a', tableCode: 'T01', roundNo: 1, status: 'SERVED' }),
      ticket({ id: 'b', tableCode: 'T01', roundNo: 2 }),
      ticket({ id: 'c', tableCode: 'T02', roundNo: 7 }),
    ];
    expect(nextRoundNo(tickets, 'T01')).toBe(3);
    expect(nextRoundNo(tickets, 'T02')).toBe(8);
    expect(nextRoundNo(tickets, 'T09')).toBe(1);
  });

  it('หนึ่งรอบแตกเป็นตั๋วต่อสถานี ไม่ใช่ใบเดียวปนกัน', () => {
    const stationOf = (sku: string) =>
      sku === 'DRINK' ? 'บาร์เครื่องดื่ม' : 'ครัวร้อน';
    const groups = groupRoundByStation(
      [
        { sku: 'FOOD1', name: 'ผัดไทย', qty: 2 },
        { sku: 'DRINK', name: 'ชาเย็น', qty: 1 },
        { sku: 'FOOD2', name: 'ต้มยำ', qty: 1 },
      ],
      stationOf,
      'ไม่ระบุสถานี',
    );
    expect(groups).toHaveLength(2);
    expect(groups.find(g => g.station === 'ครัวร้อน')?.items).toHaveLength(2);
    expect(groups.find(g => g.station === 'บาร์เครื่องดื่ม')?.items).toEqual([
      { name: 'ชาเย็น', qty: 1 },
    ]);
  });

  it('รายการที่หาสถานีไม่เจอต้องไม่หายจากกระดาน', () => {
    const groups = groupRoundByStation(
      [{ sku: 'UNKNOWN', name: 'ของลึกลับ', qty: 1 }],
      () => undefined,
      'ไม่ระบุสถานี',
    );
    expect(groups).toEqual([
      { station: 'ไม่ระบุสถานี', items: [{ name: 'ของลึกลับ', qty: 1 }] },
    ]);
  });

  it('แถบกรองครอบสถานีที่มีตั๋วจริง แม้ไม่ได้ประกาศไว้ล่วงหน้า', () => {
    const filters = stationFilters(
      ['ครัวร้อน', 'ครัวเย็น'],
      [ticket({ station: 'ของหวาน' })],
    );
    expect(filters).toContain('ของหวาน');
    expect(filters).toContain('ครัวร้อน');
    // ไม่ซ้ำ
    expect(new Set(filters).size).toBe(filters.length);
  });
});
