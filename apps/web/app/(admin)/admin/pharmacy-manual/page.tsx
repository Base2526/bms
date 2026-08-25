'use client';

import { Alert, Button, Card, Space, Tag, Typography } from "antd";
import { DownloadOutlined, ExperimentOutlined, FileProtectOutlined, PrinterOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useCallback } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual, type Bilingual } from "@/lib/static-page-i18n";
import styles from "./pharmacy-manual.module.css";

const { Title, Paragraph, Text } = Typography;

type Tone = "slate" | "amber" | "blue" | "purple" | "red" | "green" | "cyan";

type RoleRow = { permission: string; desc: string; pharmacist: "yes" | "star" | "no"; manager: "yes" | "no"; admin: "yes" | "no" };
type StateRow = { status: string; tone: Tone; meaning: string; next: string };
type FlowStep = { title: string; detail: string; chips?: string[] };
type InterruptRow = { kind: string; behavior: string };
type EscalationRow = { level: string; tone: Tone; label: string; action: string; status: string; message: string };
type CompoundRow = { condition: string; logic: string; tone: Tone; result: string };
type LifecycleStage = { status: string; tone: Tone; label: string; desc: string; cond?: string };

type PharmacyManualContent = {
  heroTag: string;
  heroTitle: string;
  heroLead: string;
  heroRoutes: { label: string; href: string }[];
  downloadLabel: string;
  printLabel: string;
  rolesEyebrow: string;
  rolesTitle: string;
  rolesLead: string;
  roleColPermission: string;
  roleColDesc: string;
  roleColPharmacist: string;
  roleColManager: string;
  roleColAdmin: string;
  roleRows: RoleRow[];
  roleStarNote: string;
  roleDangerTitle: string;
  roleDangerBody: string;
  queueEyebrow: string;
  queueTitle: string;
  queueLead: string;
  stateColStatus: string;
  stateColMeaning: string;
  stateColNext: string;
  stateRows: StateRow[];
  reviewTitle: string;
  reviewLead: string;
  reviewSteps: FlowStep[];
  reviewInfoTitle: string;
  reviewInfoBody: string;
  intakeEyebrow: string;
  intakeTitle: string;
  intakeLead: string;
  intakeSteps: FlowStep[];
  interruptTitle: string;
  interruptLead: string;
  interruptColKind: string;
  interruptColBehavior: string;
  interruptRows: InterruptRow[];
  escalationEyebrow: string;
  escalationTitle: string;
  escalationLead: string;
  escalationColLevel: string;
  escalationColAction: string;
  escalationColStatus: string;
  escalationColMessage: string;
  escalationRows: EscalationRow[];
  escalationDangerTitle: string;
  escalationDangerBody: string;
  compoundTitle: string;
  compoundColCondition: string;
  compoundColLogic: string;
  compoundColResult: string;
  compoundRows: CompoundRow[];
  lifecycleEyebrow: string;
  lifecycleTitle: string;
  lifecycleLead: string;
  lifecycleStages: LifecycleStage[];
  lifecycleWarnTitle: string;
  lifecycleWarnBody: string;
  footNoteTitle: string;
  footNoteBody: string;
};

const HERO_ROUTES_TH = [
  { label: "Pharmacy Queue", href: "/admin/pharmacy-queue" },
  { label: "Pharmacy Intake Lab", href: "/admin/pharmacy-intake-lab" },
  { label: "Pharmacy Protocols", href: "/admin/pharmacy-protocols" },
];

const ROLE_ROWS: RoleRow[] = [
  { permission: "pharmacy.assessment.read", desc: "ดูรายการและรายละเอียดเคส", pharmacist: "yes", manager: "yes", admin: "yes" },
  { permission: "pharmacy.assessment.assign", desc: "มอบหมายเคสให้เภสัชกร", pharmacist: "yes", manager: "yes", admin: "yes" },
  { permission: "pharmacy.assessment.review", desc: "เปิดหน้าตรวจสอบเคส", pharmacist: "yes", manager: "no", admin: "no" },
  { permission: "pharmacy.assessment.approve", desc: "อนุมัติเคส (ต้องมีใบอนุญาต)", pharmacist: "star", manager: "no", admin: "no" },
  { permission: "pharmacy.assessment.reject", desc: "ปฏิเสธ/ส่งต่อเคส (ต้องมีใบอนุญาต)", pharmacist: "star", manager: "no", admin: "no" },
  { permission: "pharmacy.assessment.request_more_information", desc: "ขอข้อมูลเพิ่มเติมจากลูกค้า", pharmacist: "yes", manager: "no", admin: "no" },
  { permission: "pharmacy.protocol.manage", desc: "สร้าง แก้ไข อนุมัติ Protocol", pharmacist: "yes", manager: "yes", admin: "yes" },
  { permission: "pharmacy.audit.read", desc: "ดู Audit Trail และ Event Log", pharmacist: "yes", manager: "yes", admin: "yes" },
];

const STATE_ROWS: StateRow[] = [
  { status: "COLLECTING_INFORMATION", tone: "slate", meaning: "AI กำลังซักถามข้อมูลจากลูกค้า", next: "รอลูกค้าตอบครบ" },
  { status: "PENDING_CONFIRMATION", tone: "amber", meaning: "ข้อมูลครบแล้ว รอลูกค้ายืนยันความถูกต้อง", next: "รอลูกค้ากด “ยืนยัน”" },
  { status: "WAITING_FOR_PHARMACIST", tone: "blue", meaning: "รอเภสัชกรตรวจสอบ — เคสเข้า Queue แล้ว", next: "กด “รับเคส” เพื่อเริ่มตรวจ" },
  { status: "PHARMACIST_REVIEWING", tone: "purple", meaning: "อยู่ระหว่างตรวจสอบ (คุณรับเคสนี้ไว้แล้ว)", next: "ขอข้อมูลเพิ่ม / Approve / Reject / Refer" },
  { status: "NEED_MORE_INFORMATION", tone: "amber", meaning: "รอข้อมูลเพิ่มจากลูกค้าตามที่เภสัชกรขอ", next: "กลับเข้า Queue เมื่อลูกค้าตอบครบ" },
  { status: "REFER_TO_DOCTOR", tone: "red", meaning: "ระบบประเมินว่าควรพบแพทย์เร่งด่วน", next: "เคสปิดอัตโนมัติ ลูกค้าได้รับข้อความแล้ว" },
  { status: "EMERGENCY_REFERRAL", tone: "purple", meaning: "ฉุกเฉิน — ส่งข้อความฉุกเฉินถึงลูกค้าทันที", next: "เคสปิดอัตโนมัติ" },
  { status: "APPROVED", tone: "green", meaning: "เภสัชกรอนุมัติและส่งคำแนะนำแล้ว", next: "—" },
  { status: "REJECTED", tone: "red", meaning: "เภสัชกรปฏิเสธเคสนี้", next: "—" },
  { status: "CLOSED", tone: "slate", meaning: "เคสจบแล้ว (ทุกเส้นทางลงเอยที่นี่)", next: "—" },
];

const REVIEW_STEPS: FlowStep[] = [
  {
    title: "อ่านสรุปข้อมูล",
    detail: "ตรวจสอบข้อมูลที่ AI เก็บมา ได้แก่ อาการ อายุ เพศ ประวัติแพ้ยา ยาที่ใช้อยู่ และ Risk Level ที่ Rule Engine ประเมิน",
    chips: ["Summary Panel", "Audit Timeline"],
  },
  {
    title: "แก้ไขข้อมูลหากจำเป็น (Manual Entry)",
    detail: "หากข้อมูลขาดหรือไม่ถูกต้อง กรอกเพิ่มเติมได้จาก Dropdown ในหน้าเคส ระบบจะรันกฎประเมินใหม่ทันทีหลังบันทึก",
    chips: ["manual_answer_recorded"],
  },
  {
    title: "ตรวจสอบว่าข้อมูลครบ",
    detail: "ปุ่ม Approve จะถูกปิดใช้งานถ้ายังมีข้อมูลที่ขาด (missing fields) หรือสถานะความครบถ้วนยังไม่ COMPLETE — ต้องกรอกให้ครบก่อน",
  },
  {
    title: "พิมพ์ข้อความและ Approve",
    detail: "เขียนคำแนะนำที่จะส่งถึงลูกค้าด้วยตัวเอง แล้วกด Approve — ข้อความที่ลูกค้าเห็นคือสิ่งที่คุณพิมพ์เป๊ะๆ ไม่ผ่านการเรียบเรียงของ AI และส่งครั้งเดียวเท่านั้น",
    chips: ["assessment.protocol_approved"],
  },
];

const INTAKE_STEPS: FlowStep[] = [
  {
    title: "รับข้อความและตรวจสอบเจตนา",
    detail: "ลูกค้าพิมพ์อาการผ่านช่องทางแชท เช่น “ปวดหัว” — ระบบตรวจจับคำกระตุ้นของ Protocol ที่เปิดใช้งานอยู่ ข้อความกำกวมจะถูกถามยืนยันก่อนเสมอ ไม่เดาเอง",
  },
  {
    title: "ขอความยินยอม (Consent)",
    detail: "ระบบแสดงข้อความปฏิเสธความรับผิด (AI ไม่ใช่เภสัชกร) และขอความยินยอมเก็บข้อมูลสุขภาพ — ถ้าลูกค้าไม่ยินยอม ระบบหยุดทันที ไม่มีเคสเข้า Queue",
  },
  {
    title: "ระบุผู้มีอาการ",
    detail: "ถามว่าผู้มีอาการคือ ตัวเอง / ลูก / พ่อแม่ / บุคคลอื่น เพื่อโหลดประวัติของคนที่ถูกต้อง ไม่ปะปนข้อมูลระหว่างบุคคล",
    chips: ["ตัวเอง", "ลูก", "พ่อแม่", "บุคคลอื่น"],
  },
  {
    title: "ซักถามข้อมูลตาม Protocol",
    detail: "AI ถามเฉพาะข้อมูลที่ยังขาด ถ้าลูกค้าเดิมมีข้อมูลที่ใช้ซ้ำได้ (เช่น อายุ ประวัติแพ้ยา) ระบบเติมให้อัตโนมัติและไม่ถามซ้ำ ส่วนข้อมูลที่เปลี่ยนได้ตามเวลา (ยาที่ใช้อยู่ตอนนี้) จะถามใหม่เสมอ",
  },
  {
    title: "Rule Engine ประเมิน",
    detail: "เมื่อข้อมูลครบ กฎประเมิน (คำนวณตายตัว ไม่ใช่ AI) จะตรวจทุกกฎ Red Flag แล้วเลือกระดับความเสี่ยงสูงสุดที่ตรงเงื่อนไข ถ้าตรงหลายกฎพร้อมกัน ระดับสูงสุดชนะเสมอ",
  },
  {
    title: "สรุปและให้ลูกค้ายืนยัน",
    detail: "ระบบแสดงสรุปข้อมูลทั้งหมดให้ลูกค้าตรวจ ลูกค้าขอแก้เฉพาะช่องที่ผิดได้โดยไม่ต้องเริ่มซักใหม่ทั้งหมด",
    chips: ["PENDING_CONFIRMATION"],
  },
  {
    title: "เคสเข้า Queue",
    detail: "หลังลูกค้ายืนยัน เคสจะปรากฏในหน้า Pharmacy Queue พร้อมหมายเลขเคสที่ลูกค้าได้รับไว้อ้างอิง",
    chips: ["WAITING_FOR_PHARMACIST"],
  },
];

const INTERRUPT_ROWS: InterruptRow[] = [
  { kind: "ทักทาย / ขอบคุณ", behavior: "ตอบรับสั้นๆ แล้วย้อนกลับไปถามคำถามเดิมต่อ" },
  { kind: "ขอซื้อสินค้า", behavior: "แจ้งว่ากำลังซักอาการอยู่ ให้พิมพ์ “หยุดซักอาการ” ก่อนถ้าต้องการสั่งซื้อ" },
  { kind: "ตรวจสถานะคำสั่งซื้อ", behavior: "แจ้งให้หยุดซักอาการก่อน แล้วจึงตรวจสอบคำสั่งซื้อได้" },
  { kind: "พิมพ์ “หยุดซักอาการ”", behavior: "ปิดเคส เซสชันรีเซ็ต ไม่มีเคสเข้า Queue" },
  { kind: "อาการฉุกเฉิน", behavior: "ตอบข้อความฉุกเฉินทันที หยุดคำถามทั้งหมด" },
];

const ESCALATION_ROWS: EscalationRow[] = [
  { level: "LOW", tone: "green", label: "ความเสี่ยงต่ำ", action: "CONTINUE", status: "ดำเนินการซักถามต่อ", message: "ไม่มีข้อความ escalation" },
  { level: "MODERATE", tone: "amber", label: "ปานกลาง", action: "PHARMACIST_REVIEW", status: "WAITING_FOR_PHARMACIST", message: "ข้อความแจ้งลูกค้าว่ากำลังส่งให้เภสัชกรตรวจ" },
  { level: "HIGH", tone: "red", label: "สูง — ควรพบแพทย์", action: "URGENT_MEDICAL_REVIEW", status: "REFER_TO_DOCTOR", message: "ข้อความเร่งด่วนคงที่ ส่งครั้งเดียว แล้วปิดเคส" },
  { level: "EMERGENCY", tone: "purple", label: "ฉุกเฉิน", action: "EMERGENCY_REFERRAL", status: "EMERGENCY_REFERRAL", message: "ข้อความฉุกเฉินคงที่ ส่งครั้งเดียว แล้วปิดเคสทันที" },
];

const COMPOUND_ROWS: CompoundRow[] = [
  { condition: "อายุ < 1 ปี และ อุณหภูมิ ≥ 38°C", logic: "allOf", tone: "purple", result: "EMERGENCY" },
  { condition: "หายใจลำบาก หรือ ชัก", logic: "anyOf", tone: "purple", result: "EMERGENCY" },
  { condition: "อุณหภูมิ ≥ 40°C", logic: "leaf", tone: "red", result: "HIGH" },
  { condition: "มีอาการ > 5 วัน และ ไม่มีคอแข็ง", logic: "allOf + not", tone: "amber", result: "MODERATE" },
];

const LIFECYCLE_STAGES: LifecycleStage[] = [
  { status: "DRAFT", tone: "slate", label: "บันทึกร่าง", desc: "ทีมงานสร้างหรือแก้ Protocol ที่หน้า Pharmacy Protocols — แก้ไขได้เสรี ยังไม่มีผลกับระบบจริง" },
  { status: "PENDING_REVIEW", tone: "amber", label: "ส่งตรวจ", desc: "ส่ง Protocol เข้าสู่ขั้นตอนตรวจสอบเมื่อพร้อมแล้ว ระหว่างนี้แก้ไขไม่ได้จนกว่าจะถูกตีกลับ", cond: "รอเภสัชกรที่มีใบอนุญาตตรวจเนื้อหาทางคลินิก" },
  { status: "APPROVED", tone: "green", label: "อนุมัติแล้ว (ยังปิดอยู่)", desc: "เภสัชกรที่มีใบอนุญาตเป็นคนเดียวที่กด Approve ได้ — บันทึกว่าใครอนุมัติและเมื่อไร", cond: "ยังไม่เปิดใช้งานจริงจนกว่าผู้ดูแลระบบจะเปิด" },
  { status: "ENABLED", tone: "blue", label: "เปิดใช้งาน", desc: "ผู้ดูแลระบบเปิดใช้งาน — Protocol พร้อมรับลูกค้าจริงผ่านทุกช่องทาง", cond: "คำกระตุ้น (trigger words) ต้องไม่ชนกับ Protocol ที่เปิดอยู่ตัวอื่น" },
  { status: "DISABLED", tone: "red", label: "ปิดใช้งาน", desc: "ปิด Protocol ได้ทุกเมื่อ — หยุดรับเคสใหม่ทันที เคสที่กำลังดำเนินอยู่ไม่ได้รับผลกระทบ และเปิดกลับมาใหม่ได้" },
];

const TH: PharmacyManualContent = {
  heroTag: "คู่มือเภสัชกร",
  heroTitle: "คู่มือใช้งานระบบซักอาการเบื้องต้น (Pharmacy Intake)",
  heroLead:
    "สำหรับเภสัชกรที่ตรวจเคสในคิว — เข้าใจสถานะเคส ขั้นตอนที่ AI พาลูกค้าผ่านมาก่อนถึงมือคุณ และเกณฑ์ที่ระบบใช้ตัดสินความเร่งด่วน AI ไม่เคยวินิจฉัยหรือสั่งจ่ายยาเอง — ทุกการตัดสินใจทางคลินิกเป็นของเภสัชกรที่มีใบอนุญาตเท่านั้น",
  heroRoutes: HERO_ROUTES_TH,
  downloadLabel: "ดาวน์โหลดคู่มือ (.md)",
  printLabel: "พิมพ์ / บันทึกเป็น PDF",
  rolesEyebrow: "การเข้าถึง",
  rolesTitle: "บทบาทและสิทธิ์การใช้งาน",
  rolesLead: "สามบทบาทหลักที่เกี่ยวข้องกับงานเภสัชกรรม — เภสัชกร (Pharmacist), ผู้จัดการ (Manager), ผู้ดูแลระบบ (Administrator)",
  roleColPermission: "สิทธิ์",
  roleColDesc: "คำอธิบาย",
  roleColPharmacist: "เภสัชกร",
  roleColManager: "Manager",
  roleColAdmin: "Admin",
  roleRows: ROLE_ROWS,
  roleStarNote: "★ = ต้องมีสิทธิ์นี้ และเป็นผู้มีใบอนุญาต (is_licensed_pharmacist) พร้อมกันทั้งสองเงื่อนไข",
  roleDangerTitle: "🔒 ข้อยกเว้นของ Administrator",
  roleDangerBody:
    "แม้ Administrator จะได้รับสิทธิ์ทุกอย่างโดยอัตโนมัติ แต่การอนุมัติ / ปฏิเสธ / ส่งต่อเคสทางคลินิก ถูกบล็อกไว้เฉพาะผู้ที่มีใบอนุญาตเภสัชกรเท่านั้น ไม่มีทางข้ามข้อกำหนดนี้ได้ไม่ว่าบทบาทอะไร",
  queueEyebrow: "การทำงานประจำวัน",
  queueTitle: "Pharmacy Queue และสถานะเคส",
  queueLead: "หน้า Pharmacy Queue คือจุดศูนย์กลางการทำงานของเภสัชกร แสดงเคสที่รอตรวจสอบตามลำดับเวลา",
  stateColStatus: "สถานะ",
  stateColMeaning: "ความหมาย",
  stateColNext: "ขั้นตอนถัดไป",
  stateRows: STATE_ROWS,
  reviewTitle: "การตรวจสอบเคส",
  reviewLead: "คลิกเปิดเคสจากคิวเพื่อดูและจัดการรายละเอียด",
  reviewSteps: REVIEW_STEPS,
  reviewInfoTitle: "ℹ️ Manual Entry กับ Rule Engine",
  reviewInfoBody:
    "เมื่อคุณกรอกข้อมูลเพิ่มเองแล้วบันทึกสำเร็จ ระบบจะรันกฎประเมินชุดเดิมซ้ำโดยอัตโนมัติทันที ผลลัพธ์จะอัปเดตระดับความเสี่ยงและการแจ้งเตือนเหมือนกับตอนที่ลูกค้าตอบเอง",
  intakeEyebrow: "ขั้นตอนการทำงาน",
  intakeTitle: "ขั้นตอนซักอาการ (Intake Flow)",
  intakeLead: "AI นำลูกค้าผ่านขั้นตอนนี้โดยอัตโนมัติ — เข้าใจ Flow นี้ไว้เพื่อตรวจสอบความถูกต้องของเคสที่มาถึงคุณ",
  intakeSteps: INTAKE_STEPS,
  interruptTitle: "กฎการจัดการข้อความแทรก",
  interruptLead: "ระหว่างซักถาม ลูกค้าอาจส่งข้อความที่ไม่ใช่คำตอบ ระบบจัดการดังนี้",
  interruptColKind: "ประเภทข้อความ",
  interruptColBehavior: "พฤติกรรมของระบบ",
  interruptRows: INTERRUPT_ROWS,
  escalationEyebrow: "ระบบประเมินความเสี่ยง",
  escalationTitle: "การ Escalation",
  escalationLead:
    "กฎประเมิน (ไม่ใช่ AI) เป็นผู้ตัดสิน Severity และ Action ทั้งหมด — AI ไม่มีสิทธิ์เปลี่ยนสถานะเองไม่ว่ากรณีใด เมื่อหลายกฎตรงพร้อมกัน ระดับที่รุนแรงที่สุดชนะเสมอ",
  escalationColLevel: "ระดับ",
  escalationColAction: "Action เริ่มต้น",
  escalationColStatus: "สถานะเคส",
  escalationColMessage: "ข้อความถึงลูกค้า",
  escalationRows: ESCALATION_ROWS,
  escalationDangerTitle: "⚡ ข้อความระดับ HIGH และ EMERGENCY",
  escalationDangerBody:
    "ข้อความ escalation ของสองระดับนี้เป็นข้อความคงที่ที่เตรียมไว้ล่วงหน้า ไม่ผ่านการแต่งของ AI และถูกส่งเพียงครั้งเดียวเท่านั้น",
  compoundTitle: "ตัวอย่าง Compound Rules (Protocol ไข้)",
  compoundColCondition: "เงื่อนไข",
  compoundColLogic: "Logic",
  compoundColResult: "ผลลัพธ์",
  compoundRows: COMPOUND_ROWS,
  lifecycleEyebrow: "การบริหาร Protocol",
  lifecycleTitle: "วงจรชีวิต Protocol",
  lifecycleLead:
    "Protocol คือชุดคำถามและกฎประเมินสำหรับอาการหนึ่งๆ (เช่น ไข้ ปวดหัว ไอ) — เภสัชกรมีบทบาทที่ขั้น “ส่งตรวจ” และ “อนุมัติ” เท่านั้น ส่วนการเขียน Protocol ระดับเทคนิคเป็นงานของทีมพัฒนา",
  lifecycleStages: LIFECYCLE_STAGES,
  lifecycleWarnTitle: "⚠️ ต้องครบทั้ง 4 เงื่อนไข Protocol ถึงจะทำงานจริง",
  lifecycleWarnBody:
    "Protocol จะ Active กับลูกค้าจริงก็ต่อเมื่อ: อนุมัติแล้ว และ เภสัชกรลงชื่อรับรองทางคลินิกแล้ว และ ผู้ดูแลระบบเปิดใช้งานแล้ว และ ตั้งค่าระบบอนุญาตให้ Protocol นี้ทำงาน — ขาดข้อใดข้อหนึ่ง Protocol จะไม่ทำงาน",
  footNoteTitle: "หมายเหตุ",
  footNoteBody:
    "AI ไม่เคยวินิจฉัย ไม่เคยสั่งจ่ายยา และไม่เคยส่งข้อความเกี่ยวกับยาถึงลูกค้าโดยตรง — ทุกการตัดสินใจที่ปลอดภัยสำคัญ (Red Flag, ข้อมูลไม่ครบ, การเปลี่ยนสถานะ, ใครมีสิทธิ์อนุมัติ) ถูกบังคับด้วยโค้ดฝั่งเซิร์ฟเวอร์เสมอ ไม่ใช่ดุลยพินิจของโมเดลภาษา คู่มือนี้ครอบคลุมเฉพาะงานตรวจเคสประจำวัน — เอกสารทางเทคนิคสำหรับการเขียน Protocol ใหม่ อยู่ที่ apps/web/lib/bms/pharmacy/README.md ในโค้ด",
};

const HERO_ROUTES_EN = [
  { label: "Pharmacy Queue", href: "/admin/pharmacy-queue" },
  { label: "Pharmacy Intake Lab", href: "/admin/pharmacy-intake-lab" },
  { label: "Pharmacy Protocols", href: "/admin/pharmacy-protocols" },
];

const ROLE_ROWS_EN: RoleRow[] = [
  { permission: "pharmacy.assessment.read", desc: "View the case list and case details", pharmacist: "yes", manager: "yes", admin: "yes" },
  { permission: "pharmacy.assessment.assign", desc: "Assign a case to a pharmacist", pharmacist: "yes", manager: "yes", admin: "yes" },
  { permission: "pharmacy.assessment.review", desc: "Open the case review screen", pharmacist: "yes", manager: "no", admin: "no" },
  { permission: "pharmacy.assessment.approve", desc: "Approve a case (requires a license)", pharmacist: "star", manager: "no", admin: "no" },
  { permission: "pharmacy.assessment.reject", desc: "Reject / refer a case (requires a license)", pharmacist: "star", manager: "no", admin: "no" },
  { permission: "pharmacy.assessment.request_more_information", desc: "Ask the customer for more information", pharmacist: "yes", manager: "no", admin: "no" },
  { permission: "pharmacy.protocol.manage", desc: "Create, edit, approve a protocol", pharmacist: "yes", manager: "yes", admin: "yes" },
  { permission: "pharmacy.audit.read", desc: "View the audit trail and event log", pharmacist: "yes", manager: "yes", admin: "yes" },
];

const STATE_ROWS_EN: StateRow[] = [
  { status: "COLLECTING_INFORMATION", tone: "slate", meaning: "AI is asking the customer for information", next: "Waiting for the customer to finish answering" },
  { status: "PENDING_CONFIRMATION", tone: "amber", meaning: "Information is complete, waiting for the customer to confirm it", next: "Waiting for the customer to press “Confirm”" },
  { status: "WAITING_FOR_PHARMACIST", tone: "blue", meaning: "Waiting for a pharmacist — the case is now in the queue", next: "Press “Claim” to start reviewing" },
  { status: "PHARMACIST_REVIEWING", tone: "purple", meaning: "Under review (you have claimed this case)", next: "Request more info / Approve / Reject / Refer" },
  { status: "NEED_MORE_INFORMATION", tone: "amber", meaning: "Waiting on the extra info the pharmacist requested", next: "Returns to the queue once the customer answers" },
  { status: "REFER_TO_DOCTOR", tone: "red", meaning: "The system decided the customer should see a doctor urgently", next: "Case closes automatically; the customer already got the message" },
  { status: "EMERGENCY_REFERRAL", tone: "purple", meaning: "Emergency — an emergency message was sent to the customer immediately", next: "Case closes automatically" },
  { status: "APPROVED", tone: "green", meaning: "A pharmacist approved and sent advice", next: "—" },
  { status: "REJECTED", tone: "red", meaning: "A pharmacist rejected this case", next: "—" },
  { status: "CLOSED", tone: "slate", meaning: "The case is done (every path ends here)", next: "—" },
];

const REVIEW_STEPS_EN: FlowStep[] = [
  {
    title: "Read the summary",
    detail: "Review what AI collected: symptoms, age, sex, allergy history, current medications, and the risk level the rule engine assigned.",
    chips: ["Summary Panel", "Audit Timeline"],
  },
  {
    title: "Fill in gaps if needed (manual entry)",
    detail: "If data is missing or wrong, fill it in from the dropdown on the case page — the rule engine re-runs automatically the moment you save.",
    chips: ["manual_answer_recorded"],
  },
  {
    title: "Check that everything is complete",
    detail: "The Approve button stays disabled while any field is missing or completeness isn't COMPLETE yet — fill in everything first.",
  },
  {
    title: "Write your message and Approve",
    detail: "Type the advice yourself and press Approve — the customer sees exactly what you typed, never AI-rewritten, sent exactly once.",
    chips: ["assessment.protocol_approved"],
  },
];

const INTAKE_STEPS_EN: FlowStep[] = [
  {
    title: "Receive the message and check intent",
    detail: "A customer types a symptom in chat, e.g. “headache” — the system matches it against the active protocol's trigger words. An ambiguous message is always confirmed first, never guessed.",
  },
  {
    title: "Ask for consent",
    detail: "The system shows a disclaimer (AI is not a pharmacist) and asks for consent to collect health data — if the customer declines, the system stops immediately and no case reaches the queue.",
  },
  {
    title: "Identify the patient",
    detail: "Asks whether the symptomatic person is the customer / their child / their parent / someone else, so the right history is loaded and never mixed between people.",
    chips: ["Self", "Child", "Parent", "Other"],
  },
  {
    title: "Ask through the protocol",
    detail: "AI only asks for what's still missing. Reusable prior answers (age, allergy history) are filled in automatically and not asked twice; anything that changes over time (current medications) is always asked fresh.",
  },
  {
    title: "The rule engine evaluates",
    detail: "Once complete, the deterministic rule engine (not AI) checks every red-flag rule and picks the highest matching risk level — when several rules match at once, the highest always wins.",
  },
  {
    title: "Summarize and get customer confirmation",
    detail: "The system shows the full summary; the customer can correct just the wrong field without restarting the whole intake.",
    chips: ["PENDING_CONFIRMATION"],
  },
  {
    title: "The case enters the queue",
    detail: "Once confirmed, the case appears on the Pharmacy Queue page with the case number the customer was given for reference.",
    chips: ["WAITING_FOR_PHARMACIST"],
  },
];

const INTERRUPT_ROWS_EN: InterruptRow[] = [
  { kind: "Greeting / thanks", behavior: "A short acknowledgment, then back to the pending question" },
  { kind: "Wants to buy a product", behavior: "Tells them intake is in progress — type “stop screening” first if they want to order" },
  { kind: "Checks an order status", behavior: "Tells them to stop screening first, then the order can be checked" },
  { kind: "Types “stop screening”", behavior: "Closes the case, resets the session, nothing enters the queue" },
  { kind: "An emergency symptom", behavior: "Replies with the emergency message immediately, stops every question" },
];

const ESCALATION_ROWS_EN: EscalationRow[] = [
  { level: "LOW", tone: "green", label: "Low risk", action: "CONTINUE", status: "Keeps asking questions", message: "No escalation message" },
  { level: "MODERATE", tone: "amber", label: "Moderate", action: "PHARMACIST_REVIEW", status: "WAITING_FOR_PHARMACIST", message: "Tells the customer it's being sent to a pharmacist" },
  { level: "HIGH", tone: "red", label: "High — should see a doctor", action: "URGENT_MEDICAL_REVIEW", status: "REFER_TO_DOCTOR", message: "A fixed urgent message, sent once, then the case closes" },
  { level: "EMERGENCY", tone: "purple", label: "Emergency", action: "EMERGENCY_REFERRAL", status: "EMERGENCY_REFERRAL", message: "A fixed emergency message, sent once, case closes immediately" },
];

const COMPOUND_ROWS_EN: CompoundRow[] = [
  { condition: "Age < 1 year AND temperature ≥ 38°C", logic: "allOf", tone: "purple", result: "EMERGENCY" },
  { condition: "Difficulty breathing OR seizure", logic: "anyOf", tone: "purple", result: "EMERGENCY" },
  { condition: "Temperature ≥ 40°C", logic: "leaf", tone: "red", result: "HIGH" },
  { condition: "Symptoms > 5 days AND no neck stiffness", logic: "allOf + not", tone: "amber", result: "MODERATE" },
];

const LIFECYCLE_STAGES_EN: LifecycleStage[] = [
  { status: "DRAFT", tone: "slate", label: "Saved as a draft", desc: "The team creates or edits a protocol on the Pharmacy Protocols page — freely editable, has no effect on production yet." },
  { status: "PENDING_REVIEW", tone: "amber", label: "Submitted for review", desc: "Submitted once ready — it cannot be edited again until sent back to draft.", cond: "Waiting on a licensed pharmacist to review the clinical content" },
  { status: "APPROVED", tone: "green", label: "Approved (still off)", desc: "Only a licensed pharmacist can press Approve — who approved it and when is recorded.", cond: "Still not live until an administrator enables it" },
  { status: "ENABLED", tone: "blue", label: "Enabled", desc: "An administrator enables it — the protocol is now live for real customers on every channel.", cond: "Its trigger words must not collide with another already-active protocol" },
  { status: "DISABLED", tone: "red", label: "Disabled", desc: "Can be disabled at any time — stops taking new cases immediately, cases already in progress are unaffected, and it can be re-enabled later." },
];

const EN: PharmacyManualContent = {
  heroTag: "Pharmacist manual",
  heroTitle: "Pharmacy Intake usage manual",
  heroLead:
    "For pharmacists reviewing cases in the queue — understand case states, the flow AI walks a customer through before it reaches you, and how the system decides urgency. AI never diagnoses or prescribes anything — every clinical decision belongs to a licensed pharmacist alone.",
  heroRoutes: HERO_ROUTES_EN,
  downloadLabel: "Download manual (.md)",
  printLabel: "Print / Save as PDF",
  rolesEyebrow: "Access",
  rolesTitle: "Roles and permissions",
  rolesLead: "Three roles touch pharmacy work — Pharmacist, Manager, Administrator.",
  roleColPermission: "Permission",
  roleColDesc: "What it does",
  roleColPharmacist: "Pharmacist",
  roleColManager: "Manager",
  roleColAdmin: "Admin",
  roleRows: ROLE_ROWS_EN,
  roleStarNote: "★ = requires this permission AND a verified pharmacist license, both at once",
  roleDangerTitle: "🔒 The Administrator exception",
  roleDangerBody:
    "Even though Administrator gets every permission automatically, approving / rejecting / referring a clinical case is blocked to anyone without a verified pharmacist license — no role can ever bypass this.",
  queueEyebrow: "Daily work",
  queueTitle: "Pharmacy Queue and case states",
  queueLead: "The Pharmacy Queue page is where a pharmacist works from — every case waiting for review, in time order.",
  stateColStatus: "Status",
  stateColMeaning: "Meaning",
  stateColNext: "What happens next",
  stateRows: STATE_ROWS_EN,
  reviewTitle: "Reviewing a case",
  reviewLead: "Open a case from the queue to see and act on its details.",
  reviewSteps: REVIEW_STEPS_EN,
  reviewInfoTitle: "ℹ️ Manual entry and the rule engine",
  reviewInfoBody:
    "The moment you save a manually-entered field, the system re-runs the same rule set automatically — the risk level and any notification update exactly as if the customer had answered it themselves.",
  intakeEyebrow: "Workflow",
  intakeTitle: "The intake flow",
  intakeLead: "AI walks the customer through this automatically — understand it so you can judge whether a case reached you correctly.",
  intakeSteps: INTAKE_STEPS_EN,
  interruptTitle: "How interruptions are handled",
  interruptLead: "A customer may send something that isn't an answer mid-intake — here's what the system does.",
  interruptColKind: "Message type",
  interruptColBehavior: "System behavior",
  interruptRows: INTERRUPT_ROWS_EN,
  escalationEyebrow: "Risk scoring",
  escalationTitle: "Escalation",
  escalationLead:
    "The rule engine (not AI) decides every severity and action — AI is never allowed to change a case's state itself. When several rules match at once, the most severe one always wins.",
  escalationColLevel: "Level",
  escalationColAction: "Default action",
  escalationColStatus: "Case status",
  escalationColMessage: "Message to the customer",
  escalationRows: ESCALATION_ROWS_EN,
  escalationDangerTitle: "⚡ HIGH and EMERGENCY messages",
  escalationDangerBody:
    "The escalation message for these two levels is fixed, pre-written text — never AI-generated prose — and is sent exactly once.",
  compoundTitle: "Compound rule example (fever protocol)",
  compoundColCondition: "Condition",
  compoundColLogic: "Logic",
  compoundColResult: "Result",
  compoundRows: COMPOUND_ROWS_EN,
  lifecycleEyebrow: "Protocol management",
  lifecycleTitle: "The protocol lifecycle",
  lifecycleLead:
    "A protocol is a set of questions and evaluation rules for one symptom (fever, headache, cough, etc). A pharmacist's role is at the “submit for review” and “approve” stages only — the technical authoring is engineering work.",
  lifecycleStages: LIFECYCLE_STAGES_EN,
  lifecycleWarnTitle: "⚠️ All 4 conditions must hold before a protocol goes live",
  lifecycleWarnBody:
    "A protocol is only active for real customers when: it's approved, AND a pharmacist has clinically signed off, AND an administrator has enabled it, AND the system configuration allows it to run. Missing any one of these means it does not run.",
  footNoteTitle: "Note",
  footNoteBody:
    "AI never diagnoses, never prescribes, and never sends a medication-related message to a customer directly — every safety-critical decision (red flags, missing data, state changes, who can approve) is enforced by server-side code, never the model's own judgment. This manual only covers day-to-day case review — the technical reference for authoring new protocols lives in apps/web/lib/bms/pharmacy/README.md in the codebase.",
};

const CONTENT: Bilingual<PharmacyManualContent> = { th: TH, en: EN };

function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

function FlowList({ steps }: { steps: FlowStep[] }) {
  return (
    <div className={styles.flowSteps}>
      {steps.map((step) => (
        <div className={styles.flowStep} key={step.title}>
          <span className={styles.flowNum} aria-hidden />
          <div>
            <p className={styles.flowTitle}>{step.title}</p>
            <p className={styles.flowDetail}>{step.detail}</p>
            {step.chips ? (
              <div className={styles.flowChips}>
                {step.chips.map((chip) => (
                  <Tag key={chip}>{chip}</Tag>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Serializes the same content object the page renders from into Markdown, so
 * the downloaded file can never drift from what's on screen — no second copy
 * of the text to maintain.
 */
function buildPharmacyManualMarkdown(c: PharmacyManualContent): string {
  const lines: string[] = [];
  const h1 = (t: string) => lines.push(`# ${t}`, "");
  const h2 = (t: string) => lines.push(`## ${t}`, "");
  const p = (t?: string) => t && lines.push(t, "");
  const table = (head: string[], rows: string[][]) => {
    lines.push(`| ${head.join(" | ")} |`);
    lines.push(`| ${head.map(() => "---").join(" | ")} |`);
    rows.forEach((row) => lines.push(`| ${row.join(" | ")} |`));
    lines.push("");
  };
  const permCell = (v: "yes" | "star" | "no") => (v === "yes" ? "✓" : v === "star" ? "★" : "✗");

  h1(c.heroTitle);
  p(c.heroLead);
  p(c.heroRoutes.map((r) => `${r.label}: ${r.href}`).join(" · "));

  h2(c.rolesTitle);
  p(c.rolesLead);
  table(
    [c.roleColPermission, c.roleColDesc, c.roleColPharmacist, c.roleColManager, c.roleColAdmin],
    c.roleRows.map((r) => [`\`${r.permission}\``, r.desc, permCell(r.pharmacist), permCell(r.manager), permCell(r.admin)])
  );
  p(c.roleStarNote);
  p(`**${c.roleDangerTitle}** — ${c.roleDangerBody}`);

  h2(c.queueTitle);
  p(c.queueLead);
  table(
    [c.stateColStatus, c.stateColMeaning, c.stateColNext],
    c.stateRows.map((r) => [`\`${r.status}\``, r.meaning, r.next])
  );

  h2(c.reviewTitle);
  p(c.reviewLead);
  c.reviewSteps.forEach((step, i) => lines.push(`${i + 1}. **${step.title}** — ${step.detail}`));
  lines.push("");
  p(`**${c.reviewInfoTitle}** — ${c.reviewInfoBody}`);

  h2(c.intakeTitle);
  p(c.intakeLead);
  c.intakeSteps.forEach((step, i) => lines.push(`${i + 1}. **${step.title}** — ${step.detail}`));
  lines.push("");

  h2(c.interruptTitle);
  p(c.interruptLead);
  table(
    [c.interruptColKind, c.interruptColBehavior],
    c.interruptRows.map((r) => [r.kind, r.behavior])
  );

  h2(c.escalationTitle);
  p(c.escalationLead);
  table(
    [c.escalationColLevel, c.escalationColAction, c.escalationColStatus, c.escalationColMessage],
    c.escalationRows.map((r) => [`${r.level} (${r.label})`, `\`${r.action}\``, `\`${r.status}\``, r.message])
  );
  p(`**${c.escalationDangerTitle}** — ${c.escalationDangerBody}`);

  h2(c.compoundTitle);
  table(
    [c.compoundColCondition, c.compoundColLogic, c.compoundColResult],
    c.compoundRows.map((r) => [r.condition, `\`${r.logic}\``, r.result])
  );

  h2(c.lifecycleTitle);
  p(c.lifecycleLead);
  c.lifecycleStages.forEach((stage) => {
    lines.push(`- **${stage.status} — ${stage.label}**: ${stage.desc}${stage.cond ? ` _(${stage.cond})_` : ""}`);
  });
  lines.push("");
  p(`**${c.lifecycleWarnTitle}** — ${c.lifecycleWarnBody}`);

  h2(c.footNoteTitle);
  p(c.footNoteBody);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export default function PharmacyManualPage() {
  const { lang } = useI18n();
  const { can, loading: permissionsLoading } = useBmsPermissions();
  const canView = can("pharmacy.assessment.read");
  const c = resolveBilingual(CONTENT, lang);

  const handleDownload = useCallback(() => {
    const markdown = buildPharmacyManualMarkdown(c);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bms-pharmacy-manual-${lang}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [c, lang]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  if (permissionsLoading) return <Card loading />;
  if (!canView) {
    return (
      <Alert
        closable
        type="error"
        showIcon
        message={lang === "th" ? "ไม่มีสิทธิ์ดูคู่มือนี้" : "You don't have permission to view this manual"}
        description={lang === "th" ? "ต้องมีสิทธิ์ pharmacy.assessment.read" : "Requires the pharmacy.assessment.read permission"}
      />
    );
  }

  return (
    <div className={styles.page} data-print-root>
      <div className={styles.hero}>
        <Tag color="green" style={{ width: "fit-content" }}>{c.heroTag}</Tag>
        <Title level={2} className={styles.heroTitle}>{c.heroTitle}</Title>
        <Paragraph className={styles.heroLead}>{c.heroLead}</Paragraph>
        <div className={styles.heroMeta}>
          {c.heroRoutes.map((route) => (
            <Link key={route.href} href={route.href}>
              <Tag icon={<ExperimentOutlined />}>{route.label}</Tag>
            </Link>
          ))}
        </div>
        <div className={styles.heroActions}>
          <Button icon={<PrinterOutlined />} onClick={handlePrint}>{c.printLabel}</Button>
          <Button icon={<DownloadOutlined />} onClick={handleDownload}>{c.downloadLabel}</Button>
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionEyebrow}>{c.rolesEyebrow}</div>
        <Title level={3} className={styles.sectionTitle}>{c.rolesTitle}</Title>
        <Paragraph className={styles.sectionLead}>{c.rolesLead}</Paragraph>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{c.roleColPermission}</th>
                <th>{c.roleColDesc}</th>
                <th style={{ textAlign: "center" }}>{c.roleColPharmacist}</th>
                <th style={{ textAlign: "center" }}>{c.roleColManager}</th>
                <th style={{ textAlign: "center" }}>{c.roleColAdmin}</th>
              </tr>
            </thead>
            <tbody>
              {c.roleRows.map((row) => (
                <tr key={row.permission}>
                  <td><Text code>{row.permission}</Text></td>
                  <td>{row.desc}</td>
                  <td style={{ textAlign: "center" }}>{row.pharmacist === "yes" ? "✓" : row.pharmacist === "star" ? "★" : "✗"}</td>
                  <td style={{ textAlign: "center" }}>{row.manager === "yes" ? "✓" : "✗"}</td>
                  <td style={{ textAlign: "center" }}>{row.admin === "yes" ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Text type="secondary" style={{ fontSize: 12.5 }}>{c.roleStarNote}</Text>
        <div className={`${styles.callout} ${styles.danger}`}>
          <p className={styles.calloutTitle}>{c.roleDangerTitle}</p>
          <p style={{ margin: 0 }}>{c.roleDangerBody}</p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionEyebrow}>{c.queueEyebrow}</div>
        <Title level={3} className={styles.sectionTitle}>{c.queueTitle}</Title>
        <Paragraph className={styles.sectionLead}>{c.queueLead}</Paragraph>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{c.stateColStatus}</th>
                <th>{c.stateColMeaning}</th>
                <th>{c.stateColNext}</th>
              </tr>
            </thead>
            <tbody>
              {c.stateRows.map((row) => (
                <tr key={row.status}>
                  <td><ToneBadge tone={row.tone}>{row.status}</ToneBadge></td>
                  <td>{row.meaning}</td>
                  <td>{row.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <Title level={3} className={styles.sectionTitle}>{c.reviewTitle}</Title>
        <Paragraph className={styles.sectionLead}>{c.reviewLead}</Paragraph>
        <FlowList steps={c.reviewSteps} />
        <div className={`${styles.callout} ${styles.info}`}>
          <p className={styles.calloutTitle}>{c.reviewInfoTitle}</p>
          <p style={{ margin: 0 }}>{c.reviewInfoBody}</p>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionEyebrow}>{c.intakeEyebrow}</div>
        <Title level={3} className={styles.sectionTitle}>{c.intakeTitle}</Title>
        <Paragraph className={styles.sectionLead}>{c.intakeLead}</Paragraph>
        <FlowList steps={c.intakeSteps} />
      </section>

      <section className={styles.section}>
        <Title level={3} className={styles.sectionTitle}>{c.interruptTitle}</Title>
        <Paragraph className={styles.sectionLead}>{c.interruptLead}</Paragraph>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{c.interruptColKind}</th>
                <th>{c.interruptColBehavior}</th>
              </tr>
            </thead>
            <tbody>
              {c.interruptRows.map((row) => (
                <tr key={row.kind}>
                  <td>{row.kind}</td>
                  <td>{row.behavior}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionEyebrow}>{c.escalationEyebrow}</div>
        <Title level={3} className={styles.sectionTitle}>{c.escalationTitle}</Title>
        <Paragraph className={styles.sectionLead}>{c.escalationLead}</Paragraph>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{c.escalationColLevel}</th>
                <th>{c.escalationColAction}</th>
                <th>{c.escalationColStatus}</th>
                <th>{c.escalationColMessage}</th>
              </tr>
            </thead>
            <tbody>
              {c.escalationRows.map((row) => (
                <tr key={row.level}>
                  <td><ToneBadge tone={row.tone}>{row.label}</ToneBadge></td>
                  <td><Text code>{row.action}</Text></td>
                  <td><Text code>{row.status}</Text></td>
                  <td>{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={`${styles.callout} ${styles.danger}`}>
          <p className={styles.calloutTitle}>{c.escalationDangerTitle}</p>
          <p style={{ margin: 0 }}>{c.escalationDangerBody}</p>
        </div>

        <Title level={4} style={{ margin: "8px 0 0" }}>{c.compoundTitle}</Title>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{c.compoundColCondition}</th>
                <th>{c.compoundColLogic}</th>
                <th>{c.compoundColResult}</th>
              </tr>
            </thead>
            <tbody>
              {c.compoundRows.map((row) => (
                <tr key={row.condition}>
                  <td>{row.condition}</td>
                  <td><Text code>{row.logic}</Text></td>
                  <td><ToneBadge tone={row.tone}>{row.result}</ToneBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionEyebrow}>{c.lifecycleEyebrow}</div>
        <Title level={3} className={styles.sectionTitle}>{c.lifecycleTitle}</Title>
        <Paragraph className={styles.sectionLead}>{c.lifecycleLead}</Paragraph>
        <div className={styles.lifecycle}>
          {c.lifecycleStages.map((stage, i) => (
            <div className={styles.lifecycleStep} key={stage.status}>
              <div className={styles.lifecycleRail}>
                <span className={styles.lifecycleDot} style={{ background: TONE_HEX[stage.tone] }} />
                {i < c.lifecycleStages.length - 1 ? <span className={styles.lifecycleLine} /> : null}
              </div>
              <div className={styles.lifecycleBody}>
                <ToneBadge tone={stage.tone}>{stage.status}</ToneBadge>{" "}
                <Text strong>{stage.label}</Text>
                <p className={styles.lifecycleDesc}>{stage.desc}</p>
                {stage.cond ? <p className={styles.lifecycleCond}>{stage.cond}</p> : null}
              </div>
            </div>
          ))}
        </div>
        <div className={`${styles.callout} ${styles.warn}`}>
          <p className={styles.calloutTitle}>{c.lifecycleWarnTitle}</p>
          <p style={{ margin: 0 }}>{c.lifecycleWarnBody}</p>
        </div>
      </section>

      <section className={styles.section}>
        <Title level={4} style={{ margin: 0 }}>{c.footNoteTitle}</Title>
        <Paragraph type="secondary" style={{ margin: 0 }}>{c.footNoteBody}</Paragraph>
        <Space wrap>
          <Tag icon={<FileProtectOutlined />}>apps/web/lib/bms/pharmacy/README.md</Tag>
        </Space>
      </section>
    </div>
  );
}

const TONE_HEX: Record<Tone, string> = {
  slate: "#8a97a8",
  amber: "#c98a1f",
  blue: "#3c74b8",
  purple: "#7a56c9",
  red: "#c0453a",
  green: "#2f9660",
  cyan: "#2a9494",
};
