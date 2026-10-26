import type { Bilingual } from "@/lib/static-page-i18n";
import type { DiagramLabels } from "./sequence";

type Copy = {
  breadcrumb: string;
  print: string; printHint: string; nativeShare: string; shared: string; page: string; continued: string;
  title: string; description: string; metaDescription: string; explore: string; contact: string;
  dashboard: string; signup: string; journey: string[]; groups: string[]; groupLabel: string;
  explorerTitle: string; explorerDescription: string; diagram: string; diagramHint: string;
  zoom: string; fit: string; transcript: string; flowLabel: string; share: string; copied: string;
  copyFailed: string; fitTitle: string; fitDescription: string; fits: string[];
  readinessTitle: string; readiness: string[]; ctaTitle: string; ctaDescription: string;
  scope: string; labels: DiagramLabels;
};
export const restaurantCopy: Bilingual<Copy> = {
  th: {
    breadcrumb: "ร้านอาหารและคาเฟ่",
    print: "พิมพ์ / PDF Flow นี้", printHint: "เลือกบันทึกเป็น PDF ในหน้าต่างพิมพ์ · A4 แนวนอน", nativeShare: "แชร์ Flow นี้", shared: "เปิดการแชร์แล้ว", page: "หน้า", continued: "ต่อจากเงื่อนไข",
    title: "มองเห็นทุกขั้นตอน ก่อนเลือกระบบให้ร้านคุณ",
    description: "จัดการโต๊ะ ออร์เดอร์ ครัว วัตถุดิบ และต้นทุนใน BMS ให้ทีมร้านทำงานต่อกันได้ และเจ้าของตรวจสอบที่มาของตัวเลขได้",
    metaDescription: "สำรวจ 11 Flow ร้านอาหารและคาเฟ่ใน BMS ผ่าน Sequence Diagram ตั้งแต่สูตรอาหาร จัดซื้อ หน้าร้าน ครัว รับเงิน จนถึงต้นทุนและหลายสาขา พร้อมขอบเขตการใช้งาน",
    explore: "สำรวจการทำงานของร้าน", contact: "คุยกับ BMS ทาง LINE", dashboard: "เข้าหลังบ้าน", signup: "เริ่มตั้งค่าร้าน",
    journey: ["เตรียมของ", "รับออร์เดอร์", "ส่งครัว", "รับเงิน", "ดูผลร้าน"],
    groups: ["เตรียมร้านและวัตถุดิบ", "ขายและบริการลูกค้า", "ต้นทุนและการเงิน", "สิทธิ์และความถูกต้อง"],
    groupLabel: "หมวดการทำงาน", explorerTitle: "เลือกงานที่อยากเข้าใจ", explorerDescription: "11 Flow ใน 4 หมวดงาน — ดูว่าใครทำอะไร ระบบช่วยตรงไหน และกรณียกเว้นต้องจัดการอย่างไร",
    diagram: "Sequence Diagram · ขั้นตอนและกรณียกเว้น", diagramHint: "อ่านจากบนลงล่าง เส้นประคือการตอบกลับ เลื่อนซ้าย–ขวาเพื่อดูทุกคอลัมน์ หรือเลือกอ่านเป็นข้อความด้านล่าง",
    zoom: "ขนาด Diagram", fit: "พอดีความกว้าง", transcript: "อ่านขั้นตอนทั้งหมดเป็นข้อความ", flowLabel: "เลือก Flow", share: "คัดลอกลิงก์ Flow นี้", copied: "คัดลอกลิงก์แล้ว", copyFailed: "คัดลอกไม่ได้ กรุณาคัดลอก URL จากแถบที่อยู่",
    fitTitle: "เริ่มจากรูปแบบร้านของคุณ", fitDescription: "เลือกใช้งานตามความจำเป็น แล้วตั้งสูตร สิทธิ์ และขั้นตอนให้ตรงกับทีมก่อนเปิดขายจริง",
    fits: ["ร้านอาหารนั่งทาน", "คาเฟ่และเครื่องดื่ม", "รับเอง / จัดส่ง", "ร้านหลายสาขา"],
    readinessTitle: "รู้ขอบเขตก่อนเริ่มใช้", readiness: [
      "11 Flow เป็นภาพรวมของ BMS ทั้ง POS และเว็บหลังบ้าน ไม่ใช่ทุกขั้นตอนจะมีเมนูอยู่ใน Desktop หรือ Mobile app",
      "ตั้งสูตร วิเคราะห์ต้นทุน จัดการคำขอเติมสินค้า สร้าง PO และกำหนดสิทธิ์ผ่านเว็บหลังบ้าน ส่วนแอป POS ใช้ขาย งานครัว โอนและรับสินค้า ตามสิทธิ์ของพนักงานและสาขา",
      "ร้านที่ใช้โต๊ะ QR และครัวต้องตั้งรูปแบบร้านเป็น Restaurant ก่อนเริ่มมีออร์เดอร์จริง",
      "ต้นทุนจริงต้องมีหลักฐานรับเข้าและมูลค่าสต็อก ข้อมูลที่ขาดแสดงว่าไม่ทราบ ไม่ใช้ศูนย์แทน",
      "สูตรและ SOP เป็นข้อมูลอ้างอิง ยังไม่ใช่ระบบ checklist พนักงานหรือวงจรผลิตครัวกลางครบชุด",
      "foodpanda อยู่ใน sandbox/shadow ส่วน GrabFood และ LINE MAN ยังต้องผ่านข้อตกลงการเชื่อมต่อ",
      "ยังไม่รองรับการขาย Dine-in แบบออฟไลน์ และการเลือกเครื่องพิมพ์แยก Station แบบครบวงจร",
      "ต้องทดลองอุปกรณ์ การชำระเงิน และการส่งมอบของร้านจริงก่อนเปิดใช้งาน ขึ้นกับการตั้งค่าและเวอร์ชันที่ติดตั้ง",
    ],
    ctaTitle: "ร้านของคุณเริ่มจาก Flow ไหน?", ctaDescription: "เล่ารูปแบบร้าน จำนวนสาขา และจุดที่อยากจัดการให้ดีขึ้นกับทีม BMS",
    scope: "ภาพอธิบายความสามารถของระบบ ไม่ใช่ข้อมูลร้านจริงหรือหลักฐานว่ารายการเกิดขึ้นแล้ว · ขอบเขตเนื้อหาตรวจเมื่อ 26 ต.ค. 2569",
    labels: { person: "ผู้ดำเนินงาน", system: "ระบบ", alt: "กรณี", opt: "เมื่อมีเงื่อนไข", loop: "ทำซ้ำ", else: "อีกกรณี" },
  },
  en: {
    breadcrumb: "Restaurants and cafes",
    print: "Print / PDF this flow", printHint: "Choose Save as PDF in the print dialog · A4 landscape", nativeShare: "Share this flow", shared: "Shared", page: "Page", continued: "Continuing condition",
    title: "See every step before choosing a system for your restaurant",
    description: "Connect tables, orders, kitchen work, ingredients and costs in BMS so your team can work together and you can trace the numbers.",
    metaDescription: "Explore 11 BMS restaurant and cafe workflows with sequence diagrams: recipes, purchasing, service, kitchen, payments, costs and multiple branches, with clear operating limits.",
    explore: "Explore the workflows", contact: "Talk to BMS on LINE", dashboard: "Open dashboard", signup: "Set up your store",
    journey: ["Prepare stock", "Take orders", "Send to kitchen", "Take payment", "Review results"],
    groups: ["Setup and ingredients", "Sales and service", "Costs and finance", "Access and reliability"],
    groupLabel: "Workflow categories", explorerTitle: "Choose the work you want to understand", explorerDescription: "11 flows in 4 categories — see who does what, where BMS helps, and how exceptions are handled.",
    diagram: "Sequence diagram · steps and exceptions", diagramHint: "Read from top to bottom. Dashed arrows are replies. Scroll horizontally to see all participants, or use the text transcript below.",
    zoom: "Diagram size", fit: "Fit width", transcript: "Read all steps as text", flowLabel: "Choose a flow", share: "Copy link to this flow", copied: "Link copied", copyFailed: "Could not copy; copy the URL from your address bar",
    fitTitle: "Start with your type of restaurant", fitDescription: "Choose the workflows you need, then configure recipes, permissions and responsibilities before taking real orders.",
    fits: ["Dine-in restaurants", "Cafes and drinks", "Pickup / delivery", "Multiple branches"],
    readinessTitle: "Understand the scope before starting", readiness: [
      "The 11 flows cover both POS and the web back office. Not every step has a screen in the desktop or mobile app.",
      "Use the web back office for recipe setup, cost analysis, requisitions, PO creation and access management. POS apps handle sales, kitchen work, transfers and receiving within staff and branch permissions.",
      "Stores using tables, QR ordering and kitchen workflows must select the Restaurant preset before their first real order.",
      "Actual costs require receipt evidence and inventory valuation. Missing values remain unknown, never silently zero.",
      "Recipes and SOP are reference information, not a staff completion checklist or a complete central-kitchen production ledger.",
      "foodpanda is sandbox/shadow only. GrabFood and LINE MAN remain dependent on integration agreements.",
      "Offline dine-in and a complete station-specific printer selection workflow are not supported.",
      "Rehearse with your actual hardware, payments and handover process before launch. Availability depends on configuration and installed version.",
    ],
    ctaTitle: "Which workflow matters to your restaurant?", ctaDescription: "Tell the BMS team about your store, branch count and the work you want to improve.",
    scope: "These diagrams explain system capabilities. They are not live store data or proof of completed transactions. Content reviewed 26 October 2026.",
    labels: { person: "Person", system: "System", alt: "Case", opt: "When applicable", loop: "Repeat", else: "Alternative" },
  },
};
