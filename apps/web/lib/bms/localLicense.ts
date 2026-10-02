import "server-only";
import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { getClient, query } from "@/lib/db";
import { isRetailLocalDeployment } from "./deploymentMode";
import { sanitizeLocalLicenseView } from "./localLicenseView";
import { audit } from "./audit";
import type { AdminRouteCtx } from "./adminRouteAuth";

export class LocalLicenseError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function localShop(tenantId: string) {
  if (!isRetailLocalDeployment()) throw new LocalLicenseError("not_found", 404);
  const result = await query(`SELECT tenant_id FROM bms_local_installation WHERE singleton = TRUE AND tenant_id = $1`, [tenantId]);
  if (!result.rows.length) throw new LocalLicenseError("not_found", 404);
}
function uiRoot() {
  const root = process.env.BMS_LOCAL_LICENSE_UI_DIR;
  if (!root || !path.isAbsolute(root)) throw new LocalLicenseError("runtime_unavailable", 503);
  return root;
}
async function readJSON(file: string): Promise<Record<string, unknown>> {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.size > 65536) throw new LocalLicenseError("invalid_runtime_status", 503);
  return JSON.parse(await fs.readFile(file, "utf8"));
}
async function readStatus(tenantId: string) {
  try {
    const raw = await readJSON(path.join(uiRoot(), "status/view.json"));
    if (raw.tenantId !== tenantId) throw new LocalLicenseError("not_found", 404);
    return sanitizeLocalLicenseView(raw);
  } catch (error) {
    if (error instanceof LocalLicenseError && error.status === 404) throw error;
    return sanitizeLocalLicenseView(null);
  }
}
export async function getLocalLicense(tenantId: string) {
  await localShop(tenantId);
  return readLocalLicense(tenantId);
}
async function readLocalLicense(tenantId: string) {
  const view = await readStatus(tenantId);
  try {
    const request = await readJSON(path.join(uiRoot(), "requests/activation.json"));
    if (request.tenantId === tenantId && typeof request.requestId === "string" && request.requestId !== view.requestId) {
      view.requestId = request.requestId; view.requestStatus = "PENDING";
    }
  } catch { /* An empty mailbox is normal before the first request. */ }
  return view;
}
export async function requestLocalLicenseActivation(ctx: AdminRouteCtx, value: unknown) {
  const tenantId = ctx.admin.tenant_id;
  await localShop(tenantId);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LocalLicenseError("invalid_json", 400);
  const input = value as Record<string, unknown>;
  if (input.confirmation !== "REGISTER-LOCAL-LICENSE") throw new LocalLicenseError("confirmation_required", 400);
  const code = typeof input.activationCode === "string" ? input.activationCode.trim() : "";
  if (!/^bmsla_[A-Za-z0-9_-]{43}$/.test(code)) throw new LocalLicenseError("activation_code_invalid", 400);
  const id = typeof input.requestId === "string" ? input.requestId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new LocalLicenseError("request_id_invalid", 400);
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('bms-local-license-ui'))");
    const view = await readLocalLicense(tenantId);
    if (view.requestId === id) { await client.query("COMMIT"); return { requestId: id }; }
    if (!view.available) throw new LocalLicenseError("runtime_unavailable", 503);
    if (view.requestStatus === "PENDING") throw new LocalLicenseError("activation_in_progress", 409);
    const destination = path.join(uiRoot(), "requests/activation.json");
    const temporary = destination + "." + crypto.randomUUID() + ".tmp";
    try {
      const file = await fs.open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify({ requestId: id, tenantId, activationCode: code, createdAt: new Date().toISOString() }));
        await file.sync();
      } finally { await file.close(); }
      await fs.rename(temporary, destination);
    } finally { await fs.unlink(temporary).catch(() => undefined); }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
  await audit(ctx, "retail_local.license_activation_requested", id);
  return { requestId: id };
}
