import assert from 'node:assert/strict';
import test from 'node:test';
import { meteredUsage } from '../apps/web/lib/bms/aiMetering';
import { aiAttemptReservationUsd, estimateAiCostUsd, estimateCachedAiCostUsd, hasAiCostRate, SHARED_AI_MONTHLY_BUDGET_USD } from '../apps/web/lib/bms/aiUsage';

test('numeric metering includes cached input and keeps a missing counter unknown', () => {
  const usage = meteredUsage({ input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 });
  assert.deepEqual(usage, { inputTokens: 350, outputTokens: 10, cacheReadInputTokens: 200, cacheCreationInputTokens: 50 });
  assert.equal(estimateCachedAiCostUsd({ ...usage, inputTokens: 100 }, 'claude-haiku-4-5', 'anthropic'), 0.0002325);
  assert.equal(meteredUsage({ input_tokens: 5 }).outputTokens, null);
  assert.equal(meteredUsage({ input_tokens: NaN }).inputTokens, null);
});

test('shared AI budget is 2000 USD and reservations cover the full configured model envelope', () => {
  assert.equal(SHARED_AI_MONTHLY_BUDGET_USD, 2000);
  assert.equal(aiAttemptReservationUsd('claude-haiku-4-5', 'anthropic', 1024), 1.25512);
  assert.equal(aiAttemptReservationUsd('deepseek-v4-pro', 'deepseek', 1024), 1.32405504);
  assert.equal(aiAttemptReservationUsd('future-sonnet-99', 'anthropic'), null);
  assert.equal(aiAttemptReservationUsd('claude-sonnet-99', 'anthropic'), null);
  assert.equal(aiAttemptReservationUsd('deepseek-future-pro', 'deepseek'), null);
  for (const limit of [NaN, Infinity, -1, 0, 1.5, 1_000_001]) {
    assert.equal(aiAttemptReservationUsd('claude-haiku-4-5', 'anthropic', limit), null);
  }
});

test('DeepSeek current aliases use conservative peak list rates, not expired promotional rates', () => {
  for (const model of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
    assert.equal(estimateAiCostUsd(1_000_000, 1_000_000, model, 'deepseek'), 1.5);
    assert.equal(estimateCachedAiCostUsd({ cacheReadInputTokens: 1_000_000 }, model, 'deepseek'), 0.006);
  }
  assert.equal(estimateAiCostUsd(1_000_000, 1_000_000, 'deepseek-v4-pro', 'deepseek'), 5.28);
  assert.equal(estimateCachedAiCostUsd({ cacheReadInputTokens: 1_000_000 }, 'deepseek-v4-pro', 'deepseek'), 0.044);
});

test('blank, zero and invalid OCR rates cannot silently make paid usage free; region matters', () => {
  const keys = ['QWEN_OCR_INPUT_USD_PER_MILLION', 'QWEN_OCR_OUTPUT_USD_PER_MILLION', 'QWEN_OCR_BASE_URL'];
  const saved = keys.map(k => process.env[k]);
  try {
    delete process.env.QWEN_OCR_BASE_URL;
    for (const value of ['', '  ', 'NaN', '-1', '0']) {
      process.env.QWEN_OCR_INPUT_USD_PER_MILLION = value;
      process.env.QWEN_OCR_OUTPUT_USD_PER_MILLION = value;
      assert.equal(estimateAiCostUsd(1_000_000, 1_000_000, 'qwen-vl-ocr', 'qwen'), 0.115);
    }
    process.env.QWEN_OCR_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
    assert.equal(estimateAiCostUsd(1_000_000, 1_000_000, 'qwen-vl-ocr', 'qwen'), 0.23);
    process.env.QWEN_OCR_INPUT_USD_PER_MILLION = '2';
    process.env.QWEN_OCR_OUTPUT_USD_PER_MILLION = '3';
    assert.equal(estimateAiCostUsd(1_000_000, 1_000_000, 'qwen-vl-ocr', 'qwen'), 5);
    assert.equal(hasAiCostRate('qwen-vl-ocr-2025-04-13', 'qwen'), false);
  } finally {
    keys.forEach((k, i) => { if (saved[i] == null) delete process.env[k]; else process.env[k] = saved[i]; });
  }
});
