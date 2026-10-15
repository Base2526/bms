"use client";
import {gql,useApolloClient} from '@apollo/client';
import {Alert,Button,Form,Input,Modal,Select,Table,Typography} from 'antd';
import {useState} from 'react';
import {useI18n} from '@/lib/i18nContext';
import {useBmsPermissions} from '@/app/hooks/useBmsPermissions';
import type {MenuPlan} from '@/lib/bms/restaurantMenuPlanning';
const PREVIEW=gql`query PreviewMenuBundle($input:BmsMenuBundlePublicationInput!){bmsPreviewMenuBundle(input:$input){status errorCode fingerprint snapshot}}`;
const SAVE=gql`mutation PublishMenuBundle($input:BmsMenuBundlePublicationInput!,$review:BmsPricePublicationReview!){bmsPublishMenuBundle(input:$input,review:$review){status errorCode snapshot}}`;
export default function MenuBundlePublish({plan}:{plan:MenuPlan}) {
 const {t}=useI18n(),{can}=useBmsPermissions(),client=useApolloClient();
 const [open,setOpen]=useState(false),[review,setReview]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState('');
 if(!can('product.edit')||!can('product.delete')||!can('report.view'))return null;
 async function preview(values:Record<string,unknown>) {setBusy(true);setError('');setDone('');setReview(null);try{const input={...values,plan};const {data}=await client.query({query:PREVIEW,variables:{input},fetchPolicy:'no-cache'});const r=data.bmsPreviewMenuBundle;if(r.status!=='READY')throw new Error(r.errorCode);setReview({...r,input,requestId:crypto.randomUUID()});}catch(e){setError(e instanceof Error?e.message:'ERROR');}finally{setBusy(false);}}
 async function publish(){if(!review)return;setBusy(true);setError('');try{const {data}=await client.mutate({mutation:SAVE,variables:{input:review.input,review:{fingerprint:review.fingerprint,requestId:review.requestId,confirmed:true}}});if(data.bmsPublishMenuBundle.status!=='PUBLISHED')throw new Error(data.bmsPublishMenuBundle.errorCode);setDone(review.snapshot.sku);setReview(null);}catch(e){setError(e instanceof Error?e.message:'ERROR');}finally{setBusy(false);}}
 return <>
 <Button onClick={()=>{setOpen(true);setReview(null);setError('');setDone('');}}>{t('restaurant_completion.publish_bundle')}</Button>
 <Modal open={open} destroyOnClose footer={null} width={800} title={t('restaurant_completion.publish_bundle')} style={{top:24}} styles={{body:{maxHeight:'calc(100dvh - 160px)',overflowY:'auto'}}} onCancel={()=>{if(!busy)setOpen(false);}}>
 <Alert closable type="info" message={t('restaurant_completion.bundle_hint')}/>
 {error&&<Alert closable type="error" message={error}/>}{done&&<Alert closable type="success" message={`${t('restaurant_completion.bundle_done')}: ${done}`}/>}
 <Form layout="vertical" disabled={busy} onValuesChange={()=>{setReview(null);setDone('');}} onFinish={v=>void preview(v)} initialValues={{surfaces:['RESTAURANT_POS'],vatCategory:'V'}}>
  <Form.Item name="sku" label={t('restaurant_completion.bundle_sku')} rules={[{required:true,pattern:/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/}]}><Input maxLength={50}/></Form.Item>
  <Form.Item name="name" label={t('restaurant_completion.bundle_name')} rules={[{required:true,whitespace:true,max:200}]}><Input maxLength={200}/></Form.Item>
  <Form.Item name="vatCategory" label={t('restaurant_completion.bundle_vat')} rules={[{required:true}]}><Select options={[{value:'V',label:t('restaurant_completion.taxable')},{value:'N',label:t('restaurant_completion.exempt')}]}/></Form.Item>
  <Form.Item name="surfaces" label={t('restaurant_completion.bundle_surfaces')} rules={[{required:true}]}><Select mode="multiple" options={['RETAIL_POS','RESTAURANT_POS','ONLINE_ORDER'].map(value=>({value,label:value}))}/></Form.Item>
  <Form.Item name="kitchenStation" label={t('restaurant_completion.station')}><Input maxLength={100}/></Form.Item>
  <Button htmlType="submit" loading={busy}>{t('restaurant_completion.preview_bundle')}</Button>
 </Form>
 {review&&<section><Typography.Paragraph>{review.snapshot.sku} · {review.snapshot.name}<br/>{t('restaurant_actual.sale_price')}: ฿{review.snapshot.price}<br/>{review.snapshot.surfaces.join(', ')} · {review.snapshot.vatCategory}</Typography.Paragraph>
 <Table<any> rowKey={r=>JSON.stringify([r.sku,r.size])} dataSource={review.snapshot.bom} scroll={{x:450}} columns={[{title:t('restaurant_actual.sku'),dataIndex:'sku'},{title:t('restaurant_actual.size'),dataIndex:'size'},{title:t('restaurant_actual.qty'),dataIndex:'qty'}]}/>
 <Button type="primary" loading={busy} onClick={()=>void publish()}>{t('restaurant_completion.confirm_bundle')}</Button></section>}
 </Modal></>;
}
