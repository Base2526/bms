import "server-only";

import type { LogLevel, LogMeta } from "./types";
import { writeLogServer } from "./writeLog.server";

export type { LogLevel, LogMeta } from "./types";

/**
 * Server-only logging helper.
 * Keeps server logging behavior (DB insert + dev console + Slack alerting).
 */
export async function addLog(
  level: LogLevel,
  category: string,
  message: string,
  meta: LogMeta = {}
) {
  return writeLogServer(level, category, message, meta);
}
