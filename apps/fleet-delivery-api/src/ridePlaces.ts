import { z } from "zod";
import {
  ridePlaceSearchSchema,
  ridePlaceResultsSchema,
  ridePointSchema,
} from "@bms/fleet-delivery-contracts";
import { RideSandboxError } from "../../../packages/fleet-delivery-database/src/rideSandbox.js";

/** Explicit search only, no keystroke queries, logs, cache, or automatic retries/billing. */
export async function searchRidePlaces(
  raw: unknown,
  key: string | undefined,
  request: typeof fetch = fetch
) {
  const input = ridePlaceSearchSchema.parse(raw);
  if (!key?.trim())
    throw new RideSandboxError("GOOGLE_PLACES_NOT_CONFIGURED", 503);
  try {
    const response = await request(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.id,places.displayName,places.location",
        },
        body: JSON.stringify({
          textQuery: input.query,
          languageCode: "th",
          regionCode: "TH",
          pageSize: 5,
          locationRestriction: {
            rectangle: {
              low: { latitude: 13, longitude: 99 },
              high: { latitude: 15, longitude: 102 },
            },
          },
        }),
      }
    );
    if (!response.ok) throw new Error("PROVIDER_FAILURE");
    const schema = z.object({
      places: z
        .array(
          z.object({
            id: z.string().max(255),
            displayName: z.object({ text: z.string() }),
            location: z.object({ latitude: z.number(), longitude: z.number() }),
          })
        )
        .max(5)
        .default([]),
    });
    const payload = schema.parse(await response.json());
    const places = payload.places.flatMap((p) => {
      const point = ridePointSchema.safeParse({
        label: p.displayName.text.slice(0, 100),
        lat: p.location.latitude,
        lng: p.location.longitude,
      });
      return point.success ? [{ ...point.data, placeId: p.id }] : [];
    });
    return ridePlaceResultsSchema.parse({ provider: "GOOGLE", places });
  } catch {
    // Never reflect provider error bodies, keys, query text or coordinates to logs/UI.
    throw new RideSandboxError("GOOGLE_PLACES_UNAVAILABLE", 502);
  }
}
