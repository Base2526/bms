import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { listBoardGameChatBranches, requireBoardGameCafeTenant, type PublicBoardGameCafe, type QueryClient } from "./boardGameCafe";

export type BoardGameCustomerQuery = {
  branch?: string;
  keyword?: string;
  players?: number;
  playersTo?: number;
  difficulty?: "LIGHT" | "MEDIUM" | "HEAVY" | "CUSTOM";
  limit?: number;
};
export type BoardGameCustomerRead = "rates" | "library" | "availability";

function boundedText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid board-game search text");
  return value.trim() || undefined;
}

function publicBranch(cafe: PublicBoardGameCafe) {
  return {
    name: cafe.displayName, summary: cafe.summary, address: cafe.publicAddress,
    phone: cafe.publicPhone, openingHours: cafe.openingHours, timezone: cafe.timezone,
  };
}

/** Tenant and publication checks precede all reads; no operational row identifiers leave this service. */
export async function readBoardGameCustomerInfoInTx(
  client: QueryClient,
  tenantId: string,
  kind: BoardGameCustomerRead,
  input: BoardGameCustomerQuery = {},
  readCafes = listBoardGameChatBranches
) {
  const branch = boundedText(input.branch, 120);
  const keyword = boundedText(input.keyword, 120);
  const players = input.players ?? null;
  const playersTo = input.playersTo ?? players;
  const difficulty = input.difficulty ?? null;
  const limit = input.limit ?? 8;
  if (players !== null && (!Number.isInteger(players) || players < 1 || players > 100)) throw new Error("Invalid player count");
  if (playersTo !== null && (players === null || !Number.isInteger(playersTo) || playersTo < players || playersTo > 100)) throw new Error("Invalid player range");
  if (difficulty !== null && !["LIGHT", "MEDIUM", "HEAVY", "CUSTOM"].includes(difficulty)) throw new Error("Invalid difficulty");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Invalid result limit");
  await requireBoardGameCafeTenant(client, tenantId);
  const published = await readCafes({ tenantId, client });
  if (!published.length) return { status: "NOT_PUBLISHED", branches: [] };
  const matches = branch
    ? published.filter((cafe) => cafe.displayName.toLocaleLowerCase() === branch.toLocaleLowerCase())
    : published;
  if (matches.length !== 1) return {
    status: "BRANCH_REQUIRED", branches: published.slice(0, 20).map((cafe) => ({ name: cafe.displayName })),
  };
  const cafe = matches[0];
  const base = { branch: publicBranch(cafe) };
  if (kind === "rates") return {
    ...base, status: cafe.publishRates ? "OK" : "NOT_PUBLISHED",
    rates: cafe.publishRates ? cafe.rates.slice(0, 20) : [],
    offersStatus: "NOT_EXPOSED", note: "Published hourly rates only. Do not infer day packages, offers, personal eligibility or a final bill.",
  };
  if (kind === "availability") return {
    ...base, status: cafe.publishAvailability ? "OK" : "NOT_PUBLISHED",
    totalTables: cafe.publishAvailability ? cafe.totalTables : null,
    availableTables: cafe.publishAvailability ? cafe.availableTables : null,
    observedAt: new Date().toISOString(),
    booking: {
      requestsEnabled: cafe.bookingEnabled,
      depositPolicy: cafe.reservationDepositPolicy,
      depositAmount: cafe.reservationDepositPolicy === "FIXED" ? cafe.reservationDepositAmount : null,
      depositPercent: cafe.reservationDepositPolicy === "PERCENT" ? cafe.reservationDepositPercent : null,
      refundCutoffHours: cafe.reservationDepositRefundCutoffHours,
      canSubmitViaChat: cafe.bookingEnabled && cafe.reservationDepositPolicy === "NONE",
    },
    waitMinutes: null, waitingParties: null, partyCapacity: null,
    note: "Current aggregate only, not a reservation or a guarantee of space for a party. Queue, wait time and party capacity are not available through this tool.",
  };
  const result = await client.query(
    `SELECT title.title, title.min_players, title.max_players, title.typical_minutes,
            title.difficulty, title.language, title.tags,
            COUNT(*)::int AS total_copies,
            CASE WHEN $6::boolean THEN COUNT(*) FILTER (WHERE copy.status = 'AVAILABLE')::int ELSE NULL END AS available_copies
       FROM bms_board_game_titles title
       JOIN bms_board_game_copies copy ON copy.tenant_id = title.tenant_id AND copy.title_id = title.id
       JOIN bms_board_game_public_locations profile ON profile.tenant_id = copy.tenant_id AND profile.location_id = copy.location_id
       JOIN bms_locations location ON location.tenant_id = profile.tenant_id AND location.id = profile.location_id
      WHERE title.tenant_id = $1 AND copy.location_id = $2
        AND location.active AND title.public_visible
        AND copy.status NOT IN ('RETIRED', 'LOST')
        AND ($3::text IS NULL OR POSITION(lower($3) IN lower(title.title)) > 0
             OR EXISTS (SELECT 1 FROM unnest(title.tags) tag WHERE POSITION(lower($3) IN lower(tag)) > 0))
        AND ($4::int IS NULL OR (title.min_players <= $4 AND title.max_players >= $7::int))
        AND ($8::text IS NULL OR title.difficulty = $8)
      GROUP BY title.id
      ORDER BY title.title
      LIMIT $5`,
    [tenantId, cafe.locationId, keyword ?? null, players, limit, cafe.publishAvailability, playersTo, difficulty]
  );
  return {
    ...base, status: "OK", games: result.rows.map((row) => ({
      title: row.title, minPlayers: row.min_players, maxPlayers: row.max_players,
      typicalMinutes: row.typical_minutes, difficulty: row.difficulty, language: row.language,
      tags: Array.isArray(row.tags) ? row.tags.slice(0, 20) : [],
      totalCopies: Number(row.total_copies), availableCopies: row.available_copies == null ? null : Number(row.available_copies),
    })),
    limit, note: "Playable library, not retail stock. Total copies exclude lost/retired copies but may include copies needing repair. Null availableCopies means availability is not published. Empty results mean no matching published title, not proof the shop has no such game. No game rules are supplied.",
  };
}

export async function readBoardGameCustomerInfo(tenantId: string, kind: BoardGameCustomerRead, input: BoardGameCustomerQuery = {}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await readBoardGameCustomerInfoInTx(client, tenantId, kind, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
