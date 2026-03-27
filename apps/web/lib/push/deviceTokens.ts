import { query } from "@/lib/db";

export type RegisterPushTokenInput = {
  platform: "android";
  fcmToken: string;
  deviceId?: string | null;
  appVersion?: string | null;
  locale?: string | null;
};

export async function upsertDevicePushToken(userId: string, input: RegisterPushTokenInput) {
  const fcmToken = String(input.fcmToken || "").trim();
  if (!fcmToken) throw new Error("Missing fcmToken");

  const platform = input.platform;

  const deviceId = input.deviceId ? String(input.deviceId).trim() : null;
  const appVersion = input.appVersion ? String(input.appVersion).trim() : null;
  const locale = input.locale ? String(input.locale).trim() : null;

  await query(
    `
    INSERT INTO device_push_tokens (user_id, platform, fcm_token, device_id, app_version, locale, is_active, last_seen_at)
    VALUES ($1,$2,$3,$4,$5,$6,TRUE,NOW())
    ON CONFLICT (fcm_token)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      platform = EXCLUDED.platform,
      device_id = EXCLUDED.device_id,
      app_version = EXCLUDED.app_version,
      locale = EXCLUDED.locale,
      is_active = TRUE,
      last_seen_at = NOW()
    `,
    [userId, platform, fcmToken, deviceId, appVersion, locale]
  );

  return true;
}

export async function deactivateDevicePushToken(userId: string, fcmToken: string) {
  const token = String(fcmToken || "").trim();
  if (!token) return true;

  await query(
    `
    UPDATE device_push_tokens
       SET is_active = FALSE,
           last_seen_at = NOW()
     WHERE user_id = $1
       AND fcm_token = $2
    `,
    [userId, token]
  );

  return true;
}

export async function deactivateAllDevicePushTokens(userId: string) {
  await query(
    `
    UPDATE device_push_tokens
       SET is_active = FALSE,
           last_seen_at = NOW()
     WHERE user_id = $1
    `,
    [userId]
  );

  return true;
}

export async function listActiveFcmTokens(userId: string): Promise<string[]> {
  const { rows } = await query(
    `
    SELECT fcm_token
      FROM device_push_tokens
     WHERE user_id = $1
       AND is_active = TRUE
       AND platform = 'android'
    `,
    [userId]
  );

  return rows.map((r: any) => String(r.fcm_token));
}
