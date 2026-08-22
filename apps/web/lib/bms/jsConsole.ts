// =============================================================
// BMS Dev JavaScript Console — platform admin + non-production only
// -------------------------------------------------------------
// User code never runs through eval() in the Next.js process. It runs inside a
// resource-limited worker and a vm context with no process, require, timers,
// network, database, or application modules exposed.
//
// Node's vm is not a general security boundary. The production hard-disable,
// fresh DB-backed platform-admin check in the resolver, worker isolation,
// resource limits, timeout, and audit log are all required layers.
// =============================================================

import { Worker } from "node:worker_threads";

export type JsConsoleLog = {
  level: "log" | "info" | "warn" | "error";
  text: string;
};

export type JsConsoleResult = {
  ok: boolean;
  logs: JsConsoleLog[];
  result: string | null;
  durationMs: number;
  error: string | null;
};

const MAX_CODE_LENGTH = 10_000;
const EXECUTION_TIMEOUT_MS = 1_000;
const WORKER_TIMEOUT_MS = 1_500;
const MAX_LOG_ENTRIES = 200;

const SANDBOX_BOOTSTRAP_SOURCE = String.raw`
(() => {
  const entries = [];
  const maxEntries = __MAX_LOG_ENTRIES__;
  const format = (value) => {
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "undefined") return "undefined";
    if (typeof value === "bigint") return String(value) + "n";
    if (typeof value === "symbol") return String(value);
    if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
    try {
      const seen = new WeakSet();
      return JSON.stringify(value, (_key, current) => {
        if (typeof current === "bigint") return String(current) + "n";
        if (typeof current === "symbol") return String(current);
        if (typeof current === "function") return "[Function " + (current.name || "anonymous") + "]";
        if (current && typeof current === "object") {
          if (seen.has(current)) return "[Circular]";
          seen.add(current);
        }
        return current;
      }, 2);
    } catch {
      try { return String(value); } catch { return "[Unprintable]"; }
    }
  };
  const capture = (level, values) => {
    if (entries.length >= maxEntries) return;
    entries.push({ level, text: values.map(format).join(" ") });
  };
  Object.defineProperty(globalThis, "console", {
    value: Object.freeze({
      log: (...values) => capture("log", values),
      info: (...values) => capture("info", values),
      warn: (...values) => capture("warn", values),
      error: (...values) => capture("error", values),
      dir: (...values) => capture("log", values),
      table: (...values) => capture("log", values),
    }),
    enumerable: true,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(globalThis, "__bmsReadConsoleLogs", {
    value: () => entries.map((entry) => ({ level: entry.level, text: entry.text })),
    enumerable: false,
    configurable: false,
    writable: false,
  });
})();
`;

const WORKER_SOURCE = String.raw`
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { inspect } = require("node:util");
const vm = require("node:vm");

const format = (value) => inspect(value, {
  depth: 6,
  maxArrayLength: 100,
  maxStringLength: 10000,
  breakLength: 120,
  compact: 3,
  customInspect: false,
  getters: false,
});
const sandbox = Object.create(null);
let context;
let logs = [];

try {
  context = vm.createContext(sandbox, {
    name: "bms-dev-js-console",
    codeGeneration: { strings: false, wasm: false },
  });
  // Create console and its formatter inside the context. Passing even one host
  // function into a vm context would expose that function's outer constructor
  // and allow an escape to process/require.
  const bootstrap = new vm.Script(
    ${JSON.stringify(SANDBOX_BOOTSTRAP_SOURCE)}.replace(
      "__MAX_LOG_ENTRIES__",
      String(Number(workerData.maxLogEntries))
    ),
    { filename: "bms-dev-console-bootstrap.js" }
  );
  bootstrap.runInContext(context, {
    timeout: workerData.executionTimeoutMs,
    displayErrors: true,
  });
  const script = new vm.Script('"use strict";\n' + workerData.code, {
    filename: "bms-dev-console.js",
    displayErrors: true,
  });
  const value = script.runInContext(context, {
    timeout: workerData.executionTimeoutMs,
    displayErrors: true,
    breakOnSigint: true,
  });
  if (value && typeof value.then === "function") {
    throw new Error("ไม่รองรับ Promise/async ใน console นี้ ให้ทดสอบฟังก์ชันแบบ synchronous เท่านั้น");
  }
  logs = new vm.Script("__bmsReadConsoleLogs()", {
    filename: "bms-dev-console-output.js",
  }).runInContext(context, {
    timeout: workerData.executionTimeoutMs,
    displayErrors: true,
  });
  parentPort.postMessage({
    ok: true,
    logs,
    result: value === undefined ? null : format(value),
    error: null,
  });
} catch (error) {
  if (context) {
    try {
      logs = new vm.Script("__bmsReadConsoleLogs()").runInContext(context, {
        timeout: workerData.executionTimeoutMs,
        displayErrors: true,
      });
    } catch {}
  }
  parentPort.postMessage({
    ok: false,
    logs,
    result: null,
    error: error && error.message ? String(error.message) : "JavaScript execution failed",
  });
}
`;

/** JavaScript console is intentionally impossible to enable in production. */
export function jsConsoleEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export async function runSandboxedJs(codeRaw: string): Promise<JsConsoleResult> {
  const start = Date.now();
  const code = String(codeRaw || "").trim();

  if (!jsConsoleEnabled()) {
    return {
      ok: false,
      logs: [],
      result: null,
      durationMs: 0,
      error: "JavaScript Console ปิดใช้งานเมื่อ NODE_ENV=production เสมอ",
    };
  }
  if (!code) {
    return {
      ok: false,
      logs: [],
      result: null,
      durationMs: Date.now() - start,
      error: "กรุณาใส่ JavaScript ที่ต้องการทดสอบ",
    };
  }
  if (code.length > MAX_CODE_LENGTH) {
    return {
      ok: false,
      logs: [],
      result: null,
      durationMs: Date.now() - start,
      error: `JavaScript ยาวเกิน ${MAX_CODE_LENGTH.toLocaleString()} ตัวอักษร`,
    };
  }

  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (result: Omit<JsConsoleResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve({ ...result, durationMs: Date.now() - start });
    };

    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: {
          code,
          executionTimeoutMs: EXECUTION_TIMEOUT_MS,
          maxLogEntries: MAX_LOG_ENTRIES,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: 32,
          maxYoungGenerationSizeMb: 8,
          stackSizeMb: 2,
        },
      });
    } catch (error: any) {
      resolve({
        ok: false,
        logs: [],
        result: null,
        durationMs: Date.now() - start,
        error: error?.message || "ไม่สามารถเริ่ม JavaScript worker ได้",
      });
      return;
    }

    timer = setTimeout(() => {
      finish({
        ok: false,
        logs: [],
        result: null,
        error: `หยุดการทำงานเพราะเกิน ${EXECUTION_TIMEOUT_MS.toLocaleString()} ms`,
      });
    }, WORKER_TIMEOUT_MS);

    worker.once("message", (message: Omit<JsConsoleResult, "durationMs">) => {
      finish({
        ok: message?.ok === true,
        logs: Array.isArray(message?.logs) ? message.logs.slice(0, MAX_LOG_ENTRIES) : [],
        result: typeof message?.result === "string" ? message.result : null,
        error: typeof message?.error === "string" ? message.error : null,
      });
    });
    worker.once("error", (error) => {
      finish({
        ok: false,
        logs: [],
        result: null,
        error: error.message || "JavaScript worker failed",
      });
    });
    worker.once("exit", (code) => {
      if (!settled) {
        finish({
          ok: false,
          logs: [],
          result: null,
          error: code === 0 ? "JavaScript worker จบโดยไม่มีผลลัพธ์" : `JavaScript worker หยุดด้วย code ${code}`,
        });
      }
    });
  });
}
