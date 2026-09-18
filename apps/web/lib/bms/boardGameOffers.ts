import type { QueryResult, QueryResultRow } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type BoardGameOfferKind = "TIME_PERCENT" | "TIME_FIXED_PER_PERSON" | "GROUP_FIXED";

export type BoardGameOffer = {
  id: string;
  locationId: string | null;
  code: string;
  name: string;
  kind: BoardGameOfferKind;
  percentOff: number | null;
  fixedPrice: number | null;
  minPlayers: number;
  maxPlayers: number | null;
  minimumMinutes: number;
  requiredProductSku: string | null;
  validFrom: string | null;
  validUntil: string | null;
  weekdays: number[];
  startsLocalTime: string | null;
  endsLocalTime: string | null;
  active: boolean;
  sortOrder: number;
  note: string | null;
};

export type BoardGameOfferChargeLine = {
  billableMinutes: number;
  grossAmount: number;
};

export type AppliedBoardGameOfferLine = {
  amount: number;
  offerId: string;
  offerCode: string;
  offerName: string;
  offerDiscountAmount: number;
};

type QueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: any[]): Promise<QueryResult<T>>;
};

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const iso = (value: unknown) => value == null ? null : value instanceof Date ? value.toISOString() : String(value);

function text(value: unknown, label: string, max: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > max) throw new Error(`${label}ไม่ถูกต้อง`);
  return normalized;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  return value == null || value === "" ? null : text(value, label, max);
}

function integer(value: unknown, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label}ไม่ถูกต้อง`);
  return parsed;
}

function amount(value: unknown, label: string, min = 0, max = 1_000_000): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label}ไม่ถูกต้อง`);
  return money(parsed);
}

function uuid(value: unknown, label: string): string {
  const normalized = text(value, label, 36).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`${label}ไม่ถูกต้อง`);
  }
  return normalized;
}

function code(value: unknown): string {
  const normalized = text(value, "รหัสโปรโมชัน", 120).toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!normalized) throw new Error("รหัสโปรโมชันไม่ถูกต้อง");
  return normalized;
}

function kind(value: unknown): BoardGameOfferKind {
  if (value === "TIME_PERCENT" || value === "TIME_FIXED_PER_PERSON" || value === "GROUP_FIXED") return value;
  throw new Error("ชนิดโปรโมชันไม่ถูกต้อง");
}

function date(value: unknown, label: string): Date | null {
  if (value == null || value === "") return null;
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}ไม่ถูกต้อง`);
  return parsed;
}

function localTime(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) throw new Error(`${label}ไม่ถูกต้อง`);
  return normalized;
}

function mapOffer(row: any): BoardGameOffer {
  return {
    id: row.id,
    locationId: row.location_id ?? null,
    code: row.code,
    name: row.name,
    kind: row.kind,
    percentOff: row.percent_off == null ? null : Number(row.percent_off),
    fixedPrice: row.fixed_price == null ? null : Number(row.fixed_price),
    minPlayers: Number(row.min_players),
    maxPlayers: row.max_players == null ? null : Number(row.max_players),
    minimumMinutes: Number(row.minimum_minutes),
    requiredProductSku: row.required_product_sku ?? null,
    validFrom: iso(row.valid_from),
    validUntil: iso(row.valid_until),
    weekdays: (row.weekdays ?? []).map(Number),
    startsLocalTime: row.starts_local_time == null ? null : String(row.starts_local_time).slice(0, 5),
    endsLocalTime: row.ends_local_time == null ? null : String(row.ends_local_time).slice(0, 5),
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
    note: row.note ?? null,
  };
}

const OFFER_COLUMNS = `id, location_id, code, name, kind, percent_off, fixed_price,
  min_players, max_players, minimum_minutes, required_product_sku, valid_from, valid_until,
  weekdays, starts_local_time, ends_local_time, active, sort_order, note`;

export async function listBoardGameOffers(
  tenantId: string,
  visibleLocationIds?: string[] | null,
): Promise<BoardGameOffer[]> {
  const scope = Array.isArray(visibleLocationIds) ? visibleLocationIds.map((id) => uuid(id, "locationId")) : null;
  const result = await query(
    `SELECT ${OFFER_COLUMNS}
       FROM bms_board_game_offers
      WHERE tenant_id = $1
        AND ($2::uuid[] IS NULL OR location_id IS NULL OR location_id = ANY($2::uuid[]))
      ORDER BY active DESC, sort_order, name`,
    [tenantId, scope],
  );
  return result.rows.map(mapOffer);
}

export async function locationOfBoardGameOffer(tenantId: string, offerIdInput: string): Promise<string | null> {
  const offerId = uuid(offerIdInput, "offerId");
  const result = await query<{ location_id: string | null }>(
    `SELECT location_id FROM bms_board_game_offers WHERE tenant_id = $1 AND id = $2`,
    [tenantId, offerId],
  );
  if (!result.rowCount) throw new Error("ไม่พบโปรโมชันนี้");
  return result.rows[0].location_id ?? null;
}

export async function upsertBoardGameOffer(
  tenantId: string,
  input: {
    id?: string | null; locationId?: string | null; code?: string | null; name: string; kind: string;
    percentOff?: number | null; fixedPrice?: number | null; minPlayers?: number | null;
    maxPlayers?: number | null; minimumMinutes?: number | null; requiredProductSku?: string | null;
    validFrom?: string | null; validUntil?: string | null; weekdays?: number[] | null;
    startsLocalTime?: string | null; endsLocalTime?: string | null; active?: boolean | null;
    sortOrder?: number | null; note?: string | null;
  },
  actorUserId?: string | null,
): Promise<BoardGameOffer> {
  const id = input.id ? uuid(input.id, "id") : null;
  const locationId = input.locationId ? uuid(input.locationId, "locationId") : null;
  const offerKind = kind(input.kind);
  const name = text(input.name, "ชื่อโปรโมชัน", 120);
  const offerCode = code(input.code || name);
  const percentOff = offerKind === "TIME_PERCENT" ? amount(input.percentOff, "เปอร์เซ็นต์", 0.01, 100) : null;
  const fixedPrice = offerKind === "TIME_PERCENT" ? null : amount(input.fixedPrice, "ราคาพิเศษ");
  const minPlayers = integer(input.minPlayers ?? 1, "จำนวนผู้เล่นขั้นต่ำ", 1, 100);
  const maxPlayers = input.maxPlayers == null ? null
    : integer(input.maxPlayers, "จำนวนผู้เล่นสูงสุด", minPlayers, 100);
  const minimumMinutes = integer(input.minimumMinutes ?? 0, "เวลาขั้นต่ำ", 0, 1440);
  const requiredProductSku = optionalText(input.requiredProductSku, "SKU ที่ต้องมี", 80)?.toUpperCase() ?? null;
  const validFrom = date(input.validFrom, "วันเริ่ม");
  const validUntil = date(input.validUntil, "วันสิ้นสุด");
  if (validFrom && validUntil && validUntil <= validFrom) throw new Error("วันสิ้นสุดต้องอยู่หลังวันเริ่ม");
  const weekdays = [...new Set(input.weekdays ?? [0, 1, 2, 3, 4, 5, 6])]
    .map((day) => integer(day, "วันใช้งาน", 0, 6)).sort();
  if (!weekdays.length) throw new Error("ต้องเลือกวันใช้งานอย่างน้อยหนึ่งวัน");
  const startsLocalTime = localTime(input.startsLocalTime, "เวลาเริ่ม");
  const endsLocalTime = localTime(input.endsLocalTime, "เวลาสิ้นสุด");
  if ((startsLocalTime == null) !== (endsLocalTime == null)) throw new Error("ต้องระบุเวลาเริ่มและสิ้นสุดคู่กัน");
  if (startsLocalTime && endsLocalTime && endsLocalTime <= startsLocalTime) {
    throw new Error("ช่วงเวลาโปรโมชันต้องจบภายในวันเดียวกันและหลังเวลาเริ่ม");
  }
  const active = input.active == null ? true : Boolean(input.active);
  const sortOrder = integer(input.sortOrder ?? 0, "ลำดับ", -100000, 100000);
  const note = optionalText(input.note, "หมายเหตุ", 500);

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, actorUserId ? { editorId: actorUserId } : undefined);
    if (locationId) {
      const location = await client.query(`SELECT 1 FROM bms_locations WHERE tenant_id = $1 AND id = $2`, [tenantId, locationId]);
      if (!location.rowCount) throw new Error("ไม่พบสาขานี้");
    }
    if (requiredProductSku) {
      const product = await client.query(
        `SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2 AND deleted_at IS NULL`,
        [tenantId, requiredProductSku],
      );
      if (!product.rowCount) throw new Error("ไม่พบ SKU ที่ใช้เป็นเงื่อนไข");
    }
    const params = [tenantId, id, locationId, offerCode, name, offerKind, percentOff, fixedPrice,
      minPlayers, maxPlayers, minimumMinutes, requiredProductSku, validFrom, validUntil, weekdays,
      startsLocalTime, endsLocalTime, active, sortOrder, note];
    const result = await client.query(
      id
        ? `UPDATE bms_board_game_offers SET location_id=$3, code=$4, name=$5, kind=$6,
             percent_off=$7, fixed_price=$8, min_players=$9, max_players=$10,
             minimum_minutes=$11, required_product_sku=$12, valid_from=$13, valid_until=$14,
             weekdays=$15, starts_local_time=$16, ends_local_time=$17, active=$18,
             sort_order=$19, note=$20, version=version+1, updated_at=now()
           WHERE tenant_id=$1 AND id=$2 RETURNING ${OFFER_COLUMNS}`
        : `INSERT INTO bms_board_game_offers
             (tenant_id, location_id, code, name, kind, percent_off, fixed_price, min_players,
              max_players, minimum_minutes, required_product_sku, valid_from, valid_until,
              weekdays, starts_local_time, ends_local_time, active, sort_order, note)
           VALUES ($1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           RETURNING ${OFFER_COLUMNS}`,
      params,
    );
    if (!result.rowCount) throw new Error("ไม่พบโปรโมชันที่ต้องการแก้ไข");
    await client.query("COMMIT");
    return mapOffer(result.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function localClock(at: Date, timezone: string): { weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdays[value("weekday")] ?? 0, time: `${value("hour")}:${value("minute")}` };
}

export function applyBestBoardGameOffer(
  lines: readonly BoardGameOfferChargeLine[],
  offers: readonly BoardGameOffer[],
  context: { at: Date; timezone: string; productSkus: ReadonlySet<string> },
): { lines: AppliedBoardGameOfferLine[]; total: number; offer: BoardGameOffer } | null {
  const grossTotal = money(lines.reduce((sum, line) => sum + line.grossAmount, 0));
  if (grossTotal <= 0 || !lines.length) return null;
  const clock = localClock(context.at, context.timezone);
  const eligible = offers.filter((offer) => {
    if (!offer.active || lines.length < offer.minPlayers || (offer.maxPlayers != null && lines.length > offer.maxPlayers)) return false;
    if (offer.minimumMinutes > 0 && lines.some((line) => line.billableMinutes < offer.minimumMinutes)) return false;
    if (offer.requiredProductSku && !context.productSkus.has(offer.requiredProductSku)) return false;
    if (offer.validFrom && context.at < new Date(offer.validFrom)) return false;
    if (offer.validUntil && context.at >= new Date(offer.validUntil)) return false;
    if (!offer.weekdays.includes(clock.weekday)) return false;
    if (offer.startsLocalTime && offer.endsLocalTime
      && (clock.time < offer.startsLocalTime || clock.time >= offer.endsLocalTime)) return false;
    return true;
  });

  let best: { lines: AppliedBoardGameOfferLine[]; total: number; offer: BoardGameOffer } | null = null;
  for (const offer of eligible) {
    let amounts: number[];
    if (offer.kind === "TIME_PERCENT") {
      amounts = lines.map((line) => money(line.grossAmount * (1 - Number(offer.percentOff) / 100)));
    } else if (offer.kind === "TIME_FIXED_PER_PERSON") {
      amounts = lines.map((line) => money(Math.min(line.grossAmount, Number(offer.fixedPrice))));
    } else {
      const target = money(Math.min(grossTotal, Number(offer.fixedPrice)));
      let allocated = 0;
      amounts = lines.map((line, index) => {
        const value = index === lines.length - 1
          ? money(target - allocated)
          : money(target * line.grossAmount / grossTotal);
        allocated = money(allocated + value);
        return value;
      });
    }
    const total = money(amounts.reduce((sum, value) => sum + value, 0));
    const applied = {
      offer,
      total,
      lines: lines.map((line, index) => ({
        amount: amounts[index],
        offerId: offer.id,
        offerCode: offer.code,
        offerName: offer.name,
        offerDiscountAmount: money(line.grossAmount - amounts[index]),
      })),
    };
    if (!best || total < best.total || (total === best.total && offer.sortOrder < best.offer.sortOrder)) best = applied;
  }
  return best;
}

export async function eligibleBoardGameOffersInTx(
  client: QueryClient,
  tenantId: string,
  billingGroupId: string,
): Promise<{ offers: BoardGameOffer[]; timezone: string; productSkus: Set<string> }> {
  const group = await client.query<{ location_id: string; timezone: string | null }>(
    `SELECT s.location_id, p.timezone
       FROM bms_board_game_billing_groups g
       JOIN bms_board_game_sessions s ON s.tenant_id = g.tenant_id AND s.id = g.session_id
       LEFT JOIN bms_board_game_public_locations p
         ON p.tenant_id = s.tenant_id AND p.location_id = s.location_id
      WHERE g.tenant_id = $1 AND g.id = $2`,
    [tenantId, billingGroupId],
  );
  if (!group.rowCount) throw new Error("ไม่พบกลุ่มบิล");
  const result = await client.query(
    `SELECT ${OFFER_COLUMNS}
       FROM bms_board_game_offers
      WHERE tenant_id = $1 AND active AND (location_id IS NULL OR location_id = $2)
      ORDER BY sort_order, name`,
    [tenantId, group.rows[0].location_id],
  );
  const products = await client.query<{ product_sku: string }>(
    `SELECT DISTINCT product_sku FROM bms_board_game_group_items
      WHERE tenant_id = $1 AND billing_group_id = $2 AND status = 'ACTIVE'`,
    [tenantId, billingGroupId],
  );
  return {
    offers: result.rows.map(mapOffer),
    timezone: group.rows[0].timezone || "Asia/Bangkok",
    productSkus: new Set(products.rows.map((row) => row.product_sku)),
  };
}
