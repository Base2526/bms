# Role Normalization Migration Plan

**Date:** May 30, 2026  
**Project:** Jachoei Database Schema Normalization  
**Goal:** Migrate from text-based `users.role` to normalized `roles` table with zero downtime

---

## Overview

This migration transitions the user role system from a text-based column (`users.role`) to a proper normalized structure with a dedicated `roles` table. The migration is designed to be **100% backward compatible** and can be rolled back at any phase.

### Current State
```sql
users.role text DEFAULT 'Subscriber'::text NOT NULL
```

### Target State
```sql
roles table (id, name, description, ...)
users.role_id uuid REFERENCES roles(id)
users.role text (deprecated, maintained for compatibility)
```

---

## Three-Phase Migration Strategy

### 📋 Phase 1: Schema & Data Migration (Week 1)
**Duration:** 1-2 days  
**Downtime:** None  
**Rollback Risk:** Low

#### What Happens:
1. ✅ Create `roles` table with initial data
2. ✅ Add `users.role_id` column (nullable)
3. ✅ Migrate existing `users.role` → `users.role_id`
4. ✅ Add foreign key constraint
5. ✅ Install synchronization triggers (keep both columns in sync)
6. ✅ Keep `users.role` column for backward compatibility

#### Database Changes:
- **New Tables:** `roles`
- **New Columns:** `users.role_id`, `users.role_legacy`
- **New Triggers:** `sync_user_role_from_id`, `sync_user_role_to_id`
- **New Views:** `v_users_with_roles`

#### Migration Files:
- **Run:** `001_normalize_roles_phase1.sql`
- **Rollback:** `001_normalize_roles_phase1_ROLLBACK.sql`

#### Success Criteria:
- [ ] All existing users have `role_id` populated
- [ ] `users.role` and `users.role_id` are synchronized
- [ ] No application errors
- [ ] All existing queries work unchanged

#### Application Impact:
- ✅ **No code changes required**
- ✅ Existing queries using `users.role` continue working
- ✅ Both read and write operations are synchronized

#### Testing Checklist:
```bash
# Verify migration
psql -d jachoei -c "SELECT COUNT(*) FROM users WHERE role_id IS NULL;"
# Should return 0

# Test synchronization: update via role_id
psql -d jachoei -c "
UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'Administrator') 
WHERE email = 'test@example.com';
SELECT role FROM users WHERE email = 'test@example.com';
"
# role should be 'Administrator'

# Test synchronization: update via role
psql -d jachoei -c "
UPDATE users SET role = 'Subscriber' WHERE email = 'test@example.com';
SELECT r.name FROM users u JOIN roles r ON u.role_id = r.id 
WHERE u.email = 'test@example.com';
"
# Should return 'Subscriber'
```

---

### 🔧 Phase 2: Application Code Migration (Week 2-4)
**Duration:** 2-3 weeks  
**Downtime:** None  
**Rollback Risk:** Low (can still use Phase 1 rollback if needed)

#### What Happens:
1. 🔄 Update GraphQL schema to include `role` object
2. 🔄 Update resolvers to use `users.role_id` + JOIN
3. 🔄 Update mutations to set `role_id` instead of `role` text
4. 🔄 Update authentication/authorization logic
5. 🔄 Deprecate direct `users.role` usage in new code
6. ⚠️ Keep synchronization triggers active

#### Application Changes Required:

##### GraphQL Schema Updates:
```graphql
# BEFORE (Phase 1)
type User {
  id: ID!
  name: String!
  role: String!  # Still works via trigger sync
}

# AFTER (Phase 2)
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

input CreateUserInput {
  name: String!
  email: String!
  roleId: ID  # New: use this
  role: String @deprecated  # Old: still works
}
```

##### Resolver Updates:
```javascript
// BEFORE (Phase 1)
const resolvers = {
  Query: {
    users: () => db.query('SELECT * FROM users')
  }
};

// AFTER (Phase 2)
const resolvers = {
  Query: {
    users: () => db.query(`
      SELECT u.*, r.name as role_name, r.description as role_description
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
    `)
  },
  User: {
    roleDetails: (user) => 
      user.role_id ? db.query('SELECT * FROM roles WHERE id = $1', [user.role_id]) : null
  },
  Mutation: {
    createUser: async (_, { input }) => {
      // Prefer roleId, fallback to role text (trigger will sync)
      const role_id = input.roleId || 
        (await db.query('SELECT id FROM roles WHERE name = $1', [input.role])).id;
      
      return db.query(
        'INSERT INTO users (name, email, role_id) VALUES ($1, $2, $3) RETURNING *',
        [input.name, input.email, role_id]
      );
    }
  }
};
```

##### Authorization Middleware:
```javascript
// BEFORE (Phase 1)
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (allowedRoles.includes(req.user.role)) {
      next();
    } else {
      res.status(403).send('Forbidden');
    }
  };
}

// AFTER (Phase 2) - prefer role_id lookup
async function requireRole(allowedRoles) {
  return async (req, res, next) => {
    const userRole = await db.query(
      'SELECT r.name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1',
      [req.user.id]
    );
    
    if (allowedRoles.includes(userRole.name)) {
      next();
    } else {
      res.status(403).send('Forbidden');
    }
  };
}
```

#### Deployment Strategy:
1. Deploy updated code with dual support (can use `role` or `role_id`)
2. Monitor logs for any queries still using `users.role`
3. Gradually migrate frontend queries to use `roleDetails`
4. Update tests to use `role_id`

#### Success Criteria:
- [ ] All new code uses `users.role_id` + JOIN
- [ ] GraphQL schema includes `Role` type
- [ ] Legacy code still works via synchronization
- [ ] No performance degradation
- [ ] Unit tests pass
- [ ] Integration tests pass

---

### 🧹 Phase 3: Cleanup (Week 5+)
**Duration:** 1 week  
**Downtime:** None  
**Rollback Risk:** Medium (breaking change for old code)

⚠️ **WARNING:** This phase is a breaking change. Only proceed when:
- All code has been migrated to use `role_id`
- No queries reference `users.role` directly
- All tests pass with `role` column removed

#### What Happens:
1. 🗑️ Remove synchronization triggers
2. 🗑️ Drop `users.role` column
3. 🗑️ Drop `users.role_legacy` column
4. 🗑️ Set `users.role_id` to NOT NULL (if desired)
5. 📝 Update documentation

#### Migration File:
```sql
-- 002_normalize_roles_phase3_cleanup.sql
BEGIN;

-- Verify no code is using users.role
-- Run this in production for 1 week and check logs
-- ALTER TABLE users RENAME COLUMN role TO role_deprecated;
-- If no errors after 1 week, proceed:

-- Remove triggers
DROP TRIGGER IF EXISTS trg_users_sync_role_from_id ON users;
DROP TRIGGER IF EXISTS trg_users_sync_role_to_id ON users;
DROP FUNCTION IF EXISTS sync_user_role_from_id();
DROP FUNCTION IF EXISTS sync_user_role_to_id();

-- Drop legacy columns
ALTER TABLE users DROP COLUMN IF EXISTS role;
ALTER TABLE users DROP COLUMN IF EXISTS role_legacy;

-- Optionally make role_id required
-- ALTER TABLE users ALTER COLUMN role_id SET NOT NULL;
-- ALTER TABLE users ALTER COLUMN role_id SET DEFAULT '00000000-0000-0000-0000-000000000002'::uuid;

COMMIT;
```

#### Pre-Cleanup Checklist:
- [ ] All application code migrated to use `role_id`
- [ ] No database queries reference `users.role`
- [ ] Mobile apps updated (if applicable)
- [ ] All integrations/APIs updated
- [ ] Logs monitored for 1+ week with no `role` column usage

---

## Index Recommendations

### Phase 1 Indexes (Already Included):
```sql
CREATE INDEX idx_roles_name ON roles(name);
CREATE INDEX idx_roles_active ON roles(is_active) WHERE is_active = true;
CREATE INDEX idx_users_role_id ON users(role_id);
```

### Additional Performance Indexes (Optional):
```sql
-- If you frequently filter users by role name
CREATE INDEX idx_users_role_id_covering ON users(role_id) INCLUDE (name, email);

-- If you have many inactive roles
CREATE INDEX idx_roles_active_partial ON roles(name) WHERE is_active = true;

-- For audit queries
CREATE INDEX idx_roles_created_at ON roles(created_at DESC);
```

---

## Synchronization Mechanism

During Phase 1 & 2, two triggers maintain consistency:

### Trigger 1: `sync_user_role_from_id`
**When:** `users.role_id` is updated  
**Action:** Sets `users.role` to match the role name

```sql
UPDATE users SET role_id = '<uuid-for-admin>';
-- Trigger automatically sets: role = 'Administrator'
```

### Trigger 2: `sync_user_role_to_id`
**When:** `users.role` is updated  
**Action:** Sets `users.role_id` to match the role ID

```sql
UPDATE users SET role = 'Subscriber';
-- Trigger automatically sets: role_id = '<uuid-for-subscriber>'
```

**Auto-creation:** If a new role text is inserted that doesn't exist in `roles`, it's automatically created.

---

## Rollback Procedures

### Phase 1 Rollback (Safe anytime during Phase 1 & 2):
```bash
psql -d jachoei -f db/migrations/001_normalize_roles_phase1_ROLLBACK.sql
```

**What it does:**
- Restores `users.role` from `role_id` (if needed)
- Removes `role_id` column
- Drops `roles` table
- Removes triggers

**Data loss:** None (if role values were synchronized)

### Phase 2 Rollback:
1. Deploy previous application version
2. Run Phase 1 rollback if database changes needed
3. Monitor for errors

### Phase 3 Rollback (Destructive):
⚠️ **Cannot rollback** - `users.role` column is permanently removed.  
**Alternative:** Restore from backup or recreate column from `role_id`.

---

## Testing Strategy

### Unit Tests:
```javascript
describe('Role Migration', () => {
  it('should sync role_id to role text', async () => {
    const user = await createUser({ roleId: adminRoleId });
    expect(user.role).toBe('Administrator');
  });

  it('should sync role text to role_id', async () => {
    const user = await createUser({ role: 'Subscriber' });
    expect(user.role_id).toBe(subscriberRoleId);
  });

  it('should auto-create missing roles', async () => {
    const user = await createUser({ role: 'NewCustomRole' });
    const role = await db.query('SELECT * FROM roles WHERE name = $1', ['NewCustomRole']);
    expect(role).toBeDefined();
  });
});
```

### Integration Tests:
```bash
# Test backward compatibility
curl -X POST /graphql \
  -d '{"query": "mutation { createUser(input: {name: \"Test\", role: \"Administrator\"}) { id role roleDetails { name } } }"}'

# Should return both role and roleDetails
```

### Load Testing:
- Run before Phase 1
- Run after Phase 1 (with triggers)
- Run after Phase 2 (with JOINs)
- Compare performance metrics

---

## Monitoring & Alerts

### Key Metrics to Watch:

1. **Query Performance:**
   - Monitor slow query log for JOIN performance
   - Track `users` table query times
   - Alert if p95 latency increases >10%

2. **Data Consistency:**
   ```sql
   -- Alert if any users have mismatched role/role_id
   SELECT COUNT(*) FROM users u
   LEFT JOIN roles r ON u.role_id = r.id
   WHERE u.role IS DISTINCT FROM r.name;
   ```

3. **Error Rates:**
   - GraphQL errors mentioning "role"
   - Database constraint violations
   - Foreign key errors

4. **Application Logs:**
   - Grep for "role" column usage
   - Track deprecation warnings

---

## Timeline Summary

| Phase | Duration | Risk | Code Changes | Rollback |
|-------|----------|------|--------------|----------|
| **Phase 1** | 1-2 days | Low | None | Easy |
| **Phase 2** | 2-3 weeks | Low | Yes | Easy |
| **Phase 3** | 1 week | Medium | None (cleanup) | Hard |

**Total:** ~4-5 weeks for complete migration

---

## Risk Mitigation

### Risk 1: Trigger Performance Impact
**Likelihood:** Low  
**Impact:** Medium  
**Mitigation:**
- Triggers only fire on UPDATE, not SELECT
- Test with production-scale data
- Monitor query times

### Risk 2: Application Incompatibility
**Likelihood:** Low  
**Impact:** High  
**Mitigation:**
- Phase 1 maintains full backward compatibility
- Synchronization keeps both columns valid
- Extensive testing before Phase 3

### Risk 3: Data Inconsistency
**Likelihood:** Very Low  
**Impact:** High  
**Mitigation:**
- Triggers prevent drift
- Daily consistency check (cron job)
- Validation query in migration

---

## Success Metrics

- ✅ Zero downtime during migration
- ✅ No data loss
- ✅ No application errors
- ✅ Query performance maintained or improved
- ✅ All tests pass
- ✅ Code is cleaner and more maintainable
- ✅ Future roles can be added via INSERT (no schema change)

---

## Future Enhancements (Post-Migration)

Once Phase 3 is complete, consider:

1. **Role Permissions Table:**
   ```sql
   CREATE TABLE role_permissions (
     role_id uuid REFERENCES roles(id),
     permission text NOT NULL,
     PRIMARY KEY (role_id, permission)
   );
   ```

2. **Role Hierarchy:**
   ```sql
   ALTER TABLE roles ADD COLUMN parent_role_id uuid REFERENCES roles(id);
   ```

3. **User-Specific Permissions Override:**
   ```sql
   CREATE TABLE user_permissions (
     user_id uuid REFERENCES users(id),
     permission text NOT NULL,
     granted boolean DEFAULT true,
     PRIMARY KEY (user_id, permission)
   );
   ```

4. **Audit Trail:**
   ```sql
   CREATE TABLE user_role_history (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id uuid REFERENCES users(id),
     old_role_id uuid REFERENCES roles(id),
     new_role_id uuid REFERENCES roles(id),
     changed_by uuid REFERENCES users(id),
     changed_at timestamptz DEFAULT now()
   );
   ```

---

## Questions & Support

**Migration Author:** Database Team  
**Contact:** db-team@example.com  
**Documentation:** [Link to project wiki]

### Common Questions:

**Q: Can I skip Phase 2 and go straight to Phase 3?**  
A: No. Phase 2 ensures all application code is migrated. Skipping it will break your application.

**Q: How long should I wait between phases?**  
A: Minimum 1 week between Phase 1→2, and 2 weeks between Phase 2→3.

**Q: What if I find a bug during Phase 2?**  
A: Roll back to Phase 1 state using the rollback script. Fix the bug, then retry.

**Q: Can I add new roles during migration?**  
A: Yes! Insert into `roles` table at any phase. The triggers will keep everything synchronized.

---

## Checklist for Operators

### Before Starting:
- [ ] Full database backup completed
- [ ] Backup tested and restorable
- [ ] Maintenance window scheduled (optional)
- [ ] Team notified
- [ ] Monitoring alerts configured

### Phase 1:
- [ ] Run `001_normalize_roles_phase1.sql`
- [ ] Verify all users have `role_id`
- [ ] Test synchronization (update both ways)
- [ ] Monitor application logs for 24h
- [ ] Announce success to team

### Phase 2:
- [ ] Update GraphQL schema
- [ ] Update resolvers
- [ ] Update mutations
- [ ] Deploy to staging
- [ ] Run integration tests
- [ ] Deploy to production
- [ ] Monitor logs for deprecated role usage
- [ ] Update documentation

### Phase 3:
- [ ] Verify zero usage of `users.role` for 1+ week
- [ ] Run cleanup migration
- [ ] Remove deprecated GraphQL fields
- [ ] Deploy final version
- [ ] Update schema documentation
- [ ] Archive migration files

---

## Appendix: SQL Helper Queries

### Check Migration Status:
```sql
-- Phase 1 completion check
SELECT 
  COUNT(*) FILTER (WHERE role_id IS NOT NULL) as with_role_id,
  COUNT(*) FILTER (WHERE role IS NOT NULL) as with_role_text,
  COUNT(*) as total
FROM users;

-- Synchronization health check
SELECT COUNT(*) as mismatched_roles
FROM users u
LEFT JOIN roles r ON u.role_id = r.id
WHERE u.role IS DISTINCT FROM r.name;

-- Role distribution
SELECT r.name, COUNT(u.id) as user_count
FROM roles r
LEFT JOIN users u ON u.role_id = r.id
GROUP BY r.name
ORDER BY user_count DESC;
```

### Performance Monitoring:
```sql
-- Slow query analysis
SELECT 
  query,
  mean_exec_time,
  calls,
  total_exec_time
FROM pg_stat_statements
WHERE query ILIKE '%users%role%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

---

**End of Migration Plan**
