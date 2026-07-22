// =============================================================
// BMS store profile — ข้อมูลร้าน (contact/branding/locale/policy/บัญชีรับเงิน/ค่าส่ง)
// -------------------------------------------------------------
// 1 แถวต่อร้าน (migration 6.9 + 7.17) · read ด้วย query()+WHERE tenant_id,
// write ด้วย INSERT ... ON CONFLICT ผ่าน beginTenantTx (revision-safe)
// tool: get_store_info / get_payment_info / get_shipping_estimate ดึงไปตอบลูกค้า
// ชื่อร้าน = bms_tenants.name (ไม่ใช่ field ในนี้แล้ว — ดู migration 7.17)
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export type PaymentAccount = {
  type: string; // BANK / PROMPTPAY / อื่นๆ
  bankName?: string | null;
  accountName?: string | null;
  accountNo?: string | null;
  promptpayId?: string | null;
  note?: string | null;
};

export type StoreProfile = {
  about: string | null;
  address: string | null;
  phone: string | null;
  contactEmail: string | null;
  website: string | null;
  logoUrl: string | null;
  taxId: string | null;
  timezone: string | null;
  country: string | null;   // TH / AU / UK
  currency: string | null;  // THB / AUD / GBP
  businessHours: string | null;
  shippingPolicy: string | null;
  returnPolicy: string | null;
  paymentAccounts: PaymentAccount[];
  shippingFlatRate: number | null;
  shippingFreeThreshold: number | null;
  shippingEstDaysMin: number | null;
  shippingEstDaysMax: number | null;
};

const EMPTY: StoreProfile = {
  about: null, address: null, phone: null, contactEmail: null, website: null,
  logoUrl: null, taxId: null, timezone: null, country: null, currency: null,
  businessHours: null, shippingPolicy: null, returnPolicy: null,
  paymentAccounts: [],
  shippingFlatRate: null, shippingFreeThreshold: null,
  shippingEstDaysMin: null, shippingEstDaysMax: null,
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function getStoreProfile(tenantId: string): Promise<StoreProfile> {
  const res = await query<any>(
    `SELECT about, address, phone, contact_email, website, logo_url, tax_id,
            timezone, country, currency, business_hours, shipping_policy, return_policy,
            payment_accounts, shipping_flat_rate, shipping_free_threshold,
            shipping_est_days_min, shipping_est_days_max
       FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  const r = res.rows[0];
  if (!r) return { ...EMPTY };
  return {
    about: r.about ?? null,
    address: r.address ?? null,
    phone: r.phone ?? null,
    contactEmail: r.contact_email ?? null,
    website: r.website ?? null,
    logoUrl: r.logo_url ?? null,
    taxId: r.tax_id ?? null,
    timezone: r.timezone ?? null,
    country: r.country ?? null,
    currency: r.currency ?? null,
    businessHours: r.business_hours ?? null,
    shippingPolicy: r.shipping_policy ?? null,
    returnPolicy: r.return_policy ?? null,
    paymentAccounts: Array.isArray(r.payment_accounts) ? r.payment_accounts : [],
    shippingFlatRate: num(r.shipping_flat_rate),
    shippingFreeThreshold: num(r.shipping_free_threshold),
    shippingEstDaysMin: r.shipping_est_days_min ?? null,
    shippingEstDaysMax: r.shipping_est_days_max ?? null,
  };
}

export type StoreProfileInput = Partial<StoreProfile>;

export async function upsertStoreProfile(
  tenantId: string,
  input: StoreProfileInput,
  editorId?: string | null
): Promise<StoreProfile> {
  const cur = await getStoreProfile(tenantId);
  const merged: StoreProfile = { ...cur, ...input };
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    await client.query(
      `INSERT INTO bms_store_profile (
        tenant_id, about, address, phone, contact_email, website, logo_url, tax_id,
        timezone, country, currency, business_hours, shipping_policy, return_policy,
        payment_accounts, shipping_flat_rate, shipping_free_threshold, shipping_est_days_min, shipping_est_days_max
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19)
     ON CONFLICT (tenant_id) DO UPDATE SET
        about = EXCLUDED.about, address = EXCLUDED.address, phone = EXCLUDED.phone,
        contact_email = EXCLUDED.contact_email, website = EXCLUDED.website,
        logo_url = EXCLUDED.logo_url, tax_id = EXCLUDED.tax_id, timezone = EXCLUDED.timezone,
        country = EXCLUDED.country, currency = EXCLUDED.currency,
        business_hours = EXCLUDED.business_hours, shipping_policy = EXCLUDED.shipping_policy,
        return_policy = EXCLUDED.return_policy, payment_accounts = EXCLUDED.payment_accounts,
        shipping_flat_rate = EXCLUDED.shipping_flat_rate,
        shipping_free_threshold = EXCLUDED.shipping_free_threshold,
        shipping_est_days_min = EXCLUDED.shipping_est_days_min,
        shipping_est_days_max = EXCLUDED.shipping_est_days_max, updated_at = now()`,
      [
        tenantId, merged.about, merged.address, merged.phone, merged.contactEmail, merged.website,
        merged.logoUrl, merged.taxId, merged.timezone, merged.country, merged.currency,
        merged.businessHours, merged.shippingPolicy, merged.returnPolicy,
        JSON.stringify(merged.paymentAccounts ?? []),
        merged.shippingFlatRate, merged.shippingFreeThreshold, merged.shippingEstDaysMin, merged.shippingEstDaysMax,
      ]
    );
    await client.query("COMMIT");
    return merged;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export type ShippingEstimate = {
  configured: boolean;
  fee: number | null;
  currency: string;
  freeThreshold: number | null;
  freeShippingApplied: boolean;
  estDaysMin: number | null;
  estDaysMax: number | null;
  note: string;
};

/** ประเมินค่าส่ง/ระยะเวลาจาก config ของร้าน (flat rate + ส่งฟรีเมื่อถึงยอดขั้นต่ำ) */
export async function estimateShipping(tenantId: string, subtotal?: number | null): Promise<ShippingEstimate> {
  const p = await getStoreProfile(tenantId);
  const flat = p.shippingFlatRate;
  const threshold = p.shippingFreeThreshold;
  const configured = flat != null || threshold != null || p.shippingEstDaysMin != null;

  let fee = flat;
  let free = false;
  if (threshold != null && subtotal != null && subtotal >= threshold) {
    fee = 0;
    free = true;
  }
  return {
    configured,
    fee: fee ?? null,
    currency: p.currency || "THB",
    freeThreshold: threshold,
    freeShippingApplied: free,
    estDaysMin: p.shippingEstDaysMin,
    estDaysMax: p.shippingEstDaysMax,
    note: configured
      ? "ประเมินจากค่าส่งเหมาที่ร้านตั้งไว้ (ยังไม่ผูก carrier API จริง)"
      : "ร้านยังไม่ได้ตั้งค่าส่ง",
  };
}
