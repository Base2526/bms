import fetch from "node-fetch";
import { OAuth2Client } from "google-auth-library";

/* =====================================================
   Verify Google Credential  (From @react-oauth/google)
   ===================================================== */

export async function verifyGoogle(accessToken: string) {
  try {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || !accessToken) return null;
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
    };
  } catch (err) {
    console.error("[verifyGoogle] error", err);
    return null;
  }
}

/* =====================================================
   Verify Facebook Token
   ===================================================== */

export async function verifyFacebook(accessToken: string) {
  try {
    const FB_APP_ID = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
    if (!FB_APP_ID || !FB_APP_SECRET || !accessToken) return null;
    
    // ตรวจสอบ token ว่าถูกต้องหรือไม่
    const debugUrl = `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${FB_APP_ID}|${FB_APP_SECRET}`;
    const debugRes = await fetch(debugUrl).then(r => r.json());

    if (!debugRes?.data?.is_valid || String(debugRes.data.app_id) !== String(FB_APP_ID)) {
      return null;
    }

    // ดึงข้อมูล user
    const meUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`;
    const me = await fetch(meUrl).then(r => r.json());

    if (!me?.id || String(me.id) !== String(debugRes.data.user_id) || !me.email) return null;

    return {
      email: me.email,                    // FB บางบัญชีไม่มี email
      name: me.name,
      picture: me.picture?.data?.url || "",
      provider: "facebook",
      provider_id: me.id,
      email_verified: true,
    };
  } catch (err) {
    console.error("[verifyFacebook] error", err);
    return null;
  }
}
