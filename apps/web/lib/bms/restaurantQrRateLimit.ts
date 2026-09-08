/**
 * แผนถังเพดานของหน้าสั่งอาหารด้วย QR (pure — ไม่ import อะไรเลย จึงเทสได้โดยไม่ต้องมี DB/route)
 *
 * **ทำไมต้องสองชั้น**: ลูกค้าทั้งร้านออกเน็ตทาง IP เดียวกัน ถ้านับรวมเป็นถังเดียวทั้งร้าน
 * โต๊ะที่กำลังสั่งจะไปกินโควตาของโต๊ะอื่น — จึงต้องแยกถังตาม session · แต่คุกกี้เป็นของที่
 * **ผู้เรียกถืออยู่เอง** ถังที่แยกตามคุกกี้อย่างเดียวจึงไม่ใช่เพดาน: หมุนคุกกี้ใหม่ทุกคำขอ
 * (รูปที่ผ่านเดาได้จาก regex ข้างล่าง ไม่ต้องมี session จริง) = ได้ถังใหม่ไม่จำกัด
 *
 * จึงคืน **ทั้งสองถัง** แล้วให้ผู้เรียกบังคับให้ผ่านครบทุกใบ · ชั้น IP ตั้งกว้างพอสำหรับ
 * ร้านเต็มร้าน (คูณ `QR_IP_BURST_FACTOR`) เพื่อไม่ให้ร้านจริงชนเพดานตัวเอง แต่ทำให้การยิงรัว
 * จาก IP เดียว **มีขอบเขต** แทนที่จะไม่มีเลย
 */
export type QrRateLimitBucket = { key: string; limit: number };

/** ร้านหนึ่งมีโต๊ะที่สั่งพร้อมกันได้ราวนี้ — ชั้น IP ต้องกว้างกว่าชั้น session เท่านี้ */
export const QR_IP_BURST_FACTOR = 20;

/**
 * คุกกี้ที่ "รูปทรงถูก" เท่านั้นที่ได้ถังของตัวเอง — ตรวจแค่รูป ไม่ได้ยืนยันว่ามี session จริง
 * (การยืนยันจริงเกิดทีหลังใน requireRestaurantQrSession) นี่คือเหตุผลที่ชั้น IP ต้องมีเสมอ
 */
const SHAPED_SESSION_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export function planRestaurantQrRateLimitBuckets(input: {
  scope: string;
  limit: number;
  ip: string;
  sessionToken: string | null | undefined;
  /** ผู้เรียกส่ง digest มาให้ เพื่อไม่ให้ค่า token ตัวจริงกลายเป็นคีย์ใน Redis */
  sessionDigest: (token: string) => string;
}): QrRateLimitBucket[] {
  const ipBucket = (limit: number): QrRateLimitBucket => ({
    key: `restaurant-qr:${input.scope}:ip:${input.ip}`,
    limit,
  });
  // `open` ยังไม่มี session ให้แยก — IP คือตัวตนเดียวที่มี
  if (input.scope === "open") return [ipBucket(input.limit)];
  const token = String(input.sessionToken ?? "");
  if (!SHAPED_SESSION_TOKEN.test(token)) return [ipBucket(input.limit)];
  return [
    { key: `restaurant-qr:${input.scope}:session:${input.sessionDigest(token)}`, limit: input.limit },
    ipBucket(input.limit * QR_IP_BURST_FACTOR),
  ];
}
