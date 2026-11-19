import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import test, { after } from "node:test";

import { closeDatabasePool, query } from "../apps/web/lib/db.ts";
import {
  openRetailLocalReleaseDownload,
  purgeRetailLocalReleaseFile,
  updateRetailLocalReleaseAsset,
} from "../apps/web/lib/bms/retailLocalReleases.ts";
import { __setStorageDriverForTest } from "../apps/web/lib/storageDrivers/index.ts";

after(async () => {
  __setStorageDriverForTest(null);
  await closeDatabasePool();
});

test("installer purge rejects a published row, removes bytes once, and retains one audited tombstone", async () => {
  const marker = randomUUID();
  const relpath = `release-purge-contract/${marker}.exe`;
  const filename = `BMS-Retail-Local-POS-${marker}.exe`;
  const size = 12_345;
  const objects = new Map<string, Buffer>([[relpath, Buffer.alloc(size, 0x42)]]);
  __setStorageDriverForTest({
    name: "release-purge-contract",
    shared: false,
    async write(key, body) { objects.set(key, Buffer.from(body)); },
    async writeStream(key, stream) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array>) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      objects.set(key, body);
      return { size: body.length, checksum: "a".repeat(64) };
    },
    async delete(key) { objects.delete(key); },
    async read(key) { return objects.get(key) ?? Buffer.alloc(0); },
    async stat(key) {
      const body = objects.get(key);
      return body ? { size: body.length } : null;
    },
    async openStream(key) { return Readable.from(objects.get(key) ?? Buffer.alloc(0)); },
  });

  let fileId: number | undefined;
  let releaseId: string | undefined;
  let tenantId: string | undefined;
  try {
    tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    assert.ok(tenantId, "local DB needs one tenant fixture");
    fileId = (await query<{ id: number }>(
      `INSERT INTO files(filename,original_name,mimetype,size,checksum,relpath,visibility,tenant_id)
       VALUES($1,$1,'application/vnd.microsoft.portable-executable',$2,$3,$4,'private',NULL)
       RETURNING id`,
      [filename, size, "a".repeat(64), relpath],
    )).rows[0].id;
    releaseId = (await query<{ id: string }>(
      `INSERT INTO bms_retail_local_release_assets
         (platform,package_type,version,channel,status,access_level,is_latest,file_id,original_name,
          size_bytes,sha256,min_os,release_notes)
       VALUES('windows-x64','pos',$1,'internal','supported','public',FALSE,$2,$3,$4,$5,'Windows x64','contract test')
       RETURNING id`,
      [`0.0.0-purge-${marker}`, fileId, filename, size, "a".repeat(64)],
    )).rows[0].id;

    await assert.rejects(
      purgeRetailLocalReleaseFile({ releaseId, tenantId, adminId: "contract-admin" }),
      (error: any) => error?.status === 409 && /hide the release/.test(error.message),
    );
    assert.equal(objects.get(relpath)?.length, size, "a supported installer must remain on storage");

    const hidden = await updateRetailLocalReleaseAsset(releaseId, { status: "hidden" });
    assert.equal(hidden.status, "hidden");
    const purged = await purgeRetailLocalReleaseFile({ releaseId, tenantId, adminId: "contract-admin" });
    assert.deepEqual(
      { releaseId: purged.releaseId, freedBytes: purged.freedBytes, alreadyPurged: purged.alreadyPurged },
      { releaseId, freedBytes: size, alreadyPurged: false },
    );
    assert.equal(objects.has(relpath), false);

    const tombstone = (await query<{ status: string; deleted_at: Date | null }>(
      `SELECT a.status,f.deleted_at FROM bms_retail_local_release_assets a
       JOIN files f ON f.id=a.file_id WHERE a.id=$1`,
      [releaseId],
    )).rows[0];
    assert.equal(tombstone.status, "hidden");
    assert.ok(tombstone.deleted_at);
    const audits = await query<{ size: string; freed: string }>(
      `SELECT meta->>'sizeBytes' AS size,meta->>'freedBytes' AS freed
         FROM bms_audit_log
        WHERE action='platform.retail_local_release_file.purge' AND target=$1`,
      [releaseId],
    );
    assert.deepEqual(audits.rows, [{ size: String(size), freed: String(size) }]);
    await assert.rejects(openRetailLocalReleaseDownload(releaseId), (error: any) => error?.status === 404);
    await assert.rejects(updateRetailLocalReleaseAsset(releaseId, { status: "supported" }),
      (error: any) => error?.status === 409);

    const retry = await purgeRetailLocalReleaseFile({ releaseId, tenantId, adminId: "contract-admin" });
    assert.equal(retry.alreadyPurged, true);
    assert.equal(retry.freedBytes, 0);
    assert.equal((await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bms_audit_log
        WHERE action='platform.retail_local_release_file.purge' AND target=$1`,
      [releaseId],
    )).rows[0].n, 1, "an idempotent retry must not duplicate the audit event");
  } finally {
    if (releaseId) {
      await query(`DELETE FROM bms_audit_log WHERE action='platform.retail_local_release_file.purge' AND target=$1`, [releaseId]);
      await query(`DELETE FROM bms_retail_local_release_assets WHERE id=$1`, [releaseId]);
    }
    if (fileId) await query(`DELETE FROM files WHERE id=$1`, [fileId]);
    objects.clear();
    __setStorageDriverForTest(null);
  }
});

