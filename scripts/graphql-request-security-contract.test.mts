import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

import {
  buildSchema,
  parse,
  specifiedRules,
  validate,
} from "../apps/web/node_modules/graphql/index.js";
import {
  GRAPHQL_MAX_ALIASES,
  GRAPHQL_MAX_DEPTH,
  GRAPHQL_MAX_FIELDS,
  graphqlRequestLimitsRule,
} from "../apps/web/graphql/requestLimits.ts";
import { validGraphqlUploadMap } from "../apps/web/graphql/uploadMap.ts";
import { readBoundedBodyBytes, readBoundedFormData } from "../apps/web/lib/bms/webhookBody.ts";
import { uploadProcess } from "../apps/web/node_modules/graphql-upload-nextjs/index.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const schema = buildSchema("type Node { child: Node value: String } type Query { node: Node }");
const check = (source: string) =>
  validate(schema, parse(source), [...specifiedRules, graphqlRequestLimitsRule]);

test("Apollo incremental merge uses patched GraphQL Tools without prototype pollution", () => {
  const apolloRequire = createRequire(path.join(ROOT, "apps/web/node_modules/@apollo/server/package.json"));
  assert.equal(apolloRequire("@graphql-tools/utils/package.json").version, "12.0.4");
  const probe = spawnSync(process.execPath, ["-e", `
    const { createRequire } = require('node:module');
    const apolloRequire = createRequire(${JSON.stringify(path.join(ROOT, "apps/web/node_modules/@apollo/server/package.json"))});
    const { mergeIncrementalResult } = apolloRequire('@graphql-tools/utils');
    const result = { data: { safe: null } };
    mergeIncrementalResult({ executionResult: result,
      incrementalResult: { path: [['__proto__'], 'bmsProbe'], data: { polluted: true } } });
    if (Object.hasOwn(Object.prototype, 'bmsProbe')) process.exit(1);
    mergeIncrementalResult({ executionResult: result,
      incrementalResult: { path: ['safe'], data: { accepted: true } } });
    if (result.data.safe?.accepted !== true) process.exit(2);
  `], { cwd: path.join(ROOT, "apps/web"), encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
});

test("GraphQL HTTP boundary enables CSRF, origin and byte-accurate body limits", () => {
  const route = read("apps/web/app/api/graphql/route.ts");
  const client = read("apps/web/lib/apollo.ts");
  assert.match(route, /introspection: process\.env\.NODE_ENV !== "production"/);
  assert.match(route, /csrfPrevention: true/);
  assert.match(route, /validationRules: \[graphqlRequestLimitsRule\]/);
  assert.match(route, /isSameOriginBrowserRequest\(request\)/);
  assert.match(route, /MAX_GRAPHQL_JSON_BYTES = 1024 \* 1024/);
  assert.match(route, /MAX_GRAPHQL_MULTIPART_BYTES = 64 \* 1024 \* 1024/);
  assert.match(route, /readBoundedBodyBytes\(request, MAX_GRAPHQL_JSON_BYTES\)/);
  assert.match(route, /readBoundedFormData\(request, MAX_GRAPHQL_MULTIPART_BYTES\)/);
  assert.match(route, /validGraphqlUploadMap\(body\.form\)/);
  assert.match(route, /request\.method === "POST" && contentType\.toLowerCase\(\)\.includes\("multipart\/form-data"\)/);
  assert.match(route, /formData: async \(\) => body\.form/);
  assert.match(route, /maxFileSize: MAX_GRAPHQL_FILE_BYTES/);
  assert.match(route, /allowedTypes: SAFE_GRAPHQL_UPLOAD_TYPES/);
  assert.match(client, /"Apollo-Require-Preflight": "true"/);
  assert.doesNotMatch(route, /csrfPrevention: false/);
});

function uploadForm(map: Record<string, string[]>, variables: unknown): FormData {
  const form = new FormData();
  form.set("operations", JSON.stringify({ query: "mutation ($image: Upload!) { upload(file: $image) }", variables }));
  form.set("map", JSON.stringify(map));
  return form;
}

test("multipart map rejects prototype paths and preserves valid upload placeholders", () => {
  const valid = uploadForm({ "0": ["variables.image"] }, { image: null });
  assert.equal(validGraphqlUploadMap(valid), true);
  assert.equal(validGraphqlUploadMap(uploadForm({ "0": ["variables.__proto__.bmsProbe"] }, { image: null })), false);
  assert.equal(validGraphqlUploadMap(uploadForm({ "0": ["variables.input.constructor.prototype"] }, { input: { constructor: null } })), false);
  assert.equal(validGraphqlUploadMap(uploadForm({ "0": ["query"] }, { image: null })), false);
  assert.equal(validGraphqlUploadMap(uploadForm({ "0": ["variables.image"] }, { image: "overwrite" })), false);
  assert.equal(validGraphqlUploadMap(uploadForm({ "0": ["variables.images.0"] }, { images: [null] })), true);
  assert.equal(Object.hasOwn(Object.prototype, "bmsProbe"), false);
});

test("multipart map rejects duplicate parts and targets while allowing two distinct files", () => {
  const variables = { first: null, second: null };
  const valid = uploadForm({ "0": ["variables.first"], "1": ["variables.second"] }, variables);
  valid.set("0", new Blob(["a"], { type: "text/plain" }), "a.txt");
  valid.set("1", new Blob(["b"], { type: "text/plain" }), "b.txt");
  assert.equal(validGraphqlUploadMap(valid), true);

  const duplicateTarget = uploadForm({ "0": ["variables.first"], "1": ["variables.first"] }, variables);
  assert.equal(validGraphqlUploadMap(duplicateTarget), false);
  const duplicateInSlot = uploadForm({ "0": ["variables.first", "variables.first"] }, variables);
  assert.equal(validGraphqlUploadMap(duplicateInSlot), false);

  const duplicateMapPart = uploadForm({ "0": ["variables.first"] }, variables);
  duplicateMapPart.append("map", JSON.stringify({ "0": ["variables.second"] }));
  assert.equal(validGraphqlUploadMap(duplicateMapPart), false);
  const duplicateOperations = uploadForm({ "0": ["variables.first"] }, variables);
  duplicateOperations.append("operations", "{}");
  assert.equal(validGraphqlUploadMap(duplicateOperations), false);
  valid.append("0", new Blob(["c"], { type: "text/plain" }), "c.txt");
  assert.equal(validGraphqlUploadMap(valid), false);
});

test("body limits apply without Content-Length and valid multipart parses once", async () => {
  const source = {
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    }),
  };
  assert.deepEqual(await readBoundedBodyBytes(source, 8),
    { ok: false, status: 413, error: "payload too large" });

  const form = uploadForm({ "0": ["variables.image"] }, { image: null });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WZkAAAAASUVORK5CYII=", "base64");
  form.set("0", new Blob([png], { type: "image/png" }), "image.png");
  const request = new Request("http://localhost/api/graphql", {
    method: "POST", body: form, headers: { "Apollo-Require-Preflight": "true" },
  });
  const parsed = await readBoundedFormData(request, 4096);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(validGraphqlUploadMap(parsed.form), true);
  assert.equal(parsed.form.get("0") instanceof File, true);
  const server = {
    executeOperation: async () => ({ body: { kind: "single" as const, singleResult: { data: { upload: true } } } }),
  };
  const response = await uploadProcess(
    { formData: async () => parsed.form, headers: request.headers }, {}, server as any,
    { allowedTypes: ["image/png"], maxFileSize: 1024 },
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { upload: true });
});

test("expanded GraphQL depth is rejected before resolver execution", () => {
  let selection = "value";
  for (let i = 0; i < GRAPHQL_MAX_DEPTH + 1; i += 1) {
    selection = `child { ${selection} }`;
  }
  const errors = check(`query TooDeep { node { ${selection} } }`);
  assert.ok(errors.some((error) => error.message.includes("maximum depth")));
});

test("fragment fan-out counts each expansion and rejects excessive fields", () => {
  const spreads = Array.from({ length: GRAPHQL_MAX_FIELDS + 1 }, () => "...One").join(" ");
  const errors = check(`query TooWide { node { ${spreads} } } fragment One on Node { value }`);
  assert.ok(errors.some((error) => error.message.includes("maximum field count")));
});

test("excessive aliases are rejected while ordinary operations remain valid", () => {
  const aliases = Array.from(
    { length: GRAPHQL_MAX_ALIASES + 1 },
    (_, index) => `a${index}: value`
  ).join(" ");
  const errors = check(`query TooManyAliases { node { ${aliases} } }`);
  assert.ok(errors.some((error) => error.message.includes("maximum alias count")));
  assert.deepEqual(check("query Normal { node { child { value } } }"), []);
});

test("admin REST authorization refreshes revocation, role and acting-tenant authority", () => {
  const auth = read("apps/web/lib/bms/adminRouteAuth.ts");
  assert.match(auth, /isAdminSessionActive\(session\.jti\)/);
  assert.match(auth, /refreshAdminIdentity\(session\)/);
  assert.match(auth, /admin\.is_platform_admin === true/);
  assert.match(auth, /SELECT id FROM bms_tenants WHERE id = \$1 LIMIT 1/);
});

test("database failures log parameter shape instead of credentials or PII", () => {
  const db = read("apps/web/lib/db.ts");
  assert.match(db, /formatParamMetadata/);
  assert.match(db, /formatDatabaseError/);
  assert.match(db, /string\(\$\{Buffer\.byteLength\(value, "utf8"\)\}B\)/);
  assert.doesNotMatch(db, /JSON\.stringify\(p\)/);
  assert.doesNotMatch(db, /\[SQL ERROR\] \$\{err\.message\}/);
});

test("proxy caps multipart GraphQL bodies before application buffering", () => {
  for (const file of ["apps/web/Caddyfile.server", "apps/web/Caddyfile.local"]) {
    const source = read(file);
    assert.match(source, /path \/api\/graphql/);
    assert.match(source, /header Content-Type multipart\/form-data\*/);
    assert.match(source, /request_body @gqlUpload/);
    assert.match(source, /max_size 64MB/);
    assert.match(source, /max_size 1MB/);
    assert.match(source, /path \/api\/bms\/checkout\/payment/);
  }
});
