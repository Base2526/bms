const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");
const asar = require("@electron/asar");

// Run against the actual archive, not the source tests: an old payload can pass
// today's source tests and still hide the Admin button on Windows/Linux.
async function verifyPackagedApp(archive, sourceRoot) {
  async function checkDirectory(relative) {
    for (const entry of await readdir(path.join(sourceRoot, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await checkDirectory(name);
      else if (entry.isFile()) {
        const expected = await readFile(path.join(sourceRoot, name));
        const actual = asar.extractFile(archive, name);
        if (!actual.equals(expected)) throw new Error(`Stale desktop payload: ${name}`);
      } else throw new Error(`Unsupported desktop source entry: ${name}`);
    }
  }
  await checkDirectory("src");
  await checkDirectory("renderer");
  const expected = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  const actual = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
  if (actual.version !== expected.version) throw new Error("Desktop payload version differs from source");
}

module.exports = async function afterPack(context) {
  const resources = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  await verifyPackagedApp(path.join(resources, "app.asar"), context.packager.projectDir);
  console.log("Verified packaged desktop source and version (including setup Admin action).");
};
module.exports.verifyPackagedApp = verifyPackagedApp;
