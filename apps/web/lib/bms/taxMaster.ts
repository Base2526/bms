import "server-only";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import type { EtaxDocumentType } from "./etax/types";
import type { TaxBuyerRule, TaxBuyerType } from "./taxBuyer";

type Db = Pick<PoolClient, "query">;
const run = (client?: Db) => client?.query.bind(client) ?? query;

export type EtaxDocumentCodeMap = Record<EtaxDocumentType, string>;

export async function resolveEtaxDocumentCodes(issueDate: string, client?: Db): Promise<EtaxDocumentCodeMap> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) throw new Error("ETAX_ISSUE_DATE_INVALID");
  const result = await run(client)(
    `SELECT DISTINCT ON (bms_document_type) bms_document_type,code
       FROM bms_master_tax_document_types
      WHERE active AND bms_document_type IS NOT NULL
        AND effective_from <= $1::date
        AND (effective_to IS NULL OR effective_to >= $1::date)
      ORDER BY bms_document_type,effective_from DESC`,
    [issueDate]
  );
  const map = Object.fromEntries(result.rows.map((row: any) => [row.bms_document_type,row.code]));
  for (const type of ["ABBREVIATED","FULL","CREDIT_NOTE"] as const) {
    if (!map[type]) throw new Error(`ETAX_DOCUMENT_CODE_MISSING:${type}:${issueDate}`);
  }
  return map as EtaxDocumentCodeMap;
}

export async function getEffectiveVatReference(countryCode = "TH", date?: string, client?: Db) {
  const result = await run(client)(
    `SELECT id,country_code,rate,effective_from::text,effective_to::text,source,source_version
       FROM bms_master_vat_rates
      WHERE active AND country_code=$1
        AND effective_from <= COALESCE($2::date,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date)
        AND (effective_to IS NULL OR effective_to >= COALESCE($2::date,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date))
      ORDER BY effective_from DESC LIMIT 1`,
    [countryCode.trim().toUpperCase(),date ?? null]
  );
  const row = result.rows[0];
  return row ? { id:row.id,countryCode:row.country_code,rate:Number(row.rate),effectiveFrom:row.effective_from,effectiveTo:row.effective_to??null,source:row.source,sourceVersion:row.source_version } : null;
}

export async function getTaxBuyerRule(type: TaxBuyerType, date?: string, client?: Db): Promise<TaxBuyerRule | null> {
  const result = await run(client)(
    `SELECT code,tax_id_policy,branch_policy
       FROM bms_master_tax_buyer_types
      WHERE active AND code=$1
        AND effective_from <= COALESCE($2::date,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date)
        AND (effective_to IS NULL OR effective_to >= COALESCE($2::date,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date))
      ORDER BY effective_from DESC LIMIT 1`,
    [type,date ?? null]
  );
  const row = result.rows[0];
  return row ? { code:row.code,taxIdPolicy:row.tax_id_policy,branchPolicy:row.branch_policy } : null;
}

export async function listTaxMasterData() {
  const [documents,vatRates,buyerTypes] = await Promise.all([
    query(`SELECT id,code,name_th,name_en,bms_document_type,effective_from::text,effective_to::text,active,source,source_version FROM bms_master_tax_document_types ORDER BY effective_from DESC,code`),
    query(`SELECT id,country_code,rate,effective_from::text,effective_to::text,active,source,source_version FROM bms_master_vat_rates ORDER BY effective_from DESC,country_code`),
    query(`SELECT id,code,name_th,name_en,tax_id_policy,branch_policy,effective_from::text,effective_to::text,active,source,source_version FROM bms_master_tax_buyer_types ORDER BY code,effective_from DESC`),
  ]);
  return {
    documentTypes: documents.rows.map((row:any)=>({id:row.id,code:row.code,nameTh:row.name_th,nameEn:row.name_en,bmsDocumentType:row.bms_document_type??null,effectiveFrom:row.effective_from,effectiveTo:row.effective_to??null,active:row.active,source:row.source,sourceVersion:row.source_version})),
    vatRates: vatRates.rows.map((row:any)=>({id:row.id,countryCode:row.country_code,rate:Number(row.rate),effectiveFrom:row.effective_from,effectiveTo:row.effective_to??null,active:row.active,source:row.source,sourceVersion:row.source_version})),
    buyerTypes: buyerTypes.rows.map((row:any)=>({id:row.id,code:row.code,nameTh:row.name_th,nameEn:row.name_en,taxIdPolicy:row.tax_id_policy,branchPolicy:row.branch_policy,effectiveFrom:row.effective_from,effectiveTo:row.effective_to??null,active:row.active,source:row.source,sourceVersion:row.source_version})),
  };
}
