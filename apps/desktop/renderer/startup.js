const { posText, shellMessage } = window.bmsPosLocale;
window.initializePosLanguage();
const params = new URLSearchParams(window.location.search);
const loadingState = document.querySelector("#loading-state");
const loadingHeading = document.querySelector("#loading-heading");
const loadingMessage = document.querySelector("#loading-message");
const errorState = document.querySelector("#error-state");
const errorMessage = document.querySelector("#error-message");
const retryButton = document.querySelector("#retry-button");
const changeServerButton = document.querySelector("#change-server-button");
const exportButton = document.querySelector("#export-diagnostics-button");
const diagnosticReference = document.querySelector("#diagnostic-reference");
const diagnosticExportStatus = document.querySelector("#diagnostic-export-status");
let actionError = null;
let retrying = false;

function showActionError(message) {
  actionError = message;
  errorMessage.textContent = shellMessage(message);
}

function renderStartupState() {
  retryButton.textContent = retrying
    ? posText("กำลังลองใหม่…")
    : posText("ลองใหม่");
  if (params.get("state") === "starting") {
    loadingHeading.textContent = posText("กำลังเริ่ม Retail Local Server");
    loadingMessage.textContent =
      shellMessage(params.get("message")) ||
      posText("พบ Server ในเครื่องนี้ กำลังเริ่มบริการ กรุณารอสักครู่");
  } else if (["error", "storage-error"].includes(params.get("state"))) {
    loadingState.hidden = true;
    errorState.hidden = false;
    if (params.get("state") === "storage-error") {
      document.querySelector("#error-heading").textContent = posText(
        "ยังอ่านข้อมูลจับคู่เดิมไม่ได้"
      );
    }
    errorMessage.textContent =
      shellMessage(actionError) ??
      (shellMessage(params.get("message")) ||
        posText("กรุณาตรวจอินเทอร์เน็ตหรือเซิร์ฟเวอร์แล้วลองใหม่"));
  }
}
renderStartupState();
window.addEventListener("pos-language-changed", renderStartupState);
const summaryPromise = window.bmsDesktop.getDiagnosticSummary?.();
summaryPromise?.then(summary => {
  if (!summary) return;
  const parts = [];
  if (summary.last) parts.push(`${summary.last.code} · ${summary.last.eventId}`);
  if (summary.pending) parts.push(posText("รอส่ง {v0} เหตุการณ์", { v0: summary.pending }));
  if (summary.rejected) parts.push(posText("เซิร์ฟเวอร์ปฏิเสธ {v0} เหตุการณ์", { v0: summary.rejected }));
  if (summary.lastUploadFailure) parts.push(`Upload: ${summary.lastUploadFailure}`);
  if (summary.storageError) parts.push(posText("บันทึกข้อมูลตรวจสอบในเครื่องไม่สำเร็จ"));
  const dropped = summary.gaps?.reduce((sum, gap) => sum + gap.count, 0) ?? 0;
  if (dropped) parts.push(posText("ประวัติขาดหาย {v0} เหตุการณ์", { v0: dropped }));
  diagnosticReference.textContent = parts.join(" · ");
}).catch(() => { diagnosticReference.textContent = posText("อ่านข้อมูลตรวจสอบในเครื่องไม่ได้"); });

exportButton.addEventListener("click", async () => {
  exportButton.disabled = true;
  try {
    const result = await window.bmsDesktop.exportDiagnostics();
    diagnosticExportStatus.textContent = result?.ok
      ? posText("ส่งออกข้อมูลตรวจสอบสำเร็จ")
      : result?.cancelled ? "" : result?.error || posText("ส่งออกข้อมูลตรวจสอบไม่สำเร็จ");
  } catch { diagnosticExportStatus.textContent = posText("ส่งออกข้อมูลตรวจสอบไม่สำเร็จ"); }
  exportButton.disabled = false;
});

retryButton.addEventListener("click", async () => {
  retrying = true;
  retryButton.disabled = true;
  changeServerButton.disabled = true;
  retryButton.textContent = posText("กำลังลองใหม่…");
  let result;
  try {
    result = await window.bmsDesktop.retryStartup();
  } catch {
    result = null;
  }
  if (!result?.ok) {
    showActionError(
      result?.error || posText("ลองเชื่อมต่อใหม่ไม่สำเร็จ กรุณาลองอีกครั้ง")
    );
    retrying = false;
    retryButton.disabled = false;
    changeServerButton.disabled = false;
    retryButton.textContent = posText("ลองใหม่");
  }
});

changeServerButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  changeServerButton.disabled = true;
  try {
    const result = await window.bmsDesktop.changeServer();
    if (result?.ok) return;
    showActionError(
      result?.error || posText("เปลี่ยนเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่")
    );
  } catch {
    showActionError(posText("เปลี่ยนเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่"));
  }
  retryButton.disabled = false;
  changeServerButton.disabled = false;
});
