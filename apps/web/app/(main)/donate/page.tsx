"use client";

import React from "react";
// import Image from "next/image";
import { Card, Typography, Space, Button, Divider, message, Image } from "antd";
import { CopyOutlined, LinkOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";

const { Title, Paragraph, Text, Link } = Typography;

type DonateContent = {
  title: string;
  intro: string;
  cardTitle: string;
  qrTitle: string;
  qrAlt: string;
  qrHint: string;
  paymentTitle: string;
  openPaymentLink: string;
  copyLink: string;
  noteLabel: string;
  noteText: string;
  disclaimer: string;
  toastCopied: string;
  toastCopyFailed: string;
};

const DONATE: { en: DonateContent; th: DonateContent } = {
  en: {
    title: "Donate",
    intro:
      "If you’d like to support the development of this project, you can donate via Binance (QR / payment link).",
    cardTitle: "Donate",
    qrTitle: "Scan QR (Binance)",
    qrAlt: "Binance donation QR code",
    qrHint: "Scan with the Binance app and verify recipient details and amount before confirming.",
    paymentTitle: "Payment link",
    openPaymentLink: "Open payment link",
    copyLink: "Copy link",
    noteLabel: "Note:",
    noteText: "Thank you for supporting this project.",
    disclaimer:
      "This page only provides direct transfer information for Binance. This website does not process payments and cannot recover transactions sent to the wrong destination.",
    toastCopied: "Copied!",
    toastCopyFailed: "Copy failed",
  },
  th: {
    title: "สนับสนุน",
    intro:
      "หากคุณอยากสนับสนุนการพัฒนาโปรเจกต์ สามารถโดเนทผ่าน Binance ได้ (QR / Payment Link)",
    cardTitle: "สนับสนุน",
    qrTitle: "สแกน QR (Binance)",
    qrAlt: "คิวอาร์โค้ดสำหรับโดเนทผ่าน Binance",
    qrHint: "สแกนด้วยแอป Binance แล้วตรวจสอบชื่อผู้รับ/จำนวนเงินก่อนยืนยันทุกครั้ง",
    paymentTitle: "ลิงก์ชำระเงิน",
    openPaymentLink: "เปิดลิงก์ชำระเงิน",
    copyLink: "คัดลอกลิงก์",
    noteLabel: "หมายเหตุ:",
    noteText: "ขอบคุณที่สนับสนุนโปรเจกต์นี้",
    disclaimer:
      "หน้านี้เป็นเพียงข้อมูลสำหรับการโอนโดยตรงกับ Binance เท่านั้น เว็บไซต์นี้ไม่ประมวลผลการชำระเงิน และไม่สามารถช่วยกู้คืนธุรกรรมที่โอนผิดได้",
    toastCopied: "คัดลอกแล้ว",
    toastCopyFailed: "คัดลอกไม่สำเร็จ",
  },
};

export default function DonatePage() {
  // ✅ ใส่ลิงก์/ข้อมูลจริงของคุณตรงนี้
  const paymentLink = "https://s.binance.com/czv6Ztzg"; // TODO
  const { lang } = useI18n();
  const content = resolveBilingual(DONATE, lang);

  const handleCopy = async (value: string) => {
    try {
      // ✅ Modern clipboard (ต้องเป็น HTTPS หรือ localhost)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        message.success(content.toastCopied);
        return;
      }

      // ✅ Fallback: execCommand copy (ใช้ได้แม้ HTTP หลายกรณี)
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.opacity = "0";
      textarea.setAttribute("readonly", "");

      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);

      if (ok) message.success(content.toastCopied);
      else message.error(content.toastCopyFailed);
    } catch (err) {
      message.error(content.toastCopyFailed);
    }
  };

  return (
    <div style={{ width: "100%", minHeight: 520, padding: 16 }}>
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Title level={2} style={{ marginBottom: 0 }}>
        {content.title}
      </Title>
      <Paragraph style={{ marginTop: 0 }}>
        {content.intro}
      </Paragraph>

      <Card style={{ borderRadius: 16 }}>
        <Space
          direction="vertical"
          size={12}
          style={{ width: "100%", alignItems: "center" }}
        >
          <Title level={4} style={{ margin: 0 }}>
            {content.qrTitle}
          </Title>

          <div
            style={{
              width: 240,
              height: 240,
              // borderRadius: 16,
              border: "1px solid var(--app-border)",
              overflow: "hidden",
              background: "var(--app-surface)",
            }}
          >
            <Image
              src="/icons/binance-qr.png"
              alt={content.qrAlt}
              width={240}
              height={240}
              // priority
            />
          </div>

          <Text type="secondary">
            {content.qrHint}
          </Text>

          <Divider style={{ margin: "6px 0" }} />

          <Title level={5} style={{ margin: 0 }}>
            {content.paymentTitle}
          </Title>

          <Space wrap style={{ justifyContent: "center" }}>
            <Link href={paymentLink} target="_blank" rel="noopener noreferrer">
              <LinkOutlined /> {content.openPaymentLink}
            </Link>

            <Button icon={<CopyOutlined />} onClick={() => handleCopy(paymentLink)}>
              {content.copyLink}
            </Button>
          </Space>

          <Paragraph style={{ marginBottom: 0, textAlign: "center" }}>
            <Text strong>{content.noteLabel}</Text> {content.noteText}
          </Paragraph>

          <Divider style={{ margin: "6px 0" }} />

          <Space align="start">
            <SafetyCertificateOutlined style={{ marginTop: 2 }} />
            <Text type="secondary">
              {content.disclaimer}
            </Text>
          </Space>
        </Space>
      </Card>
    </Space>
    </div>
  );
}
