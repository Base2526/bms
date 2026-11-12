import { ApolloLink, Observable } from '@apollo/client';
import { POS_OPERATION_TIMEOUT_MS, PosConnectionError } from '../lib/operation';

/** Bound all HTTP operations, including response parsing; never retry a mutation here. */
export function operationTimeoutLink(timeoutMs = POS_OPERATION_TIMEOUT_MS) {
  return new ApolloLink(
    (operation, forward) =>
      new Observable(observer => {
        const controller = new AbortController();
        const options = operation.getContext().fetchOptions ?? {};
        const previousSignal = options.signal as AbortSignal | undefined;
        const fail = () => {
          // Publish uncertainty before aborting the transport, which may fail synchronously.
          observer.error(
            new PosConnectionError(
              'เซิร์ฟเวอร์ไม่ตอบกลับ ยังยืนยันผลรายการไม่ได้ กรุณาตรวจการเชื่อมต่อและสถานะก่อนทำซ้ำ',
              previousSignal?.aborted ? 'POS_CANCELLED' : 'POS_TIMEOUT',
            ),
          );
          controller.abort();
        };
        if (previousSignal?.aborted) {
          fail();
          return;
        }
        operation.setContext({
          fetchOptions: { ...options, signal: controller.signal },
        });
        previousSignal?.addEventListener('abort', fail, { once: true });
        const timer = setTimeout(fail, timeoutMs);
        const subscription = forward(operation).subscribe({
          next: result => observer.next(result),
          error: error => observer.error(error),
          complete: () => observer.complete(),
        });
        return () => {
          clearTimeout(timer);
          previousSignal?.removeEventListener('abort', fail);
          subscription.unsubscribe();
          controller.abort();
        };
      }),
  );
}
