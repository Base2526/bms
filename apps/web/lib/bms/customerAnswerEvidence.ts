/** Server-only, request-local evidence. Never put this object on a public pipeline result. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { AiTurnQuality } from "./aiQuality";

export const EVIDENCE_VERSION = 1;
export const EVIDENCE_LIMITS = { input: 2048, output: 8192, turn: 65536, calls: 20 } as const;
export type EvidenceStatus = "COMPLETE" | "PARTIAL" | "FAILED" | "NOT_CAPTURED" | "NOT_APPLICABLE" | "EXPIRED";
export type EvidenceCall = {
  id: string; sequence: number; tool: string; source: string; outcome: string;
  startedAt: string; finishedAt: string; input: unknown; output: unknown;
  reasons: string[]; bytes: number; projectionVersion: number;
  omissions: { fields: number; arrayItems: number; strings: number };
};
export type TurnEvidence = {
  id: string; tenantId: string; channel: string; startedAt: string; finishedAt?: string;
  origin: string; status: EvidenceStatus; reasons: string[]; calls: EvidenceCall[];
  attemptedCalls: number; bytes: number; replyHash?: string; version: number;
};
const scope = new AsyncLocalStorage<TurnEvidence>();
const evidenceByQuality = new WeakMap<object, TurnEvidence>();
const evidenceByError = new WeakMap<object, TurnEvidence>();
export const replyDigest = (reply: string) => createHash("sha256").update(reply).digest("hex");

// Only public catalog/branch facts are eligible for structural projection. All other tools use
// their own narrow status/completeness projection. Unknown/new fields always fail closed.
export const PUBLIC_EVIDENCE_TOOLS = new Set([
  "search_products", "browse_catalog", "list_new_arrivals", "find_alternatives", "get_product",
  "check_stock", "list_menu_modifiers", "list_restaurant_order_locations", "get_restaurant_availability",
  "get_board_game_rates", "search_board_game_library", "get_board_game_availability", "get_store_info",
  "list_available_coupons", "list_customer_coupons", "check_coupon", "get_shipping_estimate",
  "recommend_products",
]);
const PUBLIC_KEYS = new Set((
  "verifiedAt status total products sku name price maxPrice category brand active availability available availableTotal " +
  "variants size sizes stock qty quantity reserved onHand branch branches branchName locationName locations code " +
  "storeName businessType businessArchetype businessHours country timezone restaurantOrderHours restaurantOrdersPaused " +
  "about description summary shippingPolicy returnPolicy " +
  "enabledCarriers branchParking parking published capacity carSpaces motorcycleSpaces accessibleSpaces feeType fee " +
  "details hours area floor areaLabel floorLabel seats minSeats maxSeats tableDetails groups totalTables availableTables " +
  "occupiedTables totalSeats availableSeats queueCount waitingCount reservationCount openKitchenTickets kitchenSlaMinutes " +
  "rates hourlyRate participantType minimumMinutes roundingMinutes graceMinutes currency games titles title " +
  "minPlayers maxPlayers difficulty playingTimeMinutes totalCopies availableCopies playableCopies tags " +
  "booking canSubmitViaChat autoConfirm enabled requiresDeposit depositAmount depositType minimumPartySize maximumPartySize " +
  "openingHours asOf snapshotAt truncated hasMore limit totalCount returnedCount omittedCount areaName " +
  "selectionType required minSelections maxSelections options priceDelta defaultSelected modifierGroups " +
  "coupons requestedCode requested alternatives discountType discountValue minimumSpend maximumDiscount expiresAt startsAt " +
  "subtotal shippingFee freeShippingThreshold estimatedDays minDays maxDays weightGrams configured " +
  "fields omitted source value kind unit amount durationMinutes count isEstimate policyVersion " +
  "tableDetailsTruncated observedAt requestsEnabled depositPolicy depositPercent refundCutoffHours " +
  "waitMinutes waitingParties offersStatus typicalMinutes language omittedFields branchCode tables availableNow availableSeatsNow " +
  "queue walkInWaitingParties walkInWaitingGuests estimatedWaitMinutes reservations pendingStaffReview acceptedUnseated " +
  "kitchen inProgressTickets readyAwaitingServiceTickets oldestInProgressTicketMinutes activeStations configuredSlaMinutes warnFrom lateBy estimatedPrepMinutes " +
  "pricePerHour customerType availableSizes packs packCode unitName baseQty candidates basis createdAt updatedAt " +
  "foodProfile allergenCodes allergenInformationProvided dietaryTags minSelect maxSelect " +
  "type minOrderAmount remainingRedemptions subtotalOk discountPreview reason state warnings"
).split(/\s+/));
const STATUS_KEYS = new Set((
  "status configured marketplaceManaged hasRecipientName hasPhone hasAddress missingFields " +
  "requiresConfirmation canCheckout saved updated created accepted paymentStatus fulfillmentType " +
  "total subtotal shippingFee amount currency partySize desiredAt reservedLocal durationMinutes expiresAt " +
  "requests orders items sku size qty price unitPrice lineAmount branchName " +
  "available points balance tier discountType discountValue minimumSpend referenceAmbiguous " +
  "customerFound requiresShippingDetails hasShippingAddress shippingAddressCount enrolled pointsUsable pointsBalance " +
  "redeemableDiscount redeemMinPoints programEnabled language confidence"
).split(/\s+/));
const INPUT_KEYS = new Set((
  "sku size qty quantity branch locationId partySize desiredAt reservedLocal durationMinutes action " +
  "players playersTo difficulty limit offset subtotal items packCode fulfillmentType " +
  "product keyword category brand minPrice maxPrice inStockOnly sort"
).split(/\s+/));
/** Explicit inventory: adding a customer tool requires choosing a privacy policy and a test. */
export const STATUS_EVIDENCE_TOOLS = new Set([
  "request_restaurant_reservation", "get_restaurant_reservation_status", "subscribe_restock_notification",
  "get_loyalty_points", "get_order_status", "get_customer_checkout", "create_order",
  "save_customer_checkout_details", "submit_payment", "reorder", "request_board_game_reservation",
  "get_board_game_reservation_status", "manage_board_game_booking", "get_payment_info",
  "present_customer_choices", "detect_language", "get_pharmacy_product_facts",
  "get_pharmacy_service_status", "get_pharmacy_case_status",
]);
const CONTAINER_KEYS = new Set(("products variants sizes branch branches locations branchParking parking tableDetails groups rates games titles booking " +
  "options modifierGroups coupons requested alternatives fields requests orders items tier tables queue reservations kitchen configuredSlaMinutes " +
  "availableSizes packs candidates foodProfile").split(/\s+/));
const ARRAY_KEYS = new Set(("products variants sizes branches locations tableDetails groups rates games titles tags options modifierGroups " +
  "coupons alternatives requests orders items enabledCarriers missingFields omittedFields availableSizes packs candidates allergenCodes dietaryTags warnings").split(/\s+/));
export function redactEvidenceText(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/(?:\+?\d[\d ()-]{7,}\d)/g, "[NUMBER]")
    .replace(/(?:bearer\s+\S+|(?:token|secret|password|authorization)\s*[:=]\s*\S+)/gi, "[SECRET]");
}
function project(value: unknown, keys: Set<string>, reasons: Set<string>, stats: EvidenceCall["omissions"], depth = 0): unknown {
  if (value == null || typeof value === "boolean") return value ?? null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    // Preserve ISO timestamps (not phone/account numbers).
    const clean = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)?$/.test(value) ? value : redactEvidenceText(value);
    if (clean !== value) reasons.add("REDACTED");
    if (clean.length > 500) { reasons.add("STRING_LIMIT"); stats.strings++; }
    return clean.slice(0, 500);
  }
  if (depth >= 8) { reasons.add("DEPTH_LIMIT"); return null; }
  if (Array.isArray(value)) {
    if (value.length > 30) { reasons.add("ARRAY_LIMIT"); stats.arrayItems += value.length - 30; }
    return value.slice(0, 30).map(v => project(v, keys, reasons, stats, depth + 1));
  }
  if (typeof value !== "object") { reasons.add("UNSUPPORTED_VALUE"); return null; }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key) && (child == null || typeof child !== "object" ||
      (Array.isArray(child) ? ARRAY_KEYS.has(key) : CONTAINER_KEYS.has(key)))) result[key] = project(child, keys, reasons, stats, depth + 1);
    else { reasons.add("FIELDS_OMITTED"); stats.fields++; }
  }
  return result;
}
function bound(value: unknown, max: number, reasons: Set<string>): unknown {
  if (Buffer.byteLength(JSON.stringify(value)) <= max) return value;
  reasons.add("BYTE_LIMIT");
  return { omitted: true }; // Never slice JSON into invalid text.
}
export function projectToolEvidence(tool: string, input: unknown, output: unknown) {
  const reasons = new Set<string>();
  const omissions = { fields: 0, arrayItems: 0, strings: 0 };
  if (!PUBLIC_EVIDENCE_TOOLS.has(tool) && !STATUS_EVIDENCE_TOOLS.has(tool)) {
    return { input: {}, output: {}, reasons: ["UNREGISTERED_PROJECTION"], omissions };
  }
  // Clinical tools intentionally reveal no clinical facts or identifiers to ai_quality.view.
  const clinical = tool.startsWith("get_pharmacy_");
  if (clinical) reasons.add("CLINICAL_METADATA_ONLY");
  if (!input || typeof input !== "object" || Array.isArray(input)) { input = {}; reasons.add("INVALID_INPUT_SHAPE"); }
  if (!output || typeof output !== "object") { output = {}; reasons.add("NON_OBJECT_OUTPUT"); }
  const safeInput = bound(project(input, clinical ? new Set() : INPUT_KEYS, reasons, omissions), EVIDENCE_LIMITS.input, reasons);
  const keys = PUBLIC_EVIDENCE_TOOLS.has(tool) ? PUBLIC_KEYS : STATUS_KEYS;
  const safeOutput = bound(project(output, clinical ? new Set(["status", "referenceAmbiguous"]) : keys, reasons, omissions), EVIDENCE_LIMITS.output, reasons);
  if (!PUBLIC_EVIDENCE_TOOLS.has(tool)) reasons.add("STATUS_ONLY");
  return { input: safeInput, output: safeOutput, reasons: [...reasons], omissions };
}
export function recordCustomerToolEvidence(args: {
  tenantId: string; surface: string; tool: string; input: unknown; output: unknown;
  outcome: string; source: string; startedAt: string;
}): void {
  const turn = scope.getStore();
  if (!turn || args.surface !== "customer" || turn.tenantId !== args.tenantId || turn.finishedAt) return;
  turn.attemptedCalls++;
  try {
    const p = projectToolEvidence(args.tool, args.input, args.output);
    const bytes = Buffer.byteLength(JSON.stringify(p));
    if (turn.calls.length >= EVIDENCE_LIMITS.calls || turn.bytes + bytes > EVIDENCE_LIMITS.turn) {
      addReason(turn, "TURN_LIMIT"); return;
    }
    turn.bytes += bytes;
    turn.calls.push({ id: randomUUID(), sequence: turn.attemptedCalls, tool: /^[a-z_]{1,80}$/.test(args.tool) ? args.tool : "unknown",
      source: args.source, outcome: args.outcome, startedAt: args.startedAt, finishedAt: new Date().toISOString(),
      ...p, bytes, projectionVersion: EVIDENCE_VERSION });
    p.reasons.forEach(reason => addReason(turn, reason));
  } catch { addReason(turn, "PROJECTION_FAILED"); }
}
function addReason(turn: TurnEvidence, reason: string) {
  if (!turn.reasons.includes(reason)) turn.reasons.push(reason);
  turn.status = "PARTIAL";
}
export function noteEvidenceDependency(reason: string): void {
  const turn = scope.getStore();
  if (turn && !turn.finishedAt) addReason(turn, reason);
}
/** Replace the server prefetch snapshot with exactly the projection placed in model context. */
export function recordStorePrefetchProjection(facts: unknown): void {
  const turn = scope.getStore();
  const call = turn?.calls.at(-1);
  if (!turn || turn.finishedAt || call?.tool !== "get_store_info") return;
  const projected = projectToolEvidence("get_store_info", {}, facts);
  call.source = "MODEL_CONTEXT_PREFETCH";
  const nextBytes = Buffer.byteLength(JSON.stringify(projected));
  if (turn.bytes - call.bytes + nextBytes > EVIDENCE_LIMITS.turn) {
    call.output = { omitted: true }; call.reasons.push("TURN_LIMIT"); addReason(turn, "TURN_LIMIT");
    return;
  }
  turn.bytes += nextBytes - call.bytes;
  call.bytes = nextBytes;
  call.omissions = projected.omissions;
  call.output = projected.output;
  call.reasons = [...new Set([...call.reasons, ...projected.reasons])];
  projected.reasons.forEach(reason => addReason(turn, reason));
}
export function evidenceForQuality(quality: unknown): TurnEvidence | undefined {
  return quality && typeof quality === "object" ? evidenceByQuality.get(quality) : undefined;
}
export function recoverEvidenceQuality(error: unknown, quality: object): void {
  const turn = error && typeof error === "object" ? evidenceByError.get(error) : undefined;
  if (turn) evidenceByQuality.set(quality, turn);
}
export function fallbackEvidenceQuality(error: unknown): AiTurnQuality {
  const quality: AiTurnQuality = { outcome: "FAILURE", reasonCodes: ["PIPELINE_EXCEPTION"], successfulToolCalls: 0, failedToolCalls: 0 };
  recoverEvidenceQuality(error, quality);
  return quality;
}
export async function captureCustomerAnswer<T extends { reply: string; quality?: object; tool?: string }>(
  tenantId: string, channel: string, run: () => Promise<T>
): Promise<T> {
  const turn: TurnEvidence = { id: randomUUID(), tenantId, channel, startedAt: new Date().toISOString(),
    origin: "PIPELINE", status: "COMPLETE", reasons: [], calls: [], attemptedCalls: 0, bytes: 0, version: EVIDENCE_VERSION };
  return scope.run(turn, async () => {
    try {
      const result = await run();
      turn.finishedAt = new Date().toISOString();
      turn.replyHash = replyDigest(result.reply);
      turn.origin = result.tool?.startsWith("ai") ? "MODEL_WITH_GUARDS" : "DETERMINISTIC_OR_GUARDED";
      if (!turn.attemptedCalls) addReason(turn, "NO_TOOL_SOURCE_CAPTURED");
      if (result.quality) evidenceByQuality.set(result.quality, turn);
      return result;
    } catch (error) {
      turn.finishedAt = new Date().toISOString();
      turn.status = "PARTIAL"; turn.origin = "CHANNEL_FALLBACK";
      turn.reasons.push("PIPELINE_EXCEPTION");
      if (error && typeof error === "object") evidenceByError.set(error, turn);
      throw error;
    }
  });
}
