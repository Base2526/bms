import { checklistPermission, checklistTx, type ChecklistScope } from "./operationChecklists";
import { ChecklistError, checklistText, checklistUuid, rejectChecklist as reject } from "./operationChecklistPolicy";
import { productionQuantity } from "./operationProductionPolicy";
import { directProduct } from "./operationProductionProduct";
import { teamBranches, teamHash, teamPage } from "./operationTeamReads";
import { teamInstant } from "./operationTeamPolicy";
import { createOrderInTx } from "./orders";
import { notifyOrderActionCommitted } from "./orderActionNotify";

export type FactoryDemandInput = {
  action: "CREATE" | "CANCEL" | "CONVERT";
  idempotencyKey: string;
  confirmed: boolean;
  id?: string;
  version?: number;
  locationId?: string;
  customerId?: string | null;
  outputSku?: string;
  outputSize?: string;
  qty?: number;
  dueAt?: string;
  note?: string;
};

function permission(s: ChecklistScope) {
  checklistPermission(s, "operations.production.manage");
  checklistPermission(s, "order.create");
  checklistPermission(s, "customer.view");
}

export async function factoryDemandWorkspace(
  s: ChecklistScope,
  filter: { locationId?: string; search?: string; offset?: number } = {},
) {
  permission(s);
  const search = checklistText(filter.search, 120), offset = teamPage(filter.offset);
  return checklistTx(s, async (c) => {
    const locations = await teamBranches(c, s, filter.locationId);
    const predicate = `d.tenant_id=$1 AND d.location_id=ANY($2::uuid[])
      AND ($3='' OR position(lower($3) in lower(d.output_sku||' '||d.id::text||' '||COALESCE(cu.name,'')))>0)`;
    const args = [s.tenantId, locations, search];
    const rows = (await c.query(
      `SELECT d.id,d.location_id,d.customer_id,cu.name customer_name,d.output_sku,d.output_size,
        d.qty,d.due_at,d.note,d.status,d.version,d.order_id,d.created_at,
        (SELECT LEAST(COALESCE(sum(p.actual_qty),0),2147483647)::int FROM bms_operation_production p
          WHERE p.tenant_id=d.tenant_id AND p.factory_demand_id=d.id AND p.status='POSTED') produced_qty
       FROM bms_factory_demands d LEFT JOIN bms_customers cu
         ON cu.tenant_id=d.tenant_id AND cu.id=d.customer_id
       WHERE ${predicate} ORDER BY (d.status='OPEN') DESC,d.due_at,d.id LIMIT 25 OFFSET $4`,
      [...args, offset],
    )).rows;
    const total = (await c.query(
      `SELECT count(*)::int n FROM bms_factory_demands d LEFT JOIN bms_customers cu
       ON cu.tenant_id=d.tenant_id AND cu.id=d.customer_id WHERE ${predicate}`,
      args,
    )).rows[0].n;
    return { rows, total };
  });
}

export async function factoryDemandCustomers(s: ChecklistScope, search: string) {
  permission(s);
  const term = checklistText(search, 120);
  return checklistTx(s, async (c) => (await c.query(
    `SELECT id,name,phone FROM bms_customers
     WHERE tenant_id=$1 AND deleted_at IS NULL
       AND ($2='' OR position(lower($2) in lower(name||' '||COALESCE(phone,'')))>0)
     ORDER BY name,id LIMIT 51`,
    [s.tenantId, term],
  )).rows);
}

export async function commandFactoryDemand(s: ChecklistScope, input: FactoryDemandInput) {
  try {
    permission(s);
    if (!input || !["CREATE", "CANCEL", "CONVERT"].includes(input.action))
      return reject("INVALID_INPUT");
    if (input.confirmed !== true) return reject("CONFIRMATION_REQUIRED");
    const key = `factory-demand:${checklistText(input.idempotencyKey, 128, true)}`;
    const fingerprint = teamHash(input);
    let committedOrderId: string | null = null;
    const result = await checklistTx(s, async (c) => {
      // A replay may report a prior success only while this actor still owns the branch.
      if (input.action === "CREATE") {
        if (!checklistUuid(input.locationId)) return reject("INVALID_INPUT");
        await teamBranches(c, s, input.locationId);
      } else {
        if (!checklistUuid(input.id)) return reject("INVALID_INPUT");
        const branch = (await c.query(
          `SELECT location_id FROM bms_factory_demands WHERE tenant_id=$1 AND id=$2`,
          [s.tenantId, input.id],
        )).rows[0];
        if (!branch) return reject("NOT_FOUND");
        await teamBranches(c, s, branch.location_id);
      }
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${s.tenantId}:${s.actorId}:${key}`,
      ]);
      const prior = (await c.query(
        `SELECT fingerprint,result FROM bms_operation_commands
         WHERE tenant_id=$1 AND actor=$2 AND key=$3`,
        [s.tenantId, s.actorId, key],
      )).rows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint) return reject("IDEMPOTENCY_CONFLICT");
        return prior.result;
      }
      let outcome: { status: string; id?: string; version?: number };
      if (input.action === "CREATE") {
        if (!checklistUuid(input.locationId)) return reject("INVALID_INPUT");
        await teamBranches(c, s, input.locationId);
        const sku = checklistText(input.outputSku, 200, true);
        const size = checklistText(input.outputSize, 100, true);
        const qty = productionQuantity(input.qty);
        const due = teamInstant(input.dueAt);
        const note = checklistText(input.note, 2000);
        await directProduct(c, s.tenantId, sku, size);
        const customerId = input.customerId;
        if (!checklistUuid(customerId)) return reject("CUSTOMER_REQUIRED");
        if (!(await c.query(
          `SELECT 1 FROM bms_customers WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE`,
          [s.tenantId, customerId],
        )).rowCount) return reject("CUSTOMER_NOT_FOUND");
        const row = (await c.query(
          `INSERT INTO bms_factory_demands
           (tenant_id,location_id,customer_id,output_sku,output_size,qty,due_at,note,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,version`,
          [s.tenantId, input.locationId, customerId, sku, size, qty, due, note, s.actorId],
        )).rows[0];
        outcome = { status: "OK", id: row.id, version: row.version };
      } else {
        if (!checklistUuid(input.id)) return reject("INVALID_INPUT");
        const demand = (await c.query(
          `SELECT * FROM bms_factory_demands WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [s.tenantId, input.id],
        )).rows[0];
        if (!demand) return reject("NOT_FOUND");
        await teamBranches(c, s, demand.location_id);
        if (demand.version !== input.version) return reject("STALE_VERSION");
        if (demand.status !== "OPEN") return reject("INVALID_STATE");
        if (input.action === "CANCEL") {
          if (!checklistText(input.note, 2000, true)) return reject("REASON_REQUIRED");
          const active = await c.query(
            `SELECT 1 FROM bms_operation_production WHERE tenant_id=$1
             AND factory_demand_id=$2 AND status<>'CANCELLED' LIMIT 1`,
            [s.tenantId, demand.id],
          );
          if (active.rowCount) return reject("ACTIVE_PRODUCTION");
          await c.query(`UPDATE bms_factory_demands SET status='CANCELLED',version=version+1,updated_at=now()
            WHERE tenant_id=$1 AND id=$2`, [s.tenantId, demand.id]);
        } else {
          if (!demand.customer_id) return reject("CUSTOMER_REQUIRED");
          if (!(await c.query(
            `SELECT 1 FROM bms_customers WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE`,
            [s.tenantId, demand.customer_id],
          )).rowCount) return reject("CUSTOMER_NOT_FOUND");
          const produced = (await c.query(
            `SELECT LEAST(COALESCE(sum(actual_qty),0),2147483647)::int qty FROM bms_operation_production
             WHERE tenant_id=$1 AND factory_demand_id=$2 AND status='POSTED'`,
            [s.tenantId, demand.id],
          )).rows[0].qty;
          if (produced < demand.qty) return reject("PRODUCTION_SHORT");
          // createOrderInTx is the existing price, stock, lot and reservation authority.
          // A rejected order aborts this whole transaction, including any temporary rows.
          const order = await createOrderInTx(c, {
            tenantId: s.tenantId, channel: "web", customerId: demand.customer_id,
            items: [{ sku: demand.output_sku, size: demand.output_size, qty: demand.qty }],
            locationId: demand.location_id, editorId: s.actorId,
            idempotencyKey: `factory-demand:${demand.id}`,
          });
          if (order.status !== "CREATED") return reject(order.status);
          committedOrderId = order.orderId;
          await c.query(`UPDATE bms_factory_demands
            SET status='ORDERED',order_id=$3,version=version+1,updated_at=now()
            WHERE tenant_id=$1 AND id=$2`, [s.tenantId, demand.id, order.orderId]);
        }
        outcome = { status: "OK", id: demand.id, version: demand.version + 1 };
      }
      await c.query(
        `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
         VALUES($1,$2,$3,$4,$5::jsonb)`,
        [s.tenantId, s.actorId, `factory.demand.${input.action.toLowerCase()}`, outcome.id,
          JSON.stringify({ orderId: committedOrderId,
            ...(input.action === "CANCEL" ? { reason: checklistText(input.note, 2000, true) } : {}) })],
      );
      await c.query(
        `INSERT INTO bms_operation_commands(tenant_id,actor,key,fingerprint,result)
         VALUES($1,$2,$3,$4,$5::jsonb)`,
        [s.tenantId, s.actorId, key, fingerprint, JSON.stringify(outcome)],
      );
      return outcome;
    });
    if (committedOrderId) await notifyOrderActionCommitted({
      tenantId: s.tenantId, orderId: committedOrderId, kind: "ORDER_CREATED",
      excludeUserId: s.actorId,
    });
    return result;
  } catch (e) {
    if (e instanceof ChecklistError) return { status: e.status };
    if (["40001", "40P01"].includes((e as any)?.code)) return { status: "RETRY_REQUIRED" };
    throw e;
  }
}
