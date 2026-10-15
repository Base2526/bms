"use client";
import { gql, useApolloClient, useQuery } from "@apollo/client";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Typography } from "antd";
import { useState } from "react";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import type { PricePlanInput } from "@/lib/bms/restaurantPricePlanning";
const LOCATIONS=gql`query PricePublicationLocations {bmsLocations{id name}}`;
const PREVIEW=gql`query PreviewPricePublication($input:BmsPublishPriceInput!){bmsPreviewPricePublication(input:$input){status errorCode fingerprint snapshot}}`;
const PUBLISH=gql`mutation PublishPricePlan($input:BmsPublishPriceInput!,$review:BmsPricePublicationReview!){bmsPublishPricePlan(input:$input,review:$review){status errorCode}}`;
type InputValues={mode:string;quantity:number;packCode?:string;locationId?:string;salesSurface?:string;startsAt?:string;endsAt?:string};
type Snapshot={sku:string;size:string;price:number;quantity:number;mode:string;packs:unknown[];promotions:unknown[];tiers:unknown[];locationId:string|null;salesSurface:string|null;startsAt:string|null;endsAt:string|null};
export default function RestaurantPricePublish({plan,scenarioIndex}:{plan:PricePlanInput;scenarioIndex:number}) {
  const {t}=useI18n(),{can}=useBmsPermissions(),client=useApolloClient();
  const [form]=Form.useForm();
  const locations=useQuery(LOCATIONS);
  const mode=Form.useWatch('mode',form)??'BASE';
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
  const [review,setReview]=useState<{input:Omit<InputValues,"locationId"|"salesSurface"|"startsAt"|"endsAt">&{locationId:string|null;salesSurface:string|null;startsAt:string|null;endsAt:string|null;plan:PricePlanInput;scenarioIndex:number};fingerprint:string;requestId:string;snapshot:Snapshot}|null>(null);
  if(!can('product.edit')||!can('report.view'))return null;
  async function preview(values:InputValues) {
    setBusy(true);setError('');setReview(null);setDone(false);
    try {
      const input={...values,locationId:values.locationId||null,salesSurface:values.mode==='PROMOTION'?values.salesSurface||null:null,startsAt:values.mode==='PROMOTION'&&values.startsAt?new Date(values.startsAt).toISOString():null,endsAt:values.mode==='PROMOTION'&&values.endsAt?new Date(values.endsAt).toISOString():null,quantity:values.mode==='BASE'?1:values.quantity,plan,scenarioIndex};
      const {data}=await client.query({query:PREVIEW,variables:{input},fetchPolicy:'no-cache'});
      const r=data.bmsPreviewPricePublication;
      if(r.status!=='READY')throw new Error(r.errorCode??'ERROR');
      setReview({input,fingerprint:r.fingerprint,snapshot:r.snapshot,requestId:crypto.randomUUID()});
    } catch(e) {setError(e instanceof Error && e.message==='PRICE_PUBLISH_EXCLUSIVE_CHECKOUT_UNSUPPORTED' ? t('restaurant_actual.inclusive_checkout_required') : e instanceof Error?e.message:'ERROR');} finally {setBusy(false);}
  }
  async function publish() {
    if(!review)return;setBusy(true);setError('');
    try {
      const {data}=await client.mutate({mutation:PUBLISH,variables:{input:review.input,review:{fingerprint:review.fingerprint,requestId:review.requestId,confirmed:true}}});
      if(data?.bmsPublishPricePlan.status!=='PUBLISHED')throw new Error(data?.bmsPublishPricePlan.errorCode??'ERROR');
      setReview(null);setDone(true);
    } catch(e) {setError(e instanceof Error && e.message==='PRICE_PUBLISH_EXCLUSIVE_CHECKOUT_UNSUPPORTED' ? t('restaurant_actual.inclusive_checkout_required') : e instanceof Error?e.message:'ERROR');} finally {setBusy(false);}
  }
  return <>
    <Button onClick={()=>{setOpen(true);setDone(false);setError('');setReview(null);}}>{t('restaurant_actual.publish_open')}</Button>
    <Modal open={open} destroyOnClose footer={null} style={{top:24}} styles={{body:{maxHeight:"calc(100dvh - 160px)",overflowY:"auto"}}} title={t('restaurant_actual.publish_open')} onCancel={()=>{if(!busy)setOpen(false);}}>
      <Alert closable type="warning" message={t('restaurant_actual.publish_scope')} description={t('restaurant_actual.publish_hint')} style={{marginBottom:16}}/>
      {error&&<Alert closable type="error" message={error}/>}{done&&<Alert closable type="success" message={t('restaurant_actual.published')}/>}
      <Form form={form} layout="vertical" disabled={busy} initialValues={{mode:'BASE',quantity:2}} onFinish={v=>void preview(v)} onValuesChange={()=>{setReview(null);setDone(false);}}>
        <Form.Item name="mode" label={t('restaurant_actual.mode')}><Select options={[
          {value:'BASE',label:t('restaurant_actual.base')},{value:'PACK',label:t('restaurant_actual.pack')},{value:'PROMOTION',label:t('restaurant_actual.promotion')},
        ]}/></Form.Item>
        {mode!=='BASE'&&<Form.Item name="quantity" label={t('restaurant_actual.pack_qty')}><InputNumber min={mode==='PACK'?2:1} max={10000} precision={0}/></Form.Item>}
        {mode==='PACK'&&<Form.Item name="packCode" label={t('restaurant_actual.pack_code')}><Input maxLength={30}/></Form.Item>}
        <Form.Item name="locationId" label={t('restaurant_actual.branch')}><Select allowClear options={(locations.data?.bmsLocations??[]).map((l:{id:string;name:string})=>({value:l.id,label:l.name}))} placeholder={t('restaurant_actual.all_branches')}/></Form.Item>
        {mode==='PROMOTION'&&<>
          <Form.Item name="salesSurface" label={t('restaurant_actual.surface')}><Select allowClear options={['RETAIL_POS','RESTAURANT_POS','ONLINE_ORDER'].map(value=>({value,label:value}))} placeholder={t('restaurant_actual.all_surfaces')}/></Form.Item>
          <Form.Item name="startsAt" label={t('restaurant_actual.starts_at')}><Input type="datetime-local"/></Form.Item>
          <Form.Item name="endsAt" label={t('restaurant_actual.ends_at')}><Input type="datetime-local"/></Form.Item>
        </>}
        <Button htmlType="submit" loading={busy}>{t('restaurant_actual.preview')}</Button>
      </Form>
      {review&&<section style={{marginTop:16}}>
        <Typography.Paragraph><strong>{review.snapshot.sku} / {review.snapshot.size}</strong><br/>
          {t('restaurant_actual.qty')}: {review.snapshot.quantity}<br/>{t('restaurant_actual.sale_price')}: ฿{review.snapshot.price}</Typography.Paragraph>
        <Typography.Paragraph>{<>{t('restaurant_actual.branch')}: {locations.data?.bmsLocations?.find((l:{id:string})=>l.id===review.snapshot.locationId)?.name??t('restaurant_actual.all_branches')} · {review.snapshot.salesSurface??t('restaurant_actual.all_surfaces')}<br/>{review.snapshot.startsAt??t('restaurant_actual.immediately')} → {review.snapshot.endsAt??t('restaurant_actual.no_end')}<br/></>}
          {t('restaurant_actual.current_rules')}: {review.snapshot.packs.length} / {review.snapshot.tiers.length} / {review.snapshot.promotions.length}</Typography.Paragraph>
        <Button type="primary" loading={busy} onClick={()=>void publish()}>{t('restaurant_actual.publish_confirm')}</Button>
      </section>}
    </Modal>
  </>;
}
