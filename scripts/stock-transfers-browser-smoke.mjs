import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(
  process.env.BMS_PLAYWRIGHT_MODULE || "playwright"
);
const base = process.env.BMS_SMOKE_URL || "http://127.0.0.1:3107";
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(base).hostname),
  "Local fixtures only"
);
const output = ".test-output/stock-transfers-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      serviceWorkers: "block",
    });
    await context.addCookies([
      { name: "ADMIN_COOKIE", value: "FAKE-ui", url: base },
      { name: "lang", value: "th", url: base },
    ]);
    await context.routeWebSocket("**/*", (socket) =>
      socket.onMessage((raw) => {
        if (JSON.parse(String(raw)).type === "connection_init")
          socket.send(JSON.stringify({ type: "connection_ack" }));
      })
    );
    const source = "00000000-0000-4000-8000-000000000001",
      dest = "00000000-0000-4000-8000-000000000002";
    const locations = [
      { id: source, code: "SRC", name: "FAKE Central", active: true },
      { id: dest, code: "DST", name: "FAKE Branch", active: true },
    ];
    let allowed = locations,
      deny = false,
      lose = false,
      malformed = false,
      failReads = false;
    let commandScope = "FAKE-tenant:FAKE-user",
      holdNextRead = false,
      releaseRead;
    await context.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (
          window.failTransferStorage &&
          key.startsWith("bms:stock-transfer:pending:")
        )
          throw new DOMException("FAKE blocked storage", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    let rows = [];
    const commands = [],
      saved = new Map();
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (
        url.origin !== new URL(base).origin &&
        !url.pathname.endsWith("/graphql")
      )
        return route.abort();
      if (!/\/api\/|\/graphql$/.test(url.pathname)) return route.continue();
      if (url.pathname === "/api/bms/realtime/ticket")
        return route.fulfill({ json: { ticket: "FAKE-local-ui-ticket" } });
      if (url.pathname === "/api/auth/me")
        return route.fulfill({
          json: {
            isAuthenticated: true,
            admin: {
              id: "FAKE",
              role: "Administrator",
              name: "FAKE Manager",
              language: "th",
            },
          },
        });
      if (url.pathname.endsWith("/graphql")) {
        const q = req.postDataJSON()?.query ?? "";
        return route.fulfill({
          json: {
            data: q.includes("MyBmsPermissions")
              ? { myBmsPermissions: deny ? [] : ["inventory.transfer"] }
              : {},
          },
        });
      }
      if (url.pathname !== "/api/bms/inventory/transfers")
        return route.fulfill({ json: {} });
      if (req.method() === "GET") {
        if (holdNextRead) {
          holdNextRead = false;
          await new Promise((resolve) => {
            releaseRead = resolve;
          });
          return route.fulfill({
            json: {
              transfers: [],
              locations,
              commandScope: "FAKE-stale-scope",
            },
          });
        }
        return route.fulfill(
          failReads
            ? { status: 503, json: { error: "FAKE refresh failure" } }
            : {
                json: {
                  transfers: rows,
                  locations: allowed,
                  commandScope,
                },
              }
        );
      }
      const command = req.postDataJSON();
      commands.push(command);
      assert.ok(command.idempotencyKey.length >= 8);
      if (command.commandScope !== commandScope)
        return route.fulfill({
          status: 409,
          json: {
            status: "SCOPE_CHANGED",
            reason: "ผู้ใช้หรือร้านเปลี่ยนไป กรุณารีเฟรชก่อนตรวจผลคำขอเดิม",
          },
        });
      let result = saved.get(command.idempotencyKey);
      if (!result) {
        if (command.action === "create") {
          const id = crypto.randomUUID();
          rows.push({
            id,
            transferNo: `FAKE-TRF-${rows.length + 1}`,
            fromLocationId: source,
            toLocationId: dest,
            fromLocationName: "FAKE Central",
            toLocationName: "FAKE Branch",
            status: "DRAFT",
            note: command.note,
            receivingNote: null,
            createdByName: "FAKE Manager",
            createdAt: "2026-10-26T10:00:00Z",
            sentAt: null,
            receivedAt: null,
            items: command.items.map((i, n) => ({
              ...i,
              id: n + 1,
              productName: "FAKE goods",
              receivedQty: null,
              damagedQty: 0,
              missingQty: null,
            })),
          });
          result = {
            status: "CREATED",
            transferId: id,
            transferNo: rows.at(-1).transferNo,
          };
        } else {
          const row = rows.find((r) => r.id === command.transferId);
          assert.ok(row);
          row.status = {
            send: "IN_TRANSIT",
            receive: "RECEIVED",
            cancel: "CANCELLED",
          }[command.action];
          result = { status: "OK" };
        }
        saved.set(command.idempotencyKey, result);
      }
      if (lose) {
        lose = false;
        return route.abort("connectionreset");
      }
      if (malformed) {
        malformed = false;
        return route.fulfill({ status: 200, body: "not-json" });
      }
      return route.fulfill({ json: result });
    });
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (dialog) => dialog.accept());
    const select = async (label, value) => {
      await page.getByLabel(label, { exact: true }).click();
      await page
        .locator(".ant-select-item-option:visible")
        .filter({ hasText: value })
        .last()
        .click();
    };
    const retry = () =>
      page.getByRole("button", { name: "ตรวจผลคำขอเดิม", exact: true });
    const open = () =>
      page.goto(`${base}/admin/stock-transfers`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
    try {
      assert.equal((await open()).status(), 200);
      const createButton = page.getByRole("button", { name: /สร้างใบโอน$/ });
      await createButton.waitFor();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("สร้างใบโอน")
          )?.disabled
      );
      holdNextRead = true;
      const heldRequest = page.waitForRequest(
        (r) =>
          r.method() === "GET" &&
          r.url().includes("/api/bms/inventory/transfers")
      );
      await page.getByRole("button", { name: /รีเฟรช$/ }).click();
      await heldRequest;
      await createButton.click();
      await select("สาขาต้นทาง", "FAKE Central");
      await select("สาขาปลายทาง", "FAKE Branch");
      await page.getByPlaceholder("SKU", { exact: true }).fill("FAKE-BOX");
      await page.getByPlaceholder("ไซซ์", { exact: true }).fill("BASE");
      await page.getByPlaceholder("จำนวน", { exact: true }).fill("2");
      await page.getByText("รายการที่โอน", { exact: true }).click();
      await page.screenshot({
        path: `${output}/${width}-create.png`,
        fullPage: true,
        animations: "disabled",
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        ),
        "create modal must fit mobile viewport"
      );
      await page.evaluate(() => {
        window.failTransferStorage = true;
      });
      await page
        .getByRole("button", { name: "สร้าง (ยังไม่ตัดสต็อก)", exact: true })
        .click();
      await page
        .getByText(
          "เบราว์เซอร์เก็บคำขอไม่ได้ จึงยังไม่ส่งรายการ กรุณาตรวจการตั้งค่าพื้นที่จัดเก็บ",
          { exact: true }
        )
        .waitFor();
      assert.equal(
        commands.length,
        0,
        "storage failure must send nothing and preserve the form"
      );
      assert.equal(
        await page.getByPlaceholder("SKU", { exact: true }).inputValue(),
        "FAKE-BOX"
      );
      await page.evaluate(() => {
        window.failTransferStorage = false;
      });
      lose = true;
      await page
        .getByRole("button", { name: "สร้าง (ยังไม่ตัดสต็อก)", exact: true })
        .click();
      await retry().waitFor();
      assert.equal(await createButton.isDisabled(), true);
      assert.equal(commands.length, 1);
      const original = structuredClone(commands[0]);
      const staleResponse = page.waitForResponse(
        (r) =>
          r.request().method() === "GET" &&
          r.url().includes("/api/bms/inventory/transfers")
      );
      releaseRead();
      await staleResponse;
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(
        await retry().count(),
        1,
        "old GET must not replace pending command scope"
      );
      commandScope = "FAKE-tenant:FAKE-other-user";
      await retry().click();
      await page
        .getByText("ผู้ใช้หรือร้านเปลี่ยนไป กรุณารีเฟรชก่อนตรวจผลคำขอเดิม", {
          exact: true,
        })
        .waitFor();
      assert.equal(await retry().isDisabled(), true);
      await page.getByRole("button", { name: /รีเฟรช$/ }).click();
      await retry().waitFor({ state: "hidden" });
      assert.equal(
        await page.evaluate(
          () =>
            !!sessionStorage.getItem(
              "bms:stock-transfer:pending:FAKE-tenant:FAKE-user"
            )
        ),
        true
      );
      commandScope = "FAKE-tenant:FAKE-user";
      await page.reload({ waitUntil: "domcontentloaded" });
      await retry().click();
      await page
        .getByText("ยืนยันแล้วว่าคำขอเดิมสำเร็จ", { exact: true })
        .waitFor();
      assert.deepEqual(
        commands.at(-1),
        original,
        "reload retry must preserve payload/key"
      );
      assert.equal(rows.length, 1);
      await page.getByText("FAKE-TRF-1", { exact: true }).waitFor();
      allowed = [locations[1]];
      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .getByText("คุณเข้าถึงสาขาที่เปิดใช้งานได้ไม่ถึง 2 สาขา", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: "ส่งของ", exact: true }).count(),
        0
      );
      assert.equal(
        await page.getByRole("button", { name: "ยกเลิก", exact: true }).count(),
        0
      );
      allowed = [locations[0]];
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "ส่งของ", exact: true }).click();
      lose = true;
      await page.getByRole("button", { name: "ส่ง", exact: true }).click();
      await retry().waitFor();
      const sent = structuredClone(commands.at(-1));
      await retry().click();
      await page.getByText("อยู่ระหว่างทาง", { exact: true }).last().waitFor();
      assert.deepEqual(commands.at(-1), sent);
      assert.equal(
        await page.getByRole("button", { name: "รับของ", exact: true }).count(),
        0,
        "source cannot receive"
      );
      allowed = [locations[1]];
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "รับของ", exact: true }).click();
      await page.getByText("นับของจริงก่อนกดยืนยัน", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "ยืนยันรับของ", exact: true })
        .click({ trial: true });
      await page.getByRole("dialog").evaluate(async (element) => {
        await Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => {}))
        );
      });
      await page.getByRole("dialog").screenshot({
        path: `${output}/${width}-receive.png`,
      });
      malformed = true;
      await page
        .getByRole("button", { name: "ยืนยันรับของ", exact: true })
        .click();
      await retry().waitFor();
      const received = structuredClone(commands.at(-1));
      failReads = true;
      await retry().click();
      await page.getByText("โหลดรายการไม่สำเร็จ", { exact: true }).waitFor();
      assert.deepEqual(commands.at(-1), received);
      assert.equal(
        await retry().count(),
        0,
        "known success stays resolved when refresh fails"
      );
      failReads = false;
      allowed = locations;
      await page.getByRole("button", { name: /รีเฟรช$/ }).click();
      await page.getByText("รับแล้ว", { exact: true }).last().waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        ),
        "list must fit viewport"
      );
      await page.screenshot({
        path: `${output}/${width}-complete.png`,
        fullPage: true,
      });
      deny = true;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .getByText("ไม่มีสิทธิ์ดูหน้านี้ (ต้องมี inventory.transfer)", {
          exact: true,
        })
        .waitFor();
      deny = false;
      assert.equal(
        (
          await page.goto(`${base}/admin/manual`, {
            waitUntil: "domcontentloaded",
          })
        ).status(),
        200
      );
      await page
        .getByRole("link", { name: "Stock Transfers", exact: true })
        .first()
        .waitFor();
      await page
        .getByText(/โอนแบบส่งออก\/รับเข้า 2 ขั้น สร้างต้องมีสิทธิ์ทั้งสองสาขา/)
        .waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        ),
        "manual must fit viewport"
      );
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${width}: scoped actions, create/send/receive retries, reload persistence, malformed response, success + refresh failure, permission denial`
      );
    } catch (error) {
      await page.screenshot({
        path: `${output}/${width}-failure.png`,
        fullPage: true,
      });
      console.error((await page.locator("body").innerText()).slice(-5000));
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
