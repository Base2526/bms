-- Factual label transcription only; no clinical advice, policy approval or protocol activation.
ALTER TABLE bms_products ADD COLUMN IF NOT EXISTS medicine_label JSONB NOT NULL DEFAULT '{}';
ALTER TABLE bms_products
  DROP CONSTRAINT IF EXISTS bms_products_medicine_label_shape,
  ADD CONSTRAINT bms_products_medicine_label_shape CHECK (
    jsonb_typeof(medicine_label) = 'object' AND octet_length(medicine_label::text) <= 16000
    AND (medicine_label - ARRAY['activeIngredients','strength','dosageForm']::text[]) = '{}'::jsonb
  );
COMMENT ON COLUMN bms_products.medicine_label IS
  'Shop-transcribed active ingredients, labelled strength and dosage form. Missing values are unknown. Never dosing instructions, clinical equivalence or approval to sell.';
