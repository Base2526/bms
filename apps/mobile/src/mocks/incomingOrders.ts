import type { MockCartLine } from './menu';

/**
 * ออร์เดอร์ที่ "เข้ามาจากข้างนอก" (แชท/ออนไลน์/ลูกค้าสแกน QR ที่โต๊ะ)
 *
 * ⚠️ ทั้งหมดเป็นของจำลองในหน่วยความจำ — ยังไม่มี network/subscription
 * ตอนต่อ backend ชั้นนี้จะถูกแทนด้วย GraphQL query + subscription ของคิวคำขอ
 * (ฝั่งเว็บคือ `bms_restaurant_order_requests` + แท็บ "ออร์เดอร์เข้า" ของ `/pos`)
 *
 * ⚠️ กฎที่ต้องรักษาไว้ตอนต่อของจริง: ออร์เดอร์ที่เข้ามาเป็น **ข้อเสนอ** เท่านั้น
 * ต้องมีคนกดรับก่อนถึงจะกลายเป็นงานของครัว — ฝั่งเว็บบังคับเรื่องนี้ (`PAID -> PACKING`
 * ต้องเป็นการกดของคน ไม่ใช่ผลพลอยได้ของการจ่ายเงิน)
 */
export type IncomingOrderChannel = 'chat' | 'online' | 'qr_table';

export type IncomingOrderStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface MockIncomingOrder {
  id: string;
  channel: IncomingOrderChannel;
  customerName: string;
  /** โต๊ะที่ลูกค้าสแกน QR สั่ง — ช่องทางอื่นไม่มี */
  tableCode?: string;
  note?: string;
  lines: MockCartLine[];
  receivedAt: string;
  status: IncomingOrderStatus;
  /** เหตุผลตอนปฏิเสธ — ฝั่งเว็บบังคับให้มีเสมอ ลูกค้าต้องได้คำตอบว่าทำไมไม่รับ */
  rejectReason?: string;
}

export const INCOMING_CHANNEL_LABEL: Record<IncomingOrderChannel, string> = {
  chat: 'แชท',
  online: 'สั่งออนไลน์',
  qr_table: 'QR ที่โต๊ะ',
};

/**
 * ตัวอย่างออร์เดอร์ที่ใช้ "จำลองออร์เดอร์เข้า" — วนใช้ซ้ำได้
 * SKU ตรงกับ `restaurantMockCatalog` เพื่อให้ตอนกดรับแล้วแตกตั๋วครัวตามสถานีได้จริง
 */
export const mockIncomingOrderTemplates: Array<
  Omit<MockIncomingOrder, 'id' | 'receivedAt' | 'status'>
> = [
  {
    channel: 'chat',
    customerName: 'คุณแนน',
    note: 'ไม่ใส่ผักชี',
    lines: [
      { sku: 'MENU-PADTHAI', name: 'ผัดไทยกุ้งสด', qty: 2, unitPrice: 89 },
      { sku: 'MENU-THAI-TEA', name: 'ชาไทยเย็น', qty: 2, unitPrice: 45 },
    ],
  },
  {
    channel: 'qr_table',
    customerName: 'โต๊ะ T02',
    tableCode: 'T02',
    lines: [
      { sku: 'MENU-SOMTAM', name: 'ส้มตำไทย', qty: 1, unitPrice: 69 },
      { sku: 'MENU-LIME-TEA', name: 'ชามะนาวเย็น', qty: 3, unitPrice: 45 },
    ],
  },
  {
    channel: 'online',
    customerName: 'คุณต้น',
    note: 'รับเองหน้าร้าน 18:30',
    lines: [
      { sku: 'MENU-TOMYUM', name: 'ต้มยำกุ้งน้ำข้น', qty: 1, unitPrice: 149 },
      { sku: 'MENU-BROWNIE', name: 'บราวนี่ไอศกรีม', qty: 1, unitPrice: 79 },
    ],
  },
];

export function incomingOrderTotal(order: MockIncomingOrder): number {
  return order.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
}
