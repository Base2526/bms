import { createHash, randomBytes } from "node:crypto";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { listRestaurantMenu, resolveRestaurantCheckItemRequest } from "./restaurantPos";
import { RestaurantCheckError } from "./restaurantPosErrors";
import { resolvePosScan } from "./pos";

export const RESTAURANT_QR_SESSION_COOKIE = "bms.restaurantQrSession";
export const RESTAURANT_QR_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const MAX_SUBMISSION_ITEMS = 30;
const MAX_PENDING_SUBMISSIONS_PER_CHECK = 20;

type QrSessionContext = {
  sessionId: string;
  tenantId: string;
  locationId: string;
  tableId: string;
  tableCode: string;
  tableName: string;
  checkId: string;
  checkStatus: string;
  storeName: string;
  locationName: string;
  expiresAt: string;
};

export type RestaurantQrItemInput = {
  sku: string;
  size?: string | null;
  packCode?: string | null;
  packQty: number;
  modifierCodes?: string[] | null;
  kitchenNote?: string | null;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function opaqueToken() {
  return randomBytes(32).toString("base64url");
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function normalizePublicToken(value: string) {
  const token = value.trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new RestaurantCheckError("QR โต๊ะไม่ถูกต้องหรือถูกยกเลิกแล้ว");
  }
  return token;
}

function normalizeSessionToken(value: string | null | undefined) {
  const token = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : null;
}

export async function issueRestaurantTableQr(input: {
  tenantId: string;
  tableId: string;
  actorUserId: string;
  rotate?: boolean;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const table = await client.query<{ location_id: string; code: string; name: string }>(
      `SELECT table_row.location_id, table_row.code, table_row.name
         FROM bms_restaurant_tables table_row
         JOIN bms_locations location
           ON location.tenant_id = table_row.tenant_id AND location.id = table_row.location_id
          AND location.active
        WHERE table_row.tenant_id = $1 AND table_row.id = $2 AND table_row.active
        FOR UPDATE OF table_row`,
      [input.tenantId, input.tableId]
    );
    if (!table.rowCount) throw new RestaurantCheckError("ไม่พบโต๊ะนี้");

    const existing = await client.query<{ id: string; public_token: string; created_at: Date | string }>(
      `SELECT id, public_token, created_at
         FROM bms_restaurant_table_qr_tokens
        WHERE tenant_id = $1 AND table_id = $2 AND active
        FOR UPDATE`,
      [input.tenantId, input.tableId]
    );
    if (existing.rowCount && !input.rotate) {
      await client.query("COMMIT");
      return {
        token: existing.rows[0].public_token,
        tableId: input.tableId,
        tableCode: table.rows[0].code,
        tableName: table.rows[0].name,
        createdAt: iso(existing.rows[0].created_at),
      };
    }

    if (existing.rowCount) {
      await client.query(
        `UPDATE bms_restaurant_table_qr_tokens
            SET active = FALSE, revoked_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, existing.rows[0].id]
      );
      await client.query(
        `UPDATE bms_restaurant_qr_sessions
            SET revoked_at = COALESCE(revoked_at, now())
          WHERE tenant_id = $1 AND qr_token_id = $2 AND revoked_at IS NULL`,
        [input.tenantId, existing.rows[0].id]
      );
    }

    const token = opaqueToken();
    const created = await client.query<{ created_at: Date | string }>(
      `INSERT INTO bms_restaurant_table_qr_tokens
         (tenant_id, location_id, table_id, public_token, public_token_hash, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING created_at`,
      [input.tenantId, table.rows[0].location_id, input.tableId, token, sha256(token), input.actorUserId]
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`,
        existing.rowCount ? "restaurant.table_qr.rotate" : "restaurant.table_qr.issue",
        input.tableId, JSON.stringify({ locationId: table.rows[0].location_id })]
    );
    await client.query("COMMIT");
    return {
      token,
      tableId: input.tableId,
      tableCode: table.rows[0].code,
      tableName: table.rows[0].name,
      createdAt: iso(created.rows[0].created_at),
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function getRestaurantTableQr(tenantId: string, tableId: string) {
  const result = await query<{
    public_token: string;
    created_at: Date | string;
    code: string;
    name: string;
  }>(
    `SELECT qr.public_token, qr.created_at, t.code, t.name
       FROM bms_restaurant_table_qr_tokens qr
       JOIN bms_restaurant_tables t
         ON t.tenant_id = qr.tenant_id AND t.id = qr.table_id AND t.active
      WHERE qr.tenant_id = $1 AND qr.table_id = $2 AND qr.active`,
    [tenantId, tableId]
  );
  const row = result.rows[0];
  return row ? {
    token: row.public_token,
    tableId,
    tableCode: row.code,
    tableName: row.name,
    createdAt: iso(row.created_at),
  } : null;
}

export async function openRestaurantQrSession(publicTokenInput: string, currentSessionToken?: string | null) {
  const publicToken = normalizePublicToken(publicTokenInput);
  // The public token is globally unique and is the only discovery input. Once it resolves, every
  // subsequent read/write enters an explicit tenant transaction.
  const locator = await query<{
    qr_id: string;
    tenant_id: string;
    location_id: string;
    table_id: string;
    table_code: string;
    table_name: string;
    blocked: boolean;
    business_archetype: string | null;
    store_name: string | null;
    location_name: string;
  }>(
    `SELECT qr.id AS qr_id, qr.tenant_id, qr.location_id, qr.table_id,
            t.code AS table_code, t.name AS table_name, t.blocked,
            profile.business_archetype, tenant.name AS store_name, location.name AS location_name
       FROM bms_restaurant_table_qr_tokens qr
       JOIN bms_restaurant_tables t
         ON t.tenant_id = qr.tenant_id AND t.id = qr.table_id AND t.active
       JOIN bms_locations location
         ON location.tenant_id = qr.tenant_id AND location.id = qr.location_id AND location.active
       JOIN bms_tenants tenant ON tenant.id = qr.tenant_id
       LEFT JOIN bms_store_profile profile ON profile.tenant_id = qr.tenant_id
      WHERE qr.public_token_hash = $1 AND qr.active`,
    [sha256(publicToken)]
  );
  const found = locator.rows[0];
  if (!found || found.business_archetype !== "restaurant") {
    return { status: "INVALID_QR" as const };
  }
  if (found.blocked) {
    return {
      status: "TABLE_UNAVAILABLE" as const,
      storeName: found.store_name || "ร้านอาหาร",
      locationName: found.location_name,
      tableCode: found.table_code,
      tableName: found.table_name,
    };
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, found.tenant_id);
    // Match the admin issue/rotate lock order (table -> token) so rotation cannot race a scan into
    // returning a READY cookie that was already invalid by the time the response left the server.
    const tableStillAvailable = await client.query(
      `SELECT 1
         FROM bms_restaurant_tables table_row
         JOIN bms_locations location
           ON location.tenant_id = table_row.tenant_id AND location.id = table_row.location_id
          AND location.active
        WHERE table_row.tenant_id = $1 AND table_row.location_id = $2 AND table_row.id = $3
          AND table_row.active AND NOT table_row.blocked
        FOR UPDATE OF table_row`,
      [found.tenant_id, found.location_id, found.table_id]
    );
    const tokenStillActive = tableStillAvailable.rowCount ? await client.query(
      `SELECT 1 FROM bms_restaurant_table_qr_tokens
        WHERE tenant_id = $1 AND location_id = $2 AND table_id = $3 AND id = $4 AND active
        FOR UPDATE`,
      [found.tenant_id, found.location_id, found.table_id, found.qr_id]
    ) : null;
    if (!tableStillAvailable.rowCount || !tokenStillActive?.rowCount) {
      throw new RestaurantCheckError("QR โต๊ะไม่ถูกต้อง ถูกยกเลิก หรือโต๊ะไม่พร้อมใช้งานแล้ว");
    }
    const check = await client.query<{ id: string; guest_count: number }>(
      `SELECT id, guest_count
         FROM bms_restaurant_checks
        WHERE tenant_id = $1 AND location_id = $2 AND table_id = $3 AND status = 'OPEN'
        ORDER BY opened_at DESC LIMIT 1
        FOR UPDATE`,
      [found.tenant_id, found.location_id, found.table_id]
    );
    if (!check.rowCount) {
      await client.query("COMMIT");
      return {
        status: "WAITING_FOR_TABLE" as const,
        storeName: found.store_name || "ร้านอาหาร",
        locationName: found.location_name,
        tableCode: found.table_code,
        tableName: found.table_name,
      };
    }

    const existingToken = normalizeSessionToken(currentSessionToken);
    if (existingToken) {
      const existing = await client.query<{ id: string; expires_at: Date | string }>(
        `UPDATE bms_restaurant_qr_sessions session
            SET last_seen_at = now()
           FROM bms_restaurant_table_qr_tokens qr
          WHERE session.tenant_id = $1 AND session.check_id = $2
            AND session.qr_token_id = $3 AND session.session_token_hash = $4
            AND session.revoked_at IS NULL AND session.expires_at > now()
            AND qr.tenant_id = session.tenant_id AND qr.id = session.qr_token_id AND qr.active
          RETURNING session.id, session.expires_at`,
        [found.tenant_id, check.rows[0].id, found.qr_id, sha256(existingToken)]
      );
      if (existing.rowCount) {
        await client.query("COMMIT");
        return {
          status: "READY" as const,
          sessionToken: existingToken,
          expiresAt: iso(existing.rows[0].expires_at),
          storeName: found.store_name || "ร้านอาหาร",
          locationName: found.location_name,
          tableCode: found.table_code,
          tableName: found.table_name,
          guestCount: Number(check.rows[0].guest_count),
        };
      }
    }

    const sessionToken = opaqueToken();
    const session = await client.query<{ expires_at: Date | string }>(
      `INSERT INTO bms_restaurant_qr_sessions
         (tenant_id, location_id, table_id, check_id, qr_token_id, session_token_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,now() + interval '12 hours')
       RETURNING expires_at`,
      [found.tenant_id, found.location_id, found.table_id, check.rows[0].id,
        found.qr_id, sha256(sessionToken)]
    );
    await client.query("COMMIT");
    return {
      status: "READY" as const,
      sessionToken,
      expiresAt: iso(session.rows[0].expires_at),
      storeName: found.store_name || "ร้านอาหาร",
      locationName: found.location_name,
      tableCode: found.table_code,
      tableName: found.table_name,
      guestCount: Number(check.rows[0].guest_count),
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function requireRestaurantQrSession(
  sessionTokenInput: string | null | undefined,
  publicTokenInput: string
): Promise<QrSessionContext> {
  const sessionToken = normalizeSessionToken(sessionTokenInput);
  if (!sessionToken) throw new RestaurantCheckError("เซสชันโต๊ะหมดอายุ กรุณาสแกน QR ใหม่");
  const publicTokenHash = sha256(normalizePublicToken(publicTokenInput));
  const result = await query<{
    id: string;
    tenant_id: string;
    location_id: string;
    table_id: string;
    check_id: string;
    check_status: string;
    table_code: string;
    table_name: string;
    store_name: string | null;
    location_name: string;
    expires_at: Date | string;
  }>(
    `SELECT session.id, session.tenant_id, session.location_id, session.table_id,
            session.check_id, check_row.status AS check_status,
            table_row.code AS table_code, table_row.name AS table_name,
            tenant.name AS store_name, location.name AS location_name, session.expires_at
       FROM bms_restaurant_qr_sessions session
       JOIN bms_restaurant_table_qr_tokens qr
         ON qr.tenant_id = session.tenant_id AND qr.id = session.qr_token_id AND qr.active
       JOIN bms_restaurant_checks check_row
         ON check_row.tenant_id = session.tenant_id AND check_row.id = session.check_id
        AND check_row.location_id = session.location_id AND check_row.table_id = session.table_id
       JOIN bms_restaurant_tables table_row
         ON table_row.tenant_id = session.tenant_id AND table_row.id = session.table_id
        AND table_row.location_id = session.location_id AND table_row.active AND NOT table_row.blocked
       JOIN bms_locations location
         ON location.tenant_id = session.tenant_id AND location.id = session.location_id AND location.active
       JOIN bms_tenants tenant ON tenant.id = session.tenant_id
      WHERE session.session_token_hash = $1 AND qr.public_token_hash = $2
        AND session.revoked_at IS NULL
        AND session.expires_at > now() AND check_row.status = 'OPEN'`,
    [sha256(sessionToken), publicTokenHash]
  );
  const row = result.rows[0];
  if (!row) throw new RestaurantCheckError("บิลโต๊ะปิดแล้วหรือเซสชันหมดอายุ กรุณาสแกน QR ใหม่");
  return {
    sessionId: row.id,
    tenantId: row.tenant_id,
    locationId: row.location_id,
    tableId: row.table_id,
    tableCode: row.table_code,
    tableName: row.table_name,
    checkId: row.check_id,
    checkStatus: row.check_status,
    storeName: row.store_name || "ร้านอาหาร",
    locationName: row.location_name,
    expiresAt: iso(row.expires_at),
  };
}

export async function getRestaurantQrMenu(sessionToken: string | null | undefined, publicToken: string) {
  const session = await requireRestaurantQrSession(sessionToken, publicToken);
  const items = await listRestaurantMenu(session.tenantId, session.locationId);
  return {
    table: {
      code: session.tableCode,
      name: session.tableName,
      storeName: session.storeName,
      locationName: session.locationName,
      expiresAt: session.expiresAt,
    },
    // Do not pass the internal restaurant/catalog object through to a public browser. Exact stock,
    // station ids and reset metadata are operational data; the guest needs only display fields and
    // a boolean hint for choosing an initial variant. Acceptance revalidates actual availability.
    items: items.map((item) => ({
      sku: item.sku,
      name: item.name,
      price: item.price,
      imageUrl: item.imageUrl,
      kitchenStation: item.kitchenStation,
      availableSizes: item.availableSizes.map((variant) => ({
        size: variant.size,
        available: Number(variant.available) > 0,
      })),
      sellable: item.sellable,
      availability: item.availability,
    })),
  };
}

export async function getRestaurantQrMenuItem(input: {
  sessionToken?: string | null;
  publicToken: string;
  sku: string;
  size?: string | null;
  packCode?: string | null;
}) {
  const session = await requireRestaurantQrSession(input.sessionToken, input.publicToken);
  const menu = await listRestaurantMenu(session.tenantId, session.locationId);
  const summary = menu.find((item) => item.sku === input.sku && item.sellable);
  if (!summary) throw new RestaurantCheckError("เมนูนี้ไม่พร้อมขายในขณะนี้");
  const hit = await resolvePosScan(session.tenantId, input.sku, {
    locationId: session.locationId,
    size: input.size ?? null,
    packCode: input.packCode ?? null,
    surface: "RESTAURANT_POS",
  });
  if (!hit) throw new RestaurantCheckError("ไม่พบเมนูหรือตัวเลือกนี้");
  return {
    sku: hit.sku,
    productName: hit.productName,
    size: hit.size,
    packCode: hit.packCode,
    unitName: hit.unitName,
    packPrice: hit.packPrice,
    modifiers: hit.modifiers,
  };
}

function normalizeSubmissionItems(items: RestaurantQrItemInput[]) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_SUBMISSION_ITEMS) {
    throw new RestaurantCheckError(`หนึ่งรอบต้องมีรายการ 1–${MAX_SUBMISSION_ITEMS} รายการ`);
  }
  return items.map((item) => {
    if (!item || typeof item !== "object") {
      throw new RestaurantCheckError("รายการอาหารหรือจำนวนไม่ถูกต้อง");
    }
    if (typeof item.sku !== "string"
      || typeof item.packQty !== "number"
      || (item.size != null && typeof item.size !== "string")
      || (item.packCode != null && typeof item.packCode !== "string")
      || (item.kitchenNote != null && typeof item.kitchenNote !== "string")) {
      throw new RestaurantCheckError("รายการอาหารหรือจำนวนไม่ถูกต้อง");
    }
    const sku = item.sku.trim();
    const packQty = item.packQty;
    const kitchenNote = (item.kitchenNote ?? "").trim();
    const rawModifierCodes = item.modifierCodes == null ? [] : item.modifierCodes;
    if (!Array.isArray(rawModifierCodes)) {
      throw new RestaurantCheckError("ตัวเลือกเมนูไม่ถูกต้อง");
    }
    if (rawModifierCodes.some((code) => typeof code !== "string")) {
      throw new RestaurantCheckError("ตัวเลือกเมนูไม่ถูกต้อง");
    }
    const modifierCodes = Array.from(new Set(rawModifierCodes
      .map((code) => String(code).trim().toUpperCase()).filter(Boolean))).sort();
    if (!sku || !Number.isInteger(packQty) || packQty < 1 || packQty > 9999) {
      throw new RestaurantCheckError("รายการอาหารหรือจำนวนไม่ถูกต้อง");
    }
    if (modifierCodes.length > 30 || kitchenNote.length > 300) {
      throw new RestaurantCheckError("ตัวเลือกหรือหมายเหตุยาวเกินกำหนด");
    }
    return {
      sku,
      size: (item.size ?? "").trim() || null,
      packCode: (item.packCode ?? "").trim() || null,
      packQty,
      modifierCodes,
      kitchenNote: kitchenNote || null,
    };
  });
}

export async function submitRestaurantQrOrder(input: {
  sessionToken?: string | null;
  publicToken: string;
  idempotencyKey: string;
  items: RestaurantQrItemInput[];
}) {
  const session = await requireRestaurantQrSession(input.sessionToken, input.publicToken);
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 120) {
    throw new RestaurantCheckError("รหัสป้องกันการส่งซ้ำไม่ถูกต้อง");
  }

  // A retry after a lost response must return the original result even if the menu changed in the
  // meantime. The in-transaction ON CONFLICT below is still required for two simultaneous first
  // attempts that both pass this fast-path before either one commits.
  const replay = await query<{ id: string; status: string }>(
    `SELECT id, status FROM bms_restaurant_qr_submissions
      WHERE tenant_id = $1 AND session_id = $2 AND idempotency_key = $3`,
    [session.tenantId, session.sessionId, idempotencyKey]
  );
  if (replay.rowCount) {
    return { submissionId: replay.rows[0].id, status: replay.rows[0].status, replayed: true };
  }
  const items = normalizeSubmissionItems(input.items);

  // Public display validation happens before the write. Acceptance validates again against the
  // current catalog and the normal order engine remains the final price/stock authority.
  const menu = await listRestaurantMenu(session.tenantId, session.locationId);
  const sellable = new Set(menu.filter((item) => item.sellable).map((item) => item.sku));
  const unavailable = items.find((item) => !sellable.has(item.sku));
  if (unavailable) throw new RestaurantCheckError(`เมนู ${unavailable.sku} ไม่พร้อมขายในขณะนี้`);
  const resolvedItems = await Promise.all(items.map((item) =>
    resolveRestaurantCheckItemRequest(session.tenantId, session.locationId, item)
  ));

  const client = await getClient();
  try {
    await beginTenantTx(client, session.tenantId);
    const valid = await client.query(
      `SELECT 1
         FROM bms_restaurant_qr_sessions s
         JOIN bms_restaurant_checks c
           ON c.tenant_id = s.tenant_id AND c.id = s.check_id
          AND c.location_id = s.location_id AND c.table_id = s.table_id
        WHERE s.tenant_id = $1 AND s.id = $2 AND s.check_id = $3
          AND s.revoked_at IS NULL AND s.expires_at > now() AND c.status = 'OPEN'
        FOR UPDATE OF s, c`,
      [session.tenantId, session.sessionId, session.checkId]
    );
    if (!valid.rowCount) throw new RestaurantCheckError("บิลโต๊ะปิดแล้ว กรุณาติดต่อพนักงาน");
    // เพดานคำขอที่ยังไม่ได้ตรวจต่อโต๊ะ — เพดานต่อนาที (route) กันการยิงรัว แต่ไม่กันการ
    // สะสม: session อยู่ได้ 12 ชม. โทรศัพท์เครื่องเดียวจึงกองคำขอค้างในกล่องขาเข้าของ
    // พนักงานได้ไม่จำกัด และกล่องนั้นตัดที่ 100 แถว = ของจริงถูกดันหายไปจากหน้าจอ
    // นับต่อ "บิลโต๊ะ" ไม่ใช่ต่อ session เพราะโต๊ะหนึ่งมีลูกค้าหลายเครื่องได้
    const pending = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM bms_restaurant_qr_submissions
        WHERE tenant_id = $1 AND check_id = $2 AND status = 'PENDING'`,
      [session.tenantId, session.checkId]
    );
    if (Number(pending.rows[0]?.n ?? 0) >= MAX_PENDING_SUBMISSIONS_PER_CHECK) {
      throw new RestaurantCheckError("มีรายการรอพนักงานตรวจอยู่หลายรอบแล้ว กรุณารอพนักงานรับก่อนสั่งเพิ่ม");
    }
    const submission = await client.query<{ id: string }>(
      `INSERT INTO bms_restaurant_qr_submissions
         (tenant_id, location_id, table_id, check_id, session_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, session_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [session.tenantId, session.locationId, session.tableId, session.checkId,
        session.sessionId, idempotencyKey]
    );
    if (!submission.rowCount) {
      const concurrentReplay = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM bms_restaurant_qr_submissions
          WHERE tenant_id = $1 AND session_id = $2 AND idempotency_key = $3`,
        [session.tenantId, session.sessionId, idempotencyKey]
      );
      if (!concurrentReplay.rowCount) {
        throw new RestaurantCheckError("ส่งรายการซ้ำไม่สำเร็จ กรุณาลองใหม่");
      }
      await client.query("COMMIT");
      return {
        submissionId: concurrentReplay.rows[0].id,
        status: concurrentReplay.rows[0].status,
        replayed: true,
      };
    }
    for (let index = 0; index < resolvedItems.length; index += 1) {
      const item = resolvedItems[index];
      await client.query(
        `INSERT INTO bms_restaurant_qr_submission_items
           (tenant_id, submission_id, product_sku, size, pack_code, pack_qty,
            modifier_codes, kitchen_note, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [session.tenantId, submission.rows[0].id, item.sku, item.size, item.packCode,
          item.packQty, item.modifierCodes, item.kitchenNote, index]
      );
    }
    await client.query("COMMIT");
    return { submissionId: submission.rows[0].id, status: "PENDING", replayed: false };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function listRestaurantQrSubmissions(tenantId: string, locationId: string) {
  const result = await query<any>(
    `WITH recent AS (
       SELECT * FROM bms_restaurant_qr_submissions
        WHERE tenant_id = $1 AND location_id = $2
          AND status IN ('PENDING','ACCEPTED','REJECTED')
          AND submitted_at > now() - interval '24 hours'
        ORDER BY submitted_at DESC
        LIMIT 100
     )
     SELECT submission.id, submission.status, submission.check_id, submission.submitted_at,
            submission.reviewed_at, submission.rejection_reason,
            table_row.id AS table_id, table_row.code AS table_code, table_row.name AS table_name,
            item.id AS item_id, item.product_sku, product.name AS product_name,
            item.size, item.pack_code, item.pack_qty, item.modifier_codes, item.kitchen_note,
            COALESCE((
              SELECT array_agg(modifier.name ORDER BY array_position(item.modifier_codes, modifier.code))
                FROM bms_product_modifiers modifier
               WHERE modifier.tenant_id = item.tenant_id
                 AND modifier.product_sku = item.product_sku
                 AND modifier.size = item.size
                 AND modifier.code = ANY(item.modifier_codes)
            ), ARRAY[]::text[]) AS modifier_names,
            item.accepted_check_item_id, item.sort_order,
            COALESCE(pack.price, product.price)::numeric
              + COALESCE((
                  SELECT SUM(modifier.price_delta)
                    FROM bms_product_modifiers modifier
                   WHERE modifier.tenant_id = item.tenant_id
                     AND modifier.product_sku = item.product_sku
                     AND modifier.size = item.size
                     AND modifier.code = ANY(item.modifier_codes) AND modifier.active
                ), 0)::numeric AS estimated_unit_price
       FROM recent submission
       JOIN bms_restaurant_checks check_row
         ON check_row.tenant_id = submission.tenant_id AND check_row.id = submission.check_id
        AND check_row.location_id = submission.location_id
       JOIN bms_restaurant_tables table_row
         ON table_row.tenant_id = check_row.tenant_id AND table_row.id = check_row.table_id
        AND table_row.location_id = check_row.location_id
       JOIN bms_restaurant_qr_submission_items item
         ON item.tenant_id = submission.tenant_id AND item.submission_id = submission.id
       JOIN bms_products product
         ON product.tenant_id = item.tenant_id AND product.sku = item.product_sku
       LEFT JOIN LATERAL (
         SELECT candidate.price
           FROM bms_product_packs candidate
          WHERE candidate.tenant_id = item.tenant_id
            AND candidate.product_sku = item.product_sku
            AND candidate.pack_code = item.pack_code
            AND (candidate.size = item.size OR candidate.size IS NULL)
            AND candidate.active
          ORDER BY (candidate.size = item.size) DESC NULLS LAST
          LIMIT 1
       ) pack ON TRUE
      ORDER BY submission.submitted_at, item.sort_order, item.id
      `,
    [tenantId, locationId]
  );
  const grouped = new Map<string, any>();
  for (const row of result.rows) {
    const submission = grouped.get(row.id) ?? {
      id: row.id,
      status: row.status,
      checkId: row.check_id,
      tableId: row.table_id,
      tableCode: row.table_code,
      tableName: row.table_name,
      submittedAt: iso(row.submitted_at),
      reviewedAt: row.reviewed_at ? iso(row.reviewed_at) : null,
      rejectionReason: row.rejection_reason,
      items: [],
    };
    submission.items.push({
      id: row.item_id,
      sku: row.product_sku,
      productName: row.product_name,
      size: row.size,
      packCode: row.pack_code,
      packQty: Number(row.pack_qty),
      modifierCodes: row.modifier_codes ?? [],
      modifierNames: row.modifier_names ?? [],
      kitchenNote: row.kitchen_note,
      acceptedCheckItemId: row.accepted_check_item_id,
      estimatedUnitPrice: Number(row.estimated_unit_price),
    });
    grouped.set(row.id, submission);
  }
  return [...grouped.values()].map((submission) => {
    let estimatedTotal = 0;
    for (const item of submission.items) {
      estimatedTotal += item.estimatedUnitPrice * item.packQty;
    }
    return { ...submission, estimatedTotal };
  });
}

export async function getRestaurantQrSubmissionStatus(
  sessionToken: string | null | undefined,
  publicToken: string
) {
  const session = await requireRestaurantQrSession(sessionToken, publicToken);
  const result = await query<{
    id: string;
    status: string;
    rejection_reason: string | null;
    submitted_at: Date | string;
    reviewed_at: Date | string | null;
  }>(
    `SELECT id, status, rejection_reason, submitted_at, reviewed_at
       FROM bms_restaurant_qr_submissions
      WHERE tenant_id = $1 AND session_id = $2
      ORDER BY submitted_at DESC LIMIT 20`,
    [session.tenantId, session.sessionId]
  );
  return {
    table: {
      code: session.tableCode,
      name: session.tableName,
      storeName: session.storeName,
      locationName: session.locationName,
      expiresAt: session.expiresAt,
    },
    submissions: result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      rejectionReason: row.rejection_reason,
      submittedAt: iso(row.submitted_at),
      reviewedAt: row.reviewed_at ? iso(row.reviewed_at) : null,
    })),
  };
}

export async function rejectRestaurantQrSubmission(input: {
  tenantId: string;
  locationId: string;
  submissionId: string;
  actorUserId: string;
  reason: string;
}) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 300) throw new RestaurantCheckError("ต้องระบุเหตุผลไม่เกิน 300 ตัวอักษร");
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const updated = await client.query(
      `UPDATE bms_restaurant_qr_submissions
          SET status = 'REJECTED', reviewed_by = $4, rejection_reason = $5,
              reviewed_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND location_id = $2 AND id = $3 AND status = 'PENDING'
        RETURNING id`,
      [input.tenantId, input.locationId, input.submissionId, input.actorUserId, reason]
    );
    if (!updated.rowCount) throw new RestaurantCheckError("รายการนี้ถูกรับ ปฏิเสธ หรือหมดอายุแล้ว");
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.qr_submission.reject',$3,$4::jsonb)`,
      [input.tenantId, `user:${input.actorUserId}`, input.submissionId,
        JSON.stringify({ locationId: input.locationId })]
    );
    await client.query("COMMIT");
    return { id: input.submissionId, status: "REJECTED" as const };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
