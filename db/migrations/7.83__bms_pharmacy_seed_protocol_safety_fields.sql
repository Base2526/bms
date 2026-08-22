-- =============================================================
-- 7.83  Repair the three MVP pharmacy protocol drafts
-- Renumbered from 7.74, which collided with
-- 7.74__bms_shared_customer_identity_backfill.sql (both landed 2026-08-11 from
-- different branches). Re-running this file is safe, so an environment that
-- already applied it as 7.74 needs no action.
-- -------------------------------------------------------------
-- 7.58 seeded red-flag rules whose fields were not declared as questions.
-- The authoring validator correctly rejects those drafts, so a newly enabled
-- pharmacy could not submit them for clinical review.  Only untouched sample
-- drafts are repaired; approved or shop-authored protocols are not changed.
-- =============================================================

WITH safety_fields(protocol_key, field_key, label, field_type, question_key) AS (
  VALUES
    ('headache', 'has_fever', 'มีไข้ร่วมด้วยไหม', 'yes_no', 'q_headache_fever'),
    ('headache', 'neck_stiffness', 'มีคอแข็งหรือก้มหน้าไม่ได้ร่วมด้วยไหม', 'yes_no', 'q_headache_neck_stiffness'),
    ('headache', 'worst_ever', 'อาการเกิดขึ้นฉับพลันและรุนแรงที่สุดเท่าที่เคยเป็นไหม', 'yes_no', 'q_headache_worst_ever'),
    ('headache', 'neuro_symptoms', 'มีแขนขาอ่อนแรง พูดไม่ชัด หรือมองเห็นผิดปกติไหม', 'yes_no', 'q_headache_neuro_symptoms'),
    ('headache', 'recent_head_injury', 'ก่อนปวดหัวมีศีรษะกระแทกหรือได้รับบาดเจ็บไหม', 'yes_no', 'q_headache_recent_head_injury'),
    ('cough', 'blood_in_sputum', 'มีเลือดปนในเสมหะไหม', 'yes_no', 'q_cough_blood_in_sputum'),
    ('cough', 'breathing_difficulty', 'มีหายใจลำบาก หอบเหนื่อย หรือหายใจไม่อิ่มไหม', 'yes_no', 'q_cough_breathing_difficulty'),
    ('cough', 'chest_pain', 'มีเจ็บหรือแน่นหน้าอกร่วมด้วยไหม', 'yes_no', 'q_cough_chest_pain'),
    ('diarrhea', 'blood_in_stool', 'มีเลือดปนในอุจจาระหรืออุจจาระดำไหม', 'yes_no', 'q_diarrhea_blood_in_stool'),
    ('diarrhea', 'high_fever', 'มีไข้สูงร่วมด้วยไหม', 'yes_no', 'q_diarrhea_high_fever')
), grouped AS (
  SELECT
    protocol_key,
    jsonb_agg(
      jsonb_build_object(
        'key', field_key,
        'label', label,
        'type', field_type,
        'questionKey', question_key
      ) ORDER BY field_key
    ) AS fields,
    jsonb_agg(to_jsonb(field_key) ORDER BY field_key) AS completion_keys
  FROM safety_fields
  GROUP BY protocol_key
)
UPDATE bms_pharmacy_protocols AS protocol
SET required_fields = protocol.required_fields || COALESCE((
      SELECT jsonb_agg(field_def)
      FROM jsonb_array_elements(grouped.fields) AS field_def
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(protocol.required_fields || protocol.conditional_questions) AS existing
        WHERE existing->>'key' = field_def->>'key'
      )
    ), '[]'::jsonb),
    completion_rules = jsonb_set(
      protocol.completion_rules,
      '{requireAllOf}',
      COALESCE(protocol.completion_rules->'requireAllOf', '[]'::jsonb) || COALESCE((
        SELECT jsonb_agg(completion_key)
        FROM jsonb_array_elements(grouped.completion_keys) AS completion_key
        WHERE NOT COALESCE(protocol.completion_rules->'requireAllOf', '[]'::jsonb) @> jsonb_build_array(completion_key)
      ), '[]'::jsonb),
      TRUE
    ),
    updated_at = now()
FROM grouped
WHERE protocol.protocol_key = grouped.protocol_key
  AND protocol.version = 1
  AND protocol.status = 'DRAFT'
  AND protocol.clinically_approved = FALSE
  AND protocol.enabled = FALSE
  AND protocol.name LIKE '%ตัวอย่าง%';

