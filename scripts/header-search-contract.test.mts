import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  SYSTEM_CAPABILITIES,
  capabilityStatusFilterForQuery,
  isBroadCapabilityQuery,
  listAssistantCapabilities,
  searchAssistantKnowledge,
} from "../apps/web/lib/bms/assistantKnowledge/index.ts";

const root = path.resolve(import.meta.dirname, "..");
const header = readFileSync(path.join(root, "apps/web/components/HeaderBar.tsx"), "utf8");

test("the shared header exposes BMS knowledge search on desktop and mobile", () => {
  assert.match(header, /const SHOW_HEADER_SEARCH = true;/);
  assert.match(header, /const showHeaderSearch = SHOW_HEADER_SEARCH && isAdminSession;/);
  assert.match(header, /const showPublicLearningSearch = SHOW_HEADER_SEARCH && !isAdminSession;/);
  assert.match(header, /const HEADER_SEARCH_HISTORY_KEY = "bmsKnowledgeSearchHistory";/);
  assert.match(header, /const PUBLIC_SEARCH_HISTORY_KEY = "bmsPublicLearningSearchHistory";/);
  assert.match(header, /const SEARCH_HISTORY_LIMIT = 10;/);
  assert.match(header, /function normalizeSearchHistory/);
  assert.match(header, /normalized\.length === SEARCH_HISTORY_LIMIT/);
  assert.match(header, /HEADER_SEARCH_HISTORY_KEY}:\$\{adminSession\?\.id/);
  assert.doesNotMatch(header, /globalSearchHistory/);
  assert.match(header, /!isMobileView && showHeaderSearch/);
  assert.match(header, /isMobileView && showHeaderSearch/);
  assert.match(header, /!isMobileView && !hasSession && !showHeaderSearch/);
  assert.match(header, /data-public-learning-search-trigger/);
  assert.match(header, /data-search-history/);
  assert.match(header, /data-search-history-item=\{term\}/);
  assert.match(header, /className="jachoei-mobile-search-autocomplete"/);
  assert.match(header, /style=\{\{ width: "100%" \}\}/);
  assert.match(header, /event\.key === "Escape"/);
  assert.match(header, /document\.body\.style\.overflow = "hidden"/);
  assert.match(header, /aria-modal="true"/);
  assert.match(header, /showPublicLearningSearch \|\| \(isMobileView && showHeaderSearch\)/);
});

test("submitting header search selects the safe destination for the current session", () => {
  assert.match(
    header,
    /isAdminSession\s*\? "\/admin\/search"\s*:\s*localizedPublicPath\("\/learn", currentLang\)/,
  );
  assert.match(header, /router\.push\(`\$\{destination\}\?q=\$\{encodeURIComponent\(q\)\}`/);
  assert.match(header, /const searchHistoryKey = isAdminSession/);
});

test("broad capability questions open the verified inventory without swallowing specific questions", () => {
  assert.equal(isBroadCapabilityQuery("รองรับระบบอะไรบ้าง", "th"), true);
  assert.equal(isBroadCapabilityQuery("BMS ทำอะไรได้บ้าง", "th"), true);
  assert.equal(isBroadCapabilityQuery("ฟีเจอร์นี้พร้อมใช้หรือยัง", "th"), true);
  assert.equal(isBroadCapabilityQuery("ฟีเจอร์ไหนยังเป็น Beta", "th"), true);
  assert.equal(isBroadCapabilityQuery("ฟีเจอร์นี้ต้องเปิดตั้งค่าก่อนไหม", "th"), true);
  assert.equal(isBroadCapabilityQuery("What does BMS support?", "en"), true);
  assert.equal(isBroadCapabilityQuery("ระบบรองรับร้านอาหารไหม", "th"), false);
  assert.equal(isBroadCapabilityQuery("Does BMS support restaurants?", "en"), false);
  assert.equal(capabilityStatusFilterForQuery("ฟีเจอร์ไหนยังเป็น Beta", "th"), "BETA");
  assert.equal(capabilityStatusFilterForQuery("ฟีเจอร์นี้ต้องเปิดตั้งค่าก่อนไหม", "th"), "CONDITIONAL");
  assert.equal(capabilityStatusFilterForQuery("ฟีเจอร์นี้พร้อมใช้หรือยัง", "th"), null);

  const listed = listAssistantCapabilities({ locale: "th", permissions: new Set() });
  assert.equal(listed.length, SYSTEM_CAPABILITIES.length);
  assert.ok(listed.every((entry) => entry.kind === "capability" && entry.capabilityStatus));
  assert.ok(listed.some((entry) => !entry.accessible), "RBAC annotations must survive inventory listing");

  const englishGuide = searchAssistantKnowledge("How do I add a product", {
    locale: "en",
    permissions: new Set(["product.view"]),
    kind: "guide",
    limit: 3,
  }).find((entry) => entry.matchedQuery);
  assert.equal(englishGuide?.id, "products.create");
});

test("common staff wording leads to the verified owner for every promised search example", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["รองรับร้านประเภทไหนบ้าง", "onboarding.getting-started"],
    ["ใช้กับร้านอาหารได้ไหม", "restaurant.dine-in"],
    ["รองรับร้านค้าหลายสาขาไหม", "inventory.branch"],
    ["มีระบบ POS ไหม", "pos.operations"],
    ["ใช้งานบนมือถือได้ไหม", "pos.client-and-offline-support"],
    ["ใช้ตอนอินเทอร์เน็ตล่มได้ไหม", "pos.client-and-offline-support"],
    ["เพิ่มสินค้ายังไง", "products.create"],
    ["เปิดบิลขายยังไง", "orders.follow-lifecycle"],
    ["คืนสินค้ายังไง", "pos.void-return"],
    ["โอนสต็อกข้ามสาขายังไง", "inventory.transfer"],
    ["เช็กสต็อกคงเหลือที่ไหน", "inventory.branch"],
    ["เพิ่มพนักงานและกำหนดสิทธิ์ยังไง", "users.add-and-authorize"],
    ["เปิดกะและปิดกะยังไง", "pos.shift"],
    ["ออกใบกำกับภาษียังไง", "tax.review-sales-report"],
    ["ดูรายงานยอดขายที่ไหน", "reports.create-export"],
    ["เชื่อม LINE ยังไง", "settings.configure-shop"],
    ["เชื่อม Facebook ได้ไหม", "settings.configure-shop"],
    ["รองรับ GrabFood หรือ LINE MAN ไหม", "delivery-platforms.review"],
    ["ต่อเครื่องพิมพ์ใบเสร็จยังไง", "pos.receipt-display"],
    ["รองรับเครื่องสแกนบาร์โค้ดไหม", "pos.build-sale"],
    ["เชื่อมระบบชำระเงินอะไรได้บ้าง", "pos.take-payment"],
    ["ส่งข้อความหาลูกค้าได้ไหม", "inbox.handle-conversation"],
    ["รูปสินค้าไม่แสดง", "products.create"],
    ["ทำไมสต็อกไม่ลด", "inventory.stock-models"],
    ["ทำไมพิมพ์ใบเสร็จไม่ได้", "pos.receipt-display"],
    ["ทำไมเข้าเมนูนี้ไม่ได้", "permissions.action-unavailable"],
    ["ลืม PIN ต้องทำอย่างไร", "pos.configure-devices"],
    ["ทำไมออเดอร์ไม่เข้าครัว", "kitchen.board"],
    ["LINE ไม่ได้รับข้อความ", "settings.configure-shop"],
    ["ยอดขายกับเงินในลิ้นชักไม่ตรง", "pos.shift-overview"],
    ["เครื่อง POS ออฟไลน์ต้องทำอย่างไร", "pos.client-and-offline-support"],
    ["เริ่มต้นตั้งร้านยังไง", "onboarding.getting-started"],
    ["ต้องตั้งค่าอะไรก่อนขาย", "onboarding.getting-started"],
    ["เพิ่มสาขายังไง", "locations.manage-branches"],
    ["เพิ่มคลังสินค้ายังไง", "locations.manage-branches"],
    ["ตั้งค่าภาษีมูลค่าเพิ่มที่ไหน", "settings.configure-shop"],
    ["ตั้งค่าราคาขายหลายขนาดยังไง", "products.create"],
    ["ตั้งค่าโปรโมชั่นยังไง", "products.branch-promotions"],
    ["ตั้งค่าสิทธิ์แคชเชียร์ยังไง", "permissions.explain"],
    ["ดูยอดขายวันนี้", "dashboard.daily-review"],
    ["สินค้าอะไรขายดีที่สุด", "dashboard.daily-review"],
    ["สินค้าอะไรใกล้หมด", "dashboard.daily-review"],
    ["ดูกำไรขาดทุนได้ไหม", "reports.create-export"],
    ["ส่งออกรายงาน Excel ได้ไหม", "reports.create-export"],
    ["ดูประวัติการแก้ไขข้อมูลได้ไหม", "access.review-revisions"],
    ["ดูว่าใครยกเลิกบิลได้ที่ไหน", "access.review-audit"],
    ["มีรายงานภาษีอะไรบ้าง", "tax.review-sales-report"],
    ["ต้องใช้แพ็กเกจอะไร", "billing.read-usage"],
    ["รองรับกี่สาขา", "billing.read-usage"],
    ["รองรับกี่เครื่อง POS", "billing.read-usage"],
    ["บัญชีของฉันมีสิทธิ์ใช้งานหรือเปล่า", "permissions.my-access"],
  ];

  for (const [query, expected] of cases) {
    const result = searchAssistantKnowledge(query, {
      locale: "th",
      permissions: new Set(),
      limit: 3,
    }).find((entry) => entry.matchedQuery);
    assert.equal(result?.id, expected, `${query} led to ${result?.id ?? "no result"}`);
  }
});

test("the admin knowledge page is deterministic and does not call the AI assistant", () => {
  const page = readFileSync(
    path.join(root, "apps/web/app/(admin)/admin/search/page.tsx"),
    "utf8",
  );
  assert.match(page, /searchAssistantKnowledge/);
  assert.match(page, /listAssistantCapabilities/);
  assert.match(page, /SYSTEM_GUIDES/);
  assert.match(page, /data-knowledge-details/);
  assert.match(page, /guide\.prerequisites\[locale\]/);
  assert.match(page, /guide\.steps\[locale\]/);
  assert.match(page, /guide\.warnings\[locale\]/);
  assert.match(page, /firstGuideIndex = results\.findIndex/);
  assert.match(page, /const primaryCapability = matched\.find/);
  assert.match(page, /const primaryGuide = matched\.find/);
  assert.match(page, /defaultActiveKey=\{!broad && index === firstGuideIndex/);
  assert.doesNotMatch(page, /bmsWorkAssistant|runPipeline|useMutation/);
});
