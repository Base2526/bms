import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  configureWebHttpServer,
  webRequestTimeoutMs,
} from "../apps/web/server-config.mjs";

test("the production web server gives streaming request bodies thirty minutes by default", () => {
  const server = {
    requestTimeout: 300_000,
    headersTimeout: 60_000,
    keepAliveTimeout: 5_000,
  };

  const configured = configureWebHttpServer(server, undefined);

  assert.equal(configured.requestTimeoutMs, 1_800_000);
  assert.equal(server.requestTimeout, 1_800_000);
  assert.equal(server.headersTimeout, 60_000);
  assert.equal(server.keepAliveTimeout, 5_000);
});

test("the total request timeout accepts bounded integer overrides and rejects unsafe values", () => {
  assert.equal(webRequestTimeoutMs("900000"), 900_000);

  for (const value of ["299999", "3600001", "900000.5", "not-a-number"]) {
    assert.throws(() => webRequestTimeoutMs(value), /BMS_HTTP_REQUEST_TIMEOUT_MS/);
  }
});

test("production startup and both compose paths keep the long request deadline wired", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../apps/web/package.json", import.meta.url), "utf8"),
  );
  const [baseCompose, productionCompose] = await Promise.all([
    readFile(new URL("../docker-compose.yml", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.prod.yml", import.meta.url), "utf8"),
  ]);

  assert.equal(packageJson.scripts.start, "node server.mjs");
  for (const compose of [baseCompose, productionCompose]) {
    assert.match(
      compose,
      /BMS_HTTP_REQUEST_TIMEOUT_MS:\s*\$\{BMS_HTTP_REQUEST_TIMEOUT_MS:-1800000\}/,
    );
    assert.match(
      compose,
      /BMS_RETAIL_LOCAL_UPLOAD_IDLE_TIMEOUT_MS:\s*\$\{BMS_RETAIL_LOCAL_UPLOAD_IDLE_TIMEOUT_MS:-120000\}/,
    );
  }
});

