/** Bounded JSON for the small activation/status APIs, never for installer uploads. */
export class RetailLocalRequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413) { super(message); }
}

export async function readRetailLocalJSON(request: Request): Promise<unknown> {
  const limit = 4096;
  if (Number(request.headers.get("content-length")) > limit) {
    throw new RetailLocalRequestBodyError("payload_too_large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RetailLocalRequestBodyError("invalid_json", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => undefined);
        throw new RetailLocalRequestBodyError("payload_too_large", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { throw new RetailLocalRequestBodyError("invalid_json", 400); }
}
