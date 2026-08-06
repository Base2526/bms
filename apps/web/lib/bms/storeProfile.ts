// =============================================================
// BMS store profile — ข้อมูลร้าน (contact/branding/locale/policy/บัญชีรับเงิน/ค่าส่ง)
// -------------------------------------------------------------
// 1 แถวต่อร้าน (migration 6.9 + 7.17) · read ด้วย query()+WHERE tenant_id,
// write ด้วย INSERT ... ON CONFLICT ผ่าน beginTenantTx (revision-safe)
// tool: get_store_info / get_payment_info / get_shipping_estimate ดึงไปตอบลูกค้า
// ชื่อร้าน = bms_tenants.name (ไม่ใช่ field ในนี้แล้ว — ดู migration 7.17)
// =============================================================

import { getClient, query } from "@/lib/db";
import { getOrSetCache, invalidateCache } from "@/lib/cache";
import { beginTenantTx } from "./tenant";
import { isValidShopArchetype } from "./shopArchetypes";
import { isCarrier, type Carrier } from "./carriers/constants";
import { normalizeProvince, parseWeightTiers, parseZoneRates } from "./shippingZones";

// Read on every AI tool call (get_store_info/get_payment_info/get_shipping_estimate),
// every checkout page load, and the public storefront — but written only from
// /admin/settings. Short TTL is plenty; upsertStoreProfile() below busts it immediately
// on write so admins never see a stale save.
const STORE_PROFILE_CACHE_TTL_SECONDS = 60;
const storeProfileCacheKey = (tenantId: string) => `store-profile:${tenantId}`;

export type PaymentAccount = {
  type: string; // BANK / PROMPTPAY / อื่นๆ
  bankName?: string | null;
  accountName?: string | null;
  accountNo?: string | null;
  promptpayId?: string | null;
  note?: string | null;
};

export type StoreProfile = {
  businessArchetype: string | null;
  businessType: string | null;
  aiLanguage: string;
  aiOrderingStyle: string;
  aiRequiredFields: string[];
  aiInterpretShortReplies: boolean;
  aiHandoffAfterFailedTurns: number;
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
  // Carriers the shop actually uses. Empty = not specified, and the AI must not
  // offer the customer a carrier choice at all (7.46).
  enabledCarriers: Carrier[];
  // How shipping is priced (7.47). 'flat' = pre-7.47 behaviour.
  shippingMode: "flat" | "zone" | "carrier";
  shippingOriginProvince: string | null;
  shippingOriginPostcode: string | null;
  // [{zone,fee}] / [{maxGrams,surcharge}] — parsed + validated in shippingRates.ts
  shippingZoneRates: unknown;
  shippingWeightTiers: unknown;
  emailThemeColor: string | null;  // #RRGGBB — validated at the resolver before it reaches here
  emailFooterText: string | null;  // ข้อความท้ายอีเมลแจ้งสถานะออร์เดอร์ (7.19/7.20)
};

const EMPTY: StoreProfile = {
  businessType: null,
  businessArchetype: null,
  aiLanguage: "th",
  aiOrderingStyle: "catalog_variant",
  aiRequiredFields: ["product", "size", "qty"],
  aiInterpretShortReplies: true,
  aiHandoffAfterFailedTurns: 3,
  about: null, address: null, phone: null, contactEmail: null, website: null,
  logoUrl: null, taxId: null, timezone: null, country: null, currency: null,
  businessHours: null, shippingPolicy: null, returnPolicy: null,
  paymentAccounts: [],
  shippingFlatRate: null, shippingFreeThreshold: null,
  shippingEstDaysMin: null, shippingEstDaysMax: null,
  enabledCarriers: [],
  shippingMode: "flat",
  shippingOriginProvince: null, shippingOriginPostcode: null,
  shippingZoneRates: [], shippingWeightTiers: [],
  emailThemeColor: null, emailFooterText: null,
};

export const DEFAULT_EMAIL_THEME_COLOR = "#1677ff";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function getStoreProfile(tenantId: string): Promise<StoreProfile> {
  return getOrSetCache(storeProfileCacheKey(tenantId), STORE_PROFILE_CACHE_TTL_SECONDS, () =>
    fetchStoreProfile(tenantId)
  );
}

async function fetchStoreProfile(tenantId: string): Promise<StoreProfile> {
  const res = await query<any>(
    `SELECT business_archetype, business_type, ai_language, ai_ordering_style, ai_required_fields,
            ai_interpret_short_replies, ai_handoff_after_failed_turns,
            about, address, phone, contact_email, website, logo_url, tax_id,
            timezone, country, currency, business_hours, shipping_policy, return_policy,
            payment_accounts, shipping_flat_rate, shipping_free_threshold,
            shipping_est_days_min, shipping_est_days_max, enabled_carriers,
            shipping_mode, shipping_origin_province, shipping_origin_postcode,
            shipping_zone_rates, shipping_weight_tiers,
            email_theme_color, email_footer_text
       FROM bms_store_profile WHERE tenant_id = $1`,
    [tenantId]
  );
  const r = res.rows[0];
  if (!r) return { ...EMPTY };
  return {
    businessArchetype: r.business_archetype ?? null,
    businessType: r.business_type ?? null,
    aiLanguage: r.ai_language || "th",
    aiOrderingStyle: r.ai_ordering_style || "catalog_variant",
    aiRequiredFields: Array.isArray(r.ai_required_fields) ? r.ai_required_fields : ["product", "size", "qty"],
    aiInterpretShortReplies: r.ai_interpret_short_replies !== false,
    aiHandoffAfterFailedTurns: Number(r.ai_handoff_after_failed_turns || 3),
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
    enabledCarriers: Array.isArray(r.enabled_carriers) ? r.enabled_carriers.filter(isCarrier) : [],
    shippingMode: SHIPPING_MODES.has(r.shipping_mode) ? r.shipping_mode : "flat",
    shippingOriginProvince: r.shipping_origin_province ?? null,
    shippingOriginPostcode: r.shipping_origin_postcode ?? null,
    shippingZoneRates: Array.isArray(r.shipping_zone_rates) ? r.shipping_zone_rates : [],
    shippingWeightTiers: Array.isArray(r.shipping_weight_tiers) ? r.shipping_weight_tiers : [],
    emailThemeColor: r.email_theme_color ?? null,
    emailFooterText: r.email_footer_text ?? null,
  };
}

export type StoreProfileInput = Partial<StoreProfile>;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const BUSINESS_TYPES = new Set(["fashion", "beauty", "food", "electronics", "home", "general"]);
const AI_LANGUAGES = new Set(["th", "en", "th-en"]);
const AI_ORDERING_STYLES = new Set(["catalog_variant", "simple_catalog", "inquiry_first"]);
const AI_REQUIRED_FIELDS = new Set(["product", "size", "qty"]);
const SHIPPING_MODES = new Set(["flat", "zone", "carrier"]);

export async function upsertStoreProfile(
  tenantId: string,
  input: StoreProfileInput,
  editorId?: string | null
): Promise<StoreProfile> {
  const cur = await getStoreProfile(tenantId);
  const merged: StoreProfile = { ...cur, ...input };

  if (!isValidShopArchetype(merged.businessArchetype)) {
    throw new Error("archetype ร้านไม่ถูกต้อง");
  }
  if (merged.businessType != null && !BUSINESS_TYPES.has(merged.businessType)) {
    throw new Error("ประเภทร้านไม่ถูกต้อง");
  }
  if (!AI_LANGUAGES.has(merged.aiLanguage)) throw new Error("ภาษาหลักของ AI ไม่ถูกต้อง");
  if (!AI_ORDERING_STYLES.has(merged.aiOrderingStyle)) throw new Error("รูปแบบการรับออร์เดอร์ไม่ถูกต้อง");
  merged.aiRequiredFields = Array.from(new Set(merged.aiRequiredFields)).filter((field) => AI_REQUIRED_FIELDS.has(field));
  if (!merged.aiRequiredFields.includes("product") || !merged.aiRequiredFields.includes("qty")) {
    throw new Error("ข้อมูลที่ต้องถามต้องมีสินค้าและจำนวน");
  }
  merged.aiHandoffAfterFailedTurns = Math.trunc(Number(merged.aiHandoffAfterFailedTurns));
  if (merged.aiHandoffAfterFailedTurns < 1 || merged.aiHandoffAfterFailedTurns > 10) {
    throw new Error("จำนวนรอบก่อนส่งต่อแอดมินต้องอยู่ระหว่าง 1–10");
  }
  // Drop unknown carrier codes rather than throwing — same forgiving filter as aiRequiredFields.
  merged.enabledCarriers = Array.from(new Set(merged.enabledCarriers ?? [])).filter(isCarrier);

  if (!SHIPPING_MODES.has(merged.shippingMode)) throw new Error("รูปแบบการคิดค่าส่งไม่ถูกต้อง");
  // Normalize/validate through the same parsers the rate engine uses, so what we store
  // is exactly what quoteShipping() will accept — no silently-ignored rows in the DB.
  merged.shippingZoneRates = parseZoneRates(merged.shippingZoneRates);
  merged.shippingWeightTiers = parseWeightTiers(merged.shippingWeightTiers);
  if (merged.shippingMode === "zone" && (merged.shippingZoneRates as unknown[]).length === 0) {
    throw new Error("โหมดคิดค่าส่งตามโซน ต้องตั้งเรตอย่างน้อย 1 โซน");
  }
  merged.shippingOriginProvince = normalizeProvince(merged.shippingOriginProvince);
  if (merged.shippingOriginPostcode != null) {
    const pc = String(merged.shippingOriginPostcode).trim();
    if (pc && !/^\d{5}$/.test(pc)) throw new Error("รหัสไปรษณีย์ต้นทางต้องเป็นเลข 5 หลัก");
    merged.shippingOriginPostcode = pc || null;
  }
  if (merged.emailThemeColor != null) {
    const color = merged.emailThemeColor.trim();
    if (color && !HEX_COLOR_RE.test(color)) {
      throw new Error("สีธีมอีเมลต้องเป็นรหัสสี hex แบบ #RRGGBB (เช่น #1677ff)");
    }
    merged.emailThemeColor = color || null;
  }
  if (merged.emailFooterText != null) {
    merged.emailFooterText = merged.emailFooterText.trim().slice(0, 300) || null;
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    await client.query(
      `INSERT INTO bms_store_profile (
        tenant_id, business_archetype, business_type, ai_language, ai_ordering_style, ai_required_fields,
        ai_interpret_short_replies, ai_handoff_after_failed_turns,
        about, address, phone, contact_email, website, logo_url, tax_id,
        timezone, country, currency, business_hours, shipping_policy, return_policy,
        payment_accounts, shipping_flat_rate, shipping_free_threshold, shipping_est_days_min, shipping_est_days_max,
        enabled_carriers, email_theme_color, email_footer_text,
        shipping_mode, shipping_origin_province, shipping_origin_postcode,
        shipping_zone_rates, shipping_weight_tiers
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24,$25,$26,$27,$28,$29,
               $30,$31,$32,$33::jsonb,$34::jsonb)
     ON CONFLICT (tenant_id) DO UPDATE SET
        business_archetype = EXCLUDED.business_archetype,
        business_type = EXCLUDED.business_type,
        ai_language = EXCLUDED.ai_language,
        ai_ordering_style = EXCLUDED.ai_ordering_style,
        ai_required_fields = EXCLUDED.ai_required_fields,
        ai_interpret_short_replies = EXCLUDED.ai_interpret_short_replies,
        ai_handoff_after_failed_turns = EXCLUDED.ai_handoff_after_failed_turns,
        about = EXCLUDED.about, address = EXCLUDED.address, phone = EXCLUDED.phone,
        contact_email = EXCLUDED.contact_email, website = EXCLUDED.website,
        logo_url = EXCLUDED.logo_url, tax_id = EXCLUDED.tax_id, timezone = EXCLUDED.timezone,
        country = EXCLUDED.country, currency = EXCLUDED.currency,
        business_hours = EXCLUDED.business_hours, shipping_policy = EXCLUDED.shipping_policy,
        return_policy = EXCLUDED.return_policy, payment_accounts = EXCLUDED.payment_accounts,
        shipping_flat_rate = EXCLUDED.shipping_flat_rate,
        shipping_free_threshold = EXCLUDED.shipping_free_threshold,
        shipping_est_days_min = EXCLUDED.shipping_est_days_min,
        shipping_est_days_max = EXCLUDED.shipping_est_days_max,
        enabled_carriers = EXCLUDED.enabled_carriers,
        shipping_mode = EXCLUDED.shipping_mode,
        shipping_origin_province = EXCLUDED.shipping_origin_province,
        shipping_origin_postcode = EXCLUDED.shipping_origin_postcode,
        shipping_zone_rates = EXCLUDED.shipping_zone_rates,
        shipping_weight_tiers = EXCLUDED.shipping_weight_tiers,
        email_theme_color = EXCLUDED.email_theme_color,
        email_footer_text = EXCLUDED.email_footer_text, updated_at = now()`,
      [
        tenantId, merged.businessArchetype, merged.businessType, merged.aiLanguage, merged.aiOrderingStyle, merged.aiRequiredFields,
        merged.aiInterpretShortReplies, merged.aiHandoffAfterFailedTurns,
        merged.about, merged.address, merged.phone, merged.contactEmail, merged.website,
        merged.logoUrl, merged.taxId, merged.timezone, merged.country, merged.currency,
        merged.businessHours, merged.shippingPolicy, merged.returnPolicy,
        JSON.stringify(merged.paymentAccounts ?? []),
        merged.shippingFlatRate, merged.shippingFreeThreshold, merged.shippingEstDaysMin, merged.shippingEstDaysMax,
        merged.enabledCarriers, merged.emailThemeColor, merged.emailFooterText,
        merged.shippingMode, merged.shippingOriginProvince, merged.shippingOriginPostcode,
        JSON.stringify(merged.shippingZoneRates ?? []), JSON.stringify(merged.shippingWeightTiers ?? []),
      ]
    );
    await client.query("COMMIT");
    await invalidateCache(storeProfileCacheKey(tenantId));
    return merged;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ค่าส่งย้ายไปคิดที่ lib/bms/shippingRates.ts (quoteShipping) ตั้งแต่ 7.47 — จุดเดียว
// ที่รู้เรื่องโซน/น้ำหนัก/carrier ห้ามคำนวณค่าส่งซ้ำในไฟล์นี้อีก ไม่งั้นจะได้ตัวเลข
// คนละชุดระหว่างที่โชว์ลูกค้ากับที่เก็บเงินจริง
