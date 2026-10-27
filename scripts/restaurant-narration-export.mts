import { mkdir, writeFile } from "node:fs/promises";
import { thaiNarrationEntries } from "./lib/restaurant-narration.mts";
const entries = thaiNarrationEntries();
await mkdir(".test-output/restaurant-narration", { recursive: true });
await writeFile(".test-output/restaurant-narration/requests.json", JSON.stringify(entries, null, 2));
console.log(`Exported ${entries.length} unique Thai narration cues.`);
console.log(`Latin words: ${[...new Set(entries.flatMap(entry => entry.text.match(/[A-Za-z_]+/g) ?? []))].sort().join(", ")}`);
