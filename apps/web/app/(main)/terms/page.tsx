"use client";

import { Typography, Divider } from "antd";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";

const { Title, Paragraph } = Typography;

type TermsContent = {
  title: string;
  intro: (appName: string) => string;
  sections: Array<{ title: string; body: string }>;
  footerNote: string;
};

const TERMS: { en: TermsContent; th: TermsContent } = {
  en: {
    title: "Terms & Conditions",
    intro: (appName) => `Terms and conditions for using ${appName} and related services.`,
    sections: [
      {
        title: "1. Acceptance of Terms",
        body:
          "By accessing or using this website, you agree to these terms. If you do not agree, please stop using the service immediately.",
      },
      {
        title: "2. Use of the Service",
        body:
          "You agree to use the website and services lawfully and not to perform any action that could harm the system, other users, or third parties.",
      },
      {
        title: "3. Limitation of Liability",
        body:
          "This website and software are provided “AS IS”. The developers are not liable for any damages arising from use of the service.",
      },
    ],
    footerNote: "These terms apply to all users of the website and services.",
  },
  th: {
    title: "ข้อกำหนดการใช้งาน",
    intro: (appName) => `เงื่อนไขและข้อตกลงในการใช้งานเว็บไซต์และบริการของ ${appName}`,
    sections: [
      {
        title: "1. การยอมรับข้อกำหนด",
        body:
          "การเข้าถึงหรือใช้งานเว็บไซต์นี้ ถือว่าคุณตกลงยอมรับเงื่อนไขและข้อตกลงทั้งหมด หากคุณไม่ยอมรับ กรุณาหยุดการใช้งานทันที",
      },
      {
        title: "2. การใช้งานบริการ",
        body:
          "คุณตกลงที่จะใช้งานเว็บไซต์และบริการนี้อย่างถูกต้องตามกฎหมาย และไม่กระทำการใด ๆ ที่อาจก่อให้เกิดความเสียหายต่อระบบ ผู้ใช้งานอื่น หรือบุคคลภายนอก",
      },
      {
        title: "3. ข้อจำกัดความรับผิด",
        body:
          "เว็บไซต์และซอฟต์แวร์นี้ให้บริการในสภาพ “ตามสภาพที่เป็น” (AS IS) ผู้พัฒนาไม่รับผิดชอบต่อความเสียหายใด ๆ ที่เกิดจากการใช้งาน",
      },
    ],
    footerNote: "หน้านี้ใช้บังคับกับผู้ใช้งานเว็บไซต์และบริการทุกคน",
  },
};

export default function TermsPage() {
  const { t, lang } = useI18n();
  const content = resolveBilingual(TERMS, lang);

  
  return (
    <div style={{ width: "100%", minHeight: 520, padding: 16 }}>
      <Typography>
        <Title level={2}>{content.title}</Title>
        <Paragraph>{content.intro(t("header.title"))}</Paragraph>

        <Divider />

        {content.sections.map((s) => (
          <div key={s.title}>
            <Title level={4}>{s.title}</Title>
            <Paragraph>{s.body}</Paragraph>
          </div>
        ))}

        <Divider />

        <Paragraph type="secondary">{content.footerNote}</Paragraph>
      </Typography>
    </div>
  );
}
