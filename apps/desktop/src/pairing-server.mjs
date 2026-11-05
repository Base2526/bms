export class PairingServerResponseError extends Error {
  constructor(status, userMessage) {
    super(`Pairing server responded with HTTP ${status}`);
    this.name = "PairingServerResponseError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

export function assertPairingServerResponse(response) {
  if (response?.ok) return;
  const status = Number(response?.status) || 0;
  if (status === 401) {
    throw new PairingServerResponseError(
      status,
      "Server ไม่รับ Device Token (HTTP 401) กรุณาให้ผู้ดูแลตรวจ URL สถานะเครื่อง และการออก token ใหม่ให้เครื่องเดิมก่อนจับคู่เครื่องใหม่",
    );
  }
  if (status === 403) {
    throw new PairingServerResponseError(
      status,
      "เครื่องนี้ไม่มีสิทธิ์เข้าใช้งาน Server (HTTP 403) กรุณาติดต่อผู้ดูแลร้านเพื่อตรวจสิทธิ์",
    );
  }
  if (status >= 500) {
    throw new PairingServerResponseError(
      status,
      `Server ยังไม่พร้อมใช้งาน (HTTP ${status}) กรุณาลองใหม่หรือตรวจสอบสถานะ Server`,
    );
  }
  throw new PairingServerResponseError(
    status,
    status > 0
      ? `Server ไม่รองรับการเชื่อมต่อ BMS POS (HTTP ${status}) กรุณาตรวจสอบ URL หรือเปลี่ยน Server`
      : "Server ตอบกลับไม่ถูกต้อง กรุณาตรวจสอบ URL หรือเปลี่ยน Server",
  );
}

/** Bound both headers and body reads. A proxy login page is not a verified POS session. */
export async function fetchPairingSession(pairing, fetcher, timeoutMs = 5_000) {
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const error = new Error("Pairing server request timed out");
        error.userMessage = "เซิร์ฟเวอร์ไม่ตอบภายในเวลาที่กำหนด กรุณาตรวจเครือข่ายหรือเซิร์ฟเวอร์แล้วลองใหม่";
        reject(error);
      }, timeoutMs);
    });
    return await Promise.race([(async () => {
      const response = await fetcher(new URL("/api/pos/session", pairing.serverUrl), {
        method: "GET", cache: "no-store", redirect: "manual", signal: controller.signal,
        headers: { "x-pos-device-token": pairing.token },
      });
      assertPairingServerResponse(response);
      let session;
      try { session = await response.json(); } catch {
        throw new PairingServerResponseError(response.status, "เซิร์ฟเวอร์ตอบข้อมูลที่ไม่ใช่ BMS POS กรุณาตรวจ URL และการเชื่อมต่อ");
      }
      if (typeof session?.device?.id !== "string" || !session.device.id.trim()
        || typeof session?.device?.code !== "string" || !session.device.code.trim()) {
        throw new PairingServerResponseError(response.status, "เซิร์ฟเวอร์ไม่ส่งข้อมูลเครื่อง BMS POS กรุณาตรวจ URL แล้วลองใหม่");
      }
      return session;
    })(), timeout]);
  } finally { clearTimeout(timer); }
}

export function canRecoverByStartingManagedLocalRuntime(error) {
  return !(error instanceof PairingServerResponseError) || error.status >= 500;
}

export function adminUrlForServer(serverUrl) {
  return new URL("/admin/login", serverUrl).toString();
}

// Where a POS-only machine (no Retail Local server) creates its pairing link.
export const BMS_CLOUD_SERVER_URL = "https://bms.jachoei.com";

export function cloudAdminUrl() {
  return adminUrlForServer(BMS_CLOUD_SERVER_URL);
}
