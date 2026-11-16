// =============================================================
// BMS — ตัวบังคับ role rank ฝั่ง server สำหรับหน้าจัดการผู้ใช้
// -------------------------------------------------------------
// คู่กับ `staffRoles.ts` (pure, client ใช้ได้) — ไฟล์นี้แตะ DB จึงแยกออกมา
//
// หลักการที่ห้ามเปลี่ยน:
// 1. role ของเป้าหมาย **อ่านสดจาก DB เสมอ** ไม่เชื่อค่าที่ client ส่งมา
// 2. platform admin (`is_platform_admin`) แตะไม่ได้เลยไม่ว่า rank จะเป็นอะไร —
//    platform admin เป็นแถว `users` ธรรมดาที่มี `tenant_id` ด้วย ถ้าแถวนั้นบังเอิญ
//    อยู่ในร้านของ Manager และถือ role ต่ำ ๆ (เช่น Sales) กฎ rank เพียว ๆ จะบอกว่า
//    "จัดการได้" แล้ว Manager รีเซ็ตรหัสผ่านทับ = ยึดบัญชี platform admin ได้ทันที
// 3. ชื่อ role ที่ไม่รู้จัก = ปฏิเสธก่อนเขียน DB — เพราะ trigger
//    `trg_users_sync_role_and_role_id` จะ INSERT role ใหม่เข้าตารางกลางให้เอง
//    จาก text ที่ไม่ match (ดู db/migrations/001_normalize_roles_phase1.sql:149-205)
// 4. `platform === true` หรือ actor เป็น Administrator → ข้ามทุกด่านในไฟล์นี้
//    เพื่อรักษาพฤติกรรมเดิมของ platform admin / Administrator ไว้ทุกจุด
// =============================================================

import { GraphQLError } from "graphql/error";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { audit } from "./audit";
import { canManageStaffRole, canManageUserTarget } from "./staffRoles";

export type UserAdminGate = {
  /** platform admin ที่ไม่ได้ drill-down เข้าร้านใดร้านหนึ่ง */
  platform: boolean;
  tenantId: string;
  actorId: string;
  actorRole: string;
  /** Administrator ของร้าน = super */
  isSuper: boolean;
};

export type ManagedUserRow = {
  id: string;
  tenant_id: string | null;
  role: string | null;
  is_platform_admin: boolean;
};

/** Staff contact fields are available only to self or a user.view-authorized roster read. */
export function canReadStaffContact(
  row: { id?: string | number; tenant_id?: string | null; __staffContactVisible?: boolean },
  ctx: { user?: { id?: string | number }; admin?: { id?: string | number } }
): boolean {
  if (!row.tenant_id) return true;
  return row.__staffContactVisible === true ||
    String(row.id) === String(ctx?.user?.id ?? ctx?.admin?.id ?? "");
}
const USER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Commit the team-account audit with the account change it describes. */
export async function auditUserChangeInTx(
  client: PoolClient,
  tenantId: string,
  actorId: string,
  action: string,
  targetId: string,
  meta: Record<string, unknown>
): Promise<void> {
  await client.query("SELECT set_config('bms.tenant_id', $1, true)", [tenantId]);
  await client.query(
    `INSERT INTO bms_audit_log(tenant_id, actor, action, target, meta)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [tenantId, actorId, action, targetId, JSON.stringify(meta)]
  );
}

/** Keep open work visible: an account with live assignments must be handed over first. */
export async function assertNoActiveStaffAssignments(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<void> {
  await client.query("SELECT set_config('bms.tenant_id', $1, true)", [tenantId]);
  const checks = [
    ["bms_operation_runs", "assigned_to = $2 AND status NOT IN ('APPROVED','VOID')", "รายการตรวจงาน"],
    ["bms_operation_actions", "assigned_to = $2 AND status NOT IN ('RESOLVED','VERIFIED')", "งานแก้ไข"],
    ["bms_operation_schedules", "assigned_to = $2 AND active = TRUE", "ตารางงานประจำ"],
    ["bms_operation_rosters", "assigned_to = $2 AND status = 'PUBLISHED' AND ends_at > now()", "ตารางเวร"],
    ["bms_operation_handovers", "(recipient = $2 AND status = 'SUBMITTED') OR (sender = $2 AND status = 'DRAFT')", "งานส่งต่อเวร"],
    ["bms_operation_policies", "supervisor_id = $2 AND enabled = TRUE", "ผู้รับแจ้งเตือนงาน"],
    ["bms_operation_escalations", "recipient = $2 AND status = 'OPEN'", "งานติดตาม"],
    ["bms_operation_quality_cases", "assigned_to = $2 AND status <> 'CLOSED'", "เคสคุณภาพ"],
  ] as const;
  for (const [table, predicate, label] of checks) {
    const exists = await client.query<{ present: string | null }>(
      "SELECT to_regclass($1) AS present", [`public.${table}`]
    );
    if (!exists.rows[0]?.present) continue; // Older installations may not have operations yet.
    const found = await client.query(
      `SELECT 1 FROM ${table} WHERE tenant_id = $1 AND (${predicate}) LIMIT 1`,
      [tenantId, userId]
    );
    if (found.rowCount) {
      throw new GraphQLError(`ลบผู้ใช้นี้ไม่ได้: ยังมี${label}ที่มอบหมายอยู่ กรุณาส่งต่องานก่อน`, {
        extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
      });
    }
  }
}

/** Serialize Administrator removals so concurrent edits cannot leave a shop ownerless. */
export async function assertAdministratorRemains(
  client: PoolClient,
  tenantId: string,
  removingIds: string[]
): Promise<void> {
  if (removingIds.length === 0) return;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 741))", [tenantId]);
  const remaining = await client.query(
    `SELECT 1 FROM users
      WHERE tenant_id = $1 AND role = 'Administrator' AND is_platform_admin = FALSE
        AND id <> ALL($2::uuid[]) LIMIT 1`,
    [tenantId, removingIds]
  );
  if (!remaining.rowCount) {
    throw new GraphQLError("ร้านต้องมี Administrator อย่างน้อยหนึ่งบัญชี", {
      extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
    });
  }
}

/** Apply the same account rank boundary to POS staff changes as to team edits. */
export async function assertManageablePosAccountInTx(
  client: PoolClient,
  tenantId: string,
  targetId: string,
  actorId: string
): Promise<void> {
  const target = await client.query<ManagedUserRow>(
    `SELECT id, tenant_id, role, is_platform_admin FROM users
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, targetId]
  );
  const row = target.rows[0];
  if (!row) throw notFound();
  const actor = await client.query<ManagedUserRow>(
    "SELECT id, tenant_id, role, is_platform_admin FROM users WHERE id = $1", [actorId]
  );
  const current = actor.rows[0];
  if (!current || (!current.is_platform_admin && current.tenant_id !== tenantId)) {
    throw forbidden("ไม่มีสิทธิ์จัดการบัญชีนี้");
  }
  if (row.id === actorId) return;
  if (!canManageUserTarget(
    { platform: current.is_platform_admin, tenantId, role: current.role ?? "" },
    { tenantId: row.tenant_id, role: row.role, isPlatformAdmin: row.is_platform_admin }
  )) throw forbidden("ไม่มีสิทธิ์จัดการบัญชีนี้");
}

export function explainUserDeleteFailure(error: unknown): never {
  if ((error as { code?: string })?.code === "23503") {
    throw new GraphQLError("ลบบัญชีนี้ไม่ได้ เพราะมีประวัติการทำรายการที่ต้องเก็บไว้ กรุณาคงบัญชีและปรับสิทธิ์ตามนโยบายร้าน", {
      extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
    });
  }
  throw error;
}

/** ข้ามด่าน rank ทั้งหมด (platform admin / Administrator) */
function bypasses(gate: UserAdminGate): boolean {
  return gate.platform || gate.isSuper;
}

function forbidden(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", http: { status: 403 } },
  });
}

/**
 * ใช้ข้อความ/โค้ดเดียวกับที่ `uploadAvatar` ใช้อยู่แล้ว เพื่อให้การยิงเดา id ข้ามร้าน
 * แยกไม่ออกจาก id ที่ไม่มีจริง (ไม่บอกใบ้ว่ามีผู้ใช้คนนี้อยู่ในร้านอื่น)
 */
function notFound(): GraphQLError {
  return new GraphQLError("user not found in current tenant", {
    extensions: { code: "NOT_FOUND", http: { status: 404 } },
  });
}

async function loadTarget(
  gate: UserAdminGate,
  targetId: string,
  client?: PoolClient,
  lock = false
): Promise<ManagedUserRow | null> {
  if (!USER_UUID_RE.test(targetId)) return null;
  const lockSql = lock ? " FOR UPDATE" : "";
  const sql = gate.platform
    ? `SELECT id, tenant_id, role, is_platform_admin FROM users WHERE id = $1${lockSql}`
    : `SELECT id, tenant_id, role, is_platform_admin FROM users WHERE id = $1 AND tenant_id = $2${lockSql}`;
  const params = gate.platform ? [targetId] : [targetId, gate.tenantId];
  const res = client
    ? await client.query<ManagedUserRow>(sql, params)
    : await query<ManagedUserRow>(sql, params);
  return res.rows[0] ?? null;
}

/**
 * เป้าหมายต้องอยู่ในร้านเดียวกัน (ถ้าไม่ใช่ platform) และ actor ต้องมี rank สูงกว่า
 * คืนแถวที่โหลดมาให้ caller ใช้ต่อ (เช่น `deleteUser` ต้องใช้ `tenant_id` เพื่อโอนแชท)
 */
export async function requireManageableTarget(
  ctx: any,
  gate: UserAdminGate,
  targetId: string,
  client?: PoolClient,
  allowSelf = false
): Promise<ManagedUserRow> {
  const row = await loadTarget(gate, targetId, client, Boolean(client));
  if (!row) throw notFound();
  if (allowSelf && row.id === gate.actorId) return row;
  await assertManageable(ctx, gate, row);
  return row;
}

/** ตรวจ rank/platform-admin ของแถวที่โหลดมาแล้ว — throw ถ้าแตะไม่ได้ */
async function assertManageable(ctx: any, gate: UserAdminGate, row: ManagedUserRow): Promise<void> {
  // platform admin แตะไม่ได้ ไม่ว่า role ที่ถืออยู่จะต่ำแค่ไหน (ดูหมายเหตุข้อ 2 ด้านบน)
  if (row.is_platform_admin) {
    await audit(ctx, "user.manage_denied", row.id, {
      reason: "target_is_platform_admin",
      actorRole: gate.actorRole,
    });
    throw forbidden("บัญชีนี้เป็นผู้ดูแลระบบระดับแพลตฟอร์ม จัดการจากที่นี่ไม่ได้");
  }

  if (!canManageUserTarget(
    { platform: gate.platform, tenantId: gate.tenantId, role: gate.actorRole },
    { tenantId: row.tenant_id, role: row.role, isPlatformAdmin: row.is_platform_admin }
  )) {
    await audit(ctx, "user.manage_denied", row.id, {
      reason: "insufficient_role_rank",
      actorRole: gate.actorRole,
      targetRole: row.role,
    });
    throw forbidden(
      `จัดการผู้ใช้ที่มีบทบาท "${row.role ?? "-"}" ไม่ได้ (บทบาทของคุณคือ "${gate.actorRole}")`
    );
  }
}

/**
 * เวอร์ชัน batch — ปฏิเสธทั้งชุดเมื่อแถวใดหายไป อยู่ร้านอื่น หรือแตะไม่ได้
 * เพื่อไม่ให้คำขอลบหลายคนรายงานสำเร็จทั้งที่ลบเพียงบางคนเงียบ ๆ
 */
export async function requireManageableTargets(
  ctx: any,
  gate: UserAdminGate,
  targetIds: string[],
  client?: PoolClient
): Promise<ManagedUserRow[]> {
  const rows: ManagedUserRow[] = [];
  for (const id of targetIds) {
    const row = await loadTarget(gate, id, client, Boolean(client));
    if (!row) throw notFound();
    await assertManageable(ctx, gate, row);
    rows.push(row);
  }
  return rows;
}

/**
 * แปลง role ที่ client ส่งมา (`role_id` หรือชื่อเป็น text) ให้เป็น role จริงในตาราง
 * แล้วค่อยตรวจสิทธิ์ **จากชื่อที่ resolve ได้** ไม่ใช่จาก input ดิบ
 *
 * ⚠️ จุดที่พลาดง่ายสุดของฟีเจอร์นี้: `upsertUser` รับ role ได้ 2 ทาง ถ้าตรวจแค่
 *    `role_id` จะเปิดช่องให้ส่ง `role: "Administrator"` เป็น text ผ่านไปได้เลย
 *
 * คืน `null` เมื่อไม่ได้ส่ง role มาเลยและไม่มี fallback (= ไม่ต้องแก้ role)
 */
export async function resolveAssignableRole(
  ctx: any,
  gate: UserAdminGate,
  input: { role_id?: string | null; role?: string | null },
  opts: { fallbackName?: string; unchangedSelfRoleName?: string } = {},
  client?: PoolClient
): Promise<{ roleId: string; roleName: string } | null> {
  const roleId = input.role_id ? String(input.role_id) : null;
  const roleText = input.role ? String(input.role).trim() : null;
  const wanted = roleText || opts.fallbackName || null;

  if (!roleId && !wanted) return null;

  const run = client ? client.query.bind(client) : query;
  const lockSql = client ? " FOR SHARE" : "";
  const res = roleId
    ? await run(`SELECT id, name FROM roles WHERE id = $1 AND is_active = TRUE${lockSql}`, [roleId])
    : await run(
        `SELECT id, name FROM roles WHERE name = btrim($1) AND is_active = TRUE${lockSql}`,
        [wanted]
      );

  const row = res.rows[0];
  // ชื่อ/id ที่ไม่มีจริง → ปฏิเสธก่อนถึง DB (ปิดช่อง trigger auto-create ข้อ 3 ด้านบน)
  if (!row) {
    throw new GraphQLError(`ไม่พบบทบาทที่ระบุ: ${roleId ?? wanted}`, {
      extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
    });
  }

  if (roleId && roleText && row.name !== roleText) {
    throw new GraphQLError("บทบาทที่ระบุไม่ตรงกัน", {
      extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
    });
  }

  if (bypasses(gate)) return { roleId: row.id, roleName: row.name };

  // Editing one's own profile may round-trip the existing role_id. This is
  // not a grant; the caller supplied the locked current row and cannot change it.
  if (opts.unchangedSelfRoleName === row.name && gate.actorRole === row.name) {
    return { roleId: row.id, roleName: row.name };
  }

  if (!canManageStaffRole(gate.actorRole, row.name)) {
    await audit(ctx, "user.manage_denied", null, {
      reason: "role_not_assignable",
      actorRole: gate.actorRole,
      requestedRole: row.name,
    });
    throw forbidden(
      `กำหนดบทบาท "${row.name}" ไม่ได้ (บทบาทของคุณคือ "${gate.actorRole}" กำหนดได้เฉพาะบทบาทที่ต่ำกว่า)`
    );
  }

  return { roleId: row.id, roleName: row.name };
}
