export type ConsentValue = "allow" | "reject";
// v1 did not name the provider or measurement purpose; do not reuse that permission.
export const ANALYTICS_CONSENT_KEY = "bms_analytics_consent_v2";
export const ANALYTICS_CONSENT_EVENT = "bms:analytics-consent";
const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
let sessionChoice: { value: ConsentValue; at: string } | null = null;

export function parseAnalyticsConsent(raw: string | null, now = Date.now()): ConsentValue | null {
  try {
    const choice = JSON.parse(raw || "null");
    const at = Date.parse(choice?.at);
    if ((choice?.value === "allow" || choice?.value === "reject") &&
        Number.isFinite(at) && at <= now && now - at < MAX_AGE) return choice.value;
  } catch { /* Invalid or outdated choices require a fresh choice. */ }
  return null;
}

function consentRecord(): string | null {
  if (typeof window === "undefined") return null;
  if (sessionChoice) return JSON.stringify(sessionChoice);
  try { return window.localStorage.getItem(ANALYTICS_CONSENT_KEY); }
  catch { return null; }
}

export function readAnalyticsConsent(): ConsentValue | null {
  return parseAnalyticsConsent(consentRecord());
}

export function analyticsConsentDeadline(): number | null {
  const raw = consentRecord();
  if (parseAnalyticsConsent(raw) !== "allow") return null;
  return Date.parse(JSON.parse(raw!).at) + MAX_AGE;
}

export function writeAnalyticsConsent(value: ConsentValue): void {
  if (typeof window === "undefined") return;
  sessionChoice = { value, at: new Date().toISOString() };
  try { window.localStorage.setItem(ANALYTICS_CONSENT_KEY, JSON.stringify(sessionChoice)); }
  catch { /* The explicit choice still applies to this tab when storage is blocked. */ }
  window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
}

export function syncAnalyticsConsent(event: StorageEvent): void {
  if (event.key === ANALYTICS_CONSENT_KEY || event.key === null) sessionChoice = null;
}
