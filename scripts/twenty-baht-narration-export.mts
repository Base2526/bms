import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { twentyBahtFlow } from "../apps/web/lib/learning/twentyBahtGuide.ts";

const entries = twentyBahtFlow.map((node) => ({
  track: "twenty-baht-shop",
  text: node.caption.th,
  id: createHash("sha256").update(`twenty-baht-shop\0${node.caption.th}`).digest("hex").slice(0, 24),
}));
await mkdir(".test-output/twenty-baht-narration", { recursive: true });
await writeFile(".test-output/twenty-baht-narration/requests.json", `${JSON.stringify(entries, null, 2)}\n`);
console.log(`Exported ${entries.length} Thai twenty-baht-shop cues.`);
