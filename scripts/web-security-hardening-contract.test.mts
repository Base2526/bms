import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("development database tools bind to loopback without changing localhost ports", () => {
  const compose = read("docker-compose.yml");
  assert.match(compose, /127\.0\.0\.1:\$\{POSTGRES_HOST_PORT:-5432\}:5432/);
  assert.match(compose, /127\.0\.0\.1:\$\{PGADMIN_HOST_PORT:-5050\}:80/);
  assert.doesNotMatch(compose, /^\s*-\s*"\$\{POSTGRES_HOST_PORT:-5432\}:5432"/m);
  assert.doesNotMatch(compose, /^\s*-\s*"\$\{PGADMIN_HOST_PORT:-5050\}:80"/m);
});

test("Next.js does not advertise itself and auth sessions do not expose provider credentials", () => {
  const config = read("apps/web/next.config.js");
  const options = read("apps/web/lib/auth/options.ts");
  const sessionTypes = read("apps/web/types/next-auth.d.ts");
  assert.match(config, /poweredByHeader:\s*false/);
  const sessionCallback = options.slice(options.indexOf("async session"));
  assert.doesNotMatch(sessionCallback, /session as any\)\.accessToken/);
  assert.doesNotMatch(sessionCallback, /session as any\)\.refreshToken/);
  const sessionDeclaration = sessionTypes.slice(
    sessionTypes.indexOf("interface Session"),
    sessionTypes.indexOf("declare module \"next-auth/jwt\"")
  );
  assert.doesNotMatch(sessionDeclaration, /accessToken|refreshToken/);
});

test("internet-facing framework dependencies stay on the reviewed security patch line", () => {
  const packageJson = JSON.parse(read("apps/web/package.json"));
  assert.equal(packageJson.dependencies.next, "14.2.35");
  assert.equal(packageJson.dependencies["next-auth"], "^4.24.15");
});
