"use client";

import { Typography, Divider } from "antd";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";

const { Title, Paragraph, Link } = Typography;

const REPOS = {
  mobile: "https://github.com/Base2526/app-jachoei",
  website: "https://github.com/Base2526/web-jachoei",
} as const;

type OpenSourceContent = {
  title: string;
  intro: (appName: string) => string;
  repoTitle: string;
  repoIntro: (appName: string) => string;
  mobileLabel: string;
  websiteLabel: string;
  footerNote: (appName: string) => string;
};

const OPEN_SOURCE: { en: OpenSourceContent; th: OpenSourceContent } = {
  en: {
    title: "Open Source",
    intro: (appName) =>
      `${appName} includes open-source software components. We publish source code to support transparency and community collaboration.`,
    repoTitle: "Source Code Repository",
    repoIntro: (appName) => `The source code for ${appName} is available on GitHub:`,
    mobileLabel: "Mobile Application",
    websiteLabel: "Website",
    footerNote: (appName) =>
      `This project includes open-source components. Services provided by ${appName} may also include proprietary modules or services that are subject to separate terms.`,
  },
  th: {
    title: "โอเพนซอร์ส",
    intro: (appName) =>
      `${appName} มีส่วนประกอบที่เป็นซอฟต์แวร์โอเพนซอร์ส (Open Source Software) เพื่อความโปร่งใส และเปิดโอกาสให้ชุมชนมีส่วนร่วมในการพัฒนา`,
    repoTitle: "ที่เก็บซอร์สโค้ด",
    repoIntro: (appName) => `ซอร์สโค้ดของโปรเจกต์ ${appName} สามารถเข้าถึงได้ผ่าน GitHub ดังนี้:`,
    mobileLabel: "แอปมือถือ",
    websiteLabel: "เว็บไซต์",
    footerNote: (appName) =>
      `โปรเจกต์นี้มีส่วนประกอบแบบโอเพนซอร์ส และบริการของ ${appName} อาจมีโมดูล/บริการบางส่วนที่เป็นกรรมสิทธิ์ ซึ่งอาจอยู่ภายใต้เงื่อนไขการใช้งานแยกต่างหาก`,
  },
};

export default function OpenSourcePage() {
  const { t, lang } = useI18n();
  const content = resolveBilingual(OPEN_SOURCE, lang);

  return (
    <div style={{ width: "100%", minHeight: 520, padding: 16 }}>
      <Typography>

        <Title level={2}>{content.title}</Title>

        <Paragraph>
          {content.intro(t("header.title"))}
        </Paragraph>

        <Divider />

        <Title level={4}>{content.repoTitle}</Title>

        <Paragraph>
          {content.repoIntro(t("header.title"))}
        </Paragraph>

        <Paragraph>
          <strong>{content.mobileLabel}</strong>
          <br />
          <Link
            href={REPOS.mobile}
            target="_blank"
            rel="noopener noreferrer"
          >
            {REPOS.mobile}
          </Link>
        </Paragraph>

        <Paragraph>
          <strong>{content.websiteLabel}</strong>
          <br />
          <Link
            href={REPOS.website}
            target="_blank"
            rel="noopener noreferrer"
          >
            {REPOS.website}
          </Link>
        </Paragraph>

        <Divider />

        <Paragraph type="secondary">
          {content.footerNote(t("header.title"))}
        </Paragraph>

      </Typography>
    </div>
  );
}