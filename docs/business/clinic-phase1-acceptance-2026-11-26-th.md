# ตรวจรับคลินิก ระยะ 1 — 26 พฤศจิกายน 2026

ขอบเขต: `codex/clinic-outpatient-phase1` จาก `develop` หลังรวม technical pilot. ใช้ข้อมูลสังเคราะห์เท่านั้น ไม่เปิด flag ไม่ deploy และไม่อ้างว่าพร้อมใช้กับผู้ป่วยจริง. เอกสารนี้บันทึกเฉพาะหลักฐานที่รันในรอบนี้; [ผลรอบก่อน](clinic-pilot-acceptance-2026-11-26-th.md) เป็นประวัติ ไม่ใช่หลักฐานแทนกัน.

## มีแล้ว / ยังขาด / ยังไม่ได้พิสูจน์

| Workflow | มีแล้วจากโค้ด | ยังขาดหรือยังไม่ได้พิสูจน์ |
| --- | --- | --- |
| ตัวตนและสิทธิ์ | Patient UUID/HN แยก CRM, clinic role + RBAC, care team, emergency access 15 นาที, ไฟล์เฉพาะ route; ดู `clinic/patients.ts`, `access.ts`, `encounters.ts`, `attachments.ts`, `10.141` | การพิสูจน์สิทธิ์ผู้ปกครอง, การตรวจใบอนุญาตกับหน่วยงานออกใบอนุญาต, browser ตามบทบาทหลังล็อกอิน, privacy/retention/backup policy ที่เจ้าของเรื่องอนุมัติ |
| นัดหมาย | `appointments.ts` + exclusion constraints กันผู้ตรวจ/ห้องซ้อน, request key ของการจองและเลื่อนนัด (`10.142`), check-in/cancel/no-show | ตารางเวลาทำงาน/วันหยุดและทรัพยากร, การทดสอบ load จริง; รายการต่อช่วงเวลาจำกัด 500 และระบุ `truncated` เมื่อเกิน แสดงคำเตือนและซ่อนจำนวนรายวัน ไม่ถือว่าปฏิทินที่ถูกตัดแสดงเวลาว่างครบ |
| เวชระเบียน | Draft/version, signed note/addendum immutable, clinician/care-team access; แผนยาไม่สร้างการจ่ายหรือตัดสต็อก | แบบฟอร์มและ field ที่ผู้ประกอบวิชาชีพตรวจรับ, export/print แยกสิทธิ์, full workflow บน restored BMS schema |
| ค่าบริการ | Cashier worklist จำกัดและไม่ส่ง clinical note, charge sheet ล็อกรายการ, `createOrderInTx()` และ payment UI เดิม; ดู `billing.ts`, REST adapter | Full clinic → order → submit/confirm payment → cancel/refund/reconcile, rollback/retry บน restored BMS schema, ตารางบริการและภาษีที่ฝ่ายบัญชียืนยัน |
| ช่องทาง | Public `/learn/clinic`, admin clinic/manual, desktop POS shell และ mobile POS ไม่มี chart tool/path ตาม code review รอบก่อน | Browser หลังล็อกอินตามบทบาท, เครื่องพิมพ์/อุปกรณ์จริง, ตรวจ report/log/AI runtime กับข้อมูลสังเคราะห์บนสภาพแวดล้อมครบ |

คลินิกเป้าหมายยัง **ไม่ยืนยันว่ามี EMR เดิมหรือไม่**. ก่อนขยายเวชระเบียนหรือออกแบบ integration ให้ผู้รับผิดชอบยืนยันระบบต้นทาง, รายการข้อมูลที่ต้องแลกเปลี่ยน และเจ้าของข้อมูล. หากมี EMR เดิม แนวทางที่ต้องพิจารณาคือให้ EMR ถือเวชระเบียนและ BMS รับเพียง visit reference กับค่าบริการที่ทบทวนแล้ว; หากไม่มี ให้ผู้ประกอบวิชาชีพตรวจแบบฟอร์ม/สิทธิ์ก่อนพัฒนา EMR ต่อ. ไม่มีการเลือกทางใดแทนคลินิกในรอบนี้.
[แผนที่การไหลของข้อมูล](clinic-data-flow-map-th.md) แยกเส้นทางที่ตรวจจากโค้ดกับเส้นทางที่ยังต้องทดสอบและให้เจ้าของเรื่องอนุมัติ.

## ข้อบกพร่องที่ทำซ้ำและแก้

1. เมื่อมีนัดมากกว่า 500 รายการ `listClinicAppointments()` เดิมคืน array 500 รายการโดยไม่แจ้งว่าถูกตัด; UI จึงแสดงจำนวนรายวันราวกับคิวครบ. `clinic-pilot-appointments-list-contract` แดงก่อนแก้. ตอนนี้ service อ่านได้สูงสุด 501 เพื่อส่ง `{ appointments: first 500, truncated }`; UI เตือนและซ่อนจำนวนรายวันเมื่อไม่ครบ. Exclusion constraint ใน DB ยังเป็นผู้ตัดสินการจองซ้อน.
2. `i18n-keys-contract` พบ false positive จาก helper สองภาษาใน public clinic guide ชื่อ `t()` ซึ่ง scanner สงวนให้ dictionary. เปลี่ยนชื่อเป็น `copy()` โดยไม่เปลี่ยนเนื้อหาหรือภาษา; contract ผ่านหลังแก้.

## หลักฐานที่รันจริง

- `node scripts/run-contract-tests.mjs pure clinic-pilot-appointments-list-contract`: แดงก่อนแก้ (`result.appointments` ไม่มี), ผ่าน 1/1 หลังแก้.
- `node scripts/run-contract-tests.mjs pure clinic-pilot`: ผ่าน 9/9. `node scripts/run-contract-tests.mjs pure i18n-keys-contract`: ครั้งแรก 3/4 เพราะ helper ชน scanner, ผ่าน 4/4 หลังแก้.
- `apps/web npx tsc --noEmit` ผ่าน. `apps/web npm run gate` ผ่าน: pure 4,018 tests, ผ่าน 4,012, ไม่ผ่าน 0, ข้าม 6; production build ผ่าน. Build แจ้ง warning ของ Edge Runtime/jsonwebtoken.
- PostgreSQL 16 disposable `clinic_pilot_test` บน `127.0.0.1:5544`: ใช้ `scripts/infra/clinic-pilot-fixture-base.sql`; apply `10.141`, `10.142` ตามลำดับ แล้วรันซ้ำทั้งคู่ผ่าน. `node scripts/run-contract-tests.mjs db clinic-pilot` ผ่าน 4/4 รวม RLS/grants, cross-tenant FK, concurrent booking, immutable note, care relationship/attachment และ 501 นัดในเดือนเดียวพร้อม `truncated=true` ภายใต้ `bms_app`. Container ถูกหยุดและลบทิ้งหลังทดสอบ.
- Browser local production build ที่ 1280×800 และ 390×844: `/learn/clinic` แสดงคู่มือภาษาไทยและไม่มี horizontal overflow; `/admin/clinic` และ `/admin/manual/clinic` redirect ไป login พร้อม `next` ถูกต้อง. ไม่มี authenticated test account จึงไม่ได้ตรวจหน้า clinic/manual หลังล็อกอินหรือ warning 500 นัดใน browser.

Fixture ขนาดเล็กไม่มี schema order/payment/stock, audit store และบริการ BMS ทั้งระบบ. ผล DB ข้างต้นพิสูจน์เฉพาะ migration/constraint/RLS และ service read/access ที่ระบุ ไม่ใช่ end-to-end บน restored BMS schema หรือการทดสอบ backup/restore.

## Release gates ที่ยังเปิดอยู่

1. Restored throwaway BMS schema: apply/reapply `10.141`–`10.142`, full workflow clinic → order → payment → cancel/refund/reconcile, retry/rollback และ backup/restore ด้วยข้อมูลสังเคราะห์.
2. บัญชีทดสอบ Registrar, Nurse, Clinician, Cashier, Administrator, revoked และต่าง tenant สำหรับ browser desktop/mobile หลังล็อกอิน; ทดสอบคิวขนาดใหญ่จริงและ error state.
3. เจ้าของคลินิกยืนยัน EMR เดิมหรือไม่, ประเภทบริการ/แบบฟอร์ม/สิทธิ์วิชาชีพ/ใบอนุญาต; ฝ่ายข้อมูลส่วนบุคคลกำหนด data flow, retention/legal hold และการกู้คืน; ฝ่ายบัญชี/ภาษียืนยัน catalog, VAT, เอกสารและการคืนเงิน.

Feature flag `BMS_CLINIC_PILOT_TENANTS` มีค่าเริ่มต้นว่าง/ปิด และรอบนี้ไม่ได้เปิด flag. ห้ามเปิดให้ tenant จริงจนกว่าทุก gate จะผ่านและผู้รับผิดชอบอนุมัติ.

## รอบขยาย inventory และ bootstrap บุคลากร

ส่วนนี้เป็นผล **รอบใหม่** หลัง baseline ข้างต้น ไม่ย้อนแก้ผลทดสอบเดิม. บัญชี [feature matrix](clinic-full-feature-matrix-th.md) มี ID `CF-001–218`: 148 แถวเดิมที่เพิ่ม ID และ 70 แถวย่อยใหม่, ครอบคลุม 7 ส่วนของ HL7 EHR-S FM เป็นกรอบ gap audit. Applicability ต่อคลินิกเป้าหมายยังไม่ยืนยันทุกแถว; pilot N/A ของบริการเฉพาะไม่ใช่คำตัดสินว่าคลินิกจริงไม่ใช้. [Backlog](clinic-full-backlog-th.md) แยก G/D/C/I/E/S/X ตาม dependency และ decision เรื่อง EMR ยัง Pending.

### ข้อบกพร่องและการแก้

`clinicBootstrap()` คืน clinician/nurse directory ให้ CASHIER ซึ่งใช้เพียง billing worklist และคืน directory ให้ผู้ที่ยังมี general RBAC แต่ clinic role ถูกถอนแล้ว. ก่อนแก้ DB regression ล้มเพราะ cashier ได้รายชื่อบุคลากร. หลังแก้ service ตรวจ active clinic role ก่อนคืน bootstrap, ส่งรายชื่อผู้ตรวจให้ REGISTRAR/CLINICIAN, ส่งรายชื่อพยาบาลให้ CLINICIAN, ส่ง directory ผู้ใช้/staff ให้ Administrator ที่ REST ตรวจแล้วเท่านั้น, และ audit การอ่าน bootstrap. Test ครอบ cashier, nurse, clinician, admin-only และ revoked role. คู่มือคลินิกไทย/อังกฤษและ data-flow map อธิบาย boundary นี้.

### หลักฐานที่รันในรอบขยาย

| การตรวจ | ผล | ขอบเขต |
| --- | --- | --- |
| Disposable PostgreSQL 16 บน `127.0.0.1:5544/clinic_pilot_test` | base fixture + migrations `10.141`–`10.143` apply/reapply ผ่าน; `db clinic-pilot-access` 1/1 และ `db clinic-pilot` 4/4 ผ่าน | tenant/RLS/constraint/concurrency/role/attachment/immutable note บน fixture ขนาดเล็ก ไม่ใช่ restored BMS schema |
| `apps/web npm run gate` | release check, regression inventory, typecheck, pure 4,018 (ผ่าน 4,012, ข้าม 6), production build ผ่าน | DB-free gate; build ระบุ route `/admin/clinic` และ `/admin/manual/clinic` |
| `apps/desktop npm run lint` และ `npm run test -- --runInBand` | ผ่าน; 178/178 tests | code-level shell/print/connection/route; ไม่ใช่เครื่องพิมพ์จริง |
| `apps/mobile npm run typecheck` และ `npm test -- --runInBand --silent` | ผ่าน; 66 suites, 520/520 tests | code-level POS/order/payment/print/realtime; ไม่ใช่อุปกรณ์จริง |
| Browser local production build 1440×900 และ 390×844 | `/admin/clinic` และ `/admin/manual/clinic` redirect ไป login พร้อม `next` ถูกต้อง; login layout แสดงได้ทั้งสองขนาด | ไม่มีบัญชี authenticated ทดสอบ จึงไม่ได้เห็นหน้า clinic/manual หรือ cashier-only flow หลัง login |

ยังไม่มี restored BMS schema, full payment/refund/reconciliation, restore รวมไฟล์/ลายเซ็น/audit, runtime data-lineage, browser ตามบทบาท หรือการรับรองจากวิชาชีพ/privacy/บัญชี. Feature flag ยังคงปิดเป็นค่าเริ่มต้นและไม่ deploy.

## รอบ release gates บน branch ใหม่

Branch `codex/clinic-outpatient-release-gates` เริ่มจาก `c03fc80e` ที่สะอาด. ใช้เฉพาะข้อมูลสังเคราะห์และ PostgreSQL 16 throwaway ที่ `127.0.0.1:5544/clinic_pilot_test`. ไม่มี restored BMS schema ที่ปลอดข้อมูลจริงใน workspace; `db/migrations` สร้างฐาน BMS เต็มจากศูนย์ไม่ได้ตาม [runbook](../architecture/realtime-test-database.md). ตารางนี้บันทึก **workflow ที่ตรวจในรอบนี้**; [matrix CF-001–218](clinic-full-feature-matrix-th.md) ยังเป็น inventory หลักและ applicability ของคลินิกเป้าหมายทุกแถวยังรอยืนยัน.

ตรวจความครบของ ID ใน matrix รอบนี้พบ 218 แถวไม่ซ้ำและไม่มี ID ขาด. ใน CF-001–103 มีสถานะ `pilot` 14, `บางส่วน` 37, `ฐาน` 8 และ `ไม่มี` 44 ตามคำจำกัดความของ matrix; CF-104–218 ใช้คอลัมน์สถานะคนละรูปแบบ จึงไม่รวมเป็นตัวเลข implemented เดียว. ไม่มีแถวใดได้รับการยืนยัน applicability หรือ N/A สำหรับคลินิกเป้าหมายจากเจ้าของคลินิก. รอบนี้เพิ่มหลักฐานทดสอบที่ CF-019, 024, 065, 081; แถวอื่นอ้างหลักฐานเดิมตามที่บันทึกไว้ ไม่ถือว่ารันใหม่ครบ 218 workflow.

| ID / applicability เป้าหมาย | Expected behavior | Code path / source of truth | Role / audit | Test ที่มีและหลักฐานรอบนี้ | DB / browser / อุปกรณ์ | ผลและช่องว่าง | ผู้ตรวจรับ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CF-019, CF-024 / ยังไม่ทราบ | CHECK_IN/CANCEL/NO_SHOW retry สถานะเดิมไม่เขียนซ้ำ; transition อื่น conflict | `clinic/appointments.ts`; `bms_clinic_appointments` | `clinic.appointment.manage` + active REGISTRAR/CLINICIAN; audit เฉพาะ transition แรก | เพิ่ม DB test ให้แดง `INVALID_APPOINTMENT_STATE` ก่อนแก้; หลังแก้ `db clinic-pilot-calendar` ผ่าน 1/1 และ `db clinic-pilot` 4/4 | fixture ผ่าน; browser หลัง login/อุปกรณ์ยังไม่ได้ตรวจ | แก้ retry เฉพาะสาม transition; lost response/load บน schema เต็มยังไม่พิสูจน์ | engineering/registrar ยังไม่ลงนาม |
| CF-065, CF-081 / ยังไม่ทราบ | เฉพาะ active CASHIER อ่าน charge sheet; ผู้ตรวจ/admin ไม่มีบทบาท/ผู้ถูกถอน/ต่าง tenant ถูกปฏิเสธ | `clinic/billing.ts`, REST `chargeSheet`; `bms_clinic_charge_sheets/lines` | `clinic.billing.manage` + active CASHIER; success read audit | เพิ่ม DB test ให้แดงเพราะ CLINICIAN อ่านได้ก่อนแก้; หลังแก้ `db clinic-pilot-access` ผ่าน 1/1 | fixture ผ่าน; browser role matrix ยังไม่ได้ตรวจ | แก้ service; denied-read audit และ full schema ยังเปิด | security/accounting ยังไม่ลงนาม |
| CF-057–060, CF-083 / ยังไม่ทราบ | ไฟล์ผ่าน route เฉพาะ, clinician/nurse ตาม care relationship; emergency grant ไม่เปิดไฟล์ | `clinic/attachments.ts`, `attachments/route.ts`; `bms_clinic_attachments` | `clinic.record.read/write` + active role/care team; read/write audit | DB suite รอบนี้ตรวจ role/tenant/revoke/expiry/file denial ผ่าน | fixture ผ่าน; generic route ตรวจ code path; browser/restore ยังไม่ได้ตรวจ | ไม่มี `bms_clinic_*` ใน generic `files` store; malware/restore ยังเปิด | security/privacy ยังไม่ลงนาม |
| CF-008, CF-081 / ยังไม่ทราบ | patient/encounter แยก tenant, role และ care relationship; signed note immutable | `clinic/patients.ts`, `encounters.ts`, migrations `10.141–10.143`; `bms_clinic_*` | RBAC + active role; audit ที่ service | `db clinic-pilot` ผ่าน 4/4 หลัง apply/reapply migrations รอบนี้ | fixture ผ่าน; restored schema/browser ยังไม่ได้ตรวจ | fixture พิสูจน์ constraint/RLS บางเส้นทางเท่านั้น | clinical/privacy ยังไม่ลงนาม |
| CF-066, CF-068–070, CF-190–191 / ยังไม่ทราบ | reviewed charge→order→payment/refund/reconcile atomic และ retry ไม่ซ้ำ | `clinic/billing.ts`→`orders.ts`/`payments.ts`; BMS commerce | cashier/payment permissions; audit transaction | มี pure contracts เดิม; รอบนี้ตรวจ code path แต่ไม่มี full-schema execution | ไม่มี restored BMS schema/browser/อุปกรณ์ | **ยังไม่พิสูจน์ end-to-end**; G01–G03 เปิด | accounting/engineering ยังไม่ลงนาม |
| CF-084, CF-088, CF-194–195, CF-198, CF-205 / ยังไม่ทราบ | clinical prose ไม่เข้า commerce/AI/CRM/log/report; denied read ตรวจย้อนหลังได้ | clinic read/billing/AI catalog/realtime/generic files; source ตาม entity | data minimization + audit/read denial | fixture ใส่ synthetic chart sentinel แล้วไม่พบใน charge-sheet read; code path ไม่พบ clinic tool หรือ realtime payload | ตรวจเฉพาะ billing read บน fixture; sink อื่นยังไม่ได้ทดสอบ runtime | **partial evidence**; denied-read audit และ sentinel ทุก sink ยังเปิด | security/privacy ยังไม่ลงนาม |
| CF-087, CF-101 / ยังไม่ทราบ | restore รวม note/file/audit/permission; clinic/manual ใช้ได้สองขนาดจอ | DB backup, `/admin/clinic`, `/admin/manual/clinic` | ops/QA ตามหน้าที่ | ยังไม่มี full-schema restore หรือ authenticated test accounts; browser สองขนาดตรวจ redirect ไป login | fixture ไม่แทน restore; browser หลัง login/อุปกรณ์ยังไม่ได้ตรวจ | G04/G06 เปิด | ops/QA ยังไม่ลงนาม |

### ผลทดสอบรอบ release gates นี้

- Fixture PostgreSQL 16 ใช้ข้อมูลสังเคราะห์เท่านั้น: apply/reapply migrations `10.141`–`10.143` ผ่าน; `node scripts/run-contract-tests.mjs db clinic-pilot` ผ่าน 4/4. Audit ใน test service ใหม่ใช้ mock จึงยังไม่พิสูจน์ audit ที่ persist ใน BMS schema เต็ม.
- `node scripts/run-contract-tests.mjs pure clinic-pilot` ผ่าน 9/9; `apps/web npm run gate` ผ่าน โดย pure tests 4,012 ผ่าน, 6 ข้าม, 0 ไม่ผ่าน จาก 4,018 และ production build ผ่าน.
- `apps/desktop npm run lint` ผ่าน; `npm test` ผ่าน 178/178. `apps/mobile npm run typecheck` ผ่าน; `npm test -- --runInBand` ผ่าน 66 suites, 520/520 tests. ไม่มีการทดสอบเครื่อง POS หรือเครื่องพิมพ์จริง.
- Browser บน local production build: 1440×900 และ 390×844 เปิด `/admin/clinic` กับ `/admin/manual/clinic` แล้ว redirect ไป `/admin/login?next=...` ถูกต้องทั้งคู่; login ไม่มี horizontal overflow ในสองขนาด. ไม่มีบัญชี authenticated จึงไม่ได้ตรวจหน้า clinic/manual หลัง login, cashier-only flow หรือ error state ตามบทบาท.
- ตรวจ code path ของ AI tool catalog, generic file route, realtime payload และ mobile incoming orders; synthetic chart sentinel พิสูจน์เฉพาะว่าไม่อยู่ใน charge-sheet read. ยังไม่ได้ฉีด sentinel ผ่าน CRM/Inbox/customer chat/marketing/search/report/print/log runtime.

**แยกผล:** ข้อบกพร่องที่แก้ในรอบนี้คือ charge-sheet read ที่กว้างเกินและ appointment transition retry ที่ปฏิเสธผลสำเร็จเดิม. Clinical orders, dispensing, longitudinal chart และ integration ยังอยู่นอก technical pilot หรือขึ้นกับ EMR decision. Release gates เรื่อง restored schema, การเงินครบวงจร, denied audit, runtime data lineage, backup/restore, browser หลัง login, อุปกรณ์ และการตรวจรับคนยังเปิด. Feature flag ปิดค่าเริ่มต้น; ไม่มีการใช้ข้อมูลจริง, merge หรือ deploy.
