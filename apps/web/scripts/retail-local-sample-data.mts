import process from "node:process";

import { query, closeDatabasePool } from "../lib/db";
import { createOnboardingSampleData } from "../lib/bms/onboardingSampleData";

async function main(): Promise<void> {
  const installation = await query<{ tenant_id: string }>(
    `SELECT tenant_id FROM bms_local_installation WHERE singleton = TRUE`
  );
  const tenantId = installation.rows[0]?.tenant_id;
  if (!tenantId) throw new Error("Retail Local installation is not provisioned");

  const result = await createOnboardingSampleData(tenantId);
  console.log(JSON.stringify({ ...result, requested: true }));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[BMS] optional sample data failed: ${message}`);
    // Sample data is optional. Return a machine-readable result without turning a usable shop,
    // checkout, pairing handoff, or installer into a failure.
    console.log(JSON.stringify({
      status: "FAILED",
      requested: true,
      message: "สร้างข้อมูลตัวอย่างยังไม่สำเร็จ สามารถลองใหม่จากหน้าเริ่มต้นใช้งาน",
    }));
  })
  .finally(() => closeDatabasePool().catch(() => undefined));
