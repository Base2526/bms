import type { PoolClient } from "pg";
import {
  checklistPermission,
  checklistTx,
  type ChecklistScope,
} from "./operationChecklists";
import {
  ChecklistError,
  checklistText,
  checklistUuid,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import { teamBranches, teamHash, teamPage } from "./operationTeamReads";
import { availability } from "./operationProductionReads";
import { improvementJson } from "./operationImprovementReads";
import {
  allocateMaterial,
  materialKey,
  materialSources,
  materialWindow,
  materialCount,
} from "./operationMaterialPolicy";
export function materialAccess(s: ChecklistScope) {
  checklistPermission(s, "operations.material.view");
  checklistPermission(s, "product.view");
}
export async function materialPlan(
  c: PoolClient,
  s: ChecklistScope,
  id: string,
  lock = false,
) {
  if (!checklistUuid(id)) reject("INVALID_INPUT");
  const p = (
    await c.query(
      `SELECT p.*,p.from_date::text,p.to_date::text,(SELECT name FROM bms_locations l WHERE l.tenant_id=p.tenant_id AND l.id=p.location_id) location_name FROM bms_operation_material_plans p WHERE p.tenant_id=$1 AND p.id=$2 ${lock ? "FOR UPDATE OF p" : ""}`,
      [s.tenantId, id],
    )
  ).rows[0];
  if (!p) reject("NOT_FOUND");
  await teamBranches(c, s, p.location_id);
  return p;
}
export async function materialLinks(
  c: PoolClient,
  s: ChecklistScope,
  id: string,
) {
  const rows = (
    await c.query(
      `SELECT l.*,pi.qty_ordered,pi.qty_received,po.status po_status,po.supplier_id,
 CASE WHEN $3 THEN pi.unit_cost::text ELSE NULL END unit_cost,
 COALESCE((SELECT sum(e.qty) FROM bms_purchase_receipt_evidence e WHERE e.tenant_id=l.tenant_id AND e.po_item_id=l.po_item_id),0)::int evidenced_received,
 COALESCE((SELECT sum(e.qty) FROM bms_operation_material_inspections x JOIN bms_purchase_receipt_evidence e ON e.tenant_id=x.tenant_id AND e.receipt_id=x.id WHERE x.tenant_id=l.tenant_id AND x.link_id=l.id AND x.status='POSTED'),0)::int received,
 ri.requisition_id,r.status request_status,ri.approved_qty,
 COALESCE((SELECT sum(CASE WHEN t.status='RECEIVED' THEN ti.received_qty ELSE 0 END) FROM bms_branch_requisition_transfers a JOIN bms_stock_transfer_items ti ON ti.tenant_id=a.tenant_id AND ti.id=a.transfer_item_id JOIN bms_stock_transfers t ON t.tenant_id=ti.tenant_id AND t.id=ti.transfer_id WHERE a.tenant_id=l.tenant_id AND a.item_id=l.requisition_item_id),0)::int transfer_received
 FROM bms_operation_material_links l LEFT JOIN bms_purchase_order_items pi ON pi.tenant_id=l.tenant_id AND pi.id=l.po_item_id
 LEFT JOIN bms_purchase_orders po ON po.tenant_id=pi.tenant_id AND po.id=pi.po_id
 LEFT JOIN bms_branch_requisition_items ri ON ri.tenant_id=l.tenant_id AND ri.id=l.requisition_item_id
 LEFT JOIN bms_branch_requisitions r ON r.tenant_id=ri.tenant_id AND r.id=ri.requisition_id
 WHERE l.tenant_id=$1 AND l.plan_id=$2 ORDER BY l.created_at,l.id LIMIT 501`,
      [s.tenantId, id, s.permissions.has("report.view")],
    )
  ).rows;
  if (rows.length > 500) reject("REPORT_TOO_LARGE");
  return improvementJson(
    rows.map((x) => ({
      ...x,
      received: x.requisition_item_id
        ? Math.min(x.qty, x.transfer_received)
        : x.received,
      pending: x.po_item_id
        ? x.qty_received > x.evidenced_received
          ? null
          : ["OPEN", "PARTIAL"].includes(x.po_status)
            ? Math.max(0, x.qty - x.received)
            : 0
        : ["APPROVED"].includes(x.request_status)
          ? Math.max(0, x.qty - x.transfer_received)
          : 0,
      unknownReceipts: x.po_item_id
        ? Math.max(0, x.qty_received - x.evidenced_received)
        : 0,
    })),
  );
}
export async function materialFacts(
  c: PoolClient,
  s: ChecklistScope,
  location: string,
  from: string,
  to: string,
  sources: Array<{ id: string; priority: number }>,
  planId?: string,
) {
  await teamBranches(c, s, location);
  const window = materialWindow(from, to);
  materialSources(sources);
  // Include other active plans when allocating the same stock; no plan can claim it a second time.
  const rows = (
    await c.query(
      `SELECT p.id,p.status,p.version,p.snapshot,p.output_sku,r.due_at,r.status run_status,
 ms.plan_id,ms.priority FROM bms_operation_production p JOIN bms_operation_runs r ON r.tenant_id=p.tenant_id AND r.id=p.run_id
 LEFT JOIN bms_operation_material_sources ms ON ms.tenant_id=p.tenant_id AND ms.production_id=p.id AND ms.active
 WHERE p.tenant_id=$1 AND p.location_id=$2 AND (p.id=ANY($3::uuid[]) OR ms.active) ORDER BY p.id LIMIT 501`,
      [s.tenantId, location, sources.map((x) => x.id)],
    )
  ).rows;
  if (rows.length > 500) reject("REPORT_TOO_LARGE");
  for (const x of sources) {
    const row = rows.find((r) => r.id === x.id);
    if (!row) reject("NOT_FOUND");
    if (row.plan_id && row.plan_id !== planId)
      reject("PRODUCTION_ALREADY_PLANNED");
    const day = new Date(row.due_at).toLocaleDateString("en-CA", {
      timeZone: "Asia/Bangkok",
    });
    if (day < from || day > to) reject("SOURCE_OUTSIDE_WINDOW");
  }
  const groups = new Map<string, any>();
  let units = 0;
  for (const p of rows) {
    const own = sources.find((x) => x.id === p.id);
    if (!own && !p.plan_id) continue;
    if (!["DRAFT", "READY"].includes(p.status) || p.run_status === "VOID")
      continue;
    for (const raw of p.snapshot.ingredients ?? []) {
      if (++units > 5000) reject("REPORT_TOO_LARGE");
      const x = {
        sku: checklistText(raw.sku, 200, true),
        size: checklistText(raw.size, 100, true),
        baseUnit: checklistText(raw.baseUnit, 40, true),
        qty: materialCount(raw.qty),
      };
      const key = materialKey(x),
        g = groups.get(key) ?? {
          sku: x.sku,
          size: x.size,
          baseUnit: x.baseUnit,
          demands: [],
        };
      if (g.baseUnit !== x.baseUnit) reject("SOURCE_UNIT_CHANGED");
      g.demands.push({
        productionId: p.id,
        priority: own?.priority ?? p.priority,
        dueAt: new Date(p.due_at).toISOString(),
        qty: x.qty,
        own: !!own,
      });
      groups.set(key, g);
    }
  }
  const lines = [];
  for (const g of groups.values()) {
    if (!g.demands.some((x: any) => x.own)) continue;
    const current = (
      await c.query(
        `SELECT COALESCE(sp.stock_policy,'DIRECT') policy,COALESCE(sp.base_unit,'PIECE') unit,p.serial_tracked,p.is_bundle,v.active FROM bms_products p JOIN bms_product_variants v ON v.tenant_id=p.tenant_id AND v.product_sku=p.sku AND v.code=$3 LEFT JOIN bms_product_stock_policies sp ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku WHERE p.tenant_id=$1 AND p.sku=$2`,
        [s.tenantId, g.sku, g.size],
      )
    ).rows[0];
    const compatible =
      current &&
      current.policy === "DIRECT" &&
      !current.serial_tracked &&
      !current.is_bundle &&
      current.active &&
      current.unit === g.baseUnit;
    const end = g.demands.reduce((a: string, x: any) => {
      const d = new Date(x.dueAt).toLocaleDateString("en-CA", {
        timeZone: "Asia/Bangkok",
      });
      return d > a ? d : a;
    }, to);
    const stock = await availability(
      c,
      s.tenantId,
      location,
      g.sku,
      g.size,
      end,
    );
    const allocations = allocateMaterial(
      g.demands,
      compatible ? stock.available : null,
    ).filter(
      (x: any) =>
        g.demands.find((d: any) => d.productionId === x.productionId)?.own,
    );
    const required = allocations.reduce((n, x) => n + x.qty, 0);
    materialCount(required);
    const available = allocations.some((x) => x.allocated === null)
      ? null
      : allocations.reduce((n, x) => n + x.allocated!, 0);
    lines.push({
      sku: g.sku,
      size: g.size,
      baseUnit: g.baseUnit,
      required,
      stock,
      usableThrough: end,
      available,
      shortage: available == null ? null : required - available,
      allocations,
      compatible: !!compatible,
    });
  }
  lines.sort((a, b) => materialKey(a).localeCompare(materialKey(b)));
  const selected = rows
    .filter((p) => sources.some((x) => x.id === p.id))
    .map((p) => ({
      id: p.id,
      status: p.status,
      version: p.version,
      runStatus: p.run_status,
      dueAt: new Date(p.due_at).toISOString(),
      priority: sources.find((x) => x.id === p.id)!.priority,
      outputSku: p.output_sku,
    }));
  const facts = improvementJson({
    locationId: location,
    window,
    sources: selected,
    lines,
  });
  return { ...facts, fingerprint: teamHash(facts) };
}
export async function materialPreview(s: ChecklistScope, i: any) {
  materialAccess(s);
  const sources = materialSources(i.sources);
  return checklistTx(
    s,
    (c) => materialFacts(c, s, i.locationId, i.from, i.to, sources),
    { serializable: true },
  );
}
export async function materialDetail(s: ChecklistScope, id: string) {
  materialAccess(s);
  return checklistTx(
    s,
    async (c) => {
      const p = await materialPlan(c, s, id),
        sources = (
          await c.query(
            `SELECT production_id id,priority FROM bms_operation_material_sources WHERE tenant_id=$1 AND plan_id=$2 ORDER BY production_id`,
            [s.tenantId, id],
          )
        ).rows;
      // Closed plans retain evidence; do not assert current allocations after releasing membership.
      let live: Awaited<ReturnType<typeof materialFacts>> | null = null;
      let liveError: string | null = null;
      if (["DRAFT", "CONFIRMED"].includes(p.status)) {
        try {
          live = await materialFacts(
            c,
            s,
            p.location_id,
            p.from_date,
            p.to_date,
            sources,
            id,
          );
        } catch (e) {
          // A rescheduled batch or incompatible planning inputs must not hide immutable
          // receiving evidence or prevent closing/cancelling the existing plan.
          if (
            !(e instanceof ChecklistError) ||
            ![
              "SOURCE_OUTSIDE_WINDOW",
              "SOURCE_UNIT_CHANGED",
              "REPORT_TOO_LARGE",
            ].includes(e.status)
          )
            throw e;
          liveError = e.status;
        }
      }
      const links = await materialLinks(c, s, id);
      const inspections = (
        await c.query(
          `SELECT x.*,x.expiry_date::text,l.product_sku,l.size,l.base_unit,l.po_id,r.status run_status,r.version run_version,r.assigned_to FROM bms_operation_material_inspections x JOIN bms_operation_material_links l ON l.tenant_id=x.tenant_id AND l.id=x.link_id JOIN bms_operation_runs r ON r.tenant_id=x.tenant_id AND r.id=x.run_id WHERE x.tenant_id=$1 AND l.plan_id=$2 ORDER BY x.created_at DESC LIMIT 501`,
          [s.tenantId, id],
        )
      ).rows;
      const receipts = (
        await c.query(
          `SELECT e.* FROM bms_purchase_receipt_evidence e JOIN bms_operation_material_inspections x ON x.tenant_id=e.tenant_id AND x.id=e.receipt_id JOIN bms_operation_material_links l ON l.tenant_id=x.tenant_id AND l.id=x.link_id WHERE e.tenant_id=$1 AND l.plan_id=$2 ORDER BY e.created_at,e.id LIMIT 501`,
          [s.tenantId, id],
        )
      ).rows;
      if (inspections.length > 500 || receipts.length > 500)
        reject("REPORT_TOO_LARGE");
      const events = (
        await c.query(
          `SELECT action,actor,note,details,created_at FROM bms_operation_material_events WHERE tenant_id=$1 AND plan_id=$2 ORDER BY id DESC LIMIT 101`,
          [s.tenantId, id],
        )
      ).rows;
      const lines = (live?.lines ?? []).map((x) => {
        const matching = links.filter(
          (l) => l.product_sku === x.sku && l.size === x.size,
        );
        const pending = matching.some((l) => l.pending == null)
          ? null
          : matching.reduce((n, l) => n + l.pending!, 0);
        return {
          ...x,
          pending,
          uncovered:
            x.shortage == null || pending == null
              ? null
              : Math.max(0, x.shortage - pending),
        };
      });
      return improvementJson({
        ...p,
        live: live ? { ...live, lines } : null,
        liveError,
        changed:
          liveError !== null ||
          (live ? live.fingerprint !== p.fingerprint : false),
        links,
        inspections,
        receipts,
        events: events.slice(0, 100),
        historyTruncated: events.length > 100,
      });
    },
    { serializable: true },
  );
}
export async function materialWorkspace(s: ChecklistScope, f: any = {}) {
  materialAccess(s);
  return checklistTx(s, async (c) => {
    const ids = await teamBranches(c, s, f.locationId),
      search = checklistText(f.search, 120),
      offset = teamPage(f.offset);
    const args = [s.tenantId, ids, search];
    const where = `p.tenant_id=$1 AND p.location_id=ANY($2::uuid[]) AND ($3='' OR position(lower($3) in lower(p.title))>0)`;
    const rows = (
      await c.query(
        `SELECT p.id,p.title,p.location_id,p.status,p.version,p.from_date::text,p.to_date::text,p.run_id,r.assigned_to,r.due_at FROM bms_operation_material_plans p JOIN bms_operation_runs r ON r.tenant_id=p.tenant_id AND r.id=p.run_id WHERE ${where} ORDER BY p.created_at DESC,p.id LIMIT 25 OFFSET $4`,
        [...args, offset],
      )
    ).rows;
    const total = Number(
      (
        await c.query(
          `SELECT count(*) FROM bms_operation_material_plans p WHERE ${where}`,
          args,
        )
      ).rows[0].count,
    );
    return improvementJson({ rows, total });
  });
}
export async function materialCatalog(
  s: ChecklistScope,
  kind: string,
  locationId: string,
  search = "",
) {
  materialAccess(s);
  return checklistTx(s, async (c) => {
    await teamBranches(c, s, locationId);
    const term = checklistText(search, 120);
    let rows;
    if (kind === "PRODUCTION")
      rows = (
        await c.query(
          `SELECT p.id,p.output_sku name,p.status,p.version,r.due_at FROM bms_operation_production p JOIN bms_operation_runs r ON r.tenant_id=p.tenant_id AND r.id=p.run_id WHERE p.tenant_id=$1 AND p.location_id=$2 AND p.status IN ('DRAFT','READY') AND r.status<>'VOID' AND NOT EXISTS(SELECT 1 FROM bms_operation_material_sources ms WHERE ms.tenant_id=p.tenant_id AND ms.production_id=p.id AND ms.active) AND ($3='' OR position(lower($3) in lower(p.output_sku||' '||p.id))>0) ORDER BY r.due_at,p.id LIMIT 51`,
          [s.tenantId, locationId, term],
        )
      ).rows;
    else if (kind === "SUPPLIER") {
      checklistPermission(s, "purchase.view");
      rows = (
        await c.query(
          `SELECT id,name FROM bms_suppliers WHERE tenant_id=$1 AND ($2='' OR position(lower($2) in lower(name))>0) ORDER BY name,id LIMIT 51`,
          [s.tenantId, term],
        )
      ).rows;
    } else if (kind === "PO") {
      checklistPermission(s, "purchase.view");
      rows = (
        await c.query(
          `SELECT pi.id::text id,po.id po_id,pi.product_sku name,pi.size,pi.qty_ordered,pi.qty_received,po.status FROM bms_purchase_order_items pi JOIN bms_purchase_orders po ON po.tenant_id=pi.tenant_id AND po.id=pi.po_id WHERE pi.tenant_id=$1 AND po.status IN ('OPEN','PARTIAL') AND ($2='' OR position(lower($2) in lower(pi.product_sku||' '||po.id))>0) ORDER BY po.created_at DESC,pi.id LIMIT 51`,
          [s.tenantId, term],
        )
      ).rows;
    } else if (kind === "REQUISITION") {
      checklistPermission(s, "inventory.requisition.view");
      rows = (
        await c.query(
          `SELECT i.id::text id,r.id request_id,r.request_no name,i.product_sku,i.size,i.approved_qty FROM bms_branch_requisition_items i JOIN bms_branch_requisitions r ON r.tenant_id=i.tenant_id AND r.id=i.requisition_id WHERE i.tenant_id=$1 AND r.location_id=$2 AND r.status='APPROVED' AND ($3='' OR position(lower($3) in lower(r.request_no||' '||i.product_sku))>0) ORDER BY r.created_at DESC,i.id LIMIT 51`,
          [s.tenantId, locationId, term],
        )
      ).rows;
    } else return reject("INVALID_INPUT");
    return improvementJson({
      rows: rows.slice(0, 50),
      hasMore: rows.length > 50,
    });
  });
}
export async function materialForRun(s: ChecklistScope, id: string) {
  checklistPermission(s, "operations.checklist.view");
  if (!checklistUuid(id)) reject("INVALID_INPUT");
  return checklistTx(s, async (c) => {
    const r = (
      await c.query(
        `SELECT location_id FROM bms_operation_runs WHERE tenant_id=$1 AND id=$2`,
        [s.tenantId, id],
      )
    ).rows[0];
    if (!r) reject("NOT_FOUND");
    await teamBranches(c, s, r.location_id);
    const p = (
      await c.query(
        `SELECT id,title FROM bms_operation_material_plans WHERE tenant_id=$1 AND run_id=$2`,
        [s.tenantId, id],
      )
    ).rows[0];
    const x = (
      await c.query(
        `SELECT l.plan_id,x.accepted_qty,x.rejected_qty,x.lot_no,x.expiry_date::text,x.note,l.product_sku,l.size,l.base_unit FROM bms_operation_material_inspections x JOIN bms_operation_material_links l ON l.tenant_id=x.tenant_id AND l.id=x.link_id WHERE x.tenant_id=$1 AND x.run_id=$2`,
        [s.tenantId, id],
      )
    ).rows[0];
    return p
      ? { planId: p.id, title: p.title }
      : x
        ? { planId: x.plan_id, inspection: x }
        : null;
  });
}
