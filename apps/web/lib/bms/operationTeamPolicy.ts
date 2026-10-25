import {
  checklistText,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
export function dutyKey(value: unknown) {
  const key = checklistText(value, 60, true).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) return reject("INVALID_DUTY");
  return key;
}
export function teamInstant(value: unknown) {
  if (
    typeof value !== "string" ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return reject("INVALID_INPUT");
  return new Date(value).toISOString();
}
export function teamWindow(start: unknown, end: unknown) {
  const startsAt = teamInstant(start),
    endsAt = teamInstant(end),
    minutes = (Date.parse(endsAt) - Date.parse(startsAt)) / 60000;
  if (minutes <= 0 || minutes > 1440) return reject("INVALID_INPUT");
  return { startsAt, endsAt };
}
export const TEAM_PERMISSIONS = {
  SAVE_ROSTER: "operations.roster.manage",
  PUBLISH_ROSTER: "operations.roster.manage",
  CANCEL_ROSTER: "operations.roster.manage",
  ACCEPT_DUTY: "operations.roster.accept",
  END_DUTY: "operations.roster.accept",
  CREATE_HANDOVER: "operations.roster.accept",
  REFRESH_HANDOVER: "operations.roster.accept",
  SUBMIT_HANDOVER: "operations.roster.accept",
  RECEIVE_HANDOVER: "operations.handover.receive",
  REROUTE_HANDOVER: "operations.handover.manage",
  CANCEL_HANDOVER: "operations.handover.manage",
  APPEND_NOTE: "operations.handover.receive",
  TRANSFER_ITEM: "operations.handover.manage",
  CONFIRM_DAY: "operations.summary.review",
  READ_NOTICE: "operations.checklist.view",
  SAVE_SUPERVISOR_DUTY: "operations.checklist.manage",
} as const;
