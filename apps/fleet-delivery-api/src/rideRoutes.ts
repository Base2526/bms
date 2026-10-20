import { z } from "zod";
import {
  rideQuoteRequestSchema,
  rideRoadRouteSchema,
} from "@bms/fleet-delivery-contracts";
import { RideSandboxError } from "../../../packages/fleet-delivery-database/src/rideSandbox.js";

const googleRoutesResponseSchema = z
  .object({
    routes: z
      .array(
        z
          .object({
            distanceMeters: z.number().int().positive().max(200000),
            duration: z.string().regex(/^\d+(?:\.\d+)?s$/),
            polyline: z
              .object({ encodedPolyline: z.string().min(2).max(100000) })
              .strict(),
            warnings: z.array(z.string().min(1).max(500)).max(10).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(1),
  })
  .strict();

const googleRouteMatrixResponseSchema = z
  .array(
    z
      .object({
        originIndex: z.number().int().min(0).max(4),
        destinationIndex: z.literal(0),
        status: z
          .object({
            code: z.number().int().default(0),
            message: z.string().max(500).optional(),
          })
          .passthrough()
          .optional(),
        condition: z.enum(["ROUTE_EXISTS", "ROUTE_NOT_FOUND"]),
        distanceMeters: z.number().int().positive().max(50000).optional(),
        duration: z.string().regex(/^\d+(?:\.\d+)?s$/).optional(),
      })
      .strict(),
  )
  .max(5);

type DriverOrigin = { lat: number; lng: number };

/** Road ETA for at most five already-eligible drivers; raw driver coordinates never leave the server. */
export async function computeDriverPickupEstimate(
  origins: DriverOrigin[],
  pickup: DriverOrigin,
  key: string | undefined,
  request: typeof fetch = fetch,
) {
  if (origins.length === 0) return null;
  if (!key?.trim())
    throw new RideSandboxError("GOOGLE_ROUTES_NOT_CONFIGURED", 503);
  try {
    const response = await request(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "originIndex,destinationIndex,status,condition,distanceMeters,duration",
        },
        body: JSON.stringify({
          origins: origins.slice(0, 5).map((origin) => ({
            waypoint: {
              location: {
                latLng: {
                  latitude: origin.lat,
                  longitude: origin.lng,
                },
              },
            },
          })),
          destinations: [
            {
              waypoint: {
                location: {
                  latLng: {
                    latitude: pickup.lat,
                    longitude: pickup.lng,
                  },
                },
              },
            },
          ],
          travelMode: "TWO_WHEELER",
          routingPreference: "TRAFFIC_AWARE",
          languageCode: "th",
          regionCode: "TH",
          units: "METRIC",
        }),
      },
    );
    if (!response.ok) throw new Error("PROVIDER_FAILURE");
    const routes = googleRouteMatrixResponseSchema.parse(await response.json());
    const candidates = routes
      .filter(
        (route) =>
          (route.status?.code ?? 0) === 0 &&
          route.condition === "ROUTE_EXISTS" &&
          route.duration !== undefined &&
          route.distanceMeters !== undefined,
      )
      .map((route) => ({
        durationSeconds: Math.ceil(Number(route.duration!.slice(0, -1))),
        distanceM: route.distanceMeters!,
      }))
      .filter(
        (route) =>
          Number.isSafeInteger(route.durationSeconds) &&
          route.durationSeconds > 0,
      )
      .sort((left, right) => left.durationSeconds - right.durationSeconds);
    if (!candidates[0]) throw new Error("NO_VALID_ROUTE");
    return candidates[0];
  } catch {
    throw new RideSandboxError("GOOGLE_ROUTES_UNAVAILABLE", 502);
  }
}

/** One explicit, authenticated request; no cache, redirect, retry or straight-line fallback. */
export async function computeRideRoadRoute(
  raw: unknown,
  key: string | undefined,
  request: typeof fetch = fetch,
) {
  const input = rideQuoteRequestSchema.parse(raw);
  if (!key?.trim())
    throw new RideSandboxError("GOOGLE_ROUTES_NOT_CONFIGURED", 503);
  let route: z.infer<typeof googleRoutesResponseSchema>["routes"][number];
  try {
    const response = await request(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.warnings",
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: {
                latitude: input.pickup.lat,
                longitude: input.pickup.lng,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: input.dropoff.lat,
                longitude: input.dropoff.lng,
              },
            },
          },
          travelMode: "TWO_WHEELER",
          routingPreference: "TRAFFIC_AWARE",
          computeAlternativeRoutes: false,
          polylineQuality: "OVERVIEW",
          polylineEncoding: "ENCODED_POLYLINE",
          routeModifiers: {
            avoidTolls: false,
            avoidHighways: false,
            avoidFerries: false,
          },
          languageCode: "th",
          regionCode: "TH",
          units: "METRIC",
        }),
      },
    );
    if (!response.ok) throw new Error("PROVIDER_FAILURE");
    route = googleRoutesResponseSchema.parse(await response.json()).routes[0]!;
  } catch {
    // Never reflect provider bodies, key, coordinates or transport details to logs/UI.
    throw new RideSandboxError("GOOGLE_ROUTES_UNAVAILABLE", 502);
  }
  if (route.distanceMeters < 100 || route.distanceMeters > 50000)
    throw new RideSandboxError("SANDBOX_ROAD_DISTANCE_100M_TO_50KM", 422);
  return rideRoadRouteSchema.parse({
    provider: "GOOGLE",
    travelMode: "TWO_WHEELER",
    distanceM: route.distanceMeters,
    durationSeconds: Math.ceil(Number(route.duration.slice(0, -1))),
    encodedPolyline: route.polyline.encodedPolyline,
    warnings: route.warnings,
  });
}
