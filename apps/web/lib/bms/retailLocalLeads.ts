import "server-only";

import crypto from "crypto";
import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";

export const RETAIL_LOCAL_LEAD_CONSENT_VERSION = "retail-local-lead-v1";

export const RETAIL_LOCAL_LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "TRIAL_ISSUED",
  "PAID",
  "NOT_INTERESTED",
] as const;

export type RetailLocalLeadStatus = (typeof RETAIL_LOCAL_LEAD_STATUSES)[number];
type RetailLocalPlatform = "windows" | "ubuntu" | "macos";
type RetailLocalLocale = "th" | "en";

export class RetailLocalLeadError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "RetailLocalLeadError";
  }
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new RetailLocalLeadError(`${field} ไม่ถูกต้อง`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new RetailLocalLeadError(`${field} ยาวเกิน ${max} ตัวอักษร`);
  return normalized;
}

function normalizeThaiPhone(value: unknown): string | null {
  const input = optionalText(value, "phone", 24);
  if (!input) return null;
  let normalized = input.replace(/[\s()-]/g, "");
  if (normalized.startsWith("+66")) normalized = `0${normalized.slice(3)}`;
  else if (normalized.startsWith("66")) normalized = `0${normalized.slice(2)}`;
  if (!/^0(?:[689]\d{8}|[2-7]\d{7,8})$/.test(normalized)) {
    throw new RetailLocalLeadError("phone ต้องเป็นหมายเลขโทรศัพท์ไทย");
  }
  return normalized;
}

function normalizeLineId(value: unknown): string | null {
  const lineId = optionalText(value, "lineId", 50);
  if (!lineId) return null;
  if (!/^[A-Za-z0-9._-]{2,50}$/.test(lineId)) {
    throw new RetailLocalLeadError("lineId ใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีดกลาง และขีดล่าง");
  }
  return lineId;
}

function parsePlatform(value: unknown): RetailLocalPlatform {
  if (value !== "windows" && value !== "ubuntu" && value !== "macos") {
    throw new RetailLocalLeadError("platform ไม่ถูกต้อง");
  }
  return value;
}

function parseLocale(value: unknown): RetailLocalLocale {
  if (value !== "th" && value !== "en") throw new RetailLocalLeadError("locale ไม่ถูกต้อง");
  return value;
}

export function validateRetailLocalLeadSubmission(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RetailLocalLeadError("ข้อมูลไม่ถูกต้อง");
  }
  const body = input as Record<string, unknown>;
  const allowed = new Set(["consent", "phone", "lineId", "shopName", "contactName", "businessType", "platform", "locale"]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new RetailLocalLeadError("invalid_fields");
  if (body.consent !== true) throw new RetailLocalLeadError("ต้องยินยอมให้ใช้ข้อมูลเพื่อติดต่อกลับ");
  const phone = normalizeThaiPhone(body.phone);
  const lineId = normalizeLineId(body.lineId);
  if (!phone && !lineId) throw new RetailLocalLeadError("กรุณากรอกเบอร์โทรหรือ LINE ID อย่างน้อยหนึ่งช่อง");
  return {
    shopName: optionalText(body.shopName, "shopName", 120),
    contactName: optionalText(body.contactName, "contactName", 120),
    phone,
    lineId,
    businessType: optionalText(body.businessType, "businessType", 80),
    platform: parsePlatform(body.platform),
    locale: parseLocale(body.locale),
  };
}

export async function createRetailLocalLead(input: unknown): Promise<void> {
  const lead = validateRetailLocalLeadSubmission(input);
  const client = await getClient();
  try { await client.query(
    `SELECT public.bms_submit_retail_local_lead($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      lead.shopName,
      lead.contactName,
      lead.phone,
      lead.lineId,
      lead.businessType,
      lead.platform,
      lead.locale,
      RETAIL_LOCAL_LEAD_CONSENT_VERSION,
    ],
  ); } catch { throw new RetailLocalLeadError("lead_save_unavailable", 503); }
  finally { client.release(); }
}

async function beginPlatformAdminTx(client: PoolClient, adminId: string | number) {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.editor_id', $1, true)`, [String(adminId)]);
  await client.query(`SELECT set_config('app.revision_id', $1, true)`, [crypto.randomUUID()]);
  const access = await client.query(`SELECT public.bms_is_current_platform_admin() AS allowed`);
  if (access.rows[0]?.allowed !== true) throw new RetailLocalLeadError("forbidden", 403);
}

export async function listRetailLocalLeads(input: {
  adminId: string | number;
  status?: string | null;
  limit?: number;
}) {
  const status = input.status?.trim() || null;
  if (status && !RETAIL_LOCAL_LEAD_STATUSES.includes(status as RetailLocalLeadStatus)) {
    throw new RetailLocalLeadError("status ไม่ถูกต้อง");
  }
  const limit = Number.isInteger(input.limit) ? Math.min(Math.max(Number(input.limit), 1), 500) : 200;
  const client = await getClient();
  try {
    await beginPlatformAdminTx(client, input.adminId);
    const result = await client.query(
      `SELECT id, shop_name, contact_name, phone, line_id, business_type, platform, locale,
              consent_at, consent_text_version, source, status, follow_up_at, note,
              created_at, updated_at, erased_at
       FROM bms_retail_local_leads
       WHERE ($1::text IS NULL OR status = $1)
       ORDER BY follow_up_at ASC NULLS LAST, created_at DESC
       LIMIT $2`,
      [status, limit],
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function parseFollowUpAt(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 40) throw new RetailLocalLeadError("followUpAt ไม่ถูกต้อง");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RetailLocalLeadError("followUpAt ไม่ถูกต้อง");
  return parsed.toISOString();
}

export async function updateRetailLocalLead(input: {
  id: string;
  adminId: string | number;
  status: unknown;
  note: unknown;
  followUpAt: unknown;
}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) {
    throw new RetailLocalLeadError("lead id ไม่ถูกต้อง");
  }
  if (typeof input.status !== "string" ||
      !RETAIL_LOCAL_LEAD_STATUSES.includes(input.status as RetailLocalLeadStatus)) {
    throw new RetailLocalLeadError("status ไม่ถูกต้อง");
  }
  const status = input.status as RetailLocalLeadStatus;
  const note = optionalText(input.note, "note", 2000);
  const followUpAt = parseFollowUpAt(input.followUpAt);
  const client = await getClient();
  try {
    await beginPlatformAdminTx(client, input.adminId);
    const current = await client.query<{
      status: RetailLocalLeadStatus;
      note: string | null;
      follow_up_at: string | null;
      erased_at: string | null;
    }>(
      `SELECT status, note, follow_up_at, erased_at
       FROM bms_retail_local_leads WHERE id = $1 FOR UPDATE`,
      [input.id],
    );
    if (!current.rows[0]) throw new RetailLocalLeadError("ไม่พบ lead", 404);
    const previous = current.rows[0];
    if (previous.erased_at) throw new RetailLocalLeadError("lead นี้ถูกลบข้อมูลส่วนบุคคลแล้ว แก้ไขไม่ได้", 409);
    const updated = await client.query(
      `UPDATE bms_retail_local_leads
       SET status = $2, note = $3, follow_up_at = $4
       WHERE id = $1
       RETURNING id, shop_name, contact_name, phone, line_id, business_type, platform, locale,
                 consent_at, consent_text_version, source, status, follow_up_at, note,
                 created_at, updated_at, erased_at`,
      [input.id, status, note, followUpAt],
    );
    await client.query(
      `INSERT INTO bms_retail_local_lead_events
         (lead_id, actor_id, action, previous_status, next_status, note_changed, follow_up_changed)
       VALUES ($1,$2,'LEAD_UPDATED',$3,$4,$5,$6)`,
      [
        input.id,
        String(input.adminId),
        previous.status,
        status,
        previous.note !== note,
        new Date(previous.follow_up_at || 0).getTime() !== new Date(followUpAt || 0).getTime(),
      ],
    );
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// PDPA erasure (10.106): clears the lead's contact and free-text fields and every
// earlier revision snapshot of them, in one transaction, through a platform-admin
// SECURITY DEFINER function that also records the actor and a LEAD_ERASED event.
// Erasing twice is a no-op that reports `erased: false`; an unknown id is 404.
export async function eraseRetailLocalLead(input: { id: string; adminId: string | number }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) {
    throw new RetailLocalLeadError("lead id ไม่ถูกต้อง");
  }
  const client = await getClient();
  try {
    await beginPlatformAdminTx(client, input.adminId);
    const exists = await client.query(`SELECT 1 FROM bms_retail_local_leads WHERE id = $1`, [input.id]);
    if (!exists.rowCount) throw new RetailLocalLeadError("ไม่พบ lead", 404);
    const result = await client.query<{ erased: boolean }>(
      `SELECT public.bms_erase_retail_local_lead($1::uuid) AS erased`,
      [input.id],
    );
    await client.query("COMMIT");
    return { erased: result.rows[0]?.erased === true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
