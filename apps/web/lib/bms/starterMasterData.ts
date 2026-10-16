import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type StarterCategoryApplyResult = {
  archetype: string;
  appliedCount: number;
  createdCount: number;
  categories: Array<{ id: string; name: string }>;
};

export async function applyStarterCategoriesInTx(
  client: PoolClient,
  tenantId: string,
  actorId?: string | null,
): Promise<StarterCategoryApplyResult> {
  const profile = await client.query<{ business_archetype: string | null; country: string | null }>(
    `SELECT business_archetype, country FROM bms_store_profile WHERE tenant_id=$1 FOR SHARE`,
    [tenantId],
  );
  const archetype = profile.rows[0]?.business_archetype;
  if (!archetype) throw new Error("กรุณาเลือกประเภทร้านก่อนใช้หมวดหมู่ตั้งต้น");
  const templates = await client.query<{ id: string; name: string }>(
    `SELECT t.id, CASE WHEN upper(coalesce($2,'TH'))='TH' THEN t.name_th ELSE t.name_en END AS name
       FROM bms_master_category_templates t
      WHERE t.archetype=$1 AND t.active
        AND NOT EXISTS (
          SELECT 1 FROM bms_category_template_applications a
           WHERE a.tenant_id=$3 AND a.template_id=t.id)
      ORDER BY t.sort_order,t.code`,
    [archetype, profile.rows[0]?.country, tenantId],
  );
  let createdCount = 0;
  for (const template of templates.rows) {
    const inserted = await client.query<{ id: string; name: string }>(
      `INSERT INTO bms_product_categories(tenant_id,name) VALUES($1,$2)
       ON CONFLICT (tenant_id,name) DO NOTHING RETURNING id,name`,
      [tenantId, template.name],
    );
    const category = inserted.rows[0] ?? (await client.query<{ id: string; name: string }>(
      `SELECT id,name FROM bms_product_categories WHERE tenant_id=$1 AND name=$2`,
      [tenantId, template.name],
    )).rows[0];
    if (!category) throw new Error("ไม่สามารถบันทึกหมวดหมู่ตั้งต้นได้");
    createdCount += inserted.rowCount ?? 0;
    await client.query(
      `INSERT INTO bms_category_template_applications
         (tenant_id,template_id,category_id,applied_name,applied_by)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,template_id) DO NOTHING`,
      [tenantId, template.id, category.id, template.name, actorId ?? null],
    );
  }
  const categories = await client.query<{ id: string; name: string }>(
    `SELECT id,name FROM bms_product_categories WHERE tenant_id=$1 ORDER BY name`, [tenantId],
  );
  const result = { archetype, appliedCount: templates.rowCount ?? 0, createdCount, categories: categories.rows };
  if (result.appliedCount > 0) {
    await client.query(
      `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
       VALUES($1,$2,'product.category_templates.apply',$3,$4::jsonb)`,
      [tenantId, actorId ?? null, result.archetype, JSON.stringify({
        appliedCount: result.appliedCount, createdCount: result.createdCount,
      })],
    );
  }
  return result;
}

export async function applyStarterCategories(
  tenantId: string,
  actorId?: string | null,
): Promise<StarterCategoryApplyResult> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorId ? { editorId: actorId } : undefined);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bms.starter_categories'),hashtext($1::text))`, [tenantId]);
    const result = await applyStarterCategoriesInTx(client, tenantId, actorId);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function defaultStarterUnitInTx(
  client: PoolClient,
  archetype: string,
): Promise<{ code: string; name: string } | null> {
  const result = await client.query<{ code: string; name: string }>(
    `SELECT u.code,u.name_th AS name
       FROM bms_master_archetype_units a
       JOIN bms_master_units u ON u.code=a.unit_code AND u.active
      WHERE a.archetype=$1 AND a.active AND a.is_default
      ORDER BY a.sort_order LIMIT 1`,
    [archetype],
  );
  return result.rows[0] ?? null;
}
