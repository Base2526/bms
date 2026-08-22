INSERT INTO email_templates
  (key, locale, version, is_active, is_published, subject_tpl, html_tpl, text_tpl)
VALUES
  (
    'auth.reset', 'th', 1, TRUE, TRUE,
    'รีเซ็ตรหัสผ่านของคุณ',
    '<h2>รีเซ็ตรหัสผ่าน</h2><p>สวัสดี {{user_name}}</p><p>กดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่:</p><p><a href="{{{reset_url}}}">รีเซ็ตรหัสผ่าน</a></p><p>ลิงก์นี้มีอายุ {{expiry_minutes}} นาที</p><p>ถ้าคุณไม่ได้ร้องขอการรีเซ็ต ให้ละเว้นอีเมลฉบับนี้ได้เลย</p>',
    'รีเซ็ตรหัสผ่าน: {{{reset_url}}} (ลิงก์มีอายุ {{expiry_minutes}} นาที)'
  ),
  (
    'auth.reset', 'en', 1, TRUE, TRUE,
    'Reset your password',
    '<h2>Reset your password</h2><p>Hello {{user_name}},</p><p>Use the link below to set a new password:</p><p><a href="{{{reset_url}}}">Reset password</a></p><p>This link expires in {{expiry_minutes}} minutes.</p><p>If you did not request this, you can ignore this email.</p>',
    'Reset your password: {{{reset_url}}} (expires in {{expiry_minutes}} minutes)'
  )
ON CONFLICT (key, locale, version) DO NOTHING;
