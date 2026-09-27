import "server-only";

import { GraphQLError } from "graphql/error";
import { getClient, query } from "@/lib/db";

export const SOCIAL_AUTH_PROVIDERS = ["google", "facebook"] as const;
export const SOCIAL_AUTH_SURFACES = ["PUBLIC_LOGIN", "ADMIN_LOGIN", "SHOP_SIGNUP"] as const;

export type SocialAuthProvider = (typeof SOCIAL_AUTH_PROVIDERS)[number];
export type SocialAuthSurface = (typeof SOCIAL_AUTH_SURFACES)[number];

type StoredSetting = {
  provider: SocialAuthProvider;
  public_login_enabled: boolean;
  admin_login_enabled: boolean;
  shop_signup_enabled: boolean;
  updated_at: Date | string;
};

export type SocialAuthSettingInput = {
  provider: unknown;
  surface: unknown;
  enabled: boolean;
};

const SETTING_COLUMNS = `provider, public_login_enabled, admin_login_enabled,
  shop_signup_enabled, updated_at`;

function value(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function providerOf(input: unknown): SocialAuthProvider {
  const provider = String(input ?? "").trim().toLowerCase();
  if (!SOCIAL_AUTH_PROVIDERS.includes(provider as SocialAuthProvider)) {
    throw new GraphQLError("Invalid social provider", {
      extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
    });
  }
  return provider as SocialAuthProvider;
}

function surfaceOf(input: unknown): SocialAuthSurface {
  const surface = String(input ?? "").trim().toUpperCase();
  if (!SOCIAL_AUTH_SURFACES.includes(surface as SocialAuthSurface)) {
    throw new GraphQLError("Invalid social auth surface", {
      extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
    });
  }
  return surface as SocialAuthSurface;
}

function configReadiness(provider: SocialAuthProvider): { ready: boolean; issues: string[] } {
  if (provider === "google") {
    const publicClientId = value("NEXT_PUBLIC_GOOGLE_CLIENT_ID");
    const serverClientId = value("GOOGLE_CLIENT_ID");
    const issues: string[] = [];
    if (!publicClientId) issues.push("NEXT_PUBLIC_GOOGLE_CLIENT_ID_MISSING");
    if (!serverClientId) issues.push("GOOGLE_CLIENT_ID_MISSING");
    if (publicClientId && serverClientId && publicClientId !== serverClientId) {
      issues.push("GOOGLE_CLIENT_ID_MISMATCH");
    }
    return { ready: issues.length === 0, issues };
  }

  const publicAppId = value("NEXT_PUBLIC_FACEBOOK_APP_ID");
  const serverAppId = value("FACEBOOK_APP_ID");
  const secret = value("FACEBOOK_APP_SECRET");
  const issues: string[] = [];
  if (!publicAppId) issues.push("NEXT_PUBLIC_FACEBOOK_APP_ID_MISSING");
  if (!serverAppId) issues.push("FACEBOOK_APP_ID_MISSING");
  if (!secret) issues.push("FACEBOOK_APP_SECRET_MISSING");
  if (publicAppId && serverAppId && publicAppId !== serverAppId) {
    issues.push("FACEBOOK_APP_ID_MISMATCH");
  }
  return { ready: issues.length === 0, issues };
}

function surfaceEnabled(row: StoredSetting, surface: SocialAuthSurface): boolean {
  if (surface === "PUBLIC_LOGIN") return row.public_login_enabled === true;
  if (surface === "ADMIN_LOGIN") return row.admin_login_enabled === true;
  return row.shop_signup_enabled === true;
}

function publicSetting(row: StoredSetting) {
  const config = configReadiness(row.provider);
  return {
    provider: row.provider,
    configReady: config.ready,
    configIssues: config.issues,
    publicLoginEnabled: row.public_login_enabled,
    adminLoginEnabled: row.admin_login_enabled,
    shopSignupEnabled: row.shop_signup_enabled,
    publicLoginAvailable: config.ready && row.public_login_enabled,
    adminLoginAvailable: config.ready && row.admin_login_enabled,
    shopSignupAvailable: config.ready && row.shop_signup_enabled,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function listSocialAuthSettings() {
  const result = await query<StoredSetting>(
    `SELECT ${SETTING_COLUMNS} FROM bms_social_auth_settings ORDER BY provider`,
  );
  return result.rows.map(publicSetting);
}

export async function getSocialAuthAvailability(surfaceInput: unknown) {
  const surface = surfaceOf(surfaceInput);
  try {
    const result = await query<StoredSetting>(
      `SELECT ${SETTING_COLUMNS} FROM bms_social_auth_settings ORDER BY provider`,
    );
    const availability = { google: false, facebook: false };
    for (const row of result.rows) {
      const config = configReadiness(row.provider);
      availability[row.provider] = config.ready && surfaceEnabled(row, surface);
    }
    return availability;
  } catch (error) {
    // Login pages must retain password access while a migration or database incident is repaired.
    // Social auth fails closed; no module-level cache may keep an old enabled state across replicas.
    console.error("[social-auth] availability check failed; providers disabled", error);
    return { google: false, facebook: false };
  }
}

export async function assertSocialAuthAvailable(providerInput: unknown, surfaceInput: unknown) {
  const provider = providerOf(providerInput);
  const surface = surfaceOf(surfaceInput);
  const availability = await getSocialAuthAvailability(surface);
  if (!availability[provider]) {
    throw new GraphQLError("Social authentication is unavailable", {
      extensions: { code: "SOCIAL_AUTH_UNAVAILABLE", http: { status: 503 } },
    });
  }
  return provider;
}

export async function updateSocialAuthSetting(input: SocialAuthSettingInput, actorUserId: string) {
  const provider = providerOf(input.provider);
  const surface = surfaceOf(input.surface);
  if (!actorUserId) throw new Error("SOCIAL_AUTH_ACTOR_REQUIRED");
  const enabled = input.enabled === true;

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const current = await client.query<StoredSetting>(
      `SELECT ${SETTING_COLUMNS} FROM bms_social_auth_settings WHERE provider = $1 FOR UPDATE`,
      [provider],
    );
    const previousRow = current.rows[0];
    const previous = previousRow ? {
      publicLoginEnabled: previousRow.public_login_enabled,
      adminLoginEnabled: previousRow.admin_login_enabled,
      shopSignupEnabled: previousRow.shop_signup_enabled,
    } : {
      publicLoginEnabled: false,
      adminLoginEnabled: false,
      shopSignupEnabled: false,
    };

    const key = surface === "PUBLIC_LOGIN"
      ? "publicLoginEnabled"
      : surface === "ADMIN_LOGIN"
        ? "adminLoginEnabled"
        : "shopSignupEnabled";
    const next = { ...previous, [key]: enabled };

    if (enabled && previous[key] !== true) {
      const config = configReadiness(provider);
      if (!config.ready) {
        throw new GraphQLError("Social provider configuration is not ready", {
          extensions: {
            code: "SOCIAL_AUTH_CONFIG_NOT_READY",
            http: { status: 409 },
          },
        });
      }
    }

    const saved = await client.query<StoredSetting>(
      `INSERT INTO bms_social_auth_settings (
         provider, public_login_enabled, admin_login_enabled, shop_signup_enabled, updated_by, updated_at
       ) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (provider) DO UPDATE SET
         public_login_enabled = EXCLUDED.public_login_enabled,
         admin_login_enabled = EXCLUDED.admin_login_enabled,
         shop_signup_enabled = EXCLUDED.shop_signup_enabled,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
      RETURNING ${SETTING_COLUMNS}`,
      [provider, next.publicLoginEnabled, next.adminLoginEnabled, next.shopSignupEnabled, actorUserId],
    );
    await client.query(
      `INSERT INTO bms_social_auth_setting_events (
         provider, actor_user_id, previous_settings, next_settings
       ) VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
      [provider, actorUserId, JSON.stringify(previous), JSON.stringify(next)],
    );
    await client.query("COMMIT");
    return publicSetting(saved.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
