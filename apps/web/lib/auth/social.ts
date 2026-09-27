import fetch from "node-fetch";
import { OAuth2Client } from "google-auth-library";

export type SocialProvider = "google" | "facebook";
export type VerifiedSocialIdentity = {
  email: string;
  name: string;
  picture: string;
  provider: SocialProvider;
  provider_id: string;
  email_verified: true;
};

const SOCIAL_TOKEN_MAX_LENGTH = 8192;
const FACEBOOK_TIMEOUT_MS = 8000;

function usableToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= SOCIAL_TOKEN_MAX_LENGTH;
}

async function facebookJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FACEBOOK_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`FACEBOOK_HTTP_${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function logProviderFailure(provider: SocialProvider, error: unknown): void {
  // Provider errors may contain the request URL, whose query string carries a token.
  console.error(`[verify${provider === "google" ? "Google" : "Facebook"}] failed`, {
    error: error instanceof Error ? error.name : "UnknownError",
  });
}

/* =====================================================
   Verify Google Credential  (From @react-oauth/google)
   ===================================================== */

export async function verifyGoogle(accessToken: string) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || !usableToken(accessToken)) return null;
    const ticket = await new OAuth2Client(clientId).verifyIdToken({
      idToken: accessToken,
      audience: clientId,
    });
    const googleData = ticket.getPayload();
    if (!googleData?.sub || !googleData.email || googleData.email_verified !== true) return null;

    return {
      email: googleData.email,
      name: googleData.name || googleData.given_name || "",
      picture: googleData.picture || "",
      provider: "google",
      provider_id: googleData.sub,
      email_verified: true,
    } satisfies VerifiedSocialIdentity;
  } catch (err) {
    logProviderFailure("google", err);
    return null;
  }
}

/* =====================================================
   Verify Facebook Token
   ===================================================== */

export async function verifyFacebook(accessToken: string) {
  try {
    const FB_APP_ID = process.env.FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    if (!FB_APP_ID || !FB_APP_SECRET || !usableToken(accessToken)) return null;
    
    // ตรวจสอบ token ว่าถูกต้องหรือไม่
    const debugUrl = new URL("https://graph.facebook.com/debug_token");
    debugUrl.searchParams.set("input_token", accessToken);
    debugUrl.searchParams.set("access_token", `${FB_APP_ID}|${FB_APP_SECRET}`);
    const debugRes = await facebookJson(debugUrl.toString());

    if (!debugRes?.data?.is_valid || String(debugRes.data.app_id) !== String(FB_APP_ID)) {
      return null;
    }

    // ดึงข้อมูล user
    const meUrl = new URL("https://graph.facebook.com/me");
    meUrl.searchParams.set("fields", "id,name,email,picture");
    meUrl.searchParams.set("access_token", accessToken);
    const me = await facebookJson(meUrl.toString());

    if (!me?.id || String(me.id) !== String(debugRes.data.user_id) || !me.email) return null;

    return {
      email: String(me.email),            // FB บางบัญชีไม่มี email
      name: String(me.name || ""),
      picture: me.picture?.data?.url || "",
      provider: "facebook",
      provider_id: String(me.id),
      email_verified: true,
    } satisfies VerifiedSocialIdentity;
  } catch (err) {
    logProviderFailure("facebook", err);
    return null;
  }
}

export async function verifySocialIdentity(provider: string, accessToken: string) {
  const normalized = String(provider ?? "").trim().toLowerCase();
  if (normalized === "google") return verifyGoogle(accessToken);
  if (normalized === "facebook") return verifyFacebook(accessToken);
  return null;
}
