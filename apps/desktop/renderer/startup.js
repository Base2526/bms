const params = new URLSearchParams(window.location.search);
const loadingState = document.querySelector("#loading-state");
const loadingHeading = document.querySelector("#loading-heading");
const loadingMessage = document.querySelector("#loading-message");
const errorState = document.querySelector("#error-state");
const errorMessage = document.querySelector("#error-message");
const retryButton = document.querySelector("#retry-button");
const changeServerButton = document.querySelector("#change-server-button");

if (params.get("state") === "starting") {
  loadingHeading.textContent = "กำลังเริ่ม Retail Local Server";
  loadingMessage.textContent = params.get("message")
    || "พบ Server ในเครื่องนี้ กำลังเริ่มบริการ กรุณารอสักครู่";
} else if (["error", "storage-error"].includes(params.get("state"))) {
  loadingState.hidden = true;
  errorState.hidden = false;
  if (params.get("state") === "storage-error") {
    document.querySelector("#error-heading").textContent = "ยังอ่านข้อมูลจับคู่เดิมไม่ได้";
  }
  errorMessage.textContent = params.get("message") || "กรุณาตรวจอินเทอร์เน็ตหรือเซิร์ฟเวอร์แล้วลองใหม่";
}

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  changeServerButton.disabled = true;
  retryButton.textContent = "กำลังลองใหม่…";
  let result;
  try {
    result = await window.bmsDesktop.retryStartup();
  } catch {
    result = null;
  }
  if (!result?.ok) {
    errorMessage.textContent = result?.error || "ลองเชื่อมต่อใหม่ไม่สำเร็จ กรุณาลองอีกครั้ง";
    retryButton.disabled = false;
    changeServerButton.disabled = false;
    retryButton.textContent = "ลองใหม่";
  }
});

changeServerButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  changeServerButton.disabled = true;
  try {
    const result = await window.bmsDesktop.changeServer();
    if (result?.ok) return;
    errorMessage.textContent = result?.error || "เปลี่ยนเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่";
  } catch {
    errorMessage.textContent = "เปลี่ยนเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่";
  }
  retryButton.disabled = false;
  changeServerButton.disabled = false;
});
