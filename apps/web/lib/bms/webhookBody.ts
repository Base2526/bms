/** Read an external request or response without buffering more than the allowed size. */
export async function readBoundedBodyBytes(
  source: { headers: Headers; body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; status: 413; error: "payload too large" }> {
  const declared = source.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    return { ok: false, status: 413, error: "payload too large" };
  }
  if (!source.body) return { ok: true, bytes: new Uint8Array() };

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: "payload too large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function readBoundedWebhookText(
  request: { headers: Headers; body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<
  | { ok: true; text: string }
  | { ok: false; status: 400 | 413; error: "payload too large" | "invalid utf-8 payload" }
> {
  const result = await readBoundedBodyBytes(request, maxBytes);
  if (!result.ok) return result;
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(result.bytes) };
  } catch {
    return { ok: false, status: 400, error: "invalid utf-8 payload" };
  }
}
