import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  rideCredentialsSchema,
  rideRegistrationSchema,
  rideQuoteRequestSchema,
  rideRoadRouteSchema,
  rideCommandSchema,
  rideSnapshotSchema,
  rideViewSchema,
  rideLocationSchema,
  ridePointSchema,
  type RideRoadRoute,
} from "@bms/fleet-delivery-contracts";
import { canonicalJson } from "@bms/fleet-delivery-domain";
import {
  validateUsername,
  validateNewPassword,
} from "../../../apps/web/lib/auth/identity.js";
import {
  withTenantTransaction,
  withTenantReadSnapshot,
} from "./transaction.js";

const derive = promisify(scrypt);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const uuid = z.string().uuid();
type Account = {
  id: string;
  role: "RIDER" | "DRIVER";
  display_name: string;
  online: boolean;
  vehicle_plate: string;
  location: unknown;
};
export class RideSandboxError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
  }
}
function requireRole(account: Account, role: Account["role"]) {
  if (account.role !== role) throw new RideSandboxError("ROLE_FORBIDDEN", 403);
}
function identity(input: z.infer<typeof rideCredentialsSchema>) {
  const username = validateUsername(input.username);
  const password = validateNewPassword(input.password);
  if (!username.ok || !password.ok)
    throw new RideSandboxError("INVALID_CREDENTIAL_FORMAT", 422);
  return username.value;
}
async function passwordHash(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  const bytes = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${bytes.toString("hex")}`;
}
async function audit(
  c: PoolClient,
  tenant: string,
  account: string,
  action: string,
  trip: string | null = null,
) {
  await c.query(
    "INSERT INTO fleet_delivery.ride_sandbox_audit(tenant_ref,account_id,action,trip_id) VALUES($1,$2,$3,$4)",
    [tenant, account, action, trip],
  );
}
const tripSelect = `SELECT t.*, r.display_name AS rider_name, d.display_name AS driver_name, d.vehicle_plate
  FROM fleet_delivery.ride_sandbox_trips t
  JOIN fleet_delivery.ride_sandbox_accounts r ON r.id=t.rider_id AND r.tenant_ref=t.tenant_ref
  LEFT JOIN fleet_delivery.ride_sandbox_accounts d ON d.id=t.driver_id AND d.tenant_ref=t.tenant_ref`;
const geo = (column: string) =>
  `ST_SetSRID(ST_MakePoint((${column}->>'lng')::double precision,(${column}->>'lat')::double precision),4326)::geography`;
const fresh = (
  alias: string,
) => `${alias}.location IS NOT NULL AND ${alias}.location_received_at>now()-interval '60 seconds'
  AND (${alias}.location->>'capturedAt')::timestamptz>now()-interval '60 seconds'`;
const closeTo = (location: string, point: string) =>
  `ST_DWithin(${geo(location)},${geo(point)},5000)`;
function view(r: Record<string, any>) {
  return rideViewSchema.parse({
    id: r.id,
    pickup: r.pickup,
    dropoff: r.dropoff,
    state: r.state,
    version: r.version,
    fareSatang: r.fare_satang,
    distanceM: r.distance_m,
    riderName: r.rider_name,
    driverName: r.driver_name,
    vehiclePlate: r.vehicle_plate,
    paymentStatus: r.payment_status,
    receiptRef: r.receipt_ref,
    createdAt: r.created_at.toISOString(),
  });
}

/** Local test identity only: not BMS identity, verified phone/email, KYC, or a production principal. */
export class RideSandboxService {
  constructor(
    private pool: Pool,
    private tenant: string,
  ) {}
  async authorizeProvider(token: string) {
    return withTenantTransaction(this.pool, this.tenant, async (c) => {
      const account = await this.account(c, token);
      requireRole(account, "RIDER");
      return account.id;
    });
  }
  // Ephemeral telemetry deliberately bypasses the durable command/offline queue and audit payloads.
  async location(token: string, raw: unknown) {
    const input = raw === null ? null : rideLocationSchema.parse(raw);
    return withTenantTransaction(this.pool, this.tenant, async (c) => {
      const a = await this.account(c, token, true);
      requireRole(a, "DRIVER");
      if (input) {
        const time = await c.query("SELECT clock_timestamp() AS now");
        const age = time.rows[0].now.getTime() - Date.parse(input.capturedAt);
        if (age > 60000 || age < -10000)
          throw new RideSandboxError("LOCATION_STALE_OR_FUTURE", 422);
        if (!a.online) throw new RideSandboxError("DRIVER_OFFLINE");
        const old = rideLocationSchema.safeParse(a.location);
        if (
          old.success &&
          Date.parse(input.capturedAt) <= Date.parse(old.data.capturedAt)
        ) {
          if (canonicalJson(input) === canonicalJson(old.data))
            return { ok: true };
          throw new RideSandboxError("LOCATION_OUT_OF_ORDER");
        }
      }
      await c.query(
        `UPDATE fleet_delivery.ride_sandbox_accounts SET location=$3,
        location_received_at=CASE WHEN $3::jsonb IS NULL THEN NULL ELSE clock_timestamp() END WHERE tenant_ref=$1 AND id=$2`,
        [this.tenant, a.id, input],
      );
      return { ok: true };
    });
  }
  async purgeLocations() {
    return withTenantTransaction(this.pool, this.tenant, async (c) => {
      await c.query(
        `UPDATE fleet_delivery.ride_sandbox_accounts SET location=NULL,location_received_at=NULL
        WHERE tenant_ref=$1 AND location_received_at<now()-interval '60 seconds'`,
        [this.tenant],
      );
    });
  }
  async nearbyCandidates(token: string, raw: unknown) {
    const point = ridePointSchema.parse(raw);
    return withTenantTransaction(this.pool, this.tenant, async (c) => {
      const account = await this.account(c, token);
      requireRole(account, "RIDER");
      const result = await c.query(
        `SELECT count(*)::integer AS count,
        round(min(ST_Distance(${geo("a.location")},${geo(
          "$2::jsonb",
        )})))::integer AS nearest
        FROM fleet_delivery.ride_sandbox_accounts a WHERE a.tenant_ref=$1 AND a.role='DRIVER' AND a.online
        AND ${fresh("a")} AND ${closeTo("a.location", "$2::jsonb")}
        AND NOT EXISTS (SELECT 1 FROM fleet_delivery.ride_sandbox_trips t WHERE t.tenant_ref=a.tenant_ref
          AND t.driver_id=a.id AND t.state NOT IN ('COMPLETED','CANCELLED'))`,
        [this.tenant, point],
      );
      const candidates = await c.query<{ location: unknown }>(
        `SELECT a.location FROM fleet_delivery.ride_sandbox_accounts a
        WHERE a.tenant_ref=$1 AND a.role='DRIVER' AND a.online
        AND ${fresh("a")} AND ${closeTo("a.location", "$2::jsonb")}
        AND NOT EXISTS (SELECT 1 FROM fleet_delivery.ride_sandbox_trips t WHERE t.tenant_ref=a.tenant_ref
          AND t.driver_id=a.id AND t.state NOT IN ('COMPLETED','CANCELLED'))
        ORDER BY ST_Distance(${geo("a.location")},${geo("$2::jsonb")}) LIMIT 5`,
        [this.tenant, point],
      );
      return {
        accountId: account.id,
        pickup: point,
        count: result.rows[0].count,
        nearestDistanceM: result.rows[0].nearest,
        radiusM: 5000,
        candidates: candidates.rows.map((row) =>
          rideLocationSchema.pick({ lat: true, lng: true }).parse(row.location),
        ),
      };
    });
  }
  async nearby(token: string, raw: unknown) {
    const { accountId: _accountId, pickup: _pickup, candidates, ...summary } =
      await this.nearbyCandidates(token, raw);
    return {
      ...summary,
      assessedDriverCount: candidates.length,
      pickupEtaSeconds: null,
      pickupRoadDistanceM: null,
      pickupEtaStatus: candidates.length === 0 ? "NO_DRIVER" : "PROVIDER_UNAVAILABLE",
      etaProvider: null,
    } as const;
  }
  async register(raw: unknown) {
    const input = rideRegistrationSchema.parse(raw);
    const username = identity(input);
    const digest = await passwordHash(input.password);
    return withTenantTransaction(this.pool, this.tenant, async (c) => {
      const row = await c.query<Account>(
        `INSERT INTO fleet_delivery.ride_sandbox_accounts
        (tenant_ref,username,role,password_hash,display_name,vehicle_plate) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(tenant_ref,username,role) DO NOTHING RETURNING *`,
        [
          this.tenant,
          username,
          input.role,
          digest,
          input.displayName,
          input.vehiclePlate,
        ],
      );
      if (!row.rows[0]) throw new RideSandboxError("ACCOUNT_EXISTS_LOGIN");
      await audit(
        c,
        this.tenant,
        row.rows[0].id,
        "register.sandbox_unverified",
      );
      return this.session(c, row.rows[0]);
    });
  }
  async login(raw: unknown) {
    const input = rideCredentialsSchema.parse(raw);
    const username = identity(input);
    return withTenantTransaction(this.pool, this.tenant, async (c) => {
      const result = await c.query<Account & { password_hash: string }>(
        "SELECT * FROM fleet_delivery.ride_sandbox_accounts WHERE tenant_ref=$1 AND username=$2 AND role=$3",
        [this.tenant, username, input.role],
      );
      const row = result.rows[0];
      // Same KDF even when absent. No plaintext password, bearer, or raw credentials in audit.
      const stored =
        row?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`;
      const derived = await passwordHash(input.password, stored.split(":")[0]!);
      if (!timingSafeEqual(Buffer.from(derived), Buffer.from(stored)) || !row)
        throw new RideSandboxError("INVALID_LOGIN", 401);
      await audit(c, this.tenant, row.id, "login");
      return this.session(c, row);
    });
  }
  private async session(c: PoolClient, account: Account) {
    const accessToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    await c.query(
      "INSERT INTO fleet_delivery.ride_sandbox_sessions(token_hash,tenant_ref,account_id,expires_at) VALUES($1,$2,$3,$4)",
      [hash(accessToken), this.tenant, account.id, expiresAt],
    );
    return {
      accessToken,
      expiresAt,
      role: account.role,
      accountId: account.id,
      sandbox: true,
    };
  }
  private async account(
    c: PoolClient,
    token: string,
    lock = false,
  ): Promise<Account> {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new RideSandboxError("AUTH_REQUIRED", 401);
    const result = await c.query<Account>(
      `SELECT a.* FROM fleet_delivery.ride_sandbox_accounts a
      JOIN fleet_delivery.ride_sandbox_sessions s ON s.account_id=a.id AND s.tenant_ref=a.tenant_ref
      WHERE s.tenant_ref=$1 AND s.token_hash=$2 AND s.revoked_at IS NULL AND s.expires_at>now()
      ${lock ? "FOR UPDATE OF a" : ""}`,
      [this.tenant, hash(token)],
    );
    if (!result.rows[0]) throw new RideSandboxError("SESSION_EXPIRED", 401);
    return result.rows[0];
  }
  async logout(token: string) {
    return withTenantTransaction(this.pool, this.tenant, async (c) => {
      const a = await this.account(c, token, true);
      await c.query(
        "UPDATE fleet_delivery.ride_sandbox_sessions SET revoked_at=now() WHERE tenant_ref=$1 AND token_hash=$2",
        [this.tenant, hash(token)],
      );
      await c.query(
        "UPDATE fleet_delivery.ride_sandbox_accounts SET online=false,location=NULL,location_received_at=NULL WHERE tenant_ref=$1 AND id=$2",
        [this.tenant, a.id],
      );
      await audit(c, this.tenant, a.id, "logout");
      return { ok: true };
    });
  }
  async snapshot(token: string) {
    return withTenantReadSnapshot(this.pool, this.tenant, async (c) => {
      const a = await this.account(c, token);
      const rows = await c.query(
        `${tripSelect} WHERE t.tenant_ref=$1 AND (t.rider_id=$2 OR t.driver_id=$2) ORDER BY t.created_at DESC LIMIT 30`,
        [this.tenant, a.id],
      );
      const current = rows.rows.find(
        (r) => !["COMPLETED", "CANCELLED"].includes(r.state),
      );
      const offers =
        a.role === "DRIVER" && a.online && !current
          ? await c.query(
              `${tripSelect} JOIN fleet_delivery.ride_sandbox_accounts self ON self.tenant_ref=t.tenant_ref AND self.id=$2
                WHERE t.tenant_ref=$1 AND t.state='SEARCHING' AND ${fresh(
                  "self",
                )}
                AND ${closeTo("self.location", "t.pickup")}
                ORDER BY ST_Distance(${geo("self.location")},${geo(
                  "t.pickup",
                )}),t.created_at LIMIT 20`,
              [this.tenant, a.id],
            )
          : { rows: [] };
      const earnings = await c.query(
        "SELECT COALESCE(sum(fare_satang),0)::bigint AS amount FROM fleet_delivery.ride_sandbox_trips WHERE tenant_ref=$1 AND driver_id=$2 AND state='COMPLETED'",
        [this.tenant, a.id],
      );
      const visibleDriver = a.role === "DRIVER" ? a.id : current?.driver_id;
      const location = visibleDriver
        ? await c.query(
            `SELECT a.location FROM fleet_delivery.ride_sandbox_accounts a
        WHERE a.tenant_ref=$1 AND a.id=$2 AND a.online AND ${fresh("a")}`,
            [this.tenant, visibleDriver],
          )
        : { rows: [] };
      return rideSnapshotSchema.parse({
        sandbox: true,
        account: {
          id: a.id,
          role: a.role,
          displayName: a.display_name,
          online: a.online,
          vehiclePlate: a.vehicle_plate,
        },
        current: current ? view(current) : null,
        offers: offers.rows.map(view),
        history: rows.rows
          .filter((r) => ["COMPLETED", "CANCELLED"].includes(r.state))
          .map(view),
        earningsSatang: Number(earnings.rows[0].amount),
        driverLocation: location.rows[0]?.location ?? null,
      });
    });
  }
  async mutate(
    token: string,
    key: string,
    operation: string,
    raw: unknown,
    providerRoute?: RideRoadRoute,
  ): Promise<unknown> {
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key))
      throw new RideSandboxError("IDEMPOTENCY_KEY_REQUIRED", 422);
    const fingerprint = hash(canonicalJson({ operation, body: raw } as any));
    return withTenantTransaction(this.pool, this.tenant, async (c) => {
      const a = await this.account(c, token, true);
      const prior = await c.query(
        "SELECT fingerprint,response FROM fleet_delivery.ride_sandbox_commands WHERE tenant_ref=$1 AND account_id=$2 AND command_key=$3",
        [this.tenant, a.id, key],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].fingerprint !== fingerprint)
          throw new RideSandboxError("IDEMPOTENCY_BODY_MISMATCH");
        return prior.rows[0].response;
      }
      let response: unknown;
      if (operation === "availability") {
        requireRole(a, "DRIVER");
        const input = z.object({ online: z.boolean() }).strict().parse(raw);
        await c.query(
          "UPDATE fleet_delivery.ride_sandbox_accounts SET online=$3,location=CASE WHEN $3 THEN location ELSE NULL END,location_received_at=CASE WHEN $3 THEN location_received_at ELSE NULL END WHERE tenant_ref=$1 AND id=$2",
          [this.tenant, a.id, input.online],
        );
        await audit(c, this.tenant, a.id, input.online ? "online" : "offline");
        response = { ok: true };
      } else if (operation === "quotes") {
        requireRole(a, "RIDER");
        const request = rideQuoteRequestSchema.parse(raw);
        const input = { pickup: request.pickup, dropoff: request.dropoff };
        const route = rideRoadRouteSchema.parse(providerRoute);
        const distanceM = route.distanceM;
        const fareSatang = 2000 + Math.ceil(distanceM / 1000) * 800;
        const result = await c.query(
          `INSERT INTO fleet_delivery.ride_sandbox_quotes
          (tenant_ref,rider_id,pickup,dropoff,distance_m,fare_satang,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes') RETURNING *`,
          [
            this.tenant,
            a.id,
            input.pickup,
            input.dropoff,
            distanceM,
            fareSatang,
          ],
        );
        const q = result.rows[0];
        response = {
          ...input,
          id: q.id,
          distanceM,
          fareSatang,
          expiresAt: q.expires_at.toISOString(),
          pricing: "SANDBOX_GOOGLE_ROAD_V1",
          route,
        };
        await audit(c, this.tenant, a.id, "quote");
      } else if (operation === "trips") {
        requireRole(a, "RIDER");
        const input = z
          .object({ quoteId: uuid, confirmed: z.literal(true) })
          .strict()
          .parse(raw);
        const existing = await c.query(
          `${tripSelect} WHERE t.tenant_ref=$1 AND t.rider_id=$2 AND t.quote_id=$3`,
          [this.tenant, a.id, input.quoteId],
        );
        if (existing.rows[0]) response = view(existing.rows[0]);
        else {
          const active = await c.query(
            "SELECT id FROM fleet_delivery.ride_sandbox_trips WHERE tenant_ref=$1 AND rider_id=$2 AND state NOT IN ('COMPLETED','CANCELLED')",
            [this.tenant, a.id],
          );
          if (active.rowCount) throw new RideSandboxError("ACTIVE_TRIP_EXISTS");
          const q = await c.query(
            "SELECT * FROM fleet_delivery.ride_sandbox_quotes WHERE tenant_ref=$1 AND id=$2 AND rider_id=$3 AND expires_at>now()",
            [this.tenant, input.quoteId, a.id],
          );
          if (!q.rows[0])
            throw new RideSandboxError("QUOTE_EXPIRED_OR_NOT_FOUND", 404);
          const row = q.rows[0];
          const result = await c.query(
            `INSERT INTO fleet_delivery.ride_sandbox_trips
            (tenant_ref,rider_id,quote_id,pickup,dropoff,distance_m,fare_satang,state)
            VALUES($1,$2,$3,$4,$5,$6,$7,'SEARCHING') RETURNING id`,
            [
              this.tenant,
              a.id,
              row.id,
              row.pickup,
              row.dropoff,
              row.distance_m,
              row.fare_satang,
            ],
          );
          response = await this.trip(c, result.rows[0].id);
          await audit(c, this.tenant, a.id, "request", result.rows[0].id);
        }
      } else if (operation.startsWith("trips/")) {
        const id = uuid.parse(operation.slice(6));
        const input = rideCommandSchema.parse(raw);
        const result = await c.query(
          "SELECT * FROM fleet_delivery.ride_sandbox_trips WHERE tenant_ref=$1 AND id=$2 FOR UPDATE",
          [this.tenant, id],
        );
        const t = result.rows[0];
        if (
          !t ||
          (input.action !== "accept" &&
            t.rider_id !== a.id &&
            t.driver_id !== a.id)
        )
          throw new RideSandboxError("TRIP_NOT_FOUND", 404);
        if (input.action !== "pay" && input.paymentOutcome)
          throw new RideSandboxError("UNEXPECTED_PAYMENT_OUTCOME", 422);
        let next = t.state;
        let driver = t.driver_id;
        let payment = t.payment_status;
        let receipt = t.receipt_ref;
        if (input.action === "accept") {
          requireRole(a, "DRIVER");
          if (!a.online) throw new RideSandboxError("DRIVER_OFFLINE");
          if (t.state !== "SEARCHING")
            throw new RideSandboxError("OFFER_UNAVAILABLE");
          const eligible = await c.query(
            `SELECT 1 FROM fleet_delivery.ride_sandbox_accounts a
            WHERE a.tenant_ref=$1 AND a.id=$2 AND ${fresh("a")} AND ${closeTo(
              "a.location",
              "$3::jsonb",
            )}`,
            [this.tenant, a.id, t.pickup],
          );
          if (!eligible.rowCount)
            throw new RideSandboxError("FRESH_NEARBY_LOCATION_REQUIRED");
          const active = await c.query(
            "SELECT id FROM fleet_delivery.ride_sandbox_trips WHERE tenant_ref=$1 AND driver_id=$2 AND state NOT IN ('COMPLETED','CANCELLED')",
            [this.tenant, a.id],
          );
          if (active.rowCount) throw new RideSandboxError("DRIVER_BUSY");
          next = "ACCEPTED";
          driver = a.id;
        } else if (input.action === "cancel") {
          if (!["SEARCHING", "ACCEPTED", "AT_PICKUP"].includes(t.state))
            throw new RideSandboxError("CANNOT_CANCEL_AFTER_START");
          next = "CANCELLED";
        } else if (input.action === "pay") {
          requireRole(a, "RIDER");
          if (t.rider_id !== a.id)
            throw new RideSandboxError("TRIP_NOT_FOUND", 404);
          if (t.state !== "AWAITING_PAYMENT")
            throw new RideSandboxError("PAY_AFTER_ARRIVAL_ONLY");
          if (!input.paymentOutcome)
            throw new RideSandboxError("SANDBOX_PAYMENT_OUTCOME_REQUIRED", 422);
          payment = input.paymentOutcome;
          if (payment === "SUCCEEDED") {
            next = "COMPLETED";
            receipt = `sandbox:${randomUUID()}`;
          }
        } else {
          requireRole(a, "DRIVER");
          if (t.driver_id !== a.id)
            throw new RideSandboxError("TRIP_NOT_FOUND", 404);
          const moves = {
            arrive: ["ACCEPTED", "AT_PICKUP"],
            start: ["AT_PICKUP", "IN_PROGRESS"],
            finish: ["IN_PROGRESS", "AWAITING_PAYMENT"],
          };
          const move = moves[input.action];
          if (!move || t.state !== move[0])
            throw new RideSandboxError("INVALID_TRIP_TRANSITION");
          next = move[1];
        }
        if (t.version !== input.version)
          throw new RideSandboxError("STALE_TRIP_REFRESH");
        await c.query(
          `UPDATE fleet_delivery.ride_sandbox_trips SET state=$3,driver_id=$4,payment_status=$5,receipt_ref=$6,version=version+1,updated_at=now() WHERE tenant_ref=$1 AND id=$2`,
          [this.tenant, id, next, driver, payment, receipt],
        );
        await audit(
          c,
          this.tenant,
          a.id,
          input.action === "pay"
            ? `sandbox.payment.${payment.toLowerCase()}`
            : input.action,
          id,
        );
        response = await this.trip(c, id);
      } else throw new RideSandboxError("NOT_FOUND", 404);
      await c.query(
        "INSERT INTO fleet_delivery.ride_sandbox_commands(tenant_ref,account_id,command_key,fingerprint,response) VALUES($1,$2,$3,$4,$5)",
        [this.tenant, a.id, key, fingerprint, response],
      );
      return response;
    });
  }
  private async trip(c: PoolClient, id: string) {
    const result = await c.query(
      `${tripSelect} WHERE t.tenant_ref=$1 AND t.id=$2`,
      [this.tenant, id],
    );
    return view(result.rows[0]);
  }
}
