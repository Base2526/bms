"use client";

import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, message } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useState } from "react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";

const Q_BANKS = gql`query MasterBanks($search:String,$includeInactive:Boolean){bmsMasterBanks(search:$search,includeInactive:$includeInactive){id code countryCode nameTh nameEn swift active sortOrder source sourceVersion updatedAt}}`;
const Q_UNITS = gql`query MasterUnits($search:String,$includeInactive:Boolean){bmsMasterUnits(search:$search,includeInactive:$includeInactive){id code countryCode nameTh nameEn aliases kind baseFactor active source sourceVersion updatedAt}}`;
const Q_ADDRESSES = gql`query MasterAddresses($search:String,$includeInactive:Boolean){bmsMasterThaiAddresses(search:$search,includeInactive:$includeInactive,limit:500){level id code countryCode provinceCode districtCode nameTh nameEn postcode active source sourceVersion updatedAt}}`;
const Q_CARRIERS = gql`query MasterCarriers($includeInactive:Boolean){bmsMasterCarriers(includeInactive:$includeInactive){id code countryCode nameTh nameEn trackingUrlTemplate trackingNoPattern integrationStatus active source sourceVersion updatedAt}}`;
const Q_TAX = gql`query MasterTaxReferences{bmsMasterTaxReferences{documentTypes{id code nameTh nameEn bmsDocumentType effectiveFrom effectiveTo active source sourceVersion}vatRates{id countryCode rate effectiveFrom effectiveTo active source sourceVersion}buyerTypes{id code nameTh nameEn taxIdPolicy branchPolicy effectiveFrom effectiveTo active source sourceVersion}}}`;
const Q_BARCODES = gql`query MasterBarcodes($search:String,$status:String){bmsMasterBarcodes(search:$search,status:$status,limit:500){id barcode name brand sizeText unitCode categoryHint source confirmations status updatedAt}}`;
const M_BANK = gql`mutation SaveBank($input:BmsMasterBankInput!){bmsUpsertMasterBank(input:$input){id}}`;
const M_UNIT = gql`mutation SaveUnit($input:BmsMasterUnitInput!){bmsUpsertMasterUnit(input:$input){id}}`;
const M_ADDRESS = gql`mutation SaveAddress($input:BmsMasterThaiAddressInput!){bmsUpsertMasterThaiAddress(input:$input){id}}`;
const M_CARRIER = gql`mutation SaveCarrier($input:BmsMasterCarrierInput!){bmsUpsertMasterCarrier(input:$input){id}}`;
const M_BARCODE = gql`mutation ReviewBarcode($input:BmsMasterBarcodeReviewInput!){bmsReviewMasterBarcode(input:$input){id status}}`;

function SearchBar({ value, onChange, reload }: { value: string; onChange: (value: string) => void; reload: () => void }) {
  const { t } = useI18n();
  return <Space style={{ marginBottom: 16 }} wrap>
    <Input.Search allowClear value={value} onChange={(e) => onChange(e.target.value)} onSearch={reload} placeholder={t("admin_master_data.search")} style={{ width: 320 }} />
    <Button icon={<ReloadOutlined />} onClick={reload}>{t("admin_master_data.reload")}</Button>
  </Space>;
}

function BanksTab() {
  const { t } = useI18n();
  const [search, setSearch] = useState(""); const [open, setOpen] = useState(false); const [form] = Form.useForm();
  const query = useQuery(Q_BANKS, { variables: { search, includeInactive: true }, fetchPolicy: "cache-and-network" });
  const [save, state] = useMutation(M_BANK);
  const edit = (row?: any) => { form.resetFields(); form.setFieldsValue(row ?? { countryCode:"TH",active:true,sortOrder:0,source:"platform-admin",sourceVersion:new Date().toISOString().slice(0,10) }); setOpen(true); };
  const submit = async () => { try { await save({variables:{input:await form.validateFields()}}); message.success(t("admin_master_data.saved")); setOpen(false); await query.refetch(); } catch(e:any) { if(!e?.errorFields) message.error(e?.message ?? t("admin_master_data.save_error")); } };
  return <Card><SearchBar value={search} onChange={setSearch} reload={() => void query.refetch()} />
    <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()} style={{ marginBottom: 12 }}>{t("admin_master_data.add_bank")}</Button>
    <Table rowKey="id" loading={query.loading} dataSource={query.data?.bmsMasterBanks ?? []} pagination={{pageSize:20}} columns={[
      {title:t("admin_master_data.code"),dataIndex:"code",width:90},{title:t("admin_master_data.name_th"),dataIndex:"nameTh"},{title:t("admin_master_data.name_en"),dataIndex:"nameEn"},
      {title:"SWIFT/BIC",dataIndex:"swift",width:130},{title:t("admin_master_data.status"),dataIndex:"active",width:100,render:(v)=><Tag color={v?"green":"default"}>{v?t("admin_master_data.active"):t("admin_master_data.inactive")}</Tag>},
      {title:"",width:90,render:(_,row)=><Button size="small" onClick={()=>edit(row)}>{t("admin_master_data.edit")}</Button>},
    ]}/>
    <Modal open={open} title={t("admin_master_data.bank_form")} onCancel={()=>setOpen(false)} onOk={()=>void submit()} confirmLoading={state.loading} okText={t("admin_master_data.save")} cancelText={t("admin_master_data.cancel")}>
      <Form form={form} layout="vertical"><Form.Item name="id" hidden><Input/></Form.Item><Space align="start">
        <Form.Item name="countryCode" label={t("admin_master_data.country")} rules={[{required:true}]}><Input maxLength={2}/></Form.Item>
        <Form.Item name="code" label={t("admin_master_data.code")} rules={[{required:true}]}><Input maxLength={12}/></Form.Item>
        <Form.Item name="sortOrder" label={t("admin_master_data.sort_order")}><InputNumber precision={0}/></Form.Item>
      </Space><Form.Item name="nameTh" label={t("admin_master_data.name_th")} rules={[{required:true}]}><Input/></Form.Item>
      <Form.Item name="nameEn" label={t("admin_master_data.name_en")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="swift" label="SWIFT/BIC"><Input maxLength={11}/></Form.Item>
      <Form.Item name="source" label={t("admin_master_data.source")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="sourceVersion" label={t("admin_master_data.source_version")} rules={[{required:true}]}><Input/></Form.Item>
      <Form.Item name="active" label={t("admin_master_data.active")} valuePropName="checked"><Switch/></Form.Item></Form>
    </Modal></Card>;
}

function UnitsTab() {
  const { t } = useI18n();
  const [search,setSearch]=useState(""); const [open,setOpen]=useState(false); const [form]=Form.useForm();
  const query=useQuery(Q_UNITS,{variables:{search,includeInactive:true},fetchPolicy:"cache-and-network"}); const [save,state]=useMutation(M_UNIT);
  const edit=(row?:any)=>{form.resetFields();form.setFieldsValue(row?{...row,aliases:(row.aliases??[]).join(", ")}:{countryCode:"TH",kind:"COUNT",baseFactor:1,active:true,source:"UNECE Recommendation 20",sourceVersion:"revision 14 (2020)"});setOpen(true);};
  const submit=async()=>{try{const values=await form.validateFields();await save({variables:{input:{...values,aliases:String(values.aliases??"").split(",").map((v)=>v.trim()).filter(Boolean)}}});message.success(t("admin_master_data.saved"));setOpen(false);await query.refetch();}catch(e:any){if(!e?.errorFields)message.error(e?.message??t("admin_master_data.save_error"));}};
  return <Card><SearchBar value={search} onChange={setSearch} reload={()=>void query.refetch()}/><Button type="primary" icon={<PlusOutlined/>} onClick={()=>edit()} style={{marginBottom:12}}>{t("admin_master_data.add_unit")}</Button>
    <Table rowKey="id" loading={query.loading} dataSource={query.data?.bmsMasterUnits??[]} pagination={{pageSize:20}} columns={[
      {title:t("admin_master_data.code"),dataIndex:"code",width:90},{title:t("admin_master_data.name_th"),dataIndex:"nameTh"},{title:t("admin_master_data.name_en"),dataIndex:"nameEn"},{title:t("admin_master_data.kind"),dataIndex:"kind",width:110},
      {title:t("admin_master_data.aliases"),dataIndex:"aliases",render:(v:string[])=>(v??[]).join(", ")},{title:t("admin_master_data.status"),dataIndex:"active",width:100,render:(v)=><Tag color={v?"green":"default"}>{v?t("admin_master_data.active"):t("admin_master_data.inactive")}</Tag>},{title:"",width:90,render:(_,row)=><Button size="small" onClick={()=>edit(row)}>{t("admin_master_data.edit")}</Button>},
    ]}/>
    <Modal open={open} title={t("admin_master_data.unit_form")} onCancel={()=>setOpen(false)} onOk={()=>void submit()} confirmLoading={state.loading} okText={t("admin_master_data.save")} cancelText={t("admin_master_data.cancel")}>
      <Form form={form} layout="vertical"><Form.Item name="id" hidden><Input/></Form.Item><Space align="start"><Form.Item name="countryCode" label={t("admin_master_data.country")} rules={[{required:true}]}><Input maxLength={2}/></Form.Item><Form.Item name="code" label={t("admin_master_data.code")} rules={[{required:true}]}><Input maxLength={3}/></Form.Item><Form.Item name="kind" label={t("admin_master_data.kind")} rules={[{required:true}]}><Select options={["COUNT","WEIGHT","VOLUME","LENGTH"].map(value=>({value}))}/></Form.Item></Space>
      <Form.Item name="nameTh" label={t("admin_master_data.name_th")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="nameEn" label={t("admin_master_data.name_en")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="aliases" label={t("admin_master_data.aliases")} extra={t("admin_master_data.aliases_help")}><Input/></Form.Item><Form.Item name="baseFactor" label={t("admin_master_data.base_factor")} rules={[{required:true}]}><InputNumber min={0.000000001} style={{width:"100%"}}/></Form.Item>
      <Form.Item name="source" label={t("admin_master_data.source")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="sourceVersion" label={t("admin_master_data.source_version")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="active" label={t("admin_master_data.active")} valuePropName="checked"><Switch/></Form.Item></Form>
    </Modal></Card>;
}

function AddressesTab(){
  const {t}=useI18n();const[search,setSearch]=useState("");const[open,setOpen]=useState(false);const[form]=Form.useForm();
  const query=useQuery(Q_ADDRESSES,{variables:{search,includeInactive:true},fetchPolicy:"cache-and-network"});const[save,state]=useMutation(M_ADDRESS);
  const rows=query.data?.bmsMasterThaiAddresses??[];const provinces=rows.filter((r:any)=>r.level==="PROVINCE");const districts=rows.filter((r:any)=>r.level==="DISTRICT");
  const edit=(row?:any)=>{form.resetFields();form.setFieldsValue(row??{level:"PROVINCE",active:true,source:"platform-admin",sourceVersion:new Date().toISOString().slice(0,10)});setOpen(true);};
  const submit=async()=>{try{await save({variables:{input:await form.validateFields()}});message.success(t("admin_master_data.saved"));setOpen(false);await query.refetch();}catch(e:any){if(!e?.errorFields)message.error(e?.message??t("admin_master_data.save_error"));}};
  const level=Form.useWatch("level",form);
  return <Card><Alert closable showIcon type="info" style={{marginBottom:16}} message={t("admin_master_data.address_import_title")} description={t("admin_master_data.address_import_description")}/><SearchBar value={search} onChange={setSearch} reload={()=>void query.refetch()}/><Button type="primary" icon={<PlusOutlined/>} onClick={()=>edit()} style={{marginBottom:12}}>{t("admin_master_data.add_address")}</Button>
    <Table rowKey="id" loading={query.loading} dataSource={rows} pagination={{pageSize:30}} columns={[
      {title:t("admin_master_data.level"),dataIndex:"level",width:120},{title:t("admin_master_data.code"),dataIndex:"code",width:100},{title:t("admin_master_data.name_th"),dataIndex:"nameTh"},{title:t("admin_master_data.name_en"),dataIndex:"nameEn"},{title:t("admin_master_data.postcode"),dataIndex:"postcode",width:100},{title:t("admin_master_data.status"),dataIndex:"active",width:100,render:(v)=><Tag color={v?"green":"default"}>{v?t("admin_master_data.active"):t("admin_master_data.inactive")}</Tag>},{title:"",width:90,render:(_,row)=><Button size="small" onClick={()=>edit(row)}>{t("admin_master_data.edit")}</Button>},
    ]}/>
    <Modal open={open} title={t("admin_master_data.address_form")} onCancel={()=>setOpen(false)} onOk={()=>void submit()} confirmLoading={state.loading} okText={t("admin_master_data.save")} cancelText={t("admin_master_data.cancel")}>
      <Form form={form} layout="vertical"><Form.Item name="id" hidden><Input/></Form.Item><Form.Item name="level" label={t("admin_master_data.level")} rules={[{required:true}]}><Select disabled={Boolean(form.getFieldValue("id"))} options={["PROVINCE","DISTRICT","SUBDISTRICT"].map(value=>({value}))}/></Form.Item>
      {level!=="PROVINCE"&&<Form.Item name="provinceCode" label={t("admin_master_data.province")} rules={[{required:true}]}><Select showSearch optionFilterProp="label" options={provinces.map((r:any)=>({value:r.code,label:`${r.code} · ${r.nameTh}`}))}/></Form.Item>}
      {level==="SUBDISTRICT"&&<Form.Item name="districtCode" label={t("admin_master_data.district")} rules={[{required:true}]}><Select showSearch optionFilterProp="label" options={districts.filter((r:any)=>!form.getFieldValue("provinceCode")||r.provinceCode===form.getFieldValue("provinceCode")).map((r:any)=>({value:r.code,label:`${r.code} · ${r.nameTh}`}))}/></Form.Item>}
      <Form.Item name="code" label={t("admin_master_data.code")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="nameTh" label={t("admin_master_data.name_th")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="nameEn" label={t("admin_master_data.name_en")} rules={[{required:true}]}><Input/></Form.Item>
      {level==="SUBDISTRICT"&&<Form.Item name="postcode" label={t("admin_master_data.postcode")} rules={[{required:true,pattern:/^[0-9]{5}$/}]}><Input maxLength={5}/></Form.Item>}<Form.Item name="source" label={t("admin_master_data.source")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="sourceVersion" label={t("admin_master_data.source_version")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="active" label={t("admin_master_data.active")} valuePropName="checked"><Switch/></Form.Item></Form>
    </Modal></Card>;
}

function CarriersTab(){
  const {t}=useI18n();const[open,setOpen]=useState(false);const[form]=Form.useForm();
  const query=useQuery(Q_CARRIERS,{variables:{includeInactive:true},fetchPolicy:"cache-and-network"});const[save,state]=useMutation(M_CARRIER);
  const edit=(row:any)=>{form.resetFields();form.setFieldsValue(row);setOpen(true);};
  const submit=async()=>{try{await save({variables:{input:await form.validateFields()}});message.success(t("admin_master_data.saved"));setOpen(false);await query.refetch();}catch(e:any){if(!e?.errorFields)message.error(e?.message??t("admin_master_data.save_error"));}};
  return <Card><Alert closable showIcon type="info" style={{marginBottom:16}} message={t("admin_master_data.carrier_status_title")} description={t("admin_master_data.carrier_status_description")}/>
    <Button icon={<ReloadOutlined/>} onClick={()=>void query.refetch()} style={{marginBottom:12}}>{t("admin_master_data.reload")}</Button>
    <Table rowKey="id" loading={query.loading} dataSource={query.data?.bmsMasterCarriers??[]} pagination={false} scroll={{x:720}} columns={[
      {title:t("admin_master_data.code"),dataIndex:"code",width:100},{title:t("admin_master_data.name_th"),dataIndex:"nameTh"},{title:t("admin_master_data.name_en"),dataIndex:"nameEn"},
      {title:t("admin_master_data.integration_status"),dataIndex:"integrationStatus",width:130,render:(v:string)=><Tag color={v==="LIVE"?"green":v==="MOCK"?"orange":"default"}>{v}</Tag>},
      {title:t("admin_master_data.status"),dataIndex:"active",width:100,render:(v)=><Tag color={v?"green":"default"}>{v?t("admin_master_data.active"):t("admin_master_data.inactive")}</Tag>},
      {title:"",width:90,render:(_,row)=><Button size="small" onClick={()=>edit(row)}>{t("admin_master_data.edit")}</Button>},
    ]}/>
    <Modal open={open} title={t("admin_master_data.carrier_form")} onCancel={()=>setOpen(false)} onOk={()=>void submit()} confirmLoading={state.loading} okText={t("admin_master_data.save")} cancelText={t("admin_master_data.cancel")}>
      <Form form={form} layout="vertical"><Form.Item name="id" hidden><Input/></Form.Item><Space align="start" wrap><Form.Item name="code" label={t("admin_master_data.code")} rules={[{required:true}]}><Input disabled/></Form.Item><Form.Item name="countryCode" label={t("admin_master_data.country")} rules={[{required:true}]}><Input maxLength={2}/></Form.Item><Form.Item name="integrationStatus" label={t("admin_master_data.integration_status")} rules={[{required:true}]}><Select options={["LIVE","MOCK","NONE"].map(value=>({value}))}/></Form.Item></Space>
      <Form.Item name="nameTh" label={t("admin_master_data.name_th")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="nameEn" label={t("admin_master_data.name_en")} rules={[{required:true}]}><Input/></Form.Item>
      <Form.Item name="trackingUrlTemplate" label={t("admin_master_data.tracking_url_template")} extra={t("admin_master_data.tracking_url_help")}><Input placeholder="https://…/{trackingNo}"/></Form.Item><Form.Item name="trackingNoPattern" label={t("admin_master_data.tracking_pattern")}><Input/></Form.Item>
      <Form.Item name="source" label={t("admin_master_data.source")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="sourceVersion" label={t("admin_master_data.source_version")} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="active" label={t("admin_master_data.active")} valuePropName="checked"><Switch/></Form.Item></Form>
    </Modal></Card>;
}

function TaxReferencesTab(){
  const {t}=useI18n();const query=useQuery(Q_TAX,{fetchPolicy:"cache-and-network"});const data=query.data?.bmsMasterTaxReferences;
  const period=(row:any)=>`${row.effectiveFrom}${row.effectiveTo?` – ${row.effectiveTo}`:" – ∞"}`;
  return <Space direction="vertical" size="middle" style={{width:"100%"}}>
    <Alert closable showIcon type="warning" message={t("admin_master_data.tax_beta_title")} description={t("admin_master_data.tax_beta_description")}/>
    <Button icon={<ReloadOutlined/>} onClick={()=>void query.refetch()}>{t("admin_master_data.reload")}</Button>
    <Card title={t("admin_master_data.tax_document_types")}><Table rowKey="id" size="small" loading={query.loading} dataSource={data?.documentTypes??[]} pagination={{pageSize:10}} scroll={{x:850}} columns={[
      {title:t("admin_master_data.code"),dataIndex:"code",width:90},{title:t("admin_master_data.name_th"),dataIndex:"nameTh"},{title:t("admin_master_data.name_en"),dataIndex:"nameEn"},{title:"BMS",dataIndex:"bmsDocumentType",width:140,render:(v)=>v?<Tag color="orange">{v}</Tag>:"—"},{title:t("admin_master_data.effective_period"),width:220,render:(_,r)=>period(r)},{title:t("admin_master_data.source"),dataIndex:"source",width:220}
    ]}/></Card>
    <Card title={t("admin_master_data.vat_references")}><Table rowKey="id" size="small" loading={query.loading} dataSource={data?.vatRates??[]} pagination={false} scroll={{x:650}} columns={[
      {title:t("admin_master_data.country"),dataIndex:"countryCode",width:100},{title:"VAT %",dataIndex:"rate",width:100},{title:t("admin_master_data.effective_period"),width:220,render:(_,r)=>period(r)},{title:t("admin_master_data.source"),dataIndex:"source"}
    ]}/></Card>
    <Card title={t("admin_master_data.tax_buyer_types")}><Table rowKey="id" size="small" loading={query.loading} dataSource={data?.buyerTypes??[]} pagination={false} scroll={{x:800}} columns={[
      {title:t("admin_master_data.code"),dataIndex:"code",width:120},{title:t("admin_master_data.name_th"),dataIndex:"nameTh"},{title:t("admin_master_data.name_en"),dataIndex:"nameEn"},{title:t("admin_master_data.tax_id_policy"),dataIndex:"taxIdPolicy",width:180},{title:t("admin_master_data.branch_policy"),dataIndex:"branchPolicy",width:220},{title:t("admin_master_data.effective_period"),width:220,render:(_,r)=>period(r)}
    ]}/></Card>
  </Space>;
}

function BarcodesTab(){
  const{t}=useI18n();const[search,setSearch]=useState("");const[status,setStatus]=useState("CANDIDATE");const[open,setOpen]=useState(false);const[form]=Form.useForm();
  const query=useQuery(Q_BARCODES,{variables:{search,status:status||null},fetchPolicy:"cache-and-network"});const[save,state]=useMutation(M_BARCODE);
  const edit=(row:any)=>{form.resetFields();form.setFieldsValue(row);setOpen(true);};
  const submit=async()=>{try{await save({variables:{input:await form.validateFields()}});message.success(t("admin_master_data.saved"));setOpen(false);await query.refetch();}catch(e:any){if(!e?.errorFields)message.error(e?.message??t("admin_master_data.save_error"));}};
  return <Card><Alert closable showIcon type="info" style={{marginBottom:16}} message={t("admin_master_data.barcode_review_title")} description={t("admin_master_data.barcode_review_description")}/><Space wrap style={{marginBottom:16}}><Input.Search allowClear value={search} onChange={e=>setSearch(e.target.value)} onSearch={()=>void query.refetch()} placeholder={t("admin_master_data.search")} style={{width:320}}/><Select value={status} onChange={setStatus} style={{width:160}} options={["CANDIDATE","APPROVED","REJECTED"].map(value=>({value,label:value}))}/><Button icon={<ReloadOutlined/>} onClick={()=>void query.refetch()}>{t("admin_master_data.reload")}</Button></Space>
    <Table rowKey="id" loading={query.loading} dataSource={query.data?.bmsMasterBarcodes??[]} pagination={{pageSize:30}} scroll={{x:900}} columns={[
      {title:t("admin_master_data.barcode"),dataIndex:"barcode",width:150},{title:t("admin_master_data.name"),dataIndex:"name"},{title:t("admin_master_data.brand"),dataIndex:"brand",width:150},{title:t("admin_master_data.size"),dataIndex:"sizeText",width:110},{title:t("admin_master_data.confirmations"),dataIndex:"confirmations",width:110},{title:t("admin_master_data.source"),dataIndex:"source",width:170},{title:t("admin_master_data.status"),dataIndex:"status",width:120,render:(v:string)=><Tag color={v==="APPROVED"?"green":v==="REJECTED"?"red":"orange"}>{v}</Tag>},{title:"",width:90,render:(_,row)=><Button size="small" onClick={()=>edit(row)}>{t("admin_master_data.review")}</Button>},
    ]}/>
    <Modal open={open} title={t("admin_master_data.barcode_review_title")} onCancel={()=>setOpen(false)} onOk={()=>void submit()} confirmLoading={state.loading} okText={t("admin_master_data.save")} cancelText={t("admin_master_data.cancel")}><Form form={form} layout="vertical"><Form.Item name="id" hidden><Input/></Form.Item><Form.Item name="barcode" label={t("admin_master_data.barcode")}><Input disabled/></Form.Item><Form.Item name="name" label={t("admin_master_data.name")} rules={[{required:true}]}><Input maxLength={200}/></Form.Item><Space align="start" wrap><Form.Item name="brand" label={t("admin_master_data.brand")}><Input maxLength={120}/></Form.Item><Form.Item name="sizeText" label={t("admin_master_data.size")}><Input maxLength={80}/></Form.Item><Form.Item name="unitCode" label={t("admin_master_data.unit_code")}><Input maxLength={3}/></Form.Item></Space><Form.Item name="categoryHint" label={t("admin_master_data.category_hint")}><Input maxLength={120}/></Form.Item><Form.Item name="status" label={t("admin_master_data.status")} rules={[{required:true}]}><Select options={["CANDIDATE","APPROVED","REJECTED"].map(value=>({value}))}/></Form.Item></Form></Modal>
  </Card>;
}

export default function MasterDataPage(){const{t}=useI18n();return <Space direction="vertical" size="large" style={{width:"100%"}}><AdminPageHeader title={t("admin_master_data.title")}/><Alert closable showIcon type="warning" message={t("admin_master_data.warning_title")} description={t("admin_master_data.warning_description")}/><Tabs items={[{key:"banks",label:t("admin_master_data.banks"),children:<BanksTab/>},{key:"units",label:t("admin_master_data.units"),children:<UnitsTab/>},{key:"addresses",label:t("admin_master_data.addresses"),children:<AddressesTab/>},{key:"carriers",label:t("admin_master_data.carriers"),children:<CarriersTab/>},{key:"barcodes",label:t("admin_master_data.barcodes"),children:<BarcodesTab/>},{key:"tax",label:t("admin_master_data.tax"),children:<TaxReferencesTab/>}]}/></Space>}
