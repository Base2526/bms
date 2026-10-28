import type { MetadataRoute } from "next";
import { lessons, LEARNING_REVIEWED_AT } from "@/lib/learning/catalog";
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || "https://jachoei.com").replace(/\/$/, "");
  return ["/learn", "/learn/retail", "/learn/board-game", "/learn/restaurant", "/learn/pharmacy", "/learn/inventory", ...lessons.map((lesson) => `/learn/guides/${lesson.slug}`)]
    .map((path) => ({ url: `${base}${path}`, lastModified: new Date(LEARNING_REVIEWED_AT), changeFrequency: "monthly" as const }));
}
