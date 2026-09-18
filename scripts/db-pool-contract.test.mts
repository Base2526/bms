import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const db = readFileSync(new URL("../apps/web/lib/db.ts", import.meta.url), "utf8");
const composeFiles = [
  "../docker-compose.yml",
  "../docker-compose.dev.yml",
  "../docker-compose.prod.yml",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

test("Next development reloads reuse one PostgreSQL pool", () => {
  assert.match(db, /databaseGlobal\.__bmsPostgresPool \?\?= createPool\(\)/);
  assert.match(db, /process\.env\.NODE_ENV === "production"/);
  assert.match(db, /__bmsPostgresSignalHandlerInstalled/);
});

test("an acquired client cannot run one statement forever", () => {
  assert.match(
    db,
    /statement_timeout:\s*poolInt\("POSTGRES_STATEMENT_TIMEOUT_MS",\s*60_000\)/,
  );
});

test("every web compose configuration passes the statement deadline", () => {
  for (const compose of composeFiles) {
    assert.match(
      compose,
      /POSTGRES_STATEMENT_TIMEOUT_MS:\s*\$\{POSTGRES_STATEMENT_TIMEOUT_MS:-60000\}/,
    );
  }
});
