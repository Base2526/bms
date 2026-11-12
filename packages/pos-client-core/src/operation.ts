let operationSequence = 0;

export const POS_OPERATION_TIMEOUT_MS = 15_000;

export class PosConnectionError extends Error {
  constructor(message: string, public readonly code = 'POS_NETWORK') {
    super(message);
    this.name = "PosConnectionError";
  }
}

/** Reachability is independent of whether a business action was accepted. */
export function posErrorConnectionStatus(error: unknown): "online" | "offline" | null {
  if (error instanceof PosConnectionError) return "offline";
  const value = error as {
    serverResponded?: boolean; code?: unknown; httpStatus?: number | null;
    graphQLErrors?: unknown[]; networkError?: { statusCode?: number } | null;
  } | null;
  if (typeof value?.code === 'string' && ['POS_NETWORK', 'POS_TIMEOUT', 'POS_CANCELLED'].includes(value.code)) return 'offline';
  if (value?.httpStatus === 408 || (value?.httpStatus != null && value.httpStatus >= 500)) return "offline";
  if (value?.serverResponded || value?.graphQLErrors?.length) return "online";
  if (value?.httpStatus != null) return "online";
  if (value?.networkError) {
    const status = value.networkError.statusCode;
    return status != null && status < 500 && status !== 408 ? "online" : "offline";
  }
  if (typeof value?.code === "string" && [...DECIDED_ERROR_CODES, "INTERNAL_SERVER_ERROR"].includes(value.code)) return "online";
  // Local validation/render/storage errors say nothing about server reachability.
  return null;
}

/** Bound a GraphQL HTTP operation so a dropped connection cannot spin forever. */
export async function runWithOperationTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs = POS_OPERATION_TIMEOUT_MS,
  externalSignal?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    const cancellation = new Promise<never>((_resolve, reject) => {
      cancel = () => {
        reject(new PosConnectionError('การรอคำตอบถูกยกเลิก', 'POS_CANCELLED'));
        controller.abort();
      };
      if (externalSignal?.aborted) cancel();
      else externalSignal?.addEventListener('abort', cancel, { once: true });
    });
    if (externalSignal?.aborted) return await cancellation;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
        // Reject independently: response parsing/native transports may ignore abort.
        reject(new PosConnectionError(`เซิร์ฟเวอร์ไม่ตอบภายใน ${seconds} วินาที`, 'POS_TIMEOUT'));
        controller.abort();
      }, timeoutMs);
    });
    return await Promise.race([work(controller.signal), deadline, cancellation]);
  } finally {
    clearTimeout(timer);
    if (cancel) externalSignal?.removeEventListener('abort', cancel);
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
  const value = error as GraphqlErrorShape & { networkError?: unknown } | null;
  const errors = value?.graphQLErrors;
  // One decided field cannot prove a different field did not commit before failing.
  return !value?.networkError && Array.isArray(errors) && errors.length > 0
    && errors.every(item => typeof item?.extensions?.code === 'string'
      && DECIDED_ERROR_CODES.includes(item.extensions.code));
}
