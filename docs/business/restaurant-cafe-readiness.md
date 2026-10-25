# ร้านอาหาร / คาเฟ่: ตรวจความพร้อมก่อนทำ marketing

Release H: [คุณภาพ พักล็อต และตามรอยผลกระทบ](operation-production.md#release-h--quality-cases-lot-holds-and-impact-evidence)
พักล็อตจริงในเส้นทางสต็อก งานตรวจแยกผู้ทบทวน และเสนอ/อนุมัติปล่อยใช้หรือทิ้งแยกคน พร้อมรายงานและแจ้งเตือนภายใน
ต้อง 10.97 ก่อน app; รับเพิ่ม/คืนล็อตพักต้องตรวจรอบใหม่ ไม่เรียกคืนลูกค้าหรือพักผลผลิตปลายทางอัตโนมัติ ไม่รับรองความปลอดภัย

Release G: [แผนวัตถุดิบ → เติมของ → ตรวจรับ → พร้อมผลิต](operation-production.md#release-g--materials-replenishment-and-inspected-receiving)
เชื่อม BOM ที่ตรึงไว้ PO/ใบขอสาขา และการลงรับหลังตรวจทานพร้อมหลักฐานล็อต/ต้นทุน/สต็อกใน transaction เดียว
ไม่ใช่การจองหรือพยากรณ์อัตโนมัติ ไม่รวมการโอนล็อต/quarantine/recall และยังต้อง UAT หน้าร้าน

Release F: [SOP/การฝึก ปัญหาซ้ำ และทบทวนรายสัปดาห์](operation-improvement.md) เพิ่มฉบับมาตรฐาน,
รับทราบแยกจากประเมิน, คำเตือนในกะ, งานปรับปรุงใช้ Checklist เดิม และสรุปหลายสาขาแบบยืนยันถาวร.
ต้อง migration 10.94 + 10.95 และตรวจบทบาทจริงก่อน rollout ไม่ใช่การรับรองอาหารปลอดภัย.

24 ต.ค. 2026: [Release E](operation-production.md) เพิ่มแผนเตรียมและใบผลิตจริง เชื่อมงาน A–D,
สต็อกล็อตและต้นทุนวัตถุดิบถัวเฉลี่ย รวมของเสียเฉพาะล็อต. ไม่ใช่การรับรอง rollout; ต้อง pilot
สูตรและ SKU ของเตรียมจริงก่อนใช้งาน วันหมดอายุรองรับระดับวัน ไม่ใช่ชั่วโมง.

ตรวจจากโค้ดใน branch `codex/restaurant-cafe-readiness` วันที่ 22 ตุลาคม 2026
รายงานนี้แยก “มี implementation” ออกจาก “ผ่านการใช้งานจริงกับร้านและอุปกรณ์”
ไม่ได้รับรองทุก workflow ว่าผ่าน production end-to-end

ส่วนเพิ่ม 24 ต.ค. 2026: [Release A + B + C + D งานปฏิบัติการร้านและหลักฐานการตรวจ](operation-checklists.md)
เพิ่ม `/admin/operations`, immutable templates/run snapshots, corrective actions, private images
และ schedule; C เพิ่มงานของฉัน, inbox ในหน้างาน, ส่งต่อหัวหน้า/รับเรื่อง และรายงานตามวันกำหนดส่ง.
D เพิ่มตารางกะ, งานตามหน้าที่, ใบส่งมอบ, สรุปยืนยันผู้จัดการและกระดิ่งทั่วหน้าแอดมิน.
ต้อง `10.90` + `10.91` + `10.92` และ rollout แยกจากผลตรวจวันที่ 22 ต.ค. ด้านล่าง; ยังไม่ส่ง LINE/email.

## ข้อสรุป

ระบบมีแกนหลักสำหรับร้านอาหารและคาเฟ่แล้ว: หน้าร้าน โต๊ะ รอบสั่ง ครัว
ออเดอร์ออนไลน์ สต็อกวัตถุดิบ และรายงานต้นทุน ไม่ควรใช้คำว่า “ครบทุกระบบ”
หรือ “เชื่อมทุก delivery platform” เพราะยังมีข้อจำกัดด้านการเชื่อมต่อและอุปกรณ์

**เลือกรูปแบบร้านให้ถูกตอน onboarding:** คาเฟ่ที่ต้องใช้โต๊ะ QR และ KDS ต้องตั้งเป็น
`restaurant` ส่วน `food_beverage` ใช้ flow สินค้า/ออเดอร์แบบค้าปลีก
ไม่ได้รับ restaurant branch/hours/kitchen rules โดยอัตโนมัติ
ประเภทตั้งต้นถูกล็อกหลังมีออเดอร์จริง จึงควรตรวจให้ถูกก่อนเริ่มขาย

## ฟีเจอร์ที่พบใน implementation

| ด้าน | มีอะไรแล้ว | ขอบเขตที่ต้องสื่อสาร |
| --- | --- | --- |
| หน้าร้าน | Dine-in / takeaway, โต๊ะ, รอบสั่ง, ย้ายโต๊ะ, แยก/รวมบิล, settlement ผ่าน POS กลาง | แยก/รวมบิลมีข้อกำหนดของ dine-in; ยืนยันสิทธิ์ด้วย device + cashier PIN |
| ครัว | KDS แยก station, ส่งรอบ, สถานะงาน, sold-out ตามสาขา | ชำระออนไลน์ไม่ได้สั่งครัวอัตโนมัติ ต้องรับออเดอร์ก่อน |
| เมนู | สูตร, สูตรย่อย, SOP, modifiers ที่คิดราคาฝั่ง server, stock ตามส่วนประกอบ | modifiers ผูก RECIPE; ความหวาน/นม/ท็อปปิงต้องตั้ง catalog ให้ตรง ไม่ใช่ AI เดาราคา |
| QR โต๊ะ | ลูกค้าส่งรายการจากโต๊ะได้ พนักงานตรวจและรับเข้ารอบ | เป็น proposal ที่ต้องยืนยัน ไม่ใช่ส่งตรงเข้าครัวโดยไม่มีคนตรวจ |
| ออนไลน์ | แชตส่งคำขอ เลือกสาขา DELIVERY/PICKUP เวลาที่ขอ ร้านตรวจและยืนยันก่อนสร้างบิล/ลิงก์ชำระ มีชั่วโมงเปิดร้านและพักรับออเดอร์ | REQUEST_RECEIVED ยังไม่จอง stock หรือเรียกชำระ; ชำระแล้วพนักงานรับเข้าครัวอีกขั้น; เวลาเป็นคำขอ |
| ยกเลิก/คืน | ยกเลิกบางรายการ คืน stock/สิทธิ์ผ่าน shared return engine และติดตามเงินคืนค้าง | เงินคืน non-cash ต้องมีหลักฐานการโอนจริง ไม่ใช่คืนเงินอัตโนมัติทุกช่องทาง |
| ลูกค้า/การขาย | CRM สมาชิก แต้ม คูปอง ส่วนลด และประวัติการซื้อร่วมกับระบบกลาง | สิทธิ์/เงื่อนไขโปรโมชั่นยังตรวจที่ backend |
| วัตถุดิบ | รับเข้า โอนสาขา ตรวจนับ ของเสีย recipe snapshots และต้นทุนจริงแบบ moving weighted average | ต้องตั้งสูตรและข้อมูลรับเข้าจริง; recipe sample เป็น opt-in |
| วิเคราะห์เมนู | เปรียบเทียบต้นทุนประมาณการ/จริง กำไรเมนู ราคา/แพ็ก/N-for-price/bundle ตามช่วงเวลาและสาขา | ต้นทุนที่ไม่มีหลักฐานต้องเป็น unknown; กำไรสุทธิเป็นการจัดสรรเพื่อบริหาร |
| จอง/คำขอ | บันทึกคำขอจากแชตและให้พนักงานจัดการ | REQUESTED ไม่ใช่การรับประกันโต๊ะว่างหรือ confirmed table hold |

หลักฐาน: [POS และ restaurant online](pos.md#restaurant-chat-and-online-orders),
[ต้นทุนและวัตถุดิบ](inventory.md), [ข้อกำหนดระบบ](../agent-invariants.md),
`apps/web/lib/bms/restaurant*.ts`, `recipe*.ts`, `menu*.ts`,
`apps/web/app/(pos)/pos/` และ `apps/web/lib/bms/tools/catalog.ts`.
เอกสาร [restaurant-chat-delivery](restaurant-chat-delivery.md) เป็นแผนในช่วงก่อนหน้า
รายการ “ยังไม่มี” ในนั้นต้องตรวจเทียบโค้ดปัจจุบันก่อนนำไปใช้

## ช่องว่างที่แก้ในรอบนี้: รับเองที่ร้าน

1. Checkout เคยบังคับที่อยู่จัดส่งแม้ออเดอร์เป็น PICKUP ทำให้ลูกค้าที่มีชื่อ/โทรครบส่งสลิปไม่ได้
   ตอนนี้ยกเว้นเฉพาะ PICKUP ที่อ่านจากออเดอร์ในฐานข้อมูล ไม่รับคำอ้างจาก request
   ซ่อนที่อยู่ของลูกค้าบน checkout รับเอง และแสดงชื่อสาขาที่อ่านจากระบบ
2. การแก้ข้อมูลลูกค้าเคยคำนวณค่าส่งใหม่ให้ออเดอร์ PICKUP/POS ได้ ตอนนี้ตัดออกจากรายการ
   DELIVERY ยังคำนวณได้ แต่ต้อง recheck สถานะ รายการ ยอด ที่อยู่ carrier และ payment
   หลังได้ order lock; บันทึกค่าและ audit ใน tenant transaction เดียวกัน
   เรียก carrier ก่อนเปิด transaction จึงไม่รอ network ขณะถือ order lock
3. ส่งมอบ PICKUP เคยติดเงื่อนไขไม่มีที่อยู่ ตอนนี้ใช้ stock handover เดิมโดยยกเว้นที่อยู่
   และล็อก order ป้องกันคำขอซ้ำตัด stock ซ้ำ DELIVERY ยังตรวจที่อยู่เหมือนเดิม
4. หน้าลูกค้าและปุ่มหลังบ้านใช้คำว่า “รับเอง/ส่งมอบที่ร้าน” ทั้งไทยและอังกฤษ
   ก่อนยืนยันต้องตรวจผู้รับและส่งมอบจริง ชำระแล้วไม่แสดงข้อความว่าอาหารพร้อม
   สถานะฐานข้อมูลยังใช้ PACKING/SHIPPED ตามเดิม ไม่สร้าง shipment ของผู้ขนส่งสำหรับ handover

ไม่มี migration หรือการแก้ข้อมูลออเดอร์เดิมอัตโนมัติ
หากออเดอร์เก่าเคยถูกคิดค่าส่งผิด ต้องตรวจยอดและสถานะการชำระก่อนแก้เป็นรายออเดอร์

## ข้อจำกัดก่อนใช้ข้อความโฆษณา

- foodpanda ยังเป็น sandbox/shadow; GrabFood และ LINE MAN ยังติด contract
  ห้ามสื่อว่าเชื่อม production พร้อมใช้แล้ว
- ยังไม่มีการเลือกเครื่องพิมพ์แยก station แบบครบ flow หรือ offline dine-in sync
  Emergency Offline เป็น plain-retail cash queue ตามข้อจำกัดเดิม
- ยังไม่มีระบบบัตรคิวลูกค้าและเรียกคิวผ่าน SMS/LINE ที่ครบวงจร
- อีเมลสถานะใช้ template กลาง `order.packing/order.shipped` ยังไม่มี template รับเองแยก
  ร้านที่เปิดอีเมลแจ้งสถานะต้องตรวจ wording ของ template ก่อนใช้กับ pickup
- จองโต๊ะในแชตไม่ควรใช้คำว่า “จองสำเร็จทันที” หรือ “การันตีโต๊ะ”
- ต้องทดลองกับ printer/payment/provider ที่จะใช้จริง และทดสอบรับออเดอร์จนส่งมอบ
  ของร้านนำร่องก่อนเปิดแคมเปญขาย ข้อความด้านภาษีไม่ควรสื่อว่าเป็น e-Tax อัตโนมัติ

ข้อความตั้งต้นที่ตรงกับฟีเจอร์:

> จัดการร้านอาหารและคาเฟ่ ตั้งแต่รับออเดอร์หน้าร้านและแชต โต๊ะและงานครัว
> ไปจนถึงวัตถุดิบและรายงานต้นทุน พร้อมให้ทีมร้านตรวจและยืนยันขั้นตอนสำคัญ

ตัวอย่าง demo: เปิดโต๊ะ → เพิ่มเมนู/ตัวเลือก → ส่งครัว → ชำระ → ดู stock/cost;
อีกเส้นทางคือแชต PICKUP → เลือกสาขา/รายการและยืนยันคำขอ → เก็บชื่อ/โทร →
พนักงานตรวจคำขอและยืนยันบิล → ส่ง signed checkout → แจ้งชำระ →
ตรวจชำระ → พนักงานรับออเดอร์เข้าครัว → ทำอาหาร → ตรวจผู้รับและส่งมอบ

## หลักฐานการตรวจ

- Pure service regression: `restaurant-pickup-checkout-contract` — 8 tests ผ่าน
  ครอบคลุม signed scope, missing contact, DELIVERY/legacy, marketplace และคำตอบไทย/อังกฤษ
- PostgreSQL contract: `restaurant-pickup-db-contract` — 7 tests ผ่านบน container
  ทิ้งได้ที่ localhost:5547 / `bms_restaurant_readiness_test` พร้อม synthetic schema/RLS
  ครอบคลุม concurrency, stale quote, tenant isolation, audit rollback และส่งมอบซ้ำ
- DB suite ใช้ production order service แต่ mock carrier และ movement writer;
  ไม่ได้ restore production schema จึงไม่ใช่หลักฐานทดสอบ realtime triggers,
  inventory valuation หรือ migrations ทั้งระบบ
- Browser smoke: checkout, admin orders และคู่มือจาก component/CSS จริง ด้วยข้อมูลสังเคราะห์
  ที่ 1440×1000 และ 390×844; ตรวจ pickup contact/edit, missing-contact lock,
  DELIVERY address requirement, handover confirmation ไทย/อังกฤษ และคู่มือที่แก้
  ไม่พบ horizontal overflow ในหน้ามือถือที่ตรวจ เป็น UI fixture ไม่ใช่ authenticated live E2E
- `npm run gate` ผ่าน (exit 0): typecheck, pure tests 3,000 ผ่าน / ข้าม 2 และ production build
  มี warning ของ Browserslist และ jsonwebtoken บน Edge Runtime; ไม่มี build error

## การรวมงานค้าปลีกและร้านอาหาร

รวมงานร้านอาหารเข้ากับ `codex/retail-online-readiness` แล้ว โดยเก็บทั้ง IP/token rate limits,
ขนาด JSON ที่จำกัด, การปฏิเสธ payment เมื่อสถานะออเดอร์เปลี่ยน และ flow PICKUP ในชุดเดียวกัน
เพิ่ม regression ที่นำผลจาก checkout service จริงผ่าน payment route ที่มี rate limit
เพื่อตรวจว่ารับเองที่มีข้อมูลครบผ่านขั้นตรวจ contact ได้ และ DELIVERY ยังต้องมีที่อยู่
ผลตรวจรวมล่าสุดบันทึกใน [รายงานค้าปลีก](retail-omnichannel-readiness.md#ผลตรวจหลังรวมงานร้านอาหาร)
