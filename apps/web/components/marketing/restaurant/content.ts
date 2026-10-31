import type { Bilingual } from "@/lib/static-page-i18n";
import type { DiagramLabels } from "./sequence";
import type { FullscreenCopy } from "./SequenceDiagram";
import type { PlayerCopy } from "./PlaybackPlayer";

type ProfileCopy = {
  heading: string; description: string; shopLabel: string; serviceLabel: string; multiBranch: string; centralKitchen: string; centralKitchenScope: string;
  shops: { overview: string };
  services: { dine_in: string; counter: string; online: string };
  recommended: string; related: string; restaurantExample: string; exampleNotice: string;
  selected: string; recommendedHeading: string;
  primaryHeading: string; additionalHeading: string; additionalDescription: string; showExamples: string;
  scopes: { overview: string; food_beverage: string; board_game_cafe: string; dine_in: string; counter: string; online: string };
};

type Copy = {
  breadcrumb: string;
  print: string; printHint: string; nativeShare: string; shared: string; page: string; continued: string;
  title: string; description: string; metaDescription: string; explore: string; contact: string; learnGuide: string;
  dashboard: string; signup: string; journey: string[]; groups: string[]; groupLabel: string;
  heroSignalTitle: string; heroSignalDescription: string;
  trustPoints: { title: string; description: string }[];
  explorerTitle: string; explorerDescription: string; diagram: string; diagramHint: string;
  zoom: string; fit: string; transcript: string; flowLabel: string; share: string; copied: string;
  copyFailed: string; fitTitle: string; fitDescription: string; fits: string[];
  readinessTitle: string; readiness: string[]; ctaTitle: string; ctaDescription: string;
  scope: string; labels: DiagramLabels;
  fullscreen: FullscreenCopy;
  profile: ProfileCopy; player: PlayerCopy;
};
export const restaurantCopy: Bilingual<Copy> = {
  th: {
    breadcrumb: "ร้านอาหารและคาเฟ่",
    print: "พิมพ์ / PDF Flow นี้", printHint: "เลือกบันทึกเป็น PDF ในหน้าต่างพิมพ์ · A4 แนวนอน", nativeShare: "แชร์ Flow นี้", shared: "เปิดการแชร์แล้ว", page: "หน้า", continued: "ต่อจากเงื่อนไข",
    title: "มองเห็นทุกขั้นตอน ตั้งแต่ครัวกลางจนถึงโต๊ะลูกค้า",
    description: "จัดการครัวกลาง โต๊ะ ออร์เดอร์ ครัว วัตถุดิบ และต้นทุนใน BMS ให้ทุกสาขาทำงานต่อกันได้ ผู้ช่วย AI อธิบายที่มาของตัวเลข ส่วนการตัดสินใจเป็นของคน",
    metaDescription: "สำรวจ 12 Flow ร้านอาหารและคาเฟ่ใน BMS ผ่าน Sequence Diagram ตั้งแต่สูตรอาหาร ครัวกลาง จัดซื้อ หน้าร้าน ครัว รับเงิน จนถึงต้นทุนและหลายสาขา พร้อมจุดที่ผู้ช่วย AI ช่วยและขอบเขตการใช้งาน",
    explore: "สำรวจการทำงานของร้าน", contact: "คุยกับ BMS ทาง LINE", learnGuide: "อ่านคู่มือที่ตรงกับร้านนี้", dashboard: "เข้าหลังบ้าน", signup: "เริ่มตั้งค่าร้าน",
    journey: ["ครัวกลาง", "เตรียมของ", "รับออร์เดอร์", "ส่งครัว", "รับเงิน", "ดูผลร้าน"],
    heroSignalTitle: "ข้อมูลเดียวกันทั้งร้าน",
    heroSignalDescription: "ทุกขั้นตอนเชื่อมต่อกัน ตรวจสอบที่มาของตัวเลขได้",
    trustPoints: [
      { title: "ข้อมูลเดียวกันทั้งร้าน", description: "ทุกแผนกทำงานบนข้อมูลชุดเดียวกัน" },
      { title: "ตรวจสอบที่มาของตัวเลขได้", description: "ดูได้ว่าตัวเลขมาจากขั้นตอนไหน" },
      { title: "AI อธิบาย คนตัดสิน", description: "ผู้ช่วยไม่อนุมัติ ไม่สั่งผลิต และไม่ย้ายสต็อกเอง" },
    ],
    groups: ["ตั้งเมนูและเตรียมวัตถุดิบ", "รับออร์เดอร์และดูแลลูกค้า", "เช็กยอดขาย ต้นทุน และเงิน", "กำหนดสิทธิ์และป้องกันข้อผิดพลาด"],
    groupLabel: "หมวดการทำงาน", explorerTitle: "เลือกงานที่อยากเข้าใจ", explorerDescription: "12 Flow ใน 4 หมวดงาน — ดูว่าใครทำอะไร ระบบและผู้ช่วย AI ช่วยตรงไหน และกรณียกเว้นต้องจัดการอย่างไร",
    diagram: "Sequence Diagram · ขั้นตอนและกรณียกเว้น", diagramHint: "อ่านจากบนลงล่าง เส้นประคือการตอบกลับ เลื่อนซ้าย–ขวาเพื่อดูทุกคอลัมน์ หรือเลือกอ่านเป็นข้อความด้านล่าง",
    zoom: "ขนาด Diagram", fit: "พอดีความกว้าง", transcript: "อ่านขั้นตอนทั้งหมดเป็นข้อความ", flowLabel: "เลือก Flow", share: "คัดลอกลิงก์ Flow นี้", copied: "คัดลอกลิงก์แล้ว", copyFailed: "คัดลอกไม่ได้ กรุณาคัดลอก URL จากแถบที่อยู่",
    fitTitle: "เริ่มจากรูปแบบร้านของคุณ", fitDescription: "เลือกใช้งานตามความจำเป็น แล้วตั้งสูตร สิทธิ์ และขั้นตอนให้ตรงกับทีมก่อนเปิดขายจริง",
    fits: ["ร้านอาหารนั่งทาน", "คาเฟ่และเครื่องดื่ม", "รับเอง / จัดส่ง", "ร้านหลายสาขา", "ร้านที่มีครัวกลาง"],
    readinessTitle: "รู้ขอบเขตก่อนเริ่มใช้", readiness: [
      "12 Flow เป็นภาพรวมของ BMS ทั้ง POS และเว็บหลังบ้าน ไม่ใช่ทุกขั้นตอนจะมีเมนูอยู่ใน Desktop หรือ Mobile app",
      "ตั้งสูตร วิเคราะห์ต้นทุน จัดการคำขอเติมสินค้า สร้าง PO และกำหนดสิทธิ์ผ่านเว็บหลังบ้าน ส่วนแอป POS ใช้ขาย งานครัว โอนและรับสินค้า ตามสิทธิ์ของพนักงานและสาขา",
      "ร้านที่ใช้โต๊ะ QR และครัวต้องตั้งรูปแบบร้านเป็น Restaurant ก่อนเริ่มมีออร์เดอร์จริง",
      "ต้นทุนจริงต้องมีหลักฐานรับเข้าและมูลค่าสต็อก ข้อมูลที่ขาดแสดงว่าไม่ทราบ ไม่ใช้ศูนย์แทน",
      "ครัวกลางคือสาขาหนึ่งในระบบ ผลิตของเตรียมเป็นล็อตพร้อมวันหมดอายุ ต้นทุนคิดจากผลได้จริง ไม่รวมค่าแรง ค่าไฟ และค่าใช้จ่ายร่วม",
      "ผู้ช่วย AI อ่านและอธิบายคำเตือนของใกล้หมดที่ระบบคำนวณ เป็นค่าประมาณ ไม่พยากรณ์ยอดขาย และไม่สั่งซื้อ สั่งผลิต หรือย้ายสต็อกเอง",
      "คำขอของสาขาไม่สร้างงานผลิตอัตโนมัติ และใบโอนยังไม่รองรับสินค้าที่ติดล็อตหรือวันหมดอายุ ของที่ครัวกลางผลิตเป็นล็อตจึงยังส่งผ่านคำขอไม่ได้",
      "สูตรและ SOP เป็นข้อมูลอ้างอิง ทีมร้านยังต้องฝึกและตรวจการปฏิบัติจริง",
      "foodpanda อยู่ใน sandbox/shadow ส่วน GrabFood และ LINE MAN ยังต้องผ่านข้อตกลงการเชื่อมต่อ",
      "ยังไม่รองรับการขาย Dine-in แบบออฟไลน์ และการเลือกเครื่องพิมพ์แยก Station แบบครบวงจร",
      "ต้องทดลองอุปกรณ์ การชำระเงิน และการส่งมอบของร้านจริงก่อนเปิดใช้งาน ขึ้นกับการตั้งค่าและเวอร์ชันที่ติดตั้ง",
    ],
    ctaTitle: "ร้านของคุณเริ่มจาก Flow ไหน?", ctaDescription: "เล่ารูปแบบร้าน จำนวนสาขา และจุดที่อยากจัดการให้ดีขึ้นกับทีม BMS",
    scope: "ภาพอธิบายความสามารถของระบบ ไม่ใช่ข้อมูลร้านจริงหรือหลักฐานว่ารายการเกิดขึ้นแล้ว · ขอบเขตเนื้อหาตรวจเมื่อ 31 ต.ค. 2569",
    fullscreen: { open: "เต็มจอ", close: "ปิดเต็มจอ", rotateHint: "หมุนจอเป็นแนวนอนเพื่อดูทุกคอลัมน์ หรือเลื่อนซ้าย–ขวา", dismiss: "เข้าใจแล้ว" },
    labels: { person: "ผู้ดำเนินงาน", system: "ระบบ", assistant: "อ่านอย่างเดียว", alt: "กรณี", opt: "เมื่อมีเงื่อนไข", loop: "ทำซ้ำ", else: "อีกกรณี" },
    profile: {
      heading: "เลือกรูปแบบร้านของคุณ", description: "เลือกเพื่อดูตัวอย่างและลำดับ Flow ที่ใกล้กับงานของร้าน การเลือกนี้ไม่แก้การตั้งค่าร้านจริง",
      shopLabel: "ประเภทร้าน", serviceLabel: "รูปแบบบริการหลัก", multiBranch: "มีหลายสาขา", centralKitchen: "มีครัวกลาง",
      centralKitchenScope: "มีครัวกลาง: เริ่มที่ Flow 12 ครัวกลางผลิตและส่งของให้สาขา ต่อด้วย Flow 2 การขอเติมของ และ Flow 8 การสั่งซื้อวัตถุดิบ",
      primaryHeading: "กลุ่มหลัก · ร้านอาหารและคาเฟ่",
      additionalHeading: "รูปแบบร้านเพิ่มเติมที่ BMS รองรับ",
      additionalDescription: "บอร์ดเกมคาเฟ่มีขั้นตอนเฉพาะสำหรับเวลาเล่นและกลุ่มชำระเงิน เลือกเพื่อดูตัวอย่างของรูปแบบนี้",
      showExamples: "แสดงตัวอย่างร้านอาหารหรือบริการรูปแบบอื่นเพิ่มเติม",
      scopes: {
        overview: "ภาพรวมกลุ่มหลัก: ร้านอาหารและคาเฟ่ เลือกรูปแบบร้านเพื่อดู Flow ที่เกี่ยวข้องและเงื่อนไขก่อนใช้งาน",
        dine_in: "ร้านอาหารนั่งทาน: ใช้โต๊ะ บิล รอบส่งครัว และ QR ที่พนักงานตรวจรับ ตั้งค่าสาขา เมนูและสิทธิ์ก่อนใช้งาน",
        counter: "ร้านอาหารหน้าเคาน์เตอร์: ตัวอย่างใช้บิล Takeaway และงานครัว โดยไม่มีโต๊ะหรือ QR โต๊ะ งานย้าย/แยก/รวมโต๊ะเป็นตัวอย่างบริการอีกแบบ",
        online: "ร้านอาหารออนไลน์: เริ่มที่ Flow 7 เลือกสาขาและรับเองหรือจัดส่ง พนักงานรับออร์เดอร์เข้าครัวแยกจากการยืนยันชำระเงิน",
        food_beverage: "คาเฟ่และเครื่องดื่ม: ใช้ตัวอย่างขายหน้าเคาน์เตอร์ สูตรและตัวเลือกขึ้นกับสินค้าที่ตั้งไว้ งานโต๊ะ/QR/ครัวและออร์เดอร์ออนไลน์เฉพาะร้านอาหารแยกเป็นตัวอย่างเพิ่มเติม",
        board_game_cafe: "รูปแบบเพิ่มเติม: Flow 3 อธิบายเวลาเล่น กลุ่มชำระเงินและสินค้าบนบิล ส่วน Flow 8, 10, 11 เป็นงานซื้อสินค้าขาย กะเงิน/ภาษี และสิทธิ์การโอนสต็อกที่ใช้ร่วมกัน เกมให้ยืมเล่นแยกจากสินค้าขาย คู่มือนี้ยังไม่ครอบคลุมทุกงานบอร์ดเกม",
      },
      shops: { overview: "ภาพรวมกลุ่มหลัก" },
      services: { dine_in: "มีโต๊ะให้นั่ง", counter: "ขายหน้าเคาน์เตอร์ / รับเอง", online: "รับออร์เดอร์ออนไลน์" },
      recommended: "แนะนำ", related: "เกี่ยวข้อง", restaurantExample: "ตัวอย่างบริการรูปแบบอื่น", selected: "กำลังดู", recommendedHeading: "Flow ที่แนะนำสำหรับรูปแบบนี้",
      exampleNotice: "กำลังดูตัวอย่างร้านอาหารหรือบริการอีกแบบ เพื่อศึกษาเพิ่มเติม ขั้นตอนนี้อาจไม่ตรงกับรูปแบบร้านที่เลือก และไม่ได้ยืนยันว่าร้านเปิดใช้ความสามารถนี้แล้ว",
    },
    player: {
      heading: "เล่นคำอธิบายทีละขั้น", description: "เลือกกรณีที่ต้องการ แล้วกดเล่น ภาพจะเน้นขั้นตอนปัจจุบันพร้อมเสียงบรรยายภาษาไทย",
      recordedNotice: "เสียงไทยสร้างด้วย AI และบันทึกเป็นไฟล์ไว้แล้ว ไม่ต้องติดตั้งเสียงในอุปกรณ์ กดเล่นเพื่อฟังพร้อมภาพ",
      recordedFailedNotice: "เล่นไฟล์เสียงไม่ได้ ตรวจอินเทอร์เน็ตและการอนุญาตเล่นเสียง แล้วกดเปิดเสียงเพื่อลองใหม่ ระหว่างนี้ยังอ่านและเล่นภาพต่อได้",
      condition: "กรณี", optional: "ขั้นตอนเพิ่มเติม", include: "รวมขั้นตอนนี้", play: "▶ เล่น", pause: "หยุดชั่วคราว", previous: "ก่อนหน้า", next: "ถัดไป", restart: "เริ่มใหม่", download: "ดาวน์โหลดเสียงสรุป (MP3)",
      sound: "เปิดเสียง", speed: "ความเร็ว", step: "ขั้น", of: "/", voiceNotice: "เสียงอ่านใช้เสียงสังเคราะห์ของเบราว์เซอร์ คุณภาพและภาษาเสียงขึ้นกับอุปกรณ์; ข้อความทุกขั้นอ่านได้บนหน้าจอ",
      silentNotice: "เบราว์เซอร์นี้ไม่รองรับเสียงอ่าน ลองเปิดลิงก์ใน Chrome, Edge หรือ Safari รุ่นล่าสุด ระบบยังเล่นภาพและข้อความได้",
      unlistedVoiceNotice: "ยังไม่พบเสียงภาษาที่เลือกในรายการของเบราว์เซอร์ กดเล่นเพื่อให้เบราว์เซอร์ลองเลือกเสียงให้อัตโนมัติ หากใช้ไม่ได้จะแสดงวิธีแก้",
      failedNotice: "เสียงอ่านไม่ทำงาน จึงเล่นต่อด้วยภาพและข้อความ กดเปิดเสียงเพื่อลองใหม่",
      failureHints: {
        voice: "ระบบเสียงแจ้งว่าไม่มีเสียงภาษานี้ ลองเปิดลิงก์ในเบราว์เซอร์อื่น หรือติดตั้งเสียงอ่านภาษาที่เลือกในการตั้งค่าอุปกรณ์แล้วเปิดเบราว์เซอร์ใหม่",
        blocked: "เบราว์เซอร์ไม่อนุญาตให้เล่นเสียง ให้ตรวจสิทธิ์เสียงของเว็บไซต์ แล้วหยุดและกดเล่นอีกครั้ง หากเปิดผ่านแอปให้ลองเปิดในเบราว์เซอร์ภายนอก",
        network: "บริการเสียงเชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่",
        audio: "ระบบใช้ลำโพงไม่ได้ ตรวจอุปกรณ์เสียงและแอปอื่นที่กำลังใช้งานเสียง แล้วลองใหม่",
        timeout: "ระบบเสียงไม่ตอบกลับ ลองเปิดลิงก์ในเบราว์เซอร์ภายนอกหรือตรวจเสียงอ่านของอุปกรณ์ แล้วลองใหม่",
      },
      repeatOnce: "ตัวอย่างการทำงานหนึ่งรอบ", resumeNotice: "เมื่อหยุดชั่วคราวแล้วเล่นต่อ จะเริ่มอ่านขั้นปัจจุบันใหม่",
    },
  },
  en: {
    breadcrumb: "Restaurants and cafes",
    print: "Print / PDF this flow", printHint: "Choose Save as PDF in the print dialog · A4 landscape", nativeShare: "Share this flow", shared: "Shared", page: "Page", continued: "Continuing condition",
    title: "See every step, from the central kitchen to the customer's table",
    description: "Connect your central kitchen, tables, orders, kitchen work, ingredients and costs in BMS so every branch works together. The AI assistant explains where the numbers come from; people make the decisions.",
    metaDescription: "Explore 12 BMS restaurant and cafe workflows with sequence diagrams: recipes, central kitchen, purchasing, service, kitchen, payments, costs and multiple branches, with where the AI assistant helps and clear operating limits.",
    explore: "Explore the workflows", contact: "Talk to BMS on LINE", learnGuide: "Read the guide for this format", dashboard: "Open dashboard", signup: "Set up your store",
    journey: ["Central kitchen", "Prepare stock", "Take orders", "Send to kitchen", "Take payment", "Review results"],
    heroSignalTitle: "One source of truth for the whole restaurant",
    heroSignalDescription: "Every step stays connected, so you can trace where each number came from.",
    trustPoints: [
      { title: "One source of truth", description: "Every team works from the same operational data." },
      { title: "Trace every number", description: "See which step produced each result." },
      { title: "AI explains, people decide", description: "The assistant never approves, produces or moves stock on its own." },
    ],
    groups: ["Set up menus and stock", "Take orders and serve customers", "Review sales, costs and cash", "Control access and prevent mistakes"],
    groupLabel: "Workflow categories", explorerTitle: "Choose the work you want to understand", explorerDescription: "12 flows in 4 categories — see who does what, where BMS and the AI assistant help, and how exceptions are handled.",
    diagram: "Sequence diagram · steps and exceptions", diagramHint: "Read from top to bottom. Dashed arrows are replies. Scroll horizontally to see all participants, or use the text transcript below.",
    zoom: "Diagram size", fit: "Fit width", transcript: "Read all steps as text", flowLabel: "Choose a flow", share: "Copy link to this flow", copied: "Link copied", copyFailed: "Could not copy; copy the URL from your address bar",
    fitTitle: "Start with your type of restaurant", fitDescription: "Choose the workflows you need, then configure recipes, permissions and responsibilities before taking real orders.",
    fits: ["Dine-in restaurants", "Cafes and drinks", "Pickup / delivery", "Multiple branches", "Central kitchens"],
    readinessTitle: "Understand the scope before starting", readiness: [
      "The 12 flows cover both POS and the web back office. Not every step has a screen in the desktop or mobile app.",
      "Use the web back office for recipe setup, cost analysis, requisitions, PO creation and access management. POS apps handle sales, kitchen work, transfers and receiving within staff and branch permissions.",
      "Stores using tables, QR ordering and kitchen workflows must select the Restaurant preset before their first real order.",
      "Actual costs require receipt evidence and inventory valuation. Missing values remain unknown, never silently zero.",
      "A central kitchen is one branch in BMS. It produces prepared goods as lots with expiry dates; batch cost uses actual yield and excludes labour, energy and shared expenses.",
      "The AI assistant reads and explains the low-stock warnings BMS calculates. They are estimates: it does not forecast sales, and it never orders, produces or moves stock on its own.",
      "Branch requests do not create production automatically, and transfers do not yet support lot- or expiry-tracked products, so goods the central kitchen produces as lots cannot yet be sent through a requisition.",
      "Recipes and SOP are reference information; your team still needs training and on-the-floor checks.",
      "foodpanda is sandbox/shadow only. GrabFood and LINE MAN remain dependent on integration agreements.",
      "Offline dine-in and a complete station-specific printer selection workflow are not supported.",
      "Rehearse with your actual hardware, payments and handover process before launch. Availability depends on configuration and installed version.",
    ],
    ctaTitle: "Which workflow matters to your restaurant?", ctaDescription: "Tell the BMS team about your store, branch count and the work you want to improve.",
    scope: "These diagrams explain system capabilities. They are not live store data or proof of completed transactions. Content reviewed 31 October 2026.",
    fullscreen: { open: "Full screen", close: "Exit full screen", rotateHint: "Rotate to landscape to see every column, or scroll sideways.", dismiss: "Got it" },
    labels: { person: "Person", system: "System", assistant: "Read-only", alt: "Case", opt: "When applicable", loop: "Repeat", else: "Alternative" },
    profile: {
      heading: "Choose how your shop works", description: "Select an example and recommended flows. This does not change your store configuration.",
      shopLabel: "Shop type", serviceLabel: "Main service style", multiBranch: "Multiple branches", centralKitchen: "Central kitchen",
      centralKitchenScope: "Central kitchen: start with Flow 12, where the central kitchen produces and supplies branches, then Flow 2 for requisitions and Flow 8 for ingredient purchasing.",
      primaryHeading: "Main group · Restaurants and cafes",
      additionalHeading: "Additional shop formats supported by BMS",
      additionalDescription: "Board game cafes have dedicated play-time and billing-group workflows. Select this format to explore its example.",
      showExamples: "Show additional restaurant or service examples",
      scopes: {
        overview: "Main guide: restaurants and cafes. Select a shop format to see relevant flows and setup requirements.",
        dine_in: "Dine-in restaurant: tables, checks, kitchen rounds and staff-reviewed QR requests. Configure branches, menus and permissions before use.",
        counter: "Counter restaurant: the example uses takeaway checks and kitchen work without tables or table QR. Table moves, splits and merges illustrate another service style.",
        online: "Online restaurant: start with Flow 7, choosing a branch and pickup or delivery. Staff acceptance into the kitchen is separate from payment confirmation.",
        food_beverage: "Cafe and drinks: counter POS examples; recipes and options depend on configured products. Restaurant tables, QR, kitchen and restaurant-only online ordering are separate reference examples.",
        board_game_cafe: "Additional format: Flow 3 covers play time, billing groups and goods on the tab. Flows 8, 10 and 11 cover shared retail purchasing, shifts/tax and stock-transfer authorization. Play-library games are separate from retail stock. This guide does not cover every board game workflow.",
      },
      shops: { overview: "Main group overview" },
      services: { dine_in: "Dine-in tables", counter: "Counter / takeaway", online: "Online orders" },
      recommended: "Recommended", related: "Related", restaurantExample: "Other service example", selected: "Viewing", recommendedHeading: "Recommended flows for this setup",
      exampleNotice: "This is a restaurant or other service example for reference. Its steps may differ from the selected shop format and do not confirm that these capabilities are enabled for your store.",
    },
    player: {
      heading: "Play the guided steps", description: "Choose a case and press Play. The current step is highlighted and spoken using your device voice.",
      recordedNotice: "Thai narration is generated with AI and saved as audio files. No device voice installation is needed. Press Play to hear it with the visual steps.",
      recordedFailedNotice: "The audio file could not play. Check your connection and media permission, then enable sound to retry. Visual steps and captions remain available.",
      condition: "Case", optional: "Optional step", include: "Include this step", play: "▶ Play", pause: "Pause", previous: "Previous", next: "Next", restart: "Restart", download: "Download summary audio (MP3)",
      sound: "Sound on", speed: "Speed", step: "Step", of: "of", voiceNotice: "Narration uses your browser's synthetic voice; voice language and quality depend on the device. Every step also has on-screen text.",
      silentNotice: "This browser does not support narration. Try opening the link in a recent Chrome, Edge or Safari. Visual steps and captions remain available.",
      unlistedVoiceNotice: "The browser has not listed a voice for this language. Press Play to let it try automatic voice selection. If speech fails, recovery instructions will appear.",
      failedNotice: "Narration failed. Visual steps and captions continue. Enable sound to retry.",
      failureHints: {
        voice: "The speech engine reports no voice for this language. Try another browser, or install a voice for the selected language in your device settings and restart the browser.",
        blocked: "The browser blocked speech. Check this site's sound permission, then pause and press Play again. In an embedded browser, try opening the link in an external browser.",
        network: "The voice service could not connect. Check your internet connection and retry.",
        audio: "Audio output is unavailable. Check the output device and other apps using audio, then retry.",
        timeout: "The speech engine did not respond. Try an external browser or check your device's speech voices, then retry.",
      },
      repeatOnce: "One example iteration", resumeNotice: "Resuming after a pause restarts the current step.",
    },
  },
};
