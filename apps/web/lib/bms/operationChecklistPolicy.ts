/** Pure input/state rules shared by the services; the server remains authoritative. */
export class ChecklistError extends Error {
  constructor(readonly status: string) {
    super(status);
  }
}
export const rejectChecklist = (status: string): never => {
  throw new ChecklistError(status);
};
export function checklistReportDates(from: unknown, to: unknown) {
  const valid = (v: unknown): v is string =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (!valid(from) || !valid(to)) return rejectChecklist("INVALID_INPUT");
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (days < 0 || days > 92) return rejectChecklist("INVALID_INPUT");
  return { from, to };
}
export const CHECKLIST_TYPES = [
  "BOOLEAN",
  "PASS_FAIL",
  "NUMBER",
  "TEMPERATURE",
  "TEXT",
  "PHOTO",
  "CHOICE",
] as const;
export type ChecklistItem = {
  key: string;
  label: string;
  type: (typeof CHECKLIST_TYPES)[number];
  required: boolean;
  photoRequired: boolean;
  allowNa: boolean;
  min: number | null;
  max: number | null;
  unit: string;
  choices: string[];
  instruction: string;
};
export const checklistUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export function checklistText(
  v: unknown,
  max = 2000,
  required = false,
): string {
  if (v == null && !required) return "";
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    return rejectChecklist("INVALID_INPUT");
  return v.trim();
}
export function checklistItems(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value) || !value.length || value.length > 50)
    return rejectChecklist("INVALID_INPUT");
  const seen = new Set<string>();
  return value.map((v) => {
    if (!v || typeof v !== "object") return rejectChecklist("INVALID_INPUT");
    const key = checklistText(v.key, 60, true);
    if (
      !/^[a-zA-Z0-9_-]+$/.test(key) ||
      seen.has(key) ||
      !CHECKLIST_TYPES.includes(v.type)
    )
      return rejectChecklist("INVALID_INPUT");
    seen.add(key);
    for (const flag of ["required", "photoRequired", "allowNa"])
      if (typeof v[flag] !== "boolean") return rejectChecklist("INVALID_INPUT");
    const numeric = ["NUMBER", "TEMPERATURE"].includes(v.type);
    const min = v.min == null ? null : v.min,
      max = v.max == null ? null : v.max;
    if (
      [min, max].some(
        (n) =>
          n !== null &&
          (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e9),
      ) ||
      (min !== null && max !== null && min > max) ||
      (!numeric && (min !== null || max !== null))
    )
      return rejectChecklist("INVALID_INPUT");
    const choices = v.choices == null ? [] : v.choices;
    if (!Array.isArray(choices) || choices.length > 20)
      return rejectChecklist("INVALID_INPUT");
    const clean = choices.map((c) => checklistText(c, 100, true));
    if (
      (v.type === "CHOICE" &&
        (!clean.length || new Set(clean).size !== clean.length)) ||
      (v.type !== "CHOICE" && clean.length)
    )
      return rejectChecklist("INVALID_INPUT");
    return {
      key,
      label: checklistText(v.label, 300, true),
      type: v.type,
      required: v.required,
      photoRequired: v.photoRequired,
      allowNa: v.allowNa,
      min,
      max,
      unit: checklistText(v.unit, 30),
      choices: clean,
      instruction: checklistText(v.instruction),
    };
  });
}
export function evaluateChecklistResult(
  item: ChecklistItem,
  value: unknown,
  note: string,
  photos: number[],
) {
  if (value === "NA") {
    if (!item.allowNa || !note.trim())
      return rejectChecklist("REASON_REQUIRED");
    return "NA";
  }
  if ((item.photoRequired || item.type === "PHOTO") && !photos.length)
    return rejectChecklist("EVIDENCE_REQUIRED");
  switch (item.type) {
    case "BOOLEAN":
      if (typeof value !== "boolean") return rejectChecklist("INVALID_INPUT");
      return value ? "PASS" : "FAIL";
    case "PASS_FAIL":
      if (value !== "PASS" && value !== "FAIL")
        return rejectChecklist("INVALID_INPUT");
      return value;
    case "NUMBER":
    case "TEMPERATURE":
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1e9
      )
        return rejectChecklist("INVALID_INPUT");
      if (
        (item.min !== null && value < item.min) ||
        (item.max !== null && value > item.max)
      )
        return "FAIL";
      return item.min === null && item.max === null ? "RECORDED" : "PASS";
    case "TEXT":
      checklistText(value, 2000, true);
      return "RECORDED";
    case "CHOICE":
      if (!item.choices.includes(value as string))
        return rejectChecklist("INVALID_INPUT");
      return "RECORDED";
    case "PHOTO":
      if (value !== true) return rejectChecklist("INVALID_INPUT");
      return "RECORDED";
  }
}
export function editableChecklist(status: string) {
  if (!["OPEN", "IN_PROGRESS", "REJECTED"].includes(status))
    rejectChecklist("INVALID_STATE");
}
export const CHECKLIST_COMMAND_PERMISSIONS = {
  SAVE_TEMPLATE: "operations.checklist.manage",
  PUBLISH: "operations.checklist.manage",
  RETIRE: "operations.checklist.manage",
  CREATE_RUN: "operations.checklist.manage",
  ASSIGN: "operations.checklist.manage",
  START: "operations.checklist.execute",
  RECORD: "operations.checklist.execute",
  SUBMIT: "operations.checklist.execute",
  APPROVE: "operations.checklist.review",
  REJECT: "operations.checklist.review",
  VOID: "operations.checklist.review",
  ACTION_START: "operations.checklist.execute",
  ACTION_RESOLVE: "operations.checklist.execute",
  ACTION_VERIFY: "operations.checklist.review",
  ACTION_REOPEN: "operations.checklist.review",
  ACTION_ASSIGN: "operations.checklist.manage",
  SAVE_SCHEDULE: "operations.checklist.manage",
  PAUSE_SCHEDULE: "operations.checklist.manage",
} as const;
export type ChecklistCommandAction = keyof typeof CHECKLIST_COMMAND_PERMISSIONS;
