let operationSequence = 0;

export const POS_OPERATION_TIMEOUT_MS = 15_000;

/** Bound a GraphQL HTTP operation so a dropped connection cannot leave the counter spinning forever. */
export async function runWithOperationTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs = POS_OPERATION_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
      throw new Error(`เซิร์ฟเวอร์ไม่ตอบภายใน ${seconds} วินาที`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Unique per user intent. Keep the returned value and reuse it when retrying an unknown outcome. */
export function createIdempotencyKey(prefix: string): string {
  operationSequence = (operationSequence + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${Date.now().toString(36)}-${operationSequence.toString(
    36,
  )}-${random}`;
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

type GraphqlErrorShape = {
  graphQLErrors?: ReadonlyArray<{ extensions?: { code?: unknown } | null }>;
};

/** รหัสแรกที่เซิร์ฟเวอร์ติดมากับ error — `null` เมื่อเป็นความล้มเหลวของสายเน็ตล้วน ๆ */
export function graphqlErrorCode(error: unknown): string | null {
  const errors = (error as GraphqlErrorShape | null)?.graphQLErrors;
  if (!Array.isArray(errors)) return null;
  for (const item of errors) {
    const code = item?.extensions?.code;
    if (typeof code === 'string' && code.trim()) return code;
  }
  return null;
}

/**
 * `CONFLICT` = สถานะจริงตอนนี้ไม่ให้ทำคำสั่งนี้แล้ว (รวมเคสคีย์กันรายการซ้ำที่ถูกใช้ไปกับ
 * ข้อมูลคนละชุด ซึ่งแปลว่าคำขอแรก **สำเร็จไปแล้ว**)
 *
 * ต่างจาก `INTERNAL_SERVER_ERROR` ตรงที่ห้ามยิงซ้ำด้วยคีย์เดิม — คีย์นั้นผูกกับคำขอเก่าไปแล้ว
 * ยิงอีกกี่ครั้งก็ล้มแบบเดิม หน้าจอจึงต้องทิ้งคีย์และดึงของจริงมาให้คนหน้าเครื่องดูก่อน
 */
export function isStaleOperationConflict(error: unknown): boolean {
  return graphqlErrorCode(error) === 'CONFLICT';
}

/**
 * รหัสที่แปลว่า "เซิร์ฟเวอร์ตัดสินแล้ว และคำขอนี้ไม่ได้เขียนอะไรลงไป"
 *
 * ทุกตัวถูกโยนจากด่านก่อนเรียก service (ตรวจ input, PIN/สิทธิ์, ขอบเขตสาขา, สถานะกะ) หรือจาก
 * การชนคีย์กันรายการซ้ำซึ่งแปลว่าคำขอ **เก่า** เป็นตัวที่สำเร็จ ไม่ใช่คำขอนี้
 *
 * ต่างจาก `INTERNAL_SERVER_ERROR` และการล้มของสายเน็ต ซึ่งผลยัง "ไม่รู้" — สองอย่างนั้นเท่านั้น
 * ที่ต้องเก็บคีย์เดิมไว้กดซ้ำ ส่วนรายการที่ถูกตัดสินแล้วต้องออกคีย์ใหม่ ไม่งั้นคนหน้าเครื่อง
 * แก้ข้อมูลตามที่ error บอกแล้วกดใหม่ จะไปชนคีย์เดิมแล้วล้มซ้ำแบบที่แก้ไม่ได้
 */
const DECIDED_ERROR_CODES = [
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'BAD_USER_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
];

export function isDecidedRejection(error: unknown): boolean {
  const code = graphqlErrorCode(error);
  return code != null && DECIDED_ERROR_CODES.includes(code);
}
