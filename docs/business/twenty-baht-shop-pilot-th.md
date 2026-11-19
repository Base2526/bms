# ร้าน 20 บาท: ขอบเขต pilot

หน้าอ่านสาธารณะ: `/th/learn/twenty-baht-shop` และ `/en/learn/twenty-baht-shop` (ยัง `noindex`)

## ร้านต้นแบบ

หนึ่งสาขา เครื่อง 1–3 จุด สินค้า WATER-500 และ SOAP-01 ราคา 20 บาท แต่แยก SKU, สต็อกและต้นทุน;
TISSUE-01 ราคา 35 บาท สินค้าที่ไม่มีบาร์โค้ดให้ค้นหา SKU หรือพิมพ์ป้ายรหัสร้าน
ข้อมูลทั้งหมดเป็นตัวอย่าง ไม่ใช่ข้อมูลจากร้านจริง

## ผลตรวจโค้ด

| งาน | แหล่งอ้างอิงในรีโป | ขอบเขต |
| --- | --- | --- |
| นำเข้า CSV/XLSX | `productImport.ts`, `productImportTemplate.ts`, `products.ts` | Preview และ commit ตรวจ SKU/บาร์โค้ดซ้ำ, ราคา, ต้นทุน, โควตา; สินค้าใหม่เป็น Draft; เพิ่มคอลัมน์ VAT แบบ V/N/UNKNOWN ในงานนี้; ไฟล์สินค้าไม่เพิ่มสต็อก |
| ตั้งต้นและรับเข้า | `stockCounts.ts`, `purchase.ts`, `movements.ts` | ใบนับสต็อกที่สาขาและผู้มีสิทธิ์กด apply สร้าง COUNT_ADJUST; PO รับจริงสร้าง STOCK_IN; ไม่ใช้การเขียน `bms_inventory` ตรง |
| POS | `pos.ts`, `stock.ts`, `docs/business/pos.md` | แคชเชียร์ใช้ PIN/สิทธิ์, คีย์รายการกันซ้ำ, คืนบางส่วน, void ที่ต้องใช้ PIN คนที่สอง, ปิดกะ; ผล QR/บัตร/โอนต้องตรวจการตั้งค่าและภายนอก |
| เปิดขายชั่วคราว | `docs/business/pos.md` § open item | เงินสดเท่านั้น ไม่ตัดสต็อกและต้นทุนไม่ทราบ จึงไม่ใช่วิธีขายหลักของร้าน |
| Offline | `docs/business/cloud-hybrid-pos.md`, `apps/desktop/README.md`, `docs/business/retail-local.md` | Mobile Emergency Offline เป็นคิวเงินสดแบบจำกัด; Desktop ไม่มี offline tender; Retail Local ยัง technical pilot |

## ตรวจเส้นทาง POS ใน branch นี้

| ขั้นตอน | Desktop shell / Web POS | Mobile POS | Backend ที่เป็นผู้ตัดสิน | สถานะหลักฐาน |
| --- | --- | --- | --- | --- |
| จับคู่เครื่องและเปิด/ปิดกะ | Electron เก็บ token ใน OS keystore แล้วเปิด `/pos`; หน้าเว็บเรียก `/api/pos/session`, `/api/pos/shift` | Keychain + `bmsPosSession`, `bmsPosShift` | `pos.ts` ตรวจ device, PIN, สิทธิ์ และกะตาม tenant/branch | มีในโค้ด; unit/contract ผ่าน; ยังไม่ลองเครื่องจริง |
| ค้นหา/สแกนและขาย | `/api/pos/scan`, `/api/pos/sale`; Desktop ใช้หน้าเว็บเดียวกัน | `bmsPosCatalogSearch`, `bmsPosScan`, `bmsPosSale` | `resolvePosScan()`, `recordPosSale()` อ่านราคา/สต็อกจากเซิร์ฟเวอร์และใช้คีย์กันซ้ำ | มีในโค้ด; pure/UI tests ผ่าน; ไม่มี DB test รอบนี้ |
| พักบิล คืนบางส่วน Void | `/api/pos/park`, `/api/pos/return`, `/api/pos/void` | `bmsPosPark`, `bmsPosReturn`, `bmsPosVoid` | `parkSale()`, `processPosReturn()`, `voidPosSale()` ตรวจบิล/สิทธิ์/ผู้อนุมัติและเขียนเงินกับสต็อกใน transaction | มีในโค้ด; Mobile retry-form regression ผ่าน; ยังไม่มีธุรกรรมจริงรอบนี้ |
| รับของ พิมพ์ใบเสร็จ รายงานกะ | หน้าเว็บใช้ `/api/pos/purchase`, `/api/pos/shift-report` และการพิมพ์ของเว็บ/OS | `bmsPosReceivePurchase`, `bmsPosShiftReport`; native Wi-Fi print | `purchase.ts`, `pos.ts` และข้อมูลใบเสร็จจากเซิร์ฟเวอร์ | มีในโค้ด; unit/contract ผ่าน; เครื่องพิมพ์และเอกสารจริงยังไม่ตรวจ |
| การเปลี่ยนแปลงจากเครื่องอื่น | Web/Desktop โหลดข้อมูลจาก API และใช้ realtime hint พร้อมการอ่านซ้ำ | Named GraphQL WS invalidation แล้ว refetch; reconnect อ่าน snapshot ใหม่ | outbox/realtime contract; ฐานข้อมูลยังเป็น source of truth | มีในโค้ด; pure tests ผ่าน; ยังไม่ลองหลายเครื่อง/WS จริง |

รอบนี้แก้ Mobile `SaleDetailScreen`: ถ้าผลคืน/void ไม่ชัดเจน การ retry จะส่ง body เดิมกับคีย์เดิม
แม้ผู้ใช้แก้ฟอร์มภายหลัง โดยต้องยืนยันว่ากำลังตรวจรายการเดิมก่อน; ห้ามเริ่ม return/void ชนิดอื่น
จนกว่าจะทราบผล. เมื่อเซิร์ฟเวอร์ยืนยันการคืนแล้ว การเตรียมบิลเปลี่ยนสินค้าที่ล้มเหลวจะไม่ทำให้คืนเงินซ้ำ.
ข้อจำกัด: attempt สำหรับ return/void นี้อยู่ในหน่วยความจำหน้าจอ; การปิดแอปก่อนทราบผลยังต้อง
ค้นบิล/หลักฐานจากเซิร์ฟเวอร์ก่อนเริ่มรายการใหม่.

การตรวจนับแบบรวมไม่รองรับสินค้าที่ติดตามล็อตหรือวันหมดอายุ และยอดตั้งต้นที่ยังไม่ทราบต้นทุน
ไม่ควรถูกแสดงเป็นกำไร ตัวอย่างนี้จึงใช้สินค้า DIRECT ที่ไม่ติดตามล็อตเท่านั้น

## แพ็กเกจตัวอย่าง

ค่าตั้งต้นใน migration `10.101`–`10.102` เป็น Free: 100 SKU/2 ผู้ใช้ (รวมเจ้าของ)/1 สาขา/1 เครื่อง,
Pro: 5,000 SKU/5 ผู้ใช้/1 สาขา/3 เครื่อง, Growth: 15,000 SKU/15 ผู้ใช้/3 สาขา/6 เครื่อง
ร้านหนึ่งสาขา 1 เครื่องและไม่เกิน 100 SKU/2 คนอาจเริ่มที่ Free; 2–3 เครื่องต้องตรวจ Pro ขึ้นไป
ก่อนเปิดใช้จริง ให้อ่านสิทธิ์/โควตาที่ tenant ใช้อยู่จาก Billing เพราะแค็ตตาล็อกแก้ได้และร้านเดิม
อาจอยู่ policy version เก่า ราคาในแค็ตตาล็อกไม่ใช่ระบบเรียกเก็บเงินจริง

## เกณฑ์ Go / No-Go

1. รหัส SKU, บาร์โค้ด, ราคา, VAT, สิทธิ์, เครื่องและสาขาตรงรายการจริง ผู้ทำบัญชีรับรอง VAT
2. นำเข้าชุดเล็กก่อน ตรวจ preview และ Draft; นับสต็อกตั้งต้นแยกและเทียบ movement
3. รับ PO, สแกนหลายชิ้น, รับเงิน/ทอน, คืนบางส่วน, void, ปิดกะ และรายงานตรงหลักฐาน
4. ทดสอบคีย์เดิมเมื่อกดซ้ำ/เน็ตหลุด สองเครื่องขายชิ้นสุดท้าย และ PIN ผู้อนุมัติคนที่สองกับฐานทดสอบแยก
5. ทดสอบสแกนเนอร์ เครื่องพิมพ์ และช่องทางรับเงินจริงกับอุปกรณ์/ผู้ให้บริการที่ร้านใช้
6. ผู้ดูแล production ยืนยัน migration, backup, monitoring และ rollback ของระบบเป้าหมาย

ทุกข้อมีหลักฐานและผู้รับผิดชอบจึง Go; ข้อใดไม่ผ่านคือ No-Go สำหรับรับเงินจริง
การมีโค้ดหรือผ่าน contract test ไม่เท่ากับผ่าน pilot หรือ deploy production
