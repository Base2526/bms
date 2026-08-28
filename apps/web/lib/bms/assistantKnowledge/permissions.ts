import type { AssistantLocale } from "./types";

const MODULE_LABELS: Record<string, { th: string; en: string }> = {
  product: { th: "สินค้า", en: "Products" }, stock: { th: "สต็อก", en: "Stock" },
  inventory: { th: "คลังและสาขา", en: "Inventory" }, order: { th: "ออร์เดอร์", en: "Orders" },
  purchase: { th: "จัดซื้อ", en: "Purchasing" }, payment: { th: "การชำระเงิน", en: "Payments" },
  shipping: { th: "การจัดส่ง", en: "Shipping" }, inbox: { th: "กล่องข้อความ", en: "Inbox" },
  customer: { th: "ลูกค้า", en: "Customers" }, report: { th: "รายงาน", en: "Reports" },
  user: { th: "ผู้ใช้งาน", en: "Users" }, coupon: { th: "คูปอง", en: "Coupons" },
  member: { th: "สมาชิก", en: "Membership" }, loyalty: { th: "แต้มสะสม", en: "Loyalty" },
  followup: { th: "ติดตามลูกค้า", en: "Follow-up" }, retention: { th: "รักษาฐานลูกค้า", en: "Retention" },
  pharmacy: { th: "ร้านขายยา", en: "Pharmacy" }, location: { th: "สาขา", en: "Locations" },
  pos: { th: "POS", en: "POS" }, commission: { th: "ค่าคอม", en: "Commission" },
  tax: { th: "ภาษี", en: "Tax" }, etax: { th: "e-Tax", en: "e-Tax" },
  ar: { th: "ลูกหนี้", en: "Receivables" }, storecredit: { th: "เครดิตร้าน", en: "Store credit" },
  ai_quality: { th: "คุณภาพ AI", en: "AI quality" }, action: { th: "คำแนะนำการดำเนินงาน", en: "Actions" },
};

const ACTION_LABELS: Record<string, { th: string; en: string }> = {
  view: { th: "ดู", en: "view" }, read: { th: "อ่าน", en: "read" }, edit: { th: "แก้ไข", en: "edit" },
  create: { th: "สร้าง", en: "create" }, delete: { th: "ลบ", en: "delete" }, manage: { th: "จัดการ", en: "manage" },
  adjust: { th: "ปรับ", en: "adjust" }, confirm: { th: "ยืนยัน", en: "confirm" }, refund: { th: "คืนเงิน", en: "refund" },
  cancel: { th: "ยกเลิก", en: "cancel" }, return: { th: "คืนสินค้า", en: "return" }, receive: { th: "รับเข้า", en: "receive" },
  ship: { th: "จัดส่ง", en: "ship" }, submit: { th: "ส่งตรวจ", en: "submit" }, reply: { th: "ตอบ", en: "reply" },
  assign: { th: "มอบหมาย", en: "assign" }, approve: { th: "อนุมัติ", en: "approve" }, reject: { th: "ปฏิเสธ", en: "reject" },
  sell: { th: "ขาย", en: "sell" }, collect: { th: "รับชำระ", en: "collect" }, writeoff: { th: "ตัดหนี้สูญ", en: "write off" },
  settings: { th: "ตั้งค่า", en: "configure" }, email: { th: "ส่งอีเมล", en: "email" }, transfer: { th: "โอน", en: "transfer" },
  count: { th: "นับ", en: "count" }, issue: { th: "ออก", en: "issue" }, redeem: { th: "แลกใช้", en: "redeem" },
};

export function groupPermissionDescriptions(permissions: readonly string[], locale: AssistantLocale) {
  const groups = new Map<string, { module: string; actions: Set<string>; permissions: string[] }>();
  for (const permission of [...permissions].sort()) {
    const [moduleKey, ...actionParts] = permission.split(".");
    const module = MODULE_LABELS[moduleKey]?.[locale] ?? moduleKey;
    const action = actionParts.map((part) => ACTION_LABELS[part]?.[locale] ?? part).join(locale === "th" ? " / " : " ");
    const current = groups.get(moduleKey) ?? { module, actions: new Set<string>(), permissions: [] };
    current.actions.add(action);
    current.permissions.push(permission);
    groups.set(moduleKey, current);
  }
  return [...groups.values()].map((group) => ({
    module: group.module,
    actions: [...group.actions],
    permissions: group.permissions,
  }));
}
