import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  extractDesiredRedemptionSetup,
  formatLoyaltyRedemptionReply,
  isLoyaltyRedemptionCalculationRequest,
} from "../../apps/web/lib/bms/assistantLoyaltyReply.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

test("work assistant GraphQL surface is additive and returns structured grounding", () => {
  const schema = read("apps/web/graphql/typeDefs.ts");
  assert.match(schema, /bmsAssistant\(message: String!, history:/, "legacy mutation disappeared");
  assert.match(schema, /bmsWorkAssistant\(input: BmsWorkAssistantInput!\): BmsWorkAssistantResult!/);
  for (const field of ["answerType", "citations", "links", "proposals", "trace"]) {
    assert.match(schema, new RegExp(`\\b${field}:`), `work result missing ${field}`);
  }
});

test("page context is bounded and remains a retrieval hint, not tenant authority", () => {
  const resolver = read("apps/web/graphql/bmsAssistant.ts");
  assert.match(resolver, /safeCurrentPath/);
  assert.match(resolver, /permissions: perms/);
  assert.match(resolver, /isPlatformAdmin\(ctx\)/);
  assert.match(resolver, /tenantId = getTenantId\(ctx\)/);
  assert.doesNotMatch(resolver, /input\.tenantId|input\.permissions|input\.role/);
});

test("verified help remains available without an AI provider and excluded routes do not query actor data", () => {
  const resolver = read("apps/web/graphql/bmsAssistant.ts");
  const drawer = read("apps/web/components/work-assistant/WorkAssistantDrawer.tsx");
  assert.match(resolver, /deterministicKnowledgeReply/);
  assert.match(resolver, /if \(!loop\.usedAi\)/);
  assert.match(resolver, /deterministicReply \?\?/);
  assert.match(drawer, /skip: excluded/);
});

test("explicit current-page help resolves before prior conversation history reaches the model", () => {
  const resolver = read("apps/web/graphql/bmsAssistant.ts");
  const pageIntentHelper = read("apps/web/lib/bms/assistantKnowledge/pageIntent.ts");
  const pageIntent = resolver.indexOf("if (currentPath && isCurrentPageHelpRequest(message))");
  const loyaltyIntent = resolver.indexOf("if (isLoyaltyRedemptionCalculationRequest(message, currentPath, pageId))");
  const ambiguityGuard = resolver.indexOf("const clarification = clarifyAmbiguousStaffRequest(message)");
  const priorHistory = resolver.indexOf("const priorTurns = history");
  const modelLoop = resolver.indexOf("const loop = await runToolLoop");
  assert.ok(pageIntent >= 0, "missing deterministic current-page branch");
  assert.ok(pageIntent < ambiguityGuard, "report ambiguity handling can intercept explicit page help");
  assert.ok(pageIntent < priorHistory, "prior POS history can override the current route");
  assert.ok(pageIntent < modelLoop, "the model can override deterministic page guidance");
  assert.match(resolver, /kind: "guide"[\s\S]*?currentPageRequest: true/);
  assert.match(resolver, /isLoyaltyRedemptionCalculationRequest/);
  assert.match(resolver, /runApprovedTool/);
  assert.match(resolver, /tool\.name === "get_loyalty_program_status"/);
  assert.match(pageIntentHelper, /coversRoutePrefixes/, "detail-page guide coverage was dropped");
  assert.match(resolver, /limit: SYSTEM_GUIDES\.length/);
  assert.match(
    resolver,
    /maxEntries: comprehensive \? pageGuides\.length : 3/,
    "a request for every current-page workflow is still truncated to the generic fallback limit"
  );
  assert.match(
    resolver,
    /currentPageRequest\s*\? knowledge\.slice\(0, maxEntries\)/,
    "current-page help hides workflows that exist but require another permission"
  );
  assert.doesNotMatch(
    resolver.slice(pageIntent, loyaltyIntent),
    /\n\s*pageId,/,
    "a mismatched pageId can crowd validated currentPath guides out of the result"
  );
});

test("loyalty redemption examples use live settings and only apply a requested rate when stated", () => {
  const settings = {
    enabled: true,
    redeemPointsPerUnit: 100,
    redeemBahtPerUnit: 5,
    redeemMinPoints: 100,
  };
  assert.equal(
    isLoyaltyRedemptionCalculationRequest(
      "ขอตัวอย่างการแลกแต้ม 5 บาท ต่อ 1 แต้ม ขั้นต่ำ 100 แต้ม ว่าต้องกรอกอย่างไร",
      "/admin/loyalty",
      "loyalty"
    ),
    true
  );
  assert.equal(
    isLoyaltyRedemptionCalculationRequest("แต้มคิดก่อนหรือหลังหักส่วนลด", "/admin/loyalty", "loyalty"),
    false,
    "earning questions must stay with the general loyalty tool/guide flow"
  );
  assert.deepEqual(
    extractDesiredRedemptionSetup("5 บาท ต่อ 1 แต้ม และแลกขั้นต่ำเมื่อครบ 100 แต้ม"),
    { pointsPerUnit: 1, bahtPerUnit: 5, minPoints: 100 }
  );

  const genericReply = formatLoyaltyRedemptionReply(settings, "ร้านนี้แลกแต้มอย่างไร", "th");
  assert.match(genericReply, /100 แต้ม = ส่วนลด 5 บาท/);
  assert.doesNotMatch(genericReply, /ส่วนลด 500 บาท/);

  const requestedReply = formatLoyaltyRedemptionReply(
    settings,
    "5 บาท ต่อ 1 แต้ม และแลกขั้นต่ำเมื่อครบ 100 แต้ม",
    "th"
  );
  assert.match(requestedReply, /“แต้มที่ใช้ต่อ 1 หน่วยแลก” = 1/);
  assert.match(requestedReply, /“ส่วนลดที่ได้ต่อหน่วยแลก” = 5/);
  assert.match(requestedReply, /ส่วนลด 500 บาท/);
});

test("how-to replies remain numbered and actionable without an AI provider", () => {
  const resolver = read("apps/web/graphql/bmsAssistant.ts");
  assert.match(resolver, /SYSTEM_GUIDES/);
  assert.match(resolver, /guide\.steps\[locale\]\.map/);
  assert.match(resolver, /index \+ 1/);
  assert.match(resolver, /เปิดหน้าทำงาน:/);
  assert.match(resolver, /เป็นลำดับเลข 1, 2, 3 ที่ทำตามได้/);
});

test("live staff facts expose the missing grounding fields through approved tools", () => {
  const catalog = read("apps/web/lib/bms/tools/catalog.ts");
  assert.match(catalog, /name: "get_variant_reservations"[\s\S]*?permission: "order\.view"/);
  assert.match(catalog, /listVariantReservations\(ec\.tenantId, sku, size\)/);
  assert.match(catalog, /name: "analyze_pos_shift"[\s\S]*?permission: "pos\.shift\.report\.all"/);
  assert.match(catalog, /getPosShiftExportData\(ec\.tenantId, selectedShiftId, null\)/);
  assert.match(catalog, /findPosShiftOrderReference\(ec\.tenantId, \{ orderId, receiptNo \}\)/);
  assert.match(catalog, /expectedCashHidden[\s\S]*hidden by blind-close/);
  assert.match(catalog, /expectedCashHidden[\s\S]*ไม่เปิดเผย expected cash หรือรายการประกอบยอด/);
  assert.match(catalog, /countedCashComparison/);
  assert.match(catalog, /customerPhone: _phone, customerRef: _ref/);
  assert.match(catalog, /earnBase: settings\.earnBase/);
  assert.match(catalog, /name: "get_dashboard"[\s\S]*?fetchedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(catalog, /source: "live_query"/);
});

test("staff lookup is tenant-scoped and excludes platform and sensitive identity fields", () => {
  const service = read("apps/web/lib/bms/assistantAccess.ts");
  assert.match(service, /tenant_id = \$1/);
  assert.match(service, /is_platform_admin = FALSE/);
  assert.match(service, /\[tenantId, normalized, escapeLikePattern\(normalized\), safeLimit\]/);
  assert.doesNotMatch(service, /SELECT[^;]*(password|pin_hash|token|session)/is);
  // "%" is a LIKE metacharacter: unescaped it would dump the whole staff roster.
  assert.match(service, /ESCAPE '!'/);
  // users.id is uuid — an id the model invented would raise 22P02 and be reported as an incident.
  assert.match(service, /UUID_RE\.test/);
});

test("global admin drawer shares proposal mutations and POS-only keeps a non-admin guide boundary", () => {
  const adminLayout = read("apps/web/components/AdminLayoutClient.tsx");
  const drawer = read("apps/web/components/work-assistant/WorkAssistantDrawer.tsx");
  const posGuide = read("apps/web/components/work-assistant/PosGuideAssistant.tsx");
  const posLayout = read("apps/web/app/(pos)/pos/layout.tsx");
  assert.match(adminLayout, /<WorkAssistantDrawer \/>/);
  assert.match(drawer, /WORK_ASSISTANT_CONFIRM_MUTATIONS/);
  assert.match(drawer, /currentPath: pathname, pageId/);
  assert.match(drawer, /QuestionCircleOutlined/);
  assert.match(drawer, /<Modal[\s\S]*ตัวอย่างการใช้งานผู้ช่วย/);
  assert.match(drawer, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(drawer, /createdAt: new Date\(\)\.toISOString\(\)/);
  assert.match(drawer, /dateTimeLabel\(item\.createdAt, en\)/);
  assert.match(drawer, /<Popconfirm[\s\S]*onConfirm=\{clearChat\}/);
  assert.match(drawer, /localStorage\.removeItem\(storageKey\)/);
  assert.match(drawer, /DeleteOutlined/);
  assert.match(drawer, /อ่านตัวอย่าง แล้วกดคัดลอกไปวาง\/แก้ในช่องพิมพ์เองก่อนส่ง/);
  assert.match(drawer, /กะนี้ผิดตรงไหน/);
  assert.match(drawer, /ยอด VAT\/tax document ตรงกับยอดขายไหม/);
  assert.doesNotMatch(drawer, /suggestions\.map\(\(item\) => <Button key=\{item\} size="small" onClick=\{\(\) => send\(item\)\}/);
  assert.match(posLayout, /<PosGuideAssistant \/>/);
  assert.doesNotMatch(posGuide, /gql|\/graphql|bmsWorkAssistant/);
  assert.match(posGuide, /does not access sales data or perform actions/);
});

test("the full assistant examples teach POS shift reconciliation", () => {
  const page = read("apps/web/app/(admin)/admin/assistant/page.tsx");
  const th = read("apps/web/i18n/th.ts");
  const en = read("apps/web/i18n/en.ts");
  assert.match(page, /group_pos_reconcile/);
  assert.match(page, /admin_assistant\.ex_pos_1/);
  assert.match(page, /admin_assistant\.qs_pos_shift/);
  assert.match(th, /group_pos_reconcile: "ตรวจยอด POS \/ กะ"/);
  assert.match(th, /ex_pos_3: "นับเงินจริงได้ 188000 กะล่าสุดขาดหรือเกินเท่าไหร่"/);
  assert.match(en, /group_pos_reconcile: "POS shift reconciliation"/);
  assert.match(en, /ex_pos_3: "I counted 188000 cash in the latest shift\. Is it short or over\?"/);
});

test("a citation only claims relevance the question actually earned", () => {
  const resolver = read("apps/web/graphql/bmsAssistant.ts");
  assert.match(resolver, /const matched = retrieved\.filter\(\(entry\) => entry\.matchedQuery\)/);
  assert.match(resolver, /const citations = matched\.map/);
  assert.match(resolver, /const links = matched/);
});

test("retrieval language comes from the client because it is absent from the session", () => {
  const resolver = read("apps/web/graphql/bmsAssistant.ts");
  const schema = read("apps/web/graphql/typeDefs.ts");
  const drawer = read("apps/web/components/work-assistant/WorkAssistantDrawer.tsx");
  const page = read("apps/web/app/(admin)/admin/assistant/page.tsx");
  assert.match(resolver, /function safeLocale/);
  assert.doesNotMatch(resolver, /ctx\?\.admin\?\.language/, "users.language is not a session claim");
  assert.match(schema, /input BmsWorkAssistantInput[\s\S]*?locale: String/);
  assert.doesNotMatch(schema, /input BmsWorkAssistantInput[\s\S]*?sectionId/, "dead input field");
  assert.match(drawer, /locale: en \? "en" : "th"/);
  assert.match(page, /locale: lang === "en" \? "en" : "th"/);
});

test("a proposal shows what will execute, and an outbound recipient must be reviewed", () => {
  const drawer = read("apps/web/components/work-assistant/WorkAssistantDrawer.tsx");
  // The summary is model prose; the mutation and its server-composed args are the real action.
  assert.match(drawer, /\{proposal\.mutation\}\(/);
  assert.match(drawer, /Object\.entries\(proposal\.args/);
  assert.match(drawer, /isEmailReport/);
  assert.match(drawer, /disabled=\{isEmailReport && !recipientValid\}/);
  assert.match(drawer, /isKnownRecipient === false/);
});

test("the register guide surface stays inside the register", () => {
  const posGuide = read("apps/web/components/work-assistant/PosGuideAssistant.tsx");
  assert.match(posGuide, /REGISTER_GUIDE_IDS/);
  assert.match(posGuide, /guide\.pageId === "pos"/);
  assert.match(posGuide, /result\.matchedQuery/);
});

test("the Manual renders the catalog instead of keeping a second copy of it", () => {
  const manual = read("apps/web/app/(admin)/admin/manual/page.tsx");
  // Two copies of an answer drift, and only one of them was ever reachable from chat.
  assert.match(manual, /import \{ SYSTEM_FAQ \} from "@\/lib\/bms\/assistantKnowledge\/faq"/);
  assert.match(manual, /import \{ SYSTEM_LIMITS \} from "@\/lib\/bms\/assistantKnowledge\/limits"/);
  assert.match(manual, /const HELP_ROWS_TH: HelpRow\[\] = SYSTEM_FAQ\.map/);
  assert.match(manual, /const LIMIT_GROUPS_EN: LimitGroup\[\] = SYSTEM_LIMITS\.map/);
  assert.doesNotMatch(manual, /const HELP_ROWS_(TH|EN): HelpRow\[\] = \[/, "the FAQ grew a second home");
  assert.doesNotMatch(manual, /const LIMIT_GROUPS_(TH|EN): LimitGroup\[\] = \[/, "the limits grew a second home");
});

test("verified answers reach the model and the no-provider reply", () => {
  const catalog = read("apps/web/lib/bms/tools/catalog.ts");
  const resolver = read("apps/web/graphql/bmsAssistant.ts");
  assert.match(catalog, /faqs: faqsForGuide\(entry\.id\)/);
  // 97 rules across the catalog would crowd out the answer they exist to protect.
  assert.match(catalog, /limits: index < 2/);
  assert.match(resolver, /searchAssistantFaqs\(message, \{ locale, limit: 2 \}\)/);
});
