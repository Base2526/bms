import type { CustomerAssistantMode } from "./tools/types";

/** Only the platform-configured tenant AND Page may represent BMS itself. */
export function facebookAssistantMode(tenantId: string, pageId: string): CustomerAssistantMode {
  const ownerTenant = process.env.BMS_FACEBOOK_PRESALES_TENANT_ID?.trim();
  const ownerPage = process.env.BMS_FACEBOOK_PRESALES_PAGE_ID?.trim();
  if (!ownerTenant || !ownerPage || !/^\d{5,32}$/.test(ownerPage)) return "shop_commerce";
  return tenantId === ownerTenant && pageId === ownerPage ? "bms_presales" : "shop_commerce";
}
