import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";

import { closeDatabasePool, getClient } from "../apps/web/lib/db.ts";
import { inferRetailLocalInstallerIdentity } from "../apps/web/lib/bms/retailLocalReleaseFilename.ts";

after(closeDatabasePool);

test("10.139 hides corrupt legacy identities without relabeling and is idempotent", async () => {
  const client = await getClient();
  const schema = `retail_release_identity_${crypto.randomUUID().replaceAll("-", "")}`;
  const migration = await readFile(
    new URL("../db/migrations/10.139__bms_retail_local_release_identity.sql", import.meta.url),
    "utf8",
  );
  const ids = new Map<string, string>();
  const fileIds = new Map<string, number>();
  let nextFile = 1;
  const version = "0.2.14-pilot.13";
  const name = (kind: "POS" | "Server" | "Server-POS", target = "windows-x64", ext = "exe") =>
    `BMS-POS-Plus-Retail-Local-${kind}-${version}-${target}.${ext}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await client.query(`
      CREATE TABLE files (
        id integer PRIMARY KEY, original_name text, filename text, relpath text,
        size bigint, checksum text, deleted_at timestamptz
      );
      CREATE TABLE bms_retail_local_release_assets (
        id uuid PRIMARY KEY, file_id integer NOT NULL, platform text NOT NULL,
        package_type text NOT NULL, version text NOT NULL, original_name text NOT NULL,
        size_bytes bigint NOT NULL, sha256 text NOT NULL,
        status text NOT NULL, is_latest boolean NOT NULL
      );
    `);

    const addFile = async (key: string, originalName: string, options: { size?: number; sha?: string; deleted?: boolean } = {}) => {
      const id = nextFile++;
      fileIds.set(key, id);
      const extensionAt = originalName.lastIndexOf(".");
      const storedName = `${Date.now()}-${originalName.slice(0, extensionAt)}-${crypto.randomUUID()}${originalName.slice(extensionAt)}`;
      await client.query(
        `INSERT INTO files(id,original_name,filename,relpath,size,checksum,deleted_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [id, originalName, storedName, `fixture/${storedName}`, options.size ?? 10,
          options.sha ?? "a".repeat(64), options.deleted ? new Date() : null],
      );
      return id;
    };
    const addRelease = async (key: string, input: {
      fileId: number; filename: string; platform: string; packageType: string;
      version?: string; latest?: boolean;
    }) => {
      const id = crypto.randomUUID();
      ids.set(key, id);
      await client.query(
        `INSERT INTO bms_retail_local_release_assets
           (id,file_id,platform,package_type,version,original_name,size_bytes,sha256,status,is_latest)
         VALUES($1,$2,$3,$4,$5,$6,10,$7,$8,$9)`,
        [id, input.fileId, input.platform, input.packageType, input.version ?? version,
          input.filename, "a".repeat(64), input.latest ? "latest" : "supported", input.latest ?? false],
      );
    };

    const validPosFile = await addFile("valid-pos", name("POS"));
    await addRelease("valid-pos", { fileId: validPosFile, filename: name("POS"), platform: "windows-x64", packageType: "pos", latest: true });
    const validServerFile = await addFile("valid-server", name("Server"));
    await addRelease("valid-server", { fileId: validServerFile, filename: name("Server"), platform: "windows-x64", packageType: "server", latest: true });

    const wrongPackageFile = await addFile("wrong-package", name("Server"));
    await addRelease("wrong-package", { fileId: wrongPackageFile, filename: name("Server"), platform: "windows-x64", packageType: "pos" });
    const wrongFileName = await addFile("wrong-file-name", name("Server"));
    await addRelease("wrong-file-name", { fileId: wrongFileName, filename: name("POS"), platform: "windows-x64", packageType: "pos" });
    const wrongSize = await addFile("wrong-size", name("POS"), { size: 11 });
    await addRelease("wrong-size", { fileId: wrongSize, filename: name("POS"), platform: "windows-x64", packageType: "pos" });
    const wrongSha = await addFile("wrong-sha", name("POS"), { sha: "b".repeat(64) });
    await addRelease("wrong-sha", { fileId: wrongSha, filename: name("POS"), platform: "windows-x64", packageType: "pos" });
    const wrongRelpath = await addFile("wrong-relpath", name("POS"));
    const serverPathName = `1790000000000-${name("Server").slice(0, -4)}-${crypto.randomUUID()}.exe`;
    await client.query("UPDATE files SET filename=$2,relpath=$3 WHERE id=$1", [wrongRelpath, serverPathName, `fixture/${serverPathName}`]);
    await addRelease("wrong-relpath", { fileId: wrongRelpath, filename: name("POS"), platform: "windows-x64", packageType: "pos" });
    const wrongStoredName = await addFile("wrong-stored-name", name("POS"));
    await client.query("UPDATE files SET filename='different-storage-name.exe' WHERE id=$1", [wrongStoredName]);
    await addRelease("wrong-stored-name", { fileId: wrongStoredName, filename: name("POS"), platform: "windows-x64", packageType: "pos" });
    const deleted = await addFile("deleted", name("POS"), { deleted: true });
    await addRelease("deleted", { fileId: deleted, filename: name("POS"), platform: "windows-x64", packageType: "pos" });
    await addRelease("missing-file", { fileId: 999999, filename: name("POS"), platform: "windows-x64", packageType: "pos" });
    const x86Server = name("Server", "windows-x86-legacy");
    const x86ServerFile = await addFile("x86-server", x86Server);
    await addRelease("x86-server", { fileId: x86ServerFile, filename: x86Server, platform: "windows-x86-legacy", packageType: "server" });
    const malformed = "BMS-POS-Plus-Retail-Local-POS-not-semver-windows-x64.exe";
    const malformedFile = await addFile("malformed", malformed);
    await addRelease("malformed", { fileId: malformedFile, filename: malformed, platform: "windows-x64", packageType: "pos", version: "not-semver" });

    const shared = await addFile("shared", name("Server"));
    await addRelease("shared-server", { fileId: shared, filename: name("Server"), platform: "macos-x64", packageType: "server" });
    await addRelease("shared-pos", { fileId: shared, filename: name("POS", "macos-x64", "dmg"), platform: "macos-x64", packageType: "pos" });

    for (const key of ["duplicate-a", "duplicate-b"]) {
      const filename = name("Server-POS", "linux-x64", "deb");
      const fileId = await addFile(key, filename);
      await addRelease(key, { fileId, filename, platform: "ubuntu-x64", packageType: "server-pos", latest: true });
    }

    await client.query(migration);
    await client.query(migration);

    const result = await client.query<{ id: string; package_type: string; status: string; is_latest: boolean }>(
      "SELECT id,package_type,status,is_latest FROM bms_retail_local_release_assets",
    );
    const byId = new Map(result.rows.map((row) => [row.id, row]));
    for (const key of ["valid-pos", "valid-server"]) {
      const row = byId.get(ids.get(key)!)!;
      assert.equal(row.status, "latest", key);
      assert.equal(row.is_latest, true, key);
    }
    for (const key of [...ids.keys()].filter((key) => !key.startsWith("valid-"))) {
      const row = byId.get(ids.get(key)!)!;
      assert.equal(row.status, "hidden", key);
      assert.equal(row.is_latest, false, key);
      if (key === "wrong-package") assert.equal(row.package_type, "pos", "migration must not relabel bytes");
    }

    const filenames = [
      name("POS"), name("Server"), name("Server-POS", "linux-x64", "deb"),
      "BMS-Retail-Local-Server-POS-0.2.14-pilot.12-arm64.pkg",
      malformed,
      "BMS-POS-Plus-Retail-Local-Server-0.2.14-windows-x64.dmg",
      "anything-windows-x64.exe",
    ];
    for (const filename of filenames) {
      const sql = (await client.query<{ package_type: string | null; platform: string | null; version: string | null }>(
        `SELECT bms_retail_local_filename_package_type($1) AS package_type,
                bms_retail_local_filename_platform($1) AS platform,
                bms_retail_local_filename_version($1) AS version`,
        [filename],
      )).rows[0];
      const ts = inferRetailLocalInstallerIdentity(filename);
      assert.deepEqual(
        [sql.package_type, sql.platform, sql.version],
        [ts?.packageType ?? null, ts?.platform ?? null, ts?.version ?? null],
        filename,
      );
    }

    const wrapped = `fixture/1790000000000-${name("POS").slice(0, -4)}-${crypto.randomUUID()}.exe`;
    assert.equal(
      (await client.query<{ original_name: string }>(
        "SELECT bms_retail_local_stored_path_original_name($1) AS original_name",
        [wrapped],
      )).rows[0].original_name,
      name("POS"),
    );

    const invalidId = crypto.randomUUID();
    await assert.rejects(
      client.query(
        `INSERT INTO bms_retail_local_release_assets
           (id,file_id,platform,package_type,version,original_name,size_bytes,sha256,status,is_latest)
         VALUES($1,$2,'windows-x64','pos','not-semver',$3,10,$4,'supported',false)`,
        [invalidId, validPosFile, malformed, "a".repeat(64)],
      ),
      /check constraint/i,
    );
  } finally {
    await client.query("RESET search_path").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    client.release();
  }
});
