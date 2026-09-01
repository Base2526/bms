// =============================================================
// "ใครอนุมัติงานนี้ได้" — คำตอบเดียวที่หน้าเคาน์เตอร์ต้องการ
// -------------------------------------------------------------
// เดิมทุกการปฏิเสธสิทธิ์ที่ /api/pos/* พูดอย่างเดียวว่า "พนักงานคนนี้ไม่มีสิทธิ์<ทำอะไร>"
// ซึ่งบอกว่าทำอะไรไม่ได้ แต่ไม่บอกว่าใครทำได้ หรือต้องไปขออะไร · และแย่กว่านั้นคือ
// dropdown ผู้อนุมัติที่หน้าขายกรองแค่ "มี PIN" กับ "ไม่ใช่ตัวเอง" ไม่เคยกรองว่าคนนั้น
// อนุมัติงานนี้ได้จริงไหม
//
// ลำดับที่เกิดขึ้นจริง: แคชเชียร์เลือกชื่อหัวหน้า → เดินไปตาม → หัวหน้ามากด PIN ต่อหน้า
// ลูกค้า → เพิ่งรู้ว่าไม่มีสิทธิ์ → เดินไปตามคนใหม่ · ระบบรู้คำตอบตั้งแต่ก่อนเลือกอยู่แล้ว
//
// ⚠️ รายชื่อที่กรองแล้วเป็น **UX ไม่ใช่ด่าน** — ทุก route ยังตรวจสิทธิ์ของผู้อนุมัติซ้ำ
// ฝั่ง server เสมอ การกรองที่จอทำให้เลือกถูกตั้งแต่แรก ไม่ได้ทำให้ปลอดภัยขึ้น
//
// ⚠️ ไม่โชว์ชื่อ permission ดิบให้แคชเชียร์อ่าน — "pos.return.noreceipt" ไม่มีความหมาย
// กับคนหน้าเคาน์เตอร์ · ข้อความบอกเป็นชื่อ role ที่ทำได้จริงในร้านนี้ ส่วนชื่อสิทธิ์เก็บไว้
// ให้ผู้ดูแลอ่านที่ /admin/permissions
// =============================================================

import { query } from "@/lib/db";
import { BMS_PERMISSIONS, type BmsPermission } from "./permissions";

/**
 * สิทธิ์ที่ "คนที่สอง" ต้องมีเพื่ออนุมัติงานที่หน้าเคาน์เตอร์
 *
 * เฉพาะงานที่มีทางไปต่อจริงด้วยการให้คนอื่นกด PIN — งานที่บล็อกตายตัว (เปิดกะ/คืนของ/
 * ดูสรุปกะ) ไม่อยู่ในนี้ เพราะไม่มี dropdown ให้กรอง แต่ยังใช้ข้อความเดียวกันได้
 *
 * ⚠️ ไม่รวมการอนุมัติของเภสัชกร: ด่านนั้นคือ **ใบอนุญาต** (`users.is_licensed_pharmacist`)
 * ไม่ใช่ permission · เขียนรวมมาที่นี่จะกลายเป็นบอกความจริงผิดว่า "ขอสิทธิ์แล้วจ่ายยาได้"
 */
export const POS_APPROVAL_PERMISSIONS = [
  "pos.void",
  "pos.return.noreceipt",
  "pos.cash.movement",
  "pos.discount.approve",
  // การคืนตั้งแต่ ฿500 ต้องมีผู้อนุมัติ และสิทธิ์ที่ใช้คือ payment.refund ไม่ใช่ order.return
  // (`approvalRuleForRefundAmount`) — คนละตัวกับสิทธิ์ที่ใช้ "รับคืน" ตามปกติ
  "payment.refund",
  "pos.return.cross_branch",
  "ar.sell",
  "purchase.receive",
] as const satisfies readonly BmsPermission[];

export type PosApprovalPermission = (typeof POS_APPROVAL_PERMISSIONS)[number];

/** ชื่องานภาษาคน สำหรับประกอบข้อความที่แคชเชียร์อ่านแล้วรู้ว่าต้องไปตามใคร */
const ACTION_LABEL_TH: Record<string, string> = {
  "pos.void": "ยกเลิกบิล",
  "pos.return.noreceipt": "อนุมัติการคืนที่ไม่มีใบเสร็จ",
  "pos.cash.movement": "อนุมัติเงินออกจากลิ้นชัก",
  "pos.discount.approve": "อนุมัติส่วนลด",
  "payment.refund": "อนุมัติการคืนเงิน",
  "pos.return.cross_branch": "อนุมัติการคืนข้ามสาขา",
  "ar.sell": "ขายเชื่อ",
  "ar.collect": "รับชำระหนี้",
  "ar.view": "ดูข้อมูลลูกหนี้",
  "purchase.receive": "รับสินค้าเข้า",
  "pos.sell": "ขายหน้าร้าน",
  "pos.nosale": "เปิดลิ้นชักโดยไม่ขาย",
  "pos.deposit.take": "รับมัดจำ",
  "pos.shift.open": "เปิดกะ",
  "pos.shift.close": "ปิดกะ",
  "pos.shift.report": "ดูสรุปกะ",
  "pos.expense.create": "ทำรายการค่าใช้จ่าย",
  "pos.expense.personal": "ใช้โหมดเจ้าของคนเดียว",
  "pos.petty_cash.manage": "เติมเงินสดย่อย",
  "order.return": "คืนสินค้า",
  "member.manage": "สมัครสมาชิก",
  "storecredit.redeem": "รับบัตรของขวัญ",
  "restaurant.floor.manage": "ตั้งค่าผังโต๊ะ",
  "restaurant.kitchen.update": "อัปเดตคิวครัว",
  "restaurant.check.cancel": "ยกเลิกบิลโต๊ะ",
};

export function posActionLabel(permission: string): string {
  return ACTION_LABEL_TH[permission] ?? permission;
}

/**
 * role ในร้านนี้ที่ถือสิทธิ์นี้จริง
 *
 * `Administrator` ได้ทุกสิทธิ์โดยปริยายและ **ไม่มีแถวใน `bms_role_permissions`** —
 * ลืมรวมเมื่อไหร่ เจ้าของร้านจะหายจากคำตอบทั้งที่อนุมัติได้ (กฎเดียวกับ `cashierHasPermission`)
 */
export async function rolesWithPermission(tenantId: string, permission: string): Promise<string[]> {
  const res = await query<{ name: string }>(
    `SELECT r.name
       FROM roles r
      WHERE r.name = 'Administrator'
         OR EXISTS (
           SELECT 1 FROM bms_role_permissions rp
            WHERE rp.tenant_id = $1 AND rp.role_id = r.id AND rp.permission = $2
         )
      ORDER BY (r.name <> 'Administrator'), r.name`,
    [tenantId, permission]
  );
  return res.rows.map((row) => row.name).filter(Boolean);
}

/**
 * ข้อความปฏิเสธสิทธิ์ที่บอกทางไปต่อ
 *
 * `secondPerson` = งานนี้ให้คนอื่นเดินมากด PIN ได้ · ถ้าไม่ใช่ ทางเดียวคือให้ผู้ดูแล
 * เพิ่มสิทธิ์ให้บัญชีนี้ ซึ่งต้องบอกไปตรง ๆ ไม่ใช่ปล่อยให้ยืนงงอยู่หน้าเครื่อง
 */
export async function posPermissionDeniedMessage(
  tenantId: string,
  permission: string,
  options?: { secondPerson?: boolean; subject?: string }
): Promise<string> {
  const subject = options?.subject ?? "พนักงานคนนี้";
  const action = posActionLabel(permission);
  let roles: string[] = [];
  try {
    roles = await rolesWithPermission(tenantId, permission);
  } catch {
    // ตอบว่าไม่มีสิทธิ์ให้ได้เสมอ แม้จะบอกไม่ได้ว่าใครมี — คำถามหลักคือ "ทำได้ไหม"
    roles = [];
  }
  const who = roles.length ? `ในร้านนี้คนที่ทำได้คือ ${roles.join(" / ")}` : "";
  const next = options?.secondPerson
    ? [who, "ให้คนที่มีสิทธิ์เดินมากด PIN อนุมัติ"].filter(Boolean).join(" · ")
    : [who, "ถ้าต้องการให้บัญชีนี้ทำเองได้ ให้ผู้ดูแลเพิ่มสิทธิ์ที่ /admin/permissions"]
        .filter(Boolean)
        .join(" · ");
  return `${subject}ไม่มีสิทธิ์${action}${next ? ` — ${next}` : ""}`;
}

/** กันพิมพ์ผิดในแคตตาล็อกข้างบน: ทุกสิทธิ์ที่อ้างถึงต้องมีอยู่จริง */
export function unknownPosPermissions(): string[] {
  const known = new Set<string>(BMS_PERMISSIONS as readonly string[]);
  return Object.keys(ACTION_LABEL_TH).filter((permission) => !known.has(permission));
}
