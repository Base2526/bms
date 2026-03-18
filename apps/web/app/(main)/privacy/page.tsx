"use client";

import { Typography, Divider } from "antd";

import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";

const { Title, Paragraph } = Typography;

type PrivacyContent = {
  title: string;
  intro: (appName: string) => string;
  sections: Array<{ title: string; body: string }>;
  footerNote: string;
};

const PRIVACY: { en: PrivacyContent; th: PrivacyContent } = {
  en: {
    title: "Privacy Policy",
    intro: (appName) => `Privacy policy for ${appName}.`,
    sections: [
      {
        title: "1. Information We Collect",
        body:
          "We may collect information needed to provide the service, such as your name, email, phone number, and technical data (e.g., device and usage information).",
      },
      {
        title: "2. Use of Information",
        body:
          "We use information to operate and improve the service, communicate with you, prevent abuse, and maintain system security.",
      },
      {
        title: "3. Data Security",
        body:
          "We implement appropriate security measures to protect user information. However, no system is 100% secure.",
      },
      {
        title: "4. Third-party Services",
        body:
          "Our website may connect to third-party services that have their own privacy policies. Please review those policies when applicable.",
      },
    ],
    footerNote:
      "By using this website, you consent to the collection and use of information in accordance with this Privacy Policy.",
  },
  th: {
    title: "นโยบายความเป็นส่วนตัว",
    intro: (appName) => `นโยบายความเป็นส่วนตัวของ ${appName}`,
    sections: [
      {
        title: "1. ข้อมูลที่เราเก็บรวบรวม",
        body:
          "เราอาจเก็บข้อมูลที่จำเป็นต่อการให้บริการ เช่น ชื่อ อีเมล หมายเลขโทรศัพท์ หรือข้อมูลทางเทคนิคบางส่วนเพื่อการใช้งานและความปลอดภัย",
      },
      {
        title: "2. การใช้ข้อมูล",
        body:
          "ข้อมูลจะถูกใช้เพื่อให้บริการ ปรับปรุงระบบ การติดต่อสื่อสาร การป้องกันการใช้งานที่ไม่เหมาะสม และการรักษาความปลอดภัยของแพลตฟอร์ม",
      },
      {
        title: "3. ความปลอดภัยของข้อมูล",
        body:
          "เราใช้มาตรการด้านความปลอดภัยที่เหมาะสมเพื่อปกป้องข้อมูลของผู้ใช้งาน อย่างไรก็ตาม ไม่มีระบบใดปลอดภัย 100%",
      },
      {
        title: "4. บริการของบุคคลที่สาม",
        body:
          "เว็บไซต์อาจมีการเชื่อมต่อกับบริการของบุคคลที่สาม ซึ่งมีนโยบายความเป็นส่วนตัวของตนเอง กรุณาตรวจสอบนโยบายที่เกี่ยวข้องเมื่อมีการใช้งาน",
      },
    ],
    footerNote:
      "การใช้งานเว็บไซต์นี้ถือว่าคุณยินยอมให้มีการเก็บรวบรวมและใช้ข้อมูลตามนโยบายความเป็นส่วนตัวฉบับนี้",
  },
};

export default function PrivacyPage() {
  const { t, lang } = useI18n();
  const content = resolveBilingual(PRIVACY, lang);

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
