import { GraphQLError } from "graphql/error";
import { query } from "@/lib/db";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { requireAuth } from "@/lib/auth";

type RevisionKind = "products" | "orders" | "payments" | "shipments";

const REVISION_CONFIG: Record<RevisionKind, {
  table: string;
  parentIdField: string;
  searchFields: string[];
  permission: string;
}> = {
  products: {
    table: "bms_products_revisions",
    parentIdField: "sku",
    searchFields: ["sku", "name", "barcode"],
    permission: "product.view",
  },
  orders: {
    table: "bms_orders_revisions",
    parentIdField: "id",
    searchFields: ["id", "customer_ref", "channel", "status"],
    permission: "order.view",
  },
  payments: {
    table: "bms_payments_revisions",
    parentIdField: "id",
    searchFields: ["id", "order_id", "method", "status", "slip_ref"],
    permission: "payment.view",
  },
  shipments: {
    table: "bms_shipments_revisions",
    parentIdField: "id",
    searchFields: ["id", "order_id", "carrier", "tracking_no", "status"],
    permission: "shipping.view",
  },
};

function normalizeKind(kind: string): RevisionKind {
  if (kind in REVISION_CONFIG) return kind as RevisionKind;
  throw new GraphQLError("unknown revision kind", {
    extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
  });
}

function requireAdmin(ctx: any) {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
}

function deepClone<T>(v: T): T {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function diffAny(before: any, after: any, path = ""): Array<{ path: string; before: any; after: any }> {
  if (before === after) return [];
  const bIsObj = before && typeof before === "object" && !Array.isArray(before);
  const aIsObj = after && typeof after === "object" && !Array.isArray(after);
  if (Array.isArray(before) || Array.isArray(after) || !bIsObj || !aIsObj) {
    return [{ path, before, after }];
  }
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})])).sort();
  return keys.flatMap((k) => diffAny(before?.[k], after?.[k], path ? `${path}.${k}` : k));
}

function titleCase(kind: RevisionKind) {
  return {
    products: "Products",
    orders: "Orders",
    payments: "Payments",
    shipments: "Shipments",
  }[kind];
}

function entityIdFromSnapshot(kind: RevisionKind, snapshot: any): string | null {
  const field = REVISION_CONFIG[kind].parentIdField;
  const value = snapshot?.[field];
  return value == null ? null : String(value);
}

function toISO(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") {
    const date = /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    return value;
  }
  return new Date().toISOString();
}

export const bmsRevisionsResolvers = {
  Query: {
    async bmsRevisionHistory(
      _p: unknown,
      args: { kind: string; entityId: string; limit?: number },
      ctx: any
    ) {
      requireAdmin(ctx);
      const kind = normalizeKind(args.kind);
      await requirePermission(ctx, REVISION_CONFIG[kind].permission as any);
      const tid = getTenantId(ctx);
      const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
      const cfg = REVISION_CONFIG[kind];
      const search = args.entityId.trim();
      const params: any[] = [tid];
      const conditions = ["tenant_id = $1"];

      if (search) {
        const fieldConds = cfg.searchFields.map((field) => {
          params.push(field, `%${search}%`);
          const keyParam = `$${params.length - 1}`;
          const valParam = `$${params.length}`;
          return `snapshot ->> ${keyParam} ILIKE ${valParam}`;
        });
        conditions.push(`(${fieldConds.join(" OR ")})`);
      }

      const res = await query(
        `SELECT r.id, r.tenant_id, r.editor_id, r.revision_id, r.snapshot, r.created_at,
                COALESCE(NULLIF(u.email, ''), NULLIF(u.name, ''), r.editor_id::text) AS editor_label
           FROM ${cfg.table} r
           LEFT JOIN users u ON u.id = r.editor_id
          WHERE ${conditions.map((c) => c.replaceAll("tenant_id", "r.tenant_id").replaceAll("snapshot", "r.snapshot")).join(" AND ")}
          ORDER BY r.created_at DESC
          LIMIT $${params.length + 1}`,
        [...params, limit]
      );

      return res.rows.map((row) => {
        const snapshot = typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot;
        return {
          ...row,
          kind,
          kindLabel: titleCase(kind),
          entityId: entityIdFromSnapshot(kind, snapshot) ?? search,
          editorLabel: row.editor_label ?? null,
          snapshot,
          created_at: toISO(row.created_at),
        };
      });
    },

    async bmsRevisionDetail(
      _p: unknown,
      args: { kind: string; revisionId: string },
      ctx: any
    ) {
      requireAdmin(ctx);
      const kind = normalizeKind(args.kind);
      await requirePermission(ctx, REVISION_CONFIG[kind].permission as any);
      const tid = getTenantId(ctx);
      const cfg = REVISION_CONFIG[kind];
      const res = await query(
        `SELECT r.id, r.tenant_id, r.editor_id, r.revision_id, r.snapshot, r.created_at,
                COALESCE(NULLIF(u.email, ''), NULLIF(u.name, ''), r.editor_id::text) AS editor_label
           FROM ${cfg.table} r
           LEFT JOIN users u ON u.id = r.editor_id
          WHERE r.tenant_id = $1 AND r.id = $2
          LIMIT 1`,
        [tid, args.revisionId]
      );
      const row = res.rows[0];
      if (!row) return null;
      const snapshot = typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot;
      return {
        ...row,
        kind,
        kindLabel: titleCase(kind),
        entityId: entityIdFromSnapshot(kind, snapshot),
        editorLabel: row.editor_label ?? null,
        snapshot,
        created_at: toISO(row.created_at),
      };
    },

    async bmsRevisionCompare(
      _p: unknown,
      args: { kind: string; fromRevisionId: string; toRevisionId: string },
      ctx: any
    ) {
      requireAdmin(ctx);
      const kind = normalizeKind(args.kind);
      await requirePermission(ctx, REVISION_CONFIG[kind].permission as any);
      const tid = getTenantId(ctx);
      const cfg = REVISION_CONFIG[kind];
      const res = await query(
        `SELECT id, snapshot, created_at
           FROM ${cfg.table}
          WHERE tenant_id = $1 AND id IN ($2, $3)`,
        [tid, args.fromRevisionId, args.toRevisionId]
      );
      const rows = res.rows.map((r: any) => ({
        ...r,
        snapshot: typeof r.snapshot === "string" ? JSON.parse(r.snapshot) : r.snapshot,
      }));
      const fromRow = rows.find((r: any) => String(r.id) === args.fromRevisionId);
      const toRow = rows.find((r: any) => String(r.id) === args.toRevisionId);
      if (!fromRow || !toRow) return null;
      return {
        kind,
        kindLabel: titleCase(kind),
        fromRevisionId: args.fromRevisionId,
        toRevisionId: args.toRevisionId,
        fromSnapshot: deepClone(fromRow.snapshot),
        toSnapshot: deepClone(toRow.snapshot),
        diff: diffAny(fromRow.snapshot, toRow.snapshot),
      };
    },
  },
};
