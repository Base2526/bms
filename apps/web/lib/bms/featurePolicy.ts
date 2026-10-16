export const PACKAGE_FEATURES = {
  REPORT_SCHEDULE: "pro",
  RETENTION_ENGINE: "business",
} as const;
export type PackageFeature = keyof typeof PACKAGE_FEATURES;
// Frozen rollout scope: adding a future paid feature must not implicitly grandfather it.
const LEGACY_FEATURES: readonly PackageFeature[] = ["REPORT_SCHEDULE", "RETENTION_ENGINE"];

export function planFeatureKeys(plan: string): PackageFeature[] {
  if (plan === "business") return ["REPORT_SCHEDULE", "RETENTION_ENGINE"];
  if (plan === "pro") return ["REPORT_SCHEDULE"];
  return [];
}

export function resolveFeatureAccess(plan: string, version: number, local = false, hasReportSchedule = false) {
  return (Object.keys(PACKAGE_FEATURES) as PackageFeature[]).map(feature => {
    const source = local ? "RETAIL_LOCAL" : version === 1 && LEGACY_FEATURES.includes(feature) ? "LEGACY"
      : planFeatureKeys(plan).includes(feature) ? "PLAN"
      : feature === "REPORT_SCHEDULE" && hasReportSchedule ? "EXISTING_WORK" : "LOCKED";
    return { feature, minimumPlan: PACKAGE_FEATURES[feature], allowed: source !== "LOCKED", source };
  });
}

export class FeatureAccessError extends Error {
  readonly code = "FEATURE_NOT_INCLUDED";
  constructor(readonly feature: PackageFeature) {
    super(`${feature}: ต้องใช้แพ็กเกจ / Requires ${PACKAGE_FEATURES[feature]}. ข้อมูลและงานเดิมยังใช้งานได้ / Existing work remains available.`);
  }
}
