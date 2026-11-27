const TIMEOUT_MS = 8000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class KioskDeviceApiError extends Error {
  constructor(code) { super(code); this.name = "KioskDeviceApiError"; this.code = code; }
}

export function createKioskDeviceApi(fetcher = globalThis.fetch) {
  async function publicMenu(origin, publicToken) {
    let response;
    try {
      response = await fetcher(new URL(`/api/bms/restaurant-kiosk/${encodeURIComponent(publicToken)}`, origin),
        { method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) { throw new KioskDeviceApiError(error?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK"); }
    if (response.status >= 300 && response.status < 400) throw new KioskDeviceApiError("REDIRECT");
    if (response.status === 410) throw new KioskDeviceApiError("BINDING");
    if (response.status === 429) throw new KioskDeviceApiError("RATE_LIMITED");
    if (response.status >= 500) {
      let code;
      try { code = (await response.json())?.code; } catch {}
      throw new KioskDeviceApiError(code === "RATE_LIMIT_UNAVAILABLE" ? "REDIS_UNAVAILABLE" : "SERVER");
    }
    if (!response.ok) throw new KioskDeviceApiError("BINDING");
    let data;
    try { data = await response.json(); } catch { throw new KioskDeviceApiError("INVALID_RESPONSE"); }
    if (typeof data?.storeName !== "string" || typeof data?.locationName !== "string") {
      throw new KioskDeviceApiError("INVALID_RESPONSE");
    }
    return { storeName: data.storeName, locationName: data.locationName };
  }
  async function call(origin, deviceToken, method, body) {
    let response;
    try {
      response = await fetcher(new URL("/api/bms/restaurant-kiosk-device", origin), {
        method, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "x-kiosk-device-token": deviceToken,
          ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) { throw new KioskDeviceApiError(error?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK"); }
    if (response.status >= 300 && response.status < 400) throw new KioskDeviceApiError("REDIRECT");
    if (response.status === 401) throw new KioskDeviceApiError("REVOKED");
    if (response.status === 429) throw new KioskDeviceApiError("RATE_LIMITED");
    let data;
    try { data = await response.json(); }
    catch { throw new KioskDeviceApiError(response.status >= 500 ? "SERVER" : "INVALID_RESPONSE"); }
    if (response.status >= 500) throw new KioskDeviceApiError(
      data?.code === "RATE_LIMIT_UNAVAILABLE" ? "REDIS_UNAVAILABLE" : "SERVER");
    if (!response.ok) {
      if (body?.action === "bind") throw new KioskDeviceApiError(
        ["WRONG_BRANCH", "PIN_CHANGED", "NO_PIN", "URL_UNAVAILABLE"].includes(data?.code)
          ? data.code : "BINDING");
      throw new KioskDeviceApiError(data?.status === "LOCKED" ? "LOCKED"
        : data?.status === "NO_PIN" ? "NO_PIN" : "INVALID_PIN");
    }
    return data;
  }
  return {
    publicMenu,
    async status(origin, token) {
      const data = await call(origin, token, "GET");
      if (typeof data?.pinConfigured !== "boolean" || !UUID.test(data?.pinVersion ?? "")) {
        throw new KioskDeviceApiError("INVALID_RESPONSE");
      }
      return data;
    },
    async bind(origin, token, publicToken, pinVersion) {
      const data = await call(origin, token, "POST", { action: "bind", publicToken, pinVersion });
      if (typeof data?.storeName !== "string" || typeof data?.locationName !== "string") {
        throw new KioskDeviceApiError("INVALID_RESPONSE");
      }
      return data;
    },
    async verifyPin(origin, token, pin) {
      const data = await call(origin, token, "POST", { action: "verifyPin", pin });
      if (data?.status !== "OK" || !UUID.test(data?.pinVersion ?? "")) {
        throw new KioskDeviceApiError("INVALID_RESPONSE");
      }
      return data;
    },
  };
}
