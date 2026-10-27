import type { Bilingual } from "@/lib/static-page-i18n";
import type { DiagramLabels } from "./sequence";
import type { PlayerCopy } from "./PlaybackPlayer";

type ProfileCopy = {
  heading: string; description: string; shopLabel: string; serviceLabel: string; multiBranch: string;
  shops: { overview: string };
  services: { dine_in: string; counter: string; online: string };
  recommended: string; related: string; restaurantExample: string; exampleNotice: string;
  selected: string; recommendedHeading: string;
};

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
  profile: ProfileCopy; player: PlayerCopy;
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
    scope: "ภาพอธิบายความสามารถของระบบ ไม่ใช่ข้อมูลร้านจริงหรือหลักฐานว่ารายการเกิดขึ้นแล้ว · ขอบเขตเนื้อหาตรวจเมื่อ 27 ต.ค. 2569",
    labels: { person: "ผู้ดำเนินงาน", system: "ระบบ", alt: "กรณี", opt: "เมื่อมีเงื่อนไข", loop: "ทำซ้ำ", else: "อีกกรณี" },
    profile: {
      heading: "เลือกรูปแบบร้านของคุณ", description: "เลือกเพื่อดูตัวอย่างและลำดับ Flow ที่ใกล้กับงานของร้าน การเลือกนี้ไม่แก้การตั้งค่าร้านจริง",
      shopLabel: "ประเภทร้าน", serviceLabel: "รูปแบบบริการหลัก", multiBranch: "มีหลายสาขา",
      shops: { overview: "ดูภาพรวมทุกแบบ" },
      services: { dine_in: "มีโต๊ะให้นั่ง", counter: "ขายหน้าเคาน์เตอร์ / รับเอง", online: "รับออร์เดอร์ออนไลน์" },
      recommended: "แนะนำ", related: "เกี่ยวข้อง", restaurantExample: "ตัวอย่างร้านอาหาร", selected: "กำลังดู", recommendedHeading: "Flow ที่แนะนำสำหรับรูปแบบนี้",
      exampleNotice: "Flow นี้เป็นตัวอย่างของร้านอาหาร โปรดตรวจเงื่อนไขก่อนใช้กับประเภทร้านที่เลือก",
    },
    player: {
      heading: "เล่นคำอธิบายทีละขั้น", description: "เลือกกรณีที่ต้องการ แล้วกดเล่น ภาพจะเน้นขั้นตอนปัจจุบันพร้อมเสียงบรรยายภาษาไทย",
      recordedNotice: "เสียงไทยสร้างด้วย AI และบันทึกเป็นไฟล์ไว้แล้ว ไม่ต้องติดตั้งเสียงในอุปกรณ์ กดเล่นเพื่อฟังพร้อมภาพ",
      recordedFailedNotice: "เล่นไฟล์เสียงไม่ได้ ตรวจอินเทอร์เน็ตและการอนุญาตเล่นเสียง แล้วกดเปิดเสียงเพื่อลองใหม่ ระหว่างนี้ยังอ่านและเล่นภาพต่อได้",
      condition: "กรณี", optional: "ขั้นตอนเพิ่มเติม", include: "รวมขั้นตอนนี้", play: "▶ เล่น", pause: "หยุดชั่วคราว", previous: "ก่อนหน้า", next: "ถัดไป", restart: "เริ่มใหม่",
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
    scope: "These diagrams explain system capabilities. They are not live store data or proof of completed transactions. Content reviewed 27 October 2026.",
    labels: { person: "Person", system: "System", alt: "Case", opt: "When applicable", loop: "Repeat", else: "Alternative" },
    profile: {
      heading: "Choose how your shop works", description: "Select an example and recommended flows. This does not change your store configuration.",
      shopLabel: "Shop type", serviceLabel: "Main service style", multiBranch: "Multiple branches",
      shops: { overview: "Show all examples" },
      services: { dine_in: "Dine-in tables", counter: "Counter / takeaway", online: "Online orders" },
      recommended: "Recommended", related: "Related", restaurantExample: "Restaurant example", selected: "Viewing", recommendedHeading: "Recommended flows for this setup",
      exampleNotice: "This flow illustrates restaurant operation. Check its conditions before applying it to the selected shop type.",
    },
    player: {
      heading: "Play the guided steps", description: "Choose a case and press Play. The current step is highlighted and spoken using your device voice.",
      recordedNotice: "Thai narration is generated with AI and saved as audio files. No device voice installation is needed. Press Play to hear it with the visual steps.",
      recordedFailedNotice: "The audio file could not play. Check your connection and media permission, then enable sound to retry. Visual steps and captions remain available.",
      condition: "Case", optional: "Optional step", include: "Include this step", play: "▶ Play", pause: "Pause", previous: "Previous", next: "Next", restart: "Restart",
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
