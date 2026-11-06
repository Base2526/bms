import { searchBmsPresalesKnowledge, type PresalesKnowledgeEntry, type PresalesLocale } from "./platformPresales";

export type PublicFeatureResult =
  | { kind: "answer"; entry: PresalesKnowledgeEntry }
  | { kind: "price" }
  | { kind: "localPrice" }
  | { kind: "partial"; title: string }
  | { kind: "unknown" };

// Short storefront copy is reviewed separately from the longer LINE presales answers.
// Keep limits in the visible sentence when the feature is conditional or in pilot.
const SALES_LEADS: Partial<Record<string, Record<PresalesLocale, string>>> = {
  "ai-inbox": {
    th: "ได้ เมื่อเชื่อมช่องทางและตั้งค่าสินค้าแล้ว AI ช่วยรับรายการ ตรวจข้อมูลจริง และสร้างออร์เดอร์หลังลูกค้ายืนยัน",
    en: "Yes, after connecting a channel and configuring products. AI can take requests, check live facts and create orders after customer confirmation.",
  },
  "purchasing-transfers": {
    th: "มีงานจัดซื้อ รับสินค้า และโอนสต็อกแบบส่งจากต้นทางแล้วรับที่ปลายทาง ต้องตั้งค่าสาขาและสิทธิ์ก่อนใช้",
    en: "BMS supports purchasing, receiving and branch stock transfers through send and receive steps. Branches and permissions must be configured first.",
  },
  "restaurant-operations": {
    th: "มีงานโต๊ะ คิวครัว สูตรวัตถุดิบ และ QR ส่งคำขอสั่งอาหาร โดยคำขอ QR ยังต้องผ่านขั้นตอนรับงานของร้าน",
    en: "BMS supports tables, kitchen queues, recipes and table QR order requests. QR requests still follow the restaurant's acceptance workflow.",
  },
  "readiness-status": {
    th: "งานหลักมีแล้ว แต่บางช่องทาง อุปกรณ์ และการเชื่อมต่อยังต้องตรวจความพร้อมก่อนเปิดใช้จริงกับร้านของคุณ",
    en: "Core workflows are built, but some channels, devices and integrations still need readiness checks for your shop.",
  },
  pharmacy: {
    th: "รองรับงานร้านยาบางส่วน แต่ AI ไม่ตัดสินใจทางคลินิก เภสัชกรที่มีใบอนุญาตต้องอนุมัติ และ AI Pharmacy Intake ยังปิดเป็นค่าเริ่มต้น",
    en: "Some pharmacy workflows are supported. AI makes no clinical decision; a licensed pharmacist must approve, and AI Pharmacy Intake is off by default.",
  },
  channels: {
    th: "เชื่อมแชทได้หลายช่องทาง แต่การตอบกลับจริงขึ้นกับช่องทางที่ตั้งค่า TikTok ยังส่งกลับผ่าน API ไม่ได้ และ Shopee/Lazada ยังเป็น beta",
    en: "Several chat channels can connect, but outbound support depends on setup. TikTok outbound is not connected, and Shopee/Lazada remain beta.",
  },
  "delivery-integrations": {
    th: "ยังไม่พร้อมเปิดใช้จริงทั่วไป GrabFood/LINE MAN ติดข้อกำหนดสัญญาหรือ API, foodpanda ยังอยู่ใน sandbox/shadow และ Flash/Kerry ยังไม่ผ่านการทดสอบกับบัญชีจริง",
    en: "Not ready for general live use. GrabFood/LINE MAN remain contract or API constrained, foodpanda is in sandbox/shadow, and Flash/Kerry lack live merchant-account verification.",
  },
  deployment: {
    th: "BMS ใช้ Cloud เป็นหลัก มือถือมีคิวขายเงินสดพื้นฐานเมื่อเน็ตล่ม ส่วน Retail Local ยังเป็นรุ่นนำร่องทางเทคนิค",
    en: "BMS primarily runs in the cloud. Mobile can queue basic retail cash sales during an outage; Retail Local remains a technical pilot.",
  },
  tax: {
    th: "มีใบกำกับภาษีในระบบ แต่ยังไม่ใช่ e-Tax ที่ลงนามและส่งกรมสรรพากรผ่านผู้ให้บริการจริง",
    en: "BMS has tax documents, but it does not yet provide production e-Tax signing and Revenue Department submission through a live provider.",
  },
  hardware: {
    th: "มี Web POS, Mobile POS และ Desktop shell แต่ยังไม่รับรองเครื่องพิมพ์หรือลิ้นชักทุกรุ่น ควรตรวจรุ่นอุปกรณ์ก่อนใช้งาน",
    en: "Web POS, Mobile POS and a Desktop shell exist, but not every printer or cash drawer is certified. Check your device model before rollout.",
  },
  "image-inquiry": {
    th: "รับรูปสินค้าเข้าแชทให้พนักงานดูได้ แต่ยังไม่รับรองว่า AI ระบุสินค้าและรุ่นจากรูปให้อัตโนมัติ",
    en: "Staff can review product photos in chat, but automatic AI identification of the product and model from an image is not established.",
  },
};

export function publicFeatureLead(entry: PresalesKnowledgeEntry, locale: PresalesLocale): string {
  const approved = SALES_LEADS[entry.id]?.[locale];
  if (approved) return approved;
  const full = entry.answer[locale];
  if (entry.availability === "LIMITED" || entry.availability === "PILOT") return full;
  return full.match(/^.*?(?:ค่ะ|ครับ|\.)(?=\s|$)/)?.[0] ?? full;
}

function verifiedMatch(query: string, locale: PresalesLocale) {
  const match = searchBmsPresalesKnowledge(query, locale, 1)[0];
  return match && match.score >= 30 ? match : undefined;
}

/** Search is a public read of approved copy, not an AI verdict on arbitrary combined claims. */
export function searchPublicFeature(query: string, locale: PresalesLocale): PublicFeatureResult {
  const normalized = query.normalize("NFKC").trim().slice(0, 200);
  if (!normalized) return { kind: "unknown" };
  if (/^(?:ราคา(?:\s*bms)?(?:\s*เท่า(?:ไร|ไหร่))?|(?:how much|price|pricing|cost)(?:\s+(?:is|of|for))?\s*bms)[?？\s]*$/i.test(normalized)) return { kind: "price" };
  if (/\b(?:free|pro|growth|business|enterprise)\b/i.test(normalized) && /(?:ราคา|เท่า(?:ไร|ไหร่)|price|how much|cost)/i.test(normalized)) return { kind: "price" };

  // An answer about one feature must not be presented as an answer to a second, unmatched request.
  const parts = normalized.split(/\s*(?:และ|แล้ว|พร้อม(?:กับ)?|รวมถึง|\band\b|\bplus\b)\s*/i).filter(Boolean);
  if (parts.length > 1) {
    const matches = parts.map(part => verifiedMatch(part, locale));
    const first = matches[0];
    if (!first || matches.some(match => !match || match.id !== first.id)) {
      const found = matches.find(Boolean);
      return found ? { kind: "partial", title: found.title[locale] } : { kind: "unknown" };
    }
  }

  // Generic AI Inbox copy cannot verify whether an individual marketplace sends replies today.
  const marketplace = normalized.match(/\b(?:shopee|lazada|tiktok)\b/i)?.[0];
  if (marketplace) {
    const channel = verifiedMatch(marketplace, locale);
    if (channel?.id === "channels") return { kind: "answer", entry: channel };
  }

  const match = verifiedMatch(normalized, locale);
  if (!match) return { kind: "unknown" };
  if (match.id === "retail-local-pricing") return { kind: "localPrice" };
  if (match.requiresPlans) return { kind: "price" };
  return { kind: "answer", entry: match };
}
