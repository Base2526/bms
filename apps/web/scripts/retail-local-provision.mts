import process from "node:process";

import { provisionRetailLocal } from "../lib/bms/localProvisioning";
import { closeDatabasePool } from "../lib/db";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const result = await provisionRetailLocal({
    shopName: required("BMS_LOCAL_SHOP_NAME"),
    slug: process.env.BMS_LOCAL_SHOP_SLUG?.trim() || "local-shop",
    adminName: required("BMS_LOCAL_ADMIN_NAME"),
    adminEmail: required("BMS_LOCAL_ADMIN_EMAIL"),
    adminPassword: required("BMS_LOCAL_ADMIN_PASSWORD"),
    adminPin: required("BMS_LOCAL_ADMIN_PIN"),
  });
  console.log(JSON.stringify(result));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDatabasePool().catch(() => undefined));
