// Local synthetic Playground fixture. All API calls are intercepted; no AI/provider or customer write.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium, firefox } = await import(process.env.BMS_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
await mkdir(".test-output/playground-denial-browser", { recursive: true });

for (const browserType of [chromium, firefox]) {
  const browser = await browserType.launch({ headless: true,
    ...(browserType === chromium ? { channel: "chrome" } : {}) });
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
      await context.addCookies([{ name: "ADMIN_COOKIE", value: "FAKE-playground", url: base },
        { name: "lang", value: "th", url: base }]);
      await context.routeWebSocket("**/*", socket => socket.close());
      let deniedCalls = 0, allowedCalls = 0, oversizedCalls = 0, responseStatus = 403;
      await context.route("**/*", route => {
        const request = route.request(), url = new URL(request.url());
        const isApi = /\/api\/|\/graphql$/.test(url.pathname);
        if (!isApi) return url.origin === new URL(base).origin ? route.continue() : route.abort();
        if (url.pathname === "/api/auth/me") return route.fulfill({ json: {
          isAuthenticated: true, admin: { id: "FAKE-admin", role: "Administrator", name: "FAKE" },
        } });
        if (url.pathname === "/api/bms/chat") {
          assert.equal(request.method(), "POST");
          if (responseStatus === 403) {
            deniedCalls += 1;
            return route.fulfill({ status: 403, json: { error: "forbidden" } });
          }
          if (responseStatus === 413) {
            oversizedCalls += 1;
            return route.fulfill({ status: 413, json: { error: "CHAT_INPUT_TOO_LARGE" } });
          }
          allowedCalls += 1;
          return route.fulfill({ json: { reply: "FAKE verified reply", trace: [] } });
        }
        if (url.pathname === "/api/graphql") {
          const query = request.postDataJSON()?.query || "";
          assert.doesNotMatch(query, /\bmutation\b/i);
          return route.fulfill({ json: { data: {
            myBmsPermissions: ["ai_quality.view", "product.view"],
            bmsProducts: { total: 0, items: [] },
          } } });
        }
        return route.fulfill({ json: {} });
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${base}/admin/playground`);
      await page.getByPlaceholder('เช่น "สั่ง Nike XL 2 ชิ้น"').fill("FAKE question");
      await page.locator(".ant-space-compact button").last().click();
      await page.getByText("บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้", { exact: false }).waitFor();
      assert.equal(deniedCalls, 1);
      assert.equal(await page.getByText("(ไม่มีคำตอบ)").count(), 0);
      responseStatus = 413;
      await page.getByPlaceholder('เช่น "สั่ง Nike XL 2 ชิ้น"').fill("FAKE oversized question");
      await page.locator(".ant-space-compact button").last().click();
      await page.getByText("ข้อความหรือข้อมูลประกอบมีขนาดใหญ่เกินกำหนด", { exact: false }).waitFor();
      assert.equal(oversizedCalls, 1);
      responseStatus = 200;
      await page.getByPlaceholder('เช่น "สั่ง Nike XL 2 ชิ้น"').fill("FAKE follow-up");
      await page.locator(".ant-space-compact button").last().click();
      await page.getByText("FAKE verified reply").waitFor();
      assert.equal(allowedCalls, 1);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `.test-output/playground-denial-browser/${browserType.name()}-${width}.png` });
      console.log(`${browserType.name()} ${width}px: denial and oversized messages shown; verified reply renders on next request`);
      await context.close();
    }
  } finally { await browser.close(); }
}
