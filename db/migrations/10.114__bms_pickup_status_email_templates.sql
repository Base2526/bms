-- 10.114  Restaurant pickup emails use the persisted fulfillment type.
-- Apply before deploying the orderEmailTemplateKey() caller. Re-running keeps any
-- later operator-published template version intact.
-- ROLLBACK: deploy the prior caller first; leave published templates as history.

INSERT INTO email_templates
  (key, locale, version, is_active, is_published, subject_tpl, html_tpl, text_tpl)
VALUES
  ('order.pickup.paid', 'th', 1, true, true,
   'รับชำระเงินแล้ว · ออร์เดอร์รับเอง #{{order_ref}} — {{store_name}}',
   '<p>สวัสดีคุณ{{customer_name}}, {{store_name}} รับชำระเงินสำหรับออร์เดอร์ #{{order_ref}} แล้ว</p><p>ทางร้านกำลังดำเนินการตามรายการรับเอง{{#pickup_location_name}}ที่ {{pickup_location_name}}{{/pickup_location_name}} การชำระเงินยังไม่ได้หมายความว่าสินค้าพร้อมรับ</p>',
   'รับชำระเงินสำหรับออร์เดอร์รับเอง #{{order_ref}} แล้ว ทางร้านกำลังดำเนินการตามรายการ การชำระเงินยังไม่ได้หมายความว่าสินค้าพร้อมรับ{{#pickup_location_name}}ที่ {{pickup_location_name}}{{/pickup_location_name}} — {{store_name}}'),
  ('order.pickup.paid', 'en', 1, true, true,
   'Payment received · Pickup order #{{order_ref}} — {{store_name}}',
   '<p>Hi {{customer_name}}, {{store_name}} has received payment for pickup order #{{order_ref}}.</p><p>We are processing your order{{#pickup_location_name}} at {{pickup_location_name}}{{/pickup_location_name}}. Payment does not mean it is ready to collect.</p>',
   'Payment received for pickup order #{{order_ref}}. We are processing it; payment does not mean it is ready to collect{{#pickup_location_name}} at {{pickup_location_name}}{{/pickup_location_name}} — {{store_name}}'),

  ('order.pickup.packing', 'th', 1, true, true,
   'กำลังเตรียมออร์เดอร์รับเอง #{{order_ref}} — {{store_name}}',
   '<p>สวัสดีคุณ{{customer_name}}, {{store_name}} กำลังเตรียมออร์เดอร์ #{{order_ref}}{{#pickup_location_name}} ที่ {{pickup_location_name}}{{/pickup_location_name}}</p><p>โปรดรอการยืนยันจากร้านก่อนเดินทางมารับ</p>',
   'กำลังเตรียมออร์เดอร์รับเอง #{{order_ref}}{{#pickup_location_name}} ที่ {{pickup_location_name}}{{/pickup_location_name}} โปรดรอการยืนยันจากร้านก่อนมารับ — {{store_name}}'),
  ('order.pickup.packing', 'en', 1, true, true,
   'Preparing pickup order #{{order_ref}} — {{store_name}}',
   '<p>Hi {{customer_name}}, {{store_name}} is preparing pickup order #{{order_ref}}{{#pickup_location_name}} at {{pickup_location_name}}{{/pickup_location_name}}.</p><p>Please wait for the shop to confirm when to collect it.</p>',
   'Preparing pickup order #{{order_ref}}{{#pickup_location_name}} at {{pickup_location_name}}{{/pickup_location_name}}. Please wait for collection confirmation — {{store_name}}'),

  ('order.pickup.shipped', 'th', 1, true, true,
   'ส่งมอบออร์เดอร์รับเอง #{{order_ref}} แล้ว — {{store_name}}',
   '<p>สวัสดีคุณ{{customer_name}}, {{store_name}} บันทึกการส่งมอบออร์เดอร์ #{{order_ref}}{{#pickup_location_name}} ที่ {{pickup_location_name}}{{/pickup_location_name}} แล้ว</p>',
   'บันทึกการส่งมอบออร์เดอร์รับเอง #{{order_ref}}{{#pickup_location_name}} ที่ {{pickup_location_name}}{{/pickup_location_name}} แล้ว — {{store_name}}'),
  ('order.pickup.shipped', 'en', 1, true, true,
   'Pickup order #{{order_ref}} handed over — {{store_name}}',
   '<p>Hi {{customer_name}}, {{store_name}} has recorded the handover of pickup order #{{order_ref}}{{#pickup_location_name}} at {{pickup_location_name}}{{/pickup_location_name}}.</p>',
   'Pickup order #{{order_ref}} was recorded as handed over{{#pickup_location_name}} at {{pickup_location_name}}{{/pickup_location_name}} — {{store_name}}'),

  ('order.pickup.completed', 'th', 1, true, true,
   'ออร์เดอร์รับเอง #{{order_ref}} เสร็จสมบูรณ์ — {{store_name}}',
   '<p>สวัสดีคุณ{{customer_name}}, ออร์เดอร์รับเอง #{{order_ref}} ของ {{store_name}} เสร็จสมบูรณ์แล้ว ขอบคุณที่ใช้บริการ</p>',
   'ออร์เดอร์รับเอง #{{order_ref}} เสร็จสมบูรณ์แล้ว — {{store_name}}'),
  ('order.pickup.completed', 'en', 1, true, true,
   'Pickup order #{{order_ref}} complete — {{store_name}}',
   '<p>Hi {{customer_name}}, pickup order #{{order_ref}} from {{store_name}} is complete. Thank you.</p>',
   'Pickup order #{{order_ref}} is complete — {{store_name}}')
ON CONFLICT (key, locale, version) DO NOTHING;
