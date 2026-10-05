import sharp from "sharp";
import { getClient, query } from "@/lib/db";
import { buildFileUrlById, persistBuffer } from "@/lib/storage";
import { beginTenantTx } from "./tenant";
import { requireBoardGameCafeTenant } from "./boardGameCafe";

export const BOARD_GAME_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export async function prepareBoardGameImage(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > BOARD_GAME_IMAGE_MAX_BYTES) throw new Error("รูปเกมต้องไม่เกิน 5MB");
  const image = sharp(bytes, { limitInputPixels: 20_000_000 });
  const meta = await image.metadata();
  if (!meta.format || !["png", "jpeg", "webp"].includes(meta.format) || (meta.pages ?? 1) > 1) {
    throw new Error("รองรับภาพนิ่ง PNG, JPG และ WebP เท่านั้น");
  }
  return image.rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).webp().toBuffer();
}

export async function setBoardGameTitleImage(tenantId: string, titleId: string, bytes: Buffer | null, actorId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(titleId)) {
    throw new Error("รหัสเกมไม่ถูกต้อง");
  }
  const normalized = bytes === null ? null : await prepareBoardGameImage(bytes);
  await requireBoardGameCafeTenant({ query }, tenantId);
  const owned = await query(`SELECT id FROM bms_board_game_titles WHERE tenant_id=$1 AND id=$2`, [tenantId, titleId]);
  if (!owned.rowCount) throw new Error("ไม่พบเกมในร้านนี้");
  const schema = await query(`SELECT 1 FROM pg_attribute WHERE attrelid='bms_board_game_titles'::regclass
    AND attname='image_file_id' AND NOT attisdropped`);
  if (!schema.rowCount) throw new Error("ต้องอัปเดตฐานข้อมูล 10.42 ก่อนเพิ่มรูปเกม");
  // Storage uses its own connection; finish it before borrowing a transaction connection.
  // Only decoded catalogue artwork is public. The caller never supplies a file ID or URL.
  const file = normalized ? await persistBuffer(normalized, `game-${titleId}.webp`, "image/webp", "public", tenantId) : null;
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    await requireBoardGameCafeTenant(client, tenantId);
    const title = await client.query(`SELECT id FROM bms_board_game_titles WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, titleId]);
    if (!title.rowCount) throw new Error("ไม่พบเกมในร้านนี้");
    await client.query(`UPDATE bms_board_game_titles SET image_file_id=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [tenantId, titleId, file?.id ?? null]);
    await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
      VALUES($1,$2,'board_game.title_image',$3,$4::jsonb)`,
      [tenantId, `user:${actorId}`, titleId, JSON.stringify({ fileId: file?.id ?? null })]);
    await client.query("COMMIT");
    return { imageUrl: file ? buildFileUrlById(file.id) : null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
