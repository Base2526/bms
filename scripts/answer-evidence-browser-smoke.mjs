import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://localhost:3007";
const output = ".test-output/answer-evidence-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["th", "en"]) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-browser-fixture", url: base }, { name: "lang", value: lang, url: base }]);
    const errors = [], mutations = [];
    await context.route(/\/(?:api\/|graphql)/, async route => {
      const path = new URL(route.request().url()).pathname;
      let json = {};
      if (path === "/api/auth/me") json = { isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "FAKE", language: lang } };
      else if (path === "/api/graphql" || path === "/graphql") {
        const { query: q, variables: v = {} } = route.request().postDataJSON();
        let data = {};
        if (/\bmutation\b/.test(q)) mutations.push(q);
        if (q.includes("MyBmsPermissions")) data = { myBmsPermissions: ["ai_quality.view"] };
        else if (q.includes("AnswerEvidenceCoverage")) data = { bmsAiAnswerEvidenceCoverage: { total: 6, complete: 1, partial: 2, failed: 1, not_captured: 2 } };
        else if (q.includes("AnswerEvidence(")) {
          const status = ({ "2": "PARTIAL", "3": "FAILED", "4": "EXPIRED", "5": "NOT_CAPTURED", "6": "COMPLETE" })[v.messageId];
          data = { bmsAiAnswerEvidence: { messageId: v.messageId, inputMessageId: "1", question: "FAKE มีโต๊ะชั้นไหนบ้าง", reply: "FAKE ชั้น 2 โต๊ะ 6 คน ว่าง 2 โต๊ะ",
            status, reasons: status === "PARTIAL" ? ["FIELDS_OMITTED"] : [], replyMatches: true,
            turn: { origin: "MODEL_WITH_GUARDS", captured_calls: 1, attempted_calls: 1 },
            calls: status === "EXPIRED" || status === "NOT_CAPTURED" ? [] : [{ sequence: 1, call_id: "FAKE-call", tool: "get_restaurant_availability", outcome: "ok",
              source: "MODEL_SELECTED", projection_version: 1, started_at: "2026-10-08T12:00:00Z", finished_at: "2026-10-08T12:00:01Z",
              safe_input: { branch: "FAKE" }, safe_output: { tableDetails: [{ area: "ชั้น 2", seats: 6, availableTables: 2 }], details: "FAKE-long-".repeat(80) }, reasons: [] }] } };
        } else if (q.includes("AiQuality(")) data = {
          bmsAiQualityMetrics: { days: 30, totalTurns: 6, successCount: 3, clarificationCount: 0, handoffCount: 1, unresolvedCount: 2,
            successRate: .5, handoffRate: .16, unresolvedRate: .33, pendingReviews: 0, reviewedCount: 0, humanFailCount: 0, daily: [] }, bmsAiQualityCases: [],
        };
        json = { data };
      }
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/admin/ai-quality`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const input = page.getByPlaceholder(lang === "th" ? "รหัสข้อความ AI (รวมคำตอบที่ไม่ได้สุ่มตรวจ)" : "AI message ID (including non-sampled replies)");
    try { await input.fill("2"); } catch (error) {
      console.log(await page.locator("body").innerText(), errors);
      await page.screenshot({ path: `${output}/failure-${lang}-${width}.png`, fullPage: true });
      throw error;
    }
    await input.press("Enter");
    await page.getByText("FAKE มีโต๊ะชั้นไหนบ้าง", { exact: true }).waitFor();
    await page.getByText("1. get_restaurant_availability · ok", { exact: true }).click();
    await page.getByText(/"availableTables": 2/).waitFor();
    await page.waitForFunction(() => {
      const content = document.querySelector(".ant-collapse-content-active");
      return content && content.getBoundingClientRect().height > 200;
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false, "no page overflow");
    await page.screenshot({ path: `${output}/${lang}-${width}.png`, fullPage: true });
    for (const id of ["3", "4", "5", "6"]) {
      await input.fill(id); await input.press("Enter");
      await page.getByText(`${lang === "th" ? "หลักฐานคำตอบ" : "Answer evidence"} · #${id}`, { exact: true }).waitFor();
    }
    assert.equal(mutations.length, 0); assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS actual AI Quality route: th/en, desktop/mobile, non-sampled lookup, timeline, capture states, no overflow, no mutation");
} finally { await browser.close(); }
