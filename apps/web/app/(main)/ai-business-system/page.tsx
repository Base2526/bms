import { cookies } from "next/headers";
import type { Metadata } from "next";
import AuthorityPage, { type AuthorityPageContent } from "@/components/marketing/authority/AuthorityPage";
import StructuredData from "@/components/seo/StructuredData";
import { publicPageMetadata, type PublicSeoLocale } from "@/lib/publicSeo";
import { breadcrumbJsonLd, faqPageJsonLd, webPageJsonLd } from "@/lib/seoJsonLd";

const REVIEWED_AT = "2026-10-29";

const CONTENT: Record<PublicSeoLocale, AuthorityPageContent> = {
  th: {
    eyebrow: "AI IN BMS · VERIFIED WORKFLOWS",
    title: "AI ที่ทำงานผ่านเครื่องมือที่อนุมัติ และตอบจากผลที่ตรวจสอบได้",
    intro: "AI ใน BMS ช่วยตีความความต้องการ เลือกเครื่องมือที่เหมาะกับสิทธิ์และบริบท แล้วอธิบายผลจากบริการจริง โดยไม่ใช้โมเดลเป็นผู้ตัดสินราคา สต็อก ยอดเงิน หรือสิทธิ์",
    answerLabel: "AI ใน BMS ทำอะไร",
    answer: "AI ทำหน้าที่ เข้าใจ → เลือกเครื่องมือ → อธิบายผล ส่วนบริการ backend เป็นผู้ตรวจสิทธิ์ อ่านข้อมูล และทำธุรกรรมที่ได้รับอนุญาต",
    reviewedLabel: "ทบทวนเนื้อหา",
    reviewedAt: REVIEWED_AT,
    flowTitle: "เส้นทางคำตอบที่ยึดข้อมูลจริง",
    flow: ["ข้อความ", "ความต้องการ", "เครื่องมือ", "สิทธิ์", "บริการ", "ข้อมูลจริง", "คำอธิบาย", "Audit"],
    sections: [
      {
        kicker: "เข้าใจ",
        title: "แปลภาษาคนเป็นงานที่ระบบรู้จัก",
        body: "AI ช่วยแยกเจตนาและบริบท แต่ไม่ใช้การคาดเดาของโมเดลเป็นข้อเท็จจริงทางธุรกิจ",
        bullets: ["เข้าใจคำถามหลายรูปแบบและบทสนทนาต่อเนื่อง", "เลือกเฉพาะ capability ที่ระบบอนุญาต", "ขอข้อมูลเพิ่มเมื่อคำสั่งยังไม่ชัดเจน"],
      },
      {
        kicker: "ลงมือ",
        title: "เรียก approved tools แทนการเข้าฐานข้อมูล",
        body: "AI ไม่สร้าง SQL และไม่ข้าม service layer เครื่องมือเป็นผู้ตรวจ input, tenant, permission และ audit ก่อนเข้าถึงงานจริง",
        bullets: ["ลูกค้าเห็นเฉพาะเครื่องมือที่ปลอดภัยสำหรับลูกค้า", "พนักงานได้เครื่องมือตามสิทธิ์ที่ server ตรวจซ้ำ", "งานละเอียดอ่อนเสนอได้ แต่ต้องให้คนยืนยัน"],
      },
      {
        kicker: "อธิบาย",
        title: "ตอบจากผลลัพธ์ ไม่ใช่แต่งผลลัพธ์",
        body: "เมื่อบริการคืนข้อมูล AI ช่วยสรุปเป็นภาษาที่เข้าใจง่าย พร้อมระบุข้อจำกัดเมื่อหลักฐานไม่ครบ",
        bullets: ["ไม่เดาราคา สต็อก สถานะ หรือวิธีชำระเงิน", "ไม่เปลี่ยนคำว่าไม่ทราบให้กลายเป็นคำยืนยัน", "ข้อมูลคลินิกยังอยู่ภายใต้การตัดสินใจของเภสัชกร"],
      },
    ],
    principlesTitle: "ขอบเขตที่ป้องกัน AI จากการทำเกินสิทธิ์",
    principles: [
      { title: "Tenant scoped", body: "ทุกการอ่านและเขียนผูกกับร้านที่ server ยืนยัน ไม่รับ tenant จากข้อความผู้ใช้เป็นอำนาจ" },
      { title: "Tool catalog", body: "AI ใช้ได้เฉพาะเครื่องมือที่ห่อ validation, permission และ audit ไว้แล้ว" },
      { title: "Propose before mutate", body: "การเปลี่ยนแปลงที่ละเอียดอ่อนแสดงข้อเสนอและ args ที่ server จัดให้ก่อนยืนยัน" },
      { title: "Known limits", body: "เมื่อข้อมูลหาย ไม่พร้อม หรือยังไม่รองรับ ระบบต้องบอกข้อจำกัดแทนการสร้างคำตอบ" },
    ],
    faqTitle: "คำถามเกี่ยวกับ AI ใน BMS",
    faq: [
      { question: "AI ใน BMS ต่างจากแชทบอททั่วไปอย่างไร?", answer: "AI ใน BMS เชื่อมกับ workflow และ approved tools ของระบบ จึงสามารถอธิบายข้อมูลที่ตรวจสอบแล้วและเตรียมงานต่อให้บริการ backend ได้ แทนที่จะตอบจากข้อความอย่างเดียว" },
      { question: "BMS ป้องกัน AI hallucination อย่างไร?", answer: "ข้อเท็จจริงที่มีผลต่อธุรกิจต้องมาจากเครื่องมือและบริการจริง หากข้อมูลไม่มีหรือไม่ครบ คำตอบต้องระบุข้อจำกัด ไม่สร้างราคา สต็อก สถานะ หรือการยืนยันขึ้นเอง" },
      { question: "AI เข้าฐานข้อมูลโดยตรงหรือไม่?", answer: "ไม่เข้าโดยตรง AI ไม่สร้าง SQL และใช้ได้เฉพาะเครื่องมือ backend ที่ผ่าน validation, tenant scope, permission และ audit" },
      { question: "AI ของลูกค้าและ AI ของพนักงานใช้สิทธิ์เท่ากันหรือไม่?", answer: "ไม่เท่ากัน ลูกค้าเห็นเฉพาะเครื่องมือสำหรับลูกค้าที่ไม่มีงานละเอียดอ่อน ส่วนพนักงานได้เครื่องมือตามสิทธิ์ และ server ตรวจสิทธิ์ซ้ำก่อนทำงาน" },
      { question: "งานใดต้องมีคนยืนยัน?", answer: "งานละเอียดอ่อน เช่น การเปลี่ยนข้อมูลหรือธุรกรรมที่มีผล ต้องแสดงสิ่งที่จะเปลี่ยนและให้ผู้มีสิทธิ์ยืนยันอย่างชัดเจนก่อนดำเนินการ" },
    ],
    cta: {
      title: "ดูตัวอย่างก่อนเลือกวิธีใช้งาน",
      body: "ทดลองบทสนทนาตัวอย่าง หรืออ่านคู่มือเรื่องรายงานและขอบเขตของ AI",
      primary: { label: "ทดลองคุยกับ AI", path: "/demo" },
      secondary: { label: "อ่านคู่มือ AI และรายงาน", path: "/learn/guides/reports-ai" },
    },
  },
  en: {
    eyebrow: "AI IN BMS · VERIFIED WORKFLOWS",
    title: "AI that uses approved tools and answers from verified results",
    intro: "AI in BMS interprets intent, selects a tool that fits the permission and context, then explains results from real services. The model does not decide prices, stock, money or permissions.",
    answerLabel: "What AI does in BMS",
    answer: "AI interprets → selects a tool → explains the result. Backend services check permissions, read data and perform authorized transactions.",
    reviewedLabel: "Content reviewed",
    reviewedAt: REVIEWED_AT,
    flowTitle: "The path to a grounded answer",
    flow: ["Message", "Intent", "Tool", "Permission", "Service", "Verified data", "Explanation", "Audit"],
    sections: [
      {
        kicker: "Understand",
        title: "Translate natural language into known work",
        body: "AI helps identify intent and context without treating model inference as a business fact.",
        bullets: ["Understand varied questions and recent context", "Select only capabilities the system exposes", "Ask for clarification when a request is incomplete"],
      },
      {
        kicker: "Act",
        title: "Call approved tools instead of the database",
        body: "AI does not generate SQL or bypass the service layer. Tools validate input, tenant, permission and audit requirements before real work.",
        bullets: ["Customers receive only customer-safe tools", "Staff tools follow permissions that the server checks again", "Sensitive work can be proposed but requires confirmation"],
      },
      {
        kicker: "Explain",
        title: "Explain the result without inventing the result",
        body: "After a service returns data, AI summarizes it in clear language and states the limits when evidence is incomplete.",
        bullets: ["Do not guess price, stock, status or payment methods", "Do not turn unknown information into a confirmation", "Clinical decisions remain with a licensed pharmacist"],
      },
    ],
    principlesTitle: "Boundaries that keep AI inside its authority",
    principles: [
      { title: "Tenant scoped", body: "Every read and write uses the shop established by the server, never a tenant claimed in user text." },
      { title: "Tool catalog", body: "AI can use only tools already wrapped with validation, permission and audit controls." },
      { title: "Propose before mutate", body: "Sensitive changes show the proposed mutation and server-composed arguments before confirmation." },
      { title: "Known limits", body: "When data is missing, unavailable or unsupported, the system states the limitation instead of creating an answer." },
    ],
    faqTitle: "Questions about AI in BMS",
    faq: [
      { question: "How is AI in BMS different from a general chatbot?", answer: "AI in BMS is connected to system workflows and approved tools, so it can explain verified data and prepare work for backend services rather than relying on text alone." },
      { question: "How does BMS reduce AI hallucinations?", answer: "Business facts must come from real tools and services. If evidence is missing or incomplete, the answer must state the limitation instead of inventing a price, stock level, status or confirmation." },
      { question: "Does AI query the database directly?", answer: "No. AI does not generate SQL and can use only backend tools that apply validation, tenant scope, permissions and auditing." },
      { question: "Do customer AI and staff AI have the same authority?", answer: "No. Customers receive only customer-safe tools. Staff tools depend on staff permissions, which the server checks again before execution." },
      { question: "Which actions require a person to confirm?", answer: "Sensitive changes and consequential transactions must show what will change and require explicit confirmation from an authorized person before execution." },
    ],
    cta: {
      title: "See the behavior before choosing a workflow",
      body: "Try a sample conversation or read the guide to AI reporting and operating boundaries.",
      primary: { label: "Try the AI demo", path: "/demo" },
      secondary: { label: "Read the AI and reports guide", path: "/learn/guides/reports-ai" },
    },
  },
};

function locale(): PublicSeoLocale {
  return cookies().get("lang")?.value === "en" ? "en" : "th";
}

export function generateMetadata(): Metadata {
  const lang = locale();
  const content = CONTENT[lang];
  return publicPageMetadata({ path: "/ai-business-system", locale: lang, title: content.title, description: content.intro });
}

export default function AiBusinessSystemPage() {
  const lang = locale();
  const content = CONTENT[lang];
  return (
    <>
      <StructuredData id="ai-business-page-jsonld" data={webPageJsonLd({ locale: lang, path: "/ai-business-system", title: content.title, description: content.intro, reviewedAt: content.reviewedAt })} />
      <StructuredData id="ai-business-faq-jsonld" data={faqPageJsonLd(content.faq)} />
      <StructuredData id="ai-business-breadcrumb-jsonld" data={breadcrumbJsonLd(lang, [
        { name: lang === "th" ? "หน้าหลัก" : "Home", path: "/" },
        { name: lang === "th" ? "AI ใน BMS" : "AI in BMS", path: "/ai-business-system" },
      ])} />
      <AuthorityPage content={content} locale={lang} />
    </>
  );
}
