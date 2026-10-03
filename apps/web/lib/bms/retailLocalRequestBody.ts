/** Bounded JSON; 4 KiB by default. A server-owned limit may allow larger UTF-8 forms. Never for installer uploads. */
export class RetailLocalRequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413) { super(message); }
}

export async function readRetailLocalJSON(request: Request, limit = 4096): Promise<unknown> {
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
