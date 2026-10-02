import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import asar from "@electron/asar";
import hook from "../scripts/verify-packaged-app.cjs";

test("packaged-source gate rejects stale renderer, IPC and version bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bms-desktop-payload-"));
  try {
    const source = path.join(root, "source");
    await mkdir(path.join(source, "renderer"), { recursive: true });
    await mkdir(path.join(source, "renderer/fonts"));
    await mkdir(path.join(source, "src"));
    await writeFile(path.join(source, "renderer/setup.html"), '<button id="local-admin-button">Admin</button>');
    await writeFile(path.join(source, "renderer/fonts/fonts.css"), "/* bundled fonts */");
    await writeFile(path.join(source, "src/preload.cjs"), "exports.openLocalAdmin = true;");
    await writeFile(path.join(source, "package.json"), JSON.stringify({ version: "1.0.0" }));
    const archive = path.join(root, "app.asar");
    await asar.createPackage(source, archive);
    await hook.verifyPackagedApp(archive, source);
    for (const [file, replacement] of [
      ["renderer/setup.html", "old setup"],
      ["renderer/fonts/fonts.css", "old fonts"],
      ["src/preload.cjs", "old IPC"],
      ["package.json", JSON.stringify({ version: "1.0.1" })],
    ]) {
      const original = await readFile(path.join(source, file));
      await writeFile(path.join(source, file), replacement);
      await assert.rejects(hook.verifyPackagedApp(archive, source), /Stale desktop payload|version differs/);
      await writeFile(path.join(source, file), original);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
