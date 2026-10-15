"use client";
import { gql, useApolloClient, useQuery } from "@apollo/client";
import { Alert, Button, Card, DatePicker, Form, Input, Modal, Select, Space, Table, Typography } from "antd";
import { useState } from "react";
import dayjs from "dayjs";
import MenuNetProfit from "./MenuNetProfit";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
const LOCATIONS=gql`query CostingLocations { bmsLocations { id name } }`;
const VALUES=gql`query InventoryValues($locationId:ID!,$search:String,$offset:Int,$limit:Int) { bmsInventoryValuation(locationId:$locationId,search:$search,offset:$offset,limit:$limit) {status errorCode total truncated rows {sku size qty value unitCost version}} }`;
const OPENING=gql`mutation InventoryOpening($input:BmsInventoryOpeningInput!) {bmsConfirmInventoryValue(input:$input){status errorCode}}`;
const MENU=gql`query MenuActual($input:BmsMenuActualInput!) {bmsRestaurantMenuActual(input:$input){status errorCode complete truncated observedAt totalUnits totalContribution basis costBasis issues rows{sku size units revenue cost contribution classification popularityPercent}}}`;
type ValueRow={sku:string;size:string;qty:string;value:string|null;unitCost:string|null;version:string};
function Values({locationId}:{locationId:string}) {
  const {t}=useI18n(),{can}=useBmsPermissions(),client=useApolloClient();
  const [search,setSearch]=useState(''),[page,setPage]=useState(1);
  const query=useQuery(VALUES,{variables:{locationId,search,offset:(page-1)*50,limit:50},fetchPolicy:'network-only'});
  const [row,setRow]=useState<ValueRow|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [review,setReview]=useState<{value:string;evidence:string;requestId:string}|null>(null);
  const data=query.data?.bmsInventoryValuation;
  async function save() {
    if(!row||!review)return;
    setBusy(true);setError('');
    try {
      const response=await client.mutate({mutation:OPENING,variables:{input:{locationId,sku:row.sku,size:row.size,qty:row.qty,version:row.version,...review,confirmed:true}}});
      const r=response.data?.bmsConfirmInventoryValue;
      if(r?.status!=='SAVED')throw new Error(r?.errorCode??'ERROR');
      setRow(null);setReview(null);await query.refetch();
    } catch(e) {setError(e instanceof Error?e.message:'ERROR');} finally {setBusy(false);}
  }
  const money=(v:string|null)=>v==null?t('restaurant_actual.unknown'):`฿${v}`;
  return <>
    <Alert closable type="info" message={t('restaurant_actual.opening_hint')} style={{marginBlock:12}}/>
    {query.error||data?.status==='REJECTED'?<Alert closable type="error" message={query.error?.message??data?.errorCode}/>:null}
    <Input.Search aria-label={t('restaurant_actual.search')} placeholder={t('restaurant_actual.search')} allowClear onSearch={v=>{setSearch(v);setPage(1);}} style={{marginBlock:12}}/>
    <Table<ValueRow> loading={query.loading} rowKey={r=>JSON.stringify([r.sku,r.size])} dataSource={data?.rows??[]} scroll={{x:800}} pagination={{current:page,pageSize:50,total:data?.total??0,showSizeChanger:false,onChange:setPage}} columns={[
      {title:t('restaurant_actual.sku'),dataIndex:'sku'},{title:t('restaurant_actual.size'),dataIndex:'size'},
      {title:t('restaurant_actual.qty'),dataIndex:'qty'},{title:t('restaurant_actual.value'),dataIndex:'value',render:money},
      {title:t('restaurant_actual.unit_cost'),dataIndex:'unitCost',render:money},
      {title:t('restaurant_actual.review'),render:(_,r)=>r.value==null&&can('inventory.count.apply')?<Button onClick={()=>{setRow(r);setReview(null);setError('');}}>{t('restaurant_actual.review')}</Button>:null},
    ]}/>
    <Modal open={!!row} destroyOnClose footer={null} title={t('restaurant_actual.review')} onCancel={()=>{if(!busy){setRow(null);setReview(null);}}}>
      <Typography.Paragraph>{row?.sku} / {row?.size} · {t('restaurant_actual.qty')}: {row?.qty}</Typography.Paragraph>
      {error&&<Alert closable type="error" message={error}/>}
      <Form layout="vertical" disabled={busy} onValuesChange={()=>setReview(null)} onFinish={v=>setReview({value:String(v.value),evidence:String(v.evidence),requestId:crypto.randomUUID()})}>
        <Form.Item name="value" label={t('restaurant_actual.value')} rules={[{required:true,pattern:/^\d{1,14}(\.\d{1,6})?$/}]}><Input inputMode="decimal"/></Form.Item>
        <Form.Item name="evidence" label={t('restaurant_actual.evidence')} rules={[{required:true,whitespace:true,max:1000}]}><Input.TextArea maxLength={1000}/></Form.Item>
        <Button htmlType="submit">{t('restaurant_actual.preview')}</Button>
      </Form>
      {review&&<Card size="small" style={{marginTop:16}}>
        <Typography.Paragraph>{t('restaurant_actual.value')}: ฿{review.value}<br/>{review.evidence}</Typography.Paragraph>
        <Button type="primary" loading={busy} onClick={()=>void save()}>{t('restaurant_actual.confirm')}</Button>
      </Card>}
    </Modal>
  </>;
}
function Menu({month,locationId}:{month:string;locationId:string|null}) {
  const {t}=useI18n();
  const [menuSkus,setMenuSkus]=useState<string[]>([]);
  const query=useQuery(MENU,{variables:{input:{menuSkus:menuSkus.length?menuSkus:null,from:`${month}-01`,to:dayjs(`${month}-01`).endOf('month').format('YYYY-MM-DD'),locationId}},fetchPolicy:'network-only'});
  const data=query.data?.bmsRestaurantMenuActual;
  const money=(v:string|null)=>v==null?t('restaurant_actual.unknown'):`฿${v}`;
  return <>
    <Alert closable style={{marginBlock:12}} type="info" message={t('restaurant_actual.menu_hint')}/>
    <Select mode="tags" aria-label={t('restaurant_actual.menu_selection')} placeholder={t('restaurant_actual.menu_selection')} value={menuSkus} onChange={setMenuSkus} style={{width:'100%',marginBottom:12}}/>
    {query.error||data?.status==='REJECTED'?<Alert closable type="error" message={query.error?.message??data?.errorCode}/>:null}
    {data?.status==='OK'&&<Alert closable type={data.complete?'success':'warning'} message={data.complete?t('restaurant_actual.complete'):t('restaurant_actual.incomplete')} description={data.issues?.length ? t('restaurant_actual.review_issues') : undefined}/>}
    <Table<{sku:string;size:string;units:string;revenue:string|null;cost:string|null;contribution:string|null;classification:string}> loading={query.loading} rowKey={r=>JSON.stringify([r.sku,r.size])} dataSource={data?.rows??[]} scroll={{x:900}} pagination={{pageSize:10}} columns={[
      {title:t('restaurant_actual.sku'),dataIndex:'sku'},{title:t('restaurant_actual.size'),dataIndex:'size'},
      {title:t('restaurant_actual.qty'),dataIndex:'units'},{title:t('restaurant_actual.revenue'),dataIndex:'revenue',render:money},
      {title:t('restaurant_actual.cost'),dataIndex:'cost',render:money},{title:t('restaurant_actual.contribution'),dataIndex:'contribution',render:money},
      {title:t('restaurant_actual.classification'),dataIndex:'classification'},
    ]}/>
  </>;
}
export default function RestaurantActualCosts() {
  const {t}=useI18n(),{can}=useBmsPermissions();
  const enabled=can('product.view')&&can('report.view');
  const locations=useQuery<{bmsLocations:{id:string;name:string}[]}>(LOCATIONS,{skip:!enabled});
  const [open,setOpen]=useState(false),[locationId,setLocation]=useState<string|null>(null),[month,setMonth]=useState(dayjs().format('YYYY-MM'));
  if(!enabled)return null;
  return <Card style={{marginTop:16}} title={t('restaurant_actual.title')}>
    <Typography.Paragraph>{t('restaurant_actual.intro')}</Typography.Paragraph>
    <Button onClick={()=>setOpen(true)}>{t('restaurant_actual.open')}</Button>
    <Modal open={open} destroyOnClose footer={null} width={1150} title={t('restaurant_actual.title')} onCancel={()=>setOpen(false)} style={{top:24}} styles={{body:{maxHeight:'calc(100dvh - 160px)',overflowY:'auto'}}}>
      <Space wrap>
        <Select aria-label={t('restaurant_actual.branch')} value={locationId??''} style={{minWidth:200}} onChange={v=>setLocation(v||null)} options={[{value:'',label:t('restaurant_actual.all_branches')},...(locations.data?.bmsLocations??[]).map(l=>({value:l.id,label:l.name}))]}/>
        <DatePicker picker="month" allowClear={false} value={dayjs(`${month}-01`)} onChange={v=>{if(v)setMonth(v.format('YYYY-MM'));}}/>
      </Space>
      {open&&can('tax.document.view')&&<Menu key={`${month}:${locationId}`} month={month} locationId={locationId}/>}
      {open&&<MenuNetProfit key={`net:${month}:${locationId}`} month={month} locationId={locationId}/>}
      {open&&locationId&&<Values key={locationId} locationId={locationId}/>}
    </Modal>
  </Card>;
}
