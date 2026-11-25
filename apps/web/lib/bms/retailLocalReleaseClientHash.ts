import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

/** Browser-side bounded SHA-256. Cancelling a stale selection stops its read. */
export async function hashRetailLocalInstallerFile(
  file: Blob,
  signal?: AbortSignal,
): Promise<string> {
  const hash = sha256.create();
  const reader = file.stream().getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("Hash cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException("Hash cancelled", "AbortError");
      if (done) break;
      hash.update(value);
    }
    return bytesToHex(hash.digest());
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
