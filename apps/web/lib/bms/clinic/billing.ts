import { createOrderInTx } from "../orders";
import { getVariantBasePriceInTx } from "../productPacks";
import { ClinicError, auditClinicRead, auditClinicWrite, boundedText, clinicTx, requireClinicRole, uuid } from "./access";

type ChargeLine = { sku: string; size: string; qty: number; unitPrice: number; vatCategory: "N" };

/** Cashier worklist contains identifiers and billing state, never clinical note content. */
export async function listBillableClinicEncounters(input: {
  tenantId: string; actorId: string; search: unknown;
}) {
  const search = boundedText(input.search ?? "", 100);
  const escaped = search.replace(/[\\%_]/g, "\\$&");
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["CASHIER"]);
    const rows = await client.query<{
      id: string; patient_hn: string; patient_name: string; signed_at: Date;
      charge_status: string | null; order_id: string | null;
    }>(`SELECT e.id,p.hn AS patient_hn,p.full_name AS patient_name,e.signed_at,
               s.status AS charge_status,s.order_id
          FROM bms_clinic_encounters e
          JOIN bms_clinic_patients p ON p.tenant_id=e.tenant_id AND p.id=e.patient_id
          LEFT JOIN bms_clinic_charge_sheets s ON s.tenant_id=e.tenant_id AND s.encounter_id=e.id
         WHERE e.tenant_id=$1 AND e.status='SIGNED'
           AND (p.hn ILIKE $2 OR p.full_name ILIKE $3 ESCAPE '\\')
         ORDER BY e.signed_at DESC,e.id DESC LIMIT 101`,
      [input.tenantId, `${escaped}%`, `%${escaped}%`]);
    await auditClinicRead(client, input.tenantId, input.actorId, "CLINIC_BILLING_WORKLIST", "worklist");
    return { encounters: rows.rows.slice(0, 100).map((row) => ({
      id: row.id, patientHn: row.patient_hn, patientName: row.patient_name,
      signedAt: row.signed_at.toISOString(), chargeStatus: row.charge_status, orderId: row.order_id,
    })), truncated: rows.rows.length > 100 };
  });
}

function parseLines(value: unknown): Array<{ sku: string; size: string; qty: number }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw new ClinicError("INVALID_CHARGE_LINES");
  const lines = value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ClinicError("INVALID_CHARGE_LINE");
    const line = item as Record<string, unknown>;
    const sku = boundedText(line.sku, 100, 1);
    const size = boundedText(line.size, 64, 1);
    const qty = Number(line.qty);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1000) throw new ClinicError("INVALID_CHARGE_QTY");
    return { sku, size, qty };
  });
  if (new Set(lines.map((line) => JSON.stringify([line.sku, line.size]))).size !== lines.length)
    throw new ClinicError("DUPLICATE_CHARGE_LINE");
  return lines;
}

/** The pilot permits catalogued, non-stock, VAT-N services only. It never dispenses medication. */
export async function saveClinicChargeSheet(input: {
  tenantId: string; actorId: string; encounterId: unknown; lines: unknown;
}): Promise<{ sheetId: string; lines: ChargeLine[] }> {
  const encounterId = uuid(input.encounterId);
  const requested = parseLines(input.lines);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["CASHIER"]);
    const encounter = await client.query<{ location_id: string }>(
      `SELECT location_id FROM bms_clinic_encounters WHERE tenant_id=$1 AND id=$2 AND status='SIGNED' FOR UPDATE`,
      [input.tenantId, encounterId]
    );
    if (!encounter.rows[0]) throw new ClinicError("SIGNED_ENCOUNTER_REQUIRED", 409);
    const locationId = encounter.rows[0].location_id;
    const lines: ChargeLine[] = [];
    for (const line of requested) {
      const product = await client.query<{ vat_category: string }>(
        `SELECT p.vat_category FROM bms_products p
          JOIN bms_product_stock_policies policy ON policy.tenant_id=p.tenant_id AND policy.product_sku=p.sku
          JOIN bms_product_variants variant ON variant.tenant_id=p.tenant_id
            AND variant.product_sku=p.sku AND variant.code=$3
          JOIN bms_product_sales_surfaces surface ON surface.tenant_id=p.tenant_id
            AND surface.product_sku=p.sku AND surface.surface='ONLINE_ORDER' AND surface.enabled
         WHERE p.tenant_id=$1 AND p.sku=$2 AND p.active AND variant.active
           AND policy.stock_policy='NON_STOCK' AND p.vat_category='N'`,
        [input.tenantId, line.sku, line.size]
      );
      if (!product.rowCount) throw new ClinicError("CHARGE_SERVICE_NOT_APPROVED", 409);
      const price = await getVariantBasePriceInTx(client, input.tenantId, line.sku, line.size, locationId);
      if (price == null || !Number.isFinite(price) || price < 0) throw new ClinicError("CHARGE_PRICE_MISSING", 409);
      lines.push({ ...line, unitPrice: price, vatCategory: "N" });
    }
    let sheet = await client.query<{ id: string; status: string }>(
      `SELECT id,status FROM bms_clinic_charge_sheets WHERE tenant_id=$1 AND encounter_id=$2 FOR UPDATE`,
      [input.tenantId, encounterId]
    );
    if (!sheet.rows[0]) sheet = await client.query<{ id: string; status: string }>(
      `INSERT INTO bms_clinic_charge_sheets (tenant_id,encounter_id)
       VALUES ($1,$2) RETURNING id,status`, [input.tenantId, encounterId]
    );
    if (sheet.rows[0].status !== "DRAFT") throw new ClinicError("CHARGE_SHEET_LOCKED", 409);
    const sheetId = sheet.rows[0].id;
    await client.query(`DELETE FROM bms_clinic_charge_lines WHERE tenant_id=$1 AND sheet_id=$2`,
      [input.tenantId, sheetId]);
    for (const [index, line] of lines.entries()) {
      await client.query(
        `INSERT INTO bms_clinic_charge_lines
          (tenant_id,sheet_id,line_no,product_sku,size,qty,reviewed_unit_price,reviewed_vat_category)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'N')`,
        [input.tenantId, sheetId, index + 1, line.sku, line.size, line.qty, line.unitPrice]
      );
    }
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.charge_sheet.draft_saved", sheetId, "CLINIC_CHARGE_SHEET", { lineCount: lines.length });
    return { sheetId, lines };
  });
}

export async function reviewClinicChargeSheet(input: {
  tenantId: string; actorId: string; sheetId: unknown; confirmation: unknown;
}): Promise<void> {
  const sheetId = uuid(input.sheetId);
  if (input.confirmation !== "CONFIRM CLINIC CHARGES") throw new ClinicError("CONFIRMATION_REQUIRED");
  await clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["CASHIER"]);
    const sheet = await client.query<{ status: string }>(
      `SELECT status FROM bms_clinic_charge_sheets WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [input.tenantId, sheetId]
    );
    if (sheet.rows[0]?.status !== "DRAFT") throw new ClinicError("CHARGE_SHEET_NOT_DRAFT", 409);
    const count = await client.query(`SELECT 1 FROM bms_clinic_charge_lines WHERE tenant_id=$1 AND sheet_id=$2 LIMIT 1`,
      [input.tenantId, sheetId]);
    if (!count.rowCount) throw new ClinicError("EMPTY_CHARGE_SHEET", 409);
    await client.query(
      `UPDATE bms_clinic_charge_sheets SET status='READY',reviewed_by=$3,reviewed_at=now(),updated_at=now()
        WHERE tenant_id=$1 AND id=$2`, [input.tenantId, sheetId, input.actorId]
    );
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.charge_sheet.reviewed", sheetId, "CLINIC_CHARGE_SHEET");
  });
}

export async function readClinicChargeSheet(input: {
  tenantId: string; actorId: string; encounterId: unknown;
}) {
  const encounterId = uuid(input.encounterId);
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["CASHIER", "CLINICIAN"]);
    const encounter = await client.query<{ patient_id: string }>(
      `SELECT patient_id FROM bms_clinic_encounters WHERE tenant_id=$1 AND id=$2`,
      [input.tenantId, encounterId]
    );
    if (!encounter.rows[0]) throw new ClinicError("ENCOUNTER_NOT_FOUND", 404);
    const sheet = await client.query(
      `SELECT s.id,s.status,s.order_id,s.reviewed_at,o.status AS order_status
         FROM bms_clinic_charge_sheets s
         LEFT JOIN bms_orders o ON o.tenant_id=s.tenant_id AND o.id=s.order_id
        WHERE s.tenant_id=$1 AND s.encounter_id=$2`, [input.tenantId, encounterId]
    );
    const row = sheet.rows[0];
    const lines = row ? await client.query(
      `SELECT line_no,product_sku,size,qty,reviewed_unit_price,reviewed_vat_category
         FROM bms_clinic_charge_lines WHERE tenant_id=$1 AND sheet_id=$2 ORDER BY line_no`,
      [input.tenantId, row.id]
    ) : { rows: [] };
    await auditClinicRead(client, input.tenantId, input.actorId, "CLINIC_CHARGE_SHEET",
      encounterId, encounter.rows[0].patient_id);
    return { sheet: row ?? null, lines: lines.rows };
  });
}

export async function createClinicChargeOrder(input: {
  tenantId: string; actorId: string; sheetId: unknown; confirmation: unknown;
}): Promise<{ status: "CREATED" | "REPLAYED"; orderId: string; amountDue: number }> {
  const sheetId = uuid(input.sheetId);
  if (input.confirmation !== "CREATE CLINIC ORDER") throw new ClinicError("CONFIRMATION_REQUIRED");
  return clinicTx(input.tenantId, input.actorId, async (client) => {
    await requireClinicRole(client, input.tenantId, input.actorId, ["CASHIER"]);
    const sheet = await client.query<{ status: string; order_id: string | null; location_id: string }>(
      `SELECT s.status,s.order_id,e.location_id FROM bms_clinic_charge_sheets s
         JOIN bms_clinic_encounters e ON e.tenant_id=s.tenant_id AND e.id=s.encounter_id
        WHERE s.tenant_id=$1 AND s.id=$2 FOR UPDATE OF s`, [input.tenantId, sheetId]
    );
    const state = sheet.rows[0];
    if (!state) throw new ClinicError("CHARGE_SHEET_NOT_FOUND", 404);
    if (state.status === "ORDER_CREATED" && state.order_id) {
      const existing = await client.query<{ total_amount: string; shipping_fee: string; status: string }>(
        `SELECT total_amount,shipping_fee,status FROM bms_orders WHERE tenant_id=$1 AND id=$2`,
        [input.tenantId, state.order_id]
      );
      if (!existing.rows[0] || ["CANCELLED", "RETURNED"].includes(existing.rows[0].status))
        throw new ClinicError("CHARGE_ORDER_CLOSED_REVIEW_REQUIRED", 409);
      return { status: "REPLAYED", orderId: state.order_id,
        amountDue: Number(existing.rows[0].total_amount) + Number(existing.rows[0].shipping_fee) };
    }
    if (state.status !== "READY") throw new ClinicError("CHARGE_SHEET_NOT_READY", 409);
    const rows = await client.query<{
      product_sku: string; size: string; qty: number; reviewed_unit_price: string;
    }>(`SELECT product_sku,size,qty,reviewed_unit_price FROM bms_clinic_charge_lines
          WHERE tenant_id=$1 AND sheet_id=$2 ORDER BY line_no`, [input.tenantId, sheetId]);
    if (!rows.rowCount) throw new ClinicError("EMPTY_CHARGE_SHEET", 409);
    for (const line of rows.rows) {
      const approved = await client.query(
        `SELECT 1 FROM bms_products p
          JOIN bms_product_stock_policies policy ON policy.tenant_id=p.tenant_id AND policy.product_sku=p.sku
          JOIN bms_product_variants variant ON variant.tenant_id=p.tenant_id
            AND variant.product_sku=p.sku AND variant.code=$3
          JOIN bms_product_sales_surfaces surface ON surface.tenant_id=p.tenant_id
            AND surface.product_sku=p.sku AND surface.surface='ONLINE_ORDER' AND surface.enabled
         WHERE p.tenant_id=$1 AND p.sku=$2 AND p.active AND variant.active
           AND policy.stock_policy='NON_STOCK' AND p.vat_category='N'`,
        [input.tenantId, line.product_sku, line.size]
      );
      if (!approved.rowCount) throw new ClinicError("CHARGE_SERVICE_NOT_APPROVED", 409);
    }
    const expected = rows.rows.reduce((sum, line) => sum + Number(line.reviewed_unit_price) * line.qty, 0);
    const created = await createOrderInTx(client, {
      tenantId: input.tenantId, channel: "clinic", locationId: state.location_id,
      editorId: input.actorId,
      items: rows.rows.map((line) => ({ sku: line.product_sku, size: line.size, qty: line.qty })),
    });
    if (created.status !== "CREATED") throw new ClinicError(`ORDER_${created.status}`, 409);
    const expectedCents = Math.round(expected * 100);
    if (created.discount !== 0 || created.shippingFee !== 0 || Math.round(created.total * 100) !== expectedCents
      || created.items.length !== rows.rows.length || created.items.some((line, index) => {
        const reviewed = rows.rows[index];
        return line.sku !== reviewed.product_sku || line.size !== reviewed.size || line.qty !== reviewed.qty
          || line.vatCategory !== "N" || line.availableAfter !== null
          || Math.round(line.lineAmount * 100) !== Math.round(Number(reviewed.reviewed_unit_price) * reviewed.qty * 100);
      })) {
      throw new ClinicError("CHARGE_REVIEW_CHANGED", 409);
    }
    await client.query(
      `UPDATE bms_clinic_charge_sheets
          SET status='ORDER_CREATED',order_id=$3,updated_at=now()
        WHERE tenant_id=$1 AND id=$2`, [input.tenantId, sheetId, created.orderId]
    );
    await auditClinicWrite(client, input.tenantId, input.actorId,
      "clinic.charge_sheet.order_created", sheetId, "CLINIC_CHARGE_SHEET", { orderId: created.orderId });
    return { status: "CREATED", orderId: created.orderId, amountDue: created.amountDue };
  });
}
