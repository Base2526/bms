import type { AssistantLocale, LocalizedText } from "./types";

/**
 * Verified FAQ — the short question/answer pairs staff actually ask.
 *
 * These used to live only as two hand-maintained arrays inside `/admin/manual`, so the assistant
 * could not answer them at all: a staff member who asked the Drawer "กดจัดส่งไม่ได้ ขึ้นว่าไม่มีที่อยู่"
 * got generic guide steps, while the exact answer sat in a page nobody had open. They now live
 * here, next to the guide that owns each answer, and both surfaces read this one array:
 *
 * - the Manual renders them as its FAQ table (no second copy to drift),
 * - retrieval folds `question` + `aliases` into the owning guide's alias pool, so real phrasing
 *   reaches the right guide,
 * - `search_system_guides` returns them, so the model quotes a verified answer instead of
 *   composing one out of steps.
 *
 * Rules that keep this honest:
 * - `guideId` must be a real guide. An answer is only as linkable as its guide's route.
 * - Answers are NOT folded into retrieval scoring. They are long prose; scoring them would make
 *   every answer a weak match for every question — the "it found something" failure this catalog
 *   exists to prevent. Questions and aliases are the retrieval keys; the answer is the payload.
 * - `aliases` is what staff type, not a restatement of the title: short, problem-first, in counter
 *   words ("ปุ่มหาย", "กดจัดส่งไม่ได้", "เครดิตหมด"), rarely the feature's own name.
 */
export type SystemFaq = Readonly<{
  id: string;
  /** The verified guide that owns this answer — the assistant links to that guide's route. */
  guideId: string;
  question: LocalizedText;
  answer: LocalizedText;
  aliases: Readonly<Record<AssistantLocale, readonly string[]>>;
}>;

const both = (th: string, en: string): LocalizedText => ({ th, en });
const lists = (th: readonly string[], en: readonly string[]) => ({ th, en }) as const;

export const SYSTEM_FAQ: readonly SystemFaq[] = [
  {
    id: "faq.reply-honorific",
    guideId: "account.update-profile",
    question: both(
      "AI แนะนำคำตอบลงท้าย “ค่ะ” แต่ฉันเป็นผู้ชาย อยากได้ “ครับ”",
      "The AI suggests replies ending in “ค่ะ”, but I am male and want “ครับ”"
    ),
    answer: both(
      "ไปที่ โปรไฟล์ (/admin/profile) ตั้งช่อง “คำลงท้าย” เป็น ผู้ชาย — ครับ แล้วบันทึก · คำตอบแนะนำในหน้า Inbox (รวมปุ่ม ขอตรวจสอบ/ขอบคุณ) จะเปลี่ยนเป็น ครับ ให้อัตโนมัติ · ถ้าไม่ตั้ง ระบบใช้ ค่ะ เป็นค่าเริ่มต้น",
      "Go to Profile (/admin/profile), set the polite-particle field to male — ครับ, and save. Suggested replies in Inbox (including the Checking and Thank you buttons) switch to ครับ automatically. If it is unset, the system defaults to ค่ะ."
    ),
    aliases: lists(
      ["ลงท้ายครับ", "เปลี่ยนคำลงท้าย", "ค่ะเป็นครับ", "คำลงท้ายผิดเพศ", "AI ตอบว่าค่ะ"],
      ["change polite particle", "reply says ka not krub", "honorific setting"]
    ),
  },
  {
    id: "faq.account-theme",
    guideId: "account.update-profile",
    question: both(
      "อยากให้ธีมหน้าจอจำตามบัญชี ไม่ใช่เฉพาะเครื่องนี้",
      "I want the theme to follow my account, not just this device"
    ),
    answer: both(
      "ไปที่ โปรไฟล์ (/admin/profile) เลือก “ธีมหน้าจอ” เป็น ตามระบบเครื่อง / โหมดสว่าง / โหมดมืด แล้วบันทึก · ระบบจะจำกับบัญชีของคุณและ sync ไปเครื่องอื่นหลังล็อกอิน",
      "Go to Profile (/admin/profile), set Theme to System / Light / Dark, and save. The system remembers it against your account and syncs it to other devices after you log in."
    ),
    aliases: lists(
      ["เปลี่ยนธีม", "โหมดมืด", "ธีมไม่จำ", "จอสว่างเกินไป"],
      ["dark mode", "change theme", "theme not saved"]
    ),
  },
  {
    id: "faq.new-product-cannot-sell",
    guideId: "inventory.stock-sale-blockers",
    question: both("เพิ่มสินค้าแล้ว แต่ยังขายไม่ได้", "I added a product but still cannot sell it"),
    answer: both(
      "เช็กว่าตั้งราคา, เปิด active, และมี stock ในไซซ์ที่ต้องขายแล้วหรือยัง",
      "Check that you have set a price, marked it active, and added stock for the size you want to sell."
    ),
    aliases: lists(
      ["เพิ่มสินค้าแล้วขายไม่ได้", "สินค้าใหม่ไม่ขึ้น", "สินค้าไม่โผล่ตอนขาย", "หาสินค้าไม่เจอตอนขาย"],
      ["new product cannot be sold", "product not showing at checkout"]
    ),
  },
  {
    id: "faq.cannot-find-record",
    guideId: "orders.follow-lifecycle",
    question: both("ค้นหา order / payment / shipment ไม่เจอ", "I cannot find an order / payment / shipment"),
    answer: both(
      "ใช้ช่องค้นหาบนหน้า Orders / Payment / Shipping ได้โดยตรง ระบบค้นหาแบบพิมพ์แล้วทำงานเอง",
      "Use the search box on the Orders / Payment / Shipping page directly — it searches as you type."
    ),
    aliases: lists(
      ["หาออเดอร์ไม่เจอ", "ค้นบิลไม่เจอ", "หาการชำระเงินไม่เจอ", "หาพัสดุไม่เจอ"],
      ["cannot find order", "search for an order", "missing payment record"]
    ),
  },
  {
    id: "faq.customer-messaged-next-step",
    guideId: "inbox.handle-conversation",
    question: both(
      "ลูกค้าทักมา แต่ไม่รู้ต้องเปิดหน้าไหนต่อ",
      "A customer messaged me and I do not know which page to open next"
    ),
    answer: both(
      "เริ่มจาก Inbox แล้วดู Customer 360 ก่อน ถ้ามีสิทธิ์ order.create ให้กด สร้างออเดอร์ ใน Quick Actions ได้ทันที จากนั้นค่อยตามงานต่อที่ Orders / Payment / Shipping",
      "Start from Inbox and check Customer 360 first. If you have the order.create permission you can press Create order in Quick Actions straight away, then follow the work through Orders / Payment / Shipping."
    ),
    aliases: lists(
      ["ลูกค้าทักมาทำยังไงต่อ", "เริ่มงานจากแชท", "รับลูกค้าใหม่", "ลูกค้าถามแล้วต้องทำอะไร"],
      ["customer messaged what next", "start work from chat"]
    ),
  },
  {
    id: "faq.share-product-in-chat",
    guideId: "inbox.sell-from-conversation",
    question: both(
      "แชร์สินค้าในแชทแล้วทำไมยังไม่ส่งทันที และลูกค้าเห็นรูปทั้งหมดที่ไหน",
      "Why is a shared product not sent immediately, and where does the customer see all the images?"
    ),
    answer: both(
      "ระบบใส่ชื่อ ราคา ไซซ์ สต็อก และ public link ไว้ในข้อความร่างก่อน เพื่อให้ตรวจแล้วค่อยกด ส่ง · เลือกได้ทั้ง ข้อความ + ลิงก์ และ ข้อความ + รูป + ลิงก์ · เมื่อส่งแล้ว Inbox จะแสดงเป็นการ์ดสินค้าและซ่อน URL ยาวไว้หลังปุ่ม ดูสินค้า · ในแชทส่งเฉพาะรูป cover 1 รูป ส่วนลูกค้ากด public link เพื่อดู gallery ทั้งหมดได้โดยไม่ต้อง login · ปุ่ม Products หลังบ้านเป็นแท็บใหม่สำหรับพนักงานและไม่ถูกส่งให้ลูกค้า",
      "The system puts the name, price, sizes, stock, and public link into a draft message first so you can review it before pressing Send. You can choose text + link or text + image + link. Once sent, Inbox renders it as a product card and hides the long URL behind a View product button. Only one cover image is sent in chat — the customer opens the public link to see the whole gallery without logging in. The internal Products button opens in a new tab for staff and is never sent to the customer."
    ),
    aliases: lists(
      ["แชร์สินค้าในแชทไม่ส่งทันที", "ส่งลิงก์สินค้า", "ลูกค้าเห็นรูปกี่รูป", "ส่งรูปสินค้าให้ลูกค้า"],
      ["share a product in chat", "send product link to customer", "product card in inbox"]
    ),
  },
  {
    id: "faq.inbox-attachments",
    guideId: "inbox.handle-conversation",
    question: both("รูปกับไฟล์ใน Inbox ใช้อย่างไร", "How do images and files work in Inbox?"),
    answer: both(
      "กด รูป หรือ ไฟล์ แล้วรอให้อัปโหลดเข้า draft จากนั้นตรวจ preview และกด ส่ง · แนบได้ครั้งละ 1 รายการตามรูปแบบข้อความปัจจุบัน ถ้าเลือกใหม่จะใช้รายการล่าสุด โดย loading ของปุ่มรูปและไฟล์แยกจากกัน",
      "Press Image or File, wait for the upload to land in the draft, then check the preview and press Send. The current message format allows one attachment at a time; selecting a new one replaces the previous. The image and file buttons have separate loading states."
    ),
    aliases: lists(
      ["แนบไฟล์ในแชท", "ส่งรูปในแชท", "แนบได้กี่ไฟล์", "อัปโหลดไฟล์ให้ลูกค้า"],
      ["attach a file in chat", "send an image in inbox", "how many attachments"]
    ),
  },
  {
    id: "faq.ship-button-no-address",
    guideId: "customers.manage-address",
    question: both(
      "ปุ่มจัดส่งกดไม่ได้และขึ้นว่ายังไม่มีที่อยู่",
      "The ship button is disabled and says there is no address"
    ),
    answer: both(
      "สำหรับ LINE / Facebook / Instagram / Web / TikTok Chat ให้เปิด Customers เพิ่มที่อยู่ชนิดจัดส่งให้ลูกค้าก่อน แล้วกลับมาจัดส่งใหม่ ส่วน Lazada / Shopee ใช้ที่อยู่จาก Seller Center และไม่ถูกบังคับให้เพิ่มซ้ำ",
      "For LINE / Facebook / Instagram / Web / TikTok Chat, open Customers and add a shipping address for the customer first, then come back and ship. Lazada / Shopee use the address from Seller Center and are not required to add it again."
    ),
    aliases: lists(
      ["กดจัดส่งไม่ได้", "ไม่มีที่อยู่จัดส่ง", "ปุ่มส่งของเทา", "เพิ่มที่อยู่ลูกค้า"],
      ["ship button disabled", "no shipping address", "add a customer address"]
    ),
  },
  {
    id: "faq.customer360-invoice",
    guideId: "customers.customer-360",
    question: both(
      "ใบแจ้งหนี้จาก Customer 360 บันทึกเป็นเอกสารหรือยืนยันยอดแล้วหรือยัง",
      "Does the invoice from Customer 360 save a document or confirm the amount?"
    ),
    answer: both(
      "ยัง — ใบแจ้งหนี้นี้เป็น preview/print จากข้อมูลออเดอร์จริงและราคา ณ ตอนสั่ง ไม่ได้สร้าง record เอกสารใหม่ และไม่เปลี่ยนสถานะออเดอร์หรือการชำระเงิน",
      "No — this invoice is a preview/print built from the real order data and the prices at the time of ordering. It does not create a new document record, and it does not change the order or payment status."
    ),
    aliases: lists(
      ["ใบแจ้งหนี้เป็นเอกสารจริงไหม", "ปริ้นใบแจ้งหนี้", "ใบแจ้งหนี้ลูกค้า", "ใบแจ้งหนี้เปลี่ยนสถานะไหม"],
      ["invoice preview", "does the invoice create a document"]
    ),
  },
  {
    id: "faq.connect-channels",
    guideId: "settings.configure-shop",
    question: both("อยากเชื่อม LINE / Facebook / Website", "I want to connect LINE / Facebook / Website"),
    answer: both(
      "ไปที่ Settings แล้วทำตาม webhook/token guide ของแต่ละช่องทาง; LINE OA จะดึงชื่อ/รูปโปรไฟล์แบบ cache หลังข้อความเข้า ถ้ามีสิทธิ์และลูกค้ายังไม่บล็อก OA",
      "Go to Settings and follow the webhook/token guide for each channel. LINE OA caches the display name and profile picture after a message arrives, provided you have permission and the customer has not blocked the OA."
    ),
    aliases: lists(
      ["เชื่อมไลน์", "ต่อ Facebook", "ตั้งค่า webhook", "เชื่อมช่องทางแชท"],
      ["connect LINE", "connect facebook", "webhook and token"]
    ),
  },
  {
    id: "faq.realtime-test",
    guideId: "inbox.run-realtime-diagnostics",
    question: both(
      "อยากทดสอบว่าแชทเข้า Inbox ทันทีไหม",
      "I want to test whether chats reach Inbox immediately"
    ),
    answer: both(
      "เปิด Realtime Diagnostics: กด Emit เพื่อเช็กสัญญาณ realtime อย่างเดียว หรือกด Create Msg เพื่อสร้างข้อความทดสอบให้เห็นใน Inbox จริง",
      "Open Realtime Diagnostics: press Emit to test the realtime signal alone, or press Create Msg to create a test message that actually appears in Inbox."
    ),
    aliases: lists(
      ["แชทไม่เด้ง", "ข้อความไม่เข้า", "ทดสอบเรียลไทม์", "Inbox ไม่อัปเดต"],
      ["chat not arriving", "test realtime", "inbox not updating"]
    ),
  },
  {
    id: "faq.mentions-vs-inbox",
    guideId: "inbox.review-mentions",
    question: both("Mentions กับ Inbox ต่างกันอย่างไร", "What is the difference between Mentions and Inbox?"),
    answer: both(
      "Inbox คือคิวแชทหลักทั้งหมด ส่วน Mentions คือคิวงานที่มีคนในทีม mention หาเราโดยตรงเพื่อให้รับช่วงต่อหรือช่วยตัดสินใจ ถ้ารับผิดชอบหลายบทบาท ควรเปิดทั้งสองหน้าเป็นประจำเพื่อไม่ให้งานตกหล่น",
      "Inbox is the main chat queue. Mentions is the handoff queue where teammates explicitly tagged you for help or a decision. If someone works across several responsibilities, they should check both regularly so escalated work does not get missed."
    ),
    aliases: lists(
      ["มีคนแท็กฉัน", "งานที่ถูกส่งต่อ", "Mentions คืออะไร"],
      ["mentions versus inbox", "who tagged me", "handoff queue"]
    ),
  },
  {
    id: "faq.restock-vs-followup",
    guideId: "restock.review",
    question: both(
      "Restock subscriptions ใช้เมื่อไร และต่างจาก Follow-up Queue อย่างไร",
      "When should I use Restock subscriptions, and how is it different from Follow-up Queue?"
    ),
    answer: both(
      "Restock subscriptions ใช้กับลูกค้าที่กดยินยอมให้แจ้งเมื่อของกลับเข้าโดยเฉพาะ ส่วน Follow-up Queue คือคิวงานติดตามที่สร้างจากกติกาหลายแบบ เช่น retention, follow-up หรือ workflow อื่นของร้าน ถ้าจะตามลูกค้าเรื่องของกลับเข้า ให้เริ่มที่ Restock subscriptions ก่อน",
      "Restock subscriptions is specifically for customers who opted in to be notified when an item is back in stock. Follow-up Queue is the broader queue of generated follow-up work from several shop rules. If the task is about notifying someone that stock returned, start with Restock subscriptions."
    ),
    aliases: lists(
      ["ลูกค้ารอของเข้า", "แจ้งเมื่อของเข้า", "ใครรอสินค้าอยู่"],
      ["waiting for restock", "notify when back in stock"]
    ),
  },
  {
    id: "faq.packs-vs-labels",
    guideId: "catalog.configure-packs",
    question: both(
      "Product packs กับ Product labels ต่างกันอย่างไร",
      "What is the difference between Product packs and Product labels?"
    ),
    answer: both(
      "Product packs ใช้เพิ่มหน่วยขายหรือบาร์โค้ดเสริม เช่น แพ็ก, หลายชิ้นต่อหน่วย, หรือ pack code ที่ใช้หน้าร้าน ส่วน Product labels ใช้พิมพ์สติกเกอร์บาร์โค้ดจากข้อมูลสินค้า/pack ที่ตั้งไว้แล้ว ถ้ายังไม่ได้ตั้ง pack ก่อน หน้า labels จะไม่มีข้อมูลเสริมให้พิมพ์",
      "Product packs defines extra selling units or alternate barcodes, such as packs or multi-unit sales. Product labels prints barcode stickers from product and pack data that already exists. If the pack is not configured first, labels has less data to print."
    ),
    aliases: lists(
      ["ขายยกแพ็ก", "ตั้งหน่วยขาย", "บาร์โค้ดแพ็ก", "แพ็กกับสติกเกอร์ต่างกัน"],
      ["pack versus label", "selling unit", "pack barcode"]
    ),
  },
  {
    id: "faq.pos-readiness-scope",
    guideId: "pos.review-readiness",
    question: both("POS Readiness เอาไว้เช็กอะไร", "What does POS Readiness actually check?"),
    answer: both(
      "ใช้เช็ก blocker ก่อนเปิดขายหน้าร้านจริง เช่น ภาษี, stock ยังไม่พร้อม, refund ค้าง, หรือเงื่อนไขเฉพาะธุรกิจที่ทำให้ POS ยังไม่ควรเปิด ถ้าหน้านี้ยังเตือนอยู่ ควรแก้จากต้นเหตุแล้วค่อยเริ่มกะ เพื่อไม่ให้ไปเจอปัญหาตอนรับเงินจริง",
      "It checks blockers before the counter opens for real, such as tax setup, stock readiness, pending refunds, and any business-specific prerequisites. If POS Readiness is still warning, resolve the root cause first so the shift does not hit preventable problems while taking real money."
    ),
    aliases: lists(
      ["เปิดร้านไม่ได้", "POS ยังไม่พร้อม", "ก่อนเปิดกะต้องเช็กอะไร"],
      ["pos not ready", "before opening the counter"]
    ),
  },
  {
    id: "faq.missing-button",
    guideId: "permissions.action-unavailable",
    question: both(
      "ปุ่มบางปุ่มไม่ขึ้น เป็นเพราะระบบพังหรือเพราะสิทธิ์",
      "A button is missing — is the system broken, or is it a permission issue?"
    ),
    answer: both(
      "ส่วนใหญ่ให้เช็กสิทธิ์ก่อน โดยดูที่ Permissions เพื่อดู matrix ของ role และดู Users ว่าบัญชีนี้ถูกกำหนดบทบาทอะไร ถ้าต้องตรวจย้อนหลังว่าใครอนุมัติหรือใครแก้ข้อมูล ให้ต่อที่ Audit log และ Revision History",
      "Start by checking permissions. Open Permissions to see the role matrix, and Users to confirm what role this account actually has. If you then need to trace who approved or changed something, continue with Audit log and Revision History."
    ),
    aliases: lists(
      ["ปุ่มหาย", "เมนูไม่ขึ้น", "ไม่มีสิทธิ์หรือระบบพัง"],
      ["button missing", "menu not visible", "permission or bug"]
    ),
  },
  {
    id: "faq.ai-credit-usage",
    guideId: "billing.read-usage",
    question: both("อยากรู้ว่าเครดิต AI หายไปกับงานไหน", "How do I see where AI credits were spent?"),
    answer: both(
      "เปิด Billing เพื่อดู usage breakdown และ ledger ของรอบบิล ระบบแยก charged credits, provider calls และ estimated cost ออกจากกัน ถ้าสงสัยว่าคำตอบ AI แปลกหรือใช้ tool ผิด ให้เปิด AI Quality ควบคู่กันเพื่อดูตัวอย่างงานและ failure cases",
      "Open Billing to review the usage breakdown and billing ledger. The system separates charged credits, provider calls, and estimated cost. If the concern is about strange AI behavior or failed tools, open AI Quality alongside it to inspect samples and failure cases."
    ),
    aliases: lists(
      ["เครดิตหมด", "ค่าใช้จ่าย AI", "AI ใช้เครดิตเท่าไร", "บิลค่า AI"],
      ["where ai credits went", "ai cost", "billing usage breakdown"]
    ),
  },
  {
    id: "faq.pharmacy-start",
    guideId: "pharmacy.try-intake-lab",
    question: both("ร้านยาควรเริ่มจากหน้าไหนก่อน", "Where should a pharmacy team start?"),
    answer: both(
      "ถ้ากำลังทดสอบหรือฝึกทีม ให้เริ่มที่ Pharmacy Intake Lab ก่อนเพื่อดูคำถามและเงื่อนไขคัดกรอง จากนั้นใช้ Pharmacy Intake Queue สำหรับเคสจริงที่ต้องตามต่อ และใช้ Pharmacy Protocols เมื่อจะปรับกฎหรือคำถามที่ workflow นี้อ้างอิง · การตัดสินใจทางคลินิกต้องเป็นผู้มีใบอนุญาต ไม่ใช่ AI",
      "If the team is practicing or checking the screening flow, start with Pharmacy Intake Lab. For live work, use Pharmacy Intake Queue to process the real cases that need follow-up, and open Pharmacy Protocols when you need to change the screening rules or question set. Clinical decisions still belong to a licensed pharmacist, not the AI."
    ),
    aliases: lists(
      ["ร้านยาเริ่มตรงไหน", "ฝึกใช้ระบบร้านยา", "ทดลองคัดกรองยา"],
      ["pharmacy where to start", "practice the screening flow"]
    ),
  },
  {
    id: "faq.assistant-action-needs-confirm",
    guideId: "assistant.use-work-assistant",
    question: both(
      "ใช้ ผู้ช่วย AI สั่งคืนเงิน/ปรับสต็อก/ยกเลิกออร์เดอร์แล้วทำไมยังไม่เกิดผล",
      "I asked the AI Assistant to refund / adjust stock / cancel an order, so why did nothing happen?"
    ),
    answer: both(
      "ปกติแล้วครับ — งานกลุ่มนี้ AI จะเตรียม “คำขอ” เป็นการ์ดในแชทเท่านั้น ต้องกดปุ่ม ยืนยัน บนการ์ดนั้นก่อนระบบถึงจะทำจริง (เหมือนกดยืนยันในหน้า Payment/Orders ปกติ) ถ้าไม่เห็นปุ่มยืนยันหรือกดแล้วไม่ผ่าน ให้เช็กว่าบัญชีมีสิทธิ์ (permission) ของงานนั้นหรือไม่",
      "That is expected — for this group of tasks the AI only prepares a request as a card in the chat. You have to press Confirm on that card before the system does anything (the same as confirming on the Payment or Orders page). If you do not see a confirm button, or pressing it fails, check whether your account has the permission for that task."
    ),
    aliases: lists(
      ["สั่ง AI แล้วไม่เกิดอะไร", "AI ไม่คืนเงินให้", "AI ไม่ปรับสต็อก", "ต้องกดยืนยันไหม"],
      ["ai did nothing", "assistant refund not applied", "why is there a confirm button"]
    ),
  },
  {
    id: "faq.who-changed-record",
    guideId: "access.review-revisions",
    question: both(
      "อยากดูว่าใครแก้สินค้า/ออเดอร์ และเปลี่ยนอะไรบ้าง",
      "I want to see who edited a product or order, and what changed"
    ),
    answer: both(
      "เปิด Revision History แล้วเลือกชนิดข้อมูล จากนั้นค้นหา SKU หรือ record id ได้เลย เลือก 2 แถวแล้วกด Compare เพื่อดู field ที่เปลี่ยน",
      "Open Revision History, pick the record type, then search by SKU or record id. Select two rows and press Compare to see which fields changed."
    ),
    aliases: lists(
      ["ใครแก้ราคา", "ใครแก้ข้อมูล", "ย้อนดูการแก้ไข", "ของเปลี่ยนไปเมื่อไร"],
      ["who changed the price", "edit history", "compare revisions"]
    ),
  },
];

const FAQ_BY_GUIDE = new Map<string, SystemFaq[]>();
for (const faq of SYSTEM_FAQ) {
  const bucket = FAQ_BY_GUIDE.get(faq.guideId);
  if (bucket) bucket.push(faq);
  else FAQ_BY_GUIDE.set(faq.guideId, [faq]);
}

/** FAQ entries owned by a guide, in catalog order. */
export function faqsForGuide(guideId: string): readonly SystemFaq[] {
  return FAQ_BY_GUIDE.get(guideId) ?? [];
}

/**
 * Retrieval keys a guide inherits from its FAQ: the question itself plus the phrasings staff use.
 * Answers are deliberately excluded — see the module note.
 */
export function faqRetrievalAliases(guideId: string, locale: AssistantLocale): readonly string[] {
  const owned = FAQ_BY_GUIDE.get(guideId);
  if (!owned) return [];
  return owned.flatMap((faq) => [faq.question[locale], ...faq.aliases[locale]]);
}
