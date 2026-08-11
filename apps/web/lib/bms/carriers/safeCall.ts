// External carrier calls must be bounded and normalized at the adapter boundary.
const DEFAULT_CARRIER_CALL_TIMEOUT_MS = 10_000;

export async function runCarrierCall<T>(
  operation: () => Promise<T>,
  onError: (detail: string) => T,
  timeoutMs = DEFAULT_CARRIER_CALL_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onError(`Carrier API timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Carrier API request failed";
    return onError(detail.slice(0, 500));
  } finally {
    if (timer) clearTimeout(timer);
  }
}
