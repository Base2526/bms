const TRUSTED_LINUX_BACKENDS = new Set([
  "gnome_libsecret",
  "kwallet",
  "kwallet5",
  "kwallet6",
]);

const UNAVAILABLE_MESSAGES = {
  darwin: "macOS Keychain ไม่พร้อมเข้ารหัสข้อมูลเครื่อง POS กรุณาปลดล็อก Keychain แล้วลองใหม่",
  linux: "Linux Keyring ไม่พร้อมเข้ารหัสข้อมูลเครื่อง POS กรุณาติดตั้งและปลดล็อก Secret Service หรือ KWallet แล้วลองใหม่",
  win32: "Windows ไม่พร้อมเข้ารหัสข้อมูลเครื่อง POS กรุณาล็อกอิน Windows แล้วลองใหม่",
};

export function secureStorageStatus({ platform, encryptionAvailable, backend = null }) {
  if (!encryptionAvailable) {
    return {
      ok: false,
      error: UNAVAILABLE_MESSAGES[platform] ?? "ระบบปฏิบัติการไม่พร้อมเข้ารหัสข้อมูลเครื่อง POS",
    };
  }

  if (platform === "linux" && !TRUSTED_LINUX_BACKENDS.has(backend)) {
    return {
      ok: false,
      error: "Linux เครื่องนี้ไม่มี Keyring ที่ปลอดภัยสำหรับ Device Token กรุณาเปิด GNOME Keyring/Secret Service หรือ KWallet แล้วเปิดแอปใหม่",
    };
  }

  return { ok: true };
}

export function platformClientLabel(platform) {
  if (platform === "darwin") return "macOS Client";
  if (platform === "linux") return "Linux Client";
  return "Windows Client";
}

export function platformSecurityNote(platform) {
  if (platform === "darwin") return "token ถูกเข้ารหัสด้วย macOS Keychain ของเครื่องนี้";
  if (platform === "linux") return "token ถูกเข้ารหัสด้วย Linux Keyring ของบัญชีนี้";
  return "token ถูกเข้ารหัสด้วยบัญชี Windows ของเครื่องนี้";
}
