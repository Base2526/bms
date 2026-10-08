/** Same authenticated endpoint for Cloud and Retail Local. No database or business-rule fork. */
export async function runEvidenceRetention(baseUrl, secret, fetcher = fetch) {
  if (!secret) throw new Error("Evidence retention requires BMS_CRON_SECRET");
  let cursor = null;
  for (let page = 0; page < 100; page++) {
    const url = new URL("/api/bms/ai/evidence/purge-expired", baseUrl);
    if (cursor) url.searchParams.set("afterTenant", cursor);
    const response = await fetcher(url, { method: "POST", headers: { "x-cron-secret": secret }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Evidence retention HTTP ${response.status}`);
    const result = await response.json();
    cursor = result.nextTenant;
    if (!cursor) return;
  }
  throw new Error("Evidence retention exceeded bounded fleet pages");
}

export function startLocalEvidenceRetention(port) {
  if (process.env.BMS_DEPLOYMENT_MODE !== "retail-local") return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runEvidenceRetention(`http://127.0.0.1:${port}`, process.env.BMS_CRON_SECRET); }
    catch (error) { console.error("[evidence-retention]", error.message); }
    finally { running = false; }
  };
  // Run after startup and every six hours, including shops with no customer traffic.
  setTimeout(run, 60000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
