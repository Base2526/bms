import type { PoolClient } from "pg";
import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { insertWithDailyDocNo } from "./dailyDocNo";
import {
  inventoryIdempotency,
  replayInventoryResult,
  storeInventoryResult,
} from "./inventoryIdempotency";
import { isIdempotencyConflictError } from "./idempotencyErrors";
import { createStockTransferInTx } from "./stockTransfers";
import { createPurchaseOrderInTx } from "./purchase";
import { notifyBranchRequisitionCommitted } from "./branchRequisitionNotify";
import {
  requisitionProgress,
  validRequisitionQuantity,
  validRequisitionPurchaseCosts,
  validRequisitionDate,
} from "./branchRequisitionMath";

export type RequisitionScope = { tenantId: string; actorId: string };
export type RequisitionLineInput = {
  sku: string;
  size: string;
  qty: number;
  note?: string | null;
  unitCost?: number | null;
};
export type RequisitionCommand = {
  action:
    | "SAVE"
    | "SUBMIT"
    | "REVIEW"
    | "CANCEL"
    | "TRANSFER"
    | "LINK_PO"
    | "CREATE_PO"
    | "CLOSE";
  id?: string | null;
  version?: number | null;
  idempotencyKey: string;
  confirmed?: boolean;
  locationId?: string | null;
  neededOn?: string | null;
  priority?: string | null;
  note?: string | null;
  items?: RequisitionLineInput[] | null;
  sourceId?: string | null;
  poId?: string | null;
  supplierId?: string | null;
};
export type RequisitionResult = {
  status: string;
  id?: string;
  transferId?: string;
  poId?: string;
  requestNo?: string;
};
class Rejection extends Error {
  constructor(readonly status: string) {
    super(status);
  }
}
export class RequisitionFilterError extends Error {}
function reject(status: string): never {
  throw new Rejection(status);
}
const uuid = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : v == null ? null : String(v);
const key = (i: { sku: string; size: string }) =>
  JSON.stringify([i.sku, i.size]);

// Same assigned-location semantics as locations.ts, evaluated inside the business transaction.
async function locations(client: PoolClient, scope: RequisitionScope) {
  const result = await client.query<{
    id: string;
    name: string;
    active: boolean;
  }>(
    `SELECT l.id,l.name,l.active FROM bms_locations l WHERE l.tenant_id=$1 AND
      (NOT EXISTS (SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$2)
       OR EXISTS (SELECT 1 FROM bms_user_allowed_locations a WHERE a.tenant_id=$1 AND a.user_id=$2 AND a.location_id=l.id))
     ORDER BY l.code`,
    [scope.tenantId, scope.actorId],
  );
  return result.rows;
}
async function transaction<T>(
  scope: RequisitionScope,
  work: (c: PoolClient) => Promise<T>,
) {
  const c = await getClient();
  try {
    await beginTenantTx(c, scope.tenantId, { editorId: scope.actorId });
    const result = await work(c);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}

async function lineDetails(c: PoolClient, tenantId: string, ids: string[]) {
  const lines = await c.query(
    `SELECT i.*,
      COALESCE(x.drafts,0)::int AS drafts, COALESCE(x.transit,0)::int AS transit,
      COALESCE(x.received,0)::int AS received, COALESCE(x.discrepancy,0)::int AS discrepancy,
      COALESCE(x.transfers,'[]'::jsonb) AS transfers,
      COALESCE(p.purchases,'[]'::jsonb) AS purchases
     FROM bms_branch_requisition_items i
     LEFT JOIN LATERAL (
       SELECT SUM(CASE WHEN t.status='DRAFT' THEN ti.qty ELSE 0 END) AS drafts,
        SUM(CASE WHEN t.status='IN_TRANSIT' THEN ti.qty ELSE 0 END) AS transit,
        SUM(CASE WHEN t.status='RECEIVED' THEN COALESCE(ti.received_qty,0) ELSE 0 END) AS received,
        SUM(CASE WHEN t.status='RECEIVED' THEN ti.qty-COALESCE(ti.received_qty,0) ELSE 0 END) AS discrepancy,
        jsonb_agg(jsonb_build_object('id',t.id,'number',t.transfer_no,'status',t.status,'qty',ti.qty,
          'received',ti.received_qty,'damaged',ti.damaged_qty)) AS transfers
       FROM bms_branch_requisition_transfers a
       JOIN bms_stock_transfer_items ti ON ti.tenant_id=a.tenant_id AND ti.id=a.transfer_item_id
       JOIN bms_stock_transfers t ON t.tenant_id=ti.tenant_id AND t.id=ti.transfer_id
       WHERE a.tenant_id=i.tenant_id AND a.item_id=i.id
     ) x ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('id',po.id,'status',po.status,'qty',a.qty,
         'ordered',pi.qty_ordered,'received',pi.qty_received)) AS purchases
       FROM bms_branch_requisition_purchases a
       JOIN bms_purchase_order_items pi ON pi.tenant_id=a.tenant_id AND pi.id=a.po_item_id
       JOIN bms_purchase_orders po ON po.tenant_id=pi.tenant_id AND po.id=pi.po_id
       WHERE a.tenant_id=i.tenant_id AND a.item_id=i.id
     ) p ON true
     WHERE i.tenant_id=$1 AND i.requisition_id=ANY($2::uuid[]) ORDER BY i.id`,
    [tenantId, ids],
  );
  return lines.rows.map((r) => ({
    id: String(r.id),
    requisitionId: r.requisition_id,
    sku: r.product_sku,
    size: r.size,
    name: r.product_name,
    requested: r.requested_qty,
    approved: r.approved_qty,
    reviewNote: r.review_note,
    drafts: r.drafts,
    transit: r.transit,
    received: r.received,
    discrepancy: r.discrepancy,
    ...requisitionProgress(
      r.approved_qty ?? 0,
      r.drafts,
      r.transit,
      r.received,
      r.discrepancy,
    ),
    transfers: r.transfers,
    purchases: r.purchases,
  }));
}

export async function listBranchRequisitions(
  scope: RequisitionScope,
  filter: {
    search?: string | null;
    status?: string | null;
    locationId?: string | null;
    priority?: string | null;
    limit?: number | null;
    offset?: number | null;
    id?: string | null;
    neededFrom?: string | null;
    neededTo?: string | null;
  } = {},
  canSeePurchases = false,
) {
  return transaction(scope, async (c) => {
    const accessible = await locations(c, scope);
    const limit = Math.min(50, Math.max(1, filter.limit ?? 20));
    const offset = Math.max(0, filter.offset ?? 0);
    if (
      (filter.id && !uuid(filter.id)) ||
      (filter.locationId && !uuid(filter.locationId)) ||
      (filter.neededFrom && !validRequisitionDate(filter.neededFrom)) ||
      (filter.neededTo && !validRequisitionDate(filter.neededTo)) ||
      (filter.neededFrom &&
        filter.neededTo &&
        filter.neededFrom > filter.neededTo)
    )
      throw new RequisitionFilterError(
        "Invalid requisition identifier or need-by date range",
      );
    const params = [
      scope.tenantId,
      accessible.map((l) => l.id),
      filter.status || null,
      filter.locationId || null,
      `%${(filter.search ?? "").trim().slice(0, 200)}%`,
      filter.priority || null,
      filter.id || null,
      filter.neededFrom || null,
      filter.neededTo || null,
    ];
    const where = `r.tenant_id=$1 AND r.location_id=ANY($2::uuid[])
      AND ($3::text IS NULL OR r.status=$3) AND ($4::uuid IS NULL OR r.location_id=$4)
      AND (r.request_no ILIKE $5 OR EXISTS (SELECT 1 FROM bms_branch_requisition_items i
        WHERE i.tenant_id=r.tenant_id AND i.requisition_id=r.id AND (i.product_sku ILIKE $5 OR i.product_name ILIKE $5)))
      AND ($6::text IS NULL OR r.priority=$6) AND ($7::uuid IS NULL OR r.id=$7)
      AND ($8::date IS NULL OR r.needed_on >= $8) AND ($9::date IS NULL OR r.needed_on <= $9)`;
    const count = await c.query(
      `SELECT count(*)::int AS n FROM bms_branch_requisitions r WHERE ${where}`,
      params,
    );
    const result = await c.query(
      `SELECT r.*,r.needed_on::text AS needed_on,l.name AS location_name,COALESCE(u.name,u.email) AS creator,
        (SELECT COALESCE(eu.name,eu.email) FROM bms_branch_requisition_events e
         LEFT JOIN users eu ON eu.tenant_id=e.tenant_id AND eu.id=e.actor_id
         WHERE e.tenant_id=r.tenant_id AND e.requisition_id=r.id ORDER BY e.id DESC LIMIT 1) AS latest_actor
      FROM bms_branch_requisitions r JOIN bms_locations l ON l.tenant_id=r.tenant_id AND l.id=r.location_id
      LEFT JOIN users u ON u.tenant_id=r.tenant_id AND u.id=r.created_by
      WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT $10 OFFSET $11`,
      [...params, limit, offset],
    );
    const lines = await lineDetails(
      c,
      scope.tenantId,
      result.rows.map((r) => r.id),
    );
    if (!canSeePurchases)
      lines.forEach((l) => {
        l.purchases = [];
      });
    return {
      total: count.rows[0].n,
      locations: accessible,
      rows: result.rows.map((r) => ({
        id: r.id,
        requestNo: r.request_no,
        locationId: r.location_id,
        locationName: r.location_name,
        status: r.status,
        version: r.version,
        neededOn: iso(r.needed_on)?.slice(0, 10),
        priority: r.priority,
        note: r.note,
        creator: r.creator ?? r.created_by,
        latestActor: r.latest_actor ?? r.creator ?? r.created_by,
        createdAt: iso(r.created_at),
        items: lines.filter((l) => l.requisitionId === r.id),
      })),
    };
  });
}

export async function requisitionEvents(scope: RequisitionScope, id: string) {
  return transaction(scope, async (c) => {
    if (!uuid(id)) return [];
    const allowed = (await locations(c, scope)).map((l) => l.id);
    const events = await c.query(
      `WITH request_events AS (SELECT e.id::text AS event_key,e.action,e.details,e.created_at,COALESCE(u.name,u.email) AS actor
      FROM bms_branch_requisition_events e
      JOIN bms_branch_requisitions r ON r.tenant_id=e.tenant_id AND r.id=e.requisition_id
      LEFT JOIN users u ON u.tenant_id=e.tenant_id AND u.id=e.actor_id
      WHERE e.tenant_id=$1 AND e.requisition_id=$2 AND r.location_id=ANY($3::uuid[])
      ), linked AS (
        SELECT DISTINCT t.id,t.transfer_no,t.sent_at,t.received_at,t.sent_by,t.received_by,t.receiving_note,
          EXISTS (SELECT 1 FROM bms_stock_transfer_items ti WHERE ti.tenant_id=t.tenant_id
            AND ti.transfer_id=t.id AND ti.qty>COALESCE(ti.received_qty,0)) AS discrepancy
        FROM bms_branch_requisition_transfers a
        JOIN bms_branch_requisition_items i ON i.tenant_id=a.tenant_id AND i.id=a.item_id
        JOIN bms_branch_requisitions r ON r.tenant_id=i.tenant_id AND r.id=i.requisition_id
        JOIN bms_stock_transfer_items ti ON ti.tenant_id=a.tenant_id AND ti.id=a.transfer_item_id
        JOIN bms_stock_transfers t ON t.tenant_id=ti.tenant_id AND t.id=ti.transfer_id
        WHERE r.tenant_id=$1 AND r.id=$2 AND r.location_id=ANY($3::uuid[])
      ), history AS (
        SELECT * FROM request_events UNION ALL
        SELECT t.id::text || v.action,v.action,jsonb_build_object('reason',t.transfer_no || COALESCE(' · ' || v.note,'')),
          v.at,COALESCE(u.name,u.email,'—')
        FROM linked t CROSS JOIN LATERAL (VALUES
          ('TRANSFER_SENT',t.sent_at,t.sent_by,NULL::text),
          ('TRANSFER_RECEIVED',t.received_at,t.received_by,t.receiving_note),
          ('TRANSFER_DISCREPANCY',CASE WHEN t.discrepancy THEN t.received_at END,t.received_by,t.receiving_note)
        ) v(action,at,actor_id,note)
        LEFT JOIN users u ON u.tenant_id=$1 AND u.id=v.actor_id WHERE v.at IS NOT NULL
      ) SELECT * FROM history ORDER BY created_at DESC,event_key DESC LIMIT 100`,
      [scope.tenantId, id, allowed],
    );
    return events.rows.map((r) => ({
      action: r.action,
      note: String(r.details.reason ?? ""),
      actor: r.actor ?? "—",
      at: iso(r.created_at),
    }));
  });
}

export async function requisitionNotices(scope: RequisitionScope) {
  return transaction(scope, async (c) => {
    const allowed = (await locations(c, scope)).map((l) => l.id);
    const result = await c.query(
      `SELECT n.id,r.id AS "requestId",r.request_no AS "requestNo",n.data->>'kind' AS kind,n.created_at
      FROM notifications n JOIN bms_branch_requisitions r ON r.id=n.entity_id AND r.tenant_id=$1
      WHERE n.user_id=$2 AND n.entity_type='bms_requisition_action' AND r.location_id=ANY($3::uuid[])
      ORDER BY n.created_at DESC,n.id DESC LIMIT 20`,
      [scope.tenantId, scope.actorId, allowed],
    );
    return result.rows.map((r) => ({ ...r, at: iso(r.created_at) }));
  });
}

export async function requisitionCatalog(
  scope: RequisitionScope,
  search: string,
) {
  return transaction(scope, async (c) => {
    const rows = await c.query(
      `SELECT v.product_sku AS sku,v.code AS size,p.name FROM bms_product_variants v
      JOIN bms_products p ON p.tenant_id=v.tenant_id AND p.sku=v.product_sku
      WHERE v.tenant_id=$1 AND v.active AND (p.sku ILIKE $2 OR p.name ILIKE $2) ORDER BY p.sku,v.code LIMIT 30`,
      [scope.tenantId, `%${search.trim().slice(0, 100)}%`],
    );
    return rows.rows;
  });
}

export async function requisitionAvailability(
  scope: RequisitionScope,
  sku: string,
  size: string,
) {
  return transaction(scope, async (c) => {
    const allowed = (await locations(c, scope))
      .filter((l) => l.active)
      .map((l) => l.id);
    const result = await c.query(
      `SELECT l.id,l.name,COALESCE(i.current_stock,0)::int AS stock,
      COALESCE(i.reserved_stock,0)::int AS reserved,COALESCE(i.quarantine_stock,0)::int AS quarantine
      FROM bms_locations l LEFT JOIN bms_inventory i ON i.tenant_id=l.tenant_id AND i.location_id=l.id
       AND i.product_sku=$3 AND i.size=$4 WHERE l.tenant_id=$1 AND l.id=ANY($2::uuid[]) ORDER BY l.code`,
      [scope.tenantId, allowed, sku, size],
    );
    return result.rows.map((r) => ({
      ...r,
      available: Math.max(0, r.stock - r.reserved),
    }));
  });
}

const demandSql = `WITH demand AS (
  SELECT i.product_sku AS sku,i.size,i.product_name AS name,r.id,r.request_no,l.name AS branch,r.needed_on,r.priority,
    GREATEST(0,i.approved_qty-COALESCE((SELECT sum(CASE WHEN t.status IN ('DRAFT','IN_TRANSIT') THEN ti.qty
      WHEN t.status='RECEIVED' THEN ti.received_qty ELSE 0 END)
      FROM bms_branch_requisition_transfers a JOIN bms_stock_transfer_items ti
      ON ti.tenant_id=a.tenant_id AND ti.id=a.transfer_item_id
      JOIN bms_stock_transfers t ON t.tenant_id=ti.tenant_id AND t.id=ti.transfer_id
      WHERE a.tenant_id=i.tenant_id AND a.item_id=i.id),0))::int AS remaining
  FROM bms_branch_requisition_items i JOIN bms_branch_requisitions r ON r.tenant_id=i.tenant_id AND r.id=i.requisition_id
  JOIN bms_locations l ON l.tenant_id=r.tenant_id AND l.id=r.location_id
  WHERE i.tenant_id=$1 AND r.location_id=ANY($2::uuid[]) AND r.status='APPROVED'
)`;

export async function requisitionDemandRequests(
  scope: RequisitionScope,
  sku: string,
  size: string,
  offset = 0,
) {
  return transaction(scope, async (c) => {
    const allowed = (await locations(c, scope)).map((l) => l.id);
    const params = [scope.tenantId, allowed, sku, size];
    const where = `remaining>0 AND sku=$3 AND size=$4`;
    const count = await c.query(
      `${demandSql} SELECT count(*)::int AS total FROM demand WHERE ${where}`,
      params,
    );
    const result = await c.query(
      `${demandSql} SELECT id,request_no AS "requestNo",branch,needed_on::text AS "neededOn",priority,remaining
      FROM demand WHERE ${where} ORDER BY needed_on ASC NULLS LAST,request_no,id LIMIT 20 OFFSET $5`,
      [...params, Math.max(0, offset)],
    );
    return { total: count.rows[0].total, rows: result.rows };
  });
}

/** Operational all-time metrics, restricted to the caller's branches; no PO receipt counts as delivery. */
export async function requisitionMetrics(scope: RequisitionScope) {
  return transaction(scope, async (c) => {
    const allowed = (await locations(c, scope)).map((l) => l.id);
    const result = await c.query(
      `WITH line_progress AS (
      SELECT i.requisition_id,i.requested_qty,i.approved_qty,
        COALESCE(x.good,0) AS good,COALESCE(x.planned,0) AS planned,COALESCE(x.discrepancy,0) AS discrepancy,x.completed_at
      FROM bms_branch_requisition_items i
      JOIN bms_branch_requisitions r ON r.tenant_id=i.tenant_id AND r.id=i.requisition_id
      LEFT JOIN LATERAL (
        SELECT sum(CASE WHEN t.status='RECEIVED' THEN ti.received_qty ELSE 0 END) AS good,
          sum(CASE WHEN t.status IN ('DRAFT','IN_TRANSIT') THEN ti.qty ELSE 0 END) AS planned,
          sum(CASE WHEN t.status='RECEIVED' THEN ti.qty-COALESCE(ti.received_qty,0) ELSE 0 END) AS discrepancy,
          max(t.received_at) FILTER (WHERE t.status='RECEIVED' AND ti.received_qty>0) AS completed_at
        FROM bms_branch_requisition_transfers a
        JOIN bms_stock_transfer_items ti ON ti.tenant_id=a.tenant_id AND ti.id=a.transfer_item_id
        JOIN bms_stock_transfers t ON t.tenant_id=ti.tenant_id AND t.id=ti.transfer_id
        WHERE a.tenant_id=i.tenant_id AND a.item_id=i.id
      ) x ON true WHERE i.tenant_id=$1 AND r.location_id=ANY($2::uuid[])
    ), request_progress AS (
      SELECT r.id,r.status,r.needed_on,
        sum(p.requested_qty) AS requested,COALESCE(sum(p.approved_qty),0) AS approved,
        sum(LEAST(p.good,COALESCE(p.approved_qty,0))) AS good,
        sum(GREATEST(0,COALESCE(p.approved_qty,0)-p.good-p.planned)) AS unallocated,
        sum(p.discrepancy) AS discrepancy,
        CASE WHEN bool_and(p.good>=COALESCE(p.approved_qty,0)) AND sum(p.approved_qty)>0 THEN max(p.completed_at) END AS completed_at,
        e.submitted_at,e.reviewed_at
      FROM bms_branch_requisitions r JOIN line_progress p ON p.requisition_id=r.id
      LEFT JOIN LATERAL (SELECT min(created_at) FILTER (WHERE action='SUBMIT') AS submitted_at,
        min(created_at) FILTER (WHERE action='REVIEW') AS reviewed_at
        FROM bms_branch_requisition_events WHERE tenant_id=r.tenant_id AND requisition_id=r.id) e ON true
      WHERE r.tenant_id=$1 AND r.location_id=ANY($2::uuid[])
      GROUP BY r.id,e.submitted_at,e.reviewed_at
    ) SELECT count(*) FILTER(WHERE submitted_at IS NOT NULL)::float8 AS "submittedRequests",
      COALESCE(sum(requested) FILTER(WHERE submitted_at IS NOT NULL),0)::float8 AS "requestedUnits",
      count(*) FILTER(WHERE status='SUBMITTED')::float8 AS "pendingReview",
      count(*) FILTER(WHERE reviewed_at IS NOT NULL)::float8 AS "reviewedRequests",
      count(*) FILTER(WHERE reviewed_at IS NOT NULL AND approved>0)::float8 AS "approvedRequests",
      count(*) FILTER(WHERE reviewed_at IS NOT NULL AND approved>0 AND approved<requested)::float8 AS "partialRequests",
      COALESCE(sum(approved) FILTER(WHERE status IN ('APPROVED','CLOSED')),0)::float8 AS "approvedUnits",
      COALESCE(sum(good) FILTER(WHERE status IN ('APPROVED','CLOSED')),0)::float8 AS "receivedUnits",
      COALESCE(sum(unallocated) FILTER(WHERE status='APPROVED'),0)::float8 AS "unallocatedUnits",
      count(*) FILTER(WHERE (status='SUBMITTED' OR (status='APPROVED' AND good<approved)) AND needed_on<(now() AT TIME ZONE 'Asia/Bangkok')::date)::float8 AS "overdueRequests",
      COALESCE(sum(discrepancy),0)::float8 AS "discrepancyUnits",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (reviewed_at-submitted_at))/3600)
        FILTER(WHERE reviewed_at IS NOT NULL AND submitted_at IS NOT NULL) AS "medianReviewHours",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at-reviewed_at))/3600)
        FILTER(WHERE completed_at IS NOT NULL AND reviewed_at IS NOT NULL) AS "medianFulfilmentHours"
      FROM request_progress`,
      [scope.tenantId, allowed],
    );
    return result.rows[0];
  });
}

export async function consolidateBranchRequisitions(
  scope: RequisitionScope,
  search = "",
  offset = 0,
) {
  return transaction(scope, async (c) => {
    const allowed = (await locations(c, scope)).map((l) => l.id);
    const grouped = `${demandSql}, grouped AS (
      SELECT sku,size,min(name) AS name,sum(remaining)::float8 AS remaining,count(*)::int AS requests
      FROM demand WHERE remaining>0 AND (sku ILIKE $3 OR name ILIKE $3) GROUP BY sku,size)`;
    const params = [scope.tenantId, allowed, `%${search.trim().slice(0,200)}%`];
    const count = await c.query(`${grouped} SELECT count(*)::int AS total FROM grouped`, params);
    const result = await c.query(
      `${grouped} SELECT * FROM grouped ORDER BY sku,size LIMIT 20 OFFSET $4`,
      [...params, Math.max(0, offset)],
    );
    return { total: count.rows[0].total, rows: result.rows };
  });
}

async function evidence(
  c: PoolClient,
  s: RequisitionScope,
  id: string,
  action: string,
  details: object,
) {
  await c.query(
    `INSERT INTO bms_branch_requisition_events(tenant_id,requisition_id,action,actor_id,details)
    VALUES($1,$2,$3,$4,$5)`,
    [s.tenantId, id, action, s.actorId, JSON.stringify(details)],
  );
  await c.query(
    `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,$3,$4,$5)`,
    [
      s.tenantId,
      s.actorId,
      `inventory.requisition.${action.toLowerCase()}`,
      id,
      JSON.stringify(details),
    ],
  );
}

export async function commandBranchRequisition(
  scope: RequisitionScope,
  input: RequisitionCommand,
): Promise<RequisitionResult> {
  try {
    if (input.action !== "SAVE" && input.confirmed !== true)
      reject("CONFIRMATION_REQUIRED");
    const idempotencyKey = input.idempotencyKey?.trim() ?? "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200)
      reject("INVALID_INPUT");
    if ((input.id && !uuid(input.id)) || (input.note?.length ?? 0) > 2000)
      reject("INVALID_INPUT");
    const request = inventoryIdempotency(
      `requisition.${input.action.toLowerCase()}`,
      idempotencyKey,
      { actor: scope.actorId, ...input, idempotencyKey },
    );
    let fresh = false;
    const committed = await transaction(scope, async (c) => {
      const allowed = await locations(c, scope);
      if (
        input.action === "SAVE" &&
        (!uuid(input.locationId) ||
          !allowed.some((l) => l.active && l.id === input.locationId))
      )
        reject("NOT_FOUND");
      let header: any = null;
      if (input.id) {
        const r = await c.query(
          `SELECT * FROM bms_branch_requisitions WHERE tenant_id=$1 AND id=$2
          AND location_id=ANY($3::uuid[]) FOR UPDATE`,
          [scope.tenantId, input.id, allowed.map((l) => l.id)],
        );
        header = r.rows[0];
        if (!header) reject("NOT_FOUND");
      }
      const replay = await replayInventoryResult<RequisitionResult>(
        c,
        scope.tenantId,
        request,
      );
      if (replay) return replay;
      if (header && input.version !== header.version) reject("STALE_VERSION");
      let id: string = input.id ?? "";
      let transferId: string | undefined;
      let poId = input.action === "LINK_PO" ? input.poId : undefined;
      const reason = input.note?.trim() ?? "";
      const lines = input.items ?? [];
      if (lines.length > 100 || new Set(lines.map(key)).size !== lines.length)
        reject("INVALID_INPUT");
      if (
        lines.some(
          (l) =>
            !l.sku ||
            !l.size ||
            l.sku.length > 200 ||
            l.size.length > 100 ||
            (l.note?.length ?? 0) > 2000,
        )
      )
        reject("INVALID_INPUT");
      if (input.action === "SAVE") {
        if (header && header.status !== "DRAFT") reject("INVALID_STATE");
        if (
          !uuid(input.locationId) ||
          !allowed.some((l) => l.active && l.id === input.locationId)
        )
          reject("NOT_FOUND");
        if (
          !lines.length ||
          lines.some((l) => !validRequisitionQuantity(l.qty))
        )
          reject("INVALID_INPUT");
        const priority = input.priority ?? "NORMAL";
        if (
          !["NORMAL", "URGENT"].includes(priority) ||
          (priority === "URGENT" && !reason)
        )
          reject("REASON_REQUIRED");
        if (input.neededOn && !validRequisitionDate(input.neededOn))
          reject("INVALID_INPUT");
        const names: string[] = [];
        for (const line of lines) {
          const v = await c.query(
            `SELECT p.name FROM bms_product_variants v JOIN bms_products p
            ON p.tenant_id=v.tenant_id AND p.sku=v.product_sku WHERE v.tenant_id=$1 AND v.product_sku=$2 AND v.code=$3 AND v.active`,
            [scope.tenantId, line.sku, line.size],
          );
          if (!v.rowCount) reject("PRODUCT_NOT_FOUND");
          names.push(v.rows[0].name);
        }
        if (!header) {
          id = await insertWithDailyDocNo(
            c,
            {
              tenantId: scope.tenantId,
              table: "bms_branch_requisitions",
              prefix: "REQ",
            },
            async (no) => {
              const row = await c.query(
                `INSERT INTO bms_branch_requisitions(tenant_id,request_no,location_id,needed_on,priority,note,created_by)
              VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
                [
                  scope.tenantId,
                  no,
                  input.locationId,
                  input.neededOn || null,
                  priority,
                  reason,
                  scope.actorId,
                ],
              );
              return row.rows[0].id;
            },
          );
        } else {
          await c.query(
            `UPDATE bms_branch_requisitions SET location_id=$3,needed_on=$4,priority=$5,note=$6 WHERE tenant_id=$1 AND id=$2`,
            [
              scope.tenantId,
              id,
              input.locationId,
              input.neededOn || null,
              priority,
              reason,
            ],
          );
          await c.query(
            `DELETE FROM bms_branch_requisition_items WHERE tenant_id=$1 AND requisition_id=$2`,
            [scope.tenantId, id],
          );
        }
        for (let n = 0; n < lines.length; n++)
          await c.query(
            `INSERT INTO bms_branch_requisition_items
          (tenant_id,requisition_id,product_sku,size,product_name,requested_qty) VALUES($1,$2,$3,$4,$5,$6)`,
            [
              scope.tenantId,
              id,
              lines[n].sku,
              lines[n].size,
              names[n],
              lines[n].qty,
            ],
          );
      } else {
        if (!header) reject("NOT_FOUND");
        const stored = await lineDetails(c, scope.tenantId, [id]);
        if (input.action === "SUBMIT") {
          if (header.status !== "DRAFT" || !stored.length)
            reject("INVALID_STATE");
          await c.query(
            `UPDATE bms_branch_requisitions SET status='SUBMITTED' WHERE tenant_id=$1 AND id=$2`,
            [scope.tenantId, id],
          );
        } else if (input.action === "REVIEW") {
          if (header.status !== "SUBMITTED") reject("INVALID_STATE");
          if (lines.length !== stored.length) reject("INVALID_INPUT");
          for (const line of stored) {
            const review = lines.find((l) => key(l) === key(line));
            if (
              !review ||
              !Number.isInteger(review.qty) ||
              review.qty < 0 ||
              review.qty > line.requested
            )
              reject("INVALID_INPUT");
            if (review.qty < line.requested && !(review.note?.trim() || reason))
              reject("REASON_REQUIRED");
            await c.query(
              `UPDATE bms_branch_requisition_items SET approved_qty=$3,review_note=$4 WHERE tenant_id=$1 AND id=$2`,
              [
                scope.tenantId,
                line.id,
                review.qty,
                review.note?.trim() || reason,
              ],
            );
          }
          await c.query(
            `UPDATE bms_branch_requisitions SET status=$3 WHERE tenant_id=$1 AND id=$2`,
            [
              scope.tenantId,
              id,
              lines.some((l) => l.qty > 0) ? "APPROVED" : "REJECTED",
            ],
          );
        } else if (input.action === "TRANSFER") {
          if (header.status !== "APPROVED") reject("INVALID_STATE");
          if (
            !uuid(input.sourceId) ||
            input.sourceId === header.location_id ||
            !allowed.some((l) => l.active && l.id === input.sourceId)
          )
            reject("NOT_FOUND");
          if (
            !lines.length ||
            lines.some((l) => !validRequisitionQuantity(l.qty))
          )
            reject("INVALID_INPUT");
          for (const line of [...lines].sort((a, b) =>
            key(a).localeCompare(key(b)),
          )) {
            const original = stored.find((l) => key(l) === key(line));
            if (!original || line.qty > original.remaining)
              reject("OVER_ALLOCATED");
            // The existing transfer engine moves integer stock, not lot/serial identities or recipes.
            const policy = await c.query(
              `SELECT 1 FROM bms_products p
              LEFT JOIN bms_product_stock_policies sp ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku
              WHERE p.tenant_id=$1 AND p.sku=$2 AND NOT p.serial_tracked AND NOT p.is_bundle
              AND COALESCE(sp.stock_policy,'DIRECT') IN ('DIRECT','PACK','WEIGHTED') AND NOT COALESCE(sp.lot_tracking,false)
              AND NOT EXISTS (SELECT 1 FROM bms_inventory_lots lot WHERE lot.tenant_id=p.tenant_id AND lot.product_sku=p.sku AND lot.size=$3 AND lot.qty>0)`,
              [scope.tenantId, line.sku, line.size],
            );
            if (
              !policy.rowCount ||
              line.size !== line.size.trim().toUpperCase()
            )
              reject("UNSUPPORTED_TRANSFER");
            const inv = await c.query(
              `SELECT current_stock-reserved_stock AS available FROM bms_inventory
              WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size=$4 FOR UPDATE`,
              [scope.tenantId, input.sourceId, line.sku, line.size],
            );
            if (Number(inv.rows[0]?.available ?? 0) < line.qty)
              reject("INSUFFICIENT_STOCK");
          }
          const transfer = await createStockTransferInTx(c, {
            tenantId: scope.tenantId,
            fromLocationId: input.sourceId,
            toLocationId: header.location_id,
            items: lines,
            createdBy: scope.actorId,
            note: header.request_no,
          });
          if (transfer.status !== "CREATED") reject("INVALID_INPUT");
          transferId = transfer.transferId;
          for (const line of lines) {
            const original = stored.find((l) => key(l) === key(line))!;
            const linked = await c.query(
              `INSERT INTO bms_branch_requisition_transfers(tenant_id,item_id,transfer_item_id)
              SELECT $1,$2,id FROM bms_stock_transfer_items WHERE tenant_id=$1 AND transfer_id=$3 AND product_sku=$4 AND size=$5`,
              [scope.tenantId, original.id, transferId, line.sku, line.size],
            );
            // The legacy writer normalizes identifiers. Never commit a draft whose
            // actual item no longer matches the approved request identity.
            if (linked.rowCount !== 1) reject("INVALID_INPUT");
          }
        } else if (input.action === "LINK_PO" || input.action === "CREATE_PO") {
          if (header.status !== "APPROVED") reject("INVALID_STATE");
          if (
            !lines.length ||
            lines.some((l) => !validRequisitionQuantity(l.qty))
          )
            reject("INVALID_INPUT");
          if (input.action === "CREATE_PO") {
            if (
              !uuid(input.supplierId) ||
              !validRequisitionPurchaseCosts(lines)
            )
              reject("INVALID_INPUT");
            const created = await createPurchaseOrderInTx(c, {
              tenantId: scope.tenantId,
              supplierId: input.supplierId,
              items: lines.map((l) => ({ ...l, unitCost: l.unitCost! })),
              note: header.request_no,
              actor: scope.actorId,
            });
            if (created.status !== "CREATED") reject("INVALID_INPUT");
            poId = created.poId;
            await c.query(
              `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta) VALUES($1,$2,'purchase.create',$3,$4)`,
              [
                scope.tenantId,
                scope.actorId,
                poId,
                JSON.stringify({ requisitionId: id, total: created.total }),
              ],
            );
          }
          if (!uuid(poId)) reject("INVALID_INPUT");
          // Lock the PO before allocation: concurrent requests cannot over-allocate one purchase line.
          const po = await c.query(
            `SELECT id FROM bms_purchase_orders WHERE tenant_id=$1 AND id=$2 AND status IN ('OPEN','PARTIAL') FOR UPDATE`,
            [scope.tenantId, poId],
          );
          if (!po.rowCount) reject("NOT_FOUND");
          for (const line of lines) {
            const original = stored.find((l) => key(l) === key(line));
            if (!original || line.qty > original.remaining)
              reject("OVER_ALLOCATED");
            const pi = await c.query(
              `SELECT p.id,p.qty_ordered,
              COALESCE((SELECT sum(a.qty) FROM bms_branch_requisition_purchases a WHERE a.tenant_id=p.tenant_id AND a.po_item_id=p.id),0)::int AS allocated
              FROM bms_purchase_order_items p WHERE p.tenant_id=$1 AND p.po_id=$2 AND p.product_sku=$3 AND p.size=$4`,
              [scope.tenantId, poId, line.sku, line.size],
            );
            if (
              !pi.rowCount ||
              pi.rows[0].qty_ordered - pi.rows[0].allocated < line.qty
            )
              reject("OVER_ALLOCATED");
            // G and branch requisitions must not promise the same PO line to two workflows.
            if ((await c.query(`SELECT 1 FROM bms_operation_material_links WHERE tenant_id=$1 AND po_item_id=$2 LIMIT 1`,
              [scope.tenantId, pi.rows[0].id])).rowCount) reject("OVER_ALLOCATED");
            const already = await c.query(
              `SELECT COALESCE(sum(a.qty),0)::int AS qty FROM bms_branch_requisition_purchases a
              JOIN bms_purchase_order_items p ON p.tenant_id=a.tenant_id AND p.id=a.po_item_id
              JOIN bms_purchase_orders po ON po.tenant_id=p.tenant_id AND po.id=p.po_id
              WHERE a.tenant_id=$1 AND a.item_id=$2 AND (po.status<>'CANCELLED' OR p.qty_received>0)`,
              [scope.tenantId, original.id],
            );
            if (line.qty + already.rows[0].qty > original.approved)
              reject("OVER_ALLOCATED");
            await c.query(
              `INSERT INTO bms_branch_requisition_purchases(tenant_id,item_id,po_item_id,qty,created_by)
              VALUES($1,$2,$3,$4,$5)
              ON CONFLICT (tenant_id,item_id,po_item_id) DO UPDATE SET qty=bms_branch_requisition_purchases.qty+EXCLUDED.qty`,
              [
                scope.tenantId,
                original.id,
                pi.rows[0].id,
                line.qty,
                scope.actorId,
              ],
            );
          }
        } else if (input.action === "CANCEL" || input.action === "CLOSE") {
          if (!reason) reject("REASON_REQUIRED");
          if (
            !(
              input.action === "CANCEL"
                ? ["DRAFT", "SUBMITTED", "APPROVED"]
                : ["APPROVED"]
            ).includes(header.status)
          )
            reject("INVALID_STATE");
          // A live draft could be sent later by an old client. Close/cancel only after it is resolved.
          const live = stored.some((l) => l.drafts > 0 || l.transit > 0);
          const purchased = stored.some((l) =>
            l.purchases.some((p: any) =>
              input.action === "CANCEL"
                ? p.status !== "CANCELLED" || p.received > 0
                : ["OPEN", "PARTIAL"].includes(p.status),
            ),
          );
          if (
            live ||
            purchased ||
            (input.action === "CANCEL" &&
              stored.some((l) => l.received > 0 || l.discrepancy > 0))
          )
            reject("LINKED_WORK_OPEN");
          await c.query(
            `UPDATE bms_branch_requisitions SET status=$3 WHERE tenant_id=$1 AND id=$2`,
            [
              scope.tenantId,
              id,
              input.action === "CANCEL" ? "CANCELLED" : "CLOSED",
            ],
          );
        } else reject("INVALID_INPUT");
      }
      if (header)
        await c.query(
          `UPDATE bms_branch_requisitions SET version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
          [scope.tenantId, id],
        );
      await evidence(c, scope, id, input.action, {
        reason,
        transferId,
        poId,
        lines: lines.length,
        decisions: lines.map((l) => ({
          sku: l.sku,
          size: l.size,
          qty: l.qty,
          ...(input.action === "REVIEW" ? { note: l.note } : {}),
          ...(input.action === "CREATE_PO" ? { unitCost: l.unitCost } : {}),
        })),
        before: header?.status ?? null,
      });
      const result: RequisitionResult = {
        status: "OK",
        id,
        ...(transferId ? { transferId } : {}),
        ...(poId ? { poId } : {}),
      };
      await storeInventoryResult(c, scope.tenantId, request, result);
      fresh = true;
      return result;
    });
    if (
      fresh &&
      committed.id &&
      (input.action === "SUBMIT" || input.action === "REVIEW")
    )
      await notifyBranchRequisitionCommitted({
        ...scope,
        requestId: committed.id,
        kind: input.action,
      });
    return committed;
  } catch (error) {
    if (error instanceof Rejection) return { status: error.status };
    if (isIdempotencyConflictError(error))
      return { status: "IDEMPOTENCY_CONFLICT" };
    throw error;
  }
}
