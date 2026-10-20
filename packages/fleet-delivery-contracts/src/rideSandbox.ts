import { z } from "zod";

// Passenger sandbox is a separate aggregate: never reuse goods-delivery/payment states.
export const rideRoleSchema = z.enum(["RIDER", "DRIVER"]);
export const rideStateSchema = z.enum([
  "SEARCHING",
  "ACCEPTED",
  "AT_PICKUP",
  "IN_PROGRESS",
  "AWAITING_PAYMENT",
  "COMPLETED",
  "CANCELLED",
]);
export const ridePointSchema = z
  .object({
    label: z.string().trim().min(2).max(100),
    lat: z.number().min(13).max(15),
    lng: z.number().min(99).max(102),
  })
  .strict();
export const rideCredentialsSchema = z
  .object({
    username: z.string().min(3).max(60),
    password: z.string().min(8).max(72),
    role: rideRoleSchema,
  })
  .strict();
export const rideRegistrationSchema = rideCredentialsSchema
  .extend({
    displayName: z.string().trim().min(2).max(60),
    vehiclePlate: z.string().trim().max(30).default(""),
    sandboxConsent: z.literal(true),
  })
  .strict()
  .refine((v) => v.role !== "DRIVER" || v.vehiclePlate.length >= 2, {
    message: "Driver vehicle plate required",
  });
export const rideQuoteInputSchema = z
  .object({ pickup: ridePointSchema, dropoff: ridePointSchema })
  .strict();
export const rideQuoteRequestSchema = rideQuoteInputSchema
  .extend({ providerConsent: z.literal(true) })
  .strict();
// Bangkok pilot boundary; intentionally not nationwide. No real-device authority yet.
export const rideLocationSchema = ridePointSchema
  .omit({ label: true })
  .extend({
    accuracyM: z.number().min(0).max(100),
    capturedAt: z.iso.datetime(),
    source: z.literal("SIMULATOR"),
  })
  .strict();
export const rideNearbySchema = z.object({
  count: z.number().int().nonnegative(),
  radiusM: z.literal(5000),
  nearestDistanceM: z.number().int().nonnegative().nullable(),
  assessedDriverCount: z.number().int().min(0).max(5),
  pickupEtaSeconds: z.number().int().positive().nullable(),
  pickupRoadDistanceM: z.number().int().positive().nullable(),
  pickupEtaStatus: z.enum([
    "AVAILABLE",
    "NO_DRIVER",
    "PROVIDER_UNAVAILABLE",
  ]),
  etaProvider: z.literal("GOOGLE").nullable(),
});
export const ridePlaceSearchSchema = z
  .object({
    query: z.string().trim().min(2).max(120),
    providerConsent: z.literal(true),
  })
  .strict();
export const ridePlaceResultsSchema = z.object({
  provider: z.literal("GOOGLE"),
  places: z
    .array(ridePointSchema.extend({ placeId: z.string().max(255) }))
    .max(5),
});
export const rideRoadRouteSchema = z
  .object({
    provider: z.literal("GOOGLE"),
    travelMode: z.literal("TWO_WHEELER"),
    distanceM: z.number().int().min(100).max(50000),
    durationSeconds: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60),
    encodedPolyline: z.string().min(2).max(100000),
    warnings: z.array(z.string().trim().min(1).max(500)).max(10),
  })
  .strict();
export const rideActionSchema = z.enum([
  "accept",
  "arrive",
  "start",
  "finish",
  "cancel",
  "pay",
]);
export const rideCommandSchema = z
  .object({
    action: rideActionSchema,
    version: z.number().int().positive(),
    paymentOutcome: z.enum(["SUCCEEDED", "DECLINED"]).optional(),
    confirmed: z.literal(true),
  })
  .strict();
export const rideQuoteSchema = rideQuoteInputSchema.extend({
  id: z.string().uuid(),
  distanceM: z.number().int(),
  fareSatang: z.number().int(),
  expiresAt: z.iso.datetime(),
  pricing: z.literal("SANDBOX_GOOGLE_ROAD_V1"),
  route: rideRoadRouteSchema,
});
export const rideViewSchema = rideQuoteInputSchema.extend({
  id: z.string().uuid(),
  state: rideStateSchema,
  version: z.number().int(),
  fareSatang: z.number().int(),
  distanceM: z.number().int(),
  riderName: z.string(),
  driverName: z.string().nullable(),
  vehiclePlate: z.string().nullable(),
  paymentStatus: z.enum(["UNPAID", "DECLINED", "SUCCEEDED"]),
  receiptRef: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const rideSnapshotSchema = z.object({
  sandbox: z.literal(true),
  account: z.object({
    id: z.string().uuid(),
    role: rideRoleSchema,
    displayName: z.string(),
    online: z.boolean(),
    vehiclePlate: z.string(),
  }),
  current: rideViewSchema.nullable(),
  offers: z.array(rideViewSchema),
  history: z.array(rideViewSchema),
  earningsSatang: z.number().int(),
  driverLocation: rideLocationSchema.nullable().default(null),
});
export const rideSessionSchema = z.object({
  accountId: z.string().uuid(),
  apiBaseUrl: z
    .string()
    .url()
    .refine((v) => {
      const u = new URL(v);
      return (
        (u.protocol === "https:" ||
          (u.protocol === "http:" && u.hostname === "127.0.0.1")) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        u.pathname === "/"
      );
    })
    .transform((v) => new URL(v).origin),
  accessToken: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
  role: rideRoleSchema,
});
export type RidePoint = z.infer<typeof ridePointSchema>;
export type RideQuote = z.infer<typeof rideQuoteSchema>;
export type RideRoadRoute = z.infer<typeof rideRoadRouteSchema>;
export type RideView = z.infer<typeof rideViewSchema>;
export type RideSnapshot = z.infer<typeof rideSnapshotSchema>;
export type RideSession = z.infer<typeof rideSessionSchema>;
export const RIDE_TEST_PLACES: RidePoint[] = [
  { label: "สยามพารากอน · Siam", lat: 13.7463, lng: 100.5347 },
  { label: "MBK Center", lat: 13.7446, lng: 100.5302 },
  { label: "อโศก · Asok", lat: 13.7372, lng: 100.5602 },
  { label: "สวนลุมพินี · Lumphini", lat: 13.7307, lng: 100.5418 },
  { label: "อนุสาวรีย์ชัยฯ · Victory Monument", lat: 13.7649, lng: 100.5383 },
];
