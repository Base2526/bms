import type { PaymentAccount } from "./storeProfile";

export type CustomerPaymentMethod =
  | "BANK_TRANSFER"
  | "QR"
  | "CARD"
  | "TIKTOK"
  | "CASH";

function value(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizedType(account: PaymentAccount): string {
  return value(account.type).toUpperCase();
}

export function configuredPaymentAccounts(accounts: PaymentAccount[]): PaymentAccount[] {
  return accounts.filter((account) => {
    const type = normalizedType(account);
    if (type === "BANK") return Boolean(value(account.accountNo));
    if (type === "PROMPTPAY" || type === "QR") return Boolean(value(account.promptpayId));
    return Boolean(value(account.accountNo) || value(account.promptpayId) || value(account.note));
  });
}

export function hasConfiguredPaymentAccounts(accounts: PaymentAccount[]): boolean {
  return configuredPaymentAccounts(accounts).length > 0;
}

export function supportsCustomerPaymentMethod(
  accounts: PaymentAccount[],
  method: CustomerPaymentMethod
): boolean {
  const configured = configuredPaymentAccounts(accounts);
  if (method === "BANK_TRANSFER") {
    return configured.some((account) => normalizedType(account) === "BANK");
  }
  if (method === "QR") {
    return configured.some((account) => {
      const type = normalizedType(account);
      return type === "PROMPTPAY" || type === "QR";
    });
  }
  return configured.some((account) => normalizedType(account) === method);
}

export function configuredPaymentMethodLabels(accounts: PaymentAccount[]): string[] {
  const labels: string[] = [];
  for (const account of configuredPaymentAccounts(accounts)) {
    const type = normalizedType(account);
    if (type === "BANK" && !labels.includes("โอนเข้าบัญชีธนาคาร")) {
      labels.push("โอนเข้าบัญชีธนาคาร");
    } else if ((type === "PROMPTPAY" || type === "QR") && !labels.includes("พร้อมเพย์")) {
      labels.push("พร้อมเพย์");
    } else if (type !== "BANK" && type !== "PROMPTPAY" && type !== "QR") {
      const label = value(account.note);
      if (label && !labels.includes(label)) labels.push(label);
    }
  }
  return labels;
}
