import { isProductGtin, type BarcodeSuggestion } from "./productBarcodeLookupContract";

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) || null : null;

export function parseBarcodeProviderProduct(body: unknown, code: string): BarcodeSuggestion | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as any).products)) return null;
  const matches = (body as any).products.filter((p: any) => p && typeof p.barcode_number === "string"
    && isProductGtin(p.barcode_number) && p.barcode_number.padStart(14, "0") === code.padStart(14, "0"));
  if (matches.length !== 1) return null;
  const p = matches[0];
  const name = text(p.title, 200);
  if (!name) return null;
  let imageUrl: string | null = null;
  for (const candidate of Array.isArray(p.images) ? p.images.slice(0, 10) : []) {
    if (typeof candidate !== "string" || candidate.length > 2048) continue;
    try {
      const url = new URL(candidate);
      // Provider-hosted images only. Never fetch arbitrary vendor/scanned URLs.
      if (url.protocol === "https:" && url.hostname === "images.barcodelookup.com"
        && !url.port && !url.username && !url.password) { imageUrl = url.href; break; }
    } catch { /* Ignore malformed optional images. */ }
  }
  const size = text(p.size, 128);
  return {
    name, brand: text(p.brand, 120), size: size && size.length <= 64 ? size : null,
    description: text(p.description, 2000), imageUrl,
    source: "Barcode Lookup", sourceUrl: `https://www.barcodelookup.com/${code}`,
  };
}

export async function fetchBarcodeProduct(
  code: string, apiKey: string, fetcher: typeof fetch = fetch,
): Promise<BarcodeSuggestion | null> {
  const url = new URL("https://api.barcodelookup.com/v3/products");
  url.searchParams.set("barcode", code);
  url.searchParams.set("key", apiKey);
  // Do not log this URL or propagate transport errors: the provider puts its key in the query.
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" }, redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return null;
    if (!response.ok || !response.body) throw new Error("provider unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 256 * 1024) throw new Error("provider response too large");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(body?.products)) throw new Error("invalid provider response");
    return parseBarcodeProviderProduct(body, code);
  } catch {
    throw new Error("BARCODE_PROVIDER_UNAVAILABLE");
  }
}
