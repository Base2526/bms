export type PosPaymentDraft = {
  id: string;
  method: string;
  amount: string;
  tendered: string;
  ref: string;
};

/**
 * Add a payment row, entering split-payment mode when the bill currently has one row.
 *
 * A cash-only draft stores the whole bill in both `amount` and `tendered`. Keeping that
 * tender after the cashier changes `amount` to the cash share would manufacture change
 * from stale state (for example 48,300 tendered - 15,000 cash = 33,300 change).
 * Clear it only on the single-row -> split transition so the cashier either accepts the
 * cash share as exact or enters the amount physically tendered again. Existing split rows
 * keep their tender values when a third or later method is added.
 */
export function appendSplitPaymentRow(
  current: readonly PosPaymentDraft[],
  amountDue: number,
  nextId: string,
): PosPaymentDraft[] {
  const enteringSplitMode = current.length === 1;
  const existing = enteringSplitMode
    ? current.map((payment) => ({
        ...payment,
        amount: payment.amount || String(amountDue),
        tendered: payment.method === "CASH" ? "" : payment.tendered,
      }))
    : [...current];

  return [
    ...existing,
    { id: nextId, method: "QR", amount: "", tendered: "", ref: "" },
  ];
}
