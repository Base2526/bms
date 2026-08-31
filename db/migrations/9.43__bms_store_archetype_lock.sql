-- =============================================================
-- 9.43  Lock the shop archetype after the first real order
-- -------------------------------------------------------------
-- Archetype changes alter AI guidance, onboarding checklists and capability
-- presets. Once real order history exists, changing that shop-wide meaning is
-- unsafe. Keep fake/demo seed orders editable: their reserved FAKE-* marker is
-- removed by the fake-data cleanup flow and is not business history.
--
-- Locking bms_tenants serializes this check with bms_orders' tenant FK. An
-- order INSERT and an archetype change therefore cannot both pass while each
-- misses the other's uncommitted row.
-- =============================================================

CREATE OR REPLACE FUNCTION bms_guard_store_archetype_after_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.business_archetype IS NOT DISTINCT FROM NEW.business_archetype THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.business_archetype IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM bms_tenants WHERE id = NEW.tenant_id FOR UPDATE;

  IF EXISTS (
    SELECT 1
      FROM bms_orders
     WHERE tenant_id = NEW.tenant_id
       AND (customer_ref IS NULL OR customer_ref NOT LIKE 'FAKE-%')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'ร้านนี้มีออร์เดอร์จริงแล้ว จึงล็อก Shop archetype ไว้เพื่อกัน AI / checklist / preset เปลี่ยนตามหลังข้อมูลจริง';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bms_store_profile_archetype_update_guard ON bms_store_profile;
CREATE TRIGGER bms_store_profile_archetype_update_guard
BEFORE UPDATE OF business_archetype ON bms_store_profile
FOR EACH ROW EXECUTE FUNCTION bms_guard_store_archetype_after_order();

-- AFTER INSERT avoids firing on the INSERT half of INSERT ... ON CONFLICT DO
-- UPDATE. A true insert still rolls back atomically if an order already exists.
DROP TRIGGER IF EXISTS bms_store_profile_archetype_insert_guard ON bms_store_profile;
CREATE TRIGGER bms_store_profile_archetype_insert_guard
AFTER INSERT ON bms_store_profile
FOR EACH ROW EXECUTE FUNCTION bms_guard_store_archetype_after_order();
