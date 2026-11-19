import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import test from "node:test";

const root=path.resolve(import.meta.dirname,"..");
const require=createRequire(new URL("../apps/web/package.json",import.meta.url));
const ts=require("typescript") as typeof import("typescript");

test("weighed price route enforces server permission, tenant and confirmation",async()=>{
  const calls:unknown[][]=[];
  let authorized=false;
  const mocks:Record<string,unknown>={
    "next/server":{NextResponse:{json:(body:unknown,options?:{status?:number})=>
      ({body,status:options?.status??200})}},
    "@/lib/bms/adminRouteAuth":{authorizeAdminRoute:async(permission:string)=>{
      calls.push(["auth",permission]);return authorized
        ?{ok:true,tenantId:"trusted-tenant",adminId:"trusted-staff"}
        :{ok:false,status:403};}},
    "@/lib/bms/weightedKgPricing":{
      currentWeightedKgRate:async()=>null,
      publishWeightedKgRate:async(...args:unknown[])=>{calls.push(["publish",...args]);
        return {status:"PUBLISHED",revisionNo:1,rateBahtPerKg:"23.45"};}},
    "@/lib/db":{query:async()=>({rows:[]})},
    "@/lib/log/routeError":{withRouteErrorLog:(_name:string,handler:unknown)=>handler},
  };
  const source=readFileSync(path.join(root,"apps/web/app/api/bms/weighted-kg-price/[sku]/route.ts"),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{} as Record<string,any>};
  new Function("require","module","exports",compiled)((name:string)=>{
    assert.ok(name in mocks,`unexpected import ${name}`);return mocks[name];
  },module,module.exports);
  const post=module.exports.POST as (req:Request,ctx:{params:{sku:string}})=>Promise<any>;
  const ctx={params:{sku:"SAND"}};
  const request=(confirmed:boolean)=>new Request("https://bms.example.invalid/api/bms/weighted-kg-price/SAND",
    {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      tenantId:"forged",size:"STD",rateBahtPerKg:"23.45",requestKey:"request-123",confirmed})});
  assert.equal((await post(request(true),ctx)).status,403);
  assert.deepEqual(calls,[["auth","product.weighted_price.publish"]]);
  authorized=true;calls.length=0;
  const result=await post(request(true),ctx);
  assert.equal(result.status,200);
  assert.deepEqual(calls[0],["auth","product.weighted_price.publish"]);
  assert.equal(calls[1]?.[0],"publish");
  assert.equal(calls[1]?.[1],"trusted-tenant");
  assert.equal(calls[1]?.[2],"trusted-staff");
  assert.deepEqual(calls[1]?.[3],{sku:"SAND",size:"STD",rateBahtPerKg:"23.45",
    requestKey:"request-123",confirmed:true});
});
