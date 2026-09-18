let operationSequence = 0;

export const POS_OPERATION_TIMEOUT_MS = 15_000;

/** Bound a GraphQL HTTP operation so a dropped connection cannot spin forever. */
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

/** Unique per user intent. Preserve it when retrying an unknown outcome. */
export function createIdempotencyKey(prefix: string): string {
  operationSequence = (operationSequence + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${Date.now().toString(36)}-${operationSequence.toString(36)}-${random}`;
}

type GraphqlErrorShape = {
  graphQLErrors?: ReadonlyArray<{ extensions?: { code?: unknown } | null }>;
};

export function graphqlErrorCode(error: unknown): string | null {
  const errors = (error as GraphqlErrorShape | null)?.graphQLErrors;
  if (!Array.isArray(errors)) return null;
  for (const item of errors) {
    const code = item?.extensions?.code;
    if (typeof code === "string" && code.trim()) return code;
  }
  return null;
}

export function isStaleOperationConflict(error: unknown): boolean {
  return graphqlErrorCode(error) === "CONFLICT";
}

const DECIDED_ERROR_CODES = [
  "GRAPHQL_PARSE_FAILED",
  "GRAPHQL_VALIDATION_FAILED",
  "BAD_USER_INPUT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
];

export function isDecidedRejection(error: unknown): boolean {
  const code = graphqlErrorCode(error);
  return code != null && DECIDED_ERROR_CODES.includes(code);
}
