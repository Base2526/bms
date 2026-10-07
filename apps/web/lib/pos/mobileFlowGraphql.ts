import { runWithOperationTimeout } from "@pos-core/operation";

export const POS_BOOTSTRAP_QUERY = `
  query PosBootstrap {
    bmsPosSession {
      device { id code name registeredPosNo scanner { mode prefixKey suffixKey maxGapMs } }
      location { id name branchCode vatCode pharmacistName }
      shift { id locationId deviceId status openedBy openedAt openingFloat countedCash expectedCash cashVariance closedAt pharmacistUserId }
      shiftReturnSummary { returnCount returnTotal settledTotal pendingTotal pendingCount }
      cashiers { id name email role isPharmacist hasPin posOnly }
      approvers { id name email role isPharmacist hasPin posOnly approvals }
      store { name businessHours website taxId receiptLanguageMode address phone logoUrl paymentQr { payload accountName promptpayId } }
      surface
      businessArchetype
      vat { registered priceIncludesVat rate calendarEra cashRounding }
    }
  }
`;

export const VERIFY_CASHIER_MUTATION = `
  mutation VerifyPosCashier($input: BmsPosCredentialsInput!) {
    bmsPosVerifyCashier(input: $input) { id name email role isPharmacist hasPin posOnly }
  }
`;

export const POS_CATALOG_QUERY = `
  query MobilePosCatalog($q: String = "") {
    bmsPosCatalogSearch(q: $q) {
      items { sku name price availability availableTotal imageUrl availableSizes { size available price } }
    }
  }
`;

export const POS_SCAN_QUERY = `
  query MobilePosScan($code: String!, $size: String, $packCode: String, $surface: String = "RETAIL_POS") {
    bmsPosScan(code: $code, size: $size, packCode: $packCode, surface: $surface, withImage: true) {
      sku size productName receiptName baseQty packCode unitName packPrice basePrice available
      stockTracked serialTracked scaleBarcode imageUrl barcode
      priceTiers { minQty scope size unitPrice discountPct }
      promotion { kind buyQty getQty bundlePrice id buySku buySize giftSku giftSize }
      modifiers { code name priceDelta groupCode groupName selectionType minSelect maxSelect defaultSelected }
      packs { code unitName baseQty price }
    }
  }
`;

export const POS_SHIFT_MUTATION = `
  mutation MobilePosShift($input: BmsPosShiftInput!) {
    bmsPosShift(input: $input) {
      status reason
      shift { id locationId deviceId status openedBy openedAt openingFloat countedCash expectedCash cashVariance closedAt pharmacistUserId }
    }
  }
`;

export const POS_SALE_MUTATION = `
  mutation MobilePosSale($input: BmsPosSaleInput!) {
    bmsPosSale(input: $input) {
      status reason orderId receiptNo billNo subtotal discount total cashTendered cashChange
      pointsUsed pointsEarned pointsBalance code available requested serial roundingAmount replayed
      blockers { sku status salePolicy requested maxQuantity }
    }
  }
`;

export const POS_LAST_SALE_QUERY = `
  query DesktopPosLastSale {
    bmsPosLastSale {
      orderId receiptNo billNo docNo taxRequestUrl taxRequestUnavailableReason soldAt total cashierName branchCode locationName posLabel
      posDeviceId shiftId saleLocationId roundingAmount paymentMethod paymentRef cashTendered
      cashChange memberName memberNo
      pointsEarned pointsBalance pointsExpiring pointsExpireAt promotionNotes
      boardGameTimeNotes
      extraLines { label qty unitAmount amount }
      lines { receiptName size packQty packPrice }
      payments { method amount ref cashTendered cashChange }
      discountLines { label amount }
      vat { rate vatAmount netBeforeVat exemptAmount roundingAmount }
    }
  }
`;

export const POS_BOARD_GAME_CHECKOUT_QUERY = `
  query DesktopPosBoardGameCheckout($credentials: BmsPosCredentialsInput!, $id: ID!) {
    bmsPosBoardGameCheckout(credentials: $credentials, id: $id) {
      id
      sessionId
      groupNo
      sessionGroupCount
      tableCode
      tableName
      billingMode
      startedAt
      endedAt
      amountDue
      tabAmount
      tabPricingDiscountAmount
      tabItemCount
      totalDue
      chargeLineCount
      passCoveredAmount
      offerCode
      offerName
      offerDiscountAmount
      offerEvaluation { status evaluatedAt omittedCount checks { offerCode offerName reason } }
      chargeLines {
        participantId displayName participantType billingGroupNo rateCode rateName
        joinedAt actualEndedAt chargedUntil actualMinutes billableMinutes hourlyRate amount
        grossAmount coveredMinutes coveredAmount offerDiscountAmount
        offerPaidMinutes offerFreeMinutes
      }
      tabItems { id sku productName size packCode unitName quantity unitPrice amount }
    }
  }
`;

export type PosCashier = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  isPharmacist: boolean;
  hasPin: boolean;
  posOnly: boolean;
};

export type PosShift = {
  id: string;
  locationId: string;
  deviceId: string;
  status: string;
  openedBy: string;
  openedAt: string;
  openingFloat: number;
};

export type PosBootstrap = {
  device: {
    id: string;
    code: string;
    name: string | null;
    registeredPosNo: string | null;
    scanner: { mode: string; prefixKey: string; suffixKey: string; maxGapMs: number };
  };
  location: { id: string; name: string; branchCode: string } | null;
  shift: PosShift | null;
  cashiers: PosCashier[];
  approvers: Array<PosCashier & { approvals: string[] }>;
  store: {
    name?: string | null;
    businessHours?: string | null;
    website?: string | null;
    taxId: string | null;
    receiptLanguageMode: string;
    logoUrl: string | null;
    address: string | null;
    phone: string | null;
    paymentQr: { payload: string; accountName: string | null; promptpayId: string | null } | null;
  };
  surface: string;
  businessArchetype: string | null;
  vat: { registered: boolean; priceIncludesVat: boolean; rate: number; calendarEra: string; cashRounding: string };
};

export type PosCatalogItem = {
  sku: string;
  name: string;
  price: number;
  availability: string;
  availableTotal: number;
  imageUrl: string | null;
  availableSizes: Array<{ size: string; available: number; price: number | null }>;
};

export type PosScanHit = {
  barcode?: string | null;
  sku: string;
  size: string;
  productName: string;
  receiptName: string;
  baseQty: number;
  packCode: string;
  unitName: string;
  packPrice: number;
  basePrice: number;
  available: number;
  /** false = `available` is not a selling ceiling (bundle, RECIPE/NON_STOCK menu). */
  stockTracked: boolean;
  serialTracked: boolean;
  scaleBarcode: string | null;
  imageUrl: string | null;
  priceTiers: Array<{ minQty: number; scope: string | null; size: string | null; unitPrice: number | null; discountPct: number | null }>;
  promotion: { kind: string; buyQty: number; getQty: number | null; bundlePrice: number | null;
    id?: string | null; buySku?: string | null; buySize?: string | null; giftSku?: string | null; giftSize?: string | null } | null;
  modifiers: Array<{ code: string; name: string; priceDelta: number; groupCode: string; groupName: string; selectionType: string; minSelect: number; maxSelect: number | null; defaultSelected: boolean }>;
  packs: Array<{ code: string; unitName: string; baseQty: number; price: number }>;
};

export type PosBoardGameCheckout = {
  id: string;
  sessionId: string;
  groupNo: number;
  sessionGroupCount: number;
  tableCode: string;
  tableName: string;
  billingMode: string;
  startedAt: string;
  endedAt: string;
  amountDue: number;
  tabAmount: number;
  tabPricingDiscountAmount: number;
  tabItemCount: number;
  totalDue: number;
  chargeLineCount: number;
  passCoveredAmount: number;
  offerCode: string | null;
  offerName: string | null;
  offerDiscountAmount: number;
  offerEvaluation?: {
    status: string;
    evaluatedAt: string;
    omittedCount: number;
    checks: Array<{ offerCode: string; offerName: string; reason: string }>;
  } | null;
  chargeLines: Array<{
    participantId: string;
    displayName: string | null;
    participantType: string;
    billingGroupNo: number;
    rateCode: string | null;
    rateName: string | null;
    joinedAt: string | null;
    actualEndedAt: string | null;
    chargedUntil: string | null;
    actualMinutes: number | null;
    billableMinutes: number;
    hourlyRate: number;
    amount: number;
    grossAmount: number | null;
    coveredMinutes: number | null;
    coveredAmount: number | null;
    offerDiscountAmount: number | null;
    offerPaidMinutes?: number | null;
    offerFreeMinutes?: number | null;
  }>;
  tabItems: Array<{
    id: string;
    sku: string;
    productName: string;
    size: string;
    packCode: string | null;
    unitName: string | null;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
};

export type PosVariantSelection = {
  scanCode: string;
  sku: string;
  productName: string;
  imageUrl: string | null;
  variants: Array<{ size: string; available: number; price: number; stockTracked: boolean }>;
};

function readVariantSelection(extensions: Record<string, unknown> | undefined): PosVariantSelection | null {
  if (extensions?.code !== "CONFLICT" || extensions.reason !== "VARIANT_SELECTION_REQUIRED") return null;
  const selection = extensions.selection as PosVariantSelection | undefined;
  if (!selection || typeof selection.scanCode !== "string" || !selection.scanCode.trim()
    || typeof selection.sku !== "string" || !selection.sku.trim() || typeof selection.productName !== "string"
    || !(selection.imageUrl === null || typeof selection.imageUrl === "string")
    || !Array.isArray(selection.variants) || !selection.variants.length
    || selection.variants.some((variant) => !variant || typeof variant.size !== "string" || !variant.size.trim()
      || typeof variant.available !== "number" || !Number.isFinite(variant.available) || variant.available < 0
      || typeof variant.price !== "number" || !Number.isFinite(variant.price) || variant.price < 0
      || typeof variant.stockTracked !== "boolean")) return null;
  return {
    scanCode: selection.scanCode, sku: selection.sku, productName: selection.productName, imageUrl: selection.imageUrl,
    variants: selection.variants.map(({ size, available, price, stockTracked }) => ({ size, available, price, stockTracked })),
  };
}

export class PosGraphqlError extends Error {
  constructor(message: string, public readonly code: string | null, public readonly httpStatus: number | null = null,
    public readonly variantSelection: PosVariantSelection | null = null) {
    super(message);
    this.name = "PosGraphqlError";
  }
}

export async function posGraphqlRequest<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  return runWithOperationTimeout(async (signal) => {
    const response = await fetch("/api/graphql", {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-pos-device-token": token,
        "x-scope": "pos",
      },
      body: JSON.stringify({ query, variables }),
      signal,
    });
    const body = (await response.json().catch(() => null)) as {
      data?: T;
      errors?: Array<{ message?: string; extensions?: Record<string, unknown> & { code?: string } }>;
    } | null;
    if (!response.ok || body?.errors?.length || !body?.data) {
      const first = body?.errors?.[0];
      throw new PosGraphqlError(
        first?.message ?? `เซิร์ฟเวอร์ตอบ HTTP ${response.status}`,
        first?.extensions?.code ?? null,
        response.status,
        readVariantSelection(first?.extensions),
      );
    }
    return body.data;
  });
}
