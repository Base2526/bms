export type DeliveryIntakeControlView = {
  scope: string;
  desiredState: string;
  syncStatus: string;
};

export type DeliveryIntakePresentation = {
  /** State of the branch-wide row controlled by the POS toggle itself. */
  branchPaused: boolean;
  /** Effective branch state after broader and provider-specific controls are included. */
  state: "ACCEPTING" | "PARTIAL" | "PAUSED";
  /** POS cannot resume a tenant-wide control; an administrator must change that scope. */
  controlledElsewhere: boolean;
  /** Desired state and provider state may differ, so staff must verify the provider tablet. */
  needsManualAction: boolean;
};

const BROAD_SCOPES = new Set(["ALL_ONLINE", "DELIVERY_PLATFORMS"]);
const SYNC_PROBLEM_STATUSES = new Set(["FAILED", "MANUAL_PROVIDER_ACTION_REQUIRED"]);

/**
 * Summarize every applicable intake row returned for the branch. Looking only at the BRANCH row
 * incorrectly reports "accepting" when a tenant-wide or provider-specific pause is still active.
 */
export function summarizeDeliveryIntakeControls(
  controls: readonly DeliveryIntakeControlView[],
): DeliveryIntakePresentation {
  const paused = controls.filter((row) => row.desiredState === "PAUSED");
  const branchPaused = paused.some((row) => row.scope === "BRANCH");
  const controlledElsewhere = paused.some((row) => BROAD_SCOPES.has(row.scope));
  const providerPaused = paused.some((row) => row.scope === "PROVIDER");
  const fullyPaused = branchPaused || controlledElsewhere;
  return {
    branchPaused,
    state: fullyPaused ? "PAUSED" : providerPaused ? "PARTIAL" : "ACCEPTING",
    controlledElsewhere,
    needsManualAction: controls.some((row) => SYNC_PROBLEM_STATUSES.has(row.syncStatus)),
  };
}
