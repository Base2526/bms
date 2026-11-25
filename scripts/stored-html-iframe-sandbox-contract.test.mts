// =============================================================
// Stored HTML shown in an iframe is sandboxed.
// -------------------------------------------------------------
// A `srcDoc` iframe inherits the parent page's origin, and the app sets no CSP. /admin/mail-log
// rendered `bms_mail_log.html` (every outbound email, including the arbitrary HTML that
// bmsSendTestEmail stores verbatim and admin-editable templates) without `sandbox`, so a <script>
// in a logged email would run as the platform admin viewing the log. The report preview in
// ReportSubscriptionCard already used sandbox="". Found 2026-11-24 (frontend sweep).
// =============================================================
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

function walk(dir: URL): URL[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const child = new URL(name, dir);
    if (statSync(child).isDirectory()) return walk(new URL(`${name}/`, dir));
    return /\.tsx$/.test(name) ? [child] : [];
  });
}

test("every srcDoc iframe has an empty sandbox (no scripts, no same-origin)", () => {
  const files = [
    ...walk(new URL("../apps/web/app/", import.meta.url)),
    ...walk(new URL("../apps/web/components/", import.meta.url)),
  ];
  const unsandboxed: string[] = [];
  let iframes = 0;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<iframe\b[^>]*?>/gs)) {
      if (!/\bsrcDoc=/.test(match[0])) continue;
      iframes += 1;
      if (!/\bsandbox=(?:""|\{""\}|'')/.test(match[0])) {
        unsandboxed.push(`${decodeURIComponent(file.pathname.split("/apps/web/")[1])}`);
      }
    }
  }
  assert.ok(iframes >= 2, `expected the mail-log and report previews, found ${iframes}`);
  assert.deepEqual(unsandboxed, []);
});
