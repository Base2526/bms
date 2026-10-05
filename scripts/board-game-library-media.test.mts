import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { prepareBoardGameImage } from "../apps/web/lib/bms/boardGameLibraryMedia.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const sharp = require("sharp");
test("game artwork is decoded, bounded and stripped of metadata", async () => {
  for (const format of ["png", "jpeg", "webp"]) {
    const input = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "green" } })
      .withMetadata().toFormat(format).toBuffer();
    const meta = await sharp(await prepareBoardGameImage(input)).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 1200); assert.equal(meta.height, 600);
    assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined);
  }
});
test("invalid, vector, empty, oversized and pixel-bomb artwork is rejected", async () => {
  for (const input of [Buffer.alloc(0), Buffer.alloc(5 * 1024 * 1024 + 1), Buffer.from("not an image"),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')]) {
    await assert.rejects(prepareBoardGameImage(input));
  }
  const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(prepareBoardGameImage(huge));
  await assert.rejects(prepareBoardGameImage(huge.subarray(0, 30)));
});

function routeHarness(auth: object) {
  const ts = require("typescript");
  const src = readFileSync(new URL("../apps/web/app/api/bms/board-game/library/image/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const calls: unknown[][] = [];
  const permissions: string[] = [];
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status: number }) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async (permission: string) => { permissions.push(permission); return auth; } },
    "@/lib/bms/boardGameLibraryMedia": { BOARD_GAME_IMAGE_MAX_BYTES: 5 * 1024 * 1024, setBoardGameTitleImage: async (...args: unknown[]) => { calls.push(args); return { imageUrl: "/api/files/1" }; } },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, fn: unknown) => fn },
  };
  const exports: Record<string, any> = {};
  new Function("require", "exports", compiled)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  return { ...exports, calls, permissions };
}
const request = (method = "POST", chunks = [new Uint8Array([1, 2])], type = "image/png", extra: Record<string, string> = {}) => ({
  method, nextUrl: new URL("https://example.test/api/bms/board-game/library/image?titleId=FAKE-title&tenantId=attacker"),
  headers: new Headers({ "content-type": type, ...extra }),
  body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }),
});
test("artwork route rejects missing permission before reading bytes", async () => {
  for (const status of [401, 403]) {
    const h = routeHarness({ ok: false, status });
    const res = await h.POST({ get body() { throw new Error("unauthorized body read"); } });
    assert.equal(res.status, status); assert.equal(h.calls.length, 0);
    assert.deepEqual(h.permissions, ["board_game.library.manage"]);
  }
});
test("artwork route derives ownership from auth for upload and removal", async () => {
  const h = routeHarness({ ok: true, tenantId: "trusted-tenant", adminId: 42 });
  assert.equal((await h.POST(request())).status, 200);
  assert.deepEqual(h.calls[0], ["trusted-tenant", "FAKE-title", Buffer.from([1, 2]), "42"]);
  assert.equal((await h.DELETE(request("DELETE"))).status, 200);
  assert.deepEqual(h.calls[1], ["trusted-tenant", "FAKE-title", null, "42"]);
});
test("artwork route bounds declared and chunked bytes and refuses non-images", async () => {
  const h = routeHarness({ ok: true, tenantId: "trusted-tenant", adminId: 42 });
  assert.equal((await h.POST(request("POST", [], "text/html"))).status, 400);
  assert.equal((await h.POST(request("POST", [], "image/png", { "content-length": "6000000" }))).status, 413);
  assert.equal((await h.POST(request("POST", [new Uint8Array(4 * 1024 * 1024), new Uint8Array(2 * 1024 * 1024)]))).status, 413);
  assert.equal(h.calls.length, 0);
});
