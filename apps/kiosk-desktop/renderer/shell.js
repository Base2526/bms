const copy = {
  th: {
    staffOnly:"ตั้งค่าโดยพนักงาน",start:"เริ่มใช้งานจอ",connectTitle:"เชื่อมจอนี้กับสาขาของคุณ",
    connectDescription:"ออก URL จากแผง Kiosk ใน POS และรหัสเครื่องจากหลังบ้าน แล้วติดตั้งที่จอนี้",
    customerDevice:"เครื่องจอลูกค้า · แยกจาก Desktop POS",setupTitle:"ติดตั้ง URL ของสาขา",
    setupSubtitle:"ตรวจสาขาจากเซิร์ฟเวอร์ก่อนเปิดจอ",urlLabel:"URL จอสั่งอาหาร",
    credentialLabel:"รหัสจับคู่เครื่อง Kiosk",credentialHint:"ใช้รหัสที่แสดงครั้งเดียวในหลังบ้าน เว้นว่างได้เมื่อเปลี่ยน URL บนเครื่องเดิม",
    verifyBranch:"ตรวจ URL และสาขา",
    openCustomer:"ตรวจสอบและเปิดจอลูกค้า",noPosAccess:"เครื่องนี้ไม่มี PIN พนักงาน สิทธิ์ POS หรือระบบรับเงิน",
    customerOnly:"เครื่องนี้ใช้แสดงหน้าสั่งอาหารเท่านั้น",pinTitle:"PIN ผู้ดูแลจอ",
    pinDescription:"กรอก PIN ดูแลเครื่องเพื่อเปลี่ยน URL หรือการตั้งค่า PIN นี้ใช้รับคำสั่งอาหารไม่ได้",
    pinLabel:"PIN ดูแลเครื่อง 6–8 หลัก",unlock:"ปลดล็อกการตั้งค่า",backToCustomer:"กลับจอลูกค้า",
    unavailable:"จอสั่งอาหารไม่พร้อมใช้งาน",retry:"ลองเชื่อมต่ออีกครั้ง",staffSettings:"ตั้งค่าโดยพนักงาน",
    checkPosBeforeRetry:"กรุณาให้พนักงานตรวจคำขอใน POS ก่อนเริ่มสั่งใหม่",
    staffCanSearch:"พนักงานสามารถค้นคำขอด้วยรหัสใน POS",networkTitle:"เชื่อมต่อไม่ได้ในขณะนี้",
    networkDescription:"กรุณาติดต่อพนักงานเพื่อช่วยตรวจคำขอ ก่อนเริ่มสั่งใหม่",
    revokedTitle:"เครื่องนี้ถูกปิดใช้งาน",revokedDescription:"กรุณาติดต่อพนักงานเพื่อตรวจเครื่องและ URL",
    bindingTitle:"URL ใช้ไม่ได้",bindingDescription:"URL อาจถูกหมุนหรือปิด กรุณาให้พนักงานติดตั้ง URL ใหม่",
    storageTitle:"อ่านข้อมูลเครื่องไม่ได้",storageDescription:"กรุณาให้ IT ตรวจบัญชีเครื่องและที่เก็บข้อมูลปลอดภัย",
    serverTitle:"บริการไม่พร้อมชั่วคราว",serverDescription:"กรุณาติดต่อพนักงานและลองอีกครั้งภายหลัง",
    crashTitle:"หน้าจอสั่งอาหารหยุดทำงาน",crashDescription:"กรุณาติดต่อพนักงานเพื่อตรวจคำขอก่อนเปิดจอใหม่",
    invalidUrl:"URL ไม่ถูกต้องหรือไม่ได้รับอนุญาต",invalidCredential:"รหัสจับคู่เครื่องไม่ถูกต้อง",
    busy:"กำลังตรวจสอบ…",saved:"ตรวจพบสาขาแล้ว ตรวจชื่อร้าน/สาขาก่อนเปิดจอ",pinInvalid:"PIN ไม่ถูกต้อง",
    pinChanged:"PIN ถูกเปลี่ยนแล้ว กรุณาปลดล็อกใหม่",storageFailed:"บันทึกข้อมูลเครื่องไม่ได้ กรุณาติดต่อ IT",
    pinLocked:"ใส่ PIN ผิดหลายครั้ง เครื่องถูกล็อกชั่วคราว",pinNoPin:"ยังไม่ได้ตั้ง PIN ดูแลจอในหลังบ้าน",
    failed:"ตรวจสอบไม่สำเร็จ กรุณาติดต่อพนักงาน",pinNetwork:"ตรวจ PIN ไม่ได้ กรุณาตรวจเครือข่าย",
    retryLater:"กรุณารอ 5 วินาทีก่อนลองใหม่",
  },
  en: {
    staffOnly:"Staff setup",start:"Getting started",connectTitle:"Connect this screen to your branch",
    connectDescription:"Issue a kiosk URL in POS and a device credential in the back office, then provision this screen.",
    customerDevice:"Customer screen · separate from Desktop POS",setupTitle:"Install the branch URL",
    setupSubtitle:"Verify the branch with the server first",urlLabel:"Customer ordering URL",
    credentialLabel:"Kiosk device credential",credentialHint:"Use the one-time back-office credential. Leave blank when only changing this screen's URL.",
    verifyBranch:"Verify URL and branch",
    openCustomer:"Verify and open customer screen",noPosAccess:"This screen has no cashier PIN, POS permissions or payment flow.",
    customerOnly:"This device displays customer ordering only",pinTitle:"Screen maintenance PIN",
    pinDescription:"Enter the maintenance PIN to change the URL or device settings. It cannot accept food orders.",
    pinLabel:"6–8 digit maintenance PIN",unlock:"Unlock settings",backToCustomer:"Return to customer screen",
    unavailable:"Ordering screen unavailable",retry:"Try connecting again",staffSettings:"Staff settings",
    checkPosBeforeRetry:"Ask staff to check the request in POS before ordering again.",
    staffCanSearch:"Staff can search by request code in POS",networkTitle:"Cannot connect right now",
    networkDescription:"Please ask staff to check your request before starting again.",
    revokedTitle:"This screen is disabled",revokedDescription:"Ask staff to check the device and URL.",
    bindingTitle:"URL unavailable",bindingDescription:"The URL may have been rotated or disabled. Ask staff to install a new URL.",
    storageTitle:"Cannot read device settings",storageDescription:"Ask IT to check the OS account and secure storage.",
    serverTitle:"Service temporarily unavailable",serverDescription:"Please ask staff and try again later.",
    crashTitle:"Ordering screen stopped",crashDescription:"Ask staff to check your request before reopening the screen.",
    invalidUrl:"Invalid or unapproved URL",invalidCredential:"Invalid device credential",busy:"Checking…",
    saved:"Branch verified. Confirm the shop and branch before opening.",pinInvalid:"Incorrect PIN",pinLocked:"Too many attempts. This screen is temporarily locked.",
    pinChanged:"Maintenance PIN changed. Unlock again.",storageFailed:"Could not save device settings. Ask IT.",
    pinNoPin:"No maintenance PIN has been set in the back office.",failed:"Could not verify. Please ask staff.",
    pinNetwork:"Cannot verify PIN. Check the network.",retryLater:"Please wait 5 seconds before retrying.",
  },
};

let language = "th";
let view = "recovery";
let reason = "NETWORK";
let canMaintain = false;
const $ = (id) => document.getElementById(id);
const say = (key) => copy[language][key] || key;

function showStatus(id, text, success = false) {
  const element = $(id);
  element.hidden = !text;
  element.textContent = text;
  element.classList.toggle("success", success);
}

function setupError(code) {
  return say(code === "INVALID_URL" ? "invalidUrl" : code === "INVALID_CREDENTIAL" ? "invalidCredential"
    : code === "NO_PIN" ? "pinNoPin" : code === "PIN_CHANGED" ? "pinChanged"
      : code === "BINDING" ? "bindingDescription" : code === "REVOKED" ? "revokedDescription"
        : code === "NETWORK" ? "networkDescription" : code === "STORAGE" ? "storageFailed" : "failed");
}

function render() {
  document.documentElement.lang = language;
  for (const element of document.querySelectorAll("[data-text]")) element.textContent = say(element.dataset.text);
  for (const name of ["setup", "pin", "recovery"]) $(name).hidden = name !== view;
  const kind = reason === "REVOKED" ? "revoked" : reason === "BINDING" ? "binding"
    : reason === "STORAGE" ? "storage" : reason === "SERVER" ? "server"
      : reason === "CRASH" ? "crash" : "network";
  $("recovery-title").textContent = say(`${kind}Title`);
  $("recovery-description").textContent = say(`${kind}Description`);
  $("retry").hidden = kind === "revoked" || kind === "binding" || kind === "storage";
  $("open-maintenance").hidden = !canMaintain;
  if (view === "pin") $("maintenance-pin").focus();
  if (view === "setup") $("kiosk-url").focus();
}

async function refreshState() {
  const state = await window.bmsKiosk.getState();
  view = state.view;
  reason = state.reason || "NETWORK";
  canMaintain = Boolean(state.canMaintain);
  if (state.maskedUrl) $("kiosk-url").placeholder = state.maskedUrl;
  render();
}

for (const button of document.querySelectorAll("[data-toggle-language]")) button.addEventListener("click", () => {
  language = language === "th" ? "en" : "th"; render();
});

for (const input of [$("kiosk-url"), $("device-token")]) input.addEventListener("input", () => {
  $("setup-open").hidden = true;
  showStatus("setup-status", "");
});

$("setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = $("kiosk-url").value.trim();
  const deviceToken = $("device-token").value.trim();
  $("setup-submit").disabled = true;
  showStatus("setup-status", say("busy"));
  try {
    const result = await window.bmsKiosk.validate({ url, deviceToken });
    if (!result.ok) throw new Error(result.code);
    $("device-token").value = "";
    $("kiosk-url").value = "";
    $("kiosk-url").placeholder = `${new URL(url).origin}/kiosk/••••`;
    showStatus("setup-status", `${say("saved")} · ${result.storeName} · ${result.locationName}`, true);
    $("setup-open").hidden = false;
  } catch (error) {
    showStatus("setup-status", setupError(error.message));
  } finally { $("setup-submit").disabled = false; }
});

$("setup-open").addEventListener("click", async () => {
  $("setup-open").disabled = true;
  showStatus("setup-status", say("busy"));
  try {
    const result = await window.bmsKiosk.activate();
    if (!result.ok) throw new Error(result.code);
    $("device-token").value = "";
    $("kiosk-url").value = "";
  } catch (error) {
    $("setup-open").hidden = true;
    showStatus("setup-status", setupError(error.message));
  } finally { $("setup-open").disabled = false; }
});

$("pin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = $("maintenance-pin").value;
  $("maintenance-pin").value = "";
  $("pin-submit").disabled = true;
  showStatus("pin-status", say("busy"));
  try {
    const result = await window.bmsKiosk.verifyPin(pin);
    if (!result.ok) throw new Error(result.code);
    showStatus("pin-status", "");
    await refreshState();
  } catch (error) {
    showStatus("pin-status", say(error.message === "LOCKED" || error.message === "RATE_LIMITED" ? "pinLocked"
      : error.message === "NO_PIN" ? "pinNoPin"
        : error.message === "REVOKED" ? "revokedDescription"
          : error.message === "NETWORK" || error.message === "SERVER" ? "pinNetwork" : "pinInvalid"));
  } finally { $("pin-submit").disabled = false; }
});

$("pin-cancel").addEventListener("click", () => void window.bmsKiosk.cancelMaintenance());
$("retry").addEventListener("click", async () => {
  $("retry").disabled = true;
  showStatus("recovery-status", say("busy"));
  try {
    const result = await window.bmsKiosk.retry();
    if (result?.code === "RATE_LIMITED") showStatus("recovery-status", say("retryLater"));
  } catch { showStatus("recovery-status", say("networkDescription")); }
  finally { setTimeout(() => { $("retry").disabled = false; }, 5000); }
});
$("open-maintenance").addEventListener("click", () => void window.bmsKiosk.openMaintenance());
void refreshState().catch(() => { view = "recovery"; reason = "SERVER"; render(); });
