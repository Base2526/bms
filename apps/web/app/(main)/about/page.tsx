import { cookies } from "next/headers";
import type { Metadata } from "next";
import AuthorityPage, { type AuthorityPageContent } from "@/components/marketing/authority/AuthorityPage";
import StructuredData from "@/components/seo/StructuredData";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";
import { breadcrumbJsonLd, faqPageJsonLd, webPageJsonLd } from "@/lib/seoJsonLd";

const REVIEWED_AT = "2026-10-29";

const CONTENT: Record<PublicSeoLocale, AuthorityPageContent> = {
  th: {
    eyebrow: "ABOUT BMS · AI BUSINESS OPERATING SYSTEM",
    title: "BMS คือระบบบริหารธุรกิจที่เชื่อม AI กับงานจริงของร้าน",
    intro: "BMS เชื่อมบทสนทนาของลูกค้าเข้ากับ CRM ออร์เดอร์ สต็อก การชำระเงิน การจัดส่ง และรายงาน โดยให้ backend และฐานข้อมูลเป็นแหล่งข้อมูลจริงเสมอ",
    answerLabel: "คำตอบสั้น ๆ",
    answer: "BMS คือ AI-first business operating system ไม่ใช่แชทบอทเดี่ยว ๆ — AI เข้าใจความต้องการ เลือกเครื่องมือที่ได้รับอนุญาต และอธิบายผลที่ระบบตรวจสอบแล้ว",
    reviewedLabel: "ทบทวนเนื้อหา",
    reviewedAt: REVIEWED_AT,
    flowTitle: "จากคำถามลูกค้าถึงภาพรวมธุรกิจในระบบเดียว",
    flow: ["ลูกค้า", "AI", "CRM", "ออร์เดอร์", "สต็อก", "ชำระเงิน", "จัดส่ง", "Dashboard"],
    sections: [
      {
        kicker: "ระบบเดียว",
        title: "เชื่อมงานขายกับงานหลังร้าน",
        body: "ข้อมูลไม่ได้หยุดอยู่ที่บทสนทนา แต่ไหลต่อไปยัง workflow ที่พนักงานตรวจสอบและติดตามได้",
        bullets: ["เก็บบริบทลูกค้าและงานติดตามใน CRM", "สร้างและจัดการออร์เดอร์ผ่านบริการฝั่งระบบ", "เชื่อมการขายกับสต็อก การชำระเงิน และรายงาน"],
      },
      {
        kicker: "ข้อมูลจริง",
        title: "ฐานข้อมูลและ backend เป็นผู้ตัดสินข้อเท็จจริง",
        body: "ราคา จำนวนคงเหลือ ยอดเงิน สิทธิ์ และสถานะงานมาจากบริการของระบบ ไม่ได้มาจากข้อความที่โมเดลแต่งขึ้น",
        bullets: ["AI ไม่เขียน SQL หรืออ่านฐานข้อมูลโดยตรง", "เครื่องมือทุกตัวตรวจสิทธิ์และขอบเขตร้าน", "ผลลัพธ์ที่ตอบลูกค้าต้องมาจากข้อมูลที่ตรวจสอบได้"],
      },
      {
        kicker: "หลายรูปแบบธุรกิจ",
        title: "เริ่มจากงานของร้านแต่ละประเภท",
        body: "BMS มีแนวทางสำหรับร้านค้าปลีกและค้าส่ง ร้านอาหารและคาเฟ่ ร้านบอร์ดเกม และร้านขายยา โดยแต่ละโดเมนมีข้อจำกัดของตัวเอง",
        bullets: ["POS สต็อก จัดซื้อ และลูกค้าสำหรับค้าปลีก", "โต๊ะ ครัว ออร์เดอร์ และต้นทุนสำหรับร้านอาหาร", "ขอบเขตคลินิกของร้านขายยาต้องอยู่กับเภสัชกรผู้มีใบอนุญาต"],
      },
    ],
    principlesTitle: "หลักที่ BMS ใช้แยก AI ออกจากการเดา",
    principles: [
      { title: "Source of truth", body: "ข้อมูลธุรกิจที่มีผลจริงมาจากบริการและฐานข้อมูลของ BMS" },
      { title: "Permission first", body: "ทุกเครื่องมือทำงานภายใต้ tenant และสิทธิ์ของผู้ใช้หรือช่องทางนั้น" },
      { title: "Human confirmation", body: "งานที่ละเอียดอ่อนต้องให้คนเห็นสิ่งที่จะเปลี่ยนและยืนยันก่อน" },
      { title: "Explain verified results", body: "AI มีหน้าที่อธิบายผลที่ตรวจสอบแล้ว และบอกตรง ๆ เมื่อข้อมูลยังไม่มี" },
    ],
    faqTitle: "คำถามเกี่ยวกับ BMS",
    faq: [
      { question: "BMS คืออะไร?", answer: "BMS คือระบบบริหารธุรกิจที่เชื่อม AI, CRM, ออร์เดอร์, สต็อก, การชำระเงิน, การจัดส่ง และ Dashboard เข้าด้วยกัน โดย backend และฐานข้อมูลเป็นแหล่งข้อมูลจริง" },
      { question: "BMS เป็นแชทบอทหรือไม่?", answer: "ไม่ใช่แชทบอทเดี่ยว ๆ AI เป็นชั้นที่เข้าใจความต้องการและเรียกเครื่องมือที่ได้รับอนุญาต ส่วนงานธุรกิจจริงยังทำผ่านบริการของระบบ" },
      { question: "AI เปลี่ยนข้อมูลสำคัญเองได้หรือไม่?", answer: "ไม่ได้โดยอัตโนมัติ งานที่ละเอียดอ่อนต้องผ่านสิทธิ์ของผู้ใช้และการยืนยันจากคน โดยหน้าจอต้องแสดงสิ่งที่จะเปลี่ยนก่อนดำเนินการ" },
      { question: "AI เดาราคา สต็อก หรือสถานะออร์เดอร์หรือไม่?", answer: "ไม่เดา ข้อมูลเหล่านี้ต้องอ่านจากเครื่องมือและบริการที่ตรวจสอบข้อมูลจริง หากไม่มีข้อมูล ระบบควรบอกว่าไม่มีข้อมูลยืนยัน" },
      { question: "ร้านขายยาให้ AI ตัดสินใจทางคลินิกได้หรือไม่?", answer: "ไม่ได้ เภสัชกรผู้มีใบอนุญาตเป็นผู้ตัดสินใจทางคลินิก ตรวจ แก้ และอนุมัติทุกครั้ง ส่วน AI ช่วยจัดโครงสร้างข้อมูลภายในขอบเขตที่กำหนด" },
    ],
    cta: {
      title: "ดูว่า workflow ของร้านเชื่อมกันอย่างไร",
      body: "เริ่มจากภาพรวมการทำงาน แล้วเลือกคู่มือที่ตรงกับประเภทธุรกิจของคุณ",
      primary: { label: "ดูการทำงานของ BMS", path: "/how-it-works" },
      secondary: { label: "เปิดศูนย์เรียนรู้", path: "/learn" },
    },
  },
  en: {
    eyebrow: "ABOUT BMS · AI BUSINESS OPERATING SYSTEM",
    title: "BMS connects AI to the real operating work of a business",
    intro: "BMS connects customer conversations to CRM, orders, inventory, payments, shipping and reporting while keeping backend services and the database as the source of truth.",
    answerLabel: "Short answer",
    answer: "BMS is an AI-first business operating system, not a standalone chatbot. AI interprets intent, selects approved tools and explains results that the system has verified.",
    reviewedLabel: "Content reviewed",
    reviewedAt: REVIEWED_AT,
    flowTitle: "From a customer request to one connected business view",
    flow: ["Customer", "AI", "CRM", "Order", "Inventory", "Payment", "Shipping", "Dashboard"],
    sections: [
      {
        kicker: "One system",
        title: "Connect selling work to back-office work",
        body: "Information does not stop at the conversation. It continues into workflows that staff can review and track.",
        bullets: ["Keep customer context and follow-up work in CRM", "Create and manage orders through backend services", "Connect sales to inventory, payments and reporting"],
      },
      {
        kicker: "Verified facts",
        title: "Backend services and data decide business facts",
        body: "Prices, available stock, money, permissions and work status come from system services, not text invented by a model.",
        bullets: ["AI does not write SQL or query the database directly", "Every tool checks its shop and permission scope", "Customer-facing results must come from verified data"],
      },
      {
        kicker: "Business-specific",
        title: "Start with how each business actually works",
        body: "BMS covers retail and wholesale, restaurants and cafes, board-game cafes and pharmacy workflows, each with its own boundaries.",
        bullets: ["POS, stock, purchasing and customers for retail", "Tables, kitchen work, orders and costs for restaurants", "Licensed pharmacists retain every clinical decision in pharmacy workflows"],
      },
    ],
    principlesTitle: "How BMS separates assisted work from guessing",
    principles: [
      { title: "Source of truth", body: "Business facts with real impact come from BMS services and data." },
      { title: "Permission first", body: "Every tool runs within the tenant and permissions of that user or channel." },
      { title: "Human confirmation", body: "Sensitive work shows a person what will change and requires confirmation." },
      { title: "Explain verified results", body: "AI explains checked results and states clearly when information is not available." },
    ],
    faqTitle: "Questions about BMS",
    faq: [
      { question: "What is BMS?", answer: "BMS is a business operating system that connects AI, CRM, orders, inventory, payments, shipping and dashboards, with backend services and data as the source of truth." },
      { question: "Is BMS a chatbot?", answer: "No. AI is the layer that interprets a request and calls approved tools; actual business work continues through backend services." },
      { question: "Can AI change sensitive business data by itself?", answer: "Not automatically. Sensitive work requires user permission and human confirmation, with the proposed change shown before it is executed." },
      { question: "Does AI guess prices, stock or order status?", answer: "No. Those facts must come from approved tools and verified system services. When evidence is unavailable, the system should say that it is not verified." },
      { question: "Can AI make clinical decisions for a pharmacy?", answer: "No. A licensed pharmacist makes, reviews and approves every clinical decision. AI can only help structure information within an approved boundary." },
    ],
    cta: {
      title: "See how the operating workflow connects",
      body: "Start with the product flow, then choose the learning path that matches your business.",
      primary: { label: "How BMS works", path: "/how-it-works" },
      secondary: { label: "Open the learning center", path: "/learn" },
    },
  },
};

function locale(): PublicSeoLocale {
  return cookies().get("lang")?.value === "en" ? "en" : "th";
}

export function generateMetadata(): Metadata {
  const lang = locale();
  const content = CONTENT[lang];
  return publicPageMetadata({ path: "/about", locale: lang, title: content.title, description: content.intro });
}

export default function AboutPage() {
  const lang = locale();
  const content = CONTENT[lang];
  return (
    <>
      <StructuredData id="about-page-jsonld" data={webPageJsonLd({ locale: lang, path: "/about", title: content.title, description: content.intro, reviewedAt: content.reviewedAt, type: "AboutPage" })} />
      <StructuredData id="about-faq-jsonld" data={faqPageJsonLd(content.faq)} />
      <StructuredData id="about-breadcrumb-jsonld" data={breadcrumbJsonLd(lang, [
        { name: lang === "th" ? "หน้าหลัก" : "Home", path: "/" },
        { name: lang === "th" ? "เกี่ยวกับ BMS" : "About BMS", path: "/about" },
      ])} />
      <AuthorityPage content={content} locale={lang} />
    </>
  );
}
