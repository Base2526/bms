'use client';

import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { POS_REGISTER_SUGGESTIONS, SYSTEM_GUIDES, searchAssistantKnowledge } from "@/lib/bms/assistantKnowledge";
import { useI18n } from "@/lib/i18nContext";

/**
 * Deterministic POS-only guide surface. It deliberately makes no GraphQL/AI call:
 * /pos authenticates by device + cashier PIN, not an admin session, and widening
 * the admin assistant boundary would break the pos_only invariant.
 *
 * Only register guides are served here. `pos.configure-devices` and `pos.review-readiness`
 * also start with "pos." but their steps are back-office work on `/admin/**`, which a
 * pos_only account cannot open at all — answering a cashier with them is a dead end.
 * `pageId === "pos"` is the existing marker for "performed at the register".
 */
const REGISTER_GUIDE_IDS = new Set(
  SYSTEM_GUIDES.filter((guide) => guide.pageId === "pos").map((guide) => guide.id)
);

export default function PosGuideAssistant() {
  const pathname = usePathname();
  const { lang } = useI18n();
  const locale = lang === "en" ? "en" : "th";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchAssistantKnowledge(query, {
    locale,
    currentPath: "/admin/pos-manual",
    pageId: "pos",
    kind: "guide",
    limit: 10,
  }).filter((result) => REGISTER_GUIDE_IDS.has(result.id)
    // Standing on the POS page boosts every register guide, so an unmatched question would
    // otherwise be answered confidently with whichever guide sorts first.
    && (!query.trim() || result.matchedQuery)), [locale, query]);

  if (pathname === "/pos/display") return null;
  const selected = results[0] ? SYSTEM_GUIDES.find((guide) => guide.id === results[0].id) : null;
  const en = locale === "en";

  return (
    <>
      <button
        type="button"
        aria-label={en ? "Open POS guide assistant" : "เปิดผู้ช่วยคู่มือ POS"}
        onClick={() => setOpen(true)}
        style={{ position: "fixed", right: 18, bottom: 18, zIndex: 100, width: 52, height: 52, borderRadius: 26, border: 0, background: "#1677ff", color: "#fff", fontSize: 22, boxShadow: "0 8px 24px rgba(0,0,0,.25)", cursor: "pointer" }}
      >?</button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={en ? "POS guide assistant" : "ผู้ช่วยคู่มือ POS"} style={{ position: "fixed", inset: 0, zIndex: 110, background: "rgba(0,0,0,.4)", display: "flex", justifyContent: "flex-end" }}>
          <div style={{ width: "min(440px, 100vw)", height: "100%", overflowY: "auto", background: "#fff", color: "#1f1f1f", padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <strong style={{ fontSize: 18 }}>{en ? "POS Guide Assistant" : "ผู้ช่วยคู่มือ POS"}</strong>
              <button type="button" onClick={() => setOpen(false)} style={{ marginLeft: "auto", minWidth: 44, minHeight: 44 }}>×</button>
            </div>
            <p>{en ? "Ask how to use the POS. This guide does not access sales data or perform actions." : "ถามวิธีใช้ POS ได้ที่นี่ คู่มือนี้ไม่อ่านข้อมูลการขายและไม่ทำรายการแทน"}</p>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={en ? "e.g. How do I apply a discount?" : "เช่น ให้ส่วนลดอย่างไร"}
              style={{ width: "100%", minHeight: 46, padding: "8px 12px", fontSize: 16, boxSizing: "border-box" }}
            />
            {!query ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {POS_REGISTER_SUGGESTIONS[locale].map((item) => (
                  <button type="button" key={item} onClick={() => setQuery(item)} style={{ minHeight: 40 }}>{item}</button>
                ))}
              </div>
            ) : null}
            {query && !selected ? <p>{en ? "No verified POS guide matched this question. Open the full cashier manual." : "ยังไม่พบคู่มือ POS ที่ยืนยันได้สำหรับคำถามนี้ กรุณาเปิดคู่มือแคชเชียร์ฉบับเต็ม"}</p> : null}
            {selected ? (
              <div style={{ marginTop: 18 }}>
                <h2>{selected.title[locale]}</h2>
                <p>{selected.summary[locale]}</p>
                <h3>{en ? "Before you start" : "ก่อนเริ่ม"}</h3>
                <ul>{selected.prerequisites[locale].map((item) => <li key={item}>{item}</li>)}</ul>
                <h3>{en ? "Steps" : "ขั้นตอน"}</h3>
                <ol>{selected.steps[locale].map((item) => <li key={item}>{item}</li>)}</ol>
                <h3>{en ? "Important" : "ข้อควรระวัง"}</h3>
                <ul>{selected.warnings[locale].map((item) => <li key={item}>{item}</li>)}</ul>
                <a href="/pos/manual">{en ? "Open the full cashier manual" : "เปิดคู่มือแคชเชียร์ฉบับเต็ม"}</a>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
