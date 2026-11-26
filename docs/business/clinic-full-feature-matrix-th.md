# บัญชีฟีเจอร์คลินิกผู้ป่วยนอกทั้งระบบ

สถานะการตรวจ: 26 พฤศจิกายน 2026, branch `codex/clinic-outpatient-phase1`. นี่คือ inventory จาก code path ใน repo และหลักฐานการทดสอบที่บันทึกไว้ใน [ผลตรวจรับระยะ 1](clinic-phase1-acceptance-2026-11-26-th.md) ไม่ใช่คำรับรองให้ใช้ข้อมูลผู้ป่วยจริง. `BMS_CLINIC_PILOT_TENANTS` ยังปิดเป็นค่าเริ่มต้น. ผลรอบก่อนเป็นหลักฐานย้อนหลัง; รอบ inventory นี้ยังไม่ได้รัน DB/browser ใหม่.

## วิธีอ่าน

- **ทั่วไป** = ต้องกำหนดก่อนนำระบบไปใช้คลินิกผู้ป่วยนอกทั่วไป; **ตามบริการ** = ทำเมื่อคลินิกให้บริการนั้น; **เสริม** = ต้องตัดสินตามรูปแบบปฏิบัติงาน. ความจำเป็นไม่ใช่คำวินิจฉัยกฎหมาย.
- **พิสูจน์แล้ว** หมายถึง path ที่ระบุผ่านการทดสอบตามขอบเขตหลักฐานเท่านั้น; ไม่มี workflow คลินิกใดพิสูจน์ production readiness. **ฐาน** = BMS มีระบบธุรกิจ แต่ยังไม่ผูกกับคลินิก; **pilot** = มี path คลินิกที่ปิด flag; **บางส่วน** = มีชิ้นส่วนแต่ยังไม่ครบ workflow; **ไม่มี** = ไม่พบ path คลินิกในชุดไฟล์ที่ตรวจ.
- รหัสหลักฐาน: `C` = `apps/web/lib/bms/clinic/`; `R` = `apps/web/app/api/bms/clinic/route.ts` และ `attachments/route.ts`; `U` = `apps/web/app/(admin)/admin/clinic/page.tsx`; `M` = `db/migrations/10.141__bms_clinic_outpatient_pilot.sql`, `10.142__bms_clinic_reschedule_idempotency.sql`, `10.143__bms_clinic_emergency_access_revocation.sql`; `T` = `scripts/clinic-pilot-*.test.mts`; `O` = `apps/web/lib/bms/orders.ts`; `P` = `apps/web/lib/bms/payments.ts`; `S` = `apps/web/lib/bms/stock.ts`, `stockTransfers.ts`, `stockCounts.ts`; `Q` = `apps/web/lib/bms/permissions.ts`; `G` = `apps/web/graphql/`, `schema.graphql`, `apps/mobile/`, `apps/desktop/`; `A` = `apps/web/lib/bms/tools/catalog.ts`, `packages/realtime/src/events.ts`. เมื่อระบุ `ไม่มี C/R/U/M/T` หมายถึงการสำรวจ path เหล่านี้ ไม่ใช่การพิสูจน์ว่าไม่มีโค้ดที่อื่นใน repo.
- เกณฑ์รับมอบทุกแถวต้องใช้ข้อมูลสังเคราะห์, tenant/role denial และ audit ตามความเสี่ยง. งานที่แตะการรักษาต้องมีผู้ประกอบวิชาชีพตรวจรับ; ข้อกำหนดข้อมูลส่วนบุคคลและภาษีต้องมีเจ้าของเรื่องยืนยันก่อนเปิดจริง.

| ฟีเจอร์ / ผู้ใช้หลัก | ชั้น | สถานะ | หลักฐาน | ช่องว่าง / dependency / ความเสี่ยง | เกณฑ์รับมอบที่ทดสอบได้ |
| --- | --- | --- | --- | --- | --- |
| **1. สถานพยาบาลและบุคลากร** | | | | | |
| สถานพยาบาลและสาขา / ผู้ดูแล | ทั่วไป | บางส่วน | C/access.ts; M; R/U | pilot จำกัดหนึ่ง active branch; ข้อมูลใบอนุญาตสถานพยาบาลยังไม่เป็นทะเบียนคลินิก | เลือกสาขาจาก server; ปฏิเสธสาขาอื่นและทดสอบการเปลี่ยนสาขา |
| ประเภทบริการ / ผู้ดูแล | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T | ต้องให้เจ้าของคลินิกระบุประเภทที่เปิดจริง | ประเภทบริการกำหนด workflow และ permission โดยไม่เปิดฟีเจอร์ที่ไม่เกี่ยว |
| ห้องตรวจและทรัพยากร / ผู้จัดตาราง | ทั่วไป | บางส่วน | C/appointments.ts; M exclusion | มี room code กันซ้อน แต่ไม่มีทะเบียนห้อง/อุปกรณ์ | จองห้องหรืออุปกรณ์ชนกันพร้อมกันได้หนึ่งรายการเท่านั้น |
| เวลาเปิด วันหยุด / ผู้จัดตาราง | ทั่วไป | ไม่มี | C/appointments.ts; ไม่มี M ตารางเวลา | ปฏิทินยังไม่คำนวณเวลาว่างจริง | จองนอกเวลาหรือวันหยุดถูกปฏิเสธ; timezone Asia/Bangkok |
| ผู้ประกอบวิชาชีพและประเภทวิชาชีพ / ผู้ดูแล | ทั่วไป | บางส่วน | C/access.ts; M staff; R/U | pilot มี CLINICIAN กับเลขใบอนุญาตที่กรอกเอง; ยังไม่ตรวจหน่วยงานออกใบอนุญาต | บทบาท/วิชาชีพ/สถานะถูกตรวจทุกคำสั่ง; เจ้าของคลินิกตรวจหลักฐาน |
| ตารางเวรและผู้ดูแลแทน / ผู้จัดตาราง | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T | การมี role ไม่พิสูจน์ว่าอยู่เวร | ผู้ตรวจนอกเวร/ผู้ดูแลแทนที่หมดอายุเปิด visit ไม่ได้ |
| รายการบริการและราคาที่ผู้ป่วยเห็น / ผู้ป่วย | ทั่วไป | ฐาน | O; catalog UI; C/billing.ts | catalog การค้าไม่ใช่รายการค่ารักษาที่อนุมัติ | หน้าเผยแพร่ราคาแสดง SKU/สาขา/เวลามีผลตามรายการที่บัญชีอนุมัติ |
| **2. ทะเบียนผู้ป่วยและตัวตน** | | | | | |
| Patient UUID/HN แยก CRM / registrar | ทั่วไป | pilot | C/patients.ts; M patients/HN; R/U; T | ต้องพิสูจน์บน restored schema และกำหนด EMR เจ้าของข้อมูล | ลงทะเบียนซ้ำไม่รวม chart; tenant อื่นอ่าน HN ไม่ได้ |
| ข้อมูลระบุตัวและติดต่อ / registrar | ทั่วไป | บางส่วน | C/patients.ts register/verified contact; M patients/contacts; R/U; T | ยังไม่มี API แก้ patient profile หรือ revision ที่พิสูจน์ได้; วิธีพิสูจน์ตัวตนต้องอนุมัติ | แก้ข้อมูลได้เฉพาะ role และมี revision/audit ที่อ่านย้อนหลังได้ |
| ค้นชื่อซ้ำและตรวจคนก่อนรวม / registrar | ทั่วไป | บางส่วน | C/patients.ts search/register; R/U | ชื่อ/เบอร์ซ้ำไม่ merge; ยังไม่มี workflow ตรวจ duplicate อย่างเป็นทางการ | ผลค้น bounded; ข้อมูลเหมือนกันไม่รวมอัตโนมัติ; คนอนุมัติพร้อมเหตุผล |
| ผู้ปกครอง/ผู้แทน/ผู้ติดต่อ / registrar | ทั่วไป | บางส่วน | C/patients.ts verified contact; M | contact ไม่ใช่สิทธิ์อ่าน chart; ต้องกำหนดหลักฐานความสัมพันธ์ | ผู้ติดต่อที่ไม่มีสิทธิ์เปิดข้อมูลไม่ได้; ถอนความสัมพันธ์แล้วถูกปฏิเสธ |
| ผู้จ่ายเงินต่างจากผู้ป่วย / cashier | ทั่วไป | ไม่มี | C/billing.ts; O/P | pilot charge sheet ไม่มี payer identity contract | ใบเรียกเก็บ/ใบเสร็จแสดงผู้จ่ายถูกคนโดยไม่เปิด chart |
| นำเข้าประวัติพร้อม provenance / เวชระเบียน | เสริม | ไม่มี | ไม่มี C/R/U/M/T | ต้องตัดสิน EMR และการจับคู่ตัวตนก่อน import | import ซ้ำ idempotent; ambiguous match เข้าคิวตรวจคน; provenance คงอยู่ |
| **3. นัดหมายและตารางตรวจ** | | | | | |
| ตารางผู้ตรวจและช่องว่าง / registrar | ทั่วไป | บางส่วน | C/appointments.ts; M; U | มีรายการนัด ไม่ได้คำนวณ availability จากเวร/วันหยุด | แสดงเฉพาะช่วงที่เปิดจริง; จองชนและรายการถูกตัดไม่แสดงว่าโล่ง |
| วันหยุด ห้อง อุปกรณ์ / registrar | ทั่วไป | บางส่วน | M room exclusion; C/appointments.ts | วันหยุด/อุปกรณ์ไม่มี | ตรวจ conflict ทุก resource ใน DB เมื่อส่งพร้อมกัน |
| จองนัด / registrar | ทั่วไป | pilot | C/appointments.ts; R/U/M/T | ต้อง browser หลัง login และ load test | create/retry key เดิมคืนรายการเดิม; role/tenant denial |
| Walk-in / registrar | ทั่วไป | บางส่วน | C/appointments.ts check-in; U | ไม่มี workflow walk-in แยก | walk-in ลงทะเบียน/เช็กอินได้พร้อม audit โดยไม่สร้างเวลานัดปลอม |
| นัดติดตาม / clinician, registrar | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T | ยังไม่ผูกแผนติดตามกับนัด | นัดถัดไปอ้าง visit ต้นทางและเตือนงานค้างได้ |
| เลื่อน/ยกเลิก/no-show / registrar | ทั่วไป | pilot | C/appointments.ts; R/U; M 10.142; T | ยังต้อง load/browse ร่วม flow จริง | retry เลื่อนเก่าไม่ย้อนนัดใหม่; cancel/no-show ไม่สร้าง encounter |
| Waitlist / registrar | เสริม | ไม่มี | ไม่มี C/R/U/M/T | ต้องกำหนดนโยบายเลื่อนคิว | รับคนจาก waitlist เพียงหนึ่งคนเมื่อ slot ว่างพร้อมกัน |
| เตือนนัด/จองออนไลน์ / ผู้ป่วย | เสริม | ไม่มี | ไม่มี C/R/U/M/T; A ไม่มี clinic tool | ต้องมี verified channel/consent และขอบเขตข้อมูล | ส่งเตือนถูกคนครั้งเดียว; link หมดอายุ; ไม่มี chart ในข้อความ |
| **4. ต้อนรับ เช็กอิน และคิว** | | | | | |
| ตรวจตัวตน/ผู้จ่าย/สิทธิหน้ารับบริการ / registrar | ทั่วไป | บางส่วน | C/patients.ts; C/appointments.ts | ไม่มี payer/coverage verification | check-in บันทึกผู้ตรวจหลักฐานและปฏิเสธ mismatch |
| แบบข้อมูลก่อนพบผู้ตรวจ / nurse | ทั่วไป | ไม่มี | C/encounters.ts draft เท่านั้น | ต้องอนุมัติฟอร์มและผู้เห็นข้อมูล | field/หน่วย/ผู้บันทึกครบและ clinician รับรองก่อนใช้ |
| เช็กอินและคิวรอ / registrar | ทั่วไป | บางส่วน | C/appointments.ts transition; R/U/M | มี CHECKED_IN แต่ไม่มี queue ordering | check-in ซ้ำ idempotent; ลำดับคิวไม่เผยข้อมูลข้ามบทบาท |
| ส่งต่อพยาบาล/แพทย์ / registrar | ทั่วไป | บางส่วน | C/encounters.ts assignNurse; M care team | ยังไม่มี handoff state/ack | ผู้รับงานยืนยันรับ; revoked user เข้าไม่ได้ |
| กำลังตรวจ/เสร็จ/รอจ่ายยา/รอคิดเงิน/ปิด visit / ทีมคลินิก | ทั่วไป | บางส่วน | C/encounters.ts signed; C/billing.ts | ไม่มี visit state machine ครบ; ไม่มี dispense | ทุก transition มีผู้ทำ/เวลา; ห้ามปิดเมื่อมีงานค้างตามกติกาที่อนุมัติ |
| นัดถัดไปและงานติดตามค้าง / clinician | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T | ต้องแยกงานทางคลินิกจาก reminder การค้า | งานค้างมี owner/due/ack และตามย้อนหลังได้ |
| **5. ประวัติสุขภาพต่อเนื่อง** | | | | | |
| โรคประจำตัว/problem list / clinician | ทั่วไป | ไม่มี | C/encounters.ts note text; ไม่มี M structured longitudinal | ต้องตัดสิน EMR; free text ใช้แทน list ไม่ได้ | version/provenance/ผู้ยืนยัน; แก้ไขไม่ลบประวัติ |
| แพ้ยาและยาที่ใช้อยู่ / clinician | ทั่วไป | บางส่วน | C/encounters.ts allergies/medicationPlan text | ไม่มี reconciliation หรือ structured allergy/med list | ผู้ตรวจเห็นข้อมูลล่าสุดพร้อม provenance; ทดสอบ conflict/unknown |
| ผ่าตัด/ครอบครัว/สังคม/วัคซีน / clinician | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T structured | ฟิลด์และสิทธิ์ขึ้นกับบริการ | ประวัติที่จำเป็นตามแบบฟอร์มถูกเก็บพร้อมผู้บันทึก/เวลา |
| Visit ย้อนหลัง / clinician, nurse | ทั่วไป | pilot | C/encounters.ts listClinicPatientEncounters; R/U; T | ยังไม่ได้พิสูจน์ performance/restore | care team เห็น visit ผู้ป่วยตนแบบ bounded; คนอื่นถูกปฏิเสธ |
| สัญญาณเตือนและแผนต่อเนื่อง / clinician | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T structured | ต้องให้ผู้ประกอบวิชาชีพนิยาม severity/owner | งานสำคัญแสดงผู้รับผิดชอบและหลักฐานการรับทราบ |
| แยกข้อความกับข้อมูลโครงสร้าง / clinician | ทั่วไป | บางส่วน | C/encounters.ts validateClinicRecord; M draft_record | draft JSON มี field ข้อความ; ไม่มี vital/diagnosis code model | query structured field ได้โดยไม่ parse prose; migration/test ครบ |
| **6. EMR ต่อ visit** | | | | | |
| เหตุที่มา/ประวัติอาการ / clinician | ทั่วไป | pilot | C/encounters.ts chiefComplaint/history; R/U/M/T | ฟอร์มยังไม่ตรวจรับทางวิชาชีพ | ลงนามบังคับ field ที่อนุมัติและรักษา version |
| สัญญาณชีพพร้อมหน่วย เวลา ผู้บันทึก / nurse | ทั่วไป | บางส่วน | C/encounters.ts vitals text | ไม่มี structured unit/observation metadata | บันทึกค่า+หน่วย+เวลา+actor; ค่าผิดชนิดถูกปฏิเสธ |
| ตรวจร่างกาย/ประเมิน/วินิจฉัย/แผน / clinician | ทั่วไป | pilot | C/encounters.ts; R/U/M/T | เป็นข้อความ pilot; taxonomy/form ยังไม่อนุมัติ | clinician ทดสอบกรณีจริงสังเคราะห์และเซ็นแบบฟอร์ม |
| หัตถการที่ทำจริง / clinician | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T procedure event | plan text ไม่พิสูจน์ว่าได้ทำ | procedure event มีผู้ทำ/เวลา/ผล/วัสดุ และแยก charge |
| บันทึกแพทย์/พยาบาลตามบทบาท / ทีมรักษา | ทั่วไป | บางส่วน | C/access.ts role; C/encounters.ts assignNurse | ไม่มี nursing note แยก | เขียน/อ่านตาม role และ care relationship; audit ทุกการอ่าน |
| ฟอร์มตามประเภทคลินิก / เจ้าของคลินิก | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T | ต้องยืนยันประเภทและผู้ตรวจรับ | ฟอร์มเวอร์ชันที่อนุมัติใช้ได้ตามบริการ; เก่าอ่านได้ |
| Draft → signed → addendum / clinician | ทั่วไป | pilot | C/encounters.ts; M signed_notes/guard; R/U/T | restored DB และ browser ยังไม่พิสูจน์ | version conflict ไม่ทับ; signed immutable; addendum มีเหตุผล/ผู้ลงนาม/เวลา |
| ผู้รักษา/ผู้ลงนาม/เวลา/สรุปหลังตรวจ / clinician | ทั่วไป | บางส่วน | M encounters/signed_notes; C/encounters.ts | summary/export ยังไม่มี | เอกสารแสดง actor/time จาก server และแก้ signed copy ไม่ได้ |
| ผู้ประกอบวิชาชีพตรวจรับฟอร์ม/กรณีทดสอบ / clinical owner | ทั่วไป | ไม่มี | acceptance ระยะ 1 ระบุ gate | ยังไม่มีลายเซ็นการตรวจรับ | มีชุดกรณีทดสอบลงชื่ออนุมัติและ replay บนเวอร์ชันฟอร์ม |
| **7. คำสั่งรักษา** | | | | | |
| คำสั่งยา / clinician | ทั่วไป | ไม่มี | C/encounters.ts medicationPlan text; ไม่มี order table | ข้อความแผนยาไม่ใช่ใบสั่ง | order มีผู้สั่ง/เวลา/status; ไม่มี stock/charge จากการสั่งอย่างเดียว |
| คำสั่งแล็บ/ภาพ/หัตถการ/ส่งต่อ / clinician | ตามบริการ | ไม่มี | C/encounters.ts referral text; ไม่มี order table | ต้องกำหนดบริการและปลายทาง | state transition/status/revision แยกชนิด ตรวจ role |
| ผู้สั่ง/ผู้รับ/ผู้ทำ/ยกเลิก/ประวัติ / ทีมรักษา | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T order lifecycle | ต้องมี audit ที่ไม่ลบหลักฐาน | cancel/reorder เก็บ provenance; retry ไม่สร้างซ้ำ |
| งานค้างอ่านผล/ผลสำคัญ / clinician | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T | ไม่มี result acknowledgement | ผลสำคัญถึงผู้รับผิดชอบและมี read receipt/escalation |
| **8. จ่ายยาและรักษาจริง** | | | | | |
| ตรวจยาที่ใช้อยู่/ใบสั่ง/ทบทวน / เภสัชกรหรือผู้มีหน้าที่ | ตามบริการ | ไม่มี | C note text; pharmacy README เป็นงานร้านยาแยก | ต้องให้ผู้ประกอบวิชาชีพกำหนด workflow | คำสั่งและ review ถูกคน พร้อมหลักฐานก่อนจ่าย |
| จ่ายยาจริง / ผู้จ่ายยา | ตามบริการ | ไม่มี | ไม่มี C/M dispensing; S เป็น stock ทั่วไป | ห้ามใช้ข้อความแผนแทนจ่ายจริง | dispense event อ้าง order/patient/encounter/actor และ retry ไม่ซ้ำ |
| ให้ยา/ใช้วัสดุจริงพร้อมล็อต / ผู้ปฏิบัติ | ตามบริการ | ไม่มี | S; ไม่มี C/M administration | ต้องออกแบบ lot trace และ transaction | ใช้จริงตัดล็อตพร้อม movement ใน transaction เดียว; rollback ครบ |
| ฉลาก/คำแนะนำที่รับรอง / ผู้มีวิชาชีพ | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T | ต้องตรวจภาษากับผู้ประกอบวิชาชีพ | พิมพ์จากฉบับอนุมัติ มีผู้รับรอง/เวอร์ชัน |
| คืนยา/เหตุไม่พึงประสงค์/ประวัติจ่าย / ทีมรักษา | ตามบริการ | ไม่มี | O/P return เป็นการค้า; ไม่มี C event | คืนเงินไม่ใช่การคืนยาทางคลินิก | reverse มีเหตุผลและ lot trail; adverse event ติดตามได้ |
| แยก prescribe/dispense/administer / ทีมรักษา | ตามบริการ | ไม่มี | ไม่มี C/M event models | ความเสี่ยงตัดสต็อกก่อนจ่ายจริง | สาม event แยกกัน; สั่งอย่างเดียวไม่ตัด stock/charge |
| **9. แล็บและภาพวินิจฉัย** | | | | | |
| สั่งตรวจ/สิ่งส่งตรวจ/สถานะ / clinician, lab | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T | ต้องกำหนด LIS/in-house | คำสั่งและ specimen ID มี lifecycle/idempotency |
| ผลตรวจ/ผู้รับรอง / lab, clinician | ตามบริการ | ไม่มี | C/attachments.ts เก็บไฟล์ได้ แต่ไม่มี result model | file ไม่ใช่ structured/validated result | ผลมีผู้รับรอง/เวลา/เวอร์ชัน; ห้ามแก้ผลที่รับรองโดยตรง |
| รายงาน/ภาพ/ผลสำคัญ/read acknowledgement / clinician | ตามบริการ | บางส่วน | C/attachments.ts; R file | ไม่มี critical result task/ack | แจ้งเฉพาะผู้มีสิทธิ์; บันทึกรับทราบและ escalation |
| LIS/PACS connector / integration owner | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T connector | ต้องทราบระบบ/สัญญา/API จริง | replay/out-of-order/result correction และ tenant denial ผ่าน |
| **10. เอกสารทางคลินิก** | | | | | |
| ใบยินยอม/ใบสั่งยา/ใบรับรอง/ใบส่งตัว/คำแนะนำ / clinician | ตามบริการ | ไม่มี | C/encounters.ts referral text; C/attachments.ts | ข้อความ/ไฟล์แนบไม่ใช่เอกสารที่ออกและลงนาม | template/version/ผู้ลงนาม/recipient/การยกเลิกทดสอบได้ |
| ผลตรวจ/ภาพ/สแกน/เอกสารลงนาม / ทีมรักษา | ทั่วไป | บางส่วน | C/attachments.ts; M attachments; R file; T | pilot จำกัด PDF/PNG/JPEG ≤2 MiB; ไม่มี document lifecycle | upload/list/download จำกัด tenant+role+encounter; metadata/provenance ครบ |
| พิมพ์/ส่งออก/เปิดอ่านย้อนหลัง / ทีมรักษา | ทั่วไป | บางส่วน | R download; C/access.ts audit | print/export clinical-specific ยังไม่มี | export ระบุ actor/time/purpose; revoked user ถูกปฏิเสธ |
| ห้าม generic file route / security owner | ทั่วไป | pilot | C/attachments.ts byte store; R attachment route; M; T | ต้อง runtime ทดสอบทุก route ในสภาพแวดล้อมครบ | เดา ID, generic route, emergency access และถอน role ไม่เปิดไฟล์ |
| **11. บริการและราคา** | | | | | |
| ค่าตรวจ/หัตถการ/ยา/เวชภัณฑ์/แพ็กเกจ / บัญชี | ทั่วไป | บางส่วน | C/billing.ts; O; catalog UI | pilot รับเฉพาะ reviewed NON_STOCK/ONLINE_ORDER/VAT N | matrix SKU ประเภทบริการได้รับอนุมัติ; unsupported line ถูกปฏิเสธ |
| ราคาตามสาขา/ประกาศราคา / ผู้ป่วย, บัญชี | ทั่วไป | ฐาน | O; migration 10.116 price windows | ยังไม่ผูก catalog ที่ประกาศกับ clinic charge | เวลา/สาขาเดียวกันแสดงราคาเดียวกันในประกาศ/charge/order |
| ประมาณค่าใช้จ่าย/ส่วนลดและอนุมัติ / cashier | เสริม | ไม่มี | O discount ทั่วไป; ไม่มี C estimate | ต้องกำหนด consent/approval และ freeze | estimate แยกจาก bill; ส่วนลดมี approver/audit |
| ประวัติราคาและกฎภาษี / บัญชี | ทั่วไป | บางส่วน | C/billing.ts reviewed price/VAT; O | VAT N pilot ไม่ครอบคลุมทุกบริการ; ต้องให้บัญชีอนุมัติ | ราคา/ภาษีที่ใช้ตรึงพร้อม effective time; rollback เมื่อเปลี่ยน |
| **12. คิดเงินและรับชำระ** | | | | | |
| Charge sheet ผูก visit/บริการจริง / cashier | ทั่วไป | pilot | C/billing.ts; M charge_sheets/lines; R/U/T | ยังไม่เชื่อม procedure/dispense event | สร้างเฉพาะงานที่ยืนยันทำ; ไม่มี clinical prose ใน order |
| คนทบทวนก่อนสร้าง order/ยอด backend / cashier | ทั่วไป | pilot | C/billing.ts; O createOrderInTx; T | ต้องพิสูจน์ transaction บน restored DB | reviewed catalog/price/status ยังตรง; ยอดต่าง rollback ครบ |
| ผู้จ่ายต่างคน/มัดจำ/จ่ายบางส่วน/ลูกหนี้ / cashier | ทั่วไป | ฐาน | P submitPartialPayment; O; AR 9.30 | ไม่มี clinic payer mapping/reconciliation | payer/receipt/AR ถูกคน; retry และ partial ledger balance ถูกต้อง |
| วิธีรับเงิน/ยกเลิก/คืน/เอกสารเงินภาษี / cashier, บัญชี | ทั่วไป | ฐาน | P; O cancel/return; tax modules | clinic end-to-end ไม่พิสูจน์; ภาษีต้องอนุมัติ | submit/confirm/void/refund/receipt/invoice ทดสอบบน restored DB |
| กระทบยอด clinical กับ payment / cashier | ทั่วไป | บางส่วน | C/billing.ts closed-order check; P | สองธุรกรรมอาจแยก; ยังไม่มี reconciliation worklist | ค้น mismatch ทุกชนิด, แก้โดยคน, audit และไม่สร้าง order ซ้ำ |
| Retry ไม่คิดเงินซ้ำ / cashier | ทั่วไป | บางส่วน | C/billing.ts order retry; O/P idempotency; T | full payment retry ยังไม่พิสูจน์ร่วมกัน | lost response/replay คืน ID เดิมทั้ง order/payment |
| **13. คลังยาและเวชภัณฑ์** | | | | | |
| ทะเบียนยา/หน่วย/แพ็ก/บาร์โค้ด/ล็อต/FEFO / stock owner | ตามบริการ | ฐาน | catalog, S, pharmacy README | retail/pharmacy model ไม่ใช่ clinic formulary | ผู้เชี่ยวชาญอนุมัติ catalog; lot/expiry/pack ที่เลือกตรวจได้ |
| จัดซื้อ/รับ/ย้าย/นับ/เสีย/กักกัน / stock owner | ตามบริการ | ฐาน | S; purchase modules; 10.107 transfer-lot WIP | transfer lot rollout ยัง WIP; ไม่มี clinic linkage | ทุก movement tenant/branch/lot ถูกต้อง; denial/rollback |
| ตัดเมื่อจ่าย/ใช้จริง / dispenser | ตามบริการ | ไม่มี | S; ไม่มี C dispensing/admin event | เสี่ยงตัดก่อน/หลังผิดจุด | event จริงและ movement atomic; prescribe อย่างเดียวไม่ตัด |
| Trace lot ถึง patient/encounter / safety owner | ตามบริการ | ไม่มี | ไม่มี C/M lot-patient link | จำเป็นต่อ recall | ค้นล็อต→ผู้ป่วยและผู้ป่วย→ล็อตได้ตามสิทธิ์ |
| เก็บรักษาเฉพาะทาง/เรียกคืน / safety owner | ตามบริการ | ไม่มี | S quality hold ทั่วไป; ไม่มี C workflow | ขึ้นกับรายการยา/วัคซีน | quarantine/recall ระบุล็อตและผู้ได้รับผลกระทบได้ |
| **14. สื่อสารผู้ป่วย** | | | | | |
| ยืนยัน/เตือน/เลื่อนนัด/ก่อน-หลังตรวจ/ติดตาม / registrar | เสริม | ไม่มี | ไม่มี C/R/U/M/T; messaging เป็นฐานทั่วไป | verified channel/consent/approved template | ส่งครั้งเดียวถูกช่องทาง; ไม่มี chart/diagnosis ในข้อความ |
| แจ้งผลพร้อมโดยไม่เผยผล / clinician | ตามบริการ | ไม่มี | ไม่มี C/R/U/M/T | ต้องมี result status และ identity check | แจ้งเพียงความพร้อม; ผลอ่านผ่านช่องทางที่อนุมัติ |
| แยกบริการกับ marketing / privacy owner | ทั่วไป | บางส่วน | A no clinic tools; CRM/Inbox ทั่วไป | ยังไม่พิสูจน์ data lineage runtime | opt-out การตลาดไม่ปิดข้อความบริการ; clinical data ไม่เข้า campaign |
| ตอบกลับ/ช่องทางที่เลือก / ผู้ป่วย | เสริม | ฐาน | Inbox/chat modules | ไม่ใช่ secure clinic channel | reply ผูกนัดอย่างปลอดภัยโดยไม่สร้าง chart จาก chat |
| Patient portal/ผู้ปกครอง / ผู้ป่วย | เสริม | ไม่มี | C verified contact; ไม่มี portal | ต้องพิสูจน์ตัวตนและนโยบายผู้แทน | link/session/relationship/revocation ถูกทดสอบก่อนเปิด chart |
| **15. สิทธิ์ ความปลอดภัย วงจรข้อมูล** | | | | | |
| RBAC + active role + care relationship / ทีมรักษา | ทั่วไป | pilot | C/access.ts/encounters.ts; Q; R/M/T | ต้องพิสูจน์ทุก read/write และ revoked ระหว่างคำขอ | role matrix รวมต่าง tenant/branch ผ่านบน restored DB/browser |
| Admin/cashier/device/PIN ไม่เปิด chart / security owner | ทั่วไป | pilot | C/access.ts; R; G ไม่มี clinic GraphQL | ต้อง runtime ตรวจ support/device paths | บัญชีเหล่านี้อ่าน note/file ไม่ได้แม้มี ID |
| Emergency access เหตุผล/15 นาที/audit / clinician | ทั่วไป | pilot | C/encounters.ts; M break_glass + `10.143`; T access DB/route | ถอน grant ก่อนหมดเวลาและ expiry ผ่านบน fixture; restored schema/browser/incident review ยังไม่พิสูจน์ | หมดอายุหรือถอนแล้วไม่ใช้ grant ฉุกเฉินอ่าน chart; care relationship ตามปกติยังมีสิทธิ์ของตน; ไม่ขยายไปไฟล์ |
| Audit read/write/sign/export/file / security owner | ทั่วไป | บางส่วน | C/access.ts audit; R; M signed notes | export ยังไม่มี; audit store ไม่ครบใน fixture | ตรวจ chain ของ action/actor/time/target โดยไม่มี clinical prose |
| Support/impersonation/tenant/session/encryption / security owner | ทั่วไป | บางส่วน | R auth; M FORCE RLS; C/clinicTx | support, key management และ session runtime ยังไม่พิสูจน์ | impersonation ไม่ข้าม care role; session revoke/tenant denial |
| Retention/legal hold/data request / privacy owner | ทั่วไป | ไม่มี | ไม่มี C/R/U/M/T policy | ต้องให้ผู้รับผิดชอบกำหนดฐาน/ระยะก่อน code | policy version/hold/export/delete ตามกติกาที่อนุมัติ |
| Backup/restore/incident response / ops, privacy owner | ทั่วไป | ไม่มี | acceptance ระยะ 1 ระบุ gate | fixture ไม่พิสูจน์ restore จริง | restore drill ตรวจข้อมูล/ไฟล์/audit ครบและ RTO ตามที่อนุมัติ |
| ไม่รั่วไป CRM/Inbox/marketing/AI/log/report / security owner | ทั่วไป | บางส่วน | C separation; A; data-flow map | code review ยังไม่ใช่ runtime proof | synthetic sentinel ไม่พบในทุก sink ที่ไม่ได้อนุญาต |
| **16. รายงานและคุณภาพ** | | | | | |
| ทะเบียน OPD/visit/คิว/เวลารอ/no-show / clinic manager | ทั่วไป | บางส่วน | C appointment/encounter; ไม่มี clinic report | ไม่มี timestamps/states ครบ | bounded report นับตรง source และจำกัด role/tenant |
| ภาระผู้ตรวจ/งานค้างผล/ยา/หัตถการ / clinical manager | ตามบริการ | ไม่มี | ไม่มี C report/order events | ต้องมี clinical event models ก่อน | report ตรง source และไม่แสดง chart แก่ cashier |
| รายได้/ค่ารักษา/คืน/AR/ผู้จ่าย / บัญชี | ทั่วไป | ฐาน | O/P/report modules | ไม่ผูก payer/visit ครบ | กระทบยอดรายงานกับ order/payment/refund แบบ synthetic |
| หมดอายุ/recall/adverse event/access / safety owner | ตามบริการ | บางส่วน | S; C/access.ts audit | ไม่มี patient-lot/adverse event/report | drill จากล็อตหรือ event ถึงผู้รับผิดชอบครบ |
| รายงาน PHI สิทธิ์เฉพาะ / security owner | ทั่วไป | ไม่มี | ไม่มี clinic report route | report การค้าห้ามมี clinical data | role/tenant denial และ export audit ครบ |
| **17. การเชื่อมระบบ** | | | | | |
| EMR/HIS เดิม / integration owner | เสริม | ไม่มี | ไม่มี C/R/U/M/T connector | ยังไม่ทราบว่ามี EMR เดิมหรือไม่ | ผ่าน contract/version/identity/reconciliation ก่อน sync จริง |
| LIS/PACS/ประกัน/payment/อุปกรณ์ / integration owner | ตามบริการ | บางส่วน | P payment ฐาน; G POS print; ไม่มี clinic connectors | ต้องรู้ vendor/contract และประเภทบริการ | แต่ละ connector มี sandbox denial/retry/consent/ownership test |
| External reference tenant/branch/version/auth / integration owner | ทั่วไป | ไม่มี | ไม่มี C/M external reference | ห้ามเริ่ม sync ก่อนเลือก source of truth | ref unique ภายใน tenant/branch; forged payload ถูกปฏิเสธ |
| Idempotency/outbox/out-of-order/reconciliation / integration owner | ทั่วไป | บางส่วน | C appointment/order keys; realtime outbox ทั่วไป | ไม่มี clinic integration inbox/outbox | duplicate/out-of-order/retry ได้ผลเดียวและ mismatch มีคิวคนแก้ |
| ขอบเขตข้อมูลระหว่างระบบ / privacy owner | ทั่วไป | บางส่วน | data-flow map; C separation | ต้องให้เจ้าของข้อมูลอนุมัติ payload จริง | contract test ปฏิเสธ note/diagnosis ใน commerce payload |
| **18. ประสบการณ์และปฏิบัติการ** | | | | | |
| Workspace registrar/nurse/clinician/cashier / ผู้ใช้คลินิก | ทั่วไป | บางส่วน | U/R; manual/clinic | pilot หน้าเดียว; browser ตามบทบาทยังไม่ตรวจ | task ตาม role หาได้และ denied state ชัดที่ desktop/mobile |
| Backend เดิมแต่ clinic boundary แยก / architect | ทั่วไป | pilot | C/R/M/Q; O/P reuse | ต้องทำ contract ทุก path เมื่อขยาย | SQL อยู่ service; tenant/role enforced; ไม่มี chart ใน POS |
| ไทย/อังกฤษ/desktop/mobile/performance / ผู้ใช้ | ทั่วไป | บางส่วน | U/i18n; acceptance ระยะ 1 | public/redirect browser ผ่าน; หลัง login/load ยังไม่พิสูจน์ | i18n parity; browser 2 widths; search/history latency ตาม SLO ที่ตกลง |
| Printer/scanner/outage/monitoring/manual / ops | ทั่วไป | บางส่วน | desktop/mobile POS; manual/clinic; system-health | ไม่มี clinic print/outage procedure หรือ hardware test | ทดสอบเครื่องจริง, drill downtime/recovery, คู่มือตรง behavior |
| Multi-branch สิทธิ์/ข้อมูลข้ามสาขา / clinic manager | ตามบริการ | ไม่มี | M/C one branch; S branch stock ฐาน | HN/chart/booking policy ต้องตัดสิน | branch isolation และ cross-branch care transfer ทดสอบครบ |

## ฟีเจอร์ตามประเภทบริการ

**Applicability:** สำหรับ pilot ปัจจุบัน ทั้ง 10 กลุ่มเป็น **not applicable** เพราะขอบเขต pilot ไม่รับ workflow เฉพาะทางเหล่านี้. สำหรับคลินิกเป้าหมายสถานะยัง **รอยืนยัน** เพราะยังไม่มีรายการบริการที่เจ้าของคลินิกยืนยัน. ให้ถือเป็นงาน **ตามบริการ**; เปลี่ยนเป็น applicable เมื่อยืนยันว่ามีบริการนั้น. ถ้าตอบว่าไม่มี ให้บันทึก not applicable พร้อมชื่อผู้ยืนยันและวันที่ แทนการตีความจากโค้ด.

| ประเภท / ฟีเจอร์ / ผู้ใช้ | Applicability | สถานะและหลักฐาน | Dependency / ความเสี่ยง | เกณฑ์รับมอบที่ทดสอบได้ |
| --- | --- | --- | --- | --- |
| ทันตกรรม: ผังฟัน / ทันตแพทย์ | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องกำหนด notation/ฟอร์ม | บันทึกซี่/พื้นผิวพร้อม version และ role |
| ทันตกรรม: หัตถการรายซี่ / ทันตแพทย์ | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องมี procedure event | charge อ้างซี่และงานที่ทำจริงเท่านั้น |
| ทันตกรรม: ภาพฟัน / ทันตแพทย์ | pilot: N/A; เป้าหมาย: รอยืนยัน | C/attachments.ts เก็บภาพ pilot; ไม่มี mapping ซี่ | ขนาด/format/PACS | ภาพผูกซี่/visit และอ่านตาม care role |
| ทันตกรรม: แผนหลายครั้ง / ทันตแพทย์ | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | encounter เดี่ยวไม่พอ | ความคืบหน้าแต่ละครั้งและการแก้แผนย้อนหลังได้ |
| ทันตกรรม: งานแล็บฟัน / ทันตแพทย์ | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องมี external order | ส่ง/รับ/แก้งานพร้อม provenance |
| ความงาม/ผิวหนัง: ภาพก่อน–หลัง / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | C/attachments.ts pilot เท่านั้น | consent/retention ภาพ | consent ก่อน capture, version และ access audit |
| ความงาม/ผิวหนัง: คอร์ส / operator | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ห้ามสับสนกับ retail package | ใช้ครั้ง/คงเหลือ/reversal ถูกต้อง |
| ความงาม/ผิวหนัง: ใบยินยอม / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องอนุมัติ template | ลงนามต่อหัตถการและเวอร์ชันก่อนทำ |
| ความงาม/ผิวหนัง: ล็อตสารที่ใช้ / ผู้ปฏิบัติ | pilot: N/A; เป้าหมาย: รอยืนยัน | S ฐาน; ไม่มี C patient-lot | ต้องมี administration event | trace ล็อตถึง visit และ movement atomic |
| ความงาม/ผิวหนัง: นัดติดตาม / registrar | pilot: N/A; เป้าหมาย: รอยืนยัน | C/appointments.ts นัดทั่วไป | ไม่มี course link | นัดอ้างหัตถการ/ผลและค้างติดตามได้ |
| วัคซีน/ฉีดยา: ตารางเข็ม / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ผู้เชี่ยวชาญกำหนด schedule | dose due/overdue คำนวณจากหลักฐานจริง |
| วัคซีน/ฉีดยา: ล็อต / ผู้ปฏิบัติ | pilot: N/A; เป้าหมาย: รอยืนยัน | S ฐาน; ไม่มี C link | expiry/recall | lot/expiry ของ dose จริงตรวจย้อนหลังได้ |
| วัคซีน/ฉีดยา: บันทึกให้จริง / ผู้ปฏิบัติ | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | order ≠ administration | actor/time/site/dose และ movement atomic |
| วัคซีน/ฉีดยา: ใบรับรอง / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องมี administration evidence | ใบรับรองออกจาก dose จริงและลงนาม |
| วัคซีน/ฉีดยา: เหตุไม่พึงประสงค์ / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | incident policy | event เชื่อม dose/lot และติดตามผล |
| กายภาพ: แผนหลายครั้ง / therapist | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ฟอร์มเฉพาะทาง | เป้าหมาย/ครั้ง/ผู้รับผิดชอบแก้แบบ versioned |
| กายภาพ: คะแนนประเมิน / therapist | pilot: N/A; เป้าหมาย: รอยืนยัน | C note text เท่านั้น | ต้องเลือกเครื่องมือประเมิน | ค่า/หน่วย/เวอร์ชันพร้อมผู้ประเมิน |
| กายภาพ: ความก้าวหน้า / therapist | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องมี series | เปรียบเทียบแต่ละครั้งจาก structured scores |
| กายภาพ: คอร์สคงเหลือ / cashier | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | เงินคอร์สและบริการจริงต้องแยก | ใช้/คืน/หมดอายุ reconcile กับ payment |
| แล็บตนเอง: สิ่งส่งตรวจ / lab | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | specimen workflow | รับ/ปฏิเสธ/เก็บพร้อมเวลาผู้รับ |
| แล็บตนเอง: บาร์โค้ด / lab | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้อง unique tenant/specimen | scan ผิดคน/ซ้ำถูกปฏิเสธ |
| แล็บตนเอง: สถานะตรวจ / lab | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | state machine | transition ถูกลำดับและ audit |
| แล็บตนเอง: ผู้รับรอง / lab | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | licence/role | ผลรับรอง immutable พร้อม correction workflow |
| แล็บตนเอง: ผลสำคัญ / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | escalation owner | แจ้ง/อ่าน/ack/ติดตามครบพร้อมเวลา |
| ภาพวินิจฉัย: คำสั่ง / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | modality/order model | order version/indication จำกัดสิทธิ์ |
| ภาพวินิจฉัย: ภาพ / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | C/attachments.ts pilot | PACS/format/size ไม่รองรับครบ | ภาพอ้าง study และสิทธิ์ care team |
| ภาพวินิจฉัย: รายงาน / radiologist | pilot: N/A; เป้าหมาย: รอยืนยัน | C note/attachment pilot ไม่ใช่ report | ต้องแยก signed result | final/corrected report immutable |
| ภาพวินิจฉัย: ผู้แปลผล / radiologist | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | licence/role | ผู้ลงนามและเวลาตรวจสอบได้ |
| ภาพวินิจฉัย: ระบบภาพ / integration owner | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี connector C/R/U/M/T | PACS vendor contract | duplicate/out-of-order study และ access denial |
| ประกัน: ตรวจสิทธิ / claims staff | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | payer contract/identity | eligibility response มีที่มา/เวลาและไม่แทนการรับรอง |
| ประกัน: อนุมัติล่วงหน้า / claims staff | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | ต้องมี treatment estimate | authorization ผูกบริการ/วงเงิน/เวลา |
| ประกัน: claim / claims staff | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | privacy payload/claim rules | claim ซ้ำไม่สร้างหนี้ซ้ำ; ส่งเฉพาะข้อมูลอนุมัติ |
| ประกัน: ผลปฏิเสธ/กระทบยอด / claims staff | pilot: N/A; เป้าหมาย: รอยืนยัน | P/AR ฐาน ไม่ใช่ claims | ต้องมี adjudication model | denied/partial/paid reconcile กับ AR และ patient balance |
| ตรวจทางไกล: พิสูจน์ตัวตน / registrar | pilot: N/A; เป้าหมาย: รอยืนยัน | C patient pilot; ไม่มี remote verification | ผู้ประกอบวิชาชีพ/กฎหมายอนุมัติ | verify ผู้ป่วยและผู้ตรวจทุก session |
| ตรวจทางไกล: สื่อสารทางไกล / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | secure channel/provider | session ผูก visit; timeout/revocation ทำงาน |
| ตรวจทางไกล: บันทึก / clinician | pilot: N/A; เป้าหมาย: รอยืนยัน | C encounter pilot ไม่ระบุ remote | consent/recording policy | mode/time/participants/provenance ครบ |
| ตรวจทางไกล: ข้อกำหนดวิชาชีพ / clinical owner | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี approved policy | ต้องตรวจข้อกำหนดปัจจุบัน | ผู้รับผิดชอบลงนาม scope/use cases ก่อนเปิด |
| ตรวจสุขภาพองค์กร: รายชื่อกลุ่ม / coordinator | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | consent/identity matching | roster import ซ้ำไม่รวม chart ผิดคน |
| ตรวจสุขภาพองค์กร: ชุดตรวจ / coordinator | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C/R/U/M/T | package/order dependency | bundle รายคนและงานจริงตรวจได้ |
| ตรวจสุขภาพองค์กร: รายงานนายจ้างจำกัดข้อมูล / privacy owner | pilot: N/A; เป้าหมาย: รอยืนยัน | ไม่มี C report | disclosure policy | export ไม่มีผลรายบุคคลนอกขอบเขตอนุมัติ |
| ตรวจสุขภาพองค์กร: วางบิล / cashier | pilot: N/A; เป้าหมาย: รอยืนยัน | O/P ฐาน; ไม่มี C corporate payer | ต้องกำหนดผู้จ่าย/AR | bill รวมยอดตรงแต่ไม่เผย chart |
| หลายสาขา: HN/เวชระเบียนข้ามสาขา / registrar | pilot: N/A; เป้าหมาย: รอยืนยัน | M/C one branch | ต้องกำหนด HN scope/access | ค้นข้ามสาขาตามสิทธิ์โดยไม่สร้างผู้ป่วยซ้ำ |
| หลายสาขา: ตารางผู้ตรวจ / scheduler | pilot: N/A; เป้าหมาย: รอยืนยัน | C appointment pilot one branch | resource overlap ข้ามสาขา | ผู้ตรวจไม่ถูกจองชนสองสาขา |
| หลายสาขา: สต็อก / stock owner | pilot: N/A; เป้าหมาย: รอยืนยัน | S/10.107 ฐาน WIP | lot transfer ยังไม่ rollout | ส่ง/รับ/ล็อต/movement ครบ |
| หลายสาขา: รายงานแยกสาขา / manager | pilot: N/A; เป้าหมาย: รอยืนยัน | report ธุรกิจฐาน; ไม่มี C report | branch-scoped PHI | แต่ละสาขาเห็นเฉพาะข้อมูลตาม policy |

## ข้อสรุปจาก inventory

1. Pilot มี path ลงทะเบียน นัดหมาย encounter/ลายเซ็น/ไฟล์ และ charge sheet ในสาขาเดียว แต่ยังไม่มี clinical order, dispensing, longitudinal structured record, report, external integration หรือการใช้จริงที่ได้รับอนุมัติ.
2. BMS มี order/payment/stock เป็นฐาน; การมี service เหล่านี้ไม่ทำให้ workflow คลินิกผ่านโดยอัตโนมัติ.
3. ประเภทบริการทั้งหมดต้องให้เจ้าของคลินิกยืนยัน applicability. EMR ownership ยังไม่ทราบ. ดู [architecture decision ที่ยังรอคำตอบ](clinic-emr-architecture-decision-th.md) และ [backlog ตาม dependency](clinic-full-backlog-th.md).

## หลักฐานตรวจรอบ inventory นี้

- รอบ inventory ที่ commit `1660f209`: `apps/web npm run gate` ผ่าน: release feature check, regression inventory, typecheck, pure tests 4,018 (ผ่าน 4,012, ข้าม 6, fail 0) และ production build. นี่เป็น DB-free gate.
- `apps/desktop npm run lint` และ `npm run test -- --runInBand` ผ่าน 178/178; `apps/mobile npm run typecheck` และ `npm test -- --runInBand --silent` ผ่าน 66 suites, 520/520 tests.
- รอบ inventory ตรวจ relative links, รูปแบบตาราง และ `git diff --check` ผ่าน; ตอนนั้นยังไม่มีการเปลี่ยน service/migration/UI/คู่มือในแอป.
- รอบเพิ่มการถอน emergency grant มี code, migration, UI และคู่มือใหม่ พร้อมผล DB/route test ใน [ผลตรวจรับการถอนสิทธิ์](clinic-emergency-revocation-acceptance-2026-11-26-th.md). **ยังไม่ได้พิสูจน์:** restored BMS schema, browser หลัง login, backup/restore, load และอุปกรณ์จริง. ไม่มี clinical/privacy/accounting sign-off.
