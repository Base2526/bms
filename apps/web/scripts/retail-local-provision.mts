import process from "node:process";

import { provisionRetailLocal } from "../lib/bms/localProvisioning";
import { DEFAULT_SHOP_ARCHETYPE } from "../lib/bms/shopArchetypes";
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
    businessArchetype: process.env.BMS_LOCAL_BUSINESS_ARCHETYPE?.trim() || DEFAULT_SHOP_ARCHETYPE,
  });
  // The installer checkpoints this result (including the one-time device token) before invoking
  // the optional sample-data service. Keeping these as two processes closes the power-loss window
  // where a long seed could finish after the shop committed but before the token reached the host.
  console.log(JSON.stringify({
    ...result,
    sampleData: sampleMode === "STARTER_CATALOG" && result.status === "PROVISIONED"
      ? { requested: true, mode: sampleMode, status: "PENDING" }
      : { requested: sampleMode === "STARTER_CATALOG", mode: sampleMode, status: "SKIPPED" },
  }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDatabasePool().catch(() => undefined));
