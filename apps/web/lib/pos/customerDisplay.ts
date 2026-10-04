export const CUSTOMER_DISPLAY_CHANNEL = "bms-pos-display";
export const DISPLAY_FINISHED_MS = 10_000;
export const DISPLAY_STALE_MS = 8_000;

export type CustomerDisplayBrand = {
  name: string;
  branch: string | null;
  logoUrl: string | null;
  businessHours?: string | null;
  website?: string | null;
};

export function displayBrand(session: {
  store?: { name?: string | null; logoUrl?: string | null; businessHours?: string | null; website?: string | null };
  location: { name: string } | null;
} | null): CustomerDisplayBrand | null {
  if (!session) return null;
  return {
    name: session.store?.name || session.location?.name || "",
    branch: session.location?.name ?? null,
    logoUrl: displayUrl(session.store?.logoUrl),
    businessHours: session.store?.businessHours ?? null,
    website: displayUrl(session.store?.website),
  };
}

/** Public-screen identity, never a phone number, email or full name. */
export function displayMemberName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  if (!first || /[@\d]/.test(first)) return null;
  return `${Array.from(first.replace(/\*+$/, "")).slice(0, 3).join("")}***`;
}

export function displayUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\/api\/files\/\d+$/.test(value)) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export type CustomerDisplayLine = {
  name: string;
  size: string | null;
  qty: number;
  unitName: string;
  amount: number;
};

export type CustomerDisplayPayload = {
  brand?: CustomerDisplayBrand | null;
  checkout?: boolean;
  pendingApproval?: boolean;
  pendingPricing?: boolean;
  pointsBalance?: number | null;
  pointsWillEarn?: number | null;
  lines: CustomerDisplayLine[];
  itemCount: number;
  total: number;
  discountTotal: number;
  amountDue: number;
  memberName: string | null;
  pointsEarned: number | null;
  paymentQr: {
    /** Exact provider-issued payload; the display only renders it as a QR. */
    payload: string;
    amount: number;
    accountName: string | null;
    promptpayId: string | null;
  } | null;
  finished: { id?: string; completedAt?: number; total: number; tendered: number | null; change: number | null; taxRequestUrl?: string | null } | null;
};

export const EMPTY_CUSTOMER_DISPLAY: CustomerDisplayPayload = {
  lines: [],
  itemCount: 0,
  total: 0,
  discountTotal: 0,
  amountDue: 0,
  memberName: null,
  pointsEarned: null,
  paymentQr: null,
  finished: null,
};

export function displayPhase(state: CustomerDisplayPayload) {
  if (state.finished) return "finished";
  if (state.lines.length === 0) return "idle";
  if (state.pendingApproval || state.pendingPricing) return "cart";
  return state.checkout || state.paymentQr ? "payment" : "cart";
}

/** Reject control messages and malformed snapshots before they reach rendering. */
export function isDisplayPayload(value: unknown): value is CustomerDisplayPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as CustomerDisplayPayload;
  const money = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  const optionalNumber = (n: unknown) => n == null || money(n);
  const optionalText = (s: unknown) => s == null || typeof s === "string";
  return Array.isArray(v.lines) && v.lines.every(l => l && typeof l.name === "string"
    && optionalText(l.size) && typeof l.unitName === "string" && money(l.qty) && money(l.amount))
    && [v.itemCount, v.total, v.discountTotal, v.amountDue].every(money)
    && optionalText(v.memberName) && [v.pointsEarned, v.pointsBalance, v.pointsWillEarn].every(optionalNumber)
    && [v.checkout, v.pendingApproval, v.pendingPricing].every(b => b == null || typeof b === "boolean")
    && (!v.brand || (typeof v.brand.name === "string" && [v.brand.branch, v.brand.logoUrl, v.brand.businessHours, v.brand.website].every(optionalText)))
    && (!v.paymentQr || (typeof v.paymentQr.payload === "string" && v.paymentQr.payload.length <= 2048
      && money(v.paymentQr.amount) && optionalText(v.paymentQr.accountName)))
    && (!v.finished || (money(v.finished.total) && optionalNumber(v.finished.tendered)
      && optionalNumber(v.finished.change) && optionalNumber(v.finished.completedAt) && optionalText(v.finished.id) && optionalText(v.finished.taxRequestUrl)));
}

/** Heartbeats must not restart the thank-you timer or revive a dismissed receipt. */
export function createDisplayReceiver() {
  let snapshot = EMPTY_CUSTOMER_DISPLAY;
  let lastSeen = -Infinity;
  const receiptTimes = new Map<string, number>();
  let finishedAt = 0;
  return {
    receive(value: unknown, now: number) {
      if (!isDisplayPayload(value)) return false;
      const key = value.finished ? value.finished.id ?? JSON.stringify(value.finished) : null;
      if (key) {
        if (!receiptTimes.has(key)) receiptTimes.set(key, Math.min(now, value.finished?.completedAt ?? now));
        finishedAt = receiptTimes.get(key)!;
        // Retain recent receipts across workspace switches without growing for an entire shift.
        if (receiptTimes.size > 256) receiptTimes.delete(receiptTimes.keys().next().value!);
      }
      snapshot = value;
      lastSeen = now;
      return true;
    },
    read(now: number) {
      const linked = now - lastSeen < DISPLAY_STALE_MS;
      const expired = snapshot.finished && now - finishedAt >= DISPLAY_FINISHED_MS;
      return { linked, state: !linked || expired ? { ...EMPTY_CUSTOMER_DISPLAY, brand: snapshot.brand } : snapshot };
    },
  };
}
