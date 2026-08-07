-- =============================================================
-- 7.58  AI Pharmacy Intake Assistant — protocol registry
-- -------------------------------------------------------------
-- Data-driven question/red-flag/completion/escalation rules per symptom
-- group so lib/bms/pharmacy/ruleEngine.ts never hardcodes clinical logic
-- in TS and a pharmacist can review/enable a protocol without a deploy.
--
-- Seeds 3 MVP protocols (headache/cough/diarrhea) per existing tenant.
-- They ship DISABLED and NOT clinically approved — this is sample/demo
-- data for development only, per the user's explicit instruction. A
-- pharmacist must review and flip `clinically_approved`/`enabled` before
-- any of this can be presented as clinically valid.
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_pharmacy_protocols (
  id                      UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  protocol_key            TEXT NOT NULL,
  name                    TEXT NOT NULL,
  version                 INTEGER NOT NULL DEFAULT 1,
  supported_symptom_group TEXT NOT NULL,
  required_fields         JSONB NOT NULL DEFAULT '[]',
  conditional_questions   JSONB NOT NULL DEFAULT '[]',
  red_flag_rules          JSONB NOT NULL DEFAULT '[]',
  completion_rules        JSONB NOT NULL DEFAULT '{}',
  escalation_rules        JSONB NOT NULL DEFAULT '{}',
  status                  TEXT NOT NULL DEFAULT 'DRAFT'
                            CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'RETIRED')),
  clinically_approved     BOOLEAN NOT NULL DEFAULT FALSE,
  enabled                 BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by             UUID REFERENCES users(id),
  reviewed_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, protocol_key, version)
);

CREATE INDEX IF NOT EXISTS idx_bms_pharmacy_protocols_tenant_enabled
  ON bms_pharmacy_protocols(tenant_id, protocol_key) WHERE enabled;

ALTER TABLE bms_pharmacy_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pharmacy_protocols FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pharmacy_protocols_tenant_isolation ON bms_pharmacy_protocols;
CREATE POLICY bms_pharmacy_protocols_tenant_isolation ON bms_pharmacy_protocols
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pharmacy_protocols TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- MVP seed: 3 sample protocols per tenant (DRAFT, disabled, not clinically approved) ----
INSERT INTO bms_pharmacy_protocols
  (tenant_id, protocol_key, name, version, supported_symptom_group,
   required_fields, conditional_questions, red_flag_rules, completion_rules, escalation_rules,
   status, clinically_approved, enabled)
SELECT
  t.id, p.protocol_key, p.name, 1, p.symptom_group,
  p.required_fields::jsonb, p.conditional_questions::jsonb, p.red_flag_rules::jsonb,
  p.completion_rules::jsonb, p.escalation_rules::jsonb,
  'DRAFT', FALSE, FALSE
FROM bms_tenants t
CROSS JOIN (VALUES
  (
    'headache',
    'Headache intake (ตัวอย่าง — ยังไม่ผ่านการรับรองทางคลินิก)',
    'headache',
    '[
      {"key":"onset_days","label":"ระยะเวลาที่ปวด (วัน)","type":"number","questionKey":"q_headache_onset"},
      {"key":"severity","label":"ความรุนแรง (1-10)","type":"number","questionKey":"q_headache_severity"},
      {"key":"location","label":"ตำแหน่งที่ปวด","type":"free_text","questionKey":"q_headache_location"},
      {"key":"allergies","label":"ประวัติแพ้ยา","type":"free_text","questionKey":"q_allergies"},
      {"key":"current_medications","label":"ยาที่ใช้อยู่ปัจจุบัน","type":"free_text","questionKey":"q_current_meds"}
    ]',
    '[
      {"key":"fever_temp","questionKey":"q_headache_fever_temp","unlockWhen":{"field":"has_fever","equals":"YES"}}
    ]',
    '[
      {"code":"RF_HEADACHE_STIFF_NECK","field":"neck_stiffness","equals":"YES","severity":"EMERGENCY","label":"คอแข็ง ก้มหน้าไม่ได้"},
      {"code":"RF_HEADACHE_WORST_EVER","field":"worst_ever","equals":"YES","severity":"EMERGENCY","label":"ปวดหัวรุนแรงที่สุดในชีวิตแบบเฉียบพลัน"},
      {"code":"RF_HEADACHE_NEURO_DEFICIT","field":"neuro_symptoms","equals":"YES","severity":"EMERGENCY","label":"แขนขาอ่อนแรง พูดไม่ชัด ตามัวเฉียบพลัน"},
      {"code":"RF_HEADACHE_HEAD_INJURY","field":"recent_head_injury","equals":"YES","severity":"HIGH","label":"ปวดหัวหลังศีรษะได้รับบาดเจ็บ"}
    ]',
    '{"requireAllOf":["onset_days","severity","location","allergies","current_medications"]}',
    '{"onRedFlag":"EMERGENCY_REFERRAL","onUnresolvedConflict":"WAITING_FOR_PHARMACIST"}'
  ),
  (
    'cough',
    'Cough intake (ตัวอย่าง — ยังไม่ผ่านการรับรองทางคลินิก)',
    'cough',
    '[
      {"key":"duration_days","label":"ระยะเวลาที่ไอ (วัน)","type":"number","questionKey":"q_cough_duration"},
      {"key":"sputum","label":"มีเสมหะไหม/สีอะไร","type":"free_text","questionKey":"q_cough_sputum"},
      {"key":"has_fever","label":"มีไข้ร่วมไหม","type":"yes_no","questionKey":"q_cough_fever"},
      {"key":"allergies","label":"ประวัติแพ้ยา","type":"free_text","questionKey":"q_allergies"},
      {"key":"current_medications","label":"ยาที่ใช้อยู่ปัจจุบัน","type":"free_text","questionKey":"q_current_meds"}
    ]',
    '[
      {"key":"fever_temp","questionKey":"q_cough_fever_temp","unlockWhen":{"field":"has_fever","equals":"YES"}}
    ]',
    '[
      {"code":"RF_COUGH_BLOOD","field":"blood_in_sputum","equals":"YES","severity":"EMERGENCY","label":"ไอมีเลือดปน"},
      {"code":"RF_COUGH_BREATHLESS","field":"breathing_difficulty","equals":"YES","severity":"EMERGENCY","label":"หายใจลำบาก/หอบเหนื่อยมาก"},
      {"code":"RF_COUGH_CHEST_PAIN","field":"chest_pain","equals":"YES","severity":"HIGH","label":"เจ็บแน่นหน้าอกร่วมด้วย"},
      {"code":"RF_COUGH_LONG_DURATION","field":"duration_days","greaterThan":21,"severity":"HIGH","label":"ไอเรื้อรังเกิน 3 สัปดาห์"}
    ]',
    '{"requireAllOf":["duration_days","sputum","has_fever","allergies","current_medications"]}',
    '{"onRedFlag":"EMERGENCY_REFERRAL","onUnresolvedConflict":"WAITING_FOR_PHARMACIST"}'
  ),
  (
    'diarrhea',
    'Diarrhea intake (ตัวอย่าง — ยังไม่ผ่านการรับรองทางคลินิก)',
    'diarrhea',
    '[
      {"key":"duration_hours","label":"ระยะเวลาที่ถ่ายเหลว (ชั่วโมง)","type":"number","questionKey":"q_diarrhea_duration"},
      {"key":"frequency_per_day","label":"จำนวนครั้งต่อวัน","type":"number","questionKey":"q_diarrhea_frequency"},
      {"key":"hydration_status","label":"อาการขาดน้ำ (ปากแห้ง/ปัสสาวะน้อย/หน้ามืด)","type":"yes_no","questionKey":"q_diarrhea_hydration"},
      {"key":"allergies","label":"ประวัติแพ้ยา","type":"free_text","questionKey":"q_allergies"},
      {"key":"current_medications","label":"ยาที่ใช้อยู่ปัจจุบัน","type":"free_text","questionKey":"q_current_meds"}
    ]',
    '[]',
    '[
      {"code":"RF_DIARRHEA_BLOOD","field":"blood_in_stool","equals":"YES","severity":"EMERGENCY","label":"ถ่ายมีเลือดปน"},
      {"code":"RF_DIARRHEA_SEVERE_DEHYDRATION","field":"hydration_status","equals":"YES","severity":"HIGH","label":"มีอาการขาดน้ำชัดเจน"},
      {"code":"RF_DIARRHEA_HIGH_FEVER","field":"high_fever","equals":"YES","severity":"HIGH","label":"ไข้สูงร่วมด้วย"},
      {"code":"RF_DIARRHEA_INFANT","field":"patient_age_years","lessThan":2,"severity":"HIGH","label":"ผู้ป่วยเป็นทารกอายุต่ำกว่า 2 ปี"}
    ]',
    '{"requireAllOf":["duration_hours","frequency_per_day","hydration_status","allergies","current_medications"]}',
    '{"onRedFlag":"EMERGENCY_REFERRAL","onUnresolvedConflict":"WAITING_FOR_PHARMACIST"}'
  )
) AS p(protocol_key, name, symptom_group, required_fields, conditional_questions, red_flag_rules, completion_rules, escalation_rules)
ON CONFLICT (tenant_id, protocol_key, version) DO NOTHING;
