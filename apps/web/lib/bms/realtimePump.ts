import { dispatchRealtimeOutboxBatch } from "./realtimeDispatcher";

type PumpState = { timer?: ReturnType<typeof setTimeout>; stopping: boolean; running: boolean };

const globalPump = globalThis as typeof globalThis & { __bmsRealtimePump?: PumpState };

function intervalMs(): number {
  const parsed = Number(process.env.REALTIME_OUTBOX_POLL_MS ?? "250");
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 60_000) {
    throw new Error("REALTIME_OUTBOX_POLL_MS must be an integer between 100 and 60000");
  }
  return parsed;
}

async function tick(state: PumpState, delay: number) {
  state.timer = setTimeout(async () => {
    if (state.stopping || state.running) return;
    state.running = true;
    let nextDelay = delay;
    try {
      const result = await dispatchRealtimeOutboxBatch();
      nextDelay = result.claimed > 0 ? 0 : intervalMs();
    } catch (error) {
      nextDelay = Math.min(30_000, Math.max(intervalMs(), delay * 2 || intervalMs()));
      console.error("[realtime-outbox] dispatcher iteration failed", {
        errorCode: "DISPATCH_ITERATION_FAILED",
        retryInMs: nextDelay,
      });
    } finally {
      state.running = false;
      if (!state.stopping) tick(state, nextDelay);
    }
  }, Math.max(0, delay));
  state.timer.unref();
}

export function startRealtimeOutboxPump(): void {
  if (process.env.REALTIME_OUTBOX_DISPATCH_ENABLED !== "1") return;
  if (globalPump.__bmsRealtimePump && !globalPump.__bmsRealtimePump.stopping) return;
  const state: PumpState = { stopping: false, running: false };
  globalPump.__bmsRealtimePump = state;
  tick(state, 0);
}

export function stopRealtimeOutboxPump(): void {
  const state = globalPump.__bmsRealtimePump;
  if (!state) return;
  state.stopping = true;
  if (state.timer) clearTimeout(state.timer);
}

