// =============================================================
// BMS Products — bulk CSV/XLSX import (preview + commit)
// -------------------------------------------------------------
// ไม่ทำ logic ซ้ำกับ upsertProduct(): validate ด้วย validateProductFields()
// ตัวเดียวกันทั้ง preview (commit:false) และ commit (commit:true) กัน 2 เส้นทาง
// drift กัน, เขียนจริงด้วย upsertProduct() เดิม ทีละแถว
// =============================================================

import { randomUUID } from "crypto";
import { query } from "@/lib/db";
import { getTenantPlan } from "./plans";
import {
  upsertProduct,
  validateProductFields,
  type UpsertProductInput,
  type NormalizedProductFields,
} from "./products";
import { PRODUCT_IMPORT_MAX_ROWS } from "./productImport.constants";

export type ImportRowInput = { rowNumber: number } & UpsertProductInput;

export type ImportRowResult = {
  rowNumber: number;
  sku: string | null;
  action: "CREATE" | "UPDATE" | "ERROR";
  error: string | null;
};

export type ImportResult = {
  rows: ImportRowResult[];
  quotaExceeded: boolean;
  quotaMessage: string | null;
  createCount: number;
  updateCount: number;
  errorCount: number;
};

export async function runImport(
  tenantId: string,
  rows: ImportRowInput[],
  opts: { commit: boolean; editorId?: string | number | null }
): Promise<ImportResult> {
  if (rows.length > PRODUCT_IMPORT_MAX_ROWS) {
    throw new Error(`นำเข้าได้สูงสุดครั้งละ ${PRODUCT_IMPORT_MAX_ROWS} รายการ`);
  }

  // 1) validate ทีละแถว (ไม่แตะ DB) + กัน SKU ซ้ำในไฟล์เดียวกัน (แถวแรกชนะ ที่เหลือ flag เป็น error)
  const seenSku = new Map<string, number>(); // sku -> แถวแรกที่เจอ
  const results: ImportRowResult[] = [];
  const validated: Array<{ rowNumber: number; fields: NormalizedProductFields; input: UpsertProductInput }> = [];

  for (const row of rows) {
    try {
      const fields = validateProductFields(row);
      const firstRow = seenSku.get(fields.sku);
      if (firstRow != null) {
        results.push({
          rowNumber: row.rowNumber,
          sku: fields.sku,
          action: "ERROR",
          error: `SKU ซ้ำกับแถวที่ ${firstRow} ในไฟล์นี้ — จะไม่ถูกนำเข้า`,
        });
        continue;
      }
      seenSku.set(fields.sku, row.rowNumber);
      validated.push({ rowNumber: row.rowNumber, fields, input: row });
    } catch (err: any) {
      results.push({
        rowNumber: row.rowNumber,
        sku: typeof row.sku === "string" ? row.sku.trim() || null : null,
        action: "ERROR",
        error: err?.message || "ข้อมูลไม่ถูกต้อง",
      });
    }
  }

  // 2) แยก CREATE/UPDATE ด้วย query เดียว (ไม่ query ทีละแถว)
  let existingSkus = new Set<string>();
  if (validated.length > 0) {
    const skus = validated.map((v) => v.fields.sku);
    const res = await query<{ sku: string }>(
      `SELECT sku FROM bms_products WHERE tenant_id = $1 AND sku = ANY($2::text[])`,
      [tenantId, skus]
    );
    existingSkus = new Set(res.rows.map((r) => r.sku));
  }
  const newSkuCount = validated.filter((v) => !existingSkus.has(v.fields.sku)).length;

  // 3) จำลองโควตาแบบ all-or-nothing — เกิน = บล็อกทั้ง batch ไม่ใช่เอาแค่ N แถวแรก
  let quotaExceeded = false;
  let quotaMessage: string | null = null;
  if (newSkuCount > 0) {
    const plan = await getTenantPlan(tenantId);
    if (plan.max_products >= 0) {
      const countRes = await query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM bms_products WHERE tenant_id = $1`,
        [tenantId]
      );
      const currentCount = countRes.rows[0]?.c ?? 0;
      if (currentCount + newSkuCount > plan.max_products) {
        quotaExceeded = true;
        quotaMessage =
          `การนำเข้านี้จะทำให้เกินโควตาแพ็กเกจ ${plan.name} (สูงสุด ${plan.max_products} รายการ, ` +
          `ปัจจุบันมี ${currentCount} รายการ, ไฟล์นี้จะสร้างใหม่ ${newSkuCount} รายการ) — ` +
          `ลดจำนวนรายการที่สร้างใหม่ หรืออัปเกรดแพ็กเกจ`;
      }
    }
  }

  if (!opts.commit || quotaExceeded) {
    // preview เฉยๆ หรือ quota เกิน (บล็อกทั้ง batch ไม่เขียน DB เลย) — รายงานสถานะที่ "จะเกิดขึ้น" เท่านั้น
    for (const v of validated) {
      const isCreate = !existingSkus.has(v.fields.sku);
      results.push({
        rowNumber: v.rowNumber,
        sku: v.fields.sku,
        action: isCreate ? "CREATE" : "UPDATE",
        error:
          quotaExceeded && isCreate
            ? "เกินโควตา — จะไม่ถูกนำเข้าจนกว่าจะลดจำนวนหรืออัปเกรดแพ็กเกจ"
            : null,
      });
    }
  } else {
    // commit จริง — loop upsertProduct() เดิมทีละแถว (partial success ต่อแถว), รวม UPDATE ทั้ง batch
    // เข้า revision_id เดียวกันเพื่อดูย้อนหลังเป็นชุดเดียวได้ (revision trigger fire เฉพาะ UPDATE)
    const revisionId = randomUUID();
    for (const v of validated) {
      try {
        await upsertProduct(tenantId, v.input, opts.editorId, revisionId);
        results.push({
          rowNumber: v.rowNumber,
          sku: v.fields.sku,
          action: existingSkus.has(v.fields.sku) ? "UPDATE" : "CREATE",
          error: null,
        });
      } catch (err: any) {
        results.push({
          rowNumber: v.rowNumber,
          sku: v.fields.sku,
          action: "ERROR",
          error: err?.message || "นำเข้าแถวนี้ไม่สำเร็จ",
        });
      }
    }
  }

  results.sort((a, b) => a.rowNumber - b.rowNumber);
  const createCount = results.filter((r) => r.action === "CREATE").length;
  const updateCount = results.filter((r) => r.action === "UPDATE").length;
  const errorCount = results.filter((r) => r.action === "ERROR").length;

  return { rows: results, quotaExceeded, quotaMessage, createCount, updateCount, errorCount };
}
