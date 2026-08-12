// =============================================================
// BMS RBAC — role rank (ใครจัดการใครได้)
// -------------------------------------------------------------
// permission (`user.view`/`user.manage`) ตอบว่า "เปิดหน้า Users ได้ไหม"
// ไฟล์นี้ตอบว่า "แตะแถวไหนได้ และ assign role ไหนได้" — คนละชั้นกัน
// ต้องมีทั้งสองชั้น: ถ้า Administrator ของร้านไปเปิด `user.manage` ให้ Sales
// rank ก็ยังจำกัดไม่ให้ Sales แตะ Manager/Administrator อยู่
//
// ⚠️ ไฟล์นี้ต้อง import ได้จาก client component (dropdown เลือก role)
//    → **ห้าม import `@/lib/db` หรืออะไรที่เป็น server-only**
//    (pattern เดียวกับ `productImport.constants.ts` ที่แยกไว้ด้วยเหตุผลนี้)
//
// ⚠️ role ที่ไม่อยู่ในตารางนี้ = จัดการ/assign ไม่ได้ (fail closed) เพราะ
//    (1) `roles` เป็นตารางกลางทั้งแพลตฟอร์ม platform admin เพิ่มได้ทีหลัง และ
//    (2) trigger `trg_users_sync_role_and_role_id`
//        (db/migrations/001_normalize_roles_phase1.sql) จะ auto-create role ใหม่
//        จาก text ที่ไม่รู้จัก — ถ้าให้ค่า default เป็น rank ต่ำ ๆ ชื่อที่หลุดมาจะ
//        กลายเป็น "จัดการได้" ทันที
//    เพิ่ม role จริงใหม่ในระบบ → ต้องมาเพิ่ม rank ที่นี่ด้วย ไม่งั้นจะ assign ไม่ได้
// =============================================================

/** rank สูง = จัดการ rank ที่ต่ำกว่าได้ · ตัวเลขเว้นช่องไว้เผื่อแทรก role ใหม่ */
export const STAFF_ROLE_RANK: Record<string, number> = {
  Administrator: 100, // super ของร้าน (และเป็น super ใน loadPermissions() ด้วย)
  Manager: 60, // เจ้าของร้าน/ผู้จัดการ — จัดการทีมงานหน้าร้านได้
  Sales: 20,
  Warehouse: 20,
  Staff: 20, // legacy จาก 1.24__roles.sql
  Subscriber: 0, // บัญชีสาธารณะ (community) ไม่มีสิทธิ์หลังบ้าน
};

/** role ที่ไม่รู้จัก — ห้ามใช้เทียบ rank ตรง ๆ ต้องเช็ค isKnownStaffRole() ก่อน */
export const UNRANKED_ROLE = -1;

const SUPER_ROLE = "Administrator";

export function staffRoleRank(name?: string | null): number {
  if (!name) return UNRANKED_ROLE;
  const rank = STAFF_ROLE_RANK[name.trim()];
  return typeof rank === "number" ? rank : UNRANKED_ROLE;
}

export function isKnownStaffRole(name?: string | null): boolean {
  return staffRoleRank(name) !== UNRANKED_ROLE;
}

/**
 * actor จัดการ user ที่ถือ role นี้ได้ไหม
 *
 * - Administrator → true เสมอ (super — รักษาพฤติกรรมเดิมไว้ทุกอย่าง รวมถึงแก้
 *   Administrator คนอื่นและแก้ตัวเอง)
 * - นอกนั้น: ต้องรู้จัก role ทั้งสองฝั่ง และเป้าหมายต้อง **ต่ำกว่าเท่านั้น** (ไม่ใช่เท่ากัน)
 *
 * ที่ใช้ `<` ไม่ใช่ `<=` เพราะกฎเดียวปิดสามช่องพร้อมกัน: ยกระดับ role ตัวเอง,
 * รีเซ็ตรหัสผ่าน Manager คนอื่น, และลด role Manager คนอื่น
 */
export function canManageStaffRole(actorRole?: string | null, targetRole?: string | null): boolean {
  if (actorRole?.trim() === SUPER_ROLE) return true;
  const actor = staffRoleRank(actorRole);
  const target = staffRoleRank(targetRole);
  if (actor === UNRANKED_ROLE || target === UNRANKED_ROLE) return false;
  return target < actor;
}

/**
 * กรอง role ที่ actor assign ให้คนอื่นได้ (ใช้กับ dropdown ในหน้า users)
 * Administrator ได้ทุกตัวจาก `Query.roles` เหมือนเดิม รวม role ที่ไม่อยู่ใน rank map
 *
 * ⚠️ นี่เป็นแค่การกรอง UI — ตัวบังคับจริงคือ `resolveAssignableRole()` ฝั่ง server
 */
export function assignableStaffRoles(
  actorRole: string | null | undefined,
  allRoleNames: string[]
): string[] {
  if (actorRole?.trim() === SUPER_ROLE) return allRoleNames;
  return allRoleNames.filter((name) => canManageStaffRole(actorRole, name));
}

export type UserAdminPolicyActor = {
  /** Platform admin outside drill-down mode. */
  platform: boolean;
  tenantId: string;
  role: string;
};

export type UserAdminPolicyTarget = {
  tenantId: string | null;
  role: string | null;
  isPlatformAdmin: boolean;
};

/** Shared tenant + privileged-account visibility policy used by API and tests. */
export function canViewUserTarget(
  actor: UserAdminPolicyActor,
  target: UserAdminPolicyTarget
): boolean {
  if (!actor.platform && target.tenantId !== actor.tenantId) return false;
  // A tenant-scoped screen must not disclose the platform identities that
  // happen to carry that tenant_id for legacy/bootstrap reasons.
  if (!actor.platform && target.isPlatformAdmin) return false;
  return true;
}

/** Full row-level policy after the caller has passed user.manage. */
export function canManageUserTarget(
  actor: UserAdminPolicyActor,
  target: UserAdminPolicyTarget
): boolean {
  if (!canViewUserTarget(actor, target)) return false;
  if (target.isPlatformAdmin) return false;
  if (actor.platform || actor.role.trim() === SUPER_ROLE) return true;
  return canManageStaffRole(actor.role, target.role);
}
