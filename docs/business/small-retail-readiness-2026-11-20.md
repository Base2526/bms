# ตรวจความพร้อมร้านค้าปลีกขนาดเล็ก — 20 พฤศจิกายน 2026

ขอบเขต: source บน `codex/retail-small-shop-readiness` (เริ่มจาก `5bb7d241`), ร้านหนึ่งสาขา,
สินค้า DIRECT, การขายหน้าร้านเป็นหลัก. ตารางนี้แยก **มีเส้นทางในโค้ด** ออกจาก **ผ่านธุรกรรม
กับฐาน/เครื่อง/ผู้ให้บริการจริง**. `พร้อมใช้` ในตารางหมายถึงเส้นทางและข้อกำหนดใน repo มีหลักฐาน
contract/unit; ไม่ใช่การรับรองร้านจริงหรือฐาน production. `ทดสอบไม่ได้` หมายถึงรอบนี้ไม่มี
ฐาน BMS POS+ ที่ทิ้งได้พร้อม dump, เครื่อง POS/เครื่องพิมพ์ หรือบัญชีบริการจริง.

หลักฐานคู่มือ: [คู่มือในแอป](../../apps/web/app/(admin)/admin/manual/page.tsx),
[POS](pos.md), [Inventory](inventory.md), [Payments](payment.md),
[ร้าน 20 บาท pilot](twenty-baht-shop-pilot-th.md), [Retail Local GA](retail-local-ga-readiness.md).
Implementation หลัก: `apps/web/lib/bms/` เป็นผู้ตัดสิน, `graphql/` และ `app/api/pos/` เป็น adapters.

| ฟีเจอร์/ฟิลด์ | คู่มือ | Implementation และการอ่านกลับ | ผลทดสอบรอบนี้ | สถานะ | ช่องว่าง |
| --- | --- | --- | --- | --- | --- |
| สมัครร้าน, ชื่อร้าน, slug, archetype | คู่มือเริ่มต้น/ข้อมูลร้าน | `shop-signup`, `bmsStoreProfile`, `storeProfile.ts`, `6.9`, `9.43`; ชื่ออยู่ `bms_tenants` | pure contract ใน gate; ยังไม่สร้าง tenant ใน DB | ทดสอบไม่ได้ | ต้องซ้อม signup/email verification กับฐานทดสอบ; archetype ล็อกหลังออร์เดอร์จริง |
| สาขา: code, name, address, phone, active | Locations | `admin/locations`, `locations.ts`, `7.84`; POS ผูก location จาก device | pure contract ใน gate; ไม่มี DB readback | ทดสอบไม่ได้ | ยืนยันสาขาจริงและสิทธิ์รายสาขา |
| ผู้ใช้: email, role, pos_only, active, PIN | Users/POS Devices | `admin/users`, `permissions.ts`, `pos.ts`, `7.92`; PIN ตรวจฝั่งเซิร์ฟเวอร์ทุก mutation | mobile/desktop และ pure suites ผ่าน; ไม่มีการจับคู่จริง | ทดสอบไม่ได้ | ทดสอบ PIN ผิด/บทบาทต่ำกว่า/บัญชีปิดบนฐานทดสอบ |
| เครื่อง: branch, pairing token, active | POS Devices | `pos.ts`, REST `/api/pos/session`, GraphQL `bmsPosDevice`; Desktop keystore, Mobile Keychain | Desktop 165, Mobile 490 tests และ pairing QR browser smoke ผ่าน | ทดสอบไม่ได้ | เครื่องจริง, token rotation, หลายเครื่อง |
| ข้อมูลร้าน: address, phone, email, website, logo, tax ID, locale | ข้อมูลร้าน/ภาษี | `StoreProfileCard`, `bmsStoreProfile`, `storeProfile.ts`; `bms_store_profile` อ่านกลับ | store-profile contracts ใน gate; ไม่มี DB roundtrip | ทดสอบไม่ได้ | ตรวจรูป/ที่อยู่/เลขภาษีและข้อมูลเดิมในฐานเป้าหมาย |
| บัญชีรับเงิน: bank code, account name/no, PromptPay ID, QR payload | Settings | `storeProfile.ts` ตรวจ bank code และ QR; `paymentConfiguration.ts` แสดงเฉพาะวิธีที่ตั้งจริง | pure contract และ browser smoke แบบ fixture | ยังมีช่องว่าง | ต้องยืนยันบัญชี/QR กับธนาคารจริง; ไม่มี auto-confirm เงินเข้า |
| ค่าส่งเหมา/ยอดส่งฟรี/ช่วงวันส่ง | Settings/Orders | `StoreProfileCard` → GraphQL → `storeProfile.ts` → `shippingRates.ts`; `6.9` | `store-profile-shipping-contract` 3 tests ผ่าน: ปฏิเสธติดลบ/เศษสตางค์/ช่วงวันผิด; legacy ค่าส่งติดลบไม่ถูก quote | แก้แล้ว | ยังไม่ทำ DB roundtrip หรือ provider rate จริง |
| โซนค่าส่ง, ขั้นน้ำหนัก, จังหวัดต้นทาง | Settings/Orders | `StoreProfileCard` → `storeProfile.ts` → `shippingRates.ts`; mode แยกจากค่าส่งเหมา | pure contracts ใน gate; ไม่มีอัตราจริงหรือ DB roundtrip | ทดสอบไม่ได้ | ตรวจโซนที่ไม่ครอบคลุม, ขอบน้ำหนัก และที่อยู่จริงก่อนเปิดส่งของ |
| สินค้า: SKU, name, sale price, cost | Products/Import | `products.ts` ตรวจ required/ราคา 2 ตำแหน่ง; `bmsProducts`; draft ก่อน publish | product validation/import pure suites ผ่าน | พร้อมใช้ | ราคา/ต้นทุนต้องเทียบข้อมูลร้านและ DB ก่อนรับเงินจริง |
| บาร์โค้ด, category, brand, description, images | Products | `products.ts`, `productBarcodeLookupContract.ts`; SKU/barcode ซ้ำตรวจอีกครั้งใน transaction | barcode/product contracts ใน gate | พร้อมใช้ | scanner/ฉลากจริงยังไม่ตรวจ |
| VAT category V/N/UNKNOWN | Products/ภาษี | `7.88`, `products.ts`; ไม่ส่งค่าคงของเดิม, UNKNOWN บล็อกร้านจด VAT | pure contracts; DB suite ไม่ได้รัน | ทดสอบไม่ได้ | ให้ผู้ทำบัญชีรับรองทุก SKU; migration เป้าหมาย |
| น้ำหนักสินค้า (กรัม) | Products/ค่าส่ง | `products.ts` → `weight_grams` INTEGER → `shippingRates.ts` | product pure test ปฏิเสธเศษกรัม; ผ่าน | แก้แล้ว | ข้อมูลเดิม/ค่าส่งจริงยังไม่เทียบ |
| variants, size, stock policy, sales surface | Products | `productConfiguration.ts`, `products.ts`, `9.40`–`9.52`; POS อ่าน variant จาก catalog | product catalog contracts ใน gate | พร้อมใช้ | สินค้าจริงต้องตรวจการ publish/ราคาแต่ละ size |
| packs: barcode, qty, price, branch price | Product Packs/POS | `productPacks.ts`, `pos.ts`; ราคา/จำนวนจาก DB ไม่รับ client เป็น authority | pack/price pure contracts ใน gate | ทดสอบไม่ได้ | ต้องซ้อม pack sale/return กับ DB; `10.116` ยัง source candidate |
| นำเข้า CSV/XLSX: SKU, barcode, price, cost, VAT | คู่มือ Products | `ImportModal` → `productImportTemplate.ts` → `runImport` → `upsertProduct`; preview ไม่เขียน | workbook/import pure contracts ใน gate | พร้อมใช้ | สต็อกไม่เข้าจาก import; ควรนำเข้าชุดเล็กแล้วอ่านกลับ |
| สต็อกตั้งต้น: branch, SKU, size, qty, reason | Stock Counts | `stockCounts.ts`, `7.98`; apply เป็นผลต่างและเขียน movement | pure contracts ใน gate; ไม่มี DB | ทดสอบไม่ได้ | ห้ามนับรวมสินค้าติดตามล็อต; ต้องเทียบ movement/คงเหลือ |
| ผู้ขาย: name, phone, email, type, tax ID, branch code, address, note | Purchase/Expenses | `admin/purchase` → `bmsUpsertSupplier` → `purchase.ts` → `bms_suppliers` (`5.2`, `10.11`); list อ่านกลับ; PO เดิมแสดงชื่อผู้ขายปัจจุบัน | `supplier-master-contract` และ browser smoke 1440/390 ผ่าน: validation, RBAC denial, tenant/actor, audit rollback, ฟอร์ม→mutation→อ่านกลับจาก fixture | แก้แล้ว | ยังไม่มี DB roundtrip; ต้องเทียบเอกสารผู้ขายจริงก่อนใช้ภาษีซื้อ |
| ลูกค้า: name, phone, note, tags, ช่องทาง | Customers/CRM | `admin/customers` → GraphQL → `customers.ts`; list/detail อ่านกลับตาม tenant; update ที่ละฟิลด์คงค่าเก่าเมื่อ omit | `customer-master-transaction-contract` 7 tests: RBAC, tenant/editor, audit rollback, omit/null; customer, purchase และ merge browser smoke ผ่าน; ยังไม่มี DB roundtrip | แก้แล้ว | ทดสอบข้อมูลซ้ำและ identity ข้ามช่องทางกับฐานทดสอบ |
| ที่อยู่ลูกค้า: label, ที่อยู่, จังหวัด/อำเภอ/ตำบล/รหัสไปรษณีย์, default | Customers/Orders | ฟอร์มที่อยู่ → GraphQL add/update/set default → `customers.ts`; default สอง statement อยู่ใน transaction เดียว; การล้างรหัสที่อยู่ส่ง null แล้วล้างจริง | contract พิสูจน์ rollback ของ default และ omit/null ของรหัสที่อยู่; browser smoke 1440/390 ตรวจ default true/อ่านกลับจาก fixture และสิทธิ์ดูอย่างเดียวผ่าน; ยังไม่มี DB roundtrip | แก้แล้ว | ทดสอบข้อมูลเดิมและการเลือกที่อยู่จริงใน checkout |
| PO: supplier, line qty/cost, receipt lot/expiry | Purchase/POS รับของ | `purchase.ts`, `/api/pos/purchase`, `bmsPurchase`; รับของตัดสินใน transaction | Mobile purchase tests, pure contracts และ POS purchase-status browser smoke 1440/390 ผ่าน | ทดสอบไม่ได้ | supplier/lot/expiry และ rollback ต้องซ้อมใน DB |
| โอนสาขา: source, destination, qty, lot | Stock Transfers | `stockTransfers.ts`, `7.98`, `10.107` | pure contracts ใน gate | ยังมีช่องว่าง | `10.107` WIP rollout; ไม่อ้างว่าพร้อม production |
| ขาย POS: item, qty, price, discounts, tenders, change | POS | `pos.ts` → `/api/pos/sale`/`bmsPosSale`; tenant/branch จาก device, PIN, idempotency, stock/money transaction | pure, Mobile, Desktop และ POS language/desktop shell browser smoke ผ่าน; ไม่มี DB sale รอบนี้ | ทดสอบไม่ได้ | ต้องซ้อมสองเครื่องขายชิ้นสุดท้าย, split tender และ replay กับ DB |
| Realtime หน้าร้าน/แอดมิน | POS/Admin | `apollo.ts` ใช้ WebSocket เฉพาะ URL `ws://`/`wss://` ที่ตั้งไว้; polling/refetch ยังคงอยู่ | URL contract และ browser smoke ตรวจว่าไม่มี `/admin/undefined` เมื่อไม่ตั้งค่า | แก้แล้ว | ต้องทดสอบ gateway/Redis หลาย instance และการหลุดเชื่อมต่อจริง |
| พักบิล/คืน/void: reason, qty, refund, approver PIN | POS | `pos.ts` → REST/GraphQL; void ใช้ return machinery, PIN คนที่สอง | pure และ Mobile retry tests ผ่าน | ทดสอบไม่ได้ | DB rollback, lot reconciliation, เงินคืนจริงยังไม่ตรวจ |
| สินค้าชั่วคราว: label, qty, amount, V/N | POS § สินค้าชั่วคราว | `10.129`–`10.130`, `pos.ts`; เงินสดเท่านั้น, ไม่มี stock/cost | pure contracts ใน gate | ยังมีช่องว่าง | migration production ยังไม่ยืนยัน; ไม่ใช้แทน catalog |
| Offline/replay: key, shift, accepted cash | Cloud/Hybrid POS | Mobile Emergency Offline `10.5`; Desktop ไม่มี offline tender | Mobile offline tests ผ่าน | ทดสอบไม่ได้ | ต้องทดสอบเน็ตหลุด/คืนเน็ตกับเครื่องและ DB จริง |
| ใบเสร็จ, ใบกำกับ, ภาษี, reprint | POS/Tax | `taxDocuments.ts`, `pos.ts`, `7.88`; เอกสาร snapshot, e-Tax gate | pure contracts ใน gate; tax preview/controls browser smoke 1280/390 ผ่าน | ทดสอบไม่ได้ | กระดาษ/เครื่องพิมพ์, เลขเอกสาร, ผู้ทำบัญชี, e-Tax provider |
| รายงานยอดขาย, สต็อก, กะ, คืน, ต้นทุน | Reports | `reports.ts`, `/admin/reports`, `/api/pos/shift-report`; ค่าที่ไม่รู้ไม่เดาเป็นศูนย์ | pure contracts ใน gate | ทดสอบไม่ได้ | ต้องเทียบกับรายการธุรกรรมและภาษีใน DB แยก |
| Retail Local install/update/backup/license | คู่มือ Retail Local | agent/Compose; core ใช้ Web services เดียวกัน | repo contracts ใน gate, `go test ./...` ของ agent และ AI settings browser smoke แบบ fixture ผ่าน | ยังมีช่องว่าง | technical pilot; signing, restore, hardware และ support gates ยังเปิด |

## ขอบเขตหลักฐาน

- คำว่า `พร้อมใช้` ในตารางเป็นความพร้อมของ source และ contract สำหรับการซ้อม pilot เท่านั้น.
  การอ่าน DB/RLS/rollback แบบ end-to-end ต้องใช้ฐานที่ทิ้งได้ซึ่ง restore จาก dump ที่ถูกต้อง;
  migrations ชุดนี้สร้างฐานเปล่าจากศูนย์ไม่ได้ ([runbook](../architecture/realtime-test-database.md)).
- ไม่มีการชี้ test writer ไป production หรือใช้ dump เป็นทางลัด. `outputs/` เป็นไฟล์เดิมของผู้ใช้และไม่แตะ.
- ก่อนเปิดรับเงินจริงต้องผ่าน checklist [POS](pos.md#go-live-checklist) และ
  [ร้าน 20 บาท pilot](twenty-baht-shop-pilot-th.md#เกณฑ์-go--no-go) ด้วยข้อมูล/อุปกรณ์ของร้าน.
