export type LocalBackupState = "passed" | "failed" | "stale" | "not_configured" | "unknown";
export function localBackupView(raw: unknown, now = Date.now()): { status: LocalBackupState; at: string | null } {
  const unknown = { status: "unknown" as const, at: null };
  if (!raw || typeof raw !== "object") return unknown;
  const v = raw as Record<string, unknown>;
  const heartbeat = typeof v.heartbeat === "string" ? Date.parse(v.heartbeat) : NaN;
  if (v.available !== true || !Number.isFinite(heartbeat) || Math.abs(now - heartbeat) > 180_000) return unknown;
  if (!v.backup || typeof v.backup !== "object") return unknown;
  const b = v.backup as Record<string, unknown>;
  if (b.status === "not_configured") return { status: "not_configured", at: null };
  const at = typeof b.at === "string" ? Date.parse(b.at) : NaN;
  if (!Number.isFinite(at) || at > now + 60_000) return unknown;
  if (b.status === "failed") return { status: "failed", at: new Date(at).toISOString() };
  if (b.status !== "passed") return unknown;
  return { status: now - at > 7 * 86400_000 ? "stale" : "passed", at: new Date(at).toISOString() };
}
