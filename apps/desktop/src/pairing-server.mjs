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
      "Device Token ไม่ถูกต้อง ถูกยกเลิก หรือหมดอายุ กรุณาเปลี่ยนเซิร์ฟเวอร์หรือจับคู่เครื่องใหม่",
    );
  }
  if (status === 403) {
    throw new PairingServerResponseError(
      status,
      "เครื่องนี้ไม่มีสิทธิ์เข้าใช้งาน Server กรุณาติดต่อผู้ดูแลร้านหรือจับคู่เครื่องใหม่",
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

export function canRecoverByStartingManagedLocalRuntime(error) {
  return !(error instanceof PairingServerResponseError) || error.status >= 500;
}

export function adminUrlForServer(serverUrl) {
  return new URL("/admin/login", serverUrl).toString();
}
