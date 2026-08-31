import assert from "node:assert/strict";
import test from "node:test";

import {
  POS_REGISTER_SUGGESTIONS,
  SYSTEM_CAPABILITIES,
  SYSTEM_FAQ,
  SYSTEM_GUIDES,
  SYSTEM_LIMITS,
  searchAssistantFaqs,
  searchAssistantKnowledge,
} from "../../apps/web/lib/bms/assistantKnowledge/index.ts";
import { staffTools } from "../../apps/web/lib/bms/tools/catalog.ts";
import { WORK_ASSISTANT_QUESTION_CORPUS, CORPUS_REAL_QUESTIONS } from "./work-assistant-question-corpus.mts";
import type { CorpusCase } from "./work-assistant-question-corpus.mts";

/**
 * "It found something" is not an answer.
 *
 * The catalog's earlier assertions accepted a hit anywhere in the result list, so a guide could
 * slide from rank 1 to rank 6 — behind five unrelated entries — without a single test turning red.
 * This suite pins the *leading* entry for every question the product asks or ships as a chip, and
 * pins the approved tool for every question that can only be answered from live data.
 *
 * Run through the gate (`npm run test:pure`); the runner loads the Next runtime shim that the tool
 * catalog needs.
 */

const knowledgeIds = new Set([...SYSTEM_CAPABILITIES, ...SYSTEM_GUIDES].map((entry) => entry.id));
const guideIds = new Set(SYSTEM_GUIDES.map((guide) => guide.id));

const registerGuideIds = new Set(
  SYSTEM_GUIDES.filter((guide) => guide.pageId === "pos").map((guide) => guide.id)
);

const retrieve = (item: CorpusCase) => {
  const results = searchAssistantKnowledge(item.q, {
    locale: item.locale,
    currentPath: item.context?.currentPath,
    pageId: item.context?.pageId,
    kind: item.context?.kind,
    limit: 10,
  });
  // Mirror the register surface: PosGuideAssistant keeps only guides performed at the register,
  // because a `pos_only` cashier cannot open /admin at all. Judging register questions against
  // back-office guides would fail this suite for answers the cashier can never be shown.
  return item.context?.pageId === "pos"
    ? results.filter((entry) => registerGuideIds.has(entry.id))
    : results;
};

const describe = (item: CorpusCase) =>
  `${item.locale}${item.context?.pageId ? `/${item.context.pageId}` : ""} "${item.q}"`;

test("the pinned corpus still covers the questions it was written for", () => {
  // 59 questions people actually ask (chips + hand-verified), plus coverage questions for the
  // rest of the catalog, plus 2 guards that must stay unanswerable.
  assert.equal(CORPUS_REAL_QUESTIONS.length, 59, "a pinned question disappeared or was added without review");
  assert.equal(WORK_ASSISTANT_QUESTION_CORPUS.filter((item) => item.expect === "no-match").length, 2, "empty-answer guards changed");

  const seen = new Set<string>();
  for (const item of WORK_ASSISTANT_QUESTION_CORPUS) {
    const key = `${item.locale}|${item.context?.pageId ?? ""}|${item.context?.currentPath ?? ""}|${item.q}`;
    assert.ok(!seen.has(key), `duplicate corpus case: ${describe(item)}`);
    seen.add(key);
    if (item.expect === "no-match") {
      assert.equal(item.expectTop, undefined, `${describe(item)} cannot both be unanswerable and pin a top hit`);
      continue;
    }
    assert.ok(item.expectTop, `${describe(item)} must name the entry that leads the answer`);
    assert.ok(knowledgeIds.has(item.expectTop!), `${describe(item)} pins an unknown entry ${item.expectTop}`);
    for (const also of item.expectAlso ?? []) {
      assert.ok(knowledgeIds.has(also), `${describe(item)} pins an unknown entry ${also}`);
    }
  }
});

test("every catalog entry has a question someone would actually ask", () => {
  // A guide or capability nobody ever asks about is unreachable in practice, and unreachable
  // entries are where wrong text survives: nothing retrieves it, so nothing contradicts it.
  const pinned = new Set(
    WORK_ASSISTANT_QUESTION_CORPUS.flatMap((item) => [item.expectTop, ...(item.expectAlso ?? [])])
      .filter((id): id is string => Boolean(id))
  );
  // A guide whose FAQ question is pinned is reachable by that question — the FAQ suite asserts it
  // leads its own guide — so it does not need a second one written for it.
  for (const faq of SYSTEM_FAQ) pinned.add(faq.guideId);
  const missingGuides = SYSTEM_GUIDES.filter((guide) => !pinned.has(guide.id)).map((guide) => guide.id);
  assert.deepEqual(missingGuides, [], "guides with no pinned question");
  const missingCapabilities = SYSTEM_CAPABILITIES.filter((entry) => !pinned.has(entry.id)).map((entry) => entry.id);
  assert.deepEqual(missingCapabilities, [], "capabilities with no pinned question");
});

test("every pinned question is led by the entry that actually answers it", () => {
  for (const item of WORK_ASSISTANT_QUESTION_CORPUS) {
    const results = retrieve(item);
    const matched = results.filter((entry) => entry.matchedQuery);

    if (item.expect === "no-match") {
      assert.equal(matched.length, 0, `${describe(item)} must not report a match: ${matched.map((m) => m.id).join(", ")}`);
      continue;
    }

    if (item.expect === "page-guidance") {
      // Standing on a page may rank that page's guides; it may never turn them into a match.
      assert.equal(matched.length, 0, `${describe(item)} claimed a match it did not earn: ${matched.map((m) => m.id).join(", ")}`);
      assert.ok(results.length > 0, `${describe(item)} should still surface the current page's guides`);
      assert.equal(results[0]?.id, item.expectTop, `${describe(item)} ranked ${results[0]?.id} above the page's own guide`);
      continue;
    }

    assert.ok(matched.length > 0, `${describe(item)} matched nothing — it should be led by ${item.expectTop}`);
    assert.equal(
      matched[0]?.id,
      item.expectTop,
      `${describe(item)} is led by ${matched[0]?.id} instead of ${item.expectTop} ` +
        `(matched: ${matched.map((m) => `${m.id}@${m.score}`).join(", ")})`
    );
    for (const also of item.expectAlso ?? []) {
      assert.ok(
        matched.some((entry) => entry.id === also),
        `${describe(item)} dropped ${also}, which is a separate answer the reply must not merge away`
      );
    }
    if (item.expectStatus) {
      assert.equal(
        matched[0]?.capabilityStatus,
        item.expectStatus,
        `${describe(item)} would answer with status ${matched[0]?.capabilityStatus} — the shop repeats that promise to its own customers`
      );
    }
  }
});

test("questions that need live data name a tool that exists and stays permission-gated", () => {
  const pinned = WORK_ASSISTANT_QUESTION_CORPUS.filter((item) => item.expectTool);
  assert.ok(pinned.length >= 10, "live-data coverage shrank");

  for (const item of pinned) {
    const { name, permission } = item.expectTool!;
    const withAccess = staffTools(new Set(permission ? [permission] : []));
    const tool = withAccess.find((entry) => entry.name === name);
    assert.ok(tool, `${describe(item)} names a tool the staff surface does not offer: ${name}`);
    assert.equal(
      tool!.permission ?? null,
      permission,
      `${name} changed its gate — ${describe(item)} would now be answered for the wrong people`
    );
    if (permission) {
      // A tool the actor may not use is never even shown to the model (staffTools filters first).
      const withoutAccess = staffTools(new Set()).map((entry) => entry.name);
      assert.ok(!withoutAccess.includes(name), `${name} is offered to an actor holding no permission`);
    }
  }
});

test("every starter chip the UI ships is a pinned question", () => {
  // A chip is a promise: pressing it must land on a verified answer, not on "no guide matched".
  const pinnedByLocale = new Map(
    (["th", "en"] as const).map((locale) => [
      locale,
      new Set(WORK_ASSISTANT_QUESTION_CORPUS.filter((item) => item.locale === locale).map((item) => item.q)),
    ])
  );
  for (const locale of ["th", "en"] as const) {
    for (const chip of POS_REGISTER_SUGGESTIONS[locale]) {
      assert.ok(pinnedByLocale.get(locale)?.has(chip), `register chip is not pinned (${locale}): ${chip}`);
    }
  }
  for (const chip of ["หน้านี้ใช้งานอย่างไร", "บัญชีฉันทำอะไรได้บ้าง", "ระบบ export PDF หรือ Excel ได้ไหม"]) {
    assert.ok(pinnedByLocale.get("th")?.has(chip), `drawer chip is not pinned (th): ${chip}`);
  }
  for (const chip of ["What can I do on this page?", "What can my account access?", "Can BMS export PDF or Excel?"]) {
    assert.ok(pinnedByLocale.get("en")?.has(chip), `drawer chip is not pinned (en): ${chip}`);
  }
});

test("every register chip resolves inside the register, never to a back-office page", () => {
  const registerGuideIds = new Set(SYSTEM_GUIDES.filter((guide) => guide.pageId === "pos").map((guide) => guide.id));
  for (const item of WORK_ASSISTANT_QUESTION_CORPUS) {
    if (item.context?.pageId !== "pos" || item.expect !== "answer") continue;
    assert.ok(
      registerGuideIds.has(item.expectTop!),
      `${describe(item)} points a cashier at ${item.expectTop}, which is not performed at the register`
    );
  }
});

test("every FAQ moved out of the Manual is answered by its own guide, in both languages", () => {
  assert.ok(SYSTEM_FAQ.length >= 20, "FAQ coverage shrank");
  const faqIds = SYSTEM_FAQ.map((faq) => faq.id);
  assert.equal(new Set(faqIds).size, faqIds.length, "duplicate FAQ id");

  for (const faq of SYSTEM_FAQ) {
    assert.ok(guideIds.has(faq.guideId), `${faq.id} points at a guide that does not exist: ${faq.guideId}`);
    for (const locale of ["th", "en"] as const) {
      assert.ok(faq.question[locale].trim(), `${faq.id} missing ${locale} question`);
      assert.ok(faq.answer[locale].trim(), `${faq.id} missing ${locale} answer`);
      assert.ok(faq.aliases[locale].length > 0, `${faq.id} missing ${locale} aliases`);

      const matched = searchAssistantKnowledge(faq.question[locale], { locale, kind: "guide", limit: 10 })
        .filter((entry) => entry.matchedQuery);
      assert.equal(
        matched[0]?.id,
        faq.guideId,
        `FAQ ${faq.id} (${locale}) is led by ${matched[0]?.id ?? "nothing"} instead of its own guide ${faq.guideId}`
      );
    }
  }
});

test("the words staff actually type reach the FAQ that answers them", () => {
  for (const faq of SYSTEM_FAQ) {
    for (const locale of ["th", "en"] as const) {
      for (const alias of faq.aliases[locale]) {
        const hits = searchAssistantFaqs(alias, { locale, limit: 3 });
        assert.equal(
          hits[0]?.id,
          faq.id,
          `"${alias}" (${locale}) resolves to ${hits[0]?.id ?? "nothing"} instead of ${faq.id} — ` +
            "an alias that answers a different question is worse than no alias"
        );
      }
    }
  }
});

test("every limit and trap moved out of the Manual reaches the workflow it constrains", () => {
  assert.ok(SYSTEM_LIMITS.length >= 19, "limit coverage shrank");
  const ids = SYSTEM_LIMITS.map((group) => group.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate limit group id");

  for (const group of SYSTEM_LIMITS) {
    assert.ok(group.guideIds.length > 0, `${group.id} constrains no workflow`);
    for (const guideId of group.guideIds) {
      assert.ok(guideIds.has(guideId), `${group.id} points at a guide that does not exist: ${guideId}`);
    }
    for (const locale of ["th", "en"] as const) {
      assert.ok(group.title[locale].trim(), `${group.id} missing ${locale} title`);
      assert.ok(group.items[locale].length > 0, `${group.id} has no ${locale} rules`);
      // A rule that exists in one language only is a rule half the staff never sees.
      assert.equal(
        group.items[locale].length,
        group.items[locale === "th" ? "en" : "th"].length,
        `${group.id} has a different number of rules in th and en`
      );

      // The title and the phrasings staff use must both reach a guide this group constrains.
      for (const query of [group.title[locale], ...group.aliases[locale]]) {
        const matched = searchAssistantKnowledge(query, { locale, kind: "guide", limit: 10 })
          .filter((entry) => entry.matchedQuery);
        assert.ok(
          matched.some((entry) => group.guideIds.includes(entry.id)),
          `"${query}" (${locale}) reaches ${matched.map((m) => m.id).join(", ") || "nothing"}, none of which is constrained by ${group.id}`
        );
      }
    }
  }
});

test("a generic question stays unanswered instead of matching whatever shares a filler word", () => {
  // Regression: "What can I do on this page?" scored pos.device-settings as a real match, because
  // every token in it appears somewhere in some guide body.
  for (const query of ["What can I do on this page?", "how do I do that", "can you show me this"]) {
    const matched = searchAssistantKnowledge(query, { locale: "en", limit: 10 }).filter((entry) => entry.matchedQuery);
    assert.equal(matched.length, 0, `"${query}" claimed a match: ${matched.map((m) => `${m.id}@${m.score}`).join(", ")}`);
  }
  // The filter must not swallow real questions that happen to contain filler words.
  const real = searchAssistantKnowledge("how do I export a report to PDF", { locale: "en", limit: 10 })
    .filter((entry) => entry.matchedQuery);
  assert.ok(real.some((entry) => entry.id === "reports.export" || entry.id === "reports.create-export"));
});
