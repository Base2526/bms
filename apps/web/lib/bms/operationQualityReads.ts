import type { PoolClient } from "pg";
import {
  checklistPermission,
  checklistTx,
  type ChecklistScope,
} from "./operationChecklists";
import {
  checklistUuid,
  checklistText,
  rejectChecklist as reject,
} from "./operationChecklistPolicy";
import { teamBranches, teamHash, teamPage } from "./operationTeamReads";
import { improvementJson } from "./operationImprovementReads";
export function qualityAccess(s: ChecklistScope) {
  checklistPermission(s, "operations.quality.view");
  checklistPermission(s, "product.view");
}
export async function qualityCase(
  c: PoolClient,
  s: ChecklistScope,
  id: string,
  lock = false,
) {
  if (!checklistUuid(id)) return reject("INVALID_INPUT");
  const p = (
    await c.query(
      `SELECT * FROM bms_operation_quality_cases WHERE tenant_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
      [s.tenantId, id],
    )
  ).rows[0];
  if (!p) return reject("NOT_FOUND");
  await teamBranches(c, s, p.location_id);
  return p;
}
/** Evidence traversal is bounded, permission scoped and never claims historical completeness. */
export async function qualityTrace(
  c: PoolClient,
  s: ChecklistScope,
  root: string,
) {
  if (!checklistUuid(root)) return reject("INVALID_INPUT");
  const branches = await teamBranches(c, s),
    seen = new Set<string>(),
    queue = [root],
    lots: any[] = [],
    productions: any[] = [],
    sales: any[] = [],
    receipts: any[] = [],
    returns: any[] = [];
  let restricted = false;
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    if (seen.size >= 200) reject("REPORT_TOO_LARGE");
    seen.add(id);
    const lot = (
      await c.query(
        `SELECT l.id,l.location_id,l.product_sku,l.size,l.lot_no,l.qty,l.expiry_date::text,COALESCE(sp.base_unit,'PIECE') base_unit,EXISTS(SELECT 1 FROM bms_operation_lot_holds h WHERE h.tenant_id=l.tenant_id AND h.lot_id=l.id AND h.status='ACTIVE') held FROM bms_inventory_lots l LEFT JOIN bms_product_stock_policies sp ON sp.tenant_id=l.tenant_id AND sp.product_sku=l.product_sku WHERE l.tenant_id=$1 AND l.id=$2`,
        [s.tenantId, id],
      )
    ).rows[0];
    if (!lot) {
      if (id === root) reject("NOT_FOUND");
      continue;
    }
    if (!branches.includes(lot.location_id)) {
      if (id === root) reject("NOT_FOUND");
      restricted = true;
      continue;
    }
    lots.push(lot);
    const ps = (
      await c.query(
        `SELECT DISTINCT p.id,p.location_id,p.output_lot_id,p.output_sku,p.output_size,p.actual_qty,i.product_sku,i.size,i.qty input_qty,i.lots FROM bms_operation_production_inputs i JOIN bms_operation_production p ON p.tenant_id=i.tenant_id AND p.id=i.production_id WHERE i.tenant_id=$1 AND i.lots @> $2::jsonb ORDER BY p.id LIMIT 201`,
        [s.tenantId, JSON.stringify([{ id }])],
      )
    ).rows;
    if (ps.length > 200) reject("REPORT_TOO_LARGE");
    for (const p of ps) {
      if (!branches.includes(p.location_id)) {
        restricted = true;
        continue;
      }
      productions.push({ ...p, sourceLotId: id });
      if (p.output_lot_id) queue.push(p.output_lot_id);
    }
    const rs = (
      await c.query(
        `SELECT DISTINCT r.restock_lot_id destination_id,r.lot_id source_id FROM bms_pos_return_item_lots r WHERE r.tenant_id=$1 AND r.lot_id=$2 AND r.restock_lot_id<>r.lot_id ORDER BY destination_id,source_id LIMIT 201`,
        [s.tenantId, id],
      )
    ).rows;
    if (rs.length > 200) reject("REPORT_TOO_LARGE");
    for (const r of rs) {
      queue.push(r.destination_id);
      returns.push(r);
    }
    const ss = (
      await c.query(
        `SELECT o.id order_id,o.location_id,o.status,o.created_at,oi.product_sku sold_sku,oil.qty,oil.lot_id FROM bms_order_item_lots oil JOIN bms_order_items oi ON oi.tenant_id=oil.tenant_id AND oi.id=oil.order_item_id JOIN bms_orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id WHERE oil.tenant_id=$1 AND oil.lot_id=$2 ORDER BY o.id,oi.id LIMIT 501`,
        [s.tenantId, id],
      )
    ).rows;
    if (ss.length > 500) reject("REPORT_TOO_LARGE");
    for (const x of ss) {
      if (branches.includes(x.location_id)) sales.push(x);
      else restricted = true;
    }
    receipts.push(
      ...(
        await c.query(
          `SELECT id,receipt_id,po_id,po_item_id,location_id,lot_id,qty,movement_id,created_at FROM bms_purchase_receipt_evidence WHERE tenant_id=$1 AND lot_id=$2 ORDER BY id LIMIT 501`,
          [s.tenantId, id],
        )
      ).rows,
    );
    if (
      sales.length > 500 ||
      productions.length > 500 ||
      receipts.length > 500 ||
      returns.length > 500
    )
      reject("REPORT_TOO_LARGE");
  }
  const visible = new Set(lots.map((x) => x.id));
  const evidence = improvementJson({
    root,
    lots,
    productions,
    sales,
    receipts,
    returns: returns.filter((x) => visible.has(x.destination_id)),
    restricted,
    coverage: "RECORDED_EVIDENCE_ONLY",
    limitations: [
      "NO_HISTORICAL_BACKFILL",
      "NO_UNRECORDED_TRANSFERS_OR_REPACKING",
      "NO_CUSTOMER_IDENTIFICATION",
    ],
  });
  return { ...evidence, fingerprint: teamHash(evidence) };
}
export async function qualityWorkspace(s: ChecklistScope, f: any = {}) {
  qualityAccess(s);
  return checklistTx(s, async (c) => {
    const ids = await teamBranches(c, s, f.locationId),
      search = checklistText(f.search, 120),
      offset = teamPage(f.offset);
    const where = `tenant_id=$1 AND location_id=ANY($2::uuid[]) AND ($3='' OR position(lower($3) in lower(title))>0)`;
    const rows = (
      await c.query(
        `SELECT * FROM bms_operation_quality_cases WHERE ${where} ORDER BY created_at DESC,id LIMIT 25 OFFSET $4`,
        [s.tenantId, ids, search, offset],
      )
    ).rows;
    const summary = (
      await c.query(
        `SELECT count(*)::int total,count(*) FILTER(WHERE status<>'CLOSED')::int open,count(*) FILTER(WHERE status='REVIEW')::int review,count(*) FILTER(WHERE status<>'CLOSED' AND due_at<now())::int overdue FROM bms_operation_quality_cases WHERE ${where}`,
        [s.tenantId, ids, search],
      )
    ).rows[0];
    return improvementJson({ rows, ...summary });
  });
}
export async function qualityLots(
  s: ChecklistScope,
  location: string,
  search = "",
) {
  qualityAccess(s);
  return checklistTx(s, async (c) => {
    await teamBranches(c, s, location);
    const rows = (
      await c.query(
        `SELECT l.id,l.product_sku,l.size,l.lot_no,l.qty,l.expiry_date::text,COALESCE(sp.base_unit,'PIECE') base_unit,EXISTS(SELECT 1 FROM bms_operation_lot_holds h WHERE h.tenant_id=l.tenant_id AND h.lot_id=l.id AND h.status='ACTIVE') held FROM bms_inventory_lots l LEFT JOIN bms_product_stock_policies sp ON sp.tenant_id=l.tenant_id AND sp.product_sku=l.product_sku WHERE l.tenant_id=$1 AND l.location_id=$2 AND ($3='' OR position(lower($3) in lower(l.product_sku||' '||l.lot_no))>0) ORDER BY l.received_at DESC,l.id LIMIT 51`,
        [s.tenantId, location, checklistText(search, 120)],
      )
    ).rows;
    return improvementJson({
      rows: rows.slice(0, 50),
      hasMore: rows.length > 50,
    });
  });
}
export async function qualityDetail(s: ChecklistScope, id: string) {
  qualityAccess(s);
  return checklistTx(
    s,
    async (c) => {
      const p = await qualityCase(c, s, id),
        ids = await teamBranches(c, s);
      const holds = (
        await c.query(
          `SELECT h.*,l.location_id,l.product_sku,l.size,l.lot_no,l.qty,l.expiry_date::text FROM bms_operation_lot_holds h JOIN bms_inventory_lots l ON l.tenant_id=h.tenant_id AND l.id=h.lot_id WHERE h.tenant_id=$1 AND h.case_id=$2 AND l.location_id=ANY($3::uuid[]) ORDER BY (h.status='ACTIVE') DESC,h.created_at DESC,h.id LIMIT 501`,
          [s.tenantId, id, ids],
        )
      ).rows;
      const decisions = (
        await c.query(
          `SELECT d.*,h.version current_hold_version,h.base_unit,l.id lot_id,l.lot_no,l.product_sku,l.size,l.location_id,l.qty current_qty FROM bms_operation_quality_decisions d JOIN bms_operation_lot_holds h ON h.tenant_id=d.tenant_id AND h.id=d.hold_id JOIN bms_inventory_lots l ON l.tenant_id=h.tenant_id AND l.id=h.lot_id WHERE d.tenant_id=$1 AND d.case_id=$2 AND l.location_id=ANY($3::uuid[]) ORDER BY (d.status='PENDING') DESC,d.created_at DESC LIMIT 501`,
          [s.tenantId, id, ids],
        )
      ).rows;
      const events = (
        await c.query(
          `SELECT action,actor,note,created_at,evidence FROM bms_operation_quality_events WHERE tenant_id=$1 AND case_id=$2 ORDER BY id DESC LIMIT 101`,
          [s.tenantId, id],
        )
      ).rows;
      const run = p.run_id
        ? (
            await c.query(
              `SELECT id,status,version,assigned_to,due_at FROM bms_operation_runs WHERE tenant_id=$1 AND id=$2`,
              [s.tenantId, p.run_id],
            )
          ).rows[0]
        : null;
      return improvementJson({
        ...p,
        holds: holds.slice(0, 500),
        decisions: decisions.slice(0, 500),
        run,
        events: events.slice(0, 100).map(({ evidence, ...e }) => ({
          ...e,
          trace:
            e.action === "SAVE_TRACE" &&
            Array.isArray(evidence?.lots) &&
            evidence.lots.every((l: any) => ids.includes(l.location_id))
              ? evidence
              : null,
        })),
        historyTruncated:
          events.length > 100 || holds.length > 500 || decisions.length > 500,
      });
    },
    { serializable: true },
  );
}
export async function readQualityTrace(s: ChecklistScope, id: string) {
  qualityAccess(s);
  return checklistTx(s, (c) => qualityTrace(c, s, id), { serializable: true });
}
export async function qualityForRun(s: ChecklistScope, id: string) {
  checklistPermission(s, "operations.checklist.view");
  if (!checklistUuid(id)) reject("INVALID_INPUT");
  return checklistTx(s, async (c) => {
    const p = (
      await c.query(
        `SELECT id,title,location_id,status FROM bms_operation_quality_cases WHERE tenant_id=$1 AND run_id=$2`,
        [s.tenantId, id],
      )
    ).rows[0];
    if (!p) return null;
    await teamBranches(c, s, p.location_id);
    return p;
  });
}
