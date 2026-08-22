# Customer Checkout & Payment Wireframe

> สถานะ: implemented contract — public checkout ใช้งานที่ `/checkout?t=<signed-token>`
>
> ขอบเขตที่ทำงานจริงแล้ว: chat order ส่ง signed checkout link แบบ deterministic, order review,
> reuse/แก้ข้อมูลจัดส่งเดิม, เลือกเฉพาะ BANK/PromptPay ที่ร้านตั้งค่า, upload slip,
> payment submission `PENDING`, human verification และ order/shipping tracking
>
> ขอบเขตที่ยังไม่ควรแสดงว่าใช้งานจริง: payment gateway, บัตรออนไลน์, auto-confirm payment,
> carrier checkout API และ marketplace checkout ภายใน BMS

หน้าที่แยกไว้ใน wireframe ด้านล่างถูกนำมารวมเป็น responsive single-page flow เพื่อให้เปิดใน
LINE/Facebook Messenger in-app browser ได้ต่อเนื่องโดยไม่เสีย signed token ระหว่างหน้า แต่แต่ละ
section/state ยังคงใช้กติกาและ acceptance criteria เดิม

## หลัก UX ที่ต้องใช้ทุกหน้า

1. ไม่ถามข้อมูลที่ระบบมีอยู่แล้ว: ชื่อผู้รับ เบอร์โทร และที่อยู่เดิมต้องแสดงเป็นสถานะพร้อมใช้
   พร้อมปุ่ม "แก้ไข" แทนฟอร์มว่าง
2. ถ้าข้อมูลขาด ให้ขอเฉพาะ field ที่ขาด ไม่ล้างหรือให้กรอก field ที่มีอยู่ใหม่
3. ช่องทางชำระเงินต้องมาจากบัญชีที่ร้านตั้งค่าไว้เท่านั้น แถวว่างห้ามแสดง
4. ถ้าร้านไม่มีช่องทางชำระเงิน ห้ามแนะนำ "โอนธนาคาร / พร้อมเพย์ / QR / อื่น ๆ"
5. การส่งสลิปคือ "แจ้งชำระแล้ว รอตรวจสอบ" ไม่ใช่ "ชำระสำเร็จ"
6. Lazada/Shopee ใช้ข้อมูลผู้รับ ที่อยู่ และการชำระเงินจาก Seller Center ไม่เก็บซ้ำใน BMS
7. ทุกหน้าต้องแสดงยอดจาก order snapshot และห้ามให้ client แก้ยอดเอง

## Flow รวม

```text
Chat confirms product
  -> Order created (PENDING)
  -> Pipeline replaces model prose with verified order summary + signed /checkout link
  -> Review order
  -> Check channel
     -> Lazada/Shopee: show Seller Center handoff
     -> Other channels: check CRM delivery completeness
        -> Complete: reuse saved details
        -> Incomplete: collect only missing fields
  -> Check store payment configuration
     -> Configured: choose one configured method
     -> Not configured: admin handoff, no method suggestions
  -> Show payment instruction
  -> Upload/submit slip
  -> Pending human review
  -> Confirmed or rejected
  -> Track shipping
```

## Implementation mapping

- `lib/bms/checkoutToken.ts`: HMAC token ผูก `tenantId + orderId + exp` (7 วัน, สูงสุด 30 วัน)
- `lib/bms/checkout.ts`: tenant/order-scoped projection, delivery update, payment submission และ
  deterministic post-order chat reply
- `GET/PATCH /api/bms/checkout`: อ่าน checkout และบันทึกเฉพาะข้อมูลจัดส่งที่ส่งมา
- `POST /api/bms/checkout/payment`: ตรวจ token/method/order/file, เก็บสลิป และสร้าง payment
  `PENDING`; duplicate `PENDING/CONFIRMED` คืนรายการเดิม
- `(checkout)/checkout`: public standalone UI ที่ไม่โหลด admin session/chat providers

## หน้า 1: Order Created ในแชท

```text
┌─────────────────────────────────────┐
│ รับออร์เดอร์แล้ว                    │
│ Order #A3DF3TAH                     │
│                                     │
│ [ภาพ] Versace Bright Crystal        │
│       Size 200ml x 1                │
│                                     │
│ ยอดสินค้า                 799 บาท   │
│ ส่วนลด                       0 บาท   │
│ ค่าจัดส่ง            คำนวณ/ตามร้าน   │
│ ยอดที่ต้องชำระ            799 บาท   │
│                                     │
│ [ตรวจสอบข้อมูลและชำระเงิน]          │
│ [ดูสินค้าอื่น]                      │
└─────────────────────────────────────┘
```

- "ดูสินค้าอื่น" ต้องเรียก catalog และแสดง 2-3 สินค้าพร้อมขายที่ต่างจากรายการก่อนหน้า
- ถ้าร้านไม่มี payment configuration การ์ดนี้ต้องจบที่ยอดและข้อมูลจัดส่ง ห้ามถามช่องทางชำระ
- ถ้าเป็น chat flow ที่ไม่มี public checkout URL ให้ตอบ next step ในแชทด้วยกฎเดียวกัน

## หน้า 2: Review Order

```text
┌─────────────────────────────────────┐
│ ตรวจสอบคำสั่งซื้อ                   │
│                                     │
│ รายการสินค้า                        │
│ [ภาพ] ชื่อสินค้า                    │
│       ตัวเลือก / จำนวน / ราคาต่อชิ้น │
│                                     │
│ รหัสส่วนลด                SAVE10    │
│ ยอดสินค้า                 799 บาท   │
│ ส่วนลด                      79 บาท   │
│ ค่าจัดส่ง                    0 บาท   │
│ รวม                        720 บาท   │
│                                     │
│ [ดำเนินการต่อ]                       │
│ [กลับไปแก้รายการ]                    │
└─────────────────────────────────────┘
```

- ราคา จำนวน ส่วนลด และยอดรวมเป็น read-only จาก backend
- ถ้าสต็อกเปลี่ยนก่อนสร้าง order ให้กลับไปเสนอ variant/สินค้าอื่น ไม่แสดง order ครึ่งสำเร็จ
- หลัง order ถูกสร้างแล้ว การแก้รายการต้องเป็น flow ยกเลิก/สร้างใหม่ที่มี business rule ชัดเจน
  ไม่แก้ order snapshot ฝั่ง client

## หน้า 3A: Delivery Details - มีข้อมูลครบแล้ว

```text
┌─────────────────────────────────────┐
│ ข้อมูลจัดส่ง                        │
│                                     │
│ ✓ ใช้ข้อมูลเดิม                     │
│ ชื่อผู้รับ     น*** ส***             │
│ เบอร์โทร       06*-***-6936          │
│ ที่อยู่          บ้าน                 │
│                18 ... กรุงเทพ 10140  │
│                                     │
│ ระบบจะใช้ข้อมูลนี้อัตโนมัติ           │
│ [แก้ไข]                              │
│                                     │
│ [ไปหน้าชำระเงิน]                     │
└─────────────────────────────────────┘
```

- ห้ามแสดงฟอร์มว่างและห้ามบังคับกรอกใหม่
- ค่าเริ่มต้นคือใช้ address ที่ `is_default=true`; ถ้าไม่มี default ใช้แถวแรกตามลำดับเดิม
- ใน AI context ส่งเพียง completeness/count/label; raw PII แสดงใน first-party UI เท่าที่จำเป็น
- ถ้าลูกค้าไม่กดแก้ไข ให้ดำเนินการต่อได้ทันที

## หน้า 3B: Delivery Details - ข้อมูลไม่ครบ

```text
┌─────────────────────────────────────┐
│ ข้อมูลจัดส่ง                        │
│                                     │
│ ✓ ชื่อผู้รับ     มีข้อมูลแล้ว        │
│ ! เบอร์โทร       ยังไม่มี             │
│ ✓ ที่อยู่          มีข้อมูลแล้ว        │
│                                     │
│ เบอร์โทรศัพท์*                      │
│ [_______________________________]   │
│                                     │
│ [บันทึกและดำเนินการต่อ]              │
└─────────────────────────────────────┘
```

- Render input เฉพาะ `missingFields`; field ที่มีแล้วเป็น summary + "แก้ไข"
- ในแชทถามเพียง field แรกต่อข้อความ เช่น ถ้าขาด phone และ address ให้ถาม phone ก่อน
- การบันทึกต้อง preserve field ที่ไม่ได้ส่งมา
- ที่อยู่ซ้ำต้องเลือกแถวเดิมเป็น default ไม่เพิ่ม duplicate
- Validation error แสดงใต้ field และไม่ล้างค่าที่ลูกค้ากรอก

## หน้า 3C: Delivery Details - มีหลายที่อยู่

```text
┌─────────────────────────────────────┐
│ เลือกที่อยู่จัดส่ง                   │
│                                     │
│ (•) บ้าน - ค่าเริ่มต้น               │
│     18 ... กรุงเทพ 10140             │
│ ( ) ที่ทำงาน                        │
│     99 ... กรุงเทพ 10330             │
│                                     │
│ [+ เพิ่มที่อยู่ใหม่]                 │
│ [ใช้ที่อยู่นี้]                      │
└─────────────────────────────────────┘
```

- เลือกค่า default ไว้ล่วงหน้า
- ไม่เปิดฟอร์มเพิ่มที่อยู่จนกว่าลูกค้ากดเพิ่ม
- การเลือกต้องผูกกับ identity/customer เดิมของ tenant เท่านั้น
- หาก implementation ยังไม่มี order-address snapshot ต้องระบุชัดว่าการเลือกนี้เปลี่ยน default
  ของ CRM; ก่อนเปิดใช้จริงควรเพิ่ม snapshot/address reference บน order เพื่อรักษาประวัติ

## หน้า 3D: Marketplace Handoff

```text
┌─────────────────────────────────────┐
│ ข้อมูลคำสั่งซื้อ                    │
│                                     │
│ คำสั่งซื้อนี้มาจาก Shopee/Lazada    │
│ ระบบจะใช้ชื่อ ที่อยู่ และการชำระเงิน │
│ จาก Seller Center                  │
│ ไม่ต้องกรอกข้อมูลซ้ำ                │
│                                     │
│ [ดูสถานะคำสั่งซื้อ]                 │
└─────────────────────────────────────┘
```

- ห้ามแสดงฟอร์มที่อยู่และตัวเลือกบัญชี BMS
- ห้ามสร้าง deep link ปลอมหากยังไม่มี official marketplace URL ในระบบ

## หน้า 4A: Payment Methods - ร้านตั้งค่าแล้ว

```text
┌─────────────────────────────────────┐
│ เลือกช่องทางชำระเงิน                │
│ ยอดชำระ                  720 บาท   │
│                                     │
│ (•) โอนเข้าบัญชีธนาคาร              │
│     Example Bank •••• 7890          │
│ ( ) พร้อมเพย์ •••• 5678             │
│                                     │
│ [ดำเนินการต่อ]                       │
└─────────────────────────────────────┘
```

- แสดงเฉพาะ account ที่ผ่าน `configuredPaymentAccounts()`
- BANK ต้องมี `accountNo`; PromptPay/QR ต้องมี `promptpayId`
- CARD/COD/ช่องทางอื่นแสดงได้เฉพาะเมื่อมี configuration ที่ระบบรองรับจริง
- ไม่ใช้ tile disabled ของ method ที่ร้านไม่มี เพราะทำให้ลูกค้าเข้าใจผิดว่ากำลังจะเปิดใช้

## หน้า 4B: Payment Methods - ร้านยังไม่ตั้งค่า

```text
┌─────────────────────────────────────┐
│ ยังไม่สามารถชำระเงินได้              │
│                                     │
│ ร้านยังไม่ได้ระบุรายละเอียด          │
│ การชำระเงินสำหรับออร์เดอร์นี้         │
│ แอดมินร้านจะส่งรายละเอียดให้ภายหลัง   │
│                                     │
│ [กลับไปดูคำสั่งซื้อ]                 │
│ [ติดต่อร้าน]                         │
└─────────────────────────────────────┘
```

- ห้ามมีคำว่า "เลือกช่องทาง", "โอนธนาคาร", "พร้อมเพย์", "QR" หรือ "อื่น ๆ"
- ห้ามสร้าง payment row
- ปุ่มติดต่อร้านใช้ channel เดิม; ถ้าช่องทางส่งกลับไม่ได้ให้แสดงเพียงข้อความรอแอดมิน

## หน้า 5A: Bank Transfer Instruction

```text
┌─────────────────────────────────────┐
│ โอนเข้าบัญชีธนาคาร                  │
│ ยอดที่ต้องโอน             720 บาท   │
│                                     │
│ Example Bank                        │
│ 123-4-56789-0          [คัดลอก]     │
│ ชื่อบัญชี Example Shop              │
│                                     │
│ กรุณาตรวจชื่อบัญชีก่อนโอน            │
│ [โอนแล้ว แนบสลิป]                   │
│ [เปลี่ยนช่องทาง]                    │
└─────────────────────────────────────┘
```

- ข้อมูลบัญชีมาจาก store profile เท่านั้น
- ห้ามแสดงเลขบัญชีจากประวัติแชทหรือ model memory
- ปุ่ม "โอนแล้ว" ยังไม่เปลี่ยน order เป็น `PAID`

## หน้า 5B: PromptPay/QR Instruction

```text
┌─────────────────────────────────────┐
│ พร้อมเพย์ / QR                      │
│ ยอดที่ต้องชำระ            720 บาท   │
│                                     │
│ [QR จาก configuration จริง]          │
│ พร้อมเพย์ •••-•••-5678              │
│ ชื่อบัญชี Example Shop              │
│                                     │
│ [บันทึก QR]                          │
│ [ชำระแล้ว แนบสลิป]                  │
└─────────────────────────────────────┘
```

- ถ้ามีเพียง PromptPay ID แต่ยังไม่มี QR generator ที่เชื่อถือได้ ให้แสดง ID ไม่สร้าง QR ปลอม
- QR ต้อง encode ผู้รับ/ยอดตาม provider contract จริงก่อนเปิดใช้

## หน้า 6: Upload Slip

```text
┌─────────────────────────────────────┐
│ แนบหลักฐานการชำระเงิน               │
│                                     │
│ [ + เพิ่มรูปสลิป ]                   │
│ รองรับ JPG / PNG                    │
│                                     │
│ ยอดที่แจ้ง                720 บาท   │
│ ช่องทาง             Example Bank    │
│                                     │
│ [ส่งให้ร้านตรวจสอบ]                  │
└─────────────────────────────────────┘
```

- ตรวจชนิด/ขนาดไฟล์ที่ boundary
- slip OCR เป็น advisory; ห้าม auto-confirm
- ป้องกัน submit ซ้ำด้วย idempotency/deduplication
- ถ้าไม่มี attachment แต่ลูกค้าแจ้งโอนในแชท ระบบสร้างได้เพียง payment `PENDING`

## หน้า 7: Pending Verification

```text
┌─────────────────────────────────────┐
│ รับแจ้งการชำระเงินแล้ว               │
│                                     │
│ สถานะ: รอแอดมินตรวจสอบ              │
│ Payment #8F31A2C4                   │
│ Order #A3DF3TAH                     │
│ ยอด 720 บาท                         │
│                                     │
│ ยังไม่ถือว่าชำระสำเร็จ               │
│ [ดูสถานะคำสั่งซื้อ]                 │
└─────────────────────────────────────┘
```

- ใช้คำว่า "รับแจ้ง" และ "รอตรวจสอบ" เสมอ
- ห้ามแสดง success checkmark แบบรับเงินแล้ว
- Refresh/poll/realtime ต้องอ่านสถานะ payment จาก backend

## หน้า 8A: Payment Confirmed

```text
┌─────────────────────────────────────┐
│ ยืนยันการชำระเงินแล้ว                │
│ Order #A3DF3TAH                     │
│ สถานะ: ชำระเงินแล้ว                 │
│                                     │
│ ร้านกำลังเตรียมสินค้า                │
│ [ติดตามคำสั่งซื้อ]                  │
└─────────────────────────────────────┘
```

- แสดงได้หลัง backend เปลี่ยน payment เป็น `CONFIRMED` และ order เป็น `PAID` เท่านั้น
- การ confirm ต้องมาจากคนที่มี `payment.confirm`

## หน้า 8B: Payment Rejected

```text
┌─────────────────────────────────────┐
│ ยังยืนยันการชำระเงินไม่ได้            │
│ เหตุผล: [ข้อความจากแอดมิน]           │
│                                     │
│ ออร์เดอร์ยังเปิดอยู่                 │
│ [ส่งสลิปใหม่]                       │
│ [ติดต่อร้าน]                         │
└─────────────────────────────────────┘
```

- Reject payment ไม่ยกเลิก order อัตโนมัติ
- คูปองยังไม่คืนจนกว่า order จะถูกยกเลิกหรือ auto-release ตาม policy
- ไม่เปิดเผย OCR/raw provider error แก่ลูกค้า

## หน้า 9: Order Tracking

```text
┌─────────────────────────────────────┐
│ ติดตามคำสั่งซื้อ                    │
│                                     │
│ ✓ สร้างคำสั่งซื้อ                   │
│ ✓ ยืนยันการชำระเงิน                 │
│ • กำลังแพ็ก                         │
│ ○ จัดส่งแล้ว                        │
│ ○ สำเร็จ                            │
│                                     │
│ เลขพัสดุ: แสดงเมื่อมีข้อมูลจริง       │
└─────────────────────────────────────┘
```

- Timeline อ่านจาก order/payment/shipment source of truth
- ไม่สร้างเลขพัสดุหรือลิงก์ carrier เอง
- ถ้าที่อยู่หายก่อน ship ให้ staff แก้ใน CRM; backend ยังต้องบล็อกการจัดส่งเหมือนเดิม

## State / Empty / Error ที่ต้องมี

- Order not found: แจ้งว่าไม่พบ order ของ identity นี้ ห้ามถาม UUID ก่อนลอง lookup
- Payment account removed ระหว่าง checkout: กลับหน้า 4B และไม่ submit method เดิม
- Duplicate submit: คืน payment เดิม/สถานะปัจจุบัน ไม่สร้างหลายรายการโดยไม่จำเป็น
- Address save failed: เก็บ draft ใน UI, แจ้งลองใหม่, ไม่อ้างว่าบันทึกแล้ว
- Provider/OCR failed: payment ยังคง `PENDING`, ให้ staff ตรวจด้วยตนเอง
- Session/channel identity invalid: ไม่แสดง PII และไม่อนุญาตแก้ข้อมูลลูกค้า
- Order cancelled/expired: ปิดปุ่มชำระและแสดงสถานะจริง

## Acceptance Criteria

1. ลูกค้าที่มีชื่อ เบอร์ และ shipping address แล้วผ่านหน้า delivery ได้โดยไม่กรอกใหม่
2. ลูกค้าที่ขาด 2 fields เห็น/ถูกถามเพียง field แรก และค่าที่มีอยู่ไม่ถูกล้าง
3. ร้านไม่มี payment account แล้ว UI/chat ไม่มีข้อความเสนอ bank/PromptPay/QR
4. ร้านมีเฉพาะ BANK แล้วเห็นเฉพาะ BANK; ไม่เห็น PromptPay tile แบบ disabled
5. "ดูอย่างอื่น" แสดงสินค้าพร้อมขายจริง 2-3 รายการที่ไม่ซ้ำรายการก่อน
6. Lazada/Shopee ไม่ถามข้อมูล Seller Center ซ้ำ
7. ส่งสลิปแล้วสถานะยัง `PENDING` จนกว่า staff ยืนยัน
8. ทุกข้อมูล order/payment/shipping มาจาก backend และ tenant/customer scope ถูกบังคับ
