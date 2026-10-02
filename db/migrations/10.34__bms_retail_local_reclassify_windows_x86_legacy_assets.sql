-- 10.34 - Repair legacy Windows x86 POS assets uploaded as windows-x64
-- Older admin UI inferred every .exe as windows-x64. Only POS assets whose
-- filename explicitly identifies x86/ia32 are moved; x86_64 remains x64.

-- If a correctly classified x86 release is already latest, keep it latest and
-- demote the old misclassified row before moving it to avoid the partial unique
-- index on (platform, package_type) WHERE is_latest.
UPDATE bms_retail_local_release_assets AS misplaced
   SET is_latest = FALSE,
       status = CASE WHEN status = 'latest' THEN 'supported' ELSE status END
 WHERE misplaced.platform = 'windows-x64'
   AND misplaced.package_type = 'pos'
   AND lower(misplaced.original_name) ~ '(^|[-_])(windows[-_])?(x86|ia32)([-_.]|$)'
   AND lower(misplaced.original_name) !~ '(^|[-_])(windows[-_])?x86[_-]?64([-_.]|$)'
   AND misplaced.is_latest
   AND EXISTS (
     SELECT 1
       FROM bms_retail_local_release_assets AS current_x86
      WHERE current_x86.platform = 'windows-x86-legacy'
        AND current_x86.package_type = 'pos'
        AND current_x86.is_latest
   );

UPDATE bms_retail_local_release_assets
   SET platform = 'windows-x86-legacy'
 WHERE platform = 'windows-x64'
   AND package_type = 'pos'
   AND lower(original_name) ~ '(^|[-_])(windows[-_])?(x86|ia32)([-_.]|$)'
   AND lower(original_name) !~ '(^|[-_])(windows[-_])?x86[_-]?64([-_.]|$)';
