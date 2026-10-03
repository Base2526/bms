const form = document.querySelector("#pairing-form");
const serverInput = document.querySelector("#server-url");
const pairingInput = document.querySelector("#pairing-input");
const status = document.querySelector("#status");
const statusMessage = document.querySelector("#status-message");
const statusClose = document.querySelector("#status-close");
const button = document.querySelector("#pair-button");
const buttonLabel = button.querySelector(".button-label");
const buttonProgress = button.querySelector(".button-progress");
const adminLinkRow = document.querySelector("#admin-link-row");
const adminLink = document.querySelector("#admin-link");
const adminLinkLabel = document.querySelector("#admin-link-label");
const adminLinkProgress = adminLink.querySelector(".button-progress");
const version = document.querySelector("#app-version");
const clientLabel = document.querySelector("#client-label");
const securityNote = document.querySelector("#security-note");

let storageBlocked = false;

function setBusy(busy, action = "pair") {
  button.disabled = busy || storageBlocked;
  adminLink.disabled = busy;
  serverInput.disabled = busy;
  pairingInput.disabled = busy;
  buttonLabel.hidden = busy && action === "pair";
  buttonProgress.hidden = !(busy && action === "pair");
  adminLinkLabel.hidden = busy && action === "admin";
  adminLinkProgress.hidden = !(busy && action === "admin");
}

function showError(message) {
  statusMessage.textContent = message;
  status.className = "status error";
  status.hidden = false;
}

statusClose.addEventListener("click", () => {
  status.hidden = true;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.hidden = true;
  setBusy(true, "pair");
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

const ADMIN_LINK_LABELS = {
  local: "สร้างจากระบบหลังบ้านบนเครื่องนี้",
  cloud: "สร้างจากระบบหลังบ้าน BMS",
};

function showAdminLink(kind) {
  adminLinkLabel.textContent = ADMIN_LINK_LABELS[kind] ?? ADMIN_LINK_LABELS.cloud;
  adminLinkRow.hidden = false;
}

adminLink.addEventListener("click", async () => {
  status.hidden = true;
  setBusy(true, "admin");
  try {
    const result = await window.bmsDesktop.openSetupAdmin();
    if (result?.kind) showAdminLink(result.kind);
    if (!result?.ok) showError(result?.error || "เปิดระบบหลังบ้านไม่สำเร็จ");
    else if (result.kind === "local" && !serverInput.value.trim() && !pairingInput.value.trim() && result.serverUrl) {
      serverInput.value = result.serverUrl;
    }
  } catch {
    showError("แอปไม่สามารถเปิดระบบหลังบ้านได้ กรุณาปิดแล้วเปิดใหม่");
  } finally {
    setBusy(false);
  }
});

// Label the link only once we know where it goes; a wrong label is worse than a short delay.
window.bmsDesktop.getSetupAdminTarget()
  .then((target) => showAdminLink(target?.kind))
  .catch(() => showAdminLink("cloud"));

window.bmsDesktop.getAppInfo().then((info) => {
  if (info?.version) version.textContent = `v${info.version}`;
  if (info?.clientLabel) clientLabel.textContent = info.clientLabel;
  if (info?.securityNote) securityNote.textContent = info.securityNote;
  if (info?.secureStorageReady === false) {
    storageBlocked = true;
    button.disabled = true;
    showError(info.secureStorageError || "ระบบปฏิบัติการไม่มีที่เก็บ Device Token ที่ปลอดภัย");
  }
}).catch(() => {
  showError("อ่านข้อมูลแอปไม่สำเร็จ กรุณาปิดแล้วเปิด BMS POS ใหม่");
});
