import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");

export function loadWithStubs(file: string, modules: Record<string, unknown>, fetchStub?: Function) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", "console", "fetch", compiled)(
    (name: string) => { assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name]; },
    exports,
    { error() {}, warn() {} },
    fetchStub ?? (() => { throw new Error("Unexpected network request"); })
  );
  return exports;
}

export function webhookHarness(channel: "line" | "facebook" | "instagram", options: {
  claim?: Function;
  pipeline?: Function;
  deliver?: Function;
  fetch?: Function;
  signatureValid?: boolean;
  secret?: string | null;
} = {}) {
  const calls = { claims: [] as any[][], pipeline: [] as any[][], logs: [] as any[][],
    deliveries: [] as any[][], incidents: [] as any[], health: [] as any[][], profiles: 0 };
  const noop = async () => {};
  const route = loadWithStubs(`apps/web/app/api/bms/${channel}/webhook/[tenantId]/route.ts`, {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status: number }) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
    "@/lib/bms/channels": { getChannel: async () => ({ active: true, channel_secret: options.secret === undefined ? "FAKE-secret" : options.secret, access_token: "FAKE-token" }) },
    "@/lib/bms/crypto": { verifyLineSignature: () => options.signatureValid !== false, verifyMetaSignature: () => options.signatureValid !== false },
    "@/lib/bms/inboundEvents": { claimInboundEvent: async (...args: any[]) => { calls.claims.push(args); return options.claim ? options.claim(...args) : true; } },
    "@/lib/bms/pipeline": { runPipeline: async (...args: any[]) => { calls.pipeline.push(args); return options.pipeline ? options.pipeline(...args) : { reply: `reply:${args[0]}` }; } },
    "@/lib/bms/customerAnswerEvidence": { fallbackEvidenceQuality: () => ({ outcome: "FAILURE", reasonCodes: ["PIPELINE_EXCEPTION"], successfulToolCalls: 0, failedToolCalls: 0 }) },
    "@/lib/bms/inbox": {
      logConversation: async (...args: any[]) => { calls.logs.push(args); },
      logInboundMessage: noop,
      notifyInboxConversationChanged() {},
      deliverToChannel: async (...args: any[]) => { calls.deliveries.push(args); return options.deliver ? options.deliver(...args) : true; },
    },
    "@/lib/bms/channelHealth": {
      recordInboundEvent: async (...args: any[]) => { calls.health.push(args); },
      recordWebhookVerifyFailed: noop, recordOutboundSuccess: noop, recordOutboundError: noop,
      formatOutboundErrorDetail: () => "FAKE-delivery-error",
    },
    "@/lib/bms/failureAlert": { reportBmsFailure: async (incident: any) => { calls.incidents.push(incident); } },
    // Leave errors visible to assert.rejects; production wraps these in a non-200 response.
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    "@/lib/bms/meta": { metaChallenge: () => null, parseMetaEvents: (body: any) => body.events },
    "@/lib/storage": {},
    "@/lib/bms/lineProfile": {
      syncLineUserProfile: async () => { calls.profiles++; return { ok: true, conversationIds: [] }; },
      syncLineBotInfo: async () => ({ ok: true }),
    },
  }, async (...args: any[]) => {
    calls.deliveries.push(args);
    return options.fetch ? options.fetch(...args) : { ok: true };
  });
  const event = (text: string, id = "FAKE-event") => channel === "line"
    ? { type: "message", message: { id, type: "text", text }, replyToken: `FAKE-reply-${id}`, source: { userId: "FAKE-customer" } }
    : { text, eventId: id, senderId: "FAKE-customer", attachments: [] };
  const post = (events = [event("hello")], readBody = async () => JSON.stringify({ events })) => route.POST(
    { headers: new Headers(), text: readBody }, { params: { tenantId: "FAKE-tenant" } }
  );
  return { calls, event, post };
}
