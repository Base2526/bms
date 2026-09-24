// =============================================================
// GraphQL — รายการใบกำกับภาษี + รายงานภาษีขาย (อ่านอย่างเดียว)
// -------------------------------------------------------------
// สิทธิ์ tax.document.view (มีอยู่แล้วตั้งแต่ 7.88) · การ "ส่งออกไฟล์" ใช้ bmsGenerateReport
// เดิมด้วย reportType VAT_SALES ซึ่งตรวจ report.view ของมันเอง
// =============================================================

import { GraphQLError } from "graphql/error";
import { requirePermission } from "@/lib/bms/permissions";
import { getTenantId } from "@/lib/bms/tenant";
import { listLocations } from "@/lib/bms/locations";
import {
  getSalesTaxReport,
  listTaxDocuments,
  type TaxDocumentListFilter,
} from "@/lib/bms/taxReports";

function badInput(err: unknown, fallback: string): never {
  throw new GraphQLError(err instanceof Error && err.message ? err.message : fallback, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export const bmsTaxReportsTypeDefs = /* GraphQL */ `
  input BmsTaxDocumentListInput {
    from: String!
    to: String!
    locationId: ID
    docType: String
    search: String
    includeCancelled: Boolean
    limit: Int
    offset: Int
  }

  type BmsTaxDocumentListRow {
    id: ID!
    orderId: ID!
    locationId: ID!
    locationCode: String!
    branchCode: String!
    deviceCode: String
    docType: String!
    docNo: String!
    issueDate: String!
    issuedAt: String!
    cancelledAt: String
    cancelledReason: String
    buyerName: String
    buyerTaxId: String
    referenceDocNo: String
    channel: String
    base: Float!
    exempt: Float!
    vat: Float!
    total: Float!
    rounding: Float!
  }

  type BmsTaxDocumentList {
    total: Int!
    rows: [BmsTaxDocumentListRow!]!
  }

  input BmsSalesTaxReportInput {
    from: String!
    to: String!
    locationId: ID
  }

  type BmsSalesTaxEstablishmentTotal {
    locationId: ID!
    branchCode: String!
    documentCount: Int!
    base: Float!
    exempt: Float!
    vat: Float!
    total: Float!
    rounding: Float!
  }

  type BmsSalesTaxGrandTotal {
    documentCount: Int!
    base: Float!
    exempt: Float!
    vat: Float!
    total: Float!
    rounding: Float!
  }

  type BmsSalesTaxException {
    kind: String!
    locationId: ID
    orderId: ID!
    at: String!
    amount: Float!
    reference: String
    detail: String
  }

  type BmsSalesTaxExceptionCounts {
    paidWithoutTaxDocument: Int!
    returnWithoutCreditNote: Int!
    fullReplacesOtherMonth: Int!
  }

  type BmsSalesTaxReportSummary {
    vatRegistered: Boolean!
    sellerTaxId: String
    from: String!
    to: String!
    totals: [BmsSalesTaxEstablishmentTotal!]!
    grandTotal: BmsSalesTaxGrandTotal!
    exceptions: [BmsSalesTaxException!]!
    exceptionCounts: BmsSalesTaxExceptionCounts!
    cancelledCount: Int!
  }

  type BmsTaxEstablishment {
    locationId: ID!
    code: String!
    name: String!
    branchCode: String!
    isHeadOffice: Boolean!
  }

  extend type Query {
    # รายชื่อสถานประกอบการสำหรับตัวกรอง — bmsLocations ต้องมี product.view ซึ่งผู้ดูภาษีอาจไม่มี
    bmsTaxEstablishments: [BmsTaxEstablishment!]!
    bmsTaxDocumentList(input: BmsTaxDocumentListInput!): BmsTaxDocumentList!
    bmsSalesTaxReport(input: BmsSalesTaxReportInput!): BmsSalesTaxReportSummary!
  }
`;

export const bmsTaxReportsResolvers = {
  Query: {
    async bmsTaxEstablishments(_p: unknown, _a: unknown, ctx: any) {
      await requirePermission(ctx, "tax.document.view");
      const rows = await listLocations(getTenantId(ctx));
      return rows.map((l) => ({
        locationId: l.id,
        code: l.code,
        name: l.name,
        branchCode: l.branchCode,
        isHeadOffice: l.isHeadOffice,
      }));
    },
    async bmsTaxDocumentList(_p: unknown, args: { input: TaxDocumentListFilter }, ctx: any) {
      await requirePermission(ctx, "tax.document.view");
      try {
        return await listTaxDocuments(getTenantId(ctx), args.input);
      } catch (err) {
        badInput(err, "อ่านรายการใบกำกับไม่สำเร็จ");
      }
    },
    async bmsSalesTaxReport(
      _p: unknown,
      args: { input: { from: string; to: string; locationId?: string | null } },
      ctx: any
    ) {
      await requirePermission(ctx, "tax.document.view");
      let report;
      try {
        report = await getSalesTaxReport(getTenantId(ctx), args.input);
      } catch (err) {
        badInput(err, "สร้างรายงานภาษีขายไม่สำเร็จ");
      }
      return {
        vatRegistered: report.seller.vatRegistered,
        sellerTaxId: report.seller.taxId,
        from: report.period.from,
        to: report.period.to,
        totals: report.totals,
        grandTotal: report.grandTotal,
        exceptions: report.exceptions,
        exceptionCounts: {
          paidWithoutTaxDocument: report.exceptionCounts.PAID_WITHOUT_TAX_DOCUMENT,
          returnWithoutCreditNote: report.exceptionCounts.RETURN_WITHOUT_CREDIT_NOTE,
          fullReplacesOtherMonth: report.exceptionCounts.FULL_REPLACES_OTHER_MONTH,
        },
        cancelledCount: report.cancelled.length,
      };
    },
  },
};
