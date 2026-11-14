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
    ...base, status: cafe.publishAvailability || cafe.publishTableDetails ? "OK" : "NOT_PUBLISHED",
    totalTables: cafe.publishAvailability ? cafe.totalTables : null,
    availableTables: cafe.publishAvailability ? cafe.availableTables : null,
    tableDetails: cafe.publishTableDetails ? (cafe.tableDetails ?? []).map((detail) => ({
      area: detail.area,
      seats: detail.seats,
      totalTables: detail.totalTables,
      availableTables: cafe.publishAvailability ? detail.availableTables : null,
    })) : null,
    tableDetailsTruncated: cafe.publishTableDetails ? cafe.tableDetailsTruncated : null,
    observedAt: new Date().toISOString(),
    booking: {
      requestsEnabled: cafe.bookingEnabled,
      depositPolicy: cafe.reservationDepositPolicy,
      depositAmount: cafe.reservationDepositPolicy === "FIXED" ? cafe.reservationDepositAmount : null,
      depositPercent: cafe.reservationDepositPolicy === "PERCENT" ? cafe.reservationDepositPercent : null,
      refundCutoffHours: cafe.reservationDepositRefundCutoffHours,
      canSubmitViaChat: cafe.bookingEnabled && cafe.reservationDepositPolicy === "NONE",
      autoConfirm: cafe.chatAutoConfirm && cafe.bookingEnabled && cafe.reservationDepositPolicy === "NONE",
    },
    waitMinutes: null, waitingParties: null,
    note: "Published customer-safe table summary only. Area is the shop-maintained public zone/floor label; seats is table capacity. When tableDetailsTruncated is true, only the first 100 groups are shown: explicitly say this is a partial list, never sum it as the branch total or infer that an omitted area/capacity is unavailable; ask staff for remaining details. Available counts are current observations, not a reservation or a guarantee of future space. Never infer or reveal table numbers, occupants, sessions or customer identities.",
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

/** Read only passes owned by the channel-resolved customer. Never expose cached minutes when the ledger disagrees. */
export async function readBoardGameCustomerPassesInTx(client: QueryClient, tenantId: string, customerId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId)) {
    throw new Error("Invalid customer identity");
  }
  await requireBoardGameCafeTenant(client, tenantId);
  const result = await client.query<{
    plan_name: string; kind: "MINUTES" | "UNLIMITED"; included_minutes: number | null;
    remaining_minutes: number | null; ledger_minutes: string | null;
    starts_at: Date | string; expires_at: Date | string; status: "ACTIVE" | "EXPIRED" | "CANCELLED";
    location_name: string | null; is_current: boolean;
  }>(
    `SELECT p.plan_name, p.kind, p.included_minutes, p.remaining_minutes,
            ledger.minutes AS ledger_minutes, p.starts_at, p.expires_at, p.status,
            location.name AS location_name,
            (p.status = 'ACTIVE' AND p.starts_at <= now() AND p.expires_at > now()) AS is_current
       FROM bms_board_game_member_passes p
       LEFT JOIN bms_locations location ON location.tenant_id = p.tenant_id AND location.id = p.location_id
       LEFT JOIN LATERAL (
         SELECT SUM(l.minutes)::text AS minutes
           FROM bms_board_game_pass_ledger l
          WHERE l.tenant_id = p.tenant_id AND l.pass_id = p.id AND l.kind <> 'ISSUE'
       ) ledger ON true
      WHERE p.tenant_id = $1 AND p.customer_id = $2
      ORDER BY p.expires_at DESC, p.created_at DESC
      LIMIT 11`,
    [tenantId, customerId]
  );
  const passes = result.rows.slice(0, 10).map((row) => {
    const balanceMatches = row.kind === "UNLIMITED" ||
      Number(row.remaining_minutes) === Math.max(0, Number(row.included_minutes) + Number(row.ledger_minutes ?? 0));
    return {
      planName: row.plan_name,
      kind: row.kind,
      branch: row.location_name,
      startsAt: new Date(row.starts_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      status: row.status === "CANCELLED" ? "CANCELLED" :
        row.status === "EXPIRED" ? "EXPIRED" :
        new Date(row.expires_at).getTime() <= Date.now() ? "EXPIRED" :
        !row.is_current ? "NOT_STARTED" :
        row.kind === "MINUTES" && Number(row.remaining_minutes) === 0 ? "USED_UP" : "ACTIVE",
      remainingMinutes: row.is_current && balanceMatches && row.kind === "MINUTES" ? Number(row.remaining_minutes) : null,
      balanceStatus: balanceMatches ? "VERIFIED" : "REVIEW_REQUIRED",
    };
  });
  return {
    status: passes.length ? "OK" : "NO_PASSES",
    passes, truncated: result.rows.length > 10,
    note: "Only the channel-verified customer's purchased passes. Null remainingMinutes is not zero: unlimited, inactive, or a ledger mismatch. Branch null means all branches. Never infer current plan prices, discounts, or final charges.",
  };
}

export async function readBoardGameCustomerPasses(tenantId: string, customerId: string) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await readBoardGameCustomerPassesInTx(client, tenantId, customerId);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Opt-in catalog only. Active rows may still have conditions, so this is never an eligibility quote. */
export async function readBoardGameCustomerCatalogInTx(
  client: QueryClient, tenantId: string, kind: "plans" | "offers", branch?: string,
  readCafes = listBoardGameChatBranches
) {
  const selectedBranch = boundedText(branch, 120);
  await requireBoardGameCafeTenant(client, tenantId);
  const published = await readCafes({ tenantId, client });
  if (!published.length) return { status: "NOT_PUBLISHED", branches: [] };
  const matches = selectedBranch
    ? published.filter((cafe) => cafe.displayName.toLocaleLowerCase() === selectedBranch.toLocaleLowerCase())
    : published;
  if (matches.length !== 1) return {
    status: "BRANCH_REQUIRED", branches: published.slice(0, 20).map((cafe) => ({ name: cafe.displayName })),
  };
  const cafe = matches[0];
  if (kind === "plans") {
    const result = await client.query<{
      name: string; kind: "MINUTES" | "UNLIMITED"; price: string; duration_days: number;
      included_minutes: number | null;
    }>(
      `SELECT name, kind, price, duration_days, included_minutes
         FROM bms_board_game_pass_plans
        WHERE tenant_id = $1 AND (location_id IS NULL OR location_id = $2)
          AND active AND publish_to_chat
        ORDER BY sort_order, name
        LIMIT 21`,
      [tenantId, cafe.locationId]
    );
    return { status: result.rows.length ? "OK" : "NOT_PUBLISHED", branch: publicBranch(cafe),
      plans: result.rows.slice(0, 20).map((row) => ({
        name: row.name, kind: row.kind, price: Number(row.price),
        durationDays: Number(row.duration_days),
        includedMinutes: row.included_minutes == null ? null : Number(row.included_minutes),
      })), truncated: result.rows.length > 20,
      note: "Only active plans explicitly published for customer chat. Duration starts when a pass is issued; do not call a durationDays=30 plan a calendar-month subscription. Price is the listed plan price, not a paid order or final bill. No purchase is made here.",
    };
  }
  const result = await client.query<{
    name: string; kind: "TIME_PERCENT" | "TIME_FIXED_PER_PERSON" | "GROUP_FIXED" | "TIME_BUY_GET";
    percent_off: string | null; fixed_price: string | null; buy_minutes: number | null; free_minutes: number | null;
    min_players: number; max_players: number | null; minimum_minutes: number; required_product_sku: string | null;
    valid_from: Date | string | null; valid_until: Date | string | null; weekdays: number[];
    starts_local_time: string | null; ends_local_time: string | null; starts_in_future: boolean;
  }>(
    `SELECT name, kind, percent_off, fixed_price, buy_minutes, free_minutes,
            min_players, max_players, minimum_minutes, required_product_sku,
            valid_from, valid_until, weekdays, starts_local_time, ends_local_time,
            (valid_from > now()) AS starts_in_future
       FROM bms_board_game_offers
      WHERE tenant_id = $1 AND (location_id IS NULL OR location_id = $2)
        AND active AND publish_to_chat AND (valid_until IS NULL OR valid_until > now())
      ORDER BY sort_order, name
      LIMIT 21`,
    [tenantId, cafe.locationId]
  );
  return { status: result.rows.length ? "OK" : "NOT_PUBLISHED", branch: publicBranch(cafe),
    offers: result.rows.slice(0, 20).map((row) => ({
      name: row.name, kind: row.kind,
      percentOff: row.percent_off == null ? null : Number(row.percent_off),
      fixedPrice: row.fixed_price == null ? null : Number(row.fixed_price),
      buyMinutes: row.buy_minutes == null ? null : Number(row.buy_minutes),
      freeMinutes: row.free_minutes == null ? null : Number(row.free_minutes),
      minPlayers: Number(row.min_players), maxPlayers: row.max_players == null ? null : Number(row.max_players),
      minimumMinutes: Number(row.minimum_minutes), requiresProductPurchase: row.required_product_sku != null,
      validFrom: row.valid_from == null ? null : new Date(row.valid_from).toISOString(),
      validUntil: row.valid_until == null ? null : new Date(row.valid_until).toISOString(),
      startsInFuture: Boolean(row.starts_in_future),
      weekdays: row.weekdays, startsLocalTime: row.starts_local_time == null ? null : String(row.starts_local_time).slice(0, 5),
      endsLocalTime: row.ends_local_time == null ? null : String(row.ends_local_time).slice(0, 5),
    })), truncated: result.rows.length > 20,
    timezone: cafe.timezone,
    note: "Only active offers explicitly published for customer chat, excluding expired dates. weekdays uses 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday in the branch timezone. Future dates, weekdays, time windows, player counts, minimum play time and product purchase may restrict eligibility. Offers compete with passes when the bill closes; never promise a discount, stacking, or final price. No internal SKU or note is exposed.",
  };
}

export async function readBoardGameCustomerCatalog(tenantId: string, kind: "plans" | "offers", branch?: string) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await readBoardGameCustomerCatalogInTx(client, tenantId, kind, branch);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
