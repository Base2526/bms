-- =============================================================
-- 7.20  Store profile — email branding (footer text + theme color)
-- -------------------------------------------------------------
-- ให้ร้านปรับแต่งอีเมลแจ้งสถานะออร์เดอร์ (7.19) ให้ลูกค้าจำได้ง่ายว่ามาจากร้านไหน
-- โดยไม่ต้องให้แก้ HTML template เต็มรูป (สคีมา email_templates เดิมเป็น global
-- ไม่มี tenant_id — แก้ HTML ต่อร้านได้จริงต้องรื้อ schema/สร้างหน้า editor
-- ทั้งชุด ตัดสินใจแล้วว่ายังไม่คุ้มตอนนี้) — แค่เพิ่ม 2 field ที่ template
-- ที่มีอยู่แล้วดึงไปใช้ตอน render (lib/bms/orderNotify.ts):
--   email_theme_color : สีแบรนด์หลัก ใช้กับแถบหัวอีเมล + ชื่อร้าน (validate hex
--                        เป็น #RRGGBB ที่ resolver ก่อน insert — Mustache
--                        auto-escape กัน HTML injection อยู่แล้วเป็นชั้นที่ 2)
--   email_footer_text : ข้อความท้ายอีเมล (เช่น "ติดตามเราได้ที่ Facebook...")
--                        ไม่บังคับ — ไม่ตั้งค่า = ไม่มี paragraph นี้เลย
--
-- แก้ html_tpl/text_tpl ของ 6 template จาก 7.19 แบบ full replace ต่อแถว (ไม่ใช้
-- regexp_replace/replace แบบ patch เนื้อหาเดิม) เพื่อให้ idempotent ตรงไปตรงมา —
-- รันซ้ำได้ผลลัพธ์เดิมเสมอ ไม่ต้องเช็ค NOT LIKE ป้องกัน double-patch
-- =============================================================

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS email_theme_color TEXT,
  ADD COLUMN IF NOT EXISTS email_footer_text TEXT;

-- ---- order.paid ----
UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#1a7f37">ได้รับการชำระเงินแล้ว ✅</h2>
<p>สวัสดีคุณ{{customer_name}}, ทาง {{store_name}} ได้รับการชำระเงินสำหรับออร์เดอร์ #{{order_ref}} เรียบร้อยแล้ว กำลังเตรียมจัดส่งให้คุณ</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<thead><tr style="background:#f5f5f5;text-align:left"><th style="padding:8px">สินค้า</th><th style="padding:8px">ไซซ์</th><th style="padding:8px">จำนวน</th><th style="padding:8px;text-align:right">ราคา</th></tr></thead>
<tbody>{{#items}}<tr style="border-bottom:1px solid #eee"><td style="padding:8px">{{name}}</td><td style="padding:8px">{{size}}</td><td style="padding:8px">{{qty}}</td><td style="padding:8px;text-align:right">{{line_total}} {{currency}}</td></tr>{{/items}}</tbody>
</table>
<p style="font-weight:bold">ยอดรวม: {{total}} {{currency}}</p>
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'ได้รับการชำระเงินแล้ว - ออร์เดอร์ #{{order_ref}} ยอดรวม {{total}} {{currency}} - {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.paid' AND locale = 'th';

UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#1a7f37">Payment received ✅</h2>
<p>Hi {{customer_name}}, {{store_name}} has received your payment for order #{{order_ref}}. We are preparing your order for shipment.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<thead><tr style="background:#f5f5f5;text-align:left"><th style="padding:8px">Item</th><th style="padding:8px">Size</th><th style="padding:8px">Qty</th><th style="padding:8px;text-align:right">Price</th></tr></thead>
<tbody>{{#items}}<tr style="border-bottom:1px solid #eee"><td style="padding:8px">{{name}}</td><td style="padding:8px">{{size}}</td><td style="padding:8px">{{qty}}</td><td style="padding:8px;text-align:right">{{line_total}} {{currency}}</td></tr>{{/items}}</tbody>
</table>
<p style="font-weight:bold">Total: {{total}} {{currency}}</p>
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'Payment received - Order #{{order_ref}} - Total {{total}} {{currency}} - {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.paid' AND locale = 'en';

-- ---- order.packing ----
UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#1677ff">กำลังแพ็คสินค้าของคุณ 📦</h2>
<p>สวัสดีคุณ{{customer_name}}, ออร์เดอร์ #{{order_ref}} ของคุณกำลังถูกแพ็ค เตรียมส่งเร็วๆนี้</p>
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'กำลังแพ็คสินค้า - ออร์เดอร์ #{{order_ref}} - {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.packing' AND locale = 'th';

UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#1677ff">We are packing your order 📦</h2>
<p>Hi {{customer_name}}, your order #{{order_ref}} is being packed and will ship soon.</p>
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'Packing your order - #{{order_ref}} - {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.packing' AND locale = 'en';

-- ---- order.shipped ----
UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#1a7f37">พัสดุของคุณถูกจัดส่งแล้ว 🚚</h2>
<p>สวัสดีคุณ{{customer_name}}, ออร์เดอร์ #{{order_ref}} ถูกจัดส่งแล้ว</p>
{{#tracking_no}}<p>ขนส่ง: <strong>{{carrier}}</strong><br/>เลขพัสดุ: <strong>{{tracking_no}}</strong></p>{{/tracking_no}}
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'จัดส่งแล้ว - ออร์เดอร์ #{{order_ref}}{{#tracking_no}} - เลขพัสดุ {{tracking_no}} ({{carrier}}){{/tracking_no}} - {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.shipped' AND locale = 'th';

UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#1a7f37">Your order has shipped 🚚</h2>
<p>Hi {{customer_name}}, order #{{order_ref}} is on its way.</p>
{{#tracking_no}}<p>Carrier: <strong>{{carrier}}</strong><br/>Tracking number: <strong>{{tracking_no}}</strong></p>{{/tracking_no}}
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'Shipped - Order #{{order_ref}}{{#tracking_no}} - Tracking {{tracking_no}} ({{carrier}}){{/tracking_no}} - {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.shipped' AND locale = 'en';

-- ---- order.completed ----
UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#1a7f37">ขอบคุณที่สั่งซื้อ 🎉</h2>
<p>สวัสดีคุณ{{customer_name}}, ออร์เดอร์ #{{order_ref}} เสร็จสมบูรณ์แล้ว หวังว่าคุณจะพอใจกับสินค้า</p>
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'จัดส่งสำเร็จ - ออร์เดอร์ #{{order_ref}} - ขอบคุณที่สั่งซื้อกับ {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.completed' AND locale = 'th';

UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#1a7f37">Thanks for your order 🎉</h2>
<p>Hi {{customer_name}}, order #{{order_ref}} is complete. We hope you enjoy it!</p>
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'Order complete - #{{order_ref}} - Thank you for shopping with {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.completed' AND locale = 'en';

-- ---- order.cancelled ----
UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#cf1322">ออร์เดอร์ถูกยกเลิกแล้ว</h2>
<p>สวัสดีคุณ{{customer_name}}, ออร์เดอร์ #{{order_ref}} ถูกยกเลิกแล้ว หากมีการชำระเงินไปแล้วทางร้านจะติดต่อเรื่องการคืนเงินต่อไป</p>
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'ออร์เดอร์ถูกยกเลิกแล้ว - #{{order_ref}} - {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.cancelled' AND locale = 'th';

UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#cf1322">Your order has been cancelled</h2>
<p>Hi {{customer_name}}, order #{{order_ref}} has been cancelled. If a payment was already made, we will follow up about a refund.</p>
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'Order cancelled - #{{order_ref}} - {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.cancelled' AND locale = 'en';

-- ---- order.returned ----
UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#d48806">รับคืนสินค้าเรียบร้อยแล้ว</h2>
<p>สวัสดีคุณ{{customer_name}}, ทาง {{store_name}} ได้รับคืนสินค้าของออร์เดอร์ #{{order_ref}} เรียบร้อยแล้ว</p>
<p style="color:#666;font-size:13px">มีคำถาม? ติดต่อได้ที่ {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'รับคืนสินค้าแล้ว - ออร์เดอร์ #{{order_ref}} - {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.returned' AND locale = 'th';

UPDATE email_templates SET html_tpl =
'<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2329">
<div style="border-top:4px solid {{theme_color}};padding-top:12px;margin-bottom:12px">
{{#store_logo_url}}<img src="{{store_logo_url}}" alt="{{store_name}}" style="max-height:48px;margin-bottom:8px;display:block" />{{/store_logo_url}}
<div style="color:{{theme_color}};font-weight:bold;font-size:14px">{{store_name}}</div>
</div>
<h2 style="color:#d48806">We have received your return</h2>
<p>Hi {{customer_name}}, {{store_name}} has received the returned item(s) for order #{{order_ref}}.</p>
<p style="color:#666;font-size:13px">Questions? Contact us at {{support_url}}</p>
{{#email_footer_text}}<p style="color:#666;font-size:13px">{{email_footer_text}}</p>{{/email_footer_text}}
<p style="color:#999;font-size:12px">© {{year}} {{store_name}}</p>
</div>',
text_tpl = 'Return received - Order #{{order_ref}} - {{store_name}}{{#email_footer_text}} - {{email_footer_text}}{{/email_footer_text}}'
WHERE key = 'order.returned' AND locale = 'en';
