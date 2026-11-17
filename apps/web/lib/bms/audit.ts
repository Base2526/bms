// =============================================================
// BMS audit log — บันทึกการกระทำของ admin (tenant-scoped)
// =============================================================

import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { getTenantId } from "./tenant";

export type AuditActorKind = "STAFF" | "CUSTOMER" | "AI" | "SYSTEM" | "PROVIDER";

/** Required audit for a business write: call on the same client before COMMIT. */
export async function insertAuditInTx(client: PoolClient, input: {
  tenantId: string;
  actor: string;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
  actorKind?: AuditActorKind;
  actorUserId?: string | null;
  targetKind?: string | null;
  source?: string | null;
  requestId?: string | null;
  eventKey?: string | null;
}): Promise<void> {
  await client.query(
    `INSERT INTO bms_audit_log
       (tenant_id, actor, action, target, meta, actor_kind, actor_user_id,
        target_kind, source, request_id, event_key)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tenant_id, event_key) WHERE event_key IS NOT NULL DO NOTHING`,
    [input.tenantId, input.actor, input.action, input.target ?? null,
      JSON.stringify(input.meta ?? {}), input.actorKind ?? null,
      input.actorUserId ?? null, input.targetKind ?? null, input.source ?? null,
      input.requestId ?? null, input.eventKey ?? null]
  );
}

/** บันทึก audit จาก resolver (ไม่ throw — ไม่ให้ล้ม mutation หลัก) */
export async function audit(
  ctx: any,
  action: string,
  target?: string | null,
  meta?: Record<string, unknown>,
  attribution?: { actorKind?: AuditActorKind; source?: string; targetKind?: string }
): Promise<void> {
  try {
    const actor = ctx?.admin?.email || ctx?.admin?.id || "system";
    const actorUserId = typeof ctx?.admin?.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ctx.admin.id)
      ? ctx.admin.id : null;
    await query(
      `INSERT INTO bms_audit_log
         (tenant_id, actor, action, target, meta, actor_kind, actor_user_id, source, target_kind)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
      [getTenantId(ctx), String(actor), action, target ?? null, JSON.stringify(meta ?? {}),
        attribution?.actorKind ?? (actorUserId ? "STAFF" : null), actorUserId,
        attribution?.source ?? null, attribution?.targetKind ?? null]
    );
  } catch (e) {
    console.error("[BMS] audit failed:", e);
  }
}

/**
 * actor ในตารางถูกเขียนมาสองแบบ และแก้ย้อนหลังไม่ได้
 *
 * resolver ฝั่ง GraphQL เขียนเป็น "อีเมล" (ดู audit() ข้างบน) ส่วนเส้นทางที่ไม่มี
 * ctx — POS ที่ยืนยันตัวด้วย device token + PIN, และ REST ของงานคลัง — มีแค่
 * users.id จึงเขียนเป็น UUID ดิบ ผลคือคนที่ค้นหน้า /admin/audit ด้วยอีเมลจะไม่เจอ
 * แถวขายหน้าร้าน/โอนสต็อก/ปิดกะเลย ซึ่งคือแถวที่เขาตามหาอยู่พอดี
 *
 * แปลงตอนอ่านแทนการไล่แก้ทุก call site: ครอบคลุมแถวเก่าที่เขียนไปแล้วด้วย
 * · join ด้วย u.id::text = a.actor (ไม่ cast ฝั่ง actor) เพราะ actor เป็น TEXT ที่
 *   อาจเป็นอีเมลหรือ "system:..." — cast เป็น uuid จะ error ทั้ง query
 * · ผู้ใช้ที่ถูกลบไปแล้ว join ไม่ติด ก็คืน UUID เดิม ดีกว่าคืนค่าว่าง
 */
export async function listAudit(tenantId: string, limit = 100) {
  const res = await query(
    `SELECT a.id, COALESCE(u.email, a.actor) AS actor,
            a.action, a.target, a.meta, a.created_at
       FROM bms_audit_log a
       LEFT JOIN users u ON u.id::text = a.actor
      WHERE a.tenant_id = $1
      ORDER BY a.created_at DESC, a.id DESC LIMIT $2`,
    [tenantId, Math.min(Math.max(limit, 1), 500)]
  );
  return res.rows;
}
