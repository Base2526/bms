import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

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

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const schema = buildSchema("type Node { child: Node value: String } type Query { node: Node }");
const check = (source: string) =>
  validate(schema, parse(source), [...specifiedRules, graphqlRequestLimitsRule]);

test("GraphQL HTTP boundary enables CSRF, origin and body-size defenses", () => {
  const route = read("apps/web/app/api/graphql/route.ts");
  assert.match(route, /csrfPrevention: true/);
  assert.match(route, /validationRules: \[graphqlRequestLimitsRule\]/);
  assert.match(route, /isSameOriginBrowserRequest\(request\)/);
  assert.match(route, /MAX_GRAPHQL_JSON_BYTES = 1024 \* 1024/);
  assert.match(route, /MAX_GRAPHQL_MULTIPART_BYTES = 64 \* 1024 \* 1024/);
  assert.match(route, /maxFileSize: MAX_GRAPHQL_FILE_BYTES/);
  assert.match(route, /allowedTypes: SAFE_GRAPHQL_UPLOAD_TYPES/);
  assert.doesNotMatch(route, /csrfPrevention: false/);
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
  }
});
