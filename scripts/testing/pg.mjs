// Resolve DB-test dependencies from the workspace package that owns them.
// Test files live one directory above apps/web, so a bare `pg` import is not
// resolvable on clean installs where node_modules is intentionally not hoisted.
import { createRequire } from "node:module";

const requireFromWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
export const { Pool } = requireFromWeb("pg");
