// =============================================================
// BMS Pharmacy Intake — feature flags / env config
// -------------------------------------------------------------
// No central config module exists in this codebase (process.env.X is read
// ad hoc per file) — this file follows that convention, just grouped for
// the pharmacy module. Comma-list parsing mirrors
// lib/bms/reportRecipients.ts's parseRecipientList() (split/trim/filter/
// dedupe), not a new pattern.
// =============================================================

function parseCommaList(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

function parseBoolEnv(raw: string | undefined): boolean {
  return raw === "true" || raw === "1";
}

/** Master switch — every entry point (pipeline branch, GraphQL resolvers, cron route) checks this first. */
export function isPharmacyIntakeEnabled(): boolean {
  return parseBoolEnv(process.env.PHARMACY_INTAKE_ENABLED);
}

/** Whether the AI (extraction/next-question/summary) may run at all — false forces manual-only intake. */
export function isPharmacyAiEnabled(): boolean {
  return parseBoolEnv(process.env.PHARMACY_AI_ENABLED);
}

/** Platform-wide kill switch per protocol_key, independent of a protocol row's own `enabled` flag. */
export function enabledPharmacyProtocolKeys(): string[] {
  return parseCommaList(process.env.PHARMACY_PROTOCOLS_ENABLED);
}

export function pharmacyAiProviderOverride(): string | undefined {
  const v = (process.env.PHARMACY_AI_PROVIDER || "").trim().toLowerCase();
  return v || undefined;
}

export function pharmacyAiModelOverride(): string | undefined {
  const v = (process.env.PHARMACY_AI_MODEL || "").trim();
  return v || undefined;
}

const DEFAULT_ASSESSMENT_TTL_MINUTES = 60;

export function pharmacyAssessmentTtlMinutes(): number {
  const raw = Number(process.env.PHARMACY_ASSESSMENT_TTL_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_ASSESSMENT_TTL_MINUTES;
  return Math.floor(raw);
}

export const MAX_AI_VALIDATION_RETRIES = 2;
