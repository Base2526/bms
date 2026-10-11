"use client";

import { Divider, Typography } from "antd";
import type React from "react";

const { Title, Paragraph, Link } = Typography;

const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL || "/support";
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_TO_EMAIL || "whosscam.io@gmail.com";

type DataDeletionSection = {
  title: string;
  body: React.ReactNode;
};

const englishSections: DataDeletionSection[] = [
  {
    title: "Who can request deletion",
    body: (
      <ul>
        <li>Store owners or administrators can request deletion of their store account, staff accounts, or personal data connected to their BMS POS workspace.</li>
        <li>Staff users can request deletion of personal account data through their store administrator or by contacting BMS support.</li>
        <li>End customers can request deletion of personal data collected by a store. We may first need to verify the request with the relevant store owner because the store controls its own customer records.</li>
      </ul>
    ),
  },
  {
    title: "How to request deletion",
    body: (
      <ol>
        <li>
          Open the <Link href={SUPPORT_URL}>BMS support page</Link> and choose the account, privacy, or data deletion topic.
        </li>
        <li>Include your store name, account email or phone number, and a short description of the data you want deleted.</li>
        <li>If you are requesting deletion for customer records, include enough order, receipt, or contact details for us to identify the correct store record without exposing extra personal data.</li>
        <li>
          You may also email <Link href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Link> with the same information.
        </li>
      </ol>
    ),
  },
  {
    title: "What data may be deleted",
    body: (
      <ul>
        <li>Account profile details, contact information, and staff access records where deletion is legally and operationally allowed.</li>
        <li>Uploaded support attachments or non-essential files that are no longer needed to provide the service.</li>
        <li>Customer contact records that are not required for an active order, legal obligation, accounting record, tax document, audit trail, security investigation, or dispute.</li>
      </ul>
    ),
  },
  {
    title: "What data may be retained",
    body: (
      <ul>
        <li>Orders, payments, receipts, tax documents, accounting records, inventory movements, audit logs, and security logs may be retained where required by law, fraud prevention, dispute handling, or business record integrity.</li>
        <li>When full deletion is not possible, we will limit access, anonymize, deactivate, or retain only the minimum information needed for the required purpose where practical.</li>
      </ul>
    ),
  },
  {
    title: "Timing and verification",
    body: (
      <ul>
        <li>We review deletion requests after verifying the requester and the related store or account.</li>
        <li>We usually respond within a reasonable support timeframe. Complex requests may take longer if they involve legal, tax, accounting, security, or store-owner verification.</li>
      </ul>
    ),
  },
];

const thaiSections: DataDeletionSection[] = [
  {
    title: "ใครสามารถขอลบข้อมูลได้",
    body: (
      <ul>
        <li>เจ้าของร้านหรือแอดมินร้านสามารถขอลบบัญชีร้าน บัญชีพนักงาน หรือข้อมูลส่วนบุคคลที่เกี่ยวข้องกับพื้นที่ทำงาน BMS POS ของร้านได้</li>
        <li>พนักงานร้านสามารถขอลบข้อมูลบัญชีส่วนตัวผ่านแอดมินร้าน หรือส่งคำขอมายังทีมช่วยเหลือของ BMS ได้</li>
        <li>ลูกค้าปลายทางสามารถขอลบข้อมูลส่วนบุคคลที่ร้านเก็บไว้ได้ โดยเราอาจต้องตรวจสอบกับเจ้าของร้านที่เกี่ยวข้องก่อน เพราะร้านเป็นผู้ควบคุมข้อมูลลูกค้าของตนเอง</li>
      </ul>
    ),
  },
  {
    title: "วิธีส่งคำขอลบข้อมูล",
    body: (
      <ol>
        <li>
          เปิด <Link href={SUPPORT_URL}>หน้า Support ของ BMS</Link> แล้วเลือกหัวข้อบัญชี ความเป็นส่วนตัว หรือการลบข้อมูล
        </li>
        <li>ระบุชื่อร้าน อีเมลหรือเบอร์โทรของบัญชี และอธิบายสั้น ๆ ว่าต้องการให้ลบข้อมูลใด</li>
        <li>หากเป็นคำขอลบข้อมูลลูกค้า กรุณาระบุข้อมูลอ้างอิงเท่าที่จำเป็น เช่น เลขออเดอร์ ใบเสร็จ หรือช่องทางติดต่อ เพื่อให้เราระบุรายการที่ถูกต้องโดยไม่เปิดเผยข้อมูลเกินจำเป็น</li>
        <li>
          หรือส่งอีเมลไปที่ <Link href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Link> พร้อมข้อมูลเดียวกัน
        </li>
      </ol>
    ),
  },
  {
    title: "ข้อมูลที่อาจลบได้",
    body: (
      <ul>
        <li>ข้อมูลโปรไฟล์บัญชี ข้อมูลติดต่อ และข้อมูลสิทธิ์พนักงาน ในกรณีที่สามารถลบได้ตามกฎหมายและไม่กระทบการดำเนินงานที่จำเป็น</li>
        <li>ไฟล์แนบในคำขอช่วยเหลือหรือไฟล์ที่ไม่จำเป็นต่อการให้บริการแล้ว</li>
        <li>ข้อมูลติดต่อลูกค้าที่ไม่เกี่ยวข้องกับออเดอร์ที่ยังเปิดอยู่ ภาระตามกฎหมาย เอกสารบัญชี เอกสารภาษี audit trail การตรวจสอบความปลอดภัย หรือข้อพิพาท</li>
      </ul>
    ),
  },
  {
    title: "ข้อมูลที่อาจต้องเก็บรักษาไว้",
    body: (
      <ul>
        <li>ออเดอร์ การชำระเงิน ใบเสร็จ เอกสารภาษี ข้อมูลบัญชี การเคลื่อนไหวสต็อก audit log และ security log อาจต้องเก็บไว้ตามกฎหมาย การป้องกันทุจริต การจัดการข้อพิพาท หรือความถูกต้องของบันทึกธุรกิจ</li>
        <li>หากไม่สามารถลบทั้งหมดได้ เราจะจำกัดการเข้าถึง ทำให้ไม่ระบุตัวตน ปิดใช้งาน หรือเก็บเฉพาะข้อมูลขั้นต่ำที่จำเป็นต่อวัตถุประสงค์นั้นเท่าที่ทำได้</li>
      </ul>
    ),
  },
  {
    title: "ระยะเวลาและการยืนยันตัวตน",
    body: (
      <ul>
        <li>เราจะตรวจสอบคำขอลบข้อมูลหลังจากยืนยันตัวตนของผู้ร้องขอและร้านหรือบัญชีที่เกี่ยวข้องแล้ว</li>
        <li>โดยปกติเราจะตอบกลับภายในระยะเวลาการช่วยเหลือที่เหมาะสม คำขอที่ซับซ้อนอาจใช้เวลานานขึ้นหากเกี่ยวข้องกับกฎหมาย ภาษี บัญชี ความปลอดภัย หรือการยืนยันจากเจ้าของร้าน</li>
      </ul>
    ),
  },
];

export default function DataDeletionPage() {
  return (
    <div style={{ width: "100%", minHeight: 520, padding: 16 }}>
      <Typography>
        <Title level={2}>Data Deletion Request / การขอลบข้อมูล</Title>
        <Paragraph>
          This page explains how BMS POS users, store administrators, staff, and end customers can request deletion of personal data.
        </Paragraph>
        <Paragraph>
          หน้านี้อธิบายวิธีที่ผู้ใช้ BMS POS เจ้าของร้าน แอดมิน พนักงาน และลูกค้าปลายทางสามารถส่งคำขอลบข้อมูลส่วนบุคคลได้
        </Paragraph>

        <Divider />

        <Title level={3}>English</Title>
        {englishSections.map((section) => (
          <section key={section.title}>
            <Title level={4}>{section.title}</Title>
            {section.body}
          </section>
        ))}

        <Divider />

        <Title level={3}>ภาษาไทย</Title>
        {thaiSections.map((section) => (
          <section key={section.title}>
            <Title level={4}>{section.title}</Title>
            {section.body}
          </section>
        ))}

        <Divider />

        <Paragraph type="secondary">Last updated: 11 October 2026</Paragraph>
      </Typography>
    </div>
  );
}
