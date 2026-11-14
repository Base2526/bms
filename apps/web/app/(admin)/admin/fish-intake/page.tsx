"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Typography, message } from "antd";
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import type { FishIntakeInput, FishIntakeKind, FishIntakeLineInput } from "@/lib/bms/fishIntake";

type Options={locations:Array<{id:string;name:string}>;products:Array<{sku:string;name:string;size:string;expiry_tracking:boolean}>};
type Issue={row:number;field:"billDate"|"receivedDate"|"duplicate"|"line";value:string;message:string};
type ImportPreview={previewHash:string;rowCount:number;readyCount:number;issues:Issue[];
  totals:{billKg:string;receivedKg:string;purchaseAmount:string};
  fishNames:Array<{name:string;count:number}>;
  sample:Array<{row:number;billDate:string;receivedDate:string;supplierName:string;fishName:string;receivedKg:string;purchaseAmount:string}>};
type Saved={status:"SAVED"|"REPLAYED";intakeId:string;lineCount:number;billGrams:number;receivedGrams:number;purchaseAmount:string;extraAmount:string};

async function readJson(response:Response) {
  const result=await response.json().catch(()=>({error:"Server response is unavailable"}));
  if (!response.ok) throw new Error(result.error??String(response.status));
  return result;
}
const formatKg=(grams:number)=>`${(grams/1000).toLocaleString(undefined,{maximumFractionDigits:3})} kg`;

function HistoryImport({onSaved,canCommit}:{onSaved:()=>void;canCommit:boolean}) {
  const {lang}=useI18n();
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
      const result=await readJson(await fetch("/api/bms/fish-intake/import",{method:"POST",body,credentials:"include"}));
      setSheets(result.sheets);setSheet(result.suggestedSheet??"");
    } catch(error) { message.error((error as Error).message); }
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
      const result=await readJson(await fetch("/api/bms/fish-intake/import",{method:"POST",body,credentials:"include"}));
      if (action==="preview") {setPreview(result);setDirty(false);setSaved(null);}
      else {setSaved(result);message.success(L("บันทึกประวัติแล้ว","Historical records saved"));onSaved();}
    } catch(error) {message.error((error as Error).message);}
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
      description={L("เลือกแท็บรายการหลักเพียงแท็บเดียว ตรวจวันที่ที่ไม่ชัดเจน แล้วดูยอดก่อนยืนยัน","Select one primary detail sheet, review ambiguous dates, then confirm the totals.")} />
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
        <Typography.Title level={5}>{L("แก้วันที่ที่ไม่ชัดเจนทีละแถว","Review ambiguous dates by row")}</Typography.Title>
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
      description={`${saved.lineCount.toLocaleString()} ${L("แถว","rows")} · ${saved.intakeId}`} />}
  </Space>;
}

function StockEntry({kind,options,onSaved,onSearchProducts,canCommit}:{kind:"LIVE"|"OPENING";options:Options;onSaved:()=>void;onSearchProducts:(search:string)=>void;canCommit:boolean}) {
  const {lang}=useI18n();
  const L=(th:string,en:string)=>lang==="en"?en:th;
  const [form]=Form.useForm();
  const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
  const [preview,setPreview]=useState<{previewHash:string;totals:{lineCount:number;billGrams:number;receivedGrams:number;purchaseAmount:string;extraAmount:string}}|null>(null);
  const [busy,setBusy]=useState(false);
  const [saved,setSaved]=useState<Saved|null>(null);
  const [productSearch,setProductSearch]=useState("");
  const productByKey=new Map(options.products.map(p=>[JSON.stringify([p.sku,p.size]),p]));
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
          confirmed:action==="commit",previewHash:hash})}));
      if (action==="preview") {setPreview(result);setSaved(null);}
      else {setSaved(result);setPreview(null);message.success(L("บันทึกสำเร็จ","Saved"));onSaved();
        form.resetFields();setRequestKey(crypto.randomUUID());}
    } catch(error) {message.error((error as Error).message);}
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
    {options.products.length===0 && <Alert showIcon closable type="warning" message={L("ยังไม่มีปลาที่ตั้งค่าเป็นสินค้าชั่งน้ำหนักพร้อมติดตามล็อต","No weighted, lot tracked products are configured")}/ >}
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
                options={options.products.filter(p=>!productSearch || `${p.name} ${p.size} ${p.sku}`.toLocaleLowerCase().includes(productSearch.toLocaleLowerCase()))
                  .map(p=>({value:JSON.stringify([p.sku,p.size]),label:`${p.name} · ${p.size} (${p.sku})`}))}/>
            </Form.Item>
            {kind==="LIVE" && <Form.Item {...rest} name={[name,"billSize"]} label={L("ไซซ์ตามบิล","Bill size")}><Input maxLength={100}/></Form.Item>}
            {kind==="LIVE" && <Form.Item {...rest} name={[name,"billKg"]} label={L("น้ำหนักตามบิล (กก.)","Bill weight (kg)")} rules={[{required:true}]}><Input inputMode="decimal"/></Form.Item>}
            <Form.Item {...rest} name={[name,"receivedKg"]} label={kind==="LIVE"?L("น้ำหนักรับจริง (กก.)","Received weight (kg)"):L("น้ำหนักที่นับ (กก.)","Counted weight (kg)")} rules={[{required:true}]}><Input inputMode="decimal"/></Form.Item>
            {kind==="LIVE" && <Form.Item {...rest} name={[name,"unitPricePerKg"]} label={L("ราคาตามบิล (บาท/กก.)","Bill rate (THB/kg)")}><Input inputMode="decimal"/></Form.Item>}
            <Form.Item {...rest} name={[name,"purchaseAmount"]} label={kind==="LIVE"?L("ยอดค่าปลาตามบิล (บาท)","Reviewed goods amount (THB)"):L("มูลค่าสต็อกที่นับ (บาท)","Opening stock value (THB)")} rules={[{required:true}]}><Input inputMode="decimal"/></Form.Item>
            {kind==="LIVE" && <Form.Item {...rest} name={[name,"extraAmount"]} label={L("ต้นทุนเพิ่มที่ตรวจแล้ว (บาท)","Reviewed additional cost (THB)")}><Input inputMode="decimal"/></Form.Item>}
            <Form.Item {...rest} name={[name,"lotNo"]} label={L("เลขล็อต (ว่าง = ระบบสร้าง)","Lot ID (blank = generated)")}><Input maxLength={120}/></Form.Item>
            <Form.Item {...rest} name={[name,"expiryDate"]} label={L("วันหมดอายุ ถ้าติดตาม","Expiry date if tracked")}><Input type="date"/></Form.Item>
            <Form.Item {...rest} name={[name,"quality"]} label={L("สภาพ/เกรดปลา","Quality/grade")}><Input maxLength={200}/></Form.Item>
          </Space>
          <Form.Item {...rest} name={[name,"note"]} label={L("หมายเหตุ","Note")}><Input maxLength={1000}/></Form.Item>
        </Card>)}
        <Button icon={<PlusOutlined/>} onClick={()=>add({extraAmount:"0"})}>{L("เพิ่มชนิดปลา","Add fish line")}</Button>
      </Space>}</Form.List>
      <Form.Item name="note" label={L("หมายเหตุทั้งใบ","Receipt note")} style={{marginTop:16}}><Input maxLength={1000}/></Form.Item>
      <Space wrap>
        <Button loading={busy} onClick={()=>void send("preview")}>{L("ตรวจยอดก่อนบันทึก","Preview totals")}</Button>
        <Button type="primary" disabled={!preview||!canCommit} loading={busy} onClick={()=>void confirm()}>{L("ยืนยันและเพิ่มสต็อก","Confirm and add stock")}</Button>
      </Space>
      {!canCommit&&<Typography.Text type="secondary" style={{display:"block",marginTop:8}}>
        {kind==="LIVE"?L("การรับปลาต้องมี purchase.edit และ purchase.receive","Receiving requires purchase.edit and purchase.receive"):
          L("ยอดตั้งต้นต้องมี inventory.count.apply และ report.view","Opening stock requires inventory.count.apply and report.view")}
      </Typography.Text>}
    </Form>
    {preview && <Alert showIcon closable type="info" message={L("ยอดที่ตรวจแล้ว","Reviewed totals")}
      description={`${preview.totals.lineCount} ${L("รายการ","lines")} · ${kind==="LIVE"?`${L("ตามบิล","bill")} ${formatKg(preview.totals.billGrams)} → `:""}${L("รับจริง","actual")} ${formatKg(preview.totals.receivedGrams)} · ${Number(preview.totals.purchaseAmount).toLocaleString()} ฿${kind==="LIVE"?` + ${Number(preview.totals.extraAmount).toLocaleString()} ฿`:""}`} />}
    {saved && <Alert showIcon closable type="success" message={L(saved.status==="REPLAYED"?"รายการนี้เคยบันทึกแล้ว":"บันทึกสำเร็จ",saved.status==="REPLAYED"?"This request was already saved":"Saved")}
      description={saved.intakeId} />}
  </Space>;
}

export default function FishIntakePage() {
  const {lang}=useI18n();
  const L=(th:string,en:string)=>lang==="en"?en:th;
  const {can,loading:permissionsLoading}=useBmsPermissions();
  const [options,setOptions]=useState<Options>({locations:[],products:[]});
  const [recent,setRecent]=useState<Array<{id:string;kind:FishIntakeKind;createdAt:string;lineCount:number;receivedGrams:number;purchaseAmount:string;sourceName:string|null}>>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  async function searchProducts(search:string) {
    if (search.trim().length<2) return;
    try {
      const result=await readJson(await fetch(`/api/bms/fish-intake/options?search=${encodeURIComponent(search)}`,{credentials:"include"})) as Options;
      setOptions(current=>{
        const products=new Map(current.products.map(p=>[JSON.stringify([p.sku,p.size]),p]));
        for (const product of result.products) products.set(JSON.stringify([product.sku,product.size]),product);
        return {...current,products:[...products.values()]};
      });
    } catch(e) {message.error((e as Error).message);}
  }
  async function refresh() {
    try {
      const o=await readJson(await fetch("/api/bms/fish-intake/options",{credentials:"include"}));
      setOptions(o);
      const recentResponse=await fetch("/api/bms/fish-intake",{credentials:"include"});
      if (recentResponse.status!==403) {
        const r=await readJson(recentResponse);
        setRecent(r.items);
      }
      setError(null);
    } catch(e) {setError((e as Error).message);}
    finally {setLoading(false);}
  }
  useEffect(()=>{void refresh();},[]);
  const tabs=[];
  if (can("purchase.view")) tabs.push({key:"history",label:L("นำเข้าประวัติ Excel","Historical Excel import"),
    children:<HistoryImport canCommit={can("purchase.edit")} onSaved={()=>void refresh()}/>});
  if (can("purchase.view")) tabs.push({key:"live",label:L("รับปลาใหม่","New fish receipt"),
    children:<StockEntry kind="LIVE" options={options} canCommit={can("purchase.edit")&&can("purchase.receive")}
      onSearchProducts={search=>void searchProducts(search)} onSaved={()=>void refresh()}/>});
  if (can("inventory.count")) tabs.push({key:"opening",label:L("ยอดสต็อกวันแรก","Opening stock"),
    children:<StockEntry kind="OPENING" options={options} canCommit={can("inventory.count.apply")&&can("report.view")}
      onSearchProducts={search=>void searchProducts(search)} onSaved={()=>void refresh()}/>});
  return <Space direction="vertical" size="large" style={{width:"100%"}}>
    <AdminPageHeader title={L("ล้งปลา: รับปลาและประวัติ","Fish dock: receipts and history")}/>
    {error && <Alert type="error" showIcon closable message={error} />}
    {!permissionsLoading&&tabs.length===0 && <Alert type="warning" showIcon closable message={L("ไม่มีสิทธิ์ใช้งานหน้านี้","No permission for this page")}/ >}
    <Card loading={loading}><Tabs items={tabs}/></Card>
    {can("purchase.view")&&<Card title={L("รายการล่าสุด","Recent records")} extra={<Button icon={<ReloadOutlined/>} onClick={()=>void refresh()}>{L("โหลดใหม่","Refresh")}</Button>}>
      <Table rowKey="id" dataSource={recent} pagination={{pageSize:10}} scroll={{x:700}} columns={[
        {title:L("เวลา","Time"),dataIndex:"createdAt",render:(v:string)=>new Date(v).toLocaleString(lang==="en"?"en-GB":"th-TH")},
        {title:L("ประเภท","Type"),dataIndex:"kind",render:(v:FishIntakeKind)=>v==="HISTORICAL"?L("ประวัติ","History"):v==="OPENING"?L("ยอดตั้งต้น","Opening"):L("รับปลา","Receipt")},
        {title:L("แถว","Lines"),dataIndex:"lineCount"},
        {title:L("น้ำหนักรับ","Received"),dataIndex:"receivedGrams",render:(v:number)=>formatKg(v)},
        {title:L("ยอดซื้อ/มูลค่า","Amount/value"),dataIndex:"purchaseAmount",render:(v:string)=>`${Number(v).toLocaleString()} ฿`},
        {title:L("ไฟล์","File"),dataIndex:"sourceName",render:(v:string|null)=>v??"—"},
      ]}/>
    </Card>}
  </Space>;
}
