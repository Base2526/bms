import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import {
  checklistTx,
  checklistPermission,
  executeChecklistInTx,
  lockChecklistRun,
  type ChecklistScope,
} from "./operationChecklists";
import {
  ChecklistError,
  checklistText,
  checklistUuid,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import {
  materialAccess,
  materialPlan,
  materialFacts,
  materialLinks,
} from "./operationMaterialReads";
import {
  MATERIAL_PERMISSIONS,
  materialCount,
  materialSources,
  materialWindow,
} from "./operationMaterialPolicy";
import { teamBranches, teamHash } from "./operationTeamReads";
import { teamInstant } from "./operationTeamPolicy";
import { teamNotice, operationSupervisor } from "./operationTeamDispatch";
import { directProduct } from "./operationProduction";
import { productionDate } from "./operationProductionPolicy";
import {
  createPurchaseOrderInTx,
  receivePurchaseOrderInTx,
  notifyPurchaseRestock,
  type ReceiveInput,
} from "./purchase";
import { validRequisitionPurchaseCosts } from "./branchRequisitionMath";
export type MaterialCommand = {
  action: keyof typeof MATERIAL_PERMISSIONS;
  idempotencyKey: string;
  confirmed: boolean;
  id?: string;
  version?: number;
  title?: string;
  locationId?: string;
  from?: string;
  to?: string;
  sources?: Array<{ id: string; priority: number }>;
  fingerprint?: string;
  templateId?: string;
  assignedTo?: string;
  dueAt?: string;
  sku?: string;
  size?: string;
  qty?: number;
  supplierId?: string;
  unitCost?: number;
  poItemId?: string;
  requisitionItemId?: string;
  linkId?: string;
  inspectionId?: string;
  inspectionVersion?: number;
  runVersion?: number;
  expectedReceived?: number;
  acceptedQty?: number;
  rejectedQty?: number;
  lotNo?: string;
  expiryDate?: string;
  note?: string;
};
async function run(
  c: PoolClient,
  s: ChecklistScope,
  i: MaterialCommand,
  location: string,
) {
  checklistPermission(s, "operations.checklist.manage");
  if (!checklistUuid(i.templateId) || !checklistUuid(i.assignedTo))
    reject("INVALID_INPUT");
  const t = (
    await c.query(
      `SELECT location_id,separate_reviewer,status FROM bms_operation_templates WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, i.templateId],
    )
  ).rows[0];
  if (
    t?.location_id !== location ||
    t.status !== "ACTIVE" ||
    !t.separate_reviewer
  )
    reject("SEPARATE_REVIEW_REQUIRED");
  return executeChecklistInTx(c, s, {
    action: "CREATE_RUN",
    templateId: i.templateId,
    assignedTo: i.assignedTo,
    dueAt: teamInstant(i.dueAt),
    confirmed: true,
    idempotencyKey: i.idempotencyKey,
  });
}
async function line(
  c: PoolClient,
  s: ChecklistScope,
  p: any,
  i: MaterialCommand,
) {
  const sources = (
    await c.query(
      `SELECT production_id id,priority FROM bms_operation_material_sources WHERE tenant_id=$1 AND plan_id=$2`,
      [s.tenantId, p.id],
    )
  ).rows;
  const facts = await materialFacts(
    c,
    s,
    p.location_id,
    p.from_date,
    p.to_date,
    sources,
    p.id,
  );
  if (i.fingerprint !== facts.fingerprint) reject("SNAPSHOT_CHANGED");
  const x = facts.lines.find((x) => x.sku === i.sku && x.size === i.size);
  if (!x || !x.compatible) return reject("SOURCE_UNIT_CHANGED");
  if (x.shortage == null) return reject("STOCK_RECONCILIATION_REQUIRED");
  const links = await materialLinks(c, s, p.id);
  // Match the bounded detail reader before creating a PO or immutable link.
  if (links.length >= 500) reject("REPORT_TOO_LARGE");
  if (
    links.some(
      (l) => l.product_sku === x.sku && l.size === x.size && l.pending == null,
    )
  )
    return reject("RECEIPT_RECONCILIATION_REQUIRED");
  const pending = links
      .filter((l) => l.product_sku === x.sku && l.size === x.size)
      .reduce((n, l) => n + l.pending!, 0),
    qty = materialCount(i.qty);
  if (qty > Math.max(0, x.shortage - pending)) reject("OVER_ALLOCATED");
  if ((await directProduct(c, s.tenantId, x.sku, x.size)) !== x.baseUnit)
    reject("SOURCE_UNIT_CHANGED");
  return { ...x, qty };
}
async function execute(
  c: PoolClient,
  s: ChecklistScope,
  i: MaterialCommand,
  postCommit: ReceiveInput[],
) {
  const note = checklistText(i.note, 2000, true);
  if (i.action === "CREATE") {
    const sources = materialSources(i.sources),
      window = materialWindow(i.from, i.to);
    if (!checklistUuid(i.locationId)) return reject("INVALID_INPUT");
    const facts = await materialFacts(
      c,
      s,
      i.locationId,
      window.from,
      window.to,
      sources,
    );
    if (facts.fingerprint !== i.fingerprint) reject("SNAPSHOT_CHANGED");
    if (
      facts.sources.some(
        (x) => !["DRAFT", "READY"].includes(x.status) || x.runStatus === "VOID",
      )
    )
      reject("INVALID_SOURCE");
    const task = await run(c, s, i, i.locationId);
    const p = (
      await c.query(
        `INSERT INTO bms_operation_material_plans(tenant_id,location_id,title,from_date,to_date,run_id,snapshot,fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id,version`,
        [
          s.tenantId,
          i.locationId,
          checklistText(i.title, 160, true),
          window.from,
          window.to,
          task.id,
          JSON.stringify(facts),
          facts.fingerprint,
          s.actorId,
        ],
      )
    ).rows[0];
    for (const x of sources)
      await c.query(
        `INSERT INTO bms_operation_material_sources(tenant_id,plan_id,production_id,priority) VALUES($1,$2,$3,$4)`,
        [s.tenantId, p.id, x.id, x.priority],
      );
    return { ...p, status: "OK", locationId: i.locationId };
  }
  const p = await materialPlan(c, s, i.id!, true);
  if (p.version !== i.version) reject("STALE_VERSION");
  if (!["DRAFT", "CONFIRMED"].includes(p.status)) reject("INVALID_STATE");
  if (["CONFIRM", "REFRESH"].includes(i.action)) {
    if (i.action === "CONFIRM" && p.status !== "DRAFT") reject("INVALID_STATE");
    const sources = (
      await c.query(
        `SELECT production_id id,priority FROM bms_operation_material_sources WHERE tenant_id=$1 AND plan_id=$2`,
        [s.tenantId, p.id],
      )
    ).rows;
    const facts = await materialFacts(
      c,
      s,
      p.location_id,
      p.from_date,
      p.to_date,
      sources,
      p.id,
    );
    if (facts.fingerprint !== i.fingerprint) reject("SNAPSHOT_CHANGED");
    await c.query(
      `UPDATE bms_operation_material_plans SET snapshot=$3::jsonb,fingerprint=$4,status=$5 WHERE tenant_id=$1 AND id=$2`,
      [
        s.tenantId,
        p.id,
        JSON.stringify(facts),
        facts.fingerprint,
        i.action === "CONFIRM" ? "CONFIRMED" : p.status,
      ],
    );
  } else if (["CLOSE", "CANCEL"].includes(i.action)) {
    const links = await materialLinks(c, s, p.id);
    if (
      links.some(
        (l) =>
          (l.qty > l.received &&
            (["OPEN", "PARTIAL"].includes(l.po_status) ||
              l.request_status === "APPROVED")) ||
          (i.action === "CANCEL" && (l.received > 0 || l.qty_received > 0)),
      )
    )
      reject("SUPPLY_STILL_ACTIVE");
    if (
      (
        await c.query(
          `SELECT 1 FROM bms_operation_material_inspections x JOIN bms_operation_material_links l ON l.tenant_id=x.tenant_id AND l.id=x.link_id WHERE l.tenant_id=$1 AND l.plan_id=$2 AND x.status='PENDING' LIMIT 1`,
          [s.tenantId, p.id],
        )
      ).rowCount
    )
      reject("INSPECTION_PENDING");
    await c.query(
      `UPDATE bms_operation_material_plans SET status=$3 WHERE tenant_id=$1 AND id=$2`,
      [s.tenantId, p.id, i.action === "CLOSE" ? "CLOSED" : "CANCELLED"],
    );
    await c.query(
      `UPDATE bms_operation_material_sources SET active=false WHERE tenant_id=$1 AND plan_id=$2`,
      [s.tenantId, p.id],
    );
  } else {
    if (p.status !== "CONFIRMED") reject("PLAN_NOT_CONFIRMED");
    if (["CREATE_PO", "LINK_PO", "LINK_REQUISITION"].includes(i.action)) {
      const x = await line(c, s, p, i);
      let poId: string | null = null,
        poItemId: string | null = null,
        requestItem: string | null = null;
      if (i.action === "LINK_REQUISITION") {
        checklistPermission(s, "inventory.requisition.view");
        if (!/^\d+$/.test(i.requisitionItemId ?? "")) reject("INVALID_INPUT");
        const r = (
          await c.query(
            `SELECT i.*,r.location_id,r.status FROM bms_branch_requisition_items i JOIN bms_branch_requisitions r ON r.tenant_id=i.tenant_id AND r.id=i.requisition_id WHERE i.tenant_id=$1 AND i.id=$2 FOR UPDATE OF r`,
            [s.tenantId, i.requisitionItemId],
          )
        ).rows[0];
        if (
          !r ||
          r.location_id !== p.location_id ||
          r.product_sku !== x.sku ||
          r.size !== x.size ||
          r.status !== "APPROVED" ||
          r.approved_qty !== x.qty
        )
          reject("INVALID_SOURCE");
        if (
          (
            await c.query(
              `SELECT 1 FROM bms_inventory_lots WHERE tenant_id=$1 AND product_sku=$2 AND size=$3 LIMIT 1`,
              [s.tenantId, x.sku, x.size],
            )
          ).rowCount
        )
          reject("LOT_TRANSFER_UNSUPPORTED");
        requestItem = String(r.id);
      } else {
        checklistPermission(s, "purchase.view");
        checklistPermission(s, "purchase.edit");
        if (i.action === "CREATE_PO") {
          if (
            !checklistUuid(i.supplierId) ||
            !validRequisitionPurchaseCosts([
              { qty: x.qty, unitCost: i.unitCost },
            ])
          )
            reject("INVALID_INPUT");
          const po = await createPurchaseOrderInTx(c, {
            tenantId: s.tenantId,
            supplierId: i.supplierId,
            items: [
              { sku: x.sku, size: x.size, qty: x.qty, unitCost: i.unitCost },
            ],
            note: `Material plan ${p.id}: ${note}`,
            actor: s.actorId,
          });
          if (po.status !== "CREATED") return reject(po.status);
          poId = po.poId;
          poItemId = String(
            (
              await c.query(
                `SELECT id FROM bms_purchase_order_items WHERE tenant_id=$1 AND po_id=$2 AND product_sku=$3 AND size=$4`,
                [s.tenantId, poId, x.sku, x.size],
              )
            ).rows[0].id,
          );
          await c.query(
            `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,'purchase.create',$3,$4::jsonb)`,
            [
              s.tenantId,
              s.actorId,
              poId,
              JSON.stringify({ materialPlanId: p.id, total: po.total }),
            ],
          );
        } else {
          if (!/^\d+$/.test(i.poItemId ?? "")) reject("INVALID_INPUT");
          poItemId = i.poItemId!;
        }
        const pi = (
          await c.query(
            `SELECT pi.*,po.status FROM bms_purchase_order_items pi JOIN bms_purchase_orders po ON po.tenant_id=pi.tenant_id AND po.id=pi.po_id WHERE pi.tenant_id=$1 AND pi.id=$2 FOR UPDATE OF po`,
            [s.tenantId, poItemId],
          )
        ).rows[0];
        if (
          !pi ||
          !["OPEN", "PARTIAL"].includes(pi.status) ||
          pi.product_sku !== x.sku ||
          pi.size !== x.size
        )
          reject("INVALID_SOURCE");
        poId = pi.po_id;
        if (
          (
            await c.query(
              `SELECT 1 FROM bms_branch_requisition_purchases WHERE tenant_id=$1 AND po_item_id=$2 LIMIT 1`,
              [s.tenantId, poItemId],
            )
          ).rowCount
        )
          reject("PO_ALREADY_ALLOCATED");
        const allocated = (
          await c.query(
            `SELECT COALESCE(sum(l.qty),0)::int qty,COALESCE(sum((SELECT COALESCE(sum(x.accepted_qty),0) FROM bms_operation_material_inspections x WHERE x.tenant_id=l.tenant_id AND x.link_id=l.id AND x.status='POSTED')),0)::int received FROM bms_operation_material_links l WHERE l.tenant_id=$1 AND l.po_item_id=$2`,
            [s.tenantId, poItemId],
          )
        ).rows[0];
        if (
          x.qty >
          pi.qty_ordered -
            pi.qty_received -
            (allocated.qty - allocated.received)
        )
          reject("OVER_ALLOCATED");
      }
      await c.query(
        `INSERT INTO bms_operation_material_links(tenant_id,plan_id,product_sku,size,base_unit,qty,po_id,po_item_id,requisition_item_id,needed_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          s.tenantId,
          p.id,
          x.sku,
          x.size,
          x.baseUnit,
          x.qty,
          poId,
          poItemId,
          requestItem,
          teamInstant(i.dueAt),
          s.actorId,
        ],
      );
    } else if (i.action === "INSPECT") {
      if (!checklistUuid(i.linkId)) reject("INVALID_INPUT");
      const inspectionCount = (
        await c.query(
          `SELECT x.id FROM bms_operation_material_inspections x JOIN bms_operation_material_links l ON l.tenant_id=x.tenant_id AND l.id=x.link_id WHERE l.tenant_id=$1 AND l.plan_id=$2 LIMIT 500`,
          [s.tenantId, p.id],
        )
      ).rowCount;
      if (inspectionCount === 500) reject("REPORT_TOO_LARGE");
      const l = (await materialLinks(c, s, p.id)).find(
        (x) => x.id === i.linkId,
      );
      if (!l || !l.po_item_id || !["OPEN", "PARTIAL"].includes(l.po_status))
        reject("INVALID_SOURCE");
      const accepted = materialCount(i.acceptedQty, true),
        rejected = materialCount(i.rejectedQty, true);
      materialCount(accepted + rejected);
      const pending = Number(
        (
          await c.query(
            `SELECT COALESCE(sum(accepted_qty),0)::int qty FROM bms_operation_material_inspections WHERE tenant_id=$1 AND link_id=$2 AND status='PENDING'`,
            [s.tenantId, l.id],
          )
        ).rows[0].qty,
      );
      if (
        accepted > l.qty - l.received - pending ||
        accepted > l.qty_ordered - l.qty_received
      )
        reject("OVER_RECEIVE");
      const lot = checklistText(i.lotNo, 100) || null,
        expiry = i.expiryDate ? productionDate(i.expiryDate) : null;
      if (expiry && !lot) reject("LOT_REQUIRED");
      const task = await run(c, s, i, p.location_id);
      await c.query(
        `INSERT INTO bms_operation_material_inspections(tenant_id,link_id,run_id,accepted_qty,rejected_qty,lot_no,expiry_date,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          s.tenantId,
          l.id,
          task.id,
          accepted,
          rejected,
          lot,
          expiry,
          note,
          s.actorId,
        ],
      );
    } else if (["RECEIVE", "CANCEL_INSPECTION"].includes(i.action)) {
      if (!checklistUuid(i.inspectionId)) reject("INVALID_INPUT");
      const x = (
        await c.query(
          `SELECT x.*,x.expiry_date::text,l.plan_id,l.po_id,l.po_item_id,l.product_sku,l.size,l.base_unit,l.qty FROM bms_operation_material_inspections x JOIN bms_operation_material_links l ON l.tenant_id=x.tenant_id AND l.id=x.link_id WHERE x.tenant_id=$1 AND x.id=$2 AND l.plan_id=$3 FOR UPDATE OF x`,
          [s.tenantId, i.inspectionId, p.id],
        )
      ).rows[0];
      if (!x) reject("NOT_FOUND");
      if (x.version !== i.inspectionVersion) reject("STALE_VERSION");
      if (x.status !== "PENDING") reject("INVALID_STATE");
      if (i.action === "CANCEL_INSPECTION")
        await c.query(
          `UPDATE bms_operation_material_inspections SET status='CANCELLED',version=version+1 WHERE tenant_id=$1 AND id=$2`,
          [s.tenantId, x.id],
        );
      else {
        const task = await lockChecklistRun(c, s, x.run_id);
        if (task.status !== "APPROVED" || task.version !== i.runVersion)
          reject("INSPECTION_NOT_APPROVED");
        if (
          (await directProduct(c, s.tenantId, x.product_sku, x.size)) !==
          x.base_unit
        )
          reject("SOURCE_UNIT_CHANGED");
        const po = (
          await c.query(
            `SELECT pi.qty_received,pi.qty_ordered,po.status FROM bms_purchase_order_items pi JOIN bms_purchase_orders po ON po.tenant_id=pi.tenant_id AND po.id=pi.po_id WHERE pi.tenant_id=$1 AND pi.id=$2 FOR UPDATE OF po`,
            [s.tenantId, x.po_item_id],
          )
        ).rows[0];
        if (!po || po.qty_received !== i.expectedReceived)
          reject("RECEIPT_CHANGED");
        const results = (
          await c.query(
            `SELECT DISTINCT ON(item_key) item_key,outcome,value,note,recorded_by,recorded_at FROM bms_operation_results WHERE tenant_id=$1 AND run_id=$2 ORDER BY item_key,revision DESC`,
            [s.tenantId, x.run_id],
          )
        ).rows;
        if (x.accepted_qty > 0) {
          if (results.some((r) => r.outcome === "FAIL"))
            reject("INSPECTION_FAILED");
          const inv = (
            await c.query(
              `SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 FOR UPDATE`,
              [s.tenantId, p.location_id, x.product_sku, x.size],
            )
          ).rows[0];
          const lots = (
            await c.query(
              `SELECT id,qty,lot_no,expiry_date::text FROM bms_inventory_lots WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 ORDER BY id FOR UPDATE`,
              [s.tenantId, p.location_id, x.product_sku, x.size],
            )
          ).rows;
          if (
            (lots.length &&
              lots.reduce((n, l) => n + l.qty, 0) !==
                (inv?.current_stock ?? 0)) ||
            (!lots.length && x.lot_no && (inv?.current_stock ?? 0) > 0)
          )
            reject("STOCK_RECONCILIATION_REQUIRED");
          if (lots.length && !x.lot_no) reject("LOT_REQUIRED");
          const expiry = x.expiry_date ? productionDate(x.expiry_date) : null;
          const old = lots.find((l) => l.lot_no === x.lot_no);
          if (old && old.expiry_date !== expiry) reject("LOT_EXPIRY_CONFLICT");
          const today = (
            await c.query(
              `SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date::text AS day`,
            )
          ).rows[0].day;
          if (expiry && expiry < today) reject("EXPIRED_LOT");
          const receipt = {
            sku: x.product_sku,
            size: x.size,
            qty: x.accepted_qty,
            lotNo: x.lot_no,
            expiryDate: expiry,
          };
          const result = await receivePurchaseOrderInTx(
            c,
            s.tenantId,
            x.po_id,
            [receipt],
            s.actorId,
            {
              locationId: p.location_id,
              evidenceId: x.id,
              audit: {
                actor: s.actorId,
                meta: { materialPlanId: p.id, inspectionId: x.id },
              },
            },
          );
          if (!["RECEIVED", "PARTIAL"].includes(result.status))
            reject(result.status);
          postCommit.push(receipt);
        }
        await c.query(
          `UPDATE bms_operation_material_inspections SET status=$3,version=version+1,evidence=$4::jsonb,posted_at=now() WHERE tenant_id=$1 AND id=$2`,
          [
            s.tenantId,
            x.id,
            x.accepted_qty ? "POSTED" : "REJECTED",
            JSON.stringify({
              runId: task.id,
              version: task.version,
              reviewedBy: task.reviewed_by,
              reviewedAt: task.reviewed_at,
              results,
              previousReceived: po.qty_received,
            }),
          ],
        );
      }
    } else reject("INVALID_INPUT");
  }
  await c.query(
    `UPDATE bms_operation_material_plans SET version=version+1 WHERE tenant_id=$1 AND id=$2`,
    [s.tenantId, p.id],
  );
  return {
    status: "OK",
    id: p.id,
    version: p.version + 1,
    locationId: p.location_id,
  };
}
export async function commandMaterial(s: ChecklistScope, i: MaterialCommand) {
  const postCommit: ReceiveInput[] = [];
  try {
    materialAccess(s);
    if (!i || !Object.hasOwn(MATERIAL_PERMISSIONS, i.action))
      reject("INVALID_INPUT");
    checklistPermission(s, MATERIAL_PERMISSIONS[i.action]);
    if (["CREATE_PO", "LINK_PO"].includes(i.action)) {
      checklistPermission(s, "purchase.view");
      checklistPermission(s, "purchase.edit");
    }
    if (i.action === "LINK_REQUISITION")
      checklistPermission(s, "inventory.requisition.view");
    if (["CREATE", "INSPECT"].includes(i.action))
      checklistPermission(s, "operations.checklist.manage");
    if (i.confirmed !== true) reject("CONFIRMATION_REQUIRED");
    const note = checklistText(i.note, 2000, true),
      key = `material:${checklistText(i.idempotencyKey, 128, true)}`,
      fingerprint = teamHash(i);
    const result = await checklistTx(
      s,
      async (c) => {
        if (i.action === "CREATE") {
          if (!checklistUuid(i.locationId)) reject("INVALID_INPUT");
          await teamBranches(c, s, i.locationId);
        } else await materialPlan(c, s, i.id!);
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `${s.tenantId}:materials`,
        ]);
        const old = (
          await c.query(
            `SELECT fingerprint,result FROM bms_operation_commands WHERE tenant_id=$1 AND actor=$2 AND key=$3`,
            [s.tenantId, s.actorId, key],
          )
        ).rows[0];
        if (old) {
          if (old.fingerprint !== fingerprint) reject("IDEMPOTENCY_CONFLICT");
          return old.result;
        }
        const r = await execute(c, s, i, postCommit);
        const snapshot = ["CREATE", "REFRESH", "CONFIRM"].includes(i.action)
          ? (
              await c.query(
                `SELECT snapshot FROM bms_operation_material_plans WHERE tenant_id=$1 AND id=$2`,
                [s.tenantId, r.id],
              )
            ).rows[0].snapshot
          : undefined;
        await c.query(
          `INSERT INTO bms_operation_material_events(tenant_id,plan_id,action,actor,note,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            s.tenantId,
            r.id,
            i.action,
            s.actorId,
            note,
            JSON.stringify({
              version: r.version,
              inspectionId: i.inspectionId ?? null,
              linkId: i.linkId ?? null,
              fingerprint: i.fingerprint ?? null,
              snapshot,
            }),
          ],
        );
        await c.query(
          `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5::jsonb)`,
          [
            s.tenantId,
            s.actorId,
            `operations.material.${i.action.toLowerCase()}`,
            r.id,
            JSON.stringify({ version: r.version, note }),
          ],
        );
        await c.query(
          `INSERT INTO bms_operation_commands(tenant_id,actor,key,fingerprint,result) VALUES($1,$2,$3,$4,$5::jsonb)`,
          [s.tenantId, s.actorId, key, fingerprint, JSON.stringify(r)],
        );
        return r;
      },
      { serializable: true },
    );
    if (postCommit.length) await notifyPurchaseRestock(s.tenantId, postCommit);
    return result;
  } catch (e) {
    if (e instanceof ChecklistError) return { status: e.status };
    if (["40001", "40P01"].includes((e as any)?.code))
      return { status: "RETRY_REQUIRED" };
    if ((e as any)?.code === "23505") return { status: "ALREADY_LINKED" };
    throw e;
  }
}

/** Uses canonical task notices; no new out-of-app notification channel. */
export async function runMaterialFollowups(onlyTenant?: string) {
  const tenants = (
    await query(
      `SELECT tenant_id FROM bms_operation_material_plans WHERE status='CONFIRMED' AND ($1::uuid IS NULL OR tenant_id=$1) GROUP BY tenant_id ORDER BY min(followup_at),tenant_id LIMIT 100`,
      [onlyTenant ?? null],
    )
  ).rows;
  let processed = 0,
    failed = 0;
  for (const t of tenants)
    try {
      processed += await checklistTx(
        { tenantId: t.tenant_id, actorId: "system:operations" },
        async (c) => {
          const plans = (
            await c.query(
              `SELECT p.*,r.assigned_to,r.due_at,r.status run_status FROM bms_operation_material_plans p JOIN bms_operation_runs r ON r.tenant_id=p.tenant_id AND r.id=p.run_id WHERE p.tenant_id=$1 AND p.status='CONFIRMED' ORDER BY p.followup_at,p.id LIMIT 100 FOR UPDATE OF p SKIP LOCKED`,
              [t.tenant_id],
            )
          ).rows;
          for (const p of plans) {
            const links = await materialLinks(
              c,
              {
                tenantId: t.tenant_id,
                actorId: "system:operations",
                permissions: new Set(),
              },
              p.id,
            );
            const overdue = links.filter(
              (l) =>
                l.qty > l.received &&
                (l.po_status === "CANCELLED" ||
                  l.request_status === "CANCELLED" ||
                  Date.parse(l.needed_at) < Date.now()),
            );
            const kind = overdue.length
              ? "MATERIAL_SUPPLY_RISK"
              : !["APPROVED", "VOID"].includes(p.run_status) &&
                  new Date(p.due_at).getTime() < Date.now()
                ? "MATERIAL_REVIEW_DUE"
                : null;
            if (kind) {
              const head = await operationSupervisor(
                c,
                t.tenant_id,
                p.location_id,
                new Date().toISOString(),
              );
              for (const recipient of new Set([p.assigned_to, head]))
                await teamNotice(
                  c,
                  t.tenant_id,
                  p.location_id,
                  recipient,
                  p.run_id,
                  "RUN",
                  kind,
                  `${p.version}`,
                  recipient === head
                    ? "operations.checklist.review"
                    : "operations.checklist.execute",
                );
            }
            await c.query(
              `UPDATE bms_operation_material_plans SET followup_at=now() WHERE tenant_id=$1 AND id=$2`,
              [t.tenant_id, p.id],
            );
          }
          return plans.length;
        },
      );
    } catch {
      failed++;
    }
  return { processed, failed };
}
