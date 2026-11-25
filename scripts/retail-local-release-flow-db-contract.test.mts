import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import test, { after } from "node:test";

import { closeDatabasePool, query } from "../apps/web/lib/db.ts";
import {
  createRetailLocalReleaseAsset,
  getDesktopReleaseUpdates,
  getPublicRetailLocalDownloads,
  listRetailLocalReleaseAssets,
  openRetailLocalReleaseDownload,
  updateRetailLocalReleaseAsset,
} from "../apps/web/lib/bms/retailLocalReleases.ts";
import { selectDesktopUpdates } from "../apps/web/lib/bms/desktopReleasePolicy.ts";
import { __setStorageDriverForTest } from "../apps/web/lib/storageDrivers/index.ts";
import { buildRetailLocalDownloadResponse } from "../apps/web/lib/bms/retailLocalReleaseDownloadResponse.ts";

after(async () => {
  __setStorageDriverForTest(null);
  await closeDatabasePool();
});

test("POS, Server, and Server-POS keep independent rows, latest state, and download bytes", async () => {
  const objects = new Map<string, Buffer>();
  __setStorageDriverForTest({
    name: "retail-local-release-flow", shared: false,
    async write(key, body) { objects.set(key, Buffer.from(body)); },
    async delete(key) { objects.delete(key); },
    async writeStream() { throw new Error("not used"); },
    async read(key) { return objects.get(key) ?? Buffer.alloc(0); },
    async stat(key) { const body = objects.get(key); return body ? { size: body.length } : null; },
    async openStream(key) { return Readable.from(objects.get(key) ?? Buffer.alloc(0)); },
  });

  const user = (await query<{ id: string }>("SELECT id FROM users ORDER BY id LIMIT 1")).rows[0];
  assert.ok(user?.id, "local DB needs one user fixture");
  const suffix = `${Date.now()}`;
  const version = `0.2.99-releaseflow.${suffix}`;
  const created: Array<{ id: string; file_id: number; package_type: string }> = [];
  const fileIds: number[] = [];
  try {
    for (const packageType of ["pos", "server", "server-pos"] as const) {
      const label = packageType === "pos" ? "POS" : packageType === "server" ? "Server" : "Server-POS";
      const filename = `BMS-POS-Plus-Retail-Local-${label}-${version}-windows-x64.exe`;
      const bytes = Buffer.from(`${packageType}-fixture-${suffix}`);
      const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
      const relpath = `release-flow-contract/${filename}`;
      objects.set(relpath, bytes);
      const release = await createRetailLocalReleaseAsset({
        storedFile: {
          filename, original_name: filename,
          mimetype: "application/vnd.microsoft.portable-executable",
          size: bytes.length, checksum, relpath,
        },
        platform: "windows-x64", packageType, version, channel: "pilot",
        status: "latest", accessLevel: "public", isLatest: true,
        expectedSha256: checksum, minOs: "Windows x64", releaseNotes: "contract", adminId: user.id,
      });
      created.push(release);
      fileIds.push(release.file_id);
    }

    const ids = new Set(created.map((item) => item.id));
    const rows = (await listRetailLocalReleaseAssets({ includeHidden: true })).filter((row) => ids.has(row.id));
    assert.equal(rows.length, 3);
    assert.deepEqual(new Set(rows.map((row) => row.package_type)), new Set(["pos", "server", "server-pos"]));
    assert.ok(rows.every((row) => row.is_latest && row.status === "latest"));
    assert.ok(rows.every((row) => row.original_name.includes(`-${version}-`)));

    const updates = selectDesktopUpdates(rows, {
      version: "0.2.99-releaseflow.0", platform: "win32", arch: "x64",
    });
    assert.equal(updates.releases.length, 1);
    assert.equal(updates.releases[0].packageType, "pos");
    assert.match(updates.releases[0].originalFilename, /-POS-/);

    const pos = rows.find((row) => row.package_type === "pos")!;
    const server = rows.find((row) => row.package_type === "server")!;
    const opened = await openRetailLocalReleaseDownload(pos.id);
    const response = buildRetailLocalDownloadResponse(opened);
    const posBytes = Buffer.from(await response.arrayBuffer());
    assert.equal(posBytes.toString(), `${pos.package_type}-fixture-${suffix}`);
    assert.equal(opened.filename, pos.original_name);
    assert.equal(opened.sha256, crypto.createHash("sha256").update(posBytes).digest("hex"));
    assert.match(response.headers.get("content-disposition") ?? "", new RegExp(pos.original_name));
    assert.equal(response.headers.get("content-length"), String(posBytes.length));
    assert.equal(response.headers.get("x-checksum-sha256"), opened.sha256);

    const serverFile = (await query<{ original_name: string; relpath: string; size: number; checksum: string }>(
      "SELECT original_name,relpath,size,checksum FROM files WHERE id=$1", [server.file_id],
    )).rows[0];
    await query(
      "UPDATE files SET original_name=$2,relpath=$3,size=$4,checksum=$5 WHERE id=$1",
      [pos.file_id, serverFile.original_name, serverFile.relpath, serverFile.size, serverFile.checksum],
    );
    await assert.rejects(openRetailLocalReleaseDownload(pos.id), (error: any) => error?.status === 409);
    const posKey = `release-flow-contract/${pos.original_name}`;
    const posBytesForRestore = objects.get(posKey)!;
    await query(
      "UPDATE files SET original_name=$2,relpath=$3,size=$4,checksum=$5 WHERE id=$1",
      [pos.file_id, pos.original_name, posKey, posBytesForRestore.length, pos.sha256],
    );

    objects.set(posKey, Buffer.alloc(posBytesForRestore.length, 0x78));
    await assert.rejects(openRetailLocalReleaseDownload(pos.id), (error: any) => error?.status === 409);
    objects.set(posKey, Buffer.concat([posBytesForRestore, Buffer.from("x")]));
    await assert.rejects(openRetailLocalReleaseDownload(pos.id), (error: any) => error?.status === 409);
    objects.set(posKey, posBytesForRestore);

    objects.delete(posKey);
    await assert.rejects(openRetailLocalReleaseDownload(pos.id), (error: any) => error?.status === 404);
    const missingInAdmin = (await listRetailLocalReleaseAssets({ includeHidden: true, verifyStorage: true }))
      .find((row) => row.id === pos.id);
    assert.equal(missingInAdmin?.storage_present, false);
    assert.equal(missingInAdmin?.identity_consistent, false);
    const missingInPublic = await getPublicRetailLocalDownloads();
    assert.equal(missingInPublic.latest["windows-x64"]?.pos, undefined);
    assert.equal(missingInPublic.archive.some((row) => row.id === pos.id), false);
    assert.equal((await getDesktopReleaseUpdates({
      version: "0.2.99-releaseflow.0", platform: "win32", arch: "x64",
    })).status, "unavailable", "a missing object must not be advertised to Desktop");
    objects.set(posKey, posBytesForRestore);

    await updateRetailLocalReleaseAsset(pos.id, { status: "hidden", isLatest: false });
    const replacementVersion = `0.2.99-releaseflow.${suffix}.replacement`;
    const replacementName = `BMS-POS-Plus-Retail-Local-POS-${replacementVersion}-windows-x64.exe`;
    const replacementKey = `release-flow-contract/${replacementName}`;
    const replacementBytes = Buffer.from(`replacement-pos-${suffix}`);
    const replacementSha = crypto.createHash("sha256").update(replacementBytes).digest("hex");
    objects.set(replacementKey, replacementBytes);
    const replacement = await createRetailLocalReleaseAsset({
      storedFile: { filename: replacementName, original_name: replacementName,
        mimetype: "application/vnd.microsoft.portable-executable", size: replacementBytes.length,
        checksum: replacementSha, relpath: replacementKey },
      platform: "windows-x64", packageType: "pos", version: replacementVersion,
      channel: "pilot", status: "latest", accessLevel: "public", isLatest: true,
      expectedSha256: replacementSha, minOs: "Windows x64", adminId: user.id,
    });
    created.push(replacement);
    fileIds.push(replacement.file_id);
    await query("UPDATE files SET original_name=$2 WHERE id=$1", [pos.file_id, server.original_name]);
    await assert.rejects(
      updateRetailLocalReleaseAsset(pos.id, { status: "latest", isLatest: true }),
      (error: any) => error?.status === 409,
      "a corrupt tombstone must not demote the good latest row or become latest again",
    );
    const replacementAfter = (await listRetailLocalReleaseAssets({ includeHidden: true }))
      .find((row) => row.id === replacement.id);
    assert.equal(replacementAfter?.is_latest, true);
    assert.equal(replacementAfter?.status, "latest");
    await query("UPDATE files SET original_name=$2 WHERE id=$1", [pos.file_id, pos.original_name]);

    const concurrent = await Promise.allSettled([1, 2].map(async (index) => {
      const concurrentVersion = `0.2.99-concurrent.${suffix}.${index}`;
      const concurrentName = `BMS-POS-Plus-Retail-Local-Server-POS-${concurrentVersion}-linux-x64.deb`;
      const concurrentKey = `release-flow-contract/${concurrentName}`;
      const concurrentBytes = Buffer.from(`concurrent-${index}-${suffix}`);
      const concurrentSha = crypto.createHash("sha256").update(concurrentBytes).digest("hex");
      objects.set(concurrentKey, concurrentBytes);
      return createRetailLocalReleaseAsset({
        storedFile: { filename: concurrentName, original_name: concurrentName,
          mimetype: "application/vnd.debian.binary-package", size: concurrentBytes.length,
          checksum: concurrentSha, relpath: concurrentKey },
        platform: "ubuntu-x64", packageType: "server-pos", version: concurrentVersion,
        channel: "pilot", status: "latest", accessLevel: "public", isLatest: true,
        expectedSha256: concurrentSha, minOs: "Ubuntu x64", adminId: user.id,
      });
    }));
    const concurrentWinners = concurrent.filter((item): item is PromiseFulfilledResult<any> => item.status === "fulfilled");
    assert.ok(concurrentWinners.length >= 1, "at least one concurrent publish must commit");
    created.push(...concurrentWinners.map((item) => item.value));
    fileIds.push(...concurrentWinners.map((item) => item.value.file_id));
    const concurrentRows = (await listRetailLocalReleaseAssets({ includeHidden: true }))
      .filter((row) => row.platform === "ubuntu-x64" && row.package_type === "server-pos"
        && row.version.startsWith(`0.2.99-concurrent.${suffix}.`));
    assert.equal(concurrentRows.filter((row) => row.is_latest).length, 1);
    assert.equal(
      [...objects.keys()].filter((key) => key.includes(`0.2.99-concurrent.${suffix}.`)).length,
      concurrentWinners.length,
      "any rejected concurrent request cleans only its own object",
    );

    const rollbackName = `BMS-POS-Plus-Retail-Local-POS-0.2.99-rollback.${suffix}-windows-x64.exe`;
    const rollbackKey = `release-flow-contract/${rollbackName}`;
    const rollbackBytes = Buffer.from("rollback-fixture");
    const rollbackSha = crypto.createHash("sha256").update(rollbackBytes).digest("hex");
    objects.set(rollbackKey, rollbackBytes);
    await assert.rejects(createRetailLocalReleaseAsset({
      storedFile: { filename: rollbackName, original_name: rollbackName,
        mimetype: "application/vnd.microsoft.portable-executable", size: rollbackBytes.length,
        checksum: rollbackSha, relpath: rollbackKey },
      platform: "windows-x64", packageType: "pos", version: `0.2.99-rollback.${suffix}`,
      channel: "pilot", status: "supported", accessLevel: "public", isLatest: false,
      expectedSha256: rollbackSha, minOs: "Windows x64", adminId: crypto.randomUUID(),
    }));
    assert.equal(objects.has(rollbackKey), false, "rolled-back metadata must clean only its new object");
    assert.equal(Number((await query("SELECT count(*) FROM files WHERE relpath=$1", [rollbackKey])).rows[0].count), 0);

    const mismatchedVersion = `0.2.99-path-mismatch.${suffix}`;
    const mismatchedOriginal = `BMS-POS-Plus-Retail-Local-POS-${mismatchedVersion}-windows-x64.exe`;
    const mismatchedStoredName = `BMS-POS-Plus-Retail-Local-Server-${mismatchedVersion}-windows-x64.exe`;
    const mismatchedKey = `release-flow-contract/${mismatchedStoredName}`;
    const mismatchedBytes = Buffer.from("path-mismatch-fixture");
    const mismatchedSha = crypto.createHash("sha256").update(mismatchedBytes).digest("hex");
    objects.set(mismatchedKey, mismatchedBytes);
    await assert.rejects(createRetailLocalReleaseAsset({
      storedFile: { filename: mismatchedStoredName, original_name: mismatchedOriginal,
        mimetype: "application/vnd.microsoft.portable-executable", size: mismatchedBytes.length,
        checksum: mismatchedSha, relpath: mismatchedKey },
      platform: "windows-x64", packageType: "pos", version: mismatchedVersion,
      channel: "pilot", status: "supported", accessLevel: "public", isLatest: false,
      expectedSha256: mismatchedSha, minOs: "Windows x64", adminId: user.id,
    }), /stored installer path does not match/);
    assert.equal(objects.has(mismatchedKey), false);
    assert.equal(Number((await query("SELECT count(*) FROM files WHERE relpath=$1", [mismatchedKey])).rows[0].count), 0);
  } finally {
    if (created.length) await query("DELETE FROM bms_retail_local_release_assets WHERE id = ANY($1::uuid[])", [created.map((item) => item.id)]);
    if (fileIds.length) await query("DELETE FROM files WHERE id = ANY($1::int[])", [fileIds]);
    objects.clear();
    __setStorageDriverForTest(null);
  }
});
