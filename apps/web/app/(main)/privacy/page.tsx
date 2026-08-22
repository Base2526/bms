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
    intro: (appName) =>
      `This Privacy Policy explains how ${appName} ("we", "the Platform") collects, uses, and protects information when you use our business management software — whether as a shop owner running a store on the Platform ("Shop Owner") or as a customer chatting with a shop that uses the Platform ("End Customer").`,
    sections: [
      {
        title: "1. Information We Collect",
        body: (
          <>
            <Paragraph>
              <strong>From Shop Owners (account holders):</strong>
            </Paragraph>
            <ul>
              <li>Account information: name, email, phone number, password (stored as a salted hash, never in plain text).</li>
              <li>Shop information: shop name, staff accounts, roles/permissions, subscription plan.</li>
              <li>
                Channel credentials you connect: access tokens for LINE Official Account, Facebook Page,
                Instagram, and TikTok — used only to send/receive messages on your behalf.
              </li>
              <li>Business data you enter: products, prices, inventory, orders, suppliers, and purchase records.</li>
            </ul>
            <Paragraph>
              <strong>From End Customers (people chatting with a shop):</strong>
            </Paragraph>
            <ul>
              <li>Information shared in conversation: name, phone number, shipping address, and messages sent to the shop.</li>
              <li>Channel identifiers (e.g., LINE user ID, Facebook PSID) needed to route replies back to the correct person.</li>
              <li>Payment slip images you upload, used to verify a payment (processed by AI, see Section 4).</li>
            </ul>
            <Paragraph type="secondary" style={{ marginTop: 8 }}>
              <strong>Important:</strong> for End Customers, the Shop Owner you are chatting with is the data
              controller of your information under applicable law (e.g., Thailand's PDPA). We process this data
              on the Shop Owner's behalf and instructions — see Section 3.
            </Paragraph>
          </>
        ),
      },
      {
        title: "2. How We Use Information",
        body: (
          <ul>
            <li><strong>Operate the service:</strong> run the inbox, product/order/inventory management, and reporting features you use.</li>
            <li><strong>AI-assisted replies:</strong> when a Shop Owner enables AI auto-reply, customer messages are sent to our configured AI provider (for example Anthropic/Claude or DeepSeek) to generate a suggested or automatic response, and to look up product/stock information.</li>
            <li><strong>Payment verification:</strong> uploaded payment slips are analyzed by AI to help confirm amount and reference — this assists the Shop Owner but does not replace their own verification.</li>
            <li><strong>Security and abuse prevention:</strong> detect suspicious activity, enforce rate limits, and keep an audit log of admin actions within each shop.</li>
            <li><strong>Support and communication:</strong> respond to support requests and send service-related notices.</li>
            <li><strong>Improve the Platform:</strong> understand usage patterns and fix issues (using technical/aggregate data, not message content, wherever possible).</li>
          </ul>
        ),
      },
      {
        title: "3. Multi-Tenant Data Isolation",
        body: (
          <ul>
            <li>Each shop's data is logically isolated by tenant and enforced at the database level (row-level security) — one shop cannot query another shop's products, orders, customers, or conversations.</li>
            <li>Platform administrators do not browse shop data directly; inspecting a shop's data requires an explicit, logged "enter tenant" action, and every such action is recorded in an audit trail.</li>
            <li>Shop staff access is controlled by role-based permissions configured by the Shop Owner/Administrator of that shop.</li>
          </ul>
        ),
      },
      {
        title: "4. Third-Party Services We Use",
        body: (
          <ul>
            <li><strong>Messaging channels:</strong> LINE Messaging API, Meta (Facebook/Instagram) Graph API, TikTok — to send and receive messages on behalf of a shop.</li>
            <li><strong>AI providers:</strong> configured large-model and OCR providers such as Anthropic (Claude), DeepSeek, or Alibaba Cloud Model Studio (Qwen OCR) — to generate AI replies and analyze payment slip images, when a Shop Owner enables these features.</li>
            <li><strong>Infrastructure:</strong> our hosting and database providers, used to run and store the Platform's data securely.</li>
            <li>We do not sell personal data to third parties, and we do not use conversation content for advertising.</li>
          </ul>
        ),
      },
      {
        title: "5. Data Retention & Deletion",
        body: (
          <ul>
            <li>We retain shop and customer data for as long as the shop's account is active, or as needed to comply with legal, tax, or accounting obligations.</li>
            <li>Customer records are soft-deleted (marked inactive, not immediately erased) so that order history and accounting records remain consistent; hard deletion can be requested via Support.</li>
            <li>Shop Owners can request export or deletion of their shop's data by contacting Support.</li>
            <li>End Customers who want their data removed should first contact the shop they interacted with; if unresolved, contact us via Support and we will assist.</li>
          </ul>
        ),
      },
      {
        title: "6. Data Security",
        body: (
          <ul>
            <li>Passwords are hashed; channel access tokens and other secrets are stored encrypted at rest.</li>
            <li>Access to production data is restricted to authorized personnel and logged.</li>
            <li>No method of storage or transmission is 100% secure — we apply reasonable, industry-standard safeguards but cannot guarantee absolute security.</li>
          </ul>
        ),
      },
      {
        title: "7. Your Rights",
        body: (
          <ul>
            <li>Depending on your jurisdiction and role (Shop Owner or End Customer), you may have rights to access, correct, export, or delete your personal data, and to object to certain processing.</li>
            <li>To exercise these rights, contact us via the Support page. We will respond within a reasonable timeframe and may need to verify your identity or your relationship to the relevant shop first.</li>
          </ul>
        ),
      },
      {
        title: "8. Changes to This Policy",
        body: (
          <Paragraph>
            We may update this Privacy Policy as the Platform evolves. Material changes will be reflected by
            updating the date below; continued use of the Platform after changes take effect constitutes
            acceptance of the revised policy.
          </Paragraph>
        ),
      },
    ],
    footerNote:
      "By using this Platform, you acknowledge that you have read and understood this Privacy Policy. If you have questions, please contact us via the Support page.",
  },
  th: {
    title: "นโยบายความเป็นส่วนตัว",
    intro: (appName) =>
      `นโยบายความเป็นส่วนตัวนี้อธิบายวิธีที่ ${appName} ("เรา", "แพลตฟอร์ม") เก็บ ใช้ และปกป้องข้อมูล เมื่อคุณใช้งานระบบจัดการธุรกิจของเรา — ไม่ว่าคุณจะเป็นเจ้าของร้านที่เปิดร้านบนแพลตฟอร์ม ("เจ้าของร้าน") หรือลูกค้าที่แชทกับร้านที่ใช้แพลตฟอร์มนี้ ("ลูกค้าปลายทาง")`,
    sections: [
      {
        title: "1. ข้อมูลที่เราเก็บรวบรวม",
        body: (
          <>
            <Paragraph>
              <strong>จากเจ้าของร้าน (ผู้ถือบัญชี):</strong>
            </Paragraph>
            <ul>
              <li>ข้อมูลบัญชี: ชื่อ อีเมล เบอร์โทร รหัสผ่าน (จัดเก็บแบบ hash ที่ผสม salt ไม่เก็บเป็นข้อความปกติ)</li>
              <li>ข้อมูลร้านค้า: ชื่อร้าน บัญชีพนักงาน สิทธิ์การใช้งาน แพ็กเกจที่สมัคร</li>
              <li>
                Token ของช่องทางที่คุณเชื่อมต่อ: LINE Official Account, Facebook Page, Instagram, TikTok —
                ใช้เพื่อส่ง/รับข้อความในนามร้านคุณเท่านั้น
              </li>
              <li>ข้อมูลธุรกิจที่คุณกรอกเข้าระบบ: สินค้า ราคา สต็อก ออเดอร์ ผู้จัดจำหน่าย และรายการจัดซื้อ</li>
            </ul>
            <Paragraph>
              <strong>จากลูกค้าปลายทาง (ผู้ที่แชทกับร้าน):</strong>
            </Paragraph>
            <ul>
              <li>ข้อมูลที่แชร์ในบทสนทนา: ชื่อ เบอร์โทร ที่อยู่จัดส่ง และข้อความที่ส่งถึงร้าน</li>
              <li>รหัสประจำตัวของช่องทาง (เช่น LINE user ID, Facebook PSID) ที่จำเป็นสำหรับส่งคำตอบกลับให้ถูกคน</li>
              <li>รูปสลิปการโอนเงินที่คุณอัปโหลด เพื่อยืนยันการชำระเงิน (ประมวลผลด้วย AI ดูข้อ 4)</li>
            </ul>
            <Paragraph type="secondary" style={{ marginTop: 8 }}>
              <strong>สำคัญ:</strong> สำหรับลูกค้าปลายทาง เจ้าของร้านที่คุณแชทด้วยคือผู้ควบคุมข้อมูล (data controller)
              ของคุณตามกฎหมายที่เกี่ยวข้อง (เช่น PDPA) เราประมวลผลข้อมูลนี้ในนามและตามคำสั่งของเจ้าของร้าน — ดูข้อ 3
            </Paragraph>
          </>
        ),
      },
      {
        title: "2. เราใช้ข้อมูลอย่างไร",
        body: (
          <ul>
            <li><strong>ให้บริการระบบ:</strong> รัน Inbox, จัดการสินค้า/ออเดอร์/สต็อก และรายงานที่คุณใช้งาน</li>
            <li><strong>AI ตอบลูกค้า:</strong> เมื่อเจ้าของร้านเปิดใช้ AI ตอบอัตโนมัติ ข้อความลูกค้าจะถูกส่งไปยังผู้ให้บริการ AI ที่ระบบตั้งค่าไว้ (เช่น Anthropic/Claude หรือ DeepSeek) เพื่อสร้างคำตอบและค้นข้อมูลสินค้า/สต็อก</li>
            <li><strong>ตรวจสอบการชำระเงิน:</strong> สลิปที่อัปโหลดจะถูกวิเคราะห์ด้วย AI เพื่อช่วยยืนยันจำนวนเงินและเลขอ้างอิง — เป็นตัวช่วยเจ้าของร้าน ไม่ได้แทนที่การตรวจสอบของเจ้าของร้านเอง</li>
            <li><strong>ความปลอดภัยและป้องกันการใช้งานผิด:</strong> ตรวจจับความผิดปกติ จำกัดอัตราการเรียกใช้ และบันทึก audit log การกระทำของแอดมินในแต่ละร้าน</li>
            <li><strong>สนับสนุนและติดต่อสื่อสาร:</strong> ตอบคำขอ support และแจ้งข่าวสารที่เกี่ยวกับบริการ</li>
            <li><strong>พัฒนาแพลตฟอร์ม:</strong> ทำความเข้าใจรูปแบบการใช้งานและแก้ไขปัญหา (ใช้ข้อมูลทางเทคนิค/สรุปรวม ไม่ใช่เนื้อหาข้อความ เท่าที่ทำได้)</li>
          </ul>
        ),
      },
      {
        title: "3. การแยกข้อมูลระหว่างร้าน (Multi-Tenant Isolation)",
        body: (
          <ul>
            <li>ข้อมูลของแต่ละร้านถูกแยกกันตาม tenant และบังคับใช้ที่ระดับฐานข้อมูล (Row-Level Security) — ร้านหนึ่งไม่สามารถ query ข้อมูลสินค้า ออเดอร์ ลูกค้า หรือบทสนทนาของร้านอื่นได้</li>
            <li>แอดมินของแพลตฟอร์มไม่ได้เข้าดูข้อมูลร้านโดยตรง — การดูข้อมูลร้านต้องผ่านขั้นตอน "เข้าดูร้าน" ที่ชัดเจนและถูกบันทึกไว้ในทุกครั้ง</li>
            <li>สิทธิ์การเข้าถึงของพนักงานร้านถูกควบคุมด้วยระบบสิทธิ์ (RBAC) ที่เจ้าของร้าน/แอดมินของร้านนั้นกำหนดเอง</li>
          </ul>
        ),
      },
      {
        title: "4. บริการของบุคคลที่สามที่เราใช้",
        body: (
          <ul>
            <li><strong>ช่องทางส่งข้อความ:</strong> LINE Messaging API, Meta (Facebook/Instagram) Graph API, TikTok — เพื่อส่ง/รับข้อความในนามร้าน</li>
            <li><strong>ผู้ให้บริการ AI:</strong> ผู้ให้บริการโมเดลและ OCR ที่ระบบตั้งค่าไว้ เช่น Anthropic (Claude), DeepSeek หรือ Alibaba Cloud Model Studio (Qwen OCR) — สำหรับสร้างคำตอบ AI และวิเคราะห์สลิปการโอนเงิน เมื่อเจ้าของร้านเปิดใช้ฟีเจอร์เหล่านี้</li>
            <li><strong>โครงสร้างพื้นฐาน:</strong> ผู้ให้บริการ hosting และฐานข้อมูลที่เราใช้รันและจัดเก็บข้อมูลของแพลตฟอร์มอย่างปลอดภัย</li>
            <li>เราไม่ขายข้อมูลส่วนบุคคลให้บุคคลที่สาม และไม่ใช้เนื้อหาบทสนทนาเพื่อการโฆษณา</li>
          </ul>
        ),
      },
      {
        title: "5. การเก็บและการลบข้อมูล",
        body: (
          <ul>
            <li>เราเก็บข้อมูลร้านและลูกค้าไว้ตราบใดที่บัญชีร้านยังใช้งานอยู่ หรือตามที่กฎหมาย/ภาษี/บัญชีกำหนด</li>
            <li>ข้อมูลลูกค้าใช้การลบแบบ soft-delete (ทำเครื่องหมายไม่ใช้งาน ไม่ลบทิ้งทันที) เพื่อให้ประวัติออเดอร์และบัญชียังถูกต้อง — ขอลบแบบถาวรได้ผ่านหน้า Support</li>
            <li>เจ้าของร้านขอส่งออกหรือลบข้อมูลร้านของตัวเองได้ผ่านหน้า Support</li>
            <li>ลูกค้าปลายทางที่ต้องการให้ลบข้อมูล ควรติดต่อร้านที่คุยด้วยก่อน หากไม่สำเร็จให้ติดต่อเราผ่าน Support เพื่อขอความช่วยเหลือ</li>
          </ul>
        ),
      },
      {
        title: "6. ความปลอดภัยของข้อมูล",
        body: (
          <ul>
            <li>รหัสผ่านถูก hash ไว้ · token ของช่องทางและข้อมูลลับอื่น ๆ ถูกเข้ารหัสก่อนจัดเก็บ</li>
            <li>การเข้าถึงข้อมูลจริงจำกัดเฉพาะบุคคลที่ได้รับอนุญาตและถูกบันทึกไว้</li>
            <li>ไม่มีวิธีการจัดเก็บหรือส่งข้อมูลใดปลอดภัย 100% — เราใช้มาตรการป้องกันตามมาตรฐานอุตสาหกรรมที่เหมาะสม แต่ไม่สามารถรับประกันความปลอดภัยแบบสมบูรณ์ได้</li>
          </ul>
        ),
      },
      {
        title: "7. สิทธิ์ของคุณ",
        body: (
          <ul>
            <li>ขึ้นอยู่กับเขตอำนาจศาลและบทบาทของคุณ (เจ้าของร้านหรือลูกค้าปลายทาง) คุณอาจมีสิทธิ์เข้าถึง แก้ไข ส่งออก หรือลบข้อมูลส่วนบุคคลของคุณ และคัดค้านการประมวลผลบางประเภท</li>
            <li>ติดต่อเราผ่านหน้า Support เพื่อใช้สิทธิ์เหล่านี้ — เราจะตอบกลับภายในระยะเวลาที่เหมาะสม และอาจต้องยืนยันตัวตนหรือความเกี่ยวข้องกับร้านนั้นก่อน</li>
          </ul>
        ),
      },
      {
        title: "8. การเปลี่ยนแปลงนโยบาย",
        body: (
          <Paragraph>
            เราอาจปรับปรุงนโยบายนี้ตามการพัฒนาของแพลตฟอร์ม การเปลี่ยนแปลงที่สำคัญจะสะท้อนผ่านวันที่อัปเดตด้านล่าง
            การใช้งานแพลตฟอร์มต่อไปหลังการเปลี่ยนแปลงมีผล ถือว่าคุณยอมรับนโยบายฉบับปรับปรุงแล้ว
          </Paragraph>
        ),
      },
    ],
    footerNote:
      "การใช้งานแพลตฟอร์มนี้ถือว่าคุณได้อ่านและเข้าใจนโยบายความเป็นส่วนตัวฉบับนี้แล้ว หากมีข้อสงสัยกรุณาติดต่อเราผ่านหน้า Support",
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
