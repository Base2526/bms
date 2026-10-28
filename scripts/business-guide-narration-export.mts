import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { businessGuideFlows, businessNarrationCues, type BusinessTrackId } from "../apps/web/lib/learning/businessGuideFlow.ts";

const tracks = Object.keys(businessGuideFlows) as BusinessTrackId[];
const entries = tracks.flatMap((track) => businessNarrationCues(track, "th").map(({ text }) => ({
  track,
  text,
  id: createHash("sha256").update(`${track}\0${text}`).digest("hex").slice(0, 24),
})));

await mkdir(".test-output/business-guide-narration", { recursive: true });
await writeFile(".test-output/business-guide-narration/requests.json", `${JSON.stringify(entries, null, 2)}\n`);
console.log(`Exported ${entries.length} Thai business-guide narration cues.`);
