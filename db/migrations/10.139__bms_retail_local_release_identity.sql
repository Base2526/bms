-- 10.139 - Fail closed for conflicting Retail Local installer identities.
-- Historical admin filename inference matched the BMS-POS-Plus brand token
-- before the explicit Server marker. Preserve those rows for audit, but never
-- advertise or download them as another package type.

CREATE OR REPLACE FUNCTION bms_retail_local_filename_version(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT CASE
    WHEN p_name ~* '^BMS-(POS-Plus-)?Retail-Local-(Server-POS|Server)-(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9]*[A-Z-][0-9A-Z-]*)([.](0|[1-9][0-9]*|[0-9]*[A-Z-][0-9A-Z-]*))*))?-(windows-x64(-SMOKE-ONLY)?[.]exe|linux-x64(-SMOKE-ONLY)?[.]deb|(macos-arm64|macos-x64|arm64|x64)(-SMOKE-ONLY)?[.]pkg)$'
      OR p_name ~* '^BMS-(POS-Plus-)?Retail-Local-POS-(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9]*[A-Z-][0-9A-Z-]*)([.](0|[1-9][0-9]*|[0-9]*[A-Z-][0-9A-Z-]*))*))?-(windows-x64|windows-x86-legacy)(-SMOKE-ONLY)?[.]exe$'
      OR p_name ~* '^BMS-(POS-Plus-)?Retail-Local-POS-(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9]*[A-Z-][0-9A-Z-]*)([.](0|[1-9][0-9]*|[0-9]*[A-Z-][0-9A-Z-]*))*))?-linux-x64(-SMOKE-ONLY)?[.]deb$'
      OR p_name ~* '^BMS-(POS-Plus-)?Retail-Local-POS-(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9]*[A-Z-][0-9A-Z-]*)([.](0|[1-9][0-9]*|[0-9]*[A-Z-][0-9A-Z-]*))*))?-macos-(arm64|x64)(-SMOKE-ONLY)?[.]dmg$'
    THEN regexp_replace(
      regexp_replace(p_name, '^BMS-(POS-Plus-)?Retail-Local-(Server-POS|Server|POS)-', '', 'i'),
      '-(windows-x86-legacy|windows-x64|linux-x64|macos-arm64|macos-x64|arm64|x64)(-SMOKE-ONLY)?[.](exe|deb|pkg|dmg)$',
      '',
      'i'
    )
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION bms_retail_local_filename_package_type(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT CASE
    WHEN bms_retail_local_filename_version(p_name) IS NULL THEN NULL
    WHEN p_name ~* '^BMS-(POS-Plus-)?Retail-Local-Server-POS-' THEN 'server-pos'
    WHEN p_name ~* '^BMS-(POS-Plus-)?Retail-Local-Server-' THEN 'server'
    WHEN p_name ~* '^BMS-(POS-Plus-)?Retail-Local-POS-' THEN 'pos'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION bms_retail_local_filename_platform(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT CASE
    WHEN bms_retail_local_filename_version(p_name) IS NULL THEN NULL
    WHEN p_name ~* '-windows-x86-legacy(-SMOKE-ONLY)?[.]exe$' THEN 'windows-x86-legacy'
    WHEN p_name ~* '-windows-x64(-SMOKE-ONLY)?[.]exe$' THEN 'windows-x64'
    WHEN p_name ~* '-linux-x64(-SMOKE-ONLY)?[.]deb$' THEN 'ubuntu-x64'
    WHEN p_name ~* '-macos-arm64(-SMOKE-ONLY)?[.](pkg|dmg)$' THEN 'macos-arm64'
    WHEN p_name ~* '-macos-x64(-SMOKE-ONLY)?[.](pkg|dmg)$' THEN 'macos-x64'
    WHEN p_name ~* '-arm64(-SMOKE-ONLY)?[.]pkg$' THEN 'macos-arm64'
    WHEN p_name ~* '-x64(-SMOKE-ONLY)?[.]pkg$' THEN 'macos-x64'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION bms_retail_local_stored_path_original_name(p_path TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT regexp_replace(
    regexp_replace(regexp_replace(p_path, '^.*/', ''), '^[0-9]+-', ''),
    '-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}([.](exe|deb|pkg|dmg))$',
    '\1',
    'i'
  )
$$;

WITH duplicated_latest AS (
  SELECT platform, package_type
    FROM bms_retail_local_release_assets
   WHERE is_latest
   GROUP BY platform, package_type
  HAVING count(*) > 1
), shared_cross_package_files AS (
  SELECT file_id
    FROM bms_retail_local_release_assets
   GROUP BY file_id
  HAVING count(DISTINCT package_type) > 1
)
UPDATE bms_retail_local_release_assets AS a
   SET status = 'hidden',
       is_latest = FALSE
 WHERE (
     bms_retail_local_filename_package_type(a.original_name) IS DISTINCT FROM a.package_type
     OR bms_retail_local_filename_platform(a.original_name) IS DISTINCT FROM a.platform
     OR bms_retail_local_filename_version(a.original_name) IS DISTINCT FROM a.version
     OR NOT EXISTS (SELECT 1 FROM files AS f WHERE f.id = a.file_id)
     OR EXISTS (
       SELECT 1
         FROM files AS f
        WHERE f.id = a.file_id
          AND (
            f.original_name IS DISTINCT FROM a.original_name
            OR f.filename IS DISTINCT FROM regexp_replace(f.relpath, '^.*/', '')
            OR bms_retail_local_stored_path_original_name(f.relpath) IS DISTINCT FROM a.original_name
            OR f.size IS DISTINCT FROM a.size_bytes
            OR lower(f.checksum) IS DISTINCT FROM lower(a.sha256)
            OR f.deleted_at IS NOT NULL
          )
     )
     OR (a.platform = 'windows-x86-legacy' AND a.package_type <> 'pos')
     OR a.file_id IN (SELECT file_id FROM shared_cross_package_files)
     OR (a.platform, a.package_type) IN (SELECT platform, package_type FROM duplicated_latest)
   );

ALTER TABLE bms_retail_local_release_assets
  DROP CONSTRAINT IF EXISTS bms_retail_local_release_filename_package_check;
ALTER TABLE bms_retail_local_release_assets
  ADD CONSTRAINT bms_retail_local_release_filename_package_check
  CHECK (
    status = 'hidden'
    OR bms_retail_local_filename_package_type(original_name) IS NOT DISTINCT FROM package_type
  );

ALTER TABLE bms_retail_local_release_assets
  DROP CONSTRAINT IF EXISTS bms_retail_local_release_filename_platform_check;
ALTER TABLE bms_retail_local_release_assets
  ADD CONSTRAINT bms_retail_local_release_filename_platform_check
  CHECK (
    status = 'hidden'
    OR bms_retail_local_filename_platform(original_name) IS NOT DISTINCT FROM platform
  );

ALTER TABLE bms_retail_local_release_assets
  DROP CONSTRAINT IF EXISTS bms_retail_local_release_filename_version_check;
ALTER TABLE bms_retail_local_release_assets
  ADD CONSTRAINT bms_retail_local_release_filename_version_check
  CHECK (
    status = 'hidden'
    OR bms_retail_local_filename_version(original_name) IS NOT DISTINCT FROM version
  );

COMMENT ON FUNCTION bms_retail_local_filename_package_type(TEXT) IS
  'Canonical package marker for Retail Local release filenames; NULL means ambiguous or unsupported.';

-- ROLLBACK (manual only): drop
-- bms_retail_local_release_filename_{package,platform,version}_check and the
-- three bms_retail_local_filename_* functions plus
-- bms_retail_local_stored_path_original_name(). Do not unhide rows automatically;
-- an operator must upload and publish the correct installer bytes.
