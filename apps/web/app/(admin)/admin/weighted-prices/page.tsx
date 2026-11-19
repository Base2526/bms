"use client";

import { gql, useQuery } from "@apollo/client";
import { Alert, Button, Form, Input, Modal, Select, Space, Typography, message } from "antd";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";

const Q_PRODUCTS = gql`query WeightedPriceProducts($search: String) {
  bmsProducts(search: $search, limit: 30) { items { sku name active catalogVariants { code active } } }
}`;
type FormValues = {sku:string;size:string;rateBahtPerKg:string};
type Rate = {rateBahtPerKg:string;revisionNo:number;basisGrams:number};

export default function WeightedPricesPage() {
  const {t}=useI18n();
  const {can}=useBmsPermissions();
  const [form]=Form.useForm<FormValues>();
  const [search,setSearch]=useState("");
  const [sku,setSku]=useState("");
  const [size,setSize]=useState("");
  const [rate,setRate]=useState<Rate|null>(null);
  const [busy,setBusy]=useState(false);
  const requestKey=useRef(crypto.randomUUID());
  const {data}=useQuery(Q_PRODUCTS,{variables:{search:useDeferredValue(search)}});
  const products:Array<{sku:string;name:string;catalogVariants:Array<{code:string;active:boolean}>}>=data?.bmsProducts?.items??[];
  const selected=products.find(product=>product.sku===sku);

  useEffect(()=>{
    if(!sku||!size){setRate(null);return;}
    let cancelled=false;
    fetch(`/api/bms/weighted-kg-price/${encodeURIComponent(sku)}?size=${encodeURIComponent(size)}`,
      {cache:"no-store"}).then(response=>response.json()).then(body=>{
        if(!cancelled)setRate(body.rate??null);
      }).catch(()=>{if(!cancelled)setRate(null);});
    return()=>{cancelled=true;};
  },[sku,size]);

  async function publish(values:FormValues) {
    if(!/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(values.rateBahtPerKg)) {
      message.error(t("admin_weighted_prices.invalid_rate"));return;
    }
    Modal.confirm({title:t("admin_weighted_prices.confirm_title"),
      content:t("admin_weighted_prices.confirm_detail", {sku:values.sku,size:values.size,rate:values.rateBahtPerKg}),
      okText:t("admin_weighted_prices.publish"),onOk:async()=>{
        setBusy(true);
        try {
          const response=await fetch(`/api/bms/weighted-kg-price/${encodeURIComponent(values.sku)}`,
            {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
              size:values.size,rateBahtPerKg:values.rateBahtPerKg,
              requestKey:requestKey.current,confirmed:true,
            })});
          const body=await response.json();
          if(!response.ok)throw new Error(body.status??body.error??String(response.status));
          requestKey.current=crypto.randomUUID();
          setRate({rateBahtPerKg:body.rateBahtPerKg,revisionNo:body.revisionNo,basisGrams:1000});
          message.success(t("admin_weighted_prices.published"));
        } catch(error) {message.error(`${t("admin_weighted_prices.error")}: ${String(error)}`);}
        finally {setBusy(false);}
      }});
  }
  return <div style={{maxWidth:850,margin:"0 auto",padding:16}}>
    <Typography.Title level={2}>{t("admin_weighted_prices.title")}</Typography.Title>
    <Alert type="warning" showIcon closable style={{marginBottom:16}}
      message={t("admin_weighted_prices.scope")}/>
    <Form<FormValues> form={form} layout="vertical" onFinish={publish}
      onValuesChange={()=>{requestKey.current=crypto.randomUUID();}}>
      <Space wrap align="start">
        <Form.Item name="sku" label={t("admin_weighted_prices.product")} rules={[{required:true}]}>
          <Select style={{minWidth:280}} showSearch filterOption={false} onSearch={setSearch}
            onChange={(value)=>{setSku(value);setSize("");form.setFieldValue("size",undefined);}}
            options={products.map(product=>({value:product.sku,label:`${product.sku} · ${product.name}`}))}/>
        </Form.Item>
        <Form.Item name="size" label={t("admin_weighted_prices.variant")} rules={[{required:true}]}>
          <Select style={{minWidth:180}} onChange={setSize}
            options={(selected?.catalogVariants??[]).filter(variant=>variant.active)
              .map(variant=>({value:variant.code,label:variant.code}))}/>
        </Form.Item>
      </Space>
      <Form.Item name="rateBahtPerKg" label={t("admin_weighted_prices.rate")}
        rules={[{required:true},{pattern:/^(?:0|[1-9]\d{0,8})\.\d{2}$/,
          message:t("admin_weighted_prices.invalid_rate")}] }>
        <Input inputMode="decimal" placeholder="23.45" style={{maxWidth:220}}/>
      </Form.Item>
      {rate&&<Typography.Paragraph>{t("admin_weighted_prices.current_detail", {rate:rate.rateBahtPerKg,revision:rate.revisionNo})}</Typography.Paragraph>}
      {can("product.weighted_price.publish")&&<Button type="primary" htmlType="submit" loading={busy}>
        {t("admin_weighted_prices.publish")}
      </Button>}
    </Form>
  </div>;
}
