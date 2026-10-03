import type { Metadata } from "next";
import TaxInvoiceRequestClient from "./requestClient";
import { taxRequestConfiguration } from "@/lib/bms/taxRequestToken";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "ขอใบกำกับภาษีเต็มรูป",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function TaxInvoiceRequestPage() {
  if (!taxRequestConfiguration().enabled)
    return (
      <main style={{ padding: 32 }}>
        บริการขอใบกำกับภาษีออนไลน์ยังไม่เปิดใช้งาน กรุณาติดต่อร้าน
      </main>
    );
  return <TaxInvoiceRequestClient />;
}
