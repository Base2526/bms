export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Keep every import that reaches pg/Redis in the Node-only module. Next also compiles this
    // entry for Edge, where Node built-ins such as fs/stream/crypto do not exist.
    await import("./instrumentation.node");
  }
}
