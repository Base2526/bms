import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

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
  assert.match(posLayout, /<PosGuideAssistant \/>/);
  assert.doesNotMatch(posGuide, /gql|\/graphql|bmsWorkAssistant/);
  assert.match(posGuide, /does not access sales data or perform actions/);
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
