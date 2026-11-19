// Durable, VAT-inclusive staff quotations. A quote is not an order or stock reservation.
import { createHash, randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { insertAuditInTx } from "./audit";
import { insertWithDailyDocNo } from "./dailyDocNo";
import { branchPrice } from "./branchPrices";
import { getVariantBasePriceInTx } from "./productPacks";
import { currentWeightedKgRate } from "./weightedKgPricing";
import { getVatSettings } from "./taxDocuments";
import { computeVat, type VatCategory } from "./vat";
import { createOrderInTx, type CreateOrderResult } from "./orders";

export type QuoteDraftLineInput = {
  sku: string;
  size: string;
  packCode?: string | null;
  qty: number; // number of selling packs; BASE means stock units
  agreedUnitPrice?: number | null; // VAT-inclusive; staff proposal, frozen only on approval
};
export type QuoteDraftInput = {
  locationId: string;
  customerId: string;
  projectName: string;
  siteAddress?: string | null;
  deliveryTerms: "PICKUP" | "DELIVERY";
  shippingFee?: number | null;
  expiresAt: string;
  requestKey: string;
  lines: QuoteDraftLineInput[];
};
export type QuoteResult = { status: string; quoteId?: string; quoteNo?: string; revisionNo?: number;
  orderId?: string; total?: number | null; issues?: Array<{ line: number; code: string }>; orderStatus?: string };

type ResolvedLine = {
  lineNo: number; sku: string; size: string; packCode: string; packQty: number;
  baseQty: number; unitName: string; listUnitPrice: number; agreedUnitPrice: number;
  lineDiscount: number; lineAmount: number; vatCategory: VatCategory;
};

const cents = (n: number) => Math.round(n * 100);
const MAX_AMOUNT_CENTS = 99_999_999_999_999n; // NUMERIC(14,2)
const validMoney = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)
  && n >= 0 && n <= 9_999_999_999.99 && Math.abs(cents(n) - n * 100) < 1e-7;
const hashInput = (input: QuoteDraftInput, priorId: string | null) =>
  createHash("sha256").update(JSON.stringify([priorId, input])).digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function allowedBranch(client: PoolClient, tenantId: string, actorId: string, locationId: string): Promise<boolean> {
  const res = await client.query<{ allowed: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=$3 AND (u.tenant_id=$1 OR u.is_platform_admin))
      AND EXISTS(SELECT 1 FROM bms_locations l WHERE l.tenant_id=$1 AND l.id=$2 AND l.active)
      AND (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$3)
        OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a
          WHERE a.tenant_id=$1 AND a.user_id=$3 AND a.location_id=$2)) AS allowed`,
    [tenantId, locationId, actorId]
  );
  return res.rows[0]?.allowed === true;
}

function normalizeDraft(input: QuoteDraftInput): QuoteDraftInput | null {
  if (!input || !UUID.test(input.locationId ?? "") || !UUID.test(input.customerId ?? "")
    || typeof input.projectName !== "string" || !input.projectName.trim() || input.projectName.trim().length > 200
    || (input.siteAddress != null && typeof input.siteAddress !== "string")
    || String(input.siteAddress ?? "").length > 1000
    || typeof input.expiresAt !== "string"
    || !["PICKUP", "DELIVERY"].includes(input.deliveryTerms)
    || typeof input.requestKey !== "string" || input.requestKey.length < 8 || input.requestKey.length > 200
    || !Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100) return null;
  const expiry = new Date(input.expiresAt);
  if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()
    || expiry.getTime() > Date.now() + 90 * 86400_000) return null;
  if (input.deliveryTerms === "PICKUP" && input.shippingFee !== 0) return null;
  if (input.shippingFee != null && !validMoney(input.shippingFee)) return null;
  if (input.lines.some((line) => !line || typeof line.sku !== "string" || !line.sku.trim()
    || typeof line.size !== "string" || !line.size.trim()
    || (line.packCode != null && (typeof line.packCode !== "string" || line.packCode.trim().length > 64))
    || !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 2_147_483_647
    || (line.agreedUnitPrice != null && !validMoney(line.agreedUnitPrice)))) return null;
  return {
    locationId: input.locationId, customerId: input.customerId,
    projectName: input.projectName.trim(), siteAddress: String(input.siteAddress ?? "").trim(),
    deliveryTerms: input.deliveryTerms, shippingFee: input.shippingFee ?? null,
    expiresAt: expiry.toISOString(), requestKey: input.requestKey.trim(),
    lines: input.lines.map((line) => ({ sku: line.sku.trim(), size: line.size.trim(),
      packCode: (line.packCode ?? "BASE").trim().toUpperCase() || "BASE", qty: line.qty,
      agreedUnitPrice: line.agreedUnitPrice ?? null })),
  };
}

async function resolveLines(client: PoolClient, tenantId: string, input: QuoteDraftInput): Promise<
  { ok: true; lines: ResolvedLine[] } | { ok: false; issues: Array<{ line: number; code: string }> }
> {
  const lines: ResolvedLine[] = [];
  const issues: Array<{ line: number; code: string }> = [];
  const seen = new Set<string>();
  for (const [index, item] of input.lines.entries()) {
    const key = JSON.stringify([item.sku, item.size, item.packCode]);
    if (seen.has(key)) { issues.push({ line: index + 1, code: "DUPLICATE_LINE" }); continue; }
    seen.add(key);
    const product = await client.query<{ vat_category: VatCategory; unit_name: string | null }>(
      `SELECT p.vat_category, base.unit_name FROM bms_products p
         JOIN bms_product_variants v ON v.tenant_id=p.tenant_id AND v.product_sku=p.sku
          AND v.code=$3 AND v.active
         JOIN bms_product_sales_surfaces s ON s.tenant_id=p.tenant_id AND s.product_sku=p.sku
          AND s.surface='RETAIL_POS' AND s.enabled
         LEFT JOIN LATERAL (SELECT unit_name FROM bms_product_packs k
           WHERE k.tenant_id=p.tenant_id AND k.product_sku=p.sku AND k.is_base AND k.active
             AND (k.size=$3 OR k.size IS NULL) ORDER BY k.size NULLS LAST LIMIT 1) base ON true
        WHERE p.tenant_id=$1 AND p.sku=$2 AND p.active`,
      [tenantId, item.sku, item.size]
    );
    if (!product.rowCount) { issues.push({ line: index + 1, code: "PRODUCT_UNAVAILABLE" }); continue; }
    if (await currentWeightedKgRate(client,tenantId,item.sku,item.size)) {
      issues.push({line:index+1,code:"MEASURED_ITEM_UNSUPPORTED"}); continue;
    }
    const basePrice = await getVariantBasePriceInTx(client, tenantId, item.sku, item.size, input.locationId);
    if (basePrice == null || !Number.isFinite(basePrice) || basePrice < 0) {
      issues.push({ line: index + 1, code: "PRICE_UNAVAILABLE" }); continue;
    }
    let factor = 1;
    let unitName = product.rows[0].unit_name || "หน่วยฐาน";
    let listPrice = basePrice;
    if (item.packCode !== "BASE") {
      const pack = await client.query<{ base_qty: number; unit_name: string; price: string | null }>(
        `SELECT base_qty,unit_name,price FROM bms_product_packs
          WHERE tenant_id=$1 AND product_sku=$2 AND upper(pack_code)=$3 AND active
            AND NOT is_base AND (size=$4 OR size IS NULL)
          ORDER BY size NULLS LAST LIMIT 1`,
        [tenantId, item.sku, item.packCode, item.size]
      );
      if (!pack.rowCount) { issues.push({ line: index + 1, code: "PACK_UNAVAILABLE" }); continue; }
      factor = Number(pack.rows[0].base_qty);
      unitName = pack.rows[0].unit_name;
      listPrice = (await branchPrice(client, tenantId, input.locationId, item.sku, item.size, item.packCode ?? "BASE"))
        ?? (pack.rows[0].price == null ? basePrice * factor : Number(pack.rows[0].price));
    }
    if (!Number.isSafeInteger(item.qty * factor) || item.qty * factor > 2_147_483_647
      || !validMoney(listPrice)) { issues.push({ line: index + 1, code: "INVALID_PRICE_OR_QUANTITY" }); continue; }
    const agreed = item.agreedUnitPrice ?? listPrice;
    if (!validMoney(agreed) || agreed > listPrice) {
      issues.push({ line: index + 1, code: "AGREED_PRICE_EXCEEDS_LIST" }); continue;
    }
    const lineAmountCents = BigInt(cents(agreed)) * BigInt(item.qty);
    const lineDiscountCents = BigInt(cents(listPrice) - cents(agreed)) * BigInt(item.qty);
    if (lineAmountCents > MAX_AMOUNT_CENTS || lineDiscountCents > MAX_AMOUNT_CENTS) {
      issues.push({ line: index + 1, code: "AMOUNT_OVERFLOW" }); continue;
    }
    const lineAmount = Number(lineAmountCents) / 100;
    const lineDiscount = Number(lineDiscountCents) / 100;
    lines.push({ lineNo: index + 1, sku: item.sku, size: item.size,
      packCode: item.packCode ?? "BASE", packQty: item.qty, baseQty: item.qty * factor,
      unitName, listUnitPrice: listPrice, agreedUnitPrice: agreed,
      lineDiscount, lineAmount, vatCategory: product.rows[0].vat_category ?? "UNKNOWN" });
  }
  return issues.length ? { ok: false, issues } : { ok: true, lines };
}

async function writeDraft(tenantId: string, actorId: string, raw: QuoteDraftInput,
  priorId: string | null = null): Promise<QuoteResult> {
  const input = normalizeDraft(raw);
  if (!input || !UUID.test(actorId)) return { status: "INVALID_INPUT" };
  const requestHash = hashInput(input, priorId);
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const oldRequest = await client.query<{ id: string; quote_no: string; revision_no: number; request_hash: string; total: string | null }>(
      `SELECT id,quote_no,revision_no,request_hash,total FROM bms_sales_quotations
        WHERE tenant_id=$1 AND request_key=$2`, [tenantId, input.requestKey]);
    if (oldRequest.rowCount) {
      await client.query("ROLLBACK");
      const row = oldRequest.rows[0];
      return row.request_hash === requestHash ? { status: "DRAFT", quoteId: row.id,
        quoteNo: row.quote_no, revisionNo: row.revision_no, total: row.total == null ? null : Number(row.total) }
        : { status: "IDEMPOTENCY_CONFLICT" };
    }
    if (!(await allowedBranch(client, tenantId, actorId, input.locationId))) {
      await client.query("ROLLBACK"); return { status: "BRANCH_FORBIDDEN" };
    }
    const customer = await client.query(
      `SELECT 1 FROM bms_customers WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [tenantId, input.customerId]);
    if (!customer.rowCount) { await client.query("ROLLBACK"); return { status: "CUSTOMER_NOT_FOUND" }; }
    let quoteNo: string | null = null;
    let revisionNo = 1;
    let rootId: string = randomUUID();
    if (priorId) {
      const prior = await client.query<{ id: string; quote_no: string; root_id: string; revision_no: number;
        location_id: string; customer_id: string; status: string }>(
        `SELECT id,quote_no,root_id,revision_no,location_id,customer_id,status
          FROM bms_sales_quotations WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, priorId]);
      const row = prior.rows[0];
      if (!row || !["DRAFT", "APPROVED", "SENT", "REJECTED"].includes(row.status)) {
        await client.query("ROLLBACK"); return { status: "INVALID_STATE" };
      }
      if (row.location_id !== input.locationId || row.customer_id !== input.customerId) {
        await client.query("ROLLBACK"); return { status: "IDENTITY_CHANGED" };
      }
      await client.query(`UPDATE bms_sales_quotations SET status='SUPERSEDED',updated_at=now()
        WHERE tenant_id=$1 AND id=$2`, [tenantId, priorId]);
      quoteNo = row.quote_no; revisionNo = row.revision_no + 1; rootId = row.root_id;
    }
    const resolved = await resolveLines(client, tenantId, input);
    if (!resolved.ok) { await client.query("ROLLBACK"); return { status: "INVALID_LINES", issues: resolved.issues }; }
    const subtotalCents = resolved.lines.reduce((sum, line) => sum + BigInt(cents(line.lineAmount)), 0n);
    const totalCents = input.shippingFee == null ? null : subtotalCents + BigInt(cents(input.shippingFee));
    if (subtotalCents > MAX_AMOUNT_CENTS || (totalCents != null && totalCents > MAX_AMOUNT_CENTS)) {
      await client.query("ROLLBACK"); return { status: "AMOUNT_OVERFLOW" };
    }
    const subtotal = Number(subtotalCents) / 100;
    const total = totalCents == null ? null : Number(totalCents) / 100;
    const id = priorId ? randomUUID() : rootId;
    const insert = async (number: string) => client.query(
      `INSERT INTO bms_sales_quotations
       (id,tenant_id,location_id,customer_id,root_id,supersedes_id,quote_no,revision_no,
        project_name,site_address,delivery_terms,shipping_fee,subtotal,total,expires_at,prepared_by,
        request_key,request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id, tenantId, input.locationId, input.customerId, rootId, priorId, number, revisionNo,
        input.projectName, input.siteAddress, input.deliveryTerms, input.shippingFee, subtotal,total,
        input.expiresAt, actorId, input.requestKey, requestHash]
    );
    if (quoteNo) await insert(quoteNo);
    else await insertWithDailyDocNo(client, { tenantId, table: "bms_sales_quotations", prefix: "QT" }, insert);
    const identity = quoteNo ?? (await client.query<{ quote_no: string }>(
      `SELECT quote_no FROM bms_sales_quotations WHERE tenant_id=$1 AND id=$2`, [tenantId, id])).rows[0].quote_no;
    for (const line of resolved.lines) {
      await client.query(
        `INSERT INTO bms_sales_quotation_lines
          (tenant_id,quote_id,line_no,product_sku,size,pack_code,pack_qty,base_qty,unit_name,
           list_unit_price,agreed_unit_price,line_discount,line_amount,vat_category)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [tenantId,id,line.lineNo,line.sku,line.size,line.packCode,line.packQty,line.baseQty,
          line.unitName,line.listUnitPrice,line.agreedUnitPrice,line.lineDiscount,line.lineAmount,line.vatCategory]
      );
    }
    await insertAuditInTx(client, { tenantId, actor: actorId, actorUserId: actorId,
      actorKind: "STAFF", action: priorId ? "quotation.revise" : "quotation.create", target: id,
      meta: { quoteNo: identity, revisionNo, priorId, locationId: input.locationId, customerId: input.customerId,
        subtotal, shippingFee: input.shippingFee, lineCount: resolved.lines.length } });
    await client.query("COMMIT");
    return { status: "DRAFT", quoteId: id, quoteNo: identity, revisionNo, total };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export const createQuoteDraft = (tenantId: string, actorId: string, input: QuoteDraftInput) =>
  writeDraft(tenantId, actorId, input);
export const reviseQuote = (tenantId: string, actorId: string, priorId: string, input: QuoteDraftInput) =>
  UUID.test(priorId) ? writeDraft(tenantId, actorId, input, priorId) : Promise.resolve({ status: "INVALID_INPUT" });

export async function transitionQuote(tenantId: string, actorId: string, quoteId: string,
  action: "APPROVE" | "SEND" | "ACCEPT" | "REJECT" | "CONVERT",
  evidenceRef?: string | null): Promise<QuoteResult> {
  if (!UUID.test(actorId) || !UUID.test(quoteId)) return { status: "INVALID_INPUT" };
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const res = await client.query<{ id: string; status: string; location_id: string; customer_id: string;
      prepared_by: string; expires_at: Date; shipping_fee: string | null; subtotal: string;
      total: string | null; delivery_terms: string; site_address: string | null;
      quote_no: string; revision_no: number; order_id: string | null }>(
      `SELECT id,status,location_id,customer_id,prepared_by,expires_at,shipping_fee,subtotal,total,
        delivery_terms,site_address,quote_no,revision_no,order_id FROM bms_sales_quotations
        WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, quoteId]);
    const quote = res.rows[0];
    if (!quote) { await client.query("ROLLBACK"); return { status: "NOT_FOUND" }; }
    if (!(await allowedBranch(client, tenantId, actorId, quote.location_id))) {
      await client.query("ROLLBACK"); return { status: "BRANCH_FORBIDDEN" };
    }
    const target = { APPROVE: "APPROVED", SEND: "SENT", ACCEPT: "ACCEPTED",
      REJECT: "REJECTED", CONVERT: "CONVERTED" }[action];
    if (quote.status === target) { await client.query("ROLLBACK"); return { status: target,
      quoteId, quoteNo: quote.quote_no, revisionNo: quote.revision_no,
      orderId: quote.order_id ?? undefined, total: quote.total == null ? null : Number(quote.total) }; }
    const source = { APPROVE: "DRAFT", SEND: "APPROVED", ACCEPT: "SENT",
      REJECT: "SENT", CONVERT: "ACCEPTED" }[action];
    if (quote.status !== source) { await client.query("ROLLBACK"); return { status: "INVALID_STATE" }; }
    if (action !== "REJECT" && new Date(quote.expires_at).getTime() <= Date.now()) {
      await client.query("ROLLBACK"); return { status: "EXPIRED" };
    }
    const acceptanceEvidence = typeof evidenceRef === "string" ? evidenceRef.trim() : "";
    if (action === "ACCEPT" && (acceptanceEvidence.length < 1 || acceptanceEvidence.length > 500)) {
      await client.query("ROLLBACK"); return { status: "ACCEPTANCE_EVIDENCE_REQUIRED" };
    }
    let vatSnapshot: object | null = null;
    let orderId: string | null = null;
    if (action === "APPROVE") {
      if (quote.prepared_by === actorId) { await client.query("ROLLBACK"); return { status: "SECOND_APPROVER_REQUIRED" }; }
      if (quote.shipping_fee == null || quote.total == null) {
        await client.query("ROLLBACK"); return { status: "SHIPPING_UNRESOLVED" };
      }
      if (quote.delivery_terms === "DELIVERY" && !quote.site_address?.trim()) {
        await client.query("ROLLBACK"); return { status: "SITE_ADDRESS_REQUIRED" };
      }
      const lines = await client.query<{ line_amount: string; vat_category: VatCategory }>(
        `SELECT line_amount,vat_category FROM bms_sales_quotation_lines WHERE tenant_id=$1 AND quote_id=$2
          ORDER BY line_no`, [tenantId, quoteId]);
      if (lines.rows.some((line) => line.vat_category === "UNKNOWN")) {
        await client.query("ROLLBACK"); return { status: "VAT_CATEGORY_UNRESOLVED" };
      }
      const settings = await getVatSettings(tenantId, client);
      if (!settings.priceIncludesVat) { await client.query("ROLLBACK"); return { status: "PRICE_BASIS_UNSUPPORTED" }; }
      vatSnapshot = { settings: { vatRegistered: settings.vatRegistered,
        priceIncludesVat: settings.priceIncludesVat, vatRate: settings.vatRate,
        vatRounding: settings.vatRounding }, breakdown: computeVat(
          lines.rows.map((line) => ({ amount: Number(line.line_amount), vatCategory: line.vat_category })),
          settings, { shippingAmount: Number(quote.shipping_fee) }) };
    }
    if (action === "CONVERT") {
      const rows = await client.query<{ product_sku: string; size: string; pack_code: string;
        pack_qty: number; base_qty: number }>(
        `SELECT product_sku,size,pack_code,pack_qty,base_qty FROM bms_sales_quotation_lines
          WHERE tenant_id=$1 AND quote_id=$2 ORDER BY line_no`, [tenantId, quoteId]);
      const created: CreateOrderResult = await createOrderInTx(client, {
        tenantId, channel: "web", customerId: quote.customer_id, locationId: quote.location_id,
        items: rows.rows.map((line) => ({ sku: line.product_sku, size: line.size,
          qty: Number(line.base_qty), packCode: line.pack_code,
          packQty: Number(line.pack_qty) })),
        approvedQuoteId: quoteId, editorId: actorId,
        idempotencyKey: `quote:${quoteId}`,
      });
      if (created.status !== "CREATED") {
        await client.query("ROLLBACK"); return { status: "ORDER_REJECTED", orderStatus: created.status };
      }
      if (cents(created.subtotal) !== cents(Number(quote.subtotal))
        || cents(created.shippingFee) !== cents(Number(quote.shipping_fee))
        || cents(created.amountDue) !== cents(Number(quote.total))) {
        await client.query("ROLLBACK"); return { status: "PRICE_MISMATCH" };
      }
      orderId = created.orderId;
    }
    await client.query(
      `UPDATE bms_sales_quotations SET status=$3,updated_at=now(),
        approved_by=CASE WHEN $3='APPROVED' THEN $4 ELSE approved_by END,
        approved_at=CASE WHEN $3='APPROVED' THEN now() ELSE approved_at END,
        sent_at=CASE WHEN $3='SENT' THEN now() ELSE sent_at END,
        accepted_at=CASE WHEN $3='ACCEPTED' THEN now() ELSE accepted_at END,
        acceptance_evidence=CASE WHEN $3='ACCEPTED' THEN $7 ELSE acceptance_evidence END,
        vat_snapshot=CASE WHEN $3='APPROVED' THEN $5::jsonb ELSE vat_snapshot END,
        order_id=CASE WHEN $3='CONVERTED' THEN $6::uuid ELSE order_id END
       WHERE tenant_id=$1 AND id=$2`,
      [tenantId,quoteId,target,actorId,vatSnapshot == null ? null : JSON.stringify(vatSnapshot),orderId,
        action === "ACCEPT" ? acceptanceEvidence : null]
    );
    await insertAuditInTx(client, { tenantId, actor: actorId, actorUserId: actorId,
      actorKind: "STAFF", action: `quotation.${action.toLowerCase()}`, target: quoteId,
      meta: { quoteNo: quote.quote_no, revisionNo: quote.revision_no,
        locationId: quote.location_id, orderId,
        ...(action === "ACCEPT" ? { evidenceRecorded: true } : {}) } });
    if (orderId) await insertAuditInTx(client, { tenantId, actor: actorId, actorUserId: actorId,
      actorKind: "STAFF", action: "order.create", target: orderId, targetKind: "ORDER",
      source: "QUOTATION", eventKey: `order.create:${orderId}`,
      meta: { quoteId, locationId: quote.location_id } });
    await client.query("COMMIT");
    return { status: target, quoteId, quoteNo: quote.quote_no, revisionNo: quote.revision_no,
      orderId: orderId ?? undefined, total: quote.total == null ? null : Number(quote.total) };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function listQuotes(tenantId: string, actorId: string, limit = 50) {
  if (!UUID.test(actorId)) return [];
  const res = await query(
    `SELECT q.id,q.quote_no,q.revision_no,q.status,q.location_id,q.customer_id,
      q.project_name,q.delivery_terms,q.shipping_fee,q.subtotal,q.total,q.expires_at,q.order_id,
      q.prepared_by,q.approved_by,q.created_at
      FROM bms_sales_quotations q WHERE q.tenant_id=$1
        AND (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$2)
          OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a
            WHERE a.tenant_id=$1 AND a.user_id=$2 AND a.location_id=q.location_id))
      ORDER BY q.created_at DESC,q.id DESC LIMIT $3`,
    [tenantId,actorId,Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit),1),200) : 50]
  );
  return res.rows;
}

export async function getQuote(tenantId: string, actorId: string, quoteId: string) {
  if (!UUID.test(actorId) || !UUID.test(quoteId)) return null;
  const res = await query(
    `SELECT q.id,q.quote_no,q.revision_no,q.status,q.location_id,q.customer_id,
      q.project_name,q.site_address,q.delivery_terms,q.shipping_fee,q.subtotal,q.total,
      q.price_basis,q.vat_snapshot,q.expires_at,q.prepared_by,q.approved_by,q.approved_at,
      q.sent_at,q.accepted_at,q.acceptance_evidence,q.order_id,q.created_at,q.updated_at
      FROM bms_sales_quotations q WHERE q.tenant_id=$1 AND q.id=$2
      AND (NOT EXISTS(SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$3)
        OR EXISTS(SELECT 1 FROM bms_user_allowed_locations a
          WHERE a.tenant_id=$1 AND a.user_id=$3 AND a.location_id=q.location_id))`,
    [tenantId,quoteId,actorId]
  );
  if (!res.rowCount) return null;
  const lines = await query(
    `SELECT line_no,product_sku,size,pack_code,pack_qty,base_qty,unit_name,
      list_unit_price,agreed_unit_price,line_discount,line_amount,vat_category
      FROM bms_sales_quotation_lines WHERE tenant_id=$1 AND quote_id=$2 ORDER BY line_no`,
    [tenantId,quoteId]
  );
  return { ...res.rows[0], lines: lines.rows };
}
