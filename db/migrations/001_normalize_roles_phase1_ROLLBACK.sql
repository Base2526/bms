-- =====================================================
-- ROLLBACK: Role Normalization Migration Phase 1
-- Date: 2026-05-30
-- Purpose: Safely rollback Phase 1 role normalization changes
-- WARNING: Only run this if you need to completely revert the migration
-- =====================================================

BEGIN;

-- =====================================================
-- Step 1: Verify no critical data loss will occur
-- =====================================================
DO $$
DECLARE
    users_with_role_id int;
    users_with_role_text int;
BEGIN
    SELECT COUNT(*) INTO users_with_role_id FROM users WHERE role_id IS NOT NULL;
    SELECT COUNT(*) INTO users_with_role_text FROM users WHERE role IS NOT NULL;
    
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Pre-Rollback Status Check';
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Users with role_id: %', users_with_role_id;
    RAISE NOTICE 'Users with role text: %', users_with_role_text;
    RAISE NOTICE '=================================================';
    
    IF users_with_role_id > 0 AND users_with_role_text = 0 THEN
        RAISE WARNING 'Users have role_id but no role text - will restore from role_id';
    END IF;
END $$;

-- =====================================================
-- Step 2: Ensure users.role is populated before removing role_id
-- =====================================================

-- Restore role text from role_id (in case it was cleared)
UPDATE users u
SET role = r.name
FROM roles r
WHERE u.role_id = r.id
    AND (u.role IS NULL OR u.role = '');

-- Restore from role_legacy backup if available
UPDATE users
SET role = role_legacy
WHERE role IS NULL 
    AND role_legacy IS NOT NULL;

-- Verify all users have a role text value
DO $$
DECLARE
    users_without_role int;
BEGIN
    SELECT COUNT(*) INTO users_without_role 
    FROM users 
    WHERE role IS NULL;
    
    IF users_without_role > 0 THEN
        RAISE WARNING '% users have no role value - setting to default "Subscriber"', users_without_role;
        UPDATE users SET role = 'Subscriber' WHERE role IS NULL;
    END IF;
END $$;

-- =====================================================
-- Step 3: Remove synchronization triggers
-- =====================================================
DROP TRIGGER IF EXISTS trg_users_sync_role_from_id ON users;
DROP TRIGGER IF EXISTS trg_users_sync_role_to_id ON users;

DROP FUNCTION IF EXISTS sync_user_role_from_id();
DROP FUNCTION IF EXISTS sync_user_role_to_id();

RAISE NOTICE 'Synchronization triggers removed';

-- =====================================================
-- Step 4: Drop view
-- =====================================================
DROP VIEW IF EXISTS v_users_with_roles;

RAISE NOTICE 'Views removed';

-- =====================================================
-- Step 5: Remove foreign key and drop role_id column
-- =====================================================

-- Remove foreign key constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_role_id;

-- Drop indexes
DROP INDEX IF EXISTS idx_users_role_id;

-- Remove role_id and role_legacy columns
ALTER TABLE users DROP COLUMN IF EXISTS role_id;
ALTER TABLE users DROP COLUMN IF EXISTS role_legacy;

RAISE NOTICE 'Users table columns removed (role_id, role_legacy)';

-- =====================================================
-- Step 6: Drop roles table and related objects
-- =====================================================

-- Drop indexes
DROP INDEX IF EXISTS idx_roles_active;
DROP INDEX IF EXISTS idx_roles_name;

-- Drop trigger
DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles;

-- Drop table
DROP TABLE IF EXISTS roles CASCADE;

RAISE NOTICE 'Roles table and related objects removed';

-- =====================================================
-- Step 7: Verification
-- =====================================================
DO $$
DECLARE
    users_with_role int;
    total_users int;
BEGIN
    SELECT COUNT(*) INTO total_users FROM users;
    SELECT COUNT(*) INTO users_with_role FROM users WHERE role IS NOT NULL;
    
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Rollback Complete';
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Total Users: %', total_users;
    RAISE NOTICE 'Users with role text: %', users_with_role;
    RAISE NOTICE 'Database restored to pre-migration state';
    RAISE NOTICE '=================================================';
    
    IF users_with_role < total_users THEN
        RAISE WARNING '% users are missing role values!', (total_users - users_with_role);
    END IF;
END $$;

COMMIT;

-- =====================================================
-- Post-Rollback Notes
-- =====================================================
-- 1. The database is now back to using users.role (text) column only
-- 2. All role_id references have been removed
-- 3. The roles table has been dropped
-- 4. Application code must use users.role column
-- 5. Check your application logs for any errors after rollback
-- =====================================================
