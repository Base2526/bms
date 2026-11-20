"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, List, Modal, Select, Space, Table, Tabs, Typography, message } from "antd";
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import { operatorMessage } from "@/lib/operatorMessage";
import type { FishIntakeInput, FishIntakeKind, FishIntakeLineInput, FishIntakeSetupReason } from "@/lib/bms/fishIntake";

type Options={locations:Array<{id:string;name:string}>;products:Array<{sku:string;name:string;size:string;expiry_tracking:boolean}>;
  unreadyProducts:Array<{sku:string;name:string;reasons:FishIntakeSetupReason[]}>;currency:string|null};
type Issue={row:number;field:"billDate"|"receivedDate"|"duplicate"|"line";value:string;message:string};
type ImportPreview={previewHash:string;rowCount:number;readyCount:number;issues:Issue[];
  totals:{billKg:string;receivedKg:string;purchaseAmount:string};
  fishNames:Array<{name:string;count:number}>;
  sample:Array<{row:number;billDate:string;receivedDate:string;supplierName:string;fishName:string;receivedKg:string;purchaseAmount:string}>};
type Saved={status:"SAVED"|"REPLAYED";intakeId:string;lineCount:number;billGrams:number;receivedGrams:number;purchaseAmount:string;extraAmount:string};
type LateCostPreview={status:"PREVIEW";previewHash:string;lineNo:number;originalExtraAmount:string;
  priorAdjustments:string;currentExtraCost:string;addedAmount:string;newExtraCost:string;
  valuationBefore:string;valuationAfter:string;stockQty:number};
type IntakeDetail={id:string;kind:FishIntakeKind;locationName:string|null;sourceName:string|null;
  sourceSheet:string|null;sourceYear:number|null;note:string|null;createdAt:string;lines:Array<{
    lineNo:number;sourceRow:number|null;billDate:string|null;receivedDate:string|null;
    supplierName:string|null;vesselRegistration:string|null;fishName:string;billSize:string|null;
    actualSize:string|null;sku:string|null;size:string|null;billGrams:number|null;
    receivedGrams:number;unitPricePerKg:string|null;purchaseAmount:string;extraAmount:string;
    quality:string|null;note:string|null;lotNo:string|null;expiryDate:string|null;
  }>;adjustments:Array<{id:string;lineNo:number;category:string;amount:string;reason:string;
    reference:string|null;actorId:string;actorName:string|null;createdAt:string}>};

async function readJson(response:Response, lang:string, action:"read"|"write"="read") {
  const parsed=await response.json().catch(()=>null);
  const result=parsed && typeof parsed==="object" ? parsed : {error:"Server response is unavailable"};
  if (!response.ok || result.error==="Server response is unavailable") {
    if (response.status===401) throw new Error(lang==="en"?"Sign in again, then check the latest record before continuing.":"กรุณาเข้าสู่ระบบอีกครั้ง แล้วตรวจรายการล่าสุดก่อนทำต่อ");
    if (response.status===403) throw new Error(lang==="en"?"This account cannot perform this action. Ask a store administrator to check its permissions.":"บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ ให้ผู้ดูแลร้านตรวจสิทธิ์ของบัญชี");
    if (response.status>=500 || result.error==="Server response is unavailable")
      throw new Error(action==="read"
        ? lang==="en"?"Could not load data. Refresh this page. If the problem continues, contact support.":"โหลดข้อมูลไม่ได้ กรุณารีเฟรชหน้า หากยังไม่หายให้แจ้งผู้ดูแลระบบ"
        : lang==="en"?"The save result is unknown. Check the latest record before retrying. If the problem continues, contact support.":"ยังยืนยันผลการบันทึกไม่ได้ กรุณาตรวจรายการล่าสุดก่อนกดซ้ำ หากยังไม่หายให้แจ้งผู้ดูแลระบบ");
    if (["STORE_CURRENCY_REQUIRED","IDEMPOTENCY_CONFLICT"].includes(result.code))
      throw new Error(result.code);
    throw new Error(result.error??String(response.status));
  }
  return result;
}
const formatKg=(grams:number)=>`${(grams/1000).toLocaleString(undefined,{maximumFractionDigits:3})} kg`;
const moneyCents=(amount:string)=>{const [whole,fraction=""]=amount.split(".");
  return BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));};
const formatCents=(amount:bigint)=>`${(amount/100n).toLocaleString("en-US")}.${String(amount%100n).padStart(2,"0")}`;

function HistoryImport({onSaved,onOpenDetail,canCommit}:{onSaved:()=>void;onOpenDetail:(id:string)=>void;canCommit:boolean}) {
  const {lang,t}=useI18n();
  const L=(th:string,en:string)=>lang==="en"?en:th;
  const [file,setFile]=useState<File|null>(null);
  const [sourceYear,setSourceYear]=useState<number>(2025);
  const [sheet,setSheet]=useState("");
  const [sheets,setSheets]=useState<string[]>([]);
  const [overrides,setOverrides]=useState<Record<string,{billDate?:string;receivedDate?:string;duplicateDecision?:"KEEP"|"SKIP"}>>({});
  const [preview,setPreview]=useState<ImportPreview|null>(null);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [saved,setSaved]=useState<Saved|null>(null);

  async function inspect(selected:File) {
    setFile(selected);setPreview(null);setOverrides({});setSheet("");setSheets([]);setSaved(null);setDirty(false);
    setBusy(true);
    try {
      const body=new FormData();body.append("action","inspect");body.append("file",selected);
      const result=await readJson(await fetch("/api/bms/fish-intake/import",{method:"POST",body,credentials:"include"}),lang);
      setSheets(result.sheets);setSheet(result.suggestedSheet??"");
    } catch(error) { message.error(operatorMessage(error,t)); }
    finally {setBusy(false);}
  }
  async function send(action:"preview"|"commit") {
    if (!file || !sheet) return;
    setBusy(true);
    try {
      const body=new FormData();body.append("action",action);body.append("file",file);
      body.append("sourceYear",String(sourceYear));body.append("sheet",sheet);
      body.append("overrides",JSON.stringify(overrides));
      if (action==="commit") {body.append("confirmed","true");body.append("previewHash",preview?.previewHash??"");}
      const result=await readJson(await fetch("/api/bms/fish-intake/import",{method:"POST",body,credentials:"include"}),lang,action==="commit"?"write":"read");
      if (action==="preview") {setPreview(result);setDirty(false);setSaved(null);}
      else {setSaved(result);message.success(L("บันทึกประวัติแล้ว","Historical records saved"));onSaved();}
    } catch(error) {message.error(operatorMessage(error,t,action==="commit"?"write":"read"));}
    finally {setBusy(false);}
  }
  function changeOverride(issue:Issue,value:string) {
    const key=String(issue.row);
    setOverrides(current=>({...current,[key]:{...current[key],[issue.field]:value}}));
    setDirty(true);
  }
  const issueRows=preview?.issues??[];
  return <Space direction="vertical" size="middle" style={{width:"100%"}}>
    <Alert type="info" showIcon closable message={L("ประวัติย้อนหลังไม่เพิ่มสต็อกปัจจุบัน","Historical imports do not change current stock")}
      description={L("เลือกแท็บรายการหลักเพียงแท็บเดียว ตรวจวันที่และรายการซ้ำก่อนยืนยัน การตรวจซ้ำอัตโนมัติครอบคลุมแถวในแท็บนี้และการอัปโหลดไฟล์เดิมเท่านั้น หากนำเข้าไฟล์อื่นที่มีรายการเดิม ต้องตรวจด้วยตนเอง","Select one primary detail sheet and review dates and duplicates before confirming. Automatic duplicate checks cover rows in this sheet and retries of the same file only. Check other files manually for overlapping receipts.")} />
    <Space wrap align="end">
      <label>{L("ไฟล์รายงาน .xlsx","Report .xlsx")}<br/><Input type="file" accept=".xlsx" disabled={busy}
        onChange={event=>{const selected=event.target.files?.[0];if(selected)void inspect(selected);}} /></label>
      <label>{L("ปีข้อมูล ค.ศ.","Source year (CE)")}<br/><InputNumber min={2000} max={2100} value={sourceYear} disabled={busy}
        onChange={value=>{setSourceYear(Number(value??2025));setDirty(true);}} /></label>
      <label>{L("แท็บรายการหลัก","Primary detail sheet")}<br/><Select style={{minWidth:190}} value={sheet||undefined} loading={busy}
        options={sheets.map(value=>({value,label:value}))} onChange={value=>{setSheet(value);setPreview(null);}} /></label>
      <Button type="primary" loading={busy} disabled={!file||!sheet} onClick={()=>void send("preview")}>{L("ตรวจตัวอย่าง","Preview")}</Button>
    </Space>
    {preview && <Card size="small" title={L("ผลตรวจไฟล์","File review")}>
      <Space wrap size="large">
        <span>{L("แถวข้อมูล","Rows")}: <b>{preview.rowCount.toLocaleString()}</b></span>
        <span>{L("พร้อมนำเข้า","Ready")}: <b>{preview.readyCount.toLocaleString()}</b></span>
        <span>{L("ต้องตรวจ","Need review")}: <b>{issueRows.length}</b></span>
        <span>{L("ชื่อปลา","Fish names")}: <b>{preview.fishNames.length}</b></span>
        <span>{L("น้ำหนักรับ","Received")}: <b>{Number(preview.totals.receivedKg).toLocaleString()} {L("กก.","kg")}</b></span>
        <span>{L("ยอดซื้อ","Purchase amount")}: <b>{Number(preview.totals.purchaseAmount).toLocaleString()} ฿</b></span>
      </Space>
      <Typography.Title level={5} style={{marginTop:16}}>{L("ตรวจชื่อปลาทั้งหมดในไฟล์","Review every fish name in the file")}</Typography.Title>
      <Typography.Text type="secondary">{L("ชื่อที่สะกดต่างกันจะแสดงแยกกัน หากผิดให้แก้ไฟล์ Excel แล้วอัปโหลดใหม่","Different spellings appear separately. Correct the Excel file and upload it again if needed.")}</Typography.Text>
      <Table size="small" rowKey="name" style={{marginTop:8}} dataSource={preview.fishNames}
        pagination={{pageSize:10}} columns={[
          {title:L("ชื่อปลาในไฟล์","Fish name in file"),dataIndex:"name"},
          {title:L("จำนวนแถว","Rows"),dataIndex:"count",width:110},
        ]}/>
      {dirty && <Alert style={{marginTop:12}} type="warning" showIcon closable message={L("ข้อมูลเปลี่ยนแล้ว กดตรวจตัวอย่างใหม่","Changes need another preview")} />}
      {issueRows.length>0 && <div style={{marginTop:16}}>
        <Typography.Title level={5}>{L("ตรวจและแก้ข้อมูลที่ไม่ชัดเจนทีละแถว","Review and correct each flagged row")}</Typography.Title>
        <Table size="small" rowKey={r=>`${r.row}-${r.field}`} pagination={{pageSize:25}}
          dataSource={issueRows} columns={[
            {title:L("แถว","Row"),dataIndex:"row",width:75},
            {title:L("ช่อง","Field"),dataIndex:"field",render:(v:string)=>v==="billDate"?L("วันที่บิล","Bill date"):v==="receivedDate"?L("วันที่รับ","Received date"):v==="duplicate"?L("รายการซ้ำ","Possible duplicate"):L("ข้อมูล","Data")},
            {title:L("ค่าเดิม","Source"),dataIndex:"value"},
            {title:L("ผลตรวจ","Review"),render:(_:unknown,r:Issue)=>r.field==="line"?r.message:
              r.field==="duplicate"?<Select style={{minWidth:180}} placeholder={L("ตรวจบิลจริง","Check source bill")}
                value={overrides[String(r.row)]?.duplicateDecision}
                options={[{value:"KEEP",label:L("เก็บ: คนละรายการ","Keep: separate receipt")},
                  {value:"SKIP",label:L("ข้าม: บันทึกซ้ำ","Skip: duplicate row")}]}
                onChange={value=>changeOverride(r,value)}/>:
              <Input type="date" value={overrides[String(r.row)]?.[r.field]??""} onChange={e=>changeOverride(r,e.target.value)} />},
          ]} />
      </div>}
      {issueRows.length===0 && <Table size="small" style={{marginTop:16}} pagination={false} rowKey="row"
        dataSource={preview.sample} columns={[
          {title:L("แถว","Row"),dataIndex:"row"},{title:L("วันที่บิล","Bill date"),dataIndex:"billDate"},
          {title:L("แพ","Supplier"),dataIndex:"supplierName"},{title:L("ปลา","Fish"),dataIndex:"fishName"},
          {title:L("น้ำหนักรับ กก.","Received kg"),dataIndex:"receivedKg"},
          {title:L("ยอดซื้อ บาท","Amount THB"),dataIndex:"purchaseAmount"},
        ]} />}
      <Button style={{marginTop:12}} type="primary" loading={busy}
        disabled={!canCommit||issueRows.length>0||dirty||!!saved} onClick={()=>Modal.confirm({
          title:L("ยืนยันนำเข้าประวัติ","Confirm historical import"),
          content:L(`บันทึก ${preview.readyCount.toLocaleString()} แถว ยอดซื้อ ${Number(preview.totals.purchaseAmount).toLocaleString()} บาท โดยไม่เพิ่มสต็อก`,
            `Save ${preview.readyCount.toLocaleString()} rows totaling ${Number(preview.totals.purchaseAmount).toLocaleString()} THB without changing stock?`),
          okText:L("ยืนยัน","Confirm"),onOk:()=>send("commit"),
        })}>{L("ยืนยันนำเข้าประวัติ","Import historical records")}</Button>
      {!canCommit&&<Typography.Text type="secondary" style={{display:"block",marginTop:8}}>
        {L("การยืนยันต้องมีสิทธิ์ purchase.edit","Confirmation requires purchase.edit")}
      </Typography.Text>}
    </Card>}
    {saved && <Alert type="success" showIcon closable message={L(saved.status==="REPLAYED"?"ไฟล์นี้เคยนำเข้าแล้ว":"นำเข้าสำเร็จ",saved.status==="REPLAYED"?"This file was already imported":"Import complete")}
      description={<Space wrap>{`${saved.lineCount.toLocaleString()} ${L("แถว","rows")} · ${saved.intakeId}`}
        <Button type="link" onClick={()=>onOpenDetail(saved.intakeId)}>{L("ดูรายละเอียด","View details")}</Button></Space>} />}
  </Space>;
}

function StockEntry({kind,options,onSaved,onOpenDetail,onSearchProducts,canCommit}:{kind:"LIVE"|"OPENING";options:Options;onSaved:()=>void;onOpenDetail:(id:string)=>void;onSearchProducts:(search:string)=>void;canCommit:boolean}) {
  const {lang,t}=useI18n();
  const L=(th:string,en:string)=>lang==="en"?en:th;
  const kgRule={pattern:/^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/,
    message:L("กรอกน้ำหนักเป็นกิโลกรัม ทศนิยมไม่เกิน 3 ตำแหน่ง","Enter kg with up to 3 decimal places")};
  const trimWeight=(value:unknown)=>typeof value==="string"?value.trim():value;
  const [form]=Form.useForm();
  const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
  const [preview,setPreview]=useState<{previewHash:string;totals:{lineCount:number;billGrams:number;receivedGrams:number;purchaseAmount:string;extraAmount:string}}|null>(null);
  const [busy,setBusy]=useState(false);
  const [saved,setSaved]=useState<Saved|null>(null);
  const [productSearch,setProductSearch]=useState("");
  const productByKey=new Map(options.products.map(p=>[JSON.stringify([p.sku,p.size]),p]));
  const setupReason=(reason:FishIntakeSetupReason)=>({
    NO_ACTIVE_SIZE:L("ไม่มีไซซ์ที่เปิดใช้","no active size"),
    NOT_WEIGHTED:L("ยังไม่เป็นสินค้าชั่งน้ำหนัก","not weighted"),
    NOT_GRAM:L("หน่วยฐานยังไม่ใช่กรัม","base unit is not grams"),
    LOT_DISABLED:L("ยังไม่ติดตามล็อต","lot tracking is off"),
  })[reason];
  useEffect(()=>{
    if (!form.getFieldValue("locationId") && options.locations[0])
      form.setFieldValue("locationId",options.locations[0].id);
  },[form,options.locations]);
  function makeInput(values:any):FishIntakeInput {
    const lines:FishIntakeLineInput[]=(values.lines??[]).map((line:any)=>{
      const product=productByKey.get(line.productKey);
      if (!product) throw new Error(L("ต้องเลือกสินค้าและไซซ์ที่ตั้งค่าไว้","Choose a configured product and size"));
      return {fishName:product.name,sku:product.sku,size:product.size,
        billDate:kind==="LIVE"?values.billDate:null,receivedDate:values.receivedDate,
        supplierName:kind==="LIVE"?values.supplierName:null,
        vesselRegistration:kind==="LIVE"?values.vesselRegistration:null,
        billSize:kind==="LIVE"?line.billSize:null,actualSize:product.size,
        billKg:kind==="LIVE"?String(line.billKg??""):null,receivedKg:String(line.receivedKg??""),
        unitPricePerKg:kind==="LIVE"?(line.unitPricePerKg?String(line.unitPricePerKg):null):null,
        purchaseAmount:String(line.purchaseAmount??""),extraAmount:kind==="LIVE"?String(line.extraAmount??"0"):"0",
        quality:line.quality??null,lotNo:line.lotNo??null,expiryDate:line.expiryDate??null,note:line.note??null};
    });
    return {kind,locationId:values.locationId,requestKey,note:values.note??null,lines};
  }
  async function send(action:"preview"|"commit",input?:FishIntakeInput,hash?:string) {
    setBusy(true);
    try {
      const v=input??makeInput(await form.validateFields());
      const result=await readJson(await fetch("/api/bms/fish-intake",{method:"POST",credentials:"include",
        headers:{"content-type":"application/json"},body:JSON.stringify({action,input:v,
          confirmed:action==="commit",previewHash:hash})}),lang,action==="commit"?"write":"read");
      if (action==="preview") {setPreview(result);setSaved(null);}
      else {setSaved(result);setPreview(null);message.success(L("บันทึกสำเร็จ","Saved"));onSaved();
        form.resetFields();setRequestKey(crypto.randomUUID());}
    } catch(error) {message.error(operatorMessage(error,t,action==="commit"?"write":"read"));}
    finally {setBusy(false);}
  }
  async function confirm() {
    if (!preview) return;
    let input:FishIntakeInput;
    try {input=makeInput(await form.validateFields());} catch {return;}
    Modal.confirm({title:L(kind==="LIVE"?"ยืนยันรับปลาเข้าสต็อก":"ยืนยันยอดสต็อกตั้งต้น",
        kind==="LIVE"?"Confirm fish receipt":"Confirm opening stock"),
      content:<Space direction="vertical">
        <span>{L("สาขา","Branch")}: {options.locations.find(x=>x.id===input.locationId)?.name}</span>
        <span>{L("รายการ","Lines")}: {preview.totals.lineCount} · {L("น้ำหนัก","Weight")}: {formatKg(preview.totals.receivedGrams)}</span>
        {kind==="LIVE"&&<span>{L("ตามบิล / รับจริง / ผลต่าง","Bill / actual / difference")}: {formatKg(preview.totals.billGrams)} / {formatKg(preview.totals.receivedGrams)} / {formatKg(preview.totals.receivedGrams-preview.totals.billGrams)}</span>}
        <span>{kind==="LIVE"?L("ยอดซื้อ","Purchase amount"):L("มูลค่าสต็อก","Stock value")}: {Number(preview.totals.purchaseAmount).toLocaleString()} ฿</span>
        <b>{L("การยืนยันนี้จะเพิ่มสต็อกจริงและบันทึกหลักฐาน","This confirmation adds physical stock and audit evidence")}</b>
      </Space>,okText:L("ยืนยัน","Confirm"),onOk:()=>send("commit",input,preview.previewHash)});
  }
  return <Space direction="vertical" size="middle" style={{width:"100%"}}>
    <Alert showIcon closable type={kind==="OPENING"?"warning":"info"}
      message={kind==="LIVE"?L("รับปลาใหม่: เพิ่มสต็อกตามน้ำหนักรับจริง","New fish receipt: stock uses actual received weight"):
        L("ยอดตั้งต้น: ใช้ของที่นับจริง และรับเฉพาะ SKU/ไซซ์ที่สต็อกยังว่าง","Opening stock: physical count only, for empty SKU/size balances")}
      description={L("สินค้าแต่ละตัวต้องตั้งเป็นชั่งน้ำหนัก หน่วยกรัม และติดตามล็อตก่อน","Each product must be configured as weighted, gram based, and lot tracked.")} />
    <Alert showIcon closable type="warning"
      message={L("ตรวจราคาขายปลาแยกจากราคาตามบิลก่อนเปิดขาย","Review fish selling prices separately from receipt rates before selling")}
      description={L("ระบบขายใช้ราคาแค็ตตาล็อกต่อกรัมที่เก็บได้ 2 ทศนิยม จึงยังคิดราคา 43.17 บาท/กก. ตามน้ำหนักกรัมได้ไม่ตรง รับปลาเข้าสต็อกได้ แต่ยังไม่ควรเปิดขายราคาต่อกิโลกรัมที่แปลงเป็นราคา/กรัม 2 ทศนิยมไม่ได้",
        "Sales use a catalog price per gram with two decimal places. A 43.17 THB/kg rate cannot be priced accurately for arbitrary grams yet. Stock receipt works, but do not open sales at per-kg rates that cannot be expressed as a two-decimal per-gram price.")} />
    {options.products.length===0 && <Alert showIcon closable type="warning" message={L("ยังไม่มีปลาที่ตั้งค่าเป็นสินค้าชั่งน้ำหนักพร้อมติดตามล็อต","No weighted, lot tracked products are configured")}
      description={<>{L("เพิ่มปลาและไซซ์ใน ","Add the fish and size in ")}<Link href="/admin/products">{L("สินค้า","Products")}</Link>
        {L(" แล้วเปิดสินค้าชั่งน้ำหนัก หน่วยกรัม และติดตามล็อตใน ",", then enable weighted stock, grams and lot tracking in ")}
        <Link href="/admin/stock-models">{L("รูปแบบสต็อก","Stock models")}</Link>{L(" ก่อนกลับมาโหลดหน้านี้ใหม่"," before refreshing this page.")}</>} />}
    {options.unreadyProducts.length>0 && <Alert showIcon closable type="warning"
      message={L(`มีสินค้า ${options.unreadyProducts.length} รายการที่ยังเลือกในช่องปลา/ไซซ์ไม่ได้`,
        `${options.unreadyProducts.length} products are not ready for fish intake`)}
      description={<Space direction="vertical" size={4}>
        {options.unreadyProducts.slice(0,10).map(p=><span key={p.sku} style={{overflowWrap:"anywhere"}}>
          <Link href={p.reasons.includes("NO_ACTIVE_SIZE")?"/admin/products":`/admin/stock-models?sku=${encodeURIComponent(p.sku)}`}>{p.name}</Link>
          {` (${p.sku}): ${p.reasons.map(setupReason).join(", ")}`}
        </span>)}
        {options.unreadyProducts.length>10 && <span>{L("ค้นหาชื่อสินค้าเพื่อดูรายการที่เหลือ","Search by product name to see the rest")}</span>}
        <span>{L("ตั้งค่าให้ครบแล้วกลับมากดโหลดหน้านี้ใหม่ ราคาขายในสินค้าและราคาตามบิลรับปลาเป็นคนละค่า กรุณาตรวจราคาขายก่อนเปิดขาย",
          "Complete the settings, then refresh this page. Catalog selling price and fish receipt bill rate are separate; check selling price before sales.")}</span>
      </Space>} />}
    {options.currency!=="THB" && <Alert showIcon closable type="error"
      message={L("ยังบันทึกรับปลาไม่ได้: ร้านยังไม่ได้ตั้งสกุลเงินเป็นบาท (THB)",
        "Fish receipt cannot be saved: store currency must be THB")}
      description={<>{L("ระบบต้องรู้สกุลเงินก่อนคำนวณต้นทุนสต็อก ให้ Administrator ไปที่ ",
        "The store currency is required to value stock. An Administrator should open ")}
        <Link href="/admin/settings">{L("ตั้งค่า → ข้อมูลร้าน → ภูมิภาค / เวลาทำการ",
          "Settings → Store profile → Region / hours")}</Link>
        {L(" เลือกสกุลเงิน บาท (THB) กดบันทึก แล้วกลับมาหน้านี้และรีเฟรช คุณยังตรวจยอดได้ แต่จะยืนยันเพิ่มสต็อกไม่ได้จนกว่าจะตั้งค่าเสร็จ",
          ", select Thai baht (THB), save, then return here and refresh. You can preview totals, but cannot add stock until the setting is saved.")}</>} />}
    <Form form={form} layout="vertical" initialValues={{lines:[{extraAmount:"0"}],locationId:options.locations[0]?.id}}
      onValuesChange={()=>setPreview(null)}>
      <Space wrap align="start">
        <Form.Item name="locationId" label={L("สาขาที่รับปลา","Receiving branch")} rules={[{required:true}]}>
          <Select style={{minWidth:220}} options={options.locations.map(x=>({value:x.id,label:x.name}))} />
        </Form.Item>
        <Form.Item name="receivedDate" label={kind==="LIVE"?L("วันที่รับปลา","Receipt date"):L("วันที่นับจริง","Count date")} rules={[{required:true}]}>
          <Input type="date" />
        </Form.Item>
        {kind==="LIVE" && <>
          <Form.Item name="billDate" label={L("วันที่บิล","Bill date")} rules={[{required:true}]}><Input type="date" /></Form.Item>
          <Form.Item name="supplierName" label={L("แพ/ผู้ขาย","Supplier")} rules={[{required:true}]}><Input maxLength={200}/></Form.Item>
          <Form.Item name="vesselRegistration" label={L("ทะเบียนเรือ/รถ","Vessel/vehicle ID")}><Input maxLength={100}/></Form.Item>
        </>}
      </Space>
      <Form.List name="lines">{(fields,{add,remove})=><Space direction="vertical" style={{width:"100%"}}>
        {fields.map(({key,name,...rest})=><Card key={key} size="small" title={`${L("รายการ","Line")} ${name+1}`}
          extra={fields.length>1?<Button type="text" danger icon={<DeleteOutlined/>} onClick={()=>remove(name)} aria-label={L("ลบรายการ","Remove line")}/>:null}>
          <Space wrap align="start">
            <Form.Item {...rest} name={[name,"productKey"]} label={L("ปลา / ไซซ์","Fish / size")} rules={[{required:true}]}>
              <Select showSearch filterOption={false} style={{minWidth:260}}
                onSearch={search=>{setProductSearch(search);onSearchProducts(search);}}
                onDropdownVisibleChange={open=>{if(!open)setProductSearch("");}}
                options={[
                  ...options.products.filter(p=>!productSearch || `${p.name} ${p.size} ${p.sku}`.toLocaleLowerCase().includes(productSearch.toLocaleLowerCase()))
                    .map(p=>({value:JSON.stringify([p.sku,p.size]),label:`${p.name} · ${p.size} (${p.sku})`})),
                  ...options.unreadyProducts.filter(p=>!productSearch || `${p.name} ${p.sku}`.toLocaleLowerCase().includes(productSearch.toLocaleLowerCase()))
                    .map(p=>({value:JSON.stringify([p.sku,"unready"]),label:`${p.name} (${p.sku}) — ${p.reasons.map(setupReason).join(", ")}`,disabled:true})),
                ]}/>
            </Form.Item>
            {kind==="LIVE" && <Form.Item {...rest} name={[name,"billSize"]} label={L("ไซซ์ตามบิล","Bill size")}><Input maxLength={100}/></Form.Item>}
            {kind==="LIVE" && <Form.Item {...rest} name={[name,"billKg"]} label={L("น้ำหนักตามบิล (กก.)","Bill weight (kg)")} normalize={trimWeight} rules={[{required:true},kgRule]}><Input inputMode="decimal"/></Form.Item>}
            <Form.Item {...rest} name={[name,"receivedKg"]} label={kind==="LIVE"?L("น้ำหนักรับจริง (กก.)","Received weight (kg)"):L("น้ำหนักที่นับ (กก.)","Counted weight (kg)")} normalize={trimWeight} rules={[{required:true},kgRule]}><Input inputMode="decimal"/></Form.Item>
            {kind==="LIVE" && <Form.Item {...rest} name={[name,"unitPricePerKg"]} label={L("ราคาตามบิล (บาท/กก.)","Bill rate (THB/kg)")}><Input inputMode="decimal"/></Form.Item>}
            <Form.Item {...rest} name={[name,"purchaseAmount"]} label={kind==="LIVE"?L("ยอดค่าปลาตามบิล (บาท)","Reviewed goods amount (THB)"):L("มูลค่าสต็อกที่นับ (บาท)","Opening stock value (THB)")} rules={[{required:true}]}><Input inputMode="decimal"/></Form.Item>
            {kind==="LIVE" && <Form.Item {...rest} name={[name,"extraAmount"]} label={L("ต้นทุนเพิ่มที่ตรวจแล้ว (บาท)","Reviewed additional cost (THB)")}><Input inputMode="decimal"/></Form.Item>}
            <Form.Item {...rest} name={[name,"lotNo"]} label={L("เลขล็อตของรายการนี้ (ว่าง = สร้างล็อตใหม่)","Lot ID for this line (blank = new lot)")}
              extra={L("แต่ละรายการที่ปล่อยว่างจะได้เลขล็อตแยกกันหลังยืนยัน","Each blank line gets a separate lot ID after confirmation")}><Input maxLength={120}/></Form.Item>
            <Form.Item {...rest} name={[name,"expiryDate"]} label={L("วันหมดอายุ ถ้าติดตาม","Expiry date if tracked")}><Input type="date"/></Form.Item>
            <Form.Item {...rest} name={[name,"quality"]} label={L("สภาพ/เกรดปลา","Quality/grade")}><Input maxLength={200}/></Form.Item>
          </Space>
          <Form.Item {...rest} name={[name,"note"]} label={L("หมายเหตุ","Note")}><Input maxLength={1000}/></Form.Item>
        </Card>)}
        <Button icon={<PlusOutlined/>} onClick={()=>add({extraAmount:"0"})}>{L("เพิ่มรายการรับ / ล็อต","Add receipt line / lot")}</Button>
      </Space>}</Form.List>
      <Form.Item name="note" label={L("หมายเหตุทั้งใบ","Receipt note")} style={{marginTop:16}}><Input maxLength={1000}/></Form.Item>
      <Space wrap>
        <Button loading={busy} onClick={()=>void send("preview")}>{L("ตรวจยอดก่อนบันทึก","Preview totals")}</Button>
        <Button type="primary" disabled={!preview||!canCommit||options.currency!=="THB"} loading={busy} onClick={()=>void confirm()}>{L("ยืนยันและเพิ่มสต็อก","Confirm and add stock")}</Button>
      </Space>
      {options.currency!=="THB" && <Typography.Text type="danger" style={{display:"block",marginTop:8}}>
        {L("ปุ่มยืนยันใช้ได้หลัง Administrator บันทึกสกุลเงิน บาท (THB) ในข้อมูลร้าน แล้วรีเฟรชหน้านี้",
          "To enable confirmation, an Administrator must save THB in the store profile, then refresh this page.")}
      </Typography.Text>}
      {!canCommit&&<Typography.Text type="secondary" style={{display:"block",marginTop:8}}>
        {kind==="LIVE"?L("การรับปลาต้องมี purchase.edit และ purchase.receive","Receiving requires purchase.edit and purchase.receive"):
          L("ยอดตั้งต้นต้องมี inventory.count.apply และ report.view","Opening stock requires inventory.count.apply and report.view")}
      </Typography.Text>}
    </Form>
    {preview && <Alert showIcon closable type="info" message={L("ยอดที่ตรวจแล้ว","Reviewed totals")}
      description={`${preview.totals.lineCount} ${L("รายการ","lines")} · ${kind==="LIVE"?`${L("ตามบิล","bill")} ${formatKg(preview.totals.billGrams)} → `:""}${L("รับจริง","actual")} ${formatKg(preview.totals.receivedGrams)} · ${Number(preview.totals.purchaseAmount).toLocaleString()} ฿${kind==="LIVE"?` + ${Number(preview.totals.extraAmount).toLocaleString()} ฿`:""}`} />}
    {saved && <Alert showIcon closable type="success" message={L(saved.status==="REPLAYED"?"รายการนี้เคยบันทึกแล้ว":"บันทึกสำเร็จ",saved.status==="REPLAYED"?"This request was already saved":"Saved")}
      description={<Space wrap>{saved.intakeId}<Button type="link" onClick={()=>onOpenDetail(saved.intakeId)}>{L("ดูรายละเอียดและเลขล็อต","View details and lot IDs")}</Button></Space>} />}
  </Space>;
}

export default function FishIntakePage() {
  const {lang,t}=useI18n();
  const L=(th:string,en:string)=>lang==="en"?en:th;
  const costCategoryLabel=(category:string)=>({TRANSPORT:L("ค่าขนส่ง","Transport"),ICE:L("ค่าน้ำแข็ง","Ice"),
    HANDLING:L("ค่าขนถ่าย","Handling"),OTHER:L("อื่น ๆ","Other")})[category as "TRANSPORT"|"ICE"|"HANDLING"|"OTHER"]??category;
  const {can,loading:permissionsLoading}=useBmsPermissions();
  const [options,setOptions]=useState<Options>({locations:[],products:[],unreadyProducts:[],currency:null});
  const [recent,setRecent]=useState<Array<{id:string;kind:FishIntakeKind;createdAt:string;lineCount:number;receivedGrams:number;purchaseAmount:string;sourceName:string|null}>>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [detailId,setDetailId]=useState<string|null>(null);
  const [detail,setDetail]=useState<IntakeDetail|null>(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [detailError,setDetailError]=useState<string|null>(null);
  const [costOpen,setCostOpen]=useState(false);
  const [costLine,setCostLine]=useState<number|null>(null);
  const [costCategory,setCostCategory]=useState("TRANSPORT");
  const [costAmount,setCostAmount]=useState("");
  const [costReason,setCostReason]=useState("");
  const [costReference,setCostReference]=useState("");
  const [costKey,setCostKey]=useState(()=>crypto.randomUUID());
  const [costPreview,setCostPreview]=useState<LateCostPreview|null>(null);
  const [costBusy,setCostBusy]=useState(false);
  const [costError,setCostError]=useState<string|null>(null);
  const [costResult,setCostResult]=useState<string|null>(null);
  async function openDetail(id:string,resetCost=true) {
    if (resetCost) {setCostOpen(false);setCostPreview(null);setCostError(null);setCostResult(null);
      setCostAmount("");setCostReason("");setCostReference("");setCostKey(crypto.randomUUID());}
    setDetailId(id);setDetail(null);setDetailError(null);setDetailLoading(true);
    try {
      const item=await readJson(await fetch(`/api/bms/fish-intake/${encodeURIComponent(id)}`,{credentials:"include"}),lang) as IntakeDetail;
      setDetail(item);setCostLine(item.lines[0]?.lineNo??null);
    } catch(e) {setDetailError(operatorMessage(e,t));}
    finally {setDetailLoading(false);}
  }
  async function sendLateCost(action:"preview"|"commit",confirmed=false) {
    if (!detail || costLine==null) return;
    setCostBusy(true);setCostError(null);setCostResult(null);
    try {
      const response=await fetch(`/api/bms/fish-intake/${encodeURIComponent(detail.id)}/late-cost`,{
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action,confirmed,previewHash:costPreview?.previewHash,
          input:{lineNo:costLine,category:costCategory,amount:costAmount,reason:costReason,
            reference:costReference,requestKey:costKey}}),
      });
      const result=await response.json().catch(()=>null);
      if (!response.ok) {
        if (response.status===401) throw new Error(L("กรุณาเข้าสู่ระบบอีกครั้ง","Please sign in again"));
        if (response.status===403) throw new Error(L("ไม่มีสิทธิ์เพิ่มต้นทุน","You cannot add receipt cost"));
        if (result?.code==="PREVIEW_STALE") {setCostPreview(null);throw new Error(L("ยอดต้นทุนเปลี่ยนแล้ว กรุณาตรวจยอดอีกครั้ง","Cost changed. Preview again."));}
        if (result?.code==="IDEMPOTENCY_CONFLICT") throw new Error(L("รหัสคำขอนี้เคยใช้กับข้อมูลอื่นแล้ว","This request key was used for different details."));
        if (result?.code==="LATER_STOCK_ACTIVITY_REVIEW_REQUIRED") throw new Error(L(
          "มีการขาย คืน รับเพิ่ม หรือปรับสต็อกหลังใบนี้ จึงยังเพิ่มต้นทุนย้อนหลังอัตโนมัติไม่ได้",
          "Stock moved after this receipt. A manual cost review is required."));
        if (result?.code==="STOCK_ALREADY_CONSUMED") throw new Error(L("สต็อกขายหรือใช้หมดแล้ว ต้องตรวจต้นทุนย้อนหลัง","Stock is fully consumed. Historical cost review is required."));
        if (lang==="en") {
          const errors:Record<string,string>={INVALID_LINE:"Choose a valid receipt line.",INVALID_CATEGORY:"Choose a valid cost category.",
            INVALID_AMOUNT:"Enter more than 0 THB with at most two decimal places.",INVALID_REASON:"Enter a reason of at most 1,000 characters.",
            INVALID_REFERENCE:"The evidence reference must be at most 200 characters.",INVALID_KEY:"Invalid request key.",
            INVALID_INTAKE:"Invalid receipt ID.",INTAKE_LINE_NOT_FOUND:"This LIVE receipt line is unavailable.",
            VALUATION_UNKNOWN:"Inventory value is unknown. Cost cannot be added.",
            STOCK_REVIEW_REQUIRED:"Inventory and valuation quantities differ. Review them first.",
            LOT_REVIEW_REQUIRED:"Lot and stock quantities differ. Review them first.",
            MOVEMENT_REVIEW_REQUIRED:"Receipt stock evidence is incomplete.",
            VALUATION_SOURCE_REVIEW_REQUIRED:"Original receipt valuation evidence is incomplete."};
          errors.STORE_CURRENCY_REQUIRED="Set the store currency to THB before adding fish cost.";
          if (typeof result?.code==="string"&&errors[result.code]) throw new Error(errors[result.code]);
        }
        throw new Error(result?.error??L("บันทึกไม่สำเร็จ","Could not save"));
      }
      if (result.status==="REPLAYED") {
        setCostResult(L("คำขอนี้เคยบันทึกแล้ว ไม่เพิ่มต้นทุนซ้ำ","Already saved. No duplicate cost added."));
        setCostPreview(null);setCostKey(crypto.randomUUID());setCostOpen(false);
        setCostAmount("");setCostReason("");setCostReference("");
        await openDetail(detail.id,false);
      } else if (action==="preview") setCostPreview(result as LateCostPreview);
      else {
        setCostResult(result.status==="REPLAYED"?L("คำขอนี้เคยบันทึกแล้ว ไม่เพิ่มต้นทุนซ้ำ","Already saved. No duplicate cost added."):
          L("เพิ่มต้นทุนสำเร็จ","Cost added"));
        setCostPreview(null);setCostKey(crypto.randomUUID());setCostOpen(false);
        setCostAmount("");setCostReason("");setCostReference("");
        await openDetail(detail.id,false);
      }
    } catch(e) {setCostError(e instanceof Error?e.message:String(e));}
    finally {setCostBusy(false);}
  }
  function changeCost(update:()=>void) {update();setCostPreview(null);setCostError(null);}
  async function searchProducts(search:string) {
    if (search.trim().length<2) return;
    try {
      const result=await readJson(await fetch(`/api/bms/fish-intake/options?search=${encodeURIComponent(search)}`,{credentials:"include"}),lang) as Options;
      setOptions(current=>{
        const products=new Map(current.products.map(p=>[JSON.stringify([p.sku,p.size]),p]));
        for (const product of result.products) products.set(JSON.stringify([product.sku,product.size]),product);
        const unreadyProducts=new Map(current.unreadyProducts.map(p=>[p.sku,p]));
        for (const product of result.unreadyProducts??[]) unreadyProducts.set(product.sku,product);
        return {...current,products:[...products.values()],unreadyProducts:[...unreadyProducts.values()]};
      });
    } catch(e) {message.error(operatorMessage(e,t));}
  }
  async function refresh() {
    try {
      const o=await readJson(await fetch("/api/bms/fish-intake/options",{credentials:"include"}),lang);
      setOptions({...o,unreadyProducts:o.unreadyProducts??[]});
      const recentResponse=await fetch("/api/bms/fish-intake",{credentials:"include"});
      if (recentResponse.status!==403) {
        const r=await readJson(recentResponse,lang);
        setRecent(r.items);
      }
      setError(null);
    } catch(e) {setError(operatorMessage(e,t));}
    finally {setLoading(false);}
  }
  useEffect(()=>{void refresh();},[]);
  const tabs=[];
  if (can("purchase.view")) tabs.push({key:"history",label:L("นำเข้าประวัติ Excel","Historical Excel import"),
    children:<HistoryImport canCommit={can("purchase.edit")} onSaved={()=>void refresh()} onOpenDetail={id=>void openDetail(id)}/>});
  if (can("purchase.view")) tabs.push({key:"live",label:L("รับปลาใหม่","New fish receipt"),
    children:<StockEntry kind="LIVE" options={options} canCommit={can("purchase.edit")&&can("purchase.receive")}
      onSearchProducts={search=>void searchProducts(search)} onSaved={()=>void refresh()} onOpenDetail={id=>void openDetail(id)}/>});
  if (can("inventory.count")) tabs.push({key:"opening",label:L("ยอดสต็อกวันแรก","Opening stock"),
    children:<StockEntry kind="OPENING" options={options} canCommit={can("inventory.count.apply")&&can("report.view")}
      onSearchProducts={search=>void searchProducts(search)} onSaved={()=>void refresh()} onOpenDetail={id=>void openDetail(id)}/>});
  return <Space direction="vertical" size="large" style={{width:"100%"}}>
    <AdminPageHeader title={L("ล้งปลา: รับปลาและประวัติ","Fish dock: receipts and history")}/>
    {error && <Alert type="error" showIcon closable message={error} />}
    {!permissionsLoading&&tabs.length===0 && <Alert type="warning" showIcon closable message={L("ไม่มีสิทธิ์ใช้งานหน้านี้","No permission for this page")}/ >}
    <Card loading={loading}><Tabs items={tabs}/></Card>
    {(can("purchase.view")||can("inventory.count"))&&<Card title={L("รายการล่าสุด","Recent records")} extra={<Button icon={<ReloadOutlined/>} onClick={()=>void refresh()}>{L("โหลดใหม่","Refresh")}</Button>}>
      <Table rowKey="id" dataSource={recent} pagination={{pageSize:10}} scroll={{x:700}} columns={[
        {title:L("เวลา","Time"),dataIndex:"createdAt",render:(v:string)=>new Date(v).toLocaleString(lang==="en"?"en-GB":"th-TH")},
        {title:L("ประเภท","Type"),dataIndex:"kind",render:(v:FishIntakeKind)=>v==="HISTORICAL"?L("ประวัติ","History"):v==="OPENING"?L("ยอดตั้งต้น","Opening"):L("รับปลา","Receipt")},
        {title:L("แถว","Lines"),dataIndex:"lineCount"},
        {title:L("น้ำหนักรับ","Received"),dataIndex:"receivedGrams",render:(v:number)=>formatKg(v)},
        {title:L("ยอดซื้อ/มูลค่า","Amount/value"),dataIndex:"purchaseAmount",render:(v:string)=>`${Number(v).toLocaleString()} ฿`},
        {title:L("ไฟล์","File"),dataIndex:"sourceName",render:(v:string|null)=>v??"—"},
        {title:L("รายละเอียด","Details"),key:"detail",render:(_:unknown,r:{id:string})=><Button type="link" onClick={()=>void openDetail(r.id)}>{L("ดูรายการ / ล็อต","View lines / lots")}</Button>},
      ]}/>
    </Card>}
    <Modal open={detailId!==null} onCancel={()=>setDetailId(null)} footer={null} width={900} centered
      title={L("รายละเอียดใบรับปลา","Fish intake details")} styles={{body:{maxHeight:"70vh",overflowY:"auto"}}}>
      {detailError && <Alert closable type="error" showIcon message={detailError}/>}
      {detailLoading && <Card loading/>}
      {detail && <Space direction="vertical" size="middle" style={{width:"100%"}}>
        <Typography.Text copyable>{detail.id}</Typography.Text>
        {detail.kind==="LIVE"&&can("purchase.view")&&can("purchase.edit")&&
          <Button onClick={()=>{setCostOpen(value=>!value);setCostError(null);setCostResult(null);}}>
            {L("เพิ่มค่าใช้จ่ายที่ลืมลง","Add forgotten cost")}</Button>}
        {detail.kind==="LIVE"&&can("purchase.view")&&!can("purchase.edit")&&
          <Typography.Text type="secondary">{L("การเพิ่มค่าใช้จ่ายต้องมีสิทธิ์ purchase.edit","Adding cost requires purchase.edit permission")}</Typography.Text>}
        {costResult&&<Alert type="success" showIcon closable message={costResult}/>}
        {costOpen&&detail.kind==="LIVE"&&<Card size="small" title={L("เพิ่มค่าใช้จ่ายในใบรับปลา","Add receipt cost")}>
          <Space direction="vertical" style={{width:"100%"}}>
            <Typography.Text>{L("รายการรับปลา / ล็อต","Receipt line / lot")}</Typography.Text>
            <Select aria-label={L("รายการรับปลา / ล็อต","Receipt line / lot")} style={{width:"100%"}} value={costLine} onChange={v=>changeCost(()=>setCostLine(v))}
              options={detail.lines.map(line=>({value:line.lineNo,label:`${L("รายการ","Line")} ${line.lineNo} · ${line.fishName} · ${line.lotNo??"—"}`}))}/>
            <Typography.Text>{L("ประเภทค่าใช้จ่าย","Cost category")}</Typography.Text>
            <Select aria-label={L("ประเภทค่าใช้จ่าย","Cost category")} style={{width:"100%"}} value={costCategory} onChange={v=>changeCost(()=>setCostCategory(v))}
              options={[["TRANSPORT",L("ค่าขนส่ง","Transport")],["ICE",L("ค่าน้ำแข็ง","Ice")],
                ["HANDLING",L("ค่าขนถ่าย","Handling")],["OTHER",L("อื่น ๆ","Other")]].map(([value,label])=>({value,label}))}/>
            <Typography.Text>{L("จำนวนเงินที่เพิ่ม (บาท)","Added amount (THB)")}</Typography.Text>
            <Input aria-label={L("จำนวนเงินที่เพิ่ม (บาท)","Added amount (THB)")} value={costAmount} onChange={e=>changeCost(()=>setCostAmount(e.target.value))}
              placeholder={L("จำนวนเงินเพิ่ม (บาท)","Added amount (THB)")} inputMode="decimal"/>
            <Typography.Text>{L("เหตุผล (บังคับ)","Reason (required)")}</Typography.Text>
            <Input.TextArea aria-label={L("เหตุผล (บังคับ)","Reason (required)")} value={costReason} onChange={e=>changeCost(()=>setCostReason(e.target.value))}
              maxLength={1000} placeholder={L("เหตุผลที่เพิ่มค่าใช้จ่าย (บังคับ)","Reason (required)")}/>
            <Typography.Text>{L("หลักฐานอ้างอิง (ถ้ามี)","Evidence reference (optional)")}</Typography.Text>
            <Input aria-label={L("หลักฐานอ้างอิง (ถ้ามี)","Evidence reference (optional)")} value={costReference} onChange={e=>changeCost(()=>setCostReference(e.target.value))}
              maxLength={200} placeholder={L("เลขที่ใบเสร็จหรือหลักฐานอ้างอิง (ถ้ามี)","Receipt or evidence reference (optional)")}/>
            {costError&&<Alert type="error" showIcon closable message={costError}/>}
            {costPreview&&<Alert type="info" showIcon closable message={L("ผลตรวจยอดก่อนยืนยัน","Review before confirmation")}
              description={<Space direction="vertical">
                <span>{L("ต้นทุนเพิ่มเดิม","Original extra cost")}: {costPreview.originalExtraAmount} ฿</span>
                <span>{L("ปรับปรุงก่อนหน้า","Prior adjustments")}: {costPreview.priorAdjustments} ฿</span>
                <span>{L("ต้นทุนเพิ่มปัจจุบัน","Current extra cost")}: {costPreview.currentExtraCost} ฿</span>
                <span>{L("เพิ่มครั้งนี้","Add now")}: {costPreview.addedAmount} ฿</span>
                <strong>{L("ต้นทุนเพิ่มใหม่","New extra cost")}: {costPreview.newExtraCost} ฿</strong>
                <span>{L("มูลค่าสต็อกก่อน → หลัง","On-hand value before → after")}: {costPreview.valuationBefore} → {costPreview.valuationAfter} ฿</span>
                <span>{L("ปริมาณสต็อกไม่เปลี่ยน","Stock quantity unchanged")}</span>
                <span>{L("ต้นทุนขายในอนาคตจะใช้มูลค่าเฉลี่ยใหม่","Future COGS uses the new moving-average value")}</span>
              </Space>}/>}
            <Space wrap><Button loading={costBusy} onClick={()=>void sendLateCost("preview")}>{L("ตรวจยอดก่อนยืนยัน","Preview totals")}</Button>
              <Button type="primary" disabled={!costPreview||costBusy} onClick={()=>Modal.confirm({
                title:L("ยืนยันเพิ่มต้นทุนปลา","Confirm added fish cost"),
                content:L(`เพิ่ม ${costPreview?.addedAmount} บาทในรายการ ${costLine} โดยไม่บันทึกการจ่ายเงินหรือเจ้าหนี้`,
                  `Add ${costPreview?.addedAmount} THB to line ${costLine} without creating payment or payable?`),
                okText:L("ยืนยัน","Confirm"),onOk:()=>sendLateCost("commit",true),
              })}>{L("ยืนยันเพิ่มค่าใช้จ่าย","Confirm added cost")}</Button></Space>
          </Space>
        </Card>}
        <Descriptions size="small" column={{xs:1,sm:2}} items={[
          {key:"kind",label:L("ประเภท","Type"),children:detail.kind==="HISTORICAL"?L("ประวัติ","History"):detail.kind==="OPENING"?L("ยอดตั้งต้น","Opening"):L("รับปลา","Receipt")},
          {key:"created",label:L("เวลาบันทึก","Saved at"),children:new Date(detail.createdAt).toLocaleString(lang==="en"?"en-GB":"th-TH")},
          {key:"branch",label:L("สาขา","Branch"),children:detail.locationName??"—"},
          {key:"lines",label:L("จำนวนรายการ","Lines"),children:detail.lines.length},
          ...(detail.kind!=="HISTORICAL"?[{key:"lots",label:L("จำนวนล็อตในใบรับ","Distinct receipt lots"),
            children:new Set(detail.lines.filter(line=>line.lotNo).map(line=>JSON.stringify([line.sku,line.size,line.lotNo]))).size}]:[]),
          ...(detail.sourceName?[{key:"source",label:L("ไฟล์ต้นทาง","Source file"),children:detail.sourceName}]:[]),
          ...(detail.sourceSheet?[{key:"sheet",label:L("ชีต","Sheet"),children:detail.sourceSheet}]:[]),
          ...(detail.sourceYear?[{key:"year",label:L("ปีข้อมูล","Source year"),children:detail.sourceYear}]:[]),
          ...(detail.note?[{key:"note",label:L("หมายเหตุทั้งใบ","Receipt note"),children:detail.note}]:[]),
        ]}/>
        {detail.kind!=="HISTORICAL" && <Alert closable type="info" showIcon
          message={L("เลขล็อตด้านล่างเป็นเลขที่บันทึกตอนรับเข้า น้ำหนักคงเหลืออาจเปลี่ยนหลังมีการขายหรือปรับสต็อก",
            "Lot IDs below are from this receipt. Current balances may have changed after sales or stock adjustments.")}/>}
        {detail.kind==="LIVE"&&<Card size="small" title={L("ประวัติการเพิ่มค่าใช้จ่าย","Cost adjustment history")}>
          {detail.adjustments.length===0?<Typography.Text type="secondary">{L("ยังไม่มีรายการปรับปรุง","No adjustments yet")}</Typography.Text>:
            <List dataSource={detail.adjustments} renderItem={adjustment=><List.Item>
              <Space direction="vertical"><strong>{`${L("รายการ","Line")} ${adjustment.lineNo} · ${adjustment.amount} ฿ · ${costCategoryLabel(adjustment.category)}`}</strong>
                <span>{adjustment.reason}{adjustment.reference?` · ${adjustment.reference}`:""}</span>
                <Typography.Text type="secondary">{adjustment.actorName??adjustment.actorId} · {new Date(adjustment.createdAt).toLocaleString(lang==="en"?"en-GB":"th-TH")}</Typography.Text>
              </Space></List.Item>}/>}
        </Card>}
        <List dataSource={detail.lines} pagination={{pageSize:10,hideOnSinglePage:true}}
          renderItem={line=><List.Item style={{display:"block",paddingInline:0}}>
            <Card size="small" title={`${L("รายการ","Line")} ${line.lineNo} · ${line.fishName}`}>
              <Descriptions size="small" column={{xs:1,sm:2}} items={[
                ...(line.sourceRow!=null?[{key:"sourceRow",label:L("แถวในไฟล์","Source row"),children:line.sourceRow}]:[]),
                {key:"product",label:L("สินค้า / ไซซ์","Product / size"),children:line.sku?`${line.sku} / ${line.size}`:"—"},
                {key:"lot",label:L("เลขล็อต","Lot ID"),children:line.lotNo?<Typography.Text code copyable>{line.lotNo}</Typography.Text>:"—"},
                {key:"billDate",label:L("วันที่บิล","Bill date"),children:line.billDate??"—"},
                {key:"receivedDate",label:L("วันที่รับ","Received date"),children:line.receivedDate??"—"},
                {key:"supplier",label:L("แพ / ผู้ขาย","Supplier"),children:line.supplierName??"—"},
                {key:"vessel",label:L("ทะเบียนเรือ / รถ","Vessel / vehicle"),children:line.vesselRegistration??"—"},
                {key:"billSize",label:L("ไซซ์ตามบิล","Bill size"),children:line.billSize??"—"},
                {key:"size",label:L("ไซซ์รับจริง","Actual size"),children:line.actualSize??line.size??"—"},
                {key:"billKg",label:L("น้ำหนักตามบิล","Bill weight"),children:line.billGrams==null?"—":formatKg(line.billGrams)},
                {key:"receivedKg",label:L("น้ำหนักรับจริง","Received weight"),children:formatKg(line.receivedGrams)},
                {key:"rate",label:L("ราคาตามบิล / กก.","Bill rate / kg"),children:line.unitPricePerKg==null?"—":`${Number(line.unitPricePerKg).toLocaleString()} ฿`},
                {key:"amount",label:L("ยอดค่าปลา / มูลค่า","Fish amount / value"),children:`${Number(line.purchaseAmount).toLocaleString()} ฿`},
                {key:"extra",label:L("ต้นทุนเพิ่มตอนรับ","Original additional cost"),children:`${Number(line.extraAmount).toLocaleString()} ฿`},
                {key:"late",label:L("เพิ่มภายหลัง","Added later"),children:`${formatCents(detail.adjustments.filter(a=>a.lineNo===line.lineNo).reduce((sum,a)=>sum+moneyCents(a.amount),0n))} ฿`},
                {key:"totalExtra",label:L("ต้นทุนเพิ่มรวม","Total additional cost"),children:`${formatCents(detail.adjustments.filter(a=>a.lineNo===line.lineNo).reduce((sum,a)=>sum+moneyCents(a.amount),moneyCents(line.extraAmount)))} ฿`},
                {key:"expiry",label:L("วันหมดอายุ","Expiry date"),children:line.expiryDate??"—"},
                {key:"quality",label:L("สภาพ / เกรด","Quality / grade"),children:line.quality??"—"},
                {key:"note",label:L("หมายเหตุ","Note"),children:line.note??"—"},
              ]}/>
            </Card>
          </List.Item>}/>
      </Space>}
    </Modal>
  </Space>;
}
