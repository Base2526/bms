# Schema Evolution Diagram

## Current State (Before Migration)

```
┌─────────────────────────────────────────────┐
│ users                                       │
├─────────────────────────────────────────────┤
│ id uuid                                     │
│ name text                                   │
│ email text                                  │
│ role text DEFAULT 'Subscriber' ◄─ TEXT ONLY│
│ password_hash text                          │
│ created_at timestamptz                      │
│ updated_at timestamptz                      │
│ ...                                         │
└─────────────────────────────────────────────┘
```

**Issues:**
- ❌ No referential integrity
- ❌ Typos possible ("Adminstrator", "admin", "ADMIN")
- ❌ Can't add role metadata (description, permissions)
- ❌ Schema change needed to add new roles

---

## Phase 1: Dual Column State (Backward Compatible)

```
┌─────────────────────────────────────────────┐    ┌───────────────────────────┐
│ users                                       │    │ roles                     │
├─────────────────────────────────────────────┤    ├───────────────────────────┤
│ id uuid                                     │    │ id uuid PRIMARY KEY       │
│ name text                                   │    │ name text UNIQUE          │
│ email text                                  │    │ description text          │
│ role text (kept for compatibility) ◄────┐  │    │ is_active boolean         │
│ role_id uuid ──────────────────┐        │  │    │ created_at timestamptz    │
│ role_legacy text (backup)      │        │  │    │ updated_at timestamptz    │
│ password_hash text             │        │  │    └───────────────────────────┘
│ created_at timestamptz         │        │  │                ▲
│ updated_at timestamptz         │        │  │                │
│ ...                            │        │  │                │
└────────────────────────────────┼────────┼──┘      FK Constraint
                                 │        │         (ON DELETE SET NULL)
                                 └────────┼─────────┘
                                          │
                        ┌─────────────────┴─────────────────┐
                        │  Synchronization Triggers         │
                        │  • sync_user_role_from_id()       │
                        │  • sync_user_role_to_id()         │
                        │  Keep both columns in sync!       │
                        └───────────────────────────────────┘
```

**Features:**
- ✅ Both `users.role` and `users.role_id` work
- ✅ Triggers keep them synchronized
- ✅ Zero application code changes needed
- ✅ Can rollback anytime

**Data Flow (Phase 1):**
```
Update role_id:                      Update role:
UPDATE users                         UPDATE users
SET role_id = <uuid>                 SET role = 'Admin'
    │                                    │
    ▼                                    ▼
[Trigger fires]                      [Trigger fires]
    │                                    │
    ▼                                    ▼
role = 'Admin' (synced)             role_id = <uuid> (synced)
```

---

## Phase 2: Application Migration (Both Columns Still Active)

```
Application Code Changes:
━━━━━━━━━━━━━━━━━━━━━━━━━

OLD CODE (Still works):               NEW CODE (Preferred):
──────────────────────                ────────────────────
SELECT * FROM users                   SELECT u.*, r.name, r.description
WHERE role = 'Admin'                  FROM users u
                                      JOIN roles r ON u.role_id = r.id
                                      WHERE r.name = 'Admin'

INSERT INTO users (role)              INSERT INTO users (role_id)
VALUES ('Subscriber')                 VALUES ((SELECT id FROM roles 
                                                WHERE name = 'Subscriber'))

UPDATE users                          UPDATE users
SET role = 'Admin'                    SET role_id = (SELECT id FROM roles
WHERE id = $1                                         WHERE name = 'Admin')
                                      WHERE id = $1
```

**Migration Status:**
- 🔄 Gradually update queries to use `role_id`
- 🔄 Add GraphQL `roleDetails` field
- ⚠️ Triggers still active (keeping columns synced)
- 📊 Monitor usage of old `role` column

---

## Phase 3: Final State (Fully Normalized)

```
┌─────────────────────────────────────────────┐    ┌───────────────────────────┐
│ users                                       │    │ roles                     │
├─────────────────────────────────────────────┤    ├───────────────────────────┤
│ id uuid                                     │    │ id uuid PRIMARY KEY       │
│ name text                                   │    │ name text UNIQUE          │
│ email text                                  │    │ description text          │
│ role_id uuid NOT NULL ─────────────┐       │    │ is_active boolean         │
│ password_hash text                 │       │    │ created_at timestamptz    │
│ created_at timestamptz             │       │    │ updated_at timestamptz    │
│ updated_at timestamptz             │       │    └───────────────────────────┘
│ ...                                │       │                ▲
└────────────────────────────────────┼───────┘                │
                                     │                        │
                                     └────────────────────────┘
                                             FK CONSTRAINT
                                         (ON DELETE SET NULL)
```

**Changes:**
- ❌ `users.role` column removed
- ❌ `users.role_legacy` column removed
- ❌ Synchronization triggers removed
- ✅ Clean normalized schema
- ✅ All queries use `role_id` + JOIN

**Benefits:**
- ✅ Referential integrity enforced
- ✅ Role metadata (description, is_active)
- ✅ Easy to add new roles (just INSERT)
- ✅ Type safety (uuid vs text)
- ✅ Better query performance with indexes
- ✅ Audit trail possible (role history)

---

## Query Performance Comparison

### Before (Text-based role):
```sql
-- Full table scan or text index
SELECT * FROM users WHERE role = 'Administrator';

┌─────────────┐
│ Seq Scan    │  Cost: 50-500
│ Filter: role│  
└─────────────┘
```

### After (Normalized with index):
```sql
-- Index lookup on FK
SELECT u.* FROM users u
JOIN roles r ON u.role_id = r.id
WHERE r.name = 'Administrator';

┌──────────────────┐
│ Index Scan (r)   │  Cost: 1-10
│ Nested Loop      │  
│ Index Scan (u)   │  
└──────────────────┘
```

**Performance Gains:**
- 🚀 5-50x faster for role-based queries
- 🚀 FK index eliminates full table scans
- 🚀 Better caching (numeric keys)

---

## Data Integrity Comparison

### Before:
```
❌ users.role = 'Admin'
❌ users.role = 'admin'
❌ users.role = 'Administrator'
❌ users.role = 'ADMIN'
❌ users.role = 'Adminstrator' (typo)
```
All different values, no validation!

### After:
```
✅ users.role_id = '00000000-0000-0000-0000-000000000001'
   (references roles.id where name = 'Administrator')
   
✅ FK constraint ensures role exists
✅ Single source of truth
✅ Can't insert invalid role
✅ Can update role name globally
```

---

## Future Enhancements (Post-Phase 3)

### Option 1: Add Permissions
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│ users           │    │ roles            │    │ role_permissions    │
├─────────────────┤    ├──────────────────┤    ├─────────────────────┤
│ id              │    │ id ◄─────────────┼────│ role_id             │
│ role_id ────────┼───►│ name             │    │ permission          │
└─────────────────┘    │ description      │    │ (posts:create,      │
                       └──────────────────┘    │  posts:delete, etc) │
                                               └─────────────────────┘
```

### Option 2: Add Role Hierarchy
```
┌─────────────────────────────┐
│ roles                       │
├─────────────────────────────┤
│ id                          │
│ name                        │
│ parent_role_id ─────┐       │
│ description         │       │
└─────────────────────┼───────┘
                      │
                      └───── (self-referencing FK)
```

### Option 3: Add User Overrides
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│ users           │    │ roles            │    │ user_permissions    │
│                 │    │                  │    │ (override role)     │
├─────────────────┤    ├──────────────────┤    ├─────────────────────┤
│ id ◄────────────┼────┼────────────────────────┤ user_id             │
│ role_id ────────┼───►│ id               │    │ permission          │
└─────────────────┘    └──────────────────┘    │ granted boolean     │
                                               └─────────────────────┘
```

---

## Migration Timeline Visualization

```
Week 0   Week 1   Week 2   Week 3   Week 4   Week 5   Week 6
  │        │        │        │        │        │        │
  │        │        │        │        │        │        │
  ├────────┤        │        │        │        │        │
  │ Phase 1│        │        │        │        │        │
  │ Deploy │        │        │        │        │        │
  │ (1-2d) │        │        │        │        │        │
  └────────┴────────┼────────┼────────┼────────┤        │
           │ Phase 2│        │        │        │        │
           │ Code   │        │        │        │        │
           │ Migr.  │        │        │        │        │
           │ (2-3w) │        │        │        │        │
           └────────┴────────┴────────┴────────┼────────┤
                                      │ Phase 3│        │
                                      │ Cleanup│        │
                                      │ (1w)   │        │
                                      └────────┴────────┘
                                              
Rollback Easy ────────────────────────► Hard (data loss)
```

---

## Rollback Scenarios

### Phase 1 Rollback (Easy):
```
BEFORE ROLLBACK:                  AFTER ROLLBACK:
┌────────────────┐               ┌────────────────┐
│ users          │               │ users          │
│ - role         │               │ - role ✓       │
│ - role_id      │   ───────►    │                │
│ - role_legacy  │               │                │
└────────────────┘               └────────────────┘
┌────────────────┐               
│ roles          │               (deleted)
└────────────────┘               
```

### Phase 3 Rollback (Hard):
```
BEFORE ROLLBACK:                  AFTER ROLLBACK:
┌────────────────┐               ┌────────────────┐
│ users          │               │ users          │
│ - role_id ✓    │               │ - role ???     │
└────────────────┘   ───────►    │ (needs restore)│
┌────────────────┐               └────────────────┘
│ roles ✓        │               ┌────────────────┐
└────────────────┘               │ roles          │
                                 │ (keep or delete?)
                                 └────────────────┘
```

---

## Summary: Before & After

| Aspect | Before | After |
|--------|--------|-------|
| **Data Type** | `text` | `uuid` (FK) |
| **Validation** | None | FK constraint |
| **New Roles** | Schema change | `INSERT INTO roles` |
| **Typos** | Possible | Impossible |
| **Metadata** | Not possible | Supported |
| **Performance** | Text scan | Index lookup |
| **Integrity** | ❌ | ✅ |
| **Flexibility** | Low | High |
| **Maintainability** | Poor | Excellent |

---

**Created:** 2026-05-30  
**Status:** Ready for Phase 1 deployment  
**Compatibility:** PostgreSQL 12+
