export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startRealtimeOutboxPump } = await import("./lib/bms/realtimePump");
  startRealtimeOutboxPump();
}
