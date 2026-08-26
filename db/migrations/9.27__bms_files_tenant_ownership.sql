-- =============================================================
-- 9.27  files.tenant_id — a private file belongs to one shop
-- -------------------------------------------------------------
-- 9.26 stopped /api/files/[id] handing sensitive uploads to anonymous callers,
-- but it still had nothing to say about *which* shop a file belongs to: the
-- files table has no tenant column, so any logged-in user could open another
-- shop's private file by guessing the sequential id.
--
-- Ownership is derived, not declared: the four BMS tables that point at a file
-- all carry tenant_id, so the file inherits theirs. The three legacy community
-- tables (message_images, messages.audio_file_id, post_images) have no tenant at
-- all — those files stay NULL, meaning "not owned by a shop", and the route
-- treats NULL as "a session is enough" exactly as it does today. Making them
-- NOT NULL would mean inventing an owner for pre-BMS data.
--
-- Nullable and ON DELETE SET NULL on purpose: a file must survive its shop being
-- removed long enough for the storage sweep to deal with it, rather than
-- cascading a delete into blobs on disk that nothing has cleaned up yet.
-- =============================================================

ALTER TABLE files
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES bms_tenants(id) ON DELETE SET NULL;

-- Product images: the storefront reads these publicly, but owning them still
-- matters for the private path and for any future per-shop cleanup.
UPDATE files f SET tenant_id = src.tenant_id
  FROM (SELECT DISTINCT file_id, tenant_id FROM bms_product_images WHERE file_id IS NOT NULL) src
 WHERE f.id = src.file_id AND f.tenant_id IS NULL;

UPDATE files f SET tenant_id = src.tenant_id
  FROM (SELECT DISTINCT file_id, tenant_id FROM bms_generated_reports WHERE file_id IS NOT NULL) src
 WHERE f.id = src.file_id AND f.tenant_id IS NULL;

UPDATE files f SET tenant_id = src.tenant_id
  FROM (
    SELECT DISTINCT file_id, tenant_id
      FROM bms_pharmacy_clinical_evidence
     WHERE file_id IS NOT NULL
  ) src
 WHERE f.id = src.file_id AND f.tenant_id IS NULL;

-- Slips are referenced by URL text rather than a foreign key, so the id has to
-- be parsed back out of it — the same expression 9.26 used to mark them private.
UPDATE files f SET tenant_id = src.tenant_id
  FROM (
    SELECT DISTINCT (regexp_match(p.slip_url, '^/api/files/(\d+)'))[1]::int AS file_id,
           p.tenant_id
      FROM bms_payments p
     WHERE p.slip_url ~ '^/api/files/\d+'
  ) src
 WHERE f.id = src.file_id AND f.tenant_id IS NULL;

-- The route looks up one row by id and then compares tenant; no index beyond the
-- primary key is needed for that. This one exists for the eventual per-shop
-- cleanup ("what does this tenant still hold?"), which has no other path today.
CREATE INDEX IF NOT EXISTS idx_files_tenant
  ON files(tenant_id) WHERE tenant_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN files.tenant_id IS
  'Owning shop, derived from whichever BMS table references the file. NULL = not owned by a shop (legacy community uploads); /api/files/[id] then requires only a session, not a tenant match.';
