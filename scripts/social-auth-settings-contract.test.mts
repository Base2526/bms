import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { socialLinkDecision } from "../apps/web/lib/auth/socialAccountPolicy.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("social auth settings default off and keep an append-only platform audit", () => {
  const migration = read("db/migrations/10.22__bms_social_auth_settings.sql");
  assert.match(migration, /public_login_enabled\s+BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /admin_login_enabled\s+BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /shop_signup_enabled\s+BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_social_auth_setting_events/);
  assert.match(migration, /previous_settings\s+JSONB NOT NULL/);
  assert.match(migration, /next_settings\s+JSONB NOT NULL/);
  assert.match(migration, /users_social_provider_identity_uidx/);
  assert.match(migration, /duplicate social provider identities/);
});

test("effective availability requires both a platform switch and complete runtime config", () => {
  const service = read("apps/web/lib/bms/socialAuthSettings.ts");
  assert.match(service, /config\.ready && surfaceEnabled\(row, surface\)/);
  assert.match(service, /FACEBOOK_APP_SECRET_MISSING/);
  assert.match(service, /GOOGLE_CLIENT_ID_MISMATCH/);
  assert.match(service, /FACEBOOK_APP_ID_MISMATCH/);
  assert.match(service, /return \{ google: false, facebook: false \}/,
    "a database or migration failure must fail social auth closed");
  assert.doesNotMatch(service, /NEXT_PUBLIC_FACEBOOK_APP_SECRET/,
    "a server-side provider secret must never use a NEXT_PUBLIC name");
});

test("every social mutation re-checks the server gate for its own surface", () => {
  const resolvers = read("apps/web/graphql/resolvers.ts");
  const signup = read("apps/web/lib/bms/signup.ts");
  assert.match(resolvers, /assertSocialAuthAvailable\(provider, "PUBLIC_LOGIN"\)/);
  assert.match(resolvers, /assertSocialAuthAvailable\(provider, "ADMIN_LOGIN"\)/);
  assert.match(signup, /assertSocialAuthAvailable\(input\.provider, "SHOP_SIGNUP"\)/);
});

test("only platform admins can change social auth and the mutation requires confirmation", () => {
  const resolver = read("apps/web/graphql/bmsSaas.ts");
  const start = resolver.indexOf("async bmsUpdateSocialAuthSetting");
  assert.ok(start > 0, "missing bmsUpdateSocialAuthSetting resolver");
  const block = resolver.slice(start, resolver.indexOf("async bmsDeleteTenant", start));
  assert.match(block, /await requirePlatformAdmin\(ctx\)/);
  assert.match(block, /args\.confirm !== true/);

  const service = read("apps/web/lib/bms/socialAuthSettings.ts");
  assert.match(service, /INSERT INTO bms_social_auth_setting_events/);
  assert.match(service, /SOCIAL_AUTH_CONFIG_NOT_READY/);
  assert.match(service, /const next = \{ \.\.\.previous, \[key\]: enabled \}/,
    "the mutation must patch one surface instead of overwriting a stale full row");

  const layout = read("apps/web/app/(admin)/admin/auth-settings/layout.tsx");
  assert.match(layout, /requirePlatformAdminPage/);
});

test("public signup paths are rate limited before provider or email work", () => {
  const resolver = read("apps/web/graphql/bmsSaas.ts");
  const emailStart = resolver.indexOf("async bmsSignup(");
  const socialStart = resolver.indexOf("async bmsSignupWithSocial(");
  const verifyStart = resolver.indexOf("async bmsVerifyShopSignup", socialStart);
  assert.match(resolver.slice(emailStart, socialStart), /enforceAuthRateLimit\(/);
  assert.match(resolver.slice(socialStart, verifyStart), /enforceAuthRateLimit\(/);
});

test("social identity linking is stable and rejects a different provider or provider id", () => {
  const google = {
    email: "owner@example.com",
    name: "Owner",
    picture: "",
    provider: "google" as const,
    provider_id: "google-1",
    email_verified: true as const,
  };
  assert.equal(socialLinkDecision({ provider: "password", provider_id: null }, google), "LINK");
  assert.equal(socialLinkDecision({ provider: "google", provider_id: null }, google), "LINK");
  assert.equal(socialLinkDecision({ provider: "google", provider_id: "google-1" }, google), "MATCHED");
  assert.equal(socialLinkDecision({ provider: "google", provider_id: "google-2" }, google), "CONFLICT");
  assert.equal(socialLinkDecision({ provider: "facebook", provider_id: "facebook-1" }, google), "CONFLICT");
});

test("provider verification is bounded and never logs raw provider errors", () => {
  const social = read("apps/web/lib/auth/social.ts");
  assert.match(social, /SOCIAL_TOKEN_MAX_LENGTH/);
  assert.match(social, /FACEBOOK_TIMEOUT_MS/);
  assert.match(social, /controller\.abort\(\)/);
  assert.doesNotMatch(social, /console\.error\("\[verify(?:Google|Facebook)\] error", err\)/);
});

test("browser auth mutations rely on httpOnly cookies and never request or log the JWT", () => {
  for (const file of [
    "apps/web/components/auth/LoginClient.tsx",
    "apps/web/app/(admin)/admin/login/page.tsx",
    "apps/web/app/(auth)/shop-signup/page.tsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /^\s*token\s*$/m, `${file} requests a token it does not need`);
    assert.doesNotMatch(source, /console\.log\([^\n]*login/i, `${file} logs an authentication response`);
  }
});

test("public clients receive booleans only and hide unavailable providers", () => {
  const schema = read("apps/web/graphql/typeDefs.ts");
  assert.match(schema, /type SocialAuthAvailability \{ google: Boolean! facebook: Boolean! \}/);
  const socialLogin = read("apps/web/components/auth/SocialLogin.tsx");
  assert.match(socialLogin, /socialAuthAvailability\(surface: \$surface\)/);
  assert.match(socialLogin, /if \(!hasSocialProvider\) return null/);
  assert.match(socialLogin, /googleAvailable &&/);
  assert.match(socialLogin, /facebookAvailable &&/);
});

test("a misconfigured provider keeps an existing switch available to turn off", () => {
  const page = read("apps/web/app/(admin)/admin/auth-settings/page.tsx");
  assert.match(
    page,
    /disabled=\{saving \|\| \(!setting\.configReady && !setting\[row\.key\]\)\}/,
    "configuration failure must not trap an enabled switch in the on position",
  );
});
