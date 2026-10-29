import type { MetadataRoute } from "next";
import { lessons, LEARNING_REVIEWED_AT, trackOrder } from "@/lib/learning/catalog";
import { absolutePublicUrl, localizedPublicPath, PUBLIC_SEO_LOCALES } from "@/lib/publicSeo";
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/learn", ...(Object.keys(trackOrder) as Array<keyof typeof trackOrder>).map((track) => `/learn/${track}`), ...lessons.map((lesson) => `/learn/guides/${lesson.slug}`)];
  return PUBLIC_SEO_LOCALES.flatMap((locale) => paths.map((path) => ({
    url: absolutePublicUrl(localizedPublicPath(path, locale)),
    lastModified: new Date(LEARNING_REVIEWED_AT),
    changeFrequency: "monthly" as const,
  })));
}
