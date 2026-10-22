# ตรวจความพร้อมร้านค้าปลีกหน้าร้านและออนไลน์ก่อนทำการตลาด

ตรวจวันที่ **22 ตุลาคม 2026** จาก source บน `develop` ที่ `9659f5c1` และการแก้ใน
`codex/retail-online-readiness` เอกสารนี้ตรวจความสามารถที่มีในรีโป ไม่ใช่ใบรับรอง production
หรือผลทดสอบร้านจริง และไม่ได้ติดตั้ง migration หรือเปลี่ยนข้อมูลร้าน

## ข้อสรุปสำหรับการวางสินค้า

**แกน POS + ขายผ่านแชท + CRM + สต็อก + งานจัดส่งมีแล้ว แต่ยังไม่ครบสำหรับคำสัญญาว่าเป็น
เว็บอีคอมเมิร์ซซื้อเองและเชื่อมทุก marketplace แบบอัตโนมัติครบวงจร**

ขอบเขตที่เหมาะกับการเตรียมแคมเปญรอบแรกคือร้านค้าปลีกที่ขายหน้าร้านและรับออร์เดอร์ผ่าน LINE
หรือช่องทางแชทที่ตั้งค่าและทดสอบแล้ว พนักงานตรวจรับเงินและจัดส่ง ใช้ฐานข้อมูลเดียวกับ POS
หน้าเว็บสินค้าใช้เป็นแค็ตตาล็อกแชร์ลิงก์ ก่อนเปิดรับลูกค้าจริงต้องผ่านการซ้อมขายด้านล่าง

## ฟีเจอร์กับขอบเขตจริง

“มีในโค้ด” หมายถึงพบ service และเส้นทางเรียกใช้ ไม่ได้แปลว่าทดสอบกับ production ในรอบนี้

| งานของร้าน | ผลตรวจ | หลักฐานและข้อจำกัด |
| --- | --- | --- |
| สินค้า รูป บาร์โค้ด ตัวเลือก หน่วยขาย/แพ็ก ราคาส่ง | มีในโค้ด | `lib/bms/products.ts`, `productPacks.ts`, `barcode.ts`; ตัวเลือกมาจาก catalog และต้องเปิด sales surface ให้ช่องทางนั้น |
| ขายหน้าร้าน พักบิล กะ ลิ้นชัก ยกเลิกและคืน | มีในโค้ด | `lib/bms/pos.ts`, REST `/api/pos/*`, GraphQL POS; device + cashier PIN และ PIN คนที่สองสำหรับงานที่กำหนด |
| เงินสด/โอน/QR/บัตร และแบ่งจ่ายที่ POS | มีในโค้ด | `recordPosSale()` และ payment rows; การบันทึกวิธีจ่ายไม่ได้หมายถึงเชื่อมเครื่องรูดบัตรหรือ payment gateway |
| สมาชิก แต้ม เครดิตร้าน บัตรของขวัญ มัดจำ ขายเชื่อ | มีในโค้ด | [POS](pos.md), `lib/bms/membership.ts`, `pos.ts`; ห้ามเหมารวมว่าสิทธิ์/วิธีจ่ายทั้งหมดใช้บน public checkout ได้ |
| สต็อกหน้าร้านกับออร์เดอร์ออนไลน์ | ใช้ backend ร่วมกัน | `orders.ts` จองยอดที่พร้อมขายแบบมีเงื่อนไข, `pos.ts` ปิดการขายใน transaction; จำนวนที่จองอ้าง `bms_order_stock_lines`; รอบนี้ไม่ได้พิสูจน์การแข่งขันซื้อชิ้นสุดท้ายบน DB |
| รับสินค้า PO โอนสาขา นับสต็อก | มีในโค้ด | [Inventory](inventory.md), `stockTransfers.ts`, `stockCounts.ts`; โอนเป็นส่งแล้วรับ นับเป็นส่วนต่าง |
| ขายหลายรายการผ่านแชท | มีในโค้ด ต้องตั้งช่องทาง/AI | `pipeline.ts`, `tools/catalog.ts`, `requestedItems.ts`; ลูกค้ายืนยันสรุปก่อนสร้าง order และต้องทดสอบโมเดล/ช่องทางจริงก่อนโฆษณาประสิทธิภาพ |
| CRM และ Inbox รวมงานขาย | มีในโค้ด | `customers.ts`, `inbox.ts`; ความสามารถตอบกลับแตกต่างกันตามช่องทาง |
| แค็ตตาล็อกเว็บร้าน/หน้าสินค้า | มีในโค้ด | `/shop/[tenantSlug]/products`, `getPublicProduct()`; แสดงสินค้า แชร์ โทร/ลิงก์เว็บไซต์ร้าน ยังไม่มีตะกร้าและการสั่งซื้อเองจากหน้านี้ |
| ลิงก์ checkout หลังสั่งผ่านแชท | มีในโค้ด | `checkout.ts`, `/checkout`, `/api/bms/checkout`; ลงชื่อผู้รับ/ที่อยู่ ส่งสลิป ดูสถานะและเลขพัสดุที่บันทึกแล้ว |
| รับเงินออนไลน์ | โอน/PromptPay ที่ร้านตั้งค่า + คนยืนยัน | `paymentConfiguration.ts`, `submitPaymentOnce()`; checkout รับเฉพาะ BANK_TRANSFER/QR และสร้าง PENDING ไม่ใช่ตรวจเงินเข้าบัญชีอัตโนมัติ |
| คูปอง/โปรโมชัน | มี แต่ไม่เท่ากันทุกช่องทาง | [Orders](order.md#coupons-discount-codes), [POS](pos.md); ซื้อ A แถม B ข้าม SKU (`10.41`) เฉพาะ RETAIL_POS และสินค้าตัดสต็อกตรง |
| แพ็กของ จัดส่ง เลขติดตาม | มี workflow ภายใน | `shipping.ts`; Flash/Kerry ยังไม่มี live booking adapter ที่ยืนยันกับสัญญาร้านจริง ดู [Carriers](../integrations/carriers.md) |
| สั่งออนไลน์แล้วเลือกรับที่สาขา (ค้าปลีก) | ยังไม่มี workflow เฉพาะนี้ | `orders.ts` ปฏิเสธ `fulfillmentType`/`promisedAt` นอก restaurant online; อย่าใช้ความสามารถ pickup ของร้านอาหารเป็นหลักฐานของค้าปลีก |
| ภาษี รายงานยอดขาย/สต็อก/การเงิน | มีในโค้ด พร้อมเงื่อนไข | [POS](pos.md), [Payments](payment.md), `/admin/reports`; e-Tax ยังไม่ผ่าน live provider และ PDF อีเมลยังต้องทดสอบผู้ให้บริการจริง |
| สิทธิ์พนักงาน หลายสาขา Audit | มีในโค้ด | `permissions.ts`, tenant transaction/RLS, server-derived device scope; ต้องตรวจ migrations/สิทธิ์บนฐานเป้าหมาย |
| Mobile/Desktop/Offline | มีขอบเขตเฉพาะ | [Cloud/Hybrid](cloud-hybrid-pos.md); mobile offline เฉพาะคิวขายเงินสดค้าปลีกพื้นฐาน ส่วน Desktop offline ไม่มี และ [Retail Local](retail-local-ga-readiness.md) ยังเป็น pilot |

พาธ service ในตารางอ้างจาก `apps/web/` รายการนี้ไม่ใช่คำรับรองฟีเจอร์อื่นที่ไม่ได้ตรวจ

## ช่องทางที่ต้องสื่อสารแยกกัน

| ช่องทาง | สิ่งที่พบในรีโป | คำสัญญาที่ควรหลีกเลี่ยง |
| --- | --- | --- |
| LINE | มี receive/reply/push และตรวจ identity ของ OA; ต้องตั้งค่าบัญชีร้านและทดสอบ webhook จริง | “เปิดใช้ได้ทันทีโดยไม่ต้องตั้งค่า” |
| Facebook/Instagram | มี webhook และเส้นทางส่งผ่าน Meta; ขึ้นกับ token/permission/account ของร้าน | “ทุกบัญชีเชื่อมสำเร็จแน่นอน” |
| Web chat | มี public webhook endpoint; client/widget ต้องเชื่อม endpoint | “มีเว็บตะกร้าซื้อเองครบแล้ว” |
| TikTok | webhook เข้า pipeline ได้ แต่ `TODO(prod)` ที่จุดส่งกลับ และ `channelSupportsPush()` ไม่รวม TikTok | “AI ตอบและปิดการขายกลับไปใน TikTok อัตโนมัติแล้ว” |
| Shopee/Lazada | scaffold/beta และการชำระ/จัดส่งอยู่ใน Seller Center | “ซิงก์ marketplace production ครบทั้งออร์เดอร์ สต็อก แชท และคืนเงิน” |

หลักฐาน: [LINE](../integrations/line.md), [TikTok](../integrations/tiktok.md),
[Lazada/Shopee](../integrations/lazada.md), `lib/bms/inbox.ts`, webhook routes ของแต่ละช่องทาง
รอบนี้ไม่ได้ตรวจเอกสาร provider ล่าสุดหรือส่งข้อความไปหาลูกค้าจริง

## สิ่งที่แก้ในรอบ recheck

1. เพิ่มเพดาน public checkout API แยกอ่าน 120/แก้ที่อยู่ 30/ส่งสลิป 10 ครั้งต่อนาที
   ต้องผ่านทั้ง IP และ token; ตรวจ IP ก่อน parse body และ token ก่อนอ่านข้อมูลหรือประมวลผลรูป
   ใช้ limiter กลางและ hash identity ไม่เก็บ bearer token ตรง ๆ ใน rate-limit key
   เกินเพดานคืน 429 พร้อม Retry-After และ no-store
2. PATCH ที่อยู่จำกัด JSON จริง 16 KiB แม้ไม่ส่ง Content-Length หรือส่งค่าเท็จ
   ปฏิเสธ null/array/primitive/JSON เสียเป็น 400 และเกินขนาดเป็น 413 ก่อนแก้ข้อมูล
3. หากสถานะออร์เดอร์เปลี่ยนระหว่างอ่าน checkout กับ submitPaymentOnce เช่นถูกยกเลิก
   service คืนผลล้มเหลวแทน `ok: true` ที่ไม่มี payment สำเร็จ
4. เพิ่ม regression tests ที่เรียก handler/service จริงโดยจำลอง dependencies ภายนอก
   และใส่ checkout ลงทะเบียน public routes ที่ต้องมี limiter

ไม่มี schema migration หรือการเปลี่ยนกติกายอดเงิน/สต็อก/การยืนยันรับเงินในงานนี้
เพดานนี้ครอบ API ข้างต้น; หน้า SSR `/checkout` ยังอ่าน service ตรง
limiter กลางยังมี fallback ต่อ instance เมื่อ Redis ล่ม จึงต้องตรวจ Redis และ trusted-proxy
ที่กำหนด `x-forwarded-for` ตอน deploy; การเพิ่ม guard นี้ไม่ได้รับรองระบบป้องกัน DDoS ทั้งระบบ

## งานที่ยังไม่ครบ แยกจากบั๊กที่แก้แล้ว

| ลำดับ | งาน | เกณฑ์เสร็จ |
| --- | --- | --- |
| ก่อนแคมเปญ | สาธิตร้านตัวอย่างด้วยสินค้า/บัญชีรับเงินจริงที่ได้รับอนุญาต | ผ่านวงจรหน้าร้านและแชทด้านล่าง มีหลักฐานผลและผู้รับผิดชอบ |
| ก่อนแคมเปญ | ช่องทางส่งข้อความและอุปกรณ์รุ่นที่ขายให้ลูกค้า | รับ/ตอบจริงและ retry ไม่ซ้ำ; พิมพ์/ลิ้นชักผ่านเครื่องจริงรุ่นนั้น |
| ถ้าจะขายเป็นเว็บอีคอมเมิร์ซ | ตะกร้าเว็บ + ตัวเลือก/จำนวน + สรุปยืนยัน + สร้าง order + กลับมาติดตาม | ใช้ createOrder และ token ที่ออกจาก server, จำกัดการจองสต็อก/การใช้ซ้ำ; ไม่สร้าง business rules ชุดใหม่ใน frontend |
| ถ้าจะขาย Click & Collect | retail pickup, สาขารับสินค้า, ขั้นส่งมอบและคืนสินค้า | กติกาสต็อก/เงิน/ภาษี/ผู้รับของชัดเจนและทดสอบ race/คืนสินค้า; ห้ามยก restaurant path มาเปิดให้ retail เฉย ๆ |
| ถ้าจะขาย marketplace automation | TikTok outbound และ Shopee/Lazada contracts | ได้ provider contract/สิทธิ์จริง ผ่าน sandbox และวงจร live ที่ตกลงกัน |
| ถ้าจะขายจองขนส่ง/e-Tax อัตโนมัติ | merchant/provider onboarding | มี adapter จากสัญญาจริงและผลทดสอบ retry, duplicate, failure; ไม่เดา API |

งานเพิ่มตะกร้าและ pickup เป็น workflow ใหม่ ไม่ใช่การเปิด flag ที่มีอยู่
รอบนี้ยังไม่ได้สร้างหรือเปลี่ยนรูปแบบสินค้าเป็นเว็บอีคอมเมิร์ซเต็มตัว

## บททดสอบก่อนเปิดรับลูกค้าจริง

ใช้ร้านทดสอบแยกและฐานที่ติดตั้ง migrations ถูกต้อง ห้ามใช้ลูกค้าจริงเป็น fixture

1. ตั้งสินค้า 2 ตัวเลือก + หน่วยแพ็ก, สาขา, barcode, ราคาขาย, บัญชีรับเงิน, พนักงาน/สิทธิ์
2. POS ขายเงินสด/แบ่งจ่าย พักและเรียกบิล ปิดกะ ตรวจยอดเงินและ movement
3. ลูกค้าทาง LINE สั่งหลายรายการ ยืนยันรายการ รับ checkout กรอกเฉพาะข้อมูลขาด ส่งสลิป
   เจ้าหน้าที่ตรวจ/ยืนยัน แพ็กและใส่ tracking ลูกค้าอ่านผลได้
4. POS และออนไลน์แข่งซื้อสินค้าชิ้นสุดท้าย: ต้องไม่ติดลบและไม่ออกสองบิลที่ใช้ชิ้นเดียวกัน
   ยกเลิก order ค้างแล้วคืน reserved ตามบิลให้ถูกต้อง
5. กดจ่ายซ้ำ/ส่งสลิปซ้ำ/เน็ตหลุดหลังบันทึก: ไม่สร้างการรับเงินหรือบิลซ้ำ
6. คืนสินค้า/คืนเงินทั้งเงินสดและโอน ตรวจ stock movement, refund pending, tax และรายงาน
7. พนักงานสิทธิ์ไม่ถึง/ลิงก์หมดอายุ/ลิงก์แก้ไข/tenant อื่น: ถูกปฏิเสธ ไม่มีข้อมูลรั่ว
8. ตรวจมือถือและ desktop, เครื่องพิมพ์จริง, reconnect/realtime, backup/restore และงาน cron

## ผลตรวจในรอบนี้

ผลด้านล่างเป็นรอบค้าปลีกก่อนรวม; ดูผลล่าสุดในหัวข้อท้ายเอกสาร

- ชุดใหม่ `node scripts/run-contract-tests.mjs pure checkout-public-boundary`: **ผ่าน 9/9**
- `npm run gate`: **ผ่าน (exit 0)** — TypeScript, pure 258 ไฟล์ (3,001 ผ่าน / 2 skipped /
  0 failed; รวมชุดใหม่ 9 กรณี), production build สร้างเสร็จ
  ระหว่าง build มีคำเตือนเชื่อม PostgreSQL ไม่ได้ จึงไม่ใช่หลักฐานว่า data routes อ่าน DB ได้
- Browser smoke จาก production build บน `127.0.0.1:3017`: หน้า `/checkout` กรณีไม่มีลิงก์
  ที่ 1440×900 และ 390×844 แสดงข้อความผิดพลาดตามคาด ไม่มีแนวนอนล้น; ลิงก์ผิดบนมือถือแสดง
  ข้อความลิงก์ไม่ถูกต้อง/หมดอายุ ไม่ใช่หน้าเปล่า ไม่ได้ทดสอบ checkout ของออร์เดอร์จริง
- HTTP smoke กับ build เดียวกัน: GET ลิงก์ผิดเป็น 404, PATCH JSON null เป็น 400,
  PATCH เกิน 16 KiB เป็น 413; ทั้งหมดมี JSON error และ no-store ไม่มีการเขียนข้อมูลร้าน
  Redis ไม่ได้เปิด จึงทดสอบเส้นทาง fallback ของ limiter ไม่ใช่เพดานร่วมหลาย instance
- ยังไม่รัน DB suites: ไม่มี BMS PostgreSQL/Redis stack ที่กำลังทำงานใน Docker ที่ตรวจพบ
  ไม่ได้ใช้ฐาน production หรือ dump เป็นทางลัด
- ยังไม่พิสูจน์ provider/hardware/live AI/โหลดจริง จึงยังไม่มีหลักฐานสำหรับคำว่า production-ready ทุกส่วน

## ข้อความสำหรับ marketing brief

> “ขายหน้าร้านและรับออร์เดอร์ผ่านแชทในระบบเดียว เชื่อม POS ลูกค้า และสต็อก ลดงานกรอกซ้ำ
> พร้อมลิงก์ให้ลูกค้าตรวจออร์เดอร์และแจ้งชำระเงิน โดยร้านตรวจยืนยันก่อนจัดส่ง”

ต่อท้ายรายละเอียดช่องทาง แพ็กเกจ และอุปกรณ์ที่ร้านตั้งค่าและทดสอบแล้ว
ไม่อ้างยอดขายเพิ่ม/ลดต้นทุนเป็นเปอร์เซ็นต์โดยไม่มีผลวัด และไม่ใช้คำว่า
“ทุกช่องทางอัตโนมัติ”, “รับเงินอัตโนมัติ”, “ครบทุกระบบออฟไลน์” หรือ “เว็บอีคอมเมิร์ซครบวงจร”

## ผลตรวจหลังรวมงานร้านอาหาร

วันที่ 22 ตุลาคม 2026 รวม `codex/restaurant-cafe-readiness` เข้ากับ
`codex/retail-online-readiness`: checkout ใช้ rate limits และขนาด request ที่จำกัด
ร่วมกับ flow PICKUP และยังปฏิเสธการชำระเมื่อสถานะออเดอร์เปลี่ยนระหว่างทำงาน

- TypeScript และ pure suites 259 ไฟล์: **3,010 ผ่าน / 2 skipped / 0 failed**
  รวม API regression ที่นำ checkout service จริงมาทดสอบกฎ pickup/contact ภายใต้ rate limiter
- `npm run gate` รวม production build: **ผ่าน (exit 0)** หลังรวมทั้งสองงาน
- PostgreSQL contract หลังรวม: **7/7 ผ่าน** บน disposable localhost:5547
  ใช้ synthetic schema/RLS และ production order service; carrier/movement writer เป็นตัวแทนทดสอบ
  ไม่ใช่การรับรอง migrations/realtime/valuation ทั้งระบบ และปิด container หลังทดสอบแล้ว
- Browser evidence ใช้ผล desktop/mobile ของแต่ละงานข้างต้นและ
  [รายงานร้านอาหาร](restaurant-cafe-readiness.md#หลักฐานการตรวจ);
  การรวมนี้ไม่มีการเปลี่ยน layout เพิ่ม และยังไม่ได้ทำ live-provider/hardware E2E
