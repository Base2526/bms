# Database Migrations

This directory contains database migration scripts for the Jachoei project.

---

## 📁 Directory Structure

```
db/migrations/
├── README.md                                    ← You are here
├── QUICK_START.md                              ← Start here for quick reference
├── ROLE_NORMALIZATION_PLAN.md                  ← Complete migration guide
├── SCHEMA_DIAGRAM.md                           ← Visual schema evolution
├── 001_normalize_roles_phase1.sql              ← Phase 1: Create roles table
├── 001_normalize_roles_phase1_ROLLBACK.sql     ← Phase 1: Rollback script
└── 002_normalize_roles_phase3_cleanup.sql      ← Phase 3: Remove legacy columns
```

---

## 🎯 Current Migration: Role Normalization

**Status:** Ready to deploy (Phase 1)  
**Goal:** Migrate from `users.role` (text) to normalized `roles` table  
**Impact:** Zero downtime, fully backward compatible

### Quick Links
- **New to this migration?** Read [QUICK_START.md](./QUICK_START.md)
- **Need detailed info?** Read [ROLE_NORMALIZATION_PLAN.md](./ROLE_NORMALIZATION_PLAN.md)
- **Want to visualize?** Read [SCHEMA_DIAGRAM.md](./SCHEMA_DIAGRAM.md)

---

## 🚀 Getting Started

### 1. Backup First!
```bash
pg_dump -U postgres -d jachoei -F c -f backup_$(date +%Y%m%d_%H%M%S).dump
```

### 2. Run Phase 1 Migration
```bash
psql -U postgres -d jachoei -f db/migrations/001_normalize_roles_phase1.sql
```

### 3. Verify Success
```sql
-- Should show 100% migration
SELECT 
  COUNT(*) FILTER (WHERE role_id IS NOT NULL) as migrated,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE role_id IS NOT NULL) / COUNT(*), 2) as pct
FROM users;
```

---

## 📋 Migration Phases

| Phase | Duration | Downtime | Changes Required |
|-------|----------|----------|------------------|
| **Phase 1** | 1-2 days | None | None (DB only) |
| **Phase 2** | 2-3 weeks | None | Application code |
| **Phase 3** | 1 week | None | Cleanup only |

### Phase 1: Schema Migration ✅ Ready
- Create `roles` table
- Add `users.role_id` column
- Install synchronization triggers
- Migrate existing data
- **No application changes needed**

### Phase 2: Application Migration (TBD)
- Update GraphQL schema
- Update resolvers to use `role_id`
- Add `roleDetails` field
- Gradually migrate queries
- **Triggers keep everything synchronized**

### Phase 3: Cleanup (TBD)
- Remove `users.role` column
- Remove synchronization triggers
- Update documentation
- **Only after all code migrated**

---

## 🔄 What Makes This Safe?

### Backward Compatibility
During Phase 1 & 2, **both** `users.role` and `users.role_id` work:

```sql
-- Old code (still works)
UPDATE users SET role = 'Administrator' WHERE id = $1;

-- New code (preferred)
UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'Administrator') WHERE id = $1;
```

Triggers automatically keep them synchronized!

### Rollback Capability
Can rollback Phase 1 anytime:
```bash
psql -U postgres -d jachoei -f db/migrations/001_normalize_roles_phase1_ROLLBACK.sql
```

---

## 📊 Schema Changes

### Before:
```sql
CREATE TABLE users (
  id uuid,
  name text,
  role text DEFAULT 'Subscriber',  -- Just text, no validation
  ...
);
```

### After Phase 1:
```sql
CREATE TABLE users (
  id uuid,
  name text,
  role text,           -- Kept for compatibility (synced via trigger)
  role_id uuid,        -- New: FK to roles table
  ...
);

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  name text UNIQUE,
  description text,
  is_active boolean,
  ...
);
```

### After Phase 3:
```sql
CREATE TABLE users (
  id uuid,
  name text,
  role_id uuid NOT NULL REFERENCES roles(id),  -- Clean normalized FK
  ...
);

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  name text UNIQUE,
  description text,
  is_active boolean,
  ...
);
```

---

## 🛠️ Common Operations

### Add New Role
```sql
INSERT INTO roles (name, description) 
VALUES ('Moderator', 'Can moderate content');
```

### Assign Role to User
```sql
-- Phase 1 & 2: Either works
UPDATE users SET role = 'Moderator' WHERE id = $1;
-- OR
UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'Moderator') WHERE id = $1;

-- Phase 3: Use role_id only
UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'Moderator') WHERE id = $1;
```

### List Users by Role
```sql
SELECT u.name, u.email
FROM users u
JOIN roles r ON u.role_id = r.id
WHERE r.name = 'Administrator';
```

---

## 🔍 Health Checks

### Migration Status
```sql
-- Check if all users migrated
SELECT COUNT(*) FROM users WHERE role_id IS NULL;
-- Should be 0 after Phase 1

-- Role distribution
SELECT r.name, COUNT(u.id) as user_count
FROM roles r
LEFT JOIN users u ON u.role_id = r.id
GROUP BY r.name
ORDER BY user_count DESC;
```

### Synchronization Status
```sql
-- Check for mismatches (should be 0)
SELECT COUNT(*) FROM users u
LEFT JOIN roles r ON u.role_id = r.id
WHERE u.role IS DISTINCT FROM r.name;
```

### Trigger Status
```sql
-- Verify triggers installed (Phase 1 & 2 only)
SELECT tgname FROM pg_trigger WHERE tgrelid = 'users'::regclass;
-- Should see: trg_users_sync_role_from_id, trg_users_sync_role_to_id
```

---

## 📚 Documentation

### For Developers
- [QUICK_START.md](./QUICK_START.md) - Commands and quick reference
- [SCHEMA_DIAGRAM.md](./SCHEMA_DIAGRAM.md) - Visual schema evolution

### For Database Admins
- [ROLE_NORMALIZATION_PLAN.md](./ROLE_NORMALIZATION_PLAN.md) - Complete detailed plan
- [001_normalize_roles_phase1.sql](./001_normalize_roles_phase1.sql) - Migration script
- [001_normalize_roles_phase1_ROLLBACK.sql](./001_normalize_roles_phase1_ROLLBACK.sql) - Rollback script

### For Project Managers
- Migration is **3 phases over ~5 weeks**
- **Zero downtime** at all phases
- **No breaking changes** until Phase 3
- Can **rollback safely** during Phase 1 & 2

---

## 🆘 Troubleshooting

### Migration Fails?
1. Check PostgreSQL version (requires 12+)
2. Ensure `uuid-ossp` extension installed
3. Verify no NULL role values: `SELECT * FROM users WHERE role IS NULL`
4. Check logs: `tail -f /var/log/postgresql/postgresql.log`

### Performance Issues?
1. Verify indexes: `SELECT indexname FROM pg_indexes WHERE tablename IN ('users', 'roles')`
2. Run ANALYZE: `ANALYZE users; ANALYZE roles;`
3. Check query plan: `EXPLAIN ANALYZE SELECT ...`

### Need Help?
- Read the [troubleshooting section](./ROLE_NORMALIZATION_PLAN.md#troubleshooting) in the plan
- Check the [common queries](./QUICK_START.md#common-tasks) guide
- Review [schema diagram](./SCHEMA_DIAGRAM.md) for understanding

---

## 📈 Benefits After Migration

✅ **Referential Integrity** - FK constraints prevent invalid roles  
✅ **Type Safety** - UUID instead of free-form text  
✅ **No Typos** - Can't insert "Adminstrator" or "admin"  
✅ **Easy to Extend** - Add new roles with simple INSERT  
✅ **Rich Metadata** - Store role descriptions, permissions, etc.  
✅ **Better Performance** - Indexed FK lookups vs text scans  
✅ **Audit Capability** - Can track role changes over time  

---

## 🔐 Security Notes

- Role names in `roles` table are considered trusted data
- FK constraint ensures only valid roles can be assigned
- Consider adding permission table (see future enhancements)
- Audit role changes with revision tracking

---

## 📝 Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2026-05-30 | 1.0.0 | Initial migration scripts created |

---

## 🤝 Contributing

When adding new migrations:

1. **Number sequentially:** `003_description.sql`
2. **Provide rollback:** `003_description_ROLLBACK.sql`
3. **Document changes:** Update this README
4. **Test first:** Run in staging environment
5. **Backup always:** Never skip backups

### Migration Naming Convention
```
<number>_<description>_<phase>.sql
├── 001_normalize_roles_phase1.sql
├── 002_normalize_roles_phase3_cleanup.sql
└── 003_add_permissions_table.sql
```

---

## 📞 Support

**Questions?** Read the documentation:
- [QUICK_START.md](./QUICK_START.md)
- [ROLE_NORMALIZATION_PLAN.md](./ROLE_NORMALIZATION_PLAN.md)

**Found a bug?** Open an issue with:
- PostgreSQL version
- Error message
- Steps to reproduce

---

**Last Updated:** 2026-05-30  
**PostgreSQL Version:** 12+  
**Status:** Phase 1 Ready ✅
