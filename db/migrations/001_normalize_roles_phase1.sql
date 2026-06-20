BEGIN;

-- =====================================================
-- Helper: updated_at function
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Step 1: Create roles table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.roles (
    id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    name text NOT NULL UNIQUE,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT roles_name_not_empty CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_roles_name 
ON public.roles(name);

CREATE INDEX IF NOT EXISTS idx_roles_active 
ON public.roles(is_active) 
WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_roles_updated_at ON public.roles;

CREATE TRIGGER trg_roles_updated_at
BEFORE UPDATE ON public.roles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.roles IS 'Normalized roles table - replaces text-based users.role column';
COMMENT ON COLUMN public.roles.name IS 'Role name - must match existing users.role values for backward compatibility';
COMMENT ON COLUMN public.roles.is_active IS 'Inactive roles cannot be assigned to new users';

-- =====================================================
-- Step 2: Seed initial roles
-- =====================================================
INSERT INTO public.roles (id, name, description, created_at, updated_at)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'Administrator', 'Full system access with all permissions', now(), now()),
    ('00000000-0000-0000-0000-000000000002', 'Subscriber', 'Standard user with basic permissions', now(), now())
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    updated_at = now();

-- Create roles from existing users.role values
INSERT INTO public.roles (name, description, created_at, updated_at)
SELECT DISTINCT
    trim(u.role) AS name,
    'Migrated from legacy role: ' || trim(u.role) AS description,
    now(),
    now()
FROM public.users u
WHERE u.role IS NOT NULL
  AND trim(u.role) <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.name = trim(u.role)
  )
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- Step 3: Add role_id and role_legacy columns
-- =====================================================
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS role_id uuid;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS role_legacy text;

CREATE INDEX IF NOT EXISTS idx_users_role_id
ON public.users(role_id);

COMMENT ON COLUMN public.users.role_id IS 'Foreign key to roles table - new normalized approach';
COMMENT ON COLUMN public.users.role_legacy IS 'Backup of original role value before migration';

-- =====================================================
-- Step 4: Backup and migrate existing data
-- =====================================================
UPDATE public.users
SET role_legacy = role
WHERE role_legacy IS NULL;

UPDATE public.users u
SET role_id = r.id
FROM public.roles r
WHERE trim(u.role) = r.name
  AND u.role_id IS NULL;

-- Assign default Subscriber role if role_id still null
UPDATE public.users u
SET role_id = r.id,
    role = r.name
FROM public.roles r
WHERE r.name = 'Subscriber'
  AND u.role_id IS NULL;

-- =====================================================
-- Step 5: Add FK safely
-- =====================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_users_role_id'
          AND conrelid = 'public.users'::regclass
    ) THEN
        ALTER TABLE public.users
        ADD CONSTRAINT fk_users_role_id
        FOREIGN KEY (role_id)
        REFERENCES public.roles(id)
        ON DELETE SET NULL;
    END IF;
END $$;

-- =====================================================
-- Step 6: Sync trigger function
-- ใช้ function เดียว ป้องกัน trigger ตีกัน
-- =====================================================
CREATE OR REPLACE FUNCTION public.sync_user_role_and_role_id()
RETURNS trigger AS $$
DECLARE
    v_role_name text;
    v_role_id uuid;
BEGIN
    -- INSERT case
    IF TG_OP = 'INSERT' THEN
        IF NEW.role_id IS NOT NULL THEN
            SELECT name INTO v_role_name
            FROM public.roles
            WHERE id = NEW.role_id;

            IF v_role_name IS NOT NULL THEN
                NEW.role = v_role_name;
            END IF;

        ELSIF NEW.role IS NOT NULL AND trim(NEW.role) <> '' THEN
            SELECT id INTO v_role_id
            FROM public.roles
            WHERE name = trim(NEW.role);

            IF v_role_id IS NULL THEN
                INSERT INTO public.roles (name, description, created_at, updated_at)
                VALUES (trim(NEW.role), 'Auto-created from legacy role column', now(), now())
                ON CONFLICT (name) DO UPDATE SET updated_at = now()
                RETURNING id INTO v_role_id;
            END IF;

            NEW.role_id = v_role_id;

        ELSE
            SELECT id, name INTO NEW.role_id, NEW.role
            FROM public.roles
            WHERE name = 'Subscriber';
        END IF;

        RETURN NEW;
    END IF;

    -- UPDATE case: role_id changed
    IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
        SELECT name INTO v_role_name
        FROM public.roles
        WHERE id = NEW.role_id;

        IF v_role_name IS NOT NULL THEN
            NEW.role = v_role_name;
        END IF;

        RETURN NEW;
    END IF;

    -- UPDATE case: role text changed
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        IF NEW.role IS NULL OR trim(NEW.role) = '' THEN
            SELECT id, name INTO NEW.role_id, NEW.role
            FROM public.roles
            WHERE name = 'Subscriber';
        ELSE
            SELECT id INTO v_role_id
            FROM public.roles
            WHERE name = trim(NEW.role);

            IF v_role_id IS NULL THEN
                INSERT INTO public.roles (name, description, created_at, updated_at)
                VALUES (trim(NEW.role), 'Auto-created from legacy role column', now(), now())
                ON CONFLICT (name) DO UPDATE SET updated_at = now()
                RETURNING id INTO v_role_id;
            END IF;

            NEW.role = trim(NEW.role);
            NEW.role_id = v_role_id;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_sync_role_from_id ON public.users;
DROP TRIGGER IF EXISTS trg_users_sync_role_to_id ON public.users;
DROP TRIGGER IF EXISTS trg_users_sync_role_and_role_id ON public.users;

CREATE TRIGGER trg_users_sync_role_and_role_id
BEFORE INSERT OR UPDATE OF role, role_id ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_user_role_and_role_id();

-- =====================================================
-- Step 7: Create transition view
-- =====================================================
CREATE OR REPLACE VIEW public.v_users_with_roles AS
SELECT
    u.id,
    u.name,
    u.email,
    u.username,
    u.role AS role_text_legacy,
    u.role_id,
    r.name AS role_name,
    r.description AS role_description,
    r.is_active AS role_is_active,
    u.created_at,
    u.updated_at
FROM public.users u
LEFT JOIN public.roles r ON u.role_id = r.id;

COMMENT ON VIEW public.v_users_with_roles IS 'Convenient view combining users and roles - use during migration period';

-- =====================================================
-- Step 8: Validate result
-- =====================================================
DO $$
DECLARE
    total_users int;
    migrated_users int;
    migration_pct numeric;
    rec RECORD;
BEGIN
    SELECT COUNT(*) INTO total_users FROM public.users;
    SELECT COUNT(*) INTO migrated_users FROM public.users WHERE role_id IS NOT NULL;

    IF total_users > 0 THEN
        migration_pct := ROUND((migrated_users::numeric / total_users::numeric) * 100, 2);
    ELSE
        migration_pct := 100;
    END IF;

    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Role Migration Phase 1 Complete';
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Total Users: %', total_users;
    RAISE NOTICE 'Migrated Users: % (%%%)', migrated_users, migration_pct;
    RAISE NOTICE 'Roles Created: %', (SELECT COUNT(*) FROM public.roles);
    RAISE NOTICE '-------------------------------------------------';
    RAISE NOTICE 'Role Distribution:';

    FOR rec IN (
        SELECT r.name, COUNT(u.id) AS user_count
        FROM public.roles r
        LEFT JOIN public.users u ON u.role_id = r.id
        GROUP BY r.name
        ORDER BY user_count DESC, r.name ASC
    ) LOOP
        RAISE NOTICE '  %: % users', rec.name, rec.user_count;
    END LOOP;

    RAISE NOTICE '=================================================';
END $$;

COMMIT;