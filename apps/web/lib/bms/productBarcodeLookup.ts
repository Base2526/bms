import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { rateLimit } from "./rateLimit";
import { fetchBarcodeProduct } from "./productBarcodeProvider";
import {
  parseProductBarcode, productBarcodeAliases,
  type BarcodeLookupResult, type BarcodeProductMatch,
} from "./productBarcodeLookupContract";

export async function lookupProductBarcode(tenantId: string, raw: string): Promise<BarcodeLookupResult> {
  const parsed = parseProductBarcode(raw);
  if (!parsed) return { code: "", status: "UNSUPPORTED", matches: [] };
  const { code } = parsed;
  const client = await getClient();
  let matches: BarcodeProductMatch[];
  try {
    await beginTenantTx(client, tenantId);
    const result = await client.query<BarcodeProductMatch>(
      `SELECT p.sku, p.name, p.image_url AS "imageUrl", p.active
         FROM bms_products p
        WHERE p.tenant_id = $1
          AND (p.barcode = ANY($2::text[]) OR EXISTS (
            SELECT 1 FROM bms_product_packs k
             WHERE k.tenant_id = p.tenant_id AND k.product_sku = p.sku
               AND k.barcode = ANY($2::text[])
          ))
        ORDER BY p.sku LIMIT 10`,
      [tenantId, productBarcodeAliases(code)],
    );
    matches = result.rows;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  if (matches.length) return { code, status: "LOCAL", matches };
  if (!parsed.external) return { code, status: "UNSUPPORTED", matches: [] };
  const apiKey = process.env.BMS_BARCODE_LOOKUP_API_KEY?.trim();
  if (!apiKey) return { code, status: "NOT_CONFIGURED", matches: [] };
  // Global ceiling as the API key is shared across shops; per-user limits live at the route.
  if (!(await rateLimit("product-barcode-provider", 30, 60_000)).ok) {
    return { code, status: "UNAVAILABLE", matches: [] };
  }
  try {
    const suggestion = await fetchBarcodeProduct(code, apiKey);
    return suggestion ? { code, status: "EXTERNAL", matches: [], suggestion }
      : { code, status: "NOT_FOUND", matches: [] };
  } catch {
    return { code, status: "UNAVAILABLE", matches: [] };
  }
}
