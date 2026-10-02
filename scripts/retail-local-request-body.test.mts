import assert from "node:assert/strict";
import test from "node:test";
import { readRetailLocalJSON, RetailLocalRequestBodyError } from "../apps/web/lib/bms/retailLocalRequestBody.ts";

const request = (body: BodyInit, headers?: Record<string, string>) => new Request("http://localhost/test", { method: "POST", body, headers, duplex: "half" } as RequestInit);
test("small licensing APIs bound chunked JSON before buffering and reject invalid encoding", async () => {
  assert.deepEqual(await readRetailLocalJSON(request('{"safe":true}')), { safe: true });
  await assert.rejects(readRetailLocalJSON(request("{}", { "content-length": "99999" })),
    (error: unknown) => error instanceof RetailLocalRequestBodyError && error.status === 413);
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(2048)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readRetailLocalJSON(request(stream)),
    (error: unknown) => error instanceof RetailLocalRequestBodyError && error.status === 413);
  assert.equal(cancelled, true);
  for (const body of ["{broken", new Uint8Array([0xff, 0xfe])]) {
    await assert.rejects(readRetailLocalJSON(request(body)),
      (error: unknown) => error instanceof RetailLocalRequestBodyError && error.status === 400);
  }
});
