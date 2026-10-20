import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type {
  CustomerDeliveryStatusV1,
  CustomerGrantRegistrationV1,
  CustomerMatchStageV1,
  OperationsDeliveryState,
} from "@bms/fleet-delivery-contracts";
import type { JsonValue } from "@bms/fleet-delivery-domain";
import {
  asSafeNumber,
  beginIdempotent,
  finishIdempotent,
  FleetDeliveryBusinessError,
  type IdempotentResponse,
  writeAudit,
} from "./phase2.js";
import { withTenantReadSnapshot, withTenantTransaction } from "./transaction.js";

export type CustomerGrantAction = "QUOTE" | "CREATE_DELIVERY" | "TRACK";

export type ResolvedCustomerGrant = {
  grantId: string;
  tenantRef: string;
  branchRef: string;
  bmsOrderRef: string;
  orderVersion: number;
  principal: string;
};

export async function registerSyntheticCustomerGrant(
  pool: Pool,
  input: CustomerGrantRegistrationV1,
  context: { principal: string; idempotencyKey: string; requestId: string; now?: Date },
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = "customer.grant.register.synthetic.v1";
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef,
      principal: context.principal,
      operation,
      key: context.idempotencyKey,
      request: input as unknown as JsonValue,
    });
    if (idem.replay) return idem.replay;
    const now = context.now ?? new Date();
    const expiresAt = new Date(input.expiresAt);
    if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > now.getTime() + 60 * 60_000) {
      throw new FleetDeliveryBusinessError("CUSTOMER_GRANT_EXPIRY_INVALID", 422);
    }
    const snapshot = await client.query<{ order_version: string }>(
      `SELECT order_version
         FROM fleet_delivery.order_context_snapshots
        WHERE tenant_ref=$1 AND branch_ref=$2 AND bms_order_ref=$3 AND current=true
        FOR SHARE`,
      [input.tenantRef, input.branchRef, input.bmsOrderRef],
    );
    if (!snapshot.rows[0]) throw new FleetDeliveryBusinessError("CUSTOMER_GRANT_ORDER_NOT_FOUND", 404);
    await client.query(
      `UPDATE fleet_delivery.customer_grants
          SET revoked_at=$4
        WHERE tenant_ref=$1 AND branch_ref=$2 AND bms_order_ref=$3 AND revoked_at IS NULL`,
      [input.tenantRef, input.branchRef, input.bmsOrderRef, now],
    );
    await client.query(
      `INSERT INTO fleet_delivery.customer_grants (
         id, tenant_ref, branch_ref, bms_order_ref, order_version, token_sha256,
         allowed_actions, synthetic_only, expires_at, created_by, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::text[],true,$8,$9,$10)`,
      [input.grantId, input.tenantRef, input.branchRef, input.bmsOrderRef,
        snapshot.rows[0].order_version, input.tokenSha256, input.allowedActions,
        expiresAt, context.principal, now],
    );
    await writeAudit(client, {
      tenantRef: input.tenantRef,
      branchRef: input.branchRef,
      principal: context.principal,
      action: "customer.grant.synthetic_registered",
      targetType: "customer_grant",
      targetRef: input.grantId,
      requestId: context.requestId,
      metadata: {
        bmsOrderRef: input.bmsOrderRef,
        orderVersion: Number(snapshot.rows[0].order_version),
        expiresAt: expiresAt.toISOString(),
        allowedActions: input.allowedActions,
        syntheticOnly: true,
      },
    });
    const response = {
      status: 201,
      body: {
        grantId: input.grantId,
        expiresAt: expiresAt.toISOString(),
        syntheticOnly: true,
      },
    };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef,
      principal: context.principal,
      operation,
      key: context.idempotencyKey,
    }, response);
    return response;
  });
}

export async function resolveSyntheticCustomerGrant(
  pool: Pool,
  rawToken: string,
  action: CustomerGrantAction,
): Promise<ResolvedCustomerGrant> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
    throw new FleetDeliveryBusinessError("CUSTOMER_AUTH_INVALID", 401);
  }
  const tokenSha256 = createHash("sha256").update(rawToken, "utf8").digest("hex");
  const result = await pool.query<{
    grant_id: string;
    tenant_ref: string;
    branch_ref: string;
    bms_order_ref: string;
    order_version: string;
  }>("SELECT * FROM fleet_delivery.resolve_customer_grant($1,$2)", [tokenSha256, action]);
  const row = result.rows[0];
  if (!row) throw new FleetDeliveryBusinessError("CUSTOMER_AUTH_INVALID", 401);
  return {
    grantId: row.grant_id,
    tenantRef: row.tenant_ref,
    branchRef: row.branch_ref,
    bmsOrderRef: row.bms_order_ref,
    orderVersion: Number(row.order_version),
    principal: `customer-grant:${row.grant_id}`,
  };
}

function customerMatchStage(state: OperationsDeliveryState): CustomerMatchStageV1 {
  if (state === "AWAITING_PAYMENT") return "PAYMENT_REQUIRED";
  if (state === "AWAITING_MERCHANT_ACCEPTANCE" || state === "PREPARING") return "MERCHANT_PREPARING";
  if (state === "READY_FOR_DISPATCH") return "READY_FOR_SEARCH";
  if (state === "SEARCHING_DRIVER") return "SEARCHING";
  if (state === "OFFERED") return "DRIVER_OFFERED";
  if (state === "EN_ROUTE_PICKUP" || state === "AT_PICKUP" || state === "PICKED_UP") {
    return "PICKUP_IN_PROGRESS";
  }
  if (state === "IN_TRANSIT") return "IN_TRANSIT";
  if (state === "AT_DROPOFF") return "ARRIVING";
  if (state === "DELIVERED") return "DELIVERED";
  if (state === "COMPLETED") return "COMPLETED";
  if (state === "DELIVERY_FAILED") return "DELIVERY_EXCEPTION";
  if (state === "RETURN_REQUESTED" || state === "RETURN_APPROVED" || state === "RETURN_IN_TRANSIT") {
    return "RETURNING";
  }
  if (state === "RETURNED_TO_MERCHANT") return "RETURNED";
  if (state === "RETURN_REVIEW") return "RETURN_REVIEW";
  if (state === "RETURN_RESOLVED") return "RETURN_RESOLVED";
  if (state === "MANUAL_DISPATCH_REQUIRED") return "MANUAL_REVIEW";
  if (state === "CANCELLED") return "CANCELLED";
  return "DRIVER_ASSIGNED";
}

export async function getCustomerDeliveryStatus(
  pool: Pool,
  grant: ResolvedCustomerGrant,
): Promise<CustomerDeliveryStatusV1> {
  return withTenantReadSnapshot(pool, grant.tenantRef, async (client) => {
    const liveGrant = await client.query(
      `SELECT 1
         FROM fleet_delivery.customer_grants
        WHERE id=$1 AND tenant_ref=$2 AND branch_ref=$3 AND bms_order_ref=$4
          AND synthetic_only=true AND revoked_at IS NULL AND expires_at > now()
          AND 'TRACK' = ANY(allowed_actions)`,
      [grant.grantId, grant.tenantRef, grant.branchRef, grant.bmsOrderRef],
    );
    if (liveGrant.rowCount !== 1) throw new FleetDeliveryBusinessError("CUSTOMER_AUTH_INVALID", 401);

    const serverNow = new Date();
    const result = await client.query<{
      id: string;
      quote_id: string;
      state: OperationsDeliveryState;
      version: string;
      currency: "THB";
      gross_delivery_fee_satang: string;
      customer_contribution_satang: string;
      merchant_subsidy_satang: string;
      updated_at: Date;
    }>(
      `SELECT id, quote_id, state, version, currency, gross_delivery_fee_satang,
              customer_contribution_satang, merchant_subsidy_satang, updated_at
         FROM fleet_delivery.deliveries
        WHERE tenant_ref=$1 AND branch_ref=$2 AND bms_order_ref=$3
          AND fulfillment_kind='DELIVERY'
        LIMIT 1`,
      [grant.tenantRef, grant.branchRef, grant.bmsOrderRef],
    );
    const row = result.rows[0];
    return {
      serverNow: serverNow.toISOString(),
      delivery: row ? {
        deliveryId: row.id,
        quoteId: row.quote_id,
        state: row.state,
        version: asSafeNumber(row.version),
        matchStage: customerMatchStage(row.state),
        currency: row.currency,
        grossDeliveryFeeSatang: asSafeNumber(row.gross_delivery_fee_satang),
        customerContributionSatang: asSafeNumber(row.customer_contribution_satang),
        merchantSubsidySatang: asSafeNumber(row.merchant_subsidy_satang),
        updatedAt: row.updated_at.toISOString(),
      } : null,
    };
  });
}
