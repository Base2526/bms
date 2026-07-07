-- =====================================================
-- PHASE 3: Role Normalization Cleanup
-- Date: TBD (Run only after Phase 2 complete)
-- Purpose: Remove deprecated users.role column and synchronization triggers
-- WARNING: This is a BREAKING CHANGE. Only run after ALL code has been migrated to use role_id
-- =====================================================

-- ⚠️ PRE-FLIGHT CHECKS ⚠️
-- Before running this migration, ensure:
-- 1. All application code uses users.role_id (not users.role)
-- 2. No queries in logs reference users.role column
-- 3. All tests pass without users.role
-- 4. You have tested this in staging environment
-- 5. You have a full database backup

BEGIN;

-- =====================================================
-- Step 1: Safety verification
-- =====================================================
DO $$
DECLARE
    users_without_role_id int;
    mismatched_roles int;
BEGIN
    -- Ensure all users have role_id
    SELECT COUNT(*) INTO users_without_role_id 
    FROM users 
    WHERE role_id IS NULL;
    
    IF users_without_role_id > 0 THEN
        RAISE EXCEPTION '% users are missing role_id! Cannot proceed with cleanup.', users_without_role_id;
    END IF;
    
    -- Check for synchronization issues
    SELECT COUNT(*) INTO mismatched_roles
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE u.role IS DISTINCT FROM r.name AND u.role IS NOT NULL;
    
    IF mismatched_roles > 0 THEN
        RAISE WARNING '% users have mismatched role/role_id values', mismatched_roles;
    END IF;
    
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Pre-Cleanup Verification';
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'All users have role_id: %', (users_without_role_id = 0);
    RAISE NOTICE 'Ready for cleanup: YES';
    RAISE NOTICE '=================================================';
END $$;

-- =====================================================
-- Step 2: Remove synchronization triggers
-- =====================================================
DROP TRIGGER IF EXISTS trg_users_sync_role_from_id ON users;
DROP TRIGGER IF EXISTS trg_users_sync_role_to_id ON users;

DROP FUNCTION IF EXISTS sync_user_role_from_id();
DROP FUNCTION IF EXISTS sync_user_role_to_id();

RAISE NOTICE 'Synchronization triggers removed';

-- =====================================================
-- Step 3: Drop deprecated view
-- =====================================================
DROP VIEW IF EXISTS v_users_with_roles;

RAISE NOTICE 'Deprecated view removed';

-- =====================================================
-- Step 4: Remove legacy columns
-- =====================================================

-- Drop the text-based role column (now replaced by role_id)
ALTER TABLE users DROP COLUMN IF EXISTS role CASCADE;

-- Drop the backup column
ALTER TABLE users DROP COLUMN IF EXISTS role_legacy;

RAISE NOTICE 'Legacy columns removed (users.role, users.role_legacy)';

-- =====================================================
-- Step 5 (Optional): Make role_id required
-- =====================================================
-- Uncomment these lines if you want to enforce role_id as required

-- -- Set default role for new users
-- ALTER TABLE users 
--     ALTER COLUMN role_id SET DEFAULT '00000000-0000-0000-0000-000000000002'::uuid;

-- -- Make role_id NOT NULL
-- ALTER TABLE users 
--     ALTER COLUMN role_id SET NOT NULL;

-- RAISE NOTICE 'role_id is now required with default "Subscriber"';

-- =====================================================
-- Step 6: Add helpful constraints and indexes
-- =====================================================

-- Ensure users are only assigned to active roles (optional)
-- ALTER TABLE users
--     ADD CONSTRAINT chk_users_active_role
--     CHECK (role_id IN (SELECT id FROM roles WHERE is_active = true));

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_users_role_id_email ON users(role_id, email);

-- Covering index for user list with role queries
CREATE INDEX IF NOT EXISTS idx_users_role_id_covering 
    ON users(role_id) 
    INCLUDE (name, email, created_at);

RAISE NOTICE 'Performance indexes added';

-- =====================================================
-- Step 7: Update statistics
-- =====================================================
ANALYZE users;
ANALYZE roles;

RAISE NOTICE 'Table statistics updated';

-- =====================================================
-- Step 8: Create new optimized view
-- =====================================================
CREATE OR REPLACE VIEW v_users_with_role_details AS
SELECT 
    u.id,
    u.name,
    u.email,
    u.username,
    u.avatar,
    u.phone,
    u.created_at,
    u.updated_at,
    u.language,
    u.notifications_enabled,
    -- Role details
    u.role_id,
    r.name as role_name,
    r.description as role_description,
    r.is_active as role_is_active
FROM users u
INNER JOIN roles r ON u.role_id = r.id;

COMMENT ON VIEW v_users_with_role_details IS 'Optimized view combining users and roles (post-migration)';

-- =====================================================
-- Step 9: Verification and completion report
-- =====================================================
DO $$
DECLARE
    total_users int;
    total_roles int;
    role_dist record;
BEGIN
    SELECT COUNT(*) INTO total_users FROM users;
    SELECT COUNT(*) INTO total_roles FROM roles;
    
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Phase 3 Cleanup Complete!';
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Total Users: %', total_users;
    RAISE NOTICE 'Total Roles: %', total_roles;
    RAISE NOTICE 'Legacy columns removed: users.role, users.role_legacy';
    RAISE NOTICE 'Synchronization triggers removed';
    RAISE NOTICE '-------------------------------------------------';
    RAISE NOTICE 'Current Role Distribution:';
    
    FOR role_dist IN (
        SELECT r.name, COUNT(u.id) as user_count
        FROM roles r
        LEFT JOIN users u ON u.role_id = r.id
        GROUP BY r.name
        ORDER BY user_count DESC
    ) LOOP
        RAISE NOTICE '  %: % users', role_dist.name, role_dist.user_count;
    END LOOP;
    
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Migration Complete - Schema Fully Normalized!';
    RAISE NOTICE '=================================================';
END $$;

COMMIT;

-- =====================================================
-- Post-Cleanup Notes
-- =====================================================
-- ✅ users.role column is now completely removed
-- ✅ All users must use users.role_id + JOIN to roles table
-- ✅ No backward compatibility with old role text system
-- ✅ Future roles can be added via INSERT INTO roles
-- ✅ Schema is fully normalized

-- Next steps:
-- 1. Remove any deprecated GraphQL fields (user.role)
-- 2. Update API documentation
-- 3. Update team documentation
-- 4. Archive migration scripts
-- 5. Consider implementing role_permissions table (see plan)
-- =====================================================
