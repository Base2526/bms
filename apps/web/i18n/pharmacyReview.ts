import type { UiTranslator } from "./uiText";

/** Operator labels for structured values only; free-text clinical evidence stays verbatim. */
export function pharmacyReviewValue(value: string | number | boolean | null | undefined, t: UiTranslator): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? t("admin_ui.review_yes") : t("admin_ui.review_no");
  const labels: Record<string, string> = {
    SELF: t("admin_pharmacy_case.rel_self"), CHILD: t("admin_pharmacy_case.rel_child"),
    PARENT: t("admin_pharmacy_case.rel_parent"), OTHER: t("admin_pharmacy_case.rel_other"),
    MALE: t("admin_ui.review_male"), FEMALE: t("admin_ui.review_female"),
    YES: t("admin_ui.review_present"), NO: t("admin_ui.review_absent"), NONE: t("admin_ui.review_none"),
    UNKNOWN: t("admin_ui.review_unknown"), NOT_APPLICABLE: t("admin_ui.review_not_applicable"),
  };
  return typeof value === "string" && Object.hasOwn(labels, value) ? labels[value] : String(value);
}

/** Display only: stored status codes and clipboard evidence retain their original values. */
export function pharmacyReviewStatus(value: string, t: UiTranslator): string {
  const labels: Record<string, string> = {
    COMPLETE: t("admin_ui.review_complete"), INCOMPLETE: t("admin_ui.review_incomplete"), CONFLICT: t("admin_ui.review_conflict"),
    CONFIRMED: t("admin_ui.review_confirmed"), PENDING: t("admin_ui.review_pending"), NOT_REQUESTED: t("admin_ui.review_not_requested"),
    UNKNOWN: t("admin_ui.review_unknown"),
  };
  return Object.hasOwn(labels, value) ? labels[value] : value;
}

export function pharmacyCaseStatus(value: string, t: UiTranslator): string {
  const labels: Record<string, string> = {
    DRAFT: t("admin_ui.case_draft"), COLLECTING_INFORMATION: t("admin_ui.case_collecting"),
    PENDING_CONFIRMATION: t("admin_ui.case_pending_confirmation"), WAITING_FOR_PHARMACIST: t("admin_ui.case_waiting_pharmacist"),
    PHARMACIST_REVIEWING: t("admin_ui.case_reviewing"), NEED_MORE_INFORMATION: t("admin_ui.case_need_information"),
    APPROVED: t("admin_ui.case_approved"), REJECTED: t("admin_ui.case_rejected"),
    REFER_TO_DOCTOR: t("admin_ui.case_refer_doctor"), EMERGENCY_REFERRAL: t("admin_ui.case_emergency_referral"), CLOSED: t("admin_ui.case_closed"),
  };
  return Object.hasOwn(labels, value) ? labels[value] : value;
}

export function pharmacyRiskLabel(value: string, t: UiTranslator): string {
  const labels: Record<string, string> = {
    EMERGENCY: t("admin_ui.risk_emergency"), HIGH: t("admin_ui.risk_high"), MODERATE: t("admin_ui.risk_moderate"),
    LOW: t("admin_ui.risk_low"), UNKNOWN: t("admin_ui.review_unknown"),
  };
  return Object.hasOwn(labels, value) ? labels[value] : value;
}
