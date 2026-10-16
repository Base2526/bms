// Compatibility facade: existing callers share the central entitlement authority.
export { listPlans, getTenantPlan, getUsage, enforceProductQuota, enforceUserQuota, changePlan } from "./entitlements";
export type { Plan } from "./entitlements";
