import assert from "node:assert/strict";
import test from "node:test";
import { runSignupRequest, SignupRequestTimeout } from "../apps/web/lib/auth/signupRequest.ts";

test("a stalled signup stops waiting and aborts without retrying", async () => {
  let attempts = 0;
  let signal: AbortSignal;
  await assert.rejects(runSignupRequest((s) => {
    signal = s;
    attempts++;
    return new Promise(() => {});
  }, 10), SignupRequestTimeout);
  assert.equal(signal!.aborted, true);
  assert.equal(attempts, 1);
});

test("an abort rejection still reports an unknown outcome timeout", async () => {
  await assert.rejects(runSignupRequest((signal) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("network aborted")));
  }), 10), SignupRequestTimeout);
});

test("completed signup preserves its result and clears its deadline", async () => {
  let signal: AbortSignal;
  const result = { status: "PENDING_VERIFICATION" };
  assert.equal(await runSignupRequest(async (s) => {
    signal = s;
    return result;
  }, 10), result);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signal!.aborted, false);
});

test("provider failure propagates and a later attempt starts independently", async () => {
  const failure = new Error("provider unavailable");
  await assert.rejects(runSignupRequest(async () => { throw failure; }), (err) => err === failure);
  assert.equal(await runSignupRequest(async (s) => !s.aborted), true);
});
