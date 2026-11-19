"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18nContext";
import { localizedPublicPath } from "@/lib/publicSeo";
import { gettingStartedLessons } from "@/lib/learning/gettingStartedLessons";

export default function GuideLinks({ slugs, start = false }: { slugs?: readonly string[]; start?: boolean }) {
  const { lang, t } = useI18n();
  const locale = lang === "en" ? "en" : "th";
  const items = (slugs || []).map((slug) => gettingStartedLessons.find((lesson) => lesson.slug === slug)).filter((lesson) => lesson !== undefined);
  return <nav aria-label={t("guide_links.label")} style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", alignItems: "center", margin: "8px 0 16px" }}>
    <span>{t("guide_links.label")}:</span>
    {start && <Link href={localizedPublicPath("/learn/getting-started", locale)}>{t("guide_links.start")}</Link>}
    {items.map((lesson) => <Link key={lesson.slug} href={localizedPublicPath(`/learn/guides/${lesson.slug}?track=getting-started`, locale)}>{lesson.title[locale]}</Link>)}
  </nav>;
}
