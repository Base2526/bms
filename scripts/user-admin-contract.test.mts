import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  canManageUserTarget,
  canViewUserTarget,
  canManageStaffRole,
  type UserAdminPolicyActor,
  type UserAdminPolicyTarget,
} from "../apps/web/lib/bms/staffRoles.ts";
import { assertAdministratorRemains, assertManageablePosAccountInTx, assertNoActiveStaffAssignments, auditUserChangeInTx, canReadStaffContact, explainUserDeleteFailure, requireManageableTargets, resolveAssignableRole } from "../apps/web/lib/bms/userAdmin.ts";
import { isSessionVersionCurrent } from "../apps/web/lib/auth/sessionVersion.ts";
import { canUseAdminSession } from "../apps/web/lib/auth/adminSessionEligibility.ts";
import {
  buildPasswordResetUrl,
  hashResetToken,
} from "../apps/web/lib/auth/resetToken.ts";

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const root = path.resolve(import.meta.dirname, "..");
const src = (file: string) => readFileSync(path.join(root, file), "utf8");

const actor = (overrides: Partial<UserAdminPolicyActor>): UserAdminPolicyActor => ({
  platform: false,
  tenantId: T1,
  role: "Manager",
  ...overrides,
});

const target = (overrides: Partial<UserAdminPolicyTarget>): UserAdminPolicyTarget => ({
  tenantId: T1,
  role: "Sales",
  isPlatformAdmin: false,
  ...overrides,
});

test("global platform admin can cross tenants but cannot mutate another platform identity", () => {
  const platform = actor({ platform: true, role: "Administrator" });
  assert.equal(canViewUserTarget(platform, target({ tenantId: T2 })), true);
  assert.equal(canManageUserTarget(platform, target({ tenantId: T2 })), true);
  assert.equal(canViewUserTarget(platform, target({ isPlatformAdmin: true })), true);
  assert.equal(canManageUserTarget(platform, target({ isPlatformAdmin: true })), false);
});

test("platform admin in drill-down mode is tenant-scoped", () => {
  // requireUserAdmin represents drill-down as platform=false with the acting tenant.
  const drillDown = actor({ platform: false, tenantId: T2, role: "Administrator" });
  assert.equal(canViewUserTarget(drillDown, target({ tenantId: T2 })), true);
  assert.equal(canManageUserTarget(drillDown, target({ tenantId: T2, role: "Manager" })), true);
  assert.equal(canViewUserTarget(drillDown, target({ tenantId: T1 })), false);
  assert.equal(canManageUserTarget(drillDown, target({ tenantId: T1 })), false);
});

test("tenant Administrator is super only inside its own tenant", () => {
  const admin = actor({ role: "Administrator" });
  assert.equal(canManageUserTarget(admin, target({ role: "Manager" })), true);
  assert.equal(canManageUserTarget(admin, target({ tenantId: T2 })), false);
  assert.equal(canViewUserTarget(admin, target({ isPlatformAdmin: true })), false);
});

test("tenant Manager can manage only lower-ranked non-platform users in its tenant", () => {
  const manager = actor({ role: "Manager" });
  assert.equal(canManageUserTarget(manager, target({ role: "Sales" })), true);
  assert.equal(canManageUserTarget(manager, target({ role: "Warehouse" })), true);
  assert.equal(canManageUserTarget(manager, target({ role: "Manager" })), false);
  assert.equal(canManageUserTarget(manager, target({ role: "Administrator" })), false);
  assert.equal(canManageUserTarget(manager, target({ tenantId: T2, role: "Sales" })), false);
  assert.equal(canManageUserTarget(manager, target({ role: "Sales", isPlatformAdmin: true })), false);
  assert.equal(canManageStaffRole("Manager", "Cashier"), true);
  assert.equal(canManageStaffRole("Manager", "Pharmacist"), false);
});

test("self profile edit accepts the unchanged locked role but rejects conflicting role inputs", async () => {
  const gate = { platform: false, tenantId: T1, actorId: T2, actorRole: "Manager", isSuper: false };
  const roleId = "33333333-3333-4333-8333-333333333333";
  const client = { query: async () => ({ rows: [{ id: roleId, name: "Manager" }] }) } as any;
  assert.deepEqual(
    await resolveAssignableRole({}, gate, { role_id: roleId }, { unchangedSelfRoleName: "Manager" }, client),
    { roleId, roleName: "Manager" }
  );
  await assert.rejects(
    resolveAssignableRole({}, gate, { role_id: roleId, role: "Administrator" },
      { unchangedSelfRoleName: "Manager" }, client),
    /บทบาทที่ระบุไม่ตรงกัน/
  );
});

test("bulk team changes fail closed when any selected user is missing or outside the tenant", async () => {
  const ownId = "33333333-3333-4333-8333-333333333333";
  const otherId = "44444444-4444-4444-8444-444444444444";
  const gate = { platform: false, tenantId: T1, actorId: T2, actorRole: "Manager", isSuper: false };
  const queries: string[] = [];
  const client = { query: async (sql: string, params: unknown[]) => {
    queries.push(sql);
    assert.match(sql, /tenant_id = \$2/);
    assert.equal(params[1], T1);
    return { rows: params[0] === ownId ? [{ id: ownId, tenant_id: T1, role: "Sales", is_platform_admin: false }] : [] };
  } } as any;
  await assert.rejects(requireManageableTargets({}, gate, [ownId, otherId], client), /user not found in current tenant/);
  assert.equal(queries.length, 2);
});

test("team audit is written through the caller transaction and a failure propagates", async () => {
  const calls: unknown[][] = [];
  const client = { query: async (sql: string, params: unknown[]) => {
    if (sql.includes("set_config")) return { rows: [] };
    assert.match(sql, /INSERT INTO bms_audit_log/);
    calls.push(params);
    if (params[3] === "fail") throw new Error("audit unavailable");
  } } as any;
  await auditUserChangeInTx(client, T1, T2, "user.create", "ok", { role: "Sales" });
  assert.deepEqual(calls[0], [T1, T2, "user.create", "ok", '{"role":"Sales"}']);
  await assert.rejects(auditUserChangeInTx(client, T1, T2, "user.delete", "fail", {}), /audit unavailable/);
});

test("team edit preserves optional contact fields when GraphQL omits them", () => {
  const resolver = src("apps/web/graphql/resolvers.ts");
  const edit = resolver.slice(resolver.indexOf("upsertUser: async"), resolver.indexOf("uploadAvatar: async"));
  assert.match(edit, /if \(avatar !== undefined\) \{\s*updateFields\.push\(`avatar =/);
  assert.match(edit, /if \(phone !== undefined\) \{\s*updateFields\.push\(`phone =/);
  assert.match(edit, /\[name, avatar \?\? null, phone \?\? null, email, roleId, passwordHash, newTenantId\]/);
});

test("profile mutation logs field names without writing contact values", () => {
  const resolver = src("apps/web/graphql/resolvers.ts");
  assert.match(resolver, /console\.log\("\[Mutation\] updateMe :", author_id, \{ fields: Object\.keys\(data\) \}\)/);
  assert.match(resolver, /console\.log\("\[Mutation\] updateMyProfile :", author_id, \{ fields: Object\.keys\(data\) \}\)/);
});

test("active team assignments block account deletion before Inbox reassignment", async () => {
  const calls: string[] = [];
  const client = { query: async (sql: string, params: unknown[]) => {
    calls.push(sql);
    if (sql.includes("to_regclass")) return { rows: [{ present: String(params[0]) }] };
    if (sql.includes("FROM bms_operation_schedules")) return { rowCount: 1, rows: [{ "?column?": 1 }] };
    return { rowCount: 0, rows: [] };
  } } as any;
  await assert.rejects(assertNoActiveStaffAssignments(client, T1, T2), /ตารางงานประจำ/);
  assert.ok(calls.some((sql) => sql.includes("set_config('bms.tenant_id'")));
  assert.ok(calls.some((sql) => sql.includes("tenant_id = $1")));
  assert.throws(() => explainUserDeleteFailure({ code: "23503" }), /มีประวัติการทำรายการ/);
});

test("Administrator removal is serialized and refuses to leave a tenant without one", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = { query: async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return sql.includes("FROM users") ? { rowCount: 0 } : { rowCount: 1 };
  } } as any;
  await assert.rejects(assertAdministratorRemains(client, T1, [T2]), /Administrator อย่างน้อยหนึ่งบัญชี/);
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.equal(calls[0].params[0], T1);
  assert.match(calls[1].sql, /id <> ALL\(\$2::uuid\[\]\)/);
  assert.deepEqual(calls[1].params, [T1, [T2]]);

  const writable = { query: async (sql: string) => ({ rowCount: sql.includes("FROM users") ? 1 : 0 }) } as any;
  await assertAdministratorRemains(writable, T1, [T2]);
});

test("POS PIN changes follow the same account-rank boundary as Users", async () => {
  const targetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const actorId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const makeClient = (targetRole: string, targetPlatform = false, actorRole = "Manager", actorTenant = T1) => {
    const calls: string[] = [];
    const client = { query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: targetId, tenant_id: T1, role: targetRole, is_platform_admin: targetPlatform }] };
      return { rows: [{ id: actorId, tenant_id: actorTenant, role: actorRole, is_platform_admin: false }] };
    } } as any;
    return { client, calls };
  };
  const staff = makeClient("Cashier");
  await assertManageablePosAccountInTx(staff.client, T1, targetId, actorId);
  assert.match(staff.calls[0], /tenant_id = \$1 AND id = \$2 FOR UPDATE/);
  await assert.rejects(assertManageablePosAccountInTx(makeClient("Administrator").client, T1, targetId, actorId), /ไม่มีสิทธิ์/);
  await assert.rejects(assertManageablePosAccountInTx(makeClient("Cashier", true).client, T1, targetId, actorId), /ไม่มีสิทธิ์/);
  await assert.rejects(assertManageablePosAccountInTx(makeClient("Cashier", false, "Manager", T2).client, T1, targetId, actorId), /ไม่มีสิทธิ์/);
  const pos = src("apps/web/lib/bms/pos.ts");
  assert.equal((pos.match(/if \(actingUserId\) await assertManageablePosAccountInTx\(/g) ?? []).length, 2);
  assert.match(pos, /await assertManageablePosAccountInTx\(client, tenantId, userId, actingUserId\);\s*const target/);
  assert.match(pos, /WHERE u\.tenant_id = \$1 AND u\.is_platform_admin = FALSE\s*ORDER BY r\.name/);
});

test("legacy login enforces email verification before issuing a session", () => {
  const resolver = src("apps/web/graphql/resolvers.ts");
  const login = resolver.slice(resolver.indexOf("login: async"), resolver.indexOf("loginUser: async"));
  assert.match(login, /password_hash, is_email_verified/);
  assert.ok(login.indexOf("user.is_email_verified === false") < login.indexOf("INSERT INTO sessions"));
});

test("social user discovery excludes staff accounts and private contact fields", () => {
  const resolver = src("apps/web/graphql/resolvers.ts");
  assert.match(resolver, /tenant_id IS NULL AND is_platform_admin = FALSE/);
  assert.match(resolver, /"id, name, avatar, role, role_id, created_at, username, language, notifications_enabled, is_platform_admin"/);
  assert.match(resolver, /FROM users WHERE id=\$1 AND tenant_id IS NULL AND is_platform_admin=FALSE/);
  assert.match(resolver, /FROM users u\s+WHERE u\.tenant_id IS NULL AND u\.is_platform_admin = FALSE AND \(/);
  assert.match(resolver, /roles: async \(_:\s*any, __:\s*any, ctx:\s*any\) => \{\s*await requireUserAdmin\(ctx, "user\.view"\)/);
  assert.match(resolver, /user_count: async \(parent: any, _: any, ctx: any\) =>[\s\S]*?AND tenant_id = \$2 AND is_platform_admin = FALSE/);
  assert.match(resolver, /email: \(parent: any, _: any, ctx: any\) => canReadStaffContact/);
  assert.match(resolver, /phone: \(parent: any, _: any, ctx: any\) => canReadStaffContact/);
  assert.equal(canReadStaffContact({ id: T1, tenant_id: T2 }, { user: { id: T1 } }), true);
  assert.equal(canReadStaffContact({ id: T1, tenant_id: T2 }, { user: { id: T2 } }), false);
  assert.equal(canReadStaffContact({ id: T1, tenant_id: T2 }, { admin: { id: T2 } }), false);
  assert.equal(canReadStaffContact({ id: T1, tenant_id: T2, __staffContactVisible: true }, { admin: { id: T2 } }), true);
  assert.match(src("apps/web/app/(main)/chat/page.tsx"), /users\(search: \$q, limit: 100\)\s*\{\s*items/);
});

test("admin session version invalidates tokens issued before a security change", () => {
  assert.equal(isSessionVersionCurrent(undefined, 0), true);
  assert.equal(isSessionVersionCurrent(3, 3), true);
  assert.equal(isSessionVersionCurrent(3, 4), false);
});

test("an open admin session loses access when the account becomes POS-only or otherwise ineligible", () => {
  const row = {
    role: "Cashier", tenant_id: T1, is_platform_admin: false,
    admin_session_version: 4, pos_only: false, is_email_verified: true,
    tenant_active: true,
  };
  assert.equal(canUseAdminSession(4, row), true);
  assert.equal(canUseAdminSession(4, { ...row, pos_only: true }), false);
  assert.equal(canUseAdminSession(4, { ...row, admin_session_version: 5 }), false);
  assert.equal(canUseAdminSession(4, { ...row, role: "Subscriber" }), false);
  assert.equal(canUseAdminSession(4, { ...row, is_email_verified: false }), false);
  assert.equal(canUseAdminSession(4, { ...row, tenant_active: false }), false);
  assert.equal(canUseAdminSession(4, { ...row, tenant_id: null }), false);
  assert.equal(canUseAdminSession(4, { ...row, tenant_id: null, is_platform_admin: true }), true);
  const identity = src("apps/web/lib/auth/adminIdentity.ts");
  const pos = src("apps/web/lib/bms/pos.ts");
  assert.match(identity, /canUseAdminSession\(session\.session_version, row\)/);
  assert.match(pos, /admin_session_version = CASE WHEN pos_only IS DISTINCT FROM \$3/);
  assert.match(pos, /u\.is_platform_admin FROM users u/);
  assert.match(pos, /target\.rows\[0\]\.is_platform_admin/);
});

test("password reset tokens are hashed and reset URLs fail closed in production", () => {
  const raw = "a".repeat(64);
  assert.notEqual(hashResetToken(raw), raw);
  assert.equal(hashResetToken(raw).length, 64);
  assert.equal(
    buildPasswordResetUrl(raw, "https://bms.example.com/base", "production"),
    `https://bms.example.com/reset?token=${raw}`
  );
  assert.throws(() => buildPasswordResetUrl(raw, "", "production"), /NEXT_PUBLIC_BASE_URL/);
  assert.throws(() => buildPasswordResetUrl(raw, "javascript:alert(1)", "production"), /HTTP\(S\)/);
});

test("admin display identity is refreshed from Postgres instead of trusted from the JWT", () => {
  const identity = src("apps/web/lib/auth/adminIdentity.ts");
  assert.match(identity, /u\.name, u\.username, u\.avatar/);
  assert.match(identity, /name: row\.name/);
  assert.match(identity, /username: row\.username/);
  assert.match(identity, /avatar: row\.avatar/);

  const meRoute = src("apps/web/app/api/auth/me/route.ts");
  assert.match(meRoute, /refreshAdminIdentity\(adminToken\)/);
});

test("uploading my avatar refreshes the profile, sidebar, and public index header", () => {
  const profile = src("apps/web/app/(admin)/admin/profile/page.tsx");
  assert.match(profile, /const \{ refreshSession \} = useSessionCtx\(\)/);
  assert.match(profile, /setAvatarUrl\(url\);\s*await refetch\(\);\s*await refreshSession\(\)/);
  assert.match(profile, /data-admin-profile-avatar/);

  const sidebar = src("apps/web/components/AdminSidebar.tsx");
  assert.match(sidebar, /src=\{admin\.avatar \|\| undefined\}/);
  assert.match(sidebar, /data-admin-sidebar-avatar/);

  const header = src("apps/web/components/HeaderBar.tsx");
  assert.match(header, /isAdminSession \? adminSession\?\.avatar : me\?\.avatar/);
  assert.match(header, /data-header-profile-avatar/);
});
