-- Queue-board advertising is presentation data. It never changes a queue, sale or price.
BEGIN;

ALTER TABLE bms_locations
  ADD COLUMN IF NOT EXISTS queue_board_media_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS queue_board_default_file_id INTEGER,
  ADD COLUMN IF NOT EXISTS queue_board_media_interval_seconds INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS queue_board_media_transition TEXT NOT NULL DEFAULT 'FADE',
  ADD COLUMN IF NOT EXISTS queue_board_media_version INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'bms_locations'::regclass
    AND conname = 'bms_locations_queue_board_interval_check') THEN
    ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_queue_board_interval_check
      CHECK (queue_board_media_interval_seconds BETWEEN 4 AND 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'bms_locations'::regclass
    AND conname = 'bms_locations_queue_board_transition_check') THEN
    ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_queue_board_transition_check
      CHECK (queue_board_media_transition IN ('FADE', 'SLIDE', 'CUT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'bms_locations'::regclass
    AND conname = 'bms_locations_queue_board_default_file_fk') THEN
    ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_queue_board_default_file_fk
      FOREIGN KEY (tenant_id, queue_board_default_file_id)
      REFERENCES files(tenant_id, id) ON DELETE SET NULL (queue_board_default_file_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bms_queue_board_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  file_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 7),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, sort_order),
  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id) ON DELETE RESTRICT,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_bms_queue_board_media_branch
  ON bms_queue_board_media (tenant_id, location_id, sort_order);

ALTER TABLE bms_queue_board_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_queue_board_media FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_queue_board_media_tenant_isolation ON bms_queue_board_media;
CREATE POLICY bms_queue_board_media_tenant_isolation ON bms_queue_board_media
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON bms_queue_board_media TO bms_app;

-- bms_app deliberately has no SELECT grant on files. Expose only a tenant-bound
-- yes/no check for the small set of published image IDs, never file metadata.
CREATE OR REPLACE FUNCTION public.bms_queue_board_images_valid(p_tenant_id UUID, p_file_ids INTEGER[])
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT p_tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid
     AND cardinality(p_file_ids) <= 9
     AND cardinality(p_file_ids) = (SELECT count(DISTINCT id) FROM unnest(p_file_ids) AS ids(id))
     AND cardinality(p_file_ids) = (
       SELECT count(*) FROM public.files
        WHERE tenant_id = p_tenant_id AND id = ANY(p_file_ids)
          AND deleted_at IS NULL AND visibility = 'public'
          AND mimetype IN ('image/jpeg', 'image/png', 'image/webp')
     );
$$;
REVOKE ALL ON FUNCTION public.bms_queue_board_images_valid(UUID, INTEGER[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_queue_board_images_valid(UUID, INTEGER[]) TO bms_app;

COMMENT ON TABLE bms_queue_board_media IS
  'Bounded, branch-scoped queue-board image playlist. Published files are public marketing media; queue state remains separate.';
COMMENT ON COLUMN bms_locations.queue_board_default_file_id IS
  'Image shown when no eligible queue-board promotion can be displayed.';

COMMIT;

-- ROLLBACK (manual): DROP TABLE bms_queue_board_media; then drop the five
-- queue_board_* columns from bms_locations. This discards published media settings.
