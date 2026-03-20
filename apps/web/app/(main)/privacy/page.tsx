"use client";

import { Typography, Divider } from "antd";
import React from "react";

import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";

const { Title, Paragraph } = Typography;

type PrivacyContent = {
  title: string;
  intro: (appName: string) => string;
  sections: Array<{ title: string; body: React.ReactNode }>;
  footerNote: string;
};

const PRIVACY: { en: PrivacyContent; th: PrivacyContent } = {
  en: {
    title: "Privacy Policy",
    intro: (appName) => `Privacy policy for ${appName}.`,
    sections: [
      {
        title: "1. Information We Collect",
        body: (
          <>
            <Paragraph>
              We collect information needed to provide scam detection and blocking features.
            </Paragraph>
            <ul>
              <li>
                <strong>Information you provide:</strong> such as your name, email, and phone number (if you choose to
                create an account or contact support).
              </li>
              <li>
                <strong>Technical information:</strong> device and app usage information used for reliability, fraud
                prevention, and security.
              </li>
              <li>
                <strong>SMS and Call Log data (only with your consent):</strong> SMS message content and metadata (e.g.,
                sender/receiver, date/time), call log details (e.g., phone number, call type, date/time), and related
                information needed to detect and block scam calls and scam SMS.
              </li>
            </ul>
            <Paragraph type="secondary" style={{ marginTop: 8 }}>
              We do not store your personal SMS message content or call log details on our servers.
            </Paragraph>
          </>
        ),
      },
      {
        title: "2. Use of Information",
        body: (
          <ul>
            <li>
              <strong>Scam detection and blocking:</strong> identify suspected scam calls and scam SMS.
            </li>
            <li>
              <strong>App operations:</strong> provide core features, fix bugs, and improve performance.
            </li>
            <li>
              <strong>Security:</strong> prevent abuse and protect users and systems.
            </li>
            <li>
              <strong>Support:</strong> respond to your requests and communicate important updates.
            </li>
          </ul>
        ),
      },
      {
        title: "3. Data Security",
        body: (
          <ul>
            <li>We use reasonable safeguards to protect your information.</li>
            <li>No method of storage or transmission is 100% secure.</li>
          </ul>
        ),
      },
      {
        title: "4. Third-party Services",
        body: (
          <ul>
            <li>
              Our website or app may connect to third-party services (for example, hosting, analytics, or login
              providers).
            </li>
            <li>Please review the privacy policies of those third parties when applicable.</li>
          </ul>
        ),
      },
      {
        title: "5. SMS and Call Log Permissions",
        body: (
          <>
            <Paragraph>
              Jachoei requests access to SMS and Call Log permissions only to detect and help block scam phone numbers and
              scam SMS messages. The app is <strong>not</strong> a default SMS or phone handler.
            </Paragraph>

            <Paragraph>
              <strong>Permissions we request and why</strong>
            </Paragraph>
            <ul>
              <li>
                <strong>READ_SMS:</strong> read SMS messages to detect scam patterns and warn you.
              </li>
              <li>
                <strong>RECEIVE_SMS:</strong> detect incoming SMS to provide real-time scam detection and blocking where
                supported.
              </li>
              <li>
                <strong>SEND_SMS:</strong> send SMS only when you take an explicit action (for example, sending a report or
                message you choose).
              </li>
              <li>
                <strong>WRITE_SMS:</strong> update SMS messages on your device only for features you enable (for example,
                organizing or marking messages related to scam blocking). This data stays on your device.
              </li>
              <li>
                <strong>READ_CALL_LOG:</strong> read call history to detect scam calling patterns and support call-blocking
                features.
              </li>
            </ul>

            <Paragraph>
              <strong>How we use this data</strong>
            </Paragraph>
            <ul>
              <li>
                <strong>Only for scam detection and blocking:</strong> we do not use SMS or call log data for any other
                purpose.
              </li>
              <li>
                <strong>Local processing preferred:</strong> SMS and call log data is processed on your device.
              </li>
              <li>
                <strong>No server storage of message content:</strong> we do not store your personal SMS message content or
                call log details on our servers.
              </li>
              <li>
                <strong>No third-party sharing:</strong> we do not share SMS or call log data with third parties.
              </li>
              <li>
                <strong>No ads:</strong> SMS and call log data is not used for advertising or ad targeting.
              </li>
            </ul>

            <Paragraph>
              <strong>User consent and control</strong>
            </Paragraph>
            <ul>
              <li>
                We access SMS and call log data only after you grant the required permissions.
              </li>
              <li>
                You can deny or revoke these permissions at any time in your device settings.
              </li>
              <li>
                If you revoke permissions, scam detection and blocking features that rely on SMS or call logs may not work.
              </li>
            </ul>
          </>
        ),
      },
    ],
    footerNote:
      "By using this website or app, you consent to the collection and use of information in accordance with this Privacy Policy.",
  },
  th: {
    title: "นโยบายความเป็นส่วนตัว",
    intro: (appName) => `นโยบายความเป็นส่วนตัวของ ${appName}`,
    sections: [
      {
        title: "1. ข้อมูลที่เราเก็บรวบรวม",
        body: (
          <>
            <Paragraph>
              เราเก็บข้อมูลเท่าที่จำเป็นเพื่อให้บริการตรวจจับและช่วยบล็อกสาย/ข้อความหลอกลวง
            </Paragraph>
            <ul>
              <li>
                <strong>ข้อมูลที่คุณให้:</strong> เช่น ชื่อ อีเมล และหมายเลขโทรศัพท์ (หากคุณเลือกสมัครบัญชีหรือติดต่อฝ่ายช่วยเหลือ)
              </li>
              <li>
                <strong>ข้อมูลทางเทคนิค:</strong> ข้อมูลอุปกรณ์และการใช้งานแอป เพื่อความเสถียร การป้องกันการใช้งานที่ไม่เหมาะสม และความปลอดภัย
              </li>
              <li>
                <strong>ข้อมูล SMS และบันทึกการโทร (เมื่อได้รับความยินยอมเท่านั้น):</strong> เนื้อความ SMS และข้อมูลประกอบ (เช่น ผู้ส่ง/ผู้รับ วันเวลา),
                รายการบันทึกการโทร (เช่น หมายเลขโทรเข้า/ออก ประเภทสาย วันเวลา) เพื่อช่วยตรวจจับและบล็อกสาย/ข้อความหลอกลวง
              </li>
            </ul>
            <Paragraph type="secondary" style={{ marginTop: 8 }}>
              เราไม่จัดเก็บเนื้อความ SMS ส่วนบุคคลหรือรายละเอียดบันทึกการโทรของคุณไว้บนเซิร์ฟเวอร์ของเรา
            </Paragraph>
          </>
        ),
      },
      {
        title: "2. การใช้ข้อมูล",
        body: (
          <ul>
            <li>
              <strong>ตรวจจับและช่วยบล็อกการหลอกลวง:</strong> ระบุสาย/ข้อความที่น่าสงสัยว่าเป็นมิจฉาชีพ
            </li>
            <li>
              <strong>การให้บริการและปรับปรุงแอป:</strong> พัฒนาประสิทธิภาพ ความเสถียร และแก้ไขข้อผิดพลาด
            </li>
            <li>
              <strong>ความปลอดภัย:</strong> ป้องกันการใช้งานที่ไม่เหมาะสมและรักษาความปลอดภัยของระบบ
            </li>
            <li>
              <strong>การสนับสนุนผู้ใช้:</strong> ตอบคำถามและแจ้งข้อมูลสำคัญเกี่ยวกับบริการ
            </li>
          </ul>
        ),
      },
      {
        title: "3. ความปลอดภัยของข้อมูล",
        body: (
          <ul>
            <li>เราใช้มาตรการด้านความปลอดภัยที่เหมาะสมเพื่อปกป้องข้อมูลของผู้ใช้งาน</li>
            <li>อย่างไรก็ตาม ไม่มีวิธีการจัดเก็บหรือส่งข้อมูลใดปลอดภัย 100%</li>
          </ul>
        ),
      },
      {
        title: "4. บริการของบุคคลที่สาม",
        body: (
          <ul>
            <li>
              เว็บไซต์หรือแอปอาจเชื่อมต่อกับบริการของบุคคลที่สาม (เช่น โฮสติ้ง การวิเคราะห์การใช้งาน หรือผู้ให้บริการล็อกอิน)
            </li>
            <li>บริการเหล่านั้นมีนโยบายความเป็นส่วนตัวของตนเอง กรุณาตรวจสอบนโยบายที่เกี่ยวข้องเมื่อมีการใช้งาน</li>
          </ul>
        ),
      },
      {
        title: "5. สิทธิ์การเข้าถึง SMS และบันทึกการโทร",
        body: (
          <>
            <Paragraph>
              Jachoei ขอสิทธิ์การเข้าถึง SMS และบันทึกการโทรเฉพาะเพื่อการตรวจจับและช่วยบล็อกหมายเลขโทรศัพท์และข้อความ SMS หลอกลวงเท่านั้น
              โดยแอป <strong>ไม่ใช่</strong> แอปเริ่มต้นสำหรับ SMS หรือการโทร
            </Paragraph>

            <Paragraph>
              <strong>สิทธิ์ที่ขอและเหตุผล</strong>
            </Paragraph>
            <ul>
              <li>
                <strong>READ_SMS:</strong> อ่าน SMS เพื่อวิเคราะห์รูปแบบการหลอกลวงและแจ้งเตือนผู้ใช้
              </li>
              <li>
                <strong>RECEIVE_SMS:</strong> ตรวจจับ SMS ที่เข้ามาเพื่อการแจ้งเตือน/บล็อกแบบเรียลไทม์ (เท่าที่ระบบรองรับ)
              </li>
              <li>
                <strong>SEND_SMS:</strong> ส่ง SMS เฉพาะเมื่อคุณกดสั่งงานด้วยตนเอง (เช่น ส่งรายงานหรือข้อความที่คุณเลือก)
              </li>
              <li>
                <strong>WRITE_SMS:</strong> อัปเดต/จัดการข้อความบนอุปกรณ์เฉพาะสำหรับฟีเจอร์ที่คุณเปิดใช้ (เช่น การจัดหมวดหมู่หรือทำเครื่องหมายข้อความที่เกี่ยวข้องกับการบล็อก)
                โดยข้อมูลจะอยู่บนอุปกรณ์ของคุณ
              </li>
              <li>
                <strong>READ_CALL_LOG:</strong> อ่านบันทึกการโทรเพื่อช่วยตรวจจับรูปแบบการโทรหลอกลวงและสนับสนุนฟีเจอร์การบล็อกสาย
              </li>
            </ul>

            <Paragraph>
              <strong>การใช้ข้อมูล</strong>
            </Paragraph>
            <ul>
              <li>
                <strong>ใช้เพื่อการตรวจจับและช่วยบล็อกเท่านั้น:</strong> เราไม่ใช้ข้อมูล SMS หรือบันทึกการโทรเพื่อวัตถุประสงค์อื่น
              </li>
              <li>
                <strong>เน้นประมวลผลบนเครื่อง:</strong> ข้อมูล SMS และบันทึกการโทรจะถูกประมวลผลบนอุปกรณ์ของคุณเป็นหลัก
              </li>
              <li>
                <strong>ไม่จัดเก็บเนื้อความบนเซิร์ฟเวอร์:</strong> เราไม่จัดเก็บเนื้อความ SMS ส่วนบุคคลหรือรายละเอียดบันทึกการโทรของคุณไว้บนเซิร์ฟเวอร์ของเรา
              </li>
              <li>
                <strong>ไม่แชร์กับบุคคลที่สาม:</strong> เราไม่แบ่งปันข้อมูล SMS หรือบันทึกการโทรกับบุคคลที่สาม
              </li>
              <li>
                <strong>ไม่ใช้เพื่อโฆษณา:</strong> ข้อมูล SMS และบันทึกการโทรจะไม่ถูกใช้เพื่อการโฆษณาหรือการกำหนดเป้าหมายโฆษณา
              </li>
            </ul>

            <Paragraph>
              <strong>ความยินยอมและการควบคุมของผู้ใช้</strong>
            </Paragraph>
            <ul>
              <li>แอปจะเข้าถึงข้อมูล SMS และบันทึกการโทรหลังจากคุณอนุญาตสิทธิ์ที่จำเป็นเท่านั้น</li>
              <li>คุณสามารถปฏิเสธหรือยกเลิกสิทธิ์ได้ตลอดเวลาในการตั้งค่าอุปกรณ์</li>
              <li>หากยกเลิกสิทธิ์ ฟีเจอร์การตรวจจับ/บล็อกที่ต้องใช้ SMS หรือบันทึกการโทรอาจทำงานได้ไม่ครบถ้วน</li>
            </ul>
          </>
        ),
      },
    ],
    footerNote:
      "การใช้งานเว็บไซต์หรือแอปนี้ถือว่าคุณยินยอมให้มีการเก็บรวบรวมและใช้ข้อมูลตามนโยบายความเป็นส่วนตัวฉบับนี้",
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
            {typeof s.body === "string" ? <Paragraph>{s.body}</Paragraph> : s.body}
          </div>
        ))}

        <Divider />

        <Paragraph type="secondary">{content.footerNote}</Paragraph>
      </Typography>
    </div>
  );
}
