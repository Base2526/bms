import { z } from "zod";
import {
  rideSessionSchema,
  rideSnapshotSchema,
  rideQuoteSchema,
  rideViewSchema,
  rideNearbySchema,
  ridePlaceResultsSchema,
  rideLocationSchema,
  type RideSession,
} from "@bms/fleet-delivery-contracts";
import { decodeGoogleRoutePolyline } from "./routePolyline.js";

export const pendingRideCommandSchema = z.object({
  key: z.string().min(8).max(160),
  operation: z.string().regex(/^(availability|quotes|trips(?:\/[a-f0-9-]+)?)$/),
  body: z.record(z.string(), z.unknown()),
});
export type PendingRideCommand = z.infer<typeof pendingRideCommandSchema>;
export interface RideCommandStore {
  load(): Promise<PendingRideCommand | null>;
  save(value: PendingRideCommand | null): Promise<void>;
}
export class RideRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
export async function rideRequest(
  origin: string,
  path: string,
  token: string | undefined,
  body?: unknown,
  key?: string,
) {
  // Reuse the transport constraints even for registration (not yet authenticated).
  const base = rideSessionSchema.parse({
    accountId: "00000000-0000-4000-8000-000000000000",
    apiBaseUrl: origin,
    accessToken: "0".repeat(64),
    role: "RIDER",
    expiresAt: "2099-01-01T00:00:00.000Z",
  }).apiBaseUrl;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${base}/sandbox/${path}`, {
      method: body === undefined ? "GET" : "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new RideRequestError(
        data?.error?.code ?? "REQUEST_FAILED",
        response.status,
      );
    return data;
  } finally {
    clearTimeout(timer);
  }
}
export class RideSandboxClient {
  private busy = false;
  constructor(
    readonly session: RideSession,
    private store: RideCommandStore,
  ) {}
  async places(query: string) {
    return ridePlaceResultsSchema.parse(
      await rideRequest(
        this.session.apiBaseUrl,
        "places",
        this.session.accessToken,
        { query, providerConsent: true },
      ),
    );
  }
  async nearby(point: { label: string; lat: number; lng: number }) {
    return rideNearbySchema.parse(
      await rideRequest(
        this.session.apiBaseUrl,
        "nearby",
        this.session.accessToken,
        point,
      ),
    );
  }
  async location(point: z.infer<typeof rideLocationSchema> | null) {
    if (point) rideLocationSchema.parse(point);
    return rideRequest(
      this.session.apiBaseUrl,
      "location",
      this.session.accessToken,
      point,
    );
  }
  async snapshot() {
    return rideSnapshotSchema.parse(
      await rideRequest(
        this.session.apiBaseUrl,
        "snapshot",
        this.session.accessToken,
      ),
    );
  }
  async logout() {
    return rideRequest(
      this.session.apiBaseUrl,
      "logout",
      this.session.accessToken,
      {},
    );
  }
  async command(operation: string, body: Record<string, unknown>) {
    if (this.busy) throw new Error("COMMAND_PENDING");
    this.busy = true;
    try {
      const prior = await this.store.load();
      if (prior) throw new Error("RETRY_PENDING_COMMAND_FIRST");
      const command = pendingRideCommandSchema.parse({
        operation,
        body,
        key: `ride:${Date.now()}:${Math.random()
          .toString(36)
          .slice(2)}:${Math.random().toString(36).slice(2)}`,
      });
      await this.store.save(command); // Durable before network I/O; survives lost reply/restart.
      return await this.send(command);
    } finally {
      this.busy = false;
    }
  }
  async retry() {
    if (this.busy) throw new Error("COMMAND_PENDING");
    this.busy = true;
    try {
      const command = await this.store.load();
      if (!command) return null;
      return await this.send(command);
    } finally {
      this.busy = false;
    }
  }
  private async send(command: PendingRideCommand) {
    try {
      const data = await rideRequest(
        this.session.apiBaseUrl,
        command.operation,
        this.session.accessToken,
        command.body,
        command.key,
      );
      let checked;
      if (command.operation === "quotes") {
        checked = rideQuoteSchema.parse(data);
        decodeGoogleRoutePolyline(checked.route.encodedPolyline);
      } else if (command.operation === "availability")
        checked = z.object({ ok: z.literal(true) }).parse(data);
      else checked = rideViewSchema.parse(data);
      await this.store.save(null);
      return checked;
    } catch (error) {
      // A definite business rejection did not commit; network/5xx/parse failures retain the key.
      // Quote provider failures are also definite: the sandbox calls Google before service.mutate,
      // so no quote/idempotency row can exist when either of these codes is returned.
      const quoteProviderFailedBeforeWrite =
        command.operation === "quotes" &&
        error instanceof RideRequestError &&
        ["GOOGLE_ROUTES_NOT_CONFIGURED", "GOOGLE_ROUTES_UNAVAILABLE"].includes(
          error.code,
        );
      if (
        quoteProviderFailedBeforeWrite ||
        (error instanceof RideRequestError &&
          [400, 403, 404, 409, 413, 415, 422].includes(error.status))
      )
        await this.store.save(null);
      throw error;
    }
  }
}
