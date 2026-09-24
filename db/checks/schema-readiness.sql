-- สร้างจาก scripts/check-schema-readiness.mts --sql — อย่าแก้ไฟล์นี้ด้วยมือ
-- บนเซิร์ฟเวอร์:  docker compose ... exec -T postgres psql -U <user> -d <db> < readiness.sql
CREATE TEMP TABLE bms_schema_readiness AS
WITH required(migration, kind, tbl, col, impact) AS (VALUES
    ('10.13__bms_tax_leak_guards.sql', 'column', 'bms_order_items', 'line_amount', 'ขายไม่ได้ทุกช่องทาง และออกเอกสารภาษีไม่ได้ — บิลใหม่เขียน/อ่านยอดจริงระดับบรรทัด'),
    ('9.66__bms_restaurant_order_requests.sql', 'table', 'bms_restaurant_order_requests', NULL, 'แชทร้านอาหารรับคำขอก่อนตรวจสต็อกไม่ได้ และร้านเปิดคิวตรวจคำขอไม่ได้'),
    ('9.66__bms_restaurant_order_requests.sql', 'column', 'bms_orders', 'restaurant_request_instructions', 'แชทร้านอาหารรับคำขอก่อนตรวจสต็อกไม่ได้ และร้านเปิดคิวตรวจคำขอไม่ได้'),
    ('9.40__bms_multi_store_stock_capabilities.sql', 'table', 'bms_store_capabilities', NULL, 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder/POS อ่านรูปแบบสต็อกทุกบิล'),
    ('9.40__bms_multi_store_stock_capabilities.sql', 'table', 'bms_product_stock_policies', NULL, 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder/POS อ่านรูปแบบสต็อกทุกบิล'),
    ('9.40__bms_multi_store_stock_capabilities.sql', 'table', 'bms_product_recipes', NULL, 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder/POS อ่านรูปแบบสต็อกทุกบิล'),
    ('9.40__bms_multi_store_stock_capabilities.sql', 'table', 'bms_product_recipe_items', NULL, 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder/POS อ่านรูปแบบสต็อกทุกบิล'),
    ('9.40__bms_multi_store_stock_capabilities.sql', 'table', 'bms_product_modifiers', NULL, 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder/POS อ่านรูปแบบสต็อกทุกบิล'),
    ('9.40__bms_multi_store_stock_capabilities.sql', 'table', 'bms_order_item_stock_consumption', NULL, 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder/POS อ่านรูปแบบสต็อกทุกบิล'),
    ('9.40__bms_multi_store_stock_capabilities.sql', 'column', 'bms_order_items', 'stock_modifier_codes', 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder/POS อ่านรูปแบบสต็อกทุกบิล'),
    ('9.41__bms_weighted_product_scale_mapping.sql', 'column', 'bms_product_stock_policies', 'scale_item_code', 'สแกนบาร์โค้ดเครื่องชั่งไม่ได้'),
    ('9.44__bms_restaurant_pos.sql', 'table', 'bms_restaurant_areas', NULL, 'POS ร้านอาหารใช้ไม่ได้ทั้งหน้า (ผังโต๊ะ/บิลโต๊ะ/จอครัว)'),
    ('9.44__bms_restaurant_pos.sql', 'table', 'bms_restaurant_tables', NULL, 'POS ร้านอาหารใช้ไม่ได้ทั้งหน้า (ผังโต๊ะ/บิลโต๊ะ/จอครัว)'),
    ('9.44__bms_restaurant_pos.sql', 'table', 'bms_restaurant_checks', NULL, 'POS ร้านอาหารใช้ไม่ได้ทั้งหน้า (ผังโต๊ะ/บิลโต๊ะ/จอครัว)'),
    ('9.44__bms_restaurant_pos.sql', 'table', 'bms_restaurant_check_items', NULL, 'POS ร้านอาหารใช้ไม่ได้ทั้งหน้า (ผังโต๊ะ/บิลโต๊ะ/จอครัว)'),
    ('9.44__bms_restaurant_pos.sql', 'table', 'bms_restaurant_kitchen_tickets', NULL, 'POS ร้านอาหารใช้ไม่ได้ทั้งหน้า (ผังโต๊ะ/บิลโต๊ะ/จอครัว)'),
    ('9.44__bms_restaurant_pos.sql', 'column', 'bms_orders', 'restaurant_check_id', 'POS ร้านอาหารใช้ไม่ได้ทั้งหน้า (ผังโต๊ะ/บิลโต๊ะ/จอครัว)'),
    ('9.45__bms_restaurant_modifier_pricing_rbac.sql', 'column', 'bms_product_modifiers', 'price_delta', 'เพิ่มเมนูที่มีตัวเลือกลงบิลโต๊ะไม่ได้ (ราคาส่วนต่างของตัวเลือก)'),
    ('9.46__bms_support_diagnostics.sql', 'table', 'bms_support_events', NULL, 'จอ POS ส่ง diagnostics ไม่ได้ (ไม่บล็อกการขาย แต่ไล่ปัญหาไม่มีข้อมูล)'),
    ('9.46__bms_support_diagnostics.sql', 'table', 'bms_support_bundles', NULL, 'จอ POS ส่ง diagnostics ไม่ได้ (ไม่บล็อกการขาย แต่ไล่ปัญหาไม่มีข้อมูล)'),
    ('9.48__bms_restaurant_pos_settlement_claim.sql', 'column', 'bms_restaurant_checks', 'settlement_attempt_id', 'คิดเงินบิลโต๊ะไม่ได้ (จองสิทธิ์การรับชำระ)'),
    ('9.51__bms_product_catalog_foundation.sql', 'table', 'bms_product_variants', NULL, 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — ทุกบิลอ่านช่องทางขายของสินค้า'),
    ('9.51__bms_product_catalog_foundation.sql', 'table', 'bms_product_sales_surfaces', NULL, 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — ทุกบิลอ่านช่องทางขายของสินค้า'),
    ('9.51__bms_product_catalog_foundation.sql', 'table', 'bms_product_modifier_groups', NULL, 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — ทุกบิลอ่านช่องทางขายของสินค้า'),
    ('9.51__bms_product_catalog_foundation.sql', 'column', 'bms_product_modifiers', 'group_id', 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — ทุกบิลอ่านช่องทางขายของสินค้า'),
    ('9.53__bms_kitchen_station_sla.sql', 'table', 'bms_kitchen_station_slas', NULL, 'ตั้งเกณฑ์เวลาจอครัวไม่ได้'),
    ('9.54__bms_kitchen_station_master.sql', 'table', 'bms_kitchen_stations', NULL, 'บันทึกสินค้าไม่ได้ทั้งระบบ (readiness join ทะเบียนสถานี) + ส่งครัวไม่ได้'),
    ('9.54__bms_kitchen_station_master.sql', 'column', 'bms_product_stock_policies', 'kitchen_station_id', 'บันทึกสินค้าไม่ได้ทั้งระบบ (readiness join ทะเบียนสถานี) + ส่งครัวไม่ได้'),
    ('9.54__bms_kitchen_station_master.sql', 'column', 'bms_kitchen_tickets', 'station_id', 'บันทึกสินค้าไม่ได้ทั้งระบบ (readiness join ทะเบียนสถานี) + ส่งครัวไม่ได้'),
    ('9.54__bms_kitchen_station_master.sql', 'column', 'bms_restaurant_kitchen_tickets', 'station_id', 'บันทึกสินค้าไม่ได้ทั้งระบบ (readiness join ทะเบียนสถานี) + ส่งครัวไม่ได้'),
    ('9.55__bms_menu_temporary_unavailability.sql', 'table', 'bms_product_menu_unavailability', NULL, 'ค้นสินค้า/เช็คสต็อกล้มทั้งระบบ (ทุกร้าน) — เมนูร้านอาหารว่างเปล่า'),
    ('9.55__bms_menu_temporary_unavailability.sql', 'column', 'bms_store_profile', 'menu_availability_reset_time', 'ค้นสินค้า/เช็คสต็อกล้มทั้งระบบ (ทุกร้าน) — เมนูร้านอาหารว่างเปล่า'),
    ('9.56__bms_restaurant_online_order_acceptance.sql', 'column', 'bms_orders', 'fulfillment_type', 'สร้างบิลไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — INSERT bms_orders อ้างคอลัมน์นี้ทุกครั้ง'),
    ('9.56__bms_restaurant_online_order_acceptance.sql', 'column', 'bms_orders', 'promised_at', 'สร้างบิลไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — INSERT bms_orders อ้างคอลัมน์นี้ทุกครั้ง'),
    ('9.56__bms_restaurant_online_order_acceptance.sql', 'column', 'bms_store_profile', 'restaurant_order_hours', 'สร้างบิลไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — INSERT bms_orders อ้างคอลัมน์นี้ทุกครั้ง'),
    ('9.56__bms_restaurant_online_order_acceptance.sql', 'column', 'bms_store_profile', 'restaurant_orders_paused', 'สร้างบิลไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — INSERT bms_orders อ้างคอลัมน์นี้ทุกครั้ง'),
    ('9.57__bms_restaurant_order_line_cancellation.sql', 'column', 'bms_pos_returns', 'merchant_absorbed_amount', 'ตัดรายการออกจากออร์เดอร์ออนไลน์ไม่ได้'),
    ('9.57__bms_restaurant_order_line_cancellation.sql', 'column', 'bms_pos_return_items', 'cancellation_cause', 'ตัดรายการออกจากออร์เดอร์ออนไลน์ไม่ได้'),
    ('9.57__bms_restaurant_order_line_cancellation.sql', 'column', 'bms_store_profile', 'restaurant_merchant_absorb_limit', 'ตัดรายการออกจากออร์เดอร์ออนไลน์ไม่ได้'),
    ('9.61__bms_product_promotions_branch_scope.sql', 'column', 'bms_product_promotions', 'location_id', 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder อ่านโปรรายสาขาทุกบิล'),
    ('9.65__bms_product_price_tiers_branch_scope.sql', 'column', 'bms_product_price_tiers', 'location_id', 'ขายไม่ได้ทั้งระบบ (ทุกร้าน) — createOrder อ่านราคาส่งรายสาขาทุกบิล'),
    ('9.60__bms_restaurant_qr_ordering.sql', 'table', 'bms_restaurant_table_qr_tokens', NULL, 'ลูกค้าสแกน QR ที่โต๊ะสั่งอาหารไม่ได้ และเครื่องขายเปิดแท็บคำขอ QR ไม่ได้'),
    ('9.60__bms_restaurant_qr_ordering.sql', 'table', 'bms_restaurant_qr_sessions', NULL, 'ลูกค้าสแกน QR ที่โต๊ะสั่งอาหารไม่ได้ และเครื่องขายเปิดแท็บคำขอ QR ไม่ได้'),
    ('9.60__bms_restaurant_qr_ordering.sql', 'table', 'bms_restaurant_qr_submissions', NULL, 'ลูกค้าสแกน QR ที่โต๊ะสั่งอาหารไม่ได้ และเครื่องขายเปิดแท็บคำขอ QR ไม่ได้'),
    ('9.63__bms_restaurant_check_split_merge.sql', 'column', 'bms_restaurant_checks', 'split_group_no', 'แยกบิล/รวมบิลของโต๊ะไม่ได้ และเปิดบิลโต๊ะไม่ได้ (คิวรีอ่านคอลัมน์นี้เสมอ)'),
    ('9.64__bms_restaurant_waitlist.sql', 'table', 'bms_restaurant_waitlist', NULL, 'บัตรคิวหน้าร้านและการจองโต๊ะใช้ไม่ได้'),
    ('9.69__bms_restaurant_service_calls.sql', 'table', 'bms_restaurant_service_calls', NULL, 'ลูกค้ากดเรียกพนักงานจากโต๊ะไม่ได้ และแท็บเรียกพนักงานที่เครื่องขายพัง'),
    ('9.70__bms_realtime_outbox.sql', 'table', 'bms_realtime_outbox', NULL, 'รับของเข้าคลังจาก PO ไม่ได้ (ทั้งหลังบ้านและที่เครื่องขาย) — ทรานแซกชันล้มทั้งก้อน'),
    ('9.82__bms_board_game_pos_settlement.sql', 'column', 'bms_orders', 'board_game_session_id', 'ขายไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — createOrder INSERT คอลัมน์นี้ทุกบิล'),
    ('9.87__bms_restaurant_service_mode.sql', 'column', 'bms_orders', 'restaurant_service_mode', 'ขายไม่ได้ทั้งระบบ (createOrder INSERT ทุกบิล) และจอครัว/บิลโต๊ะร้านอาหารพังทั้งหน้า'),
    ('9.87__bms_restaurant_service_mode.sql', 'column', 'bms_restaurant_checks', 'service_mode', 'ขายไม่ได้ทั้งระบบ (createOrder INSERT ทุกบิล) และจอครัว/บิลโต๊ะร้านอาหารพังทั้งหน้า'),
    ('9.88__bms_inventory_operation_idempotency.sql', 'table', 'bms_inventory_operation_idempotency', NULL, 'โอนสต็อกและนับสต็อกจากเครื่องขาย native ล้มทุกครั้ง (หลังบ้านยังทำได้)'),
    ('9.89__bms_board_game_billing_groups.sql', 'column', 'bms_orders', 'board_game_billing_group_id', 'ขายไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — createOrder INSERT คอลัมน์นี้ทุกบิล'),
    ('9.89__bms_board_game_billing_groups.sql', 'table', 'bms_board_game_billing_groups', NULL, 'ขายไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — createOrder INSERT คอลัมน์นี้ทุกบิล'),
    ('9.89__bms_board_game_billing_groups.sql', 'column', 'bms_board_game_session_participants', 'billing_group_id', 'ขายไม่ได้ทั้งระบบ (ทุกร้าน ทุกช่องทาง) — createOrder INSERT คอลัมน์นี้ทุกบิล'),
    ('9.90__bms_board_game_group_tab_items.sql', 'table', 'bms_board_game_group_items', NULL, 'ร้านบอร์ดเกมเก็บเงินไม่ได้ทุกโต๊ะ — createOrder อ่านรายการบนบิลทุกครั้ง'),
    ('9.90__bms_board_game_group_tab_items.sql', 'column', 'bms_board_game_billing_groups', 'tab_amount', 'ร้านบอร์ดเกมเก็บเงินไม่ได้ทุกโต๊ะ — createOrder อ่านรายการบนบิลทุกครั้ง'),
    ('9.80__bms_board_game_cafe_core.sql', 'table', 'bms_board_game_tables', NULL, 'ร้านบอร์ดเกมใช้อะไรไม่ได้เลย — ตารางโต๊ะ/เวลา/คลังเกมยังไม่มีอยู่'),
    ('9.80__bms_board_game_cafe_core.sql', 'table', 'bms_board_game_sessions', NULL, 'ร้านบอร์ดเกมใช้อะไรไม่ได้เลย — ตารางโต๊ะ/เวลา/คลังเกมยังไม่มีอยู่'),
    ('9.80__bms_board_game_cafe_core.sql', 'table', 'bms_board_game_session_participants', NULL, 'ร้านบอร์ดเกมใช้อะไรไม่ได้เลย — ตารางโต๊ะ/เวลา/คลังเกมยังไม่มีอยู่'),
    ('9.80__bms_board_game_cafe_core.sql', 'table', 'bms_board_game_session_games', NULL, 'ร้านบอร์ดเกมใช้อะไรไม่ได้เลย — ตารางโต๊ะ/เวลา/คลังเกมยังไม่มีอยู่'),
    ('9.80__bms_board_game_cafe_core.sql', 'table', 'bms_board_game_titles', NULL, 'ร้านบอร์ดเกมใช้อะไรไม่ได้เลย — ตารางโต๊ะ/เวลา/คลังเกมยังไม่มีอยู่'),
    ('9.80__bms_board_game_cafe_core.sql', 'table', 'bms_board_game_copies', NULL, 'ร้านบอร์ดเกมใช้อะไรไม่ได้เลย — ตารางโต๊ะ/เวลา/คลังเกมยังไม่มีอยู่'),
    ('9.80__bms_board_game_cafe_core.sql', 'table', 'bms_board_game_idempotency_results', NULL, 'ร้านบอร์ดเกมใช้อะไรไม่ได้เลย — ตารางโต๊ะ/เวลา/คลังเกมยังไม่มีอยู่'),
    ('9.91__bms_board_game_seatings.sql', 'table', 'bms_board_game_seatings', NULL, 'ร้านบอร์ดเกมเปิดโต๊ะไม่ได้เลย — openBoardGameSession เขียน seating_id ทุกครั้ง'),
    ('9.91__bms_board_game_seatings.sql', 'column', 'bms_board_game_sessions', 'seating_id', 'ร้านบอร์ดเกมเปิดโต๊ะไม่ได้เลย — openBoardGameSession เขียน seating_id ทุกครั้ง'),
    ('9.92__bms_board_game_member_passes.sql', 'table', 'bms_board_game_pass_plans', NULL, 'ร้านบอร์ดเกมปิดบิลไม่ได้เลย — เส้นทางปิดบิลอ่านตารางแพ็กเกจทุกครั้ง'),
    ('9.92__bms_board_game_member_passes.sql', 'table', 'bms_board_game_member_passes', NULL, 'ร้านบอร์ดเกมปิดบิลไม่ได้เลย — เส้นทางปิดบิลอ่านตารางแพ็กเกจทุกครั้ง'),
    ('9.92__bms_board_game_member_passes.sql', 'table', 'bms_board_game_pass_ledger', NULL, 'ร้านบอร์ดเกมปิดบิลไม่ได้เลย — เส้นทางปิดบิลอ่านตารางแพ็กเกจทุกครั้ง'),
    ('9.93__bms_board_game_identity_holds.sql', 'table', 'bms_board_game_identity_holds', NULL, 'ร้านบอร์ดเกมปิดบิล/ยกเลิก/เปิดดูโต๊ะไม่ได้เลย — ด่านคืนบัตรอ่านตารางนี้ทุกครั้ง'),
    ('9.94__bms_board_game_branch_scope_and_identity_hardening.sql', 'column', 'bms_board_game_member_passes', 'location_id', 'ร้านบอร์ดเกมปิดบิล/เปิดหน้าแพ็กเกจไม่ได้ — โค้ดอ่านสาขา snapshot ของสิทธิ์ทุกครั้ง'),
    ('9.96__bms_board_game_service_calls.sql', 'table', 'bms_board_game_guest_tokens', NULL, 'ลิงก์เรียกพนักงานร้านบอร์ดเกมและคิวเรียกพนักงานที่เครื่องขายใช้ไม่ได้'),
    ('9.96__bms_board_game_service_calls.sql', 'table', 'bms_board_game_service_calls', NULL, 'ลิงก์เรียกพนักงานร้านบอร์ดเกมและคิวเรียกพนักงานที่เครื่องขายใช้ไม่ได้'),
    ('9.99__bms_board_game_waitlist.sql', 'table', 'bms_board_game_waitlist', NULL, 'จอ Board Game POS และคิวรอโต๊ะใช้ไม่ได้ — workspace อ่านกระดานคิวทุกครั้ง'),
    ('10.0__bms_board_game_advance_reservations.sql', 'column', 'bms_board_game_waitlist', 'kind', 'จอ Board Game POS ใช้ไม่ได้ — workspace อ่านคอลัมน์การจองทุกครั้ง'),
    ('10.0__bms_board_game_advance_reservations.sql', 'column', 'bms_board_game_waitlist', 'reserved_for', 'จอ Board Game POS ใช้ไม่ได้ — workspace อ่านคอลัมน์การจองทุกครั้ง'),
    ('10.0__bms_board_game_advance_reservations.sql', 'column', 'bms_board_game_waitlist', 'reserved_table_id', 'จอ Board Game POS ใช้ไม่ได้ — workspace อ่านคอลัมน์การจองทุกครั้ง'),
    ('10.1__bms_board_game_public_reservations.sql', 'column', 'bms_board_game_waitlist', 'source', 'จอ Board Game POS และหน้าขอจองออนไลน์ใช้ไม่ได้ — โค้ดอ่านสถานะคำขอ/แจ้งเตือนทุกครั้ง'),
    ('10.1__bms_board_game_public_reservations.sql', 'column', 'bms_board_game_waitlist', 'guest_email', 'จอ Board Game POS และหน้าขอจองออนไลน์ใช้ไม่ได้ — โค้ดอ่านสถานะคำขอ/แจ้งเตือนทุกครั้ง'),
    ('10.1__bms_board_game_public_reservations.sql', 'column', 'bms_board_game_waitlist', 'reminder_status', 'จอ Board Game POS และหน้าขอจองออนไลน์ใช้ไม่ได้ — โค้ดอ่านสถานะคำขอ/แจ้งเตือนทุกครั้ง'),
    ('10.1__bms_board_game_public_reservations.sql', 'column', 'bms_board_game_public_locations', 'booking_enabled', 'จอ Board Game POS และหน้าขอจองออนไลน์ใช้ไม่ได้ — โค้ดอ่านสถานะคำขอ/แจ้งเตือนทุกครั้ง'),
    ('10.2__bms_board_game_reservation_completion.sql', 'column', 'bms_board_game_waitlist', 'deposit_status', 'รับมัดจำ/หมดอายุคำขอ/แจ้งผลจองและคิดเงิน Board Game POS ใช้ไม่ได้'),
    ('10.2__bms_board_game_reservation_completion.sql', 'column', 'bms_board_game_waitlist', 'customer_locale', 'รับมัดจำ/หมดอายุคำขอ/แจ้งผลจองและคิดเงิน Board Game POS ใช้ไม่ได้'),
    ('10.2__bms_board_game_reservation_completion.sql', 'column', 'bms_board_game_public_locations', 'reservation_deposit_policy', 'รับมัดจำ/หมดอายุคำขอ/แจ้งผลจองและคิดเงิน Board Game POS ใช้ไม่ได้'),
    ('10.2__bms_board_game_reservation_completion.sql', 'column', 'bms_payments', 'payable_type', 'รับมัดจำ/หมดอายุคำขอ/แจ้งผลจองและคิดเงิน Board Game POS ใช้ไม่ได้'),
    ('10.2__bms_board_game_reservation_completion.sql', 'column', 'bms_payments', 'refunded_amount', 'รับมัดจำ/หมดอายุคำขอ/แจ้งผลจองและคิดเงิน Board Game POS ใช้ไม่ได้'),
    ('10.2__bms_board_game_reservation_completion.sql', 'table', 'bms_board_game_reservation_deposit_applications', NULL, 'รับมัดจำ/หมดอายุคำขอ/แจ้งผลจองและคิดเงิน Board Game POS ใช้ไม่ได้'),
    ('10.3__bms_board_game_offers.sql', 'table', 'bms_board_game_offers', NULL, 'ร้านบอร์ดเกมปิดบิลไม่ได้ — เส้นทางปิดบิลตรวจโปรโมชันค่าเวลาทุกครั้ง'),
    ('10.4__bms_board_game_pass_renewals.sql', 'table', 'bms_board_game_pass_renewals', NULL, 'หน้าจัดการแพ็กเกจสมาชิกและงานต่ออายุอัตโนมัติใช้ไม่ได้'),
    ('10.4__bms_board_game_pass_renewals.sql', 'table', 'bms_board_game_pass_renewal_runs', NULL, 'หน้าจัดการแพ็กเกจสมาชิกและงานต่ออายุอัตโนมัติใช้ไม่ได้'),
    ('10.4__bms_board_game_pass_renewals.sql', 'column', 'bms_board_game_member_passes', 'renewal_id', 'หน้าจัดการแพ็กเกจสมาชิกและงานต่ออายุอัตโนมัติใช้ไม่ได้'),
    ('10.4__bms_board_game_pass_renewals.sql', 'column', 'bms_payments', 'board_game_member_pass_id', 'หน้าจัดการแพ็กเกจสมาชิกและงานต่ออายุอัตโนมัติใช้ไม่ได้'),
    ('10.4__bms_board_game_pass_renewals.sql', 'column', 'bms_store_credit_ledger', 'board_game_member_pass_id', 'หน้าจัดการแพ็กเกจสมาชิกและงานต่ออายุอัตโนมัติใช้ไม่ได้'),
    ('10.5__bms_pos_offline_tenders.sql', 'column', 'bms_orders', 'pos_offline_tendered_at', 'ซิงก์รายการขายเงินสดออฟไลน์ไม่ได้ — settlement ต้องบันทึกเวลารับเงินและเวลาซิงก์พร้อมกัน'),
    ('10.5__bms_pos_offline_tenders.sql', 'column', 'bms_orders', 'pos_offline_synced_at', 'ซิงก์รายการขายเงินสดออฟไลน์ไม่ได้ — settlement ต้องบันทึกเวลารับเงินและเวลาซิงก์พร้อมกัน'),
    ('10.6__bms_board_game_receipt_evidence.sql', 'column', 'bms_board_game_session_participants', 'rate_code_snapshot', 'ร้านบอร์ดเกมเปิดโต๊ะ/เพิ่มผู้เล่น/เปิดรายละเอียดบิลไม่ได้ — โค้ดอ่านและเขียนป้ายเรท snapshot ทุกครั้ง'),
    ('10.6__bms_board_game_receipt_evidence.sql', 'column', 'bms_board_game_session_participants', 'rate_name_snapshot', 'ร้านบอร์ดเกมเปิดโต๊ะ/เพิ่มผู้เล่น/เปิดรายละเอียดบิลไม่ได้ — โค้ดอ่านและเขียนป้ายเรท snapshot ทุกครั้ง'),
    ('10.7__bms_board_game_flexible_groups.sql', 'column', 'bms_board_game_session_participants', 'time_mode', 'ร้านบอร์ดเกมเปิดโต๊ะ เพิ่มผู้เล่น ดูรายละเอียด หรือรวม/แยกกลุ่มบิลไม่ได้'),
    ('10.7__bms_board_game_flexible_groups.sql', 'column', 'bms_board_game_session_participants', 'planned_end_at', 'ร้านบอร์ดเกมเปิดโต๊ะ เพิ่มผู้เล่น ดูรายละเอียด หรือรวม/แยกกลุ่มบิลไม่ได้'),
    ('10.7__bms_board_game_flexible_groups.sql', 'column', 'bms_board_game_billing_groups', 'merged_into_group_id', 'ร้านบอร์ดเกมเปิดโต๊ะ เพิ่มผู้เล่น ดูรายละเอียด หรือรวม/แยกกลุ่มบิลไม่ได้'),
    ('10.10__bms_stock_movement_count_direction.sql', 'column', 'bms_stock_movements', 'direction', 'กดยืนยันผลการนับสต็อกไม่ได้ และรายงานสินค้าและวัตถุดิบเปิดไม่ได้ (การขายยังทำงานปกติ)')
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
  FROM bms_schema_readiness WHERE NOT ok;
