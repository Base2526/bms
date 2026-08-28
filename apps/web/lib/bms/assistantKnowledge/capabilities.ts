import type { SystemCapability } from "./types";

const both = (th: string, en: string) => ({ th, en }) as const;
const aliases = (th: readonly string[], en: readonly string[]) => ({ th, en }) as const;

function featureCapability(input: {
  id: string; module: string; route: string; title: readonly [string, string];
  description: readonly [string, string]; aliases: readonly [readonly string[], readonly string[]];
  status?: SystemCapability["status"]; requiredPermissions?: SystemCapability["requiredPermissions"];
  anyOfPermissions?: SystemCapability["anyOfPermissions"];
  accessRequirement?: SystemCapability["accessRequirement"];
  dependencies?: readonly string[]; limitations: readonly [string, string]; formats?: readonly string[];
}): SystemCapability {
  return {
    id: input.id, module: input.module, route: input.route,
    title: both(input.title[0], input.title[1]),
    description: both(input.description[0], input.description[1]),
    aliases: aliases(input.aliases[0], input.aliases[1]),
    status: input.status ?? "AVAILABLE",
    requiredPermissions: input.requiredPermissions ?? [],
    anyOfPermissions: input.anyOfPermissions,
    accessRequirement: input.accessRequirement,
    configurationDependencies: input.dependencies ?? [],
    limitations: both(input.limitations[0], input.limitations[1]),
    formats: input.formats,
  };
}

/**
 * Phase 1 capability inventory.
 *
 * This catalog describes implemented product capability, not live tenant state. A
 * CONDITIONAL entry still needs a trusted configuration tool before the assistant
 * can say that a particular shop has enabled or configured it.
 */
export const SYSTEM_CAPABILITIES: readonly SystemCapability[] = [
  {
    id: "dashboard.overview", module: "dashboard",
    title: both("ภาพรวมร้าน", "Store overview"),
    description: both("ดูยอดขาย งานค้าง และตัวชี้วัดการดำเนินงาน", "View sales, pending work, and operating indicators."),
    aliases: aliases(["แดชบอร์ด", "ภาพรวม", "ยอดวันนี้"], ["dashboard", "overview", "today summary"]),
    status: "AVAILABLE", route: "/admin/dashboard", requiredPermissions: ["report.view"],
    configurationDependencies: [], limitations: both("ตัวเลขต้องอ่านจากข้อมูลร้านจริง", "Figures must come from live shop data."),
  },
  {
    id: "inbox.omnichannel", module: "inbox",
    title: both("กล่องข้อความลูกค้า", "Customer inbox"),
    description: both("อ่าน มอบหมาย ติดแท็ก บันทึกโน้ต และตอบบทสนทนา", "Read, assign, tag, note, and reply to customer conversations."),
    aliases: aliases(["อินบ็อกซ์", "แชทลูกค้า", "ข้อความ"], ["inbox", "customer chat", "messages"]),
    status: "CONDITIONAL", route: "/admin/inbox", requiredPermissions: ["inbox.view"],
    configurationDependencies: ["At least one supported channel must be configured for external messaging."],
    limitations: both("ความสามารถส่งออกขึ้นกับช่องทางที่เชื่อมต่อจริง", "Outbound support depends on the configured channel."),
  },
  {
    id: "catalog.products", module: "products",
    title: both("สินค้าและแคตตาล็อก", "Products and catalog"),
    description: both("จัดการสินค้า ราคา รูปภาพ แพ็ก และตัวเลือกสินค้า", "Manage products, prices, images, packs, and variants."),
    aliases: aliases(["สินค้า", "เพิ่มสินค้า", "SKU", "ราคา"], ["products", "add product", "SKU", "price"]),
    status: "AVAILABLE", route: "/admin/products", requiredPermissions: ["product.view"],
    configurationDependencies: [], limitations: both("การแก้ไขต้องมี product.edit", "Editing additionally requires product.edit."),
  },
  {
    id: "inventory.branch", module: "inventory",
    title: both("สต็อกตามสาขา", "Branch inventory"),
    description: both("ดู นับ และโอนสต็อกระหว่างสาขา", "View, count, and transfer stock between branches."),
    aliases: aliases(["สต็อก", "คลัง", "โอนสาขา", "นับสต็อก"], ["stock", "warehouse", "branch transfer", "stock count"]),
    status: "CONDITIONAL", route: "/admin/locations", requiredPermissions: ["inventory.count"],
    configurationDependencies: ["Locations must be configured."],
    limitations: both("การโอนและการยืนยันผลนับใช้สิทธิ์แยกกัน", "Transfer and count approval use separate permissions."),
  },
  {
    id: "orders.lifecycle", module: "orders",
    title: both("จัดการออร์เดอร์", "Order management"),
    description: both("สร้าง ดู ชำระ แพ็ก จัดส่ง ยกเลิก และคืนออร์เดอร์", "Create, view, pay, pack, ship, cancel, and return orders."),
    aliases: aliases(["ออร์เดอร์", "คำสั่งซื้อ", "บิล"], ["orders", "sales orders", "bills"]),
    status: "AVAILABLE", route: "/admin/orders", requiredPermissions: ["order.view"],
    configurationDependencies: [], limitations: both("การยกเลิกและคืนสินค้าเป็นงานสำคัญที่ต้องยืนยัน", "Cancellation and returns are sensitive confirmed actions."),
  },
  {
    id: "payments.review", module: "payments",
    title: both("ตรวจสอบการชำระเงิน", "Payment review"),
    description: both("ดูสลิปและยืนยัน ปฏิเสธ หรือคืนเงินตามสิทธิ์", "Review slips and confirm, reject, or refund according to access."),
    aliases: aliases(["ชำระเงิน", "สลิป", "คืนเงิน"], ["payments", "payment slip", "refund"]),
    status: "CONDITIONAL", route: "/admin/payment", requiredPermissions: ["payment.view"],
    configurationDependencies: ["Receiving accounts and payment methods must be configured."],
    limitations: both("AI วิเคราะห์สลิปได้เพียงคำแนะนำ มนุษย์ต้องยืนยัน", "AI slip analysis is advisory; a human confirms."),
  },
  {
    id: "shipping.fulfillment", module: "shipping",
    title: both("การจัดส่งและเลขพัสดุ", "Shipping and tracking"),
    description: both("สร้างรายการจัดส่งและติดตามสถานะพัสดุ", "Create shipments and track parcel status."),
    aliases: aliases(["จัดส่ง", "เลขพัสดุ", "ขนส่ง", "สร้างพัสดุ"], ["shipping", "tracking", "shipment", "fulfilment"]),
    // The shipment module itself is built and used; only the carrier booking adapters are not.
    // Marking the whole capability MOCK told staff that shipping does not work at all.
    status: "AVAILABLE", route: "/admin/shipment", requiredPermissions: ["shipping.view"],
    configurationDependencies: [], limitations: both("เลขพัสดุกรอก/นำเข้าเอง — การจองกับผู้ให้บริการขนส่งยังไม่ live (ดู shipping.carrier-integrations)", "Tracking numbers are entered or imported; live carrier booking is not available (see shipping.carrier-integrations)."),
  },
  {
    id: "shipping.carrier-integrations", module: "shipping",
    title: both("เชื่อมต่อผู้ให้บริการขนส่ง (Flash/Kerry)", "Carrier integrations (Flash/Kerry)"),
    description: both("ตัวเชื่อมสำหรับจองพัสดุกับ Flash/Kerry โดยตรงจากระบบ", "Adapters for booking parcels with Flash/Kerry directly from BMS."),
    aliases: aliases(["Flash", "Kerry", "จองขนส่ง", "เรียกรถเข้ารับ"], ["Flash", "Kerry", "carrier booking", "pickup request"]),
    status: "MOCK", route: "/admin/shipment", requiredPermissions: ["shipping.view"],
    configurationDependencies: ["A signed merchant contract and verified carrier credentials are required."],
    limitations: both("เป็น scaffold ที่ยังไม่เคยยิงกับ API จริง ห้ามบอกลูกค้าว่าจองพัสดุอัตโนมัติได้แล้ว", "These are scaffolds never run against the live carrier APIs; never tell a customer booking is automated."),
  },
  {
    id: "purchase.orders", module: "purchase",
    title: both("ใบสั่งซื้อและรับสินค้า", "Purchase orders and receiving"),
    description: both("สร้าง PO ติดตาม และรับสินค้าเข้าสต็อก", "Create, track, and receive purchase orders into stock."),
    aliases: aliases(["PO", "สั่งซื้อ", "ซัพพลายเออร์", "รับของ"], ["PO", "purchase order", "supplier", "receive stock"]),
    status: "AVAILABLE", route: "/admin/purchase", requiredPermissions: ["purchase.view"],
    configurationDependencies: [], limitations: both("การสร้างและรับของใช้สิทธิ์คนละรายการ", "Creating and receiving use separate permissions."),
  },
  {
    id: "customers.crm", module: "customers",
    title: both("ลูกค้าและ Customer 360", "Customers and Customer 360"),
    description: both("ดูประวัติ คำสั่งซื้อ แท็ก ที่อยู่ และภาพรวมลูกค้า", "View customer history, orders, tags, addresses, and the 360 profile."),
    aliases: aliases(["ลูกค้า", "CRM", "ประวัติลูกค้า", "Customer 360"], ["customers", "CRM", "customer history", "Customer 360"]),
    status: "AVAILABLE", route: "/admin/customers", requiredPermissions: ["customer.view"],
    configurationDependencies: [], limitations: both("แสดงเฉพาะข้อมูลในร้านปัจจุบันตามสิทธิ์", "Only current-tenant data is available according to access."),
  },
  {
    id: "coupons.promotions", module: "coupons",
    title: both("คูปองและสิทธิ์ใช้งาน", "Coupons and eligibility"),
    description: both("สร้างคูปองและตรวจสิทธิ์ตามเวลา โควตา ลูกค้า และยอดขั้นต่ำ", "Create coupons and check eligibility by time, quota, customer, and minimum spend."),
    aliases: aliases(["คูปอง", "ส่วนลด", "โค้ดลดราคา", "คูปองที่ใช้ได้"], ["coupon", "discount", "promo code", "available coupons"]),
    status: "AVAILABLE", route: "/admin/coupons", requiredPermissions: ["coupon.view"],
    configurationDependencies: [], limitations: both("คูปอง active ไม่ได้แปลว่าลูกค้าทุกคนใช้ได้", "An active coupon is not necessarily eligible for every customer."),
  },
  {
    id: "loyalty.points", module: "loyalty",
    title: both("สมาชิกและสะสมแต้ม", "Membership and loyalty points"),
    description: both("รองรับสมาชิก ระดับสมาชิก การรับแต้ม และการแลกแต้ม", "Supports membership, tiers, earning points, and point redemption."),
    aliases: aliases(["สมาชิก", "สะสมแต้ม", "แต้ม", "แลกแต้ม"], ["membership", "loyalty", "points", "redeem points"]),
    status: "CONDITIONAL", route: "/admin/loyalty", requiredPermissions: ["member.view"],
    configurationDependencies: ["The tenant loyalty program must be enabled and configured."],
    limitations: both("ระบบรองรับไม่ได้แปลว่าร้านเปิดใช้ ต้องอ่านสถานะร้านจริง", "Product support does not mean the shop enabled it; live configuration must be checked."),
  },
  {
    id: "followup.retention", module: "followup",
    title: both("ติดตามลูกค้าและรักษาฐานลูกค้า", "Follow-up and retention"),
    description: both("จัดการกฎติดตาม คิวติดตาม และข้อเสนอรักษาลูกค้า", "Manage follow-up rules, queues, and retention proposals."),
    aliases: aliases(["ติดตามลูกค้า", "follow up", "retention", "ลูกค้าเงียบ"], ["follow-up", "retention", "quiet customers"]),
    status: "CONDITIONAL", route: "/admin/followup-queue", requiredPermissions: ["followup.view"],
    configurationDependencies: ["Follow-up rules and supported outbound channels must be configured."],
    limitations: both("Holdout ห้ามติดต่อและ treatment เป็น propose-only", "Holdout customers cannot be contacted and treatment is propose-only."),
  },
  {
    id: "reports.export", module: "reports",
    title: both("ส่งออกรายงาน", "Report export"),
    description: both("สร้างรายงานยอดขาย สต็อก และกำไรโดยประมาณ", "Generate sales, inventory, and estimated-profit reports."),
    aliases: aliases(["รายงาน", "export", "PDF", "Excel", "CSV"], ["reports", "export", "PDF", "Excel", "CSV"]),
    status: "AVAILABLE", route: "/admin/reports", requiredPermissions: ["report.view"],
    configurationDependencies: [], formats: ["XLSX", "CSV", "PDF"],
    limitations: both("หัวข้อ PDF ปัจจุบันเป็นอังกฤษเพราะข้อจำกัดฟอนต์", "PDF headings are currently English because of font limitations."),
  },
  {
    id: "reports.email", module: "reports",
    title: both("ส่งรายงานทางอีเมล", "Email a report"),
    description: both("ส่งไฟล์รายงานที่สร้างแล้วไปยังอีเมลหลังผู้ใช้ยืนยัน", "Email a generated report after explicit user confirmation."),
    aliases: aliases(["ส่งรายงาน", "อีเมลรายงาน"], ["email report", "send report"]),
    status: "CONDITIONAL", route: "/admin/reports", requiredPermissions: ["report.email"],
    configurationDependencies: ["Mailer configuration must be valid."],
    limitations: both("เป็น proposal และต้องตรวจผู้รับก่อนส่ง", "This is proposal-only and the recipient must be reviewed."),
  },
  {
    id: "users.access", module: "users",
    title: both("ผู้ใช้ บทบาท และสิทธิ์", "Users, roles, and permissions"),
    description: both("ดูบุคลากร บทบาท และสิทธิ์ที่มีผลจริงภายในร้าน", "View staff, roles, and effective access within the shop."),
    aliases: aliases(["ผู้ใช้", "พนักงาน", "สิทธิ์", "role", "ใครทำได้"], ["users", "staff", "permissions", "roles", "who can"]),
    status: "AVAILABLE", route: "/admin/users", requiredPermissions: ["user.view"],
    configurationDependencies: [], limitations: both("ค้นหาเฉพาะร้านปัจจุบันและไม่เปิดเผยบัญชี platform", "Search is tenant-scoped and excludes platform identities."),
  },
  {
    id: "pos.operations", module: "pos",
    title: both("ขายหน้าร้าน POS", "Point of sale"),
    description: both("เปิดกะ ขาย รับเงิน พักบิล คืนสินค้า และปิดกะ", "Open shifts, sell, take payment, hold bills, return items, and close shifts."),
    aliases: aliases(["POS", "หน้าร้าน", "แคชเชียร์", "เปิดกะ", "ปิดกะ"], ["POS", "cashier", "open shift", "close shift"]),
    status: "CONDITIONAL", route: "/admin/pos-manual", requiredPermissions: ["pos.sell"],
    configurationDependencies: ["A POS device, branch, and cashier PIN must be configured."],
    limitations: both("ส่วนลด Void และเงินออกต้องมี PIN บุคคลที่สอง", "Discounts, voids, and cash-out require a second person's PIN."),
  },
  {
    id: "pharmacy.workflow", module: "pharmacy",
    title: both("กระบวนการร้านขายยา", "Pharmacy workflow"),
    description: both("รับเคส ขอข้อมูลเพิ่ม และส่งให้เภสัชกรผู้มีใบอนุญาตพิจารณา", "Intake cases, request more information, and route them to a licensed pharmacist."),
    aliases: aliases(["ร้านขายยา", "เภสัชกร", "เคสยา", "ใบสั่งยา"], ["pharmacy", "pharmacist", "medicine case", "prescription"]),
    status: "CONDITIONAL", route: "/admin/pharmacy-manual", requiredPermissions: ["pharmacy.assessment.read"],
    configurationDependencies: ["Pharmacy intake is feature-gated and requires licensed-pharmacist setup."],
    limitations: both("AI ไม่ตัดสินใจทางคลินิกและหลักฐานมีสิทธิ์แยก", "AI makes no clinical decisions and evidence has narrower access."),
  },
  {
    id: "audit.revisions", module: "audit",
    title: both("บันทึกตรวจสอบและประวัติแก้ไข", "Audit and revision history"),
    description: both("ตรวจว่าใครทำอะไรและดูประวัติก่อน/หลังของรายการที่รองรับ", "See who did what and before/after history for supported records."),
    aliases: aliases(["audit", "ประวัติแก้ไข", "ใครแก้"], ["audit", "revision history", "who changed"]),
    status: "AVAILABLE", route: "/admin/audit", requiredPermissions: [],
    accessRequirement: "tenant_administrator",
    configurationDependencies: [], limitations: both("การเข้าถึงหน้าระดับสูงยังถูกจำกัดด้วย server guard", "High-privilege pages remain protected by server guards."),
  },
  {
    id: "system.health", module: "system-health",
    title: both("สถานะระบบ", "System health"),
    description: both("ดูสุขภาพ provider งานเบื้องหลัง และตัวชี้วัดที่ระบบมี", "View provider, job, and available system-health indicators."),
    aliases: aliases(["ระบบล่ม", "สุขภาพระบบ", "provider", "job"], ["system health", "provider", "jobs", "outage"]),
    status: "AVAILABLE", route: "/admin/system-health", requiredPermissions: [],
    accessRequirement: "platform_administrator",
    configurationDependencies: [], limitations: both("หน้านี้อ่านอย่างเดียว ไม่มี restart หรือ repair", "This surface is read-only with no restart or repair actions."),
  },
  {
    id: "receivables.credit-sales", module: "receivables",
    title: both("ขายเชื่อและลูกหนี้การค้า", "Credit sales and receivables"),
    description: both("ดูวงเงิน หนี้คงค้าง รับชำระ และจัดการลูกหนี้", "View credit limits, outstanding debt, collections, and receivables."),
    aliases: aliases(["ขายเชื่อ", "ลูกหนี้", "รับชำระหนี้", "AR"], ["credit sale", "receivables", "collect debt", "AR"]),
    status: "AVAILABLE", route: "/admin/receivables", requiredPermissions: ["ar.view"],
    configurationDependencies: [], limitations: both("ปล่อยเชื่อ รับชำระ และตัดหนี้สูญใช้สิทธิ์แยกกัน", "Credit sale, collection, and write-off use separate permissions."),
  },
  {
    id: "restock.subscriptions", module: "restock",
    title: both("แจ้งเตือนสินค้าเข้า", "Restock subscriptions"),
    description: both("เก็บความต้องการสินค้าหมดและให้พนักงานตรวจคิวเมื่อของกลับเข้า", "Capture out-of-stock demand and let staff review the queue when stock returns."),
    aliases: aliases(["แจ้งเตือนสินค้าเข้า", "ลูกค้ารอของ", "restock"], ["restock alert", "waiting customers", "restock"]),
    status: "CONDITIONAL", route: "/admin/restock-subscriptions", requiredPermissions: ["inbox.view"],
    configurationDependencies: ["Customer opt-in and a supported outbound channel are required."],
    limitations: both("AI ไม่ส่งหาเองทันที พนักงานตรวจและส่งตามช่องทาง", "AI does not contact automatically; staff reviews and sends through the channel."),
  },
  {
    id: "catalog.product-packs", module: "product-packs",
    title: both("หน่วยขายและแพ็กสินค้า", "Product packs and selling units"),
    description: both("กำหนดกล่อง ขวด แผง หรือหน่วยขายที่ผูกกับจำนวนชิ้นและราคา", "Configure boxes, bottles, blisters, or selling units with server-owned quantity and price."),
    aliases: aliases(["แพ็กสินค้า", "ขายเป็นกล่อง", "ขายเป็นแผง", "pack code"], ["product pack", "sell by box", "selling unit", "pack code"]),
    status: "AVAILABLE", route: "/admin/product-packs", requiredPermissions: ["product.view"],
    configurationDependencies: [], limitations: both("AI ส่งเพียง packCode; จำนวนชิ้นและราคาต้อง resolve ฝั่ง server", "AI supplies only packCode; quantity and price resolve server-side."),
  },
  {
    id: "commission.staff", module: "commission",
    title: both("ค่าคอมพนักงาน", "Staff commission"),
    description: both("ดูรายงานและจัดการอัตราค่าคอมตามสิทธิ์", "View commission reports and manage rates according to access."),
    aliases: aliases(["ค่าคอม", "commission", "ยอดพนักงาน"], ["commission", "staff sales"]),
    status: "AVAILABLE", route: "/admin/commission", requiredPermissions: ["commission.view"],
    configurationDependencies: [], limitations: both("ดูและจัดการอัตราเป็นคนละสิทธิ์", "Viewing and managing rates use separate permissions."),
  },
  {
    id: "settings.channels", module: "settings",
    title: both("ตั้งค่าร้าน ช่องทาง และ AI", "Store, channel, and AI settings"),
    description: both("ตั้งค่าโปรไฟล์ร้าน บัญชีรับเงิน ช่องทาง และ provider AI", "Configure store profile, receiving accounts, channels, and AI provider."),
    aliases: aliases(["ตั้งค่าร้าน", "เชื่อม LINE", "บัญชีรับเงิน", "ตั้งค่า AI"], ["store settings", "connect LINE", "payment account", "AI settings"]),
    status: "CONDITIONAL", route: "/admin/settings", requiredPermissions: [],
    configurationDependencies: ["Each external channel/provider needs valid credentials and health verification."],
    limitations: both("active คือสวิตช์แอดมิน ส่วน status คือสุขภาพที่สังเกตได้", "active is the admin switch; status is observed connection health."),
  },
  {
    id: "ai.quality", module: "ai-quality",
    title: both("ตรวจคุณภาพ AI", "AI quality review"),
    description: both("ตรวจเคส AI และให้ verdict เพื่อพัฒนาคุณภาพโดยมนุษย์", "Review AI cases and record human verdicts for quality improvement."),
    aliases: aliases(["AI quality", "ตรวจคำตอบ AI", "eval"], ["AI quality", "review AI answer", "eval"]),
    status: "AVAILABLE", route: "/admin/ai-quality", requiredPermissions: ["ai_quality.view"],
    configurationDependencies: [], limitations: both("การ review ต้องมี ai_quality.review", "Submitting a review requires ai_quality.review."),
  },
  {
    id: "billing.plan", module: "billing",
    title: both("แพ็กเกจและการใช้งาน AI", "Plan and AI usage"),
    description: both("ดูแผน โควตาเครดิต AI provider calls และต้นทุนที่ระบุราคาได้", "View plan, AI credit quota, provider calls, and priced attributed cost."),
    aliases: aliases(["แพ็กเกจ", "โควตา AI", "เครดิต", "billing"], ["plan", "AI quota", "credits", "billing"]),
    status: "AVAILABLE", route: "/admin/billing", requiredPermissions: [],
    configurationDependencies: [], limitations: both("เครดิต provider calls และต้นทุน USD เป็นคนละมิติ", "Credits, provider calls, and attributed USD cost are separate dimensions."),
  },
  {
    id: "reports.schedule", module: "report-schedule",
    title: both("ตั้งเวลารายงาน", "Scheduled reports"),
    description: both("กำหนดงานรายงานตามเวลาสำหรับผู้ดูแลแพลตฟอร์ม", "Configure scheduled reporting jobs for platform administration."),
    aliases: aliases(["ตั้งเวลารายงาน", "ส่งรายงานอัตโนมัติ", "report schedule"], ["schedule report", "automatic report", "report schedule"]),
    status: "CONDITIONAL", route: "/admin/report-schedule", requiredPermissions: [],
    accessRequirement: "platform_administrator",
    configurationDependencies: ["Platform-admin access, cron authorization, and mailer configuration are required."],
    limitations: both("ผู้ใช้ร้านทั่วไปเข้าไม่ได้ และ cron ต้อง fail closed เมื่อไม่มี secret", "Tenant staff cannot access it, and cron fails closed without its secret."),
  },
  {
    id: "access.matrix", module: "permissions",
    title: both("ตารางบทบาทและสิทธิ์", "Role permission matrix"),
    description: both("ผู้ดูแลระดับสูงกำหนดสิทธิ์ของแต่ละบทบาทภายในร้าน", "High-privilege administrators configure permissions for each tenant role."),
    aliases: aliases(["ตารางสิทธิ์", "ตั้ง role", "permissions"], ["permission matrix", "configure role", "permissions"]),
    status: "AVAILABLE", route: "/admin/permissions", requiredPermissions: [],
    accessRequirement: "tenant_administrator",
    configurationDependencies: [], limitations: both("Server super guard และ role rank ยังบังคับ แม้ซ่อนเมนู", "Server super guards and role rank still apply regardless of menu visibility."),
  },
  featureCapability({
    id: "inventory.transfers", module: "inventory", route: "/admin/stock-transfers",
    title: ["โอนสต็อกระหว่างสาขา", "Inter-branch stock transfers"], description: ["ส่งของจากต้นทางและรับเข้าปลายทางเป็นสองขั้นตอน", "Send from the source and receive at the destination as two separate steps."],
    aliases: [["โอนของ", "ย้ายสต็อก", "ของระหว่างทาง"], ["stock transfer", "move stock", "in transit"]], requiredPermissions: ["inventory.transfer"],
    limitations: ["ส่งได้เฉพาะ stock ที่ไม่ถูกจอง และของขาดระหว่างรับถูกบันทึกที่ต้นทาง", "Only unreserved stock can be sent; short receipt is recorded as loss at the source."],
  }),
  featureCapability({
    id: "inventory.snapshot-counts", module: "inventory", route: "/admin/stock-counts",
    title: ["นับสต็อกแบบ Snapshot", "Snapshot-based stock counts"], description: ["นับสต็อกโดย apply เฉพาะผลต่าง เพื่อรักษารายการขายที่เกิดระหว่างนับ", "Apply only the count variance so sales made during counting are preserved."],
    aliases: [["นับสต็อก", "ตรวจนับ", "stock count"], ["stock count", "cycle count", "inventory count"]], requiredPermissions: ["inventory.count"],
    limitations: ["การ apply ต้องมี inventory.count.apply และห้ามทำให้ต่ำกว่าของที่จอง", "Applying requires inventory.count.apply and cannot reduce stock below reservations."],
  }),
  featureCapability({
    id: "catalog.labels", module: "product-labels", route: "/admin/product-labels",
    title: ["ฉลากและบาร์โค้ดสินค้า", "Product barcode labels"], description: ["พิมพ์สติกเกอร์จากสินค้าและหน่วยขายที่ตั้งไว้", "Print labels from configured products and selling packs."],
    aliases: [["พิมพ์บาร์โค้ด", "ฉลากสินค้า", "สติกเกอร์ราคา"], ["print barcode", "product labels", "price sticker"]], requiredPermissions: ["product.view"],
    limitations: ["ใช้ข้อมูล catalog ปัจจุบันและไม่สร้าง SKU หรือ barcode ใหม่เอง", "Uses current catalog data and does not invent a SKU or barcode."],
  }),
  featureCapability({
    id: "pos.deposits", module: "pos", route: "/admin/pos-manual",
    title: ["มัดจำและรับยอดคงเหลือที่ POS", "POS deposits and settlement"], description: ["รับมัดจำ รับเพิ่ม และปิดยอดโดยตัดสต็อก/ออกเอกสารในขั้นยืนยัน", "Take deposits, add payments, and settle with stock and documents finalized at confirmation."],
    aliases: [["รับมัดจำ", "จ่ายยอดคงเหลือ", "layaway"], ["deposit", "settle balance", "layaway"]], status: "CONDITIONAL", requiredPermissions: ["pos.deposit.take"],
    dependencies: ["A paired POS device, branch, open shift, and cashier PIN are required."], limitations: ["ยกเลิกต้องมี pos.deposit.cancel และสินค้าบังคับ serial ต้องระบุ serial ตอนปิดยอด", "Cancellation requires pos.deposit.cancel; serial-tracked goods need serials at settlement."],
  }),
  featureCapability({
    id: "pos.store-credit", module: "pos", route: "/admin/pos-manual",
    title: ["เครดิตร้าน", "Store credit"], description: ["ออก ใช้ และปรับเครดิตร้านผ่านสิทธิ์แยกกัน", "Issue, redeem, and adjust store credit through separate permissions."],
    aliases: [["เครดิตร้าน", "เงินคงเหลือลูกค้า", "store credit"], ["store credit", "customer credit balance"]], status: "CONDITIONAL", anyOfPermissions: ["storecredit.issue", "storecredit.redeem", "storecredit.adjust"],
    dependencies: ["The customer must be resolved and the acting cashier must hold the action permission."], limitations: ["เครดิตร้านไม่ใช่แต้มสะสมหรือวงเงินขายเชื่อ", "Store credit is distinct from loyalty points and receivables credit."],
  }),
  featureCapability({
    id: "pos.expenses", module: "pos", route: "/admin/pos-manual",
    title: ["ค่าใช้จ่าย เงินสดย่อย และเงินลิ้นชัก", "POS expenses, petty cash, and drawer movements"], description: ["บันทึกค่าใช้จ่าย เงินสดย่อย และ cash in/out ด้วยหลักฐานและสิทธิ์ที่เหมาะสม", "Record expenses, petty cash, and cash in/out with evidence and proper access."],
    aliases: [["เงินสดย่อย", "ค่าใช้จ่ายหน้าร้าน", "เงินออกลิ้นชัก"], ["petty cash", "store expense", "cash out"]], status: "CONDITIONAL", anyOfPermissions: ["pos.expense.create", "pos.petty_cash.manage", "pos.cash.movement"],
    dependencies: ["An open shift and cashier PIN are required for drawer operations."], limitations: ["เงินออกต้องมีคนที่สอง และยอดขายเงินสดห้ามบันทึก cash-in ซ้ำ", "Cash-out needs a second person; cash sales must not be duplicated as cash-in."],
  }),
  featureCapability({
    id: "pos.returns", module: "pos", route: "/admin/pos-manual",
    title: ["คืนสินค้า Void และคืนไม่มีบิล", "POS returns, voids, and blind returns"], description: ["รองรับ return, void และคืนไม่มีใบเสร็จด้วย guard แยกกัน", "Supports returns, voids, and no-receipt returns with separate guards."],
    aliases: [["คืนสินค้า", "void", "คืนไม่มีบิล"], ["return", "void", "no receipt return"]], status: "CONDITIONAL", anyOfPermissions: ["order.return", "pos.void", "pos.return.noreceipt"],
    dependencies: ["The original sale or required blind-return evidence and approval must be available."], limitations: ["Void ไม่ใช่ Return และส่วนลดราคาส่งถูกคำนวณใหม่เมื่อคืนบางส่วน", "Void is not Return, and wholesale eligibility is recalculated for partial returns."],
  }),
  featureCapability({
    id: "tax.documents", module: "tax", route: "/admin/pos-manual",
    title: ["เอกสารภาษีจาก POS", "POS tax documents"], description: ["ออกและดูเอกสารภาษีที่ผูกกับการขาย", "Issue and view tax documents tied to a sale."],
    aliases: [["ใบกำกับภาษี", "VAT", "เอกสารภาษี"], ["tax invoice", "VAT", "tax document"]], status: "CONDITIONAL", anyOfPermissions: ["tax.document.view", "tax.document.issue"],
    dependencies: ["Tax settings and required customer/business fields must be configured."], limitations: ["เอกสารที่ออกแล้ว immutable; การยกเลิกต้องเกิดกับ reversal ที่ถูกต้อง", "Issued documents are immutable; cancellation follows the proper reversal."],
  }),
  featureCapability({
    id: "tax.etax", module: "etax", route: "/admin/pos-manual",
    title: ["คิวส่ง e-Tax", "e-Tax submission queue"], description: ["เตรียมเอกสารที่ผ่านเงื่อนไขเข้าคิวส่ง e-Tax แบบ gated", "Queue eligible documents for gated e-Tax submission."],
    aliases: [["e-tax", "ส่งสรรพากร", "ภาษีอิเล็กทรอนิกส์"], ["e-tax", "electronic tax", "revenue department"]],
    // Built and gated off by default, but no signing/submission provider has ever been verified
    // end to end. CONDITIONAL would read as "just switch it on", which is not true yet.
    status: "BETA", anyOfPermissions: ["etax.view", "etax.manage"],
    dependencies: ["Tax configuration, e-Tax integration, permission, and scheduled-job authorization are required."], limitations: ["ยังไม่มีผู้ให้บริการลงลายมือชื่อ/ยื่นที่ผ่านการยืนยันจริง ห้ามยืนยันกับร้านว่ายื่นสรรพากรได้แล้ว", "No signing/submission provider has been verified end to end; never confirm that filing works."],
  }),
  featureCapability({
    id: "settings.marketplaces", module: "settings", route: "/admin/settings",
    title: ["ขายผ่าน Marketplace (Shopee/Lazada)", "Marketplace channels (Shopee/Lazada)"],
    description: ["รับออร์เดอร์และข้อความจาก Shopee/Lazada เข้าระบบเดียวกับช่องทางอื่น", "Bring Shopee/Lazada orders and messages into the same pipeline as other channels."],
    aliases: [["shopee", "lazada", "marketplace", "ขายในแอป"], ["shopee", "lazada", "marketplace", "open platform"]],
    // Webhook signature verification is still a TikTok-shaped HMAC placeholder that has never been
    // checked against the real Open Platform docs — that is beta, not merely "needs configuring".
    status: "BETA",
    dependencies: ["Open Platform credentials plus signature verification confirmed against the live provider documentation."],
    limitations: ["การตรวจลายเซ็น webhook ยังไม่ได้ยืนยันกับเอกสารจริงของ Open Platform ห้ามใช้กับร้านจริงจนกว่าจะยืนยัน", "Webhook signature verification is unverified against the real Open Platform docs; do not run a live shop on it yet."],
  }),
  featureCapability({
    id: "pos.hardware-printing", module: "pos", route: "/admin/pos-manual",
    title: ["พิมพ์ใบเสร็จ ESC/POS และเปิดลิ้นชัก", "ESC/POS receipt printing and cash drawer"],
    description: ["สั่งพิมพ์ใบเสร็จและเปิดลิ้นชักผ่านคำสั่ง ESC/POS จากเครื่องขาย", "Drive receipt printing and the cash drawer with ESC/POS commands from the register."],
    aliases: [["ปริ้นใบเสร็จ", "เครื่องพิมพ์สลิป", "เปิดลิ้นชัก", "ESC/POS"], ["receipt printer", "print receipt", "cash drawer", "ESC/POS"]],
    // Written but never run against a real printer or drawer — see CLAUDE.md build status.
    status: "BETA", requiredPermissions: ["pos.sell"],
    dependencies: ["A physical ESC/POS printer and cash drawer wired to the register."],
    limitations: ["ยังไม่เคยทดสอบกับฮาร์ดแวร์จริง ร้านที่เปิดใช้ต้องทดสอบเองก่อนวันขายจริง", "Never tested against real hardware; a shop must validate its own printer and drawer before going live."],
  }),
  featureCapability({
    id: "settings.byok", module: "settings", route: "/admin/settings",
    title: ["ตั้ง AI Provider ของร้านเอง", "Bring your own AI provider key"], description: ["ร้านตั้ง provider/model/key ของตนเองจาก Settings ได้", "A shop can configure its own provider, model, and key in Settings."],
    aliases: [["BYOK", "ตั้ง api key AI", "เปลี่ยนโมเดล"], ["BYOK", "AI API key", "change model"]], status: "CONDITIONAL",
    dependencies: ["A supported provider credential and sufficient quota are required."], limitations: ["ห้ามเปิดเผย key ในคำตอบ log หรือ client และการเปลี่ยน provider ไม่ขยายสิทธิ์ทูล", "Keys never appear in answers, logs, or clients; changing provider does not widen tool access."],
  }),
  featureCapability({
    id: "pharmacy.evidence", module: "pharmacy", route: "/admin/pharmacy-queue",
    title: ["หลักฐานทางคลินิกแบบจำกัดสิทธิ์", "Restricted clinical evidence"], description: ["แนบและอ่านหลักฐานของเคสผ่าน endpoint เฉพาะที่ตรวจ tenant และสิทธิ์", "Attach and read case evidence through a dedicated tenant- and permission-checked endpoint."],
    aliases: [["รูปใบสั่งยา", "หลักฐานเคสยา", "clinical evidence"], ["prescription image", "pharmacy evidence", "clinical evidence"]], status: "CONDITIONAL", requiredPermissions: ["pharmacy.evidence.read"],
    dependencies: ["Pharmacy intake must be enabled and the actor must have the evidence-specific permission."], limitations: ["Manager ที่อ่านเคสได้อาจเปิดหลักฐานไม่ได้ และ AI ไม่ได้รับ file_id", "A Manager may read the case but not its evidence; AI never receives file_id."],
  }),
] as const;
