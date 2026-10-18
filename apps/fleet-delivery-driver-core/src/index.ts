import {
  driverCurrentAssignmentV1Schema,
  driverOfferFeedV1Schema,
  driverSnapshotV1Schema,
  type DriverCurrentAssignmentV1,
  type DriverJourneyAction,
  type DriverOfferFeedQueryV1,
  type DriverOfferFeedV1,
  type DriverSnapshotV1,
  type OfferDecision,
} from "@bms/fleet-delivery-contracts";
import { z } from "zod";

export const PHASE4_SAFE_CAPABILITIES = Object.freeze({
  productionAuthentication: false,
  realDeviceLocation: false,
  kycDocumentCapture: false,
  podPhotoCapture: false,
  pushNotifications: false,
  customerContact: false,
  codAndEarnings: false,
});

const scopeSchema = z.object({
  tenantRef: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
  branchRef: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

const commandBaseSchema = z.object({
  commandId: z.string().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/),
  idempotencyKey: z.string().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/),
  createdAt: z.iso.datetime({ offset: true }),
  scope: scopeSchema,
});

const availabilityCommandSchema = commandBaseSchema.extend({
  kind: z.literal("SET_AVAILABILITY"),
  state: z.enum(["ONLINE", "OFFLINE"]),
}).strict();

const offerDecisionCommandSchema = commandBaseSchema.extend({
  kind: z.literal("DECIDE_OFFER"),
  offerId: z.uuid(),
  decision: z.enum(["accept", "reject"]),
  expectedOfferVersion: z.number().int().positive().safe(),
}).strict();

const journeyCommandSchema = commandBaseSchema.extend({
  kind: z.literal("ADVANCE_PICKUP_JOURNEY"),
  deliveryId: z.uuid(),
  action: z.enum(["start_pickup", "arrive_pickup"]),
  expectedVersion: z.number().int().positive().safe(),
}).strict();

export const driverOfflineCommandSchema = z.discriminatedUnion("kind", [
  availabilityCommandSchema,
  offerDecisionCommandSchema,
  journeyCommandSchema,
]);

export type DriverOfflineCommand = z.infer<typeof driverOfflineCommandSchema>;
export type DriverScope = z.infer<typeof scopeSchema>;

export interface DriverCommandStore {
  load(): Promise<unknown>;
  save(commands: readonly DriverOfflineCommand[]): Promise<void>;
}

export type DriverCommandResult =
  | { outcome: "APPLIED"; response: unknown }
  | { outcome: "REJECTED"; code: string }
  | { outcome: "RETRYABLE_FAILURE"; code: string };

export interface DriverCommandSender {
  send(command: DriverOfflineCommand): Promise<DriverCommandResult>;
}

export type FlushResult = {
  appliedCommandIds: string[];
  rejected: Array<{ commandId: string; code: string }>;
  retryPending: boolean;
  remaining: number;
};

export class DriverOfflineQueue {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: DriverCommandStore,
    private readonly sender: DriverCommandSender,
    private readonly makeOpaqueId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(): Promise<DriverOfflineCommand[]> {
    const stored = await this.store.load();
    if (stored === null || stored === undefined) return [];
    return z.array(driverOfflineCommandSchema).max(100).parse(stored);
  }

  private buildBase(scope: DriverScope) {
    const checkedScope = scopeSchema.parse(scope);
    const commandId = this.makeOpaqueId();
    return {
      commandId,
      idempotencyKey: `driver-command:${commandId}`,
      createdAt: this.now().toISOString(),
      scope: checkedScope,
    };
  }

  enqueueAvailability(scope: DriverScope, state: "ONLINE" | "OFFLINE"): Promise<DriverOfflineCommand> {
    return this.exclusive(async () => {
      const checkedScope = scopeSchema.parse(scope);
      const commands = await this.read();
      const last = commands.at(-1);
      if (
        last?.kind === "SET_AVAILABILITY"
        && last.scope.tenantRef === checkedScope.tenantRef
        && last.scope.branchRef === checkedScope.branchRef
      ) {
        if (last.state === state) return last;
        const replacement = availabilityCommandSchema.parse({
          ...this.buildBase(checkedScope),
          kind: "SET_AVAILABILITY",
          state,
        });
        await this.store.save([...commands.slice(0, -1), replacement]);
        return replacement;
      }
      const command = availabilityCommandSchema.parse({
        ...this.buildBase(checkedScope),
        kind: "SET_AVAILABILITY",
        state,
      });
      if (commands.length >= 100) throw new Error("DRIVER_OFFLINE_QUEUE_FULL");
      await this.store.save([...commands, command]);
      return command;
    });
  }

  enqueueOfferDecision(
    scope: DriverScope,
    offerId: string,
    decision: OfferDecision,
    expectedOfferVersion: number,
  ): Promise<DriverOfflineCommand> {
    return this.exclusive(async () => {
      const command = offerDecisionCommandSchema.parse({
        ...this.buildBase(scope),
        kind: "DECIDE_OFFER",
        offerId,
        decision,
        expectedOfferVersion,
      });
      const commands = await this.read();
      if (commands.length >= 100) throw new Error("DRIVER_OFFLINE_QUEUE_FULL");
      await this.store.save([...commands, command]);
      return command;
    });
  }

  enqueuePickupJourneyAction(
    scope: DriverScope,
    deliveryId: string,
    action: DriverJourneyAction,
    expectedVersion: number,
  ): Promise<DriverOfflineCommand> {
    return this.exclusive(async () => {
      const command = journeyCommandSchema.parse({
        ...this.buildBase(scope),
        kind: "ADVANCE_PICKUP_JOURNEY",
        deliveryId,
        action,
        expectedVersion,
      });
      const commands = await this.read();
      if (commands.length >= 100) throw new Error("DRIVER_OFFLINE_QUEUE_FULL");
      await this.store.save([...commands, command]);
      return command;
    });
  }

  flush(): Promise<FlushResult> {
    return this.exclusive(async () => {
      const commands = await this.read();
      const remaining = [...commands];
      const result: FlushResult = {
        appliedCommandIds: [],
        rejected: [],
        retryPending: false,
        remaining: commands.length,
      };
      while (remaining.length > 0) {
        const command = remaining[0]!;
        const sent = await this.sender.send(command);
        if (sent.outcome === "RETRYABLE_FAILURE") {
          result.retryPending = true;
          break;
        }
        remaining.shift();
        if (sent.outcome === "APPLIED") result.appliedCommandIds.push(command.commandId);
        else result.rejected.push({ commandId: command.commandId, code: sent.code });
        await this.store.save(remaining);
      }
      result.remaining = remaining.length;
      return result;
    });
  }
}

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

function errorCode(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null || !("error" in body)) return fallback;
  const error = body.error;
  if (typeof error !== "object" || error === null || !("code" in error)) return fallback;
  return typeof error.code === "string" ? error.code : fallback;
}

function isRetryable(body: unknown, status: number): boolean {
  if ([401, 408, 425, 429].includes(status) || status >= 500) return true;
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const error = body.error;
  return typeof error === "object" && error !== null && "retryable" in error && error.retryable === true;
}

export class DriverHttpTransport implements DriverCommandSender {
  constructor(
    private readonly baseUrl: string,
    private readonly getAccessToken: () => Promise<string>,
    private readonly fetchImpl: FetchLike,
  ) {
    if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(baseUrl)) {
      throw new Error("DRIVER_API_REQUIRES_HTTPS");
    }
  }

  private async authorization(): Promise<string> {
    const token = await this.getAccessToken();
    if (!token.trim()) throw new Error("DRIVER_ACCESS_TOKEN_MISSING");
    return `Bearer ${token}`;
  }

  async listOffers(scope: DriverOfferFeedQueryV1): Promise<DriverOfferFeedV1> {
    const checked = scopeSchema.parse(scope);
    const query = new URLSearchParams(checked).toString();
    const response = await this.fetchImpl(`${this.baseUrl}/v1/driver/offers?${query}`, {
      method: "GET",
      headers: { authorization: await this.authorization() },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(errorCode(body, `DRIVER_OFFER_FEED_HTTP_${response.status}`));
    return driverOfferFeedV1Schema.parse(body);
  }

  async getCurrentAssignment(scope: DriverOfferFeedQueryV1): Promise<DriverCurrentAssignmentV1> {
    const checked = scopeSchema.parse(scope);
    const query = new URLSearchParams(checked).toString();
    const response = await this.fetchImpl(`${this.baseUrl}/v1/driver/assignments/current?${query}`, {
      method: "GET",
      headers: { authorization: await this.authorization() },
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(errorCode(body, `DRIVER_CURRENT_ASSIGNMENT_HTTP_${response.status}`));
    }
    return driverCurrentAssignmentV1Schema.parse(body);
  }

  async getSnapshot(scope: DriverOfferFeedQueryV1): Promise<DriverSnapshotV1> {
    const checked = scopeSchema.parse(scope);
    const query = new URLSearchParams(checked).toString();
    const response = await this.fetchImpl(`${this.baseUrl}/v1/driver/snapshot?${query}`, {
      method: "GET",
      headers: { authorization: await this.authorization() },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(errorCode(body, `DRIVER_SNAPSHOT_HTTP_${response.status}`));
    return driverSnapshotV1Schema.parse(body);
  }

  async send(command: DriverOfflineCommand): Promise<DriverCommandResult> {
    const checked = driverOfflineCommandSchema.parse(command);
    const path = checked.kind === "SET_AVAILABILITY"
      ? "/v1/driver/availability"
      : checked.kind === "DECIDE_OFFER"
        ? `/v1/dispatch/offers/${checked.offerId}/${checked.decision}`
        : `/v1/driver/deliveries/${checked.deliveryId}/actions/${checked.action}`;
    const body = checked.kind === "SET_AVAILABILITY"
      ? { ...checked.scope, state: checked.state }
      : checked.kind === "DECIDE_OFFER"
        ? { ...checked.scope, expectedOfferVersion: checked.expectedOfferVersion }
        : { ...checked.scope, expectedVersion: checked.expectedVersion };
    let response: FetchResponse;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: await this.authorization(),
          "content-type": "application/json",
          "idempotency-key": checked.idempotencyKey,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      return {
        outcome: "RETRYABLE_FAILURE",
        code: error instanceof Error && error.message === "DRIVER_ACCESS_TOKEN_MISSING"
          ? "AUTH_REQUIRED"
          : "NETWORK_UNAVAILABLE",
      };
    }
    const responseBody = await response.json().catch(() => undefined);
    if (response.ok) return { outcome: "APPLIED", response: responseBody };
    const code = errorCode(responseBody, `DRIVER_COMMAND_HTTP_${response.status}`);
    return isRetryable(responseBody, response.status)
      ? { outcome: "RETRYABLE_FAILURE", code }
      : { outcome: "REJECTED", code };
  }
}
