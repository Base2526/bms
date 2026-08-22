ALTER TABLE bms_actions ADD COLUMN IF NOT EXISTS title_en TEXT;
ALTER TABLE bms_actions ADD COLUMN IF NOT EXISTS expected_impact_en TEXT;

UPDATE bms_actions SET title_en=title WHERE title_en IS NULL;
UPDATE bms_actions SET expected_impact_en=expected_impact WHERE expected_impact_en IS NULL;

ALTER TABLE bms_actions ALTER COLUMN title_en SET NOT NULL;
ALTER TABLE bms_actions ALTER COLUMN expected_impact_en SET NOT NULL;

GRANT SELECT, INSERT, UPDATE ON bms_actions TO bms_app;
