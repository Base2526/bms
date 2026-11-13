import { createHash, randomUUID } from "node:crypto";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { createOrderInTx, type CreateOrderResult, type OrderItemInput } from "./orders";
import { createCheckoutUrl } from "./checkout";
import { readCustomerToken, signCustomerToken } from "./customerSecurityToken";
import { notifyOrderActionCommitted } from "./orderActionNotify";

const QUOTE_SECONDS = 10 * 60;
const MAX_LINES = 10;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RetailCartLine = { sku: string; size: string; qty: number; packCode?: string };
export type RetailCartReview = {
  lines: Array<{ sku: string; name: string; size: string; qty: number; unitPrice: number; lineAmount: number;
    packCode: string | null; packQty: number | null; packUnitName: string | null }>;
  subtotal: number;
  discount: number;
  shippingFee: number;
  amountDue: number;
};
export type RetailCartResult =
  | { status: "READY"; review: RetailCartReview; quoteToken: string; expiresAt: string }
  | { status: "CREATED"; checkoutUrl: string; replayed: boolean }
  | { status: "INVALID" | "SHOP_UNAVAILABLE" | "REVIEW_REQUIRED" | "ORDER_REJECTED"; reason?: string };

function basket(value: unknown): RetailCartLine[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LINES) return null;
  const seen = new Set<string>();
  const lines: RetailCartLine[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.sku !== "string" || typeof item.size !== "string" ||
        item.sku.length > 100 || item.size.length > 100 ||
        !item.sku.trim() || !item.size.trim() ||
        !Number.isSafeInteger(item.qty) || Number(item.qty) < 1 || Number(item.qty) > 100) return null;
    const sku = item.sku.trim();
    const size = item.size.trim();
    const packCode = item.packCode == null ? undefined : typeof item.packCode === "string"
      && item.packCode.trim() && item.packCode.length <= 64
      && item.packCode.trim().toUpperCase() !== "BASE" ? item.packCode.trim() : null;
    if (packCode === null) return null;
    const key = `${sku}\0${size}\0${packCode?.toUpperCase() ?? "BASE"}`;
    if (seen.has(key)) return null;
    seen.add(key);
    lines.push({ sku, size, qty: Number(item.qty), ...(packCode ? { packCode } : {}) });
  }
  return lines;
}

function reviewOf(result: Extract<CreateOrderResult, { status: "CREATED" }>): RetailCartReview {
  return {
    lines: result.items.map((line) => ({
      sku: line.sku, name: line.name, size: line.size, qty: line.qty,
      unitPrice: line.unitPrice, lineAmount: line.lineAmount,
      packCode: line.packCode ?? null, packQty: line.packQty ?? null,
      packUnitName: line.packUnitName ?? null,
    })),
    subtotal: result.subtotal,
    discount: result.discount,
    shippingFee: result.shippingFee,
    amountDue: result.amountDue,
  };
}

function fingerprint(review: RetailCartReview): string {
  return createHash("sha256").update(JSON.stringify(review)).digest("hex");
}

async function publicRetailTenant(slug: string): Promise<string | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) return null;
  const found = await query<{ id: string }>(
    `SELECT t.id FROM bms_tenants t
       LEFT JOIN bms_store_profile profile ON profile.tenant_id = t.id
      WHERE t.slug = $1 AND t.active
        AND COALESCE(profile.business_archetype, '') <> 'restaurant'
      LIMIT 1`, [slug]
  );
  return found.rows[0]?.id ?? null;
}

async function publicBasketAllowed(client: import("pg").PoolClient, tenantId: string, lines: RetailCartLine[]): Promise<boolean> {
  const skus = [...new Set(lines.map((line) => line.sku))];
  const found = await client.query<{ sku: string }>(
    `SELECT p.sku FROM bms_products p
       JOIN bms_product_sales_surfaces public_surface
         ON public_surface.tenant_id = p.tenant_id AND public_surface.product_sku = p.sku
        AND public_surface.surface = 'PUBLIC_STOREFRONT' AND public_surface.enabled
       JOIN bms_product_sales_surfaces order_surface
         ON order_surface.tenant_id = p.tenant_id AND order_surface.product_sku = p.sku
        AND order_surface.surface = 'ONLINE_ORDER' AND order_surface.enabled
      WHERE p.tenant_id = $1 AND p.sku = ANY($2::text[]) AND p.active
      FOR SHARE OF p, public_surface, order_surface`,
    [tenantId, skus]
  );
  return found.rows.length === skus.length;
}

function orderInput(tenantId: string, lines: RetailCartLine[], nonce: string): {
  tenantId: string; channel: "web"; customerRef: string; items: OrderItemInput[]; idempotencyKey: string;
} {
  return { tenantId, channel: "web", customerRef: `web-cart:${nonce}`,
    items: lines.map((line) => line.packCode
      ? { sku: line.sku, size: line.size, qty: line.qty, packCode: line.packCode, packQty: line.qty }
      : { sku: line.sku, size: line.size, qty: line.qty }),
    idempotencyKey: `retail-cart:${nonce}` };
}

/** Simulate the real order transaction and roll it back, including reservations and customer creation. */
export async function previewRetailCart(tenantSlug: unknown, rawLines: unknown): Promise<RetailCartResult> {
  const slug = typeof tenantSlug === "string" ? tenantSlug.trim().toLowerCase() : "";
  const lines = basket(rawLines);
  if (!lines) return { status: "INVALID" };
  const tenantId = await publicRetailTenant(slug);
  if (!tenantId) return { status: "SHOP_UNAVAILABLE" };
  const nonce = randomUUID();
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    if (!await publicBasketAllowed(client, tenantId, lines)) return { status: "ORDER_REJECTED" };
    const result = await createOrderInTx(client, orderInput(tenantId, lines, nonce));
    if (result.status !== "CREATED") return { status: "ORDER_REJECTED", reason: result.status };
    const review = reviewOf(result);
    const exp = Math.floor(Date.now() / 1000) + QUOTE_SECONDS;
    const quoteToken = signCustomerToken("retail-cart-v1", {
      tenantId, slug, lines, nonce, fingerprint: fingerprint(review), exp,
    });
    return { status: "READY", review, quoteToken, expiresAt: new Date(exp * 1000).toISOString() };
  } finally {
    try { await client.query("ROLLBACK"); } finally { client.release(); }
  }
}

/** Recheck the entire basket and its price under a per-quote lock before committing. */
export async function confirmRetailCart(rawToken: unknown): Promise<RetailCartResult> {
  const token = readCustomerToken("retail-cart-v1", rawToken);
  if (!token || typeof token.slug !== "string" || !uuid.test(String(token.tenantId)) ||
      !uuid.test(String(token.nonce)) || typeof token.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(token.fingerprint)) return { status: "INVALID" };
  const lines = basket(token.lines);
  if (!lines) return { status: "INVALID" };
  const tenantId = String(token.tenantId);
  const client = await getClient();
  let orderId: string | null = null;
  let replayed = false;
  let committed = false;
  try {
    await beginTenantTx(client, tenantId);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`retail-cart:${token.nonce}`]);
    const prior = await client.query<{ id: string }>(
      `SELECT id FROM bms_orders WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [tenantId, `retail-cart:${token.nonce}`]
    );
    if (prior.rows[0]) {
      orderId = prior.rows[0].id;
      replayed = true;
    } else {
      if (await publicRetailTenant(String(token.slug)) !== tenantId) return { status: "SHOP_UNAVAILABLE" };
      if (!await publicBasketAllowed(client, tenantId, lines)) return { status: "REVIEW_REQUIRED" };
      const result = await createOrderInTx(client, orderInput(tenantId, lines, String(token.nonce)));
      if (result.status !== "CREATED") return { status: "REVIEW_REQUIRED", reason: result.status };
      if (fingerprint(reviewOf(result)) !== token.fingerprint) return { status: "REVIEW_REQUIRED" };
      orderId = result.orderId;
    }
    await client.query("COMMIT");
    committed = true;
  } finally {
    if (!committed) { try { await client.query("ROLLBACK"); } catch {} }
    client.release();
  }
  if (!replayed) await notifyOrderActionCommitted({ tenantId, orderId, kind: "ORDER_CREATED" });
  return { status: "CREATED", checkoutUrl: createCheckoutUrl(tenantId, orderId), replayed };
}
