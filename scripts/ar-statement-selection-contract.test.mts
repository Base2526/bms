// =============================================================
// /admin/receivables shows a statement only for the account the user opened.
// -------------------------------------------------------------
// The page computed `statement.data?.bmsArStatement?.accountId === statementFor?.id ?
// statement.data.bmsArStatement : null`. Before any account is opened both sides are undefined, the
// comparison is true, and `statement.data.bmsArStatement` throws: the whole page rendered the error
// boundary on first load (since 2026-11-19). Found 2026-11-24 by the local Admin browser crawl.
// =============================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { visibleArStatement } from "../apps/web/lib/arStatementSelection.ts";

const statement = { accountId: "FAKE-account-1", lines: [] };

test("no statement before an account is opened or while its query has no data", () => {
  assert.equal(visibleArStatement(undefined, null), null);
  assert.equal(visibleArStatement(undefined, undefined), null);
  assert.equal(visibleArStatement({}, null), null);
  assert.equal(visibleArStatement({ bmsArStatement: null }, { id: "FAKE-account-1" }), null);
});

test("a loaded statement is shown only for the account that is open", () => {
  assert.equal(visibleArStatement({ bmsArStatement: statement }, { id: "FAKE-account-1" }), statement);
  assert.equal(visibleArStatement({ bmsArStatement: statement }, { id: "FAKE-account-2" }), null,
    "a stale statement from the previous account must not be shown");
  assert.equal(visibleArStatement({ bmsArStatement: statement }, null), null);
});

test("the receivables page uses the helper", () => {
  const page = readFileSync(new URL("../apps/web/app/(admin)/admin/receivables/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const visibleStatement = visibleArStatement\(statement\.data, statementFor\);/);
  assert.doesNotMatch(page, /\? statement\.data\.bmsArStatement : null/);
});
