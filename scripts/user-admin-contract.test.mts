import assert from "node:assert/strict";
import test from "node:test";

import {
  canManageUserTarget,
  canViewUserTarget,
  type UserAdminPolicyActor,
  type UserAdminPolicyTarget,
} from "../apps/web/lib/bms/staffRoles.ts";
import { isSessionVersionCurrent } from "../apps/web/lib/auth/sessionVersion.ts";
import {
  buildPasswordResetUrl,
  hashResetToken,
} from "../apps/web/lib/auth/resetToken.ts";

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";

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
});

test("admin session version invalidates tokens issued before a security change", () => {
  assert.equal(isSessionVersionCurrent(undefined, 0), true);
  assert.equal(isSessionVersionCurrent(3, 3), true);
  assert.equal(isSessionVersionCurrent(3, 4), false);
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
