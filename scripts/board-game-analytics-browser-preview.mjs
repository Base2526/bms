// Local fixture preview of the REAL component/CSS. No login, DB, network APIs or writes.
// Run: node scripts/board-game-analytics-browser-preview.mjs
// Inspect http://127.0.0.1:3108/?width=390 and ?width=1280 manually.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
const web = fileURLToPath(new URL("../apps/web/", import.meta.url));
const require = createRequire(path.join(web, "package.json"));
const { build } = require("esbuild");
const mockApollo = `
import { useMemo, useState } from 'react';
export const gql = (strings) => strings.join('');
const metric = { tableId:'table', code:'A1', name:'โต๊ะตัวอย่าง', areaName:'พื้นที่ A', locationName:'สาขาตัวอย่าง', seats:4,
 availableTableHours:12, occupiedTableHours:3, utilizationPct:25, revenue:'450.00', revPATH:'37.50', netPlay:'300.00', tabRevenue:'150.00', tabCost:null, tabGrossProfit:null };
const report = { timezone:'Asia/Bangkok', complete:true, truncated:false,
 issues:[{code:'COST_HIDDEN',message:'',count:1}], dataQuality:{backfilledBefore:null,hoursConfigured:true,tablesWithoutHours:0},
 totals:{...metric, sessions:2,paidSessions:1,cancelledSessions:0,guests:4,avgPlayMinutes:90,seatUtilizationPct:12.5,turnoverPerTablePerDay:1,
 grossPlay:'400.00',offerDiscount:'50.00',passCoverage:'50.00',playReturns:'0.00',passSalesRevenue:'500.00',passMinutesUsed:60,depositsForfeited:'0.00',
 waitlist:{entries:5,seated:4,avgWaitMinutes:10,noShow:1,cancelled:0,noShowRatePct:20}},
 byTable:[metric],byArea:[{...metric,areaId:'area',locationId:'branch',name:'พื้นที่ A'}],
 heatmap:Array.from({length:7*12},(_,i)=>({weekday:Math.floor(i/12),hour:10+i%12,occupiedTableHours:1,availableTableHours:4,utilizationPct:i%4*25,revenue:'100.00'})),
 topOffers:[{offerId:'offer',name:'ตัวอย่างโปรโมชั่น',uses:2,discount:'50.00'}],
 library:{titlesPlayed:[{titleId:'title',name:'เกมตัวอย่าง',plays:2,minutes:90}],copiesNeedingAttention:1,purchaseCostTotal:null}};
export function useLazyQuery() {
 const [loading,setLoading]=useState(false);
 return [async ({variables})=>{setLoading(true); await new Promise(r=>setTimeout(r,100));setLoading(false);return {data:{bmsBoardGameAnalytics:{status:'OK',report:{...report,range:variables.input}}}};},{loading,error:null}];
}
export function useQuery(_query,{variables,skip}) {
 const data=useMemo(()=>skip?undefined:{bmsBoardGameBranchHours:{status:'OK',hours:Array.from({length:7},(_,weekday)=>({weekday,opensAt:'10:00:00',closesAt:'22:00:00',closed:false,effectiveFrom:'2026-01-01'}))}},[variables.locationId,skip]);
 return {data,loading:false,error:null,refetch:async()=>({data})};
}
export function useMutation(query) {
 return [async({variables})=>{
  if(query.includes('Export')) { document.getElementById('fixture-event').textContent='Fixture export: '+JSON.stringify(variables.input);return {data:{bmsGenerateReport:{fileUrl:null}}}; }
  document.getElementById('fixture-event').textContent='Fixture save: '+JSON.stringify(variables.input);
  return {data:{bmsUpsertBoardGameBranchHours:{status:'OK',...variables.input}}};
 },{loading:false}];
}`;
const entry = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import Panel from './app/(admin)/admin/board-game/BoardGameAnalyticsPanel';
import {I18nProvider} from './lib/i18nContext'; import 'antd/dist/reset.css';
createRoot(document.getElementById('app')).render(<I18nProvider lang="th"><Panel
 locations={[{id:'branch',name:'สาขาตัวอย่าง'}]} currentLocationId="branch"
 areas={[{id:'area',name:'พื้นที่ตัวอย่าง'}]} canManageFloor={true}/></I18nProvider>);`;
const result = await build({ stdin: { contents: entry, resolveDir: web, loader: "tsx" }, absWorkingDir: web,
 bundle: true, write: false, outdir: "fixture", format: "iife", jsx: "automatic",
 define: { "process.env.NODE_ENV": '"development"' },
 plugins: [{ name: "fixture-only-apollo", setup(builder) {
   builder.onResolve({ filter: /^@apollo\/client$/ }, () => ({ path: "mock", namespace: "fixture" }));
   builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: mockApollo, loader: "js", resolveDir: web }));
 } }],
});
const js = result.outputFiles.find((file) => file.path.endsWith(".js")).contents;
const css = result.outputFiles.find((file) => file.path.endsWith(".css")).contents;
createServer((request, response) => {
 const url = new URL(request.url, "http://127.0.0.1:3108");
 if (url.pathname === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(js); return; }
 if (url.pathname === "/bundle.css") { response.setHeader("Content-Type", "text/css"); response.end(css); return; }
 response.setHeader("Content-Type", "text/html; charset=utf-8");
 if (url.pathname === "/frame") response.end('<!doctype html><html lang="th"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>body{margin:0;padding:16px;font-family:Arial,sans-serif}#fixture-event{overflow-wrap:anywhere}</style></head><body><p>FIXTURE ONLY — no backend writes</p><div id="app"></div><p id="fixture-event"></p><script src="/bundle.js"></script></body></html>');
 else { const width = [390,768,1280].includes(Number(url.searchParams.get("width"))) ? Number(url.searchParams.get("width")) : 1280;
 response.end('<!doctype html><html><body style="margin:0"><p>Fixture preview: <a href="/?width=390">390px</a> <a href="/?width=1280">1280px</a></p><iframe title="Board-game analytics fixture" src="/frame" style="border:0;width:'+width+'px;height:1600px"></iframe></body></html>'); }
}).listen(3108, "127.0.0.1", () => console.log("Fixture preview: http://127.0.0.1:3108/?width=390 (Ctrl+C to stop)"));
