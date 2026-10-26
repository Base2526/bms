import { productionDate } from "./operationProductionPolicy";
import { rejectChecklist as reject } from "./operationChecklistPolicy";
export const IMPROVEMENT_PERMISSIONS = {
  PUBLISH_STANDARD: "operations.standard.manage",
  ACK_STANDARD: "operations.checklist.view",
  ASSESS_STANDARD: "operations.standard.assess",
  RECORD_TRAINING: "operations.standard.assess",
  CREATE_ISSUE: "operations.improvement.manage",
  UPDATE_ISSUE: "operations.improvement.manage",
  LINK_FAILURE: "operations.improvement.manage",
  CREATE_FOLLOWUP: "operations.improvement.manage",
  REOPEN_ISSUE: "operations.improvement.manage",
  CLOSE_ISSUE: "operations.checklist.review",
  CONFIRM_WEEK: "operations.summary.review",
} as const;
export function operationWeek(from: unknown) {
  const start = productionDate(from);
  const instant = new Date(Date.parse(start) + 6 * 86400000).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(instant)) reject("INVALID_DATE");
  const end = instant.slice(0, 10);
  return { from: start, to: end };
}
export function wasteValue(rows: Array<{ amount: string | null }>) {
  let micros = 0n,
    unknown = 0;
  for (const x of rows) {
    if (x.amount == null) {
      unknown++;
      continue;
    }
    if (!/^\d+(?:\.\d{1,6})?$/.test(x.amount)) reject("INVALID_VALUE_EVIDENCE");
    const [a, b = ""] = x.amount.split(".");
    micros += BigInt(a) * 1000000n + BigInt(b.padEnd(6, "0"));
  }
  const known = `${micros / 1000000n}.${String(micros % 1000000n).padStart(6, "0")}`;
  return { known, unknown, total: unknown ? null : known };
}
