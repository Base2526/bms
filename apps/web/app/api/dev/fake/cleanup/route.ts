// apps/web/app/api/dev/fake/cleanup/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled, resolveExistingTenantId } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import { deleteUnreferencedFakeUsers } from "@/lib/bms/devCleanup";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { deleteFakePharmacyAssessments } from "@/lib/bms/devPharmacySeed";

async function handleDELETE(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });
  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = await resolveExistingTenantId(body?.tenantId, guard.actor?.tenant_id);
    const fakeBoardGameReservationScope = `
      w.tenant_id = $1 AND (
        EXISTS (SELECT 1 FROM bms_board_game_sessions s
                 WHERE s.tenant_id = w.tenant_id AND s.id = w.seated_session_id
                   AND s.open_idempotency_key LIKE 'fake-open-%')
        OR EXISTS (SELECT 1 FROM bms_board_game_tables t
                   WHERE t.tenant_id = w.tenant_id
                     AND t.id IN (w.seated_table_id, w.reserved_table_id)
                     AND t.code LIKE 'FAKE-%')
        OR EXISTS (SELECT 1 FROM bms_board_game_areas a
                   WHERE a.tenant_id = w.tenant_id AND a.id = w.preferred_area_id
                     AND a.name LIKE 'FAKE %')
      )`;

    // posts/users เป็น fixtures ระดับระบบ (ไม่ใช่ BMS)
    // `posts` ไม่มีคอลัมน์ tenant_id เลย (มีแค่ author_id) — เดิมจึงลบข้ามร้านทุกครั้ง
    // scope ผ่าน author → users.tenant_id แทน · ต้องลบ posts ก่อน users เสมอ (ลำดับเดิมถูกอยู่แล้ว)
    // ไม่งั้น author หายไปก่อนแล้ว EXISTS จะ match ไม่เจอ
    // หมายเหตุ: fake post ที่ author_id เป็น NULL จะไม่ถูกลบ (ระบุร้านไม่ได้) — ยอมเหลือไว้ดีกว่าลบข้ามร้าน
    const resPosts = await query(
      `DELETE FROM posts p
        WHERE p.fake_test = true
          AND EXISTS (SELECT 1 FROM users u WHERE u.id = p.author_id AND u.tenant_id = $1)
        RETURNING p.id`,
      [tenantId]
    );
  // BMS fake data — marker: restock/customer_ref/order = 'FAKE-%', PO note 'FAKE%',
  //   supplier note 'FAKE%', products = SKU 'FAKE-%', customers = tag 'fake'
  // ลบตามลำดับ FK: restock + orders + conversations + PO ก่อน (cascade items/payments/shipments/messages/notes/deliveries)
  //   → suppliers → products (cascade inventory) → customers · ข้ามตัวที่ยังมีของอ้างถึง (กัน FK error)
  //   ทุก DELETE scope ด้วย tenant_id = ร้านของผู้ล็อกอิน
    // 10.2 links a reservation cash receipt to an internal tender on the eventual order. Unwind
    // those restrictive evidence links before deleting either the fake order or queue row.
    await query(
      `DELETE FROM bms_pos_refund_allocations allocation
        USING bms_payments applied, bms_payments source, bms_board_game_waitlist w
        WHERE allocation.tenant_id = $1
          AND applied.tenant_id = allocation.tenant_id AND applied.id = allocation.payment_id
          AND source.tenant_id = applied.tenant_id AND source.id = applied.source_payment_id
          AND w.tenant_id = source.tenant_id AND w.id = source.board_game_reservation_id
          AND ${fakeBoardGameReservationScope}`,
      [tenantId]
    );
    await query(
      `DELETE FROM bms_board_game_reservation_deposit_applications application
        USING bms_board_game_waitlist w
        WHERE application.tenant_id = $1
          AND w.tenant_id = application.tenant_id AND w.id = application.reservation_id
          AND ${fakeBoardGameReservationScope}`,
      [tenantId]
    );
    await query(
      `DELETE FROM bms_payments applied
        USING bms_payments source, bms_board_game_waitlist w
        WHERE applied.tenant_id = $1 AND applied.source_payment_id = source.id
          AND source.tenant_id = applied.tenant_id
          AND w.tenant_id = source.tenant_id AND w.id = source.board_game_reservation_id
          AND ${fakeBoardGameReservationScope}`,
      [tenantId]
    );
    await query(
      `UPDATE bms_board_game_waitlist w SET deposit_payment_id = NULL
        WHERE ${fakeBoardGameReservationScope} AND w.deposit_payment_id IS NOT NULL`,
      [tenantId]
    );
    await query(
      `DELETE FROM bms_payments source
        USING bms_board_game_waitlist w
        WHERE source.tenant_id = $1 AND source.payable_type = 'BOARD_GAME_RESERVATION'
          AND w.tenant_id = source.tenant_id AND w.id = source.board_game_reservation_id
          AND ${fakeBoardGameReservationScope}`,
      [tenantId]
    );
    const resBoardGameOrders = await query(
      `DELETE FROM bms_orders o
        WHERE o.tenant_id = $1
          AND EXISTS (
            SELECT 1 FROM bms_board_game_sessions s
            LEFT JOIN bms_board_game_tables t
              ON t.tenant_id = s.tenant_id AND t.id = s.table_id
             WHERE s.tenant_id = o.tenant_id AND s.id = o.board_game_session_id
               AND (s.open_idempotency_key LIKE 'fake-open-%' OR t.code LIKE 'FAKE-%')
          )
        RETURNING o.id`,
      [tenantId]
    );
    const resBoardGameWaitlist = await query(
      `DELETE FROM bms_board_game_waitlist w
        WHERE ${fakeBoardGameReservationScope}
        RETURNING w.id`,
      [tenantId]
    );
    const resBoardGameSessions = await query(
      `DELETE FROM bms_board_game_sessions s
        WHERE s.tenant_id = $1
          AND (
            s.open_idempotency_key LIKE 'fake-open-%'
            OR EXISTS (
              SELECT 1 FROM bms_board_game_tables t
               WHERE t.tenant_id = s.tenant_id AND t.id = s.table_id AND t.code LIKE 'FAKE-%'
            )
          )
        RETURNING s.id`,
      [tenantId]
    );
    const resBoardGameSeatings = await query(
      `DELETE FROM bms_board_game_seatings st
        WHERE st.tenant_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM bms_board_game_sessions s
             WHERE s.tenant_id = st.tenant_id AND s.seating_id = st.id
          )
          AND EXISTS (
            SELECT 1 FROM bms_board_game_tables t
             WHERE t.tenant_id = st.tenant_id AND t.id = st.table_id AND t.code LIKE 'FAKE-%'
          )
        RETURNING st.id`,
      [tenantId]
    );
    const resBoardGameProfiles = await query(
      `DELETE FROM bms_board_game_public_locations
        WHERE tenant_id = $1 AND public_visible = FALSE AND display_name LIKE 'FAKE %'
        RETURNING id`,
      [tenantId]
    );
    const resBoardGameCopies = await query(
      `DELETE FROM bms_board_game_copies WHERE tenant_id = $1 AND copy_code LIKE 'FAKE-%' RETURNING id`,
      [tenantId]
    );
    const resBoardGameTitles = await query(
      `DELETE FROM bms_board_game_titles WHERE tenant_id = $1 AND title LIKE 'FAKE %' RETURNING id`,
      [tenantId]
    );
    const resBoardGameTables = await query(
      `DELETE FROM bms_board_game_tables WHERE tenant_id = $1 AND code LIKE 'FAKE-%' RETURNING id`,
      [tenantId]
    );
    const resBoardGameAreas = await query(
      `DELETE FROM bms_board_game_areas WHERE tenant_id = $1 AND name LIKE 'FAKE %' RETURNING id`,
      [tenantId]
    );
    const resBoardGameRates = await query(
      `DELETE FROM bms_board_game_time_rates WHERE tenant_id = $1 AND code ~ '^FAKE_' RETURNING id`,
      [tenantId]
    );
    const resBoardGameIdempotency = await query(
      `DELETE FROM bms_board_game_idempotency_results
        WHERE tenant_id = $1 AND idempotency_key LIKE 'fake-%'
        RETURNING idempotency_key`,
      [tenantId]
    );
    const resRestock = await query(`DELETE FROM bms_restock_subscriptions WHERE customer_ref LIKE 'FAKE-%' AND tenant_id = $1 RETURNING id`, [tenantId]);
    const resOrders = await query(`DELETE FROM bms_orders WHERE customer_ref LIKE 'FAKE-%' AND tenant_id = $1 RETURNING id`, [tenantId]);
    const resConversations = await query(`DELETE FROM bms_conversations WHERE customer_ref LIKE 'FAKE-%' AND tenant_id = $1 RETURNING id`, [tenantId]);
    const resPosShifts = await query(`DELETE FROM bms_pos_shifts WHERE note LIKE 'FAKE%' AND tenant_id = $1 RETURNING id`, [tenantId]);
    // Fake pharmacy cases reference the seeded pharmacist with restrictive FKs.
    const resPharmacyAssessments = await deleteFakePharmacyAssessments(tenantId);
    const resUsers = await deleteUnreferencedFakeUsers(tenantId);
    const resEvalRuns = await query('DELETE FROM bms_fake_eval_runs WHERE tenant_id = $1 RETURNING id', [tenantId]);
    const resPO = await query(`DELETE FROM bms_purchase_orders WHERE note LIKE 'FAKE%' AND tenant_id = $1 RETURNING id`, [tenantId]);
    // coupons ไม่มี FK ผูกกับ order แบบ RESTRICT (bms_orders.coupon_id → ON DELETE SET NULL) ลบตรงได้เลย
    const resCoupons = await query(`DELETE FROM bms_coupons WHERE note LIKE 'FAKE%' AND tenant_id = $1 RETURNING id`, [tenantId]);
    const resSuppliers = await query(
      `DELETE FROM bms_suppliers s
        WHERE (s.name LIKE 'FAKE %' OR s.note LIKE 'FAKE%') AND s.tenant_id = $1
          AND NOT EXISTS (SELECT 1 FROM bms_purchase_orders po WHERE po.supplier_id = s.id)
        RETURNING s.id`,
      [tenantId]
    );
    const resProducts = await query(
      `DELETE FROM bms_products p
        WHERE p.sku LIKE 'FAKE-%' AND p.tenant_id = $1
          AND NOT EXISTS (SELECT 1 FROM bms_order_items oi WHERE oi.tenant_id = p.tenant_id AND oi.product_sku = p.sku)
          AND NOT EXISTS (SELECT 1 FROM bms_purchase_order_items pi WHERE pi.tenant_id = p.tenant_id AND pi.product_sku = p.sku)
        RETURNING p.sku`,
      [tenantId]
    );
    const resCustomers = await query(
      `DELETE FROM bms_customers c
        WHERE 'fake' = ANY(c.tags) AND c.tenant_id = $1
          AND NOT EXISTS (SELECT 1 FROM bms_orders o WHERE o.customer_id = c.id)
        RETURNING c.id`,
      [tenantId]
    );
    const resSupportTickets = await query(
      `DELETE FROM support_tickets WHERE ref LIKE 'FAKE-SUPPORT-%' RETURNING id`
    );

    const deleted =
      resPosts.rows.length + resUsers.deletedIds.length + resBoardGameOrders.rows.length + resBoardGameWaitlist.rows.length + resBoardGameSessions.rows.length +
      resBoardGameSeatings.rows.length + resBoardGameProfiles.rows.length + resBoardGameCopies.rows.length + resBoardGameTitles.rows.length +
      resBoardGameTables.rows.length + resBoardGameAreas.rows.length + resBoardGameRates.rows.length +
      resBoardGameIdempotency.rows.length + resRestock.rows.length + resOrders.rows.length + resConversations.rows.length +
      resPosShifts.rows.length + resPharmacyAssessments + resPO.rows.length + resCoupons.rows.length + resSuppliers.rows.length + resProducts.rows.length + resCustomers.rows.length +
      resSupportTickets.rows.length + resEvalRuns.rows.length;

    return NextResponse.json({
      ok: true,
      deleted,
      posts: resPosts.rows.length,
      users: resUsers.deletedIds.length,
      usersSkippedReferenced: resUsers.referencedIds.length,
      bmsBoardGameOrders: resBoardGameOrders.rows.length,
      bmsBoardGameWaitlist: resBoardGameWaitlist.rows.length,
      bmsBoardGameSessions: resBoardGameSessions.rows.length,
      bmsBoardGameSeatings: resBoardGameSeatings.rows.length,
      bmsBoardGameProfiles: resBoardGameProfiles.rows.length,
      bmsBoardGameCopies: resBoardGameCopies.rows.length,
      bmsBoardGameTitles: resBoardGameTitles.rows.length,
      bmsBoardGameTables: resBoardGameTables.rows.length,
      bmsBoardGameAreas: resBoardGameAreas.rows.length,
      bmsBoardGameRates: resBoardGameRates.rows.length,
      bmsBoardGameIdempotency: resBoardGameIdempotency.rows.length,
      bmsRestockSubscriptions: resRestock.rows.length,
      bmsOrders: resOrders.rows.length,
      bmsConversations: resConversations.rows.length,
      bmsPosShifts: resPosShifts.rows.length,
      bmsPharmacyAssessments: resPharmacyAssessments,
      bmsPurchaseOrders: resPO.rows.length,
      bmsCoupons: resCoupons.rows.length,
      bmsSuppliers: resSuppliers.rows.length,
      bmsProducts: resProducts.rows.length,
      bmsCustomers: resCustomers.rows.length,
      supportTickets: resSupportTickets.rows.length,
      fakeEvaluationRuns: resEvalRuns.rows.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "cleanup failed" }, { status: e?.message === "ไม่พบร้านที่เลือก" ? 400 : 500 });
  }
}

export const DELETE = withRouteErrorLog("DELETE /api/dev/fake/cleanup", handleDELETE);
