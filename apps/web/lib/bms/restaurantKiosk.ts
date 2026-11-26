import { createHash, randomBytes } from "node:crypto";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { listRestaurantMenu, quoteRestaurantKioskItems } from "./restaurantPos";
import { kioskQuoteChanged, normalizeKioskRequestCode } from "./restaurantKioskReview";
import { kioskTenantRead } from "./restaurantKioskTenantRead";
import { normalizeSubmissionItems, type RestaurantQrItemInput } from "./restaurantQrOrdering";
import { RestaurantCheckError } from "./restaurantPosErrors";
import { resolvePosScan } from "./pos";

export type KioskServiceMode = "DINE_IN" | "TAKEAWAY";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedToken(value: string) {
  const token = value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new RestaurantCheckError("จอสั่งอาหารนี้ไม่พร้อมใช้งาน", "KIOSK_UNAVAILABLE");
  return token;
}

async function requireKiosk(tokenInput: string) {
  const token = normalizedToken(tokenInput);
  const client = await getClient();
  let locator;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bms_app");
    await client.query("SELECT set_config('bms.kiosk_token_hash', $1, true)", [digest(token)]);
    locator = await client.query<{
      id: string; tenant_id: string; location_id: string; store_name: string;
      location_name: string; business_archetype: string | null;
    }>(
      `SELECT kiosk.id, kiosk.tenant_id, kiosk.location_id,
              tenant.name AS store_name, location.name AS location_name,
              profile.business_archetype
         FROM bms_restaurant_kiosks kiosk
         JOIN bms_locations location
           ON location.tenant_id = kiosk.tenant_id AND location.id = kiosk.location_id AND location.active
         JOIN bms_tenants tenant ON tenant.id = kiosk.tenant_id
         LEFT JOIN bms_store_profile profile ON profile.tenant_id = kiosk.tenant_id
        WHERE kiosk.token_hash = $1 AND kiosk.active`,
      [digest(token)]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
  const row = locator.rows[0];
  if (!row || row.business_archetype !== "restaurant") {
    throw new RestaurantCheckError("จอสั่งอาหารนี้ไม่พร้อมใช้งาน", "KIOSK_UNAVAILABLE");
  }
  return {
    id: row.id, tenantId: row.tenant_id, locationId: row.location_id,
    storeName: row.store_name, locationName: row.location_name,
  };
}

export async function issueRestaurantKiosk(input: {
  tenantId: string; locationId: string; actorUserId: string; rotate?: boolean; disable?: boolean;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    // The location lock serializes two issue/rotate requests for one branch.
    const location = await client.query(
      `SELECT 1 FROM bms_locations WHERE tenant_id = $1 AND id = $2 AND active FOR UPDATE`,
      [input.tenantId, input.locationId]
    );
    if (!location.rowCount) throw new RestaurantCheckError("สาขานี้ไม่พร้อมใช้งาน");
    const profile = await client.query<{ business_archetype: string | null }>(
      `SELECT business_archetype FROM bms_store_profile WHERE tenant_id = $1`, [input.tenantId]
    );
    if (profile.rows[0]?.business_archetype !== "restaurant") {
      throw new RestaurantCheckError("ใช้ได้เฉพาะร้านอาหาร");
    }
    const current = await client.query<{ id: string }>(
      `SELECT id FROM bms_restaurant_kiosks
        WHERE tenant_id = $1 AND location_id = $2 AND active FOR UPDATE`,
      [input.tenantId, input.locationId]
    );
    if (current.rowCount && !input.rotate && !input.disable) {
      throw new RestaurantCheckError("สาขานี้มีจอสั่งอาหารแล้ว หากต้องการ URL ใหม่ให้หมุนรหัส");
    }
    if (current.rowCount) {
      await client.query(
        `UPDATE bms_restaurant_kiosks SET active = FALSE, revoked_at = now()
          WHERE tenant_id = $1 AND id = $2`, [input.tenantId, current.rows[0].id]
      );
      await client.query(
        `UPDATE bms_restaurant_kiosk_submissions SET status = 'EXPIRED', updated_at = now()
          WHERE tenant_id = $1 AND kiosk_id = $2 AND status = 'PENDING'`,
        [input.tenantId, current.rows[0].id]
      );
    }
    let token: string | null = null;
    if (!input.disable) {
      token = randomBytes(32).toString("base64url");
      await client.query(
        `INSERT INTO bms_restaurant_kiosks (tenant_id, location_id, token_hash, created_by)
         VALUES ($1,$2,$3,$4)`,
        [input.tenantId, input.locationId, digest(token), input.actorUserId]
      );
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`,
        input.disable ? "restaurant.kiosk.disable" : current.rowCount ? "restaurant.kiosk.rotate" : "restaurant.kiosk.issue",
        input.locationId, JSON.stringify({ locationId: input.locationId })]
    );
    await client.query("COMMIT");
    return { active: !input.disable, token };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function restaurantKioskState(tenantId: string, locationId: string) {
  const result = await kioskTenantRead(tenantId, (client) => client.query(
    `SELECT 1 FROM bms_restaurant_kiosks WHERE tenant_id = $1 AND location_id = $2 AND active`,
    [tenantId, locationId]
  ));
  return { active: Boolean(result.rowCount) };
}

/** Manager dashboard summary; never returns a URL or token hash. */
export async function restaurantKioskAdminState(tenantId: string, locationId: string) {
  const result = await kioskTenantRead(tenantId, (client) => client.query<{
    active: boolean; pending_count: string;
  }>(
    `SELECT EXISTS (
       SELECT 1 FROM bms_restaurant_kiosks
        WHERE tenant_id = $1 AND location_id = $2 AND active
     ) AS active,
     (SELECT count(*)::text FROM bms_restaurant_kiosk_submissions
       WHERE tenant_id = $1 AND location_id = $2 AND status = 'PENDING'
         AND submitted_at > now() - interval '30 minutes') AS pending_count`,
    [tenantId, locationId]
  ));
  return { active: result.rows[0]?.active === true,
    pendingCount: Number(result.rows[0]?.pending_count ?? 0) };
}

export async function restaurantKioskMenu(token: string) {
  const kiosk = await requireKiosk(token);
  const items = await listRestaurantMenu(kiosk.tenantId, kiosk.locationId);
  return {
    storeName: kiosk.storeName, locationName: kiosk.locationName,
    items: items.map((item) => ({
      sku: item.sku, name: item.name, category: item.category,
      price: item.price, imageUrl: item.imageUrl,
      sellable: item.sellable, availability: item.availability,
      availableSizes: item.availableSizes.map((variant) => ({
        size: variant.size, available: variant.sellable,
      })),
    })),
  };
}

export async function restaurantKioskMenuItem(input: {
  token: string; sku: string; size?: string | null; packCode?: string | null;
}) {
  const kiosk = await requireKiosk(input.token);
  const menu = await listRestaurantMenu(kiosk.tenantId, kiosk.locationId);
  if (!menu.some((item) => item.sku === input.sku && item.sellable)) {
    throw new RestaurantCheckError("เมนูนี้ไม่พร้อมขายในขณะนี้");
  }
  const hit = await resolvePosScan(kiosk.tenantId, input.sku, {
    locationId: kiosk.locationId, size: input.size ?? null,
    packCode: input.packCode ?? null, surface: "RESTAURANT_POS",
  });
  if (!hit) throw new RestaurantCheckError("ไม่พบเมนูหรือตัวเลือกนี้");
  return {
    sku: hit.sku, productName: hit.productName, size: hit.size, packCode: hit.packCode,
    unitName: hit.unitName, packPrice: hit.packPrice, modifiers: hit.modifiers,
  };
}

export async function submitRestaurantKioskOrder(input: {
  token: string; serviceMode: unknown; idempotencyKey: string; items: RestaurantQrItemInput[];
}) {
  const kiosk = await requireKiosk(input.token);
  if (input.serviceMode !== "DINE_IN" && input.serviceMode !== "TAKEAWAY") {
    throw new RestaurantCheckError("กรุณาเลือกกินในร้านหรือรับกลับ");
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 120) {
    throw new RestaurantCheckError("รหัสป้องกันการส่งซ้ำไม่ถูกต้อง");
  }
  const replay = await kioskTenantRead(kiosk.tenantId, (client) => client.query<{ id: string; status: string }>(
    `SELECT id, CASE WHEN status = 'PENDING' AND submitted_at <= now() - interval '30 minutes'
                     THEN 'EXPIRED' ELSE status END AS status
       FROM bms_restaurant_kiosk_submissions
      WHERE tenant_id = $1 AND kiosk_id = $2 AND idempotency_key = $3`,
    [kiosk.tenantId, kiosk.id, idempotencyKey]
  ));
  if (replay.rowCount) return { submissionId: replay.rows[0].id, status: replay.rows[0].status, replayed: true };
  const items = normalizeSubmissionItems(input.items);
  if (items.length > 20) throw new RestaurantCheckError("หนึ่งครั้งสั่งได้ไม่เกิน 20 รายการ");
  // This price evidence comes from the server, never from the shared browser.
  const submittedQuote = await quoteRestaurantKioskItems(kiosk.tenantId, kiosk.locationId, items);
  const quotedItems = items.map((item, index) => ({ ...item, submittedQuote: submittedQuote.lines[index] }));
  const client = await getClient();
  try {
    await beginTenantTx(client, kiosk.tenantId);
    const active = await client.query(
      `SELECT 1 FROM bms_restaurant_kiosks
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND active FOR UPDATE`,
      [kiosk.tenantId, kiosk.locationId, kiosk.id]
    );
    if (!active.rowCount) throw new RestaurantCheckError("จอสั่งอาหารนี้ไม่พร้อมใช้งาน", "KIOSK_UNAVAILABLE");
    const pending = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM bms_restaurant_kiosk_submissions
        WHERE tenant_id = $1 AND kiosk_id = $2 AND status = 'PENDING'
          AND submitted_at > now() - interval '30 minutes'`,
      [kiosk.tenantId, kiosk.id]
    );
    if (Number(pending.rows[0]?.n ?? 0) >= 100) {
      throw new RestaurantCheckError("มีคำขอรอตรวจมากเกินไป กรุณาติดต่อพนักงาน");
    }
    const created = await client.query<{ id: string; status: string }>(
      `INSERT INTO bms_restaurant_kiosk_submissions
         (tenant_id, location_id, kiosk_id, service_mode, idempotency_key, items)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (tenant_id, kiosk_id, idempotency_key) DO NOTHING
       RETURNING id, status`,
      [kiosk.tenantId, kiosk.locationId, kiosk.id, input.serviceMode, idempotencyKey, JSON.stringify(quotedItems)]
    );
    const row = created.rows[0] ?? (await client.query<{ id: string; status: string }>(
      `SELECT id, CASE WHEN status = 'PENDING' AND submitted_at <= now() - interval '30 minutes'
                       THEN 'EXPIRED' ELSE status END AS status
         FROM bms_restaurant_kiosk_submissions
        WHERE tenant_id = $1 AND kiosk_id = $2 AND idempotency_key = $3`,
      [kiosk.tenantId, kiosk.id, idempotencyKey]
    )).rows[0];
    if (!row) throw new RestaurantCheckError("ส่งคำขอไม่สำเร็จ กรุณาลองใหม่");
    await client.query("COMMIT");
    return { submissionId: row.id, status: row.status, replayed: !created.rowCount };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function restaurantKioskSubmissionStatus(token: string, submissionId: string) {
  const kiosk = await requireKiosk(token);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)) {
    throw new RestaurantCheckError("ไม่พบคำขอ");
  }
  const result = await kioskTenantRead(kiosk.tenantId, (client) => client.query<{
    status: string; service_mode: string; rejection_reason: string | null;
  }>(
    `SELECT CASE WHEN status = 'PENDING' AND submitted_at <= now() - interval '30 minutes'
                 THEN 'EXPIRED' ELSE status END AS status,
            service_mode, rejection_reason
       FROM bms_restaurant_kiosk_submissions
      WHERE tenant_id = $1 AND kiosk_id = $2 AND id = $3`,
    [kiosk.tenantId, kiosk.id, submissionId]
  ));
  if (!result.rowCount) throw new RestaurantCheckError("ไม่พบคำขอ");
  return {
    status: result.rows[0].status, serviceMode: result.rows[0].service_mode,
    rejectionReason: result.rows[0].rejection_reason,
  };
}

export async function listRestaurantKioskSubmissions(tenantId: string, locationId: string, requestCode?: string) {
  let code: string;
  try { code = normalizeKioskRequestCode(requestCode ?? ""); }
  catch { throw new RestaurantCheckError("รหัสคำขอไม่ถูกต้อง"); }
  const result = await kioskTenantRead(tenantId, (client) => client.query<{
    id: string; service_mode: KioskServiceMode; status: string;
    items: Array<RestaurantQrItemInput & { submittedQuote?: unknown }>;
    check_id: string | null; submitted_at: Date; reviewed_at: Date | null;
    rejection_reason: string | null;
    check_status: string | null; order_id: string | null;
    table_code: string | null; table_name: string | null; area_name: string | null;
    split_group_no: number | null;
  }>(
    `SELECT s.id, s.service_mode,
            CASE WHEN s.status = 'PENDING' AND s.submitted_at <= now() - interval '30 minutes'
                 THEN 'EXPIRED' ELSE s.status END AS status,
            s.items, s.check_id, s.submitted_at, s.reviewed_at, s.rejection_reason,
            c.status AS check_status, c.current_order_id AS order_id,
            t.code AS table_code, t.name AS table_name, a.name AS area_name,
            c.split_group_no
       FROM bms_restaurant_kiosk_submissions s
       LEFT JOIN bms_restaurant_checks c
         ON c.tenant_id = s.tenant_id AND c.location_id = s.location_id AND c.id = s.check_id
       LEFT JOIN bms_restaurant_tables t
         ON t.tenant_id = c.tenant_id AND t.location_id = c.location_id AND t.id = c.table_id
       LEFT JOIN bms_restaurant_areas a
         ON a.tenant_id = t.tenant_id AND a.id = t.area_id
      WHERE s.tenant_id = $1 AND s.location_id = $2
        AND ($3::text = '' OR s.id::text LIKE $3 || '%')
        AND ($3::text <> '' OR s.submitted_at > now() - interval '24 hours')
      ORDER BY (s.status = 'PENDING' AND s.submitted_at > now() - interval '30 minutes') DESC,
               s.submitted_at DESC LIMIT ${code ? 10 : 100}`,
    [tenantId, locationId, code]
  ));
  const skus = Array.from(new Set(result.rows.flatMap((row) => row.items.map((item) => item.sku))));
  const names = skus.length ? await query<{ sku: string; name: string }>(
    `SELECT sku, name FROM bms_products WHERE tenant_id = $1 AND sku = ANY($2::text[])`,
    [tenantId, skus]
  ) : { rows: [] };
  const nameBySku = new Map(names.rows.map((row) => [row.sku, row.name]));
  return result.rows.map((row) => ({
    id: row.id, serviceMode: row.service_mode, status: row.status,
    items: row.items.map((item) => ({ ...item, productName: nameBySku.get(item.sku) ?? item.sku })),
    checkId: row.check_id, submittedAt: row.submitted_at.toISOString(),
    reviewedAt: row.reviewed_at?.toISOString() ?? null, rejectionReason: row.rejection_reason,
    checkStatus: row.check_status, orderId: row.order_id,
    tableCode: row.table_code, tableName: row.table_name, areaName: row.area_name,
    splitGroupNo: row.split_group_no,
  }));
}

export async function previewRestaurantKioskSubmission(input: {
  tenantId: string; locationId: string; submissionId: string; checkId?: string | null;
}) {
  const result = await kioskTenantRead(input.tenantId, (client) => client.query<{
    status: string; service_mode: KioskServiceMode;
    items: Array<RestaurantQrItemInput & { submittedQuote?: unknown }>;
  }>(
    `SELECT status, service_mode, items FROM bms_restaurant_kiosk_submissions
      WHERE tenant_id = $1 AND location_id = $2 AND id = $3
        AND status = 'PENDING' AND submitted_at > now() - interval '30 minutes'`,
    [input.tenantId, input.locationId, input.submissionId]
  ));
  const submission = result.rows[0];
  if (!submission) throw new RestaurantCheckError("คำขอนี้ไม่อยู่ระหว่างรอตรวจในสาขา");
  const quote = await quoteRestaurantKioskItems(input.tenantId, input.locationId, submission.items);
  const submittedLines = submission.items.map((item) => item.submittedQuote ?? null);
  const priceChanged = kioskQuoteChanged(submittedLines, quote);
  let check: null | {
    id: string; version: number; tableId: string; tableCode: string;
    tableName: string; areaName: string; splitGroupNo: number; openedAt: string;
  } = null;
  if (submission.service_mode === "DINE_IN") {
    if (!input.checkId) throw new RestaurantCheckError("กรุณาเลือกบิลโต๊ะก่อนตรวจราคา");
    const checkResult = await query<{
      id: string; version: number; table_id: string; table_code: string;
      table_name: string; area_name: string; split_group_no: number; opened_at: Date;
    }>(
      `SELECT c.id, c.version, c.table_id, t.code AS table_code,
              t.name AS table_name, a.name AS area_name, c.split_group_no, c.opened_at
         FROM bms_restaurant_checks c
         JOIN bms_restaurant_tables t ON t.tenant_id = c.tenant_id AND t.id = c.table_id
         JOIN bms_restaurant_areas a ON a.tenant_id = t.tenant_id AND a.id = t.area_id
        WHERE c.tenant_id = $1 AND c.location_id = $2 AND c.id = $3
          AND c.service_mode = 'DINE_IN' AND c.status = 'OPEN'`,
      [input.tenantId, input.locationId, input.checkId]
    );
    const row = checkResult.rows[0];
    if (!row) throw new RestaurantCheckError("บิลโต๊ะปิด ย้ายสาขา หรือไม่ใช่บิลกินในร้าน กรุณาตรวจใหม่");
    check = {
      id: row.id, version: Number(row.version), tableId: row.table_id,
      tableCode: row.table_code, tableName: row.table_name,
      areaName: row.area_name, splitGroupNo: Number(row.split_group_no),
      openedAt: row.opened_at.toISOString(),
    };
  }
  return { submissionId: input.submissionId, serviceMode: submission.service_mode,
    submittedLines, quote, priceChanged, check };
}

export async function rejectRestaurantKioskSubmission(input: {
  tenantId: string; locationId: string; submissionId: string; actorUserId: string; reason: string;
}) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 300) throw new RestaurantCheckError("ต้องระบุเหตุผลไม่เกิน 300 ตัวอักษร");
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const result = await client.query(
      `UPDATE bms_restaurant_kiosk_submissions
          SET status = 'REJECTED', reviewed_by = $4, reviewed_at = now(),
              rejection_reason = $5, updated_at = now()
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND status = 'PENDING'
          AND submitted_at > now() - interval '30 minutes'
        RETURNING id`,
      [input.tenantId, input.locationId, input.submissionId, input.actorUserId, reason]
    );
    if (!result.rowCount) throw new RestaurantCheckError("คำขอนี้ถูกรับหรือปฏิเสธแล้ว");
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.kiosk.reject',$3,$4::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, input.submissionId,
        JSON.stringify({ locationId: input.locationId })]
    );
    await client.query("COMMIT");
    return { status: "REJECTED" as const };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}
