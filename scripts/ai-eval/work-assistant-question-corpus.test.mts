import assert from "node:assert/strict";
import test from "node:test";

import {
  POS_REGISTER_SUGGESTIONS,
  SYSTEM_CAPABILITIES,
  SYSTEM_FAQ,
  SYSTEM_GUIDES,
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

const retrieve = (item: CorpusCase) =>
  searchAssistantKnowledge(item.q, {
    locale: item.locale,
    currentPath: item.context?.currentPath,
    pageId: item.context?.pageId,
    kind: item.context?.kind,
    limit: 10,
  });

const describe = (item: CorpusCase) =>
  `${item.locale}${item.context?.pageId ? `/${item.context.pageId}` : ""} "${item.q}"`;

test("the pinned corpus still covers the questions it was written for", () => {
  // 51 questions people actually ask + 2 guards that must stay unanswerable.
  assert.equal(CORPUS_REAL_QUESTIONS.length, 51, "a pinned question disappeared or was added without review");
  assert.equal(WORK_ASSISTANT_QUESTION_CORPUS.length - CORPUS_REAL_QUESTIONS.length, 2, "empty-answer guards changed");

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
