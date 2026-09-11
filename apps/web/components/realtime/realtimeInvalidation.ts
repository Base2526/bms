import type { DocumentNode } from "@apollo/client";

import type { RealtimeEventType } from "../../../../packages/realtime/src/events";

const COMMON_DASHBOARD_FIELDS = ["bmsDashboard", "bmsActionCenter", "bmsExecutive", "bmsToday"] as const;

/**
 * Which root query fields a domain's events invalidate.
 *
 * Exported because the set of keys is a contract with the event union: an event whose
 * domain is missing here matches no rule and therefore refetches nothing, which reads on
 * screen exactly like realtime being switched off. `kitchen` was that hole — the retail
 * queue from 9.40 got its events in 9.72 while this map still only knew `restaurant`, so a
 * food_beverage shop with KITCHEN_WORKFLOW watched a board that never refreshed itself.
 *
 * ⚠️ Nothing compares these keys to the event union yet. `realtime-client-contract` checks
 * the prefix-match rule, not coverage, so the 18th domain can go missing exactly the way
 * `kitchen` did. Adding an event type means checking this map by hand until that test exists.
 */
export const DOMAIN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  restaurant: ["bmsRestaurant", "bmsKitchen", "bmsPosRestaurant", "bmsOrders", ...COMMON_DASHBOARD_FIELDS],
  // ตั๋วครัวของร้านค้าปลีก (9.40/9.72) — กระดานเดียวกับร้านอาหาร แต่ไม่ได้แตะโต๊ะหรือบิล
  kitchen: ["bmsKitchen"],
  order: ["bmsOrder", "bmsOrders", "bmsCustomers", ...COMMON_DASHBOARD_FIELDS],
  payment: ["bmsPayment", "bmsPayments", "bmsOrders", ...COMMON_DASHBOARD_FIELDS],
  inventory: ["bmsProduct", "bmsProducts", "bmsInventory", "bmsStock", "bmsVariantReservations", ...COMMON_DASHBOARD_FIELDS],
  purchase: ["bmsPurchase", "bmsProducts", "bmsInventory", ...COMMON_DASHBOARD_FIELDS],
  product: ["bmsProduct", "bmsProducts", "bmsInventory", "bmsRestaurant"],
  menu: ["bmsProduct", "bmsProducts", "bmsRestaurant", "bmsKitchen"],
  inbox: ["bmsInbox", "bmsConversation", "bmsConversations"],
  shipment: ["bmsShipment", "bmsShipments", "bmsOrders", ...COMMON_DASHBOARD_FIELDS],
  pharmacy: ["bmsPharmacy", "pharmacy"],
  notification: ["notifications", "notification", "unreadNotification"],
  dashboard: COMMON_DASHBOARD_FIELDS,
  pos: ["bmsPos", "bmsOrders", "bmsProducts", ...COMMON_DASHBOARD_FIELDS],
  shift: ["bmsPos", "bmsShift"],
  device: ["bmsPos", "bmsDevice"],
  waitlist: ["bmsRestaurant", "bmsWaitlist"],
};

function rootQueryFields(document: DocumentNode): string[] {
  const result: string[] = [];
  for (const definition of document.definitions) {
    if (definition.kind !== "OperationDefinition" || definition.operation !== "query") continue;
    for (const selection of definition.selectionSet.selections) {
      if (selection.kind === "Field") result.push(selection.name.value);
    }
  }
  return result;
}

export function queryNeedsRealtimeRefetch(document: DocumentNode, eventType: RealtimeEventType): boolean {
  const domain = eventType.split(".", 1)[0];
  const rules = DOMAIN_FIELDS[domain] ?? [];
  return rootQueryFields(document).some((field) => rules.some((prefix) => field.startsWith(prefix)));
}
