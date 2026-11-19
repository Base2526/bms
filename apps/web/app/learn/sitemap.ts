import type { MetadataRoute } from "next";
import { lessons, LEARNING_REVIEWED_AT, trackOrder } from "@/lib/learning/catalog";
import { absolutePublicUrl, localizedPublicPath, PUBLIC_SEO_LOCALES } from "@/lib/publicSeo";
export default function sitemap(): MetadataRoute.Sitemap {
  const entries = [
    { path: "/learn", reviewedAt: "2026-11-19" },
    ...(Object.keys(trackOrder) as Array<keyof typeof trackOrder>).map((track) => ({ path: `/learn/${track}`, reviewedAt: track === "building-materials" ? "2026-11-19" : LEARNING_REVIEWED_AT })),
    ...lessons.map((lesson) => ({ path: `/learn/guides/${lesson.slug}`, reviewedAt: lesson.reviewedAt ?? LEARNING_REVIEWED_AT })),
  ];
  return PUBLIC_SEO_LOCALES.flatMap((locale) => entries.map(({ path, reviewedAt }) => ({
    url: absolutePublicUrl(localizedPublicPath(path, locale)),
    lastModified: new Date(reviewedAt),
    changeFrequency: "monthly" as const,
  })));
}
