export const KIOSK_BODY_MAX_BYTES = 32 * 1024;

/** Read a public JSON request with a byte cap, including chunked bodies without Content-Length. */
export async function readRestaurantKioskJson(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > KIOSK_BODY_MAX_BYTES) throw new Error("BODY_TOO_LARGE");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("INVALID_JSON");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > KIOSK_BODY_MAX_BYTES) {
      await reader.cancel();
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(part.value);
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_JSON");
    return body as Record<string, unknown>;
  } catch { throw new Error("INVALID_JSON"); }
}
