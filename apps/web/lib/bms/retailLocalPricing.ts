// Retail Local commercial price list — the one place these numbers live.
//
// The public /retail-local page, the shop's /admin/retail-local-license card and
// the add-device notice at /admin/pos-devices all read from here. A second copy
// of a price is the copy that drifts.
//
// These prices buy SERVICE, never permission to keep selling. Retail Local
// licensing is evidence-only and fail-open (docs/agent-invariants.md): an
// unregistered, unpaid or lapsed install keeps selling, updating, backing up
// and restoring. Nothing here may be read on a POS, payment, stock, tax,
// backup, restore or update path, and no price or plan wording may appear on
// a receipt, bill, tax document or kitchen ticket.
//
// Pure module with no imports so client components can use it.

export const RETAIL_LOCAL_PRICING = {
  currency: "THB",
  /** Every amount below excludes 7% VAT. */
  vatIncluded: false,
  /** Install, sell, update, back up and restore on one installation. */
  free: { amount: 0, posDevices: 1 },
  /** One-time licence: support for `supportMonths`, machine transfer, restore help. */
  plus: { amount: 2990, supportMonths: 12 },
  /** Early-adopter price for the technical pilot. */
  pilot: { amount: 1990, shops: 20 },
  /** Optional yearly renewal of support; not renewing never stops the shop. */
  supportRenewal: { amount: 990, per: "year" },
  /** Each POS device after the first, one-time. Honour system: we cannot see pairings. */
  extraDevice: { amount: 990, per: "device" },
  /** Set up a scheduled backup to the shop's own USB/NAS and test a restore, one-time. */
  backupSetup: { amount: 500 },
  /** On-site installation, from this amount. */
  onSiteInstall: { fromAmount: 1500 },
} as const;

export function formatRetailLocalBaht(amount: number, lang: "th" | "en"): string {
  const n = amount.toLocaleString("en-US");
  return lang === "th" ? `${n} บาท` : `฿${n}`;
}
