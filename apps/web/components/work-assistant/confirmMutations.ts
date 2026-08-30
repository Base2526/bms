import { gql } from "@apollo/client";

/** Existing permission-gated mutations used after an informed assistant proposal. */
export const WORK_ASSISTANT_CONFIRM_MUTATIONS: Record<
  string,
  { doc: any; vars: (args: any) => Record<string, unknown> }
> = {
  bmsConfirmPayment: {
    doc: gql`mutation($id: ID!) { bmsConfirmPayment(id: $id) { __typename } }`,
    vars: (args) => ({ id: args.id }),
  },
  bmsRejectPayment: {
    doc: gql`mutation($id: ID!, $note: String) { bmsRejectPayment(id: $id, note: $note) }`,
    vars: (args) => ({ id: args.id, note: args.note ?? null }),
  },
  bmsRefundPayment: {
    doc: gql`mutation($id: ID!) { bmsRefundPayment(id: $id) }`,
    vars: (args) => ({ id: args.id }),
  },
  bmsCancelOrder: {
    doc: gql`mutation($id: ID!) { bmsCancelOrder(id: $id) }`,
    vars: (args) => ({ id: args.id }),
  },
  bmsReturnOrder: {
    doc: gql`mutation($id: ID!) { bmsReturnOrder(id: $id) }`,
    vars: (args) => ({ id: args.id }),
  },
  bmsAdjustStock: {
    doc: gql`mutation($sku: String!, $size: String!, $locationId: ID!, $delta: Int!, $note: String) {
      bmsAdjustStock(sku: $sku, size: $size, locationId: $locationId, delta: $delta, note: $note) { __typename }
    }`,
    vars: (args) => ({
      sku: args.sku, size: args.size, locationId: args.locationId,
      delta: args.delta, note: args.note ?? null,
    }),
  },
  bmsMergeCustomers: {
    doc: gql`mutation($keepId: ID!, $mergeId: ID!) { bmsMergeCustomers(keepId: $keepId, mergeId: $mergeId) }`,
    vars: (args) => ({ keepId: args.keepId, mergeId: args.mergeId }),
  },
  bmsCancelPurchaseOrder: {
    doc: gql`mutation($id: ID!) { bmsCancelPurchaseOrder(id: $id) }`,
    vars: (args) => ({ id: args.id }),
  },
  bmsCancelShipment: {
    doc: gql`mutation($id: ID!) { bmsCancelShipment(id: $id) }`,
    vars: (args) => ({ id: args.id }),
  },
  bmsSendMessage: {
    doc: gql`mutation($id: ID!, $body: String) { bmsSendMessage(id: $id, body: $body) { status } }`,
    vars: (args) => ({ id: args.id, body: args.body }),
  },
  bmsEmailReport: {
    doc: gql`mutation($fileId: Int!, $to: String!, $subject: String) {
      bmsEmailReport(fileId: $fileId, to: $to, subject: $subject) { fileId to reportType format }
    }`,
    vars: (args) => ({ fileId: args.fileId, to: args.to, subject: args.subject ?? null }),
  },
};
