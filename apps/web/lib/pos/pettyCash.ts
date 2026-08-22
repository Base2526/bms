// Shared deterministic math for settling a POS petty-cash advance.
// The server owns the authoritative write; keeping this function side-effect free
// makes the drawer delta and expense split contract-testable without a database.

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculatePettyCashSettlement(advanced: number, actual: number) {
  const advancedAmount = roundMoney(Number(advanced));
  const actualAmount = roundMoney(Number(actual));
  if (!Number.isFinite(advancedAmount) || advancedAmount <= 0) {
    throw new RangeError("advanced amount must be greater than zero");
  }
  if (!Number.isFinite(actualAmount) || actualAmount < 0) {
    throw new RangeError("actual amount must not be negative");
  }
  const drawerDelta = roundMoney(actualAmount - advancedAmount);
  return {
    advancedAmount,
    actualAmount,
    returnedAmount: drawerDelta < 0 ? Math.abs(drawerDelta) : 0,
    extraCashOut: drawerDelta > 0 ? drawerDelta : 0,
    /** Positive means more cash leaves; negative means change returns to the drawer. */
    drawerDelta,
  };
}
