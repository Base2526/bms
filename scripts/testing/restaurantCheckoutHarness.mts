import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");

/** Execute the whole production service, replacing only its imported dependencies. */
export function loadService(file: string, dependencies: Record<string, unknown>, allowUnused = false): any {
  const source = readFileSync(new URL(`../../apps/web/lib/bms/${file}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", compiled)((id: string) => {
    if (id in dependencies) return dependencies[id];
    if (allowUnused) return {};
    throw new Error(`Unexpected dependency: ${id}`);
  }, exports);
  return exports;
}

export function checkoutFixture(options: {
  type?: string | null; missing?: string[]; channel?: string; invalidToken?: boolean;
} = {}) {
  const calls: string[] = [];
  const missing = options.missing ?? ["shippingAddress"];
  const channel = options.channel ?? "line";
  const service = loadService("checkout", {
    "@/lib/db": { query: async (sql: string, values: unknown[]) => {
      assertScope(values);
      calls.push(sql);
      if (sql.includes("FROM bms_orders o")) return { rows: [{
        id: "order", customer_id: "customer", customer_ref: "ref", channel,
        status: "PENDING", created_at: "2026-10-22", customer_name: "FAKE Guest",
        customer_phone: "0000000000", fulfillment_type: options.type ?? null, location_name: "FAKE Branch",
      }] };
      if (sql.includes("bms_customer_addresses")) return { rows: [{
        id: "address", address: "FAKE private address", label: null, is_default: true,
      }] };
      return { rows: [] };
    } },
    "./customers": { getCustomerCheckoutStatus: async () => ({
      hasRecipientName: !missing.includes("recipientName"), hasPhone: !missing.includes("phone"), missingFields: missing,
    }) },
    "./documents": { generateInvoice: async () => ({
      store: { name: "FAKE Cafe" }, number: "FAKE-1", subtotal: 100, discount: 0, shippingFee: 0, total: 100,
      couponCode: null, lines: [{ sku: "FAKE-COFFEE", name: "Coffee", size: "M", qty: 1, unitPrice: 100, amount: 100 }],
    }) },
    "./orders": {},
    "./paymentConfiguration": { configuredPaymentAccounts: (accounts: unknown) => accounts, supportsCustomerPaymentMethod: () => true },
    "./payments": { submitPaymentOnce: async (input: any) => {
      if (input.tenantId !== "tenant" || input.orderId !== "order" || input.amount !== null) throw new Error("Untrusted payment scope");
      calls.push("payment:PENDING");
      return { status: "SUBMITTED", paymentId: "payment", amount: 100 };
    } },
    "./storeProfile": { getStoreProfile: async () => ({ paymentAccounts: [{ type: "BANK", accountNo: "FAKE-ACCOUNT" }] }) },
    "./checkoutToken": {
      verifyCheckoutToken: () => options.invalidToken ? null : ({ tenantId: "tenant", orderId: "order" }),
      createCheckoutToken: () => "FAKE-signed-token",
    },
  });
  return { service, calls };
}
function assertScope(values: unknown[]) {
  if (values[0] !== "tenant") throw new Error("Missing signed tenant scope");
}
