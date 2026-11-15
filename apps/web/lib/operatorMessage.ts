/** Explain server business rejections without exposing protocol codes as the instruction. */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function operatorMessage(error: unknown, t: Translate, action: "read" | "write" = "read"): string {
  const gqlCode = error && typeof error === "object" && "graphQLErrors" in error
    ? (error as { graphQLErrors?: Array<{ extensions?: { code?: unknown } }> }).graphQLErrors?.[0]?.extensions?.code
    : undefined;
  const raw = typeof error === "string" ? error.trim()
    : error instanceof Error ? error.message.trim() : "";
  const code = /^[A-Z][A-Z0-9_]{2,}$/.test(raw) ? raw
    : typeof gqlCode === "string" && ["UNAUTHENTICATED", "FORBIDDEN", "INTERNAL_SERVER_ERROR", "CONFLICT"].includes(gqlCode)
      ? gqlCode : raw;

  switch (code) {
    case "UNAUTHENTICATED": return t("operator_message.sign_in");
    case "FORBIDDEN": case "VALUATION_FORBIDDEN": case "COST_ALLOCATION_FORBIDDEN": case "NET_PROFIT_FORBIDDEN":
      return t("operator_message.permission");
    case "MENU_PROFIT_ALL_BRANCH_ACCESS_REQUIRED": case "BUNDLE_PUBLISH_ALL_BRANCH_ACCESS_REQUIRED":
    case "PRICE_PUBLISH_ALL_BRANCH_ACCESS_REQUIRED": case "COST_ALLOCATION_ALL_BRANCH_ACCESS_REQUIRED":
    case "NET_PROFIT_ALL_BRANCH_ACCESS_REQUIRED": return t("operator_message.all_branches");
    case "STORE_CURRENCY_REQUIRED": case "VALUATION_CURRENCY_REVIEW_REQUIRED": case "COST_ALLOCATION_CURRENCY_REVIEW_REQUIRED":
    case "NET_PROFIT_CURRENCY_REVIEW_REQUIRED": case "PRICE_PUBLISH_CURRENCY_REVIEW_REQUIRED":
      return t("operator_message.currency");
    case "VALUATION_STALE_REVIEW": case "MENU_PROFIT_STALE_REVIEW": case "BUNDLE_PUBLISH_STALE_REVIEW":
    case "PRICE_PUBLISH_STALE_REVIEW": case "COST_ALLOCATION_PREVIEW_STALE": case "COST_ALLOCATION_CONFLICT":
    case "COST_ALLOCATION_SNAPSHOT_INVALID": case "CONFLICT": return t("operator_message.changed");
    case "IDEMPOTENCY_CONFLICT": case "VALUATION_IDEMPOTENCY_CONFLICT": case "MENU_PROFIT_IDEMPOTENCY_CONFLICT":
    case "BUNDLE_PUBLISH_IDEMPOTENCY_CONFLICT": case "PRICE_PUBLISH_IDEMPOTENCY_CONFLICT":
      return t("operator_message.request_conflict");
    case "COST_ALLOCATION_MONTH_UNSUPPORTED": case "NET_PROFIT_MONTH_UNSUPPORTED": return t("operator_message.month");
    case "COST_ALLOCATION_COSTS_TRUNCATED": case "COST_ALLOCATION_LOCATION_LIMIT": case "COST_ALLOCATION_ROW_LIMIT":
    case "NET_PROFIT_VALUATION_LIMIT": case "PRICE_PLAN_RANGE_EXCEEDED": case "MENU_PLAN_RANGE_EXCEEDED":
      return t("operator_message.limit");
    case "COST_ALLOCATION_INVALID_AMOUNT": case "VALUATION_INVALID_AMOUNT": case "PRICE_PUBLISH_INVALID_BRANCH_PRICE":
    case "PRICE_PUBLISH_PRICE_LIMIT": return t("operator_message.amount");
    case "COST_ALLOCATION_SOURCE_REVIEW_REQUIRED": return t("operator_message.allocation_source");
    case "COST_ALLOCATION_TARGET_NOT_FOUND": return t("operator_message.allocation_target");
    case "VALUATION_FISH_BALANCE_REVIEW_REQUIRED": case "VALUATION_FISH_MOVEMENT_INVALID":
      return t("operator_message.fish_balance");
    case "VALUATION_FISH_SOURCE_MISSING": return t("operator_message.fish_source");
    case "PRODUCT_NOT_READY": return t("operator_message.fish_product_ready");
    case "EXPIRY_REQUIRED": return t("operator_message.fish_expiry");
    case "OPENING_NOT_EMPTY": return t("operator_message.fish_opening_not_empty");
    case "LOT_REVIEW_REQUIRED": return t("operator_message.fish_lot_review");
    case "VALUATION_PURCHASE_SOURCE_MISSING": return t("operator_message.purchase_source");
    case "VALUATION_INVENTORY_MISSING": return t("operator_message.stock_missing");
    case "VALUATION_NEGATIVE_OPENING": return t("operator_message.negative_stock");
    case "VALUATION_QUANTITY_MISMATCH": return t("operator_message.stock_changed");
    case "VALUATION_INVALID_QUANTITY": return t("operator_message.quantity");
    case "VALUATION_REVIEW_REQUIRED": return t("operator_message.valuation_review");
    case "MENU_PROFIT_EVIDENCE_INCOMPLETE": return t("operator_message.profit_evidence");
    case "MENU_PROFIT_RECONCILIATION_FAILED": return t("operator_message.profit_reconcile");
    case "MENU_PROFIT_RULE_REQUIRED": return t("operator_message.profit_rule");
    case "MENU_PROFIT_INVALID_WEIGHTS": return t("operator_message.profit_weights");
    case "MENU_PROFIT_ZERO_WEIGHT": return t("operator_message.profit_zero_weight");
    case "BUNDLE_PUBLISH_SKU_EXISTS": return t("operator_message.bundle_sku");
    case "BUNDLE_PUBLISH_TAX_SETTINGS_REQUIRED": return t("operator_message.bundle_tax");
    case "BUNDLE_PUBLISH_VAT_MISMATCH": case "PRICE_PUBLISH_VAT_MISMATCH":
      return t("operator_message.vat_mismatch");
    case "BUNDLE_PUBLISH_COST_INCOMPLETE": case "PRICE_PUBLISH_COST_INCOMPLETE":
      return t("operator_message.recipe_cost");
    case "PRICE_PUBLISH_BRANCH_PACK_REQUIRED": return t("operator_message.branch_pack");
    case "PRICE_PUBLISH_INVALID_PACK": return t("operator_message.pack_code");
    case "PRICE_PUBLISH_ACTIVE_RECIPE_REQUIRED": return t("operator_message.active_recipe");
    case "PRICE_PUBLISH_INVALID_BRANCH_WINDOW": case "PRICE_PUBLISH_INVALID_WINDOW":
    case "PRICE_PUBLISH_WINDOW_OVERLAP": return t("operator_message.price_window");
    case "PRICE_PUBLISH_EXCLUSIVE_CHECKOUT_UNSUPPORTED": return t("operator_message.inclusive_price");
    case "SALES_EVIDENCE_INVALID_MENU_SELECTION": return t("operator_message.menu_selection");
    case "MENU_PROFIT_CONFIRM_REQUIRED": case "BUNDLE_PUBLISH_CONFIRM_REQUIRED":
    case "PRICE_PUBLISH_CONFIRM_REQUIRED": case "PRICE_PUBLISH_CANCEL_CONFIRM_REQUIRED":
      return t("operator_message.confirm_again");
    case "MENU_PROFIT_INVALID_SCOPE": case "PRICE_PUBLISH_INVALID_SCOPE": case "VALUATION_INVALID_LOCATION":
      return t("operator_message.branch_selection");
    case "VALUATION_INVALID_PAGE": return t("operator_message.refresh");
    case "SALES_EVIDENCE_INVALID_INPUT": case "BUNDLE_PUBLISH_INVALID_INPUT": case "BUNDLE_PUBLISH_INVALID_SURFACES":
    case "PRICE_PUBLISH_INVALID_INPUT": case "PRICE_PLAN_INVALID_INPUT": case "MENU_PLAN_INVALID_INPUT":
      return t("operator_message.check_input");
    case "MISSING_COST": case "INVALID_COST_SOURCE": case "LEGACY_RECONSTRUCTED_COST":
    case "ACTUAL_INVENTORY_COST_UNKNOWN": return t("operator_message.cost_unknown");
    case "COST_ALLOCATION_INCOMPLETE": case "OPERATING_COST_REVIEW_INCOMPLETE":
    case "BRANCH_WIDE_COST_NOT_CHANNEL_ALLOCATED": return t("operator_message.expense_unknown");
    case "RETURN_COST_IS_QUANTITY_BASIS": case "RETURN_COST_REVERSAL_UNVERIFIED":
      return t("operator_message.return_cost_unknown");
    case "RETURN_VAT_IS_SALE_ALLOCATION": return t("operator_message.return_vat_basis");
    case "RESERVATION_RELEASE_NOT_RESTOCK": return t("operator_message.reservation_basis");
    case "LINE_LIMIT": case "EVENT_LIMIT": case "RETURN_HISTORY_LIMIT": case "PROFIT_GAP_LIMIT":
    case "MENU_POPULATION_TRUNCATED": return t("operator_message.evidence_limit");
    case "MISSING_LINES": case "SALES_EVIDENCE_DUPLICATE_LINE": case "ORDER_TOTAL_MISMATCH":
    case "VAT_SNAPSHOT_UNRECONCILED": case "MENU_LINE_VAT_UNRECONCILED":
      return t("operator_message.sale_evidence");
    case "RETURN_COMPONENTS_UNALLOCATED": case "RETURN_COMPONENTS_UNRECONCILED":
    case "RETURN_TOTAL_MISMATCH": case "RETURN_QUANTITY_MISMATCH": case "RETURN_PAYABLE_MISMATCH":
    case "RETURN_SALE_VAT_UNRECONCILED": case "RETURN_VAT_UNRECONCILED": case "RETURN_VAT_UNALLOCATED":
    case "RETURN_HISTORY_AMOUNT_MISMATCH": case "BLIND_RETURN_UNRECONCILED":
      return t("operator_message.return_evidence");
    case "RETURN_PRIOR_COMPONENTS_UNKNOWN": case "RETURN_PRIOR_VAT_UNKNOWN": case "RETURN_LINE_VAT_UNKNOWN":
      return t("operator_message.return_prior_unknown");
    case "BACKOFFICE_RETURN_WITHOUT_LINE_ALLOCATION": case "PAYMENT_REFUND_WITHOUT_LINE_ALLOCATION":
      return t("operator_message.return_allocation");
    case "INVENTORY_ADJUSTMENT_UNVALUED": return t("operator_message.stock_value_unknown");
    case "PROFIT_EVENT_SCOPE_UNKNOWN": return t("operator_message.sale_scope_unknown");
    case "LEGACY_DATE_FALLBACK": return t("operator_message.legacy_date");
    case "CANCELLED_SALE_REQUIRES_RECONCILIATION": case "TAX_ADJUSTMENT_REQUIRES_RECONCILIATION":
      return t("operator_message.reconcile_sale");
    case "REFUND_METHOD_UNKNOWN": return t("operator_message.refund_method");
    case "RETURN_SNAPSHOT_INVALID": case "RETURN_SOURCE_CHANGED":
      return t("operator_message.return_review");
    case "INTERNAL_SERVER_ERROR": case "SERVER_ERROR": case "เซิร์ฟเวอร์ผิดพลาด":
      return t(action === "read" ? "operator_message.read_unavailable" : "operator_message.write_unknown");
  }

  if (/^(?:[A-Z][A-Z0-9_]{2,}|HTTP[_ ]?\d{3}|ERROR)$/.test(code))
    return t("operator_message.unknown_code", { code });
  if (/^(?:Response not successful|Failed to fetch|Network request failed|NetworkError|fetch failed|Server response is unavailable|Load failed)/i.test(raw))
    return t(action === "read" ? "operator_message.read_unavailable" : "operator_message.write_unknown");
  return raw || t(action === "read" ? "operator_message.read_unavailable" : "operator_message.write_unknown");
}
