"use client";

const CLAIMS_KEY = "bms.staffAlertClaims.v1";
const CLAIM_TTL_MS = 5 * 60_000;
const MAX_CLAIMS = 200;

type Claims = Record<string, number>;

function readClaims(): Claims {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CLAIMS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Claims : {};
  } catch {
    return {};
  }
}

function claimInStorage(key: string, now: number): boolean {
  const claims = readClaims();
  const previous = Number(claims[key]);
  if (Number.isFinite(previous) && now - previous >= 0 && now - previous < CLAIM_TTL_MS) return false;

  const retained = Object.entries(claims)
    .filter(([, timestamp]) => Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp < CLAIM_TTL_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CLAIMS - 1);
  const next: Claims = Object.fromEntries(retained);
  next[key] = now;
  window.localStorage.setItem(CLAIMS_KEY, JSON.stringify(next));
  return true;
}

/**
 * Claim one audible/visual alert across tabs on this device.
 *
 * Web Locks serializes the read/write when available. localStorage remains the durable cross-tab
 * memory so a tab that receives the same websocket event just after the lock is released still
 * declines it. If browser storage is unavailable, fail open: a duplicate alert is safer than a
 * missed customer/order alert.
 */
export async function claimStaffAlert(key: string): Promise<boolean> {
  const now = Date.now();
  try {
    if (navigator.locks) {
      return await navigator.locks.request("bms-staff-alert-claim", { mode: "exclusive" }, () => (
        claimInStorage(key, now)
      ));
    }
    return claimInStorage(key, now);
  } catch {
    return true;
  }
}

