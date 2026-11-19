// Read-only target check. Exit 1: pickup templates missing; exit 2: unable to inspect.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeDbTarget, loadDbEnvFromFiles } from "./dbEnv.mts";
import { REQUIRED_PICKUP_EMAIL_TEMPLATES, missingPickupEmailTemplates } from "./orderEmailReadiness.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFileUsed = loadDbEnvFromFiles(root);
console.log(describeDbTarget(envFileUsed));

try {
  // Resolve env before loading the application's connection pool.
  const { query } = await import("../apps/web/lib/db.ts");
  const keys = [...new Set(REQUIRED_PICKUP_EMAIL_TEMPLATES.map(({ key }) => key))];
  const result = await query<{ key: string; locale: string; version: number; subject_tpl: string; html_tpl: string }>(
    `SELECT key, locale, version, subject_tpl, html_tpl FROM email_templates
      WHERE key = ANY($1::text[]) AND locale IN ('th', 'en')
        AND is_active = true AND is_published = true`,
    [keys],
  );
  const missing = missingPickupEmailTemplates(result.rows);
  if (missing.length) {
    console.log(`BLOCK pickup email templates missing, inactive or empty: ${missing.join(", ")}`);
    console.log("Apply db/migrations/10.114__bms_pickup_status_email_templates.sql or publish active replacements.");
    process.exit(1);
  }
  console.log("ok    Published pickup status email templates available in Thai and English");
  process.exit(0);
} catch (error: any) {
  console.log(`?     Cannot inspect pickup email templates (code ${String(error?.code ?? "unknown")})`);
  process.exit(2);
}
