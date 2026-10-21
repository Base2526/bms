type SaleResult = { status?: string | null; orderId?: string | null } | null | undefined;

/** PAYMENT_FAILED may follow a committed, stock-reserving PENDING order. */
export function mustRetainSaleAttempt(result: SaleResult): boolean {
  return !result?.status || result.status === "PAYMENT_FAILED" || result.status === "SERVER_ERROR"
    || ((result.status === "SOLD" || result.status === "DEPOSIT_TAKEN") && !result.orderId);
}

export class PosSaleResultError extends Error {
  readonly serverResponded = true;
  readonly retainAttempt: boolean;
  readonly knownFailure: boolean;

  constructor(message: string, result: SaleResult) {
    super(message);
    this.name = "PosSaleResultError";
    this.retainAttempt = mustRetainSaleAttempt(result);
    this.knownFailure = Boolean(result?.status && !["SOLD", "DEPOSIT_TAKEN", "SERVER_ERROR"].includes(result.status));
  }
}
