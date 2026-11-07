/** Bank reconciliation is an additive rollout and is disabled unless explicitly enabled. */
export function isBankReconciliationEnabled(): boolean {
  return process.env.BMS_BANK_RECONCILIATION_ENABLED === "true";
}

export function requireBankReconciliationEnabled(): void {
  if (!isBankReconciliationEnabled()) {
    const error = new Error("Bank reconciliation is not enabled for this deployment");
    error.name = "FeatureDisabledError";
    throw error;
  }
}
