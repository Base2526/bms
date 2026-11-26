"use client";

import { useEffect, useState } from "react";
import { LearningFlowFullscreen } from "../LearningFlowFullscreen";
import c from "./clinic.module.css";

type Lang = "th" | "en";
type Copy = Record<Lang, string>;
type FlowStep = { icon: string; title: Copy; detail: Copy; explanation: Copy; tone?: "green" | "orange" | "purple" };
const bi = (th: string, en: string): Copy => ({ th, en });

const lanes: FlowStep[][] = [
  [
    { icon: "▣", title: bi("สิทธิ์และบทบาท", "Access and roles"), detail: bi("BMS + บทบาทคลินิก", "BMS + clinic role"), explanation: bi("ผู้ดูแลกำหนดสิทธิ์ตามงานและบทบาท REGISTRAR, NURSE, CLINICIAN หรือ CASHIER แยกกัน ผู้ดูแลระบบไม่ได้อ่านเวชระเบียนโดยอัตโนมัติ", "Grant task permissions and separate REGISTRAR, NURSE, CLINICIAN or CASHIER roles. Administrator status alone does not grant chart access.") },
    { icon: "◇", title: bi("ลงทะเบียนผู้ป่วย", "Register patient"), detail: bi("ค้น HN ก่อนสร้าง", "Search HN first"), explanation: bi("Registrar ค้น HN หรือชื่อก่อนสร้างผู้ป่วยทดสอบ ข้อมูลผู้ป่วยแยกจาก CRM และใช้ข้อมูลสังเคราะห์เท่านั้น", "The registrar searches HN or name before creating a test patient. Patient data is separate from CRM; use synthetic data only.") },
    { icon: "▦", title: bi("นัดหมาย", "Appointment"), detail: bi("ผู้ตรวจ ห้อง และเวลา", "Clinician, room and time"), explanation: bi("เลือกผู้ตรวจ ห้อง สาขา และช่วงเวลา ระบบปฏิเสธนัดที่ผู้ตรวจหรือห้องซ้อนกัน ปฏิทินที่ข้อมูลถูกตัดไม่ใช้ยืนยันเวลาว่าง", "Choose clinician, room, branch and time. Conflicting bookings are rejected. A truncated calendar cannot establish availability.") },
    { icon: "✓", title: bi("เช็กอิน", "Check in"), detail: bi("ยืนยันการมาถึง", "Confirm arrival"), explanation: bi("Registrar เช็กอินนัดที่มาถึง ก่อนผู้ตรวจที่ได้รับมอบหมายเปิด encounter", "The registrar checks in the arrived appointment before the assigned clinician opens an encounter.") },
  ],
  [
    { icon: "✎", title: bi("บันทึกการตรวจ", "Clinical note"), detail: bi("ร่างและตรวจทาน", "Draft and review"), explanation: bi("Clinician ที่ได้รับมอบหมายบันทึกร่างและตรวจทาน แผนยาเป็นข้อความในบันทึกเท่านั้น ไม่ใช่คำสั่งจ่ายยาหรือการตัดสต็อก", "The assigned clinician drafts and reviews the note. A medication plan is text in the record, not a dispensing order or stock movement.") },
    { icon: "✓", title: bi("ลงนาม", "Sign note"), detail: bi("แก้ไขด้วย addendum", "Correct via addendum"), explanation: bi("บันทึกที่ลงนามแล้วแก้ทับไม่ได้ การแก้ไขภายหลังต้องทำ addendum ที่ลงนามพร้อมเหตุผล", "A signed note cannot be overwritten. Later corrections require a signed addendum with a reason."), tone: "purple" },
    { icon: "▤", title: bi("ตรวจค่าบริการ", "Review charges"), detail: bi("CASHIER + สิทธิ์ billing", "CASHIER + billing permission"), explanation: bi("เฉพาะ CASHIER ที่มี clinic.billing.manage เห็นรายการ encounter ที่ลงนามแล้วโดยไม่เห็นบันทึกทางคลินิก เลือกบริการ NON_STOCK ที่เปิด ONLINE_ORDER และ VAT N แล้วตรวจราคา server ก่อนล็อก READY", "Only an active CASHIER with clinic.billing.manage sees the signed-encounter worklist, without clinical notes. Select NON_STOCK services with ONLINE_ORDER and VAT N, then review server prices before READY."), tone: "orange" },
    { icon: "▥", title: bi("สร้างออร์เดอร์", "Create order"), detail: bi("หนึ่งครั้งต่อ charge sheet", "One per charge sheet"), explanation: bi("สร้าง order จาก charge sheet ที่ตรวจแล้วหนึ่งครั้ง หาก order ถูกยกเลิกหรือคืน ต้องกระทบยอด ไม่สร้างรายการแทนอัตโนมัติ", "Create one order from the reviewed charge sheet. A cancelled or returned order requires reconciliation, not an automatic replacement."), tone: "orange" },
  ],
  [
    { icon: "฿", title: bi("ชำระเงิน", "Payment"), detail: bi("ผ่าน Payment เดิม", "Existing Payment flow"), explanation: bi("หน้า Payment ต้องมี payment.view/payment.submit เพื่อบันทึก และ payment.confirm สำหรับผู้ยืนยัน การคืนเงินใช้ workflow เดิม", "The Payment page requires payment.view/payment.submit to record payment and payment.confirm for the confirmer. Refunds follow the existing workflow."), tone: "green" },
    { icon: "◉", title: bi("ตรวจการเข้าถึง", "Review access"), detail: bi("สิทธิ์และ audit", "Access and audit"), explanation: bi("การอ่านเวชระเบียนต้องมีสิทธิ์ BMS และบทบาทที่ยังมีผลของ clinician ที่เคยดูแลหรือ nurse ใน care team ผู้ดูแลระบบอ่านไม่ได้เอง สิทธิ์ฉุกเฉินเฉพาะ clinician ที่ระบุเหตุผลและยืนยัน มีผล 15 นาที บันทึก audit และไม่ครอบคลุมไฟล์แนบ", "Chart reads require BMS permission plus an active prior-care clinician or care-team nurse role; Administrator alone is insufficient. Emergency access is reasoned and confirmed, clinician-only, lasts 15 minutes, is audited and does not include attachments."), tone: "purple" },
  ],
];

const steps = lanes.flat();
const phaseRanges = [[0, 4], [4, 6], [6, 10]] as const;
const phaseNames = [
  bi("ลงทะเบียนและนัดหมาย", "Registration and appointments"),
  bi("การดูแลและเวชระเบียน", "Care and clinical records"),
  bi("ค่าบริการ ชำระเงิน และ audit", "Charges, payment and audit"),
];
const phaseRoles: Copy[] = [bi("REGISTRAR / บุคลากร", "REGISTRAR / STAFF"), bi("CLINICIAN / CARE TEAM", "CLINICIAN / CARE TEAM"), bi("CASHIER / PAYMENT / ACCESS", "CASHIER / PAYMENT / ACCESS")];

export function ClinicGuideFlow({ lang }: { lang: Lang }) {
  const [step, setStep] = useState(0);
  const [expandedPhase, setExpandedPhase] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const th = lang === "th";
  const title = th ? "Flow การดูแลผู้ป่วยนอก" : "Outpatient care flow";

  useEffect(() => {
    const media = window.matchMedia("(max-width: 850px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function selectStep(next: number) {
    if (next < 0 || next >= steps.length) return;
    setStep(next);
    setExpandedPhase(phaseRanges.findIndex(([start, end]) => next >= start && next < end));
  }

  function renderDiagram(fullscreen = false) {
    return <div className={fullscreen ? c.fullscreenDiagram : undefined} data-track="clinic">
      <div className={c.phases}>
        {phaseRanges.map(([start, end], phase) => <section className={c.phase} key={start} data-expanded={expandedPhase === phase} aria-label={`${phase + 1}. ${phaseNames[phase][lang]}`}>
          <button type="button" className={c.phaseHeader} onClick={() => isMobile && !fullscreen ? setExpandedPhase(phase) : selectStep(start)} aria-expanded={isMobile && !fullscreen ? expandedPhase === phase : undefined}>
            <span className={c.phaseNumber}>0{phase + 1}</span>
            <span><strong>{phaseNames[phase][lang]}</strong><small>{phaseRoles[phase][lang]}</small></span>
            <span className={c.phaseChevron} aria-hidden="true">⌄</span>
          </button>
          <ol className={c.nodes} start={start + 1}>
            {steps.slice(start, end).map((item, offset) => {
              const current = start + offset;
              const active = current === step;
              return <li className={c.node} key={item.title.en} data-active={active} data-flow-active={active}>
                <button type="button" onClick={() => selectStep(current)} aria-current={active ? "step" : undefined} aria-label={`${current + 1}. ${item.title[lang]}`}>
                  <span className={c.nodeNumber} aria-hidden="true">{current + 1}</span>
                  <span className={c.nodeCopy}><strong>{item.title[lang]}</strong><small>{item.detail[lang]}</small></span>
                </button>
              </li>;
            })}
          </ol>
        </section>)}
      </div>
    </div>;
  }

  return <section className={c.flow} aria-labelledby="clinic-flow-title">
    <div className={c.flowHeading}>
      <div><h2 id="clinic-flow-title">{title}</h2><p>{th ? "3 ช่วงงาน · 10 ขั้นตอน" : "3 phases · 10 steps"}</p></div>
      <LearningFlowFullscreen lang={lang} title={title} cueText={steps[step].explanation[lang]} step={step} total={steps.length} playing={false} canPlay={false} onTogglePlaying={() => {}} onPrevious={() => selectStep(step - 1)} onNext={() => selectStep(step + 1)} renderDiagram={() => renderDiagram(true)} showAudioControl={false} followLabel={th ? "ติดตามขั้นที่เลือก" : "Follow selected step"} detailNote={th ? "Technical pilot: ใช้ข้อมูลสังเคราะห์เท่านั้น ยังไม่ผ่านการตรวจรับเพื่อใช้กับผู้ป่วยจริง" : "Technical pilot: synthetic data only. Not approved for real patients."} />
    </div>
    <div className={c.selected}>
      <div className={c.selectedCopy} aria-live="polite">
        <span className={c.stepCount}>{th ? "ขั้น" : "Step"} {step + 1} / {steps.length}</span>
        <p className={c.selectedTitle}>{steps[step].title[lang]}</p>
        <p className={c.selectedText}>{steps[step].explanation[lang]}</p>
      </div>
      <div className={c.controls}>
        <button type="button" onClick={() => selectStep(step - 1)} disabled={step === 0}>{th ? "ก่อนหน้า" : "Previous"}</button>
        <button type="button" onClick={() => selectStep(step + 1)} disabled={step === steps.length - 1}>{th ? "ถัดไป" : "Next"}</button>
        <button type="button" onClick={() => selectStep(0)}>{th ? "เริ่มใหม่" : "Restart"}</button>
      </div>
    </div>
    {renderDiagram()}
    <p className={c.finePrint}>{th ? "Technical pilot · ปิดเป็นค่าเริ่มต้น · เฉพาะ tenant ทดสอบใน allowlist และข้อมูลสังเคราะห์เท่านั้น" : "Technical pilot · Off by default · Allowlisted test tenants and synthetic data only"}</p>
  </section>;
}
