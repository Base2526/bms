export const CUSTOMER_DISPLAY_CHANNEL = "bms-pos-display";

export type CustomerDisplayLine = {
  name: string;
  size: string | null;
  qty: number;
  unitName: string;
  amount: number;
};

export type CustomerDisplayPayload = {
  lines: CustomerDisplayLine[];
  itemCount: number;
  total: number;
  discountTotal: number;
  amountDue: number;
  memberName: string | null;
  pointsEarned: number | null;
  paymentQr: {
    /** Exact provider-issued payload; the display only renders it as a QR. */
    payload: string;
    amount: number;
    accountName: string | null;
    promptpayId: string | null;
  } | null;
  finished: { total: number; tendered: number | null; change: number | null } | null;
};

export const EMPTY_CUSTOMER_DISPLAY: CustomerDisplayPayload = {
  lines: [],
  itemCount: 0,
  total: 0,
  discountTotal: 0,
  amountDue: 0,
  memberName: null,
  pointsEarned: null,
  paymentQr: null,
  finished: null,
};
