import Link from "next/link";
import { learningLang, learningMetadata, Sidebar } from "../shared";
import { localizedPublicPath } from "@/lib/publicSeo";
import s from "../learning.module.css";
import { ClinicGuideFlow } from "./ClinicGuideFlow";
import c from "./clinic.module.css";

const path = "/learn/clinic";

export async function generateMetadata() {
  const lang = await learningLang();
  return {
    ...learningMetadata(
      lang === "th" ? "คู่มือคลินิกผู้ป่วยนอก (Technical pilot)" : "Outpatient clinic guide (technical pilot)",
      lang === "th"
        ? "คู่มือทดลองสำหรับคลินิกผู้ป่วยนอกหนึ่งสาขา: สิทธิ์บุคลากร ลงทะเบียน นัดหมาย เวชระเบียน และค่าบริการ ใช้ข้อมูลสังเคราะห์เท่านั้น"
        : "One-branch outpatient clinic pilot guide covering staff access, registration, appointments, records and charges. Synthetic data only.",
      path,
      lang,
    ),
    robots: { index: false, follow: true },
  };
}

export default async function ClinicGuidePage() {
  const lang = await learningLang();
  const th = lang === "th";
  const copy = (thai: string, english: string) => th ? thai : english;
  const steps = [
    {
      title: copy("1. กำหนดสิทธิ์บุคลากร", "1. Grant staff access"),
      body: copy("ผู้ดูแลกำหนดสิทธิ์ BMS ตามหน้าที่ และกำหนดบทบาทคลินิก REGISTRAR, NURSE, CLINICIAN หรือ CASHIER แยกอีกชั้น ผู้ดูแลระบบไม่ได้อ่านเวชระเบียนได้โดยอัตโนมัติ", "An administrator grants task-specific BMS permissions and a separate REGISTRAR, NURSE, CLINICIAN or CASHIER clinic role. Administrator status alone does not grant chart access."),
    },
    {
      title: copy("2. ลงทะเบียนและนัดหมาย", "2. Register and book"),
      body: copy("Registrar ค้น HN หรือชื่อก่อนสร้างผู้ป่วยทดสอบ บันทึกผู้ติดต่อหลังตรวจความสัมพันธ์ แล้วเลือกผู้ตรวจ ห้อง และเวลา ระบบปฏิเสธนัดที่ผู้ตรวจหรือห้องซ้อนกัน", "The registrar searches HN or name before creating a test patient, verifies a contact's relationship, then selects a practitioner, room and time. Overlapping practitioner or room bookings are rejected."),
    },
    {
      title: copy("3. เช็กอิน บันทึก และลงนาม", "3. Check in, document and sign"),
      body: copy("หลังเช็กอิน clinician ที่ได้รับมอบหมายเปิด encounter บันทึกร่าง และตรวจข้อมูลก่อนลงนาม บันทึก SIGNED แก้ทับไม่ได้; หากแก้ไขภายหลังให้ลงนาม addendum พร้อมเหตุผล แผนยาเป็นข้อความเท่านั้น ไม่จ่ายยาหรือตัดสต็อก", "After check-in, the assigned clinician opens an encounter, saves a draft and reviews it before signing. A SIGNED record cannot be overwritten; later corrections require a signed addendum with a reason. Medication plans are text only and do not dispense or move stock."),
    },
    {
      title: copy("4. ตรวจค่าบริการและชำระเงิน", "4. Review charges and payment"),
      body: copy("Cashier ที่มีบทบาทยังมีผลและสิทธิ์ clinic.billing.manage เลือก encounter ที่ลงนามแล้วจากรายการที่ไม่แสดงบันทึกทางคลินิก เพิ่มเฉพาะบริการ NON_STOCK ที่เปิด ONLINE_ORDER และ VAT N ตรวจราคา server แล้วล็อก READY ก่อนสร้าง order หนึ่งครั้ง จากนั้นหน้า Payment ต้องมี payment.view/payment.submit และผู้ยืนยันต้องมี payment.confirm", "A cashier with an active clinic role and clinic.billing.manage selects a signed encounter from a worklist without clinical notes. Add only NON_STOCK services enabled for ONLINE_ORDER with VAT N. Review server prices, lock the sheet as READY and create one order. Payment requires payment.view/payment.submit; the confirmer needs payment.confirm."),
    },
    {
      title: copy("5. ตรวจการเข้าถึง", "5. Review access"),
      body: copy("ตรวจประวัติการเข้าถึงเวชระเบียนและไฟล์แนบ สิทธิ์ฉุกเฉินมีเฉพาะ clinician ที่ระบุเหตุผลและยืนยัน มีผล 15 นาทีและบันทึก audit", "Review chart and attachment access. Emergency access is clinician-only, requires a reason and confirmation, lasts 15 minutes and is audited."),
    },
  ];

  return <div className={`${s.layout} ${s.trackLayout} ${s.clinicLayout} ${c.page}`}>
    <Sidebar lang={lang} clinicGuide />
    <div className={`${s.trackContents} ${c.content}`}>
      <nav className={s.breadcrumb} aria-label="Breadcrumb">
        <Link href={localizedPublicPath("/learn", lang)}>{copy("ศูนย์เรียนรู้", "Learning center")}</Link><span>/</span>
        <span aria-current="page">{copy("คลินิกผู้ป่วยนอก", "Outpatient clinic")}</span>
      </nav>
      <article className={c.article}>
        <div className={c.hero}>
          <div className={c.titleLine}><h1>{copy("คู่มือคลินิกผู้ป่วยนอก", "Outpatient clinic guide")}</h1><span className={c.pilotBadge}>TECHNICAL PILOT</span></div>
          <p className={c.subtitle}>{copy("ลำดับงานสำหรับคลินิกหนึ่งสาขาที่ได้รับสิทธิ์ ตั้งแต่ลงทะเบียนจนถึงชำระค่าบริการ", "A one-branch workflow for authorized clinic staff, from registration through service payment.")}</p>
        </div>
        <div className={c.status}>
          <span className={c.statusIcon} aria-hidden="true">!</span>
          <div><strong>{copy("สถานะการทดลอง", "Pilot status")}</strong>
          <p>{copy("โมดูลปิดเป็นค่าเริ่มต้น เปิดได้เฉพาะ tenant ทดสอบที่อยู่ใน allowlist และใช้ข้อมูลสังเคราะห์เท่านั้น ยังไม่ผ่านการตรวจรับด้านคลินิก ความเป็นส่วนตัว และบัญชี/ภาษี ห้ามบันทึกข้อมูลผู้ป่วยจริง", "The module is off by default and limited to allowlisted test tenants with synthetic data. Clinical, privacy and accounting/tax review is outstanding. Do not enter real patient data.")}</p>
          </div>
        </div>
        <ClinicGuideFlow lang={lang} />
        <div className={c.details}>
          <h2>{copy("รายละเอียดการทำงาน", "Workflow details")}</h2>
          <div className={c.detailsGrid}>{steps.map((step) => <section key={step.title} className={c.detailCard}>
            <h3>{step.title}</h3><p>{step.body}</p>
          </section>)}</div>
        </div>
        <div className={c.scope}>
          <h2>{copy("ขอบเขต", "Scope")}</h2>
          <p>{copy("ไม่มี AI วินิจฉัย ลงนาม สั่งยา หรืออ่านเวชระเบียน ไม่มีการจ่ายยา เคลมประกัน telemedicine หรือแล็บภายนอก", "AI cannot diagnose, sign, prescribe or read charts. Dispensing, insurance claims, telemedicine and external labs are not included.")}</p>
        </div>
        <p className={c.manualNote}>{copy("สำหรับขั้นตอนและรหัสข้อผิดพลาดโดยละเอียด ให้เปิดคู่มือพนักงานหลังเข้าสู่ระบบ", "For detailed steps and error codes, open the staff manual after signing in.")}</p>
        <Link className={c.manualLink} href="/admin/manual/clinic">{copy("คู่มือคลินิกสำหรับพนักงาน", "Clinic staff manual")} →</Link>
      </article>
    </div>
  </div>;
}
