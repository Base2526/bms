// =============================================================
// ลิสต์ "สิ่งที่โค้ดชุดนี้ต้องมีในฐาน" — แหล่งความจริงชุดเดียว
// -------------------------------------------------------------
// ใช้โดยสองทาง: `scripts/check-schema-readiness.mts` (ต่อฐานแล้วตอบทันที) และไฟล์
// `db/checks/schema-readiness.sql` ที่ generate จากที่นี่สำหรับเซิร์ฟเวอร์ที่ **ไม่มี Node**
// (เจอจริง 2026-09-05: production ตอบว่า `npx: command not found`)
//
// ห้ามแก้ .sql ด้วยมือ — `scripts/schema-readiness-contract.test.mts` เทียบไฟล์กับตัวเรนเดอร์
// ทุกครั้งที่รัน gate ถ้าไม่ตรงจะแดง
// =============================================================

export type Need =
  | { kind: "table"; name: string }
  | { kind: "column"; table: string; name: string };

export type Migration = {
  file: string;
  /** พังยังไงถ้าไฟล์นี้ยังไม่ได้รัน — เขียนเป็นอาการที่คนหน้าร้านเจอ ไม่ใช่ชื่อ error */
  impact: string;
  needs: Need[];
};

// ครอบเฉพาะไฟล์ที่ "โค้ดปัจจุบันอ้างถึงแบบไม่มีเงื่อนไข" — ของเก่ากว่านี้ถ้าขาด ระบบจะพัง
// ตั้งแต่หน้าแรกจนเห็นเองอยู่แล้ว
export const MIGRATIONS: Migration[] = [
  {
    file: "10.14__bms_delivery_platform_hardening.sql",
    impact: "รับออเดอร์ delivery platform ไม่ได้อย่างปลอดภัย — แยกชนิดขนส่งและตรวจ config หลังเรียก provider ไม่ได้",
    needs: [
      { kind: "column", table: "bms_delivery_integrations", name: "config_version" },
      { kind: "column", table: "bms_delivery_orders", name: "transport_type" },
      { kind: "column", table: "bms_delivery_events", name: "provider_call_attempts" },
      { kind: "column", table: "bms_delivery_commands", name: "provider_call_attempts" },
    ],
  },
  {
    file: "10.13__bms_tax_leak_guards.sql",
    impact: "ขายไม่ได้ทุกช่องทาง และออกเอกสารภาษีไม่ได้ — บิลใหม่เขียน/อ่านยอดจริงระดับบรรทัด",
    needs: [{ kind: "column", table: "bms_order_items", name: "line_amount" }],
  },
  {
    file: '9.66__bms_restaurant_order_requests.sql',
    impact: 'แชทร้านอาหารรับคำขอก่อนตรวจสต็อกไม่ได้ และร้านเปิดคิวตรวจคำขอไม่ได้',
    needs: [{ kind: 'table', name: 'bms_restaurant_order_requests' },
      { kind: 'column', table: 'bms_orders', name: 'restaurant_request_instructions' }],
  },
  {
    file: "9.40__bms_multi_store_stock_capabilities.sql",
    impact: "ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder/POS อ่านรูปแบบสต็อกทุกบิล",
    needs: [
      { kind: "table", name: "bms_store_capabilities" },
      { kind: "table", name: "bms_product_stock_policies" },
      { kind: "table", name: "bms_product_recipes" },
      { kind: "table", name: "bms_product_recipe_items" },
      { kind: "table", name: "bms_product_modifiers" },
      { kind: "table", name: "bms_order_item_stock_consumption" },
      { kind: "column", table: "bms_order_items", name: "stock_modifier_codes" },
    ],
  },
  {
    file: "9.41__bms_weighted_product_scale_mapping.sql",
    impact: "สแกนบาร์โค้ดเครื่องชั่งไม่ได้",
    needs: [{ kind: "column", table: "bms_product_stock_policies", name: "scale_item_code" }],
  },
  {
    file: "9.44__bms_restaurant_pos.sql",
    impact: "POS ร้านอาหารใช้ไม่ได้ทั้งหน้า (ผังโต๊ะ/บิลโต๊ะ/จอครัว)",
    needs: [
      { kind: "table", name: "bms_restaurant_areas" },
      { kind: "table", name: "bms_restaurant_tables" },
      { kind: "table", name: "bms_restaurant_checks" },
      { kind: "table", name: "bms_restaurant_check_items" },
      { kind: "table", name: "bms_restaurant_kitchen_tickets" },
      { kind: "column", table: "bms_orders", name: "restaurant_check_id" },
    ],
  },
  {
    file: "9.45__bms_restaurant_modifier_pricing_rbac.sql",
    impact: "เพิ่มเมนูที่มีตัวเลือกลงบิลโต๊ะไม่ได้ (ราคาส่วนต่างของตัวเลือก)",
    needs: [{ kind: "column", table: "bms_product_modifiers", name: "price_delta" }],
  },
  {
    file: "9.46__bms_support_diagnostics.sql",
    impact: "จอ POS ส่ง diagnostics ไม่ได้ (ไม่บล็อกการขาย แต่ไล่ปัญหาไม่มีข้อมูล)",
    needs: [
      { kind: "table", name: "bms_support_events" },
      { kind: "table", name: "bms_support_bundles" },
    ],
  },
  {
    file: "9.48__bms_restaurant_pos_settlement_claim.sql",
    impact: "คิดเงินบิลโต๊ะไม่ได้ (จองสิทธิ์การรับชำระ)",
    needs: [{ kind: "column", table: "bms_restaurant_checks", name: "settlement_attempt_id" }],
  },
  {
    file: "9.51__bms_product_catalog_foundation.sql",
    impact: "ขายไม่ได้ทั้งระบบ (ทุกร้าน) — ทุกบิลอ่านช่องทางขายของสินค้า",
    needs: [
      { kind: "table", name: "bms_product_variants" },
      { kind: "table", name: "bms_product_sales_surfaces" },
      { kind: "table", name: "bms_product_modifier_groups" },
      { kind: "column", table: "bms_product_modifiers", name: "group_id" },
    ],
  },
  {
    file: "9.53__bms_kitchen_station_sla.sql",
    impact: "ตั้งเกณฑ์เวลาจอครัวไม่ได้",
    needs: [{ kind: "table", name: "bms_kitchen_station_slas" }],
  },
  {
    file: "9.54__bms_kitchen_station_master.sql",
    impact: "บันทึกสินค้าไม่ได้ทั้งระบบ (readiness join ทะเบียนสถานี) + ส่งครัวไม่ได้",
    needs: [
      { kind: "table", name: "bms_kitchen_stations" },
      { kind: "column", table: "bms_product_stock_policies", name: "kitchen_station_id" },
      { kind: "column", table: "bms_kitchen_tickets", name: "station_id" },
      { kind: "column", table: "bms_restaurant_kitchen_tickets", name: "station_id" },
    ],
  },
  {
    file: "9.55__bms_menu_temporary_unavailability.sql",
    impact: "ค้นสินค้า/เช็คสต็อกล้มทั้งระบบ (ทุกร้าน) — เมนูร้านอาหารว่างเปล่า",
    needs: [
      { kind: "table", name: "bms_product_menu_unavailability" },
      { kind: "column", table: "bms_store_profile", name: "menu_availability_reset_time" },
    ],
  },
  {
    file: "9.56__bms_restaurant_online_order_acceptance.sql",
    impact: "สร้างบิลไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — INSERT bms_orders อ้างคอลัมน์นี้ทุกครั้ง",
    needs: [
      { kind: "column", table: "bms_orders", name: "fulfillment_type" },
      { kind: "column", table: "bms_orders", name: "promised_at" },
      { kind: "column", table: "bms_store_profile", name: "restaurant_order_hours" },
      { kind: "column", table: "bms_store_profile", name: "restaurant_orders_paused" },
    ],
  },
  {
    file: "9.57__bms_restaurant_order_line_cancellation.sql",
    impact: "ตัดรายการออกจากออร์เดอร์ออนไลน์ไม่ได้",
    needs: [
      { kind: "column", table: "bms_pos_returns", name: "merchant_absorbed_amount" },
      { kind: "column", table: "bms_pos_return_items", name: "cancellation_cause" },
      { kind: "column", table: "bms_store_profile", name: "restaurant_merchant_absorb_limit" },
    ],
  },
  {
    // สองคอลัมน์นี้ถูก SELECT ใน `createOrderInTx()` แบบไม่มีเงื่อนไข = ทุกบิลของทุกร้าน
    // ฐานที่ขาดจึงขายไม่ได้ทั้งระบบ ไม่ใช่แค่ร้านที่ตั้งโปร/ราคาส่งรายสาขา
    file: "9.61__bms_product_promotions_branch_scope.sql",
    impact: "ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder อ่านโปรรายสาขาทุกบิล",
    needs: [{ kind: "column", table: "bms_product_promotions", name: "location_id" }],
  },
  {
    file: "9.65__bms_product_price_tiers_branch_scope.sql",
    impact: "ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder อ่านราคาส่งรายสาขาทุกบิล",
    needs: [{ kind: "column", table: "bms_product_price_tiers", name: "location_id" }],
  },
  {
    file: "9.60__bms_restaurant_qr_ordering.sql",
    impact: "ลูกค้าสแกน QR ที่โต๊ะสั่งอาหารไม่ได้ และเครื่องขายเปิดแท็บคำขอ QR ไม่ได้",
    needs: [
      { kind: "table", name: "bms_restaurant_table_qr_tokens" },
      { kind: "table", name: "bms_restaurant_qr_sessions" },
      { kind: "table", name: "bms_restaurant_qr_submissions" },
    ],
  },
  {
    file: "9.63__bms_restaurant_check_split_merge.sql",
    impact: "แยกบิล/รวมบิลของโต๊ะไม่ได้ และเปิดบิลโต๊ะไม่ได้ (คิวรีอ่านคอลัมน์นี้เสมอ)",
    needs: [{ kind: "column", table: "bms_restaurant_checks", name: "split_group_no" }],
  },
  {
    file: "9.64__bms_restaurant_waitlist.sql",
    impact: "บัตรคิวหน้าร้านและการจองโต๊ะใช้ไม่ได้",
    needs: [{ kind: "table", name: "bms_restaurant_waitlist" }],
  },
  {
    file: "9.69__bms_restaurant_service_calls.sql",
    impact: "ลูกค้ากดเรียกพนักงานจากโต๊ะไม่ได้ และแท็บเรียกพนักงานที่เครื่องขายพัง",
    needs: [{ kind: "table", name: "bms_restaurant_service_calls" }],
  },
  {
    // ตัวส่งเหตุการณ์ realtime เขียนลงตารางนี้ "ในทรานแซกชันเดียวกับงานธุรกิจ" แบบไม่มีเงื่อนไข
    // (`enqueueRealtimeEventInTx` ไม่มีธงและไม่ได้ห่อ try/catch) ตารางที่ขาดจึงไม่ได้แปลว่า
    // realtime เงียบ แต่แปลว่า **ทรานแซกชันนั้น rollback ทั้งก้อน**
    file: "9.70__bms_realtime_outbox.sql",
    impact: "รับของเข้าคลังจาก PO ไม่ได้ (ทั้งหลังบ้านและที่เครื่องขาย) — ทรานแซกชันล้มทั้งก้อน",
    needs: [{ kind: "table", name: "bms_realtime_outbox" }],
  },
  {
    // `createOrderInTx()` เขียนคอลัมน์นี้ใน INSERT ของ **ทุกบิลทุกช่องทางของทุกร้าน** และ
    // `finalizePosSale()` SELECT มันกลับมาทุกการขาย — ไม่มีกิ่งไหนข้ามได้ ฐานที่ขาดไฟล์นี้
    // จึง "ขายไม่ได้เลยสักใบ" ไม่ใช่ "ฟีเจอร์บอร์ดเกมใช้ไม่ได้" · ตัวตารางของโมดูลบอร์ดเกม
    // (`9.79`–`9.83`) จงใจไม่อยู่ในลิสต์ เพราะทุก query ของมันถูกกั้นด้วย `boardGameBillingGroupId`
    file: "9.82__bms_board_game_pos_settlement.sql",
    impact: "ขายไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — createOrder INSERT คอลัมน์นี้ทุกบิล",
    needs: [{ kind: "column", table: "bms_orders", name: "board_game_session_id" }],
  },
  {
    // เหตุผลเดียวกับ `9.82` สำหรับ `bms_orders.restaurant_service_mode` · ส่วน
    // `bms_restaurant_checks.service_mode` ถูกอ่านโดย `listKitchenTickets()` และทุก query
    // ของบิลโต๊ะ — ขาดแล้วจอครัวและ POS ร้านอาหารตายทั้งหน้า ไม่ใช่แค่โหมดรับกลับบ้าน
    file: "9.87__bms_restaurant_service_mode.sql",
    impact: "ขายไม่ได้ทั้งระบบ (createOrder INSERT ทุกบิล) และจอครัว/บิลโต๊ะร้านอาหารพังทั้งหน้า",
    needs: [
      { kind: "column", table: "bms_orders", name: "restaurant_service_mode" },
      { kind: "column", table: "bms_restaurant_checks", name: "service_mode" },
    ],
  },
  {
    // ทุก mutation โอน/นับสต็อกของเครื่องขาย native บังคับ `idempotencyKey: String!` แล้ว
    // `replayInventoryResult()` อ่านตารางนี้ **ก่อน** แตะสต็อก โดยไม่มีธงและไม่ได้ห่อ try/catch
    // → ฐานที่ไม่มีตารางได้ 42P01 แล้ว rollback ทั้งก้อนทุกครั้ง
    // · เส้น REST ของหลังบ้านไม่ส่งคีย์ จึงไม่แตะตารางนี้และไม่กระทบ
    file: "9.88__bms_inventory_operation_idempotency.sql",
    impact: "โอนสต็อกและนับสต็อกจากเครื่องขาย native ล้มทุกครั้ง (หลังบ้านยังทำได้)",
    needs: [{ kind: "table", name: "bms_inventory_operation_idempotency" }],
  },
  {
    // เหตุผลเดียวกับ `9.82` เป๊ะ ๆ: `createOrderInTx()` เพิ่มคอลัมน์นี้เข้าไปใน INSERT ของ
    // **ทุกบิลทุกช่องทางของทุกร้าน** และ `finalizePosSale()` SELECT มันกลับมาทุกการขาย
    // ฐานที่ขาดไฟล์นี้จึงขายไม่ได้เลยสักใบ ไม่ใช่แค่ฟีเจอร์บอร์ดเกมใช้ไม่ได้
    // · ตัวตาราง `bms_board_game_billing_groups` อยู่ในลิสต์ด้วย เพราะ `9.89` ย้ายเงินไปไว้ที่นั่น
    //   ทั้งหมด — เส้นทางปิดโต๊ะ/เก็บเงินอ่านตารางนี้เสมอเมื่อร้านเป็นบอร์ดเกม
    file: "9.89__bms_board_game_billing_groups.sql",
    impact: "ขายไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — createOrder INSERT คอลัมน์นี้ทุกบิล",
    needs: [
      { kind: "column", table: "bms_orders", name: "board_game_billing_group_id" },
      { kind: "table", name: "bms_board_game_billing_groups" },
      { kind: "column", table: "bms_board_game_session_participants", name: "billing_group_id" },
    ],
  },
  {
    // `createOrderInTx()` อ่านตารางนี้ทุกครั้งที่บิลมี `boardGameBillingGroupId` — ซึ่งคือ
    // ทุกการเก็บเงินของร้านบอร์ดเกม · และ `tab_amount` ถูกเขียนทุกครั้งที่มีของเข้าบิล
    // ฐานที่ขาดไฟล์นี้จึงเก็บเงินโต๊ะบอร์ดเกมไม่ได้เลยสักใบ (ร้านอื่นไม่กระทบ)
    file: "9.90__bms_board_game_group_tab_items.sql",
    impact: "ร้านบอร์ดเกมเก็บเงินไม่ได้ทุกโต๊ะ — createOrder อ่านรายการบนบิลทุกครั้ง",
    needs: [
      { kind: "table", name: "bms_board_game_group_items" },
      { kind: "column", table: "bms_board_game_billing_groups", name: "tab_amount" },
    ],
  },
  {
    // ตารางหลักของโมดูล — เส้นทางเปิด/อ่าน/ปิด/ยกเลิกโต๊ะอ่านมันทุกครั้ง · ฐานที่มี `9.89`-`9.94`
    // แต่ขาดไฟล์นี้เป็นไปไม่ได้ในทางปฏิบัติ (FK ของ `9.89` ชี้มาที่ session) แต่ลิสต์นี้ตอบคำถาม
    // "ฐานนี้รันโค้ดปัจจุบันได้ไหม" — การประกาศให้ครบไม่มีต้นทุน ส่วนการเว้นไว้ทำให้คำตอบไม่ครบ
    file: "9.80__bms_board_game_cafe_core.sql",
    impact: "ร้านบอร์ดเกมใช้อะไรไม่ได้เลย — ตารางโต๊ะ/เวลา/คลังเกมยังไม่มีอยู่",
    needs: [
      { kind: "table", name: "bms_board_game_tables" },
      { kind: "table", name: "bms_board_game_sessions" },
      { kind: "table", name: "bms_board_game_session_participants" },
      { kind: "table", name: "bms_board_game_session_games" },
      { kind: "table", name: "bms_board_game_titles" },
      { kind: "table", name: "bms_board_game_copies" },
      { kind: "table", name: "bms_board_game_idempotency_results" },
    ],
  },
  {
    // ⚠️ `9.91`–`9.94` มีรัศมีเท่ากับ `9.90` เป๊ะ ๆ — กั้นด้วย archetype เหมือนกัน แต่เมื่อร้าน
    // เป็นบอร์ดเกมแล้วทุกเส้นทางแตะมันทุกครั้ง · การเว้นไว้เพราะ "กั้นด้วย archetype แล้ว"
    // ทำให้ `db/checks/schema-readiness.sql` (ตัวเดียวที่รันบนเซิร์ฟเวอร์ production ได้ เพราะ
    // ที่นั่นไม่มี Node) ตอบว่า "พร้อม" กับฐานที่ apply ไม่ครบ แล้วร้านเปิดโต๊ะไม่ได้สักโต๊ะ —
    // ซึ่งเป็นสิ่งที่ CLAUDE.md เรียกว่า "แย่กว่าไม่มีตัวตรวจเลย"
    file: "9.91__bms_board_game_seatings.sql",
    impact: "ร้านบอร์ดเกมเปิดโต๊ะไม่ได้เลย — openBoardGameSession เขียน seating_id ทุกครั้ง",
    needs: [
      { kind: "table", name: "bms_board_game_seatings" },
      { kind: "column", table: "bms_board_game_sessions", name: "seating_id" },
    ],
  },
  {
    // ปิดบิลทุกกลุ่มล็อกและอ่านแพ็กเกจก่อนคิดยอดเสมอ (`closeOpenBillingGroupInTx`)
    // ไม่ว่าสมาชิกคนนั้นจะถือแพ็กเกจหรือไม่
    file: "9.92__bms_board_game_member_passes.sql",
    impact: "ร้านบอร์ดเกมปิดบิลไม่ได้เลย — เส้นทางปิดบิลอ่านตารางแพ็กเกจทุกครั้ง",
    needs: [
      { kind: "table", name: "bms_board_game_pass_plans" },
      { kind: "table", name: "bms_board_game_member_passes" },
      { kind: "table", name: "bms_board_game_pass_ledger" },
    ],
  },
  {
    // ด่าน "คืนบัตรก่อนจบโต๊ะ" อ่านตารางนี้ที่ทางออกทั้งสามของโต๊ะ และ getBoardGameSession
    // อ่านมันทุกครั้งที่เปิดการ์ดโต๊ะ
    file: "9.93__bms_board_game_identity_holds.sql",
    impact: "ร้านบอร์ดเกมปิดบิล/ยกเลิก/เปิดดูโต๊ะไม่ได้เลย — ด่านคืนบัตรอ่านตารางนี้ทุกครั้ง",
    needs: [{ kind: "table", name: "bms_board_game_identity_holds" }],
  },
  {
    // close-for-billing อ่าน location_id ของสิทธิ์ทุกใบเพื่อบังคับว่าใช้ได้ในสาขาของกลุ่มนั้น
    // และหน้าแพ็กเกจอ่านคอลัมน์นี้เพื่อกรองข้อมูลตามสาขาที่ผู้ใช้ดูแล
    file: "9.94__bms_board_game_branch_scope_and_identity_hardening.sql",
    impact: "ร้านบอร์ดเกมปิดบิล/เปิดหน้าแพ็กเกจไม่ได้ — โค้ดอ่านสาขา snapshot ของสิทธิ์ทุกครั้ง",
    needs: [{ kind: "column", table: "bms_board_game_member_passes", name: "location_id" }],
  },
  {
    // หน้าแขกและทั้งสองเครื่องขายอ่านสองตารางนี้โดยตรง ไม่มี feature probe ระหว่าง request
    // ฐานที่ขาด 9.96 จึงไม่ได้แค่ไม่มี badge แต่ route/GraphQL ล้มทันที
    file: "9.96__bms_board_game_service_calls.sql",
    impact: "ลิงก์เรียกพนักงานร้านบอร์ดเกมและคิวเรียกพนักงานที่เครื่องขายใช้ไม่ได้",
    needs: [
      { kind: "table", name: "bms_board_game_guest_tokens" },
      { kind: "table", name: "bms_board_game_service_calls" },
    ],
  },
  {
    // workspace ของทั้งสองเครื่องขายอ่านกระดานคิวทุกครั้ง และเส้นพาไปนั่งเขียน session + คิว
    // ในทรานแซกชันเดียว ฐานที่ไม่มีตารางนี้จึงเปิดจอ Board Game ไม่ได้เลย
    file: "9.99__bms_board_game_waitlist.sql",
    impact: "จอ Board Game POS และคิวรอโต๊ะใช้ไม่ได้ — workspace อ่านกระดานคิวทุกครั้ง",
    needs: [{ kind: "table", name: "bms_board_game_waitlist" }],
  },
  {
    // workspace อ่านชนิดและเวลาจองทุกครั้งหลัง 10.0 แม้ร้านจะยังไม่มี reservation สักแถว
    file: "10.0__bms_board_game_advance_reservations.sql",
    impact: "จอ Board Game POS ใช้ไม่ได้ — workspace อ่านคอลัมน์การจองทุกครั้ง",
    needs: [
      { kind: "column", table: "bms_board_game_waitlist", name: "kind" },
      { kind: "column", table: "bms_board_game_waitlist", name: "reserved_for" },
      { kind: "column", table: "bms_board_game_waitlist", name: "reserved_table_id" },
    ],
  },
  {
    // workspace อ่าน source/reminder ทุกครั้ง และ public directory อ่าน booking_enabled ทุกครั้ง
    file: "10.1__bms_board_game_public_reservations.sql",
    impact: "จอ Board Game POS และหน้าขอจองออนไลน์ใช้ไม่ได้ — โค้ดอ่านสถานะคำขอ/แจ้งเตือนทุกครั้ง",
    needs: [
      { kind: "column", table: "bms_board_game_waitlist", name: "source" },
      { kind: "column", table: "bms_board_game_waitlist", name: "guest_email" },
      { kind: "column", table: "bms_board_game_waitlist", name: "reminder_status" },
      { kind: "column", table: "bms_board_game_public_locations", name: "booking_enabled" },
    ],
  },
  {
    // POS, public status, payment review and reports all read these fields unconditionally.
    file: "10.2__bms_board_game_reservation_completion.sql",
    impact: "รับมัดจำ/หมดอายุคำขอ/แจ้งผลจองและคิดเงิน Board Game POS ใช้ไม่ได้",
    needs: [
      { kind: "column", table: "bms_board_game_waitlist", name: "deposit_status" },
      { kind: "column", table: "bms_board_game_waitlist", name: "customer_locale" },
      { kind: "column", table: "bms_board_game_public_locations", name: "reservation_deposit_policy" },
      { kind: "column", table: "bms_payments", name: "payable_type" },
      { kind: "column", table: "bms_payments", name: "refunded_amount" },
      { kind: "table", name: "bms_board_game_reservation_deposit_applications" },
    ],
  },
  {
    // Every board-game group close evaluates automatic offers before freezing the charge.
    file: "10.3__bms_board_game_offers.sql",
    impact: "ร้านบอร์ดเกมปิดบิลไม่ได้ — เส้นทางปิดบิลตรวจโปรโมชันค่าเวลาทุกครั้ง",
    needs: [{ kind: "table", name: "bms_board_game_offers" }],
  },
  {
    // The pass screen loads renewal agreements together with the pass catalogue.
    file: "10.4__bms_board_game_pass_renewals.sql",
    impact: "หน้าจัดการแพ็กเกจสมาชิกและงานต่ออายุอัตโนมัติใช้ไม่ได้",
    needs: [
      { kind: "table", name: "bms_board_game_pass_renewals" },
      { kind: "table", name: "bms_board_game_pass_renewal_runs" },
      { kind: "column", table: "bms_board_game_member_passes", name: "renewal_id" },
      { kind: "column", table: "bms_payments", name: "board_game_member_pass_id" },
      { kind: "column", table: "bms_store_credit_ledger", name: "board_game_member_pass_id" },
    ],
  },
  {
    // Offline cash settlement stamps both fields in the same transaction as payment, stock and tax.
    file: "10.5__bms_pos_offline_tenders.sql",
    impact: "ซิงก์รายการขายเงินสดออฟไลน์ไม่ได้ — settlement ต้องบันทึกเวลารับเงินและเวลาซิงก์พร้อมกัน",
    needs: [
      { kind: "column", table: "bms_orders", name: "pos_offline_tendered_at" },
      { kind: "column", table: "bms_orders", name: "pos_offline_synced_at" },
    ],
  },
  {
    // เปิด session และเพิ่มผู้เล่นเขียนป้ายเรท snapshot ทุกครั้ง ส่วนหน้ารายละเอียด/checkout
    // อ่านมันเพื่ออธิบายบิลโดยไม่ย้อนกลับไปใช้ชื่อเรทปัจจุบัน · วางต่อจาก 10.5 เพื่อให้
    // check-schema-readiness แนะนำลำดับ apply 10.4 → 10.5 → 10.6 อย่างถูกต้อง
    file: "10.6__bms_board_game_receipt_evidence.sql",
    impact: "ร้านบอร์ดเกมเปิดโต๊ะ/เพิ่มผู้เล่น/เปิดรายละเอียดบิลไม่ได้ — โค้ดอ่านและเขียนป้ายเรท snapshot ทุกครั้ง",
    needs: [
      { kind: "column", table: "bms_board_game_session_participants", name: "rate_code_snapshot" },
      { kind: "column", table: "bms_board_game_session_participants", name: "rate_name_snapshot" },
    ],
  },
  {
    // เปิด/อ่าน/คิดเงินผู้เล่นทุกคนแตะเวลารายคน และทุกหน้ารายละเอียดกรองกลุ่มที่รวมแล้ว
    // โดยตรง จึงไม่มีทางเปิด feature บางส่วนเพื่อข้าม migration นี้อย่างซื่อตรงได้
    file: "10.7__bms_board_game_flexible_groups.sql",
    impact: "ร้านบอร์ดเกมเปิดโต๊ะ เพิ่มผู้เล่น ดูรายละเอียด หรือรวม/แยกกลุ่มบิลไม่ได้",
    needs: [
      { kind: "column", table: "bms_board_game_session_participants", name: "time_mode" },
      { kind: "column", table: "bms_board_game_session_participants", name: "planned_end_at" },
      { kind: "column", table: "bms_board_game_billing_groups", name: "merged_into_group_id" },
    ],
  },
  {
    // เขียนเฉพาะตอนปรับยอดจากการนับ (movements.ts ส่งคอลัมน์นี้เฉพาะแถวที่มีค่า)
    // รายงานสินค้าและวัตถุดิบก็อ่านคอลัมน์นี้ทุกครั้ง
    file: "10.10__bms_stock_movement_count_direction.sql",
    impact: "กดยืนยันผลการนับสต็อกไม่ได้ และรายงานสินค้าและวัตถุดิบเปิดไม่ได้ (การขายยังทำงานปกติ)",
    needs: [{ kind: "column", table: "bms_stock_movements", name: "direction" }],
  },
];

/** เรนเดอร์ตัวตรวจเป็น SQL ล้วน — ไม่ต่อฐาน ไม่ต้องมี env */
export function renderReadinessSql(): string {
  const lit = (value: string | null) => (value == null ? "NULL" : `'${value.replace(/'/g, "''")}'`);
  const rows: string[] = [];
  for (const migration of MIGRATIONS) {
    for (const need of migration.needs) {
      rows.push(`    (${lit(migration.file)}, ${lit(need.kind)}, `
        + `${lit(need.kind === "table" ? need.name : need.table)}, `
        + `${lit(need.kind === "column" ? need.name : null)}, ${lit(migration.impact)})`);
    }
  }
  return `-- สร้างจาก scripts/check-schema-readiness.mts --sql — อย่าแก้ไฟล์นี้ด้วยมือ
-- บนเซิร์ฟเวอร์:  docker compose ... exec -T postgres psql -U <user> -d <db> < readiness.sql
CREATE TEMP TABLE bms_schema_readiness AS
WITH required(migration, kind, tbl, col, impact) AS (VALUES
${rows.join(",\n")}
)
SELECT r.*,
       CASE WHEN r.kind = 'table' THEN to_regclass('public.' || r.tbl) IS NOT NULL
            -- คอลัมน์ของตารางที่ยังไม่มี ไม่ต้องรายงานซ้ำ — แถวของตารางรายงานไปแล้ว
            ELSE to_regclass('public.' || r.tbl) IS NULL
                 OR EXISTS (SELECT 1 FROM information_schema.columns c
                             WHERE c.table_schema = 'public' AND c.table_name = r.tbl
                               AND c.column_name = r.col)
       END AS ok
  FROM required r;

SELECT migration AS "ไฟล์ที่ยังไม่ได้รัน",
       CASE WHEN kind = 'table' THEN 'ไม่มีตาราง ' || tbl
            ELSE 'ไม่มีคอลัมน์ ' || tbl || '.' || col END AS "ของที่ขาด",
       impact AS "ผลถ้าไม่รัน"
  FROM bms_schema_readiness WHERE NOT ok ORDER BY migration, tbl, col;

SELECT CASE WHEN count(*) = 0
            THEN 'ครบ — อาการ 500 ที่เจอไม่ได้มาจาก migration ที่ขาด ให้ไปดูสาเหตุอื่น'
            ELSE 'ขาด ' || count(DISTINCT migration) || ' ไฟล์ — รันตามลำดับเลข: '
                 || string_agg(DISTINCT 'db/migrations/' || migration, ', ')
       END AS "สรุป"
  FROM bms_schema_readiness WHERE NOT ok;`;
}
