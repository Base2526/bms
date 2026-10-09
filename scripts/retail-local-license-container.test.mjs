// Docker is required. This runs isolated mailbox probes, never the shop stack.
// BMS_LICENSE_SMOKE_IMAGE may name an already-built Web image for release verification.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const image = process.env.BMS_LICENSE_SMOKE_IMAGE || "node:22-bookworm-slim";
const testEnv = { ...process.env, COMPOSE_ENV_FILES: "", COMPOSE_DISABLE_ENV_FILE: "1" };
for (const key of ["POSTGRES_DB", "POSTGRES_PASSWORD", "REDIS_PASSWORD", "JWT_SECRET",
  "BMS_SECRET_KEY", "BMS_CHECKOUT_SECRET", "BMS_CRON_SECRET", "BMS_JOB_TOKEN"]) {
  testEnv[key] = "mailbox-smoke-only";
}
for (const key of ["BMS_WEB_IMAGE_REF", "BMS_WS_IMAGE_REF", "BMS_POSTGRES_IMAGE_REF", "BMS_REDIS_IMAGE_REF"]) {
  testEnv[key] = image;
}
function docker(args, input) {
  const result = spawnSync("docker", args, { input, env: testEnv, encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return result.stdout;
}

const composeFiles = process.env.BMS_LICENSE_SMOKE_COMPOSE
  ? [process.env.BMS_LICENSE_SMOKE_COMPOSE]
  : ["deploy/retail-local/compose.yml", "deploy/retail-local/managed-runtime/compose.managed.yml"];
for (const compose of composeFiles) {
  test(`${compose}: host status reaches Web and Web requests reach host`, () => {
    const root = mkdtempSync(path.join(tmpdir(), "bms-license-mount-"));
    try {
      const envFile = path.join(root, "empty.env");
      writeFileSync(envFile, "");
      const config = JSON.parse(docker(["compose", "--env-file", envFile, "--project-directory", root,
        "-f", path.resolve(repo, compose), "config", "--format", "json"]));
      const web = config.services.web;
      const mailbox = web.environment.BMS_LOCAL_LICENSE_UI_DIR;
      assert.equal(mailbox, "/run/bms-license-ui", "Web must receive the mailbox path");
      const volumes = ["status", "requests"].map(name => {
        const mount = web.volumes.find(v => v.target === `${mailbox}/${name}`);
        assert.ok(mount, `Web is missing the ${name} mount`);
        assert.equal(mount.type, "bind");
        assert.equal(path.resolve(mount.source), path.join(root, "license-ui", name));
        assert.equal(Boolean(mount.read_only), name === "status");
        mkdirSync(mount.source, { recursive: true });
        return ["--mount", `type=bind,source=${mount.source},target=${mount.target}${mount.read_only ? ",readonly" : ""}`];
      }).flat();
      // Mount only the resolved mailbox directories, never shop storage or host credentials.
      const snapshot = { tenantId: "smoke-tenant", available: true, registered: false, heartbeat: new Date().toISOString() };
      const statusPath = path.join(root, "license-ui/status/view.json");
      writeFileSync(statusPath, JSON.stringify(snapshot));
      const requestId = randomUUID();
      const request = { requestId, tenantId: snapshot.tenantId, activationCode: "bmsla_" + "x".repeat(43) };
      const runProbe = code => {
        const name = `bms-license-smoke-${randomUUID()}`;
        // Keep private (0600) requests readable by this test's host user on Linux CI.
        const user = process.getuid ? ["--user", `${process.getuid()}:${process.getgid()}`] : [];
        try {
          return docker(["run", "--rm", "-i", "--name", name, "--network", "none", "--read-only",
            "--cap-drop=ALL", ...user, ...volumes, "-e", `BMS_LOCAL_LICENSE_UI_DIR=${mailbox}`,
            "--entrypoint", "node", image, "--input-type=module", "-"], code);
        } finally {
          // Handles a timed-out probe too. This exact name belongs only to this test.
          spawnSync("docker", ["rm", "-f", name], { encoding: "utf8", timeout: 10_000 });
        }
      };
      const imports = `import assert from 'node:assert/strict'; import fs from 'node:fs';
        const root = process.env.BMS_LOCAL_LICENSE_UI_DIR;`;
      runProbe(`${imports}
        assert.deepEqual(JSON.parse(fs.readFileSync(root + '/status/view.json')), ${JSON.stringify(snapshot)});
        assert.throws(() => fs.writeFileSync(root + '/status/forbidden.json', '{}'), { code: 'EROFS' });
        const destination = root + '/requests/activation.json';
        fs.writeFileSync(destination + '.tmp', JSON.stringify(${JSON.stringify(request)}), { mode: 0o600 });
        fs.renameSync(destination + '.tmp', destination);
      `);
      const requestPath = path.join(root, "license-ui/requests/activation.json");
      assert.deepEqual(JSON.parse(readFileSync(requestPath, "utf8")), request);
      // Host consumes the code and atomically replaces status, as the agent does.
      writeFileSync(requestPath, JSON.stringify({ ...request, activationCode: "" }));
      const completed = { ...snapshot, registered: true, requestId, requestStatus: "SUCCEEDED" };
      writeFileSync(statusPath + ".tmp", JSON.stringify(completed));
      renameSync(statusPath + ".tmp", statusPath);
      runProbe(`${imports}
        assert.deepEqual(JSON.parse(fs.readFileSync(root + '/status/view.json')), ${JSON.stringify(completed)});
        assert.equal(JSON.parse(fs.readFileSync(root + '/requests/activation.json')).activationCode, '');
      `);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
