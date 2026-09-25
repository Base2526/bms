/**
 * "Every table a query names must be a table a migration creates."
 *
 * SQL lives in template literals, so a mistyped relation name is invisible to `tsc`, invisible to
 * the production build, and invisible to every pure test that does not execute it. It only shows up
 * as `42P01 relation "..." does not exist` the first time a human walks that code path.
 *
 * That is not hypothetical. `seedFakeBoardGameCafe()` read `bms_store_profiles` while the table has
 * been singular `bms_store_profile` since `6.9`. The archetype guard was the first statement of the
 * seeder, so creating a board-game test shop failed every single time — and because the route
 * deletes a half-seeded tenant on failure, the operator saw "create failed" with the tenant already
 * gone. One character, one flow dead, every gate green.
 *
 * A plural/singular slip is the cheapest possible mistake to make and the most expensive to find by
 * hand, so it gets a scanner rather than a rule nobody can enforce while typing.
 *
 * What counts as "a table a migration creates" is deliberately generous — CREATE TABLE, CREATE VIEW,
 * any table an ALTER touches (legacy pre-BMS tables such as `users` have no CREATE in this folder,
 * only ALTERs), and the `<table>_revisions` companions that `create_revision_trigger()` builds at
 * runtime. The point is to catch names that exist nowhere, not to re-derive the schema.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "db", "migrations");

const SCANNED_ROOTS = [
  path.join(ROOT, "apps", "web", "lib"),
  path.join(ROOT, "apps", "web", "app"),
  path.join(ROOT, "apps", "web", "graphql"),
  path.join(ROOT, "packages"),
];

const sourceFiles = (dir: string): string[] => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
};

/**
 * Relation names any migration brings into existence. ALTER counts because the pre-BMS community
 * tables (`users`, `posts`, `chats`, ...) predate this folder and are only ever altered here; a
 * scanner that called them unknown would be a scanner people switch off.
 */
const knownRelations = (): Set<string> => {
  const known = new Set<string>();
  const add = (name: string) => known.add(name.toLowerCase());

  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
    // `--` comments explain the very names we are matching on; read the statements, not the prose.
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--.*$/gm, " ");
    const collect = (re: RegExp) => {
      for (const match of sql.matchAll(re)) add(match[1]);
    };
    collect(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?([A-Za-z0-9_]+)/gi);
    collect(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?([A-Za-z0-9_]+)/gi);
    collect(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?["']?([A-Za-z0-9_]+)/gi);
    collect(/CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?([A-Za-z0-9_]+)/gi);
    // `create_revision_trigger('x')` builds `x_revisions` at runtime (7.0), so it has no CREATE TABLE.
    for (const match of sql.matchAll(/create_revision_trigger\(\s*'([A-Za-z0-9_]+)'/gi)) {
      add(`${match[1]}_revisions`);
    }
  }
  return known;
};

/** Words the grammar puts where a relation name goes: `FOR UPDATE OF`, `DO UPDATE SET`, `FROM LATERAL`. */
const NOT_A_RELATION = new Set([
  "set", "of", "skip", "nowait", "lateral", "only", "excluded", "values", "select", "dual",
  "unnest", "generate_series", "each", "rows", "returning", "where", "using",
]);

/** Relations Postgres itself provides: catalogs, `information_schema`, and set-returning functions. */
const PROVIDED_BY_POSTGRES = /^(pg_|information_schema\b|jsonb?_to_recordset$|jsonb?_array_elements|regexp_split_to_table$|string_to_table$)/;

const stripJsComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every template literal in the file, with the line it starts on. `${...}` may nest backticks. */
const templateLiterals = (source: string): Array<{ text: string; line: number }> => {
  const out: Array<{ text: string; line: number }> = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "`") continue;
    let j = i + 1;
    let depth = 0;
    while (j < source.length) {
      if (source[j] === "\\") { j += 2; continue; }
      if (source[j] === "$" && source[j + 1] === "{") { depth++; j += 2; continue; }
      if (depth > 0 && source[j] === "}") { depth--; j++; continue; }
      if (depth === 0 && source[j] === "`") break;
      j++;
    }
    out.push({ text: source.slice(i + 1, j), line: source.slice(0, i).split(/\r?\n/).length });
    i = j;
  }
  return out;
};

const SQL_SHAPED = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH)\b/i;

type Reference = { relation: string; line: number };

/**
 * Relations named by the SQL in one source file. Exercised below against a fixture so the matcher's
 * behaviour is pinned directly — repo-wide counts alone would stay green while half the grammar
 * quietly stopped matching.
 */
const relationsInSource = (raw: string): Reference[] => {
  const source = stripJsComments(raw);
  const refs: Reference[] = [];

  /**
   * A CTE is a relation the statement defines for itself; `AS MATERIALIZED (` counts too.
   * Collected per file rather than per literal because long queries are assembled from several
   * literals — `listPosShiftOverview()` declares `rows_with_metrics` in one and selects from it
   * in another, and a per-literal view would call its own CTE an unknown table.
   */
  const ctes = new Set<string>();
  for (const match of source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s+AS\s+(?:NOT\s+)?(?:MATERIALIZED\s+)?\(/gi)) {
    ctes.add(match[1].toLowerCase());
  }

  for (const literal of templateLiterals(source)) {
    if (!SQL_SHAPED.test(literal.text)) continue;
    const sql = literal.text.replace(/--.*$/gm, " ");

    const pattern =
      /\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?(?:public\.)?([A-Za-z_][A-Za-z0-9_]*)(.?)/gi;
    for (const match of sql.matchAll(pattern)) {
      const relation = match[1].toLowerCase();
      // `IS NOT DISTINCT FROM i.size` names a column, not a table.
      if (match[2] === ".") continue;
      // `FROM bms_claim_work($1)` is a table-valued function, not a relation. Function
      // definitions are checked by migration/database contracts; treating the call as a table
      // makes every correctly named claim helper look like a missing migration table.
      if (match[2] === "(") continue;
      if (NOT_A_RELATION.has(relation) || PROVIDED_BY_POSTGRES.test(relation) || ctes.has(relation)) continue;
      refs.push({ relation, line: literal.line });
    }
  }
  return refs;
};

const referencedRelations = (): Array<{ relation: string; where: string }> =>
  SCANNED_ROOTS.flatMap((dir) =>
    sourceFiles(dir).flatMap((file) => {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      return relationsInSource(readFileSync(file, "utf8")).map((ref) => ({
        relation: ref.relation,
        where: `${rel}:${ref.line}`,
      }));
    })
  );

test("every relation named in SQL is created by a migration", () => {
  const known = knownRelations();
  const refs = referencedRelations();

  const unknown = refs.filter((ref) => !known.has(ref.relation));
  const detail = unknown.map((ref) => `  ${ref.relation}  @ ${ref.where}`).join("\n");

  assert.ok(
    unknown.length === 0,
    `SQL names ${unknown.length} relation(s) that no migration creates. A mistyped table is invisible ` +
      `to tsc and to the build — it only fails as 42P01 when a human first walks that path:\n${detail}`
  );
});

/**
 * The scanner is the whole guarantee, so its behaviour is pinned on a fixture rather than on
 * repo-wide totals. Counting alone stays green while half the grammar silently stops matching —
 * a scanner that finds nothing is a test that checks nothing.
 */
test("the scanner reads each SQL shape it claims to read", () => {
  const fixture = `
    // Comments in this repo quote SQL back at you — \`SELECT id FROM bms_a_comment_table\` must
    // never be read as a real statement, or the scanner reports its own documentation.
    /* also here: \`JOIN bms_a_block_comment_table x\` */
    const a = await query(\`SELECT id FROM bms_read_by_select WHERE tenant_id = $1\`);
    const b = await query(\`UPDATE bms_written_by_update SET x = 1\`);
    const c = await query(\`INSERT INTO bms_written_by_insert (id) VALUES ($1)\`);
    const d = await query(\`DELETE FROM bms_written_by_delete WHERE id = $1\`);
    const e = await query(\`SELECT 1 FROM bms_left AS l JOIN bms_joined j ON j.id = l.id\`);
    const f = await query(\`
      WITH scoped AS MATERIALIZED (SELECT id FROM bms_cte_source)
      SELECT * FROM scoped
    \`);
    const g = await query(\`
      SELECT s.* FROM bms_locked s
       WHERE s.size IS NOT DISTINCT FROM i.size
       FOR UPDATE OF s SKIP LOCKED
    \`);
    const h = await query(\`
      INSERT INTO bms_upserted (id) VALUES ($1)
      ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
    \`);
    const i = await query(\`SELECT indexname FROM pg_indexes WHERE tablename = $1\`);
    const j = await query(\`SELECT * FROM bms_claim_due_work($1)\`);
  `;

  const found = relationsInSource(fixture);
  const names = new Set(found.map((ref) => ref.relation));

  // Every statement shape must be seen — this is what a mistyped table hides behind.
  for (const expected of [
    "bms_read_by_select",
    "bms_written_by_update",
    "bms_written_by_insert",
    "bms_written_by_delete",
    "bms_left",
    "bms_joined",
    "bms_cte_source",
    "bms_locked",
    "bms_upserted",
  ]) {
    assert.ok(names.has(expected), `scanner missed ${expected} — a whole SQL shape is unchecked`);
  }

  // And every non-relation must stay out, or the real test drowns in noise and gets deleted.
  for (const notARelation of [
    "bms_a_comment_table",       // SQL quoted inside a line comment
    "bms_a_block_comment_table", // SQL quoted inside a block comment
    "scoped",              // the statement's own CTE
    "i",                   // `IS NOT DISTINCT FROM i.size` is a column
    "s",                   // `FOR UPDATE OF s`
    "set",                 // `DO UPDATE SET`
    "excluded",
    "pg_indexes",          // Postgres provides it
    "bms_claim_due_work",  // table-valued function call, not a relation
  ]) {
    assert.ok(!names.has(notARelation), `scanner wrongly treated "${notARelation}" as a table`);
  }
});

test("the schema side knows the table the board-game bug missed", () => {
  const known = knownRelations();
  const refs = referencedRelations();

  assert.ok(known.has("bms_store_profile"), "bms_store_profile should be a known relation");
  assert.ok(!known.has("bms_store_profiles"), "bms_store_profiles must not exist — it is the typo");
  // `create_revision_trigger('x')` builds `x_revisions` with no CREATE TABLE anywhere.
  assert.ok(known.has("bms_customers_revisions"), "revision companions must be resolved");
  assert.ok(
    refs.some((ref) => ref.relation === "bms_store_profile"),
    "expected at least one query to read bms_store_profile"
  );
});
