import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { FishLateCostError, validateFishLateCost } from "../apps/web/lib/bms/fishLateCost.ts";

const valid={lineNo:1,category:"TRANSPORT",amount:"1200.50",reason:"ใบขนส่งที่ลืมลง",
  reference:"RC-1",requestKey:"late-cost-request-123456"};
const reject=(input:Record<string,unknown>,code:string)=>assert.throws(
  ()=>validateFishLateCost(input as typeof valid),
  (error:unknown)=>error instanceof FishLateCostError&&error.code===code);

test("late fish cost validates line, category, amount, reason, reference and retry key",()=>{
  assert.deepEqual(validateFishLateCost(valid),valid);
  assert.equal(validateFishLateCost({...valid,amount:"999999999999.99"}).amount,"999999999999.99");
  for (const amount of ["0","-1","1.234","1e3",".5","",1200]) reject({...valid,amount},"INVALID_AMOUNT");
  reject({...valid,lineNo:0},"INVALID_LINE");
  reject({...valid,category:"PAYMENT"},"INVALID_CATEGORY");
  reject({...valid,reason:" "},"INVALID_REASON");
  reject({...valid,reason:"x".repeat(1001)},"INVALID_REASON");
  reject({...valid,reference:"x".repeat(201)},"INVALID_REFERENCE");
  reject({...valid,requestKey:"short"},"INVALID_KEY");
});

test("late fish cost REST guards session, permission, input and trusted scope",async()=>{
  const require=createRequire(new URL("../apps/web/package.json",import.meta.url));
  const ts=require("typescript") as typeof import("typescript");
  let authStatus=401,permitted=true,serviceResult:unknown={status:"PREVIEW",previewHash:"hash"};
  const calls:unknown[][]=[];
  const mocks:Record<string,unknown>={
    "next/server":{NextResponse:{json:(body:unknown,options?:{status?:number})=>
      ({body,status:options?.status??200})}},
    "@/lib/bms/adminRouteAuth":{authorizeAdminRoute:async()=>authStatus===200
      ?{ok:true,tenantId:"trusted-tenant",adminId:"trusted-actor",ctx:{}}
      :{ok:false,status:authStatus}},
    "@/lib/bms/permissions":{requirePermission:async(_ctx:unknown,permission:string)=>{
      calls.push(["permission",permission]);if(!permitted) throw new Error("forbidden");}},
    "@/lib/bms/fishLateCost":{FishLateCostError,fishLateCost:async(...args:unknown[])=>{
      calls.push(["service",...args]);if(serviceResult instanceof Error) throw serviceResult;return serviceResult;}},
    "@/lib/log/routeError":{withRouteErrorLog:(_name:string,handler:unknown)=>handler},
  };
  const source=readFileSync(path.resolve(import.meta.dirname,"../apps/web/app/api/bms/fish-intake/[id]/late-cost/route.ts"),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{} as Record<string,any>};
  new Function("require","module","exports",compiled)((name:string)=>{
    assert.ok(name in mocks,`unexpected import ${name}`);return mocks[name];},mod,mod.exports);
  const post=mod.exports.POST as (req:Request,ctx:{params:{id:string}})=>Promise<any>;
  const ctx={params:{id:"trusted-intake"}};
  const request=(body:object)=>new Request("https://bms.example.invalid/api/bms/fish-intake/trusted-intake/late-cost",
    {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const input={...valid,tenantId:"forged-tenant",actorId:"forged-actor",locationId:"forged-branch",lotNo:"forged-lot"};
  assert.equal((await post(request({action:"preview",input}),ctx)).status,401);
  authStatus=200;permitted=false;
  assert.equal((await post(request({action:"preview",input}),ctx)).status,403);
  permitted=true;calls.length=0;
  assert.equal((await post(request({action:"wrong",input}),ctx)).status,400);
  assert.equal((await post(request({action:"preview",input}),ctx)).status,200);
  const serviceCall=calls.find(call=>call[0]==="service")!;
  assert.equal(serviceCall[1],"trusted-tenant");assert.equal(serviceCall[2],"trusted-actor");
  assert.equal(serviceCall[3],"trusted-intake");
  serviceResult={status:"SAVED",adjustmentId:"saved"};
  assert.equal((await post(request({action:"commit",input,confirmed:true,previewHash:"hash"}),ctx)).status,201);
  serviceResult={status:"REPLAYED",adjustmentId:"saved"};
  assert.equal((await post(request({action:"commit",input,confirmed:true,previewHash:"hash"}),ctx)).status,200);
  serviceResult=new FishLateCostError("PREVIEW_STALE","preview stale");
  assert.equal((await post(request({action:"commit",input,confirmed:true,previewHash:"bad"}),ctx)).status,409);
  serviceResult=new FishLateCostError("IDEMPOTENCY_CONFLICT","conflict");
  assert.equal((await post(request({action:"commit",input,confirmed:true,previewHash:"hash"}),ctx)).status,409);
});
