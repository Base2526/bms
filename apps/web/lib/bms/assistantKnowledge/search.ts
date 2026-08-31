import { SYSTEM_CAPABILITIES } from "./capabilities";
import { SYSTEM_FAQ, faqRetrievalAliases } from "./faq";
import { SYSTEM_GUIDES } from "./guides";
import { limitRetrievalAliases } from "./limits";
import type { BmsPermission } from "../permissions";
import type {
  AssistantKnowledgeContext,
  AssistantKnowledgeResult,
  AssistantLocale,
  SystemCapability,
  SystemGuide,
} from "./types";

export function normalizeAssistantQuery(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Words that carry no topic on their own.
 *
 * Token scoring is substring-based over titles, aliases and bodies, so a question built only from
 * these words used to "match" whatever entry happened to contain them: "What can I do on this
 * page?" scored `pos.device-settings` as a real answer for an admin standing anywhere. A generic
 * question must reach the honest "no verified entry matched this question" branch instead of the
 * first entry that shares the word "page". Thai has no spaces, so its questions arrive as one long
 * token and are matched by alias containment — only the English fillers need listing here.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "any", "are", "at", "be", "but", "by", "can", "could", "did", "do", "does",
  "for", "from", "get", "has", "have", "how", "in", "is", "it", "its", "me", "my", "of", "on",
  "or", "our", "page", "please", "screen", "should", "show", "so", "tell", "that", "the", "then",
  "there", "these", "this", "to", "us", "want", "was", "we", "what", "when", "where", "which",
  "who", "why", "will", "with", "would", "you", "your",
]);

function tokens(value: string): string[] {
  return normalizeAssistantQuery(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function textScore(query: string, title: string, aliases: readonly string[], body: string): number {
  const q = normalizeAssistantQuery(query);
  if (!q) return 0;
  const normalizedTitle = normalizeAssistantQuery(title);
  const normalizedAliases = aliases.map(normalizeAssistantQuery);
  const normalizedBody = normalizeAssistantQuery(body);
  let score = 0;
  if (normalizedTitle === q) score += 30;
  else if (normalizedTitle.includes(q)) score += 18;
  if (normalizedAliases.some((alias) => alias === q)) score += 24;
  else {
    /**
     * Partial alias matches used to score a flat 12, so "ระบบโอนสต็อกข้ามสาขาได้ไหม" tied between
     * the branch-inventory capability (matched on "โอนสาขา") and the transfer capability (matched
     * on "โอนสต็อกข้ามสาขา") — and the tie was broken by alphabetical id, which is not an answer.
     * The longest verified phrase found in the question is the stronger evidence, so it wins by a
     * bounded margin: never enough to beat an exact alias or a title, always enough to beat a
     * shorter phrase that happens to sit inside the same words. Thai supplies no word breaks, so
     * this length signal is most of what separates two Thai aliases at all.
     *
     * The reverse direction is restricted: a query found *inside* an alias only counts when it is
     * most of that alias. "ทำยังไง" sits inside "คิวเภสัชกรทำยังไง", but someone typing two generic
     * words has not asked about the pharmacy queue — counting that as a match resurrects the exact
     * failure this catalog exists to prevent.
     */
    const overlaps = normalizedAliases.filter(
      (alias) => q.includes(alias) || (alias.includes(q) && q.length * 2 >= alias.length)
    );
    if (overlaps.length) {
      const longest = Math.max(...overlaps.map((alias) => alias.length));
      score += 12 + Math.min(8, Math.floor(longest / 3));
    }
  }
  for (const token of tokens(q)) {
    if (normalizedTitle.includes(token)) score += 5;
    if (normalizedAliases.some((alias) => alias.includes(token))) score += 4;
    if (normalizedBody.includes(token)) score += 1;
  }
  return score;
}

function permissionState(
  required: readonly BmsPermission[],
  anyOf: readonly BmsPermission[] | undefined,
  context: AssistantKnowledgeContext,
  accessRequirement: "any_staff" | "tenant_administrator" | "platform_administrator" = "any_staff"
) {
  const missing = context.permissions ? required.filter((permission) => !context.permissions?.has(permission)) : [];
  const missingAnyOf = context.permissions && anyOf?.length && !anyOf.some((permission) => context.permissions?.has(permission))
    ? [...anyOf]
    : [];
  const audienceAllowed = accessRequirement === "platform_administrator"
    ? context.isPlatformAdmin === true
    : accessRequirement === "tenant_administrator"
      ? context.isPlatformAdmin === true || context.role === "Administrator"
      : true;
  const accessNote = audienceAllowed
    ? missingAnyOf.length ? `one_of:${missingAnyOf.join(",")}` : null
    : accessRequirement;
  return {
    missing: [...missing, ...missingAnyOf],
    accessible: audienceAllowed && missing.length === 0 && missingAnyOf.length === 0,
    accessRequirement,
    accessNote,
  };
}

function capabilityResult(
  entry: SystemCapability,
  query: string,
  locale: AssistantLocale,
  context: AssistantKnowledgeContext
): AssistantKnowledgeResult | null {
  const queryScore = textScore(query, entry.title[locale], entry.aliases[locale], `${entry.description[locale]} ${entry.limitations[locale]}`);
  let score = queryScore;
  if (context.currentPath && entry.route && context.currentPath.startsWith(entry.route)) score += 8;
  if (context.pageId === entry.module) score += 8;
  if (score <= 0) return null;
  const access = permissionState(entry.requiredPermissions, entry.anyOfPermissions, context, entry.accessRequirement);
  return {
    kind: "capability", id: entry.id, title: entry.title[locale], summary: entry.description[locale],
    route: entry.route, score, requiredPermissions: entry.requiredPermissions,
    missingPermissions: access.missing, accessible: access.accessible, capabilityStatus: entry.status,
    accessRequirement: access.accessRequirement, accessNote: access.accessNote,
    matchedQuery: queryScore > 0,
  };
}

function guideResult(
  entry: SystemGuide,
  query: string,
  locale: AssistantLocale,
  context: AssistantKnowledgeContext
): AssistantKnowledgeResult | null {
  // A guide inherits its FAQ's question and staff phrasings as retrieval keys, so "กดจัดส่งไม่ได้"
  // reaches the guide that owns that answer. FAQ answers stay out of scoring on purpose (faq.ts).
  const aliasPool = [
    ...entry.aliases[locale],
    ...faqRetrievalAliases(entry.id, locale),
    ...limitRetrievalAliases(entry.id, locale),
  ];
  const queryScore = textScore(query, entry.title[locale], aliasPool, `${entry.summary[locale]} ${entry.steps[locale].join(" ")}`);
  let score = queryScore;
  if (context.currentPath && context.currentPath.startsWith(entry.route)) score += 10;
  if (context.pageId === entry.pageId) score += 10;
  if (score <= 0) return null;
  const access = permissionState(entry.requiredPermissions, entry.anyOfPermissions, context, entry.accessRequirement);
  return {
    kind: "guide", id: entry.id, title: entry.title[locale], summary: entry.summary[locale],
    route: entry.route, score, requiredPermissions: entry.requiredPermissions,
    missingPermissions: access.missing, accessible: access.accessible,
    accessRequirement: access.accessRequirement, accessNote: access.accessNote,
    matchedQuery: queryScore > 0,
  };
}

export function searchAssistantKnowledge(
  query: string,
  context: AssistantKnowledgeContext
): AssistantKnowledgeResult[] {
  // เพดานนี้กันค่าที่ผู้เรียกส่งมาเกินจริง ไม่ใช่คำสัญญาของฟีเจอร์ — หน้าที่มีไกด์มากกว่าเพดาน
  // จะตอบ "อธิบายทุกเมนูในหน้านี้" ไม่ครบ โดยที่ไม่มีอะไรฟ้องนอกจากเทสความครบถ้วน
  // (หน้าเครื่องขายแตะ 21 ไกด์ตอนเพิ่มงานร้านอาหาร) · ผู้เรียกจริงยังคุมตัวเลขของตัวเองเหมือนเดิม
  const limit = Math.min(Math.max(context.limit ?? 8, 1), 32);
  const capabilities = context.kind === "guide" ? [] : SYSTEM_CAPABILITIES.map((entry) => capabilityResult(entry, query, context.locale, context));
  const guides = context.kind === "capability" ? [] : SYSTEM_GUIDES.map((entry) => guideResult(entry, query, context.locale, context));
  return [...capabilities, ...guides]
    .filter((entry): entry is AssistantKnowledgeResult => entry !== null)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export type AssistantFaqMatch = Readonly<{
  id: string;
  guideId: string;
  question: string;
  answer: string;
  /** The owning guide's route, so a matched answer stays linkable. */
  route: string | null;
  score: number;
}>;

/**
 * Match a question against the verified FAQ only.
 *
 * Used where a verified sentence beats verified steps: the no-AI-provider reply, which otherwise
 * lists a guide's numbered steps for a question the FAQ already answers in one line. Only the FAQ
 * question and its staff phrasings are scored — never the answer text (see faq.ts).
 */
export function searchAssistantFaqs(
  query: string,
  context: Readonly<{ locale: AssistantLocale; limit?: number }>
): AssistantFaqMatch[] {
  const limit = Math.min(Math.max(context.limit ?? 2, 1), 10);
  const routeByGuideId = new Map(SYSTEM_GUIDES.map((guide) => [guide.id, guide.route]));
  return SYSTEM_FAQ
    .map((faq) => ({
      id: faq.id,
      guideId: faq.guideId,
      question: faq.question[context.locale],
      answer: faq.answer[context.locale],
      route: routeByGuideId.get(faq.guideId) ?? null,
      score: textScore(query, faq.question[context.locale], faq.aliases[context.locale], ""),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
