/**
 * Storage for pharmacist-approved guidance (10.45). Content rules live in guidanceTemplates.ts.
 *
 * Writes run in a tenant transaction with their audit row in the same transaction.
 * The customer-facing read is fail-safe: any error or a slow database means "no approved
 * guidance", and the caller falls back to the fixed pharmacist handoff that exists today.
 */
import { query, getClient } from "@/lib/db";
import { beginTenantTx } from "../tenant";
import { pharmacyClinicalHandoffReply } from "./customerAssistancePolicy";
import { getStoreProfile } from "../storeProfile";
import {
  PHARMACY_GUIDANCE_DEFAULT_DRAFTS,
  PHARMACY_GUIDANCE_MAX_BODY,
  classifyPharmacyGuidanceQuestion,
  isPharmacyGuidanceCode,
  isPharmacyGuidanceLocale,
  pharmacyGuidanceLocaleOf,
  pharmacyGuidanceWarnings,
  renderPharmacyGuidance,
  type PharmacyGuidanceCode,
  type PharmacyGuidanceLocale,
  type PharmacyGuidanceStatus,
  type PharmacyGuidanceValues,
  type PharmacyGuidanceWarning,
} from "./guidanceTemplates";

export class PharmacyGuidanceError extends Error {}

export type PharmacyGuidanceTemplate = {
  id: string;
  code: PharmacyGuidanceCode;
  locale: PharmacyGuidanceLocale;
  body: string;
  status: PharmacyGuidanceStatus;
  version: number;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvedLicenseNo: string | null;
  updatedAt: string;
  warnings: PharmacyGuidanceWarning[];
};

const COLUMNS = `g.id, g.code, g.locale, g.body, g.status, g.version, g.approved_by,
  g.approved_at, g.approved_license_no, g.updated_at, COALESCE(u.name, u.email) AS approved_by_name`;

function iso(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(r: any): PharmacyGuidanceTemplate {
  return {
    id: String(r.id),
    code: r.code,
    locale: r.locale,
    body: String(r.body ?? ""),
    status: r.status,
    version: Number(r.version ?? 1),
    approvedBy: r.approved_by ?? null,
    approvedByName: r.approved_by_name ?? null,
    approvedAt: iso(r.approved_at),
    approvedLicenseNo: r.approved_license_no ?? null,
    updatedAt: iso(r.updated_at) ?? "",
    warnings: pharmacyGuidanceWarnings(String(r.body ?? "")),
  };
}

function requireCode(code: unknown): PharmacyGuidanceCode {
  if (!isPharmacyGuidanceCode(code)) throw new PharmacyGuidanceError("ชนิดคำถามไม่ถูกต้อง");
  return code;
}

function requireLocale(locale: unknown): PharmacyGuidanceLocale {
  if (!isPharmacyGuidanceLocale(locale)) throw new PharmacyGuidanceError("ภาษาต้องเป็น th หรือ en");
  return locale;
}

export async function listPharmacyGuidanceTemplates(tenantId: string): Promise<PharmacyGuidanceTemplate[]> {
  const res = await query(
    `SELECT ${COLUMNS}
       FROM bms_pharmacy_guidance_templates g
       LEFT JOIN users u ON u.id = g.approved_by AND u.tenant_id = g.tenant_id
      WHERE g.tenant_id = $1
      ORDER BY g.code, g.locale`,
    [tenantId]
  );
  return res.rows.map(mapRow);
}

async function readOneInTx(client: any, tenantId: string, id: string): Promise<PharmacyGuidanceTemplate> {
  const res = await client.query(
    `SELECT g.id, g.code, g.locale, g.body, g.status, g.version, g.approved_by,
            g.approved_at, g.approved_license_no, g.updated_at, NULL::text AS approved_by_name
       FROM bms_pharmacy_guidance_templates g
      WHERE g.tenant_id = $1 AND g.id = $2`,
    [tenantId, id]
  );
  return mapRow(res.rows[0]);
}

async function auditInTx(client: any, tenantId: string, actorId: string, action: string, target: string, meta: Record<string, unknown>) {
  await client.query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta) VALUES ($1,$2,$3,$4,$5)`,
    [tenantId, actorId, action, target, JSON.stringify(meta)]
  );
}

/** Create or edit a draft. Editing an APPROVED body returns it to DRAFT (DB trigger enforces it too). */
export async function savePharmacyGuidanceDraft(
  tenantId: string,
  actorId: string,
  input: { code: unknown; locale: unknown; body: unknown },
): Promise<PharmacyGuidanceTemplate> {
  const code = requireCode(input.code);
  const locale = requireLocale(input.locale);
  const body = typeof input.body === "string" ? input.body.replace(/\r\n?/g, "\n").trim() : "";
  if (!body) throw new PharmacyGuidanceError("ต้องกรอกข้อความ");
  if (body.length > PHARMACY_GUIDANCE_MAX_BODY) {
    throw new PharmacyGuidanceError(`ข้อความยาวเกิน ${PHARMACY_GUIDANCE_MAX_BODY} ตัวอักษร`);
  }
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const res = await client.query(
      `INSERT INTO bms_pharmacy_guidance_templates (tenant_id, code, locale, body, status, updated_by)
       VALUES ($1,$2,$3,$4,'DRAFT',$5)
       ON CONFLICT (tenant_id, code, locale) DO UPDATE
         SET body = EXCLUDED.body,
             -- Re-saving an unchanged approved body keeps the approval; anything else is a draft
             -- (a retired row comes back as a draft that needs approving again).
             status = CASE WHEN bms_pharmacy_guidance_templates.body = EXCLUDED.body
                            AND bms_pharmacy_guidance_templates.status = 'APPROVED'
                           THEN 'APPROVED' ELSE 'DRAFT' END,
             updated_by = EXCLUDED.updated_by
       RETURNING id`,
      [tenantId, code, locale, body, actorId]
    );
    const id = String(res.rows[0].id);
    const saved = await readOneInTx(client, tenantId, id);
    await auditInTx(client, tenantId, actorId, "pharmacy.guidance.draft_saved", `pharmacy_guidance:${id}`,
      { code, locale, version: saved.version, status: saved.status });
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/** Copy the built-in starting drafts in for every code/locale the shop has not written yet. */
export async function seedPharmacyGuidanceDrafts(tenantId: string, actorId: string): Promise<number> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    let created = 0;
    for (const [code, byLocale] of Object.entries(PHARMACY_GUIDANCE_DEFAULT_DRAFTS)) {
      for (const [locale, body] of Object.entries(byLocale)) {
        const res = await client.query(
          `INSERT INTO bms_pharmacy_guidance_templates (tenant_id, code, locale, body, status, updated_by)
           VALUES ($1,$2,$3,$4,'DRAFT',$5)
           ON CONFLICT (tenant_id, code, locale) DO NOTHING`,
          [tenantId, code, locale, body, actorId]
        );
        created += res.rowCount ?? 0;
      }
    }
    await auditInTx(client, tenantId, actorId, "pharmacy.guidance.drafts_seeded", "pharmacy_guidance", { created });
    await client.query("COMMIT");
    return created;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Approval is a fact about the person, not a role: Administrator does not get it for free.
 * The approved version is pinned so a body edited after the pharmacist opened the page is not
 * approved by accident.
 */
export async function approvePharmacyGuidance(
  tenantId: string,
  actorId: string,
  id: string,
  expectedVersion: number,
): Promise<PharmacyGuidanceTemplate> {
  const license = await query<{ ok: boolean; license_no: string | null }>(
    `SELECT public.bms_is_licensed_pharmacist($1, $2) AS ok,
            (SELECT NULLIF(btrim(pharmacist_license_no), '') FROM users WHERE tenant_id = $1 AND id = $2) AS license_no`,
    [tenantId, actorId]
  );
  if (license.rows[0]?.ok !== true) {
    throw new PharmacyGuidanceError("ผู้อนุมัติต้องเป็นเภสัชกรที่มีใบประกอบวิชาชีพ");
  }
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const res = await client.query(
      `UPDATE bms_pharmacy_guidance_templates
          SET status = 'APPROVED', approved_by = $3, approved_at = now(),
              approved_license_no = $5, updated_by = $3
        WHERE tenant_id = $1 AND id = $2 AND status = 'DRAFT' AND version = $4
        RETURNING id`,
      [tenantId, id, actorId, expectedVersion, license.rows[0].license_no ?? null]
    );
    if (!res.rowCount) {
      await client.query("ROLLBACK");
      throw new PharmacyGuidanceError("อนุมัติได้เฉพาะร่างฉบับล่าสุด กรุณาโหลดหน้าใหม่แล้วตรวจข้อความอีกครั้ง");
    }
    const saved = await readOneInTx(client, tenantId, id);
    await auditInTx(client, tenantId, actorId, "pharmacy.guidance.approved", `pharmacy_guidance:${id}`, {
      code: saved.code, locale: saved.locale, version: saved.version, warnings: saved.warnings,
    });
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function retirePharmacyGuidance(tenantId: string, actorId: string, id: string): Promise<PharmacyGuidanceTemplate> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const res = await client.query(
      `UPDATE bms_pharmacy_guidance_templates SET status = 'RETIRED', updated_by = $3
        WHERE tenant_id = $1 AND id = $2 AND status <> 'RETIRED'
        RETURNING id`,
      [tenantId, id, actorId]
    );
    if (!res.rowCount) {
      await client.query("ROLLBACK");
      throw new PharmacyGuidanceError("ไม่พบข้อความนี้ หรือปลดใช้ไปแล้ว");
    }
    const saved = await readOneInTx(client, tenantId, id);
    await auditInTx(client, tenantId, actorId, "pharmacy.guidance.retired", `pharmacy_guidance:${id}`,
      { code: saved.code, locale: saved.locale, version: saved.version });
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export const PHARMACY_GUIDANCE_READ_TIMEOUT_MS = 500;

/**
 * The approved body for a customer reply, or null. Never throws and never waits longer than
 * PHARMACY_GUIDANCE_READ_TIMEOUT_MS: a missing table (10.45 not applied), a slow database or
 * any other error means the caller keeps the fixed pharmacist handoff.
 */
export async function getApprovedPharmacyGuidanceBody(
  tenantId: string,
  code: PharmacyGuidanceCode,
  locale: PharmacyGuidanceLocale,
  timeoutMs = PHARMACY_GUIDANCE_READ_TIMEOUT_MS,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = query<{ body: string }>(
      `SELECT body FROM bms_pharmacy_guidance_templates
        WHERE tenant_id = $1 AND code = $2 AND locale = $3 AND status = 'APPROVED'
        LIMIT 1`,
      [tenantId, code, locale]
    ).then((res) => res.rows[0]?.body ?? null);
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const safeRead = read.catch((error: unknown) => {
      console.error("[BMS] pharmacy guidance read failed:", (error as { code?: string })?.code ?? error);
      return null;
    });
    return await Promise.race([safeRead, timeout]);
  } catch (error) {
    console.error("[BMS] pharmacy guidance read failed:", (error as { code?: string })?.code ?? error);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The reply for a clinical question the AI must not answer itself: the shop's approved guidance
 * for that question type when one exists, otherwise the fixed handoff used before 10.45.
 * Emergency routing must run before this — it is the caller's job and is pinned by tests.
 */
export async function pharmacyClinicalGuidanceReply(
  tenantId: string,
  message: string,
  loadValues: () => Promise<PharmacyGuidanceValues> = () => pharmacyGuidanceShopValues(tenantId),
): Promise<{ reply: string; code: PharmacyGuidanceCode | null; approved: boolean }> {
  const code = classifyPharmacyGuidanceQuestion(message);
  const locale = pharmacyGuidanceLocaleOf(message);
  if (code) {
    const body = await getApprovedPharmacyGuidanceBody(tenantId, code, locale);
    // Shop facts are only read when an approved body exists to use them.
    if (body) return { reply: renderPharmacyGuidance(body, await loadValues(), locale), code, approved: true };
  }
  return { reply: pharmacyClinicalHandoffReply(locale === "en", message), code, approved: false };
}

/** Shop facts a template may reference. A failed read leaves every placeholder line out. */
export async function pharmacyGuidanceShopValues(tenantId: string): Promise<PharmacyGuidanceValues> {
  try {
    const profile = await getStoreProfile(tenantId);
    return { shop_phone: profile.phone, business_hours: profile.businessHours, shop_address: profile.address };
  } catch (error) {
    console.error("[BMS] pharmacy guidance shop values failed:", (error as { code?: string })?.code ?? error);
    return {};
  }
}
