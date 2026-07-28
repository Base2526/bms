import { getClient, query } from "@/lib/db";
import { listProductImages, listProducts, upsertProduct } from "./products";
import { beginTenantTx } from "./tenant";

export type AiSynonymCandidate = {
  id: string;
  term: string;
  occurrences: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  productSku: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedAt: string | null;
};

function normalizeTerm(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function isSafeCandidate(term: string): boolean {
  if (term.length < 2 || term.length > 80) return false;
  if (/https?:\/\/|www\.|@|\b\d{8,}\b/i.test(term)) return false;
  return /[a-zก-๙]/i.test(term);
}

export async function recordSynonymCandidate(tenantId: string, rawTerm: string): Promise<void> {
  const displayTerm = String(rawTerm || "").replace(/\s+/g, " ").trim();
  const normalizedTerm = normalizeTerm(displayTerm);
  if (!isSafeCandidate(normalizedTerm)) return;

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await client.query(
      `INSERT INTO bms_ai_synonym_candidates
         (tenant_id, normalized_term, display_term)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, normalized_term) DO UPDATE
         SET occurrences = bms_ai_synonym_candidates.occurrences + 1,
             display_term = EXCLUDED.display_term,
             last_seen_at = now()
       WHERE bms_ai_synonym_candidates.status = 'PENDING'`,
      [tenantId, normalizedTerm, displayTerm]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function listSynonymCandidates(
  tenantId: string,
  status: AiSynonymCandidate["status"] = "PENDING",
  limit = 50
): Promise<AiSynonymCandidate[]> {
  const result = await query<any>(
    `SELECT id, display_term, occurrences, status, product_sku,
            first_seen_at, last_seen_at, reviewed_at
       FROM bms_ai_synonym_candidates
      WHERE tenant_id = $1 AND status = $2
      ORDER BY occurrences DESC, last_seen_at DESC
      LIMIT $3`,
    [tenantId, status, Math.min(Math.max(limit, 1), 200)]
  );
  return result.rows.map((row) => ({
    id: row.id,
    term: row.display_term,
    occurrences: Number(row.occurrences),
    status: row.status,
    productSku: row.product_sku ?? null,
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
  }));
}

export async function reviewSynonymCandidate(
  tenantId: string,
  id: string,
  decision: "APPROVED" | "REJECTED",
  productSku: string | null,
  reviewerId: string | null
): Promise<AiSynonymCandidate> {
  const candidate = await query<any>(
    `SELECT id, display_term, status
       FROM bms_ai_synonym_candidates
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  const row = candidate.rows[0];
  if (!row) throw new Error("ไม่พบคำ synonym");
  if (row.status !== "PENDING") throw new Error("คำ synonym นี้ถูกตรวจแล้ว");

  const sku = String(productSku || "").trim();
  if (decision === "APPROVED") {
    if (!sku) throw new Error("ต้องเลือก SKU ก่อนอนุมัติ");
    const { items } = await listProducts(tenantId, { search: sku, limit: 10 });
    const product = items.find((item) => item.sku === sku);
    if (!product) throw new Error("ไม่พบสินค้า SKU ที่เลือก");
    const images = await listProductImages(tenantId, product.sku);
    const keywords = Array.from(new Set([
      ...(product.keywords ?? []),
      row.display_term,
    ].map((value) => value.trim()).filter(Boolean)));
    await upsertProduct(tenantId, {
      sku: product.sku,
      name: product.name,
      price: Number(product.price),
      keywords,
      active: product.active,
      barcode: product.barcode,
      image_url: product.image_url,
      image_urls: Array.from(new Set([
        product.image_url,
        ...images.map((image) => image.url),
      ].filter((url): url is string => Boolean(url)))),
      description: product.description,
      cost_price: product.cost_price == null ? null : Number(product.cost_price),
      category: product.category,
      brand: product.brand,
    }, reviewerId);
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, reviewerId ? { editorId: reviewerId } : undefined);
    await client.query(
      `UPDATE bms_ai_synonym_candidates
          SET status = $3, product_sku = $4, reviewed_at = now(), reviewed_by = $5
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, decision, decision === "APPROVED" ? sku : null, reviewerId]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  const exact = (await query<any>(
    `SELECT id, display_term, occurrences, status, product_sku,
            first_seen_at, last_seen_at, reviewed_at
       FROM bms_ai_synonym_candidates WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  )).rows[0];
  if (!exact) throw new Error("ไม่พบคำ synonym หลังบันทึก");
  return {
    id: exact.id,
    term: exact.display_term,
    occurrences: Number(exact.occurrences),
    status: exact.status,
    productSku: exact.product_sku ?? null,
    firstSeenAt: new Date(exact.first_seen_at).toISOString(),
    lastSeenAt: new Date(exact.last_seen_at).toISOString(),
    reviewedAt: exact.reviewed_at ? new Date(exact.reviewed_at).toISOString() : null,
  };
}
