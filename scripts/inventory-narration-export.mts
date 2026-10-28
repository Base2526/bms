import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { inventoryNarrationCues } from "../apps/web/lib/learning/inventoryNarration.ts";

const entries = inventoryNarrationCues.th.map(({ text }) => ({
  text,
  id: createHash("sha256").update(text).digest("hex").slice(0, 24),
}));

await mkdir(".test-output/inventory-narration", { recursive: true });
await writeFile(".test-output/inventory-narration/requests.json", `${JSON.stringify(entries, null, 2)}\n`);
console.log(`Exported ${entries.length} Thai inventory narration cues.`);
