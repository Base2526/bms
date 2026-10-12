import "server-only";
import { query } from "@/lib/db";
import { requirePlatformAdmin } from "./platform";
import { audit } from "./audit";
import { normalizeAppDownloadSettings } from "./appDownloadValidation";

/** Platform-wide public links, never tenant configuration or credentials. */
export async function getAppDownloadSettings() {
  const result = await query<{ android_url: string; ios_url: string }>(
    `SELECT android_url, ios_url FROM bms_app_download_settings WHERE singleton = true`,
  );
  const row = result.rows[0];
  return normalizeAppDownloadSettings({ androidUrl: row?.android_url ?? "", iosUrl: row?.ios_url ?? "" });
}

export async function updateAppDownloadSettings(ctx: any, input: unknown) {
  await requirePlatformAdmin(ctx);
  const settings = normalizeAppDownloadSettings(input);
  await query(
    `INSERT INTO bms_app_download_settings (singleton, android_url, ios_url, updated_by)
     VALUES (true, $1, $2, $3)
     ON CONFLICT (singleton) DO UPDATE SET android_url = EXCLUDED.android_url,
       ios_url = EXCLUDED.ios_url, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [settings.androidUrl, settings.iosUrl, ctx.admin.id],
  );
  await audit(ctx, "platform.app_downloads.update", "homepage", {
    androidConfigured: Boolean(settings.androidUrl), iosConfigured: Boolean(settings.iosUrl),
  });
  return settings;
}
