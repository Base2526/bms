'use client';

// Shared content + rendering for the POS counter manual — used by both
// /admin/pos-manual (gated by pos.sell, for Manager/Sales/non-pos_only
// Cashier logins) and /pos/manual (no admin session required at all, since
// a pos_only cashier account is blocked from /admin at the login level and
// would otherwise never be able to open this page from its own register).
// One copy of the content, two thin page wrappers with different auth.
import { Button, Tag, Typography } from "antd";
import { DownloadOutlined, PrinterOutlined } from "@ant-design/icons";
import { useCallback, useState } from "react";
import styles from "../../app/(admin)/admin/pos-manual/pos-manual.module.css";

const { Title, Paragraph, Text } = Typography;

export type Tone = "slate" | "amber" | "blue" | "purple" | "red" | "green" | "dual";

/**
 * A small set of block kinds covers every table/list/callout in this manual
 * without a bespoke type per section (there are 14 sections) — a generic
 * BlockRenderer maps kind -> markup, and the same blocks feed the Markdown
 * export, so the download can never drift from what's on screen.
 */
export type Block =
  | { kind: "p"; text: string }
  | { kind: "sub"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "callout"; tone: "info" | "warn" | "danger"; title: string; body: string }
  | { kind: "table"; head: string[]; rows: (string | { text: string; tone?: Tone })[][] }
  | { kind: "flow"; steps: { title: string; detail: string; chips?: string[] }[] }
  | { kind: "stats"; items: { label: string; value: string }[] };

export type ManualSection = {
  id: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  defaultOpen: boolean;
  blocks: Block[];
};

export type PageCopy = {
  heroTag: string;
  heroTitle: string;
  heroLead: string;
  printLabel: string;
  downloadLabel: string;
  noPermTitle: string;
  noPermDesc: string;
};

export const COPY_TH: PageCopy = {
  heroTag: "คู่มือแคชเชียร์",
  heroTitle: "คู่มือใช้งาน POS หน้าร้าน",
  heroLead:
    "สำหรับแคชเชียร์และหัวหน้ากะที่ทำงานที่ /pos — เปิดกะ ขายสินค้า รับชำระเงิน คืนสินค้า จัดการเงินสดในลิ้นชัก ไปจนถึงปิดกะและออกรายงาน หลักการสำคัญที่สุด: เบราว์เซอร์ไม่เคยกำหนดราคาเอง ทุกยอดคำนวณที่เซิร์ฟเวอร์ หน้าจอแสดงแค่ตัวอย่าง",
  printLabel: "พิมพ์ / บันทึกเป็น PDF",
  downloadLabel: "ดาวน์โหลดคู่มือ (.md)",
  noPermTitle: "ไม่มีสิทธิ์ดูคู่มือนี้",
  noPermDesc: "ต้องมีสิทธิ์ pos.sell",
};

export const COPY_EN: PageCopy = {
  heroTag: "Cashier manual",
  heroTitle: "POS counter usage manual",
  heroLead:
    "For cashiers and shift leads working at /pos — opening a shift, selling, taking payment, returns, cash drawer handling, through to closing a shift and reading reports. The single most important rule: the browser never sets a price itself. Every total is computed server-side; the screen only shows a preview.",
  printLabel: "Print / Save as PDF",
  downloadLabel: "Download manual (.md)",
  noPermTitle: "You don't have permission to view this manual",
  noPermDesc: "Requires the pos.sell permission",
};

// ---------------------------------------------------------------------------
// TH sections
// ---------------------------------------------------------------------------
export const TH_SECTIONS: ManualSection[] = [
  {
    id: "access",
    eyebrow: "ก่อนเริ่มงาน",
    title: "การเข้าใช้งานและโครงหน้าจอ",
    lead: "POS ยืนยันตัวตน 2 ชั้น แยกจากระบบ Admin โดยสิ้นเชิง",
    defaultOpen: false,
    blocks: [
      {
        kind: "stats",
        items: [
          { label: "ชั้นที่ 1 — เครื่อง", value: "Device Token" },
          { label: "ชั้นที่ 2 — คน", value: "Cashier PIN" },
        ],
      },
      { kind: "p", text: "ผู้ดูแลระบบสร้างเครื่องและออก Token ครั้งเดียวที่ /admin/pos-devices แล้วจับคู่กับเบราว์เซอร์ หลังจากนั้นเครื่องจะจำ Token ไว้" },
      { kind: "callout", tone: "warn", title: "PIN เก็บในหน่วยความจำเท่านั้น", body: "PIN ของแคชเชียร์ไม่ถูกบันทึกลงเบราว์เซอร์ ทุกครั้งที่รีเฟรชหน้าหรือปิด-เปิดเครื่องใหม่ ต้องกรอก PIN อีกครั้ง — ตั้งใจให้เป็นแบบนี้" },
      { kind: "sub", text: "บัญชี pos_only" },
      { kind: "p", text: "บัญชีแคชเชียร์ที่ตั้งเป็น pos_only จะถูกบล็อกจากการเข้า /admin ที่ระดับระบบ login ไม่ใช่แค่ซ่อนเมนู และปลดค่านี้ของตัวเองหรือของผู้ดูแลระบบไม่ได้" },
      { kind: "sub", text: "โครงหน้าจอเคาน์เตอร์" },
      {
        kind: "list",
        items: [
          "แถบไอคอนซ้าย: สลับ ขาย / คืนสินค้า / กะ / ตั้งค่า / รับสินค้า — เฉพาะคอลัมน์ซ้ายเปลี่ยนตาม",
          "คอลัมน์ขวาคงที่เสมอ: ยอดรวม แป้นเงินสด ปุ่มชำระเงิน เพราะคิวลูกค้าซ้อนกันได้",
          "หน้าเพจไม่เลื่อน — แต่ละคอลัมน์เลื่อนในกล่องตัวเอง ปุ่มชำระเงินจึงไม่ตกจอ",
          "ออกจากแท็บขายแล้วกลับมา โฟกัสกลับไปช่องสแกนอัตโนมัติ",
          "จอกว้างน้อยกว่า 768px แถบไอคอนย้ายลงเป็นแถบล่าง",
        ],
      },
      { kind: "sub", text: "จอแสดงผลสำหรับลูกค้า" },
      { kind: "p", text: "เปิด /pos/display บนจอที่สอง — แสดงรายการ ยอดรวม ส่วนลด เงินทอน ไม่มีปุ่มใดๆ ซิงค์ผ่าน BroadcastChannel ในเครื่องเดียวกัน ไม่ใช่ WebSocket เน็ตหลุดจอนี้จึงไม่ค้างยอดเก่าที่ผิด แสดงเฉพาะ 8 รายการล่าสุด" },
    ],
  },
  {
    id: "shift-open",
    eyebrow: "ขั้นตอนที่ 1",
    title: "เปิดกะ (Open Shift)",
    lead: "ทุกการขายต้องอยู่ในกะที่เปิดอยู่ — การเปิดกะบันทึกเงินทอนตั้งต้น (float) เพื่อกระทบยอดตอนปิดกะได้",
    defaultOpen: false,
    blocks: [
      {
        kind: "flow",
        steps: [
          { title: "เลือกชื่อแคชเชียร์และกรอก PIN", detail: "ต้องมีสิทธิ์ pos.shift.open" },
          { title: "นับเงินทอนตั้งต้นและกรอกยอด", detail: "บันทึกลง Audit Log ทันที — ระบบเก็บทั้งสองปลายของกะ (เงินตอนเปิด และยอดคาดหวัง/นับได้/ผลต่างตอนปิด)" },
          { title: "ตรวจ Checklist \"ยังขายไม่ได้\"", detail: "แสดงรายการที่ขาด เช่น สินค้าไม่มีราคา ไม่มีแถวสต็อกที่สาขานี้ หรือยังไม่ตั้งประเภท VAT" },
        ],
      },
      { kind: "callout", tone: "info", title: "เปิด-ปิดกะทำที่เคาน์เตอร์ได้เลย", body: "ไม่ต้องไปหน้า Admin — รายงานกะ (X/Z) ก็อ่านจากเคาน์เตอร์ได้ด้วยสิทธิ์ pos.shift.report" },
    ],
  },
  {
    id: "selling",
    eyebrow: "การขาย",
    title: "ขายสินค้า",
    lead: "สแกนบาร์โค้ด พิมพ์ SKU หรือค้นจากรายการสด ขายเป็นหน่วยย่อยหรือแพ็กก็ได้",
    defaultOpen: true,
    blocks: [
      { kind: "sub", text: "โหมดเครื่องสแกน (Scan Manager)" },
      { kind: "p", text: "เครื่องสแกน Bluetooth คือคีย์บอร์ดในสายตาเบราว์เซอร์ ระบบจึงไม่เดาว่าเป็นการสแกนจากความเร็วพิมพ์หรือช่องที่โฟกัส — ตั้งได้ 2 โหมด: FOCUS (ใช้ช่องสแกนเดิม ต้องคุมโฟกัสเอง) และ PREFIX (แนะนำ — ตั้งเครื่องสแกนให้ส่งปุ่มฟังก์ชัน เช่น F9 นำหน้า + Enter ปิดท้าย ระบบดักจับได้ทั้งชุดก่อนถึงช่องอื่น)" },
      { kind: "callout", tone: "warn", title: "การสแกนถูกกำหนดโดยสถานะหน้าจอ ไม่ใช่โฟกัส", body: "แท็บขายเพิ่มลงตะกร้า / ค้นสินค้าอ่านโดยไม่เพิ่ม / คืนสินค้าค้นใบเสร็จ / รับสินค้าเพิ่มเข้าใบสั่งซื้อ — แท็บกะ ตั้งค่า และช่วงกำลังเขียนข้อมูล ปิดการสแกนทั้งหมด" },
      { kind: "sub", text: "พักบิล (Park)" },
      {
        kind: "list",
        items: [
          "บิลที่พักไว้ไม่จองสต็อกและไม่ล็อกราคา — เรียกคืนจะอ่านราคา/สต็อกใหม่เสมอ",
          "หายไปพร้อมปิดกะ ไม่ค้างข้ามวัน — จำกัด 20 บิลต่อกะ",
          "สองเครื่องในกะเดียวกันดึงบิลเดียวกันมาขายซ้ำไม่ได้",
          "ถ้าสินค้าต้องให้เภสัชกรตรวจ ระบบจะมีปุ่มส่งเคสจากหน้า POS เพื่อสร้างเคส ผูกกับบิลพัก และเคลียร์หน้าเคาน์เตอร์ทันที — เรียกกลับมาปิดการขายได้เมื่อเคสอนุมัติแล้วเท่านั้น",
        ],
      },
      { kind: "sub", text: "Serial Number" },
      {
        kind: "list",
        items: [
          "สินค้า serial_tracked ต้องกรอก Serial 1 ตัวต่อ 1 หน่วยย่อยก่อนขายผ่าน",
          "ตรวจก่อนสร้างบิล — กรอกไม่ครบจึงไม่เสียสต็อก ไม่หักแต้ม ไม่นับคูปอง",
          "Serial ซ้ำในบิลเดียวกันหรือที่ขายไปแล้วถูกปฏิเสธ",
          "คืนทั้งบิล Serial กลับมาขายใหม่ได้ — คืนบางส่วนไม่ปลด Serial เพราะไม่รู้ว่าชิ้นไหนถูกคืน",
          "บังคับเฉพาะ POS เท่านั้น ออนไลน์ไม่ได้เพราะไม่รู้ว่าจะหยิบชิ้นไหน",
        ],
      },
      { kind: "sub", text: "ค่าธรรมเนียมที่ไม่ใช่สินค้า" },
      { kind: "p", text: "ค่าถุง ค่าบริการ ค่าห่อของขวัญ — เพิ่มเป็นบรรทัดพิเศษได้เลย ไม่ต้องสร้าง SKU ปลอม" },
      {
        kind: "list",
        items: [
          "อยู่ในฐาน VAT — ค่าบริการที่ร้านจด VAT ต้องเสียภาษี",
          "ลดราคาไม่ได้ — ส่วนลดทุกชั้นคิดจากยอดสินค้า ค่าธรรมเนียมบวกทีหลัง",
          "บรรทัดไม่ครบ (ไม่มีชื่อ/ยอด/จำนวนไม่ถูกต้อง) ถูกตัดออกเงียบๆ ไม่ทำให้บิลล้ม",
          "ใช้สิทธิ์ pos.sell ธรรมดา — ชื่อรายการพิมพ์บนใบเสร็จให้ลูกค้าเห็นเป็นการควบคุมที่แน่นกว่าการล็อกสิทธิ์",
        ],
      },
    ],
  },
  {
    id: "pricing",
    eyebrow: "การขาย",
    title: "ราคาและโปรโมชั่น",
    lead: "ระบบมีกลไกราคาหลายชั้น ทุกชั้นคำนวณที่เซิร์ฟเวอร์และไม่นับเป็นส่วนลดตามบิล",
    defaultOpen: true,
    blocks: [
      { kind: "sub", text: "ลำดับการหาราคา" },
      { kind: "p", text: "ราคา BASE ตามขนาด → ราคา BASE ร่วม → ราคาสินค้า (fallback) — POS, การสร้างออเดอร์, AI และหน้าร้านออนไลน์ ใช้ลำดับเดียวกันทั้งหมด" },
      { kind: "sub", text: "ราคาขายส่งตามจำนวน (Wholesale Steps)" },
      { kind: "p", text: "\"ซื้อสิบได้ราคาส่ง\" — ขั้นที่มี min_qty สูงสุดที่ไม่เกินจำนวนซื้อชนะ และใช้กับทุกหน่วย ไม่ใช่แค่ส่วนที่เกินเกณฑ์" },
      {
        kind: "table",
        head: ["ขอบเขต", "วิธีคิด", "เหมาะกับ"],
        rows: [
          ["แยกขนาด (ราคาคงที่)", "รวมบรรทัดของ SKU+ขนาดเดียวกัน ใช้ราคาต่อหน่วยที่ตั้งไว้", "สินค้าขนาดเดียว หรือแต่ละขนาดมีราคาส่งของตัวเอง"],
          ["รวมทุกขนาด (เปอร์เซ็นต์)", "รวมจำนวนทุกขนาดของ SKU เพื่อผ่านเกณฑ์ แล้วลด % จากราคาฐานแต่ละขนาดเอง", "สินค้าหลายขนาดที่ราคาต่างกัน"],
        ],
      },
      { kind: "callout", tone: "info", title: "บรรทัดที่ขายเป็นแพ็กใช้ราคาแพ็ก", body: "หน่วยในแพ็กยังนับรวมเข้าเกณฑ์ SKU+ขนาดเดิม แต่ตัวบรรทัดแพ็กเก็บราคาแพ็กไว้ ไม่ให้สองกลไกแข่งกันในบรรทัดเดียว" },
      { kind: "sub", text: "โปรโมชั่น ซื้อ X แถม Y และ N ชิ้นราคาเดียว" },
      { kind: "p", text: "ไม่ใช่ส่วนลดชั้นที่ห้า — เป็นกลไกราคาระดับบรรทัด และไม่อยู่ใต้เพดานส่วนลดตามบิล (ถ้าอยู่ใต้เพดาน โปรที่ติดป้ายไว้อาจถูกตัดทอนกลางบิล กลายเป็นร้านผิดคำพูดกับลูกค้า)" },
      {
        kind: "list",
        items: [
          "เศษที่เหลือคิดราคาเต็ม — ซื้อ 3 แถม 1 จำนวน 7 ชิ้น = ครบ 1 ชุด + 3 ชิ้นราคาเต็ม จ่าย 6 ชิ้น",
          "จำนวนรวมข้ามขนาด คิดครั้งเดียวต่อ SKU ต่อบิล",
          "โปรที่แพงกว่าซื้อแยกจะไม่ถูกใช้ — ยอดที่ถูกกว่าชนะเสมอ",
          "1 สินค้า 1 โปรโมชั่น (บังคับระดับฐานข้อมูล) · มีช่วงวันที่ (โปรหมดอายุหยุดทำงานเอง) · แพ็กไม่เข้าร่วม",
        ],
      },
      { kind: "p", text: "ยังไม่รองรับ: โปรข้ามสินค้า (\"ซื้อ A แถม B\")" },
      { kind: "sub", text: "ตะกร้ารีเฟรชราคาก่อนชำระเงิน" },
      { kind: "p", text: "ก่อนกดชำระเงินทุกครั้ง ระบบดึงราคา ขั้นขายส่ง ข้อมูลแพ็ก และโปรโมชั่นของทุกบรรทัดใหม่จากเซิร์ฟเวอร์ — ถ้ามีอะไรเปลี่ยนหลังสินค้าเข้าตะกร้า การชำระเงินหยุดก่อนเขียนออเดอร์ ยอดใหม่แทนยอดเดิม ต้องตรวจและรับเงินอีกครั้ง" },
    ],
  },
  {
    id: "discounts",
    eyebrow: "การขาย",
    title: "ส่วนลดและสมาชิก",
    lead: "ส่วนลด 4 ชั้นซ้อนกันได้ในบิลเดียว คิดตามลำดับคงที่ อยู่ใต้เพดานเดียวกัน",
    defaultOpen: true,
    blocks: [
      {
        kind: "table",
        head: ["ชั้น", "ที่มา", "ย้อนกลับ"],
        rows: [
          ["1. ส่วนลดสมาชิก (Tier)", "อัตโนมัติเมื่อผูกลูกค้ากับบิล", { text: "ย้อนกลับได้", tone: "green" }],
          ["2. คูปอง", "ต้องมีรหัสที่ลูกค้ารู้", { text: "ย้อนกลับยาก", tone: "red" }],
          ["3. แลกแต้มสะสม", "ตามอัตราที่ร้านตั้ง ปัดลงเต็มหน่วยเสมอ", { text: "ย้อนกลับได้", tone: "green" }],
          ["4. ส่วนลดมือ (Manual)", "คีย์ที่เคาน์เตอร์ ต้องมีหัวหน้าอนุมัติ", { text: "2 คน 2 PIN", tone: "dual" }],
        ],
      },
      { kind: "p", text: "ชนเพดาน max_discount_pct เมื่อไหร่ ระบบตัดจากชั้นที่ย้อนกลับง่ายที่สุดก่อน (ชั้น 4 → 1) ผลรวมทุกชั้นลงคอลัมน์เดียว (discount_amount) ซึ่งเป็นฐานของ VAT และใบกำกับภาษี" },
      { kind: "sub", text: "การอนุมัติส่วนลดมือ" },
      {
        kind: "flow",
        steps: [
          { title: "แคชเชียร์กรอกยอดส่วนลดและเหตุผล", detail: "เหตุผลเป็นข้อมูลบังคับ" },
          { title: "ผู้อนุมัติกรอก PIN ของตัวเอง", detail: "ต้องมีสิทธิ์ pos.discount.approve — กรอกแยกจาก PIN แคชเชียร์เสมอ แม้เป็นคนเดียวกัน", chips: ["Dual Control"] },
          { title: "เซิร์ฟเวอร์ตรวจแล้วส่งยอดเข้าบิล", detail: "การอนุมัติเป็นต่อบิล ไม่ใช่ต่อกะ — ล้างหลังทุกการขาย" },
        ],
      },
      { kind: "callout", tone: "danger", title: "บิลถูกปฏิเสธด้วย DISCOUNT_UNAPPROVED สองกรณี", body: "1) มียอดส่วนลดแต่ไม่มีผู้อนุมัติ/เหตุผล 2) มียอดที่เพดานต่อบิลจะตัดทอน — ล้มดังๆ ให้คีย์ใหม่ ดีกว่าตัดเงียบๆ แล้วเก็บเงินเกินที่แจ้งลูกค้าไป" },
      { kind: "sub", text: "แต้มสะสม (Loyalty Points)" },
      {
        kind: "table",
        head: ["เรื่อง", "กฎที่ใช้จริง"],
        rows: [
          ["การได้แต้ม", "เกิดตอนบิลเป็น PAID ฐานคิดคือยอดหลังหักส่วนลด เฉพาะลูกค้าที่มี member_no"],
          ["การปัดเศษ", "ปัดลงเต็มหน่วยเสมอ เช่น 3,045 แต้มแลกได้ 3,000 — ปุ่ม \"ใช้ทั้งหมด\" ส่ง 3,000 ที่ใช้จริง"],
          ["แลกไม่พอ = ปฏิเสธ", "ไม่ตัดทอนเงียบๆ — บิลล้มด้วย POINTS_INVALID"],
          ["คืนสินค้า", "ดึงแต้มที่ได้คืน + คืนแต้มที่แลกไป ตามสัดส่วนที่คืนเงิน"],
          ["ยอดติดลบได้", "ตั้งใจ — กันไม่ให้ \"คืนของหลังแลกแต้ม\" มีกำไร"],
          ["แต้มหมดอายุ", "FIFO ขับด้วยงานประจำวัน — ถ้าไม่ตั้ง cron แต้มจะไม่หมดอายุเลย"],
        ],
      },
      { kind: "callout", tone: "warn", title: "สำหรับฝ่ายบัญชี", body: "แต้มที่ยังใช้ได้เป็นหนี้สิน (รายได้รอรับรู้ตาม IFRS 15) — ให้ตัวเลขนี้กับนักบัญชีทุกสิ้นงวด ไม่ใช่ตัวเลขตกแต่งบนแดชบอร์ด" },
      {
        kind: "list",
        items: [
          "ไม่มีการแจ้งลูกค้าอัตโนมัติเรื่องแต้มใกล้หมดอายุ/เลื่อนระดับ — ร้านต้องดูรายชื่อที่ /admin/loyalty แล้วติดต่อเอง",
          "ไม่มีรายงานแต้มแบบส่งออกไฟล์ — ดูบนหน้าจอเท่านั้น",
          "แลกแต้มเป็นสินค้าไม่ได้ แลกเป็นส่วนลดบิลเท่านั้น",
          "AI อ่านยอดแต้มได้ แต่แลกไม่ได้ — การแลกเกิดตอนสร้างบิลเท่านั้น",
        ],
      },
      { kind: "sub", text: "บัตรของขวัญและเครดิตร้าน (Store Credit)" },
      { kind: "callout", tone: "danger", title: "ต่างจากแต้มหนึ่งข้อ: เครดิตติดลบไม่ได้", body: "เครดิตคือเงิน ยอดติดลบหมายถึงร้านเป็นหนี้ลูกค้าโดยไม่มีใครอนุมัติ — บังคับด้วย CHECK ที่ตาราง ไม่ใช่แค่ในโค้ด" },
      {
        kind: "list",
        items: [
          "ตรวจรหัสก่อนสร้างบิล — ผิดหรือยอดไม่พอจึงไม่เสียสต็อก ไม่เสียแต้ม ไม่นับคูปอง",
          "STORE_CREDIT เป็นวิธีชำระเงินแต่ไม่ใช่เงินสด — ไม่เข้ายอดลิ้นชักหรือสูตรเงินสดคาดหวัง",
          "คืนสินค้าคืนเครดิตกลับบัตรใบเดิมตามสัดส่วน",
          "รหัสบัตรสุ่มจาก crypto ไม่ใช่เลขเรียง — ตัดอักขระที่อ่านสับสน (I O 0 1)",
          "ออกบัตร/ปรับยอด: Manager เท่านั้น · รับบัตรมาใช้: ทุกคนที่ขาย",
        ],
      },
    ],
  },
  {
    id: "payment",
    eyebrow: "การขาย",
    title: "การชำระเงิน",
    lead: "เลือกวิธีชำระจากแถวปุ่มใต้ช่องยอดเงิน — บิลเดียวแบ่งจ่ายได้หลายวิธี",
    defaultOpen: true,
    blocks: [
      {
        kind: "table",
        head: ["วิธี", "พฤติกรรมหน้าจอ", "เข้าลิ้นชัก"],
        rows: [
          ["เงินสด", "เปิดแป้นรับเงินด่วน บันทึกเงินรับ/ทอนต่อแถว", { text: "ใช่", tone: "green" }],
          ["QR / บัตร / โอน / Wallet", "กรอกเลขอ้างอิง ยอดล็อกเท่ายอดบิล", { text: "ไม่", tone: "slate" }],
          ["เครดิตร้าน / บัตรของขวัญ", "สแกนรหัสบัตร ตรวจยอดก่อนสร้างบิล", { text: "ไม่", tone: "slate" }],
        ],
      },
      { kind: "p", text: "กด \"แบ่งชำระ\" เปลี่ยนเป็นฟอร์มหลายแถว — ผลรวมทุกแถวต้องเท่ายอดที่เซิร์ฟเวอร์คำนวณพอดี ไม่เท่าคือบิลถูกยกเลิกด้วย PAYMENT_MISMATCH" },
      { kind: "sub", text: "สิ่งที่เกิดขึ้นเมื่อชำระสำเร็จ" },
      { kind: "p", text: "ทุกอย่างต่อไปนี้ commit พร้อมกันเป็นหนึ่งเดียว ไม่มีทางสำเร็จบางส่วน: ออเดอร์ → COMPLETED · ตัดสต็อก · จ่ายล็อตแบบ FEFO · บันทึกการเคลื่อนไหวสต็อก · ออกใบกำกับภาษีอย่างย่อ (ถ้าจด VAT) · บันทึกแต้มสะสมและ Audit Log" },
      { kind: "sub", text: "การปัดเศษเงินสด" },
      { kind: "p", text: "ใช้กับบิลที่ชำระด้วยเงินสดทั้งจำนวนเท่านั้น — ยอดที่ปัดเป็นบรรทัดของตัวเอง ไม่ใช่ส่วนลด และไม่เปลี่ยนฐาน VAT" },
      { kind: "sub", text: "การกู้คืนเมื่อเน็ตหลุด" },
      {
        kind: "table",
        head: ["สถานการณ์", "สิ่งที่ระบบทำ"],
        rows: [
          ["คำตอบหาย/เน็ตขาดตอนกดชำระ", "ทิ้งบันทึกกู้คืนในเบราว์เซอร์ — กดชำระซ้ำใช้ key เดิม ไม่สร้างบิลที่สอง"],
          ["บิล PENDING/PAID ที่ค้าง", "ทำ transaction ชำระเงินต่อได้"],
          ["เล่นซ้ำแล้วได้ PAYMENT_MISMATCH", "เซิร์ฟเวอร์ยกเลิกบิลที่ถูกปฏิเสธไปแล้ว → POS รีเฟรชตะกร้าทั้งใบ ยืนยันยอดใหม่หนึ่งครั้ง"],
        ],
      },
      { kind: "callout", tone: "danger", title: "นี่ไม่ใช่ POS แบบออฟไลน์", body: "การค้นหา ขาย คืนสินค้า ชำระเงิน และงานกะ ต้องเชื่อมต่อเซิร์ฟเวอร์ได้ ร้านต้องมีขั้นตอนสำรองแบบมือที่เขียนไว้ชัดเจน" },
    ],
  },
  {
    id: "deposit",
    eyebrow: "รูปแบบบิลพิเศษ",
    title: "มัดจำและวางดาวน์",
    lead: "กฎที่ยอดชำระต้องเท่ายอดบิลพอดีไม่ได้ถูกผ่อนปรนที่นี่ — มัดจำเป็นบิลอีกชนิดหนึ่งแทน",
    defaultOpen: false,
    blocks: [
      {
        kind: "flow",
        steps: [
          { title: "รับมัดจำ", detail: "สินค้าถูกจองแต่ยังไม่ตัดสต็อก ออเดอร์อยู่สถานะ PENDING", chips: ["order: PENDING"] },
          { title: "ลูกค้ากลับมาจ่ายส่วนที่เหลือ", detail: "เดินตามเส้นทางปิดการขายปกติ (สต็อก ล็อต ใบกำกับภาษี แต้ม Audit) — ใช้เส้นทางเดิมซ้ำโดยตั้งใจ", chips: ["COMPLETED"] },
        ],
      },
      {
        kind: "table",
        head: ["เรื่อง", "พฤติกรรม"],
        rows: [
          ["ใบกำกับภาษีออกตอนรับของ", "ไม่ใช่ตอนรับมัดจำ — กรรมสิทธิ์โอนตอนนั้นจริง"],
          ["ยอดขายเป็นของกะที่ส่งของ", "ประทับเครื่อง กะ แคชเชียร์ใหม่ตอนปิดบิล — ยอดขาย/ค่าคอมลงกับคนที่ส่งของ"],
          ["รับของที่สาขาที่จองไว้", "ย้ายรับสาขาอื่นต้องทำใบโอนสต็อกก่อน"],
          ["มัดจำเท่ายอดบิล", "ถูกปฏิเสธ — นั่นคือการขายที่จบแล้ว ต้องไปทางปกติ"],
        ],
      },
      { kind: "callout", tone: "warn", title: "การปิดมัดจำไม่เคลื่อนเงินด้วยตัวเอง", body: "คืนเงินหรือยึดเป็นข้อตกลงระหว่างร้านกับลูกค้า ระบบบันทึกการตัดสินใจพร้อมเหตุผลบังคับ แล้วปล่อยให้เส้นทางคืนเงินปกติจัดการ" },
      { kind: "p", text: "มัดจำที่เปิดอยู่มีวันครบกำหนดและติดธง overdue เพราะสินค้าที่จองคือของที่คนอื่นซื้อไม่ได้" },
    ],
  },
  {
    id: "return-void",
    eyebrow: "การแก้ไขบิล",
    title: "คืนสินค้าและยกเลิกบิล",
    lead: "ผลลัพธ์ปลายทางเหมือนกัน (ของกลับเข้าสต็อก เงินคืน แต้มถูกดึงคืน) แต่ความหมายต่างกัน และระบบแยกทั้งสองออกจากกัน",
    defaultOpen: true,
    blocks: [
      {
        kind: "table",
        head: ["", "คืนสินค้า (Return)", "ยกเลิกบิล (Void)"],
        rows: [
          ["ใช้เมื่อ", "การขายที่จบแล้ว ลูกค้าเปลี่ยนใจ", "บิลที่ไม่ควรมีอยู่ตั้งแต่แรก (สแกนซ้ำ/ผิดคน)"],
          ["เข้ารายงานคืนสินค้า", "ใช่", "ไม่ — กรองออกจากรายงานคืนสินค้าทั้ง 5 รายการ"],
          ["ทำได้เมื่อ", "ทั้งบิลหรือบางส่วน", "เฉพาะบิลในกะที่ยังเปิด และยังไม่มีการคืนใดๆ"],
          ["ผู้อนุมัติ", "ต้องมีรหัสเหตุผล", { text: "2 คน 2 PIN (pos.void)", tone: "dual" }],
        ],
      },
      { kind: "callout", tone: "info", title: "เหตุผลที่ต้องแยก", body: "บังคับให้ Void เดินเส้นทางเดียวกับ Return จะทำให้แคชเชียร์ที่พลาดวันละสองครั้งไปกระตุ้นสัญญาณ \"การคืนผิดปกติ\" ทุกสัปดาห์ จนไม่มีใครเชื่อสัญญาณนั้นอีก" },
      { kind: "sub", text: "ใบกำกับภาษีถูกยกเลิก ไม่ถูกลบ" },
      { kind: "p", text: "เลขที่หายไปจากลำดับคือสิ่งแรกที่ผู้ตรวจสอบบัญชีถามและไม่มีคำตอบที่ดี — ระบบบันทึก cancelled_at บิลที่ Void ออกจาก salesTotal/billCount และปรากฏบนบรรทัดของตัวเองในรายงานกะ" },
      { kind: "sub", text: "การจ่ายเงินคืน" },
      {
        kind: "table",
        head: ["ลูกค้าจ่ายมาด้วย", "การคืนเงิน"],
        rows: [
          ["เงินสด", "เสร็จทันที"],
          ["บัตร/QR/โอน/Wallet", "ค้างสถานะ PENDING จนกว่าผู้มีสิทธิ์ payment.refund บันทึกเลขอ้างอิงคืนเงินภายนอก"],
          ["เครดิตร้าน/บัตรของขวัญ", "คืนเข้าบัตรใบเดิมตามสัดส่วน"],
        ],
      },
      { kind: "callout", tone: "warn", title: "ปิดกะไม่ได้ถ้ายังมีการคืนเงินค้าง", body: "กะจะปิดไม่ได้ตราบใดที่ยังมีการคืนเงินของกะนั้นค้างสถานะ PENDING" },
      { kind: "p", text: "ถ้ามีรายการค้าง ให้เปิดแท็บคืนแล้วดูบล็อก “งานที่ต้องทำตอนนี้” ด้านบนสุด หรือกดจากสรุปกะเพื่อกระโดดมาคิวนี้ได้ทันที ตัวกรองจะคัดเฉพาะบิลที่ยังต้องยืนยันคืนเงินจริงให้เอง" },
      { kind: "sub", text: "ใบขายเดิมกับใบรับคืนเป็นคนละเอกสาร" },
      { kind: "p", text: "หลังคืน ให้กด ดูใบรับคืนล่าสุด หรือเปิดประวัติบิลแล้วเลือกใบรับคืนครั้งนั้น มูลค่ารายการบนใบรับคืนคือยอดคืนจริงหลังเฉลี่ยส่วนลดเดิม ส่วนใบขายเดิมยังคงจำนวน ราคาป้าย ส่วนลด และยอดตอนขาย โดย barcode ของใบรับคืนอ้างอิงบิลขายเดิมเพื่อสแกนกลับมาค้นได้" },
      { kind: "sub", text: "เปลี่ยนสินค้า (Exchange)" },
      { kind: "p", text: "เลือกจำนวนของเดิมที่จะเปลี่ยน แล้วกด “คืนที่เลือก + ทำบิลเปลี่ยน” ระบบรับคืนและจัดสรรเงินคืนตามช่องทางเดิมก่อน เมื่อสำเร็จจึงพาไปแท็บขายพร้อมเฉพาะรายการที่รับคืน ให้เปลี่ยนรุ่น/ไซซ์และรับเงินใหม่ — เป็นการขายใหม่ ไม่ใช่การแก้ใบเสร็จเดิม" },
      { kind: "sub", text: "คืนสินค้าโดยไม่มีใบเสร็จ" },
      { kind: "p", text: "เส้นทางทุจริตที่ตรงที่สุดที่ร้านมี จึงมี 3 การควบคุมพร้อมกัน: ผู้อนุมัติ+PIN (สิทธิ์ pos.return.noreceipt — Manager เท่านั้น) · เหตุผลบังคับ · เพดานราคา (คืนต่อหน่วยไม่เกินราคาป้ายวันนี้)" },
      {
        kind: "list",
        items: [
          "พยายามหาใบเสร็จเดิมก่อนเสมอ: ช่องค้นบิลรับเลขบิล, order id, barcode สินค้า, SKU, รหัสสมาชิก และเบอร์โทร",
          "เมื่อมีคำค้น ระบบจะค้นย้อนหลังข้ามเครื่อง POS ทั้งร้านให้ ไม่ได้จำกัดแค่เครื่องปัจจุบัน",
          "บิลที่ขายจากเครื่องอื่นใช้ดูต้นทาง/พิมพ์ซ้ำได้ แต่คืนหรือเปลี่ยนสินค้าจากใบเสร็จนั้นที่เครื่องนี้ไม่ได้ — ปุ่มจะไม่เปิดให้กดผิด",
          "ถ้าเปิดโหมดคืนไม่มีใบเสร็จแล้วสแกนสินค้า ระบบจะใส่ของลงตะกร้าและค้นบิลที่เคยขายสินค้านี้ให้พร้อมกัน",
          "โหมดคืนไม่มีใบเสร็จใช้ตะกร้าของตัวเองในทางปฏิบัติ: ถ้าจะออกจากโหมดหรือไปทำบิล/คืนจากใบเสร็จ ระบบจะให้ยืนยันล้างรายการค้างก่อน เพื่อกันของคืนปนกับของขาย",
          "เงินสดออกทางตารางการเคลื่อนไหวลิ้นชักเดียวกัน — ไม่มีแหล่งเงินออกที่สอง",
          "ลิ้นชักต้องมีเงินจริง — ยอดคืนมากกว่าเงินในลิ้นชักถูกปฏิเสธ",
          "รายงานนับแยกที่ /admin/reports/pos-return-audit และส่งสัญญาณทุกครั้ง",
          "ไม่ออกใบลดหนี้ — ไม่มีใบกำกับภาษีต้นทางให้อ้างอิง",
        ],
      },
    ],
  },
  {
    id: "cash-drawer",
    eyebrow: "การควบคุมภายใน",
    title: "เงินสดในลิ้นชัก",
    lead: "เงินเข้าออกลิ้นชักโดยไม่มีการขาย — ฝากธนาคารกลางกะ ยืมเงินทอน ซื้อของใช้",
    defaultOpen: true,
    blocks: [
      { kind: "callout", tone: "danger", title: "อย่าบันทึกเงินจากการขายเป็นเงินสดเข้าลิ้นชัก", body: "เงินจากบิลเงินสดถูกนับในเงินสดคาดหวังอยู่แล้ว — กรอกซ้ำจะทำให้ยอดคาดหวังเป็นสองเท่า ใช้เฉพาะเงินที่เข้ามาจากนอกกระบวนการขาย" },
      { kind: "sub", text: "สูตรเงินสดคาดหวังตอนปิดกะ" },
      { kind: "p", text: "เงินทอนตั้งต้น + เงินสดที่รับจากการขาย − เงินสดที่จ่ายคืนลูกค้า + เงินสดเข้าลิ้นชัก − เงินสดออกจากลิ้นชัก = เงินสดที่ควรมีในลิ้นชัก" },
      { kind: "sub", text: "เงินเข้ากับเงินออกใช้การควบคุมต่างกัน" },
      {
        kind: "list",
        items: [
          "เงินเข้า: ไม่ต้องมีผู้อนุมัติ — บังคับให้หัวหน้ามาทุกครั้งที่มีคนหยิบเหรียญ คือวิธีที่ทำให้ไม่มีใครบันทึกอะไรเลย",
          "เงินออก: ต้องมี 2 คน — พนักงานกรอก PIN ตัวเอง และผู้มีสิทธิ์ pos.cash.movement กรอก PIN ตัวเอง พร้อมเหตุผลทุกครั้ง",
        ],
      },
      { kind: "callout", tone: "warn", title: "WOULD_OVERDRAW", body: "รายการที่จะทำให้เงินคาดหวังต่ำกว่าศูนย์ถูกปฏิเสธ — มักเป็นการพิมพ์ผิด (฿99,999 แทน ฿999)" },
      { kind: "sub", text: "เปิดลิ้นชักโดยไม่ขาย (No-Sale)" },
      {
        kind: "list",
        items: [
          "แลกแบงก์ให้ลูกค้าเป็นเรื่องปกติ ห้ามไม่ได้ — บันทึกทุกครั้งพร้อมเหตุผลบังคับ ปรากฏบนรายงานกะ",
          "สิทธิ์ pos.nosale ให้ Manager/Sales/Cashier — ไม่มีผู้อนุมัติโดยเจตนา (การควบคุมคือการบันทึก ไม่ใช่ประตู)",
        ],
      },
    ],
  },
  {
    id: "expenses",
    eyebrow: "การควบคุมภายใน",
    title: "ค่าใช้จ่ายย่อย (Petty Cash)",
    lead: "จ่ายเงินให้คนส่งน้ำแข็งหรือซื้อของใช้คือค่าใช้จ่าย — ฝากธนาคาร/ย้ายเงินทอนไม่ใช่",
    defaultOpen: false,
    blocks: [
      {
        kind: "table",
        head: ["รูปแบบ", "วิธีทำงาน", "กระทบเงินคาดหวัง", "ต้องมี 2 คน"],
        rows: [
          ["จ่ายตรง (Direct)", "จ่ายผู้ขายเลย บันทึกยอดที่หยิบจากลิ้นชัก", { text: "ใช่", tone: "red" }, { text: "ใช่", tone: "dual" }],
          ["เบิกล่วงหน้า (Advance)", "เบิกไปซื้อ กลับมากรอกยอดจริง — ยอดค่าใช้จ่ายคือยอดจริง ไม่ใช่ยอดที่เบิก", { text: "ใช่", tone: "red" }, { text: "ใช่", tone: "dual" }],
          ["เงินส่วนตัวเจ้าของ", "Administrator (pos.expense.personal) บันทึกยอดที่จ่ายเอง ต้องมีเลขอ้างอิงหลักฐาน", { text: "ไม่", tone: "green" }, { text: "ไม่", tone: "slate" }],
          ["กระเป๋าเงินย่อยสาขา", "เติมด้วย pos.petty_cash.manage แคชเชียร์ที่มี pos.expense.create จ่ายจากยอดคงเหลือได้ อยู่นอกลิ้นชัก", { text: "ไม่", tone: "green" }, { text: "ไม่", tone: "slate" }],
        ],
      },
      { kind: "callout", tone: "warn", title: "การเบิกล่วงหน้าที่ยังไม่ปิดจะบล็อกการปิดกะ", body: "เพราะปิดลิ้นชักขณะยอดจริงยังไม่รู้ จะทำให้รายงานค่าใช้จ่ายกำกวมถาวร" },
      { kind: "p", text: "หมวดค่าใช้จ่าย: วัตถุดิบ · บรรจุภัณฑ์ · ค่าส่ง · ค่าเดินทาง · ทำความสะอาด · ซ่อมแซม · สาธารณูปโภค · อื่นๆ — receipt_ref เป็นตัวเลือกสำหรับค่าใช้จ่ายจากลิ้นชัก แต่บังคับสำหรับเงินส่วนตัวและกระเป๋าเงินย่อย" },
    ],
  },
  {
    id: "shift-close",
    eyebrow: "ปิดกะ",
    title: "ปิดกะและรายงาน X/Z",
    lead: "ปิดกะแบบปิดตา (Blind Close) เปิดใช้เป็นค่าเริ่มต้น",
    defaultOpen: true,
    blocks: [
      { kind: "callout", tone: "info", title: "ขณะกะยังเปิดอยู่ ไม่มีใครเห็นเงินสดคาดหวัง รวมถึงผู้จัดการ", body: "ถ้ารายงานแสดงยอดคาดหวังก่อนนับ คนนับลิ้นชักจะอ่านคำตอบแล้วพิมพ์กลับ ผลต่างจะเป็นศูนย์ตลอดไป — การควบคุมที่สอบไม่ตกไม่ใช่การควบคุม" },
      { kind: "p", text: "หลังปิดกะแล้วทุกอย่างแสดงตามปกติ — ร้านที่ต้องการพฤติกรรมเดิมปิดฟีเจอร์นี้ได้ที่ /admin/pos-readiness" },
      { kind: "sub", text: "ขั้นตอนปิดกะ" },
      {
        kind: "flow",
        steps: [
          { title: "เคลียร์รายการค้างทั้งหมด", detail: "การคืนเงินที่ยังไม่ยืนยัน และการเบิกล่วงหน้าที่ยังไม่ปิด บล็อกการปิดกะ" },
          { title: "นับเงินในลิ้นชักและกรอกยอด", detail: "ต้องมีสิทธิ์ pos.shift.close — ยังไม่เห็นยอดคาดหวังตอนนี้" },
          { title: "ระบบคำนวณและบันทึกผลต่าง", detail: "ยอดคาดหวัง ยอดนับได้ ผลต่าง ถูกบันทึกลง Audit Log ทั้งหมด" },
          { title: "อ่านรายงาน Z และให้ผู้จัดการเซ็น", detail: "ตอนนี้ตัวเลขทั้งหมดแสดงแล้ว" },
        ],
      },
      { kind: "sub", text: "รายงาน X และ Z" },
      { kind: "p", text: "โค้ดชุดเดียวกัน ต่างกันแค่ว่ากะปิดแล้วหรือยัง — อ่านกลางกะคือ X อ่านหลังปิดคือ Z ประกอบด้วย: ยอดขายสุทธิ · จำนวนบิล · ส่วนลด · บิลที่ยกเลิก · การคืนสินค้า · แยกตามวิธีชำระ/แคชเชียร์ · การเคลื่อนไหวลิ้นชัก · ค่าใช้จ่ายย่อย · จำนวน No-Sale · เงินสดคาดหวัง/นับได้/ผลต่าง" },
      {
        kind: "list",
        items: [
          "กะที่ปิดแล้วรายงานยอดคาดหวังที่เก็บไว้ตอนปิด ไม่คำนวณใหม่ — กันไม่ให้แก้ข้อมูลย้อนหลังทำให้ใบพิมพ์วันนี้ขัดกับกระดาษที่เซ็นไปแล้ว",
          "เครื่องอ่านได้เฉพาะรายงานของกะตัวเอง แม้อยู่ในร้านเดียวกัน",
          "การคืนเงินแบบแบ่งจ่ายนับครั้งเดียว ไม่คูณตามจำนวนแถว",
        ],
      },
    ],
  },
  {
    id: "tax",
    eyebrow: "เอกสาร",
    title: "ใบกำกับภาษีและใบเสร็จ",
    lead: "การตั้งค่าภาษี ประเภท VAT ของสินค้า ใบเสร็จ และ e-Tax",
    defaultOpen: false,
    blocks: [
      { kind: "p", text: "การจดทะเบียน VAT อัตราภาษี วิธีปัดเศษ ปีปฏิทินเอกสาร — ตั้งที่ /admin/pos-readiness (สิทธิ์ tax.setting.manage) การตั้งค่าใช้กับบิลใหม่เท่านั้น เอกสารที่ออกไปแล้วเก็บอัตรา/ยอดของตัวเองไว้" },
      { kind: "sub", text: "ประเภท VAT ของสินค้า" },
      {
        kind: "table",
        head: ["ค่า", "ความหมาย"],
        rows: [
          ["V", "สินค้าที่เสียภาษี"],
          ["N", "สินค้าที่ยกเว้นภาษี"],
          ["UNKNOWN", "ค่าเริ่มต้น — บล็อกการเปิดใช้งานสำหรับร้านที่จด VAT"],
        ],
      },
      {
        kind: "list",
        items: [
          "ไม่ส่งค่านี้มา = เก็บค่าเดิมไว้ (ไม่ล้างการจัดประเภทภาษีทั้งร้านเงียบๆ)",
          "สินค้าใหม่เป็น UNKNOWN เสมอ ไม่เดาเป็น V",
          "ปุ่มตั้งทีเดียวแตะเฉพาะแถว UNKNOWN ที่ยังขายอยู่ ใช้สิทธิ์ tax.setting.manage",
          "ถ้ารับเงินแล้วพบ UNKNOWN ให้แก้ประเภท VAT ของสินค้าที่แจ้ง แล้วกลับมากดชำระบิลเดิมซ้ำ ระบบเติมเฉพาะค่าที่ยังไม่รู้และไม่สร้างบิลหรือรับเงินซ้ำ",
        ],
      },
      { kind: "sub", text: "ใบเสร็จ" },
      { kind: "p", text: "Enter พิมพ์ · Esc ปิด · ปุ่มเปิดลิ้นชักปรากฏเฉพาะเชื่อมเครื่องพิมพ์ ESC/POS ผ่าน WebUSB" },
      { kind: "callout", tone: "danger", title: "ตัวเลขภาษีอ่านจากเอกสารที่ออกแล้ว ไม่คำนวณใหม่", body: "คำนวณ ยอด×7/107 ใหม่จะพังทันทีที่บิลผสมสินค้ายกเว้นภาษี — ไม่มีเอกสาร ไม่มีบล็อก VAT" },
      { kind: "sub", text: "ส่งใบเสร็จให้ลูกค้า" },
      {
        kind: "list",
        items: [
          "ส่งอีเมล/LINE ได้ — ส่งล้มเหลวไม่ทำให้การขายเสียหาย",
          "อีเมลที่พิมพ์ที่เคาน์เตอร์ชนะข้อมูลในประวัติลูกค้า",
          "อีเมลนั้นไม่ถูกเขียนกลับเข้าโปรไฟล์ลูกค้า",
        ],
      },
      { kind: "sub", text: "e-Tax" },
      { kind: "p", text: "การออกใบกำกับที่เคาน์เตอร์ไม่ได้ติดต่อกรมสรรพากรเอง — การยื่น XML เป็นคิวแยก และปิดไว้เป็นค่าเริ่มต้น จนกว่าจะมีผู้ให้บริการยื่นจริงที่ตรวจสอบแล้ว ให้ปิด ETAX_ENABLED ไว้" },
    ],
  },
  {
    id: "permissions",
    eyebrow: "อ้างอิง",
    title: "สิทธิ์การใช้งาน",
    lead: "สิทธิ์ทุกตัวถูกตรวจที่เซิร์ฟเวอร์แยกกัน — ปุ่มที่กดแล้วได้ 403 เงียบๆ มักแปลว่ายังไม่ได้ apply migration ที่ตั้งค่าสิทธิ์นั้น",
    defaultOpen: false,
    blocks: [
      {
        kind: "table",
        head: ["สิทธิ์", "ใช้ทำอะไร", "ตั้งค่าให้", "2 คน"],
        rows: [
          ["pos.sell", "ขายสินค้า เพิ่มค่าธรรมเนียม", "Manager/Sales/Cashier", { text: "✗", tone: "slate" }],
          ["pos.shift.open / .close / .report", "เปิด/ปิดกะ/อ่านรายงาน", "Manager/Sales/Cashier", { text: "✗", tone: "slate" }],
          ["pos.nosale", "เปิดลิ้นชักโดยไม่ขาย", "Manager/Sales/Cashier", { text: "✗", tone: "slate" }],
          ["order.return", "คืนสินค้าตามใบเสร็จ", "Manager/Sales/Cashier", { text: "✗", tone: "slate" }],
          ["pos.expense.create", "บันทึกค่าใช้จ่ายย่อย", "Manager/Sales/Cashier", { text: "ถ้าใช้เงินลิ้นชัก", tone: "dual" }],
          ["pos.discount.approve", "อนุมัติส่วนลดมือ", "Manager", { text: "ใช่", tone: "dual" }],
          ["pos.void", "ยกเลิกบิล", "Manager", { text: "ใช่", tone: "dual" }],
          ["pos.cash.movement", "เบิกเงินออกจากลิ้นชัก", "Manager", { text: "ใช่", tone: "dual" }],
          ["pos.return.noreceipt", "คืนสินค้าไม่มีใบเสร็จ", "Manager", { text: "ใช่", tone: "dual" }],
          ["payment.refund", "ยืนยันคืนเงินที่ไม่ใช่เงินสด", "Manager", { text: "✗", tone: "slate" }],
          ["pos.expense.personal", "ค่าใช้จ่ายจากเงินส่วนตัวเจ้าของ", "Administrator เท่านั้น", { text: "✗", tone: "slate" }],
          ["pos.petty_cash.manage", "เติมเงินกระเป๋าย่อยสาขา", "Administrator เท่านั้น", { text: "✗", tone: "slate" }],
          ["tax.setting.manage", "ตั้งค่าภาษี/VAT ทั้งร้าน", "Manager", { text: "✗", tone: "slate" }],
          ["storecredit.issue / .adjust", "ออกบัตรของขวัญ/ปรับยอด", "Manager", { text: "✗", tone: "slate" }],
          ["storecredit.redeem", "รับบัตรของขวัญมาใช้", "ทุกคนที่ขาย", { text: "✗", tone: "slate" }],
          ["commission.view / .manage", "อ่านค่าคอม/ตั้งอัตรา", "Manager", { text: "✗", tone: "slate" }],
          ["purchase.receive", "รับสินค้าเข้าที่เคาน์เตอร์", "Manager/Warehouse", { text: "✗", tone: "slate" }],
        ],
      },
      { kind: "callout", tone: "info", title: "4 การกระทำที่ต้องมี 2 คนเสมอ", body: "ส่วนลดมือ · ยกเลิกบิล · เบิกเงินออกจากลิ้นชัก · คืนสินค้าไม่มีใบเสร็จ — ทั้งสี่คือ \"เงินออกจากยอดที่นับ\" ต้องมี PIN ของคนที่สองไม่ว่าใครล็อกอินอยู่ แม้เป็นคนเดียวกันที่มีทั้งสองสิทธิ์" },
    ],
  },
  {
    id: "errors",
    eyebrow: "อ้างอิง",
    title: "ข้อความ Error และวิธีแก้",
    lead: "สิ่งที่เปิดดูบ่อยที่สุดตอนบิลไม่ผ่าน",
    defaultOpen: true,
    blocks: [
      {
        kind: "table",
        head: ["รหัส", "สาเหตุ", "วิธีแก้ที่เคาน์เตอร์"],
        rows: [
          [{ text: "PAYMENT_MISMATCH", tone: "red" }, "ยอดรวมแถวชำระไม่เท่ายอดเซิร์ฟเวอร์ — มักเกิดจากราคา/โปรเปลี่ยนหลังเข้าตะกร้า", "ระบบรีเฟรชตะกร้าให้แล้ว — ตรวจยอดใหม่และรับเงินอีกครั้ง"],
          [{ text: "INSUFFICIENT", tone: "red" }, "สต็อกไม่พอ หรือล็อตที่ยังไม่หมดอายุน้อยกว่าที่ขาย", "ตรวจสต็อกที่สาขานี้ / ตรวจล็อตหมดอายุ / ลดจำนวน"],
          [{ text: "PHARMACY_REVIEW_REQUIRED / PHARMACY_SAFETY_CHECK_REQUIRED", tone: "amber" }, "สินค้านี้ต้องให้เภสัชกรตรวจหรือซักประวัติก่อนขาย", "กดส่งเคสให้เภสัชกร + พักบิล จากหน้า POS แล้วรอให้เคสอนุมัติ"],
          [{ text: "DISCOUNT_UNAPPROVED", tone: "red" }, "ส่วนลดมือไม่มีผู้อนุมัติ+เหตุผล หรือยอดจะถูกเพดานตัดทอน", "ให้หัวหน้ากรอก PIN+เหตุผล / ลดยอดให้อยู่ในเพดาน แล้วคีย์ใหม่"],
          [{ text: "POINTS_INVALID", tone: "red" }, "ขอแลกแต้มเกินที่มี/เกินที่บิลรับได้ — ยอดแต้มเปลี่ยนระหว่าง preview กับตอนจ่าย", "เรียกยอดใหม่ (re-quote) แล้วแจ้งยอดที่ถูกต้อง"],
          [{ text: "WOULD_OVERDRAW", tone: "red" }, "รายการเงินสดจะทำให้ยอดคาดหวังต่ำกว่าศูนย์ — มักเป็นการพิมพ์ผิด", "ตรวจจำนวนหลักที่พิมพ์ (ไม่บอกยอดจริงถ้าเปิด Blind Close)"],
          [{ text: "ALREADY_RETURNED", tone: "red" }, "บิลนี้มีการคืนแล้ว — Void ทำได้เฉพาะบิลที่ยังไม่มีการคืน", "ใช้การคืนสินค้าแทนการยกเลิกบิล"],
          [{ text: "403 เงียบๆ", tone: "amber" }, "ปุ่มกดแล้วไม่มีอะไรเกิดขึ้น — สิทธิ์ยังไม่ถูก seed", "ตรวจว่า apply migration ที่ตั้งสิทธิ์นั้นแล้ว (ดูตารางสิทธิ์)"],
        ],
      },
      { kind: "sub", text: "ค่าคอมมิชชั่นการขาย" },
      { kind: "p", text: "อัตราค่าคอมเก็บพร้อมวันที่มีผล รายงานเลือกอัตราที่ใช้ในวันของแต่ละบิล — เปลี่ยนอัตราคือเพิ่มแถวใหม่ ไม่ใช่เขียนทับ (ไม่งั้นวันที่ปรับอัตรา เดือนที่จ่ายไปแล้วจะเปลี่ยนเลขเงียบๆ)" },
      {
        kind: "list",
        items: [
          "ความเฉพาะเจาะจง: สินค้า → หมวด → ค่าเริ่มต้น",
          "สินค้าที่คืนดึงค่าคอมกลับ — บิลที่ Void ไม่ได้ค่าคอมเลย",
          "ส่วนลดระดับบิลถูกกระจายลงบรรทัด — บิลที่มีคูปองก้อนใหญ่ไม่จ่ายค่าคอมบนเงินที่ร้านไม่ได้รับ",
          "commission.view และ .manage แยกกัน — หัวหน้าทีมอ่านตัวเลขได้โดยขึ้นอัตราเองไม่ได้",
        ],
      },
    ],
  },
  {
    id: "scope",
    eyebrow: "อ้างอิง",
    title: "ขอบเขตที่ไม่รองรับ",
    lead: "ขอบเขตที่พัฒนาแล้วคือ POS ค้าปลีกทั่วไป — รายการต่อไปนี้เป็นโมดูลแยก ไม่ใช่สวิตช์ที่ซ่อนอยู่ในการตั้งค่า",
    defaultOpen: false,
    blocks: [
      {
        kind: "stats",
        items: [
          { label: "ร้านอาหาร", value: "ผังโต๊ะ/ชั้น" },
          { label: "ครัว", value: "KDS/ส่งพิมพ์ครัว" },
          { label: "เมนู", value: "Modifier/Topping" },
          { label: "คิว", value: "บัตรคิว/จองโต๊ะ" },
          { label: "เครือข่าย", value: "Offline-first sync" },
          { label: "เครื่องรับบัตร", value: "ไม่มี EDC driver" },
        ],
      },
      { kind: "callout", tone: "warn", title: "ฮาร์ดแวร์ต้องทดสอบก่อนใช้จริง", body: "เส้นทาง ESC/POS ผ่าน WebUSB (ใบเสร็จ บาร์โค้ด เปิดลิ้นชัก) เขียนไว้แล้วแต่ยังไม่เคยรันกับฮาร์ดแวร์จริง — ต้องทดสอบตามรุ่นเครื่องพิมพ์ก่อนเปิดใช้งาน" },
      { kind: "sub", text: "ก่อนเปิดใช้งานจริง — รายการซ้อมที่ต้องผ่าน (ทุกข้อบนทุกเครื่องขาย)" },
      {
        kind: "list",
        items: [
          "ขายเงินสดพร้อมทอนเงิน · แบ่งชำระหลายวิธี · บัตร/QR พร้อมเลขอ้างอิง · พิมพ์ใบเสร็จซ้ำ",
          "คืนสินค้าบางส่วน · คืนสินค้าทั้งบิล · ยืนยันคืนเงินที่ไม่ใช่เงินสด",
          "การกระทำที่ไม่มีสิทธิ์ถูกปฏิเสธ · ปิดกะที่มีผลต่างเงินสดที่รู้ยอดล่วงหน้า",
          "ส่วนลดมือพร้อม PIN หัวหน้า · พักบิลแล้วเรียกคืนจากเครื่องที่สอง · ส่งเคสเภสัชจาก POS แล้วกลับมาขายต่อหลัง approve",
          "ฝากเงินธนาคารกลางกะ · ยกเลิกบิล (Void) · อ่านรายงาน X ก่อนปิดกะ",
        ],
      },
      { kind: "p", text: "ถ้าใช้โปรแกรมสะสมแต้ม เพิ่มการซ้อมอีก 4 บิล: ส่วนลดสมาชิกอย่างเดียว / คูปอง+สมาชิก / แลกแต้ม / คืนบางส่วนของบิลที่ทั้งได้แต้มและแลกแต้ม — ตรวจว่า balanceMismatchCount ยังเป็น 0" },
    ],
  },
];

// ---------------------------------------------------------------------------
// EN sections (condensed translation, same facts)
// ---------------------------------------------------------------------------
export const EN_SECTIONS: ManualSection[] = [
  {
    id: "access",
    eyebrow: "Before you start",
    title: "Access and the counter layout",
    lead: "POS authenticates in two layers, completely separate from the Admin system.",
    defaultOpen: false,
    blocks: [
      {
        kind: "stats",
        items: [
          { label: "Layer 1 — the machine", value: "Device Token" },
          { label: "Layer 2 — the person", value: "Cashier PIN" },
        ],
      },
      { kind: "p", text: "An administrator creates the device and issues a token once at /admin/pos-devices, then pairs it with the browser. The device remembers the token after that." },
      { kind: "callout", tone: "warn", title: "The PIN only ever lives in memory", body: "A cashier's PIN is never saved to the browser — a page refresh or restart always asks for it again. That's intentional." },
      { kind: "sub", text: "pos_only accounts" },
      { kind: "p", text: "A cashier account set to pos_only is blocked from /admin at the login level, not just a hidden menu — and it can't lift that flag on itself or on an administrator." },
      { kind: "sub", text: "Counter screen layout" },
      {
        kind: "list",
        items: [
          "Left icon rail switches Sell / Return / Shift / Settings / Receive — only the left column changes",
          "The right column stays fixed always: total, cash pad, pay button — because customer queues stack up",
          "The page itself never scrolls — each column scrolls in its own box, so the pay button never gets pushed off-screen",
          "Leaving and returning to the Sell tab refocuses the scan field automatically",
          "Below 768px width, the icon rail moves to a bottom bar",
        ],
      },
      { kind: "sub", text: "Customer-facing display" },
      { kind: "p", text: "Open /pos/display on a second screen — shows items, total, discount, change, no buttons at all. It syncs over BroadcastChannel on the same machine, not WebSocket, so a dropped connection never leaves it showing a stale wrong total. Shows the last 8 items only." },
    ],
  },
  {
    id: "shift-open",
    eyebrow: "Step 1",
    title: "Opening a shift",
    lead: "Every sale must happen inside an open shift — opening one records the starting float so closing can be reconciled.",
    defaultOpen: false,
    blocks: [
      {
        kind: "flow",
        steps: [
          { title: "Pick the cashier and enter a PIN", detail: "Requires pos.shift.open" },
          { title: "Count and enter the starting float", detail: "Logged to the audit trail immediately — both ends of a shift are recorded (what came in at open, and expected/counted/variance at close)" },
          { title: "Check the \"not ready to sell\" checklist", detail: "Shows what's missing: a product with no price, no stock row for this branch, or no VAT category set" },
        ],
      },
      { kind: "callout", tone: "info", title: "Opening and closing happen right at the counter", body: "No trip to Admin needed — the X/Z shift report can be read from the counter too, with pos.shift.report" },
    ],
  },
  {
    id: "selling",
    eyebrow: "Selling",
    title: "Selling",
    lead: "Scan a barcode, type a SKU, or search live inventory. Sell by base unit or a configured pack.",
    defaultOpen: true,
    blocks: [
      { kind: "sub", text: "Scan Manager modes" },
      { kind: "p", text: "A Bluetooth scanner is just a keyboard to the browser, so the system never guesses a scan from typing speed or which field is focused. Two modes: FOCUS (uses the existing scan field, you must keep focus there) and PREFIX (recommended — program the scanner to send a function key like F9 first and Enter last; the system captures the whole payload before any other field can)." },
      { kind: "callout", tone: "warn", title: "Scanning is decided by screen state, not focus", body: "The Sell tab adds to cart / product search reads without adding / Returns searches a receipt / Receiving adds to a purchase order draft — the Shift, Settings tabs and any moment mid-edit disable scanning entirely." },
      { kind: "sub", text: "Parking a bill" },
      {
        kind: "list",
        items: [
          "A parked bill reserves no stock and locks no price — recalling it re-reads price/stock fresh",
          "Disappears at shift close, never carries overnight — capped at 20 per shift",
          "Two devices on the same shift can't both pull the same parked bill",
          "If an item needs pharmacist review, POS can create the case from the counter, link it to the parked bill, and clear the register immediately — the bill can only resume once the case is approved",
        ],
      },
      { kind: "sub", text: "Serial numbers" },
      {
        kind: "list",
        items: [
          "A serial_tracked product needs one serial per unit before the sale goes through",
          "Checked before the bill is created — an incomplete entry costs no stock, no points, no coupon count",
          "A duplicate serial in the same bill, or one already sold, is rejected",
          "Returning the whole bill frees the serials to sell again — a partial return does not, since there's no record of which unit came back",
          "POS-only enforcement — not online, since nobody knows which physical unit will be picked until packing",
        ],
      },
      { kind: "sub", text: "Non-product fees" },
      { kind: "p", text: "Bag fees, service charges, gift wrap — add as an extra line, no fake SKU needed." },
      {
        kind: "list",
        items: [
          "Inside the VAT base — a service charge from a VAT-registered shop is taxable",
          "Can't be discounted — every discount tier applies to product value only, fees are added after",
          "An incomplete line (no name/amount, or a bad quantity) is silently dropped, never fails the whole bill",
          "Just needs pos.sell — the line name printed on the receipt is a tighter control than gating the permission",
        ],
      },
    ],
  },
  {
    id: "pricing",
    eyebrow: "Selling",
    title: "Pricing and promotions",
    lead: "Several pricing layers, all computed server-side, none of them count as a per-bill discount.",
    defaultOpen: true,
    blocks: [
      { kind: "sub", text: "Price precedence" },
      { kind: "p", text: "Size-level BASE price → shared BASE price → the product's own price (fallback) — POS, order creation, AI, and the online storefront all use this exact same order." },
      { kind: "sub", text: "Wholesale steps (buy-more pricing)" },
      { kind: "p", text: "\"Buy 10, get the wholesale rate\" — the step with the highest min_qty at or under the purchased quantity wins, and applies to every unit, not just the ones over the threshold." },
      {
        kind: "table",
        head: ["Scope", "How it's computed", "Fits"],
        rows: [
          ["Per size (fixed price)", "Sums lines of the same SKU+size, applies the configured per-unit price", "A single-size product, or each size has its own wholesale price"],
          ["Across all sizes (percent)", "Sums the quantity across all sizes of the SKU to clear the threshold, then cuts % off each size's own base price", "A multi-size product where sizes are priced differently"],
        ],
      },
      { kind: "callout", tone: "info", title: "A line sold as a pack uses the pack price", body: "Units inside a pack still count toward the same SKU+size threshold, but the pack line itself keeps the pack's own price — two mechanisms never compete on one line." },
      { kind: "sub", text: "Buy X get Y, and N-for-a-fixed-price promotions" },
      { kind: "p", text: "Not a fifth discount tier — it's a line-level pricing mechanism, and sits outside the per-bill discount cap (if it were inside the cap, an advertised promo could get clipped mid-bill, making the shop break its own promise for a reason no one at the counter can explain)." },
      {
        kind: "list",
        items: [
          "Leftover units are full price — buy 3 get 1, 7 units = one complete set + 3 full-price units, paying for 6",
          "Quantity is summed across sizes, computed once per SKU per bill",
          "A promo pricier than buying separately is never applied — the cheaper total always wins",
          "One promo per product (enforced at the database level) · has a date window · packs don't participate",
        ],
      },
      { kind: "p", text: "Not supported yet: cross-product promotions (\"buy A get B\")" },
      { kind: "sub", text: "The cart re-prices right before payment" },
      { kind: "p", text: "Every time Pay is pressed, price, wholesale tier, pack data, and promotions for every line are fetched fresh from the server. If anything changed since the item was scanned, payment stops before the order is written, the new total replaces the old one, and the cashier must review and collect again." },
    ],
  },
  {
    id: "discounts",
    eyebrow: "Selling",
    title: "Discounts and membership",
    lead: "Four discount tiers can stack on one bill, applied in a fixed order, under one shared cap.",
    defaultOpen: true,
    blocks: [
      {
        kind: "table",
        head: ["Tier", "Source", "Reversible"],
        rows: [
          ["1. Membership tier discount", "Automatic once a customer is linked to the bill", { text: "Reversible", tone: "green" }],
          ["2. Coupon", "Needs a code the customer knows", { text: "Hard to reverse", tone: "red" }],
          ["3. Redeemed loyalty points", "At the shop's set rate, always rounded down to a whole redeem unit", { text: "Reversible", tone: "green" }],
          ["4. Manual discount", "Keyed at the counter, requires a supervisor's approval", { text: "2 people, 2 PINs", tone: "dual" }],
        ],
      },
      { kind: "p", text: "Hitting the max_discount_pct cap trims the easiest-to-reverse tier first (4 → 1). Every tier's total lands in one column (discount_amount), which is the VAT and abbreviated tax-invoice base." },
      { kind: "sub", text: "Approving a manual discount" },
      {
        kind: "flow",
        steps: [
          { title: "The cashier enters the discount amount and a reason", detail: "A reason is mandatory" },
          { title: "The approver enters their own PIN", detail: "Requires pos.discount.approve — always entered separately from the cashier's PIN, even if it's the same person", chips: ["Dual Control"] },
          { title: "The server verifies, then applies it to the bill", detail: "Approval is per-bill, not per-shift — it clears after every sale" },
        ],
      },
      { kind: "callout", tone: "danger", title: "A bill is rejected with DISCOUNT_UNAPPROVED in two cases", body: "1) There's a discount with no approver/reason attached. 2) The amount would be trimmed by the per-bill cap — this one matters, because the manual tier is cut first; failing loudly beats silently collecting more than what was told to the customer." },
      { kind: "sub", text: "Loyalty points" },
      {
        kind: "table",
        head: ["Topic", "The rule actually enforced"],
        rows: [
          ["Earning", "Happens the moment a bill turns PAID, based on the post-discount total, only for customers with a member_no"],
          ["Rounding", "Always rounds down to a whole redeem unit — e.g. 3,045 points redeems 3,000; \"redeem all\" sends the real 3,000"],
          ["Not enough to redeem = rejected", "Never silently trimmed — the bill fails with POINTS_INVALID"],
          ["Returns", "Pulls back points earned and restores points redeemed, proportional to the refunded amount"],
          ["Balance can go negative", "Intentional — stops \"return after redeeming\" from turning a profit"],
          ["Expiry", "FIFO, driven by a daily job — with no cron scheduled, points simply never expire"],
        ],
      },
      { kind: "callout", tone: "warn", title: "For accounting", body: "Outstanding points are a liability (deferred revenue under IFRS 15) — hand this number to the accountant every period, it's not a dashboard decoration." },
      {
        kind: "list",
        items: [
          "No automatic customer notification for expiring points or tier upgrades — the shop reads the list at /admin/loyalty and reaches out itself",
          "No file-export points report — screen only",
          "Points redeem for a bill discount only, never for a product",
          "AI can read a points balance but can never redeem it — redemption only happens at bill creation",
        ],
      },
      { kind: "sub", text: "Gift cards and store credit" },
      { kind: "callout", tone: "danger", title: "One difference from points: credit can never go negative", body: "Credit is money — a negative balance would mean the shop owes the customer with nobody having approved it. Enforced by a table CHECK, not just code." },
      {
        kind: "list",
        items: [
          "The code is checked before the bill is created — a wrong code or insufficient balance costs no stock, points, or coupon count",
          "STORE_CREDIT is a payment method but not cash — never counts toward the drawer total or expected-cash formula",
          "A return credits the same original card, proportional to the refund",
          "Card codes are random from a crypto source, never sequential — with easily-confused characters (I O 0 1) removed",
          "Issuing/adjusting: Manager only · redeeming one: anyone who sells",
        ],
      },
    ],
  },
  {
    id: "payment",
    eyebrow: "Selling",
    title: "Taking payment",
    lead: "Pick a method from the row of buttons under the total — one bill can be split across several.",
    defaultOpen: true,
    blocks: [
      {
        kind: "table",
        head: ["Method", "On-screen behavior", "Counts toward the drawer"],
        rows: [
          ["Cash", "Opens the quick cash pad, records amount tendered/change per row", { text: "Yes", tone: "green" }],
          ["QR / card / bank transfer / wallet", "Enter a reference number, amount locked to the bill total", { text: "No", tone: "slate" }],
          ["Store credit / gift card", "Scan the card code, balance checked before the bill is created", { text: "No", tone: "slate" }],
        ],
      },
      { kind: "p", text: "\"Split payment\" switches to a multi-row form — the sum across every row must match the server's computed total exactly, or the bill is cancelled with PAYMENT_MISMATCH." },
      { kind: "sub", text: "What happens on a successful payment" },
      { kind: "p", text: "Everything below commits together as one unit — never partially: order → COMPLETED · reserved/current stock cut · lots issued FEFO · stock movement logged · an abbreviated tax invoice issued (if VAT-registered) · loyalty points and audit log recorded" },
      { kind: "sub", text: "Cash rounding" },
      { kind: "p", text: "Applies only to bills paid entirely in cash — the rounded amount is its own line, not a discount, and never changes the VAT base." },
      { kind: "sub", text: "Recovering from a dropped connection" },
      {
        kind: "table",
        head: ["Situation", "What the system does"],
        rows: [
          ["The response is lost / connection drops mid-payment", "A recovery record stays in the browser — pressing Pay again reuses the same key, never a second bill"],
          ["A stuck PENDING/PAID bill", "The payment transaction can be resumed"],
          ["A replay resolves to PAYMENT_MISMATCH", "The server has already cancelled the rejected bill → POS refreshes the whole cart and asks for one fresh confirmation"],
        ],
      },
      { kind: "callout", tone: "danger", title: "This is not an offline POS", body: "Search, selling, returns, payment, and shift operations all require a live server connection. A shop needs a clearly written manual fallback procedure, entered into the system only once the connection is back." },
    ],
  },
  {
    id: "deposit",
    eyebrow: "Special bill types",
    title: "Deposits and down payments",
    lead: "The rule that payment must exactly match the bill total is not relaxed here — a deposit is a different kind of bill instead.",
    defaultOpen: false,
    blocks: [
      {
        kind: "flow",
        steps: [
          { title: "Take the deposit", detail: "Stock is reserved but not yet cut — the order stays PENDING", chips: ["order: PENDING"] },
          { title: "The customer returns to pay the rest", detail: "Follows the normal closing path (stock, FEFO lots, tax invoice, points, audit) — deliberately reusing the same path rather than a second one", chips: ["COMPLETED"] },
        ],
      },
      {
        kind: "table",
        head: ["Topic", "Behavior"],
        rows: [
          ["Tax invoice issued at pickup", "Not at deposit time — ownership genuinely transfers then"],
          ["Sale belongs to the shift that hands the item over", "Device/shift/cashier are re-stamped at closing — sale and commission go to whoever handed it over"],
          ["Picked up at the branch it was reserved at", "Moving it to another branch first needs a stock transfer"],
          ["A deposit equal to the full bill", "Rejected — that's a completed sale, it belongs on the normal path"],
        ],
      },
      { kind: "callout", tone: "warn", title: "Closing a deposit never moves money by itself", body: "Refund or forfeit is an agreement between shop and customer — the system records the decision with a mandatory reason, then hands the payment off to the normal refund path." },
      { kind: "p", text: "An open deposit has a due date and an overdue flag — reserved stock is stock nobody else can buy." },
    ],
  },
  {
    id: "return-void",
    eyebrow: "Fixing a bill",
    title: "Returns and voiding a bill",
    lead: "They end up in the same place (stock restored, money refunded, points clawed back) but mean different things — the system keeps them separate.",
    defaultOpen: true,
    blocks: [
      {
        kind: "table",
        head: ["", "Return", "Void"],
        rows: [
          ["Used when", "A completed sale the customer changed their mind on", "A bill that shouldn't exist at all (double scan, wrong customer)"],
          ["Counts in the returns report", "Yes", "No — filtered out of all 5 return reports"],
          ["Allowed when", "Whole bill or partial", "Only within the still-open shift, and only if nothing on it has been returned yet"],
          ["Approval", "Requires a reason code", { text: "2 people, 2 PINs (pos.void)", tone: "dual" }],
        ],
      },
      { kind: "callout", tone: "info", title: "Why they're kept separate", body: "Forcing Void down the same path as Return would make a cashier who fixes two mistakes a day trip a \"return rate anomaly\" alert every week, until nobody trusts that signal anymore." },
      { kind: "sub", text: "A cancelled tax invoice is voided, not deleted" },
      { kind: "p", text: "A missing sequence number is the first thing an auditor asks about, with no good answer — so the system records cancelled_at instead. A voided bill drops out of salesTotal/billCount and shows on its own line in the shift report." },
      { kind: "sub", text: "Refund payouts" },
      {
        kind: "table",
        head: ["Paid with", "Refund"],
        rows: [
          ["Cash", "Completes immediately"],
          ["Card/QR/transfer/wallet", "Stays PENDING until someone with payment.refund records the external refund reference"],
          ["Store credit/gift card", "Returns to the same card, proportionally"],
        ],
      },
      { kind: "callout", tone: "warn", title: "A shift can't close with a pending refund", body: "It can't close while any refund allocation from that shift is still PENDING." },
      { kind: "sub", text: "The original sale and the return slip are separate documents" },
      { kind: "p", text: "After a return, use View latest return slip, or open Bill history and select that return event. Return-slip line amounts are the actual refund after allocating the original discounts; the original sale keeps its original quantities, shelf prices, discounts, and total. The return-slip barcode points back to the original sale for lookup." },
      { kind: "sub", text: "Exchange" },
      { kind: "p", text: "Loads the leftover items into a fresh cart — a new sale, never an edit to the original receipt." },
      { kind: "sub", text: "Returns without a receipt" },
      { kind: "p", text: "The single most direct fraud path a shop has, so three controls apply at once: an approver + PIN (pos.return.noreceipt — Manager only) · a mandatory reason · a price cap (per-unit refund never exceeds today's shelf price)." },
      {
        kind: "list",
        items: [
          "Cash goes out through the same drawer-movement table — there is no second cash-out source",
          "The drawer must actually hold the cash — a refund larger than what's in it is rejected",
          "Counted separately at /admin/reports/pos-return-audit, flagged every single time",
          "No credit note is issued — there's no original tax invoice to reference",
        ],
      },
    ],
  },
  {
    id: "cash-drawer",
    eyebrow: "Internal controls",
    title: "Cash in the drawer",
    lead: "Money moving in or out of the drawer with no sale attached — a bank deposit mid-shift, borrowed float, a supply run.",
    defaultOpen: true,
    blocks: [
      { kind: "callout", tone: "danger", title: "Never log a completed cash sale as a cash-in movement", body: "Cash from a completed cash bill is already counted in expected cash — logging it again claims a second inflow, doubling the expected total. Only log money that entered from outside the sale process." },
      { kind: "sub", text: "The expected-cash formula at close" },
      { kind: "p", text: "Starting float + cash taken from sales − cash refunded to customers + single cash-in movements − cash-out movements = cash the drawer should hold" },
      { kind: "sub", text: "Cash-in and cash-out use different controls" },
      {
        kind: "list",
        items: [
          "Cash-in: no approver needed — forcing a supervisor over every time someone grabs coins is exactly what pushes people to stop logging anything",
          "Cash-out: needs two people — the staff member enters their own PIN, and someone with pos.cash.movement enters theirs, with a reason every time",
        ],
      },
      { kind: "callout", tone: "warn", title: "WOULD_OVERDRAW", body: "A movement that would push expected cash below zero is rejected — usually a typo (฿99,999 instead of ฿999)." },
      { kind: "sub", text: "Opening the drawer with no sale" },
      {
        kind: "list",
        items: [
          "Making change for a customer is normal and can't be blocked — every open is logged with a mandatory reason and shows on the shift report",
          "pos.nosale is granted to Manager/Sales/Cashier — deliberately no approver (the control is the log entry, not a gate)",
        ],
      },
    ],
  },
  {
    id: "expenses",
    eyebrow: "Internal controls",
    title: "Petty cash",
    lead: "Paying the ice delivery or buying supplies is an expense — a bank deposit or moving float between machines is not.",
    defaultOpen: false,
    blocks: [
      {
        kind: "table",
        head: ["Form", "How it works", "Hits expected cash", "Needs 2 people"],
        rows: [
          ["Direct", "Pay the vendor now, log what came out of the drawer", { text: "Yes", tone: "red" }, { text: "Yes", tone: "dual" }],
          ["Advance", "Draw cash to go buy something, come back and enter the real amount — the expense is the real amount, not what was drawn", { text: "Yes", tone: "red" }, { text: "Yes", tone: "dual" }],
          ["Owner's personal funds", "An Administrator (pos.expense.personal) logs an expense they paid from their own pocket, with a mandatory receipt reference", { text: "No", tone: "green" }, { text: "No", tone: "slate" }],
          ["Branch petty-cash wallet", "Topped up with pos.petty_cash.manage; a cashier with pos.expense.create spends from the balance — lives outside the drawer", { text: "No", tone: "green" }, { text: "No", tone: "slate" }],
        ],
      },
      { kind: "callout", tone: "warn", title: "An unsettled advance blocks shift close", body: "Closing the drawer while the real amount is still unknown makes the expense report permanently ambiguous." },
      { kind: "p", text: "Categories: raw materials · packaging · delivery · travel · cleaning · repairs · utilities · other — receipt_ref is optional for a drawer expense but mandatory for personal funds and the petty-cash wallet." },
    ],
  },
  {
    id: "shift-close",
    eyebrow: "Closing",
    title: "Closing a shift and the X/Z report",
    lead: "Blind Close is on by default.",
    defaultOpen: true,
    blocks: [
      { kind: "callout", tone: "info", title: "While a shift is open, nobody sees expected cash — including managers", body: "If the report showed the expected total before counting, whoever counts the drawer would just read the answer and type it back — the variance would always be zero. A control that never fails isn't a control." },
      { kind: "p", text: "Once closed, everything shows normally. A shop that wants the old behavior can turn this off at /admin/pos-readiness." },
      { kind: "sub", text: "Closing steps" },
      {
        kind: "flow",
        steps: [
          { title: "Clear every pending item", detail: "An unconfirmed refund and an unsettled cash advance both block closing" },
          { title: "Count the drawer and enter the total", detail: "Requires pos.shift.close — expected cash still isn't shown yet" },
          { title: "The system computes and records the variance", detail: "Expected, counted, and variance all go to the audit log" },
          { title: "Read the Z report and get a manager's sign-off", detail: "Every number is visible now" },
        ],
      },
      { kind: "sub", text: "X and Z reports" },
      { kind: "p", text: "The same code, differing only by whether the shift has closed — read mid-shift, it's X; read after close, it's Z. Contains: net sales · bill count · discounts · voided bills · returns · by payment method/cashier · cash movements · petty cash · no-sale count · expected/counted cash and the variance." },
      {
        kind: "list",
        items: [
          "A closed shift reports the expected total saved at close, never recomputed — otherwise a later data fix would make today's printout disagree with yesterday's signed paper",
          "A device can only read its own shift's report, even inside the same shop",
          "A split-payment refund counts once, never multiplied by its row count",
        ],
      },
    ],
  },
  {
    id: "tax",
    eyebrow: "Documents",
    title: "Tax invoices and receipts",
    lead: "Tax settings, product VAT categories, receipts, and e-Tax.",
    defaultOpen: false,
    blocks: [
      { kind: "p", text: "VAT registration, rate, rounding method, the document calendar year — set at /admin/pos-readiness (tax.setting.manage). Settings apply to new bills only; an issued document keeps its own rate and amounts." },
      { kind: "sub", text: "Product VAT categories" },
      {
        kind: "table",
        head: ["Value", "Meaning"],
        rows: [
          ["V", "Taxable product"],
          ["N", "Tax-exempt product"],
          ["UNKNOWN", "Default — blocks go-live for a VAT-registered shop"],
        ],
      },
      {
        kind: "list",
        items: [
          "Omitting this field keeps the existing value (never silently wipes the shop's whole tax classification)",
          "A new product is always UNKNOWN, never guessed as V",
          "The bulk-set button only touches still-selling UNKNOWN rows, gated by tax.setting.manage",
          "If payment reports an UNKNOWN item, classify the named product and retry the recovered bill. The retry fills only unresolved VAT snapshots and never creates another bill or takes payment twice.",
        ],
      },
      { kind: "sub", text: "Receipts" },
      { kind: "p", text: "Enter prints · Esc closes · the drawer-open button only appears when an ESC/POS printer is connected over WebUSB." },
      { kind: "callout", tone: "danger", title: "Tax figures are read from the issued document, never recomputed", body: "Recomputing total×7/107 breaks the instant a bill mixes in a tax-exempt item — no document, no VAT block." },
      { kind: "sub", text: "Emailing a receipt" },
      {
        kind: "list",
        items: [
          "Can be sent by email or LINE — a failed send never invalidates the sale",
          "An email typed at the counter takes priority over what's on the customer's profile",
          "That email is never written back into the customer's profile",
        ],
      },
      { kind: "sub", text: "e-Tax" },
      { kind: "p", text: "Issuing at the counter never talks to the Revenue Department itself — XML filing is a separate background queue, off by default until a verified filing/signing provider is connected." },
    ],
  },
  {
    id: "permissions",
    eyebrow: "Reference",
    title: "Permissions",
    lead: "Every permission is checked server-side independently — a button that does nothing on click usually means a migration granting that permission hasn't been applied yet.",
    defaultOpen: false,
    blocks: [
      {
        kind: "table",
        head: ["Permission", "What it does", "Granted to", "2 people"],
        rows: [
          ["pos.sell", "Sell, add fee lines", "Manager/Sales/Cashier", { text: "✗", tone: "slate" }],
          ["pos.shift.open / .close / .report", "Open/close a shift, read reports", "Manager/Sales/Cashier", { text: "✗", tone: "slate" }],
          ["pos.nosale", "Open the drawer with no sale", "Manager/Sales/Cashier", { text: "✗", tone: "slate" }],
          ["order.return", "Return with a receipt", "Manager/Sales/Cashier", { text: "✗", tone: "slate" }],
          ["pos.expense.create", "Log a petty-cash expense", "Manager/Sales/Cashier", { text: "if from the drawer", tone: "dual" }],
          ["pos.discount.approve", "Approve a manual discount", "Manager", { text: "Yes", tone: "dual" }],
          ["pos.void", "Void a bill", "Manager", { text: "Yes", tone: "dual" }],
          ["pos.cash.movement", "Take cash out of the drawer", "Manager", { text: "Yes", tone: "dual" }],
          ["pos.return.noreceipt", "Return without a receipt", "Manager", { text: "Yes", tone: "dual" }],
          ["payment.refund", "Confirm a non-cash refund", "Manager", { text: "✗", tone: "slate" }],
          ["pos.expense.personal", "Expense from the owner's own money", "Administrator only", { text: "✗", tone: "slate" }],
          ["pos.petty_cash.manage", "Top up a branch petty-cash wallet", "Administrator only", { text: "✗", tone: "slate" }],
          ["tax.setting.manage", "Shop-wide tax/VAT settings", "Manager", { text: "✗", tone: "slate" }],
          ["storecredit.issue / .adjust", "Issue a gift card / adjust balance", "Manager", { text: "✗", tone: "slate" }],
          ["storecredit.redeem", "Redeem a gift card", "Anyone who sells", { text: "✗", tone: "slate" }],
          ["commission.view / .manage", "Read commission / set rates", "Manager", { text: "✗", tone: "slate" }],
          ["purchase.receive", "Receive stock at the counter", "Manager/Warehouse", { text: "✗", tone: "slate" }],
        ],
      },
      { kind: "callout", tone: "info", title: "4 actions that always need two people", body: "Manual discount · voiding a bill · cash out of the drawer · a return without a receipt — all four are \"money leaving the counted total,\" so they always need a second PIN, even if the same person legitimately holds both permissions." },
    ],
  },
  {
    id: "errors",
    eyebrow: "Reference",
    title: "Error messages and how to fix them",
    lead: "What gets opened most often when a bill won't go through.",
    defaultOpen: true,
    blocks: [
      {
        kind: "table",
        head: ["Code", "Cause", "Fix at the counter"],
        rows: [
          [{ text: "PAYMENT_MISMATCH", tone: "red" }, "The paid total doesn't match the server's computed total — usually price/promo changed after the item was scanned", "The cart has already been refreshed — review the new total and collect again"],
          [{ text: "INSUFFICIENT", tone: "red" }, "Not enough stock, or fewer non-expired lots than what's being sold", "Check branch stock / expired lots / reduce the quantity"],
          [{ text: "PHARMACY_REVIEW_REQUIRED / PHARMACY_SAFETY_CHECK_REQUIRED", tone: "amber" }, "This item needs pharmacist review or a safety interview before it can be sold", "Use the POS action to send the case to the pharmacist and park the bill until approval"],
          [{ text: "DISCOUNT_UNAPPROVED", tone: "red" }, "A manual discount has no approver+reason, or the amount would be trimmed by the cap", "Get a supervisor's PIN+reason / lower the amount under the cap, then re-key"],
          [{ text: "POINTS_INVALID", tone: "red" }, "Asked to redeem more points than available or than the bill can absorb — the balance changed between preview and payment", "Re-quote, then tell the customer the correct total"],
          [{ text: "WOULD_OVERDRAW", tone: "red" }, "A cash movement would push expected cash below zero — usually a typo", "Check the digits you typed (the real total isn't shown if Blind Close is on)"],
          [{ text: "ALREADY_RETURNED", tone: "red" }, "This bill already has a return on it — Void only works on a bill with none", "Use a return instead of voiding the bill"],
          [{ text: "A silent 403", tone: "amber" }, "The button does nothing — the permission was never seeded", "Check that the migration granting that permission was applied (see the permissions table)"],
        ],
      },
      { kind: "sub", text: "Sales commission" },
      { kind: "p", text: "A commission rate is stored with an effective date, and a report uses whichever rate was in effect on each bill's own date — changing a rate adds a new row, it never overwrites (otherwise adjusting a rate would silently change numbers for months already paid out)." },
      {
        kind: "list",
        items: [
          "Specificity order: product → category → default",
          "A returned item claws its commission back — a voided bill earns none at all",
          "A whole-bill discount is spread proportionally across lines — a bill with a large coupon never pays commission on money the shop didn't receive",
          "commission.view and .manage are separate — a team lead can read the numbers without being able to raise their own rate",
        ],
      },
    ],
  },
  {
    id: "scope",
    eyebrow: "Reference",
    title: "What isn't supported",
    lead: "The scope built so far is general retail POS — everything below is a separate module, not a hidden setting.",
    defaultOpen: false,
    blocks: [
      {
        kind: "stats",
        items: [
          { label: "Restaurants", value: "Table/floor plans" },
          { label: "Kitchen", value: "KDS / kitchen print" },
          { label: "Menu", value: "Modifiers/toppings" },
          { label: "Queueing", value: "Queue tickets/reservations" },
          { label: "Networking", value: "Offline-first sync" },
          { label: "Card terminals", value: "No EDC driver" },
        ],
      },
      { kind: "callout", tone: "warn", title: "Hardware needs testing before going live", body: "The ESC/POS-over-WebUSB path (receipts, barcodes, cash-drawer kick) is written but has never run against real hardware — test it against the actual printer model before relying on it." },
      { kind: "sub", text: "Rehearsal checklist before going live (every item, on every register)" },
      {
        kind: "list",
        items: [
          "Cash sale with change · split payment across methods · card/QR with a reference number · reprinting a receipt",
          "Partial return · full-bill return · confirming a non-cash refund",
          "An unauthorized action correctly gets rejected · closing a shift with a known cash variance",
          "A manual discount with a supervisor PIN · parking a bill and recalling it from a second device · sending a pharmacy case from POS and resuming after approval",
          "A mid-shift bank deposit · voiding a bill · reading the X report before closing",
        ],
      },
      { kind: "p", text: "If loyalty is in use, rehearse 4 more bills: member discount alone / coupon+member / redeeming points / a partial return on a bill that both earned and redeemed points — confirm balanceMismatchCount stays at 0." },
    ],
  },
];

function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

function Cell({ value }: { value: string | { text: string; tone?: Tone } }) {
  if (typeof value === "string") return <>{value}</>;
  return value.tone ? <ToneBadge tone={value.tone}>{value.text}</ToneBadge> : <>{value.text}</>;
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return <Paragraph className={styles.lead}>{block.text}</Paragraph>;
    case "sub":
      return <p className={styles.subhead}>{block.text}</p>;
    case "list":
      return (
        <ul className={styles.list}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "callout":
      return (
        <div className={`${styles.callout} ${styles[block.tone]}`}>
          <p className={styles.calloutTitle}>{block.title}</p>
          <p style={{ margin: 0 }}>{block.body}</p>
        </div>
      );
    case "stats":
      return (
        <div className={styles.statGrid}>
          {block.items.map((item) => (
            <div className={styles.statCard} key={item.label}>
              <span className={styles.statLabel}>{item.label}</span>
              <span className={styles.statValue}>{item.value}</span>
            </div>
          ))}
        </div>
      );
    case "flow":
      return (
        <div className={styles.flowSteps}>
          {block.steps.map((step) => (
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
    case "table":
      return (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {block.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}><Cell value={cell} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

/**
 * Collapsible section — same pattern as /admin/pharmacy-manual: collapsed by
 * default for background reading, open by default for what's checked
 * mid-shift. Content stays in the DOM either way, and the print stylesheet
 * forces every closed body open, so a printed/saved copy is never missing
 * anything.
 */
function Disclosure({ section }: { section: ManualSection }) {
  const [open, setOpen] = useState(section.defaultOpen);
  return (
    <section id={section.id} className={styles.section} style={{ scrollMarginTop: 88 }}>
      <div
        className={styles.disclosureHead}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <div className={styles.disclosureHeadText}>
          {section.eyebrow ? <div className={styles.sectionEyebrow}>{section.eyebrow}</div> : null}
          <Title level={3} className={styles.sectionTitle}>{section.title}</Title>
        </div>
        <span className={styles.disclosureChevron} aria-hidden>{open ? "–" : "+"}</span>
      </div>
      <div className={open ? styles.disclosureBody : `${styles.disclosureBody} ${styles.disclosureBodyClosed}`}>
        {section.lead ? <Paragraph className={styles.lead}>{section.lead}</Paragraph> : null}
        {section.blocks.map((block, i) => (
          <BlockView block={block} key={i} />
        ))}
      </div>
    </section>
  );
}

function blockToMarkdown(block: Block): string[] {
  const cellText = (v: string | { text: string; tone?: Tone }) => (typeof v === "string" ? v : v.text);
  switch (block.kind) {
    case "p":
      return [block.text, ""];
    case "sub":
      return [`**${block.text}**`, ""];
    case "list":
      return [...block.items.map((item) => `- ${item}`), ""];
    case "callout":
      return [`> **${block.title}** — ${block.body}`, ""];
    case "stats":
      return [block.items.map((item) => `**${item.label}:** ${item.value}`).join(" · "), ""];
    case "flow":
      return [...block.steps.map((step, i) => `${i + 1}. **${step.title}** — ${step.detail}`), ""];
    case "table": {
      const lines = [`| ${block.head.join(" | ")} |`, `| ${block.head.map(() => "---").join(" | ")} |`];
      block.rows.forEach((row) => lines.push(`| ${row.map(cellText).join(" | ")} |`));
      lines.push("");
      return lines;
    }
    default:
      return [];
  }
}

export function buildPosManualMarkdown(copy: PageCopy, sections: ManualSection[]): string {
  const lines: string[] = [`# ${copy.heroTitle}`, "", copy.heroLead, ""];
  sections.forEach((section) => {
    lines.push(`## ${section.title}`, "");
    if (section.lead) lines.push(section.lead, "");
    section.blocks.forEach((block) => lines.push(...blockToMarkdown(block)));
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/**
 * The manual's hero + sticky quick-nav + all sections, with no auth baked
 * in — the two page wrappers each decide who's allowed to see it:
 * /admin/pos-manual gates on the pos.sell permission (admin session),
 * /pos/manual has no gate at all (a pos_only cashier has no admin session
 * to check against; the content itself has nothing tenant-specific or
 * secret in it).
 */
export function PosManualBody({ lang, heroIcon }: { lang: "th" | "en"; heroIcon?: React.ReactNode }) {
  const copy = lang === "th" ? COPY_TH : COPY_EN;
  const sections = lang === "th" ? TH_SECTIONS : EN_SECTIONS;

  const handleDownload = useCallback(() => {
    const markdown = buildPosManualMarkdown(copy, sections);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bms-pos-manual-${lang}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [copy, sections, lang]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const navItems = sections.map((s) => ({ id: s.id, label: s.title }));

  return (
    <div className={styles.page} data-print-root>
      <div className={styles.hero}>
        <Tag color="blue" style={{ width: "fit-content" }} icon={heroIcon}>{copy.heroTag}</Tag>
        <Title level={2} className={styles.heroTitle}>{copy.heroTitle}</Title>
        <Paragraph className={styles.heroLead}>{copy.heroLead}</Paragraph>
      </div>

      <nav className={styles.quickNav} aria-label={copy.heroTag}>
        <div className={styles.quickNavChips}>
          {navItems.map((item) => (
            <a key={item.id} href={`#${item.id}`} className={styles.quickNavChip}>{item.label}</a>
          ))}
        </div>
        <div className={styles.quickNavActions}>
          <Button size="small" icon={<PrinterOutlined />} onClick={handlePrint}>{copy.printLabel}</Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={handleDownload}>{copy.downloadLabel}</Button>
        </div>
      </nav>

      {sections.map((section) => (
        <Disclosure section={section} key={section.id} />
      ))}
    </div>
  );
}
