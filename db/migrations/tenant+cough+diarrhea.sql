INSERT INTO bms_pharmacy_protocols (
  tenant_id,
  protocol_key,
  name,
  version,
  supported_symptom_group,
  required_fields,
  conditional_questions,
  red_flag_rules,
  completion_rules,
  escalation_rules,
  status,
  clinically_approved,
  enabled
) VALUES
(
  'YOUR_TENANT_ID',
  'headache',
  'Headache intake',
  1,
  'headache',
  '[
    {"key":"onset_days","label":"ระยะเวลาที่ปวด (วัน)","type":"number","questionKey":"q_headache_onset"},
    {"key":"severity","label":"ความรุนแรง (1-10)","type":"number","questionKey":"q_headache_severity"},
    {"key":"location","label":"ตำแหน่งที่ปวด","type":"free_text","questionKey":"q_headache_location"},
    {"key":"allergies","label":"ประวัติแพ้ยา","type":"free_text","questionKey":"q_allergies"},
    {"key":"current_medications","label":"ยาที่ใช้อยู่ปัจจุบัน","type":"free_text","questionKey":"q_current_meds"}
  ]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '{"requireAllOf":["onset_days","severity","location","allergies","current_medications"]}'::jsonb,
  '{"onRedFlag":"EMERGENCY_REFERRAL","onUnresolvedConflict":"WAITING_FOR_PHARMACIST"}'::jsonb,
  'APPROVED',
  TRUE,
  TRUE
);


INSERT INTO bms_pharmacy_protocols (
  tenant_id,
  protocol_key,
  name,
  version,
  supported_symptom_group,
  required_fields,
  conditional_questions,
  red_flag_rules,
  completion_rules,
  escalation_rules,
  status,
  clinically_approved,
  enabled
)
VALUES
(
  'YOUR_TENANT_ID',
  'cough',
  'Cough intake',
  1,
  'cough',
  '[
    {"key":"duration_days","label":"ระยะเวลาที่ไอ (วัน)","type":"number","questionKey":"q_cough_duration"},
    {"key":"sputum","label":"มีเสมหะไหม/สีอะไร","type":"free_text","questionKey":"q_cough_sputum"},
    {"key":"has_fever","label":"มีไข้ร่วมไหม","type":"yes_no","questionKey":"q_cough_fever"},
    {"key":"allergies","label":"ประวัติแพ้ยา","type":"free_text","questionKey":"q_allergies"},
    {"key":"current_medications","label":"ยาที่ใช้อยู่ปัจจุบัน","type":"free_text","questionKey":"q_current_meds"}
  ]'::jsonb,
  '[
    {"key":"fever_temp","questionKey":"q_cough_fever_temp","unlockWhen":{"field":"has_fever","equals":"YES"}}
  ]'::jsonb,
  '[
    {"code":"RF_COUGH_BLOOD","field":"blood_in_sputum","equals":"YES","severity":"EMERGENCY","label":"ไอมีเลือดปน"},
    {"code":"RF_COUGH_BREATHLESS","field":"breathing_difficulty","equals":"YES","severity":"EMERGENCY","label":"หายใจลำบาก/หอบเหนื่อยมาก"},
    {"code":"RF_COUGH_CHEST_PAIN","field":"chest_pain","equals":"YES","severity":"HIGH","label":"เจ็บแน่นหน้าอกร่วมด้วย"},
    {"code":"RF_COUGH_LONG_DURATION","field":"duration_days","greaterThan":21,"severity":"HIGH","label":"ไอเรื้อรังเกิน 3 สัปดาห์"}
  ]'::jsonb,
  '{"requireAllOf":["duration_days","sputum","has_fever","allergies","current_medications"]}'::jsonb,
  '{"onRedFlag":"EMERGENCY_REFERRAL","onUnresolvedConflict":"WAITING_FOR_PHARMACIST"}'::jsonb,
  'APPROVED',
  TRUE,
  TRUE
),
(
  'YOUR_TENANT_ID',
  'diarrhea',
  'Diarrhea intake',
  1,
  'diarrhea',
  '[
    {"key":"duration_hours","label":"ระยะเวลาที่ถ่ายเหลว (ชั่วโมง)","type":"number","questionKey":"q_diarrhea_duration"},
    {"key":"frequency_per_day","label":"จำนวนครั้งต่อวัน","type":"number","questionKey":"q_diarrhea_frequency"},
    {"key":"hydration_status","label":"อาการขาดน้ำ (ปากแห้ง/ปัสสาวะน้อย/หน้ามืด)","type":"yes_no","questionKey":"q_diarrhea_hydration"},
    {"key":"allergies","label":"ประวัติแพ้ยา","type":"free_text","questionKey":"q_allergies"},
    {"key":"current_medications","label":"ยาที่ใช้อยู่ปัจจุบัน","type":"free_text","questionKey":"q_current_meds"}
  ]'::jsonb,
  '[]'::jsonb,
  '[
    {"code":"RF_DIARRHEA_BLOOD","field":"blood_in_stool","equals":"YES","severity":"EMERGENCY","label":"ถ่ายมีเลือดปน"},
    {"code":"RF_DIARRHEA_SEVERE_DEHYDRATION","field":"hydration_status","equals":"YES","severity":"HIGH","label":"มีอาการขาดน้ำชัดเจน"},
    {"code":"RF_DIARRHEA_HIGH_FEVER","field":"high_fever","equals":"YES","severity":"HIGH","label":"ไข้สูงร่วมด้วย"},
    {"code":"RF_DIARRHEA_INFANT","field":"patient_age_years","lessThan":2,"severity":"HIGH","label":"ผู้ป่วยเป็นทารกอายุต่ำกว่า 2 ปี"}
  ]'::jsonb,
  '{"requireAllOf":["duration_hours","frequency_per_day","hydration_status","allergies","current_medications"]}'::jsonb,
  '{"onRedFlag":"EMERGENCY_REFERRAL","onUnresolvedConflict":"WAITING_FOR_PHARMACIST"}'::jsonb,
  'APPROVED',
  TRUE,
  TRUE
)
ON CONFLICT (tenant_id, protocol_key, version)
DO UPDATE SET
  name = EXCLUDED.name,
  supported_symptom_group = EXCLUDED.supported_symptom_group,
  required_fields = EXCLUDED.required_fields,
  conditional_questions = EXCLUDED.conditional_questions,
  red_flag_rules = EXCLUDED.red_flag_rules,
  completion_rules = EXCLUDED.completion_rules,
  escalation_rules = EXCLUDED.escalation_rules,
  status = EXCLUDED.status,
  clinically_approved = EXCLUDED.clinically_approved,
  enabled = EXCLUDED.enabled,
  updated_at = now();