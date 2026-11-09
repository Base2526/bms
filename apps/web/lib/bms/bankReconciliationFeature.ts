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

/**
 * Static capability description plus the real server flag. `enabled` must come from the same
 * check that gates every read/write, so a client never sees "enabled" while the service refuses.
 * Kept here (no DB imports) so it can be checked without a database.
 */
export function bankReconciliationReadiness() {
  return {
    enabled: isBankReconciliationEnabled(),
    fileImport: true,
    supportedFormats: ["CSV", "XLSX", "XLS"],
    deterministicMatching: true,
    humanConfirmationRequired: true,
    openBanking: "NOT_CONFIGURED",
    sourceMutation: false,
  };
}
