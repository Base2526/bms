import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";

import { createS3Driver } from "../apps/web/lib/storageDrivers/s3.ts";

const PART_BYTES = 8 * 1024 * 1024;

test("release multipart parser streams the file and returns small metadata", async (t) => {
  const chunks: Buffer[] = [];
  const { __setStorageDriverForTest } = await import("../apps/web/lib/storageDrivers/index.ts");
  __setStorageDriverForTest({
    name: "upload-test",
    shared: false,
    async write() {},
    async delete() {},
    async writeStream(_relpath, stream) {
      const hash = crypto.createHash("sha256");
      let size = 0;
      for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array>) {
        const buffer = Buffer.from(chunk);
        chunks.push(buffer);
        size += buffer.length;
        hash.update(buffer);
      }
      return { size, checksum: hash.digest("hex") };
    },
    async read() { return Buffer.alloc(0); },
    async stat() { return null; },
    async openStream() { return Readable.from([]); },
  });
  t.after(() => __setStorageDriverForTest(null));

  const { parseRetailLocalReleaseUploadStream } = await import(
    "../apps/web/lib/bms/retailLocalReleaseUpload.ts"
  );
  const form = new FormData();
  form.set("platform", "windows-x64");
  form.set("packageType", "server-pos");
  form.set("version", "1.2.3");
  form.set("channel", "pilot");
  form.set("status", "supported");
  form.set("accessLevel", "trial");
  form.set("isLatest", "false");
  form.set("minOs", "Windows 10 x64");
  form.set("releaseNotes", "stream test");
  form.set("file", new Blob(["installer-bytes"]), "BMS-Server-POS-1.2.3.exe");

  const request = new Request("http://local/upload", {
    method: "POST",
    body: form,
  });
  const headers = Object.fromEntries(request.headers);
  const parsed = await parseRetailLocalReleaseUploadStream(
    Readable.fromWeb(request.body as any),
    headers
  );

  assert.equal(parsed.fields.packageType, "server-pos");
  assert.equal(parsed.fields.accessLevel, "trial");
  assert.equal(parsed.storedFile.original_name, "BMS-Server-POS-1.2.3.exe");
  assert.equal(parsed.storedFile.size, Buffer.byteLength("installer-bytes"));
  assert.equal(Buffer.concat(chunks).toString("utf8"), "installer-bytes");
  assert.equal(
    parsed.storedFile.checksum,
    crypto.createHash("sha256").update("installer-bytes").digest("hex")
  );
});

test("release multipart parser rejects oversized files and removes partial bytes", async (t) => {
  const deleted: string[] = [];
  const { __setStorageDriverForTest } = await import("../apps/web/lib/storageDrivers/index.ts");
  __setStorageDriverForTest({
    name: "upload-limit-test",
    shared: false,
    async write() {},
    async delete(relpath) { deleted.push(relpath); },
    async writeStream(_relpath, stream) {
      const hash = crypto.createHash("sha256");
      let size = 0;
      for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array>) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        hash.update(buffer);
      }
      return { size, checksum: hash.digest("hex") };
    },
    async read() { return Buffer.alloc(0); },
    async stat() { return null; },
    async openStream() { return Readable.from([]); },
  });
  t.after(() => __setStorageDriverForTest(null));

  const previousLimit = process.env.BMS_RETAIL_LOCAL_RELEASE_MAX_BYTES;
  process.env.BMS_RETAIL_LOCAL_RELEASE_MAX_BYTES = "5";
  t.after(() => {
    if (previousLimit === undefined) delete process.env.BMS_RETAIL_LOCAL_RELEASE_MAX_BYTES;
    else process.env.BMS_RETAIL_LOCAL_RELEASE_MAX_BYTES = previousLimit;
  });

  const { parseRetailLocalReleaseUploadStream } = await import(
    "../apps/web/lib/bms/retailLocalReleaseUpload.ts"
  );
  const form = new FormData();
  form.set("file", new Blob(["too-large"]), "BMS-Server-POS-1.2.3.exe");

  const request = new Request("http://local/upload", { method: "POST", body: form });
  await assert.rejects(
    parseRetailLocalReleaseUploadStream(
      Readable.fromWeb(request.body as any),
      Object.fromEntries(request.headers)
    ),
    (error: any) => error?.status === 413
  );
  assert.equal(deleted.length, 1);
});

test("S3 stream uploads use bounded multipart parts and preserve checksum", async (t) => {
  const partSizes: number[] = [];
  let initiated = false;
  let completedBody = "";

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);

    if (request.method === "POST" && url.searchParams.has("uploads")) {
      initiated = true;
      response.writeHead(200, { "content-type": "application/xml" });
      response.end("<InitiateMultipartUploadResult><UploadId>test/upload+id</UploadId></InitiateMultipartUploadResult>");
      return;
    }
    if (request.method === "PUT" && url.searchParams.has("partNumber")) {
      partSizes.push(body.length);
      response.writeHead(200, { etag: `\"part-${url.searchParams.get("partNumber")}\"` });
      response.end();
      return;
    }
    if (request.method === "POST" && url.searchParams.has("uploadId")) {
      completedBody = body.toString("utf8");
      response.writeHead(200, { "content-type": "application/xml" });
      response.end("<CompleteMultipartUploadResult />");
      return;
    }
    if (request.method === "DELETE") {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(500);
    response.end("unexpected request");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const envNames = [
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_ENDPOINT",
    "S3_FORCE_PATH_STYLE",
  ] as const;
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const name of envNames) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  process.env.S3_BUCKET = "release-test";
  process.env.S3_ACCESS_KEY_ID = "test-access";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret";
  process.env.S3_ENDPOINT = `http://127.0.0.1:${address.port}`;
  process.env.S3_FORCE_PATH_STYLE = "true";

  const payload = Buffer.alloc(PART_BYTES * 2 + 123, 0x61);
  const source = Readable.from([
    payload.subarray(0, PART_BYTES - 7),
    payload.subarray(PART_BYTES - 7, PART_BYTES + 19),
    payload.subarray(PART_BYTES + 19),
  ]);
  const result = await createS3Driver().writeStream("releases/test.exe", source);

  assert.equal(initiated, true);
  assert.deepEqual(partSizes, [PART_BYTES, PART_BYTES, 123]);
  assert.match(completedBody, /<PartNumber>1<\/PartNumber>/);
  assert.match(completedBody, /<PartNumber>3<\/PartNumber>/);
  assert.equal(result.size, payload.length);
  assert.equal(result.checksum, crypto.createHash("sha256").update(payload).digest("hex"));
});
