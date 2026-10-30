import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { query } from "@/lib/db";
import { localBackupView } from "./localBackupView";
export async function getLocalBackup(tenantId: string) {
  const scope = await query(`SELECT tenant_id FROM bms_local_installation WHERE singleton = TRUE AND tenant_id = $1`, [tenantId]);
  if (!scope.rowCount) return null;
  try {
    const root = process.env.BMS_LOCAL_LICENSE_UI_DIR;
    if (!root || !path.isAbsolute(root)) return localBackupView(null);
    const file = path.join(root, "status/view.json");
    const info = await fs.lstat(file);
    if (!info.isFile() || info.size > 65536) return localBackupView(null);
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    if (raw.tenantId !== tenantId) return null;
    return localBackupView(raw);
  } catch { return localBackupView(null); }
}
