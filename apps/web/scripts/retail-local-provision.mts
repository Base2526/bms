import process from "node:process";

import { provisionRetailLocal } from "../lib/bms/localProvisioning";
import { createStarterCatalog } from "../lib/bms/sampleData";
import { closeDatabasePool } from "../lib/db";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const sampleMode = process.env.BMS_LOCAL_SAMPLE_MODE?.trim() || "NONE";
  if (!["NONE", "STARTER_CATALOG"].includes(sampleMode)) {
    throw new Error("BMS_LOCAL_SAMPLE_MODE must be NONE or STARTER_CATALOG");
  }
  const result = await provisionRetailLocal({
    shopName: required("BMS_LOCAL_SHOP_NAME"),
    slug: process.env.BMS_LOCAL_SHOP_SLUG?.trim() || "local-shop",
    adminName: required("BMS_LOCAL_ADMIN_NAME"),
    adminEmail: required("BMS_LOCAL_ADMIN_EMAIL"),
    adminPassword: required("BMS_LOCAL_ADMIN_PASSWORD"),
    adminPin: required("BMS_LOCAL_ADMIN_PIN"),
    businessArchetype: process.env.BMS_LOCAL_BUSINESS_ARCHETYPE?.trim() || "mini_mart",
  });
  let sample: Record<string, unknown> = { status: "SKIPPED", mode: sampleMode };
  if (result.status === "PROVISIONED" && sampleMode === "STARTER_CATALOG") {
    try {
      const created = await createStarterCatalog(result.tenantId, result.adminUserId);
      sample = {
        status: created.status,
        mode: created.mode,
        runId: created.id,
        products: created.products.length,
      };
    } catch (error) {
      // Core provisioning is already committed and must remain usable if optional
      // examples fail. The installer surfaces the failure and Admin can retry.
      sample = {
        status: "FAILED",
        mode: sampleMode,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  console.log(JSON.stringify({ ...result, sample }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDatabasePool().catch(() => undefined));
