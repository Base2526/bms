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
      store { taxId receiptLanguageMode address phone logoUrl }
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
      serialTracked scaleBarcode imageUrl
      priceTiers { minQty scope size unitPrice discountPct }
      promotion { kind buyQty getQty bundlePrice }
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

export const POS_BOARD_GAME_CHECKOUT_QUERY = `
  query DesktopPosBoardGameCheckout($credentials: BmsPosCredentialsInput!, $id: ID!) {
    bmsPosBoardGameCheckout(credentials: $credentials, id: $id) {
      id
      sessionId
      groupNo
      sessionGroupCount
      tableCode
      tableName
      startedAt
      endedAt
      amountDue
      tabAmount
      tabItemCount
      totalDue
      chargeLineCount
      passCoveredAmount
      offerCode
      offerName
      offerDiscountAmount
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
  store: { receiptLanguageMode: string; logoUrl: string | null };
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
  serialTracked: boolean;
  scaleBarcode: string | null;
  imageUrl: string | null;
  priceTiers: Array<{ minQty: number; scope: string | null; size: string | null; unitPrice: number | null; discountPct: number | null }>;
  promotion: { kind: string; buyQty: number; getQty: number | null; bundlePrice: number | null } | null;
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
  startedAt: string;
  endedAt: string;
  amountDue: number;
  tabAmount: number;
  tabItemCount: number;
  totalDue: number;
  chargeLineCount: number;
  passCoveredAmount: number;
  offerCode: string | null;
  offerName: string | null;
  offerDiscountAmount: number;
};

export class PosGraphqlError extends Error {
  constructor(message: string, public readonly code: string | null, public readonly httpStatus: number | null = null) {
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
      errors?: Array<{ message?: string; extensions?: { code?: string } }>;
    } | null;
    if (!response.ok || body?.errors?.length || !body?.data) {
      const first = body?.errors?.[0];
      throw new PosGraphqlError(
        first?.message ?? `เซิร์ฟเวอร์ตอบ HTTP ${response.status}`,
        first?.extensions?.code ?? null,
        response.status,
      );
    }
    return body.data;
  });
}
