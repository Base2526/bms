import { listPlans, type Plan } from "./entitlements";

export type PresalesLocale = "th" | "en";
export type PresalesAvailability =
  | "AVAILABLE"
  | "REQUIRES_SETUP"
  | "LIMITED"
  | "PILOT"
  | "NOT_AVAILABLE";

export type PresalesKnowledgeEntry = Readonly<{
  id: string;
  title: Readonly<Record<PresalesLocale, string>>;
  aliases: Readonly<Record<PresalesLocale, readonly string[]>>;
  answer: Readonly<Record<PresalesLocale, string>>;
  availability: PresalesAvailability;
  nextQuestion?: Readonly<Record<PresalesLocale, string>>;
}>;

const both = (th: string, en: string) => ({ th, en }) as const;
const aliases = (th: readonly string[], en: readonly string[]) => ({ th, en }) as const;

/**
 * Public, sales-safe product facts. This is deliberately separate from assistantKnowledge:
 * that catalog contains staff permissions, admin routes and operational details that must not be
 * exposed to prospects. Keep claims aligned with docs/business/product-overview-th.md.
 */
export const BMS_PRESALES_KNOWLEDGE: readonly PresalesKnowledgeEntry[] = [
  {
    id: "overview",
    title: both("BMS คืออะไร", "What is BMS?"),
    aliases: aliases(
      ["bms คือ", "bms ทำอะไร", "ระบบ bms", "แนะนำ bms", "คืออะไร", "ทำอะไรได้บ้าง"],
      ["what is bms", "what does bms do", "tell me about bms", "bms system"]
    ),
    answer: both(
      "BMS คือระบบบริหารธุรกิจที่เชื่อมแชทลูกค้า CRM ออร์เดอร์ POS สต็อก การชำระเงิน การจัดส่ง ภาษี และรายงานไว้บนข้อมูลชุดเดียว AI ช่วยเข้าใจคำถามและเรียกใช้เครื่องมือที่ได้รับอนุญาต แต่ราคา สต็อก ยอดเงิน และสถานะสำคัญยังยืนยันจากระบบจริงค่ะ",
      "BMS is a business operating system connecting customer chat, CRM, orders, POS, inventory, payments, shipping, tax and reporting on one data set. AI helps interpret requests and use approved tools, while prices, stock, money and important statuses remain verified by the backend."
    ),
    availability: "AVAILABLE",
    nextQuestion: both("กำลังมองหาระบบสำหรับธุรกิจประเภทไหนคะ?", "What type of business are you looking to run?")
  },
  {
    id: "business-types",
    title: both("ประเภทธุรกิจที่รองรับ", "Supported business types"),
    aliases: aliases(
      ["สร้างร้านอะไรได้บ้าง", "เปิดร้านอะไรได้บ้าง", "รองรับร้านอะไร", "ประเภทร้าน", "ธุรกิจอะไรใช้ได้", "เหมาะกับร้านอะไร"],
      ["what shops can i create", "supported business types", "what businesses are supported", "what store can i run"]
    ),
    answer: both(
      "BMS รองรับร้านค้าปลีกและค้าส่ง มินิมาร์ท แฟชั่น ของใช้ในบ้าน ความงาม อาหารและเครื่องดื่ม แก็ดเจ็ต ของขวัญ สินค้าสัตว์เลี้ยง วัสดุก่อสร้าง ร้านอาหาร ร้านบอร์ดเกม และร้านขายยาค่ะ แต่ละประเภทเปิด workflow และรูปแบบสต็อกที่เหมาะกับธุรกิจนั้นได้",
      "BMS supports retail and wholesale, mini marts, fashion, home goods, beauty, food and beverage, gadgets, gifts, pet supplies, building materials, restaurants, board-game cafes and pharmacies. Each type can enable workflows and stock models suited to that business."
    ),
    availability: "AVAILABLE",
    nextQuestion: both("สนใจร้านประเภทไหนคะ จะได้แนะนำฟีเจอร์ที่เกี่ยวข้องให้ตรงจุด", "Which type are you interested in so I can suggest the relevant features?")
  },
  {
    id: "ai-inbox",
    title: both("AI Inbox และ CRM", "AI Inbox and CRM"),
    aliases: aliases(
      ["ai ตอบลูกค้า", "ตอบแชท", "รวมแชท", "line oa", "crm", "จำลูกค้า", "รับออร์เดอร์จากแชท"],
      ["ai replies", "chat inbox", "line oa", "crm", "remember customers", "orders from chat"]
    ),
    answer: both(
      "AI Inbox รวมบทสนทนาที่เชื่อมต่อไว้ใน Inbox เดียว ช่วยค้นสินค้า ตรวจราคาและสต็อกจากข้อมูลจริง รับรายการหลายสินค้า และพาไปสู่การสร้างออร์เดอร์หลังลูกค้ายืนยันค่ะ ประวัติลูกค้า ออร์เดอร์ ที่อยู่ คูปองและแต้มเชื่อมกับ Customer 360 โดยงานเสี่ยงยังต้องให้พนักงานยืนยัน",
      "AI Inbox brings connected conversations into one inbox, checks products, prices and stock from verified data, handles multi-item requests and proceeds to an order only after customer confirmation. Customer history, orders, addresses, coupons and points connect to Customer 360, while sensitive actions still require staff confirmation."
    ),
    availability: "REQUIRES_SETUP",
    nextQuestion: both("ตอนนี้ใช้ช่องทางแชทอะไรรับลูกค้าอยู่คะ?", "Which chat channels do you currently use with customers?")
  },
  {
    id: "retail-wholesale",
    title: both("ร้านค้าปลีกและค้าส่ง", "Retail and wholesale"),
    aliases: aliases(
      ["ร้านค้าปลีก", "ร้านค้าส่ง", "ราคาส่ง", "บาร์โค้ด", "serial", "imei", "ขายเชื่อ", "มินิมาร์ท"],
      ["retail", "wholesale", "barcode", "serial", "imei", "credit sales", "mini mart"]
    ),
    answer: both(
      "ร้านค้าปลีกและค้าส่งใช้ POS สแกนบาร์โค้ด สินค้าหลายไซซ์/สี/หน่วยขาย ราคาปลีกและราคาส่ง สต็อกตามสาขา Serial/IMEI โปรโมชั่น มัดจำ ขายเชื่อ และรายงานได้ค่ะ ความสามารถที่ใช้จริงขึ้นกับรูปแบบร้านและการตั้งค่าสินค้า",
      "Retail and wholesale shops can use POS barcode scanning, variants and packs, retail and wholesale pricing, branch inventory, serial/IMEI tracking, promotions, deposits, credit sales and reports. Exact behavior depends on the shop and product configuration."
    ),
    availability: "REQUIRES_SETUP"
  },
  {
    id: "restaurant",
    title: both("ร้านอาหารและคาเฟ่", "Restaurants and cafes"),
    aliases: aliases(
      ["ร้านอาหาร", "คาเฟ่", "ระบบโต๊ะ", "แยกบิล", "คิวครัว", "modifier", "สูตรวัตถุดิบ"],
      ["restaurant", "cafe", "tables", "split bill", "kitchen queue", "modifiers", "recipes"]
    ),
    answer: both(
      "ร้านอาหารและคาเฟ่รองรับ POS โต๊ะและโซน การย้าย/รวมโต๊ะ แยกผู้ชำระ สูตรวัตถุดิบ Modifier คิวครัว Sold-out รายวัน คำขอออร์เดอร์ออนไลน์ และการจองโต๊ะจากแชทค่ะ การชำระเงินไม่สร้างงานครัวเอง และคำขอจากแชทยังต้องเดินตามสถานะที่ร้านกำหนด",
      "Restaurants and cafes can use table and zone POS, table moves and merges, split payers, recipes, modifiers, kitchen queues, daily sold-out controls, online-order requests and chat reservation requests. Payment does not create kitchen work by itself, and chat requests still follow the shop's configured review flow."
    ),
    availability: "REQUIRES_SETUP"
  },
  {
    id: "board-game",
    title: both("ร้านบอร์ดเกม", "Board-game cafes"),
    aliases: aliases(
      ["ร้านบอร์ดเกม", "คิดค่าเล่นตามเวลา", "คลังเกม", "สมาชิกบอร์ดเกม", "จองโต๊ะบอร์ดเกม"],
      ["board game cafe", "timed play", "game library", "board game membership", "table booking"]
    ),
    answer: both(
      "ร้านบอร์ดเกมรองรับโต๊ะและการจับเวลา ผู้เล่นและกลุ่มผู้ชำระหลายกลุ่ม อัตราค่าเล่น คลังเกมให้ยืม แพ็กเกจสมาชิก โปรโมชั่นเวลา และการจองจากแชทค่ะ ค่าเวลาและสิทธิ์สมาชิกเป็น entitlement/service ไม่ใช่สินค้า SKU และการยืนยันอัตโนมัติมีเงื่อนไขเฉพาะสาขาที่ตั้งค่าไว้",
      "Board-game cafes can manage tables and timers, players and multiple payer groups, play rates, a lending library, member passes, time promotions and chat bookings. Time and member entitlements are services rather than product SKUs, and automatic confirmation is limited to branches configured for it."
    ),
    availability: "REQUIRES_SETUP"
  },
  {
    id: "pharmacy",
    title: both("ร้านขายยา", "Pharmacies"),
    aliases: aliases(
      ["ร้านขายยา", "ai แนะนำยา", "เภสัชกร", "ยา", "pharmacy intake"],
      ["pharmacy", "medicine advice", "pharmacist", "pharmacy intake"]
    ),
    answer: both(
      "ร้านขายยารองรับนโยบายสินค้า ล็อต วันหมดอายุ FEFO และกระบวนการให้เภสัชกรตรวจเคสค่ะ AI ช่วยเก็บและสรุปข้อมูลได้ แต่เภสัชกรที่มีใบอนุญาตเป็นผู้ตัดสินใจทางคลินิกและอนุมัติทุกครั้ง AI Pharmacy Intake ยังปิดเป็นค่าเริ่มต้นและต้องเปิดใช้งานแบบควบคุม",
      "Pharmacies can use product policies, lots, expiry, FEFO and pharmacist review workflows. AI may collect and summarize information, but a licensed pharmacist makes every clinical decision and approval. AI Pharmacy Intake is off by default and requires controlled enablement."
    ),
    availability: "LIMITED"
  },
  {
    id: "channels",
    title: both("ช่องทางแชทและ Marketplace", "Chat channels and marketplaces"),
    aliases: aliases(
      ["เชื่อม line", "เชื่อม facebook", "instagram", "tiktok", "shopee", "lazada", "ช่องทางไหน"],
      ["connect line", "facebook", "instagram", "tiktok", "shopee", "lazada", "supported channels"]
    ),
    answer: both(
      "BMS มีโครงสร้างรับข้อความจาก LINE, Facebook/Instagram, TikTok, เว็บ และช่องทาง Marketplace ที่กำหนดค่ะ การส่งข้อความกลับอัตโนมัติพร้อมใช้งานจริงขึ้นกับ adapter และ credential ของแต่ละช่องทาง ปัจจุบัน TikTok outbound ยังไม่ได้เชื่อม API และ Shopee/Lazada ยังเป็น beta จึงต้องตรวจขอบเขตก่อนเปิดใช้จริง",
      "BMS can ingest messages from LINE, Facebook/Instagram, TikTok, web and configured marketplace channels. Real outbound support depends on each adapter and its credentials. TikTok outbound is not connected yet, and Shopee/Lazada remain beta, so their production scope must be reviewed first."
    ),
    availability: "LIMITED"
  },
  {
    id: "delivery-integrations",
    title: both("Delivery platform และขนส่ง", "Delivery platforms and carriers"),
    aliases: aliases(
      ["grabfood", "line man", "lineman", "foodpanda", "flash", "kerry", "เรียกรถ", "จองขนส่ง"],
      ["grabfood", "line man", "foodpanda", "flash", "kerry", "carrier booking"]
    ),
    answer: both(
      "โครงสร้าง delivery platform และ carrier มีบางส่วนในระบบ แต่ยังห้ามสัญญาว่า GrabFood, LINE MAN, foodpanda, Flash หรือ Kerry เปิด live ได้ทุกบัญชีค่ะ GrabFood/LINE MAN ยังติดข้อกำหนดสัญญาหรือ API, foodpanda อยู่ใน sandbox/shadow และการจองพัสดุกับ Flash/Kerry ยังไม่ผ่านการทดสอบ production กับบัญชีจริง",
      "Parts of the delivery-platform and carrier architecture exist, but BMS must not promise that GrabFood, LINE MAN, foodpanda, Flash or Kerry can go live for every account. GrabFood/LINE MAN remain contract/API constrained, foodpanda is sandbox/shadow, and live Flash/Kerry booking has not been production-verified with merchant accounts."
    ),
    availability: "LIMITED"
  },
  {
    id: "deployment",
    title: both("Cloud, Mobile Offline และ Retail Local", "Cloud, mobile offline and Retail Local"),
    aliases: aliases(
      ["cloud", "offline", "เน็ตล่ม", "retail local", "ติดตั้งในร้าน", "ใช้โดยไม่มีอินเทอร์เน็ต"],
      ["cloud", "offline", "internet outage", "retail local", "on premises"]
    ),
    answer: both(
      "BMS Cloud เป็นระบบหลักค่ะ Mobile Emergency Offline เก็บคิวขายปลีกเงินสดพื้นฐานบนโทรศัพท์แล้วให้ server ตรวจใหม่เมื่อออนไลน์ ไม่ใช่ full offline และยังไม่รองรับร้านอาหาร ร้านยา หรือร้านบอร์ดเกม ส่วน Retail Local ติดตั้ง server ในร้านและยังเป็น technical pilot ไม่ใช่บริการ GA",
      "BMS Cloud is the primary mode. Mobile Emergency Offline queues basic retail cash sales on the phone for server revalidation after reconnection; it is not full offline and does not cover restaurants, pharmacies or board-game cafes. Retail Local installs the server in-store and remains a technical pilot rather than GA."
    ),
    availability: "PILOT"
  },
  {
    id: "tax",
    title: both("เอกสารภาษี", "Tax documents"),
    aliases: aliases(
      ["ใบกำกับภาษี", "ภาษี", "vat", "e-tax", "ใบเสร็จ"],
      ["tax invoice", "tax", "vat", "e-tax", "receipt"]
    ),
    answer: both(
      "BMS รองรับใบกำกับภาษีอย่างย่อ ใบกำกับภาษีเต็ม ใบลดหนี้ VAT แบบราคารวมภาษี และคำขอใบกำกับจาก QR บนใบเสร็จค่ะ เอกสารภาษีที่ออกแล้วเป็นข้อมูลถาวร แต่ยังไม่ควรอ้างว่าเป็น e-Tax ที่ลงนามและส่งกรมสรรพากรผ่าน provider จริง",
      "BMS supports abbreviated and full tax invoices, credit notes, VAT-inclusive pricing and receipt-QR invoice requests. Issued tax documents are immutable records, but BMS must not claim production e-Tax signing and Revenue Department submission through a live provider."
    ),
    availability: "LIMITED"
  },
  {
    id: "security",
    title: both("ความปลอดภัยและการควบคุม AI", "Security and AI controls"),
    aliases: aliases(
      ["ปลอดภัยไหม", "ข้อมูลร้าน", "ข้อมูลลูกค้า", "ai ทำเอง", "ยืนยันสลิป", "สิทธิ์พนักงาน", "rls", "rbac"],
      ["is it secure", "shop data", "customer data", "ai autonomy", "payment confirmation", "rbac", "rls"]
    ),
    answer: both(
      "ข้อมูลแต่ละร้านถูกแยกตาม tenant และ RLS พร้อมตรวจสิทธิ์ RBAC บน server ค่ะ AI ไม่มีสิทธิ์ query ฐานข้อมูลหรือสร้าง SQL เอง แต่เรียกได้เฉพาะเครื่องมือที่อนุมัติ งานสำคัญ เช่น ยืนยันชำระเงิน คืนเงิน ยกเลิก และปรับสต็อก ต้องให้ผู้มีสิทธิ์ยืนยันและมี audit trail",
      "Each shop is isolated by tenant and RLS, with server-side RBAC checks. AI cannot query the database or generate SQL; it may only call approved tools. Sensitive actions such as confirming payments, refunds, cancellations and stock adjustments require an authorized human confirmation and an audit trail."
    ),
    availability: "AVAILABLE"
  },
  {
    id: "onboarding",
    title: both("เริ่มใช้งาน BMS", "Getting started with BMS"),
    aliases: aliases(
      ["สมัครยังไง", "เริ่มใช้งาน", "ทดลองใช้", "ขอเดโม", "ย้ายระบบ", "นำเข้าข้อมูล", "ติดตั้ง"],
      ["how to sign up", "get started", "trial", "demo", "migrate data", "import data", "installation"]
    ),
    answer: both(
      "เริ่มจากสมัครร้าน เลือกประเภทธุรกิจ ตั้งค่าสาขา ผู้ใช้ สินค้า และช่องทางที่ต้องการค่ะ งานหลักเริ่มได้จากแพ็กเกจ Free โดยไม่ต้องใช้บัตรเครดิต การย้ายข้อมูลหรือการติดตั้งที่มีหลายสาขาและอุปกรณ์ควรให้ทีมประเมินจากจำนวนสินค้า ผู้ใช้ ช่องทาง และ workflow จริงก่อน",
      "Start by registering a shop, selecting the business type, then configuring branches, users, products and channels. Core work can begin on the Free plan without a credit card. Data migration or multi-branch/hardware installation should be assessed from the real product, user, channel and workflow scope."
    ),
    availability: "AVAILABLE",
    nextQuestion: both("เปิดร้านอยู่แล้วหรือกำลังเริ่มร้านใหม่คะ?", "Are you already operating, or starting a new business?")
  },
  {
    id: "hardware",
    title: both("อุปกรณ์ POS", "POS hardware"),
    aliases: aliases(
      ["มือถือ", "android", "iphone", "desktop", "windows", "เครื่องพิมพ์", "ลิ้นชัก", "esc/pos", "ฮาร์ดแวร์"],
      ["mobile", "android", "iphone", "desktop", "windows", "printer", "cash drawer", "esc/pos", "hardware"]
    ),
    answer: both(
      "BMS มี Web POS, Mobile POS และ Desktop shell ค่ะ Mobile รองรับ workflow ที่เชื่อมกับ server และมีการพิมพ์ ESC/POS ผ่าน Wi-Fi/LAN ในโค้ด แต่ยังไม่รับรองกับเครื่องพิมพ์และลิ้นชักทุกรุ่น ส่วน Desktop ต้องเชื่อม server และยังไม่มี offline tender หรือแพ็กเกจ signed/auto-update สำหรับกระจายทั่วไป",
      "BMS has Web POS, Mobile POS and a Desktop shell. Mobile contains server-connected workflows and Wi-Fi/LAN ESC/POS printing support, but not every printer or cash drawer is certified. Desktop requires the server and does not yet provide offline tender or generally distributed signed/auto-updating packages."
    ),
    availability: "LIMITED"
  }
];

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function scoreEntry(query: string, entry: PresalesKnowledgeEntry, locale: PresalesLocale): number {
  const q = normalize(query);
  if (!q) return 0;
  const title = normalize(entry.title[locale]);
  const entryAliases = entry.aliases[locale].map(normalize);
  let score = title === q ? 100 : title.includes(q) || q.includes(title) ? 50 : 0;
  for (const alias of entryAliases) {
    if (alias === q) score = Math.max(score, 100);
    else if (q.includes(alias)) score = Math.max(score, 30 + Math.min(alias.length, 20));
    else if (alias.includes(q) && q.length >= 4 && q.length * 2 >= alias.length) score = Math.max(score, 20);
  }
  const tokens = q.split(/[\s/,]+/).filter(token => token.length >= 2);
  const haystack = normalize(`${entry.title[locale]} ${entry.aliases[locale].join(" ")} ${entry.answer[locale]}`);
  score += tokens.filter(token => haystack.includes(token)).length * 2;
  return score;
}

export function searchBmsPresalesKnowledge(
  query: string,
  locale: PresalesLocale = "th",
  limit = 3
): Array<PresalesKnowledgeEntry & { score: number }> {
  return BMS_PRESALES_KNOWLEDGE
    .map(entry => ({ ...entry, score: scoreEntry(query, entry, locale) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.min(Math.max(limit, 1), 5));
}

export function isBmsPlanQuestion(message: string): boolean {
  return /(?:ราคา|แพ็กเกจ|package|pricing|price|กี่บาท|รายเดือน|\bfree\b|ฟรี|\bpro\b|\bbusiness\s+(?:plan|package)\b|(?:\bplan|\bpackage)\s+business\b|โควตา|quota|แต้ม\s*ai|ai\s*(?:point|credit))/i.test(message);
}

export function isBmsPresalesGreeting(message: string): boolean {
  return /^(?:สวัสดี|หวัดดี|hello|hi)\s*(?:ครับ|ค่ะ|คะ)?[\s!?.]*$/i.test(message.trim());
}

export function composePresalesKnowledgeReply(
  matches: ReadonlyArray<Pick<PresalesKnowledgeEntry, "answer" | "nextQuestion">>,
  locale: PresalesLocale
): string {
  const first = matches[0];
  if (!first) {
    return locale === "en"
      ? "I do not yet have a verified answer for that question. Please share your business type and what you need help with so the BMS team can follow up."
      : "ตอนนี้ยังไม่มีคำตอบที่ตรวจสอบแล้วสำหรับเรื่องนี้ค่ะ รบกวนบอกประเภทธุรกิจและสิ่งที่ต้องการให้ช่วยเพิ่มเติม เพื่อให้ทีม BMS รับช่วงต่อได้ค่ะ";
  }
  return [first.answer[locale], first.nextQuestion?.[locale]].filter(Boolean).join("\n\n");
}

export type PublicPlan = Pick<Plan,
  "code" | "name" | "price_monthly" | "max_products" | "max_channels" | "max_orders_month" |
  "max_users" | "max_branches" | "max_devices" | "ai_credits_monthly" | "feature_keys"
> & { verifiedAt: string };

export async function listBmsPublicPlans(): Promise<PublicPlan[]> {
  const verifiedAt = new Date().toISOString();
  const plans = await listPlans();
  return plans.map(plan => ({
    code: plan.code,
    name: plan.name,
    price_monthly: plan.price_monthly,
    max_products: plan.max_products,
    max_channels: plan.max_channels,
    max_orders_month: plan.max_orders_month,
    max_users: plan.max_users,
    max_branches: plan.max_branches,
    max_devices: plan.max_devices,
    ai_credits_monthly: plan.ai_credits_monthly,
    feature_keys: plan.feature_keys,
    verifiedAt,
  }));
}

function limit(value: number, locale: PresalesLocale): string {
  if (value < 0) return locale === "en" ? "unlimited" : "ไม่จำกัด";
  return value.toLocaleString(locale === "en" ? "en-US" : "th-TH");
}

export function composeBmsPlanReply(plans: readonly PublicPlan[], locale: PresalesLocale): string {
  if (!plans.length) {
    return locale === "en"
      ? "I could not verify the current BMS plans. Please try again later or ask the BMS team."
      : "ขณะนี้ตรวจสอบแพ็กเกจ BMS ล่าสุดไม่ได้ค่ะ กรุณาลองใหม่ภายหลังหรือสอบถามทีม BMS โดยตรง";
  }
  const blocks = plans.map(plan => locale === "en"
    ? `• ${plan.name}: ${plan.price_monthly > 0 ? `${plan.price_monthly.toLocaleString("en-US")} THB/month` : "Free"}\n  Products ${limit(plan.max_products, locale)} · users ${limit(plan.max_users, locale)} · branches ${limit(plan.max_branches, locale)} · POS devices ${limit(plan.max_devices, locale)} · channels ${limit(plan.max_channels, locale)} · AI ${limit(plan.ai_credits_monthly, locale)} points/month`
    : `• ${plan.name}: ${plan.price_monthly > 0 ? `${plan.price_monthly.toLocaleString("th-TH")} บาท/เดือน` : "ฟรี"}\n  สินค้า ${limit(plan.max_products, locale)} · ผู้ใช้ ${limit(plan.max_users, locale)} · สาขา ${limit(plan.max_branches, locale)} · เครื่อง POS ${limit(plan.max_devices, locale)} · ช่องทาง ${limit(plan.max_channels, locale)} · AI ${limit(plan.ai_credits_monthly, locale)} แต้ม/เดือน`
  );
  const note = locale === "en"
    ? "Core POS, CRM, inventory, payments, tax and data export remain available across plans. Scheduled reports start at Pro and new Retention analyses require Business for new shops. There is currently no automatic recurring subscription charge or Pro trial."
    : "งานหลัก POS, CRM, สต็อก รับเงิน ภาษี และส่งออกข้อมูลใช้ได้ทุกแพ็กเกจค่ะ สำหรับร้านใหม่ การตั้งเวลารายงานเริ่มที่ Pro และการสร้าง Retention analysis ใหม่ต้องใช้ Business ปัจจุบันยังไม่มีการตัดค่าสมาชิกรายเดือนอัตโนมัติหรือ Pro trial";
  return [locale === "en" ? "Current BMS plans" : "แพ็กเกจ BMS ปัจจุบัน", ...blocks, note, locale === "en" ? "How many branches and POS devices do you expect to use?" : "คาดว่าจะใช้กี่สาขาและกี่เครื่อง POS คะ?"].join("\n\n");
}
