import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("clinic attachment route authenticates, bounds uploads and sends private no-store downloads", async () => {
  let authStatus = 401;
  let uploadArgs: Record<string, unknown> | null = null;
  class ClinicError extends Error { constructor(public code: string, public status = 400) { super(code); } }
  class NextResponse extends Response {
    static json(body: unknown, options?: ResponseInit) { return Response.json(body, options); }
  }
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => authStatus
      ? { ok: false, status: authStatus } : { ok: true, tenantId: "server-tenant", adminId: "server-actor" } },
    "@/lib/bms/clinic/access": { ClinicError },
    "@/lib/bms/clinic/attachments": {
      readClinicAttachment: async (input: Record<string, unknown>) => {
        if (input.attachmentId === "missing") throw new ClinicError("ATTACHMENT_NOT_FOUND", 404);
        assert.deepEqual(input, { tenantId: "server-tenant", actorId: "server-actor", attachmentId: "file-1" });
        return { file_name: "synthetic.pdf", mime_type: "application/pdf", content: Buffer.from("%PDF-1.4") };
      },
      uploadClinicAttachment: async (input: Record<string, unknown>) => { uploadArgs = input; return "file-2"; },
    },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  };
  const source = readFileSync(path.join(root, "apps/web/app/api/bms/clinic/attachments/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `Unexpected import ${name}`); return mocks[name];
  }, module, module.exports);
  const get = module.exports.GET as (request: { nextUrl: URL }) => Promise<Response>;
  const post = module.exports.POST as (request: Request & { nextUrl: URL }) => Promise<Response>;
  const url = new URL("https://bms.example.invalid/api/bms/clinic/attachments?id=file-1&encounterId=enc-1&tenantId=forged");
  const makePost = (body: string) => Object.assign(new Request(url, { method: "POST",
    headers: { "content-type": "application/pdf", "x-clinic-file-name": "synthetic.pdf" }, body }), { nextUrl: url });
  let result = await get({ nextUrl: url });
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), { status: "UNAUTHENTICATED" });
  result = await post(makePost("%PDF-1.4"));
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), { status: "UNAUTHENTICATED" });
  authStatus = 403;
  result = await get({ nextUrl: url });
  assert.equal(result.status, 403);
  assert.deepEqual(await result.json(), { status: "FORBIDDEN" });
  authStatus = 0;
  result = await get({ nextUrl: url });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "private, no-store, no-cache, max-age=0");
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  assert.equal(result.headers.get("content-type"), "application/pdf");
  assert.match(result.headers.get("content-disposition") ?? "", /attachment;/);
  assert.equal(await result.text(), "%PDF-1.4");
  result = await get({ nextUrl: new URL("https://bms.example.invalid/api/bms/clinic/attachments?id=missing") });
  assert.equal(result.status, 404);
  result = await post(makePost("x".repeat(2 * 1024 * 1024 + 1)));
  assert.equal(result.status, 413);
  assert.equal(uploadArgs, null);
  result = await post(makePost("%PDF-1.4"));
  assert.equal(result.status, 200);
  assert.equal(uploadArgs?.tenantId, "server-tenant");
  assert.equal(uploadArgs?.actorId, "server-actor");
  assert.equal(uploadArgs?.encounterId, "enc-1");
});
