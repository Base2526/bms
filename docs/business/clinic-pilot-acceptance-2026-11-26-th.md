# ตรวจรับคลินิกผู้ป่วยนอก รอบสอง — 26 พฤศจิกายน 2026

ขอบเขต: branch `codex/clinic-outpatient-pilot`, technical pilot ที่ flag ปิดเป็นค่าเริ่มต้น ใช้ข้อมูลสังเคราะห์เท่านั้น ตารางนี้บันทึกผลที่รันในรอบนี้ ไม่ยกผลรอบก่อนมาเป็นหลักฐานใหม่

| Workflow / expected behavior | Code path | Test/หลักฐานรอบนี้ | ผลและช่องว่าง |
| --- | --- | --- | --- |
| HN แยกจาก CRM; ชื่อซ้ำไม่รวม chart; contact ไม่ให้สิทธิ์ผู้ปกครองอ่าน | `clinic/patients.ts`, `10.141` | `clinic-pilot-db-contract`: HN/ชื่อซ้ำคนละ UUID, tenant FK/RLS | ผ่านบน fixture สังเคราะห์; ยังไม่ทดสอบการพิสูจน์ตัวตนผู้ปกครองหรือ portal เพราะอยู่นอก pilot |
| RBAC + active clinic role + care relationship; ต่าง tenant/ถูกถอนสิทธิ์อ่านไม่ได้ | `clinic/access.ts`, `clinic/encounters.ts`, `clinic/attachments.ts`, REST adapters | `clinic-pilot-route-contract`, `clinic-pilot-access-db-contract`: clinician, nurse, cashier, revocation, cross-tenant | ผ่าน service/adapter กับ `bms_app` บน fixture; Registrar/Administrator/ผู้ไม่มีสิทธิ์ยังไม่ได้เดิน authenticated browser ตามบทบาท |
| Emergency clinician-only, เหตุผล/confirmation, 15 นาที, audit; ไม่เปิดไฟล์ | `requestClinicEmergencyAccess`, `requirePatientCareAccess`, attachment queries | `clinic-pilot-access-db-contract`: ก่อน grant/หลัง grant/หมดอายุ/ถอน role/ไฟล์ยัง 404; audit call ไม่มีเนื้อหาไฟล์ | ผ่านบน fixture; ไม่ได้ทดสอบ clock skew หลายเครื่องหรือ production audit store |
| นัดหมายไม่ซ้อนผู้ตรวจ/ห้อง; คำขอเก่าหลังเลื่อนครั้งใหม่ไม่ย้อนเวลา | `clinic/appointments.ts`, exclusion constraints `10.141`, request ledger `10.142`, UI ref | `clinic-pilot-db-contract`: concurrent room booking สำเร็จหนึ่ง, RLS/FK/key; `clinic-pilot-reschedule-contract`: red ก่อนแก้ แล้ว green หลังแก้ | แก้แล้ว; UI หลัง login และโหลดเดือนที่มีข้อมูลมากยังไม่พิสูจน์ |
| Draft version, signed note/addendum immutable; แผนยาเป็นข้อความเท่านั้น | `clinic/encounters.ts`, signed-note triggers `10.141` | `clinic-pilot-contract`, `clinic-pilot-db-contract`: input validation, note/encounter immutable | ผ่านขอบเขตนี้; full clinical form/sign/addendum บน restored BMS schema ยังไม่รัน |
| ไฟล์ PDF/PNG/JPEG ≤2 MiB อ่านตาม encounter, role, tenant และ no-store | `clinic/attachments.ts`, `/api/bms/clinic/attachments` | `clinic-pilot-access-db-contract`: upload/list/download, type, care team, revocation, tenant; `clinic-pilot-attachment-route-contract`: auth, 413, 404, headers | แก้ 401 body ให้ตรงสถานะ; ผ่าน fixture/adapter; ไม่ได้ทดสอบ browser download หลัง login หรือ malware scanning |
| Cashier worklist ไม่มี clinical note, ค้น HN/ชื่อและบอกเมื่อเกิน 100 | `clinic/billing.ts`, `/api/bms/clinic`, clinic UI | `clinic-pilot-billing-contract`, `clinic-pilot-route-contract`; query ตรวจใน fixture รอบก่อน แต่รอบนี้ทดสอบ service mock | ผ่าน targeted tests; ยังไม่มี authenticated cashier browser และ query load test ขนาดใหญ่ |
| Charge ใช้ NON_STOCK/ONLINE_ORDER/VAT N และราคา server; order mismatch rollback; retry ไม่ซ้ำ | `clinic/billing.ts`, `createOrderInTx()` | code-path review, `clinic-pilot-closed-order-contract`: red ก่อนแก้/green หลังแก้; `clinic-pilot-db-contract` ล็อก reviewed lines | แก้ closed order replay ให้ต้อง review; **ยังไม่พิสูจน์ full order transaction, payment submit/confirm/void/refund กับ restored BMS schema** |
| Clinical note ไม่เข้า order, payment, CRM, AI, realtime หรือ POS | clinic services, order input, AI tool catalog, mobile incoming query, desktop route | code-path review: `createClinicChargeOrder` ส่งเฉพาะ SKU/size/qty; mobile restaurant incoming ต้องมี `fulfillment_type`; desktop จำกัด `/pos`; ไม่มี clinic tool | ไม่พบทางส่ง note/file จาก code path ที่ตรวจ; ยังไม่ใช่การตรวจข้อมูลจริงในทุก receipt/report/log runtime |
| Web navigation, i18n, manual, desktop/mobile regression | `/admin/clinic`, `/admin/manual/clinic`, i18n, native apps | web gate, desktop lint/test, mobile typecheck/Jest; browser 1280×800 และ 390×844 | ทุก suite ผ่าน; browser ทั้งสอง route redirect ไป `/admin/login?next=…` ถูกต้องเมื่อไม่ authenticated และหน้า login ไม่มี horizontal overflow; หน้า clinic/manual หลัง login ยังไม่ได้ตรวจเพราะไม่มีบัญชีทดสอบ |

## หลักฐานที่รันในรอบนี้

- `node ../../scripts/run-contract-tests.mjs pure clinic-pilot`: ผ่าน targeted clinic contracts หลังแก้
- บน PostgreSQL 16 disposable ที่ `127.0.0.1:5544/clinic_pilot_test`: ใช้ `scripts/infra/clinic-pilot-fixture-base.sql`, apply `10.141` และ `10.142` อย่างละสองครั้ง; `node ../../scripts/run-contract-tests.mjs db clinic-pilot-db-contract` และ `... db clinic-pilot-access-db-contract` ผ่าน
- `apps/web npm run gate`: ผ่าน (pure 4,017 tests: ผ่าน 4,011, ไม่ผ่าน 0, ข้าม 6; production build ผ่าน) หลังแก้ admin navigation และ realtime domain coverage ที่ gate รอบแรกจับได้
- `apps/desktop npm run lint` ผ่าน; `apps/desktop npm test` ผ่าน 178/178
- `apps/mobile npm run typecheck` ผ่าน; `apps/mobile npm test -- --runInBand --watch=false` ผ่าน 520/520 ใน 66 suites
- browser บน production server local: `/admin/clinic` และ `/admin/manual/clinic` ที่ 1280×800 และ 390×844 redirect ไป login พร้อม `next` ตรง route; หน้า login ไม่เกิด horizontal overflow. ไม่มี authenticated test account จึงยังไม่อ้างว่าหน้า clinic/manual หลัง login หรือ cashier-only flow ผ่าน

## Release gates ที่ยังเปิดอยู่

1. Restored throwaway BMS schema และ full clinic → order → payment → cancellation/refund/reconciliation ต้องผ่านด้วยข้อมูลสังเคราะห์ รวม rollback และ retry หลัง network failure
2. Browser desktop/mobile หลัง login ด้วย Registrar, Nurse, Clinician, Cashier, Administrator และบัญชีที่ถูกถอนสิทธิ์; ตรวจข้อความผิดพลาดและการแสดงผลจริง
3. ผู้รับผิดชอบคลินิกตรวจแบบฟอร์ม การลงนาม และใบอนุญาต; ฝ่ายข้อมูลส่วนบุคคลตรวจฐานประมวลผล retention/backup/export; บัญชี/ภาษีตรวจ SKU/VAT/เอกสารและการคืนเงิน
4. ทดสอบเครื่องพิมพ์/อุปกรณ์จริง, backup/restore, performance และ incident response ก่อนใช้ข้อมูลผู้ป่วยจริง
