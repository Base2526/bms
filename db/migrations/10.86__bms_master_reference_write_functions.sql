-- Phase 1/3 runtime writes previously used direct INSERT with a SELECT-only role.
-- Apply after 10.85 using the migration-owner connection. No business rows are changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.upsert_master_bank(uuid,text,text,text,text,text,boolean,integer,text,text)
RETURNS SETOF public.bms_master_banks
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NULLIF(current_setting('app.editor_id',true),'')::uuid AND is_platform_admin) THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN QUERY INSERT INTO bms_master_banks
        (id,code,country_code,name_th,name_en,swift,active,sort_order,source,source_version)
       VALUES (COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code,country_code=EXCLUDED.country_code,
         name_th=EXCLUDED.name_th,name_en=EXCLUDED.name_en,swift=EXCLUDED.swift,
         active=EXCLUDED.active,sort_order=EXCLUDED.sort_order,source=EXCLUDED.source,
         source_version=EXCLUDED.source_version,updated_at=now() RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.upsert_master_bank(uuid,text,text,text,text,text,boolean,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_master_bank(uuid,text,text,text,text,text,boolean,integer,text,text) TO bms_app;

CREATE OR REPLACE FUNCTION public.upsert_master_unit(uuid,text,text,text,text,text[],text,numeric,boolean,text,text)
RETURNS SETOF public.bms_master_units
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NULLIF(current_setting('app.editor_id',true),'')::uuid AND is_platform_admin) THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN QUERY INSERT INTO bms_master_units
        (id,code,country_code,name_th,name_en,aliases,kind,base_factor,active,source,source_version)
       VALUES (COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code,country_code=EXCLUDED.country_code,
         name_th=EXCLUDED.name_th,name_en=EXCLUDED.name_en,aliases=EXCLUDED.aliases,
         kind=EXCLUDED.kind,base_factor=EXCLUDED.base_factor,active=EXCLUDED.active,
         source=EXCLUDED.source,source_version=EXCLUDED.source_version,updated_at=now() RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.upsert_master_unit(uuid,text,text,text,text,text[],text,numeric,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_master_unit(uuid,text,text,text,text,text[],text,numeric,boolean,text,text) TO bms_app;

CREATE OR REPLACE FUNCTION public.upsert_master_th_province(uuid,text,text,text,boolean,text,text)
RETURNS SETOF public.bms_master_th_provinces
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NULLIF(current_setting('app.editor_id',true),'')::uuid AND is_platform_admin) THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN QUERY INSERT INTO bms_master_th_provinces
        (id,code,name_th,name_en,active,source,source_version)
        VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6,$7)
        ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,name_th=EXCLUDED.name_th,name_en=EXCLUDED.name_en,
          active=EXCLUDED.active,source=EXCLUDED.source,source_version=EXCLUDED.source_version,updated_at=now()
        RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.upsert_master_th_province(uuid,text,text,text,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_master_th_province(uuid,text,text,text,boolean,text,text) TO bms_app;

CREATE OR REPLACE FUNCTION public.upsert_master_th_district(uuid,text,text,text,text,boolean,text,text)
RETURNS SETOF public.bms_master_th_districts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NULLIF(current_setting('app.editor_id',true),'')::uuid AND is_platform_admin) THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN QUERY INSERT INTO bms_master_th_districts
        (id,code,province_code,name_th,name_en,active,source,source_version)
        VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,province_code=EXCLUDED.province_code,
          name_th=EXCLUDED.name_th,name_en=EXCLUDED.name_en,active=EXCLUDED.active,
          source=EXCLUDED.source,source_version=EXCLUDED.source_version,updated_at=now()
        RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.upsert_master_th_district(uuid,text,text,text,text,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_master_th_district(uuid,text,text,text,text,boolean,text,text) TO bms_app;

CREATE OR REPLACE FUNCTION public.upsert_master_th_subdistrict(uuid,text,text,text,text,text,text,boolean,text,text)
RETURNS SETOF public.bms_master_th_subdistricts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NULLIF(current_setting('app.editor_id',true),'')::uuid AND is_platform_admin) THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN QUERY INSERT INTO bms_master_th_subdistricts
        (id,code,province_code,district_code,name_th,name_en,postcode,active,source,source_version)
        VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,province_code=EXCLUDED.province_code,
          district_code=EXCLUDED.district_code,name_th=EXCLUDED.name_th,name_en=EXCLUDED.name_en,
          postcode=EXCLUDED.postcode,active=EXCLUDED.active,source=EXCLUDED.source,
          source_version=EXCLUDED.source_version,updated_at=now()
        RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.upsert_master_th_subdistrict(uuid,text,text,text,text,text,text,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_master_th_subdistrict(uuid,text,text,text,text,text,text,boolean,text,text) TO bms_app;

CREATE OR REPLACE FUNCTION public.upsert_master_carrier(uuid,text,text,text,text,text,text,text,boolean,text,text)
RETURNS SETOF public.bms_master_carriers
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NULLIF(current_setting('app.editor_id',true),'')::uuid AND is_platform_admin) THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN QUERY INSERT INTO bms_master_carriers
        (id,code,country_code,name_th,name_en,tracking_url_template,tracking_no_pattern,
         integration_status,active,source,source_version)
       VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(id) DO UPDATE SET code=EXCLUDED.code,country_code=EXCLUDED.country_code,
         name_th=EXCLUDED.name_th,name_en=EXCLUDED.name_en,
         tracking_url_template=EXCLUDED.tracking_url_template,
         tracking_no_pattern=EXCLUDED.tracking_no_pattern,
         integration_status=EXCLUDED.integration_status,active=EXCLUDED.active,
         source=EXCLUDED.source,source_version=EXCLUDED.source_version,updated_at=now()
       RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.upsert_master_carrier(uuid,text,text,text,text,text,text,text,boolean,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_master_carrier(uuid,text,text,text,text,text,text,text,boolean,text,text) TO bms_app;

CREATE OR REPLACE FUNCTION public.ensure_master_province_shipping_zone(text,text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = NULLIF(current_setting('app.editor_id',true),'')::uuid AND is_platform_admin) THEN
    RAISE EXCEPTION 'PLATFORM_ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;
  INSERT INTO bms_master_th_shipping_zones (province_code,zone,source,source_version)
         VALUES($1,$2,'BMS legacy shipping-zone parity','pre-10.78')
         ON CONFLICT(province_code) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.ensure_master_province_shipping_zone(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_master_province_shipping_zone(text,text) TO bms_app;

-- ROLLBACK: revert masterData.ts first, then revoke EXECUTE on these seven functions.
-- Keep all master rows, snapshots and revision tables; no schema/data rollback is needed.
COMMIT;
