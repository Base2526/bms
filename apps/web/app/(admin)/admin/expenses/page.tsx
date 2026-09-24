'use client';

import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Switch, Table, Tag, message } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";

const Q_BOOT = gql`query ExpenseBoot { bmsExpenseEstablishments { locationId code name branchCode isHeadOffice } bmsExpenseSuppliers { id name taxId branchCode address entityType } }`;
const Q_LIST = gql`query ExpenseDocuments($input:BmsExpenseDocumentListInput!,$from:String!,$to:String!,$locationId:ID){
  bmsExpenseDocuments(input:$input){ total rows { id locationId locationName branchCode category documentKind payeeName payeeTaxId documentNo documentDate paidAt amountBeforeVat vatAmount vatClaimMonth whtIncomeType whtRate whtAmount status voidReason createdAt } }
  bmsExpenseTaxSummary(from:$from,to:$to,locationId:$locationId){ grandTotal { documentCount expenseBase vatPurchase wht } }
}`;
const M_CREATE = gql`mutation CreateExpense($input:BmsCreateExpenseDocumentInput!){ bmsCreateExpenseDocument(input:$input){ id } }`;
const M_VOID = gql`mutation VoidExpense($id:ID!,$reason:String!){ bmsVoidExpenseDocument(id:$id,reason:$reason){ id status } }`;

const categories = ["INVENTORY","RENT","UTILITIES","INTERNET","ADVERTISING","TRANSPORT","REPAIRS","PROFESSIONAL_FEE","WAGES","OTHER"];
const whtTypes = ["RENT","SERVICE","PROFESSIONAL","TRANSPORT","ADVERTISING","OTHER"];
const baht = (n:number) => Number(n ?? 0).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});

export default function ExpensesPage(){
  const { t } = useI18n();
  const { can, loading: permLoading } = useBmsPermissions();
  const allowed = can("expense.view"), canManage = can("expense.manage");
  const [month,setMonth] = useState<Dayjs>(dayjs().startOf("month"));
  const [locationId,setLocationId] = useState<string|undefined>();
  const [category,setCategory] = useState<string|undefined>();
  const [search,setSearch] = useState("");
  const [includeVoid,setIncludeVoid] = useState(false);
  const [open,setOpen] = useState(false);
  const [createKey,setCreateKey] = useState("");
  const [form] = Form.useForm();
  const from=month.startOf("month").format("YYYY-MM-DD"), to=month.endOf("month").format("YYYY-MM-DD");
  const boot=useQuery(Q_BOOT,{skip:!allowed});
  const vars={input:{from,to,locationId:locationId??null,category:category??null,search:search.trim()||null,includeVoid,limit:200,offset:0},from,to,locationId:locationId??null};
  const docs=useQuery(Q_LIST,{skip:!allowed,variables:vars,fetchPolicy:"cache-and-network"});
  const [createDoc,{loading:creating}]=useMutation(M_CREATE);
  const [voidDoc]=useMutation(M_VOID);
  const establishments=boot.data?.bmsExpenseEstablishments??[], suppliers=boot.data?.bmsExpenseSuppliers??[];
  const total=docs.data?.bmsExpenseTaxSummary?.grandTotal;

  if(!permLoading&&!allowed) return <Alert closable type="error" showIcon message={t("admin_expenses.no_permission")}/>;
  const submit=async(values:any)=>{
    try{
      const input={...values,documentDate:values.documentDate.format("YYYY-MM-DD"),paidAt:values.paidAt?.format("YYYY-MM-DD")??null,vatClaimMonth:values.vatClaimMonth?.startOf("month").format("YYYY-MM-DD")??null,idempotencyKey:createKey};
      await createDoc({variables:{input}}); message.success(t("admin_expenses.saved")); setOpen(false); setCreateKey(""); form.resetFields(); await docs.refetch();
    }catch(err:any){message.error(err?.message||t("admin_expenses.load_error"));}
  };
  const voidOne=async(id:string,reason:string)=>{try{await voidDoc({variables:{id,reason}});message.success(t("admin_expenses.void_done"));await docs.refetch();}catch(err:any){message.error(err?.message||t("admin_expenses.load_error"));}};
  return <div>
    <AdminPageHeader title={t("admin_expenses.page_title")}>
      <DatePicker picker="month" allowClear={false} value={month} onChange={v=>v&&setMonth(v.startOf("month"))}/>
      <Select allowClear style={{width:230}} placeholder={t("admin_expenses.all_branches")} value={locationId} onChange={setLocationId} options={establishments.map((e:any)=>({value:e.locationId,label:`${e.isHeadOffice?"HQ":e.branchCode} · ${e.name}`}))}/>
      <Button icon={<ReloadOutlined/>} onClick={()=>void docs.refetch()}/>
      {canManage&&<Button type="primary" icon={<PlusOutlined/>} onClick={()=>{setCreateKey(crypto.randomUUID());setOpen(true);}}>{t("admin_expenses.add")}</Button>}
    </AdminPageHeader>
    <Alert closable showIcon type="info" style={{marginBottom:16}} message={t("admin_expenses.intro")}/>
    {docs.error&&<Alert closable showIcon type="error" style={{marginBottom:16}} message={t("admin_expenses.load_error")} description={docs.error.message}/>} 
    <Row gutter={[16,16]} style={{marginBottom:16}}>
      <Col xs={12} md={6}><Card><Statistic title={t("admin_expenses.expense_base")} value={total?.expenseBase??0} precision={2} suffix="฿"/></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title={t("admin_expenses.vat_purchase")} value={total?.vatPurchase??0} precision={2} suffix="฿"/></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title={t("admin_expenses.wht")} value={total?.wht??0} precision={2} suffix="฿"/></Card></Col>
      <Col xs={12} md={6}><Card><Statistic title={t("admin_expenses.documents")} value={total?.documentCount??0}/></Card></Col>
    </Row>
    <Card extra={<Space wrap><Select allowClear style={{width:180}} placeholder={t("admin_expenses.all_categories")} value={category} onChange={setCategory} options={categories.map(v=>({value:v,label:v}))}/><Input.Search allowClear style={{width:300}} placeholder={t("admin_expenses.search")} onSearch={setSearch}/><Switch checked={includeVoid} onChange={setIncludeVoid}/>{t("admin_expenses.include_void")}</Space>}>
      <Table rowKey="id" loading={docs.loading} dataSource={docs.data?.bmsExpenseDocuments?.rows??[]} pagination={{pageSize:50}} scroll={{x:true}} columns={[
        {title:t("admin_expenses.col_date"),dataIndex:"documentDate"},{title:t("admin_expenses.col_branch"),render:(_:any,r:any)=>`${r.branchCode} · ${r.locationName}`},{title:t("admin_expenses.col_payee"),dataIndex:"payeeName"},{title:t("admin_expenses.col_document"),render:(_:any,r:any)=>`${r.documentKind}${r.documentNo?` · ${r.documentNo}`:""}`},{title:t("admin_expenses.col_category"),dataIndex:"category"},{title:t("admin_expenses.col_base"),align:"right" as const,render:(_:any,r:any)=>baht(r.amountBeforeVat)},{title:t("admin_expenses.col_vat"),align:"right" as const,render:(_:any,r:any)=>baht(r.vatAmount)},{title:t("admin_expenses.col_wht"),align:"right" as const,render:(_:any,r:any)=>baht(r.whtAmount)},{title:t("admin_expenses.col_status"),render:(_:any,r:any)=><Tag color={r.status==="ACTIVE"?"green":"red"}>{t(r.status==="ACTIVE"?"admin_expenses.active":"admin_expenses.void")}</Tag>},{title:t("admin_expenses.col_action"),render:(_:any,r:any)=>canManage&&r.status==="ACTIVE"?<VoidAction onConfirm={reason=>voidOne(r.id,reason)} t={t}/>:null}
      ]}/>
    </Card>
    <Modal open={open} title={t("admin_expenses.create_title")} okText={t("admin_expenses.save")} cancelText={t("admin_expenses.cancel")} confirmLoading={creating} onCancel={()=>setOpen(false)} onOk={()=>form.submit()} width={760}>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{category:"OTHER",documentKind:"RECEIPT",documentDate:dayjs(),amountBeforeVat:0,vatAmount:0,whtAmount:0}}>
        <Row gutter={12}><Col span={12}><Form.Item name="locationId" label={t("admin_expenses.location")} rules={[{required:true}]}><Select options={establishments.map((e:any)=>({value:e.locationId,label:`${e.branchCode} · ${e.name}`}))}/></Form.Item></Col><Col span={12}><Form.Item name="category" label={t("admin_expenses.category")} rules={[{required:true}]}><Select options={categories.map(v=>({value:v,label:v}))}/></Form.Item></Col></Row>
        <Row gutter={12}><Col span={12}><Form.Item name="documentKind" label={t("admin_expenses.document_kind")} rules={[{required:true}]}><Select options={["TAX_INVOICE","RECEIPT","CASH_BILL","PAYMENT_VOUCHER"].map(v=>({value:v,label:t(`admin_expenses.${({TAX_INVOICE:"tax_invoice",RECEIPT:"receipt",CASH_BILL:"cash_bill",PAYMENT_VOUCHER:"payment_voucher"} as any)[v]}`)}))}/></Form.Item></Col><Col span={12}><Form.Item name="supplierId" label={t("admin_expenses.supplier")}><Select allowClear showSearch optionFilterProp="label" options={suppliers.map((s:any)=>({value:s.id,label:s.name}))}/></Form.Item></Col></Row>
        <Row gutter={12}><Col span={12}><Form.Item name="payeeName" label={t("admin_expenses.payee_name")}><Input/></Form.Item></Col><Col span={12}><Form.Item name="documentNo" label={t("admin_expenses.document_no")}><Input/></Form.Item></Col></Row>
        <Row gutter={12}><Col span={8}><Form.Item name="documentDate" label={t("admin_expenses.document_date")} rules={[{required:true}]}><DatePicker style={{width:"100%"}}/></Form.Item></Col><Col span={8}><Form.Item name="paidAt" label={t("admin_expenses.paid_at")}><DatePicker style={{width:"100%"}}/></Form.Item></Col><Col span={8}><Form.Item name="vatClaimMonth" label={t("admin_expenses.vat_claim_month")}><DatePicker picker="month" style={{width:"100%"}}/></Form.Item></Col></Row>
        <Row gutter={12}><Col span={8}><Form.Item name="amountBeforeVat" label={t("admin_expenses.amount_before_vat")} rules={[{required:true}]}><InputNumber min={0} precision={2} style={{width:"100%"}}/></Form.Item></Col><Col span={8}><Form.Item name="vatAmount" label={t("admin_expenses.vat_amount")}><InputNumber min={0} precision={2} style={{width:"100%"}}/></Form.Item></Col><Col span={8}><Form.Item name="whtAmount" label={t("admin_expenses.wht_amount")}><InputNumber min={0} precision={2} style={{width:"100%"}}/></Form.Item></Col></Row>
        <Row gutter={12}><Col span={8}><Form.Item name="payeeTaxId" label={t("admin_expenses.payee_tax_id")}><Input maxLength={13}/></Form.Item></Col><Col span={8}><Form.Item name="payeeBranchCode" label={t("admin_expenses.payee_branch_code")}><Input maxLength={5}/></Form.Item></Col><Col span={8}><Form.Item name="payeeType" label={t("admin_expenses.payee_type")}><Select allowClear options={[{value:"INDIVIDUAL",label:t("admin_expenses.individual")},{value:"JURISTIC",label:t("admin_expenses.juristic")} ]}/></Form.Item></Col></Row>
        <Row gutter={12}><Col span={12}><Form.Item name="whtIncomeType" label={t("admin_expenses.wht_income_type")}><Select allowClear options={whtTypes.map(v=>({value:v,label:v}))}/></Form.Item></Col><Col span={12}><Form.Item name="whtRate" label={t("admin_expenses.wht_rate")}><InputNumber min={0.01} max={100} precision={2} style={{width:"100%"}}/></Form.Item></Col></Row>
        <Form.Item name="note" label={t("admin_expenses.note")}><Input.TextArea rows={2}/></Form.Item>
      </Form>
    </Modal>
  </div>;
}

function VoidAction({onConfirm,t}:{onConfirm:(reason:string)=>void;t:(key:string)=>string}){const[reason,setReason]=useState("");return <Popconfirm title={t("admin_expenses.void_action")} description={<Input value={reason} onChange={e=>setReason(e.target.value)} placeholder={t("admin_expenses.void_reason")}/>} okButtonProps={{disabled:!reason.trim(),danger:true}} onConfirm={()=>onConfirm(reason.trim())}><Button danger size="small">{t("admin_expenses.void_action")}</Button></Popconfirm>}
