"use client";
import {gql,useQuery} from "@apollo/client";
import {Form,Select} from "antd";
import {useI18n} from "@/lib/i18nContext";
const LOCATIONS=gql`query RecipeCostLocations {bmsLocations{id name}}`;
export function RecipeCostBasisSelect({value,onChange,id}:{id?:string;value?:string;onChange?:(value:string)=>void}) {
 const {t}=useI18n(),q=useQuery(LOCATIONS);
 return <Select id={id} aria-label={t("restaurant_actual.cost_basis")} value={value??"CATALOG"} onChange={onChange} style={{minWidth:240,maxWidth:"100%"}} options={[
  {value:"CATALOG",label:t("restaurant_actual.catalog_basis")},
  ...(q.data?.bmsLocations??[]).map((l:{id:string;name:string})=>({value:l.id,label:`${t("restaurant_actual.weighted_basis")} · ${l.name}`}))]}/>;
}
export function costSelection(value?:string) {return value && value!=="CATALOG" ? {costBasis:"WEIGHTED_AVERAGE" as const,locationId:value} : {costBasis:"CATALOG" as const,locationId:null};}
export default function RecipeCostBasis() {const {t}=useI18n();return <Form.Item name="costSelection" label={t("restaurant_actual.cost_basis")}><RecipeCostBasisSelect/></Form.Item>;}
