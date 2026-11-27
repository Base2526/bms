// Real native main + local FAKE HTTP server. Isolated OS data directory; no BMS DB.
import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const token = "a".repeat(43);
const credential = `bmsk_${"b".repeat(43)}`;
let revoked = false;
let urlGone = false;
let failNextStatus = false;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  const json = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
  if (path === `/kiosk/${token}`) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>FAKE kiosk</title><h1>FAKE customer page</h1>"); return;
  }
  if (path === `/api/bms/restaurant-kiosk/${token}`) {
    json(revoked || urlGone ? 410 : 200, revoked || urlGone ? { error: "gone" } :
      { storeName: "FAKE Restaurant", locationName: "FAKE Branch", items: [] }); return;
  }
  if (path === "/api/bms/restaurant-kiosk-device") {
    if (req.headers["x-kiosk-device-token"] !== credential || revoked) { json(401, {}); return; }
    if (req.method === "GET") {
      if (failNextStatus) { failNextStatus = false; json(503, {}); return; }
      json(200, { pinConfigured: true, pinSetAt: "2026-11-27T00:00:00.000Z",
        pinVersion: "11111111-1111-4111-8111-111111111111" }); return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (body.action === "bind") { json(body.publicToken === token &&
      body.pinVersion === "11111111-1111-4111-8111-111111111111" && !urlGone ? 200 : 409,
      { storeName: "FAKE Restaurant", locationName: "FAKE Branch" }); return; }
    if (body.action === "verifyPin") { json(body.pin === "123456" ? 200 : 403,
      body.pin === "123456" ? { status: "OK", pinVersion: "11111111-1111-4111-8111-111111111111" }
        : { status: "INVALID" }); return; }
  }
  json(404, {});
});

const temp = await mkdtemp(join(tmpdir(), "bms-kiosk-integration-"));
app.setPath("appData", temp);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.BMS_KIOSK_TEST_ORIGIN = origin;
process.env.BMS_KIOSK_TEST_MAINTENANCE_MS = "8000";
await import("../src/main.mjs");

async function until(predicate, message, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Timeout: ${message}; windows=${BrowserWindow.getAllWindows().map((win) => win.webContents.getURL()).join(',')}`);
}
const local = () => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().startsWith("file:"));
const guest = () => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().startsWith(origin));

app.whenReady().then(async () => { try {
  const shell = await until(() => local()?.webContents.getURL() && local(), "first-run setup");
  await until(() => shell.webContents.executeJavaScript("!document.querySelector('#setup').hidden"), "setup visible");
  const invalid = await shell.webContents.executeJavaScript(
    `window.bmsKiosk.validate({url:'https://evil.test/kiosk/${token}',deviceToken:'${credential}'})`);
  assert.equal(invalid.code, "INVALID_URL");
  await shell.webContents.executeJavaScript(`document.querySelector('#kiosk-url').value='${origin}/kiosk/${token}';
    document.querySelector('#device-token').value='${credential}'; document.querySelector('#setup-form').requestSubmit()`);
  await until(() => shell.webContents.executeJavaScript("!document.querySelector('#setup-open').hidden"), "server-verified branch");
  assert.match(await shell.webContents.executeJavaScript("document.querySelector('#setup-status').textContent"), /FAKE Branch/);
  await shell.webContents.executeJavaScript("document.querySelector('#setup-open').click()");
  const customer = await until(() => guest(), "customer window");
  await until(() => customer.isVisible(), "guest visible");
  assert.equal(await customer.webContents.executeJavaScript("typeof window.bmsKiosk"), "undefined");
  assert.equal(await customer.webContents.executeJavaScript("typeof process"), "undefined");
  await customer.webContents.executeJavaScript("window.open('https://example.invalid')");
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  await customer.webContents.executeJavaScript(`location.href='${origin}/pos'`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(customer.webContents.getURL(), `${origin}/kiosk/${token}`);
  customer.webContents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: ["control", "alt"] });
  await until(() => shell.isVisible(), "maintenance shell visible");
  await until(() => shell.webContents.executeJavaScript("!document.querySelector('#pin').hidden"), "PIN screen");
  const wrong = await shell.webContents.executeJavaScript("window.bmsKiosk.verifyPin('000000')");
  assert.equal(wrong.ok, false);
  const right = await shell.webContents.executeJavaScript("window.bmsKiosk.verifyPin('123456')");
  assert.equal(right.ok, true);
  await until(() => shell.webContents.executeJavaScript("!document.querySelector('#setup').hidden"), "unlocked setup");
  await shell.webContents.executeJavaScript("window.bmsKiosk.cancelMaintenance()");
  const afterMaintenance = await until(() => guest() && guest() !== customer && guest()?.isVisible() && guest(),
    "fresh guest after maintenance");
  assert.equal(await afterMaintenance.webContents.executeJavaScript("sessionStorage.getItem('cart')"), null);
  afterMaintenance.webContents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: ["control", "alt"] });
  await until(() => shell.isVisible() && shell.webContents.executeJavaScript("!document.querySelector('#pin').hidden"),
    "PIN required again");
  assert.equal((await shell.webContents.executeJavaScript("window.bmsKiosk.verifyPin('123456')")).ok, true);
  await until(() => shell.webContents.executeJavaScript("!document.querySelector('#setup').hidden"), "settings unlocked");
  const afterTimeout = await until(() => guest() && guest() !== afterMaintenance && guest()?.isVisible() && guest(),
    "settings timeout starts fresh customer session", 12_000);
  assert.equal(await afterTimeout.webContents.executeJavaScript("sessionStorage.getItem('cart')"), null);
  await afterTimeout.webContents.executeJavaScript("sessionStorage.setItem('cart', 'FAKE-OLD-CUSTOMER')");
  failNextStatus = true;
  await new Promise((resolve) => setTimeout(resolve, 16_000));
  assert.equal(guest()?.isVisible(), true, "transient heartbeat outage must keep current cart/window");
  urlGone = true;
  await until(() => !guest() && shell.isVisible(), "rotated URL closes guest", 18_000);
  assert.equal(await shell.webContents.executeJavaScript("!document.querySelector('#recovery').hidden"), true);
  urlGone = false;
  await shell.webContents.executeJavaScript("window.bmsKiosk.retry()");
  const replacement = await until(() => guest() && guest() !== afterTimeout && guest(), "fresh guest after retry");
  await until(() => replacement.isVisible(), "fresh guest visible");
  assert.equal(await replacement.webContents.executeJavaScript("sessionStorage.getItem('cart')"), null);
  replacement.webContents.forcefullyCrashRenderer();
  await until(() => !guest() && shell.isVisible(), "renderer crash recovery");
  assert.match(await shell.webContents.executeJavaScript("document.querySelector('#recovery-title').textContent"),
    /หน้าจอสั่งอาหารหยุดทำงาน/);
  await new Promise((resolve) => setTimeout(resolve, 5200));
  await shell.webContents.executeJavaScript("window.bmsKiosk.retry()");
  await until(() => guest()?.isVisible(), "fresh guest after crash");
  revoked = true;
  await until(() => !guest() && shell.isVisible(), "revocation closes guest", 18_000);
  assert.equal(await shell.webContents.executeJavaScript("!document.querySelector('#recovery').hidden"), true);
  const output = join(root, "..", "..", ".test-output", "kiosk-desktop-shell");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "real-main-revoked-fixture.png"),
    await shell.webContents.capturePage().then((image) => image.toPNG()));
  console.log("main integration fixture: provision, guest isolation, navigation, PIN, transient outage, rotation, crash and revoke passed");
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  app.quit();
  await new Promise((resolve) => server.close(resolve));
  if (temp.startsWith(join(tmpdir(), "bms-kiosk-integration-"))) await rm(temp, { recursive: true, force: true });
  if (process.exitCode) app.exit(process.exitCode);
} }).catch((error) => { console.error(error); process.exitCode = 1; app.quit(); });
