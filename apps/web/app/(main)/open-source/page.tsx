"use client";

import { Typography, Divider } from "antd";
import { useI18n } from "@/lib/i18nContext";

const { Title, Paragraph, Link } = Typography;

export default function OpenSourcePage() {
  const { t } = useI18n();

  return (
    <div style={{ width: "100%", minHeight: 520, padding: 16 }}>
      <Typography>

        <Title level={2}>Open Source</Title>

        <Paragraph>
          {t("header.title")} มีส่วนประกอบที่เป็นซอฟต์แวร์โอเพ่นซอร์ส (Open Source Software)
          ซึ่งเปิดเผยซอร์สโค้ดเพื่อความโปร่งใสและการมีส่วนร่วมจากชุมชน
        </Paragraph>

        <Divider />

        <Title level={4}>Source Code Repository</Title>

        <Paragraph>
          ซอร์สโค้ดของโปรเจกต์ <strong>{t("header.title")}</strong> สามารถเข้าถึงได้ผ่าน GitHub ดังนี้:
        </Paragraph>

        <Paragraph>
          <strong>Mobile Application</strong>
          <br />
          <Link
            href="https://github.com/Base2526/app-jachoei"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://github.com/Base2526/app-jachoei
          </Link>
        </Paragraph>

        <Paragraph>
          <strong>Website</strong>
          <br />
          <Link
            href="https://github.com/Base2526/web-jachoei"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://github.com/Base2526/web-jachoei
          </Link>
        </Paragraph>

        <Divider />

        <Paragraph type="secondary">
          This project includes open-source components. Services provided by{" "}
          {t("header.title")} may also include proprietary modules or services
          that are subject to separate commercial terms.
        </Paragraph>

      </Typography>
    </div>
  );
}