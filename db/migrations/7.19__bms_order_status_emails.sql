-- =============================================================
-- 7.19  Order status notification emails — seed email_templates
-- -------------------------------------------------------------
-- ตาม feature ใหม่: แจ้งลูกค้าทางอีเมลเมื่อสถานะออร์เดอร์เปลี่ยน (PAID/PACKING/
-- SHIPPED/COMPLETED/CANCELLED/RETURNED) — เดิม sendEmail() ใช้แค่ตอน verify
-- สมัครสมาชิกเท่านั้น ไม่มีในโดเมน order เลย
--
-- ใช้ตาราง email_templates เดิม (1.21) ไม่สร้างตารางใหม่ — key ใหม่ 6 ตัวตาม
-- convention เดิม "<domain>.<event>" (เทียบ auth.verify/auth.reset):
--   order.paid / order.packing / order.shipped / order.completed /
--   order.cancelled / order.returned
-- seed ทั้ง locale "th" และ "en" (getLatestEmailTemplate fallback ไป "en" เสมอ
-- ถ้า locale ที่ขอไม่มี — seed "en" ไว้ด้วยกันพลาดกรณี customer.preferred_language
-- ไม่ใช่ "th")
--
-- ตัวแปรที่ render() รับ (ดู lib/bms/orderNotify.ts): app_name, year,
-- support_url, store_name, store_logo_url, order_ref, customer_name, currency,
-- total, items[] ({name,size,qty,unit_price,line_total}), tracking_no, carrier
-- (มีเฉพาะ order.shipped)
--
-- ไม่มี tenant_id ในตารางนี้ (global ทั้งระบบ ตาม 1.21) — personalize ต่อร้าน
-- ด้วยตัวแปร {{store_name}}/{{store_logo_url}} ที่ query ตอน render แทน
-- =============================================================

INSERT INTO email_templates (key, locale, version, is_active, is_published, subject_tpl, html_tpl, text_tpl)
VALUES
-- ---- order.paid ----
('order.paid', 'th', 1, true, true,
 'ได้รับการชำระเงินแล้ว · ออร์เดอร์ #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#1a7f37">ได้รับการชำระเงินแล้ว ✅</h2>
<p>สวัสดีคุณ{{customer_name}}, ทาง {{store_name}} ได้รับการชำระเงินสำหรับออร์เดอร์ #{{order_ref}} เรียบร้อยแล้ว กำลังเตรียมจัดส่งให้คุณ</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<thead><tr style="background:#f5f5f5;text-align:left"><th style="padding:8px">สินค้า</th><th style="padding:8px">ไซซ์</th><th style="padding:8px">จำนวน</th><th style="padding:8px;text-align:right">ราคา</th></tr></thead>
<tbody>{{#items}}<tr style="border-bottom:1px solid #eee"><td style="padding:8px">{{name}}</td><td style="padding:8px">{{size}}</td><td style="padding:8px">{{qty}}</td><td style="padding:8px;text-align:right">{{line_total}} {{currency}}</td></tr>{{/items}}</tbody>
</table>
<p style="font-weight:bold">ยอดรวม: {{total}} {{currency}}</p>
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'ได้รับการชำระเงินแล้ว - ออร์เดอร์ #{{order_ref}} ยอดรวม {{total}} {{currency}} - {{store_name}}'),

('order.paid', 'en', 1, true, true,
 'Payment received · Order #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#1a7f37">Payment received ✅</h2>
<p>Hi {{customer_name}}, {{store_name}} has received your payment for order #{{order_ref}}. We are preparing your order for shipment.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<thead><tr style="background:#f5f5f5;text-align:left"><th style="padding:8px">Item</th><th style="padding:8px">Size</th><th style="padding:8px">Qty</th><th style="padding:8px;text-align:right">Price</th></tr></thead>
<tbody>{{#items}}<tr style="border-bottom:1px solid #eee"><td style="padding:8px">{{name}}</td><td style="padding:8px">{{size}}</td><td style="padding:8px">{{qty}}</td><td style="padding:8px;text-align:right">{{line_total}} {{currency}}</td></tr>{{/items}}</tbody>
</table>
<p style="font-weight:bold">Total: {{total}} {{currency}}</p>
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'Payment received - Order #{{order_ref}} - Total {{total}} {{currency}} - {{store_name}}'),

-- ---- order.packing ----
('order.packing', 'th', 1, true, true,
 'กำลังแพ็คสินค้า · ออร์เดอร์ #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#1677ff">กำลังแพ็คสินค้าของคุณ 📦</h2>
<p>สวัสดีคุณ{{customer_name}}, ออร์เดอร์ #{{order_ref}} ของคุณกำลังถูกแพ็ค เตรียมส่งเร็วๆนี้</p>
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'กำลังแพ็คสินค้า - ออร์เดอร์ #{{order_ref}} - {{store_name}}'),

('order.packing', 'en', 1, true, true,
 'Packing your order · #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#1677ff">We are packing your order 📦</h2>
<p>Hi {{customer_name}}, your order #{{order_ref}} is being packed and will ship soon.</p>
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'Packing your order - #{{order_ref}} - {{store_name}}'),

-- ---- order.shipped ----
('order.shipped', 'th', 1, true, true,
 'จัดส่งแล้ว · ออร์เดอร์ #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#1a7f37">พัสดุของคุณถูกจัดส่งแล้ว 🚚</h2>
<p>สวัสดีคุณ{{customer_name}}, ออร์เดอร์ #{{order_ref}} ถูกจัดส่งแล้ว</p>
{{#tracking_no}}<p>ขนส่ง: <strong>{{carrier}}</strong><br/>เลขพัสดุ: <strong>{{tracking_no}}</strong></p>{{/tracking_no}}
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'จัดส่งแล้ว - ออร์เดอร์ #{{order_ref}}{{#tracking_no}} - เลขพัสดุ {{tracking_no}} ({{carrier}}){{/tracking_no}} - {{store_name}}'),

('order.shipped', 'en', 1, true, true,
 'Shipped · Order #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#1a7f37">Your order has shipped 🚚</h2>
<p>Hi {{customer_name}}, order #{{order_ref}} is on its way.</p>
{{#tracking_no}}<p>Carrier: <strong>{{carrier}}</strong><br/>Tracking number: <strong>{{tracking_no}}</strong></p>{{/tracking_no}}
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'Shipped - Order #{{order_ref}}{{#tracking_no}} - Tracking {{tracking_no}} ({{carrier}}){{/tracking_no}} - {{store_name}}'),

-- ---- order.completed ----
('order.completed', 'th', 1, true, true,
 'จัดส่งสำเร็จ · ออร์เดอร์ #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#1a7f37">ขอบคุณที่สั่งซื้อ 🎉</h2>
<p>สวัสดีคุณ{{customer_name}}, ออร์เดอร์ #{{order_ref}} เสร็จสมบูรณ์แล้ว หวังว่าคุณจะพอใจกับสินค้า</p>
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'จัดส่งสำเร็จ - ออร์เดอร์ #{{order_ref}} - ขอบคุณที่สั่งซื้อกับ {{store_name}}'),

('order.completed', 'en', 1, true, true,
 'Order complete · #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#1a7f37">Thanks for your order 🎉</h2>
<p>Hi {{customer_name}}, order #{{order_ref}} is complete. We hope you enjoy it!</p>
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'Order complete - #{{order_ref}} - Thank you for shopping with {{store_name}}'),

-- ---- order.cancelled ----
('order.cancelled', 'th', 1, true, true,
 'ออร์เดอร์ถูกยกเลิก · #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#cf1322">ออร์เดอร์ถูกยกเลิกแล้ว</h2>
<p>สวัสดีคุณ{{customer_name}}, ออร์เดอร์ #{{order_ref}} ถูกยกเลิกแล้ว หากมีการชำระเงินไปแล้วทางร้านจะติดต่อเรื่องการคืนเงินต่อไป</p>
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'ออร์เดอร์ถูกยกเลิกแล้ว - #{{order_ref}} - {{store_name}}'),

('order.cancelled', 'en', 1, true, true,
 'Order cancelled · #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#cf1322">Your order has been cancelled</h2>
<p>Hi {{customer_name}}, order #{{order_ref}} has been cancelled. If a payment was already made, we will follow up about a refund.</p>
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'Order cancelled - #{{order_ref}} - {{store_name}}'),

-- ---- order.returned ----
('order.returned', 'th', 1, true, true,
 'รับคืนสินค้าแล้ว · ออร์เดอร์ #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#d48806">รับคืนสินค้าเรียบร้อยแล้ว</h2>
<p>สวัสดีคุณ{{customer_name}}, ทาง {{store_name}} ได้รับคืนสินค้าของออร์เดอร์ #{{order_ref}} เรียบร้อยแล้ว</p>
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'รับคืนสินค้าแล้ว - ออร์เดอร์ #{{order_ref}} - {{store_name}}'),

('order.returned', 'en', 1, true, true,
 'Return received · Order #{{order_ref}} — {{store_name}}',
 '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:16px" />{{/store_logo_url}}
<h2 style="color:#d48806">We have received your return</h2>
<p>Hi {{customer_name}}, {{store_name}} has received the returned item(s) for order #{{order_ref}}.</p>
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
 'Return received - Order #{{order_ref}} - {{store_name}}')

ON CONFLICT (key, locale, version) DO NOTHING;
