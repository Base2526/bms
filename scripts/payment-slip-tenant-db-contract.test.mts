// =============================================================
// A payment slip is read only from the paying shop's own files.
// -------------------------------------------------------------
// bms_payments.slip_url is free text from payment.submit (REST body / GraphQL arg). Slip OCR turns
// "/api/files/<id>" into image bytes and sends them to an AI provider, then returns the extracted
// fields to the caller. Before 2026-11-24 the files lookup used the id alone, so a slip URL naming
// another shop's private file was read and its contents came back to the wrong shop.
//
// Real storage driver + real files rows on a local throwaway database; no AI provider is called.
// =============================================================
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { deleteStoredFile, persistBuffer } from "../apps/web/lib/storage.ts";
import { loadSlipImage } from "../apps/web/lib/bms/payments.ts";
import type { SlipReader } from "../apps/web/lib/bms/slipReader.ts";

const sharp = createRequire(new URL("../apps/web/package.json", import.meta.url))("sharp");

const reader: SlipReader = {
  provider: "contract-test",
  read: async () => {
    throw new Error("the contract never calls a provider");
  },
};

test("slip OCR loads the paying shop's own file and never another shop's", async () => {
  const tenants = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 2`)).rows;
  assert.equal(tenants.length, 2, "needs two tenants in the restored database");
  const [own, other] = tenants.map((row) => row.id);
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const ownFile = await persistBuffer(png, "FAKE-slip-own.png", "image/png", "private", own);
  const otherFile = await persistBuffer(png, "FAKE-slip-other.png", "image/png", "private", other);
  try {
    const mine = await loadSlipImage(own, `/api/files/${ownFile.id}`, reader);
    assert.ok(mine?.base64, "the shop's own slip image must still load");
    assert.equal(
      await loadSlipImage(own, `/api/files/${otherFile.id}`, reader),
      null,
      "a slip URL that names another shop's file must not be read or sent to OCR"
    );
  } finally {
    for (const file of [ownFile, otherFile]) {
      await query(`DELETE FROM files WHERE id = $1`, [file.id]);
      await deleteStoredFile(file.relpath).catch(() => {});
    }
  }
});
