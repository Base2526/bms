# บัญชีฟีเจอร์คลินิกผู้ป่วยนอกทั้งระบบ

สถานะการตรวจ: 26 พฤศจิกายน 2026; inventory เริ่มจาก branch `codex/clinic-outpatient-phase1` และเพิ่มหลักฐานรอบ `codex/clinic-outpatient-release-gates` ใน [ผลตรวจรับ](clinic-phase1-acceptance-2026-11-26-th.md). นี่คือ inventory จาก code path ใน repo ไม่ใช่คำรับรองให้ใช้ข้อมูลผู้ป่วยจริง. `BMS_CLINIC_PILOT_TENANTS` ยังปิดเป็นค่าเริ่มต้น. ผลรอบก่อนเป็นหลักฐานย้อนหลัง; รอบ release gates ทดสอบ DB fixture เพิ่ม แต่ยังไม่มี restored BMS schema หรือ browser ที่ login ตามบทบาท.

## วิธีอ่าน

- **ทั่วไป** = ต้องกำหนดก่อนนำระบบไปใช้คลินิกผู้ป่วยนอกทั่วไป; **ตามบริการ** = ทำเมื่อคลินิกให้บริการนั้น; **เสริม** = ต้องตัดสินตามรูปแบบปฏิบัติงาน. ความจำเป็นไม่ใช่คำวินิจฉัยกฎหมาย.
- **พิสูจน์แล้ว** หมายถึง path ที่ระบุผ่านการทดสอบตามขอบเขตหลักฐานเท่านั้น; ไม่มี workflow คลินิกใดพิสูจน์ production readiness. **ฐาน** = BMS มีระบบธุรกิจ แต่ยังไม่ผูกกับคลินิก; **pilot** = มี path คลินิกที่ปิด flag; **บางส่วน** = มีชิ้นส่วนแต่ยังไม่ครบ workflow; **ไม่มี** = ไม่พบ path คลินิกในชุดไฟล์ที่ตรวจ.
- รหัสหลักฐาน: `C` = `apps/web/lib/bms/clinic/`; `R` = `apps/web/app/api/bms/clinic/route.ts` และ `attachments/route.ts`; `U` = `apps/web/app/(admin)/admin/clinic/page.tsx`; `M` = `db/migrations/10.141__bms_clinic_outpatient_pilot.sql`, `10.142__bms_clinic_reschedule_idempotency.sql`, `10.143__bms_clinic_emergency_access_revocation.sql`; `T` = `scripts/clinic-pilot-*.test.mts`; `O` = `apps/web/lib/bms/orders.ts`; `P` = `apps/web/lib/bms/payments.ts`; `S` = `apps/web/lib/bms/stock.ts`, `stockTransfers.ts`, `stockCounts.ts`; `Q` = `apps/web/lib/bms/permissions.ts`; `G` = `apps/web/graphql/`, `schema.graphql`, `apps/mobile/`, `apps/desktop/`; `A` = `apps/web/lib/bms/tools/catalog.ts`, `packages/realtime/src/events.ts`. เมื่อระบุ `ไม่มี C/R/U/M/T` หมายถึงการสำรวจ path เหล่านี้ ไม่ใช่การพิสูจน์ว่าไม่มีโค้ดที่อื่นใน repo.
- เกณฑ์รับมอบทุกแถวต้องใช้ข้อมูลสังเคราะห์, tenant/role denial และ audit ตามความเสี่ยง. งานที่แตะการรักษาต้องมีผู้ประกอบวิชาชีพตรวจรับ; ข้อกำหนดข้อมูลส่วนบุคคลและภาษีต้องมีเจ้าของเรื่องยืนยันก่อนเปิดจริง.
- `CF-001` เป็นต้นไปคือ ID คงที่ของแถว ไม่ใช่ลำดับความสำคัญ. **หลักฐานโค้ด** ≠ **test ผ่าน** ≠ **restored DB ผ่าน** ≠ **browser หลัง login ผ่าน** ≠ **ผู้ประกอบวิชาชีพรับรอง**. หากหลักฐานไม่ระบุชั้นใด ให้ถือว่ายังไม่พิสูจน์ชั้นนั้น. สถานะ N/A ของ pilot ไม่ใช่คำตัดสินว่าคลินิกเป้าหมายไม่ใช้บริการ; ต้องบันทึกผู้ยืนยันและวันที่ก่อนตัดออก.

## Crosswalk กับ HL7 EHR-S Functional Model 2.1.1

ใช้ [HL7 EHR-S FM R2.1.1 ฉบับ Normative](https://hl7.org/ehrs/uv/ehrsfmr2/Normative1/en/chapter4.html) เป็น **กรอบถามช่องว่าง** เท่านั้น. หมวด HL7 ซ้อนทับกันได้; แถวนี้ไม่ใช่การแมป conformance criteria รายข้อและไม่กล่าวอ้างว่า BMS ผ่านการรับรอง HL7. ต้องเลือก functional profile ตามบริการจริงก่อนจะใช้เกณฑ์มาตรฐานเป็นข้อกำหนดของผลิตภัณฑ์.

| ส่วน HL7 | หมวดในบัญชีนี้ | ประเด็นตรวจเพิ่ม |
| --- | --- | --- |
| Overarching | CF-080–087, CF-098–102, CF-198–211 | ความครบทั้งระบบ, การใช้งานร่วมกัน, สำรองและกู้คืน, การช่วยผู้ใช้ |
| Care Provision | CF-007–059, CF-155–188, CF-212–218 | ตัวตนผู้ป่วย, ข้อมูลต่อเนื่อง, visit, order, ผล, ยา, หัตถการ, ส่งต่อ |
| Care Provision Support | CF-001–006, CF-070–079, CF-149–154, CF-192–195, CF-203–204 | ทรัพยากร, ตาราง, คำศัพท์, คลัง, เอกสาร, งานสนับสนุนผู้รักษา |
| Administrative Support | CF-001–026, CF-060–069, CF-088–092, CF-149–164, CF-189–191 | ทะเบียน, นัด/คิว, บริการและราคา, การเงิน, รายงานปฏิบัติการ |
| Population Health Support | CF-088–092, CF-196, CF-205–206 และบริการเฉพาะที่เกี่ยวข้อง | งานป้องกันและรายงานระดับกลุ่มเฉพาะเมื่อมีขอบเขต/ฐานข้อมูลที่ได้รับอนุมัติ |
| Record Infrastructure | CF-007–012, CF-033–059, CF-093–097, CF-156–159, CF-168–169, CF-187–188, CF-200–204 | แหล่งข้อมูลจริง, version, amendment, archive/restore, แลกเปลี่ยนข้อมูล |
| Trust Infrastructure | CF-080–087, CF-093–102, CF-155–159, CF-188, CF-194–202, CF-207–211 | identity, authorization, audit, privacy, file, vendor, incident, ความต่อเนื่อง |

## แหล่งข้อกำหนดไทยที่ตรวจในรอบนี้

| ข้อที่พบจากแหล่งทางการ | การตีความที่ยังต้องยืนยัน | แนวทางออกแบบที่ยังไม่ใช่ข้อกฎหมาย |
| --- | --- | --- |
| [กรมสนับสนุนบริการสุขภาพ: พ.ร.บ.สถานพยาบาลและกฎกระทรวงลักษณะสถานพยาบาล](https://law.hss.moph.go.th/laws/) ระบุกรอบใบอนุญาตและประเภทบริการ | เจ้าของคลินิกต้องส่งประเภท/สาขา/บริการ/ใบอนุญาตจริงให้ผู้รับผิดชอบกฎหมายและวิชาชีพตรวจว่าฉบับใดใช้ | ทำทะเบียนหลักฐานและวันมีผลแยกจาก role ของซอฟต์แวร์; ยังไม่ hardcode รูปแบบหรืออายุใบอนุญาต |
| [พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562](https://www.ccit.go.th/pdpa/document/law_pdpa_2562.pdf) มาตรา 26 ระบุข้อมูลสุขภาพเป็นข้อมูลที่ต้องจัดการตามเงื่อนไขเฉพาะ; มาตรา 37 และ 39 กล่าวถึงมาตรการ/บันทึกรายการ | เจ้าของข้อมูลและที่ปรึกษากฎหมายต้องกำหนดฐานประมวลผล, ผู้ควบคุม/ผู้ประมวลผล, retention, สิทธิผู้ป่วย, เหตุละเมิด และ vendor ตามข้อเท็จจริง | แยก chart จาก CRM/POS/AI, จำกัดสิทธิ์และ payload, เก็บ provenance/audit; ยังไม่กำหนดระยะเก็บหรือแบบ consent เอง |
| [กรมสรรพากร: ประมวลรัษฎากร มาตรา 81](https://rd.go.th/5206.html) กล่าวถึงการยกเว้น VAT ของบริการรักษาพยาบาลโดยสถานพยาบาลตามกฎหมาย | ฝ่ายบัญชี/ภาษีต้องตัดสิน **รายบริการและผู้ประกอบการ** ว่าข้อยกเว้นและเอกสารใดใช้; `VAT N` ใน pilot เป็นข้อจำกัดทางเทคนิค ไม่ใช่คำวินิจฉัยภาษี | ห้ามขยาย catalog/ภาษีคลินิกจาก SKU pilot โดยไม่ตรวจราคา/ประเภทบริการ/ใบอนุญาต |

ยังไม่ทราบชนิดคลินิกและบริการจริง จึงยังตรวจข้อกำหนดเฉพาะทันตกรรม วัคซีน แล็บ ภาพวินิจฉัย telemedicine และอื่น ๆ ให้ครบตามข้อเท็จจริงไม่ได้. บันทึก applicability และผู้ยืนยันใน backlog ก่อนเพิ่ม schema หรือประกาศว่า compliant.

## แหล่งข้อมูลจริงและสิทธิ์ขั้นต่ำของแถวเดิม

แถว `CF-001–148` ระบุผู้ใช้/สถานะ/หลักฐาน/ช่องว่าง/เกณฑ์ทดสอบไว้ในตารางเดิม. ตารางนี้เติม **source of truth ที่เสนอ** และ **สิทธิ์/audit ที่ต้องพิสูจน์** ตามกลุ่มแถว; ถ้าคลินิกเลือกทาง A หรือ B เจ้าของ entity ต้องยืนยันตาม [architecture decision](clinic-emr-architecture-decision-th.md). ข้อความในตารางนี้เป็น acceptance requirement ไม่ใช่คำยืนยันว่าโค้ดปัจจุบันทำครบ. การอ่านข้อมูลสุขภาพต้องตรวจ active role/care relationship และบันทึก audit; การเขียนต้องมี actor, tenant, branch, version และ audit ใน transaction ตามประเภทงาน.

| แถว | Source of truth ที่เสนอ | สิทธิ์และ audit ที่ต้องพิสูจน์ |
| --- | --- | --- |
| CF-001–007 | ทะเบียนสถานพยาบาล/บุคลากรที่ผู้รับผิดชอบอนุมัติ; catalog/price BMS สำหรับค่าบริการ | ผู้ดูแล/ผู้จัดตาราง/บัญชีตามหน้าที่; audit อนุมัติสถานะ, เวรและราคา; ผู้ป่วยเห็นเฉพาะราคาเผยแพร่ |
| CF-008–013 | patient master ของ A หรือ B; CRM และ payer แยก | registrar/identity steward; audit ค้น/แก้/merge/import/ผู้แทน; contact ไม่ให้สิทธิ์ chart |
| CF-014–021 | scheduling owner ที่เลือก; slot/resource/appointment version | registrar/ผู้จัดตาราง; audit จอง/เลื่อน/ยกเลิก/แจ้ง; verified contact ก่อนส่ง |
| CF-022–027 | visit/queue ของ A หรือ B; payer verification แยก | registrar/nurse/clinician ตาม step; audit ตรวจตัวตน/handoff/transition/owner |
| CF-028–033 | longitudinal chart ของ A หรือ B | care team ตาม scope; audit อ่าน/แก้/reconcile/provenance; ผู้ป่วยแจ้งเองต้องแยกสถานะ |
| CF-034–042 | encounter/note/signed revision ของ A หรือ B | clinician/nurse ตาม scope; audit อ่าน/draft/sign/addendum/correction; signed copy immutable |
| CF-043–046 | clinical order owner ของ A หรือ B | ผู้สั่ง/ผู้รับ/ผู้ทำตามวิชาชีพ; audit order/cancel/override; ไม่สร้าง charge/stock จาก plan |
| CF-047–052 | dispense/administration event ของ A หรือ B; stock ledger ของระบบที่เลือก | ผู้มีหน้าที่จ่าย/ให้; audit identity/lot/action/reversal; stock movement atomic |
| CF-053–056 | result owner ของ A หรือ B/LIS/PACS ตาม contract | lab/interpreter/care team; audit specimen/result/correction/critical ack |
| CF-057–060 | clinical document/file owner ของ A หรือ B | ผู้ลงนาม/ผู้รับที่ได้รับสิทธิ์; audit read/print/export/reissue; generic file route ห้าม bypass |
| CF-061–064 | approved service catalog/price BMS หลังบัญชีรับรอง | บัญชีอนุมัติราคา/ภาษี; audit publish/change; ราคา effective snapshot |
| CF-065–070 | BMS charge/order/payment/refund/AR | cashier/ผู้อนุมัติแยกตาม action; audit submit/confirm/void/refund และ reconciliation |
| CF-071–075 | stock/lot ledger ของระบบที่เลือก | stock owner/ผู้จ่ายตามหน้าที่; audit receive/transfer/hold/recall; movement ใน transaction |
| CF-076–080 | verified channel/communication policy; chart owner เก็บคำแนะนำคลินิก | staff/patient ตามสิทธิ์; audit disclosure/consent/opt-out; ห้าม chart เข้า marketing |
| CF-081–088 | identity/access/audit store และ archive owner ที่ privacy อนุมัติ | RBAC + active clinic role + care relationship; audit read/denial/emergency/export/restore |
| CF-089–093 | clinical source สำหรับรายงานรักษา; BMS commerce สำหรับรายงานการค้า | manager ตามข้อมูลที่จำเป็น; bounded read/export audit; ห้าม cross-domain PHI leakage |
| CF-094–098 | contract/inbox/outbox ที่เลือกหลัง D01 | source auth, tenant mapping ฝั่ง server; audit import/reconcile/duplicate/retry |
| CF-099–103 | operational evidence/backup ของ clinic/ops owner | ops/QA ตามหน้าที่; audit restore/downtime/import; ทดสอบเครื่องจริง |
| CF-104–148 | entity owner ตามชนิดบริการและ A/B; ต้องยืนยัน applicability ก่อนสร้าง | วิชาชีพเฉพาะและ privacy/accounting ตามข้อมูล; audit clinical action, charge และ disclosure แยกกัน |

| ID | ฟีเจอร์ / ผู้ใช้หลัก | ชั้น | สถานะ | หลักฐาน | ช่องว่าง / dependency / ความเสี่ยง | เกณฑ์รับมอบที่ทดสอบได้ |
| --- | --- | --- | --- | --- | --- | --- |
| | **1. สถานพยาบาลและบุคลากร** | | | | | |
| CF-001 | สถานพยาบาลและสาขา / ผู้ดูแล | ทั่วไป | บางส่วน | C/access.ts; M; R/U | pilot จำกัดหนึ่ง active branch; ข้อมูลใบอนุญาตสถานพยาบาลยังไม่เป็นทะเบียนคลินิก | เลือกสาขาจาก server; ปฏิเสธสาขาอื่นและทดสอบการเปลี่ยนสาขา |
| CF-002 | ประเภทบริการ / ผู้ดูแล | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T | ต้องให้เจ้าของคลินิกระบุประเภทที่เปิดจริง | ประเภทบริการกำหนด workflow และ permission โดยไม่เปิดฟีเจอร์ที่ไม่เกี่ยว |
| CF-003 | ห้องตรวจและทรัพยากร / ผู้จัดตาราง | ทั่วไป | บางส่วน | C/appointments.ts; M exclusion | มี room code กันซ้อน แต่ไม่มีทะเบียนห้อง/อุปกรณ์ | จองห้องหรืออุปกรณ์ชนกันพร้อมกันได้หนึ่งรายการเท่านั้น |
| CF-004 | เวลาเปิด วันหยุด / ผู้จัดตาราง | ทั่วไป | ไม่มี | C/appointments.ts; ไม่มี M ตารางเวลา | ปฏิทินยังไม่คำนวณเวลาว่างจริง | จองนอกเวลาหรือวันหยุดถูกปฏิเสธ; timezone Asia/Bangkok |
| CF-005 | ผู้ประกอบวิชาชีพและประเภทวิชาชีพ / ผู้ดูแล | ทั่วไป | บางส่วน | C/access.ts; M staff; R/U | pilot มี CLINICIAN กับเลขใบอนุญาตที่กรอกเอง; ยังไม่ตรวจหน่วยงานออกใบอนุญาต | บทบาท/วิชาชีพ/สถานะถูกตรวจทุกคำสั่ง; เจ้าของคลินิกตรวจหลักฐาน |
| CF-006 | ตารางเวรและผู้ดูแลแทน / ผู้จัดตาราง | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T | การมี role ไม่พิสูจน์ว่าอยู่เวร | ผู้ตรวจนอกเวร/ผู้ดูแลแทนที่หมดอายุเปิด visit ไม่ได้ |
| CF-007 | รายการบริการและราคาที่ผู้ป่วยเห็น / ผู้ป่วย | ทั่วไป | ฐาน | O; catalog UI; C/billing.ts | catalog การค้าไม่ใช่รายการค่ารักษาที่อนุมัติ | หน้าเผยแพร่ราคาแสดง SKU/สาขา/เวลามีผลตามรายการที่บัญชีอนุมัติ |
| | **2. ทะเบียนผู้ป่วยและตัวตน** | | | | | |
| CF-008 | Patient UUID/HN แยก CRM / registrar | ทั่วไป | pilot | C/patients.ts; M patients/HN; R/U; T | ต้องพิสูจน์บน restored schema และกำหนด EMR เจ้าของข้อมูล | ลงทะเบียนซ้ำไม่รวม chart; tenant อื่นอ่าน HN ไม่ได้ |
| CF-009 | ข้อมูลระบุตัวและติดต่อ / registrar | ทั่วไป | บางส่วน | C/patients.ts register/verified contact; M patients/contacts; R/U; T | ยังไม่มี API แก้ patient profile หรือ revision ที่พิสูจน์ได้; วิธีพิสูจน์ตัวตนต้องอนุมัติ | แก้ข้อมูลได้เฉพาะ role และมี revision/audit ที่อ่านย้อนหลังได้ |
| CF-010 | ค้นชื่อซ้ำและตรวจคนก่อนรวม / registrar | ทั่วไป | บางส่วน | C/patients.ts search/register; R/U | ชื่อ/เบอร์ซ้ำไม่ merge; ยังไม่มี workflow ตรวจ duplicate อย่างเป็นทางการ | ผลค้น bounded; ข้อมูลเหมือนกันไม่รวมอัตโนมัติ; คนอนุมัติพร้อมเหตุผล |
| CF-011 | ผู้ปกครอง/ผู้แทน/ผู้ติดต่อ / registrar | ทั่วไป | บางส่วน | C/patients.ts verified contact; M | contact ไม่ใช่สิทธิ์อ่าน chart; ต้องกำหนดหลักฐานความสัมพันธ์ | ผู้ติดต่อที่ไม่มีสิทธิ์เปิดข้อมูลไม่ได้; ถอนความสัมพันธ์แล้วถูกปฏิเสธ |
| CF-012 | ผู้จ่ายเงินต่างจากผู้ป่วย / cashier | ทั่วไป | ไม่มี | C/billing.ts; O/P | pilot charge sheet ไม่มี payer identity contract | ใบเรียกเก็บ/ใบเสร็จแสดงผู้จ่ายถูกคนโดยไม่เปิด chart |
| CF-013 | นำเข้าประวัติพร้อม provenance / เวชระเบียน | เสริม | ไม่มี | ไม่มี C/R/U/M/T | ต้องตัดสิน EMR และการจับคู่ตัวตนก่อน import | import ซ้ำ idempotent; ambiguous match เข้าคิวตรวจคน; provenance คงอยู่ |
| | **3. นัดหมายและตารางตรวจ** | | | | | |
| CF-014 | ตารางผู้ตรวจและช่องว่าง / registrar | ทั่วไป | บางส่วน | C/appointments.ts; M; U | มีรายการนัด ไม่ได้คำนวณ availability จากเวร/วันหยุด | แสดงเฉพาะช่วงที่เปิดจริง; จองชนและรายการถูกตัดไม่แสดงว่าโล่ง |
| CF-015 | วันหยุด ห้อง อุปกรณ์ / registrar | ทั่วไป | บางส่วน | M room exclusion; C/appointments.ts | วันหยุด/อุปกรณ์ไม่มี | ตรวจ conflict ทุก resource ใน DB เมื่อส่งพร้อมกัน |
| CF-016 | จองนัด / registrar | ทั่วไป | pilot | C/appointments.ts; R/U/M/T | ต้อง browser หลัง login และ load test | create/retry key เดิมคืนรายการเดิม; role/tenant denial |
| CF-017 | Walk-in / registrar | ทั่วไป | บางส่วน | C/appointments.ts check-in; U | ไม่มี workflow walk-in แยก | walk-in ลงทะเบียน/เช็กอินได้พร้อม audit โดยไม่สร้างเวลานัดปลอม |
| CF-018 | นัดติดตาม / clinician, registrar | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T | ยังไม่ผูกแผนติดตามกับนัด | นัดถัดไปอ้าง visit ต้นทางและเตือนงานค้างได้ |
| CF-019 | เลื่อน/ยกเลิก/no-show / registrar | ทั่วไป | pilot | C/appointments.ts; R/U; M 10.142; T calendar DB | cancel/no-show retry สถานะเดิมผ่าน fixture; ยังต้อง load/browse ร่วม flow จริง | retry เลื่อนเก่าไม่ย้อนนัดใหม่; cancel/no-show ซ้ำไม่เขียนหรือ audit ซ้ำและไม่สร้าง encounter |
| CF-020 | Waitlist / registrar | เสริม | ไม่มี | ไม่มี C/R/U/M/T | ต้องกำหนดนโยบายเลื่อนคิว | รับคนจาก waitlist เพียงหนึ่งคนเมื่อ slot ว่างพร้อมกัน |
| CF-021 | เตือนนัด/จองออนไลน์ / ผู้ป่วย | เสริม | ไม่มี | ไม่มี C/R/U/M/T; A ไม่มี clinic tool | ต้องมี verified channel/consent และขอบเขตข้อมูล | ส่งเตือนถูกคนครั้งเดียว; link หมดอายุ; ไม่มี chart ในข้อความ |
| | **4. ต้อนรับ เช็กอิน และคิว** | | | | | |
| CF-022 | ตรวจตัวตน/ผู้จ่าย/สิทธิหน้ารับบริการ / registrar | ทั่วไป | บางส่วน | C/patients.ts; C/appointments.ts | ไม่มี payer/coverage verification | check-in บันทึกผู้ตรวจหลักฐานและปฏิเสธ mismatch |
| CF-023 | แบบข้อมูลก่อนพบผู้ตรวจ / nurse | ทั่วไป | ไม่มี | C/encounters.ts draft เท่านั้น | ต้องอนุมัติฟอร์มและผู้เห็นข้อมูล | field/หน่วย/ผู้บันทึกครบและ clinician รับรองก่อนใช้ |
| CF-024 | เช็กอินและคิวรอ / registrar | ทั่วไป | บางส่วน | C/appointments.ts transition; R/U/M; T calendar DB | check-in retry สถานะเดิมผ่าน fixture; ยังไม่มี queue ordering | check-in ซ้ำไม่เขียนหรือ audit ซ้ำ; ลำดับคิวไม่เผยข้อมูลข้ามบทบาท |
| CF-025 | ส่งต่อพยาบาล/แพทย์ / registrar | ทั่วไป | บางส่วน | C/encounters.ts assignNurse; M care team | ยังไม่มี handoff state/ack | ผู้รับงานยืนยันรับ; revoked user เข้าไม่ได้ |
| CF-026 | กำลังตรวจ/เสร็จ/รอจ่ายยา/รอคิดเงิน/ปิด visit / ทีมคลินิก | ทั่วไป | บางส่วน | C/encounters.ts signed; C/billing.ts | ไม่มี visit state machine ครบ; ไม่มี dispense | ทุก transition มีผู้ทำ/เวลา; ห้ามปิดเมื่อมีงานค้างตามกติกาที่อนุมัติ |
| CF-027 | นัดถัดไปและงานติดตามค้าง / clinician | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T | ต้องแยกงานทางคลินิกจาก reminder การค้า | งานค้างมี owner/due/ack และตามย้อนหลังได้ |
| | **5. ประวัติสุขภาพต่อเนื่อง** | | | | | |
| CF-028 | โรคประจำตัว/problem list / clinician | ทั่วไป | ไม่มี | C/encounters.ts note text; ไม่มี M structured longitudinal | ต้องตัดสิน EMR; free text ใช้แทน list ไม่ได้ | version/provenance/ผู้ยืนยัน; แก้ไขไม่ลบประวัติ |
| CF-029 | แพ้ยาและยาที่ใช้อยู่ / clinician | ทั่วไป | บางส่วน | C/encounters.ts allergies/medicationPlan text | ไม่มี reconciliation หรือ structured allergy/med list | ผู้ตรวจเห็นข้อมูลล่าสุดพร้อม provenance; ทดสอบ conflict/unknown |
| CF-030 | ผ่าตัด/ครอบครัว/สังคม/วัคซีน / clinician | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T structured | ฟิลด์และสิทธิ์ขึ้นกับบริการ | ประวัติที่จำเป็นตามแบบฟอร์มถูกเก็บพร้อมผู้บันทึก/เวลา |
| CF-031 | Visit ย้อนหลัง / clinician, nurse | ทั่วไป | pilot | C/encounters.ts listClinicPatientEncounters; R/U; T | ยังไม่ได้พิสูจน์ performance/restore | care team เห็น visit ผู้ป่วยตนแบบ bounded; คนอื่นถูกปฏิเสธ |
| CF-032 | สัญญาณเตือนและแผนต่อเนื่อง / clinician | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T structured | ต้องให้ผู้ประกอบวิชาชีพนิยาม severity/owner | งานสำคัญแสดงผู้รับผิดชอบและหลักฐานการรับทราบ |
| CF-033 | แยกข้อความกับข้อมูลโครงสร้าง / clinician | ทั่วไป | บางส่วน | C/encounters.ts validateClinicRecord; M draft_record | draft JSON มี field ข้อความ; ไม่มี vital/diagnosis code model | query structured field ได้โดยไม่ parse prose; migration/test ครบ |
| | **6. EMR ต่อ visit** | | | | | |
| CF-034 | เหตุที่มา/ประวัติอาการ / clinician | ทั่วไป | pilot | C/encounters.ts chiefComplaint/history; R/U/M/T | ฟอร์มยังไม่ตรวจรับทางวิชาชีพ | ลงนามบังคับ field ที่อนุมัติและรักษา version |
| CF-035 | สัญญาณชีพพร้อมหน่วย เวลา ผู้บันทึก / nurse | ทั่วไป | บางส่วน | C/encounters.ts vitals text | ไม่มี structured unit/observation metadata | บันทึกค่า+หน่วย+เวลา+actor; ค่าผิดชนิดถูกปฏิเสธ |
| CF-036 | ตรวจร่างกาย/ประเมิน/วินิจฉัย/แผน / clinician | ทั่วไป | pilot | C/encounters.ts; R/U/M/T | เป็นข้อความ pilot; taxonomy/form ยังไม่อนุมัติ | clinician ทดสอบกรณีจริงสังเคราะห์และเซ็นแบบฟอร์ม |
| CF-037 | หัตถการที่ทำจริง / clinician | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T procedure event | plan text ไม่พิสูจน์ว่าได้ทำ | procedure event มีผู้ทำ/เวลา/ผล/วัสดุ และแยก charge |
| CF-038 | บันทึกแพทย์/พยาบาลตามบทบาท / ทีมรักษา | ทั่วไป | บางส่วน | C/access.ts role; C/encounters.ts assignNurse | ไม่มี nursing note แยก | เขียน/อ่านตาม role และ care relationship; audit ทุกการอ่าน |
| CF-039 | ฟอร์มตามประเภทคลินิก / เจ้าของคลินิก | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T | ต้องยืนยันประเภทและผู้ตรวจรับ | ฟอร์มเวอร์ชันที่อนุมัติใช้ได้ตามบริการ; เก่าอ่านได้ |
| CF-040 | Draft → signed → addendum / clinician | ทั่วไป | pilot | C/encounters.ts; M signed_notes/guard; R/U/T | restored DB และ browser ยังไม่พิสูจน์ | version conflict ไม่ทับ; signed immutable; addendum มีเหตุผล/ผู้ลงนาม/เวลา |
| CF-041 | ผู้รักษา/ผู้ลงนาม/เวลา/สรุปหลังตรวจ / clinician | ทั่วไป | บางส่วน | M encounters/signed_notes; C/encounters.ts | summary/export ยังไม่มี | เอกสารแสดง actor/time จาก server และแก้ signed copy ไม่ได้ |
| CF-042 | ผู้ประกอบวิชาชีพตรวจรับฟอร์ม/กรณีทดสอบ / clinical owner | ทั่วไป | ไม่มี | acceptance ระยะ 1 ระบุ gate | ยังไม่มีลายเซ็นการตรวจรับ | มีชุดกรณีทดสอบลงชื่ออนุมัติและ replay บนเวอร์ชันฟอร์ม |
| | **7. คำสั่งรักษา** | | | | | |
| CF-043 | คำสั่งยา / clinician | ทั่วไป | ไม่มี | C/encounters.ts medicationPlan text; ไม่มี order table | ข้อความแผนยาไม่ใช่ใบสั่ง | order มีผู้สั่ง/เวลา/status; ไม่มี stock/charge จากการสั่งอย่างเดียว |
| CF-044 | คำสั่งแล็บ/ภาพ/หัตถการ/ส่งต่อ / clinician | ตามบริการ | ไม่มี | C/encounters.ts referral text; ไม่มี order table | ต้องกำหนดบริการและปลายทาง | state transition/status/revision แยกชนิด ตรวจ role |
| CF-045 | ผู้สั่ง/ผู้รับ/ผู้ทำ/ยกเลิก/ประวัติ / ทีมรักษา | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T order lifecycle | ต้องมี audit ที่ไม่ลบหลักฐาน | cancel/reorder เก็บ provenance; retry ไม่สร้างซ้ำ |
| CF-046 | งานค้างอ่านผล/ผลสำคัญ / clinician | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T | ไม่มี result acknowledgement | ผลสำคัญถึงผู้รับผิดชอบและมี read receipt/escalation |
| | **8. จ่ายยาและรักษาจริง** | | | | | |
| CF-047 | ตรวจยาที่ใช้อยู่/ใบสั่ง/ทบทวน / เภสัชกรหรือผู้มีหน้าที่ | ตามบริการ | ไม่มี | C note text; pharmacy README เป็นงานร้านยาแยก | ต้องให้ผู้ประกอบวิชาชีพกำหนด workflow | คำสั่งและ review ถูกคน พร้อมหลักฐานก่อนจ่าย |
| CF-048 | จ่ายยาจริง / ผู้จ่ายยา | ตามบริการ | ไม่มี | ไม่มี C/M dispensing; S เป็น stock ทั่วไป | ห้ามใช้ข้อความแผนแทนจ่ายจริง | dispense event อ้าง order/patient/encounter/actor และ retry ไม่ซ้ำ |
| CF-049 | ให้ยา/ใช้วัสดุจริงพร้อมล็อต / ผู้ปฏิบัติ | ตามบริการ | ไม่มี | S; ไม่มี C/M administration | ต้องออกแบบ lot trace และ transaction | ใช้จริงตัดล็อตพร้อม movement ใน transaction เดียว; rollback ครบ |
| CF-050 | ฉลาก/คำแนะนำที่รับรอง / ผู้มีวิชาชีพ | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T | ต้องตรวจภาษากับผู้ประกอบวิชาชีพ | พิมพ์จากฉบับอนุมัติ มีผู้รับรอง/เวอร์ชัน |
| CF-051 | คืนยา/เหตุไม่พึงประสงค์/ประวัติจ่าย / ทีมรักษา | ตามบริการ | ไม่มี | O/P return เป็นการค้า; ไม่มี C event | คืนเงินไม่ใช่การคืนยาทางคลินิก | reverse มีเหตุผลและ lot trail; adverse event ติดตามได้ |
| CF-052 | แยก prescribe/dispense/administer / ทีมรักษา | ตามบริการ | ไม่มี | ไม่มี C/M event models | ความเสี่ยงตัดสต็อกก่อนจ่ายจริง | สาม event แยกกัน; สั่งอย่างเดียวไม่ตัด stock/charge |
| | **9. แล็บและภาพวินิจฉัย** | | | | | |
| CF-053 | สั่งตรวจ/สิ่งส่งตรวจ/สถานะ / clinician, lab | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T | ต้องกำหนด LIS/in-house | คำสั่งและ specimen ID มี lifecycle/idempotency |
| CF-054 | ผลตรวจ/ผู้รับรอง / lab, clinician | ตามบริการ | ไม่มี | C/attachments.ts เก็บไฟล์ได้ แต่ไม่มี result model | file ไม่ใช่ structured/validated result | ผลมีผู้รับรอง/เวลา/เวอร์ชัน; ห้ามแก้ผลที่รับรองโดยตรง |
| CF-055 | รายงาน/ภาพ/ผลสำคัญ/read acknowledgement / clinician | ตามบริการ | บางส่วน | C/attachments.ts; R file | ไม่มี critical result task/ack | แจ้งเฉพาะผู้มีสิทธิ์; บันทึกรับทราบและ escalation |
| CF-056 | LIS/PACS connector / integration owner | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T connector | ต้องทราบระบบ/สัญญา/API จริง | replay/out-of-order/result correction และ tenant denial ผ่าน |
| | **10. เอกสารทางคลินิก** | | | | | |
| CF-057 | ใบยินยอม/ใบสั่งยา/ใบรับรอง/ใบส่งตัว/คำแนะนำ / clinician | ตามบริการ | ไม่มี | C/encounters.ts referral text; C/attachments.ts | ข้อความ/ไฟล์แนบไม่ใช่เอกสารที่ออกและลงนาม | template/version/ผู้ลงนาม/recipient/การยกเลิกทดสอบได้ |
| CF-058 | ผลตรวจ/ภาพ/สแกน/เอกสารลงนาม / ทีมรักษา | ทั่วไป | บางส่วน | C/attachments.ts; M attachments; R file; T | pilot จำกัด PDF/PNG/JPEG ≤2 MiB; ไม่มี document lifecycle | upload/list/download จำกัด tenant+role+encounter; metadata/provenance ครบ |
| CF-059 | พิมพ์/ส่งออก/เปิดอ่านย้อนหลัง / ทีมรักษา | ทั่วไป | บางส่วน | R download; C/access.ts audit | print/export clinical-specific ยังไม่มี | export ระบุ actor/time/purpose; revoked user ถูกปฏิเสธ |
| CF-060 | ห้าม generic file route / security owner | ทั่วไป | pilot | C/attachments.ts byte store; R attachment route; M; T | ต้อง runtime ทดสอบทุก route ในสภาพแวดล้อมครบ | เดา ID, generic route, emergency access และถอน role ไม่เปิดไฟล์ |
| | **11. บริการและราคา** | | | | | |
| CF-061 | ค่าตรวจ/หัตถการ/ยา/เวชภัณฑ์/แพ็กเกจ / บัญชี | ทั่วไป | บางส่วน | C/billing.ts; O; catalog UI | pilot รับเฉพาะ reviewed NON_STOCK/ONLINE_ORDER/VAT N | matrix SKU ประเภทบริการได้รับอนุมัติ; unsupported line ถูกปฏิเสธ |
| CF-062 | ราคาตามสาขา/ประกาศราคา / ผู้ป่วย, บัญชี | ทั่วไป | ฐาน | O; migration 10.116 price windows | ยังไม่ผูก catalog ที่ประกาศกับ clinic charge | เวลา/สาขาเดียวกันแสดงราคาเดียวกันในประกาศ/charge/order |
| CF-063 | ประมาณค่าใช้จ่าย/ส่วนลดและอนุมัติ / cashier | เสริม | ไม่มี | O discount ทั่วไป; ไม่มี C estimate | ต้องกำหนด consent/approval และ freeze | estimate แยกจาก bill; ส่วนลดมี approver/audit |
| CF-064 | ประวัติราคาและกฎภาษี / บัญชี | ทั่วไป | บางส่วน | C/billing.ts reviewed price/VAT; O | VAT N pilot ไม่ครอบคลุมทุกบริการ; ต้องให้บัญชีอนุมัติ | ราคา/ภาษีที่ใช้ตรึงพร้อม effective time; rollback เมื่อเปลี่ยน |
| | **12. คิดเงินและรับชำระ** | | | | | |
| CF-065 | Charge sheet ผูก visit/บริการจริง / cashier | ทั่วไป | pilot | C/billing.ts; M charge_sheets/lines; R/U/T access DB | อ่าน charge sheet จำกัด active CASHIER ผ่าน fixture; ยังไม่เชื่อม procedure/dispense event | สร้างเฉพาะงานที่ยืนยันทำ; ไม่มี clinical prose ใน order |
| CF-066 | คนทบทวนก่อนสร้าง order/ยอด backend / cashier | ทั่วไป | pilot | C/billing.ts; O createOrderInTx; T | ต้องพิสูจน์ transaction บน restored DB | reviewed catalog/price/status ยังตรง; ยอดต่าง rollback ครบ |
| CF-067 | ผู้จ่ายต่างคน/มัดจำ/จ่ายบางส่วน/ลูกหนี้ / cashier | ทั่วไป | ฐาน | P submitPartialPayment; O; AR 9.30 | ไม่มี clinic payer mapping/reconciliation | payer/receipt/AR ถูกคน; retry และ partial ledger balance ถูกต้อง |
| CF-068 | วิธีรับเงิน/ยกเลิก/คืน/เอกสารเงินภาษี / cashier, บัญชี | ทั่วไป | ฐาน | P; O cancel/return; tax modules | clinic end-to-end ไม่พิสูจน์; ภาษีต้องอนุมัติ | submit/confirm/void/refund/receipt/invoice ทดสอบบน restored DB |
| CF-069 | กระทบยอด clinical กับ payment / cashier | ทั่วไป | บางส่วน | C/billing.ts closed-order check; P | สองธุรกรรมอาจแยก; ยังไม่มี reconciliation worklist | ค้น mismatch ทุกชนิด, แก้โดยคน, audit และไม่สร้าง order ซ้ำ |
| CF-070 | Retry ไม่คิดเงินซ้ำ / cashier | ทั่วไป | บางส่วน | C/billing.ts order retry; O/P idempotency; T | full payment retry ยังไม่พิสูจน์ร่วมกัน | lost response/replay คืน ID เดิมทั้ง order/payment |
| | **13. คลังยาและเวชภัณฑ์** | | | | | |
| CF-071 | ทะเบียนยา/หน่วย/แพ็ก/บาร์โค้ด/ล็อต/FEFO / stock owner | ตามบริการ | ฐาน | catalog, S, pharmacy README | retail/pharmacy model ไม่ใช่ clinic formulary | ผู้เชี่ยวชาญอนุมัติ catalog; lot/expiry/pack ที่เลือกตรวจได้ |
| CF-072 | จัดซื้อ/รับ/ย้าย/นับ/เสีย/กักกัน / stock owner | ตามบริการ | ฐาน | S; purchase modules; 10.107 transfer-lot WIP | transfer lot rollout ยัง WIP; ไม่มี clinic linkage | ทุก movement tenant/branch/lot ถูกต้อง; denial/rollback |
| CF-073 | ตัดเมื่อจ่าย/ใช้จริง / dispenser | ตามบริการ | ไม่มี | S; ไม่มี C dispensing/admin event | เสี่ยงตัดก่อน/หลังผิดจุด | event จริงและ movement atomic; prescribe อย่างเดียวไม่ตัด |
| CF-074 | Trace lot ถึง patient/encounter / safety owner | ตามบริการ | ไม่มี | ไม่มี C/M lot-patient link | จำเป็นต่อ recall | ค้นล็อต→ผู้ป่วยและผู้ป่วย→ล็อตได้ตามสิทธิ์ |
| CF-075 | เก็บรักษาเฉพาะทาง/เรียกคืน / safety owner | ตามบริการ | ไม่มี | S quality hold ทั่วไป; ไม่มี C workflow | ขึ้นกับรายการยา/วัคซีน | quarantine/recall ระบุล็อตและผู้ได้รับผลกระทบได้ |
| | **14. สื่อสารผู้ป่วย** | | | | | |
| CF-076 | ยืนยัน/เตือน/เลื่อนนัด/ก่อน-หลังตรวจ/ติดตาม / registrar | เสริม | ไม่มี | ไม่มี C/R/U/M/T; messaging เป็นฐานทั่วไป | verified channel/consent/approved template | ส่งครั้งเดียวถูกช่องทาง; ไม่มี chart/diagnosis ในข้อความ |
| CF-077 | แจ้งผลพร้อมโดยไม่เผยผล / clinician | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T | ต้องมี result status และ identity check | แจ้งเพียงความพร้อม; ผลอ่านผ่านช่องทางที่อนุมัติ |
| CF-078 | แยกบริการกับ marketing / privacy owner | ทั่วไป | บางส่วน | A no clinic tools; CRM/Inbox ทั่วไป | ยังไม่พิสูจน์ data lineage runtime | opt-out การตลาดไม่ปิดข้อความบริการ; clinical data ไม่เข้า campaign |
| CF-079 | ตอบกลับ/ช่องทางที่เลือก / ผู้ป่วย | เสริม | ฐาน | Inbox/chat modules | ไม่ใช่ secure clinic channel | reply ผูกนัดอย่างปลอดภัยโดยไม่สร้าง chart จาก chat |
| CF-080 | Patient portal/ผู้ปกครอง / ผู้ป่วย | เสริม | ไม่มี | C verified contact; ไม่มี portal | ต้องพิสูจน์ตัวตนและนโยบายผู้แทน | link/session/relationship/revocation ถูกทดสอบก่อนเปิด chart |
| | **15. สิทธิ์ ความปลอดภัย วงจรข้อมูล** | | | | | |
| CF-081 | RBAC + active role + care relationship / ทีมรักษา | ทั่วไป | pilot | C/access.ts/encounters.ts/billing.ts; Q; R/M/T | active CASHIER ของ charge sheet และ revoked denial ผ่าน fixture; ยังต้องพิสูจน์ทุก read/write และ revoke ระหว่างคำขอ | role matrix รวมต่าง tenant/branch ผ่านบน restored DB/browser |
| CF-082 | Admin/cashier/device/PIN ไม่เปิด chart / security owner | ทั่วไป | pilot | C/access.ts; R; G ไม่มี clinic GraphQL | ต้อง runtime ตรวจ support/device paths | บัญชีเหล่านี้อ่าน note/file ไม่ได้แม้มี ID |
| CF-083 | Emergency access เหตุผล/15 นาที/audit / clinician | ทั่วไป | pilot | C/encounters.ts; M break_glass + `10.143`; T access DB/route | ถอน grant ก่อนหมดเวลาและ expiry ผ่านบน fixture; restored schema/browser/incident review ยังไม่พิสูจน์ | หมดอายุหรือถอนแล้วไม่ใช้ grant ฉุกเฉินอ่าน chart; care relationship ตามปกติยังมีสิทธิ์ของตน; ไม่ขยายไปไฟล์ |
| CF-084 | Audit read/write/sign/export/file / security owner | ทั่วไป | บางส่วน | C/access.ts audit; R; M signed notes | export ยังไม่มี; audit store ไม่ครบใน fixture | ตรวจ chain ของ action/actor/time/target โดยไม่มี clinical prose |
| CF-085 | Support/impersonation/tenant/session/encryption / security owner | ทั่วไป | บางส่วน | R auth; M FORCE RLS; C/clinicTx | support, key management และ session runtime ยังไม่พิสูจน์ | impersonation ไม่ข้าม care role; session revoke/tenant denial |
| CF-086 | Retention/legal hold/data request / privacy owner | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T policy | ต้องให้ผู้รับผิดชอบกำหนดฐาน/ระยะก่อน code | policy version/hold/export/delete ตามกติกาที่อนุมัติ |
| CF-087 | Backup/restore/incident response / ops, privacy owner | ทั่วไป | ไม่มี | acceptance ระยะ 1 ระบุ gate | fixture ไม่พิสูจน์ restore จริง | restore drill ตรวจข้อมูล/ไฟล์/audit ครบและ RTO ตามที่อนุมัติ |
| CF-088 | ไม่รั่วไป CRM/Inbox/marketing/AI/log/report / security owner | ทั่วไป | บางส่วน | C separation; A; data-flow map | code review ยังไม่ใช่ runtime proof | synthetic sentinel ไม่พบในทุก sink ที่ไม่ได้อนุญาต |
| | **16. รายงานและคุณภาพ** | | | | | |
| CF-089 | ทะเบียน OPD/visit/คิว/เวลารอ/no-show / clinic manager | ทั่วไป | บางส่วน | C appointment/encounter; ไม่มี clinic report | ไม่มี timestamps/states ครบ | bounded report นับตรง source และจำกัด role/tenant |
| CF-090 | ภาระผู้ตรวจ/งานค้างผล/ยา/หัตถการ / clinical manager | ตามบริการ | ไม่มี | ไม่มี C report/order events | ต้องมี clinical event models ก่อน | report ตรง source และไม่แสดง chart แก่ cashier |
| CF-091 | รายได้/ค่ารักษา/คืน/AR/ผู้จ่าย / บัญชี | ทั่วไป | ฐาน | O/P/report modules | ไม่ผูก payer/visit ครบ | กระทบยอดรายงานกับ order/payment/refund แบบ synthetic |
| CF-092 | หมดอายุ/recall/adverse event/access / safety owner | ตามบริการ | บางส่วน | S; C/access.ts audit | ไม่มี patient-lot/adverse event/report | drill จากล็อตหรือ event ถึงผู้รับผิดชอบครบ |
| CF-093 | รายงาน PHI สิทธิ์เฉพาะ / security owner | ทั่วไป | ไม่มี | ไม่มี clinic report route | report การค้าห้ามมี clinical data | role/tenant denial และ export audit ครบ |
| | **17. การเชื่อมระบบ** | | | | | |
| CF-094 | EMR/HIS เดิม / integration owner | เสริม | ไม่มี | ไม่มี C/R/U/M/T connector | ยังไม่ทราบว่ามี EMR เดิมหรือไม่ | ผ่าน contract/version/identity/reconciliation ก่อน sync จริง |
| CF-095 | LIS/PACS/ประกัน/payment/อุปกรณ์ / integration owner | ตามบริการ | บางส่วน | P payment ฐาน; G POS print; ไม่มี clinic connectors | ต้องรู้ vendor/contract และประเภทบริการ | แต่ละ connector มี sandbox denial/retry/consent/ownership test |
| CF-096 | External reference tenant/branch/version/auth / integration owner | ทั่วไป | ไม่มี | ไม่มี C/M external reference | ห้ามเริ่ม sync ก่อนเลือก source of truth | ref unique ภายใน tenant/branch; forged payload ถูกปฏิเสธ |
| CF-097 | Idempotency/outbox/out-of-order/reconciliation / integration owner | ทั่วไป | บางส่วน | C appointment/order keys; realtime outbox ทั่วไป | ไม่มี clinic integration inbox/outbox | duplicate/out-of-order/retry ได้ผลเดียวและ mismatch มีคิวคนแก้ |
| CF-098 | ขอบเขตข้อมูลระหว่างระบบ / privacy owner | ทั่วไป | บางส่วน | data-flow map; C separation | ต้องให้เจ้าของข้อมูลอนุมัติ payload จริง | contract test ปฏิเสธ note/diagnosis ใน commerce payload |
| | **18. ประสบการณ์และปฏิบัติการ** | | | | | |
| CF-099 | Workspace registrar/nurse/clinician/cashier / ผู้ใช้คลินิก | ทั่วไป | บางส่วน | U/R; manual/clinic | pilot หน้าเดียว; browser ตามบทบาทยังไม่ตรวจ | task ตาม role หาได้และ denied state ชัดที่ desktop/mobile |
| CF-100 | Backend เดิมแต่ clinic boundary แยก / architect | ทั่วไป | pilot | C/R/M/Q; O/P reuse | ต้องทำ contract ทุก path เมื่อขยาย | SQL อยู่ service; tenant/role enforced; ไม่มี chart ใน POS |
| CF-101 | ไทย/อังกฤษ/desktop/mobile/performance / ผู้ใช้ | ทั่วไป | บางส่วน | U/i18n; acceptance ระยะ 1 | public/redirect browser ผ่าน; หลัง login/load ยังไม่พิสูจน์ | i18n parity; browser 2 widths; search/history latency ตาม SLO ที่ตกลง |
| CF-102 | Printer/scanner/outage/monitoring/manual / ops | ทั่วไป | บางส่วน | desktop/mobile POS; manual/clinic; system-health | ไม่มี clinic print/outage procedure หรือ hardware test | ทดสอบเครื่องจริง, drill downtime/recovery, คู่มือตรง behavior |
| CF-103 | Multi-branch สิทธิ์/ข้อมูลข้ามสาขา / clinic manager | ตามบริการ | ไม่มี | M/C one branch; S branch stock ฐาน | HN/chart/booking policy ต้องตัดสิน | branch isolation และ cross-branch care transfer ทดสอบครบ |

## ฟีเจอร์ตามประเภทบริการ

**Applicability:** สำหรับ pilot ปัจจุบัน ทั้ง 10 กลุ่มเป็น **not applicable** เพราะขอบเขต pilot ไม่รับ workflow เฉพาะทางเหล่านี้. สำหรับคลินิกเป้าหมายสถานะยัง **รอยืนยัน** เพราะยังไม่มีรายการบริการที่เจ้าของคลินิกยืนยัน. ให้ถือเป็นงาน **ตามบริการ**; เปลี่ยนเป็น applicable เมื่อยืนยันว่ามีบริการนั้น. ถ้าตอบว่าไม่มี ให้บันทึก not applicable พร้อมชื่อผู้ยืนยันและวันที่ แทนการตีความจากโค้ด.

| ID | ประเภท / ฟีเจอร์ / ผู้ใช้ | Applicability | สถานะและหลักฐาน | Dependency / ความเสี่ยง | เกณฑ์รับมอบที่ทดสอบได้ |
| --- | --- | --- | --- | --- | --- |
| CF-104 | ทันตกรรม: ผังฟัน / ทันตแพทย์ | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องกำหนด notation/ฟอร์ม | บันทึกซี่/พื้นผิวพร้อม version และ role |
| CF-105 | ทันตกรรม: หัตถการรายซี่ / ทันตแพทย์ | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องมี procedure event | charge อ้างซี่และงานที่ทำจริงเท่านั้น |
| CF-106 | ทันตกรรม: ภาพฟัน / ทันตแพทย์ | pilot: N/A; เป้าหมาย: รอยืนยัน | C/attachments.ts เก็บภาพ pilot; ไม่มี mapping ซี่ | ขนาด/format/PACS | ภาพผูกซี่/visit และอ่านตาม care role |
| CF-107 | ทันตกรรม: แผนหลายครั้ง / ทันตแพทย์ | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | encounter เดี่ยวไม่พอ | ความคืบหน้าแต่ละครั้งและการแก้แผนย้อนหลังได้ |
| CF-108 | ทันตกรรม: งานแล็บฟัน / ทันตแพทย์ | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องมี external order | ส่ง/รับ/แก้งานพร้อม provenance |
| CF-109 | ความงาม/ผิวหนัง: ภาพก่อน–หลัง / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | C/attachments.ts pilot เท่านั้น | consent/retention ภาพ | consent ก่อน capture, version และ access audit |
| CF-110 | ความงาม/ผิวหนัง: คอร์ส / operator | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ห้ามสับสนกับ retail package | ใช้ครั้ง/คงเหลือ/reversal ถูกต้อง |
| CF-111 | ความงาม/ผิวหนัง: ใบยินยอม / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องอนุมัติ template | ลงนามต่อหัตถการและเวอร์ชันก่อนทำ |
| CF-112 | ความงาม/ผิวหนัง: ล็อตสารที่ใช้ / ผู้ปฏิบัติ | pilot: N/A; เป้าหมาย: รอยืนยัน | S ฐาน; ไม่มี C patient-lot | ต้องมี administration event | trace ล็อตถึง visit และ movement atomic |
| CF-113 | ความงาม/ผิวหนัง: นัดติดตาม / registrar | pilot: N/A; เป้าหมาย: รอยืนยัน | C/appointments.ts นัดทั่วไป | ไม่มี course link | นัดอ้างหัตถการ/ผลและค้างติดตามได้ |
| CF-114 | วัคซีน/ฉีดยา: ตารางเข็ม / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ผู้เชี่ยวชาญกำหนด schedule | dose due/overdue คำนวณจากหลักฐานจริง |
| CF-115 | วัคซีน/ฉีดยา: ล็อต / ผู้ปฏิบัติ | pilot: N/A; เป้าหมาย: รอยืนยัน | S ฐาน; ไม่มี C link | expiry/recall | lot/expiry ของ dose จริงตรวจย้อนหลังได้ |
| CF-116 | วัคซีน/ฉีดยา: บันทึกให้จริง / ผู้ปฏิบัติ | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | order ≠ administration | actor/time/site/dose และ movement atomic |
| CF-117 | วัคซีน/ฉีดยา: ใบรับรอง / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องมี administration evidence | ใบรับรองออกจาก dose จริงและลงนาม |
| CF-118 | วัคซีน/ฉีดยา: เหตุไม่พึงประสงค์ / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | incident policy | event เชื่อม dose/lot และติดตามผล |
| CF-119 | กายภาพ: แผนหลายครั้ง / therapist | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ฟอร์มเฉพาะทาง | เป้าหมาย/ครั้ง/ผู้รับผิดชอบแก้แบบ versioned |
| CF-120 | กายภาพ: คะแนนประเมิน / therapist | pilot: N/A; เป้าหมาย: รอยืนยัน | C note text เท่านั้น | ต้องเลือกเครื่องมือประเมิน | ค่า/หน่วย/เวอร์ชันพร้อมผู้ประเมิน |
| CF-121 | กายภาพ: ความก้าวหน้า / therapist | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องมี series | เปรียบเทียบแต่ละครั้งจาก structured scores |
| CF-122 | กายภาพ: คอร์สคงเหลือ / cashier | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | เงินคอร์สและบริการจริงต้องแยก | ใช้/คืน/หมดอายุ reconcile กับ payment |
| CF-123 | แล็บตนเอง: สิ่งส่งตรวจ / lab | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | specimen workflow | รับ/ปฏิเสธ/เก็บพร้อมเวลาผู้รับ |
| CF-124 | แล็บตนเอง: บาร์โค้ด / lab | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้อง unique tenant/specimen | scan ผิดคน/ซ้ำถูกปฏิเสธ |
| CF-125 | แล็บตนเอง: สถานะตรวจ / lab | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | state machine | transition ถูกลำดับและ audit |
| CF-126 | แล็บตนเอง: ผู้รับรอง / lab | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | licence/role | ผลรับรอง immutable พร้อม correction workflow |
| CF-127 | แล็บตนเอง: ผลสำคัญ / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | escalation owner | แจ้ง/อ่าน/ack/ติดตามครบพร้อมเวลา |
| CF-128 | ภาพวินิจฉัย: คำสั่ง / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | modality/order model | order version/indication จำกัดสิทธิ์ |
| CF-129 | ภาพวินิจฉัย: ภาพ / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | C/attachments.ts pilot | PACS/format/size ไม่รองรับครบ | ภาพอ้าง study และสิทธิ์ care team |
| CF-130 | ภาพวินิจฉัย: รายงาน / radiologist | pilot: N/A; เป้าหมาย: รอยืนยัน | C note/attachment pilot ไม่ใช่ report | ต้องแยก signed result | final/corrected report immutable |
| CF-131 | ภาพวินิจฉัย: ผู้แปลผล / radiologist | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | licence/role | ผู้ลงนามและเวลาตรวจสอบได้ |
| CF-132 | ภาพวินิจฉัย: ระบบภาพ / integration owner | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี connector C/R/U/M/T | PACS vendor contract | duplicate/out-of-order study และ access denial |
| CF-133 | ประกัน: ตรวจสิทธิ / claims staff | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | payer contract/identity | eligibility response มีที่มา/เวลาและไม่แทนการรับรอง |
| CF-134 | ประกัน: อนุมัติล่วงหน้า / claims staff | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องมี treatment estimate | authorization ผูกบริการ/วงเงิน/เวลา |
| CF-135 | ประกัน: claim / claims staff | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | privacy payload/claim rules | claim ซ้ำไม่สร้างหนี้ซ้ำ; ส่งเฉพาะข้อมูลอนุมัติ |
| CF-136 | ประกัน: ผลปฏิเสธ/กระทบยอด / claims staff | pilot: N/A; เป้าหมาย: รอยืนยัน | P/AR ฐาน ไม่ใช่ claims | ต้องมี adjudication model | denied/partial/paid reconcile กับ AR และ patient balance |
| CF-137 | ตรวจทางไกล: พิสูจน์ตัวตน / registrar | pilot: N/A; เป้าหมาย: รอยืนยัน | C patient pilot; ไม่มี remote verification | ผู้ประกอบวิชาชีพ/กฎหมายอนุมัติ | verify ผู้ป่วยและผู้ตรวจทุก session |
| CF-138 | ตรวจทางไกล: สื่อสารทางไกล / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | secure channel/provider | session ผูก visit; timeout/revocation ทำงาน |
| CF-139 | ตรวจทางไกล: บันทึก / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | C encounter pilot ไม่ระบุ remote | consent/recording policy | mode/time/participants/provenance ครบ |
| CF-140 | ตรวจทางไกล: ข้อกำหนดวิชาชีพ / clinical owner | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี approved policy | ต้องตรวจข้อกำหนดปัจจุบัน | ผู้รับผิดชอบลงนาม scope/use cases ก่อนเปิด |
| CF-141 | ตรวจสุขภาพองค์กร: รายชื่อกลุ่ม / coordinator | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | consent/identity matching | roster import ซ้ำไม่รวม chart ผิดคน |
| CF-142 | ตรวจสุขภาพองค์กร: ชุดตรวจ / coordinator | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | package/order dependency | bundle รายคนและงานจริงตรวจได้ |
| CF-143 | ตรวจสุขภาพองค์กร: รายงานนายจ้างจำกัดข้อมูล / privacy owner | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C report | disclosure policy | export ไม่มีผลรายบุคคลนอกขอบเขตอนุมัติ |
| CF-144 | ตรวจสุขภาพองค์กร: วางบิล / cashier | pilot: N/A; เป้าหมาย: รอยืนยัน | O/P ฐาน; ไม่มี C corporate payer | ต้องกำหนดผู้จ่าย/AR | bill รวมยอดตรงแต่ไม่เผย chart |
| CF-145 | หลายสาขา: HN/เวชระเบียนข้ามสาขา / registrar | pilot: N/A; เป้าหมาย: รอยืนยัน | M/C one branch | ต้องกำหนด HN scope/access | ค้นข้ามสาขาตามสิทธิ์โดยไม่สร้างผู้ป่วยซ้ำ |
| CF-146 | หลายสาขา: ตารางผู้ตรวจ / scheduler | pilot: N/A; เป้าหมาย: รอยืนยัน | C appointment pilot one branch | resource overlap ข้ามสาขา | ผู้ตรวจไม่ถูกจองชนสองสาขา |
| CF-147 | หลายสาขา: สต็อก / stock owner | pilot: N/A; เป้าหมาย: รอยืนยัน | S/10.107 ฐาน WIP | lot transfer ยังไม่ rollout | ส่ง/รับ/ล็อต/movement ครบ |
| CF-148 | หลายสาขา: รายงานแยกสาขา / manager | pilot: N/A; เป้าหมาย: รอยืนยัน | report ธุรกิจฐาน; ไม่มี C report | branch-scoped PHI | แต่ละสาขาเห็นเฉพาะข้อมูลตาม policy |

## งานย่อยที่รายการรวมเดิมยังบอกความเสี่ยงไม่พอ

แถวต่อไปนี้แตกจากรายการรวมด้านบนหรือเพิ่มช่องว่างใหม่. `A` หมายถึง EMR/HIS เดิมเป็นเจ้าของข้อมูลทางคลินิก; `B` หมายถึง BMS เป็นเจ้าของหลัง decision และการตรวจรับ. ช่อง **สิทธิ์/หลักฐาน** เป็นเกณฑ์ที่ต้องออกแบบเมื่อยังไม่มี implementation ไม่ใช่การอ้างว่ามี permission หรือ audit นั้นแล้ว. ผู้ตรวจรับในคอลัมน์สุดท้ายต้องเป็นคนจริงพร้อมชื่อ/วันที่ก่อนเปลี่ยน applicability หรือเปิดใช้.

| ID | Workflow / ผู้ใช้ | ใช้เมื่อ | ข้อมูลที่สร้าง / source of truth | สิทธิ์และ audit ที่ต้องมี | สถานะ / หลักฐานปัจจุบัน | Dependency / ความเสี่ยง | เกณฑ์ทดสอบ / ผู้ตรวจรับ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CF-149 | ทะเบียนใบอนุญาตสถานพยาบาล / ผู้ดูแล | ทุกสาขาที่ใช้จริง | ประเภท, เลขที่, ผู้รับอนุญาต, วันมีผล; ทะเบียนคลินิกที่ผู้รับผิดชอบยืนยัน | ผู้ดูแลที่มอบหมาย; audit เพิ่ม/เปลี่ยน/หมดอายุ | ไม่มี clinic registry; `bms_locations` เป็นฐานสาขา | ชนิดสถานพยาบาล/บริการยังไม่ทราบ; ห้ามอนุมานจาก archetype | หมดอายุหรือผิดสาขาไม่เปิด workflow; เจ้าของคลินิก/กฎหมาย |
| CF-150 | ทะเบียนเตียง อุปกรณ์ ความจุ และสถานะพร้อมใช้ / ผู้จัดตาราง | ตามบริการจริง | resource + capacity/version; A หรือ B ตาม owner นัดหมาย | scheduler ที่ได้รับมอบหมาย; audit การปิด/เปิดทรัพยากร | room code pilot กันซ้อน แต่ไม่มี resource registry | ต้องยืนยันชนิด/จำนวน/maintenance | จองอุปกรณ์เสียหรือเกิน capacity พร้อมกันไม่ได้; clinic ops |
| CF-151 | รายการบริการที่อนุมัติและประกาศราคา / บัญชี, ผู้ป่วย | ทุกบริการคิดเงิน | service code, สาขา, ราคา, วันมีผล, ผู้อนุมัติ; BMS catalog หลังบัญชีรับรอง | catalog/price permission; audit approve/publish | BMS catalog มีราคา; clinic ใช้ NON_STOCK/VAT N เท่านั้น | ไม่มี clinic service approval/price publication contract | ราคาแสดงกับ charge/order ตรง snapshot; บัญชี/ภาษี |
| CF-152 | ตรวจหลักฐานวิชาชีพกับแหล่งออกใบอนุญาต / ผู้ดูแลวิชาชีพ | ผู้ลงนาม/สั่ง/ทำ | ประเภทวิชาชีพ, เลข, หลักฐาน, ผลตรวจ, วันหมดอายุ; ผู้รับผิดชอบวิชาชีพ | แยกผู้กรอก/ผู้ตรวจ; audit ผล/แหล่ง/เวลา | `bms_clinic_staff.licence_no` กรอกเอง | role ไม่พิสูจน์ใบอนุญาตหรือการอยู่เวร | หมดอายุ/ไม่ผ่านตรวจไม่มีสิทธิ์งานที่กำหนด; clinical owner |
| CF-153 | ขอบเขตงาน การฝึกและความสามารถ / ผู้ดูแลวิชาชีพ | ตามงานที่ต้องรับรอง | competency + version + evidence; clinical owner | ผู้อนุมัติวิชาชีพ; audit การให้/ถอน scope | ไม่มี clinic competency model | ต้องกำหนด scope ตามบริการจริง | ผู้ไม่มี scope ทำ/ลงนามไม่ได้แม้มี role; clinical owner |
| CF-154 | เวร ผู้ดูแลแทน และส่งมอบงาน / scheduler | เมื่อคลินิกใช้ตารางเวร | shift/delegation/ack/expiry; A หรือ B ตาม owner ตาราง | ผู้จัดเวรและผู้รับ; audit มอบหมาย/ถอน | ไม่มี clinic roster; BMS store roster ไม่พิสูจน์อยู่เวร | ต้องกำหนดเวลาทำงานและการแทน | delegate หมดอายุหรือไม่รับงานเปิด visit ไม่ได้; clinic ops |
| CF-155 | ยืนยันผู้ป่วยซ้ำที่จุดตรวจ/สั่ง/ทำ / ทีมรักษา | ทุก visit ที่มี clinical action | identity-check evidence; A/B chart owner | ผู้ทำขั้นนั้น; audit patient+encounter+time | pilot มี HN/ชื่อ แต่ไม่มี checkpoint evidence | wrong-patient harm; ห้ามใช้ชื่อ/โทรศัพท์แทน proof | เลือกคนผิดแล้วหยุดก่อน order/procedure; clinical owner |
| CF-156 | แก้ชื่อ/วันเกิด/ข้อมูลระบุตัว / registrar | เมื่อข้อมูลผิด | amendment + before/after + reason; patient master owner A/B | registrar พร้อม reviewer ตามนโยบาย; audit transaction | pilot ลงทะเบียน/อ่านได้ แต่ไม่มี edit | อ้างอิง encounter เดิมต้องคงคนเดิม | แก้ไม่ทับประวัติและไม่เปลี่ยน HN ของคนอื่น; registrar/privacy |
| CF-157 | Merge/unmerge ผู้ป่วยผิดคน / identity steward | เมื่อ duplicate หรือรวมผิด | mapping, reason, reference repair plan; patient master owner A/B | dual review/confirmation; audit immutable | ไม่มี clinic merge/unmerge | ไม่ใช้ CRM merge เป็น chart merge | แยกกลับแล้ว note/order/file ทุกอันชี้คนเดิมถูกต้อง; clinical/privacy |
| CF-158 | นำเข้าประวัติที่จับคู่คนไม่ชัด / import reviewer | เฉพาะเมื่อเลือก import | source ID, provenance, confidence, review queue; A/B | human accept/reject; audit source/version | ไม่มี clinic import | D01/สัญญา/สิทธิ์ผู้ป่วย | ambiguous match ไม่เขียน chart; replay ไม่ซ้ำ; registrar/privacy |
| CF-159 | ถอนสิทธิ์ผู้แทน/ผู้ปกครอง / registrar | หากมี portal/disclosure ผู้แทน | relationship evidence + validity/revocation; patient master owner | ผู้ตรวจหลักฐาน; audit grant/revoke/read | pilot contact ไม่ให้ chart access อยู่แล้ว | อายุ/ผู้แทน/วิธีพิสูจน์ต้องอนุมัติ | ถอนแล้ว portal/export/download ถูกปฏิเสธ; privacy |
| CF-160 | คำนวณ slot จากระยะบริการ เวร ห้อง วันหยุด / scheduler | เมื่อ BMS ถือการนัด | service duration + availability snapshot; BMS appointment | appointment.manage + role; audit booking/override | pilot มี conflict constraint แต่ไม่คำนวณ availability | C01–C03; รายการถูกตัดห้ามอ้างว่าว่าง | จองนอกเวร/หยุด/อุปกรณ์ไม่พร้อมไม่ได้; clinic ops |
| CF-161 | เสนอคิว waitlist แบบมีอายุและผู้รับ / registrar | หากคลินิกใช้ waitlist | offer/claim/expiry; appointment owner A/B | registrar; audit offer/accept/expire | ไม่มี clinic waitlist | policy ลำดับคิวและการติดต่อ | slot เดียวรับได้หนึ่งราย; retry ไม่ส่งซ้ำ; clinic ops |
| CF-162 | คัดกรองความเร่งด่วนและส่งต่อฉุกเฉิน / nurse | เมื่อมี front desk triage | screening, urgency, escalation actor/time; A/B | nurse ตาม scope; audit handoff/ack | ไม่มี triage model; vitals เป็นข้อความ draft | เกณฑ์ต้องให้ผู้ประกอบวิชาชีพกำหนด | กรณีทดสอบที่รับรองส่งถึง owner; clinical owner |
| CF-163 | ตรวจผู้จ่าย/ความคุ้มครองหน้าเคาน์เตอร์ / registrar | เมื่อ payer/insurance ใช้จริง | payer proof, eligibility source/time; BMS billing และ insurer ตามสัญญา | registrar/claims role; audit read/decision | pilot ไม่มี payer mapping | ไม่ถือผลตรวจสิทธิ์เป็นการอนุมัติ claim | wrong payer ไม่เปิดเผย chart/ออกบิลผิด; accounting/privacy |
| CF-164 | คิวและ handoff ที่ผู้รับยืนยัน / registrar, nurse | เมื่อมีหลายจุดบริการ | queue stage, owner, sent/ack time; visit owner A/B | ผู้ส่ง/ผู้รับตาม role; audit ทุก transition | CHECKED_IN + care team pilot แต่ไม่มี queue ack | ต้องกำหนดสถานะ visit | งานไม่หายเมื่อคนรับถูกถอนสิทธิ์; clinic ops |
| CF-165 | แยกประวัติที่ผู้ป่วยแจ้งกับที่ยืนยันแล้ว / clinician | เมื่อ BMS ถือ chart | assertion/source/recorded/reviewed/conflict; BMS EMR | record.read/write + care relationship; audit review | note text pilot ไม่มี provenance แยก | D01/ฟอร์มวิชาชีพ | self-report ไม่ถูกแสดงเป็น verified; clinical owner |
| CF-166 | ประวัติอุปกรณ์ฝัง/วัคซีน/ผ่าตัด/ครอบครัวเป็นรายการ / clinician | ตามบริการและฟอร์ม | structured item + source/version; A/B chart owner | care role; audit read/amend | ไม่มี structured longitudinal tables | E01 และผู้ประกอบวิชาชีพเลือก field | แก้รายการหนึ่งไม่ลบประวัติอื่น; clinical owner |
| CF-167 | Vitals ค่า/หน่วย/เวลา/ผู้บันทึก / nurse | เมื่อ BMS ถือ chart | observation พร้อม unit/source; BMS EMR | nurse ตาม assignment; audit/sign-off | pilot `vitals` เป็นข้อความ | unit/code set ต้องอนุมัติ | หน่วยผิด/ค่าไม่ถูกชนิดถูกปฏิเสธ; clinical owner |
| CF-168 | แก้/ถอน signed record โดยไม่ทับฉบับเดิม / clinician | เมื่อ BMS ถือ chart | correction/retraction reason+link; BMS EMR | ผู้ลงนามที่มีสิทธิ์; audit ทั้งสองฉบับ | addendum pilot มี แต่ไม่มี retraction | policy อนุมัติการแก้ผิดคน/ผิด visit | ฉบับเดิม immutable และผู้เปิดเห็นสถานะใหม่; clinical/privacy |
| CF-169 | เวอร์ชันฟอร์มและ attestation / clinical owner | ทุกฟอร์มที่จะใช้จริง | template version/approval/effective date; A/B | ผู้อนุมัติวิชาชีพ; audit publish/retire | pilot note schema fixed code ไม่มี form registry | D02 และกรณีทดสอบที่ผู้ประกอบวิชาชีพเซ็น | บันทึกเก่าเปิดด้วยเวอร์ชันเดิม; clinical owner |
| CF-170 | ตรวจคน/แพ้ยา/ข้อห้าม ณ จุดสั่ง / clinician | เฉพาะ order ที่คลินิกใช้ | order context + check result; A/B clinical order | ผู้สั่งตาม scope; audit check/override | ไม่มี clinical order; note plan ไม่ใช่ order | rule ต้องผ่าน clinical approval | order ผิดคนหรือแพ้ที่ยืนยันแล้วไม่ผ่านโดยไม่มี review; clinical owner |
| CF-171 | Override alert ด้วยเหตุผลและผู้ทบทวน / clinician | เมื่อมี clinical alert ที่อนุมัติ | alert, reason, actor, review state; A/B | คนสั่งและ reviewer แยกตาม policy; audit | ไม่มี alert engine หรือ override | ห้ามให้ AI กำหนดเกณฑ์เอง | override ไม่มีเหตุผล/หมด scope ไม่ผ่าน; clinical owner |
| CF-172 | รับ/ยกเลิก/แก้ order โดยแยกผู้รับกับผู้ทำ / ทีมรักษา | เมื่อมี order | order state/history/version; A/B | role ตามชนิดคำสั่ง; audit transitions | ไม่มี clinical order lifecycle | E03; signed note ไม่ใช่ order | retry/ลำดับผิด/คำสั่งเก่าห้ามทำซ้ำ; clinical owner |
| CF-173 | Medication reconciliation / clinician, ผู้จ่าย | เมื่อมีการใช้ยา | med list source/review/conflict; A/B | ผู้ทบทวนตามวิชาชีพ; audit resolution | note medicationPlan text เท่านั้น | E01/E03 และแหล่งยาที่เชื่อถือ | ยาที่ผู้ป่วยแจ้งเองไม่กลายเป็นใบสั่ง; clinical owner |
| CF-174 | ทบทวนใบสั่งก่อนจ่าย / ผู้มีหน้าที่ | เมื่อจ่ายยา | prescription review decision; A/B | ผู้ทบทวนที่ได้รับอนุมัติ; audit approve/reject | pharmacy retail path ไม่ใช่ clinic dispense | แยก prescribe/review/dispense | ไม่ผ่าน review ไม่มี dispense/charge/stock; clinical owner |
| CF-175 | ให้ยาจริงและบันทึกล็อต / ผู้ปฏิบัติ | เมื่อมี administration | patient/dose/route/time/site/lot; A/B + stock BMS | ผู้ปฏิบัติที่มอบหมาย; audit event/movement | ไม่มี administration event; S เป็นฐาน stock | E06 และ lot reconciliation | event/movement atomic, retry ไม่ตัดซ้ำ; clinical/stock |
| CF-176 | คืนยา/ยกเลิกจ่ายและติดตาม recall / ผู้จ่าย, safety owner | เมื่อจ่ายยา | dispense reversal + lot link; A/B + stock BMS | ผู้อนุมัติการคืน; audit reason/stock | POS return เป็นการเงิน ไม่ใช่ clinical return | E05 และ policy ของยา | คืนเงินไม่ย้อน dispense เอง; trace ผู้ได้รับล็อต; clinical/stock |
| CF-177 | เก็บสิ่งส่งตรวจพร้อมยืนยันคนและ barcode / lab | เมื่อมีแล็บ | specimen ID, collector, time, patient/order; LIS หรือ BMS ตาม contract | ผู้เก็บตาม scope; audit scan/collection | ไม่มี specimen model | D01/D02, LIS contract | scan คนผิด/ซ้ำหยุดก่อนรับ; lab owner |
| CF-178 | ขนส่ง/รับ/ปฏิเสธสิ่งส่งตรวจ / lab | เมื่อมี specimen handoff | custody steps, receiver, reject reason; LIS/BMS | ผู้ส่งและผู้รับ; audit transition | ไม่มี specimen custody | ต้องกำหนด SLA และตัวตนผู้รับ | หาย/ล่าช้า/ปฏิเสธมี owner และ recollection; lab owner |
| CF-179 | แก้ผลที่รับรองแล้ว / lab, clinician | เมื่อมีผลตรวจ | result version, correction link, signed time; LIS/BMS | ผู้รับรองที่มีสิทธิ์; audit ฉบับเดิม/ใหม่ | attachment file ไม่ใช่ result version | E04 หรือ LIS/PACS contract | เก่า immutable; ผู้รักษาเห็น correction และ ack ใหม่; lab/clinical |
| CF-180 | ผลวิกฤต: แจ้ง รับทราบ และ escalate / lab, clinician | ตามบริการที่มี critical result | threshold version, owner, notice, ack, escalation; LIS/BMS | role ตามวิชาชีพ; audit เวลาแต่ละจุด | ไม่มี result task/ack | threshold/deadline ต้องอนุมัติ | overdue ส่งต่อ owner ตาม policy และตรวจได้; clinical owner |
| CF-181 | ยินยอมก่อนหัตถการ / clinician | ตามหัตถการที่ต้องมี | consent version, patient/representative proof, time; A/B | ผู้รับ consent ที่มีสิทธิ์; audit sign/revoke | ไม่มี procedure consent model | clinical/privacy policy | ไม่มี consent ที่ใช้ได้แล้ว performed ไม่ผ่าน; clinical/privacy |
| CF-182 | บันทึกหัตถการที่ทำจริงพร้อมตำแหน่ง/ข้าง / ผู้ปฏิบัติ | เมื่อมีหัตถการ | performed event, site/side, actor, time, materials; A/B | scope + assignment; audit event/correction | `treatmentPlan` text ไม่ใช่ performed | C11; wrong-site risk | order/plan แยกจาก performed และ charge; clinical owner |
| CF-183 | ภาวะแทรกซ้อน คำแนะนำและติดตามหลังทำ / clinician | เมื่อมีหัตถการ | adverse/aftercare/follow-up task; A/B | care role; audit notification/ack | ไม่มี structured incident/aftercare | ผู้ประกอบวิชาชีพอนุมัติข้อความ | งานค้างถึง owner ไม่ส่งข้อมูลผ่าน marketing; clinical owner |
| CF-184 | ส่ง/รับ referral และผลตอบกลับ / clinician | เมื่อส่งต่อ | referral state, recipient, sent/received/response; A/B | ผู้ส่ง/ผู้รับตาม care relationship; audit disclosure | note referral text เท่านั้น | ต้องยืนยันปลายทางและช่องทาง | หาย/ซ้ำ/ปฏิเสธมี owner และ reconciliation; clinical/privacy |
| CF-185 | สรุป visit/discharge ที่ลงนาม / clinician | เมื่อปิด visit | summary version, signer, time; A/B | record.sign + assignment; audit print/export | signed note pilot แต่ไม่มี summary workflow | ฟอร์มวิชาชีพและผู้รับ | จบ visit แล้วสรุปย้อนถึง source ได้; clinical owner |
| CF-186 | งานติดตาม/คัดกรอง/โรคเรื้อรังที่ค้าง / care coordinator | ตามบริการ | task owner, due, ack, closed reason; A/B | care role; audit task lifecycle | ไม่มี clinic follow-up queue | D02 และช่องทางที่ยืนยัน | overdue ไม่หายและไม่เผย PHI ให้คนอื่น; clinical owner |
| CF-187 | ออกใหม่/ถอนเอกสารรับรอง / clinician | เมื่อออกเอกสาร | document ID, template version, signer, supersedes/revoked; A/B | ผู้ลงนาม; audit issue/revoke | attachment ไม่ใช่ issued document | E07; ปลายทาง/รูปแบบต้องอนุมัติ | เอกสารเก่ายังตรวจสถานะได้และพิมพ์ผิดฉบับไม่ได้; clinical owner |
| CF-188 | พิมพ์/ส่งออก/เปิดเผย chart พร้อมหลักฐานผู้รับ / privacy officer | เมื่อมี disclosure | purpose, recipient, scope, time, artifact hash; chart owner A/B | export permission เฉพาะ; audit read/export | มี download ไฟล์ pilot แต่ไม่มี disclosure workflow | D03; generic route ห้ามข้าม | revoked/foreign denied; export ไม่มีเกิน scope; privacy |
| CF-189 | ผู้จ่ายต่างจากผู้ป่วย/claim reference / cashier | เมื่อมี payer อื่น | payer identity, authorization, claim ref; BMS billing | clinic.billing.manage + payer permission; audit mapping | BMS AR/payment ฐาน; ไม่มี clinic payer link | D04; identity/receipt | บิลระบุผู้จ่ายถูกคนโดยไม่ให้ payer อ่าน chart; accounting/privacy |
| CF-190 | เก็บ charge จาก performed/dispense event / cashier | เมื่อคิดค่าบริการจริง | event ref, approved service SKU, price snapshot; BMS charge | billing.manage + human review; audit event→order | pilot charge จาก signed encounter ไม่ยืนยัน performed | C11/E05 หรือ approved EMR event | retry ไม่เพิ่ม charge; ยอด/stock rollback ครบ; accounting/clinical |
| CF-191 | Refund/void แยกจาก clinical correction / cashier | เมื่อคืนเงิน | refund reference, reason, clinical reconciliation state; BMS payment | payment/refund permissions; audit 2 ฝั่ง | POS/payment มีฐาน; ไม่มี clinic reconciliation | G02/C08 | คืนเงินไม่ลบ performed/note อัตโนมัติ; accounting/clinical |
| CF-192 | Cold chain และอุณหภูมิ / stock owner | เฉพาะรายการที่ต้องควบคุม | reading, device, range, excursion, hold; stock owner | stock/safety role; audit excursion/release | quality hold ฐาน; ไม่มี clinic cold chain | D02/ชนิดสินค้า/เกณฑ์ที่อนุมัติ | excursion กักล็อตจนคน review; stock/clinical |
| CF-193 | Trace lot กลับถึงผู้ป่วยและ recall / safety owner | เมื่อยา/วัสดุมีล็อต | dispense/use→lot→patient mapping; A/B + BMS stock | safety role; audit query/notice | stock lot ฐาน แต่ไม่มี patient link | E05/E06 | ค้นได้สองทางและแจ้งเฉพาะผู้เกี่ยวข้อง; clinical/privacy |
| CF-194 | Secure reply แยกจากแชตการค้า / patient service | หากเปิดช่องทางผู้ป่วย | verified channel, message scope/recipient; chart owner | patient/care role; audit send/read | Inbox ฐานไม่ใช่ clinical channel | D03; ห้าม diagnosis ผ่าน marketing | ผิดผู้รับ/ถอนสิทธิ์ส่งไม่ได้; privacy |
| CF-195 | Portal ผู้ป่วยและผู้แทนที่ถอนสิทธิ์ได้ / patient | หากเปิด portal | identity proof, delegation, expiry; chart owner | patient/representative scope; audit read/download | ไม่มี clinic portal | D03/CF-159 | guardian เบอร์เดียวกันไม่เปิด chart; privacy |
| CF-196 | Clinical incident/near miss/complaint / safety owner | ทุกบริการที่กำหนด policy | case, severity, investigation, corrective action; A/B | แยกผู้รายงาน/ผู้สอบสวน; audit transition | BMS support ticket ไม่ใช่ clinical incident | D02 และนโยบายความปลอดภัย | case ไม่ปิดหาก action ค้าง; clinical owner |
| CF-197 | Wrong-patient checkpoints ที่ specimen/dispense/administration/procedure / ผู้ปฏิบัติ | ตาม event ที่เปิดจริง | check evidence ต่อ event; A/B | ผู้ทำงานจริง; audit mismatch/override | ไม่มี clinical event เหล่านี้ | CF-155 และ order/event model | ยืนยันผิดคนหยุดก่อน stock/charge/result; clinical owner |
| CF-198 | Audit การปฏิเสธอ่าน/แก้/ส่งออก/เปิดไฟล์ / security owner | ทุก chart path | security event target/actor/outcome; BMS audit | ผู้ตรวจ audit แยก; query tenant-bound | pilot audit success/read และ write; denial ยังไม่ครอบคลุม | ต้องไม่ log clinical text/secret | 401/403/404 ที่เสี่ยงมีเหตุการณ์ตรวจได้; security/privacy |
| CF-199 | Vendor access, MFA และตอบเหตุการณ์ข้อมูล / security owner | เมื่อมีผู้ให้บริการ/remote access | access grant, expiry, incident evidence; platform/security | admin approval; audit access/withdrawal | BMS auth ฐาน; clinic-specific policy ไม่มี | D03/vendor contract | vendor หมดสิทธิ์แล้วอ่าน chart ไม่ได้; security/privacy |
| CF-200 | Archive/restore chart พร้อมไฟล์ ลายเซ็น audit / ops | เมื่อ BMS ถือ chart | backup set/hash/restore evidence; BMS clinical store | restore operator แยก; audit drill | DB fixture ไม่ใช่ full restore | G01/G06; retention/hold policy | restore บน throwaway แล้วยังตรวจ signer/attachment ได้; ops/privacy |
| CF-201 | คำขอข้อมูล/แก้ไข/ระงับ/hold / privacy officer | ตามคำขอที่ยืนยันตัวตน | request, decision, scope, reason, deadline; chart owner | privacy role; audit decision/disclosure | ไม่มี clinic DSAR/hold workflow | D03/กฎหมายและนโยบายจริง | ตอบ/ปฏิเสธพร้อมเหตุผลโดยไม่ลบผิดกฎหมาย; privacy |
| CF-202 | หลักฐานรับ/ส่งข้อมูลข้ามระบบ / integration owner | เมื่อเชื่อมระบบ | source, recipient, event ID, version, checksum; A/B inbox/outbox | service identity; audit receive/send | ไม่มี clinic connector | I01–I04 | duplicate/out-of-order ไม่สร้าง chart/order ซ้ำ; security/privacy |
| CF-203 | เวอร์ชันรหัสวินิจฉัย/ยา/แล็บ/หน่วย / terminology owner | ตามบริการที่ใช้รหัส | code system/version/effective date; A/B | owner อนุมัติ mapping; audit publish | pilot note เป็นข้อความ | D02/E01–E04 | บันทึกเก่าตีความด้วยเวอร์ชันเดิม; clinical owner |
| CF-204 | Local-code mapping และการเปลี่ยนความหมาย / terminology owner | เมื่อมีรหัสท้องถิ่น | mapping source/target/version/owner; A/B | human approval; audit mapping | ไม่มี clinic mapping registry | I01 หรือ EMR taxonomy | เปลี่ยน mapping ไม่เปลี่ยนบิล/ผลย้อนหลัง; clinical/accounting |
| CF-205 | รายงาน clinical แยกจากรายงานการค้า / clinical manager | เมื่อมี chart/report | OPD/ผลค้าง/คุณภาพ; chart owner | clinical report permission; audit read/export | report BMS ฐาน ไม่มี clinic clinical report | D03/C09 | cashier/CRM ไม่มี PHI; count ตรง source; privacy/clinical |
| CF-206 | รายงานประชากร/สาธารณสุข / public-health owner | เฉพาะบริการหรือข้อกำหนดที่ยืนยัน | aggregate/limited extract; chart owner | approved purpose + privacy review; audit export | ไม่มี clinic population report | D02/D03; ห้ามตั้งเกณฑ์จากสมมติฐาน | ตัวเลขไม่เปิดเผยรายบุคคลเกิน scope; privacy/clinical |
| CF-207 | Authenticated clinic inbox/outbox / integration owner | เมื่อเลือกทาง A หรือเชื่อม LIS/PACS | event ID/version/source/status; BMS integration store | service credential + tenant mapping ฝั่ง server; audit | BMS integration patterns มีฐาน แต่ไม่มี clinic connector | I01/I03; vendor contract | forgery/retry/out-of-order fail closed; security/vendor |
| CF-208 | คิวแก้ patient/visit mapping ไม่ตรง / identity steward | เมื่อมี external ID | candidate links, evidence, decision; patient owner | human review; audit accept/reject | ไม่มี clinic reconciliation worklist | I02; ห้ามรวม chart อัตโนมัติ | ambiguity ไม่ลงข้อมูล/charge ผิดคน; privacy/registrar |
| CF-209 | Downtime กระดาษและนำกลับเข้าอย่างกระทบยอด / ops | เมื่อระบบ/เครือข่ายล่ม | paper ref, back-entry provenance, duplicate check; chart owner | dual review; audit import/correction | mobile Emergency Offline เป็นขายปลีก ไม่ใช่ clinic | D03/G06 และผู้ประกอบวิชาชีพ | replay ไม่สร้าง visit/order ซ้ำ; ops/clinical |
| CF-210 | ทำความสะอาด ฆ่าเชื้อ calibration และซ่อมอุปกรณ์ / clinic ops | ตามบริการ/เครื่องมือ | checklist, instrument, due/owner evidence; clinic ops | ผู้ปฏิบัติ/ผู้ทบทวน; audit acceptance | BMS store checklist ฐาน ไม่ใช่ clinical evidence | D02; เกณฑ์ต้องอนุมัติ | เครื่องไม่พร้อมถูกกันจาก booking/procedure; clinic ops |
| CF-211 | พิมพ์เอกสารคลินิกและ accessibility ในเครื่องจริง / QA | ก่อนเปิด workflow นั้น | print artifact/test evidence; chart owner | print/export เฉพาะ role; audit | desktop/mobile POS tests ผ่าน แต่ไม่มี clinical print | G04/G07, hardware test | Thai/English, mobile widths, screen reader, offline error ตรวจจริง; QA/privacy |
| CF-212 | สุขภาพจิต: applicability และข้อมูลอ่อนไหวเพิ่มเติม / clinical owner | เป้าหมายรอยืนยัน; pilot N/A | form/access policy; EMR owner A/B | care role เฉพาะ; audit read/disclosure | ไม่มี mental-health workflow | ยืนยันบริการและกฎผู้รับข้อมูลก่อน schema | กรณีผู้แทน/ส่งต่อ/ข้อมูลจำกัดผ่าน clinical/privacy review |
| CF-213 | เด็ก: applicability, ผู้ปกครองและ growth / pediatric owner | เป้าหมายรอยืนยัน; pilot N/A | guardian evidence + growth record; A/B | age/representative policy; audit | pilot contact ไม่ให้ portal access | ยืนยันช่วงอายุ/บริการ/ผู้แทน | ผู้ปกครองที่ไม่พิสูจน์สิทธิ์อ่านไม่ได้; pediatric/privacy |
| CF-214 | สูตินรีเวช: applicability และแบบฟอร์มเฉพาะ / clinical owner | เป้าหมายรอยืนยัน; pilot N/A | service-specific form/history; A/B | scope/consent; audit | ไม่มี specialty form | ยืนยันบริการ/ข้อมูล/ผู้เห็นก่อนออกแบบ | ผู้ประกอบวิชาชีพรับรองฟอร์มและ denial; clinical/privacy |
| CF-215 | จักษุ: applicability, ตา/ข้างและผลตรวจ / ophthalmology owner | เป้าหมายรอยืนยัน; pilot N/A | eye/site/measurement/result; A/B | scope/attestation; audit | ไม่มี structured eye workflow | ยืนยันเครื่องมือ/หน่วย/ผล | ตาซ้าย-ขวาไม่สลับและผลแก้มี version; specialist |
| CF-216 | หูคอจมูก: applicability, ข้าง/ตำแหน่ง/ผล / ENT owner | เป้าหมายรอยืนยัน; pilot N/A | site/side/measurement; A/B | scope/attestation; audit | ไม่มี structured ENT workflow | ยืนยันหัตถการ/เครื่องมือ | wrong-side denial และ signer ตาม scope; specialist |
| CF-217 | โรคเรื้อรัง: applicability และแผนติดตามระยะยาว / clinical owner | เป้าหมายรอยืนยัน; pilot N/A | problem/goal/measurement/task; A/B | care-team role; audit | ไม่มี longitudinal structured plan | D02/E01/CF-186 | overdue owner/ผลต่อเนื่องตรวจได้; clinical owner |
| CF-218 | หัตถการเล็ก: applicability, consent/site/วัสดุ / clinical owner | เป้าหมายรอยืนยัน; pilot N/A | consent + performed + lot; A/B และ stock | scope/identity checks; audit | ไม่มี procedure event | D02/CF-181–183 | คน/ข้าง/ล็อตถูกต้องก่อน charge/stock; clinical owner |

## ข้อสรุปจาก inventory

1. Pilot มี path ลงทะเบียน นัดหมาย encounter/ลายเซ็น/ไฟล์ และ charge sheet ในสาขาเดียว แต่ยังไม่มี clinical order, dispensing, longitudinal structured record, report, external integration หรือการใช้จริงที่ได้รับอนุมัติ.
2. BMS มี order/payment/stock เป็นฐาน; การมี service เหล่านี้ไม่ทำให้ workflow คลินิกผ่านโดยอัตโนมัติ.
3. ประเภทบริการทั้งหมดต้องให้เจ้าของคลินิกยืนยัน applicability. EMR ownership ยังไม่ทราบ. ดู [architecture decision ที่ยังรอคำตอบ](clinic-emr-architecture-decision-th.md) และ [backlog ตาม dependency](clinic-full-backlog-th.md).

## หลักฐานตรวจรอบ inventory นี้

- รอบ inventory ที่ commit `1660f209`: `apps/web npm run gate` ผ่าน: release feature check, regression inventory, typecheck, pure tests 4,018 (ผ่าน 4,012, ข้าม 6, fail 0) และ production build. นี่เป็น DB-free gate.
- `apps/desktop npm run lint` และ `npm run test -- --runInBand` ผ่าน 178/178; `apps/mobile npm run typecheck` และ `npm test -- --runInBand --silent` ผ่าน 66 suites, 520/520 tests.
- รอบ inventory ตรวจ relative links, รูปแบบตาราง และ `git diff --check` ผ่าน; ตอนนั้นยังไม่มีการเปลี่ยน service/migration/UI/คู่มือในแอป.
- รอบเพิ่มการถอน emergency grant มี code, migration, UI และคู่มือใหม่ พร้อมผล DB/route test ใน [ผลตรวจรับการถอนสิทธิ์](clinic-emergency-revocation-acceptance-2026-11-26-th.md). **ยังไม่ได้พิสูจน์:** restored BMS schema, browser หลัง login, backup/restore, load และอุปกรณ์จริง. ไม่มี clinical/privacy/accounting sign-off.
- รอบขยาย `CF-001–218` นี้พบว่า `clinicBootstrap()` ส่งรายชื่อ clinician/nurse ให้ cashier และให้ผู้มี RBAC แต่ถูกถอน clinic role อ่าน directory ได้. เพิ่ม DB regression ก่อนแก้ แล้วจำกัดรายการตาม active role พร้อม audit read; `db clinic-pilot` ผ่าน 4/4 บน fixture สังเคราะห์. `apps/web npm run gate` ผ่าน pure 4,018 (ผ่าน 4,012, ข้าม 6) และ build; desktop lint/178 tests, mobile typecheck/66 suites/520 tests ผ่าน. Browser 1440×900 และ 390×844 ยืนยันเพียง unauthenticated redirect ของ `/admin/clinic` และ `/admin/manual/clinic` ไป login พร้อม `next`; **ยังไม่ได้ตรวจหน้า clinic/manual หลัง login**. ดู [บันทึกรอบขยาย](clinic-phase1-acceptance-2026-11-26-th.md#รอบขยาย-inventory-และ-bootstrap-บุคลากร).
