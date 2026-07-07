"use client";

import { Typography, Divider } from "antd";

import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";

const { Title, Paragraph, Link } = Typography;

const REPO_URL = "https://github.com/Base2526/next-apollo-pg-ws";

type LicenseContent = {
  title: string;
  intro: (appName: string) => string;
  repoTitle: string;
  repoIntro: (appName: string) => string;
  mitTitle: string;
  copyright: (year: number, appName: string) => string;
  warranty: string;
};

const LICENSE: { en: LicenseContent; th: LicenseContent } = {
  en: {
    title: "License",
    intro: (appName) => `Licensing information for ${appName}.`,
    repoTitle: "Open Source Repository",
    repoIntro: (appName) => `${appName} is based on the following open-source repository:`,
    mitTitle: "MIT License",
    copyright: (year, appName) => `Copyright © ${year} ${appName}`,
    warranty: 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.',
  },
  th: {
    title: "ใบอนุญาต",
    intro: (appName) => `ข้อมูลใบอนุญาตการใช้งานสำหรับ ${appName}`,
    repoTitle: "ที่เก็บซอร์สโค้ดโอเพนซอร์ส",
    repoIntro: (appName) => `${appName} อ้างอิง/พัฒนาต่อยอดจากซอร์สโค้ดโอเพนซอร์สต่อไปนี้:`,
    mitTitle: "ใบอนุญาต MIT",
    copyright: (year, appName) => `สงวนลิขสิทธิ์ © ${year} ${appName}`,
    warranty: "ซอฟต์แวร์นี้ให้บริการ “ตามสภาพที่เป็น” (AS IS) โดยไม่มีการรับประกันใด ๆ",
  },
};

export default function LicensePage() {
  const { t, lang } = useI18n();
  const content = resolveBilingual(LICENSE, lang);
  const year = new Date().getFullYear();
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
        <Link
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {REPO_URL}
        </Link>
      </Paragraph>

      <Divider />

      <Title level={4}>{content.mitTitle}</Title>
      <Paragraph>
        {content.copyright(year, t("header.title"))}
      </Paragraph>

      <Paragraph>
        {content.warranty}
      </Paragraph>
    </Typography>
    </div>
  );
}
