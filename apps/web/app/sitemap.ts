import type { MetadataRoute } from "next";
import { lessons, LEARNING_REVIEWED_AT, trackOrder } from "@/lib/learning/catalog";
import {
  absolutePublicUrl,
  localizedPublicPath,
  PUBLIC_MARKETING_PATHS,
  PUBLIC_SEO_LOCALES,
} from "@/lib/publicSeo";

const learningPaths = [
  "/learn",
  ...(Object.keys(trackOrder) as Array<keyof typeof trackOrder>).map((track) => `/learn/${track}`),
  ...lessons.map((lesson) => `/learn/guides/${lesson.slug}`),
];

export default function sitemap(): MetadataRoute.Sitemap {
  const marketingEntries = PUBLIC_SEO_LOCALES.flatMap((locale) =>
    PUBLIC_MARKETING_PATHS.map((path) => ({
      url: absolutePublicUrl(localizedPublicPath(path, locale)),
      changeFrequency: path === "/" ? "weekly" as const : "monthly" as const,
      priority: path === "/" ? 1 : path === "/restaurant" || path === "/cost-pricing" ? 0.9 : 0.6,
    })),
  );

  const learningEntries = PUBLIC_SEO_LOCALES.flatMap((locale) =>
    learningPaths.map((path) => ({
      url: absolutePublicUrl(localizedPublicPath(path, locale)),
      lastModified: new Date(LEARNING_REVIEWED_AT),
      changeFrequency: "monthly" as const,
      priority: path === "/learn" ? 0.9 : path.includes("/guides/") ? 0.7 : 0.8,
    })),
  );

  return [...marketingEntries, ...learningEntries];
}
