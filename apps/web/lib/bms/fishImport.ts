import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import type { FishIntakeInput, FishIntakeLineInput } from "./fishIntake";

export type FishDateOverrides = Record<string, { billDate?: string; receivedDate?: string; duplicateDecision?: "KEEP" | "SKIP" }>;
export class FishImportError extends Error {}
export type FishImportIssue = { row: number; field: "billDate" | "receivedDate" | "duplicate" | "line"; value: string; message: string };
export type FishImportPreview = {
  sourceHash: string;
  previewHash: string;
  sheet: string;
  sourceYear: number;
  rowCount: number;
  readyCount: number;
  issues: FishImportIssue[];
  totals: { billKg: string; receivedKg: string; purchaseAmount: string };
  fishNames: Array<{ name: string; count: number }>;
  sample: Array<{row:number;billDate:string;receivedDate:string;supplierName:string;fishName:string;receivedKg:string;purchaseAmount:string}>;
  input: FishIntakeInput;
};

const iso = (year: number, month: number, day: number): string | null => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const result = new Date(Date.UTC(year,month-1,day));
  if (result.getUTCFullYear()!==year || result.getUTCMonth()+1!==month || result.getUTCDate()!==day) return null;
  return result.toISOString().slice(0,10);
};
function actualYear(year: number, sourceYear: number): number | null {
  // Older Thai Excel workbooks typed 68 as a two-digit Buddhist year and Excel
  // persisted it as 1968. The conversion is explicit in the preview.
  if (year === sourceYear || year === sourceYear+1) return year;
  if (year === sourceYear-57 || year === sourceYear-56) return year+57;
  if (year === sourceYear+543 || year === sourceYear+544) return year-543;
  if (year >= 0 && year <= 99 && 1957+year >= sourceYear-1 && 1957+year <= sourceYear+1) return 1957+year;
  return null;
}
function parseDate(value: unknown, sourceYear: number): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year=actualYear(value.getUTCFullYear(),sourceYear);
    return year==null?null:iso(year,value.getUTCMonth()+1,value.getUTCDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date=XLSX.SSF.parse_date_code(value);
    if (!date) return null;
    const year=actualYear(date.y,sourceYear);
    return year==null?null:iso(year,date.m,date.d);
  }
  if (typeof value === "string") {
    const s=value.trim();
    const exact=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (exact) return iso(Number(exact[1]),Number(exact[2]),Number(exact[3]));
    const thai=/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
    if (thai) {
      const year=actualYear(Number(thai[3]),sourceYear);
      return year==null?null:iso(year,Number(thai[2]),Number(thai[1]));
    }
  }
  return null;
}
function decimal(value: unknown, precision: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const n=Number(value.replace(/,/g,"").trim());
    if (!Number.isFinite(n)) return null;
    value=n;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const factor=10**precision;
  if (Math.abs(value*factor-Math.round(value*factor)) > 0.001) return null;
  return Number(value.toFixed(precision)).toString();
}
const cellText=(value:unknown)=>value==null?"":String(value).trim();
const cents=(amount:string)=>{const [whole,fraction=""]=amount.split(".");return BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));};

/** Parses only a verified daily-fish sheet, never duplicate helper/summary tabs. */
export function parseFishImportWorkbook(buffer: Buffer, sourceName: string, sourceYear: number,
  sheetName: string, overrides: FishDateOverrides = {}): FishImportPreview {
  if (!Number.isInteger(sourceYear) || sourceYear < 2000 || sourceYear > 2100)
    throw new FishImportError("ปีข้อมูลต้องเป็น ค.ศ. 2000–2100");
  if (!sheetName || sheetName.length > 100) throw new FishImportError("ต้องเลือกแท็บรายการหลัก");
  let book:XLSX.WorkBook;
  try { book=XLSX.read(buffer,{type:"buffer",cellDates:false}); }
  catch { throw new FishImportError("อ่านไฟล์ Excel ไม่ได้ กรุณาตรวจรูปแบบไฟล์"); }
  const sheet=book.Sheets[sheetName];
  if (!sheet) throw new FishImportError("ไม่พบแท็บที่เลือกในไฟล์");
  const range=XLSX.utils.decode_range(sheet["!ref"]??"A1");
  if (range.e.r>100000 || range.e.c>200)
    throw new FishImportError("แท็บมีขนาดเกินขอบเขตนำเข้า กรุณาเลือกเฉพาะรายการปลาหลัก");
  let rows:unknown[][];
  try {rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:null,blankrows:true});}
  catch {throw new FishImportError("อ่านแถวข้อมูลปลาไม่ได้ กรุณาตรวจรูปแบบไฟล์");}
  const header=rows[1]??[];
  if (!cellText(header[1]).includes("วันที่บิล") || !cellText(header[2]).includes("วันที่รับปลา") ||
      !cellText(header[5]).includes("ชื่อปลา") || !cellText(header[14]).includes("นน.รวม") ||
      !cellText(header[18]).includes("จำนวนเงิน"))
    throw new FishImportError("แท็บนี้ไม่ใช่รูปแบบรายการรับปลาสดหลัก (ต้องมีคอลัมน์ B/C/F/O/S)");
  const issues:FishImportIssue[]=[];
  const lines:FishIntakeLineInput[]=[];
  const seen=new Map<string,number>();
  const fishNameCounts=new Map<string,number>();
  let count=0;
  for (let index=2;index<rows.length;index++) {
    const row=rows[index]??[];
    const rowNo=index+1;
    const fishName=typeof row[5]==="string"?row[5].trim():"";
    const hasDate=row[1]!=null||row[2]!=null;
    if (!fishName && !hasDate) continue;
    if (!fishName) continue; // section labels and monthly subtotal rows
    count++;
    fishNameCounts.set(fishName,(fishNameCounts.get(fishName)??0)+1);
    if (row[14]==null) {
      issues.push({row:rowNo,field:"line",value:fishName,message:"แถวปลานี้ไม่มีน้ำหนักตามบิล: แก้ไฟล์ก่อนนำเข้า"});
      continue;
    }
    const override=overrides[String(rowNo)]??{};
    const billDate=parseDate(override.billDate??row[1],sourceYear);
    const receivedDate=parseDate(override.receivedDate??row[2],sourceYear);
    if (!billDate || !receivedDate) {
      if (!billDate) issues.push({row:rowNo,field:"billDate",value:cellText(row[1]),message:"วันที่บิลไม่ชัดเจน: ระบุวันที่จริงเป็น YYYY-MM-DD"});
      if (!receivedDate) issues.push({row:rowNo,field:"receivedDate",value:cellText(row[2]),message:"วันที่รับไม่ชัดเจน: ระบุวันที่จริงเป็น YYYY-MM-DD"});
      continue;
    }
    if (Number(billDate.slice(0,4))!==sourceYear ||
        Math.abs(Date.parse(receivedDate)-Date.parse(billDate))>45*24*60*60*1000) {
      issues.push({row:rowNo,field:"line",value:`${billDate} / ${receivedDate}`,message:"วันที่อยู่นอกปีข้อมูลหรือห่างกันเกิน 45 วัน"});
      continue;
    }
    const billKg=decimal(row[14],3),receivedKg=decimal(row[16],3),amount=decimal(row[18],2);
    const rawPrice=row[17];
    const priceValue=typeof rawPrice==="number"&&Number.isFinite(rawPrice)&&rawPrice>=0
      ?Number(rawPrice.toFixed(4)).toString():decimal(rawPrice,4);
    if (!billKg || !receivedKg || Number(receivedKg)<=0 || amount==null ||
        (rawPrice!=null && priceValue==null)) {
      issues.push({row:rowNo,field:"line",value:fishName,message:"น้ำหนัก ราคา หรือยอดเงินไม่ถูกต้อง: แก้ไฟล์ก่อนนำเข้า"});
      continue;
    }
    const line:FishIntakeLineInput={sourceRow:rowNo,billDate,receivedDate,
      supplierName:cellText(row[3]),vesselRegistration:cellText(row[4]),fishName,
      billSize:cellText(row[6]),actualSize:cellText(row[7]),billKg,receivedKg,
      unitPricePerKg:priceValue,purchaseAmount:amount,quality:cellText(row[24]),note:cellText(row[25])};
    const fingerprint=JSON.stringify([billDate,receivedDate,line.supplierName,line.vesselRegistration,
      fishName,line.billSize,line.actualSize,billKg,receivedKg,priceValue,amount,line.quality]);
    const matchedRow=seen.get(fingerprint);
    if (matchedRow!=null) {
      if (override.duplicateDecision==="SKIP") continue;
      if (override.duplicateDecision!=="KEEP") {
        issues.push({row:rowNo,field:"duplicate",value:`${fishName} · ${matchedRow}`,
          message:`ข้อมูลหลักตรงกับแถว ${matchedRow}: เลือกเก็บหรือข้ามหลังตรวจบิลจริง`});
        continue;
      }
    } else seen.set(fingerprint,rowNo);
    lines.push(line);
  }
  if (count===0 || count>3000) throw new FishImportError("แท็บนี้ไม่มีข้อมูลปลา หรือมีเกิน 3,000 แถว");
  const billGrams=lines.reduce((sum,line)=>sum+Math.round(Number(line.billKg)*1000),0);
  const receivedGrams=lines.reduce((sum,line)=>sum+Math.round(Number(line.receivedKg)*1000),0);
  const totalCents=lines.reduce((sum,line)=>sum+cents(line.purchaseAmount),0n);
  const sourceHash=createHash("sha256").update(buffer).digest("hex");
  const input:FishIntakeInput={kind:"HISTORICAL",requestKey:sourceHash,sourceName,sourceSheet:sheetName,
    sourceYear,lines};
  const previewHash=createHash("sha256").update(JSON.stringify({sourceHash,sourceYear,sheetName,
    overrides,lines,issues})).digest("hex");
  return {sourceHash,previewHash,sheet:sheetName,sourceYear,rowCount:count,readyCount:lines.length,issues,
    totals:{billKg:(billGrams/1000).toFixed(3),receivedKg:(receivedGrams/1000).toFixed(3),
      purchaseAmount:`${totalCents/100n}.${String(totalCents%100n).padStart(2,"0")}`},
    fishNames:[...fishNameCounts].map(([name,nameCount])=>({name,count:nameCount}))
      .sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name,"th")),
    sample:lines.slice(0,10).map(l=>({row:l.sourceRow!,billDate:l.billDate!,receivedDate:l.receivedDate!,
      supplierName:l.supplierName??"",fishName:l.fishName,receivedKg:l.receivedKg,
      purchaseAmount:l.purchaseAmount})),input};
}

export function listFishImportSheets(buffer: Buffer): string[] {
  let book:XLSX.WorkBook;
  try {book=XLSX.read(buffer,{type:"buffer",bookSheets:true});}
  catch {throw new FishImportError("อ่านไฟล์ Excel ไม่ได้ กรุณาตรวจรูปแบบไฟล์");}
  return book.SheetNames;
}
