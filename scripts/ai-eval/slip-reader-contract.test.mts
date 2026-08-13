import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSlipExtract,
  slipAmountMatches,
  SlipReaderError,
} from "../../apps/web/lib/bms/slipReader.ts";
import { createAnthropicSlipReader } from "../../apps/web/lib/bms/slipReaders/anthropic.ts";
import { createQwenSlipReader } from "../../apps/web/lib/bms/slipReaders/qwen.ts";
import {
  DEFAULT_SLIP_READER_PROVIDER,
  getSlipReader,
  runSlipReaderFallback,
} from "../../apps/web/lib/bms/slipReaders/index.ts";
import { estimateAiCostUsd } from "../../apps/web/lib/bms/aiUsage.ts";

const REQUEST = {
  base64: "ZmFrZS1zbGlw",
  mediaType: "image/jpeg",
  credentials: { apiKey: "test-key-never-sent", model: "test-model" },
};

function anthropicResponse(
  text: string,
  usage: { input_tokens?: unknown; output_tokens?: unknown } = {}
) {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text }],
      usage,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function qwenResponse(
  text: string,
  usage: { prompt_tokens?: unknown; completion_tokens?: unknown } = {}
) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage,
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

test("slip parser accepts the exact contract and normalizes bounded text", () => {
  assert.deepEqual(
    parseSlipExtract(
      '```json\n{"amount":1250.5,"date":" 2026-07-29 ","ref":" ABC-123 ","bank":" KBank "}\n```'
    ),
    {
      amount: 1250.5,
      date: "2026-07-29",
      ref: "ABC-123",
      bank: "KBank",
    }
  );
});

test("default SlipReader is selected through the provider-neutral registry", () => {
  const reader = getSlipReader();
  assert.equal(DEFAULT_SLIP_READER_PROVIDER, "qwen");
  assert.equal(reader.provider, DEFAULT_SLIP_READER_PROVIDER);
});

test("slip parser accepts null when a fact cannot be read", () => {
  assert.deepEqual(
    parseSlipExtract('{"amount":null,"date":null,"ref":null,"bank":null}'),
    { amount: null, date: null, ref: null, bank: null }
  );
});

test("slip parser rejects malformed JSON, unknown fields, and missing fields", () => {
  const invalid = [
    "not-json",
    '{"amount":100,"date":null,"ref":null,"bank":null,"verified":true}',
    '{"amount":100,"date":null,"ref":null}',
  ];
  for (const value of invalid) {
    assert.throws(
      () => parseSlipExtract(value),
      (error) => error instanceof SlipReaderError && error.code === "MALFORMED_OUTPUT"
    );
  }
});

test("slip parser rejects invalid amounts and unbounded text", () => {
  const invalid = [
    '{"amount":"100.00","date":null,"ref":null,"bank":null}',
    '{"amount":-1,"date":null,"ref":null,"bank":null}',
    `{"amount":100,"date":null,"ref":"${"x".repeat(257)}","bank":null}`,
  ];
  for (const value of invalid) {
    assert.throws(
      () => parseSlipExtract(value),
      (error) => error instanceof SlipReaderError && error.code === "MALFORMED_OUTPUT"
    );
  }
});

test("amount comparison is exact to satang tolerance and rejects invalid expectations", () => {
  assert.equal(slipAmountMatches(100, 100), true);
  assert.equal(slipAmountMatches(100.009, 100), true);
  assert.equal(slipAmountMatches(100.01, 100), false);
  assert.equal(slipAmountMatches(null, 100), false);
  assert.equal(slipAmountMatches(100, Number.NaN), false);
});

test("Anthropic adapter returns provider metadata and normalized token usage", async () => {
  let requestBody: any;
  const reader = createAnthropicSlipReader({
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return anthropicResponse(
        '{"amount":250,"date":"2026-07-29","ref":"REF-1","bank":"SCB"}',
        { input_tokens: 10.8, output_tokens: "4" }
      );
    },
  });

  const result = await reader.read(REQUEST);
  assert.equal(reader.provider, "anthropic");
  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "test-model");
  assert.equal(result.extracted.amount, 250);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 4 });
  assert.equal(requestBody.messages[0].content[0].source.data, REQUEST.base64);
});

test("OCR adapters preserve missing usage as unpriced instead of zero-cost", async () => {
  const anthropic = createAnthropicSlipReader({
    fetchImpl: async () =>
      anthropicResponse('{"amount":100,"date":null,"ref":null,"bank":null}'),
  });
  const qwen = createQwenSlipReader({
    fetchImpl: async () =>
      qwenResponse('{"amount":100,"date":null,"ref":null,"bank":null}'),
  });

  assert.deepEqual((await anthropic.read(REQUEST)).usage, {
    inputTokens: null,
    outputTokens: null,
  });
  assert.deepEqual((await qwen.read(REQUEST)).usage, {
    inputTokens: null,
    outputTokens: null,
  });
});

test("Anthropic adapter rejects unsupported images before contacting provider", async () => {
  let calls = 0;
  const reader = createAnthropicSlipReader({
    fetchImpl: async () => {
      calls += 1;
      return anthropicResponse('{"amount":null,"date":null,"ref":null,"bank":null}');
    },
  });

  await assert.rejects(
    reader.read({ ...REQUEST, mediaType: "image/heic" }),
    (error) => error instanceof SlipReaderError && error.code === "INVALID_INPUT"
  );
  assert.equal(calls, 0);
});

test("Anthropic adapter fails safely on provider error without exposing response content", async () => {
  const reader = createAnthropicSlipReader({
    fetchImpl: async () =>
      new Response("customer-sensitive-provider-body", { status: 429 }),
  });

  await assert.rejects(
    reader.read(REQUEST),
    (error) =>
      error instanceof SlipReaderError &&
      error.code === "PROVIDER_ERROR" &&
      !error.message.includes("customer-sensitive")
  );
});

test("Anthropic adapter aborts a bounded request", async () => {
  const reader = createAnthropicSlipReader({
    timeoutMs: 5,
    fetchImpl: ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })) as typeof fetch,
  });

  await assert.rejects(
    reader.read(REQUEST),
    (error) => error instanceof SlipReaderError && error.code === "PROVIDER_TIMEOUT"
  );
});

test("Qwen adapter sends a data URL and normalizes usage fields", async () => {
  let requestBody: any;
  const reader = createQwenSlipReader({
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return qwenResponse(
        '{"amount":520,"date":"2026-07-29","ref":"TXN-52","bank":"BBL"}',
        { prompt_tokens: "18", completion_tokens: 6.2 }
      );
    },
  });

  const result = await reader.read({
    ...REQUEST,
    credentials: {
      ...REQUEST.credentials,
      baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
    },
  });

  assert.equal(reader.provider, "qwen");
  assert.equal(result.provider, "qwen");
  assert.equal(result.extracted.amount, 520);
  assert.deepEqual(result.usage, { inputTokens: 18, outputTokens: 6 });
  assert.match(
    requestBody.messages[0].content[1].image_url.url,
    /^data:image\/jpeg;base64,/
  );
});

test("runtime OCR failure retries the fallback provider lazily and finalizes both attempts", async () => {
  const resolved: string[] = [];
  const finalized: Array<{ id: string; status: string }> = [];
  const sessions: any[] = [
    {
      provider: "qwen",
      source: "shared",
      usageEventId: "usage-qwen",
      credentials: REQUEST.credentials,
      reader: {
        provider: "qwen",
        read: async () => {
          throw new SlipReaderError("PROVIDER_TIMEOUT", "qwen timeout");
        },
      },
    },
    {
      provider: "anthropic",
      source: "shared",
      usageEventId: "usage-anthropic",
      credentials: REQUEST.credentials,
      reader: {
        provider: "anthropic",
        read: async () => ({
          provider: "anthropic",
          model: "test-model",
          extracted: { amount: 999, date: null, ref: null, bank: null },
          usage: { inputTokens: 12, outputTokens: 3 },
        }),
      },
    },
  ];

  const outcome = await runSlipReaderFallback({
    resolveNext: async (excluded, fallbackFrom, chargeSharedCredit) => {
      resolved.push(`${excluded.join(",")}|${fallbackFrom ?? "-"}|${chargeSharedCredit}`);
      return sessions[excluded.length] ?? null;
    },
    loadImage: async () => ({
      base64: REQUEST.base64,
      mediaType: REQUEST.mediaType,
    }),
    recordProviderAttempt: async () => {},
    finalize: async (id, result) => {
      finalized.push({ id, status: result.status });
    },
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.result.provider, "anthropic");
  assert.deepEqual(outcome.attemptedProviders, ["qwen", "anthropic"]);
  assert.deepEqual(resolved, ["|-|true", "qwen|qwen|false"]);
  assert.deepEqual(finalized, [
    { id: "usage-qwen", status: "failed" },
    { id: "usage-anthropic", status: "completed" },
  ]);
});

test("Qwen OCR cost uses provider-specific rates instead of Anthropic defaults", () => {
  const previousInput = process.env.QWEN_OCR_INPUT_USD_PER_MILLION;
  const previousOutput = process.env.QWEN_OCR_OUTPUT_USD_PER_MILLION;
  process.env.QWEN_OCR_INPUT_USD_PER_MILLION = "0.043";
  process.env.QWEN_OCR_OUTPUT_USD_PER_MILLION = "0.072";
  try {
    assert.equal(estimateAiCostUsd(1_000_000, 1_000_000, "qwen-vl-ocr", "qwen"), 0.115);
  } finally {
    if (previousInput === undefined) delete process.env.QWEN_OCR_INPUT_USD_PER_MILLION;
    else process.env.QWEN_OCR_INPUT_USD_PER_MILLION = previousInput;
    if (previousOutput === undefined) delete process.env.QWEN_OCR_OUTPUT_USD_PER_MILLION;
    else process.env.QWEN_OCR_OUTPUT_USD_PER_MILLION = previousOutput;
  }
});
