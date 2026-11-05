import assert from "node:assert/strict";
import test from "node:test";
import {
  adminUrlForServer,
  cloudAdminUrl,
  assertPairingServerResponse,
  canRecoverByStartingManagedLocalRuntime,
  PairingServerResponseError,
  fetchPairingSession,
} from "../src/pairing-server.mjs";

test("admin URL follows the paired server origin without carrying POS credentials", () => {
  assert.equal(adminUrlForServer("http://127.0.0.1:3100"), "http://127.0.0.1:3100/admin/login");
  assert.equal(adminUrlForServer("https://shop.example.com"), "https://shop.example.com/admin/login");
  assert.doesNotMatch(adminUrlForServer("https://shop.example.com"), /token|pos_/i);
});

test("pairing server probe accepts only successful HTTP responses", () => {
  assert.doesNotThrow(() => assertPairingServerResponse({ ok: true, status: 200 }));
  assert.throws(
    () => assertPairingServerResponse({ ok: false, status: 502 }),
    (error) => error instanceof PairingServerResponseError
      && error.status === 502
      && error.userMessage.includes("HTTP 502"),
  );
});

test("pairing server probe gives actionable authentication errors", () => {
  assert.throws(
    () => assertPairingServerResponse({ ok: false, status: 401 }),
    (error) => error.userMessage.includes("HTTP 401")
      && error.userMessage.includes("ออก token ใหม่")
      && !error.userMessage.includes("หมดอายุ"),
  );
  assert.throws(
    () => assertPairingServerResponse({ ok: false, status: 403 }),
    (error) => error.userMessage.includes("ไม่มีสิทธิ์")
      && error.userMessage.includes("HTTP 403")
      && !error.userMessage.includes("จับคู่เครื่องใหม่"),
  );
});

test("managed local runtime retries transport and server failures, not rejected credentials", () => {
  assert.equal(canRecoverByStartingManagedLocalRuntime(new Error("offline")), true);
  assert.equal(
    canRecoverByStartingManagedLocalRuntime(new PairingServerResponseError(503, "unavailable")),
    true,
  );
  assert.equal(
    canRecoverByStartingManagedLocalRuntime(new PairingServerResponseError(401, "unauthorized")),
    false,
  );
});

test("POS-only setup sends people to the cloud BMS login", () => {
  assert.equal(cloudAdminUrl(), "https://bms.jachoei.com/admin/login");
});

const pairing = {serverUrl:"https://shop.example.com",token:"FAKE-device-token"};
test("pairing checks the authenticated session body without following a redirect", async () => {
  const session={device:{id:"device",code:"POS-01"}};
  assert.deepEqual(await fetchPairingSession(pairing,async(url,options)=>{
    assert.equal(url.toString(),"https://shop.example.com/api/pos/session");
    assert.equal(options.headers["x-pos-device-token"],pairing.token);
    assert.equal(options.redirect,"manual");
    return {ok:true,status:200,json:async()=>session};
  }),session);
});
for(const body of [null,{}, {device:{id:"device"}}, {device:{id:"",code:"POS-01"}}]) {
  test(`HTTP 200 with an invalid session is not successful pairing: ${JSON.stringify(body)}`,async()=>{
    await assert.rejects(fetchPairingSession(pairing,async()=>({ok:true,status:200,json:async()=>body})),
      error=>error instanceof PairingServerResponseError && !canRecoverByStartingManagedLocalRuntime(error));
  });
}
test("HTML and redirected sign-in pages cannot be saved as pairing",async()=>{
  await assert.rejects(fetchPairingSession(pairing,async()=>({ok:true,status:200,json:async()=>{throw Error('HTML');}})),/HTTP 200/);
  await assert.rejects(fetchPairingSession(pairing,async()=>({ok:false,status:302})),/HTTP 302/);
});
for(const phase of ['headers','body']) test(`pairing times out and aborts a hanging ${phase} read`,async()=>{
  let signal;
  const result=fetchPairingSession(pairing,async(_url,options)=>{
    signal=options.signal;
    if(phase==='headers')return new Promise(()=>{});
    return {ok:true,status:200,json:()=>new Promise(()=>{})};
  },10);
  await assert.rejects(result,error=>error.userMessage.includes('ไม่ตอบภายในเวลาที่กำหนด'));
  assert.equal(signal.aborted,true);
});
