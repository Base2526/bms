import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderBmsGraphqlSdl } from "../apps/web/graphql/schema";

const artifact = new URL("../schema.graphql", import.meta.url);

// Git may check an LF artifact out as CRLF on Windows. Schema drift is content drift, not an
// operating-system newline difference, so compare canonical line endings while preserving all SDL.
const canonicalLines = (text: string) => text.replace(/\r\n?/g, "\n").trimEnd();

test("committed schema.graphql matches the executable BMS GraphQL schema", async () => {
  assert.equal(
    canonicalLines(await readFile(artifact, "utf8")),
    canonicalLines(renderBmsGraphqlSdl()),
    "run `cd apps/web && npm run schema:export` and commit schema.graphql",
  );
});
