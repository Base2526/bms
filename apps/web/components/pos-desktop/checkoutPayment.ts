import type { PosPaymentInput } from "@pos-core/payment";

/** UI-only provenance; never submitted as payment evidence. */
export type CheckoutPayment = PosPaymentInput & { manualTender?: boolean };

export function syncSingleCheckoutPayment(
  payments: CheckoutPayment[], total: number, locked: boolean,
): CheckoutPayment[] {
  if (locked || payments.length !== 1) return payments;
  const payment = payments[0];
  const tendered = payment.method === "cash"
    ? payment.manualTender ? payment.tendered : total
    : undefined;
  if (payment.amount === total && payment.tendered === tendered) return payments;
  return [{ ...payment, amount: total, tendered }];
}

export function editCheckoutPayment(
  payment: CheckoutPayment, patch: Partial<PosPaymentInput>, exactCash = false,
): CheckoutPayment {
  const next = { ...payment, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "tendered")) next.manualTender = !exactCash;
  if (next.method === "cash" && !next.manualTender) next.tendered = next.amount;
  return next;
}
