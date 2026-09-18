const form = document.querySelector("#pairing-form");
const serverInput = document.querySelector("#server-url");
const pairingInput = document.querySelector("#pairing-input");
const status = document.querySelector("#status");
const button = document.querySelector("#pair-button");
const buttonLabel = button.querySelector(".button-label");
const buttonProgress = button.querySelector(".button-progress");
const version = document.querySelector("#app-version");

function setBusy(busy) {
  button.disabled = busy;
  serverInput.disabled = busy;
  pairingInput.disabled = busy;
  buttonLabel.hidden = busy;
  buttonProgress.hidden = !busy;
}

function showError(message) {
  status.textContent = message;
  status.className = "status error";
  status.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.hidden = true;
  setBusy(true);
  try {
    const result = await window.bmsDesktop.pair({
      serverUrl: serverInput.value,
      pairingInput: pairingInput.value,
    });
    if (!result?.ok) showError(result?.error || "เชื่อมต่อไม่สำเร็จ");
  } catch {
    showError("แอปไม่สามารถตรวจสอบการจับคู่ได้ กรุณาปิดแล้วเปิดใหม่");
  } finally {
    setBusy(false);
  }
});

window.bmsDesktop.getAppInfo().then((info) => {
  if (info?.version) version.textContent = `v${info.version}`;
});
