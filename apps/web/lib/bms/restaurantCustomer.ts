import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { RestaurantRequestRejection } from "./restaurantRequestPolicy";

async function restaurantLocation(tenantId: string, locationId: string) {
  const result = await query<{ id: string; name: string; branch_code: string | null }>(
    `SELECT location.id, location.name, location.branch_code
       FROM bms_locations location
       JOIN bms_store_profile profile ON profile.tenant_id = location.tenant_id
      WHERE location.tenant_id = $1 AND location.id = $2 AND location.active
        AND profile.business_archetype = 'restaurant'
      LIMIT 1`,
    [tenantId, locationId]
  );
  return result.rows[0] ?? null;
}

/** Customer-safe aggregate only: no table ids, party details, ticket names or operational notes. */
export async function getRestaurantCustomerAvailability(tenantId: string, locationId: string) {
  const location = await restaurantLocation(tenantId, locationId);
  if (!location) throw new RestaurantRequestRejection("ไม่พบสาขาร้านอาหารนี้");
  const [floor, queue, kitchen, sla] = await Promise.all([
    query<{ total_tables: string; available_tables: string; available_seats: string }>(
      `SELECT COUNT(*) FILTER (WHERE t.active AND NOT t.blocked)::text AS total_tables,
              COUNT(*) FILTER (
                WHERE t.active AND NOT t.blocked AND NOT EXISTS (
                  SELECT 1 FROM bms_restaurant_checks c
                   WHERE c.tenant_id = t.tenant_id AND c.table_id = t.id
                     AND c.status IN ('OPEN','CLOSING') AND c.service_mode = 'DINE_IN'
                )
              )::text AS available_tables,
              COALESCE(SUM(t.seats) FILTER (
                WHERE t.active AND NOT t.blocked AND NOT EXISTS (
                  SELECT 1 FROM bms_restaurant_checks c
                   WHERE c.tenant_id = t.tenant_id AND c.table_id = t.id
                     AND c.status IN ('OPEN','CLOSING') AND c.service_mode = 'DINE_IN'
                )
              ), 0)::text AS available_seats
         FROM bms_restaurant_tables t
        WHERE t.tenant_id = $1 AND t.location_id = $2`,
      [tenantId, locationId]
    ),
    query<{
      walk_in_parties: string; walk_in_guests: string;
      requested_reservations: string; accepted_reservations: string;
    }>(
      `SELECT (COUNT(*) FILTER (WHERE kind = 'WALK_IN'))::text AS walk_in_parties,
              COALESCE(SUM(party_size) FILTER (WHERE kind = 'WALK_IN'), 0)::text AS walk_in_guests,
              (COUNT(*) FILTER (WHERE kind = 'RESERVATION' AND status = 'REQUESTED'))::text
                AS requested_reservations,
              (COUNT(*) FILTER (WHERE kind = 'RESERVATION' AND status IN ('WAITING','CALLED')))::text
                AS accepted_reservations
         FROM bms_restaurant_waitlist
        WHERE tenant_id = $1 AND location_id = $2
          AND status IN ('REQUESTED','WAITING','CALLED')`,
      [tenantId, locationId]
    ),
    query<{
      in_progress_tickets: string; ready_tickets: string;
      oldest_in_progress_minutes: string | null; active_stations: string;
    }>(
      `SELECT (COUNT(*) FILTER (WHERE status IN ('NEW','PREPARING')))::text AS in_progress_tickets,
              (COUNT(*) FILTER (WHERE status = 'READY'))::text AS ready_tickets,
              FLOOR(EXTRACT(EPOCH FROM (
                now() - MIN(created_at) FILTER (WHERE status IN ('NEW','PREPARING'))
              )) / 60)::text AS oldest_in_progress_minutes,
              (COUNT(DISTINCT COALESCE(station_id::text, station, '__UNASSIGNED__'))
                FILTER (WHERE status IN ('NEW','PREPARING')))::text AS active_stations
         FROM (
           SELECT kt.created_at, kt.station_id, kt.station, kt.status
             FROM bms_kitchen_tickets kt
             JOIN bms_orders o ON o.tenant_id = kt.tenant_id AND o.id = kt.order_id
            WHERE kt.tenant_id = $1 AND o.location_id = $2
              AND kt.status IN ('NEW','PREPARING','READY')
           UNION ALL
           SELECT rt.created_at, rt.station_id, rt.station, rt.status
             FROM bms_restaurant_kitchen_tickets rt
             JOIN bms_restaurant_checks c ON c.tenant_id = rt.tenant_id AND c.id = rt.check_id
            WHERE rt.tenant_id = $1 AND c.location_id = $2
              AND rt.status IN ('NEW','PREPARING','READY')
         ) tickets`,
      [tenantId, locationId]
    ),
    query<{ warn_minutes: number | null; late_minutes: number | null }>(
      `SELECT MIN(sla.warn_minutes)::integer AS warn_minutes,
              MAX(sla.late_minutes)::integer AS late_minutes
         FROM bms_kitchen_station_slas sla
         JOIN bms_kitchen_stations station
           ON station.tenant_id = sla.tenant_id AND station.name = sla.station
        WHERE sla.tenant_id = $1 AND station.active
          AND (station.location_id IS NULL OR station.location_id = $2)`,
      [tenantId, locationId]
    ),
  ]);
  const f = floor.rows[0];
  const q = queue.rows[0];
  const k = kitchen.rows[0];
  const s = sla.rows[0];
  return {
    status: "OK" as const,
    branch: { name: location.name, branchCode: location.branch_code },
    observedAt: new Date().toISOString(),
    tables: {
      total: Number(f?.total_tables ?? 0),
      availableNow: Number(f?.available_tables ?? 0),
      availableSeatsNow: Number(f?.available_seats ?? 0),
    },
    queue: {
      walkInWaitingParties: Number(q?.walk_in_parties ?? 0),
      walkInWaitingGuests: Number(q?.walk_in_guests ?? 0),
      estimatedWaitMinutes: null,
    },
    reservations: {
      pendingStaffReview: Number(q?.requested_reservations ?? 0),
      acceptedUnseated: Number(q?.accepted_reservations ?? 0),
      note: "Accepted reservations are unseated bookings, not proof that those parties are physically waiting now.",
    },
    kitchen: {
      inProgressTickets: Number(k?.in_progress_tickets ?? 0),
      readyAwaitingServiceTickets: Number(k?.ready_tickets ?? 0),
      oldestInProgressTicketMinutes: k?.oldest_in_progress_minutes == null
        ? null
        : Math.max(0, Number(k.oldest_in_progress_minutes)),
      activeStations: Number(k?.active_stations ?? 0),
      configuredSlaMinutes: s?.late_minutes == null ? null : {
        warnFrom: Number(s.warn_minutes ?? 0),
        lateBy: Number(s.late_minutes),
      },
      estimatedPrepMinutes: null,
    },
    note: "Live aggregate only. Availability can change before staff seats or accepts a party. Walk-in queue and kitchen ticket counts do not prove a wait/preparation time because table fit, station capacity and dish mix are unknown.",
  };
}

export async function requestRestaurantReservation(input: {
  tenantId: string;
  locationId: string;
  customerId: string;
  partySize: number;
  desiredAt: string;
  note?: string | null;
}) {
  const partySize = input.partySize;
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 100) {
    throw new RestaurantRequestRejection("จำนวนลูกค้าต้องอยู่ระหว่าง 1–100 คน");
  }
  // Date.parse accepts local timestamps and even normalizes impossible calendar dates.
  // Require an explicit offset and a real date before consulting the server clock.
  const appointment = typeof input.desiredAt === "string" ? input.desiredAt : "";
  const isoWithZone = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
  const calendarDate = new Date(`${appointment.slice(0, 10)}T00:00:00Z`);
  if (!isoWithZone.test(appointment) || Number.isNaN(calendarDate.getTime()) ||
      calendarDate.toISOString().slice(0, 10) !== appointment.slice(0, 10)) {
    throw new RestaurantRequestRejection("เวลาที่ต้องการต้องเป็น ISO-8601 พร้อมเขตเวลาและวันที่ถูกต้อง");
  }
  const desiredAt = new Date(appointment);
  const now = Date.now();
  if (Number.isNaN(desiredAt.getTime()) || desiredAt.getTime() <= now + 15 * 60_000) {
    throw new RestaurantRequestRejection("เวลาที่ต้องการต้องเป็น ISO-8601 พร้อมเขตเวลา และช้ากว่าเวลาปัจจุบันอย่างน้อย 15 นาที");
  }
  if (desiredAt.getTime() > now + 180 * 24 * 60 * 60_000) {
    throw new RestaurantRequestRejection("ส่งคำขอจองล่วงหน้าได้ไม่เกิน 180 วัน");
  }
  const note = String(input.note ?? "").trim().slice(0, 300) || null;
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId);
    const locationResult = await client.query<{ id: string; name: string; branch_code: string | null }>(
      `SELECT location.id, location.name, location.branch_code
         FROM bms_locations location
         JOIN bms_store_profile profile ON profile.tenant_id = location.tenant_id
        WHERE location.tenant_id = $1 AND location.id = $2 AND location.active
          AND profile.business_archetype = 'restaurant'
        FOR SHARE OF location, profile`,
      [input.tenantId, input.locationId]
    );
    const location = locationResult.rows[0];
    if (!location) throw new RestaurantRequestRejection("ไม่พบสาขาร้านอาหารนี้");
    const customer = await client.query<{ name: string; phone: string | null }>(
      `SELECT name, phone FROM bms_customers
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR SHARE`,
      [input.tenantId, input.customerId]
    );
    if (!customer.rowCount) throw new RestaurantRequestRejection("ไม่พบตัวตนลูกค้าจากช่องทางนี้");
    const row = customer.rows[0];
    if (!row.phone?.trim()) throw new RestaurantRequestRejection("ข้อมูลติดต่อยังไม่ครบ: phone");
    const inserted = await client.query<{
      id: string; status: "REQUESTED" | "WAITING" | "CALLED";
      party_size: number; reserved_for: Date | string; created_at: Date | string;
    }>(
      `WITH service AS (
         SELECT ((($5::timestamptz AT TIME ZONE COALESCE(NULLIF(profile.timezone, ''), 'Asia/Bangkok'))
                   - COALESCE(profile.menu_availability_reset_time, TIME '04:00'))::date) AS service_date
           FROM bms_store_profile profile WHERE profile.tenant_id = $1
       )
       INSERT INTO bms_restaurant_waitlist
         (tenant_id, location_id, kind, status, service_date, reserved_for, party_size,
          guest_name, guest_phone, note, source, customer_id, created_by)
       SELECT $1, $2, 'RESERVATION', 'REQUESTED', service.service_date, $5, $3,
              NULLIF(btrim($6), ''), NULLIF(btrim($7), ''), $4, 'CUSTOMER_AI', $8, NULL
         FROM service
       ON CONFLICT (tenant_id, location_id, customer_id, reserved_for)
         WHERE source = 'CUSTOMER_AI' AND status IN ('REQUESTED','WAITING','CALLED')
       DO UPDATE SET updated_at = now()
         WHERE bms_restaurant_waitlist.party_size = EXCLUDED.party_size
           AND bms_restaurant_waitlist.note IS NOT DISTINCT FROM EXCLUDED.note
       RETURNING id, status, party_size, reserved_for, created_at`,
      [input.tenantId, input.locationId, partySize, note, desiredAt.toISOString(),
        row.name.slice(0, 120), row.phone?.slice(0, 40) ?? null, input.customerId]
    );
    const request = inserted.rows[0];
    if (!request) {
      throw new RestaurantRequestRejection("มีคำขอจองเวลานี้อยู่แล้วแต่จำนวนคนหรือหมายเหตุต่างกัน กรุณาติดต่อร้านเพื่อแก้ไขคำขอเดิม ยังไม่ได้บันทึกการเปลี่ยนแปลง");
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,'ai:customer','restaurant.reservation_request',$2,$3::jsonb)`,
      [input.tenantId, request.id, JSON.stringify({ locationId: input.locationId, partySize, desiredAt: desiredAt.toISOString() })]
    );
    await client.query("COMMIT");
    return {
      status: request.status,
      requestId: request.id,
      branch: { name: location.name, branchCode: location.branch_code },
      partySize: Number(request.party_size),
      desiredAt: request.reserved_for instanceof Date ? request.reserved_for.toISOString() : String(request.reserved_for),
      note: "This is a request only. Staff acceptance admits it to the reservation board; no table is assigned or guaranteed until seating.",
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function listCustomerRestaurantReservations(tenantId: string, customerId: string) {
  const result = await query<{
    id: string; status: string; reserved_for: Date | string; party_size: number;
    location_name: string; branch_code: string | null; created_at: Date | string;
  }>(
    `SELECT w.id, w.status, w.reserved_for, w.party_size,
            location.name AS location_name, location.branch_code, w.created_at
       FROM bms_restaurant_waitlist w
       JOIN bms_locations location ON location.tenant_id = w.tenant_id AND location.id = w.location_id
      WHERE w.tenant_id = $1 AND w.customer_id = $2 AND w.source = 'CUSTOMER_AI'
      ORDER BY w.created_at DESC
      LIMIT 5`,
    [tenantId, customerId]
  );
  return result.rows.map((row) => ({
    requestId: row.id,
    displayRequestId: row.id.slice(0, 8),
    status: row.status,
    desiredAt: row.reserved_for instanceof Date ? row.reserved_for.toISOString() : String(row.reserved_for),
    partySize: Number(row.party_size),
    branch: { name: row.location_name, branchCode: row.branch_code },
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}
