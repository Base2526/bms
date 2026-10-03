import { TAX_REQUEST_WINDOW_DAYS } from "./taxRequestToken";

export const TAX_REQUEST_MAX_SUBMISSIONS = 3;
export const taxRequestDeadline = (soldAt: Date | string) =>
  new Date(
    new Date(soldAt).getTime() + TAX_REQUEST_WINDOW_DAYS * 86400000
  ).toISOString();

/** Server-composed UI guidance. Mutations recheck with the DB clock after acquiring locks. */
export function taxRequestPolicy(
  deadline: Date | string,
  submissions: number,
  status: string,
  now: Date | string
) {
  const expiresAt = new Date(deadline).toISOString();
  const expired = new Date(now).getTime() >= new Date(expiresAt).getTime();
  const remaining = Math.max(0, TAX_REQUEST_MAX_SUBMISSIONS - submissions);
  return {
    expiresAt,
    serverNow: new Date(now).toISOString(),
    submissions,
    maxSubmissions: TAX_REQUEST_MAX_SUBMISSIONS,
    remaining,
    expired,
    canSubmit:
      !expired && remaining > 0 && ["PENDING", "NEEDS_INFO"].includes(status),
  };
}
