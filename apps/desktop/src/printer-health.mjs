// Electron status is a Winspool bitmask on Windows and an IPP enum on CUPS.
export function printerHealth(printer, platform = process.platform) {
  const blocked = message => ({ status: "blocked", message });
  if (!printer) return blocked("ไม่พบเครื่องพิมพ์ที่บันทึกไว้ ตรวจสายและเปิดเครื่องพิมพ์");
  if (platform === "win32") {
    const status = printer.status;
    if (!Number.isInteger(status)) return { status: "unknown", message: "ระบบไม่รายงานสถานะเครื่องพิมพ์ กรุณาพิมพ์ทดสอบ" };
    if (status & (0x80 | 0x02000000)) return blocked("เครื่องพิมพ์ออฟไลน์ ตรวจสายหรือเครือข่ายและเปิดเครื่องพิมพ์");
    if (status & 0x10) return blocked("กระดาษหมด กรุณาเติมกระดาษ");
    if (status & 0x8) return blocked("กระดาษติด กรุณานำกระดาษที่ติดออก");
    if (status & 0x00400000) return blocked("ฝาเครื่องพิมพ์เปิดอยู่ กรุณาปิดฝา");
    if (status & 0x1) return blocked("คิวพิมพ์ถูกพัก กรุณาเปิดคิวพิมพ์ในระบบปฏิบัติการ");
    const normal = 0x100 | 0x200 | 0x400 | 0x2000 | 0x4000 | 0x8000 | 0x10000 | 0x20000 | 0x01000000;
    if (status & ~normal) return blocked("เครื่องพิมพ์รายงานปัญหา กรุณาตรวจเครื่องและคิวพิมพ์");
    return { status: "ready", message: "ระบบไม่พบปัญหาเครื่องพิมพ์" };
  }
  const options = printer.options ?? {};
  const reasons = String(options["printer-state-reasons"] ?? "").split(",");
  if (reasons.some(reason => /offline|not-connected|unreachable/.test(reason))) return blocked("เครื่องพิมพ์ออฟไลน์ ตรวจสายหรือเครือข่ายและเปิดเครื่องพิมพ์");
  if (reasons.some(reason => /media-empty|media-tray-empty/.test(reason))) return blocked("กระดาษหมด กรุณาเติมกระดาษ");
  if (reasons.some(reason => /media-jam/.test(reason))) return blocked("กระดาษติด กรุณานำกระดาษที่ติดออก");
  if (reasons.some(reason => /cover-open|door-open/.test(reason))) return blocked("ฝาเครื่องพิมพ์เปิดอยู่ กรุณาปิดฝา");
  if (String(options["printer-is-accepting-jobs"]) === "false") return blocked("เครื่องพิมพ์ไม่รับงาน กรุณาตรวจคิวพิมพ์");
  const status = Number(options["printer-state"] ?? printer.status);
  if (status === 5 || reasons.some(reason => /paused|shutdown|stopping|offline|error$/.test(reason))) {
    return blocked("เครื่องพิมพ์หยุดทำงานหรือมีข้อผิดพลาด กรุณาตรวจเครื่องและคิวพิมพ์");
  }
  return [3, 4].includes(status)
    ? { status: "ready", message: "ระบบไม่พบปัญหาเครื่องพิมพ์" }
    : { status: "unknown", message: "ระบบไม่รายงานสถานะเครื่องพิมพ์ กรุณาพิมพ์ทดสอบ" };
}

export function printerReadiness(config, printers, problem = "", awaitingConfirmation = false, platform) {
  const selected = printers.find(printer => printer.name === config.deviceName);
  const health = printerHealth(selected, platform);
  const canTest = Boolean(selected) && health.status !== "blocked";
  const canPrint = canTest && !problem && !awaitingConfirmation && (health.status === "ready" || config.tested === true);
  const message = !config.deviceName ? "ยังไม่ได้ตั้งค่าเครื่องพิมพ์ใบเสร็จ"
    : health.status === "blocked" ? health.message
    : awaitingConfirmation ? "ส่งหน้าทดสอบเข้าคิวแล้ว กรุณายืนยันผลจากกระดาษ"
    : problem || (config.tested && health.status === "unknown" ? "ยืนยันผลทดสอบแล้ว (ไดรเวอร์ไม่รายงานสถานะสด)" : health.message);
  return { available: Boolean(selected), canTest, canPrint, awaitingConfirmation, message, health: health.status };
}
