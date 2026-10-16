-- Recovery-safe entry point for SQL clients such as HeidiSQL. Run the whole file.
ROLLBACK;
BEGIN;

-- Phase 5: opt-in starter defaults plus display-only holiday and emergency references.
-- Nothing in this migration is copied into an existing tenant automatically.

CREATE TABLE IF NOT EXISTS bms_master_category_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype TEXT NOT NULL,
  code TEXT NOT NULL,
  parent_code TEXT,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (archetype IN ('mini_mart','fashion','home_kitchen','beauty_personal_care','food_beverage','gadgets_accessories','b2b_wholesale','gifts_seasonal','pharmacy','pet_supply','building_materials','restaurant','board_game_cafe','other')),
  CHECK (code ~ '^[A-Z0-9_]{1,40}$' AND name_th <> '' AND name_en <> ''),
  UNIQUE (archetype, code)
);

CREATE TABLE IF NOT EXISTS bms_master_archetype_units (
  archetype TEXT NOT NULL,
  unit_code TEXT NOT NULL REFERENCES bms_master_units(code),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (archetype IN ('mini_mart','fashion','home_kitchen','beauty_personal_care','food_beverage','gadgets_accessories','b2b_wholesale','gifts_seasonal','pharmacy','pet_supply','building_materials','restaurant','board_game_cafe','other')),
  PRIMARY KEY (archetype, unit_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_master_archetype_units_default
  ON bms_master_archetype_units(archetype) WHERE active AND is_default;

CREATE TABLE IF NOT EXISTS bms_master_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL,
  holiday_date DATE NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PUBLIC','BANK')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (country_code ~ '^[A-Z]{2}$' AND name_th <> '' AND name_en <> ''),
  UNIQUE (country_code, holiday_date, kind)
);
CREATE INDEX IF NOT EXISTS idx_bms_master_holidays_lookup
  ON bms_master_holidays(country_code, holiday_date) WHERE active;

CREATE TABLE IF NOT EXISTS bms_master_emergency_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('MEDICAL','POISONING','SELF_HARM','TOURIST_ASSISTANCE','OTHER')),
  number TEXT NOT NULL,
  label_th TEXT NOT NULL,
  label_en TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (country_code ~ '^[A-Z]{2}$' AND number ~ '^[+0-9-]{1,30}$'),
  UNIQUE (country_code, kind, number)
);
CREATE INDEX IF NOT EXISTS idx_bms_master_emergency_numbers_lookup
  ON bms_master_emergency_numbers(country_code, kind, priority) WHERE active;

-- A durable application marker prevents a renamed or deleted tenant category
-- from being recreated by a later click.
CREATE TABLE IF NOT EXISTS bms_category_template_applications (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES bms_master_category_templates(id),
  category_id UUID REFERENCES bms_product_categories(id) ON DELETE SET NULL,
  applied_name TEXT NOT NULL,
  applied_by TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, template_id)
);
CREATE INDEX IF NOT EXISTS idx_bms_category_template_applications_tenant
  ON bms_category_template_applications(tenant_id, applied_at);
ALTER TABLE bms_category_template_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_category_template_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_category_template_applications_tenant_isolation ON bms_category_template_applications;
CREATE POLICY bms_category_template_applications_tenant_isolation ON bms_category_template_applications
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

INSERT INTO bms_master_category_templates
  (archetype,code,parent_code,name_th,name_en,sort_order,source,source_version)
VALUES
 ('mini_mart','FOOD',NULL,'อาหารและขนม','Food & snacks',10,'BMS starter defaults','10.80'),
 ('mini_mart','DRINKS',NULL,'เครื่องดื่ม','Beverages',20,'BMS starter defaults','10.80'),
 ('mini_mart','HOUSEHOLD',NULL,'ของใช้ในบ้าน','Household',30,'BMS starter defaults','10.80'),
 ('fashion','CLOTHING',NULL,'เสื้อผ้า','Clothing',10,'BMS starter defaults','10.80'),
 ('fashion','ACCESSORIES',NULL,'เครื่องประดับ','Accessories',20,'BMS starter defaults','10.80'),
 ('home_kitchen','KITCHEN',NULL,'เครื่องครัว','Kitchen',10,'BMS starter defaults','10.80'),
 ('home_kitchen','HOME',NULL,'ของใช้ในบ้าน','Home',20,'BMS starter defaults','10.80'),
 ('beauty_personal_care','SKINCARE',NULL,'ดูแลผิว','Skincare',10,'BMS starter defaults','10.80'),
 ('beauty_personal_care','PERSONAL_CARE',NULL,'ของใช้ส่วนบุคคล','Personal care',20,'BMS starter defaults','10.80'),
 ('food_beverage','FOOD',NULL,'อาหาร','Food',10,'BMS starter defaults','10.80'),
 ('food_beverage','DRINKS',NULL,'เครื่องดื่ม','Beverages',20,'BMS starter defaults','10.80'),
 ('gadgets_accessories','GADGETS',NULL,'อุปกรณ์ไอที','Gadgets',10,'BMS starter defaults','10.80'),
 ('gadgets_accessories','ACCESSORIES',NULL,'อุปกรณ์เสริม','Accessories',20,'BMS starter defaults','10.80'),
 ('b2b_wholesale','OFFICE',NULL,'ของใช้สำนักงาน','Office supplies',10,'BMS starter defaults','10.80'),
 ('b2b_wholesale','CONSUMABLES',NULL,'วัสดุสิ้นเปลือง','Consumables',20,'BMS starter defaults','10.80'),
 ('gifts_seasonal','GIFTS',NULL,'ของขวัญ','Gifts',10,'BMS starter defaults','10.80'),
 ('gifts_seasonal','SEASONAL',NULL,'สินค้าตามเทศกาล','Seasonal',20,'BMS starter defaults','10.80'),
 ('pharmacy','MEDICINE',NULL,'ยา','Medicine',10,'BMS starter defaults','10.80'),
 ('pharmacy','HEALTH',NULL,'สุขภาพและเวชภัณฑ์','Health supplies',20,'BMS starter defaults','10.80'),
 ('pet_supply','PET_FOOD',NULL,'อาหารสัตว์','Pet food',10,'BMS starter defaults','10.80'),
 ('pet_supply','PET_CARE',NULL,'ดูแลสัตว์เลี้ยง','Pet care',20,'BMS starter defaults','10.80'),
 ('building_materials','BUILDING',NULL,'วัสดุก่อสร้าง','Building materials',10,'BMS starter defaults','10.80'),
 ('building_materials','TOOLS',NULL,'เครื่องมือ','Tools',20,'BMS starter defaults','10.80'),
 ('restaurant','FOOD',NULL,'อาหาร','Food',10,'BMS starter defaults','10.80'),
 ('restaurant','DRINKS',NULL,'เครื่องดื่ม','Beverages',20,'BMS starter defaults','10.80'),
 ('board_game_cafe','BOARD_GAMES',NULL,'บอร์ดเกม','Board games',10,'BMS starter defaults','10.80'),
 ('board_game_cafe','FOOD_DRINKS',NULL,'อาหารและเครื่องดื่ม','Food & beverages',20,'BMS starter defaults','10.80'),
 ('other','GENERAL',NULL,'สินค้าทั่วไป','General',10,'BMS starter defaults','10.80')
ON CONFLICT (archetype,code) DO NOTHING;

-- Keep every Starter Catalog category available in the opt-in category list.
INSERT INTO bms_master_category_templates
  (archetype,code,parent_code,name_th,name_en,sort_order,source,source_version)
VALUES
 ('mini_mart','SAMPLE_DRY',NULL,'ของแห้ง','Dry goods',110,'BMS Starter Catalog','10.80'),
 ('mini_mart','SAMPLE_FRESH',NULL,'ของสด','Fresh food',120,'BMS Starter Catalog','10.80'),
 ('fashion','SAMPLE_DRESS',NULL,'เดรส','Dresses',110,'BMS Starter Catalog','10.80'),
 ('fashion','SAMPLE_PANTS',NULL,'กางเกง','Pants',120,'BMS Starter Catalog','10.80'),
 ('fashion','SAMPLE_BAGS',NULL,'กระเป๋า','Bags',130,'BMS Starter Catalog','10.80'),
 ('home_kitchen','SAMPLE_FOOD_BOX',NULL,'กล่องเก็บอาหาร','Food containers',110,'BMS Starter Catalog','10.80'),
 ('home_kitchen','SAMPLE_TABLEWARE',NULL,'จานชาม','Tableware',120,'BMS Starter Catalog','10.80'),
 ('home_kitchen','SAMPLE_APPLIANCE',NULL,'เครื่องใช้ไฟฟ้า','Appliances',130,'BMS Starter Catalog','10.80'),
 ('beauty_personal_care','SAMPLE_CLEANSER',NULL,'คลีนเซอร์','Cleanser',110,'BMS Starter Catalog','10.80'),
 ('beauty_personal_care','SAMPLE_SERUM',NULL,'เซรั่ม','Serum',120,'BMS Starter Catalog','10.80'),
 ('beauty_personal_care','SAMPLE_SUNSCREEN',NULL,'ครีมกันแดด','Sunscreen',130,'BMS Starter Catalog','10.80'),
 ('beauty_personal_care','SAMPLE_PERSONAL',NULL,'ของใช้ส่วนตัว','Personal care',140,'BMS Starter Catalog','10.80'),
 ('food_beverage','SAMPLE_BAKERY',NULL,'เบเกอรี่','Bakery',110,'BMS Starter Catalog','10.80'),
 ('food_beverage','SAMPLE_READY',NULL,'อาหารพร้อมทาน','Ready-to-eat food',120,'BMS Starter Catalog','10.80'),
 ('food_beverage','SAMPLE_PREPARED_DRINK',NULL,'เครื่องดื่มชง','Prepared drinks',130,'BMS Starter Catalog','10.80'),
 ('gadgets_accessories','SAMPLE_CASE',NULL,'เคส','Cases',110,'BMS Starter Catalog','10.80'),
 ('gadgets_accessories','SAMPLE_CABLE',NULL,'สายชาร์จ','Charging cables',120,'BMS Starter Catalog','10.80'),
 ('gadgets_accessories','SAMPLE_ADAPTER',NULL,'อะแดปเตอร์','Adapters',130,'BMS Starter Catalog','10.80'),
 ('gadgets_accessories','SAMPLE_POWERBANK',NULL,'แบตเตอรี่สำรอง','Power banks',140,'BMS Starter Catalog','10.80'),
 ('b2b_wholesale','SAMPLE_PAPER',NULL,'กระดาษ','Paper',110,'BMS Starter Catalog','10.80'),
 ('b2b_wholesale','SAMPLE_CHEMICAL',NULL,'เคมีภัณฑ์','Cleaning chemicals',120,'BMS Starter Catalog','10.80'),
 ('gifts_seasonal','SAMPLE_PACKAGING',NULL,'บรรจุภัณฑ์','Packaging',110,'BMS Starter Catalog','10.80'),
 ('gifts_seasonal','SAMPLE_CARD',NULL,'การ์ด','Cards',120,'BMS Starter Catalog','10.80'),
 ('gifts_seasonal','SAMPLE_GIFT_SET',NULL,'Gift Set','Gift sets',130,'BMS Starter Catalog','10.80'),
 ('pharmacy','SAMPLE_HEALTH_SUPPLY',NULL,'ของใช้สุขภาพ','Health supplies',110,'BMS Starter Catalog','10.80'),
 ('pharmacy','SAMPLE_WOUND',NULL,'ดูแลแผล','Wound care',120,'BMS Starter Catalog','10.80'),
 ('pharmacy','SAMPLE_DEVICE',NULL,'อุปกรณ์สุขภาพ','Health devices',130,'BMS Starter Catalog','10.80'),
 ('pet_supply','SAMPLE_TREAT',NULL,'ขนมสัตว์เลี้ยง','Pet treats',110,'BMS Starter Catalog','10.80'),
 ('pet_supply','SAMPLE_HYGIENE',NULL,'ทรายและสุขอนามัย','Litter and hygiene',120,'BMS Starter Catalog','10.80'),
 ('building_materials','SAMPLE_CEMENT',NULL,'ปูนและวัสดุก่อ','Cement and building materials',110,'BMS Starter Catalog','10.80'),
 ('building_materials','SAMPLE_PLUMBING',NULL,'ประปา','Plumbing',120,'BMS Starter Catalog','10.80'),
 ('building_materials','SAMPLE_ELECTRICAL',NULL,'ไฟฟ้า','Electrical',130,'BMS Starter Catalog','10.80'),
 ('building_materials','SAMPLE_TRADE_TOOLS',NULL,'เครื่องมือช่าง','Trade tools',140,'BMS Starter Catalog','10.80'),
 ('restaurant','SAMPLE_MAIN_DISH',NULL,'อาหารจานเดียว','Main dishes',110,'BMS Starter Catalog','10.80'),
 ('restaurant','SAMPLE_READY_DRINK',NULL,'เครื่องดื่มพร้อมขาย','Ready-to-sell drinks',120,'BMS Starter Catalog','10.80'),
 ('restaurant','SAMPLE_INGREDIENT',NULL,'วัตถุดิบ','Ingredients',130,'BMS Starter Catalog','10.80'),
 ('board_game_cafe','SAMPLE_DRINK',NULL,'เครื่องดื่ม','Beverages',110,'BMS Starter Catalog','10.80'),
 ('board_game_cafe','SAMPLE_SNACK',NULL,'ขนม','Snacks',120,'BMS Starter Catalog','10.80'),
 ('board_game_cafe','SAMPLE_ACCESSORY',NULL,'Board Game Accessories','Board game accessories',130,'BMS Starter Catalog','10.80'),
 ('other','SAMPLE_OFFICE',NULL,'ของใช้สำนักงาน','Office supplies',110,'BMS Starter Catalog','10.80'),
 ('other','SAMPLE_HOME',NULL,'ของใช้ในบ้าน','Household',120,'BMS Starter Catalog','10.80'),
 ('other','SAMPLE_CLEANING',NULL,'ทำความสะอาด','Cleaning',130,'BMS Starter Catalog','10.80'),
 ('other','SAMPLE_APPLIANCE',NULL,'เครื่องใช้ไฟฟ้า','Appliances',140,'BMS Starter Catalog','10.80')
ON CONFLICT (archetype,code) DO NOTHING;

INSERT INTO bms_master_archetype_units
  (archetype,unit_code,is_default,sort_order,source,source_version)
VALUES
 ('mini_mart','H87',TRUE,10,'BMS starter defaults','10.80'),('fashion','H87',TRUE,10,'BMS starter defaults','10.80'),
 ('home_kitchen','H87',TRUE,10,'BMS starter defaults','10.80'),('beauty_personal_care','H87',TRUE,10,'BMS starter defaults','10.80'),
 ('food_beverage','H87',TRUE,10,'BMS starter defaults','10.80'),('gadgets_accessories','H87',TRUE,10,'BMS starter defaults','10.80'),
 ('b2b_wholesale','BX',TRUE,10,'BMS starter defaults','10.80'),('gifts_seasonal','H87',TRUE,10,'BMS starter defaults','10.80'),
 ('pharmacy','H87',TRUE,10,'BMS starter defaults','10.80'),('pet_supply','H87',TRUE,10,'BMS starter defaults','10.80'),
 ('building_materials','H87',TRUE,10,'BMS starter defaults','10.80'),('restaurant','H87',TRUE,10,'BMS starter defaults','10.80'),
 ('board_game_cafe','H87',TRUE,10,'BMS starter defaults','10.80'),('other','H87',TRUE,10,'BMS starter defaults','10.80')
ON CONFLICT (archetype,unit_code) DO NOTHING;

INSERT INTO bms_master_emergency_numbers
  (country_code,kind,number,label_th,label_en,priority,source,source_version)
VALUES
 ('TH','MEDICAL','1669','การแพทย์ฉุกเฉิน','Emergency medical services',10,'สถาบันการแพทย์ฉุกเฉินแห่งชาติ','verified 2026-10-16'),
 ('TH','POISONING','1367','ศูนย์พิษวิทยารามาธิบดี','Ramathibodi Poison Center',20,'ศูนย์พิษวิทยารามาธิบดี','verified 2026-10-16'),
 ('TH','SELF_HARM','1323','สายด่วนสุขภาพจิต','Mental Health Hotline',30,'กรมสุขภาพจิต','verified 2026-10-16'),
 ('TH','TOURIST_ASSISTANCE','1155','ตำรวจท่องเที่ยว','Tourist Police',40,'กองบัญชาการตำรวจท่องเที่ยว','verified 2026-10-16')
ON CONFLICT (country_code,kind,number) DO NOTHING;

SELECT public.create_global_revision_trigger('bms_master_category_templates');
SELECT public.create_global_revision_trigger('bms_master_archetype_units');
SELECT public.create_global_revision_trigger('bms_master_holidays');
SELECT public.create_global_revision_trigger('bms_master_emergency_numbers');

DO $$ DECLARE tbl TEXT; BEGIN
  FOREACH tbl IN ARRAY ARRAY['bms_master_category_templates','bms_master_archetype_units','bms_master_holidays','bms_master_emergency_numbers'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', tbl);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I FROM bms_app', tbl);
    EXECUTE format('GRANT SELECT ON TABLE %I TO bms_app', tbl);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', tbl || '_revisions');
    EXECUTE format('GRANT SELECT ON TABLE %I TO bms_app', tbl || '_revisions');
  END LOOP;
END $$;
REVOKE ALL ON TABLE bms_category_template_applications FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_category_template_applications TO bms_app;

COMMENT ON TABLE bms_master_holidays IS 'Display-only holiday reference. It is not an authority for due-date or cron calculations.';
COMMENT ON TABLE bms_master_emergency_numbers IS 'Optional emergency contact reference. Application code retains a no-database canonical fallback.';
COMMENT ON TABLE bms_category_template_applications IS 'Tenant opt-in ledger; prevents templates from being reapplied after local rename or deletion.';

COMMIT;
