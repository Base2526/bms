# แผนที่การไหลของข้อมูลคลินิกผู้ป่วยนอก (technical pilot)

สถานะ 26 พฤศจิกายน 2026: ตรวจจาก code path ของ branch `codex/clinic-outpatient-phase1` และการทดสอบด้วยข้อมูลสังเคราะห์เท่านั้น. ไม่ใช่การรับรอง privacy/retention, backup หรือ production deployment. Feature flag ปิดเป็นค่าเริ่มต้น.

| จุดข้อมูล / เส้นทาง | ข้อมูลที่ผ่านและตัวควบคุมในโค้ด | หลักฐานและช่องว่าง |
| --- | --- | --- |
| ฐานข้อมูลคลินิก | `bms_clinic_patients`, appointments, encounters, signed notes, attachments, charge sheets แยกจาก `bms_customers`; tenant FK, FORCE RLS, `bms_app` grants ใน `10.141`–`10.143` | Migration/role tests บน fixture สังเคราะห์ผ่าน; ยังต้องทดสอบบน restored BMS schema และ backup/restore |
| Web API | `/api/bms/clinic` รับ session tenant/actor, ตรวจ RBAC ราย action และ clinic role/care relationship ใน service; `/api/bms/clinic/attachments` ตรวจสิทธิ์อ่าน/เขียนและคืน no-store | REST/DB contract ตรวจ denial และ tenant; browser หลังล็อกอินตามบทบาทยังไม่มีบัญชีทดสอบ |
| Staff bootstrap | `clinicBootstrap()` อ่าน active clinic role ก่อนคืนรายชื่อ: registrar เห็นผู้ตรวจสำหรับนัด, clinician เห็นผู้ตรวจ/พยาบาลสำหรับการมอบหมาย, nurse/cashier ไม่รับ directory; Administrator ที่ REST ยืนยันเท่านั้นจึงรับ users/staff สำหรับจัดการ | DB fixture test ผ่านสำหรับ cashier, nurse, clinician, admin-only, revoked role และ read audit; ยังต้องตรวจ browser หลัง login และ restored BMS schema |
| ไฟล์สุขภาพ | bytes อยู่ใน `bms_clinic_attachments` และอ่านผ่าน route เฉพาะ; ไม่สร้าง row ใน `files` สำหรับ generic download | DB contract ตรวจเดา ID, tenant, role revocation และ emergency access ไม่เปิดไฟล์; ยังไม่ตรวจ malware scanning, key management และ restore |
| Order/payment | `billing.ts` จำกัดการอ่าน charge sheet ให้ active CASHIER; ส่งไป `createOrderInTx()` เฉพาะ SKU, size, quantity ของบริการที่ทบทวน; `bms_orders`/payment ใช้บริการการค้าเดิม | DB fixture ตรวจ cashier/clinician/admin/revoked denial และ chart sentinel ไม่อยู่ในผล read charge sheet; ยังไม่ได้พิสูจน์ order, payment, receipt, refund, reconciliation และรายงานบน restored schema |
| Audit/security event/log | `auditClinicWrite()` เก็บ action, ID และ metadata ที่จำกัด; `auditClinicRead()` เก็บ target/patient ID ใน `bms_security_events`; adapter ตอบ error code แทนข้อความ exception | Contract ตรวจ metadata ที่ไม่ใส่เนื้อหาไฟล์; ยังต้องตรวจ audit store, log pipeline, retention และการค้นเหตุการณ์ในสภาพแวดล้อมครบ |
| CRM, Inbox, marketing, AI | ไม่พบการอ้าง `bms_clinic_*` ใน AI tool catalog หรือ adapter ทั่วไป; clinic service ไม่เขียน CRM/Inbox | เป็น code-path review ไม่ใช่ runtime data-lineage proof; ต้องทดสอบ export/report/support ที่ครบด้วยข้อมูลสังเคราะห์ |
| Realtime, desktop, mobile | `bms_clinic_*` ถูกจัดเป็น private/no realtime payload; desktop จำกัด POS shell; mobile ใช้ POS/restaurant GraphQL ที่ไม่ได้รับ chart payload | Code/contract review เท่านั้น; ต้องตรวจเครื่องจริงและ print/receipt รวมถึงกรณี order ช่องทาง clinic |
| Appointment transition retry | `appointments.ts` ล็อกแถวก่อน CHECK_IN/CANCEL/NO_SHOW; คำขอซ้ำที่พบสถานะปลายทางเดิมคืนสำเร็จโดยไม่เขียนหรือ audit ซ้ำ; สถานะอื่นถูกปฏิเสธ | DB fixture ตรวจทั้งสาม transition และ conflict; ยังต้องทดสอบ lost response/load/browser บน schema เต็ม |
| Support/impersonation | clinic API ยังใช้ session tenant, RBAC และ active clinic role/care relationship; ไม่มีทางลัดให้ Administrator อ่าน chart ตาม service. `10.143` ให้ clinician ถอน emergency grant ของตนเองโดยย่น expiry และ audit ใน transaction | ต้องทดสอบ support drill-down/impersonation, การถอนสิทธิ์ระหว่างคำขอ และ incident access ด้วยบัญชีทดสอบจริง |
| Export, backup, data subject request | pilot ไม่มี clinical export/print ทั่วไป; ไม่มี retention, legal hold หรือ delete policy ที่อนุมัติ | ให้ผู้รับผิดชอบข้อมูลส่วนบุคคลกำหนดฐานประมวลผล ระยะเก็บรักษา สิทธิ์ผู้ป่วย การลบ/ระงับ และ restore ก่อนเพิ่ม policy ในโค้ด |

## Boundary เมื่อเลือกเจ้าของเวชระเบียน

สถานะ [decision](clinic-emr-architecture-decision-th.md) ยัง **Pending**. ถ้า EMR/HIS เดิมเป็นเจ้าของ patient/visit/note/result ให้ BMS รับเฉพาะ opaque reference และ approved charge หรือ stock event ผ่าน authenticated inbox หลัง human reconciliation; ห้ามมี chart สองชุดที่แก้ได้. ถ้า BMS เป็นเจ้าของ ให้ clinical event, signed record และไฟล์อยู่หลัง clinic service/route/role เฉพาะ แล้วส่งเฉพาะ approved service code, quantity และราคา/ภาษีที่ตรวจแล้วไป commerce. ทั้งสองทางต้องเลือก owner ของ appointment, dispense และ stock อย่างชัดก่อนเชื่อม; payment/refund ไม่แก้ clinical record โดยอัตโนมัติ. ดู owner ราย entity และคำถามที่ค้างใน decision.

## จุดที่ต้องตัดสินใจก่อนออกแบบต่อ

- คลินิกเป้าหมายมี EMR เดิมหรือไม่ และระบบใดเป็นเจ้าของ patient/visit/เวชระเบียน. คำตอบยังไม่ทราบ.
- ผู้ประกอบวิชาชีพและฝ่ายเวชระเบียนกำหนด field, สิทธิ์แต่ละวิชาชีพ, การลงนาม, การแก้ไข และหลักฐานใบอนุญาต.
- ฝ่ายข้อมูลส่วนบุคคลอนุมัติ data flow จริง, lawful basis, การเปิดเผย, retention/legal hold, backup/restore และ incident response.
- ฝ่ายบัญชี/ภาษียืนยันรายการบริการ, VAT, ใบเสร็จ/ใบกำกับ, การชำระบางส่วนและการคืนเงิน.

หากใช้ EMR เดิม ให้เสนอ contract ที่ส่งเพียง external visit reference และรายการค่าบริการที่ทบทวนแล้วมายัง BMS โดยไม่คัดลอกอาการ วินิจฉัย หรือข้อความเวชระเบียนเข้า order/CRM/Inbox. หาก BMS เป็นเจ้าของ EMR ให้ใช้ pilot เป็นฐานหลังผู้รับผิดชอบตรวจข้อกำหนดข้างต้น.
