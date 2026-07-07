# Quick Start Guide: Role Normalization Migration

## 🚀 TL;DR

Migrate from `users.role` (text) to normalized `roles` table in 3 phases without downtime.

---

## Prerequisites

```bash
# 1. Backup database
pg_dump -U postgres -d jachoei -F c -f backup_before_role_migration_$(date +%Y%m%d).dump

# 2. Verify backup
pg_restore --list backup_before_role_migration_*.dump | head -20

# 3. Connect to database
psql -U postgres -d jachoei
```

---

## Phase 1: Run Migration (No Code Changes Required)

### Execute Migration:
```bash
# From project root
psql -U postgres -d jachoei -f db/migrations/001_normalize_roles_phase1.sql
```

### Expected Output:
```
=================================================
Role Migration Phase 1 Complete
=================================================
Total Users: 1234
Migrated Users: 1234 (100.00%)
Roles Created: 2
-------------------------------------------------
Role Distribution:
  Subscriber: 1200 users
  Administrator: 34 users
=================================================
```

### Verify Migration:
```sql
-- All users should have role_id
SELECT COUNT(*) FROM users WHERE role_id IS NULL;
-- Expected: 0

-- Test synchronization (update via role_id)
BEGIN;
UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'Administrator') 
WHERE email = 'test@example.com';
SELECT role FROM users WHERE email = 'test@example.com';
-- Expected: 'Administrator'
ROLLBACK;

-- Test synchronization (update via role text)
BEGIN;
UPDATE users SET role = 'Subscriber' WHERE email = 'test@example.com';
SELECT r.name FROM users u 
JOIN roles r ON u.role_id = r.id 
WHERE u.email = 'test@example.com';
-- Expected: 'Subscriber'
ROLLBACK;
```

### Rollback (if needed):
```bash
psql -U postgres -d jachoei -f db/migrations/001_normalize_roles_phase1_ROLLBACK.sql
```

---

## Phase 2: Update Application Code (2-3 weeks)

### Update GraphQL Schema:
```graphql
type Role {
  id: ID!
  name: String!
  description: String
  isActive: Boolean!
}

type User {
  id: ID!
  name: String!
  role: String! @deprecated(reason: "Use roleDetails instead")
  roleId: ID
  roleDetails: Role
}
```

### Update Resolvers:
```javascript
// Use JOIN to get role details
const user = await db.query(`
  SELECT u.*, r.name as role_name, r.description 
  FROM users u
  LEFT JOIN roles r ON u.role_id = r.id
  WHERE u.id = $1
`, [userId]);
```

### Monitor Usage:
```sql
-- Find queries still using users.role
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
WHERE query ILIKE '%users%role%'
  AND query NOT ILIKE '%role_id%'
ORDER BY calls DESC;
```

---

## Phase 3: Cleanup (After All Code Migrated)

⚠️ **WARNING:** This removes `users.role` column permanently!

### Pre-Cleanup Checklist:
- [ ] All code uses `role_id` (not `role`)
- [ ] Logs show zero usage of `users.role` for 1+ week
- [ ] All tests pass
- [ ] Tested in staging

### Execute Cleanup:
```bash
psql -U postgres -d jachoei -f db/migrations/002_normalize_roles_phase3_cleanup.sql
```

---

## Common Tasks

### Add New Role:
```sql
INSERT INTO roles (name, description) 
VALUES ('Moderator', 'Can moderate content and users');
```

### Assign Role to User:
```sql
-- Using role_id (preferred)
UPDATE users 
SET role_id = (SELECT id FROM roles WHERE name = 'Moderator')
WHERE email = 'user@example.com';

-- Using role text (Phase 1 & 2 only - trigger will sync)
UPDATE users 
SET role = 'Moderator'
WHERE email = 'user@example.com';
```

### Check Role Distribution:
```sql
SELECT r.name, COUNT(u.id) as user_count
FROM roles r
LEFT JOIN users u ON u.role_id = r.id
GROUP BY r.name
ORDER BY user_count DESC;
```

### List Users by Role:
```sql
SELECT u.name, u.email, r.name as role
FROM users u
JOIN roles r ON u.role_id = r.id
WHERE r.name = 'Administrator';
```

---

## Troubleshooting

### Problem: Migration fails with "users have no role_id"
**Solution:** Check for NULL role values:
```sql
SELECT * FROM users WHERE role IS NULL OR role = '';
-- Update these users before retrying migration
UPDATE users SET role = 'Subscriber' WHERE role IS NULL;
```

### Problem: Synchronization not working
**Solution:** Check triggers are installed:
```sql
SELECT tgname FROM pg_trigger WHERE tgrelid = 'users'::regclass;
-- Should see: trg_users_sync_role_from_id, trg_users_sync_role_to_id
```

### Problem: Performance degradation
**Solution:** Check indexes:
```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename IN ('users', 'roles');

-- Add missing indexes
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);
```

### Problem: Role mismatch detected
**Solution:** Re-sync manually:
```sql
-- Sync from role_id to role
UPDATE users u
SET role = r.name
FROM roles r
WHERE u.role_id = r.id;

-- Or sync from role to role_id
UPDATE users u
SET role_id = r.id
FROM roles r
WHERE u.role = r.name;
```

---

## Useful Queries

### Migration Status:
```sql
SELECT 
  COUNT(*) FILTER (WHERE role_id IS NOT NULL) as with_role_id,
  COUNT(*) FILTER (WHERE role IS NOT NULL) as with_role_text,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE role_id IS NOT NULL) / COUNT(*), 2) as pct_migrated
FROM users;
```

### Data Consistency Check:
```sql
-- Find users with mismatched role/role_id
SELECT u.id, u.email, u.role as role_text, r.name as role_from_id
FROM users u
LEFT JOIN roles r ON u.role_id = r.id
WHERE u.role IS DISTINCT FROM r.name;
```

### Performance Comparison:
```sql
-- Before migration (text comparison)
EXPLAIN ANALYZE
SELECT * FROM users WHERE role = 'Administrator';

-- After migration (indexed FK)
EXPLAIN ANALYZE
SELECT u.* FROM users u
JOIN roles r ON u.role_id = r.id
WHERE r.name = 'Administrator';
```

---

## File Reference

| File | Purpose | When to Run |
|------|---------|-------------|
| `001_normalize_roles_phase1.sql` | Create roles table, migrate data | Phase 1 start |
| `001_normalize_roles_phase1_ROLLBACK.sql` | Undo Phase 1 changes | If Phase 1 fails |
| `002_normalize_roles_phase3_cleanup.sql` | Remove legacy columns | After Phase 2 complete |
| `ROLE_NORMALIZATION_PLAN.md` | Complete migration guide | Reference throughout |

---

## Timeline

| Phase | Duration | Downtime | Rollback |
|-------|----------|----------|----------|
| Phase 1 | 1-2 days | None | Easy |
| Phase 2 | 2-3 weeks | None | Easy |
| Phase 3 | 1 week | None | Hard |

---

## Support

**Questions?** Read [ROLE_NORMALIZATION_PLAN.md](./ROLE_NORMALIZATION_PLAN.md) for detailed information.

**Issues?** Check the Troubleshooting section above.
