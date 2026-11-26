"use client";

import { Alert, Card, Col, Row, Space, Table, Tag, Typography } from "antd";
import Link from "next/link";
import { useI18n } from "@/lib/i18nContext";

type GuideCopy = {
  tag: string; title: string; lead: string; pilot: string;
  cards: Array<{ title: string; body: string; links: Array<{ label: string; href: string }> }>;
  flowTitle: string; flow: string[];
  stateTitle: string; stateColumns: [string, string, string];
  states: Array<{ area: string; state: string; meaning: string }>;
  recoveryTitle: string; recovery: Array<{ problem: string; action: string }>;
  limitsTitle: string; limits: string[];
};

const COPY: Record<"th" | "en", GuideCopy> = {
  th: {
    tag: "คู่มือคลินิกผู้ป่วยนอก · Technical pilot",
    title: "ลงทะเบียน ตรวจรักษา และคิดค่าบริการ",
    lead: "ขั้นตอนสำหรับบุคลากรคลินิกหนึ่งสาขาที่ได้รับสิทธิ์ ใช้เฉพาะข้อมูลสังเคราะห์ระหว่างทดลอง",
    pilot: "โมดูลนี้ปิดเป็นค่าเริ่มต้น ต้องใช้ migration 10.141 และ 10.142 ตามลำดับ และยังไม่ผ่านการตรวจรับทางคลินิก ความเป็นส่วนตัว หรือบัญชี/ภาษี ห้ามบันทึกข้อมูลผู้ป่วยจริง",
    cards: [
      { title: "1. ผู้ดูแลกำหนดสิทธิ์", body: "หลังใช้ migration 10.141 และ 10.142 ตามลำดับ และเปิด allowlist เฉพาะ tenant ทดสอบ ให้กำหนดสิทธิ์ BMS ตามหน้าที่ แล้วให้บทบาท REGISTRAR, NURSE, CLINICIAN หรือ CASHIER ในหน้าคลินิก Registrar ต้องมี clinic.patient.read/register และ clinic.appointment.manage; clinician ต้องมี clinic.patient.read, clinic.appointment.manage และ clinic.record.read/write/sign; nurse ต้องมี clinic.patient.read และ clinic.record.read; cashier ต้องมี clinic.billing.manage. ผู้ใช้หน้า Payment ต้องมี payment.view/submit และผู้ยืนยันต้องมี payment.confirm แยกตามหน้าที่ เลขใบอนุญาต clinician เป็นข้อมูลที่ผู้ดูแลกรอก ยังไม่ได้ตรวจหน่วยงานออกใบอนุญาต ถอนสิทธิ์เมื่อพ้นหน้าที่ Administrator ไม่ได้อ่านเวชระเบียนโดยอัตโนมัติ", links: [
        { label: "สิทธิ์ BMS", href: "/admin/permissions" }, { label: "กำหนดบทบาทคลินิก", href: "/admin/clinic" },
      ] },
      { title: "2. Registrar ลงทะเบียนและนัดหมาย", body: "ค้น HN หรือชื่อก่อนลงทะเบียนเพื่อป้องกันรายการซ้ำจากการทำงาน แต่ระบบไม่รวม chart จากชื่อหรือเบอร์อัตโนมัติ บันทึกผู้ติดต่อที่ตรวจความสัมพันธ์แล้ว จากนั้นเลือกผู้ป่วย ผู้ตรวจ ห้อง และเวลาในเขตเวลา Asia/Bangkok ตรวจคิวรายเดือนก่อนยืนยัน หากมีคำเตือนว่ารายการเกิน 500 ปฏิทินไม่ครบและไม่ใช้จำนวนบนปฏิทินยืนยันเวลาว่าง คำขอเวลา/ห้องซ้อนจะถูกปฏิเสธที่ฐานข้อมูล", links: [
        { label: "ผู้ป่วยและนัดหมาย", href: "/admin/clinic" },
      ] },
      { title: "3. Clinician บันทึกและลงนาม", body: "หลังเช็กอิน ผู้ตรวจที่ถูกนัดเปิด encounter บันทึกอาการ ผลตรวจ วินิจฉัย และแผนรักษาเป็นร่าง ตรวจความครบถ้วนก่อนลงนาม เมื่อ SIGNED แล้วแก้ทับไม่ได้ ให้ลงนาม addendum พร้อมเหตุผลหากต้องแก้ภายหลัง แผนยาเป็นข้อความเท่านั้น ไม่มีการจ่ายยา ตัดสต็อก หรือคิดเงินจากข้อความนี้", links: [
        { label: "เวชระเบียน", href: "/admin/clinic" },
      ] },
      { title: "4. Cashier ตรวจและส่งต่อการชำระ", body: "เปิดแท็บค่าบริการและเลือก encounter ที่ลงนามแล้วจากรายการสำหรับ cashier รายการนี้ไม่มีข้อความเวชระเบียน เพิ่มได้เฉพาะบริการใน catalog ที่เป็น NON_STOCK, เปิด ONLINE_ORDER และ VAT N ตรวจรายการ/ราคาจริงก่อนล็อก READY แล้วสร้าง order เพียงครั้งเดียว เปิดหน้า Payment ด้วยเลข order เพื่อบันทึกและยืนยันเงินตามสิทธิ์เดิม", links: [
        { label: "ค่าบริการคลินิก", href: "/admin/clinic" }, { label: "สินค้า/บริการ", href: "/admin/products" },
        { label: "ชำระเงิน", href: "/admin/payment" },
      ] },
      { title: "5. ตรวจประวัติการเข้าถึง", body: "Clinician ที่เคยดูแลหรือ nurse ที่ได้รับมอบหมายเท่านั้นจึงอ่านประวัติได้ การเข้าถึงฉุกเฉินต้องเป็น clinician ระบุเหตุผลและยืนยัน มีผล 15 นาทีและบันทึกตรวจย้อนหลังได้ ไฟล์แนบเปิดผ่าน route เฉพาะที่ตรวจบทบาทและ encounter ทุกครั้ง", links: [
        { label: "ประวัติและ audit คลินิก", href: "/admin/clinic" },
      ] },
    ],
    flowTitle: "ลำดับทดสอบด้วยข้อมูลสังเคราะห์",
    flow: [
      "ผู้ดูแลกำหนดสิทธิ์ BMS และบทบาทคลินิกแยกตามคน; ตรวจว่าผู้ไม่มีบทบาทอ่านเวชระเบียนไม่ได้",
      "Registrar ลงทะเบียน HN ทดสอบ เลือกผู้ป่วย และนัดหมายเวลาที่ไม่ซ้อน",
      "เช็กอิน แล้วให้ clinician ที่ถูกนัดเปิด encounter บันทึกร่างและลงนาม",
      "ลอง addendum ที่มีเหตุผล; ตรวจว่าบันทึกที่ลงนามแล้วแก้ทับไม่ได้",
      "Cashier ค้น HN ในรายการลงนาม ตรวจบริการ NON_STOCK/VAT N บันทึกและล็อก charge sheet",
      "สร้าง order ตรวจยอด แล้วใช้หน้า Payment เดิมบันทึกและยืนยันเงิน; ตรวจประวัติการเข้าถึงย้อนหลัง",
    ],
    stateTitle: "สถานะที่พนักงานต้องแยกให้ออก",
    stateColumns: ["งาน", "สถานะ", "ความหมาย/ขั้นต่อไป"],
    states: [
      { area: "นัดหมาย", state: "CONFIRMED", meaning: "จองแล้ว; เช็กอิน เลื่อน ยกเลิก หรือระบุ no-show ได้" },
      { area: "นัดหมาย", state: "CHECKED_IN", meaning: "ผู้ป่วยมาถึง; clinician ที่ถูกนัดเปิด encounter" },
      { area: "นัดหมาย", state: "CANCELLED / NO_SHOW", meaning: "นัดจบโดยไม่ตรวจ; ไม่ใช้เป็นหลักฐานว่ามีเวชระเบียน" },
      { area: "นัดหมาย", state: "COMPLETED", meaning: "encounter ลงนามแล้ว" },
      { area: "เวชระเบียน", state: "OPEN", meaning: "ร่างที่แก้ได้ภายใต้ version ปัจจุบัน" },
      { area: "เวชระเบียน", state: "SIGNED / ADDENDUM", meaning: "ต้นฉบับเปลี่ยนไม่ได้; ADDENDUM เป็นบันทึกใหม่อ้างฉบับเดิม" },
      { area: "ค่าบริการ", state: "DRAFT", meaning: "แก้รายการได้ก่อน cashier ตรวจ" },
      { area: "ค่าบริการ", state: "READY", meaning: "รายการ/ราคาล็อกแล้ว; สร้าง order ได้" },
      { area: "ค่าบริการ", state: "ORDER_CREATED", meaning: "มี order แล้ว; ยังไม่เท่ากับชำระเงินสำเร็จ" },
    ],
    recoveryTitle: "เมื่อระบบปฏิเสธหรือเครือข่ายขัดข้อง",
    recovery: [
      { problem: "CLINIC_PILOT_DISABLED / CLINIC_SINGLE_BRANCH_REQUIRED", action: "ให้ผู้ดูแลตรวจ allowlist ของ tenant ทดสอบ, migration และจำนวนสาขาที่ active; อย่าเปิด flag ของร้านจริง" },
      { problem: "CLINIC_ACCESS_DENIED / PATIENT_CARE_ACCESS_DENIED", action: "ตรวจทั้งสิทธิ์ BMS, บทบาทคลินิกที่ active และความสัมพันธ์กับ encounter; อย่าใช้บัญชี Administrator ข้ามสิทธิ์รักษา" },
      { problem: "APPOINTMENT_CONFLICT / REQUEST_KEY_CONFLICT", action: "รีเฟรชปฏิทินและเลือกช่วงเวลา/ห้องใหม่; retry การเลื่อนนัดเดิมใช้ request key เดิม ห้ามนำ key เดิมไปใช้กับเวลาใหม่ หากไม่ทราบผลให้ตรวจรายการก่อนส่งซ้ำ" },
      { problem: "ENCOUNTER_VERSION_CONFLICT", action: "เปิดเวชระเบียนล่าสุด ตรวจการแก้ของผู้อื่น แล้วบันทึกร่างหรือขอให้ผู้ตรวจลงนามใหม่" },
      { problem: "CHARGE_SERVICE_NOT_APPROVED / CHARGE_REVIEW_CHANGED", action: "หยุดสร้าง order ตรวจชนิดสินค้า sales surface ภาษีและราคากับผู้รับผิดชอบ; ไม่แก้ยอดย้อนหลังเพื่อให้ผ่าน" },
      { problem: "CHARGE_ORDER_CLOSED_REVIEW_REQUIRED", action: "order เดิมถูกยกเลิกหรือคืนแล้ว ให้ผู้มีสิทธิ์ตรวจ payment/refund และรายการค่าบริการก่อนทำรายการใหม่ ระบบไม่สร้าง order ทดแทนเอง" },
      { problem: "ไม่แน่ใจว่า order/เงินสำเร็จหรือไม่", action: "โหลด charge sheet และค้นเลข order ใน Payment ก่อนลองใหม่; การสร้าง order ซ้ำคืน order เดิม แต่การยืนยันเงินเป็นขั้นตอนแยก" },
    ],
    limitsTitle: "ขอบเขตที่ยังไม่เปิดใช้จริง",
    limits: [
      "ไม่มี patient portal หรือการให้ผู้ปกครองอ่าน chart แม้บันทึก verified contact แล้ว",
      "ไม่มี AI วินิจฉัย ลงนาม สั่งยา หรืออ่านเวชระเบียน; ไม่มีการจ่ายยา/เคลมประกัน/telemedicine/แล็บภายนอก",
      "ต้องทดสอบฐาน BMS ที่ restore, การชำระและคืนเงินจริง, backup/restore, browser หลังล็อกอิน และให้ผู้รับผิดชอบทางคลินิก ข้อมูลส่วนบุคคล บัญชี/ภาษีตรวจรับก่อนใช้ข้อมูลจริง",
    ],
  },
  en: {
    tag: "Outpatient clinic guide · Technical pilot",
    title: "Register, document care and bill services",
    lead: "A one-branch workflow for authorised clinic staff, using synthetic data only",
    pilot: "This module is disabled by default and requires migrations 10.141 and 10.142 in order. Clinical, privacy and accounting/tax review are outstanding. Do not enter real patient data.",
    cards: [
      { title: "1. Administrator: grant access", body: "After migrations 10.141 and 10.142 in order and a test-tenant allowlist, grant BMS permissions and separate REGISTRAR, NURSE, CLINICIAN or CASHIER roles. Registrar needs clinic.patient.read/register and clinic.appointment.manage; clinician needs clinic.patient.read, clinic.appointment.manage and clinic.record.read/write/sign; nurse needs clinic.patient.read and clinic.record.read; cashier needs clinic.billing.manage. Payment users need payment.view/submit, and confirmation requires payment.confirm according to duty. A clinician licence number is staff-entered evidence, not issuing-authority verification. Revoke access when duties change. Administrator alone cannot read a chart.", links: [
        { label: "BMS permissions", href: "/admin/permissions" }, { label: "Clinic roles", href: "/admin/clinic" },
      ] },
      { title: "2. Registrar: register and schedule", body: "Search HN or name before registration to avoid operational duplicates. Matching name or phone never merges charts. Record a contact only after staff verify the relationship. Select patient, practitioner, room and Bangkok time; check the monthly queue. If more than 500 appointments trigger the incomplete-list warning, do not use calendar counts to confirm availability. The database rejects overlapping practitioner or room bookings.", links: [
        { label: "Patients and appointments", href: "/admin/clinic" },
      ] },
      { title: "3. Clinician: document and sign", body: "After check-in, the assigned practitioner opens the encounter and saves a draft. Review complaint, examination, diagnosis and plan before signing. SIGNED notes cannot be overwritten; corrections are signed addenda with a reason. Medication plans are text only and never dispense, move stock or create charges.", links: [
        { label: "Clinical records", href: "/admin/clinic" },
      ] },
      { title: "4. Cashier: review and collect", body: "Choose a signed encounter from the cashier worklist, which contains no clinical note. Use only catalogued NON_STOCK services enabled for ONLINE_ORDER with VAT N. Review and lock the charge sheet before creating one order. Open Payment with that order ID to submit and confirm the payment under existing BMS permissions.", links: [
        { label: "Clinic charges", href: "/admin/clinic" }, { label: "Products/services", href: "/admin/products" },
        { label: "Payment", href: "/admin/payment" },
      ] },
      { title: "5. Review access", body: "Only a treating clinician or assigned nurse may read history. Emergency access requires a clinician, a reason and confirmation, lasts 15 minutes and is audited. Attachment downloads recheck the active role and encounter assignment on every request.", links: [
        { label: "Clinic access history", href: "/admin/clinic" },
      ] },
    ],
    flowTitle: "Synthetic-data trial workflow",
    flow: [
      "Grant BMS permissions and clinic roles separately; verify an unassigned account cannot open a chart.",
      "Register a test HN, select the patient and book an available time.",
      "Check in; the assigned clinician opens the encounter, saves a draft and signs it.",
      "Add a reasoned addendum and verify the signed original cannot be overwritten.",
      "Find the HN in the signed cashier worklist, review NON_STOCK/VAT-N services and lock the charge sheet.",
      "Create the order, compare the amount, then submit and confirm payment in Payment; inspect access history.",
    ],
    stateTitle: "Statuses to distinguish",
    stateColumns: ["Area", "Status", "Meaning / next step"],
    states: [
      { area: "Appointment", state: "CONFIRMED", meaning: "Booked; check in, reschedule, cancel or mark no-show." },
      { area: "Appointment", state: "CHECKED_IN", meaning: "Patient arrived; assigned clinician opens an encounter." },
      { area: "Appointment", state: "CANCELLED / NO_SHOW", meaning: "Appointment ended without a clinical record." },
      { area: "Appointment", state: "COMPLETED", meaning: "Encounter has been signed." },
      { area: "Record", state: "OPEN", meaning: "Draft can be changed with the current version." },
      { area: "Record", state: "SIGNED / ADDENDUM", meaning: "Signed original is immutable; an addendum is a separate signed note." },
      { area: "Charge", state: "DRAFT", meaning: "Lines can be edited before cashier review." },
      { area: "Charge", state: "READY", meaning: "Reviewed lines and prices are locked; an order may be created." },
      { area: "Charge", state: "ORDER_CREATED", meaning: "An order exists; payment has not necessarily succeeded." },
    ],
    recoveryTitle: "When a request fails or the network drops",
    recovery: [
      { problem: "CLINIC_PILOT_DISABLED / CLINIC_SINGLE_BRANCH_REQUIRED", action: "Ask the administrator to inspect the synthetic tenant allowlist, migration and active branch count. Do not enable a real shop." },
      { problem: "CLINIC_ACCESS_DENIED / PATIENT_CARE_ACCESS_DENIED", action: "Check BMS permission, active clinic role and encounter relationship; Administrator is no shortcut to a chart." },
      { problem: "APPOINTMENT_CONFLICT / REQUEST_KEY_CONFLICT", action: "Refresh the calendar and choose another room/time. Retry the same move with its original request key; never reuse that key for new target values. Check the appointment before retrying an uncertain request." },
      { problem: "ENCOUNTER_VERSION_CONFLICT", action: "Reload the latest record, review another person's changes, then save or sign the current version." },
      { problem: "CHARGE_SERVICE_NOT_APPROVED / CHARGE_REVIEW_CHANGED", action: "Stop and review stock policy, sales surface, tax category and price with the responsible staff. Do not alter past amounts to force success." },
      { problem: "CHARGE_ORDER_CLOSED_REVIEW_REQUIRED", action: "The existing order was cancelled or returned. Have an authorised reviewer reconcile payment, refund and charges before a new transaction; no replacement order is created automatically." },
      { problem: "Uncertain order or payment result", action: "Reload the charge sheet and search the order ID in Payment before trying again. Order retries return the same order; payment confirmation is separate." },
    ],
    limitsTitle: "Still outside real-patient use",
    limits: [
      "There is no patient portal or guardian chart access, even after recording a verified contact.",
      "AI cannot diagnose, sign, prescribe or read a chart. Dispensing, insurance claims, telemedicine and external labs are not included.",
      "A restored BMS database, full payment/refund path, backup/restore, authenticated browser check and clinical, privacy and accounting/tax sign-off are required before real data.",
    ],
  },
};

export default function ClinicManualPage() {
  const { lang } = useI18n();
  const c = COPY[lang === "en" ? "en" : "th"];
  return <div style={{ maxWidth: 1160, margin: "0 auto", padding: 24 }}>
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <div>
        <Tag color="orange">{c.tag}</Tag>
        <Typography.Title level={2} style={{ marginTop: 12 }}>{c.title}</Typography.Title>
        <Typography.Paragraph type="secondary">{c.lead}</Typography.Paragraph>
        <Space wrap><Link href="/admin/manual">← {lang === "en" ? "All manuals" : "คู่มือทั้งหมด"}</Link>
          <Link href="/admin/clinic">{lang === "en" ? "Open clinic" : "เปิดหน้าคลินิก"} →</Link></Space>
      </div>
      <Alert type="warning" showIcon closable message={c.pilot} />
      <Row gutter={[16, 16]}>{c.cards.map(card => <Col key={card.title} xs={24} md={12}>
        <Card title={card.title} style={{ height: "100%" }}>
          <Typography.Paragraph>{card.body}</Typography.Paragraph>
          <Space wrap>{card.links.map(link => <Link key={link.href} href={link.href}>{link.label} →</Link>)}</Space>
        </Card>
      </Col>)}</Row>
      <Card title={c.flowTitle}><ol>{c.flow.map(item => <li key={item}>{item}</li>)}</ol></Card>
      <Card title={c.stateTitle}>
        <Table rowKey={row => `${row.area}:${row.state}`} size="small" pagination={false}
          scroll={{ x: 650 }} dataSource={c.states} columns={[
            { title: c.stateColumns[0], dataIndex: "area" },
            { title: c.stateColumns[1], dataIndex: "state", render: value => <Tag>{value}</Tag> },
            { title: c.stateColumns[2], dataIndex: "meaning" },
          ]} />
      </Card>
      <Card title={c.recoveryTitle}>
        <Space direction="vertical" style={{ width: "100%" }}>{c.recovery.map(item =>
          <div key={item.problem}><Typography.Text strong>{item.problem}</Typography.Text>
            <Typography.Paragraph style={{ marginBottom: 0 }}>{item.action}</Typography.Paragraph></div>)}</Space>
      </Card>
      <Card title={c.limitsTitle}><ul>{c.limits.map(item => <li key={item}>{item}</li>)}</ul></Card>
    </Space>
  </div>;
}
