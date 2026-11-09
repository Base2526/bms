const QUEUE_BOARD_SOUND_PREFIX = "bms.pos.queueBoardSound.";

export function queueBoardSoundStorageKey(namespace: string): string {
  return QUEUE_BOARD_SOUND_PREFIX + namespace;
}

/** Sound is on for a new till. Only an explicit saved `0` mutes the customer call screen. */
export function readQueueBoardSoundEnabled(namespace: string): boolean {
  if (!namespace || typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(queueBoardSoundStorageKey(namespace)) !== "0";
  } catch {
    return true;
  }
}

export function writeQueueBoardSoundEnabled(namespace: string, enabled: boolean): void {
  if (!namespace || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(queueBoardSoundStorageKey(namespace), enabled ? "1" : "0");
  } catch {
    // Blocked storage keeps the safe operational default: sound on.
  }
}
