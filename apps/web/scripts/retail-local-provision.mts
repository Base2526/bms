import process from "node:process";

import { provisionRetailLocal } from "../lib/bms/localProvisioning";
import { closeDatabasePool } from "../lib/db";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function booleanFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase() || "0";
  if (["1", "true", "yes"].includes(value)) return true;
  if (["0", "false", "no"].includes(value)) return false;
  throw new Error(`${name} must be 1 or 0`);
}

async function main(): Promise<void> {
  const createSampleData = booleanFlag("BMS_LOCAL_CREATE_SAMPLE_DATA");
  const result = await provisionRetailLocal({
    shopName: required("BMS_LOCAL_SHOP_NAME"),
    slug: process.env.BMS_LOCAL_SHOP_SLUG?.trim() || "local-shop",
    adminName: required("BMS_LOCAL_ADMIN_NAME"),
    adminEmail: required("BMS_LOCAL_ADMIN_EMAIL"),
    adminPassword: required("BMS_LOCAL_ADMIN_PASSWORD"),
    adminPin: required("BMS_LOCAL_ADMIN_PIN"),
    businessArchetype: required("BMS_LOCAL_BUSINESS_ARCHETYPE"),
  });
  // The installer checkpoints this result (including the one-time device token) before invoking
  // the optional sample-data service. Keeping these as two processes closes the power-loss window
  // where a long seed could finish after the shop committed but before the token reached the host.
  console.log(JSON.stringify({
    ...result,
    sampleData: createSampleData
      ? { requested: true, status: "PENDING" }
      : { requested: false, status: "SKIPPED" },
  }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDatabasePool().catch(() => undefined));
