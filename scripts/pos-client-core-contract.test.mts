import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  initialPosClientFlow,
  transitionPosClientFlow,
} from "../packages/pos-client-core/src/flow.ts";
import {
  calculateCashChange,
  validatePayments,
} from "../packages/pos-client-core/src/payment.ts";
import { selectPosCatalogCardVariant } from "../packages/pos-client-core/src/catalog.ts";
import {
  isPosPinValid,
  normalizePosPinInput,
  POS_PIN_MAX_LENGTH,
  POS_PIN_MIN_LENGTH,
  visiblePosPinSlots,
} from "../packages/pos-client-core/src/posPin.ts";
import { receiptPayloadFromPosSale } from "../apps/web/lib/pos/posSaleReceipt.ts";

const desktopRenderer = readFileSync(
  new URL("../apps/web/components/pos-desktop/DesktopPosRenderer.tsx", import.meta.url),
  "utf8",
);
const restaurantRenderer = readFileSync(
  new URL("../apps/web/app/(pos)/pos/restaurant/page.tsx", import.meta.url),
  "utf8",
);
const retailRenderer = readFileSync(
  new URL("../apps/web/app/(pos)/pos/page.tsx", import.meta.url),
  "utf8",
);
const boardGameRenderer = readFileSync(
  new URL("../apps/web/components/pos/BoardGamePanel.tsx", import.meta.url),
  "utf8",
);
const desktopDeviceClient = readFileSync(
  new URL("../apps/web/lib/pos/deviceTokenClient.ts", import.meta.url),
  "utf8",
);
const desktopMain = readFileSync(
  new URL("../apps/desktop/src/main.mjs", import.meta.url),
  "utf8",
);

test("desktop and native register flow requires a verified device, cashier PIN, and open shift", () => {
  let state = initialPosClientFlow(true);
  assert.equal(state.stage, "VERIFYING_DEVICE");

  state = transitionPosClientFlow(state, "DEVICE_VERIFIED");
  state = transitionPosClientFlow(state, "SHIFT_STATUS_OPEN");
  assert.equal(state.stage, "CASHIER_LOGIN");
  assert.equal(state.shiftOpen, true);

  state = transitionPosClientFlow(state, "CASHIER_VERIFIED");
  assert.equal(state.stage, "CATALOG");
  state = transitionPosClientFlow(state, "START_CHECKOUT");
  assert.equal(state.stage, "CHECKOUT");
  state = transitionPosClientFlow(state, "SALE_COMPLETED");
  assert.equal(state.stage, "RECEIPT");
});

test("an unopened shift blocks checkout even after cashier verification", () => {
  let state = transitionPosClientFlow(initialPosClientFlow(true), "DEVICE_VERIFIED");
  state = transitionPosClientFlow(state, "CASHIER_VERIFIED");
  assert.equal(state.stage, "SHIFT_REQUIRED");
  state = transitionPosClientFlow(state, "START_CHECKOUT");
  assert.equal(state.stage, "SHIFT_REQUIRED");
});

test("shared payment validation balances split tender and computes cash change", () => {
  const result = validatePayments(250, [
    { id: "cash", method: "cash", amount: 100, tendered: 120 },
    { id: "qr", method: "qr", amount: 150, reference: "TX-1" },
  ]);
  assert.equal(result.canConfirm, true);
  assert.equal(result.paidTotal, 250);
  assert.equal(calculateCashChange(100, 120), 20);
});

test("every POS client uses the shared numeric 4-8 digit PIN policy", () => {
  assert.equal(POS_PIN_MIN_LENGTH, 4);
  assert.equal(POS_PIN_MAX_LENGTH, 8);
  assert.equal(isPosPinValid("0123"), true, "a leading zero is part of the PIN");
  assert.equal(isPosPinValid("12345678"), true);
  assert.equal(isPosPinValid("123"), false);
  assert.equal(isPosPinValid("123456789"), false);
  assert.equal(isPosPinValid("12a4"), false);
  assert.equal(normalizePosPinInput("01a23-456789"), "01234567");
  assert.equal(visiblePosPinSlots(""), 4);
  assert.equal(visiblePosPinSlots("123456"), 6);
});

test("catalog cards show stock for the same variant that clicking will sell", () => {
  const item42 = selectPosCatalogCardVariant({
    price: 149,
    availableTotal: 99,
    availableSizes: [
      { size: "S", available: 25, price: 149 },
      { size: "M", available: 32, price: 149 },
      { size: "L", available: 17, price: 149 },
      { size: "XL", available: 25, price: 149 },
    ],
  });
  const item453 = selectPosCatalogCardVariant({
    price: 3_831,
    availableTotal: 99,
    availableSizes: [
      { size: "S", available: 2, price: 3_831 },
      { size: "M", available: 13, price: 3_831 },
      { size: "L", available: 48, price: 3_831 },
      { size: "XL", available: 36, price: 3_831 },
    ],
  });

  assert.equal(item42.variant?.size, "L");
  assert.equal(item42.available, 17);
  assert.equal(item453.variant?.size, "L");
  assert.equal(item453.available, 48);
  assert.notEqual(item42.available, 99, "the all-size total must not label the selected L variant");
});

test("desktop POS overlaps the first catalogue read with cashier PIN entry", () => {
  assert.match(
    desktopRenderer,
    /setConnection\("online"\);[\s\S]*?void loadCatalog\("", nextToken\);/,
    "the verified device should prime the catalogue before cashier authentication finishes",
  );
  assert.match(
    desktopRenderer,
    /activeRequest\.token === requestToken[\s\S]*?activeRequest\.query === normalizedQuery[\s\S]*?return activeRequest\.promise/,
    "opening the selling screen must join an in-flight prime instead of duplicating it",
  );
  assert.match(
    desktopRenderer,
    /const version = \+\+catalogRequestVersion\.current[\s\S]*?version !== catalogRequestVersion\.current/,
    "a slow old search must not overwrite a newer catalogue response",
  );
  assert.match(
    desktopRenderer,
    /normalizedQuery \? 180 : 0/,
    "typing may be debounced, but the default catalogue must not receive an artificial delay",
  );
  assert.match(desktopRenderer, /aria-busy=\{catalogLoading\}/);
  assert.match(desktopRenderer, /กำลังโหลดสินค้า…/);
  assert.match(
    desktopRenderer,
    /!catalog\.length && !catalogLoading && !catalogError && !busy/,
    "an in-flight or failed request must not be presented as an empty catalogue",
  );
});

test("desktop POS defers heavy secondary workspaces until after the selling screen", () => {
  assert.doesNotMatch(desktopRenderer, /import PosPage from/);
  assert.doesNotMatch(desktopRenderer, /import BoardGamePanel from/);
  assert.match(desktopRenderer, /dynamic\(loadAdvancedPosModule/);
  assert.match(desktopRenderer, /dynamic\(loadBoardGameModule/);
  assert.match(
    desktopRenderer,
    /requestIdleCallback\(preloadModules, \{ timeout: 3_000 \}\)/,
    "secondary chunks should warm after the primary catalogue becomes interactive",
  );
});

test("full POS search keeps raw keystrokes outside the register-wide state", () => {
  assert.match(retailRenderer, /const PosProductSearchInput = memo\(forwardRef/);
  assert.match(retailRenderer, /defaultValue=""/);
  assert.match(
    retailRenderer,
    /queryTimer\.current = window\.setTimeout\([\s\S]*?onQueryChange\(value\);[\s\S]*?180/,
  );
  assert.match(
    retailRenderer,
    /<PosProductSearchInput[\s\S]*?onQueryChange=\{setSearchTerm\}[\s\S]*?onSubmit=\{submitManualScan\}/,
  );
  assert.match(retailRenderer, /useImperativeHandle\(ref,[\s\S]*?clear/);
  assert.match(
    retailRenderer,
    /const clear = useCallback\(\(\) => \{[\s\S]*?clearTimeout\(queryTimer\.current\)[\s\S]*?inputRef\.current\.value = "";[\s\S]*?onQueryChange\(""\)/,
    "programmatic clears must cancel a pending debounced query instead of letting stale results reappear",
  );
  assert.doesNotMatch(retailRenderer, /const \[scanCode, setScanCode\] = useState/);
});

test("desktop startup reuses its compatible route without rendering the app twice", () => {
  const showPos = desktopMain.slice(
    desktopMain.indexOf("async function showPos"),
    desktopMain.indexOf("function startPosNavigation"),
  );
  assert.match(showPos, /method: "HEAD"/);
  assert.doesNotMatch(showPos, /method: "GET"/);
  assert.match(
    showPos,
    /const cachedEntryPath = cachedPosEntryPath\(pairing\.posEntryPath\);\s*const entryPath = cachedEntryPath \?\? await probeEntryPath\(\);\s*await loadPosUrl/,
  );
  assert.match(showPos, /void probeEntryPath\(\)\.then/);
  assert.match(
    showPos,
    /cachedEntryPath === MOBILE_POS_PATH && freshEntryPath === "\/pos"[\s\S]*?current\.pathname === MOBILE_POS_PATH[\s\S]*?await loadPosUrl/,
    "a rollback that removes /pos/app must recover the cached mobile route without an app restart",
  );
});

test("desktop refresh uses one in-place contract across retail, restaurant, and board-game shops", () => {
  for (const path of ["/pos", "/pos/app", "/pos/restaurant"]) {
    assert.match(desktopMain, new RegExp(`contentRefreshRoutes[\\s\\S]*?${path.replaceAll("/", "\\/")}`));
  }
  assert.match(desktopRenderer, /window\.bmsDesktop\.onRefreshRequested/);
  assert.match(desktopRenderer, /setContentRefreshSignal\(\(value\) => value \+ 1\)/);
  assert.match(desktopRenderer, /refreshSignal=\{contentRefreshSignal\}/);
  assert.match(boardGameRenderer, /feed\.refreshNow\(\)/);
  assert.match(retailRenderer, /refreshSignal === handledRefreshSignal\.current/);
  assert.match(desktopRenderer, /Command\/Ctrl \+ Shift \+ R[\s\S]*?โหลดแอปใหม่ทั้งหมด ใช้เมื่อหน้าค้าง/);
});

test("desktop header keeps cashier identity without a permanent legacy-sales escape button", () => {
  assert.doesNotMatch(
    desktopRenderer,
    />ฟังก์ชันขายทั้งหมด<\/button>/,
    "the desktop renderer must have one obvious primary sales surface",
  );
  assert.match(desktopRenderer, /className=\{styles\.accountMenu\}/);
  assert.doesNotMatch(desktopRenderer, />ข้อมูลกะ<\/button>/);
  assert.doesNotMatch(desktopRenderer, />ตั้งค่าเครื่อง<\/button>/);
  assert.doesNotMatch(desktopRenderer, /className=\{styles\.signOut\}/);
  assert.match(desktopRenderer, /ล็อก \/ เปลี่ยนพนักงาน/);
  assert.match(
    desktopRenderer,
    /สินค้านี้ต้องกรอก serial \/ น้ำหนัก \/ ตัวเลือกเพิ่มเติม[\s\S]*?openModule\("sell"\)/,
    "advanced items must retain a contextual path to the full sales workflow",
  );
});

test("restaurant other-work modules keep the restaurant identity in the desktop shell", () => {
  assert.match(desktopRenderer, /get\("module"\)/);
  assert.match(desktopRenderer, /styles\.restaurantTheme/);
  assert.match(desktopRenderer, /businessArchetype === "restaurant"/);
  assert.match(
    desktopRenderer,
    /businessArchetype !== "restaurant"[\s\S]*?!cashier[\s\S]*?router\.replace\("\/pos\/restaurant"\)/,
    "a verified restaurant operator should land on the floor instead of the retail home",
  );
  const floorHandoff = desktopRenderer.slice(
    desktopRenderer.indexOf('if (bootstrap?.businessArchetype !== "restaurant" || !cashier'),
    desktopRenderer.indexOf('router.replace("/pos/restaurant")'),
  );
  assert.ok(floorHandoff.length > 0, "the restaurant floor handoff effect must exist");
  assert.ok(
    !/hasDesktopPosBridge\(\)/.test(floorHandoff.split("\n")[0]),
    "signIn leaves a restaurant login in 'preparing' until this handoff runs; gating it on the Electron bridge strands a browser register",
  );
  assert.match(desktopRenderer, /keepPreparingUntilNavigation = true/);
  const signIn = desktopRenderer.slice(
    desktopRenderer.indexOf("const signIn = async"),
    desktopRenderer.indexOf("const openShift = async"),
  );
  assert.match(
    signIn,
    /const restaurantHome = bootstrap\?\.businessArchetype === "restaurant"[\s\S]*?!new URLSearchParams\(window\.location\.search\)\.get\("module"\)/,
    "only a plain restaurant entry should wait for the floor navigation",
  );
  assert.match(signIn, /if \(restaurantHome\) \{[\s\S]*?keepPreparingUntilNavigation = true;/);
  assert.match(
    signIn,
    /setCashier\(verified\);\s*if \(restaurantHome\) return;\s*sendFlow\("CASHIER_VERIFIED"\);/,
    "restaurant other-work deep-links must finish the login flow instead of waiting for a redirect they intentionally skip",
  );
  assert.match(
    desktopRenderer,
    /const requested = new URLSearchParams\(window\.location\.search\)\.get\("module"\);[\s\S]*?if \(requested\) return;/,
    "explicit other-work deep-links must remain in the selected retail module",
  );
});

test("desktop rail provides professional help and real app-version diagnostics", () => {
  assert.match(desktopRenderer, /ช่วยเหลือ/);
  assert.match(desktopRenderer, /เกี่ยวกับ BMS POS/);
  assert.match(
    desktopRenderer,
    /className=\{styles\.railFooter\}[\s\S]*?openDesktopInfoDialog\("help"\)[\s\S]*?openDesktopInfoDialog\("about"\)/,
    "help and about belong at the bottom of the app rail, not inside the cashier account menu",
  );
  const accountPopover = desktopRenderer.slice(
    desktopRenderer.indexOf('className={styles.accountPopover}'),
    desktopRenderer.indexOf('</details>', desktopRenderer.indexOf('className={styles.accountPopover}')),
  );
  assert.doesNotMatch(accountPopover, /ช่วยเหลือ|เกี่ยวกับ BMS POS/);
  assert.match(desktopRenderer, /window\.open\("\/pos\/manual"/);
  assert.match(desktopRenderer, /readDesktopAppInfo\(\)/);
  assert.match(desktopRenderer, /copyTextToClipboard\(diagnostic\)/);
  assert.match(desktopRenderer, /role="dialog" aria-modal="true"/);
  assert.match(desktopDeviceClient, /getAppInfo\?\(\): Promise<DesktopAppInfo \| null>/);
  assert.match(desktopMain, /!isSetupFrame\(event\) && !isPairedPosFrame\(event\)/);
});

test("desktop checkout does not repeat the payment selector for a single tender", () => {
  assert.match(
    desktopRenderer,
    /\{payments\.length > 1 \? \([\s\S]*?<select value=\{payment\.method\}/,
    "the per-row method selector belongs only to split payments",
  );
  assert.match(
    desktopRenderer,
    /const paymentCount = payments\.length;[\s\S]*?\}, \[paymentCount, total\]\);/,
    "returning from split to one tender must restore the authoritative total",
  );
});

test("desktop POS alerts expose a close control on every operating surface", () => {
  const restaurantAlerts = restaurantRenderer.match(/<Alert\b[\s\S]*?\/>/g) ?? [];
  assert.ok(restaurantAlerts.length > 0, "restaurant POS should render operational alerts");
  restaurantAlerts.forEach((alert, index) => {
    assert.match(alert, /\bclosable\b/, `restaurant Alert ${index + 1} must expose a close button`);
  });

  assert.match(retailRenderer, /PosDismissibleAlert/);
  assert.doesNotMatch(retailRenderer, /<div className="pos-note(?:\s|"|`)/);
  assert.match(boardGameRenderer, /PosDismissibleAlert/);
  assert.match(desktopRenderer, /PosDismissibleAlert/);
  assert.match(desktopRenderer, /useOrderAlerts\(Boolean\(bootstrap && cashier\)\)/);
  assert.match(desktopRenderer, /OrderAlertSettingsModal/);
  assert.match(desktopRenderer, /styles\.alertBell/);
  assert.match(desktopRenderer, /serviceCalls\.length > 0/);
  assert.match(desktopRenderer, /\/api\/pos\/restaurant\/service-calls/);
  assert.match(desktopRenderer, /action: completing \? "service\.complete" : "service\.acknowledge"/);
  assert.match(desktopRenderer, /call\.status === "PENDING" \? "รับเรื่อง" : "เสร็จสิ้น"/);
  assert.doesNotMatch(
    desktopRenderer,
    /setServiceCalls\(calls\.filter\(\(call\) => call\.status === "PENDING"\)\)/,
    "acknowledged work must remain in the desktop bell until staff complete it",
  );
  assert.doesNotMatch(desktopRenderer, /<(?:div|p) className=\{styles\.(?:errorBox|noticeBox)\}/);
});

/**
 * A pharmacy register on the desktop shell must sell in the full workspace.
 *
 * The compact desktop sell screen (`/pos/app`, "mobile_sell") builds its sale payload with every
 * pharmacy field hard-coded to null: no review-queue case, no pharmacist PIN, no counter
 * authorization. For a pharmacy that means any regulated item is refused by the server and the
 * cashier has no control on that screen to continue. The full sell workspace (the embedded
 * `/pos` page) owns the pharmacist review queue, the pharmacist PIN card and clinical evidence,
 * so the desktop shell maps a pharmacy's "home" to that workspace.
 *
 * The customer display follows whichever workspace is visibly selling. Two publishers on one
 * BroadcastChannel would let the empty desktop cart overwrite the bill the customer is paying.
 */

// Comments in this file explain the rule with the same words the assertions look for.
const pharmacyRenderer = desktopRenderer
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
  .join("\n");

const hasInRenderer = (re: RegExp, message: string) => assert.ok(re.test(pharmacyRenderer), message);
const lacksInRenderer = (re: RegExp, message: string) => assert.ok(!re.test(pharmacyRenderer), message);

function rendererBlock(startMarker: string, endMarker: string): string {
  const start = pharmacyRenderer.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = pharmacyRenderer.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker not found after ${startMarker}: ${endMarker}`);
  return pharmacyRenderer.slice(start, end);
}

test("the compact desktop sale still has no pharmacy controls, so a pharmacy must not use it", () => {
  const payload = rendererBlock("const buildSalePayload", "const submitSale");
  // This is the reason for the handoff. If the compact screen ever grows real pharmacy support,
  // this assertion is the one to revisit, together with the mapping below.
  assert.match(payload, /pharmacistAuthorizerUserId:\s*null/);
  assert.match(payload, /pharmacyReviewAssessmentId:\s*null/);
});

test("a pharmacy register maps the compact sell home to the full sell workspace", () => {
  hasInRenderer(
    /const pharmacyRegister = bootstrap\?\.businessArchetype === "pharmacy";/,
    "the handoff must be decided from the server-reported shop archetype",
  );
  hasInRenderer(
    /const shownModule: DesktopModule =\s*pharmacyRegister && activeModule === "mobile_sell" \? "sell" : activeModule;/,
    "every transition that writes mobile_sell must land a pharmacy on the full sell workspace",
  );
});

test("the workspace that renders is the shown module, not the raw state", () => {
  hasInRenderer(
    /\{shownModule !== "mobile_sell" && shownModule !== "restaurant" \?/,
    "the compact sell screen must not render for a pharmacy",
  );
  hasInRenderer(/initialTab: shownModule,/, "the embedded workspace must open on the tab that is shown");
  lacksInRenderer(
    /\{activeModule !== "mobile_sell" && activeModule !== "restaurant" \?/,
    "rendering from the raw state bypasses the pharmacy mapping",
  );
  lacksInRenderer(/initialTab: activeModule,/, "the embedded workspace would open on the compact tab");
});

test("pharmacy sign-in prepares the full workspace instead of the compact catalogue", () => {
  const signIn = rendererBlock("const signIn = async", "const openShift = async");
  assert.match(
    signIn,
    /businessArchetype === "pharmacy"\) \{\s*await loadAdvancedPosModule\(\);\s*setActiveModule\("sell"\);/,
  );
});

test("the customer display is owned by the workspace that is visibly selling", () => {
  hasInRenderer(
    /const desktopOwnsCustomerDisplay = shownModule !== "sell";/,
    "the full sell workspace must own the display while it is shown",
  );
  hasInRenderer(
    /suppressCustomerDisplay: desktopOwnsCustomerDisplay,/,
    "the embedded workspace must publish while it is the one selling",
  );
  lacksInRenderer(
    /suppressCustomerDisplay: true,/,
    "a permanently suppressed embedded workspace leaves the customer display blank at a pharmacy",
  );
  hasInRenderer(
    /customerDisplayPayloadRef\.current = payload;\s*if \(!desktopOwnsCustomerDisplay\) return;\s*customerDisplayChannelRef\.current\?\.postMessage\(payload\);/,
    "the desktop cart must not overwrite the embedded bill on the display",
  );
  hasInRenderer(
    /event\.data\?\.type === "hello" && desktopOwnsCustomerDisplayRef\.current/,
    "a display that reconnects must not be answered with the idle desktop cart",
  );
});

/**
 * Retail desktop register (`/pos/app` compact sell screen).
 *
 * 1. "Print receipt" used to call window.print() on the success card. globals.css hides the
 *    whole page while printing and reveals only #pos-receipt under a body marker, so the sheet
 *    came out blank — and the card had no lines, discounts, tax-document number or VAT anyway.
 * 2. The compact screen refused any item whose own inventory row is 0. Bundles and
 *    RECIPE/NON_STOCK menus keep that row at 0 by design; the server sells them.
 */
const posService = readFileSync(new URL("../apps/web/lib/bms/pos.ts", import.meta.url), "utf8");
const posDeviceGraphql = readFileSync(
  new URL("../apps/web/graphql/bmsPosDevice.ts", import.meta.url),
  "utf8",
);
const globalsCss = readFileSync(new URL("../apps/web/app/globals.css", import.meta.url), "utf8");
const retailSource = desktopRenderer
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
  .join("\n");
const retailHas = (re: RegExp, message: string) => assert.ok(re.test(retailSource), message);
const retailLacks = (re: RegExp, message: string) => assert.ok(!re.test(retailSource), message);

const saleRow = {
  orderId: "11111111-1111-4111-8111-111111111111",
  receiptNo: "B-0007",
  billNo: "B-0007",
  docNo: "TX-0007",
  soldAt: "2026-09-23T03:15:00.000Z",
  total: 170,
  cashierName: "แคชเชียร์",
  branchCode: "00000",
  locationName: "สาขาหลัก",
  posLabel: "POS-01",
  posDeviceId: "22222222-2222-4222-8222-222222222222",
  shiftId: "33333333-3333-4333-8333-333333333333",
  saleLocationId: "44444444-4444-4444-8444-444444444444",
  roundingAmount: 0,
  paymentMethod: "CASH",
  paymentRef: null,
  cashTendered: 100,
  cashChange: 0,
  memberName: null,
  memberNo: null,
  lines: [
    { receiptName: "น้ำดื่ม", size: "600ml", packQty: 2, packPrice: 50 },
    { receiptName: "ขนม", size: "-", packQty: 1, packPrice: 90 },
  ],
  payments: [
    { method: "CASH", amount: 100, ref: null, cashTendered: 100, cashChange: 0 },
    { method: "QR", amount: 70, ref: "TX9", cashTendered: null, cashChange: null },
  ],
  discountLines: [{ label: "ส่วนลดราคาส่ง/โปรโมชั่น", amount: 20 }],
  vat: { rate: 7, vatAmount: 11.12, netBeforeVat: 158.88, exemptAmount: 0, roundingAmount: 0 },
};
const saleStore = {
  languageMode: "th" as const,
  vatRegistered: true,
  taxId: "0105555555555",
  address: null,
  phone: null,
  logoUrl: null,
  fallbackStoreName: null,
  fallbackBranchCode: null,
  fallbackPosNo: null,
};

test("the desktop receipt is the saved bill: list-price lines, discount lines and the tax split", () => {
  const payload = receiptPayloadFromPosSale(saleRow, saleStore);
  assert.deepEqual(payload.lines, [
    { name: "น้ำดื่ม (600ml)", qty: 2, amount: 100 },
    { name: "ขนม", qty: 1, amount: 90 },
  ]);
  const lineSum = payload.lines.reduce((sum, line) => sum + line.amount, 0);
  const discounts = (payload.discountLines ?? []).reduce((sum, line) => sum + line.amount, 0);
  assert.equal(lineSum - discounts, payload.total, "printed lines minus printed discounts must equal the total");
  assert.equal(payload.docNo, "TX-0007");
  assert.equal(payload.docTitle, "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ");
  assert.equal(payload.taxId, "0105555555555");
  assert.equal(payload.vat?.vatAmount, 11.12);
  assert.equal(payload.barcodeValue, "B-0007");
  assert.equal(payload.itemCount, 3);
  assert.equal(payload.member, null);
});

test("a split payment prints every tender, and a store without VAT prints a plain receipt", () => {
  const split = receiptPayloadFromPosSale(saleRow, saleStore);
  assert.equal(split.payments?.length, 2);
  assert.equal(split.paymentLabel, "จ่ายหลายวิธี");
  assert.equal(split.payments?.[1]?.ref, "TX9");
  const plain = receiptPayloadFromPosSale(
    { ...saleRow, vat: null, docNo: null, payments: [], discountLines: [] },
    { ...saleStore, vatRegistered: false, taxId: null },
  );
  assert.equal(plain.docTitle, "ใบเสร็จรับเงิน");
  assert.equal(plain.vat, null);
  assert.equal(plain.payments?.length, 1, "a legacy row without payment rows still prints its tender");
  assert.equal(plain.notes, null);
});

test("desktop print reveals the receipt paper instead of printing a blank page", () => {
  assert.match(
    globalsCss,
    /body\[data-pos-print-target="receipt"\] #pos-receipt/,
    "the print stylesheet only reveals #pos-receipt under this body marker",
  );
  retailHas(/<ReceiptPaper payload=\{receiptPaper\} \/>/, "the success screen must render the saved bill");
  retailHas(
    /document\.body\.setAttribute\("data-pos-print-target", "receipt"\)[\s\S]{0,600}window\.print\(\)/,
    "print must set the marker before opening the dialog",
  );
  retailLacks(/onClick=\{\(\) => window\.print\(\)\}/, "a bare window.print() prints a blank sheet");
  retailHas(
    /row\.orderId !== sale\.orderId\) throw/,
    "the last sale of the device must be the one just confirmed, or nothing is printed",
  );
});

test("the server says whether a scanned item's own stock is a real ceiling", () => {
  const helper = posService.slice(
    posService.indexOf("export async function isPosVariantStockTracked"),
    posService.indexOf("export async function getPosVariantAvailable"),
  );
  assert.ok(helper.length > 0, "isPosVariantStockTracked must exist before getPosVariantAvailable");
  assert.match(helper, /is_bundle/);
  assert.match(helper, /IN \('RECIPE', 'NON_STOCK'\)/);
  assert.match(helper, /\?\? true/, "an unknown SKU must never loosen the client check");
  assert.match(posDeviceGraphql, /stockTracked: Boolean!/);
  assert.match(posDeviceGraphql, /isPosVariantStockTracked\(device\.tenantId, hit\.sku\)/);
});

test("the compact screen sells bundles and recipe menus and still caps tracked stock", () => {
  retailLacks(
    /if \(Number\(hit\.available\) <= 0\) throw/,
    "an unconditional own-stock check refuses bundles and RECIPE/NON_STOCK menus",
  );
  retailHas(/incoming\.stockTracked && incoming\.available <= 0/, "only tracked stock can refuse an add");
  retailHas(
    /delta > 0\s*&& target\.stockTracked\s*&& \(target\.qty \+ delta\) \* target\.baseQty > target\.available/,
    "the + stepper must stop at tracked stock instead of failing at payment",
  );
  retailHas(/const sellable = item\.availability === "AVAILABLE";/, "the catalogue card follows the server");
  retailHas(/disabled=\{!sellable \|\| busy\}/, "a zero own-stock row must not disable a sellable card");
  retailLacks(/disabled=\{item\.availableTotal <= 0/, "availableTotal is 0 for every recipe menu");
});

test("the full-sell button appears only with the notice that needs it", () => {
  retailHas(
    /!error && notice === ADVANCED_ITEM_NOTICE \? <button onClick=\{\(\) => openModule\("sell"\)\}>/,
    "a price-changed or deferred-refresh notice must not send the cashier away from the bill",
  );
  retailHas(/setNotice\(ADVANCED_ITEM_NOTICE\)/, "serial/weight/option items still get the path");
});
