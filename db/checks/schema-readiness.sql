-- สร้างจาก scripts/check-schema-readiness.mts --sql — อย่าแก้ไฟล์นี้ด้วยมือ
-- บนเซิร์ฟเวอร์:  docker compose ... exec -T postgres psql -U <user> -d <db> < readiness.sql
CREATE TEMP TABLE bms_schema_readiness AS
WITH required(migration, kind, tbl, col, impact) AS (VALUES
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
    ('9.57__bms_restaurant_order_line_cancellation.sql', 'column', 'bms_store_profile', 'restaurant_merchant_absorb_limit', 'ตัดรายการออกจากออร์เดอร์ออนไลน์ไม่ได้')
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
