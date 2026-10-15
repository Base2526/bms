"use client";
import {gql,useApolloClient,useQuery} from '@apollo/client';
import {Alert,Button,Card,Form,Input,Select,Table,Typography} from 'antd';
import {useState} from 'react';
import {useI18n} from '@/lib/i18nContext';
import {useBmsPermissions} from '@/app/hooks/useBmsPermissions';
const READ=gql`query MenuNetProfit($month:String!,$locationId:ID){bmsMenuNetProfit(month:$month,locationId:$locationId){status errorCode snapshot}}`;
const PREVIEW=gql`query PreviewMenuNetProfit($input:BmsMenuProfitInput!){bmsPreviewMenuNetProfit(input:$input){status errorCode fingerprint snapshot}}`;
const SAVE=gql`mutation ConfirmMenuNetProfit($input:BmsMenuProfitInput!,$review:BmsPricePublicationReview!){bmsConfirmMenuNetProfit(input:$input,review:$review){status errorCode}}`;
export default function MenuNetProfit({month,locationId}:{month:string;locationId:string|null}) {
 const {t}=useI18n(),{can}=useBmsPermissions(),client=useApolloClient();
 const allowed=['report.view','expense.view','delivery.settlement.view','tax.document.view','product.view'].every(p=>can(p));
 const current=useQuery(READ,{variables:{month,locationId},skip:!allowed,fetchPolicy:'network-only'});
 const [review,setReview]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 if(!allowed)return null;
 const data=current.data?.bmsMenuNetProfit,snapshot=review?.snapshot??(data?.status==='CURRENT'?data.snapshot:null);
 async function preview(v:{method:string;reason:string}) {
  setBusy(true);setReview(null);setError('');try{const input={...v,month,locationId};const {data}=await client.query({query:PREVIEW,variables:{input},fetchPolicy:'no-cache'});const r=data.bmsPreviewMenuNetProfit;if(r.status!=='READY')throw new Error(r.errorCode);setReview({...r,input,requestId:crypto.randomUUID()});}catch(e){setError(e instanceof Error?e.message:'ERROR');}finally{setBusy(false);}
 }
 async function save(){if(!review)return;setBusy(true);setError('');try{const {data}=await client.mutate({mutation:SAVE,variables:{input:review.input,review:{fingerprint:review.fingerprint,requestId:review.requestId,confirmed:true}}});if(data.bmsConfirmMenuNetProfit.status!=='SAVED')throw new Error(data.bmsConfirmMenuNetProfit.errorCode);setReview(null);await current.refetch();}catch(e){setError(e instanceof Error?e.message:'ERROR');}finally{setBusy(false);}}
 return <Card title={t('restaurant_completion.net_title')} style={{marginBlock:16}}>
  <Typography.Paragraph>{t('restaurant_completion.net_hint')}</Typography.Paragraph>
  {error||current.error||data?.errorCode?<Alert closable type="error" message={error||current.error?.message||data?.errorCode}/>:null}
  <Alert closable type={data?.status==='CURRENT'&&!review?'success':'warning'} message={review?t('restaurant_completion.preview_only'):data?.status==='CURRENT'?t('restaurant_completion.current'):t('restaurant_completion.review_required')}/>
  {can('expense.manage')&&<Form layout="vertical" disabled={busy} initialValues={{method:'REVENUE'}} onValuesChange={()=>setReview(null)} onFinish={v=>void preview(v)}>
   <Form.Item name="method" label={t('restaurant_completion.method')} rules={[{required:true}]}><Select options={['REVENUE','UNITS','EQUAL'].map(value=>({value,label:t(`restaurant_completion.method_${value.toLowerCase()}`)}))}/></Form.Item>
   <Form.Item name="reason" label={t('restaurant_completion.reason')} rules={[{required:true,whitespace:true,max:1000}]}><Input.TextArea maxLength={1000}/></Form.Item>
   <Button htmlType="submit" loading={busy}>{t('restaurant_completion.preview_net')}</Button>
  </Form>}
  {snapshot&&<>
   <Table<any> rowKey={r=>JSON.stringify([r.sku,r.size])} dataSource={snapshot.rows} scroll={{x:1100}} pagination={{pageSize:10}} columns={[
    {title:t('restaurant_actual.sku'),dataIndex:'sku'},{title:t('restaurant_actual.size'),dataIndex:'size'},
    ...['revenue','cost','operating','gp','depreciation','inventoryAdjustment','netProfit'].map(key=>({title:t(`restaurant_completion.${key}`),dataIndex:key,render:(v:string)=>`฿${v}`})),
   ]}/>
   <Typography.Paragraph>{t('restaurant_completion.menu_total')}: ฿{snapshot.menuNetProfit}<br/>{t('restaurant_completion.non_menu')}: ฿{snapshot.nonMenuRevenue}<br/>{t('restaurant_completion.reconciled_total')}: ฿{snapshot.netProfit}</Typography.Paragraph>
   {review&&<Button type="primary" loading={busy} onClick={()=>void save()}>{t('restaurant_completion.confirm_net')}</Button>}
  </>}
 </Card>;
}
