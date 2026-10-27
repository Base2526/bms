import type { PlaybackCue } from "./playback";
import type { Sequence } from "./sequence";

/** Shared by the player and offline asset builder; a text edit requires a new audio asset. */
export function narrationText(cue: Pick<PlaybackCue, "kind" | "label" | "from">, sequence: Sequence, repeatOnce: string) {
  return cue.kind === "message"
    ? `${sequence.participants.find(person => person.id === cue.from)?.label ?? ""}. ${cue.label}`
    : cue.kind === "loop" ? `${repeatOnce}. ${cue.label}` : cue.label;
}
