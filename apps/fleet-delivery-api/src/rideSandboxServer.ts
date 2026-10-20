import { createServer, type IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { ZodError } from "zod";
import {
  RideSandboxError,
  RideSandboxService,
} from "../../../packages/fleet-delivery-database/src/rideSandbox.js";
import { searchRidePlaces } from "./ridePlaces.js";
import {
  computeDriverPickupEstimate,
  computeRideRoadRoute,
} from "./rideRoutes.js";

type RideProviderConfig = {
  placesKey?: string;
  routesKey?: string;
  request?: typeof fetch;
};

async function body(req: IncomingMessage) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new RideSandboxError("JSON_REQUIRED", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 8192) throw new RideSandboxError("BODY_TOO_LARGE", 413);
    chunks.push(Buffer.from(part));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RideSandboxError("INVALID_JSON", 400);
  }
}
/** Only started by the explicit local sandbox command, never mounted in production API. */
export function createRideSandboxServer(
  service: RideSandboxService,
  redis: Redis,
  providers: RideProviderConfig = {},
) {
  if (process.env.NODE_ENV === "production")
    throw new Error("RIDE_SANDBOX_FORBIDDEN_IN_PRODUCTION");
  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader(
      "content-security-policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    const send = (status: number, value: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(value));
    };
    try {
      // Native apps have no Origin. Do not expose registration/payment simulation to browser CSRF.
      if (req.headers.origin)
        throw new RideSandboxError("BROWSER_ORIGIN_FORBIDDEN", 403);
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (path === "/healthz" && req.method === "GET") {
        send(200, {
          sandbox: true,
          ok: true,
          providers: {
            placesConfigured: Boolean(providers.placesKey?.trim()),
            routesConfigured: Boolean(providers.routesKey?.trim()),
          },
        });
        return;
      }
      const auth = path === "/sandbox/register" || path === "/sandbox/login";
      const bucket = Math.floor(Date.now() / 60000);
      const ip = createHash("sha256")
        .update(req.socket.remoteAddress ?? "unknown")
        .digest("hex");
      const key = `ride-sandbox:rate:${auth ? "auth" : "api"}:${ip}:${bucket}`;
      let allowed = false;
      try {
        const count = await redis.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n",
          1,
          key,
        );
        allowed = Number(count) <= (auth ? 30 : 600);
      } catch {
        throw new RideSandboxError("RATE_LIMIT_UNAVAILABLE", 503);
      }
      if (!allowed) throw new RideSandboxError("RATE_LIMITED", 429);
      if (auth && req.method === "POST") {
        const input = await body(req);
        send(
          200,
          path.endsWith("register")
            ? await service.register(input)
            : await service.login(input),
        );
        return;
      }
      const token = req.headers.authorization?.match(
        /^Bearer ([a-f0-9]{64})$/,
      )?.[1];
      if (!token) throw new RideSandboxError("AUTH_REQUIRED", 401);
      if (req.method === "POST" && path === "/sandbox/places") {
        const accountId = await service.authorizeProvider(token);
        // Separate authenticated provider quota, shared across processes. No unbounded paid search.
        const who = createHash("sha256").update(accountId).digest("hex");
        let count: unknown;
        try {
          count = await redis.eval(
            "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n",
            1,
            `ride-sandbox:places:${who}:${bucket}`,
          );
        } catch {
          throw new RideSandboxError("RATE_LIMIT_UNAVAILABLE", 503);
        }
        if (Number(count) > 10) throw new RideSandboxError("RATE_LIMITED", 429);
        send(
          200,
          await searchRidePlaces(
            await body(req),
            providers.placesKey,
            providers.request,
          ),
        );
        return;
      }
      if (req.method === "POST" && path === "/sandbox/location") {
        send(200, await service.location(token, await body(req)));
        return;
      }
      if (req.method === "POST" && path === "/sandbox/nearby") {
        const nearby = await service.nearbyCandidates(token, await body(req));
        let estimate = null;
        let providerUnavailable = false;
        if (nearby.candidates.length > 0) {
          const who = createHash("sha256").update(nearby.accountId).digest("hex");
          try {
            const count = await redis.eval(
              "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n",
              1,
              `ride-sandbox:pickup-eta:${who}:${bucket}`,
            );
            if (Number(count) > 10)
              throw new RideSandboxError("RATE_LIMITED", 429);
            estimate = await computeDriverPickupEstimate(
              nearby.candidates,
              nearby.pickup,
              providers.routesKey,
              providers.request,
            );
          } catch (error) {
            if (
              error instanceof RideSandboxError &&
              ["GOOGLE_ROUTES_NOT_CONFIGURED", "GOOGLE_ROUTES_UNAVAILABLE"].includes(
                error.code,
              )
            )
              providerUnavailable = true;
            else throw error;
          }
        }
        send(200, {
          count: nearby.count,
          radiusM: nearby.radiusM,
          nearestDistanceM: nearby.nearestDistanceM,
          assessedDriverCount: nearby.candidates.length,
          pickupEtaSeconds: estimate?.durationSeconds ?? null,
          pickupRoadDistanceM: estimate?.distanceM ?? null,
          pickupEtaStatus:
            nearby.candidates.length === 0
              ? "NO_DRIVER"
              : providerUnavailable || !estimate
                ? "PROVIDER_UNAVAILABLE"
                : "AVAILABLE",
          etaProvider: estimate ? "GOOGLE" : null,
        });
        return;
      }
      if (path === "/sandbox/snapshot" && req.method === "GET") {
        send(200, await service.snapshot(token));
        return;
      }
      if (path === "/sandbox/logout" && req.method === "POST") {
        send(200, await service.logout(token));
        return;
      }
      if (
        req.method !== "POST" ||
        !/^\/sandbox\/(availability|quotes|trips(?:\/[a-f0-9-]+)?)$/.test(path)
      )
        throw new RideSandboxError("NOT_FOUND", 404);
      const commandKey = req.headers["idempotency-key"];
      const commandBody = await body(req);
      let providerRoute;
      if (path === "/sandbox/quotes") {
        const accountId = await service.authorizeProvider(token);
        const who = createHash("sha256").update(accountId).digest("hex");
        let count: unknown;
        try {
          count = await redis.eval(
            "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n",
            1,
            `ride-sandbox:routes:${who}:${bucket}`,
          );
        } catch {
          throw new RideSandboxError("RATE_LIMIT_UNAVAILABLE", 503);
        }
        if (Number(count) > 10) throw new RideSandboxError("RATE_LIMITED", 429);
        providerRoute = await computeRideRoadRoute(
          commandBody,
          providers.routesKey,
          providers.request,
        );
      }
      send(
        200,
        await service.mutate(
          token,
          typeof commandKey === "string" ? commandKey : "",
          path.slice(9),
          commandBody,
          providerRoute,
        ),
      );
    } catch (error) {
      if (error instanceof RideSandboxError)
        send(error.status, { error: { code: error.code } });
      else if (error instanceof ZodError)
        send(422, { error: { code: "VALIDATION_FAILED" } });
      else send(500, { error: { code: "SANDBOX_INTERNAL_ERROR" } });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
