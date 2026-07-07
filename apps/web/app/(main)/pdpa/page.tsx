"use client";

import { Typography, Divider } from "antd";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";

const { Title, Paragraph, Link } = Typography;

type PdpaContent = {
  title: string;
  intro: (appName: string) => string;
  sections: Array<{ title: string; body: string }>;
  contactTitle: string;
  contactBody: string;
  contactEmailLabel: string;
  contactEmailValue: string;
  footerNote: string;
};

const PDPA: { en: PdpaContent; th: PdpaContent } = {
  en: {
    title: "PDPA Notice (Thailand)",
    intro: (appName) =>
      `${appName} respects your privacy and processes personal data in accordance with the Personal Data Protection Act B.E. 2562 (PDPA).`,
    sections: [
      {
        title: "1. Purpose of Processing",
        body:
          "We process personal data to provide and improve our safety-focused community platform, prevent abuse/spam, maintain system security, and respond to support or legal requests.",
      },
      {
        title: "2. Personal Data We May Collect",
        body:
          "Depending on how you use the service, we may collect identifiers and contact details (e.g., name, email, phone), account/profile information, report content you submit, and technical data (e.g., device, browser, logs, IP address).",
      },
      {
        title: "3. Legal Basis and Consent",
        body:
          "We process data based on necessity to provide the service, legitimate interests in security and fraud prevention, and/or your consent when required. You may withdraw consent where applicable.",
      },
      {
        title: "4. Retention",
        body:
          "We retain personal data only as long as necessary for the purposes described above, to comply with legal obligations, and to protect the platform and users.",
      },
      {
        title: "5. Your Rights as a Data Subject",
        body:
          "You may have rights to access, obtain a copy, correct, delete, restrict, object, or request data portability, subject to PDPA conditions and security considerations.",
      },
    ],
    contactTitle: "Contact",
    contactBody:
      "If you have questions about PDPA or would like to exercise your rights, please contact us:",
    contactEmailLabel: "Email:",
    contactEmailValue: "support@yourdomain.com",
    footerNote:
      "We may request verification to protect account ownership and prevent misuse of PDPA requests.",
  },
  th: {
    title: "PDPA (ประเทศไทย)",
    intro: (appName) =>
      `${appName} ให้ความสำคัญกับความเป็นส่วนตัว และมีการประมวลผลข้อมูลส่วนบุคคลตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)`,
    sections: [
      {
        title: "1. วัตถุประสงค์ในการประมวลผลข้อมูล",
        body:
          "เราใช้ข้อมูลส่วนบุคคลเพื่อให้บริการและปรับปรุงแพลตฟอร์มความปลอดภัยของชุมชน ป้องกันการใช้งานที่ไม่เหมาะสม/สแปม รักษาความปลอดภัยของระบบ และตอบกลับคำขอช่วยเหลือหรือคำขอทางกฎหมาย",
      },
      {
        title: "2. ประเภทข้อมูลส่วนบุคคลที่อาจเก็บรวบรวม",
        body:
          "ขึ้นอยู่กับการใช้งานของคุณ เราอาจเก็บข้อมูลระบุตัวตนและข้อมูลติดต่อ (เช่น ชื่อ อีเมล เบอร์โทร) ข้อมูลบัญชี/โปรไฟล์ เนื้อหารายงานที่คุณส่ง และข้อมูลทางเทคนิค (เช่น อุปกรณ์ เบราว์เซอร์ บันทึกการใช้งาน และ IP)",
      },
      {
        title: "3. ฐานทางกฎหมายและความยินยอม",
        body:
          "เราอาจประมวลผลข้อมูลโดยอาศัยความจำเป็นเพื่อให้บริการ ประโยชน์โดยชอบด้วยกฎหมายด้านความปลอดภัยและการป้องกันการทุจริต และ/หรือความยินยอมของคุณในกรณีที่กฎหมายกำหนด คุณสามารถถอนความยินยอมได้ในส่วนที่เกี่ยวข้อง",
      },
      {
        title: "4. ระยะเวลาการเก็บรักษาข้อมูล",
        body:
          "เราจะเก็บรักษาข้อมูลส่วนบุคคลเท่าที่จำเป็นตามวัตถุประสงค์ที่ระบุ เพื่อปฏิบัติตามกฎหมาย และเพื่อคุ้มครองความปลอดภัยของแพลตฟอร์มและผู้ใช้งาน",
      },
      {
        title: "5. สิทธิของเจ้าของข้อมูลส่วนบุคคล",
        body:
          "คุณอาจมีสิทธิในการเข้าถึง ขอรับสำเนา แก้ไข ลบ ระงับการใช้ คัดค้าน หรือขอให้โอนย้ายข้อมูล ตามเงื่อนไขของ PDPA และข้อพิจารณาด้านความปลอดภัยของระบบ",
      },
    ],
    contactTitle: "ติดต่อ",
    contactBody:
      "หากมีคำถามเกี่ยวกับ PDPA หรือประสงค์ใช้สิทธิของเจ้าของข้อมูล สามารถติดต่อได้ที่:",
    contactEmailLabel: "อีเมล:",
    contactEmailValue: "support@yourdomain.com",
    footerNote:
      "เพื่อความปลอดภัย เราอาจขอข้อมูลเพิ่มเติมเพื่อยืนยันตัวตน/ความเป็นเจ้าของบัญชี และป้องกันการนำสิทธิไปใช้ในทางที่ไม่เหมาะสม",
  },
};

export default function PdpaPage() {
  const { t, lang } = useI18n();
  const content = resolveBilingual(PDPA, lang);

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

        <Title level={4}>{content.contactTitle}</Title>
        <Paragraph>{content.contactBody}</Paragraph>
        <Paragraph>
          <strong>{content.contactEmailLabel}</strong>{" "}
          <Link href={`mailto:${content.contactEmailValue}`}>{content.contactEmailValue}</Link>
        </Paragraph>

        <Paragraph type="secondary">{content.footerNote}</Paragraph>
      </Typography>
    </div>
  );
}
