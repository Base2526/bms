import { createHash } from "node:crypto";
import { restaurantFlows } from "../../apps/web/components/marketing/restaurant/flowContent.ts";
import { guideFlowCopy, type GuideProfile } from "../../apps/web/components/marketing/restaurant/guideProfiles.ts";
import { parseSequence } from "../../apps/web/components/marketing/restaurant/sequence.ts";
import { narrationText } from "../../apps/web/components/marketing/restaurant/narration.ts";
import { restaurantCopy } from "../../apps/web/components/marketing/restaurant/content.ts";

export function thaiNarrationEntries() {
  const texts = new Set<string>();
  const profiles: GuideProfile[] = [
    { shop: "overview", service: "dine_in", multiBranch: false },
    { shop: "restaurant", service: "counter", multiBranch: false },
    { shop: "food_beverage", service: "counter", multiBranch: false },
    { shop: "board_game_cafe", service: "dine_in", multiBranch: false },
  ];
  for (const profile of profiles) for (const flow of restaurantFlows) {
    const detail = guideFlowCopy(flow, profile, "th"), sequence = parseSequence(detail.source);
    texts.add(`${detail.title}. ${detail.description}`); texts.add(detail.note);
    // Enumerate source events, including hidden alternatives and disabled optional branches.
    for (const event of sequence.events) {
      if (event.kind === "end") continue;
      const cue = event.kind === "message" || event.kind === "note" || event.kind === "loop"
        ? event : { kind: "condition" as const, label: event.label };
      texts.add(narrationText(cue, sequence, restaurantCopy.th.player.repeatOnce));
    }
  }
  return [...texts].sort().map(text => ({ text, id: createHash("sha256").update(text).digest("hex").slice(0, 24) }));
}
