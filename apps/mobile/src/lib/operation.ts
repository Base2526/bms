import { posText } from '../i18n/catalog';
import {
  POS_OPERATION_TIMEOUT_MS,
  PosConnectionError,
  runWithOperationTimeout as runCoreOperationWithTimeout,
} from '../../../../packages/pos-client-core/src/operation';

export * from '../../../../packages/pos-client-core/src/operation';

/**
 * The shared wrapper rejects with fixed Thai text; translate its two own failures by code so a
 * timed-out or cancelled wait reads in the cashier's language (alerts, offline queue error text).
 * This local export takes precedence over the star re-export above.
 */
export async function runWithOperationTimeout<T>(
  ...args: Parameters<typeof runCoreOperationWithTimeout<T>>
): Promise<T> {
  try {
    return await runCoreOperationWithTimeout<T>(...args);
  } catch (error) {
    if (error instanceof PosConnectionError && error.code === 'POS_TIMEOUT') {
      const timeoutMs = args[1] ?? POS_OPERATION_TIMEOUT_MS;
      const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
      throw new PosConnectionError(posText("เซิร์ฟเวอร์ไม่ตอบภายใน {v0} วินาที", { v0: seconds }), error.code);
    }
    if (error instanceof PosConnectionError && error.code === 'POS_CANCELLED') {
      throw new PosConnectionError(posText("การรอคำตอบถูกยกเลิก"), error.code);
    }
    throw error;
  }
}

export function resultFailure(
  result: { status?: string | null; reason?: string | null } | null | undefined,
  fallback: string,
): string | null {
  if (!result) return fallback;
  return result.status === 'OK' || result.status === 'SUCCESS'
    ? null
    : result.reason ?? result.status ?? fallback;
}
