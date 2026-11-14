import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { parseFishImportWorkbook } from "../apps/web/lib/bms/fishImport.ts";
import { FishIntakeError, fishIntakePreview, validateFishIntake } from "../apps/web/lib/bms/fishIntake.ts";

const requireWeb=createRequire(new URL("../apps/web/package.json",import.meta.url));
const XLSX=requireWeb("xlsx") as typeof import("../apps/web/node_modules/xlsx/types/index.d.ts");

function workbook() {
  const header=Array(26).fill(null);
  header[1]="วันที่บิล";header[2]="วันที่รับปลา";header[5]="ชื่อปลา";
  header[14]="นน.รวม";header[18]="จำนวนเงิน";
  const row=(bill:unknown,received:unknown,fish:string,billKg:unknown,actualKg:unknown,amount:unknown)=>{
    const values=Array(26).fill(null);
    values[1]=bill;values[2]=received;values[3]="แพ ก";values[4]="เรือ 1";
    values[5]=fish;values[14]=billKg;values[16]=actualKg;values[18]=amount;
    return values;
  };
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
    ["รายงานปลาสด"],header,
    row("01/01/68","01/01/68","ปลาทู",1.25,1.125,112.50),
    row("02/01/68","03/01/68","ปลากะพง",2,1.875,300),
    row("03/01/68","24/11/6/8","ปลาเก๋า",3,2.5,500),
  ]),"01-1068");
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["รายงานซ้ำ"],header,row("01/01/68","01/01/68","ปลาทู",1.25,1.125,112.50)]),"สรุปซ้ำ");
  return XLSX.write(book,{type:"buffer",bookType:"xlsx"}) as Buffer;
}

test("historical preview selects one sheet, maps Thai Excel years and blocks ambiguous dates",()=>{
  const buffer=workbook();
  const first=parseFishImportWorkbook(buffer,"fish.xlsx",2025,"01-1068");
  assert.equal(first.rowCount,3);
  assert.equal(first.readyCount,2);
  assert.deepEqual(first.issues.map(x=>[x.row,x.field]),[[5,"receivedDate"]]);
  assert.equal(first.totals.receivedKg,"3.000");
  assert.equal(first.totals.purchaseAmount,"412.50");
  assert.deepEqual(first.fishNames.map(item=>[item.name,item.count]),
    [["ปลากะพง",1],["ปลาเก๋า",1],["ปลาทู",1]]);
  assert.equal(first.sample[0].billDate,"2025-01-01");
  const fixed=parseFishImportWorkbook(buffer,"fish.xlsx",2025,"01-1068",{"5":{receivedDate:"2025-01-03"}});
  assert.equal(fixed.readyCount,3);
  assert.equal(fixed.issues.length,0);
  assert.equal(fixed.totals.receivedKg,"5.500");
  assert.equal(fixed.totals.purchaseAmount,"912.50");
  assert.notEqual(fixed.previewHash,first.previewHash);
  assert.equal(fixed.sourceHash,first.sourceHash);
  assert.equal(validateFishIntake(fixed.input).totals.receivedGrams,5500);
});

test("possible duplicate rows require an explicit keep or skip decision",()=>{
  const book=XLSX.read(workbook(),{type:"buffer"});
  const sheet=book.Sheets["01-1068"];
  const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:null,blankrows:true});
  XLSX.utils.sheet_add_aoa(sheet,[rows[3]],{origin:"A6"});
  const buffer=XLSX.write(book,{type:"buffer",bookType:"xlsx"}) as Buffer;
  const dates={"5":{receivedDate:"2025-01-03"}};
  const unresolved=parseFishImportWorkbook(buffer,"fish.xlsx",2025,"01-1068",dates);
  assert.equal(unresolved.rowCount,4);
  assert.deepEqual(unresolved.issues.map(x=>[x.row,x.field]),[[6,"duplicate"]]);
  const skipped=parseFishImportWorkbook(buffer,"fish.xlsx",2025,"01-1068",
    {...dates,"6":{duplicateDecision:"SKIP"}});
  assert.equal(skipped.issues.length,0);
  assert.equal(skipped.readyCount,3);
  assert.equal(skipped.totals.purchaseAmount,"912.50");
  const kept=parseFishImportWorkbook(buffer,"fish.xlsx",2025,"01-1068",
    {...dates,"6":{duplicateDecision:"KEEP"}});
  assert.equal(kept.issues.length,0);
  assert.equal(kept.readyCount,4);
  assert.equal(kept.totals.purchaseAmount,"1212.50");
  assert.notEqual(kept.previewHash,skipped.previewHash);
});

test("live receipt uses exact grams and reviewed money, with a stable preview hash",()=>{
  const input={kind:"LIVE" as const,locationId:"00000000-0000-0000-0000-000000000001",
    requestKey:"example-live-request-1",lines:[{
      fishName:"ปลาทู",sku:"FISH-1",size:"M",supplierName:"แพ ก",billDate:"2025-01-01",
      receivedDate:"2025-01-01",billKg:"1.250",receivedKg:"1.125",
      unitPricePerKg:"100",purchaseAmount:"125.00",extraAmount:"2.50",
    }]};
  const preview=fishIntakePreview(input);
  assert.equal(preview.totals.receivedGrams,1125);
  assert.equal(preview.totals.purchaseAmount,"125.00");
  assert.equal(preview.totals.extraAmount,"2.50");
  assert.notEqual(fishIntakePreview({...input,lines:[{...input.lines[0],receivedKg:"1.126"}]}).previewHash,preview.previewHash);
  assert.throws(()=>validateFishIntake({...input,lines:[{...input.lines[0],receivedKg:"1.1259"}]}),
    (error:unknown)=>error instanceof FishIntakeError&&error.code==="INVALID_WEIGHT");
});

test("opening stock rejects bill fields and history rejects stock mappings",()=>{
  const base={requestKey:"example-opening-request-1",lines:[{fishName:"ปลาเก๋า",sku:"FISH-2",size:"L",
    receivedDate:"2025-01-01",receivedKg:"2.001",purchaseAmount:"300.00"}]};
  assert.equal(validateFishIntake({kind:"OPENING",locationId:"00000000-0000-0000-0000-000000000001",...base}).totals.receivedGrams,2001);
  assert.throws(()=>validateFishIntake({kind:"OPENING",locationId:"00000000-0000-0000-0000-000000000001",
    ...base,lines:[{...base.lines[0],billKg:"2.000"}]}),
  (error:unknown)=>error instanceof FishIntakeError&&error.code==="OPENING_FIELDS_INVALID");
  assert.throws(()=>validateFishIntake({kind:"HISTORICAL",...base,
    lines:[{...base.lines[0],sourceRow:3,billDate:"2025-01-01"}]}),
  (error:unknown)=>error instanceof FishIntakeError&&error.code==="HISTORY_STOCK_FIELDS");
});
