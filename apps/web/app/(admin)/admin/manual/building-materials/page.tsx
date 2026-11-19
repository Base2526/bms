"use client";

import { Alert, Card, Col, Row, Space, Tag, Typography } from "antd";
import Link from "next/link";
import { useI18n } from "@/lib/i18nContext";

type GuideCopy = {
  tag: string;
  title: string;
  lead: string;
  pilot: string;
  preset: string;
  cards: Array<{ title: string; body: string; links: Array<{ label: string; href: string }> }>;
  flowTitle: string;
  flow: string[];
  guardTitle: string;
  guards: string[];
  footer: string;
};

const COPY: Record<"th" | "en", GuideCopy> = {
  th: {
    tag: "คู่มือร้านวัสดุก่อสร้าง · Pilot",
    title: "ขายหน้าร้าน เสนอราคา และติดตามหนี้",
    lead: "เริ่มจากสินค้าและหน่วยที่ตรวจแล้ว ใช้ราคา สต็อก และเอกสารจากระบบจริงทุกขั้น",
    pilot: "ฟีเจอร์ใหม่ในหน้านี้ยังเป็น pilot ต้องตรวจ migration สิทธิ์ ผู้ใช้งานจริง เครื่องชั่ง และเอกสารภาษีในร้านที่จะเปิดใช้ก่อน",
    preset: "รูปแบบร้าน building_materials จัดคำแนะนำและเมนูเริ่มต้นเท่านั้น ไม่ได้เปิดงานตัดจากม้วน ส่งหลายเที่ยว หรือบัญชีเจ้าหนี้",
    cards: [
      { title: "1. ตั้งสินค้าและหน่วย", body: "ปูนถุง/พาเลทใช้ pack factor ที่ตรวจได้จริง สีต่างขนาดต้องแยก SKU หรือ variant และสต็อก สเปกต้องมีแหล่งอ้างอิงและผู้ตรวจอีกคนเผยแพร่", links: [
        { label: "สินค้า", href: "/admin/products" }, { label: "แพ็ก", href: "/admin/product-packs" },
        { label: "สเปก", href: "/admin/product-specs" },
      ] },
      { title: "2. เสนอราคาโครงการ", body: "ฝ่ายขายสร้างร่าง ผู้มีสิทธิ์อีกคนอนุมัติเมื่อค่าส่งทราบ บันทึกการส่งและหลักฐานยอมรับ แก้ด้วย revision ใหม่ แล้วแปลงเป็นออร์เดอร์ที่ตรวจสต็อกซ้ำ", links: [
        { label: "ใบเสนอราคา", href: "/admin/quotations" }, { label: "ออร์เดอร์", href: "/admin/orders" },
      ] },
      { title: "3. ขายและชั่งน้ำหนัก", body: "POS ตรวจ PIN สิทธิ์และกะ ราคาต่อกิโลกรัมใช้ฉลาก prefix 22 ที่ server ตรวจซ้ำ สต็อกเป็นกรัมจำนวนเต็ม และ pilot นี้ยังไม่ขายผ่านเว็บหรือ AI ลูกค้า", links: [
        { label: "POS", href: "/pos" }, { label: "ตั้งรหัสเครื่องชั่ง", href: "/admin/stock-models" },
        { label: "ราคาต่อกก.", href: "/admin/weighted-prices" },
      ] },
      { title: "4. ซื้อเข้า เครดิต และส่งมอบ", body: "PO รับบางส่วนได้; หากผู้ขายส่งเป็นแพ็ก ให้ตรึงจำนวนแพ็ก ตัวคูณหน่วยฐาน หลักฐาน และต้นทุนต่อหน่วยฐานที่ระบุชัดเจนใน PO แล้วตรวจจำนวนแพ็กอีกครั้งตอนรับ Admin ให้เลือกสาขาที่มีสิทธิ์รับและ server ตรวจซ้ำก่อนเพิ่มสต็อก ลูกหนี้ดูยอดจาก AR ledger การส่งของยังเป็นทั้งบิล; งานหลายเที่ยวและ AP ยังไม่ครบ", links: [
        { label: "ซื้อเข้า", href: "/admin/purchase" }, { label: "ลูกหนี้", href: "/admin/receivables" },
        { label: "ส่งของ", href: "/admin/orders" },
      ] },
    ],
    flowTitle: "ลำดับใช้งานในร้านทดสอบ",
    flow: [
      "ตรวจสาขา สิทธิ์ PIN และสินค้าจริงก่อนรับบิลแรก",
      "ลองขายปูน 1 ถุง/1 พาเลท แล้วเทียบจำนวนหน่วยฐานกับ stock movement",
      "สร้างใบเสนอราคา แก้ revision อนุมัติ บันทึกหลักฐานยอมรับ และแปลงเป็นออร์เดอร์",
      "ลองขายเชื่อ รับชำระบางส่วน แล้วเทียบใบแจ้งยอดภายในกับ AR ledger",
      "ลอง PO รับบางส่วนและคืนสินค้าจากบิลเดิม ตรวจ stock/เงิน/ภาษีที่เปลี่ยนจริง",
    ],
    guardTitle: "หยุดและส่งให้พนักงานตรวจเมื่อ",
    guards: [
      "ค่าส่งยังไม่ทราบ สเปกไม่มีแหล่งที่มา หรือใบเสนอราคาหมดอายุ",
      "ต้องตัดสายไฟจากม้วน เก็บเศษ/เศษเสีย หรือส่งบิลเดียวหลายเที่ยว",
      "เลข serial/lot ไม่ตรง หรือการคืนสินค้าต้องเข้า stock review",
      "ต้องเสนอราคาก่อน VAT หรือใช้เอกสารเพื่อยื่นภาษีโดยยังไม่มีนักบัญชีตรวจ",
    ],
    footer: "อ่านคู่มือสาธารณะฉบับเต็มพร้อมเสียงได้ที่ /learn/building-materials ส่วนรายละเอียดเชิงปฏิบัติและหลักฐานทดสอบอยู่ในเอกสารของรีโป",
  },
  en: {
    tag: "Building materials guide · Pilot",
    title: "Counter sales, quotations and receivables",
    lead: "Start with checked products and units. Use server-backed prices, stock and documents at every step.",
    pilot: "New workflows on this page remain pilots. Check migrations, permissions, real users, scale hardware and tax documents in the target shop before rollout.",
    preset: "The building_materials archetype prioritizes starter guidance and navigation. It does not enable roll cutting, multi-trip delivery or accounts payable.",
    cards: [
      { title: "1. Set up products and units", body: "Cement bags and pallets need a verified pack factor. Paint containers of different sizes need distinct SKU/variant stock. Specifications need a source and a second reviewer to publish them.", links: [
        { label: "Products", href: "/admin/products" }, { label: "Packs", href: "/admin/product-packs" },
        { label: "Specs", href: "/admin/product-specs" },
      ] },
      { title: "2. Quote a project", body: "Sales drafts the quote; a separate authorized person approves once freight is known. Record sending and acceptance evidence, revise with a new version, then convert through an order that rechecks stock.", links: [
        { label: "Quotations", href: "/admin/quotations" }, { label: "Orders", href: "/admin/orders" },
      ] },
      { title: "3. Sell and weigh", body: "POS verifies PIN, permission and shift. The per-kilogram pilot uses prefix-22 labels rechecked by the server and integer gram stock. It is not available in the web cart or customer AI.", links: [
        { label: "POS", href: "/pos" }, { label: "Scale code", href: "/admin/stock-models" },
        { label: "Kg prices", href: "/admin/weighted-prices" },
      ] },
      { title: "4. Buy, collect and hand over", body: "POs allow partial receiving. Supplier packages need a frozen package count, base-unit factor, source and explicit base-unit cost on the PO, rechecked on receipt. Admin selects an allowed receiving branch and the server checks access before adding stock. Receivables show AR ledger balances. Delivery remains whole-order; multi-trip delivery and AP are incomplete.", links: [
        { label: "Purchasing", href: "/admin/purchase" }, { label: "Receivables", href: "/admin/receivables" },
        { label: "Delivery", href: "/admin/orders" },
      ] },
    ],
    flowTitle: "Trial-shop workflow",
    flow: [
      "Check branches, permissions, PINs and actual products before the first bill.",
      "Sell one cement bag and one pallet; reconcile base-unit quantities with stock movements.",
      "Draft, revise, approve and accept a quote with evidence, then convert it to an order.",
      "Make a credit sale, collect part of the debt and compare the internal statement with the AR ledger.",
      "Part-receive a PO and return an original sale; inspect the resulting stock, money and tax records.",
    ],
    guardTitle: "Stop and ask staff to review when",
    guards: [
      "Freight is unknown, a spec lacks a source or the quote has expired.",
      "A roll must be cut with kept/wasted remnants or a single bill needs several trips.",
      "Serial/lot identity conflicts or a return requires stock review.",
      "An ex-VAT price or statutory tax document is needed without accountant review.",
    ],
    footer: "Read the full public guide with narration at /learn/building-materials. The repository documents retain detailed procedures and test evidence.",
  },
};

export default function BuildingMaterialsManualPage() {
  const { lang } = useI18n();
  const c = COPY[lang === "en" ? "en" : "th"];
  return <div style={{ maxWidth: 1160, margin: "0 auto", padding: 24 }}>
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <div>
        <Tag color="orange">{c.tag}</Tag>
        <Typography.Title level={2} style={{ marginTop: 12 }}>{c.title}</Typography.Title>
        <Typography.Paragraph type="secondary">{c.lead}</Typography.Paragraph>
        <Link href="/admin/manual">← {lang === "en" ? "All manuals" : "คู่มือทั้งหมด"}</Link>
        <Typography.Paragraph style={{ marginTop: 12 }}><Link href={lang === "en" ? "/en/learn/building-materials" : "/th/learn/building-materials"}>{lang === "en" ? "Open the complete public guide with narrated flow" : "เปิดคู่มือสาธารณะฉบับเต็ม พร้อม Flow และเสียงบรรยาย"} →</Link></Typography.Paragraph>
      </div>
      <Alert type="warning" showIcon closable message={c.pilot} description={c.preset} />
      <Row gutter={[16, 16]}>{c.cards.map((card) => <Col key={card.title} xs={24} md={12}>
        <Card title={card.title} style={{ height: "100%" }}>
          <Typography.Paragraph>{card.body}</Typography.Paragraph>
          <Space wrap>{card.links.map((link) => <Link key={link.href} href={link.href}>{link.label} →</Link>)}</Space>
        </Card>
      </Col>)}</Row>
      <Card title={c.flowTitle}><ol>{c.flow.map((item) => <li key={item}>{item}</li>)}</ol></Card>
      <Card title={c.guardTitle}><ul>{c.guards.map((item) => <li key={item}>{item}</li>)}</ul></Card>
      <Typography.Paragraph type="secondary">{c.footer}</Typography.Paragraph>
    </Space>
  </div>;
}
