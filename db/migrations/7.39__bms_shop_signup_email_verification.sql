-- =============================================================
-- 7.39  Verify shop owner email before creating a tenant
-- =============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS bms_pending_shop_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  owner_name TEXT,
  password_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  tenant_id UUID REFERENCES bms_tenants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bms_pending_shop_signups_active_email_idx
  ON bms_pending_shop_signups (lower(email))
  WHERE verified_at IS NULL;

CREATE INDEX IF NOT EXISTS bms_pending_shop_signups_token_lookup_idx
  ON bms_pending_shop_signups (token_hash)
  WHERE verified_at IS NULL;

INSERT INTO email_templates
  (key, locale, version, is_active, is_published, subject_tpl, html_tpl, text_tpl)
VALUES
  (
    'auth.shop_verify', 'th', 1, TRUE, TRUE,
    'ยืนยันอีเมลเพื่อเปิดร้าน {{shop_name}}',
    '<h2>ยืนยันอีเมลเพื่อเปิดร้าน</h2><p>สวัสดี {{user_name}}</p><p>กรุณากดลิงก์ด้านล่างเพื่อยืนยันอีเมลและเปิดใช้งานร้าน <strong>{{shop_name}}</strong></p><p><a href="{{{verify_url}}}">ยืนยันอีเมลและเปิดร้าน</a></p><p>ลิงก์นี้มีอายุ {{expiry_minutes}} นาที หากคุณไม่ได้สมัครร้านนี้ ไม่ต้องดำเนินการใด ๆ</p>',
    'ยืนยันอีเมลและเปิดร้าน {{shop_name}}: {{{verify_url}}} (ลิงก์มีอายุ {{expiry_minutes}} นาที)'
  ),
  (
    'auth.shop_verify', 'en', 1, TRUE, TRUE,
    'Verify your email to activate {{shop_name}}',
    '<h2>Verify your email to activate your shop</h2><p>Hello {{user_name}},</p><p>Use the link below to verify your email and activate <strong>{{shop_name}}</strong>.</p><p><a href="{{{verify_url}}}">Verify email and activate shop</a></p><p>This link expires in {{expiry_minutes}} minutes. If you did not request this, you can ignore this email.</p>',
    'Verify your email and activate {{shop_name}}: {{{verify_url}}} (expires in {{expiry_minutes}} minutes)'
  )
ON CONFLICT (key, locale, version) DO NOTHING;
