import type { TrackId } from "./catalog";

/** Public, Thai-only files generated from docs/public-pos-guides/*.md. */
export const POS_GUIDE_REVIEWED_AT = "2026-11-19";

const guideSlugs = ["retail", "board-game", "restaurant", "pharmacy", "building-materials"] as const;
type GuideSlug = typeof guideSlugs[number];

export function isDownloadablePosGuide(track: TrackId): track is GuideSlug {
  return (guideSlugs as readonly string[]).includes(track);
}

export function posGuideFile(track: GuideSlug, format: "docx" | "pdf"): string {
  return `/guides/pos/bms-pos-${track}-th.${format}`;
}
