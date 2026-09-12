/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  JSON: { input: unknown; output: unknown; }
  /** The Upload scalar type represents a file upload. */
  Upload: { input: unknown; output: unknown; }
};

export type SchemaBankEntityDetail = {
  __typename?: 'BankEntityDetail';
  account: Scalars['String']['output'];
  bank_code: Scalars['String']['output'];
  bank_name: Scalars['String']['output'];
  is_reported: Scalars['Boolean']['output'];
  last_report_at: Maybe<Scalars['String']['output']>;
  latest_post_id: Maybe<Scalars['ID']['output']>;
  post_count: Scalars['Int']['output'];
  post_ids: Array<Scalars['ID']['output']>;
  report_count: Scalars['Int']['output'];
  risk_level: Scalars['Int']['output'];
  tags: Array<Scalars['String']['output']>;
  updated_at: Scalars['String']['output'];
};

export type SchemaBasicResponse = {
  __typename?: 'BasicResponse';
  message: Scalars['String']['output'];
  ok: Scalars['Boolean']['output'];
};

export type SchemaBlockAction =
  | 'BLOCK'
  | 'UNBLOCK';

export type SchemaBlockPhoneInput = {
  note: InputMaybe<Scalars['String']['input']>;
  phone: Scalars['String']['input'];
  postId: InputMaybe<Scalars['ID']['input']>;
};

export type SchemaBlockPhonePayload = {
  __typename?: 'BlockPhonePayload';
  ok: Scalars['Boolean']['output'];
  status: SchemaPhoneSafetyStatus;
};

export type SchemaBmsActingTenant = {
  __typename?: 'BmsActingTenant';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
};

export type SchemaBmsAction = {
  __typename?: 'BmsAction';
  actionKey: Scalars['String']['output'];
  category: Scalars['String']['output'];
  confidence: Scalars['Float']['output'];
  deepLink: Scalars['String']['output'];
  dueAt: Maybe<Scalars['String']['output']>;
  evidence: Scalars['JSON']['output'];
  expectedImpact: Scalars['String']['output'];
  expectedImpactEn: Scalars['String']['output'];
  firstSeenAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  lastSeenAt: Scalars['String']['output'];
  measuredOutcome: Maybe<Scalars['JSON']['output']>;
  ownerId: Maybe<Scalars['ID']['output']>;
  ownerName: Maybe<Scalars['String']['output']>;
  priority: Scalars['String']['output'];
  status: SchemaBmsActionStatus;
  statusReason: Maybe<Scalars['String']['output']>;
  title: Scalars['String']['output'];
  titleEn: Scalars['String']['output'];
};

export type SchemaBmsActionMetrics = {
  __typename?: 'BmsActionMetrics';
  acceptanceRate: Scalars['Float']['output'];
  accepted: Scalars['Int']['output'];
  avgTimeToActionMinutes: Scalars['Float']['output'];
  completed: Scalars['Int']['output'];
  completionRate: Scalars['Float']['output'];
  days: Scalars['Int']['output'];
  measuredOutcomeCount: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type SchemaBmsActionStatus =
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'DISMISSED'
  | 'EXPIRED'
  | 'NEW';

export type SchemaBmsAiConfig = {
  __typename?: 'BmsAiConfig';
  api_key_masked: Maybe<Scalars['String']['output']>;
  has_key: Scalars['Boolean']['output'];
  model: Maybe<Scalars['String']['output']>;
  provider: Scalars['String']['output'];
};

export type SchemaBmsAiCreditLedgerEntry = {
  __typename?: 'BmsAiCreditLedgerEntry';
  amount: Scalars['Int']['output'];
  balanceAfter: Scalars['Int']['output'];
  createdAt: Scalars['String']['output'];
  entryType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  note: Maybe<Scalars['String']['output']>;
  referenceId: Maybe<Scalars['String']['output']>;
  referenceType: Maybe<Scalars['String']['output']>;
  yearMonth: Scalars['String']['output'];
};

export type SchemaBmsAiFailureSummary = {
  __typename?: 'BmsAiFailureSummary';
  days: Scalars['Int']['output'];
  errorCalls: Scalars['Int']['output'];
  handoffCount: Scalars['Int']['output'];
  topFailingTools: Array<SchemaBmsAiToolFailureRow>;
  totalToolCalls: Scalars['Int']['output'];
};

export type SchemaBmsAiProviderHealth = {
  __typename?: 'BmsAiProviderHealth';
  last_checked_at: Maybe<Scalars['String']['output']>;
  last_error_at: Maybe<Scalars['String']['output']>;
  last_success_at: Maybe<Scalars['String']['output']>;
  provider: Scalars['String']['output'];
  purpose: Scalars['String']['output'];
  status: Scalars['String']['output'];
  status_detail: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsAiQualityCase = {
  __typename?: 'BmsAiQualityCase';
  aiPreview: Scalars['String']['output'];
  category: Maybe<Scalars['String']['output']>;
  channel: Scalars['String']['output'];
  conversationId: Scalars['ID']['output'];
  conversationStatus: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  customerPreview: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  messageId: Scalars['ID']['output'];
  reasonCodes: Array<Scalars['String']['output']>;
  reviewedAt: Maybe<Scalars['String']['output']>;
  reviewerName: Maybe<Scalars['String']['output']>;
  reviewerNote: Maybe<Scalars['String']['output']>;
  severity: Scalars['String']['output'];
  signalOutcome: Scalars['String']['output'];
  source: Scalars['String']['output'];
  status: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  verdict: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsAiQualityCaseDetail = {
  __typename?: 'BmsAiQualityCaseDetail';
  aiPreview: Scalars['String']['output'];
  category: Maybe<Scalars['String']['output']>;
  channel: Scalars['String']['output'];
  conversationId: Scalars['ID']['output'];
  conversationStatus: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  customerPreview: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  messageId: Scalars['ID']['output'];
  messages: Array<SchemaBmsAiQualityMessage>;
  reasonCodes: Array<Scalars['String']['output']>;
  reviewedAt: Maybe<Scalars['String']['output']>;
  reviewerName: Maybe<Scalars['String']['output']>;
  reviewerNote: Maybe<Scalars['String']['output']>;
  severity: Scalars['String']['output'];
  signalOutcome: Scalars['String']['output'];
  source: Scalars['String']['output'];
  status: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  verdict: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsAiQualityDaily = {
  __typename?: 'BmsAiQualityDaily';
  day: Scalars['String']['output'];
  handoffCount: Scalars['Int']['output'];
  successCount: Scalars['Int']['output'];
  totalTurns: Scalars['Int']['output'];
  unresolvedCount: Scalars['Int']['output'];
};

export type SchemaBmsAiQualityMessage = {
  __typename?: 'BmsAiQualityMessage';
  body: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  direction: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  sender: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsAiQualityMetrics = {
  __typename?: 'BmsAiQualityMetrics';
  clarificationCount: Scalars['Int']['output'];
  daily: Array<SchemaBmsAiQualityDaily>;
  days: Scalars['Int']['output'];
  handoffCount: Scalars['Int']['output'];
  handoffRate: Scalars['Float']['output'];
  humanFailCount: Scalars['Int']['output'];
  pendingReviews: Scalars['Int']['output'];
  reviewedCount: Scalars['Int']['output'];
  successCount: Scalars['Int']['output'];
  successRate: Scalars['Float']['output'];
  totalTurns: Scalars['Int']['output'];
  unresolvedCount: Scalars['Int']['output'];
  unresolvedRate: Scalars['Float']['output'];
};

export type SchemaBmsAiSynonymCandidate = {
  __typename?: 'BmsAiSynonymCandidate';
  firstSeenAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  lastSeenAt: Scalars['String']['output'];
  occurrences: Scalars['Int']['output'];
  productSku: Maybe<Scalars['String']['output']>;
  reviewedAt: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  term: Scalars['String']['output'];
};

export type SchemaBmsAiToolFailureRow = {
  __typename?: 'BmsAiToolFailureRow';
  count: Scalars['Int']['output'];
  outcome: Scalars['String']['output'];
  tool: Scalars['String']['output'];
};

export type SchemaBmsAiUsage = {
  __typename?: 'BmsAiUsage';
  actualCostUsd: Scalars['Float']['output'];
  adjustedCredits: Scalars['Int']['output'];
  billableCredits: Scalars['Int']['output'];
  blockedRequests: Scalars['Int']['output'];
  bonusCredits: Scalars['Int']['output'];
  byokRequests: Scalars['Int']['output'];
  count: Scalars['Int']['output'];
  estimatedCost: Scalars['Float']['output'];
  grantedCredits: Scalars['Int']['output'];
  inputTokens: Scalars['Float']['output'];
  limit: Scalars['Int']['output'];
  outputTokens: Scalars['Float']['output'];
  planCode: Scalars['String']['output'];
  planName: Scalars['String']['output'];
  providerCalls: Scalars['Int']['output'];
  remaining: Scalars['Int']['output'];
  requestCount: Scalars['Int']['output'];
  sharedRequests: Scalars['Int']['output'];
  unlimited: Scalars['Boolean']['output'];
  unpricedProviderCalls: Scalars['Int']['output'];
};

export type SchemaBmsAiUsageBreakdown = {
  __typename?: 'BmsAiUsageBreakdown';
  actualCostUsd: Scalars['Float']['output'];
  billableCredits: Scalars['Int']['output'];
  creditsUsed: Scalars['Int']['output'];
  estimatedCost: Scalars['Float']['output'];
  feature: Scalars['String']['output'];
  inputTokens: Scalars['Float']['output'];
  outputTokens: Scalars['Float']['output'];
  providerCalls: Scalars['Int']['output'];
  requests: Scalars['Int']['output'];
  unpricedProviderCalls: Scalars['Int']['output'];
};

export type SchemaBmsAiUsageEvent = {
  __typename?: 'BmsAiUsageEvent';
  actualCostUsd: Maybe<Scalars['Float']['output']>;
  billableCredits: Scalars['Int']['output'];
  channel: Maybe<Scalars['String']['output']>;
  completedAt: Maybe<Scalars['String']['output']>;
  configuredProvider: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  creditsUsed: Scalars['Int']['output'];
  effectiveProvider: Maybe<Scalars['String']['output']>;
  estimatedCost: Scalars['Float']['output'];
  fallbackFrom: Maybe<Scalars['String']['output']>;
  feature: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  inputTokens: Maybe<Scalars['Int']['output']>;
  model: Maybe<Scalars['String']['output']>;
  outputTokens: Maybe<Scalars['Int']['output']>;
  provider: Scalars['String']['output'];
  providerCalls: Scalars['Int']['output'];
  routingReason: Maybe<Scalars['String']['output']>;
  sensitive: Scalars['Boolean']['output'];
  source: Scalars['String']['output'];
  status: Scalars['String']['output'];
  surface: Scalars['String']['output'];
  unpricedProviderCalls: Scalars['Int']['output'];
};

export type SchemaBmsArAccount = {
  __typename?: 'BmsArAccount';
  /** ยอดขายเชื่อที่ยังทำได้หลังรวมเครดิตคงเหลือ */
  availableCredit: Scalars['Float']['output'];
  /** ยอดหนี้คงค้าง · ติดลบ = ร้านค้างลูกค้า (คืนของหลังจ่ายครบ) */
  balance: Scalars['Float']['output'];
  createdAt: Scalars['String']['output'];
  /** เครดิตคงเหลือจากยอดติดลบ เช่น คืนสินค้า/void หลังจ่ายครบ */
  creditBalance: Scalars['Float']['output'];
  creditLimit: Scalars['Float']['output'];
  /** วงเงินที่เหลือจากเพดานเครดิต ไม่รวมเครดิตคืนสินค้า */
  creditLineAvailable: Scalars['Float']['output'];
  customerId: Scalars['ID']['output'];
  customerName: Maybe<Scalars['String']['output']>;
  customerPhone: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  note: Maybe<Scalars['String']['output']>;
  openInvoiceCount: Scalars['Int']['output'];
  overdueAmount: Scalars['Float']['output'];
  status: Scalars['String']['output'];
  termsDays: Scalars['Int']['output'];
};

export type SchemaBmsArAging = {
  __typename?: 'BmsArAging';
  current: Scalars['Float']['output'];
  d1to30: Scalars['Float']['output'];
  d31to60: Scalars['Float']['output'];
  d61to90: Scalars['Float']['output'];
  d90plus: Scalars['Float']['output'];
  total: Scalars['Float']['output'];
};

export type SchemaBmsArInvoice = {
  __typename?: 'BmsArInvoice';
  accountId: Scalars['ID']['output'];
  amount: Scalars['Float']['output'];
  creditedAmount: Scalars['Float']['output'];
  customerId: Scalars['ID']['output'];
  customerName: Maybe<Scalars['String']['output']>;
  daysPastDue: Scalars['Int']['output'];
  /** เลขใบกำกับของบิลต้นทาง — ลูกค้าอ้างเลขนี้เวลามาจ่าย */
  docNo: Maybe<Scalars['String']['output']>;
  dueAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  issuedAt: Scalars['String']['output'];
  orderId: Scalars['ID']['output'];
  outstanding: Scalars['Float']['output'];
  overdue: Scalars['Boolean']['output'];
  settledAmount: Scalars['Float']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsArLedgerEntry = {
  __typename?: 'BmsArLedgerEntry';
  actorName: Maybe<Scalars['String']['output']>;
  amount: Scalars['Float']['output'];
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  invoiceId: Scalars['ID']['output'];
  kind: Scalars['String']['output'];
  note: Maybe<Scalars['String']['output']>;
  orderId: Maybe<Scalars['ID']['output']>;
  receiptId: Maybe<Scalars['ID']['output']>;
};

export type SchemaBmsArOutstanding = {
  __typename?: 'BmsArOutstanding';
  accountsWithBalance: Scalars['Int']['output'];
  aging: SchemaBmsArAging;
  /** ต้องเป็น 0 เสมอ — ไม่ 0 คือมีทางเขียนที่ลืมคำนวณยอดใหม่จาก ledger */
  balanceMismatchCount: Scalars['Int']['output'];
  openInvoiceCount: Scalars['Int']['output'];
  outstandingAmount: Scalars['Float']['output'];
  overdueAmount: Scalars['Float']['output'];
};

export type SchemaBmsArReceiptAllocation = {
  __typename?: 'BmsArReceiptAllocation';
  amount: Scalars['Float']['output'];
  invoiceId: Scalars['ID']['output'];
  orderId: Scalars['ID']['output'];
};

export type SchemaBmsArReceiptResult = {
  __typename?: 'BmsArReceiptResult';
  allocations: Array<SchemaBmsArReceiptAllocation>;
  balanceAfter: Scalars['Float']['output'];
  receiptId: Scalars['ID']['output'];
  replayed: Scalars['Boolean']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsArWriteOffResult = {
  __typename?: 'BmsArWriteOffResult';
  amount: Scalars['Float']['output'];
  balanceAfter: Scalars['Float']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsAssistantCitation = {
  __typename?: 'BmsAssistantCitation';
  accessNote: Maybe<Scalars['String']['output']>;
  accessRequirement: Scalars['String']['output'];
  accessible: Scalars['Boolean']['output'];
  id: Scalars['String']['output'];
  kind: Scalars['String']['output'];
  missingPermissions: Array<Scalars['String']['output']>;
  path: Maybe<Scalars['String']['output']>;
  status: Maybe<Scalars['String']['output']>;
  summary: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type SchemaBmsAssistantLink = {
  __typename?: 'BmsAssistantLink';
  label: Scalars['String']['output'];
  path: Scalars['String']['output'];
};

export type SchemaBmsAssistantProposal = {
  __typename?: 'BmsAssistantProposal';
  args: Scalars['JSON']['output'];
  mutation: Scalars['String']['output'];
  summary: Scalars['String']['output'];
  tool: Scalars['String']['output'];
};

export type SchemaBmsAssistantResult = {
  __typename?: 'BmsAssistantResult';
  proposals: Array<SchemaBmsAssistantProposal>;
  reply: Scalars['String']['output'];
  trace: Array<SchemaBmsAssistantTrace>;
};

export type SchemaBmsAssistantTrace = {
  __typename?: 'BmsAssistantTrace';
  ok: Scalars['Boolean']['output'];
  summary: Scalars['String']['output'];
  tool: Scalars['String']['output'];
};

export type SchemaBmsAssistantTurn = {
  role: Scalars['String']['input'];
  text: Scalars['String']['input'];
};

export type SchemaBmsAttachmentInput = {
  mimeType: InputMaybe<Scalars['String']['input']>;
  name: InputMaybe<Scalars['String']['input']>;
  url: Scalars['String']['input'];
};

export type SchemaBmsAuditEntry = {
  __typename?: 'BmsAuditEntry';
  action: Scalars['String']['output'];
  actor: Maybe<Scalars['String']['output']>;
  created_at: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  meta: Maybe<Scalars['JSON']['output']>;
  target: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsBilling = {
  __typename?: 'BmsBilling';
  plan: SchemaBmsPlan;
  plans: Array<SchemaBmsPlan>;
  usage: SchemaBmsUsage;
};

export type SchemaBmsBundleItem = {
  __typename?: 'BmsBundleItem';
  componentName: Scalars['String']['output'];
  componentSize: Scalars['String']['output'];
  componentSku: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
};

export type SchemaBmsBundleItemInput = {
  componentSize: Scalars['String']['input'];
  componentSku: Scalars['String']['input'];
  qty: Scalars['Int']['input'];
};

export type SchemaBmsBusinessDoc = {
  __typename?: 'BmsBusinessDoc';
  channel: Maybe<Scalars['String']['output']>;
  couponCode: Maybe<Scalars['String']['output']>;
  customerRef: Maybe<Scalars['String']['output']>;
  date: Scalars['String']['output'];
  discount: Scalars['Float']['output'];
  lines: Array<SchemaBmsDocLine>;
  note: Scalars['String']['output'];
  number: Scalars['String']['output'];
  paymentStatus: Maybe<Scalars['String']['output']>;
  shippingFee: Maybe<Scalars['Float']['output']>;
  store: SchemaBmsStoreSummary;
  subtotal: Scalars['Float']['output'];
  total: Scalars['Float']['output'];
  type: Scalars['String']['output'];
};

export type SchemaBmsCarrier =
  | 'AUSPOST'
  | 'DHL'
  | 'FLASH'
  | 'KERRY'
  | 'NZPOST'
  | 'OTHER';

export type SchemaBmsCarrierBookingResult = {
  __typename?: 'BmsCarrierBookingResult';
  detail: Maybe<Scalars['String']['output']>;
  externalShipmentId: Maybe<Scalars['String']['output']>;
  labelUrl: Maybe<Scalars['String']['output']>;
  shipmentId: Maybe<Scalars['ID']['output']>;
  source: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  trackingNo: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsChannelConfig = {
  __typename?: 'BmsChannelConfig';
  access_token_masked: Maybe<Scalars['String']['output']>;
  active: Scalars['Boolean']['output'];
  channel: Scalars['String']['output'];
  channel_secret_masked: Maybe<Scalars['String']['output']>;
  has_secret: Scalars['Boolean']['output'];
  has_token: Scalars['Boolean']['output'];
};

export type SchemaBmsChannelHealth = {
  __typename?: 'BmsChannelHealth';
  active: Scalars['Boolean']['output'];
  channel: Scalars['String']['output'];
  last_checked_at: Maybe<Scalars['String']['output']>;
  last_error_at: Maybe<Scalars['String']['output']>;
  last_inbound_event_at: Maybe<Scalars['String']['output']>;
  last_outbound_success_at: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  status_detail: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsChannelSales = {
  __typename?: 'BmsChannelSales';
  channel: Scalars['String']['output'];
  orders: Scalars['Int']['output'];
  revenue: Scalars['Float']['output'];
};

export type SchemaBmsCloseShiftResult = {
  __typename?: 'BmsCloseShiftResult';
  amount: Maybe<Scalars['Float']['output']>;
  count: Maybe<Scalars['Int']['output']>;
  shift: Maybe<SchemaBmsPosShift>;
  status: Scalars['String']['output'];
};

export type SchemaBmsCommissionRuleInput = {
  action: InputMaybe<Scalars['String']['input']>;
  effectiveFrom: InputMaybe<Scalars['String']['input']>;
  id: InputMaybe<Scalars['Int']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  percent: InputMaybe<Scalars['Float']['input']>;
  ref: InputMaybe<Scalars['String']['input']>;
  scope: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsConvStatus =
  | 'CLOSED'
  | 'OPEN'
  | 'PENDING';

export type SchemaBmsConversation = {
  __typename?: 'BmsConversation';
  assignedStaff: Maybe<SchemaBmsStaffRef>;
  channel: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  customerAvatar: Maybe<Scalars['String']['output']>;
  customerId: Maybe<Scalars['ID']['output']>;
  customerName: Maybe<Scalars['String']['output']>;
  customerRef: Maybe<Scalars['String']['output']>;
  helpers: Array<SchemaBmsStaffRef>;
  id: Scalars['ID']['output'];
  lastMessage: Maybe<Scalars['String']['output']>;
  lastMessageAt: Maybe<Scalars['String']['output']>;
  messages: Array<SchemaBmsMessage>;
  notes: Array<SchemaBmsConversationNote>;
  sourceAvatar: Maybe<Scalars['String']['output']>;
  sourceDisplayName: Maybe<Scalars['String']['output']>;
  sourceHandle: Maybe<Scalars['String']['output']>;
  status: SchemaBmsConvStatus;
  systemEvents: Array<SchemaBmsSystemEvent>;
  tags: Array<Scalars['String']['output']>;
  unread: Scalars['Int']['output'];
  updatedAt: Scalars['String']['output'];
};


export type SchemaBmsConversationMessagesArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaBmsConversationNotesArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaBmsConversationSystemEventsArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
};

export type SchemaBmsConversationNote = {
  __typename?: 'BmsConversationNote';
  author: Maybe<Scalars['String']['output']>;
  body: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  mentionedUserIds: Array<Scalars['ID']['output']>;
};

export type SchemaBmsCoupon = {
  __typename?: 'BmsCoupon';
  active: Scalars['Boolean']['output'];
  code: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  expiresAt: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  locationIds: Array<Scalars['ID']['output']>;
  maxRedemptions: Maybe<Scalars['Int']['output']>;
  minOrderAmount: Maybe<Scalars['Float']['output']>;
  note: Maybe<Scalars['String']['output']>;
  perCustomerLimit: Maybe<Scalars['Int']['output']>;
  redemptionsCount: Scalars['Int']['output'];
  startsAt: Maybe<Scalars['String']['output']>;
  type: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
  value: Scalars['Float']['output'];
};

export type SchemaBmsCouponInput = {
  active: InputMaybe<Scalars['Boolean']['input']>;
  code: Scalars['String']['input'];
  expiresAt: InputMaybe<Scalars['String']['input']>;
  id: InputMaybe<Scalars['ID']['input']>;
  locationIds: InputMaybe<Array<Scalars['ID']['input']>>;
  maxRedemptions: InputMaybe<Scalars['Int']['input']>;
  minOrderAmount: InputMaybe<Scalars['Float']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  perCustomerLimit: InputMaybe<Scalars['Int']['input']>;
  startsAt: InputMaybe<Scalars['String']['input']>;
  type: Scalars['String']['input'];
  value: Scalars['Float']['input'];
};

export type SchemaBmsCouponRedemption = {
  __typename?: 'BmsCouponRedemption';
  channel: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  customerId: Maybe<Scalars['ID']['output']>;
  customerName: Maybe<Scalars['String']['output']>;
  discountAmount: Scalars['Float']['output'];
  orderId: Scalars['ID']['output'];
  status: Scalars['String']['output'];
  totalAmount: Scalars['Float']['output'];
};

export type SchemaBmsCouponSummary = {
  __typename?: 'BmsCouponSummary';
  discountThisMonth: Scalars['Float']['output'];
  redemptionsThisMonth: Scalars['Int']['output'];
  topCoupons: Array<SchemaBmsTopCoupon>;
};

export type SchemaBmsCreateStockCountInput = {
  locationId: Scalars['ID']['input'];
  note: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsCreateStockTransferInput = {
  fromLocationId: Scalars['ID']['input'];
  items: Array<SchemaBmsStockTransferLineInput>;
  note: InputMaybe<Scalars['String']['input']>;
  toLocationId: Scalars['ID']['input'];
};

export type SchemaBmsCustomer = {
  __typename?: 'BmsCustomer';
  addresses: Array<SchemaBmsCustomerAddress>;
  coupons: Array<SchemaBmsCustomerCoupon360>;
  created_at: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  identities: Array<SchemaBmsCustomerIdentity>;
  loyaltyLedger: Array<SchemaBmsLoyaltyLedgerEntry>;
  membership: Maybe<SchemaBmsMember>;
  name: Scalars['String']['output'];
  note: Maybe<Scalars['String']['output']>;
  order_count: Scalars['Int']['output'];
  orders: Array<SchemaBmsOrder>;
  phone: Maybe<Scalars['String']['output']>;
  tags: Array<Scalars['String']['output']>;
  total_spent: Scalars['Float']['output'];
};

export type SchemaBmsCustomer360 = {
  __typename?: 'BmsCustomer360';
  addresses: Array<SchemaBmsCustomerAddress360>;
  coupons: Array<SchemaBmsCustomerCoupon360>;
  customer: Maybe<SchemaBmsCustomerProfile360>;
  draftOrder: Maybe<SchemaBmsCustomerDraftOrder>;
  identities: Array<SchemaBmsCustomerIdentity360>;
  notes: Array<SchemaBmsCustomerNote360>;
  products: SchemaBmsCustomerProducts;
  recentOrders: Array<SchemaBmsCustomerRecentOrder>;
  stats: SchemaBmsCustomerStats;
};

export type SchemaBmsCustomerAddress = {
  __typename?: 'BmsCustomerAddress';
  address: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  is_default: Scalars['Boolean']['output'];
  label: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsCustomerAddress360 = {
  __typename?: 'BmsCustomerAddress360';
  address: Scalars['String']['output'];
  addressType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isDefault: Scalars['Boolean']['output'];
  label: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsCustomerCoupon360 = {
  __typename?: 'BmsCustomerCoupon360';
  active: Scalars['Boolean']['output'];
  assigned: Scalars['Boolean']['output'];
  assignedAt: Maybe<Scalars['String']['output']>;
  available: Scalars['Boolean']['output'];
  code: Scalars['String']['output'];
  customerUsedCount: Scalars['Int']['output'];
  discountPreview: Maybe<Scalars['Float']['output']>;
  expiredAt: Maybe<Scalars['String']['output']>;
  expiresAt: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  maxRedemptions: Maybe<Scalars['Int']['output']>;
  minOrderAmount: Maybe<Scalars['Float']['output']>;
  note: Maybe<Scalars['String']['output']>;
  perCustomerLimit: Maybe<Scalars['Int']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  redeemedAt: Maybe<Scalars['String']['output']>;
  redeemedOrderId: Maybe<Scalars['ID']['output']>;
  redemptionsCount: Scalars['Int']['output'];
  remainingRedemptions: Maybe<Scalars['Int']['output']>;
  reservedAt: Maybe<Scalars['String']['output']>;
  reservedOrderId: Maybe<Scalars['ID']['output']>;
  revokedAt: Maybe<Scalars['String']['output']>;
  source: Maybe<Scalars['String']['output']>;
  startsAt: Maybe<Scalars['String']['output']>;
  state: Scalars['String']['output'];
  type: Scalars['String']['output'];
  value: Scalars['Float']['output'];
  walletId: Maybe<Scalars['ID']['output']>;
};

export type SchemaBmsCustomerDraftOrder = {
  __typename?: 'BmsCustomerDraftOrder';
  channel: Scalars['String']['output'];
  couponCode: Maybe<Scalars['String']['output']>;
  createdAt: Maybe<Scalars['String']['output']>;
  discountAmount: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsCustomerOrderItem360>;
  totalAmount: Scalars['Float']['output'];
};

export type SchemaBmsCustomerFavoriteCategory = {
  __typename?: 'BmsCustomerFavoriteCategory';
  category: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
};

export type SchemaBmsCustomerIdentity = {
  __typename?: 'BmsCustomerIdentity';
  channel: Scalars['String']['output'];
  external_ref: Scalars['String']['output'];
};

export type SchemaBmsCustomerIdentity360 = {
  __typename?: 'BmsCustomerIdentity360';
  channel: Scalars['String']['output'];
  externalRef: Scalars['String']['output'];
};

export type SchemaBmsCustomerInput = {
  id: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  phone: InputMaybe<Scalars['String']['input']>;
  tags: InputMaybe<Array<Scalars['String']['input']>>;
};

export type SchemaBmsCustomerInsights = {
  __typename?: 'BmsCustomerInsights';
  cached: Scalars['Boolean']['output'];
  generatedAt: Maybe<Scalars['String']['output']>;
  summary: Scalars['String']['output'];
};

export type SchemaBmsCustomerNote360 = {
  __typename?: 'BmsCustomerNote360';
  author: Maybe<Scalars['String']['output']>;
  body: Scalars['String']['output'];
  conversationId: Scalars['ID']['output'];
  createdAt: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
};

export type SchemaBmsCustomerOrderItem360 = {
  __typename?: 'BmsCustomerOrderItem360';
  qty: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  unitPrice: Scalars['Float']['output'];
};

export type SchemaBmsCustomerProductStat = {
  __typename?: 'BmsCustomerProductStat';
  category: Maybe<Scalars['String']['output']>;
  lastPurchasedAt: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  orderCount: Scalars['Int']['output'];
  qty: Scalars['Int']['output'];
  revenue: Scalars['Float']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsCustomerProducts = {
  __typename?: 'BmsCustomerProducts';
  favoriteCategories: Array<SchemaBmsCustomerFavoriteCategory>;
  frequentlyPurchased: Array<SchemaBmsCustomerProductStat>;
  recentlyPurchased: Array<SchemaBmsCustomerProductStat>;
  topPurchased: Array<SchemaBmsCustomerProductStat>;
};

export type SchemaBmsCustomerProfile360 = {
  __typename?: 'BmsCustomerProfile360';
  createdAt: Maybe<Scalars['String']['output']>;
  email: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isNewCustomer: Scalars['Boolean']['output'];
  isReturningCustomer: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  note: Maybe<Scalars['String']['output']>;
  orderCount: Scalars['Int']['output'];
  phone: Maybe<Scalars['String']['output']>;
  preferredLanguage: Maybe<Scalars['String']['output']>;
  tags: Array<Scalars['String']['output']>;
  timezone: Maybe<Scalars['String']['output']>;
  totalSpent: Scalars['Float']['output'];
};

export type SchemaBmsCustomerRecentOrder = {
  __typename?: 'BmsCustomerRecentOrder';
  carrier: Maybe<Scalars['String']['output']>;
  channel: Scalars['String']['output'];
  couponCode: Maybe<Scalars['String']['output']>;
  createdAt: Maybe<Scalars['String']['output']>;
  discountAmount: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsCustomerOrderItem360>;
  paymentMethod: Maybe<Scalars['String']['output']>;
  paymentStatus: Maybe<SchemaBmsPaymentStatus>;
  shipmentStatus: Maybe<SchemaBmsShipmentStatus>;
  status: SchemaBmsOrderStatus;
  totalAmount: Scalars['Float']['output'];
  trackingNo: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsCustomerStats = {
  __typename?: 'BmsCustomerStats';
  avgOrderValue: Scalars['Float']['output'];
  avgResponseTimeSeconds: Maybe<Scalars['Int']['output']>;
  cancelledOrders: Scalars['Int']['output'];
  completedOrders: Scalars['Int']['output'];
  lastConversationAt: Maybe<Scalars['String']['output']>;
  lastOrderDate: Maybe<Scalars['String']['output']>;
  lifetimeValue: Scalars['Float']['output'];
  refundCount: Scalars['Int']['output'];
  totalOrders: Scalars['Int']['output'];
};

export type SchemaBmsCustomerTimelineEntry = {
  __typename?: 'BmsCustomerTimelineEntry';
  at: Scalars['String']['output'];
  ref: Maybe<Scalars['String']['output']>;
  text: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export type SchemaBmsDailySales = {
  __typename?: 'BmsDailySales';
  day: Scalars['String']['output'];
  orders: Scalars['Int']['output'];
  revenue: Scalars['Float']['output'];
};

export type SchemaBmsDashboard = {
  __typename?: 'BmsDashboard';
  couponSummary: Maybe<SchemaBmsCouponSummary>;
  customerCount: Scalars['Int']['output'];
  lowStockCount: Scalars['Int']['output'];
  orderCount: Scalars['Int']['output'];
  ordersByStatus: Array<SchemaBmsStatusCount>;
  revenueToday: Scalars['Float']['output'];
  revenueTotal: Scalars['Float']['output'];
  salesDaily: Array<SchemaBmsDailySales>;
  topCustomers: Array<SchemaBmsTopCustomer>;
  topProducts: Array<SchemaBmsTopProduct>;
};

export type SchemaBmsDocLine = {
  __typename?: 'BmsDocLine';
  amount: Scalars['Float']['output'];
  name: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  unitPrice: Scalars['Float']['output'];
};

export type SchemaBmsEmailReportResult = {
  __typename?: 'BmsEmailReportResult';
  fileId: Scalars['Int']['output'];
  format: Scalars['String']['output'];
  reportType: Scalars['String']['output'];
  to: Scalars['String']['output'];
};

export type SchemaBmsEnrollMemberResult = {
  __typename?: 'BmsEnrollMemberResult';
  member: Maybe<SchemaBmsMember>;
  reason: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsEtaxRunResult = {
  __typename?: 'BmsEtaxRunResult';
  accepted: Scalars['Int']['output'];
  failed: Scalars['Int']['output'];
  processed: Scalars['Int']['output'];
  rejected: Scalars['Int']['output'];
};

export type SchemaBmsEtaxSubmission = {
  __typename?: 'BmsEtaxSubmission';
  attempts: Scalars['Int']['output'];
  docNo: Maybe<Scalars['String']['output']>;
  documentId: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  lastError: Maybe<Scalars['String']['output']>;
  nextAttemptAt: Maybe<Scalars['String']['output']>;
  provider: Maybe<Scalars['String']['output']>;
  providerRef: Maybe<Scalars['String']['output']>;
  sentAt: Maybe<Scalars['String']['output']>;
  settledAt: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsEtaxSummary = {
  __typename?: 'BmsEtaxSummary';
  accepted: Scalars['Int']['output'];
  enabled: Scalars['Boolean']['output'];
  failed: Scalars['Int']['output'];
  /**  ใบกำกับที่ออกแล้วแต่ยังไม่เคยเข้าคิว  */
  notQueued: Scalars['Int']['output'];
  pending: Scalars['Int']['output'];
  rejected: Scalars['Int']['output'];
  sent: Scalars['Int']['output'];
};

export type SchemaBmsExpiringLotItem = {
  __typename?: 'BmsExpiringLotItem';
  daysToExpiry: Scalars['Int']['output'];
  expiryDate: Scalars['String']['output'];
  lotNo: Scalars['String']['output'];
  name: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
  recommendedAction: Scalars['String']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsExpiringPointsRow = {
  __typename?: 'BmsExpiringPointsRow';
  customerId: Scalars['ID']['output'];
  expiringPoints: Scalars['Int']['output'];
  firstExpiresAt: Scalars['String']['output'];
  memberNo: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  phone: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsFollowupAnalytics = {
  __typename?: 'BmsFollowupAnalytics';
  activeJobs: Scalars['Int']['output'];
  avgIdleMinutesAtSend: Maybe<Scalars['Float']['output']>;
  avgRetryCount: Scalars['Float']['output'];
  byGoal: Array<SchemaBmsFollowupAnalyticsBucket>;
  byIntent: Array<SchemaBmsFollowupAnalyticsBucket>;
  daily: Array<SchemaBmsFollowupAnalyticsDaily>;
  failedHistory: Scalars['Int']['output'];
  failedJobs: Scalars['Int']['output'];
  orderRate: Scalars['Float']['output'];
  orderedAfterFollowup: Scalars['Int']['output'];
  pendingJobs: Scalars['Int']['output'];
  repliedAfterFollowup: Scalars['Int']['output'];
  replyRate: Scalars['Float']['output'];
  sentHistory: Scalars['Int']['output'];
  sentJobs: Scalars['Int']['output'];
  skippedHistory: Scalars['Int']['output'];
  stoppedJobs: Scalars['Int']['output'];
  totalHistory: Scalars['Int']['output'];
  windowDays: Scalars['Int']['output'];
};

export type SchemaBmsFollowupAnalyticsBucket = {
  __typename?: 'BmsFollowupAnalyticsBucket';
  failed: Scalars['Int']['output'];
  key: Scalars['String']['output'];
  ordered: Scalars['Int']['output'];
  replied: Scalars['Int']['output'];
  sent: Scalars['Int']['output'];
  skipped: Scalars['Int']['output'];
};

export type SchemaBmsFollowupAnalyticsDaily = {
  __typename?: 'BmsFollowupAnalyticsDaily';
  day: Scalars['String']['output'];
  failed: Scalars['Int']['output'];
  ordered: Scalars['Int']['output'];
  replied: Scalars['Int']['output'];
  sent: Scalars['Int']['output'];
  skipped: Scalars['Int']['output'];
};

export type SchemaBmsFollowupHistoryEntry = {
  __typename?: 'BmsFollowupHistoryEntry';
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  goal: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  jobId: Maybe<Scalars['ID']['output']>;
  messageBody: Maybe<Scalars['String']['output']>;
  outcome: Scalars['String']['output'];
  reason: Maybe<Scalars['String']['output']>;
  ruleId: Maybe<Scalars['ID']['output']>;
};

export type SchemaBmsFollowupJob = {
  __typename?: 'BmsFollowupJob';
  businessHoursOnly: Scalars['Boolean']['output'];
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  customerLifetimeValue: Maybe<Scalars['Float']['output']>;
  customerName: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  idleMinutes: Maybe<Scalars['Int']['output']>;
  intent: Scalars['String']['output'];
  lastMessageAt: Maybe<Scalars['String']['output']>;
  lastResult: Maybe<Scalars['String']['output']>;
  maxRetry: Scalars['Int']['output'];
  messageGoal: Scalars['String']['output'];
  nextRunAt: Scalars['String']['output'];
  priority: Scalars['Int']['output'];
  retryCount: Scalars['Int']['output'];
  ruleId: Scalars['ID']['output'];
  score: Scalars['Int']['output'];
  scoreLabel: Scalars['String']['output'];
  scoreReasons: Array<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  totalOrders: Scalars['Int']['output'];
  updatedAt: Scalars['String']['output'];
};

export type SchemaBmsFollowupRule = {
  __typename?: 'BmsFollowupRule';
  businessHoursOnly: Scalars['Boolean']['output'];
  createdAt: Scalars['String']['output'];
  delayMinutes: Scalars['Int']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  intent: Scalars['String']['output'];
  maxRetry: Scalars['Int']['output'];
  messageGoal: Scalars['String']['output'];
  priority: Scalars['Int']['output'];
  stopConditions: Array<Scalars['String']['output']>;
  template: Maybe<Scalars['String']['output']>;
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['String']['output'];
};

export type SchemaBmsFollowupRuleInput = {
  businessHoursOnly: InputMaybe<Scalars['Boolean']['input']>;
  delayMinutes: Scalars['Int']['input'];
  enabled: InputMaybe<Scalars['Boolean']['input']>;
  id: InputMaybe<Scalars['ID']['input']>;
  intent: Scalars['String']['input'];
  maxRetry: InputMaybe<Scalars['Int']['input']>;
  messageGoal: Scalars['String']['input'];
  priority: InputMaybe<Scalars['Int']['input']>;
  stopConditions: InputMaybe<Array<Scalars['String']['input']>>;
  template: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsFollowupRunResult = {
  __typename?: 'BmsFollowupRunResult';
  failed: Scalars['Int']['output'];
  scanned: Scalars['Int']['output'];
  sent: Scalars['Int']['output'];
  skipped: Scalars['Int']['output'];
};

export type SchemaBmsGenerateReportInput = {
  dateFrom: InputMaybe<Scalars['String']['input']>;
  dateTo: InputMaybe<Scalars['String']['input']>;
  format: Scalars['String']['input'];
  includeSummary: InputMaybe<Scalars['Boolean']['input']>;
  reportType: Scalars['String']['input'];
};

export type SchemaBmsGenerateReportResult = {
  __typename?: 'BmsGenerateReportResult';
  fileId: Scalars['Int']['output'];
  fileUrl: Scalars['String']['output'];
  format: Scalars['String']['output'];
  reportType: Scalars['String']['output'];
  summary: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsGeneratedReport = {
  __typename?: 'BmsGeneratedReport';
  createdAt: Scalars['String']['output'];
  fileId: Maybe<Scalars['Int']['output']>;
  fileUrl: Maybe<Scalars['String']['output']>;
  format: Scalars['String']['output'];
  generatedBy: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  params: Scalars['JSON']['output'];
  reportType: Scalars['String']['output'];
  summary: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsInboxChangedPayload = {
  __typename?: 'BmsInboxChangedPayload';
  conversationId: Scalars['ID']['output'];
  kind: Scalars['String']['output'];
  messageId: Maybe<Scalars['ID']['output']>;
  messageSource: Maybe<Scalars['String']['output']>;
  occurredAt: Scalars['String']['output'];
};

export type SchemaBmsInboxDiagnosticEventResult = {
  __typename?: 'BmsInboxDiagnosticEventResult';
  channel: Scalars['String']['output'];
  conversationId: Scalars['ID']['output'];
  kind: Scalars['String']['output'];
  message: Scalars['String']['output'];
  occurredAt: Scalars['String']['output'];
  ok: Scalars['Boolean']['output'];
};

export type SchemaBmsInboxDiagnosticLatest = {
  __typename?: 'BmsInboxDiagnosticLatest';
  channel: Scalars['String']['output'];
  conversationId: Scalars['ID']['output'];
  customerRef: Scalars['String']['output'];
  lastInboundAt: Scalars['String']['output'];
};

export type SchemaBmsInboxDiagnosticMessageResult = {
  __typename?: 'BmsInboxDiagnosticMessageResult';
  channel: Scalars['String']['output'];
  conversationId: Scalars['ID']['output'];
  customerRef: Scalars['String']['output'];
  message: Scalars['String']['output'];
  messageId: Scalars['ID']['output'];
  occurredAt: Scalars['String']['output'];
  ok: Scalars['Boolean']['output'];
};

export type SchemaBmsInventoryActionCenter = {
  __typename?: 'BmsInventoryActionCenter';
  expiringLots: Array<SchemaBmsExpiringLotItem>;
  lowStock: Array<SchemaBmsInventoryActionLowStockItem>;
  purchaseSuggestions: Array<SchemaBmsPurchaseSuggestionItem>;
  slowMoving: Array<SchemaBmsSlowMovingItem>;
  stockoutRisk: Array<SchemaBmsStockoutRiskItem>;
  summary: SchemaBmsInventoryActionSummary;
};

export type SchemaBmsInventoryActionLowStockItem = {
  __typename?: 'BmsInventoryActionLowStockItem';
  available: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  reorderPoint: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsInventoryActionSummary = {
  __typename?: 'BmsInventoryActionSummary';
  coverageDays: Scalars['Int']['output'];
  deadStockCount: Scalars['Int']['output'];
  disclaimer: Scalars['String']['output'];
  expiringLotCount: Scalars['Int']['output'];
  expiringUnits: Scalars['Int']['output'];
  lowStockCount: Scalars['Int']['output'];
  outOfStockCount: Scalars['Int']['output'];
  purchaseSuggestionCount: Scalars['Int']['output'];
  slowMovingCount: Scalars['Int']['output'];
  stockoutWithin7DaysCount: Scalars['Int']['output'];
  totalSuggestedQty: Scalars['Int']['output'];
  windowDays: Scalars['Int']['output'];
};

export type SchemaBmsInventoryDemandInput = {
  kind: SchemaBmsInventoryDemandKind;
  note: InputMaybe<Scalars['String']['input']>;
  qty: Scalars['Int']['input'];
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};

export type SchemaBmsInventoryDemandKind =
  | 'LOST_SALE'
  | 'RESTOCK_REQUEST';

export type SchemaBmsInventoryLot = {
  __typename?: 'BmsInventoryLot';
  expiryDate: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  locationId: Scalars['ID']['output'];
  lotNo: Scalars['String']['output'];
  note: Maybe<Scalars['String']['output']>;
  productSku: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
  receivedAt: Scalars['String']['output'];
  size: Scalars['String']['output'];
  supplierId: Maybe<Scalars['ID']['output']>;
  unitCost: Maybe<Scalars['Float']['output']>;
};

export type SchemaBmsInventoryPolicyInput = {
  leadTimeDays: Scalars['Int']['input'];
  safetyStockDays: Scalars['Int']['input'];
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};

export type SchemaBmsInventorySummary = {
  __typename?: 'BmsInventorySummary';
  availableUnits: Scalars['Int']['output'];
  lowStockCount: Scalars['Int']['output'];
  outOfStockCount: Scalars['Int']['output'];
  reservedUnits: Scalars['Int']['output'];
  skuCount: Scalars['Int']['output'];
  stockValue: Scalars['Float']['output'];
  totalUnits: Scalars['Int']['output'];
  variantCount: Scalars['Int']['output'];
};

export type SchemaBmsInventoryWastage = {
  __typename?: 'BmsInventoryWastage';
  actorName: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  locationId: Scalars['ID']['output'];
  locationName: Maybe<Scalars['String']['output']>;
  orderId: Maybe<Scalars['ID']['output']>;
  productName: Scalars['String']['output'];
  productSku: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
  reason: Scalars['String']['output'];
  size: Scalars['String']['output'];
};

export type SchemaBmsInventoryWastageInput = {
  locationId: Scalars['ID']['input'];
  orderId: InputMaybe<Scalars['ID']['input']>;
  productSku: Scalars['String']['input'];
  qty: Scalars['Int']['input'];
  reason: Scalars['String']['input'];
  size: Scalars['String']['input'];
};

export type SchemaBmsInventoryWastageResult = {
  __typename?: 'BmsInventoryWastageResult';
  id: Scalars['ID']['output'];
};

export type SchemaBmsIssueFullTaxInvoiceResult = {
  __typename?: 'BmsIssueFullTaxInvoiceResult';
  cancelledAbbreviated: Maybe<SchemaBmsTaxDocument>;
  document: Maybe<SchemaBmsTaxDocument>;
  reason: Maybe<Scalars['String']['output']>;
  skus: Maybe<Array<Scalars['String']['output']>>;
  status: Scalars['String']['output'];
};

export type SchemaBmsIssueStoreCreditInput = {
  amount: Scalars['Float']['input'];
  code: InputMaybe<Scalars['String']['input']>;
  customerId: InputMaybe<Scalars['ID']['input']>;
  expiresAt: InputMaybe<Scalars['String']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsJsConsoleLog = {
  __typename?: 'BmsJsConsoleLog';
  level: Scalars['String']['output'];
  text: Scalars['String']['output'];
};

export type SchemaBmsJsConsoleResult = {
  __typename?: 'BmsJsConsoleResult';
  durationMs: Scalars['Int']['output'];
  error: Maybe<Scalars['String']['output']>;
  logs: Array<SchemaBmsJsConsoleLog>;
  ok: Scalars['Boolean']['output'];
  result: Maybe<Scalars['String']['output']>;
};

/** สถานีครัว (9.54) — พื้นที่ทำงานในสาขา ไม่ใช่สาขา และไม่แยกสต็อก */
export type SchemaBmsKitchenStation = {
  __typename?: 'BmsKitchenStation';
  active: Scalars['Boolean']['output'];
  activeProductCount: Scalars['Int']['output'];
  code: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  description: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  lateMinutes: Scalars['Int']['output'];
  /** null = ใช้ได้ทุกสาขา · มีค่า = ของสาขานั้นสาขาเดียว */
  locationId: Maybe<Scalars['ID']['output']>;
  locationName: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  productCount: Scalars['Int']['output'];
  slaConfigured: Scalars['Boolean']['output'];
  sortOrder: Scalars['Int']['output'];
  updatedAt: Scalars['String']['output'];
  warnMinutes: Scalars['Int']['output'];
};

export type SchemaBmsKitchenStationInput = {
  active: InputMaybe<Scalars['Boolean']['input']>;
  /** ไม่ส่ง = derive จากชื่อ (ร้านส่วนใหญ่ไม่เคยอยากตั้งรหัสเอง) */
  code: InputMaybe<Scalars['String']['input']>;
  description: InputMaybe<Scalars['String']['input']>;
  locationId: InputMaybe<Scalars['ID']['input']>;
  name: InputMaybe<Scalars['String']['input']>;
  sortOrder: InputMaybe<Scalars['Int']['input']>;
};

/** เกณฑ์เวลาของจอครัวต่อสถานี (9.53) — สถานีที่ยังไม่ตั้งค่าคืนค่าปริยายพร้อม configured=false */
export type SchemaBmsKitchenStationSla = {
  __typename?: 'BmsKitchenStationSla';
  configured: Scalars['Boolean']['output'];
  lateMinutes: Scalars['Int']['output'];
  station: Scalars['String']['output'];
  /** null = ชื่อที่ยังไม่มีแถวหลักในตารางสถานี */
  stationId: Maybe<Scalars['ID']['output']>;
  warnMinutes: Scalars['Int']['output'];
};

export type SchemaBmsKitchenTicket = {
  __typename?: 'BmsKitchenTicket';
  checkId: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  kitchenNote: Maybe<Scalars['String']['output']>;
  modifierCodes: Array<Scalars['String']['output']>;
  /** null สำหรับตั๋วของบิลโต๊ะ (ยังไม่มีออร์เดอร์ที่ปิดการขาย) */
  orderId: Maybe<Scalars['ID']['output']>;
  orderItemId: Scalars['ID']['output'];
  packQty: Maybe<Scalars['Int']['output']>;
  productName: Scalars['String']['output'];
  productSku: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
  roundNo: Maybe<Scalars['Int']['output']>;
  size: Scalars['String']['output'];
  /** ORDER = ตั๋วจากบิลที่ปิดการขายแล้ว · RESTAURANT_CHECK = ตั๋วจากบิลโต๊ะก่อนชำระเงิน */
  source: Scalars['String']['output'];
  /** ชื่อสถานี ณ เวลาที่ตั๋วถูกสร้าง (snapshot) — เปลี่ยนชื่อสถานีแล้วใบเก่าต้องไม่เปลี่ยนตาม */
  station: Maybe<Scalars['String']['output']>;
  /** id ของสถานี (9.54) — null สำหรับตั๋วเก่าหรือสถานีที่ยังไม่ถูกยกระดับ */
  stationId: Maybe<Scalars['ID']['output']>;
  status: Scalars['String']['output'];
  tableCode: Maybe<Scalars['String']['output']>;
  tableName: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['String']['output'];
};

export type SchemaBmsLabelItem = {
  __typename?: 'BmsLabelItem';
  qty: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsLabelShipTo = {
  __typename?: 'BmsLabelShipTo';
  address: Maybe<Scalars['String']['output']>;
  name: Maybe<Scalars['String']['output']>;
  phone: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsLocation = {
  __typename?: 'BmsLocation';
  active: Scalars['Boolean']['output'];
  address: Maybe<Scalars['String']['output']>;
  branchCode: Scalars['String']['output'];
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isHeadOffice: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  pharmacistLicenseNo: Maybe<Scalars['String']['output']>;
  pharmacistName: Maybe<Scalars['String']['output']>;
  pharmacyLicenseNo: Maybe<Scalars['String']['output']>;
  phone: Maybe<Scalars['String']['output']>;
  vatCode: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsLocationInput = {
  active: InputMaybe<Scalars['Boolean']['input']>;
  address: InputMaybe<Scalars['String']['input']>;
  branchCode: Scalars['String']['input'];
  code: Scalars['String']['input'];
  id: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  phone: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsLotMismatch = {
  __typename?: 'BmsLotMismatch';
  currentStock: Scalars['Int']['output'];
  locationId: Scalars['ID']['output'];
  lotTotal: Scalars['Int']['output'];
  productSku: Scalars['String']['output'];
  size: Scalars['String']['output'];
};

export type SchemaBmsLotRecallHit = {
  __typename?: 'BmsLotRecallHit';
  channel: Scalars['String']['output'];
  customerId: Maybe<Scalars['ID']['output']>;
  customerName: Maybe<Scalars['String']['output']>;
  customerPhone: Maybe<Scalars['String']['output']>;
  orderCreatedAt: Scalars['String']['output'];
  orderId: Scalars['ID']['output'];
  productSku: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
};

export type SchemaBmsLowStockItem = {
  __typename?: 'BmsLowStockItem';
  available: Scalars['Int']['output'];
  branchCode: Scalars['String']['output'];
  locationId: Scalars['ID']['output'];
  locationName: Scalars['String']['output'];
  name: Scalars['String']['output'];
  reorder_point: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsLoyaltyActivityRow = {
  __typename?: 'BmsLoyaltyActivityRow';
  adjustedNet: Scalars['Int']['output'];
  earned: Scalars['Int']['output'];
  expired: Scalars['Int']['output'];
  month: Scalars['String']['output'];
  redeemed: Scalars['Int']['output'];
  reversedNet: Scalars['Int']['output'];
};

export type SchemaBmsLoyaltyBalance = {
  __typename?: 'BmsLoyaltyBalance';
  balance: Scalars['Int']['output'];
};

export type SchemaBmsLoyaltyExpireResult = {
  __typename?: 'BmsLoyaltyExpireResult';
  customers: Scalars['Int']['output'];
  points: Scalars['Int']['output'];
};

export type SchemaBmsLoyaltyLedgerEntry = {
  __typename?: 'BmsLoyaltyLedgerEntry';
  createdAt: Scalars['String']['output'];
  expiresAt: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  kind: Scalars['String']['output'];
  note: Maybe<Scalars['String']['output']>;
  orderId: Maybe<Scalars['ID']['output']>;
  points: Scalars['Int']['output'];
  posReturnId: Maybe<Scalars['ID']['output']>;
};

export type SchemaBmsLoyaltyOutstanding = {
  __typename?: 'BmsLoyaltyOutstanding';
  balanceMismatchCount: Scalars['Int']['output'];
  expiringIn30Days: Scalars['Int']['output'];
  members: Scalars['Int']['output'];
  outstandingPoints: Scalars['Int']['output'];
  outstandingValue: Scalars['Float']['output'];
};

export type SchemaBmsLoyaltySettings = {
  __typename?: 'BmsLoyaltySettings';
  earnBase: Scalars['String']['output'];
  earnMinSpend: Scalars['Float']['output'];
  earnMode: Scalars['String']['output'];
  earnPointsPerBaht: Scalars['Float']['output'];
  enabled: Scalars['Boolean']['output'];
  maxDiscountPct: Scalars['Float']['output'];
  pointsExpireMonths: Scalars['Int']['output'];
  redeemBahtPerUnit: Scalars['Float']['output'];
  redeemMinPoints: Scalars['Int']['output'];
  redeemPointsPerUnit: Scalars['Int']['output'];
  visitPoints: Scalars['Int']['output'];
};

export type SchemaBmsLoyaltySettingsInput = {
  earnBase: InputMaybe<Scalars['String']['input']>;
  earnMinSpend: InputMaybe<Scalars['Float']['input']>;
  earnMode: InputMaybe<Scalars['String']['input']>;
  earnPointsPerBaht: InputMaybe<Scalars['Float']['input']>;
  enabled: InputMaybe<Scalars['Boolean']['input']>;
  maxDiscountPct: InputMaybe<Scalars['Float']['input']>;
  pointsExpireMonths: InputMaybe<Scalars['Int']['input']>;
  redeemBahtPerUnit: InputMaybe<Scalars['Float']['input']>;
  redeemMinPoints: InputMaybe<Scalars['Int']['input']>;
  redeemPointsPerUnit: InputMaybe<Scalars['Int']['input']>;
  visitPoints: InputMaybe<Scalars['Int']['input']>;
};

export type SchemaBmsMailLogEntry = {
  __typename?: 'BmsMailLogEntry';
  category: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  error: Maybe<Scalars['String']['output']>;
  fromEmail: Maybe<Scalars['String']['output']>;
  html: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  messageId: Maybe<Scalars['String']['output']>;
  provider: Scalars['String']['output'];
  status: Scalars['String']['output'];
  statusCode: Maybe<Scalars['Int']['output']>;
  subject: Maybe<Scalars['String']['output']>;
  tenantId: Maybe<Scalars['ID']['output']>;
  tenantName: Maybe<Scalars['String']['output']>;
  textBody: Maybe<Scalars['String']['output']>;
  toEmail: Scalars['String']['output'];
  triggeredBy: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsMailLogPage = {
  __typename?: 'BmsMailLogPage';
  items: Array<SchemaBmsMailLogEntry>;
  total: Scalars['Int']['output'];
};

export type SchemaBmsMailLogStats = {
  __typename?: 'BmsMailLogStats';
  error: Scalars['Int']['output'];
  success: Scalars['Int']['output'];
  topErrorProvider: Maybe<Scalars['String']['output']>;
  total: Scalars['Int']['output'];
};

export type SchemaBmsMe = {
  __typename?: 'BmsMe';
  avatar: Maybe<Scalars['String']['output']>;
  created_at: Maybe<Scalars['String']['output']>;
  email: Maybe<Scalars['String']['output']>;
  gender: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  is_available: Scalars['Boolean']['output'];
  is_platform_admin: Scalars['Boolean']['output'];
  language: Maybe<Scalars['String']['output']>;
  name: Maybe<Scalars['String']['output']>;
  permissions: Array<Scalars['String']['output']>;
  phone: Maybe<Scalars['String']['output']>;
  role: Scalars['String']['output'];
  tenant: Maybe<SchemaBmsMeTenant>;
  themePreference: Scalars['String']['output'];
  username: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsMeTenant = {
  __typename?: 'BmsMeTenant';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  plan: Scalars['String']['output'];
  slug: Scalars['String']['output'];
};

export type SchemaBmsMember = {
  __typename?: 'BmsMember';
  customerId: Scalars['ID']['output'];
  enrolledBranchCode: Maybe<Scalars['String']['output']>;
  enrolledByName: Maybe<Scalars['String']['output']>;
  enrolledByUserId: Maybe<Scalars['ID']['output']>;
  enrolledLocationId: Maybe<Scalars['ID']['output']>;
  enrolledLocationName: Maybe<Scalars['String']['output']>;
  enrolledPosDeviceId: Maybe<Scalars['ID']['output']>;
  enrolledPosDeviceName: Maybe<Scalars['String']['output']>;
  enrolledRegisteredPosNo: Maybe<Scalars['String']['output']>;
  enrolledShiftId: Maybe<Scalars['ID']['output']>;
  enrollmentChannel: Maybe<Scalars['String']['output']>;
  memberNo: Maybe<Scalars['String']['output']>;
  memberSince: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  phone: Maybe<Scalars['String']['output']>;
  pointsBalance: Scalars['Int']['output'];
  pointsUsable: Scalars['Int']['output'];
  tier: Maybe<SchemaBmsMembershipTier>;
};

export type SchemaBmsMemberDiscountPreview = {
  __typename?: 'BmsMemberDiscountPreview';
  capped: Scalars['Boolean']['output'];
  cappedAt: Scalars['Float']['output'];
  couponDiscount: Scalars['Float']['output'];
  manualDiscount: Scalars['Float']['output'];
  member: Maybe<SchemaBmsMember>;
  netTotal: Scalars['Float']['output'];
  pointsDiscount: Scalars['Float']['output'];
  pointsUsed: Scalars['Int']['output'];
  subtotal: Scalars['Float']['output'];
  tierDiscount: Scalars['Float']['output'];
  tierLabel: Maybe<Scalars['String']['output']>;
  totalDiscount: Scalars['Float']['output'];
};

export type SchemaBmsMemberPage = {
  __typename?: 'BmsMemberPage';
  members: Array<SchemaBmsMember>;
  total: Scalars['Int']['output'];
};

export type SchemaBmsMembershipTier = {
  __typename?: 'BmsMembershipTier';
  active: Scalars['Boolean']['output'];
  code: Scalars['String']['output'];
  discountType: Scalars['String']['output'];
  discountValue: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  qualifyPoints: Scalars['Int']['output'];
  qualifySpend12m: Scalars['Float']['output'];
  sortOrder: Scalars['Int']['output'];
};

export type SchemaBmsMembershipTierInput = {
  active: Scalars['Boolean']['input'];
  code: Scalars['String']['input'];
  discountType: Scalars['String']['input'];
  discountValue: Scalars['Float']['input'];
  id: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  qualifyPoints: Scalars['Int']['input'];
  qualifySpend12m: Scalars['Float']['input'];
  sortOrder: Scalars['Int']['input'];
};

export type SchemaBmsMention = {
  __typename?: 'BmsMention';
  author: Maybe<Scalars['String']['output']>;
  body: Scalars['String']['output'];
  channel: Scalars['String']['output'];
  conversationId: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  customerName: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  readAt: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsMessage = {
  __typename?: 'BmsMessage';
  attachment: Maybe<SchemaBmsMessageAttachment>;
  body: Scalars['String']['output'];
  canReportDelivery: Scalars['Boolean']['output'];
  createdAt: Scalars['String']['output'];
  direction: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  sender: Maybe<Scalars['String']['output']>;
  status: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsMessageAttachment = {
  __typename?: 'BmsMessageAttachment';
  isImage: Scalars['Boolean']['output'];
  mimeType: Maybe<Scalars['String']['output']>;
  name: Maybe<Scalars['String']['output']>;
  url: Scalars['String']['output'];
};

export type SchemaBmsMobileCommissionReport = {
  __typename?: 'BmsMobileCommissionReport';
  from: Scalars['String']['output'];
  noRulesConfigured: Scalars['Boolean']['output'];
  rows: Array<SchemaBmsMobileCommissionRow>;
  to: Scalars['String']['output'];
  totalCommission: Scalars['Float']['output'];
};

export type SchemaBmsMobileCommissionReportResult = {
  __typename?: 'BmsMobileCommissionReportResult';
  report: SchemaBmsMobileCommissionReport;
};

export type SchemaBmsMobileCommissionRow = {
  __typename?: 'BmsMobileCommissionRow';
  billCount: Scalars['Int']['output'];
  commission: Scalars['Float']['output'];
  eligibleSales: Scalars['Float']['output'];
  grossSales: Scalars['Float']['output'];
  returnedSales: Scalars['Float']['output'];
  staffId: Scalars['ID']['output'];
  staffName: Scalars['String']['output'];
};

export type SchemaBmsMobileCommissionRule = {
  __typename?: 'BmsMobileCommissionRule';
  effectiveFrom: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  note: Maybe<Scalars['String']['output']>;
  percent: Scalars['Float']['output'];
  ref: Maybe<Scalars['String']['output']>;
  scope: Scalars['String']['output'];
};

export type SchemaBmsMobileCommissionRuleActionResult = {
  __typename?: 'BmsMobileCommissionRuleActionResult';
  id: Maybe<Scalars['Int']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsMobileCommissionRulesResult = {
  __typename?: 'BmsMobileCommissionRulesResult';
  rules: Array<SchemaBmsMobileCommissionRule>;
};

export type SchemaBmsMobileRestaurantRequest = {
  __typename?: 'BmsMobileRestaurantRequest';
  agreedItems: Maybe<Array<SchemaBmsMobileRestaurantRequestItem>>;
  checkoutUrl: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  customerName: Maybe<Scalars['String']['output']>;
  fulfillmentType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsMobileRestaurantRequestItem>;
  locationId: Scalars['ID']['output'];
  locationName: Scalars['String']['output'];
  note: Maybe<Scalars['String']['output']>;
  orderId: Maybe<Scalars['ID']['output']>;
  phone: Maybe<Scalars['String']['output']>;
  requestedAt: Maybe<Scalars['String']['output']>;
  reviewNote: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  version: Scalars['Int']['output'];
};

export type SchemaBmsMobileRestaurantRequestActionResult = {
  __typename?: 'BmsMobileRestaurantRequestActionResult';
  checkoutUrl: Maybe<Scalars['String']['output']>;
  failure: Maybe<SchemaBmsPosSaleResult>;
  orderId: Maybe<Scalars['ID']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsMobileRestaurantRequestItem = {
  __typename?: 'BmsMobileRestaurantRequestItem';
  modifierCodes: Maybe<Array<Scalars['String']['output']>>;
  modifierNames: Maybe<Array<Scalars['String']['output']>>;
  name: Maybe<Scalars['String']['output']>;
  packCode: Maybe<Scalars['String']['output']>;
  qty: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  unitName: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsMobileRestaurantRequestsResult = {
  __typename?: 'BmsMobileRestaurantRequestsResult';
  enabled: Scalars['Boolean']['output'];
  requests: Array<SchemaBmsMobileRestaurantRequest>;
};

export type SchemaBmsMobileStockCount = {
  __typename?: 'BmsMobileStockCount';
  appliedAt: Maybe<Scalars['String']['output']>;
  countNo: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  createdByName: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsMobileStockCountItem>;
  locationId: Scalars['ID']['output'];
  locationName: Maybe<Scalars['String']['output']>;
  note: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  varianceUnits: Scalars['Int']['output'];
};

export type SchemaBmsMobileStockCountActionResult = {
  __typename?: 'BmsMobileStockCountActionResult';
  adjustedItems: Maybe<Scalars['Int']['output']>;
  countId: Maybe<Scalars['ID']['output']>;
  countNo: Maybe<Scalars['String']['output']>;
  current: Maybe<Scalars['String']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  reserved: Maybe<Scalars['Float']['output']>;
  size: Maybe<Scalars['String']['output']>;
  sku: Maybe<Scalars['String']['output']>;
  snapshotQty: Maybe<Scalars['Int']['output']>;
  status: Scalars['String']['output'];
  variance: Maybe<Scalars['Int']['output']>;
  varianceUnits: Maybe<Scalars['Int']['output']>;
  wouldBe: Maybe<Scalars['Float']['output']>;
};

export type SchemaBmsMobileStockCountItem = {
  __typename?: 'BmsMobileStockCountItem';
  countedQty: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  note: Maybe<Scalars['String']['output']>;
  productName: Maybe<Scalars['String']['output']>;
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  snapshotQty: Scalars['Int']['output'];
  variance: Scalars['Int']['output'];
};

export type SchemaBmsMobileStockCountsResult = {
  __typename?: 'BmsMobileStockCountsResult';
  counts: Array<SchemaBmsMobileStockCount>;
  locations: Array<SchemaBmsLocation>;
};

export type SchemaBmsMobileStockTransfer = {
  __typename?: 'BmsMobileStockTransfer';
  createdAt: Scalars['String']['output'];
  createdByName: Maybe<Scalars['String']['output']>;
  fromLocationId: Scalars['ID']['output'];
  fromLocationName: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsMobileStockTransferItem>;
  note: Maybe<Scalars['String']['output']>;
  receivedAt: Maybe<Scalars['String']['output']>;
  receivingNote: Maybe<Scalars['String']['output']>;
  sentAt: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  toLocationId: Scalars['ID']['output'];
  toLocationName: Maybe<Scalars['String']['output']>;
  transferNo: Scalars['String']['output'];
};

export type SchemaBmsMobileStockTransferActionResult = {
  __typename?: 'BmsMobileStockTransferActionResult';
  available: Maybe<Scalars['Float']['output']>;
  current: Maybe<Scalars['String']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  requested: Maybe<Scalars['Float']['output']>;
  size: Maybe<Scalars['String']['output']>;
  sku: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  transferId: Maybe<Scalars['ID']['output']>;
  transferNo: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsMobileStockTransferItem = {
  __typename?: 'BmsMobileStockTransferItem';
  damagedQty: Scalars['Int']['output'];
  discrepancyNote: Maybe<Scalars['String']['output']>;
  discrepancyReason: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  missingQty: Maybe<Scalars['Int']['output']>;
  productName: Maybe<Scalars['String']['output']>;
  qty: Scalars['Int']['output'];
  receivedQty: Maybe<Scalars['Int']['output']>;
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsMobileStockTransfersResult = {
  __typename?: 'BmsMobileStockTransfersResult';
  locations: Array<SchemaBmsLocation>;
  transfers: Array<SchemaBmsMobileStockTransfer>;
};

export type SchemaBmsMobileStoreCredit = {
  __typename?: 'BmsMobileStoreCredit';
  balance: Scalars['Float']['output'];
  code: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  customerId: Maybe<Scalars['ID']['output']>;
  customerName: Maybe<Scalars['String']['output']>;
  expiresAt: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  note: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsMobileStoreCreditActionResult = {
  __typename?: 'BmsMobileStoreCreditActionResult';
  credit: Maybe<SchemaBmsMobileStoreCredit>;
  reason: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsMobileStoreCreditOutstanding = {
  __typename?: 'BmsMobileStoreCreditOutstanding';
  activeCards: Scalars['Int']['output'];
  balanceMismatchCount: Scalars['Int']['output'];
  outstandingAmount: Scalars['Float']['output'];
};

export type SchemaBmsMobileStoreCreditResult = {
  __typename?: 'BmsMobileStoreCreditResult';
  credit: Maybe<SchemaBmsMobileStoreCredit>;
  outstanding: Maybe<SchemaBmsMobileStoreCreditOutstanding>;
};

export type SchemaBmsModifierComponent = {
  __typename?: 'BmsModifierComponent';
  qtyDelta: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsModifierComponentInput = {
  qtyDelta: Scalars['Int']['input'];
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};

export type SchemaBmsOnboardingProgress = {
  __typename?: 'BmsOnboardingProgress';
  completed: Array<Scalars['String']['output']>;
  dismissedAt: Maybe<Scalars['String']['output']>;
  lastSeenAt: Maybe<Scalars['String']['output']>;
  skipped: Array<Scalars['String']['output']>;
};

export type SchemaBmsOpenShiftResult = {
  __typename?: 'BmsOpenShiftResult';
  reason: Maybe<Scalars['String']['output']>;
  shift: Maybe<SchemaBmsPosShift>;
  status: Scalars['String']['output'];
};

export type SchemaBmsOperationalAlerts = {
  __typename?: 'BmsOperationalAlerts';
  chatWaitingCount: Scalars['Int']['output'];
  packingOverdueCount: Scalars['Int']['output'];
  reservationExpiringCount: Scalars['Int']['output'];
  slipPendingCount: Scalars['Int']['output'];
};

export type SchemaBmsOrder = {
  __typename?: 'BmsOrder';
  amount_due: Scalars['Float']['output'];
  branchCode: Maybe<Scalars['String']['output']>;
  channel: Scalars['String']['output'];
  coupon_code: Maybe<Scalars['String']['output']>;
  created_at: Scalars['String']['output'];
  customer_ref: Maybe<Scalars['String']['output']>;
  deposit_balance_due: Scalars['Float']['output'];
  deposit_paid: Scalars['Float']['output'];
  deposit_status: Maybe<Scalars['String']['output']>;
  discountLines: Array<SchemaBmsOrderDiscountLine>;
  discount_amount: Scalars['Float']['output'];
  fulfillmentType: Maybe<Scalars['String']['output']>;
  hasShippingAddress: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsOrderItem>;
  locationId: Maybe<Scalars['ID']['output']>;
  locationName: Maybe<Scalars['String']['output']>;
  pendingRefundAmount: Scalars['Float']['output'];
  pendingRefundCount: Scalars['Int']['output'];
  pendingRefundSince: Maybe<Scalars['String']['output']>;
  posDeviceName: Maybe<Scalars['String']['output']>;
  posShiftId: Maybe<Scalars['ID']['output']>;
  preferred_carrier: Maybe<SchemaBmsCarrier>;
  promisedAt: Maybe<Scalars['String']['output']>;
  registeredPosNo: Maybe<Scalars['String']['output']>;
  shipping_fee: Scalars['Float']['output'];
  status: SchemaBmsOrderStatus;
  total_amount: Scalars['Float']['output'];
  updated_at: Scalars['String']['output'];
};

export type SchemaBmsOrderDiscountLine = {
  __typename?: 'BmsOrderDiscountLine';
  amount: Scalars['Float']['output'];
  label: Scalars['String']['output'];
  pointsUsed: Scalars['Int']['output'];
  source: Scalars['String']['output'];
};

export type SchemaBmsOrderEvent = {
  __typename?: 'BmsOrderEvent';
  actorName: Maybe<Scalars['String']['output']>;
  at: Scalars['String']['output'];
  kind: Scalars['String']['output'];
  text: Scalars['String']['output'];
};

export type SchemaBmsOrderItem = {
  __typename?: 'BmsOrderItem';
  product_name: Maybe<Scalars['String']['output']>;
  product_sku: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  unit_price: Scalars['Float']['output'];
};

export type SchemaBmsOrderItemInput = {
  qty: Scalars['Int']['input'];
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};

export type SchemaBmsOrderJourney = {
  __typename?: 'BmsOrderJourney';
  amountDue: Scalars['Float']['output'];
  assignedStaff: Maybe<SchemaBmsStaffRef>;
  channel: Scalars['String']['output'];
  conversationId: Maybe<Scalars['ID']['output']>;
  depositBalanceDue: Scalars['Float']['output'];
  depositStatus: Maybe<Scalars['String']['output']>;
  events: Array<SchemaBmsOrderEvent>;
  helpers: Array<SchemaBmsStaffRef>;
  isDeposit: Scalars['Boolean']['output'];
  orderId: Scalars['ID']['output'];
  paidTotal: Scalars['Float']['output'];
  pendingSettlementTotal: Scalars['Float']['output'];
  remainingAfterReturn: Scalars['Float']['output'];
  returnedTotal: Scalars['Float']['output'];
  status: SchemaBmsOrderStatus;
  steps: Array<SchemaBmsOrderStep>;
};

export type SchemaBmsOrderStatus =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'PACKING'
  | 'PAID'
  | 'PENDING'
  | 'RETURNED'
  | 'SHIPPED';

export type SchemaBmsOrderStep = {
  __typename?: 'BmsOrderStep';
  actorName: Maybe<Scalars['String']['output']>;
  at: Maybe<Scalars['String']['output']>;
  branch: Scalars['Boolean']['output'];
  reached: Scalars['Boolean']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsPackAudit = {
  __typename?: 'BmsPackAudit';
  name: Scalars['String']['output'];
  packs: Scalars['Int']['output'];
  sizes: Scalars['Int']['output'];
  sizesWithoutBarcode: Array<Scalars['String']['output']>;
  sku: Scalars['String']['output'];
};

export type SchemaBmsPayment = {
  __typename?: 'BmsPayment';
  amount: Scalars['Float']['output'];
  completedRefundAmount: Scalars['Float']['output'];
  confirmedAt: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  method: SchemaBmsPaymentMethod;
  netAmount: Scalars['Float']['output'];
  note: Maybe<Scalars['String']['output']>;
  orderId: Scalars['ID']['output'];
  pendingRefundAmount: Scalars['Float']['output'];
  refundedAt: Maybe<Scalars['String']['output']>;
  rejectedAt: Maybe<Scalars['String']['output']>;
  slipRef: Maybe<Scalars['String']['output']>;
  slipUrl: Maybe<Scalars['String']['output']>;
  status: SchemaBmsPaymentStatus;
  updatedAt: Scalars['String']['output'];
  verifiedBy: Maybe<Scalars['String']['output']>;
  verifyResult: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPaymentAccount = {
  __typename?: 'BmsPaymentAccount';
  accountName: Maybe<Scalars['String']['output']>;
  accountNo: Maybe<Scalars['String']['output']>;
  bankName: Maybe<Scalars['String']['output']>;
  note: Maybe<Scalars['String']['output']>;
  promptpayId: Maybe<Scalars['String']['output']>;
  type: Scalars['String']['output'];
};

export type SchemaBmsPaymentAccountInput = {
  accountName: InputMaybe<Scalars['String']['input']>;
  accountNo: InputMaybe<Scalars['String']['input']>;
  bankName: InputMaybe<Scalars['String']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  promptpayId: InputMaybe<Scalars['String']['input']>;
  type: Scalars['String']['input'];
};

export type SchemaBmsPaymentMethod =
  | 'BANK_TRANSFER'
  | 'CARD'
  | 'CASH'
  | 'CREDIT'
  | 'QR'
  | 'STORE_CREDIT'
  | 'TIKTOK'
  | 'WALLET';

export type SchemaBmsPaymentResult = {
  __typename?: 'BmsPaymentResult';
  message: Maybe<Scalars['String']['output']>;
  paymentId: Maybe<Scalars['ID']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPaymentStatus =
  | 'CONFIRMED'
  | 'PENDING'
  | 'REFUNDED'
  | 'REJECTED';

/** 9.29 — หนึ่งแถวต่อ (บิล, สินค้า, ไซซ์) ที่เภสัชกรกด PIN อนุมัติจ่ายที่เคาน์เตอร์ */
export type SchemaBmsPharmacistCounterAuthorization = {
  __typename?: 'BmsPharmacistCounterAuthorization';
  cashierName: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  note: Maybe<Scalars['String']['output']>;
  /** รหัสสั้นที่พนักงานใช้เรียกบิล (ตรงกับที่หน้า POS โชว์ตอนขายจบ) */
  orderCode: Scalars['String']['output'];
  orderId: Scalars['ID']['output'];
  pharmacistName: Maybe<Scalars['String']['output']>;
  pharmacistUserId: Scalars['ID']['output'];
  policyStatus: Scalars['String']['output'];
  productName: Maybe<Scalars['String']['output']>;
  productSku: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
  /** policy ที่ถูกปลด ณ เวลานั้น (snapshot ไม่ใช่ค่าปัจจุบันของสินค้า) */
  salePolicy: Scalars['String']['output'];
  size: Scalars['String']['output'];
  /** เลขใบกำกับ/ใบเสร็จถ้าออกแล้ว — บิลมัดจำที่ยังไม่ส่งของยังไม่มี */
  taxDocNo: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPharmacistCounterAuthorizationPage = {
  __typename?: 'BmsPharmacistCounterAuthorizationPage';
  items: Array<SchemaBmsPharmacistCounterAuthorization>;
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type SchemaBmsPharmacyAssessment = {
  __typename?: 'BmsPharmacyAssessment';
  aiModelVersion: Maybe<Scalars['String']['output']>;
  aiPromptVersion: Maybe<Scalars['String']['output']>;
  aiSummary: Maybe<Scalars['String']['output']>;
  aiSummaryVersion: Scalars['Int']['output'];
  anomalies: Scalars['JSON']['output'];
  approvedAt: Maybe<Scalars['String']['output']>;
  approvedBy: Maybe<Scalars['ID']['output']>;
  assignedPharmacistId: Maybe<Scalars['ID']['output']>;
  biologicalSex: Scalars['String']['output'];
  breastfeedingStatus: Scalars['String']['output'];
  channelId: Maybe<Scalars['String']['output']>;
  checkoutOrderDraft: Maybe<Scalars['JSON']['output']>;
  closedAt: Maybe<Scalars['String']['output']>;
  complaint: Scalars['JSON']['output'];
  completenessStatus: Scalars['String']['output'];
  conflictingFields: Array<Scalars['String']['output']>;
  consentAt: Maybe<Scalars['String']['output']>;
  consentStatus: Scalars['String']['output'];
  consentVersion: Maybe<Scalars['String']['output']>;
  conversationId: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['String']['output'];
  currentQuestionKey: Maybe<Scalars['String']['output']>;
  customerConfirmationStatus: Scalars['String']['output'];
  customerConfirmationSummary: Scalars['JSON']['output'];
  customerConfirmedAt: Maybe<Scalars['String']['output']>;
  customerId: Maybe<Scalars['ID']['output']>;
  decisionReason: Maybe<Scalars['String']['output']>;
  detectedRedFlags: Scalars['JSON']['output'];
  escalationReason: Maybe<Scalars['String']['output']>;
  expiresAt: Maybe<Scalars['String']['output']>;
  heightCm: Maybe<Scalars['Float']['output']>;
  id: Scalars['ID']['output'];
  medicalInfo: Scalars['JSON']['output'];
  medicationSuggestions: Scalars['JSON']['output'];
  missingFields: Array<Scalars['String']['output']>;
  needsManualIntake: Scalars['Boolean']['output'];
  outOfScopeReason: Maybe<Scalars['String']['output']>;
  patientAgeYears: Maybe<Scalars['Int']['output']>;
  patientDob: Maybe<Scalars['String']['output']>;
  patientRelationship: Scalars['String']['output'];
  pharmacistDecisionNotes: Maybe<Scalars['String']['output']>;
  pharmacistEdits: Scalars['JSON']['output'];
  pregnancyStatus: Scalars['String']['output'];
  protocolId: Maybe<Scalars['ID']['output']>;
  rawMessages: Scalars['JSON']['output'];
  riskLevel: Scalars['String']['output'];
  status: Scalars['String']['output'];
  structuredAnswers: Scalars['JSON']['output'];
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['String']['output'];
  version: Scalars['Int']['output'];
  weightKg: Maybe<Scalars['Float']['output']>;
};

export type SchemaBmsPharmacyAssessmentEvent = {
  __typename?: 'BmsPharmacyAssessmentEvent';
  action: Scalars['String']['output'];
  actor: Scalars['String']['output'];
  assessmentId: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  meta: Scalars['JSON']['output'];
  nextState: Maybe<Scalars['String']['output']>;
  previousState: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPharmacyAssistantResult = {
  __typename?: 'BmsPharmacyAssistantResult';
  reply: Scalars['String']['output'];
  session: Scalars['JSON']['output'];
};

export type SchemaBmsPharmacyAssistantSessionInput = {
  answers: InputMaybe<Scalars['JSON']['input']>;
  currentFieldKey: InputMaybe<Scalars['String']['input']>;
  currentQuestionKey: InputMaybe<Scalars['String']['input']>;
  phase: InputMaybe<Scalars['String']['input']>;
  protocolId: InputMaybe<Scalars['String']['input']>;
  protocolKey: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPharmacyCatalogItem = {
  __typename?: 'BmsPharmacyCatalogItem';
  availableTotal: Scalars['Int']['output'];
  brand: Maybe<Scalars['String']['output']>;
  category: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  policyStatus: Scalars['String']['output'];
  price: Scalars['Float']['output'];
  productType: Scalars['String']['output'];
  salePolicy: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  variants: Array<SchemaBmsPharmacyCatalogVariant>;
};

export type SchemaBmsPharmacyCatalogVariant = {
  __typename?: 'BmsPharmacyCatalogVariant';
  available: Scalars['Int']['output'];
  size: Scalars['String']['output'];
};

/**
 * หลักฐานทางคลินิกของเคส (9.25) — ไม่มี fileId โดยตั้งใจ
 * รูปใบสั่งยาดูได้ทาง fileUrl เท่านั้น ซึ่งเป็น route ที่ตรวจสิทธิ์
 */
export type SchemaBmsPharmacyClinicalEvidence = {
  __typename?: 'BmsPharmacyClinicalEvidence';
  assessmentId: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  createdBy: Maybe<Scalars['ID']['output']>;
  createdByName: Maybe<Scalars['String']['output']>;
  fileMimetype: Maybe<Scalars['String']['output']>;
  fileName: Maybe<Scalars['String']['output']>;
  fileSize: Maybe<Scalars['Int']['output']>;
  fileUrl: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  kind: Scalars['String']['output'];
  source: Scalars['String']['output'];
  textValue: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPharmacyConversationHistory = {
  __typename?: 'BmsPharmacyConversationHistory';
  channel: Scalars['String']['output'];
  conversationId: Scalars['ID']['output'];
  customerName: Maybe<Scalars['String']['output']>;
  customerRef: Maybe<Scalars['String']['output']>;
  messages: Array<SchemaBmsPharmacyConversationHistoryMessage>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPharmacyConversationHistoryMessage = {
  __typename?: 'BmsPharmacyConversationHistoryMessage';
  body: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  direction: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  sender: Maybe<Scalars['String']['output']>;
  status: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPharmacyLabCartItemInput = {
  qty: Scalars['Int']['input'];
  size: InputMaybe<Scalars['String']['input']>;
  sku: Scalars['String']['input'];
};

export type SchemaBmsPharmacyLicenseUser = {
  __typename?: 'BmsPharmacyLicenseUser';
  email: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isLicensedPharmacist: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  pharmacistLicenseNo: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPharmacyPolicyReadiness = {
  __typename?: 'BmsPharmacyPolicyReadiness';
  approved: Scalars['Int']['output'];
  /** 9.29 — TRUE = เปิดกะไม่ได้ถ้ารีวิว policy ยังไม่ครบ */
  blockShiftOnUnreviewed: Scalars['Boolean']['output'];
  /** 9.29 — เภสัชกรกด PIN อนุมัติจ่ายยาที่เครื่องขายได้ */
  counterAuthorization: Scalars['Boolean']['output'];
  draft: Scalars['Int']['output'];
  missing: Scalars['Int']['output'];
  pendingReview: Scalars['Int']['output'];
  pharmacyArchetype: Scalars['Boolean']['output'];
  ready: Scalars['Boolean']['output'];
  totalProducts: Scalars['Int']['output'];
};

export type SchemaBmsPharmacyProductPolicy = {
  __typename?: 'BmsPharmacyProductPolicy';
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  maxQuantity: Maybe<Scalars['Int']['output']>;
  productName: Scalars['String']['output'];
  productSku: Scalars['String']['output'];
  productType: Scalars['String']['output'];
  registrationNo: Maybe<Scalars['String']['output']>;
  regulatoryClass: Scalars['String']['output'];
  regulatoryEvidenceRef: Maybe<Scalars['String']['output']>;
  regulatoryEvidenceSource: Scalars['String']['output'];
  regulatoryFramework: Scalars['String']['output'];
  reviewedAt: Maybe<Scalars['String']['output']>;
  reviewedBy: Maybe<Scalars['ID']['output']>;
  safetyRuleKey: Maybe<Scalars['String']['output']>;
  salePolicy: Scalars['String']['output'];
  status: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  updatedAt: Scalars['String']['output'];
};

export type SchemaBmsPharmacyProductPolicyInput = {
  maxQuantity: InputMaybe<Scalars['Int']['input']>;
  productSku: Scalars['String']['input'];
  productType: Scalars['String']['input'];
  registrationNo: InputMaybe<Scalars['String']['input']>;
  regulatoryClass: Scalars['String']['input'];
  regulatoryEvidenceRef: InputMaybe<Scalars['String']['input']>;
  regulatoryEvidenceSource: Scalars['String']['input'];
  regulatoryFramework: Scalars['String']['input'];
  safetyRuleKey: InputMaybe<Scalars['String']['input']>;
  salePolicy: Scalars['String']['input'];
};

export type SchemaBmsPharmacyProductPolicyPage = {
  __typename?: 'BmsPharmacyProductPolicyPage';
  items: Array<SchemaBmsPharmacyProductPolicy>;
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type SchemaBmsPharmacyProtocol = {
  __typename?: 'BmsPharmacyProtocol';
  clinicallyApproved: Scalars['Boolean']['output'];
  completionRules: Scalars['JSON']['output'];
  conditionalQuestions: Scalars['JSON']['output'];
  createdAt: Scalars['String']['output'];
  displayLabel: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  escalationRules: Scalars['JSON']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  platformAllowed: Scalars['Boolean']['output'];
  protocolKey: Scalars['String']['output'];
  redFlagRules: Scalars['JSON']['output'];
  requiredFields: Scalars['JSON']['output'];
  reviewedAt: Maybe<Scalars['String']['output']>;
  reviewedBy: Maybe<Scalars['ID']['output']>;
  status: Scalars['String']['output'];
  supportedSymptomGroup: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
  triggerTerms: Array<Scalars['String']['output']>;
  updatedAt: Scalars['String']['output'];
  version: Scalars['Int']['output'];
};

export type SchemaBmsPharmacyProtocolInput = {
  completionRules: Scalars['JSON']['input'];
  conditionalQuestions: Scalars['JSON']['input'];
  displayLabel: Scalars['String']['input'];
  escalationRules: Scalars['JSON']['input'];
  id: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  protocolKey: Scalars['String']['input'];
  redFlagRules: Scalars['JSON']['input'];
  requiredFields: Scalars['JSON']['input'];
  supportedSymptomGroup: Scalars['String']['input'];
  triggerTerms: Array<Scalars['String']['input']>;
  version: InputMaybe<Scalars['Int']['input']>;
};

export type SchemaBmsPlan = {
  __typename?: 'BmsPlan';
  ai_credits_monthly: Scalars['Int']['output'];
  code: Scalars['String']['output'];
  max_ai_messages_month: Scalars['Int']['output'];
  max_channels: Scalars['Int']['output'];
  max_orders_month: Scalars['Int']['output'];
  max_products: Scalars['Int']['output'];
  max_users: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  price_monthly: Scalars['Float']['output'];
};

export type SchemaBmsPosApprover = {
  __typename?: 'BmsPosApprover';
  approvals: Array<Scalars['String']['output']>;
  email: Maybe<Scalars['String']['output']>;
  hasPin: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isPharmacist: Scalars['Boolean']['output'];
  name: Maybe<Scalars['String']['output']>;
  posOnly: Scalars['Boolean']['output'];
  role: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosArAccountResult = {
  __typename?: 'BmsPosArAccountResult';
  account: Maybe<SchemaBmsArAccount>;
  invoices: Array<SchemaBmsArInvoice>;
};

export type SchemaBmsPosArReceiptAllocation = {
  __typename?: 'BmsPosArReceiptAllocation';
  amount: Scalars['Float']['output'];
  invoiceId: Scalars['ID']['output'];
  orderId: Scalars['ID']['output'];
};

export type SchemaBmsPosArReceiptResult = {
  __typename?: 'BmsPosArReceiptResult';
  allocations: Maybe<Array<SchemaBmsPosArReceiptAllocation>>;
  balanceAfter: Maybe<Scalars['Float']['output']>;
  outstanding: Maybe<Scalars['Float']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  receiptId: Maybe<Scalars['ID']['output']>;
  replayed: Maybe<Scalars['Boolean']['output']>;
  requested: Maybe<Scalars['Float']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosArShiftSummary = {
  __typename?: 'BmsPosArShiftSummary';
  collectedAmount: Scalars['Float']['output'];
  collectedCashAmount: Scalars['Float']['output'];
  collectedCount: Scalars['Int']['output'];
  creditSalesAmount: Scalars['Float']['output'];
  creditSalesCount: Scalars['Int']['output'];
};

export type SchemaBmsPosAvailableLocation = {
  __typename?: 'BmsPosAvailableLocation';
  branchCode: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type SchemaBmsPosAvailableSize = {
  __typename?: 'BmsPosAvailableSize';
  available: Scalars['Float']['output'];
  price: Maybe<Scalars['Float']['output']>;
  size: Scalars['String']['output'];
};

export type SchemaBmsPosBlindReturnInput = {
  approverPin: Scalars['String']['input'];
  approverUserId: Scalars['ID']['input'];
  cashierUserId: Scalars['ID']['input'];
  customerId: InputMaybe<Scalars['ID']['input']>;
  customerNote: InputMaybe<Scalars['String']['input']>;
  idempotencyKey: Scalars['String']['input'];
  lines: Array<SchemaBmsPosBlindReturnLineInput>;
  pin: Scalars['String']['input'];
  reason: Scalars['String']['input'];
};

export type SchemaBmsPosBlindReturnLineInput = {
  qty: Scalars['Int']['input'];
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
  unitRefund: Scalars['Float']['input'];
};

export type SchemaBmsPosCashMovement = {
  __typename?: 'BmsPosCashMovement';
  actorName: Maybe<Scalars['String']['output']>;
  amount: Scalars['Float']['output'];
  approvedByName: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  direction: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  reason: Scalars['String']['output'];
};

export type SchemaBmsPosCashMovementActionResult = {
  __typename?: 'BmsPosCashMovementActionResult';
  available: Maybe<Scalars['Float']['output']>;
  drawerAfter: Maybe<Scalars['Float']['output']>;
  movement: Maybe<SchemaBmsPosCashMovement>;
  reason: Maybe<Scalars['String']['output']>;
  replayed: Maybe<Scalars['Boolean']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosCashMovementInput = {
  amount: Scalars['Float']['input'];
  approverPin: InputMaybe<Scalars['String']['input']>;
  approverUserId: InputMaybe<Scalars['ID']['input']>;
  cashierUserId: Scalars['ID']['input'];
  direction: Scalars['String']['input'];
  idempotencyKey: Scalars['String']['input'];
  pin: Scalars['String']['input'];
  reason: Scalars['String']['input'];
};

export type SchemaBmsPosCashMovementsResult = {
  __typename?: 'BmsPosCashMovementsResult';
  movements: Array<SchemaBmsPosCashMovement>;
};

export type SchemaBmsPosCashier = {
  __typename?: 'BmsPosCashier';
  email: Maybe<Scalars['String']['output']>;
  hasPin: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isPharmacist: Scalars['Boolean']['output'];
  name: Maybe<Scalars['String']['output']>;
  posOnly: Scalars['Boolean']['output'];
  role: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosCatalogItem = {
  __typename?: 'BmsPosCatalogItem';
  availability: Scalars['String']['output'];
  availableSizes: Array<SchemaBmsPosAvailableSize>;
  availableTotal: Scalars['Float']['output'];
  imageUrl: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  price: Scalars['Float']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsPosCatalogSearchResult = {
  __typename?: 'BmsPosCatalogSearchResult';
  items: Array<SchemaBmsPosCatalogItem>;
};

export type SchemaBmsPosCollectArInput = {
  accountId: Scalars['ID']['input'];
  amount: Scalars['Float']['input'];
  cashierUserId: Scalars['ID']['input'];
  idempotencyKey: Scalars['String']['input'];
  method: Scalars['String']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  pin: Scalars['String']['input'];
  reference: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPosCompleteRefundInput = {
  allocationId: Scalars['ID']['input'];
  cashierUserId: Scalars['ID']['input'];
  externalRef: InputMaybe<Scalars['String']['input']>;
  pin: Scalars['String']['input'];
  userId: InputMaybe<Scalars['ID']['input']>;
};

export type SchemaBmsPosCompleteRefundResult = {
  __typename?: 'BmsPosCompleteRefundResult';
  allocation: Maybe<SchemaBmsPosRefundAllocation>;
  reason: Maybe<Scalars['String']['output']>;
  replayed: Maybe<Scalars['Boolean']['output']>;
  returnSettlementStatus: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosCreatedLine = {
  __typename?: 'BmsPosCreatedLine';
  availableAfter: Maybe<Scalars['Float']['output']>;
  modifierCodes: Maybe<Array<Scalars['String']['output']>>;
  name: Scalars['String']['output'];
  packCode: Maybe<Scalars['String']['output']>;
  packQty: Maybe<Scalars['Float']['output']>;
  packUnitName: Maybe<Scalars['String']['output']>;
  packUnitPrice: Maybe<Scalars['Float']['output']>;
  pricingSnapshot: SchemaBmsPosCreatedLinePricing;
  qty: Scalars['Float']['output'];
  receiptUnitPrice: Scalars['Float']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  unitPrice: Scalars['Float']['output'];
  vatCategory: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosCreatedLinePricing = {
  __typename?: 'BmsPosCreatedLinePricing';
  modifierUnitPrice: Scalars['Float']['output'];
  priceTiers: Array<SchemaBmsPosPriceTier>;
  promotion: Maybe<SchemaBmsPosPromotion>;
  source: Scalars['String']['output'];
};

export type SchemaBmsPosCredentialsInput = {
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosDeposit = {
  __typename?: 'BmsPosDeposit';
  balanceDue: Scalars['Float']['output'];
  createdAt: Scalars['String']['output'];
  customerId: Maybe<Scalars['ID']['output']>;
  customerName: Maybe<Scalars['String']['output']>;
  customerNote: Maybe<Scalars['String']['output']>;
  customerPhone: Maybe<Scalars['String']['output']>;
  depositPaid: Scalars['Float']['output'];
  dueAt: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isOtherLocation: Scalars['Boolean']['output'];
  itemQty: Scalars['Float']['output'];
  items: Array<SchemaBmsPosDepositItem>;
  locationId: Scalars['ID']['output'];
  locationName: Maybe<Scalars['String']['output']>;
  memberNo: Maybe<Scalars['String']['output']>;
  orderId: Scalars['ID']['output'];
  overdue: Scalars['Boolean']['output'];
  status: Scalars['String']['output'];
  totalAmount: Scalars['Float']['output'];
};

export type SchemaBmsPosDepositActionResult = {
  __typename?: 'BmsPosDepositActionResult';
  deposit: Maybe<SchemaBmsPosDeposit>;
  docNo: Maybe<Scalars['String']['output']>;
  expected: Maybe<Scalars['Float']['output']>;
  forfeited: Maybe<Scalars['Float']['output']>;
  orderId: Maybe<Scalars['ID']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  received: Maybe<Scalars['Float']['output']>;
  refundable: Maybe<Scalars['Float']['output']>;
  replayed: Maybe<Scalars['Boolean']['output']>;
  saleLocationId: Maybe<Scalars['ID']['output']>;
  status: Scalars['String']['output'];
  total: Maybe<Scalars['Float']['output']>;
};

export type SchemaBmsPosDepositCandidateOrder = {
  __typename?: 'BmsPosDepositCandidateOrder';
  channel: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  itemCount: Scalars['Int']['output'];
  orderId: Scalars['ID']['output'];
  totalAmount: Scalars['Float']['output'];
};

export type SchemaBmsPosDepositInput = {
  action: Scalars['String']['input'];
  amount: InputMaybe<Scalars['Float']['input']>;
  cashierUserId: Scalars['ID']['input'];
  customerNote: InputMaybe<Scalars['String']['input']>;
  dueAt: InputMaybe<Scalars['String']['input']>;
  idempotencyKey: InputMaybe<Scalars['String']['input']>;
  lines: InputMaybe<Array<SchemaBmsPosDepositSerialLineInput>>;
  method: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['ID']['input'];
  outcome: InputMaybe<Scalars['String']['input']>;
  payments: InputMaybe<Array<SchemaBmsPosPaymentInput>>;
  pin: Scalars['String']['input'];
  reason: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPosDepositItem = {
  __typename?: 'BmsPosDepositItem';
  name: Scalars['String']['output'];
  qty: Scalars['Float']['output'];
  size: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosDepositSerialLineInput = {
  serials: Array<Scalars['String']['input']>;
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};

export type SchemaBmsPosDepositsResult = {
  __typename?: 'BmsPosDepositsResult';
  candidateOrders: Array<SchemaBmsPosDepositCandidateOrder>;
  deposits: Array<SchemaBmsPosDeposit>;
  searchQuery: Maybe<Scalars['String']['output']>;
  searchResults: Array<SchemaBmsPosDeposit>;
};

export type SchemaBmsPosDevice = {
  __typename?: 'BmsPosDevice';
  active: Scalars['Boolean']['output'];
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  locationId: Scalars['ID']['output'];
  name: Maybe<Scalars['String']['output']>;
  receiptPrefix: Maybe<Scalars['String']['output']>;
  registeredPosNo: Maybe<Scalars['String']['output']>;
  scannerMaxGapMs: Scalars['Int']['output'];
  scannerMode: Scalars['String']['output'];
  scannerPrefixKey: Scalars['String']['output'];
  scannerSuffixKey: Scalars['String']['output'];
  tenantId: Scalars['ID']['output'];
};

export type SchemaBmsPosDeviceInput = {
  active: InputMaybe<Scalars['Boolean']['input']>;
  code: Scalars['String']['input'];
  id: InputMaybe<Scalars['ID']['input']>;
  locationId: Scalars['ID']['input'];
  name: InputMaybe<Scalars['String']['input']>;
  receiptPrefix: InputMaybe<Scalars['String']['input']>;
  registeredPosNo: InputMaybe<Scalars['String']['input']>;
  scannerMaxGapMs: InputMaybe<Scalars['Int']['input']>;
  scannerMode: InputMaybe<Scalars['String']['input']>;
  scannerPrefixKey: InputMaybe<Scalars['String']['input']>;
  scannerSuffixKey: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPosDeviceScanner = {
  __typename?: 'BmsPosDeviceScanner';
  maxGapMs: Scalars['Int']['output'];
  mode: Scalars['String']['output'];
  prefixKey: Scalars['String']['output'];
  suffixKey: Scalars['String']['output'];
};

export type SchemaBmsPosDeviceSummary = {
  __typename?: 'BmsPosDeviceSummary';
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Maybe<Scalars['String']['output']>;
  registeredPosNo: Maybe<Scalars['String']['output']>;
  scanner: SchemaBmsPosDeviceScanner;
};

/**  token ค่าจริงคืนครั้งเดียวตอนออกเท่านั้น ฐานข้อมูลเก็บแต่ hash  */
export type SchemaBmsPosDeviceToken = {
  __typename?: 'BmsPosDeviceToken';
  token: Scalars['String']['output'];
};

export type SchemaBmsPosDiscountLine = {
  __typename?: 'BmsPosDiscountLine';
  amount: Scalars['Float']['output'];
  label: Scalars['String']['output'];
  pointsUsed: Scalars['Float']['output'];
  source: Scalars['String']['output'];
};

export type SchemaBmsPosEnrollMemberInput = {
  cashierUserId: Scalars['ID']['input'];
  name: InputMaybe<Scalars['String']['input']>;
  phone: Scalars['String']['input'];
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosEnrollMemberResult = {
  __typename?: 'BmsPosEnrollMemberResult';
  error: Maybe<Scalars['String']['output']>;
  member: Maybe<SchemaBmsPosMember>;
  reason: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosExpense = {
  __typename?: 'BmsPosExpense';
  actorName: Maybe<Scalars['String']['output']>;
  actualAmount: Maybe<Scalars['Float']['output']>;
  advancedAmount: Scalars['Float']['output'];
  approvedByName: Maybe<Scalars['String']['output']>;
  category: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  description: Scalars['String']['output'];
  extraCashOut: Scalars['Float']['output'];
  fundingSource: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  kind: Scalars['String']['output'];
  payee: Maybe<Scalars['String']['output']>;
  pettyCashBalanceAfter: Maybe<Scalars['Float']['output']>;
  receiptRef: Maybe<Scalars['String']['output']>;
  returnedAmount: Scalars['Float']['output'];
  settledAt: Maybe<Scalars['String']['output']>;
  settledByName: Maybe<Scalars['String']['output']>;
  settlementApprovedByName: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosExpenseActionResult = {
  __typename?: 'BmsPosExpenseActionResult';
  available: Maybe<Scalars['Float']['output']>;
  balanceAfter: Maybe<Scalars['Float']['output']>;
  drawerAfter: Maybe<Scalars['Float']['output']>;
  entry: Maybe<SchemaBmsPosPettyCashLedgerEntry>;
  expense: Maybe<SchemaBmsPosExpense>;
  pettyCashAfter: Maybe<Scalars['Float']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  replayed: Maybe<Scalars['Boolean']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosExpenseInput = {
  action: Scalars['String']['input'];
  actualAmount: InputMaybe<Scalars['Float']['input']>;
  amount: InputMaybe<Scalars['Float']['input']>;
  approverPin: InputMaybe<Scalars['String']['input']>;
  approverUserId: InputMaybe<Scalars['ID']['input']>;
  cashierUserId: Scalars['ID']['input'];
  category: InputMaybe<Scalars['String']['input']>;
  description: InputMaybe<Scalars['String']['input']>;
  evidenceRef: InputMaybe<Scalars['String']['input']>;
  expenseId: InputMaybe<Scalars['ID']['input']>;
  fundingSource: InputMaybe<Scalars['String']['input']>;
  idempotencyKey: Scalars['String']['input'];
  kind: InputMaybe<Scalars['String']['input']>;
  payee: InputMaybe<Scalars['String']['input']>;
  pin: Scalars['String']['input'];
  reason: InputMaybe<Scalars['String']['input']>;
  receiptRef: InputMaybe<Scalars['String']['input']>;
  source: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPosExpensesResult = {
  __typename?: 'BmsPosExpensesResult';
  canManagePettyCash: Scalars['Boolean']['output'];
  canUsePersonalFunds: Scalars['Boolean']['output'];
  categories: Array<Scalars['String']['output']>;
  expenses: Array<SchemaBmsPosExpense>;
  pettyCashWallet: SchemaBmsPosPettyCashWallet;
};

export type SchemaBmsPosExtraLineInput = {
  label: Scalars['String']['input'];
  qty: InputMaybe<Scalars['Float']['input']>;
  unitAmount: Scalars['Float']['input'];
};

export type SchemaBmsPosIncomingOrder = {
  __typename?: 'BmsPosIncomingOrder';
  amountDue: Scalars['Float']['output'];
  channel: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  customerRef: Maybe<Scalars['String']['output']>;
  fulfillmentType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsPosIncomingOrderItem>;
  promisedAt: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosIncomingOrderItem = {
  __typename?: 'BmsPosIncomingOrderItem';
  modifierCodes: Maybe<Array<Scalars['String']['output']>>;
  name: Maybe<Scalars['String']['output']>;
  orderItemId: Scalars['Int']['output'];
  qty: Scalars['Float']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  unitName: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosKitchenSlaEntry = {
  __typename?: 'BmsPosKitchenSlaEntry';
  lateMinutes: Scalars['Int']['output'];
  stationRef: Scalars['String']['output'];
  warnMinutes: Scalars['Int']['output'];
};

export type SchemaBmsPosKitchenStationSummary = {
  __typename?: 'BmsPosKitchenStationSummary';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  sortOrder: Scalars['Int']['output'];
};

export type SchemaBmsPosKitchenTicketActionResult = {
  __typename?: 'BmsPosKitchenTicketActionResult';
  reason: Maybe<Scalars['String']['output']>;
  status: Maybe<Scalars['String']['output']>;
  ticket: Maybe<SchemaBmsKitchenTicket>;
};

export type SchemaBmsPosKitchenTicketStatusInput = {
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  status: Scalars['String']['input'];
  ticketId: Scalars['ID']['input'];
  userId: InputMaybe<Scalars['ID']['input']>;
};

export type SchemaBmsPosKitchenTicketsActionResult = {
  __typename?: 'BmsPosKitchenTicketsActionResult';
  reason: Maybe<Scalars['String']['output']>;
  status: Maybe<Scalars['String']['output']>;
  tickets: Maybe<Array<SchemaBmsKitchenTicket>>;
};

export type SchemaBmsPosKitchenTicketsResult = {
  __typename?: 'BmsPosKitchenTicketsResult';
  generatedAt: Scalars['String']['output'];
  stationSlas: Array<SchemaBmsPosKitchenSlaEntry>;
  stations: Array<SchemaBmsPosKitchenStationSummary>;
  tickets: Array<SchemaBmsKitchenTicket>;
};

export type SchemaBmsPosKitchenTicketsStatusInput = {
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  status: Scalars['String']['input'];
  ticketIds: Array<Scalars['ID']['input']>;
  userId: InputMaybe<Scalars['ID']['input']>;
};

export type SchemaBmsPosLocationSummary = {
  __typename?: 'BmsPosLocationSummary';
  branchCode: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  pharmacistName: Maybe<Scalars['String']['output']>;
  vatCode: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosMember = {
  __typename?: 'BmsPosMember';
  customerId: Scalars['ID']['output'];
  memberNo: Maybe<Scalars['String']['output']>;
  memberSince: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  phone: Maybe<Scalars['String']['output']>;
  pointsBalance: Scalars['Float']['output'];
  pointsUsable: Scalars['Float']['output'];
  tier: Maybe<SchemaBmsPosMemberTier>;
};

export type SchemaBmsPosMemberLoyaltyPreview = {
  __typename?: 'BmsPosMemberLoyaltyPreview';
  block: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  pointsForAmount: Maybe<Scalars['Float']['output']>;
};

export type SchemaBmsPosMemberPreviewInput = {
  couponCode: InputMaybe<Scalars['String']['input']>;
  customerId: InputMaybe<Scalars['ID']['input']>;
  manualDiscount: InputMaybe<Scalars['Float']['input']>;
  pointsToRedeem: InputMaybe<Scalars['Float']['input']>;
  subtotal: Scalars['Float']['input'];
};

export type SchemaBmsPosMemberPreviewResult = {
  __typename?: 'BmsPosMemberPreviewResult';
  capped: Maybe<Scalars['Boolean']['output']>;
  cappedAt: Maybe<Scalars['Float']['output']>;
  couponDiscount: Maybe<Scalars['Float']['output']>;
  couponError: Maybe<Scalars['String']['output']>;
  loyaltyEnabled: Maybe<Scalars['Boolean']['output']>;
  manualDiscount: Maybe<Scalars['Float']['output']>;
  member: Maybe<SchemaBmsPosMember>;
  netTotal: Maybe<Scalars['Float']['output']>;
  pointsDiscount: Maybe<Scalars['Float']['output']>;
  pointsEarnBlock: Maybe<Scalars['String']['output']>;
  pointsUsed: Maybe<Scalars['Float']['output']>;
  pointsWillEarn: Maybe<Scalars['Float']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  redeemBahtPerUnit: Maybe<Scalars['Float']['output']>;
  redeemMinPoints: Maybe<Scalars['Float']['output']>;
  redeemPointsPerUnit: Maybe<Scalars['Float']['output']>;
  status: Maybe<Scalars['String']['output']>;
  subtotal: Maybe<Scalars['Float']['output']>;
  tierDiscount: Maybe<Scalars['Float']['output']>;
  tierLabel: Maybe<Scalars['String']['output']>;
  totalDiscount: Maybe<Scalars['Float']['output']>;
};

export type SchemaBmsPosMemberSearchResult = {
  __typename?: 'BmsPosMemberSearchResult';
  loyalty: SchemaBmsPosMemberLoyaltyPreview;
  members: Array<SchemaBmsPosMember>;
};

export type SchemaBmsPosMemberTier = {
  __typename?: 'BmsPosMemberTier';
  code: Scalars['String']['output'];
  discountType: Scalars['String']['output'];
  discountValue: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type SchemaBmsPosMenuAvailabilityResult = {
  __typename?: 'BmsPosMenuAvailabilityResult';
  availability: Maybe<Scalars['String']['output']>;
  productSku: Maybe<Scalars['String']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  resetsAt: Maybe<Scalars['String']['output']>;
  status: Maybe<Scalars['String']['output']>;
  unavailable: Maybe<Scalars['Boolean']['output']>;
};

export type SchemaBmsPosModifier = {
  __typename?: 'BmsPosModifier';
  code: Scalars['String']['output'];
  defaultSelected: Scalars['Boolean']['output'];
  groupCode: Scalars['String']['output'];
  groupName: Scalars['String']['output'];
  maxSelect: Maybe<Scalars['Int']['output']>;
  minSelect: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  priceDelta: Scalars['Float']['output'];
  selectionType: Scalars['String']['output'];
};

export type SchemaBmsPosNoSale = {
  __typename?: 'BmsPosNoSale';
  actorName: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  reason: Scalars['String']['output'];
};

export type SchemaBmsPosNoSaleInput = {
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  reason: Scalars['String']['input'];
};

export type SchemaBmsPosNoSalesResult = {
  __typename?: 'BmsPosNoSalesResult';
  noSales: Array<SchemaBmsPosNoSale>;
};

export type SchemaBmsPosOperationalReadiness = {
  __typename?: 'BmsPosOperationalReadiness';
  activeDevices: Scalars['Int']['output'];
  activeLocations: Scalars['Int']['output'];
  blockers: Array<Scalars['String']['output']>;
  cashiersReady: Scalars['Int']['output'];
  cashiersWithPin: Scalars['Int']['output'];
  openShifts: Scalars['Int']['output'];
  pairedDevices: Scalars['Int']['output'];
  pendingRefundAmount: Scalars['Float']['output'];
  pendingRefundCount: Scalars['Int']['output'];
  ready: Scalars['Boolean']['output'];
  sellableProducts: Scalars['Int']['output'];
  stockedVariants: Scalars['Int']['output'];
  unknownVatProducts: Scalars['Int']['output'];
  warnings: Array<Scalars['String']['output']>;
};

export type SchemaBmsPosParkActionResult = {
  __typename?: 'BmsPosParkActionResult';
  cart: Maybe<SchemaBmsPosParkedCart>;
  caseCode: Maybe<Scalars['String']['output']>;
  label: Maybe<Scalars['String']['output']>;
  limit: Maybe<Scalars['Int']['output']>;
  parked: Maybe<SchemaBmsPosParkedSale>;
  reason: Maybe<Scalars['String']['output']>;
  reviewStatus: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosParkInput = {
  action: InputMaybe<Scalars['String']['input']>;
  cart: InputMaybe<Scalars['JSON']['input']>;
  cashierUserId: Scalars['ID']['input'];
  itemCount: InputMaybe<Scalars['Int']['input']>;
  label: InputMaybe<Scalars['String']['input']>;
  parkedId: InputMaybe<Scalars['ID']['input']>;
  subtotalHint: InputMaybe<Scalars['Float']['input']>;
};

export type SchemaBmsPosParkedCart = {
  __typename?: 'BmsPosParkedCart';
  couponCode: Maybe<Scalars['String']['output']>;
  extraLines: Maybe<Array<SchemaBmsPosParkedExtraLine>>;
  lines: Array<SchemaBmsPosParkedCartLine>;
  member: Maybe<SchemaBmsPosParkedCartMember>;
  pharmacyReview: Maybe<SchemaBmsPosParkedCartPharmacyReview>;
  pointsToRedeem: Maybe<Scalars['String']['output']>;
  version: Scalars['Int']['output'];
};

export type SchemaBmsPosParkedCartLine = {
  __typename?: 'BmsPosParkedCartLine';
  available: Maybe<Scalars['Float']['output']>;
  basePrice: Maybe<Scalars['Float']['output']>;
  baseQty: Maybe<Scalars['Float']['output']>;
  imageUrl: Maybe<Scalars['String']['output']>;
  key: Maybe<Scalars['String']['output']>;
  modifierCodes: Maybe<Array<Scalars['String']['output']>>;
  orderItemId: Maybe<Scalars['Int']['output']>;
  packCode: Maybe<Scalars['String']['output']>;
  packPrice: Maybe<Scalars['Float']['output']>;
  packQty: Maybe<Scalars['Int']['output']>;
  priceTiers: Maybe<Array<SchemaBmsPosPriceTier>>;
  productName: Maybe<Scalars['String']['output']>;
  promotion: Maybe<SchemaBmsPosPromotion>;
  receiptName: Maybe<Scalars['String']['output']>;
  refundablePackQty: Maybe<Scalars['Float']['output']>;
  returnedPackQty: Maybe<Scalars['Float']['output']>;
  scaleBarcode: Maybe<Scalars['String']['output']>;
  serialTracked: Maybe<Scalars['Boolean']['output']>;
  serials: Maybe<Array<Scalars['String']['output']>>;
  size: Maybe<Scalars['String']['output']>;
  sku: Maybe<Scalars['String']['output']>;
  unitName: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosParkedCartMember = {
  __typename?: 'BmsPosParkedCartMember';
  customerId: Maybe<Scalars['ID']['output']>;
  memberNo: Maybe<Scalars['String']['output']>;
  name: Maybe<Scalars['String']['output']>;
  phone: Maybe<Scalars['String']['output']>;
  pointsBalance: Maybe<Scalars['Float']['output']>;
  pointsUsable: Maybe<Scalars['Float']['output']>;
};

export type SchemaBmsPosParkedCartPharmacyReview = {
  __typename?: 'BmsPosParkedCartPharmacyReview';
  assessmentId: Scalars['ID']['output'];
  caseCode: Scalars['String']['output'];
  requiresSafetyCheck: Scalars['Boolean']['output'];
};

export type SchemaBmsPosParkedExtraLine = {
  __typename?: 'BmsPosParkedExtraLine';
  label: Scalars['String']['output'];
  unitAmount: Scalars['String']['output'];
};

export type SchemaBmsPosParkedPharmacyReview = {
  __typename?: 'BmsPosParkedPharmacyReview';
  assessmentId: Scalars['ID']['output'];
  canResume: Scalars['Boolean']['output'];
  caseCode: Scalars['String']['output'];
  requiresSafetyCheck: Scalars['Boolean']['output'];
  status: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosParkedSale = {
  __typename?: 'BmsPosParkedSale';
  cart: Maybe<SchemaBmsPosParkedCart>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  itemCount: Scalars['Int']['output'];
  label: Scalars['String']['output'];
  parkedByName: Maybe<Scalars['String']['output']>;
  pharmacyReview: Maybe<SchemaBmsPosParkedPharmacyReview>;
  subtotalHint: Scalars['Float']['output'];
};

export type SchemaBmsPosParkedSalesResult = {
  __typename?: 'BmsPosParkedSalesResult';
  parked: Array<SchemaBmsPosParkedSale>;
};

export type SchemaBmsPosPaymentInput = {
  amount: Scalars['Float']['input'];
  cashTendered: InputMaybe<Scalars['Float']['input']>;
  method: Scalars['String']['input'];
  ref: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPosPendingRestaurantRefund = {
  __typename?: 'BmsPosPendingRestaurantRefund';
  amount: Scalars['Float']['output'];
  cancelledBy: Maybe<Scalars['String']['output']>;
  channel: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  customerRef: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  method: Scalars['String']['output'];
  orderId: Scalars['ID']['output'];
};

export type SchemaBmsPosPettyCashLedgerEntry = {
  __typename?: 'BmsPosPettyCashLedgerEntry';
  actorName: Maybe<Scalars['String']['output']>;
  amount: Scalars['Float']['output'];
  balanceAfter: Scalars['Float']['output'];
  createdAt: Scalars['String']['output'];
  direction: Scalars['String']['output'];
  evidenceRef: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  reason: Scalars['String']['output'];
  source: Scalars['String']['output'];
};

export type SchemaBmsPosPettyCashWallet = {
  __typename?: 'BmsPosPettyCashWallet';
  balance: Scalars['Float']['output'];
  entries: Array<SchemaBmsPosPettyCashLedgerEntry>;
};

export type SchemaBmsPosPharmacyBlocker = {
  __typename?: 'BmsPosPharmacyBlocker';
  maxQuantity: Maybe<Scalars['Int']['output']>;
  requested: Maybe<Scalars['Int']['output']>;
  salePolicy: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsPosPharmacyReviewResult = {
  __typename?: 'BmsPosPharmacyReviewResult';
  assessmentId: Maybe<Scalars['ID']['output']>;
  caseCode: Maybe<Scalars['String']['output']>;
  parked: Maybe<SchemaBmsPosParkedSale>;
  reason: Maybe<Scalars['String']['output']>;
  requiresSafetyCheck: Maybe<Scalars['Boolean']['output']>;
  reviewStatus: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosPriceTier = {
  __typename?: 'BmsPosPriceTier';
  discountPct: Maybe<Scalars['Float']['output']>;
  minQty: Scalars['Int']['output'];
  scope: Maybe<Scalars['String']['output']>;
  size: Maybe<Scalars['String']['output']>;
  unitPrice: Maybe<Scalars['Float']['output']>;
};

export type SchemaBmsPosPromotion = {
  __typename?: 'BmsPosPromotion';
  bundlePrice: Maybe<Scalars['Float']['output']>;
  buyQty: Scalars['Int']['output'];
  getQty: Maybe<Scalars['Int']['output']>;
  kind: Scalars['String']['output'];
};

export type SchemaBmsPosPurchaseOrdersResult = {
  __typename?: 'BmsPosPurchaseOrdersResult';
  orders: Array<SchemaBmsPurchaseOrder>;
};

export type SchemaBmsPosReceipt = {
  __typename?: 'BmsPosReceipt';
  billNo: Maybe<Scalars['String']['output']>;
  branchCode: Maybe<Scalars['String']['output']>;
  cashChange: Maybe<Scalars['Float']['output']>;
  cashTendered: Maybe<Scalars['Float']['output']>;
  cashierName: Maybe<Scalars['String']['output']>;
  discountLines: Array<SchemaBmsPosDiscountLine>;
  docNo: Maybe<Scalars['String']['output']>;
  lines: Array<SchemaBmsPosReceiptLine>;
  locationName: Maybe<Scalars['String']['output']>;
  memberName: Maybe<Scalars['String']['output']>;
  memberNo: Maybe<Scalars['String']['output']>;
  memberPhone: Maybe<Scalars['String']['output']>;
  orderId: Scalars['ID']['output'];
  orderStatus: Scalars['String']['output'];
  paymentMethod: Maybe<Scalars['String']['output']>;
  paymentRef: Maybe<Scalars['String']['output']>;
  payments: Array<SchemaBmsPosReceiptPayment>;
  posDeviceId: Maybe<Scalars['ID']['output']>;
  posLabel: Maybe<Scalars['String']['output']>;
  receiptNo: Maybe<Scalars['String']['output']>;
  refunds: Array<SchemaBmsPosRefundAllocation>;
  returnBlockedReason: Maybe<Scalars['String']['output']>;
  returnEligible: Scalars['Boolean']['output'];
  returnEvents: Array<SchemaBmsPosReceiptReturnEvent>;
  roundingAmount: Scalars['Float']['output'];
  saleLocationId: Scalars['ID']['output'];
  shiftId: Maybe<Scalars['ID']['output']>;
  soldAt: Scalars['String']['output'];
  sourceChannel: Scalars['String']['output'];
  total: Scalars['Float']['output'];
  vat: Maybe<SchemaBmsPosReceiptVat>;
  voidedAt: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosReceiptDeliveryResult = {
  __typename?: 'BmsPosReceiptDeliveryResult';
  channel: Maybe<Scalars['String']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  to: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosReceiptLine = {
  __typename?: 'BmsPosReceiptLine';
  basePrice: Scalars['Float']['output'];
  baseQty: Scalars['Float']['output'];
  lineTotal: Scalars['Float']['output'];
  orderItemId: Scalars['Int']['output'];
  packCode: Scalars['String']['output'];
  packPrice: Scalars['Float']['output'];
  packQty: Scalars['Float']['output'];
  receiptName: Scalars['String']['output'];
  refundablePackQty: Scalars['Float']['output'];
  returnedPackQty: Scalars['Float']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  unitName: Scalars['String']['output'];
};

export type SchemaBmsPosReceiptPayment = {
  __typename?: 'BmsPosReceiptPayment';
  amount: Scalars['Float']['output'];
  cashChange: Maybe<Scalars['Float']['output']>;
  cashTendered: Maybe<Scalars['Float']['output']>;
  id: Scalars['ID']['output'];
  method: Scalars['String']['output'];
  ref: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosReceiptReturnEvent = {
  __typename?: 'BmsPosReceiptReturnEvent';
  approvedByName: Maybe<Scalars['String']['output']>;
  creditNoteNo: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isVoid: Scalars['Boolean']['output'];
  items: Array<SchemaBmsPosReceiptReturnItem>;
  note: Maybe<Scalars['String']['output']>;
  pricingAdjustmentAmount: Scalars['Float']['output'];
  refundAmount: Scalars['Float']['output'];
  refunds: Array<SchemaBmsPosRefundAllocation>;
  remainingAmount: Maybe<Scalars['Float']['output']>;
  returnMode: Scalars['String']['output'];
  returnedAt: Scalars['String']['output'];
  returnedByName: Maybe<Scalars['String']['output']>;
  settlementStatus: Scalars['String']['output'];
};

export type SchemaBmsPosReceiptReturnItem = {
  __typename?: 'BmsPosReceiptReturnItem';
  orderItemId: Scalars['Int']['output'];
  packQty: Scalars['Float']['output'];
  receiptName: Scalars['String']['output'];
  refundAmount: Scalars['Float']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsPosReceiptVat = {
  __typename?: 'BmsPosReceiptVat';
  exemptAmount: Scalars['Float']['output'];
  netBeforeVat: Scalars['Float']['output'];
  rate: Scalars['Float']['output'];
  roundingAmount: Scalars['Float']['output'];
  taxableAmount: Scalars['Float']['output'];
  vatAmount: Scalars['Float']['output'];
};

export type SchemaBmsPosReceivePurchaseInput = {
  cashierUserId: Scalars['ID']['input'];
  idempotencyKey: Scalars['String']['input'];
  items: Array<SchemaBmsPosReceivePurchaseLineInput>;
  pin: Scalars['String']['input'];
  poId: Scalars['ID']['input'];
};

export type SchemaBmsPosReceivePurchaseLineInput = {
  expiryDate: InputMaybe<Scalars['String']['input']>;
  lotNo: InputMaybe<Scalars['String']['input']>;
  qty: Scalars['Int']['input'];
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};

export type SchemaBmsPosRecentReturnSummary = {
  __typename?: 'BmsPosRecentReturnSummary';
  createdAt: Scalars['String']['output'];
  crossBranch: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  note: Maybe<Scalars['String']['output']>;
  orderId: Scalars['ID']['output'];
  pendingAmount: Scalars['Float']['output'];
  reasonCode: Maybe<Scalars['String']['output']>;
  reasonText: Maybe<Scalars['String']['output']>;
  refundAmount: Scalars['Float']['output'];
  returnLocationName: Maybe<Scalars['String']['output']>;
  returnMode: Scalars['String']['output'];
  returnedBy: Maybe<Scalars['String']['output']>;
  saleLocationName: Maybe<Scalars['String']['output']>;
  settledAmount: Scalars['Float']['output'];
  settlementStatus: Scalars['String']['output'];
  sourceChannel: Scalars['String']['output'];
};

export type SchemaBmsPosRecentSalesResult = {
  __typename?: 'BmsPosRecentSalesResult';
  depositMatches: Array<SchemaBmsPosDeposit>;
  sales: Array<SchemaBmsPosReceipt>;
};

export type SchemaBmsPosRefundAllocation = {
  __typename?: 'BmsPosRefundAllocation';
  amount: Scalars['Float']['output'];
  completedAt: Maybe<Scalars['String']['output']>;
  completedByName: Maybe<Scalars['String']['output']>;
  externalRef: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  method: Scalars['String']['output'];
  paymentId: Scalars['ID']['output'];
  posReturnId: Maybe<Scalars['ID']['output']>;
  returnMode: Maybe<Scalars['String']['output']>;
  returnNote: Maybe<Scalars['String']['output']>;
  returnedAt: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosRequestPharmacyReviewInput = {
  cashierUserId: Scalars['ID']['input'];
  customerId: InputMaybe<Scalars['ID']['input']>;
  idempotencyKey: Scalars['String']['input'];
  itemCount: InputMaybe<Scalars['Int']['input']>;
  label: InputMaybe<Scalars['String']['input']>;
  lines: Array<SchemaBmsPosSaleLineInput>;
  parkedCart: InputMaybe<Scalars['JSON']['input']>;
  pin: Scalars['String']['input'];
  subtotalHint: InputMaybe<Scalars['Float']['input']>;
};

export type SchemaBmsPosRestaurantAcceptIncomingOrderInput = {
  cashierUserId: Scalars['ID']['input'];
  orderId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantAddCheckItemInput = {
  cashierUserId: Scalars['ID']['input'];
  kitchenNote: InputMaybe<Scalars['String']['input']>;
  modifierCodes: InputMaybe<Array<Scalars['String']['input']>>;
  packCode: InputMaybe<Scalars['String']['input']>;
  packQty: Scalars['Int']['input'];
  pin: Scalars['String']['input'];
  size: InputMaybe<Scalars['String']['input']>;
  sku: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantAddWaitlistInput = {
  cashierUserId: Scalars['ID']['input'];
  guestName: InputMaybe<Scalars['String']['input']>;
  guestPhone: InputMaybe<Scalars['String']['input']>;
  kind: Scalars['String']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  partySize: Scalars['Int']['input'];
  pin: Scalars['String']['input'];
  preferredTableId: InputMaybe<Scalars['ID']['input']>;
  reservedFor: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPosRestaurantCancelCheckInput = {
  approverPin: InputMaybe<Scalars['String']['input']>;
  approverUserId: InputMaybe<Scalars['ID']['input']>;
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  reason: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantCancelLineInput = {
  cause: Scalars['String']['input'];
  orderItemId: Scalars['Int']['input'];
  packQty: Scalars['Int']['input'];
};

export type SchemaBmsPosRestaurantCancelOrderLinesInput = {
  cashierUserId: Scalars['ID']['input'];
  idempotencyKey: Scalars['String']['input'];
  lines: Array<SchemaBmsPosRestaurantCancelLineInput>;
  managerPin: InputMaybe<Scalars['String']['input']>;
  managerUserId: InputMaybe<Scalars['ID']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantCheck = {
  __typename?: 'BmsPosRestaurantCheck';
  amountDue: Scalars['Float']['output'];
  areaName: Scalars['String']['output'];
  guestCount: Scalars['Int']['output'];
  hasCurrentOrder: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsPosRestaurantCheckItem>;
  mergedIntoCheckId: Maybe<Scalars['ID']['output']>;
  note: Maybe<Scalars['String']['output']>;
  openedAt: Maybe<Scalars['String']['output']>;
  reservationLost: Scalars['Boolean']['output'];
  reservationStatus: Maybe<Scalars['String']['output']>;
  reservedVersion: Maybe<Scalars['Int']['output']>;
  splitFromCheckId: Maybe<Scalars['ID']['output']>;
  splitGroupNo: Scalars['Int']['output'];
  status: Scalars['String']['output'];
  tableCode: Scalars['String']['output'];
  tableId: Scalars['ID']['output'];
  tableName: Scalars['String']['output'];
  version: Scalars['Int']['output'];
};

export type SchemaBmsPosRestaurantCheckActionInput = {
  action: Scalars['String']['input'];
  approverPin: InputMaybe<Scalars['String']['input']>;
  approverUserId: InputMaybe<Scalars['ID']['input']>;
  cashierUserId: Scalars['ID']['input'];
  customerId: InputMaybe<Scalars['ID']['input']>;
  guestCount: InputMaybe<Scalars['Int']['input']>;
  itemId: InputMaybe<Scalars['ID']['input']>;
  itemIds: InputMaybe<Array<Scalars['ID']['input']>>;
  kitchenNote: InputMaybe<Scalars['String']['input']>;
  modifierCodes: InputMaybe<Array<Scalars['String']['input']>>;
  packCode: InputMaybe<Scalars['String']['input']>;
  packQty: InputMaybe<Scalars['Int']['input']>;
  payments: InputMaybe<Array<SchemaBmsPosPaymentInput>>;
  pin: Scalars['String']['input'];
  reason: InputMaybe<Scalars['String']['input']>;
  size: InputMaybe<Scalars['String']['input']>;
  sku: InputMaybe<Scalars['String']['input']>;
  targetCheckId: InputMaybe<Scalars['ID']['input']>;
  targetTableId: InputMaybe<Scalars['ID']['input']>;
};

export type SchemaBmsPosRestaurantCheckActionResult = {
  __typename?: 'BmsPosRestaurantCheckActionResult';
  available: Maybe<Scalars['Float']['output']>;
  billNo: Maybe<Scalars['String']['output']>;
  cashChange: Maybe<Scalars['Float']['output']>;
  cashTendered: Maybe<Scalars['Float']['output']>;
  check: Maybe<SchemaBmsPosRestaurantCheck>;
  discountLines: Maybe<Array<SchemaBmsPosDiscountLine>>;
  docNo: Maybe<Scalars['String']['output']>;
  expected: Maybe<Scalars['Float']['output']>;
  kitchenTickets: Maybe<Scalars['Int']['output']>;
  movedItems: Maybe<Scalars['Int']['output']>;
  orderId: Maybe<Scalars['ID']['output']>;
  pointsBalance: Maybe<Scalars['Float']['output']>;
  pointsEarned: Maybe<Scalars['Float']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  receiptNo: Maybe<Scalars['String']['output']>;
  received: Maybe<Scalars['Float']['output']>;
  replayed: Maybe<Scalars['Boolean']['output']>;
  requested: Maybe<Scalars['Float']['output']>;
  roundingAmount: Maybe<Scalars['Float']['output']>;
  size: Maybe<Scalars['String']['output']>;
  sku: Maybe<Scalars['String']['output']>;
  source: Maybe<SchemaBmsPosRestaurantCheck>;
  status: Maybe<Scalars['String']['output']>;
  target: Maybe<SchemaBmsPosRestaurantCheck>;
  total: Maybe<Scalars['Float']['output']>;
  vat: Maybe<SchemaBmsPosReceiptVat>;
};

export type SchemaBmsPosRestaurantCheckCredentialsInput = {
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantCheckItem = {
  __typename?: 'BmsPosRestaurantCheckItem';
  baseQty: Maybe<Scalars['Float']['output']>;
  createdAt: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  kitchenNote: Maybe<Scalars['String']['output']>;
  kitchenStatus: Maybe<Scalars['String']['output']>;
  lineAmount: Maybe<Scalars['Float']['output']>;
  modifierCodes: Array<Scalars['String']['output']>;
  modifierNames: Array<Scalars['String']['output']>;
  packCode: Maybe<Scalars['String']['output']>;
  packPrice: Maybe<Scalars['Float']['output']>;
  packQty: Scalars['Int']['output'];
  productName: Scalars['String']['output'];
  roundNo: Maybe<Scalars['Int']['output']>;
  sentAt: Maybe<Scalars['String']['output']>;
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  status: Scalars['String']['output'];
  unitName: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosRestaurantCloseWaitlistInput = {
  cashierUserId: Scalars['ID']['input'];
  entryId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  reason: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPosRestaurantFloorCheck = {
  __typename?: 'BmsPosRestaurantFloorCheck';
  amountDue: Scalars['Float']['output'];
  guestCount: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  itemCount: Scalars['Int']['output'];
  openedAt: Maybe<Scalars['String']['output']>;
  reservedVersion: Maybe<Scalars['Int']['output']>;
  splitGroupNo: Scalars['Int']['output'];
  status: Scalars['String']['output'];
  unsentCount: Scalars['Int']['output'];
  version: Scalars['Int']['output'];
};

export type SchemaBmsPosRestaurantFloorResult = {
  __typename?: 'BmsPosRestaurantFloorResult';
  areas: Array<SchemaBmsRestaurantArea>;
  tables: Array<SchemaBmsPosRestaurantFloorTable>;
};

export type SchemaBmsPosRestaurantFloorSetupInput = {
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  tableCount: InputMaybe<Scalars['Int']['input']>;
};

export type SchemaBmsPosRestaurantFloorTable = {
  __typename?: 'BmsPosRestaurantFloorTable';
  active: Scalars['Boolean']['output'];
  areaId: Scalars['ID']['output'];
  blocked: Scalars['Boolean']['output'];
  check: Maybe<SchemaBmsPosRestaurantFloorCheck>;
  checks: Array<SchemaBmsPosRestaurantFloorCheck>;
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  positionX: Scalars['Int']['output'];
  positionY: Scalars['Int']['output'];
  seats: Scalars['Int']['output'];
  shape: Scalars['String']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsPosRestaurantIncomingActionInput = {
  action: Scalars['String']['input'];
  cashierUserId: Scalars['ID']['input'];
  idempotencyKey: InputMaybe<Scalars['String']['input']>;
  lines: InputMaybe<Array<SchemaBmsPosRestaurantCancelLineInput>>;
  managerPin: InputMaybe<Scalars['String']['input']>;
  managerUserId: InputMaybe<Scalars['ID']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  orderId: InputMaybe<Scalars['ID']['input']>;
  paused: InputMaybe<Scalars['Boolean']['input']>;
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantIncomingActionResult = {
  __typename?: 'BmsPosRestaurantIncomingActionResult';
  current: Maybe<Scalars['String']['output']>;
  paused: Maybe<Scalars['Boolean']['output']>;
  posReturnId: Maybe<Scalars['ID']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  refundAmount: Maybe<Scalars['Float']['output']>;
  replayed: Maybe<Scalars['Boolean']['output']>;
  settlementStatus: Maybe<Scalars['String']['output']>;
  status: Maybe<Scalars['String']['output']>;
  ticketsCreated: Maybe<Scalars['Int']['output']>;
};

export type SchemaBmsPosRestaurantIncomingResult = {
  __typename?: 'BmsPosRestaurantIncomingResult';
  config: SchemaBmsPosRestaurantOrderingConfig;
  orders: Array<SchemaBmsPosIncomingOrder>;
  refunds: Array<SchemaBmsPosPendingRestaurantRefund>;
};

export type SchemaBmsPosRestaurantMenuAvailabilityInput = {
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  productSku: Scalars['String']['input'];
  reason: InputMaybe<Scalars['String']['input']>;
  unavailable: Scalars['Boolean']['input'];
};

export type SchemaBmsPosRestaurantMenuItem = {
  __typename?: 'BmsPosRestaurantMenuItem';
  availability: Scalars['String']['output'];
  availableSizes: Array<SchemaBmsPosRestaurantMenuSize>;
  availableTotal: Scalars['Float']['output'];
  hasModifiers: Scalars['Boolean']['output'];
  imageUrl: Maybe<Scalars['String']['output']>;
  kitchenStation: Maybe<Scalars['String']['output']>;
  kitchenStationId: Maybe<Scalars['ID']['output']>;
  name: Scalars['String']['output'];
  price: Scalars['Float']['output'];
  sellable: Scalars['Boolean']['output'];
  sku: Scalars['String']['output'];
  unavailableReason: Maybe<Scalars['String']['output']>;
  unavailableResetsAt: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosRestaurantMenuResult = {
  __typename?: 'BmsPosRestaurantMenuResult';
  items: Array<SchemaBmsPosRestaurantMenuItem>;
};

export type SchemaBmsPosRestaurantMenuSize = {
  __typename?: 'BmsPosRestaurantMenuSize';
  available: Scalars['Float']['output'];
  size: Scalars['String']['output'];
};

export type SchemaBmsPosRestaurantMergeChecksInput = {
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  targetCheckId: Scalars['ID']['input'];
};

export type SchemaBmsPosRestaurantMoveCheckInput = {
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  targetTableId: Scalars['ID']['input'];
};

export type SchemaBmsPosRestaurantOpenCheckInput = {
  cashierUserId: Scalars['ID']['input'];
  guestCount: InputMaybe<Scalars['Int']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  pin: Scalars['String']['input'];
  tableId: Scalars['ID']['input'];
};

export type SchemaBmsPosRestaurantOpenCheckResult = {
  __typename?: 'BmsPosRestaurantOpenCheckResult';
  check: Maybe<SchemaBmsPosRestaurantCheck>;
};

export type SchemaBmsPosRestaurantOrderInterval = {
  __typename?: 'BmsPosRestaurantOrderInterval';
  close: Scalars['String']['output'];
  day: Scalars['Int']['output'];
  open: Scalars['String']['output'];
};

export type SchemaBmsPosRestaurantOrderingConfig = {
  __typename?: 'BmsPosRestaurantOrderingConfig';
  accepting: Scalars['Boolean']['output'];
  hours: Array<SchemaBmsPosRestaurantOrderInterval>;
  paused: Scalars['Boolean']['output'];
  reason: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosRestaurantQrActionResult = {
  __typename?: 'BmsPosRestaurantQrActionResult';
  check: Maybe<SchemaBmsPosRestaurantCheck>;
  id: Maybe<Scalars['ID']['output']>;
  kitchenTickets: Maybe<Scalars['Int']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  replayed: Maybe<Scalars['Boolean']['output']>;
  status: Scalars['String']['output'];
  submissionId: Maybe<Scalars['ID']['output']>;
};

export type SchemaBmsPosRestaurantQrOrderActionInput = {
  action: Scalars['String']['input'];
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  reason: InputMaybe<Scalars['String']['input']>;
  submissionId: Scalars['ID']['input'];
};

export type SchemaBmsPosRestaurantQrOrdersResult = {
  __typename?: 'BmsPosRestaurantQrOrdersResult';
  submissions: Array<SchemaBmsPosRestaurantQrSubmission>;
};

export type SchemaBmsPosRestaurantQrSubmission = {
  __typename?: 'BmsPosRestaurantQrSubmission';
  checkId: Scalars['ID']['output'];
  estimatedTotal: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsPosRestaurantQrSubmissionItem>;
  rejectionReason: Maybe<Scalars['String']['output']>;
  reviewedAt: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  submittedAt: Scalars['String']['output'];
  tableCode: Scalars['String']['output'];
  tableId: Scalars['ID']['output'];
  tableName: Scalars['String']['output'];
};

export type SchemaBmsPosRestaurantQrSubmissionInput = {
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  submissionId: Scalars['ID']['input'];
};

export type SchemaBmsPosRestaurantQrSubmissionItem = {
  __typename?: 'BmsPosRestaurantQrSubmissionItem';
  acceptedCheckItemId: Maybe<Scalars['ID']['output']>;
  estimatedUnitPrice: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  kitchenNote: Maybe<Scalars['String']['output']>;
  modifierCodes: Array<Scalars['String']['output']>;
  modifierNames: Array<Scalars['String']['output']>;
  packCode: Maybe<Scalars['String']['output']>;
  packQty: Scalars['Int']['output'];
  productName: Scalars['String']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsPosRestaurantRejectQrSubmissionInput = {
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  reason: InputMaybe<Scalars['String']['input']>;
  submissionId: Scalars['ID']['input'];
};

export type SchemaBmsPosRestaurantRequest = {
  __typename?: 'BmsPosRestaurantRequest';
  agreedItems: Maybe<Array<SchemaBmsPosRestaurantRequestItem>>;
  checkoutUrl: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  customerName: Maybe<Scalars['String']['output']>;
  fulfillmentType: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsPosRestaurantRequestItem>;
  locationId: Scalars['ID']['output'];
  locationName: Scalars['String']['output'];
  note: Maybe<Scalars['String']['output']>;
  orderId: Maybe<Scalars['ID']['output']>;
  phone: Maybe<Scalars['String']['output']>;
  requestedAt: Maybe<Scalars['String']['output']>;
  reviewNote: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  version: Scalars['Int']['output'];
};

export type SchemaBmsPosRestaurantRequestActionInput = {
  action: Scalars['String']['input'];
  cashierUserId: Scalars['ID']['input'];
  confirmed: InputMaybe<Scalars['Boolean']['input']>;
  id: InputMaybe<Scalars['ID']['input']>;
  kitchenNote: InputMaybe<Scalars['String']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  pin: Scalars['String']['input'];
  quantities: InputMaybe<Array<Scalars['Int']['input']>>;
  version: InputMaybe<Scalars['Int']['input']>;
};

export type SchemaBmsPosRestaurantRequestActionResult = {
  __typename?: 'BmsPosRestaurantRequestActionResult';
  checkoutUrl: Maybe<Scalars['String']['output']>;
  failure: Maybe<SchemaBmsPosSaleResult>;
  orderId: Maybe<Scalars['ID']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  requests: Maybe<Array<SchemaBmsPosRestaurantRequest>>;
  status: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosRestaurantRequestDecisionInput = {
  cashierUserId: Scalars['ID']['input'];
  confirmed: Scalars['Boolean']['input'];
  id: Scalars['ID']['input'];
  kitchenNote: InputMaybe<Scalars['String']['input']>;
  note: Scalars['String']['input'];
  pin: Scalars['String']['input'];
  quantities: InputMaybe<Array<Scalars['Int']['input']>>;
  version: Scalars['Int']['input'];
};

export type SchemaBmsPosRestaurantRequestItem = {
  __typename?: 'BmsPosRestaurantRequestItem';
  modifierCodes: Maybe<Array<Scalars['String']['output']>>;
  modifierNames: Maybe<Array<Scalars['String']['output']>>;
  name: Maybe<Scalars['String']['output']>;
  packCode: Maybe<Scalars['String']['output']>;
  qty: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  unitName: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosRestaurantRequestsResult = {
  __typename?: 'BmsPosRestaurantRequestsResult';
  requests: Array<SchemaBmsPosRestaurantRequest>;
};

export type SchemaBmsPosRestaurantSeatWaitlistInput = {
  cashierUserId: Scalars['ID']['input'];
  entryId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  tableId: Scalars['ID']['input'];
};

export type SchemaBmsPosRestaurantServiceCall = {
  __typename?: 'BmsPosRestaurantServiceCall';
  acknowledgedAt: Maybe<Scalars['String']['output']>;
  completedAt: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  requestCode: Scalars['String']['output'];
  requestNote: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  tableCode: Scalars['String']['output'];
  tableId: Scalars['ID']['output'];
  tableName: Scalars['String']['output'];
};

export type SchemaBmsPosRestaurantServiceCallActionInput = {
  action: Scalars['String']['input'];
  callId: Scalars['ID']['input'];
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantServiceCallActionResult = {
  __typename?: 'BmsPosRestaurantServiceCallActionResult';
  id: Maybe<Scalars['ID']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  status: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosRestaurantServiceCallInput = {
  callId: Scalars['ID']['input'];
  cashierUserId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantServiceCallsResult = {
  __typename?: 'BmsPosRestaurantServiceCallsResult';
  calls: Array<SchemaBmsPosRestaurantServiceCall>;
};

export type SchemaBmsPosRestaurantSetGuestCountInput = {
  cashierUserId: Scalars['ID']['input'];
  guestCount: Scalars['Int']['input'];
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantSetOrderingPausedInput = {
  cashierUserId: Scalars['ID']['input'];
  paused: Scalars['Boolean']['input'];
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantSettleCheckInput = {
  cashierUserId: Scalars['ID']['input'];
  customerId: InputMaybe<Scalars['ID']['input']>;
  payments: Array<SchemaBmsPosPaymentInput>;
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantSplitCheckInput = {
  cashierUserId: Scalars['ID']['input'];
  guestCount: InputMaybe<Scalars['Int']['input']>;
  itemIds: Array<Scalars['ID']['input']>;
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantWaitlistActionInput = {
  action: Scalars['String']['input'];
  cashierUserId: Scalars['ID']['input'];
  entryId: InputMaybe<Scalars['ID']['input']>;
  guestName: InputMaybe<Scalars['String']['input']>;
  guestPhone: InputMaybe<Scalars['String']['input']>;
  kind: InputMaybe<Scalars['String']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  partySize: InputMaybe<Scalars['Int']['input']>;
  pin: Scalars['String']['input'];
  preferredTableId: InputMaybe<Scalars['ID']['input']>;
  reason: InputMaybe<Scalars['String']['input']>;
  reservedFor: InputMaybe<Scalars['String']['input']>;
  tableId: InputMaybe<Scalars['ID']['input']>;
};

export type SchemaBmsPosRestaurantWaitlistActionResult = {
  __typename?: 'BmsPosRestaurantWaitlistActionResult';
  check: Maybe<SchemaBmsPosRestaurantCheck>;
  entry: Maybe<SchemaBmsPosRestaurantWaitlistEntry>;
  reason: Maybe<Scalars['String']['output']>;
  status: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosRestaurantWaitlistEntry = {
  __typename?: 'BmsPosRestaurantWaitlistEntry';
  calledAt: Maybe<Scalars['String']['output']>;
  checkId: Maybe<Scalars['ID']['output']>;
  closedAt: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  guestName: Maybe<Scalars['String']['output']>;
  guestPhone: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  kind: Scalars['String']['output'];
  note: Maybe<Scalars['String']['output']>;
  partySize: Scalars['Int']['output'];
  preferredTableCode: Maybe<Scalars['String']['output']>;
  preferredTableId: Maybe<Scalars['ID']['output']>;
  queueNo: Maybe<Scalars['Int']['output']>;
  reservedFor: Maybe<Scalars['String']['output']>;
  seatedAt: Maybe<Scalars['String']['output']>;
  seatedTableCode: Maybe<Scalars['String']['output']>;
  seatedTableId: Maybe<Scalars['ID']['output']>;
  serviceDate: Scalars['String']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsPosRestaurantWaitlistEntryInput = {
  cashierUserId: Scalars['ID']['input'];
  entryId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
};

export type SchemaBmsPosRestaurantWaitlistResult = {
  __typename?: 'BmsPosRestaurantWaitlistResult';
  calledCount: Scalars['Int']['output'];
  entries: Array<SchemaBmsPosRestaurantWaitlistEntry>;
  waitingCount: Scalars['Int']['output'];
  waitingGuests: Scalars['Int']['output'];
};

export type SchemaBmsPosReturnActionResult = {
  __typename?: 'BmsPosReturnActionResult';
  additionalAmount: Maybe<Scalars['Float']['output']>;
  available: Maybe<Scalars['Float']['output']>;
  blindReturnId: Maybe<Scalars['ID']['output']>;
  channel: Maybe<Scalars['String']['output']>;
  creditNoteNo: Maybe<Scalars['String']['output']>;
  crossBranch: Maybe<Scalars['Boolean']['output']>;
  current: Maybe<Scalars['String']['output']>;
  maxUnitRefund: Maybe<Scalars['Float']['output']>;
  method: Maybe<Scalars['String']['output']>;
  orderId: Maybe<Scalars['ID']['output']>;
  orderItemId: Maybe<Scalars['Int']['output']>;
  pointsReturned: Maybe<Scalars['Float']['output']>;
  pointsReversed: Maybe<Scalars['Float']['output']>;
  posReturnId: Maybe<Scalars['ID']['output']>;
  pricingAdjustmentAmount: Maybe<Scalars['Float']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  refundAmount: Maybe<Scalars['Float']['output']>;
  refunds: Maybe<Array<SchemaBmsPosRefundAllocation>>;
  remaining: Maybe<Scalars['Float']['output']>;
  remainingAmount: Maybe<Scalars['Float']['output']>;
  replayed: Maybe<Scalars['Boolean']['output']>;
  requested: Maybe<Scalars['Float']['output']>;
  returnLocationId: Maybe<Scalars['ID']['output']>;
  returnedAt: Maybe<Scalars['String']['output']>;
  returnedItems: Maybe<Array<SchemaBmsPosReturnedItem>>;
  saleLocationId: Maybe<Scalars['ID']['output']>;
  settlementStatus: Maybe<Scalars['String']['output']>;
  sku: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosReturnAuditSummaryResult = {
  __typename?: 'BmsPosReturnAuditSummaryResult';
  anomalySignals: Array<Scalars['String']['output']>;
  approvalCandidateCount: Scalars['Int']['output'];
  approvedCount: Scalars['Int']['output'];
  byCashier: Array<SchemaBmsPosReturnCashierSummary>;
  from: Scalars['String']['output'];
  highValueReturnCount: Scalars['Int']['output'];
  missingApprovalCount: Scalars['Int']['output'];
  noReceiptCount: Scalars['Int']['output'];
  noReceiptTotal: Scalars['Float']['output'];
  to: Scalars['String']['output'];
};

export type SchemaBmsPosReturnCashierSummary = {
  __typename?: 'BmsPosReturnCashierSummary';
  cashier: Scalars['String']['output'];
  refundTotal: Scalars['Float']['output'];
  returnCount: Scalars['Int']['output'];
};

export type SchemaBmsPosReturnInput = {
  approvalPin: InputMaybe<Scalars['String']['input']>;
  approvalUserId: InputMaybe<Scalars['ID']['input']>;
  cashierUserId: Scalars['ID']['input'];
  idempotencyKey: Scalars['String']['input'];
  lines: InputMaybe<Array<SchemaBmsPosReturnLineInput>>;
  mode: Scalars['String']['input'];
  note: Scalars['String']['input'];
  orderId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  preferredRefundMethod: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPosReturnLineInput = {
  orderItemId: Scalars['Int']['input'];
  packQty: Scalars['Int']['input'];
};

export type SchemaBmsPosReturnReasonSummary = {
  __typename?: 'BmsPosReturnReasonSummary';
  count: Scalars['Int']['output'];
  reasonCode: Maybe<Scalars['String']['output']>;
  reasonText: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosReturnSummaryResult = {
  __typename?: 'BmsPosReturnSummaryResult';
  from: Scalars['String']['output'];
  pendingCount: Scalars['Int']['output'];
  pendingTotal: Scalars['Float']['output'];
  recent: Array<SchemaBmsPosRecentReturnSummary>;
  refundTotal: Scalars['Float']['output'];
  returnCount: Scalars['Int']['output'];
  settledTotal: Scalars['Float']['output'];
  to: Scalars['String']['output'];
  topReasons: Array<SchemaBmsPosReturnReasonSummary>;
};

export type SchemaBmsPosReturnedItem = {
  __typename?: 'BmsPosReturnedItem';
  orderItemId: Scalars['Int']['output'];
  packQty: Scalars['Float']['output'];
  refundAmount: Scalars['Float']['output'];
};

export type SchemaBmsPosSaleInput = {
  cashierUserId: Scalars['ID']['input'];
  couponCode: InputMaybe<Scalars['String']['input']>;
  creditApproverPin: InputMaybe<Scalars['String']['input']>;
  creditApproverUserId: InputMaybe<Scalars['ID']['input']>;
  customerId: InputMaybe<Scalars['ID']['input']>;
  depositCustomerNote: InputMaybe<Scalars['String']['input']>;
  depositDueAt: InputMaybe<Scalars['String']['input']>;
  discountApproverPin: InputMaybe<Scalars['String']['input']>;
  discountApproverUserId: InputMaybe<Scalars['ID']['input']>;
  discountReason: InputMaybe<Scalars['String']['input']>;
  extraLines: InputMaybe<Array<SchemaBmsPosExtraLineInput>>;
  idempotencyKey: Scalars['String']['input'];
  lines: Array<SchemaBmsPosSaleLineInput>;
  manualDiscount: InputMaybe<Scalars['Float']['input']>;
  mode: InputMaybe<Scalars['String']['input']>;
  payments: Array<SchemaBmsPosPaymentInput>;
  pharmacistAuthorizationNote: InputMaybe<Scalars['String']['input']>;
  pharmacistAuthorizerPin: InputMaybe<Scalars['String']['input']>;
  pharmacistAuthorizerUserId: InputMaybe<Scalars['ID']['input']>;
  pharmacyApprovedAssessmentId: InputMaybe<Scalars['ID']['input']>;
  pharmacyReviewAssessmentId: InputMaybe<Scalars['ID']['input']>;
  pin: Scalars['String']['input'];
  pointsToRedeem: InputMaybe<Scalars['Float']['input']>;
};

export type SchemaBmsPosSaleLineInput = {
  baseQty: InputMaybe<Scalars['Float']['input']>;
  modifierCodes: InputMaybe<Array<Scalars['String']['input']>>;
  packCode: InputMaybe<Scalars['String']['input']>;
  packPrice: InputMaybe<Scalars['Float']['input']>;
  packQty: Scalars['Int']['input'];
  scaleBarcode: InputMaybe<Scalars['String']['input']>;
  serials: InputMaybe<Array<Scalars['String']['input']>>;
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
  unitName: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPosSaleResult = {
  __typename?: 'BmsPosSaleResult';
  amountDue: Maybe<Scalars['Float']['output']>;
  available: Maybe<Scalars['Float']['output']>;
  balance: Maybe<Scalars['Float']['output']>;
  billNo: Maybe<Scalars['String']['output']>;
  blockers: Maybe<Array<SchemaBmsPosPharmacyBlocker>>;
  cashChange: Maybe<Scalars['Float']['output']>;
  cashTendered: Maybe<Scalars['Float']['output']>;
  code: Maybe<Scalars['String']['output']>;
  couponCode: Maybe<Scalars['String']['output']>;
  deposit: Maybe<SchemaBmsPosDeposit>;
  discount: Maybe<Scalars['Float']['output']>;
  discountLines: Maybe<Array<SchemaBmsPosDiscountLine>>;
  docNo: Maybe<Scalars['String']['output']>;
  expected: Maybe<Scalars['Float']['output']>;
  fulfillmentType: Maybe<Scalars['String']['output']>;
  index: Maybe<Scalars['Int']['output']>;
  items: Maybe<Array<SchemaBmsPosCreatedLine>>;
  kitchenTickets: Maybe<Scalars['Int']['output']>;
  locationId: Maybe<Scalars['ID']['output']>;
  locations: Maybe<Array<SchemaBmsPosAvailableLocation>>;
  maxQuantity: Maybe<Scalars['Int']['output']>;
  orderId: Maybe<Scalars['ID']['output']>;
  packCode: Maybe<Scalars['String']['output']>;
  pointsBalance: Maybe<Scalars['Float']['output']>;
  pointsEarned: Maybe<Scalars['Float']['output']>;
  pointsUsed: Maybe<Scalars['Float']['output']>;
  posDeviceId: Maybe<Scalars['ID']['output']>;
  preferredCarrier: Maybe<Scalars['String']['output']>;
  promisedAt: Maybe<Scalars['String']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  receiptNo: Maybe<Scalars['String']['output']>;
  received: Maybe<Scalars['Float']['output']>;
  replayed: Maybe<Scalars['Boolean']['output']>;
  requested: Maybe<Scalars['Float']['output']>;
  roundingAmount: Maybe<Scalars['Float']['output']>;
  saleLocationId: Maybe<Scalars['ID']['output']>;
  salePolicy: Maybe<Scalars['String']['output']>;
  sellable: Maybe<Scalars['Float']['output']>;
  serial: Maybe<Scalars['String']['output']>;
  shiftId: Maybe<Scalars['ID']['output']>;
  shippingFee: Maybe<Scalars['Float']['output']>;
  size: Maybe<Scalars['String']['output']>;
  sku: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  subtotal: Maybe<Scalars['Float']['output']>;
  total: Maybe<Scalars['Float']['output']>;
  vat: Maybe<SchemaBmsPosReceiptVat>;
};

export type SchemaBmsPosScanResult = {
  __typename?: 'BmsPosScanResult';
  available: Scalars['Float']['output'];
  basePrice: Scalars['Float']['output'];
  baseQty: Scalars['Float']['output'];
  imageUrl: Maybe<Scalars['String']['output']>;
  modifiers: Array<SchemaBmsPosModifier>;
  packCode: Scalars['String']['output'];
  packPrice: Scalars['Float']['output'];
  priceTiers: Array<SchemaBmsPosPriceTier>;
  productName: Scalars['String']['output'];
  promotion: Maybe<SchemaBmsPosPromotion>;
  receiptName: Scalars['String']['output'];
  scaleBarcode: Maybe<Scalars['String']['output']>;
  serialTracked: Scalars['Boolean']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  unitName: Scalars['String']['output'];
};

export type SchemaBmsPosSendReceiptInput = {
  cashierUserId: Scalars['ID']['input'];
  channel: Scalars['String']['input'];
  orderId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  to: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPosSessionResult = {
  __typename?: 'BmsPosSessionResult';
  approvers: Array<SchemaBmsPosApprover>;
  businessArchetype: Maybe<Scalars['String']['output']>;
  cashiers: Array<SchemaBmsPosCashier>;
  device: SchemaBmsPosDeviceSummary;
  kitchenOperators: Array<SchemaBmsPosCashier>;
  location: Maybe<SchemaBmsPosLocationSummary>;
  purchaseReceivers: Array<SchemaBmsPosCashier>;
  shift: Maybe<SchemaBmsPosShift>;
  shiftReturnSummary: SchemaBmsPosShiftReturnSummary;
  store: SchemaBmsPosStoreReceiptSettings;
  surface: Scalars['String']['output'];
  vat: SchemaBmsPosVatSettings;
};

export type SchemaBmsPosShift = {
  __typename?: 'BmsPosShift';
  cashVariance: Maybe<Scalars['Float']['output']>;
  closedAt: Maybe<Scalars['String']['output']>;
  countedCash: Maybe<Scalars['Float']['output']>;
  deviceId: Scalars['ID']['output'];
  expectedCash: Maybe<Scalars['Float']['output']>;
  id: Scalars['ID']['output'];
  locationId: Scalars['ID']['output'];
  openedAt: Scalars['String']['output'];
  openedBy: Scalars['ID']['output'];
  openingFloat: Scalars['Float']['output'];
  pharmacistUserId: Maybe<Scalars['ID']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosShiftActionResult = {
  __typename?: 'BmsPosShiftActionResult';
  amount: Maybe<Scalars['Float']['output']>;
  cashIn: Maybe<Scalars['Float']['output']>;
  cashOut: Maybe<Scalars['Float']['output']>;
  count: Maybe<Scalars['Int']['output']>;
  partialReturnCashOut: Maybe<Scalars['Float']['output']>;
  reason: Maybe<Scalars['String']['output']>;
  shift: Maybe<SchemaBmsPosShift>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosShiftCashierSummary = {
  __typename?: 'BmsPosShiftCashierSummary';
  amount: Scalars['Float']['output'];
  billCount: Scalars['Int']['output'];
  cashier: Scalars['String']['output'];
};

export type SchemaBmsPosShiftHistoryItem = {
  __typename?: 'BmsPosShiftHistoryItem';
  cashVariance: Maybe<Scalars['Float']['output']>;
  closedAt: Maybe<Scalars['String']['output']>;
  closedByName: Maybe<Scalars['String']['output']>;
  countedCash: Maybe<Scalars['Float']['output']>;
  expectedCash: Maybe<Scalars['Float']['output']>;
  id: Scalars['ID']['output'];
  openedAt: Scalars['String']['output'];
  openedByName: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosShiftHistoryResult = {
  __typename?: 'BmsPosShiftHistoryResult';
  shifts: Array<SchemaBmsPosShiftHistoryItem>;
};

export type SchemaBmsPosShiftInput = {
  action: Scalars['String']['input'];
  cashierUserId: Scalars['ID']['input'];
  countedCash: InputMaybe<Scalars['Float']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  openingFloat: InputMaybe<Scalars['Float']['input']>;
  pin: Scalars['String']['input'];
  userId: InputMaybe<Scalars['ID']['input']>;
};

export type SchemaBmsPosShiftPaymentSummary = {
  __typename?: 'BmsPosShiftPaymentSummary';
  amount: Scalars['Float']['output'];
  count: Scalars['Int']['output'];
  method: Scalars['String']['output'];
};

export type SchemaBmsPosShiftReport = {
  __typename?: 'BmsPosShiftReport';
  billCount: Scalars['Int']['output'];
  byCashier: Array<SchemaBmsPosShiftCashierSummary>;
  byMethod: Array<SchemaBmsPosShiftPaymentSummary>;
  cashIn: Scalars['Float']['output'];
  cashOut: Scalars['Float']['output'];
  cashRefunds: Scalars['Float']['output'];
  cashVariance: Maybe<Scalars['Float']['output']>;
  closedAt: Maybe<Scalars['String']['output']>;
  closedByName: Maybe<Scalars['String']['output']>;
  countedCash: Maybe<Scalars['Float']['output']>;
  deviceCode: Scalars['String']['output'];
  discountTotal: Scalars['Float']['output'];
  expectedCash: Maybe<Scalars['Float']['output']>;
  expectedCashHidden: Scalars['Boolean']['output'];
  expenseCount: Scalars['Int']['output'];
  expenseTotal: Scalars['Float']['output'];
  locationName: Maybe<Scalars['String']['output']>;
  noSaleCount: Scalars['Int']['output'];
  openExpenseAmount: Scalars['Float']['output'];
  openExpenseCount: Scalars['Int']['output'];
  openedAt: Scalars['String']['output'];
  openedByName: Maybe<Scalars['String']['output']>;
  openingFloat: Scalars['Float']['output'];
  personalExpenseCount: Scalars['Int']['output'];
  personalExpenseTotal: Scalars['Float']['output'];
  pettyCashExpenseCount: Scalars['Int']['output'];
  pettyCashExpenseTotal: Scalars['Float']['output'];
  returnCount: Scalars['Int']['output'];
  returnTotal: Scalars['Float']['output'];
  roundingTotal: Scalars['Float']['output'];
  salesTotal: Scalars['Float']['output'];
  shiftId: Scalars['ID']['output'];
  status: Scalars['String']['output'];
  voidCount: Scalars['Int']['output'];
  voidTotal: Scalars['Float']['output'];
};

export type SchemaBmsPosShiftReportResult = {
  __typename?: 'BmsPosShiftReportResult';
  receivables: SchemaBmsPosArShiftSummary;
  report: SchemaBmsPosShiftReport;
};

export type SchemaBmsPosShiftReturnSummary = {
  __typename?: 'BmsPosShiftReturnSummary';
  pendingCount: Scalars['Int']['output'];
  pendingTotal: Scalars['Float']['output'];
  returnCount: Scalars['Int']['output'];
  returnTotal: Scalars['Float']['output'];
  settledTotal: Scalars['Float']['output'];
};

export type SchemaBmsPosSimpleActionResult = {
  __typename?: 'BmsPosSimpleActionResult';
  reason: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosStoreCreditResult = {
  __typename?: 'BmsPosStoreCreditResult';
  credit: Maybe<SchemaBmsPosStoreCreditSummary>;
  reason: Maybe<Scalars['String']['output']>;
  status: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosStoreCreditSummary = {
  __typename?: 'BmsPosStoreCreditSummary';
  balance: Scalars['Float']['output'];
  code: Scalars['String']['output'];
  customerName: Maybe<Scalars['String']['output']>;
  expiresAt: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPosStoreReceiptSettings = {
  __typename?: 'BmsPosStoreReceiptSettings';
  receiptLanguageMode: Scalars['String']['output'];
  taxId: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsPosVatSettings = {
  __typename?: 'BmsPosVatSettings';
  calendarEra: Scalars['String']['output'];
  cashRounding: Scalars['String']['output'];
  priceIncludesVat: Scalars['Boolean']['output'];
  rate: Scalars['Float']['output'];
  registered: Scalars['Boolean']['output'];
};

export type SchemaBmsPosVoidInput = {
  approverPin: Scalars['String']['input'];
  approverUserId: Scalars['ID']['input'];
  cashierUserId: Scalars['ID']['input'];
  idempotencyKey: Scalars['String']['input'];
  orderId: Scalars['ID']['input'];
  pin: Scalars['String']['input'];
  reason: Scalars['String']['input'];
};

export type SchemaBmsPriceTier = {
  __typename?: 'BmsPriceTier';
  discountPct: Maybe<Scalars['Float']['output']>;
  minQty: Scalars['Int']['output'];
  scope: Scalars['String']['output'];
  size: Maybe<Scalars['String']['output']>;
  unitPrice: Maybe<Scalars['Float']['output']>;
};

export type SchemaBmsPriceTierInput = {
  discountPct: InputMaybe<Scalars['Float']['input']>;
  minQty: Scalars['Int']['input'];
  scope: InputMaybe<Scalars['String']['input']>;
  size: InputMaybe<Scalars['String']['input']>;
  unitPrice: InputMaybe<Scalars['Float']['input']>;
};

export type SchemaBmsPriceTierRowInput = {
  discountPct: InputMaybe<Scalars['Float']['input']>;
  minQty: Scalars['Int']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  scope: Scalars['String']['input'];
  size: InputMaybe<Scalars['String']['input']>;
  unitPrice: InputMaybe<Scalars['Float']['input']>;
};

export type SchemaBmsProduct = {
  __typename?: 'BmsProduct';
  active: Scalars['Boolean']['output'];
  barcode: Maybe<Scalars['String']['output']>;
  brand: Maybe<Scalars['String']['output']>;
  catalogVariants: Array<SchemaBmsProductCatalogVariant>;
  category: Maybe<Scalars['String']['output']>;
  costPrice: Maybe<Scalars['Float']['output']>;
  description: Maybe<Scalars['String']['output']>;
  imageUrl: Maybe<Scalars['String']['output']>;
  images: Array<SchemaImage>;
  keywords: Array<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  price: Scalars['Float']['output'];
  priceTiers: Array<SchemaBmsPriceTier>;
  readiness: SchemaBmsProductReadiness;
  salesSurfaces: Array<Scalars['String']['output']>;
  sku: Scalars['String']['output'];
  stockPolicy: Maybe<SchemaBmsProductStockPolicy>;
  variants: Array<SchemaBmsVariant>;
  vatCategory: Maybe<Scalars['String']['output']>;
  weightGrams: Maybe<Scalars['Int']['output']>;
};

export type SchemaBmsProductCatalogVariant = {
  __typename?: 'BmsProductCatalogVariant';
  active: Scalars['Boolean']['output'];
  code: Scalars['String']['output'];
  displayName: Maybe<Scalars['String']['output']>;
  sortOrder: Scalars['Int']['output'];
};

export type SchemaBmsProductCatalogVariantInput = {
  active: InputMaybe<Scalars['Boolean']['input']>;
  code: Scalars['String']['input'];
  displayName: InputMaybe<Scalars['String']['input']>;
  productSku: Scalars['String']['input'];
  sortOrder: InputMaybe<Scalars['Int']['input']>;
};

export type SchemaBmsProductCategory = {
  __typename?: 'BmsProductCategory';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
};

export type SchemaBmsProductConnection = {
  __typename?: 'BmsProductConnection';
  items: Array<SchemaBmsProduct>;
  total: Scalars['Int']['output'];
};

export type SchemaBmsProductDuplicateResult = {
  __typename?: 'BmsProductDuplicateResult';
  name: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsProductImportResult = {
  __typename?: 'BmsProductImportResult';
  createCount: Scalars['Int']['output'];
  errorCount: Scalars['Int']['output'];
  quotaExceeded: Scalars['Boolean']['output'];
  quotaMessage: Maybe<Scalars['String']['output']>;
  rows: Array<SchemaBmsProductImportRowResult>;
  updateCount: Scalars['Int']['output'];
};

export type SchemaBmsProductImportRowInput = {
  active: InputMaybe<Scalars['Boolean']['input']>;
  barcode: InputMaybe<Scalars['String']['input']>;
  base_unit: InputMaybe<Scalars['String']['input']>;
  brand: InputMaybe<Scalars['String']['input']>;
  category: InputMaybe<Scalars['String']['input']>;
  cost_price: InputMaybe<Scalars['Float']['input']>;
  creation_template: InputMaybe<Scalars['String']['input']>;
  description: InputMaybe<Scalars['String']['input']>;
  keywords: InputMaybe<Array<Scalars['String']['input']>>;
  name: Scalars['String']['input'];
  price: Scalars['Float']['input'];
  rowNumber: Scalars['Int']['input'];
  sales_surfaces: InputMaybe<Array<Scalars['String']['input']>>;
  sku: Scalars['String']['input'];
  stock_policy: InputMaybe<Scalars['String']['input']>;
  variant_codes: InputMaybe<Array<Scalars['String']['input']>>;
};

export type SchemaBmsProductImportRowResult = {
  __typename?: 'BmsProductImportRowResult';
  action: Scalars['String']['output'];
  error: Maybe<Scalars['String']['output']>;
  rowNumber: Scalars['Int']['output'];
  sku: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsProductInput = {
  active: InputMaybe<Scalars['Boolean']['input']>;
  barcode: InputMaybe<Scalars['String']['input']>;
  base_unit: InputMaybe<Scalars['String']['input']>;
  brand: InputMaybe<Scalars['String']['input']>;
  category: InputMaybe<Scalars['String']['input']>;
  cost_price: InputMaybe<Scalars['Float']['input']>;
  creation_template: InputMaybe<Scalars['String']['input']>;
  description: InputMaybe<Scalars['String']['input']>;
  image_url: InputMaybe<Scalars['String']['input']>;
  image_urls: InputMaybe<Array<Scalars['String']['input']>>;
  keywords: InputMaybe<Array<Scalars['String']['input']>>;
  kitchen_station: InputMaybe<Scalars['String']['input']>;
  /** 9.54 — id ของสถานีจาก bmsKitchenStations · ชนะ kitchen_station เมื่อส่งมาทั้งคู่ */
  kitchen_station_id: InputMaybe<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
  price: Scalars['Float']['input'];
  price_tiers: InputMaybe<Array<SchemaBmsPriceTierInput>>;
  sales_surfaces: InputMaybe<Array<Scalars['String']['input']>>;
  sku: Scalars['String']['input'];
  stock_policy: InputMaybe<Scalars['String']['input']>;
  variant_codes: InputMaybe<Array<Scalars['String']['input']>>;
  vat_category: InputMaybe<Scalars['String']['input']>;
  weight_grams: InputMaybe<Scalars['Int']['input']>;
};

export type SchemaBmsProductModifier = {
  __typename?: 'BmsProductModifier';
  active: Scalars['Boolean']['output'];
  code: Scalars['String']['output'];
  defaultSelected: Scalars['Boolean']['output'];
  groupCode: Scalars['String']['output'];
  groupId: Scalars['ID']['output'];
  groupName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsModifierComponent>;
  maxSelect: Maybe<Scalars['Int']['output']>;
  minSelect: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  priceDelta: Scalars['Float']['output'];
  productSku: Scalars['String']['output'];
  selectionType: Scalars['String']['output'];
  size: Scalars['String']['output'];
  sortOrder: Scalars['Int']['output'];
};

export type SchemaBmsProductModifierInput = {
  active: InputMaybe<Scalars['Boolean']['input']>;
  code: Scalars['String']['input'];
  defaultSelected: InputMaybe<Scalars['Boolean']['input']>;
  groupCode: InputMaybe<Scalars['String']['input']>;
  groupName: InputMaybe<Scalars['String']['input']>;
  id: InputMaybe<Scalars['ID']['input']>;
  items: Array<SchemaBmsModifierComponentInput>;
  maxSelect: InputMaybe<Scalars['Int']['input']>;
  minSelect: InputMaybe<Scalars['Int']['input']>;
  name: Scalars['String']['input'];
  priceDelta: InputMaybe<Scalars['Float']['input']>;
  productSku: Scalars['String']['input'];
  selectionType: InputMaybe<Scalars['String']['input']>;
  size: Scalars['String']['input'];
  sortOrder: InputMaybe<Scalars['Int']['input']>;
};

/**  หน่วยขาย: สิ่งที่ลูกค้าซื้อจริงและมีบาร์โค้ดของตัวเอง (แผง / กล่อง)  */
export type SchemaBmsProductPack = {
  __typename?: 'BmsProductPack';
  active: Scalars['Boolean']['output'];
  barcode: Maybe<Scalars['String']['output']>;
  baseQty: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  isBase: Scalars['Boolean']['output'];
  packCode: Scalars['String']['output'];
  /**  null = คิดจากราคาสินค้า × baseQty  */
  price: Maybe<Scalars['Float']['output']>;
  productSku: Scalars['String']['output'];
  size: Maybe<Scalars['String']['output']>;
  unitName: Scalars['String']['output'];
};

export type SchemaBmsProductPackInput = {
  active: InputMaybe<Scalars['Boolean']['input']>;
  barcode: InputMaybe<Scalars['String']['input']>;
  baseQty: Scalars['Int']['input'];
  id: InputMaybe<Scalars['ID']['input']>;
  isBase: InputMaybe<Scalars['Boolean']['input']>;
  packCode: Scalars['String']['input'];
  price: InputMaybe<Scalars['Float']['input']>;
  productSku: Scalars['String']['input'];
  size: InputMaybe<Scalars['String']['input']>;
  unitName: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsProductPackList = {
  __typename?: 'BmsProductPackList';
  packs: Array<SchemaBmsProductPack>;
  /**  ไซซ์ที่มีแถวสต็อกจริง  */
  sizes: Array<Scalars['String']['output']>;
};

export type SchemaBmsProductPriceTier = {
  __typename?: 'BmsProductPriceTier';
  discountPct: Maybe<Scalars['Float']['output']>;
  locationId: Maybe<Scalars['ID']['output']>;
  locationName: Maybe<Scalars['String']['output']>;
  minQty: Scalars['Int']['output'];
  note: Maybe<Scalars['String']['output']>;
  productName: Maybe<Scalars['String']['output']>;
  productSku: Scalars['String']['output'];
  scope: Scalars['String']['output'];
  size: Maybe<Scalars['String']['output']>;
  unitPrice: Maybe<Scalars['Float']['output']>;
  updatedAt: Scalars['String']['output'];
};

export type SchemaBmsProductPromotion = {
  __typename?: 'BmsProductPromotion';
  active: Scalars['Boolean']['output'];
  bundlePrice: Maybe<Scalars['Float']['output']>;
  buyQty: Scalars['Int']['output'];
  endsAt: Maybe<Scalars['String']['output']>;
  getQty: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  kind: Scalars['String']['output'];
  /** null = โปรทั้งร้าน · มีค่า = โปรของสาขานั้น และทับโปรทั้งร้านของ SKU เดียวกัน */
  locationId: Maybe<Scalars['ID']['output']>;
  locationName: Maybe<Scalars['String']['output']>;
  note: Maybe<Scalars['String']['output']>;
  productName: Maybe<Scalars['String']['output']>;
  productSku: Scalars['String']['output'];
  startsAt: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['String']['output'];
};

export type SchemaBmsProductPromotionInput = {
  bundlePrice: InputMaybe<Scalars['Float']['input']>;
  buyQty: Scalars['Int']['input'];
  endsAt: InputMaybe<Scalars['String']['input']>;
  getQty: InputMaybe<Scalars['Int']['input']>;
  kind: Scalars['String']['input'];
  locationId: InputMaybe<Scalars['ID']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  productSku: Scalars['String']['input'];
  startsAt: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsProductReadiness = {
  __typename?: 'BmsProductReadiness';
  blockers: Array<SchemaBmsProductReadinessIssue>;
  ready: Scalars['Boolean']['output'];
  recipeCostEstimate: Maybe<Scalars['Float']['output']>;
  recipeCostMaxEstimate: Maybe<Scalars['Float']['output']>;
  warnings: Array<SchemaBmsProductReadinessIssue>;
};

export type SchemaBmsProductReadinessIssue = {
  __typename?: 'BmsProductReadinessIssue';
  code: Scalars['String']['output'];
  external: Scalars['Boolean']['output'];
  field: Maybe<Scalars['String']['output']>;
  fixPath: Maybe<Scalars['String']['output']>;
  message: Scalars['String']['output'];
};

export type SchemaBmsProductRecipe = {
  __typename?: 'BmsProductRecipe';
  active: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsRecipeComponent>;
  outputQty: Scalars['Int']['output'];
  productSku: Scalars['String']['output'];
  size: Scalars['String']['output'];
  version: Scalars['Int']['output'];
};

export type SchemaBmsProductRecipeInput = {
  active: InputMaybe<Scalars['Boolean']['input']>;
  id: InputMaybe<Scalars['ID']['input']>;
  items: Array<SchemaBmsRecipeComponentInput>;
  outputQty: InputMaybe<Scalars['Int']['input']>;
  productSku: Scalars['String']['input'];
  size: Scalars['String']['input'];
};

export type SchemaBmsProductStockPolicy = {
  __typename?: 'BmsProductStockPolicy';
  baseUnit: Scalars['String']['output'];
  displayPrecision: Scalars['Int']['output'];
  displayUnit: Maybe<Scalars['String']['output']>;
  expiryTracking: Scalars['Boolean']['output'];
  fefo: Scalars['Boolean']['output'];
  /** ชื่อสถานี — ค่าที่ derive จาก kitchenStationId ตั้งแต่ 9.54 (fallback ของผู้อ่านรุ่นเก่า) */
  kitchenStation: Maybe<Scalars['String']['output']>;
  kitchenStationId: Maybe<Scalars['ID']['output']>;
  lotTracking: Scalars['Boolean']['output'];
  productSku: Scalars['String']['output'];
  scaleItemCode: Maybe<Scalars['String']['output']>;
  scaleSize: Maybe<Scalars['String']['output']>;
  stockPolicy: Scalars['String']['output'];
};

export type SchemaBmsProductStockPolicyInput = {
  baseUnit: InputMaybe<Scalars['String']['input']>;
  deactivateDerived: InputMaybe<Scalars['Boolean']['input']>;
  displayPrecision: InputMaybe<Scalars['Int']['input']>;
  displayUnit: InputMaybe<Scalars['String']['input']>;
  expiryTracking: InputMaybe<Scalars['Boolean']['input']>;
  fefo: InputMaybe<Scalars['Boolean']['input']>;
  /** ทางเก่า (ชื่อล้วน) — ชื่อที่ยังไม่มีแถวหลักจะถูกยกขึ้นเป็นสถานีระดับร้านให้อัตโนมัติ */
  kitchenStation: InputMaybe<Scalars['String']['input']>;
  /** ทางใหม่ (9.54) เลือกจาก bmsKitchenStations — ส่งมาคู่กับ kitchenStation ได้ แต่ id ชนะ */
  kitchenStationId: InputMaybe<Scalars['ID']['input']>;
  lotTracking: InputMaybe<Scalars['Boolean']['input']>;
  productSku: Scalars['String']['input'];
  scaleItemCode: InputMaybe<Scalars['String']['input']>;
  scaleSize: InputMaybe<Scalars['String']['input']>;
  stockPolicy: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsPurchaseItem = {
  __typename?: 'BmsPurchaseItem';
  qtyOrdered: Scalars['Int']['output'];
  qtyReceived: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  supplierProductName: Maybe<Scalars['String']['output']>;
  supplierSku: Maybe<Scalars['String']['output']>;
  unitCost: Scalars['Float']['output'];
};

export type SchemaBmsPurchaseItemInput = {
  leadTimeDays: InputMaybe<Scalars['Int']['input']>;
  minOrderQty: InputMaybe<Scalars['Int']['input']>;
  packQty: InputMaybe<Scalars['Int']['input']>;
  qty: Scalars['Int']['input'];
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
  supplierBarcode: InputMaybe<Scalars['String']['input']>;
  supplierProductName: InputMaybe<Scalars['String']['input']>;
  supplierSku: InputMaybe<Scalars['String']['input']>;
  unitCost: InputMaybe<Scalars['Float']['input']>;
};

export type SchemaBmsPurchaseOrder = {
  __typename?: 'BmsPurchaseOrder';
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  items: Array<SchemaBmsPurchaseItem>;
  note: Maybe<Scalars['String']['output']>;
  qtyOrdered: Scalars['Int']['output'];
  qtyReceived: Scalars['Int']['output'];
  status: SchemaBmsPurchaseStatus;
  supplier: Maybe<SchemaBmsSupplier>;
  total: Scalars['Float']['output'];
  updatedAt: Scalars['String']['output'];
};

export type SchemaBmsPurchaseResult = {
  __typename?: 'BmsPurchaseResult';
  message: Maybe<Scalars['String']['output']>;
  poId: Maybe<Scalars['ID']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsPurchaseStatus =
  | 'CANCELLED'
  | 'OPEN'
  | 'PARTIAL'
  | 'RECEIVED';

export type SchemaBmsPurchaseSuggestionItem = {
  __typename?: 'BmsPurchaseSuggestionItem';
  available: Scalars['Int']['output'];
  avgPerDay: Scalars['Float']['output'];
  classification: Scalars['String']['output'];
  demandFeedback: Scalars['Int']['output'];
  incomingQty: Scalars['Int']['output'];
  leadTimeDays: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  recommendedAction: Scalars['String']['output'];
  safetyStock: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  soldInWindow: Scalars['Int']['output'];
  suggestedQty: Scalars['Int']['output'];
  trendPct: Scalars['Float']['output'];
};

export type SchemaBmsReceiveItemInput = {
  qty: Scalars['Int']['input'];
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};

export type SchemaBmsReceiveStockTransferInput = {
  received: InputMaybe<Array<SchemaBmsStockTransferReceiptLineInput>>;
  receivingNote: InputMaybe<Scalars['String']['input']>;
  transferId: Scalars['ID']['input'];
};

export type SchemaBmsRecipeComponent = {
  __typename?: 'BmsRecipeComponent';
  qty: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsRecipeComponentInput = {
  qty: Scalars['Int']['input'];
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};

export type SchemaBmsRecordStockCountItemInput = {
  countId: Scalars['ID']['input'];
  countedQty: Scalars['Int']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};

export type SchemaBmsReorderResult = {
  __typename?: 'BmsReorderResult';
  message: Scalars['String']['output'];
  orderId: Maybe<Scalars['ID']['output']>;
  status: Scalars['String']['output'];
  total: Maybe<Scalars['Float']['output']>;
};

export type SchemaBmsReplacePriceTiersInput = {
  locationId: InputMaybe<Scalars['ID']['input']>;
  productSku: Scalars['String']['input'];
  tiers: Array<SchemaBmsPriceTierRowInput>;
};

export type SchemaBmsReportChannelResult = {
  __typename?: 'BmsReportChannelResult';
  channel: Scalars['String']['output'];
  error: Maybe<Scalars['String']['output']>;
  ok: Scalars['Boolean']['output'];
};

export type SchemaBmsReportDelivery = {
  __typename?: 'BmsReportDelivery';
  channel: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  error: Maybe<Scalars['String']['output']>;
  frequency: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  payloadSnapshot: Maybe<Scalars['JSON']['output']>;
  periodEnd: Scalars['String']['output'];
  periodKey: Scalars['String']['output'];
  periodStart: Scalars['String']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsReportSubscription = {
  __typename?: 'BmsReportSubscription';
  emailEnabled: Scalars['Boolean']['output'];
  enabled: Scalars['Boolean']['output'];
  frequency: Scalars['String']['output'];
  hasSlackWebhook: Scalars['Boolean']['output'];
  lastPeriodKey: Maybe<Scalars['String']['output']>;
  lastSentAt: Maybe<Scalars['String']['output']>;
  lastStatus: Maybe<Scalars['String']['output']>;
  lineEnabled: Scalars['Boolean']['output'];
  lineUserId: Maybe<Scalars['String']['output']>;
  platformAllowed: Scalars['Boolean']['output'];
  recipientEmail: Maybe<Scalars['String']['output']>;
  sendDayOfMonth: Maybe<Scalars['Int']['output']>;
  sendHour: Scalars['Int']['output'];
  sendWeekday: Maybe<Scalars['Int']['output']>;
  slackEnabled: Scalars['Boolean']['output'];
  tenantId: Scalars['ID']['output'];
};

export type SchemaBmsReportSubscriptionOverview = {
  __typename?: 'BmsReportSubscriptionOverview';
  emailEnabled: Scalars['Boolean']['output'];
  enabled: Scalars['Boolean']['output'];
  frequency: Scalars['String']['output'];
  hasSlackWebhook: Scalars['Boolean']['output'];
  lastPeriodKey: Maybe<Scalars['String']['output']>;
  lastSentAt: Maybe<Scalars['String']['output']>;
  lastStatus: Maybe<Scalars['String']['output']>;
  lineEnabled: Scalars['Boolean']['output'];
  lineUserId: Maybe<Scalars['String']['output']>;
  recipientEmail: Maybe<Scalars['String']['output']>;
  sendDayOfMonth: Maybe<Scalars['Int']['output']>;
  sendHour: Scalars['Int']['output'];
  sendWeekday: Maybe<Scalars['Int']['output']>;
  slackEnabled: Scalars['Boolean']['output'];
  tenantId: Scalars['ID']['output'];
  tenantName: Scalars['String']['output'];
  tenantSlug: Scalars['String']['output'];
};

export type SchemaBmsRestaurantArea = {
  __typename?: 'BmsRestaurantArea';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  sortOrder: Scalars['Int']['output'];
  tableCount: Scalars['Int']['output'];
};

export type SchemaBmsRestaurantCancellationLoss = {
  __typename?: 'BmsRestaurantCancellationLoss';
  absorbedAmount: Scalars['Float']['output'];
  name: Scalars['String']['output'];
  quantity: Scalars['Int']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsRestaurantFloorAdmin = {
  __typename?: 'BmsRestaurantFloorAdmin';
  areas: Array<SchemaBmsRestaurantArea>;
  tables: Array<SchemaBmsRestaurantTableAdmin>;
};

export type SchemaBmsRestaurantTableAdmin = {
  __typename?: 'BmsRestaurantTableAdmin';
  active: Scalars['Boolean']['output'];
  areaId: Scalars['ID']['output'];
  blocked: Scalars['Boolean']['output'];
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  positionX: Scalars['Int']['output'];
  positionY: Scalars['Int']['output'];
  seats: Scalars['Int']['output'];
  shape: Scalars['String']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsRestaurantTablePatchInput = {
  areaId: InputMaybe<Scalars['ID']['input']>;
  blocked: InputMaybe<Scalars['Boolean']['input']>;
  name: InputMaybe<Scalars['String']['input']>;
  seats: InputMaybe<Scalars['Int']['input']>;
  shape: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsRestaurantTablePositionInput = {
  tableId: Scalars['ID']['input'];
  x: Scalars['Int']['input'];
  y: Scalars['Int']['input'];
};

export type SchemaBmsRestaurantTableQr = {
  __typename?: 'BmsRestaurantTableQr';
  createdAt: Scalars['String']['output'];
  tableCode: Scalars['String']['output'];
  tableId: Scalars['ID']['output'];
  tableName: Scalars['String']['output'];
  token: Scalars['String']['output'];
};

export type SchemaBmsRestockDelivery = {
  __typename?: 'BmsRestockDelivery';
  attemptNo: Scalars['Int']['output'];
  body: Scalars['String']['output'];
  channel: Scalars['String']['output'];
  completedAt: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  error: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  inboxMessageId: Maybe<Scalars['ID']['output']>;
  status: Scalars['String']['output'];
  triggeredBy: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsRestockMetrics = {
  __typename?: 'BmsRestockMetrics';
  active: Scalars['Int']['output'];
  cancelled: Scalars['Int']['output'];
  expired: Scalars['Int']['output'];
  failedDeliveries: Scalars['Int']['output'];
  notified: Scalars['Int']['output'];
  notifiedSubscriptions: Scalars['Int']['output'];
  notifyRate: Scalars['Float']['output'];
  ordered: Scalars['Int']['output'];
  purchased: Scalars['Int']['output'];
  readyRate: Scalars['Float']['output'];
  readyToNotify: Scalars['Int']['output'];
  recoveredCustomersCount: Scalars['Int']['output'];
  recoveredFromNotified: Scalars['Int']['output'];
  recoveredOrdersCount: Scalars['Int']['output'];
  recoveredRevenue: Scalars['Float']['output'];
  recoveredSalesCount: Scalars['Int']['output'];
  recoveryRateFromNotified: Scalars['Float']['output'];
  recoveryRateOverall: Scalars['Float']['output'];
  sentDeliveries: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type SchemaBmsRestockSendAllResult = {
  __typename?: 'BmsRestockSendAllResult';
  attempted: Scalars['Int']['output'];
  failed: Scalars['Int']['output'];
  sent: Scalars['Int']['output'];
};

export type SchemaBmsRestockSendResult = {
  __typename?: 'BmsRestockSendResult';
  attemptId: Maybe<Scalars['ID']['output']>;
  delivered: Scalars['Boolean']['output'];
  message: Scalars['String']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsRestockStatusCounts = {
  __typename?: 'BmsRestockStatusCounts';
  active: Scalars['Int']['output'];
  notified: Scalars['Int']['output'];
  ordered: Scalars['Int']['output'];
  readyToNotify: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type SchemaBmsRestockSubscription = {
  __typename?: 'BmsRestockSubscription';
  available: Scalars['Int']['output'];
  channel: Scalars['String']['output'];
  consentedAt: Scalars['String']['output'];
  conversationId: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['String']['output'];
  customerId: Maybe<Scalars['ID']['output']>;
  customerName: Maybe<Scalars['String']['output']>;
  customerRef: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  lastNotifiedAt: Maybe<Scalars['String']['output']>;
  orderedAt: Maybe<Scalars['String']['output']>;
  productName: Scalars['String']['output'];
  productSku: Scalars['String']['output'];
  readyAt: Maybe<Scalars['String']['output']>;
  recoveredRevenue: Maybe<Scalars['Float']['output']>;
  requestedQty: Scalars['Int']['output'];
  resolvedAt: Maybe<Scalars['String']['output']>;
  resolvedOrderId: Maybe<Scalars['ID']['output']>;
  size: Scalars['String']['output'];
  source: Scalars['String']['output'];
  status: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
};

export type SchemaBmsRestockSubscriptionConnection = {
  __typename?: 'BmsRestockSubscriptionConnection';
  items: Array<SchemaBmsRestockSubscription>;
  total: Scalars['Int']['output'];
};

export type SchemaBmsRetentionAnalytics = {
  __typename?: 'BmsRetentionAnalytics';
  holdoutConverted: Scalars['Int']['output'];
  holdoutRate: Scalars['Float']['output'];
  holdoutTotal: Scalars['Int']['output'];
  incrementalLift: Scalars['Float']['output'];
  retentionRevenue: Scalars['Float']['output'];
  treatmentConverted: Scalars['Int']['output'];
  treatmentRate: Scalars['Float']['output'];
  treatmentTotal: Scalars['Int']['output'];
};

export type SchemaBmsRetentionCase = {
  __typename?: 'BmsRetentionCase';
  cohort: Scalars['String']['output'];
  contactedAt: Maybe<Scalars['String']['output']>;
  convertedAt: Maybe<Scalars['String']['output']>;
  convertedRevenue: Maybe<Scalars['Float']['output']>;
  customerId: Scalars['ID']['output'];
  customerName: Scalars['String']['output'];
  expectedReturnAt: Maybe<Scalars['String']['output']>;
  frequency: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  monetary: Scalars['Float']['output'];
  reasonEn: Scalars['String']['output'];
  reasonTh: Scalars['String']['output'];
  recencyDays: Scalars['Int']['output'];
  recommendedChannel: Maybe<Scalars['String']['output']>;
  recommendedMessageEn: Scalars['String']['output'];
  recommendedMessageTh: Scalars['String']['output'];
  recommendedOffer: Scalars['String']['output'];
  recommendedProductSku: Maybe<Scalars['String']['output']>;
  rfmSegment: Scalars['String']['output'];
  riskScore: Scalars['Int']['output'];
  status: SchemaBmsRetentionStatus;
};

export type SchemaBmsRetentionStatus =
  | 'ACCEPTED'
  | 'CONTACTED'
  | 'CONVERTED'
  | 'DISMISSED'
  | 'EXPIRED'
  | 'NEW';

export type SchemaBmsReviewRestaurantRequestInput = {
  action: Scalars['String']['input'];
  confirmed: Scalars['Boolean']['input'];
  id: Scalars['ID']['input'];
  kitchenNote: InputMaybe<Scalars['String']['input']>;
  locationId: Scalars['ID']['input'];
  note: Scalars['String']['input'];
  quantities: InputMaybe<Array<Scalars['Int']['input']>>;
  version: Scalars['Int']['input'];
};

export type SchemaBmsRevisionComparison = {
  __typename?: 'BmsRevisionComparison';
  diff: Array<SchemaBmsRevisionDiff>;
  fromRevisionId: Scalars['ID']['output'];
  fromSnapshot: Scalars['JSON']['output'];
  kind: SchemaBmsRevisionKind;
  kindLabel: Scalars['String']['output'];
  toRevisionId: Scalars['ID']['output'];
  toSnapshot: Scalars['JSON']['output'];
};

export type SchemaBmsRevisionDiff = {
  __typename?: 'BmsRevisionDiff';
  after: Maybe<Scalars['JSON']['output']>;
  before: Maybe<Scalars['JSON']['output']>;
  path: Scalars['String']['output'];
};

export type SchemaBmsRevisionEntry = {
  __typename?: 'BmsRevisionEntry';
  created_at: Scalars['String']['output'];
  editorLabel: Maybe<Scalars['String']['output']>;
  editor_id: Maybe<Scalars['ID']['output']>;
  entityId: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  kind: SchemaBmsRevisionKind;
  kindLabel: Scalars['String']['output'];
  revision_id: Maybe<Scalars['ID']['output']>;
  snapshot: Scalars['JSON']['output'];
  tenant_id: Scalars['ID']['output'];
};

export type SchemaBmsRevisionKind =
  | 'coupons'
  | 'orders'
  | 'payments'
  | 'products'
  | 'purchase'
  | 'purchaseItems'
  | 'shipments';

export type SchemaBmsRolePermissions = {
  __typename?: 'BmsRolePermissions';
  id: Scalars['ID']['output'];
  is_super: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  permissions: Array<Scalars['String']['output']>;
};

export type SchemaBmsSalesByTierRow = {
  __typename?: 'BmsSalesByTierRow';
  averageBasket: Scalars['Float']['output'];
  members: Scalars['Int']['output'];
  orders: Scalars['Int']['output'];
  revenue: Scalars['Float']['output'];
  tierCode: Scalars['String']['output'];
  tierName: Scalars['String']['output'];
};

export type SchemaBmsSalesSummary = {
  __typename?: 'BmsSalesSummary';
  avgOrderValue: Scalars['Float']['output'];
  byChannel: Array<SchemaBmsChannelSales>;
  byDay: Array<SchemaBmsDailySales>;
  byStatus: Array<SchemaBmsStatusCount>;
  from: Scalars['String']['output'];
  netRevenue: Scalars['Float']['output'];
  orderCount: Scalars['Int']['output'];
  refundTotal: Scalars['Float']['output'];
  revenue: Scalars['Float']['output'];
  to: Scalars['String']['output'];
};

export type SchemaBmsSeedPharmacyQueueDemoResult = {
  __typename?: 'BmsSeedPharmacyQueueDemoResult';
  assessmentId: Maybe<Scalars['ID']['output']>;
  assessmentIds: Array<Scalars['ID']['output']>;
  createdCount: Scalars['Int']['output'];
};

export type SchemaBmsSendReportResult = {
  __typename?: 'BmsSendReportResult';
  overallStatus: Scalars['String']['output'];
  results: Array<SchemaBmsReportChannelResult>;
};

export type SchemaBmsSendResult = {
  __typename?: 'BmsSendResult';
  delivered: Scalars['Boolean']['output'];
  message: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsShipment = {
  __typename?: 'BmsShipment';
  carrier: SchemaBmsCarrier;
  carrierBookingAttemptedAt: Maybe<Scalars['String']['output']>;
  carrierBookingError: Maybe<Scalars['String']['output']>;
  carrierBookingStatus: Scalars['String']['output'];
  carrierLastSyncedAt: Maybe<Scalars['String']['output']>;
  carrierTrackingSource: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['String']['output'];
  externalShipmentId: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  labelUrl: Maybe<Scalars['String']['output']>;
  marketplaceManaged: Scalars['Boolean']['output'];
  note: Maybe<Scalars['String']['output']>;
  orderId: Scalars['ID']['output'];
  status: SchemaBmsShipmentStatus;
  trackingNo: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['String']['output'];
};

export type SchemaBmsShipmentLabel = {
  __typename?: 'BmsShipmentLabel';
  carrier: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  items: Array<SchemaBmsLabelItem>;
  labelUrl: Maybe<Scalars['String']['output']>;
  orderId: Scalars['ID']['output'];
  shipTo: SchemaBmsLabelShipTo;
  shipmentId: Scalars['ID']['output'];
  trackingNo: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsShipmentResult = {
  __typename?: 'BmsShipmentResult';
  carrierBookingStatus: Maybe<Scalars['String']['output']>;
  carrierIntegration: Maybe<Scalars['String']['output']>;
  message: Maybe<Scalars['String']['output']>;
  shipmentId: Maybe<Scalars['ID']['output']>;
  status: Scalars['String']['output'];
};

export type SchemaBmsShipmentStatus =
  | 'CANCELLED'
  | 'DELIVERED'
  | 'IN_TRANSIT'
  | 'PENDING'
  | 'RETURNED'
  | 'SHIPPED';

export type SchemaBmsShipmentTrackingEvent = {
  __typename?: 'BmsShipmentTrackingEvent';
  carrierStatus: Scalars['String']['output'];
  description: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  occurredAt: Scalars['String']['output'];
  source: Scalars['String']['output'];
};

export type SchemaBmsShippingWeightTier = {
  __typename?: 'BmsShippingWeightTier';
  maxGrams: Scalars['Int']['output'];
  surcharge: Scalars['Float']['output'];
};

export type SchemaBmsShippingWeightTierInput = {
  maxGrams: Scalars['Int']['input'];
  surcharge: Scalars['Float']['input'];
};

export type SchemaBmsShippingZoneRate = {
  __typename?: 'BmsShippingZoneRate';
  fee: Scalars['Float']['output'];
  zone: Scalars['String']['output'];
};

export type SchemaBmsShippingZoneRateInput = {
  fee: Scalars['Float']['input'];
  zone: Scalars['String']['input'];
};

export type SchemaBmsSignupResult = {
  __typename?: 'BmsSignupResult';
  slug: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  tenantId: Maybe<Scalars['ID']['output']>;
};

export type SchemaBmsSlipVerification = {
  __typename?: 'BmsSlipVerification';
  amountMatch: Scalars['Boolean']['output'];
  checkedAt: Scalars['String']['output'];
  expectedAmount: Scalars['Float']['output'];
  method: Scalars['String']['output'];
  provider: Maybe<Scalars['String']['output']>;
  reason: Scalars['String']['output'];
  verified: Scalars['Boolean']['output'];
};

export type SchemaBmsSlowMovingItem = {
  __typename?: 'BmsSlowMovingItem';
  available: Scalars['Int']['output'];
  classification: Scalars['String']['output'];
  name: Scalars['String']['output'];
  recommendedAction: Scalars['String']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  soldInWindow: Scalars['Int']['output'];
  trendPct: Scalars['Float']['output'];
};

export type SchemaBmsSqlResult = {
  __typename?: 'BmsSqlResult';
  columns: Array<Scalars['String']['output']>;
  durationMs: Scalars['Int']['output'];
  error: Maybe<Scalars['String']['output']>;
  ok: Scalars['Boolean']['output'];
  rowCount: Scalars['Int']['output'];
  rows: Scalars['JSON']['output'];
};

export type SchemaBmsStaffRef = {
  __typename?: 'BmsStaffRef';
  avatar: Maybe<Scalars['String']['output']>;
  email: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  isAvailable: Maybe<Scalars['Boolean']['output']>;
  name: Maybe<Scalars['String']['output']>;
  openCount: Maybe<Scalars['Int']['output']>;
  role: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsStatusCount = {
  __typename?: 'BmsStatusCount';
  count: Scalars['Int']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsStockCountInput = {
  action: Scalars['String']['input'];
  countId: InputMaybe<Scalars['ID']['input']>;
  countedQty: InputMaybe<Scalars['Int']['input']>;
  locationId: InputMaybe<Scalars['ID']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  size: InputMaybe<Scalars['String']['input']>;
  sku: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsStockMovement = {
  __typename?: 'BmsStockMovement';
  actor: Maybe<Scalars['String']['output']>;
  branch_code: Maybe<Scalars['String']['output']>;
  created_at: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  location_id: Scalars['ID']['output'];
  location_name: Maybe<Scalars['String']['output']>;
  note: Maybe<Scalars['String']['output']>;
  product_sku: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
  ref_order_id: Maybe<Scalars['String']['output']>;
  size: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export type SchemaBmsStockTransferInput = {
  action: Scalars['String']['input'];
  fromLocationId: InputMaybe<Scalars['ID']['input']>;
  items: InputMaybe<Array<SchemaBmsStockTransferLineInput>>;
  note: InputMaybe<Scalars['String']['input']>;
  received: InputMaybe<Array<SchemaBmsStockTransferReceiptLineInput>>;
  receivingNote: InputMaybe<Scalars['String']['input']>;
  toLocationId: InputMaybe<Scalars['ID']['input']>;
  transferId: InputMaybe<Scalars['ID']['input']>;
};

export type SchemaBmsStockTransferLineInput = {
  qty: Scalars['Int']['input'];
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};

export type SchemaBmsStockTransferReceiptLineInput = {
  damagedQty: InputMaybe<Scalars['Int']['input']>;
  itemId: Scalars['Int']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  qty: Scalars['Int']['input'];
  reason: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsStockoutRiskItem = {
  __typename?: 'BmsStockoutRiskItem';
  available: Scalars['Int']['output'];
  avgPerDay: Scalars['Float']['output'];
  daysToStockout: Maybe<Scalars['Float']['output']>;
  name: Scalars['String']['output'];
  projectedStockoutDate: Maybe<Scalars['String']['output']>;
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsStoreCapability = {
  __typename?: 'BmsStoreCapability';
  capability: Scalars['String']['output'];
  config: Scalars['JSON']['output'];
  configured: Scalars['Boolean']['output'];
  enabled: Scalars['Boolean']['output'];
  gating: Scalars['Boolean']['output'];
  source: Scalars['String']['output'];
  status: Scalars['String']['output'];
};

export type SchemaBmsStoreProfile = {
  __typename?: 'BmsStoreProfile';
  about: Maybe<Scalars['String']['output']>;
  address: Maybe<Scalars['String']['output']>;
  aiHandoffAfterFailedTurns: Scalars['Int']['output'];
  aiInterpretShortReplies: Scalars['Boolean']['output'];
  aiLanguage: Scalars['String']['output'];
  aiOrderingStyle: Scalars['String']['output'];
  aiRequiredFields: Array<Scalars['String']['output']>;
  businessArchetype: Maybe<Scalars['String']['output']>;
  businessArchetypeLocked: Scalars['Boolean']['output'];
  businessHours: Maybe<Scalars['String']['output']>;
  businessType: Maybe<Scalars['String']['output']>;
  contactEmail: Maybe<Scalars['String']['output']>;
  country: Maybe<Scalars['String']['output']>;
  currency: Maybe<Scalars['String']['output']>;
  emailFooterText: Maybe<Scalars['String']['output']>;
  emailThemeColor: Maybe<Scalars['String']['output']>;
  enabledCarriers: Array<SchemaBmsCarrier>;
  logoUrl: Maybe<Scalars['String']['output']>;
  paymentAccounts: Array<SchemaBmsPaymentAccount>;
  phone: Maybe<Scalars['String']['output']>;
  receiptLanguageMode: Scalars['String']['output'];
  restaurantMerchantAbsorbLimit: Scalars['Float']['output'];
  restaurantOrderHours: Scalars['JSON']['output'];
  restaurantOrdersPaused: Scalars['Boolean']['output'];
  returnPolicy: Maybe<Scalars['String']['output']>;
  shippingEstDaysMax: Maybe<Scalars['Int']['output']>;
  shippingEstDaysMin: Maybe<Scalars['Int']['output']>;
  shippingFlatRate: Maybe<Scalars['Float']['output']>;
  shippingFreeThreshold: Maybe<Scalars['Float']['output']>;
  shippingMode: Scalars['String']['output'];
  shippingOriginPostcode: Maybe<Scalars['String']['output']>;
  shippingOriginProvince: Maybe<Scalars['String']['output']>;
  shippingPolicy: Maybe<Scalars['String']['output']>;
  shippingWeightTiers: Array<SchemaBmsShippingWeightTier>;
  shippingZoneRates: Array<SchemaBmsShippingZoneRate>;
  taxId: Maybe<Scalars['String']['output']>;
  timezone: Maybe<Scalars['String']['output']>;
  vatRegistered: Scalars['Boolean']['output'];
  website: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsStoreProfileInput = {
  about: InputMaybe<Scalars['String']['input']>;
  address: InputMaybe<Scalars['String']['input']>;
  aiHandoffAfterFailedTurns: InputMaybe<Scalars['Int']['input']>;
  aiInterpretShortReplies: InputMaybe<Scalars['Boolean']['input']>;
  aiLanguage: InputMaybe<Scalars['String']['input']>;
  aiOrderingStyle: InputMaybe<Scalars['String']['input']>;
  aiRequiredFields: InputMaybe<Array<Scalars['String']['input']>>;
  businessArchetype: InputMaybe<Scalars['String']['input']>;
  businessHours: InputMaybe<Scalars['String']['input']>;
  businessType: InputMaybe<Scalars['String']['input']>;
  contactEmail: InputMaybe<Scalars['String']['input']>;
  country: InputMaybe<Scalars['String']['input']>;
  currency: InputMaybe<Scalars['String']['input']>;
  emailFooterText: InputMaybe<Scalars['String']['input']>;
  emailThemeColor: InputMaybe<Scalars['String']['input']>;
  enabledCarriers: InputMaybe<Array<SchemaBmsCarrier>>;
  logoUrl: InputMaybe<Scalars['String']['input']>;
  paymentAccounts: InputMaybe<Array<SchemaBmsPaymentAccountInput>>;
  phone: InputMaybe<Scalars['String']['input']>;
  receiptLanguageMode: InputMaybe<Scalars['String']['input']>;
  restaurantMerchantAbsorbLimit: InputMaybe<Scalars['Float']['input']>;
  restaurantOrderHours: InputMaybe<Scalars['JSON']['input']>;
  restaurantOrdersPaused: InputMaybe<Scalars['Boolean']['input']>;
  returnPolicy: InputMaybe<Scalars['String']['input']>;
  shippingEstDaysMax: InputMaybe<Scalars['Int']['input']>;
  shippingEstDaysMin: InputMaybe<Scalars['Int']['input']>;
  shippingFlatRate: InputMaybe<Scalars['Float']['input']>;
  shippingFreeThreshold: InputMaybe<Scalars['Float']['input']>;
  shippingMode: InputMaybe<Scalars['String']['input']>;
  shippingOriginPostcode: InputMaybe<Scalars['String']['input']>;
  shippingOriginProvince: InputMaybe<Scalars['String']['input']>;
  shippingPolicy: InputMaybe<Scalars['String']['input']>;
  shippingWeightTiers: InputMaybe<Array<SchemaBmsShippingWeightTierInput>>;
  shippingZoneRates: InputMaybe<Array<SchemaBmsShippingZoneRateInput>>;
  taxId: InputMaybe<Scalars['String']['input']>;
  timezone: InputMaybe<Scalars['String']['input']>;
  website: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsStoreSummary = {
  __typename?: 'BmsStoreSummary';
  address: Maybe<Scalars['String']['output']>;
  name: Maybe<Scalars['String']['output']>;
  phone: Maybe<Scalars['String']['output']>;
  taxId: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsSupplier = {
  __typename?: 'BmsSupplier';
  email: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  note: Maybe<Scalars['String']['output']>;
  phone: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsSupplierProduct = {
  __typename?: 'BmsSupplierProduct';
  active: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  lastUnitCost: Maybe<Scalars['Float']['output']>;
  leadTimeDays: Maybe<Scalars['Int']['output']>;
  minOrderQty: Scalars['Int']['output'];
  packQty: Scalars['Int']['output'];
  productName: Scalars['String']['output'];
  size: Scalars['String']['output'];
  sku: Scalars['String']['output'];
  supplierBarcode: Maybe<Scalars['String']['output']>;
  supplierId: Scalars['ID']['output'];
  supplierName: Scalars['String']['output'];
  supplierProductName: Maybe<Scalars['String']['output']>;
  supplierSku: Scalars['String']['output'];
};

export type SchemaBmsSupportTicket = {
  __typename?: 'BmsSupportTicket';
  closedAt: Maybe<Scalars['String']['output']>;
  comments: Array<SchemaBmsSupportTicketComment>;
  createdAt: Scalars['String']['output'];
  diagnosticBundleId: Maybe<Scalars['ID']['output']>;
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  ip: Maybe<Scalars['String']['output']>;
  message: Scalars['String']['output'];
  name: Maybe<Scalars['String']['output']>;
  pageUrl: Maybe<Scalars['String']['output']>;
  phone: Maybe<Scalars['String']['output']>;
  ref: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  subject: Scalars['String']['output'];
  ticketId: Scalars['String']['output'];
  topic: Scalars['String']['output'];
  updatedAt: Maybe<Scalars['String']['output']>;
  userAgent: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsSupportTicketComment = {
  __typename?: 'BmsSupportTicketComment';
  authorEmail: Maybe<Scalars['String']['output']>;
  authorId: Maybe<Scalars['ID']['output']>;
  body: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  fromStatus: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  toStatus: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsSupportTicketPage = {
  __typename?: 'BmsSupportTicketPage';
  items: Array<SchemaBmsSupportTicket>;
  total: Scalars['Int']['output'];
};

export type SchemaBmsSyncShipmentLiveResult = {
  __typename?: 'BmsSyncShipmentLiveResult';
  completedOrder: Maybe<Scalars['Boolean']['output']>;
  detail: Maybe<Scalars['String']['output']>;
  eventCount: Maybe<Scalars['Int']['output']>;
  shipmentId: Maybe<Scalars['ID']['output']>;
  shipmentStatus: Maybe<SchemaBmsShipmentStatus>;
  source: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  trackingNo: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsSystemEvent = {
  __typename?: 'BmsSystemEvent';
  actorName: Scalars['String']['output'];
  at: Scalars['String']['output'];
  auto: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  kind: Scalars['String']['output'];
  statusValue: Maybe<Scalars['String']['output']>;
  targetName: Maybe<Scalars['String']['output']>;
};

export type SchemaBmsTaxDocument = {
  __typename?: 'BmsTaxDocument';
  buyerAddress: Maybe<Scalars['String']['output']>;
  buyerBranchCode: Maybe<Scalars['String']['output']>;
  buyerName: Maybe<Scalars['String']['output']>;
  buyerPhone: Maybe<Scalars['String']['output']>;
  buyerTaxId: Maybe<Scalars['String']['output']>;
  cancelledAt: Maybe<Scalars['String']['output']>;
  cancelledReason: Maybe<Scalars['String']['output']>;
  deviceId: Maybe<Scalars['ID']['output']>;
  docNo: Scalars['String']['output'];
  docType: Scalars['String']['output'];
  exemptAmount: Scalars['Float']['output'];
  grandTotal: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  issueDate: Scalars['String']['output'];
  issuedAt: Scalars['String']['output'];
  locationId: Scalars['ID']['output'];
  orderId: Scalars['ID']['output'];
  replacesDocumentId: Maybe<Scalars['ID']['output']>;
  roundingAmount: Scalars['Float']['output'];
  taxableAmount: Scalars['Float']['output'];
  vatAmount: Scalars['Float']['output'];
  vatRate: Scalars['Float']['output'];
};

export type SchemaBmsTaxInvoiceBuyerInput = {
  address: InputMaybe<Scalars['String']['input']>;
  branchCode: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  phone: InputMaybe<Scalars['String']['input']>;
  taxId: Scalars['String']['input'];
};

/** ค่าตั้งภาษีของร้าน — มีผลกับบิลใหม่เท่านั้น เอกสารเก่าเก็บอัตราของตัวเองไว้แล้ว */
export type SchemaBmsTaxSettings = {
  __typename?: 'BmsTaxSettings';
  abbreviatedApproved: Scalars['Boolean']['output'];
  /** BE | CE — ปีบนเอกสาร */
  calendarEra: Scalars['String']['output'];
  /** NONE | 0.25 | 0.50 | 1.00 — ปัดเฉพาะบิลที่จ่ายสดล้วน */
  cashRounding: Scalars['String']['output'];
  priceIncludesVat: Scalars['Boolean']['output'];
  vatRate: Scalars['Float']['output'];
  vatRegistered: Scalars['Boolean']['output'];
  /** BASE_FIRST | VAT_FIRST_TRUNCATE | VAT_FIRST_ROUND */
  vatRounding: Scalars['String']['output'];
};

export type SchemaBmsTaxSettingsInput = {
  abbreviatedApproved: Scalars['Boolean']['input'];
  calendarEra: Scalars['String']['input'];
  cashRounding: Scalars['String']['input'];
  priceIncludesVat: Scalars['Boolean']['input'];
  vatRate: Scalars['Float']['input'];
  vatRegistered: Scalars['Boolean']['input'];
  vatRounding: Scalars['String']['input'];
};

export type SchemaBmsTenantInfo = {
  __typename?: 'BmsTenantInfo';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
};

export type SchemaBmsTenantRow = {
  __typename?: 'BmsTenantRow';
  active: Scalars['Boolean']['output'];
  created_at: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  orders: Scalars['Int']['output'];
  plan: Scalars['String']['output'];
  products: Scalars['Int']['output'];
  revenue: Scalars['Float']['output'];
  slug: Scalars['String']['output'];
  users: Scalars['Int']['output'];
};

export type SchemaBmsTestAiKeyResult = {
  __typename?: 'BmsTestAiKeyResult';
  message: Scalars['String']['output'];
  ok: Scalars['Boolean']['output'];
};

export type SchemaBmsTestChannelResult = {
  __typename?: 'BmsTestChannelResult';
  message: Scalars['String']['output'];
  ok: Scalars['Boolean']['output'];
};

export type SchemaBmsTestEmailResult = {
  __typename?: 'BmsTestEmailResult';
  details: Array<Scalars['String']['output']>;
  message: Scalars['String']['output'];
  ok: Scalars['Boolean']['output'];
  sent: Scalars['Int']['output'];
};

export type SchemaBmsTierDeleteResult = {
  __typename?: 'BmsTierDeleteResult';
  deactivated: Scalars['Boolean']['output'];
  deleted: Scalars['Boolean']['output'];
};

export type SchemaBmsTierReviewResult = {
  __typename?: 'BmsTierReviewResult';
  changed: Scalars['Int']['output'];
  reviewed: Scalars['Int']['output'];
};

export type SchemaBmsTimelineEntry = {
  __typename?: 'BmsTimelineEntry';
  at: Scalars['String']['output'];
  channel: Maybe<Scalars['String']['output']>;
  entityId: Maybe<Scalars['ID']['output']>;
  ref: Maybe<Scalars['String']['output']>;
  status: Maybe<Scalars['String']['output']>;
  statusAt: Maybe<Scalars['String']['output']>;
  text: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export type SchemaBmsTopCoupon = {
  __typename?: 'BmsTopCoupon';
  code: Scalars['String']['output'];
  discount: Scalars['Float']['output'];
  redemptions: Scalars['Int']['output'];
  usages: Array<SchemaBmsCouponRedemption>;
};

export type SchemaBmsTopCustomer = {
  __typename?: 'BmsTopCustomer';
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  orders: Scalars['Int']['output'];
  spent: Scalars['Float']['output'];
  tags: Array<Scalars['String']['output']>;
};

export type SchemaBmsTopProduct = {
  __typename?: 'BmsTopProduct';
  name: Scalars['String']['output'];
  qty: Scalars['Int']['output'];
  revenue: Scalars['Float']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsUnreviewedProduct = {
  __typename?: 'BmsUnreviewedProduct';
  name: Scalars['String']['output'];
  policyStatus: Scalars['String']['output'];
  sku: Scalars['String']['output'];
};

export type SchemaBmsUpdateSupportTicketInput = {
  comment: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
  status: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsUpsertReportSubscriptionInput = {
  emailEnabled: InputMaybe<Scalars['Boolean']['input']>;
  enabled: InputMaybe<Scalars['Boolean']['input']>;
  frequency: InputMaybe<Scalars['String']['input']>;
  lineEnabled: InputMaybe<Scalars['Boolean']['input']>;
  lineUserId: InputMaybe<Scalars['String']['input']>;
  recipientEmail: InputMaybe<Scalars['String']['input']>;
  sendDayOfMonth: InputMaybe<Scalars['Int']['input']>;
  sendHour: InputMaybe<Scalars['Int']['input']>;
  sendWeekday: InputMaybe<Scalars['Int']['input']>;
  slackEnabled: InputMaybe<Scalars['Boolean']['input']>;
  slackWebhookUrl: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsUsage = {
  __typename?: 'BmsUsage';
  channels: Scalars['Int']['output'];
  orders_month: Scalars['Int']['output'];
  products: Scalars['Int']['output'];
  users: Scalars['Int']['output'];
};

export type SchemaBmsVariant = {
  __typename?: 'BmsVariant';
  available: Scalars['Int']['output'];
  /** BASE pack ของไซซ์นี้ ใช้แก้ราคาโดยไม่สร้างแถวซ้ำ */
  basePackId: Maybe<Scalars['ID']['output']>;
  branchCode: Maybe<Scalars['String']['output']>;
  current_stock: Scalars['Int']['output'];
  inTransitQty: Scalars['Int']['output'];
  locationId: Maybe<Scalars['ID']['output']>;
  locationName: Maybe<Scalars['String']['output']>;
  low: Scalars['Boolean']['output'];
  /** ราคาขายจริงของไซซ์นี้ (fallback เป็นราคาหลักของสินค้า) */
  price: Maybe<Scalars['Float']['output']>;
  /** null = ไซซ์นี้ใช้ราคาหลักของสินค้า */
  priceOverride: Maybe<Scalars['Float']['output']>;
  quarantine_stock: Scalars['Int']['output'];
  reorder_point: Scalars['Int']['output'];
  reserved_stock: Scalars['Int']['output'];
  size: Scalars['String']['output'];
  transferLostQty: Scalars['Int']['output'];
};

export type SchemaBmsVariantReservationOrder = {
  __typename?: 'BmsVariantReservationOrder';
  branchCode: Maybe<Scalars['String']['output']>;
  channel: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  customerName: Maybe<Scalars['String']['output']>;
  customerPhone: Maybe<Scalars['String']['output']>;
  customerRef: Maybe<Scalars['String']['output']>;
  /** ไม่ null = ของถูกจองไว้เพราะมัดจำที่ยังไม่ปิด (9.0) */
  depositStatus: Maybe<Scalars['String']['output']>;
  locationName: Maybe<Scalars['String']['output']>;
  orderId: Scalars['ID']['output'];
  qty: Scalars['Int']['output'];
  /** ไซซ์ที่บิลนี้ถืออยู่ — หนึ่งแถวต่อ (บิล × ไซซ์) */
  size: Scalars['String']['output'];
  status: Scalars['String']['output'];
  /** ไม่ว่าง = บิลนี้ถือของผ่านเซ็ต ของถูกจองที่ส่วนประกอบ (8.8) · เป็นลิสต์เพราะบิลเดียวมีได้หลายเซ็ต */
  viaBundleSkus: Array<Scalars['String']['output']>;
};

export type SchemaBmsVariantReservations = {
  __typename?: 'BmsVariantReservations';
  /** ยอดที่อธิบายได้จากบิลที่ยังถือของอยู่ (PENDING/PAID/PACKING) */
  attributedTotal: Scalars['Int']['output'];
  /** จำนวนแถว (บิล × ไซซ์) ทั้งหมด — มากกว่าความยาว orders เมื่อรายการถูกตัดที่เพดาน */
  lineCount: Scalars['Int']['output'];
  /** จำนวนบิลทั้งหมด (นับหัวบิล) */
  orderCount: Scalars['Int']['output'];
  orders: Array<SchemaBmsVariantReservationOrder>;
  /** attributedTotal - reservedTotal — บิลถือรวมกันมากกว่ายอดจองในตาราง (ข้อมูลไม่ตรงกัน) */
  overAttributed: Scalars['Int']['output'];
  /** ยอดจองจริงในตาราง รวมทุกสาขา */
  reservedTotal: Scalars['Int']['output'];
  /** null = ถามรวมทุกไซซ์ของ SKU นี้ */
  size: Maybe<Scalars['String']['output']>;
  sku: Scalars['String']['output'];
  /** reservedTotal - attributedTotal — จองค้างที่ไม่มีบิลเป็นเจ้าของ */
  unattributed: Scalars['Int']['output'];
};

export type SchemaBmsVerifyShopSignupResult = {
  __typename?: 'BmsVerifyShopSignupResult';
  slug: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  tenantId: Maybe<Scalars['ID']['output']>;
};

export type SchemaBmsWorkAssistantInput = {
  currentPath: InputMaybe<Scalars['String']['input']>;
  history: InputMaybe<Array<SchemaBmsAssistantTurn>>;
  locale: InputMaybe<Scalars['String']['input']>;
  message: Scalars['String']['input'];
  pageId: InputMaybe<Scalars['String']['input']>;
};

export type SchemaBmsWorkAssistantResult = {
  __typename?: 'BmsWorkAssistantResult';
  answerType: Scalars['String']['output'];
  citations: Array<SchemaBmsAssistantCitation>;
  links: Array<SchemaBmsAssistantLink>;
  proposals: Array<SchemaBmsAssistantProposal>;
  reply: Scalars['String']['output'];
  trace: Array<SchemaBmsAssistantTrace>;
};

export type SchemaBookmark = {
  __typename?: 'Bookmark';
  user_id: Scalars['ID']['output'];
};

export type SchemaBookmarkAction =
  | 'BOOKMARK'
  | 'UNBOOKMARK';

export type SchemaBookmarkTargetType =
  | 'POST';

export type SchemaCallHistoryLog = {
  __typename?: 'CallHistoryLog';
  action: Scalars['String']['output'];
  created_at: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  matched_by: Maybe<Scalars['String']['output']>;
  normalized_number: Scalars['String']['output'];
  source: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export type SchemaChat = {
  __typename?: 'Chat';
  created_at: Scalars['String']['output'];
  created_by: Maybe<SchemaUser>;
  id: Scalars['ID']['output'];
  is_group: Scalars['Boolean']['output'];
  is_undeletable: Scalars['Boolean']['output'];
  last_message: Maybe<SchemaMessage>;
  last_message_at: Maybe<Scalars['String']['output']>;
  members: Array<SchemaUser>;
  name: Maybe<Scalars['String']['output']>;
};

export type SchemaChatMemberSettings = {
  __typename?: 'ChatMemberSettings';
  is_muted: Scalars['Boolean']['output'];
  notifications_enabled: Scalars['Boolean']['output'];
};

export type SchemaComment = {
  __typename?: 'Comment';
  content: Scalars['String']['output'];
  created_at: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  parent_id: Maybe<Scalars['ID']['output']>;
  post_id: Scalars['ID']['output'];
  replies: Array<SchemaComment>;
  updated_at: Scalars['String']['output'];
  user: SchemaUser;
  user_id: Scalars['ID']['output'];
};

export type SchemaContactSpamMark = {
  __typename?: 'ContactSpamMark';
  action: Scalars['String']['output'];
  active: Scalars['Boolean']['output'];
  contact_name: Maybe<Scalars['String']['output']>;
  phone_normalized: Scalars['String']['output'];
  source: Maybe<SchemaContactSpamMarkSource>;
  updated_at: Scalars['String']['output'];
  user_id: Scalars['ID']['output'];
};

export type SchemaContactSpamMarkSource =
  | 'AUTO'
  | 'MANUAL'
  | 'SUGGESTED';

export type SchemaContactSpamProtectionMode =
  | 'AUTO'
  | 'OFF'
  | 'PROMPT';

export type SchemaContactSpamProtectionSettings = {
  __typename?: 'ContactSpamProtectionSettings';
  auto_mark_enabled: Scalars['Boolean']['output'];
  mode: SchemaContactSpamProtectionMode;
  risk_threshold: Scalars['Int']['output'];
  sync_enabled: Scalars['Boolean']['output'];
  updated_at: Scalars['String']['output'];
  user_id: Scalars['ID']['output'];
};

export type SchemaContactSpamProtectionSettingsInput = {
  auto_mark_enabled: Scalars['Boolean']['input'];
  mode: SchemaContactSpamProtectionMode;
  risk_threshold: Scalars['Int']['input'];
  sync_enabled: Scalars['Boolean']['input'];
};

export type SchemaCreateRoleInput = {
  description: InputMaybe<Scalars['String']['input']>;
  is_active: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
};

export type SchemaDashboardPost = {
  __typename?: 'DashboardPost';
  created_at: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  status: Maybe<Scalars['String']['output']>;
  title: Maybe<Scalars['String']['output']>;
};

export type SchemaDashboardUser = {
  __typename?: 'DashboardUser';
  avatar: Maybe<Scalars['String']['output']>;
  created_at: Maybe<Scalars['String']['output']>;
  email: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  name: Maybe<Scalars['String']['output']>;
  role: Maybe<Scalars['String']['output']>;
};

export type SchemaFile = {
  __typename?: 'File';
  created_at: Scalars['String']['output'];
  filename: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  mimetype: Maybe<Scalars['String']['output']>;
  original_name: Maybe<Scalars['String']['output']>;
  relpath: Scalars['String']['output'];
  size: Scalars['Int']['output'];
  thumb: Maybe<Scalars['String']['output']>;
  updated_at: Scalars['String']['output'];
  url: Scalars['String']['output'];
};

export type SchemaFileConnection = {
  __typename?: 'FileConnection';
  items: Array<SchemaFile>;
  total: Scalars['Int']['output'];
};

export type SchemaGlobalSearchResult = {
  __typename?: 'GlobalSearchResult';
  bank_accounts: Array<SchemaSearchBankAccountResult>;
  phones: Array<SchemaSearchPhoneReportResult>;
  posts: Array<SchemaSearchPostResult>;
  users: Array<SchemaSearchUserResult>;
};

export type SchemaImage = {
  __typename?: 'Image';
  id: Scalars['ID']['output'];
  url: Scalars['String']['output'];
};

export type SchemaLogCallInput = {
  action: Scalars['String']['input'];
  created_at: InputMaybe<Scalars['String']['input']>;
  matched_by: InputMaybe<Scalars['String']['input']>;
  normalized_number: Scalars['String']['input'];
  source: Scalars['String']['input'];
  type: Scalars['String']['input'];
};

export type SchemaLoginInput = {
  email: InputMaybe<Scalars['String']['input']>;
  password: Scalars['String']['input'];
  username: InputMaybe<Scalars['String']['input']>;
};

export type SchemaLoginResult = {
  __typename?: 'LoginResult';
  message: Maybe<Scalars['String']['output']>;
  ok: Scalars['Boolean']['output'];
  token: Maybe<Scalars['String']['output']>;
  user: Maybe<SchemaUser>;
};

export type SchemaMeInput = {
  email: InputMaybe<Scalars['String']['input']>;
  gender: InputMaybe<Scalars['String']['input']>;
  language: InputMaybe<Scalars['String']['input']>;
  name: InputMaybe<Scalars['String']['input']>;
  notifications_enabled: InputMaybe<Scalars['Boolean']['input']>;
  phone: InputMaybe<Scalars['String']['input']>;
  themePreference: InputMaybe<Scalars['String']['input']>;
  username: InputMaybe<Scalars['String']['input']>;
};

export type SchemaMessage = {
  __typename?: 'Message';
  audio: Maybe<SchemaMessageAudio>;
  chat_id: Scalars['ID']['output'];
  created_at: Scalars['String']['output'];
  deleted_at: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  images: Array<SchemaMessageImage>;
  is_deleted: Scalars['Boolean']['output'];
  location: Maybe<SchemaMessageLocation>;
  myReceipt: SchemaMessageReceipt;
  readers: Array<SchemaUser>;
  readersCount: Scalars['Int']['output'];
  reply_to: Maybe<SchemaMessage>;
  reply_to_id: Maybe<Scalars['ID']['output']>;
  sender: Maybe<SchemaUser>;
  text: Scalars['String']['output'];
  to_user_ids: Array<Scalars['ID']['output']>;
  type: Scalars['String']['output'];
};

export type SchemaMessageAudio = {
  __typename?: 'MessageAudio';
  duration_sec: Maybe<Scalars['Int']['output']>;
  file_id: Scalars['ID']['output'];
  mime: Maybe<Scalars['String']['output']>;
  url: Scalars['String']['output'];
};

export type SchemaMessageConnection = {
  __typename?: 'MessageConnection';
  hasMore: Scalars['Boolean']['output'];
  items: Array<SchemaMessage>;
  nextCursor: Maybe<Scalars['String']['output']>;
};

export type SchemaMessageImage = {
  __typename?: 'MessageImage';
  file_id: Scalars['ID']['output'];
  height: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  mime: Maybe<Scalars['String']['output']>;
  url: Scalars['String']['output'];
  width: Maybe<Scalars['Int']['output']>;
};

export type SchemaMessageLocation = {
  __typename?: 'MessageLocation';
  googleMapsUrl: Scalars['String']['output'];
  latitude: Scalars['Float']['output'];
  longitude: Scalars['Float']['output'];
  placeName: Maybe<Scalars['String']['output']>;
};

export type SchemaMessageLocationInput = {
  googleMapsUrl: InputMaybe<Scalars['String']['input']>;
  latitude: Scalars['Float']['input'];
  longitude: Scalars['Float']['input'];
  placeName: InputMaybe<Scalars['String']['input']>;
};

export type SchemaMessageReceipt = {
  __typename?: 'MessageReceipt';
  deliveredAt: Scalars['String']['output'];
  isRead: Scalars['Boolean']['output'];
  readAt: Maybe<Scalars['String']['output']>;
};

export type SchemaMutation = {
  __typename?: 'Mutation';
  addComment: SchemaComment;
  addMember: Scalars['Boolean']['output'];
  blockNumber: SchemaPhoneCenterActionPayload;
  blockPhone: SchemaBlockPhonePayload;
  bmsAddConversationHelper: Scalars['Boolean']['output'];
  bmsAddConversationNote: Maybe<SchemaBmsConversationNote>;
  bmsAddCustomerAddress: SchemaBmsCustomerAddress;
  bmsAdjustAiCredits: Scalars['Boolean']['output'];
  bmsAdjustLoyaltyPoints: SchemaBmsLoyaltyBalance;
  bmsAdjustStock: SchemaBmsVariant;
  bmsApplyStockCount: SchemaBmsMobileStockCountActionResult;
  bmsApproveAssessment: SchemaBmsPharmacyAssessment;
  /** ปิดใช้งาน ไม่ใช่ลบ — force = ปิดทั้งที่ยังมีสินค้าเปิดขายผูกอยู่ */
  bmsArchiveKitchenStation: SchemaBmsKitchenStation;
  bmsAssignConversation: Scalars['Boolean']['output'];
  bmsAssignCouponToCustomer: Scalars['Boolean']['output'];
  bmsAssignPharmacist: SchemaBmsPharmacyAssessment;
  bmsAssistant: SchemaBmsAssistantResult;
  bmsBackfillEtaxQueue: Scalars['Int']['output'];
  bmsBookShipmentLive: SchemaBmsCarrierBookingResult;
  bmsCancelOrder: Scalars['Boolean']['output'];
  bmsCancelPurchaseOrder: Scalars['Boolean']['output'];
  bmsCancelRestockSubscription: Scalars['Boolean']['output'];
  bmsCancelShipment: Scalars['Boolean']['output'];
  bmsCancelStockCount: SchemaBmsMobileStockCountActionResult;
  bmsCancelStockTransfer: SchemaBmsMobileStockTransferActionResult;
  bmsChangePlan: Scalars['Boolean']['output'];
  bmsCheckAllAiProviderHealth: Array<SchemaBmsAiProviderHealth>;
  bmsClearKitchenStationSla: Scalars['Boolean']['output'];
  bmsClosePosShift: SchemaBmsCloseShiftResult;
  bmsCommissionRule: SchemaBmsMobileCommissionRuleActionResult;
  bmsCompleteOrder: Scalars['Boolean']['output'];
  bmsConfirmPayment: SchemaBmsPaymentResult;
  bmsCreateInboxDiagnosticMessage: SchemaBmsInboxDiagnosticMessageResult;
  bmsCreateKitchenStation: SchemaBmsKitchenStation;
  bmsCreateOrder: SchemaBmsReorderResult;
  bmsCreatePharmacyLabOrder: SchemaBmsReorderResult;
  bmsCreateProductCategory: SchemaBmsProductCategory;
  bmsCreatePurchaseOrder: SchemaBmsPurchaseResult;
  bmsCreateRestaurantArea: SchemaBmsRestaurantArea;
  bmsCreateRestaurantTable: SchemaBmsRestaurantTableAdmin;
  bmsCreateShipment: SchemaBmsShipmentResult;
  bmsCreateStockCount: SchemaBmsMobileStockCountActionResult;
  bmsCreateStockTransfer: SchemaBmsMobileStockTransferActionResult;
  bmsDeactivateProductPromotion: Scalars['Boolean']['output'];
  bmsDeleteCoupon: Scalars['Boolean']['output'];
  bmsDeleteCustomer: Scalars['Boolean']['output'];
  bmsDeleteCustomerAddress: Scalars['Boolean']['output'];
  bmsDeleteFollowupRule: Scalars['Boolean']['output'];
  bmsDeleteMembershipTier: SchemaBmsTierDeleteResult;
  bmsDeleteProductCategory: Scalars['Boolean']['output'];
  bmsDeleteProductPack: Scalars['Boolean']['output'];
  bmsDeleteRestaurantArea: Scalars['Boolean']['output'];
  bmsDeleteRestaurantTable: Scalars['Boolean']['output'];
  bmsDeleteTenant: Scalars['Boolean']['output'];
  bmsDismissAiQualityCase: SchemaBmsAiQualityCaseDetail;
  bmsDuplicateProduct: SchemaBmsProductDuplicateResult;
  bmsEditAssessmentSummary: SchemaBmsPharmacyAssessment;
  bmsEditPharmacistDecisionNotes: SchemaBmsPharmacyAssessment;
  bmsEmailReport: SchemaBmsEmailReportResult;
  bmsEmitInboxDiagnosticEvent: SchemaBmsInboxDiagnosticEventResult;
  bmsEnrollMember: SchemaBmsEnrollMemberResult;
  bmsEnterTenant: Scalars['Boolean']['output'];
  bmsEscalateAssessmentToEmergency: SchemaBmsPharmacyAssessment;
  bmsExitTenant: Scalars['Boolean']['output'];
  bmsExpireLoyaltyPoints: SchemaBmsLoyaltyExpireResult;
  bmsGenerateInStoreBarcode: Scalars['String']['output'];
  bmsGenerateMedicationSuggestions: SchemaBmsPharmacyAssessment;
  bmsGenerateReport: SchemaBmsGenerateReportResult;
  bmsImportProducts: SchemaBmsProductImportResult;
  bmsIssueFullTaxInvoice: SchemaBmsIssueFullTaxInvoiceResult;
  bmsIssuePosDeviceToken: SchemaBmsPosDeviceToken;
  bmsIssueRestaurantTableQr: SchemaBmsRestaurantTableQr;
  bmsIssueStoreCredit: SchemaBmsMobileStoreCreditActionResult;
  bmsManualFillAssessmentFields: SchemaBmsPharmacyAssessment;
  bmsMarkAllMentionsRead: Scalars['Boolean']['output'];
  bmsMarkConversationRead: Scalars['Boolean']['output'];
  bmsMarkMentionRead: Scalars['Boolean']['output'];
  bmsMergeCustomers: Scalars['Boolean']['output'];
  bmsOpenPosShift: SchemaBmsOpenShiftResult;
  bmsPackOrder: Scalars['Boolean']['output'];
  bmsPayOrder: Scalars['Boolean']['output'];
  /** แนบหลักฐานทางคลินิกจากหน้าคิว (เภสัชกร) — รูปอัปโหลดผ่าน REST ไม่ผ่าน GraphQL */
  bmsPharmacyAddClinicalEvidence: SchemaBmsPharmacyClinicalEvidence;
  bmsPharmacyAssistantTest: SchemaBmsPharmacyAssistantResult;
  /** ลบหลักฐาน (soft delete — ยังตรวจย้อนได้ว่าใครลบ) */
  bmsPharmacyDeleteClinicalEvidence: Scalars['Boolean']['output'];
  bmsPosBlindReturn: SchemaBmsPosReturnActionResult;
  bmsPosCashMovement: SchemaBmsPosCashMovementActionResult;
  bmsPosCollectAr: SchemaBmsPosArReceiptResult;
  bmsPosCompleteRefund: SchemaBmsPosCompleteRefundResult;
  bmsPosDeposit: SchemaBmsPosDepositActionResult;
  bmsPosEnrollMember: SchemaBmsPosEnrollMemberResult;
  bmsPosExpense: SchemaBmsPosExpenseActionResult;
  bmsPosKitchenTicketStatus: SchemaBmsPosKitchenTicketActionResult;
  bmsPosKitchenTicketsStatus: SchemaBmsPosKitchenTicketsActionResult;
  bmsPosNoSale: SchemaBmsPosSimpleActionResult;
  bmsPosPark: SchemaBmsPosParkActionResult;
  bmsPosReceivePurchase: SchemaBmsPurchaseResult;
  bmsPosRequestPharmacyReview: SchemaBmsPosPharmacyReviewResult;
  bmsPosRestaurantAcceptIncomingOrder: SchemaBmsPosRestaurantIncomingActionResult;
  bmsPosRestaurantAcceptQrSubmission: SchemaBmsPosRestaurantQrActionResult;
  bmsPosRestaurantAcknowledgeServiceCall: SchemaBmsPosRestaurantServiceCallActionResult;
  bmsPosRestaurantAddCheckItem: SchemaBmsPosRestaurantCheckActionResult;
  bmsPosRestaurantAddWaitlistEntry: SchemaBmsPosRestaurantWaitlistActionResult;
  bmsPosRestaurantCallWaitlistEntry: SchemaBmsPosRestaurantWaitlistActionResult;
  bmsPosRestaurantCancelCheck: SchemaBmsPosRestaurantCheckActionResult;
  bmsPosRestaurantCancelOrderLines: SchemaBmsPosRestaurantIncomingActionResult;
  bmsPosRestaurantCancelRequest: SchemaBmsPosRestaurantRequestActionResult;
  bmsPosRestaurantCancelWaitlistEntry: SchemaBmsPosRestaurantWaitlistActionResult;
  /** @deprecated Use the named restaurant check mutations */
  bmsPosRestaurantCheckAction: SchemaBmsPosRestaurantCheckActionResult;
  bmsPosRestaurantCompleteServiceCall: SchemaBmsPosRestaurantServiceCallActionResult;
  bmsPosRestaurantConfirmRequest: SchemaBmsPosRestaurantRequestActionResult;
  bmsPosRestaurantContactRequest: SchemaBmsPosRestaurantRequestActionResult;
  bmsPosRestaurantFloorSetup: SchemaBmsPosRestaurantFloorResult;
  /** @deprecated Use the named incoming-order mutations */
  bmsPosRestaurantIncomingAction: SchemaBmsPosRestaurantIncomingActionResult;
  bmsPosRestaurantMenuAvailability: SchemaBmsPosMenuAvailabilityResult;
  bmsPosRestaurantMergeChecks: SchemaBmsPosRestaurantCheckActionResult;
  bmsPosRestaurantMoveCheck: SchemaBmsPosRestaurantCheckActionResult;
  bmsPosRestaurantNoShowWaitlistEntry: SchemaBmsPosRestaurantWaitlistActionResult;
  bmsPosRestaurantOpenCheck: SchemaBmsPosRestaurantOpenCheckResult;
  /** @deprecated Use the named QR-submission mutations */
  bmsPosRestaurantQrOrderAction: SchemaBmsPosRestaurantQrActionResult;
  bmsPosRestaurantRejectQrSubmission: SchemaBmsPosRestaurantQrActionResult;
  bmsPosRestaurantRemoveCheckItem: SchemaBmsPosRestaurantCheckActionResult;
  /** @deprecated Use bmsPosRestaurantRequests or a named request decision mutation */
  bmsPosRestaurantRequestAction: SchemaBmsPosRestaurantRequestActionResult;
  bmsPosRestaurantSeatWaitlistEntry: SchemaBmsPosRestaurantWaitlistActionResult;
  bmsPosRestaurantSendCheckToKitchen: SchemaBmsPosRestaurantCheckActionResult;
  /** @deprecated Use the named service-call mutations */
  bmsPosRestaurantServiceCallAction: SchemaBmsPosRestaurantServiceCallActionResult;
  bmsPosRestaurantSetCheckGuestCount: SchemaBmsPosRestaurantCheckActionResult;
  bmsPosRestaurantSetOrderingPaused: SchemaBmsPosRestaurantIncomingActionResult;
  bmsPosRestaurantSettleCheck: SchemaBmsPosRestaurantCheckActionResult;
  bmsPosRestaurantSplitCheck: SchemaBmsPosRestaurantCheckActionResult;
  /** @deprecated Use the named waitlist mutations */
  bmsPosRestaurantWaitlistAction: SchemaBmsPosRestaurantWaitlistActionResult;
  bmsPosReturn: SchemaBmsPosReturnActionResult;
  bmsPosSale: SchemaBmsPosSaleResult;
  bmsPosSendReceipt: SchemaBmsPosReceiptDeliveryResult;
  bmsPosShift: SchemaBmsPosShiftActionResult;
  bmsPosVerifyCashier: SchemaBmsPosCashier;
  bmsPosVoid: SchemaBmsPosReturnActionResult;
  bmsPublishProduct: SchemaBmsProductReadiness;
  bmsReceivePurchaseOrder: SchemaBmsPurchaseResult;
  bmsReceiveStockTransfer: SchemaBmsMobileStockTransferActionResult;
  /** รับชำระที่ไม่ใช่เงินสด · เงินสดต้องทำที่เครื่องขายเพื่อให้เข้าลิ้นชักของกะ */
  bmsRecordArReceipt: SchemaBmsArReceiptResult;
  bmsRecordInventoryDemand: Scalars['ID']['output'];
  bmsRecordInventoryWastage: SchemaBmsInventoryWastageResult;
  bmsRecordPharmacyConsent: SchemaBmsPharmacyAssessment;
  bmsRecordStockCountItem: SchemaBmsMobileStockCountActionResult;
  bmsReferAssessmentToDoctor: SchemaBmsPharmacyAssessment;
  bmsRefreshActions: Scalars['Int']['output'];
  bmsRefreshRetention: Scalars['Int']['output'];
  bmsRefundPayment: Scalars['Boolean']['output'];
  bmsRejectAssessment: SchemaBmsPharmacyAssessment;
  bmsRejectPayment: Scalars['Boolean']['output'];
  bmsRemoveAiKey: Scalars['Boolean']['output'];
  bmsRemoveConversationHelper: Scalars['Boolean']['output'];
  bmsRenameProductCategory: SchemaBmsProductCategory;
  bmsRenameRestaurantArea: SchemaBmsRestaurantArea;
  bmsReorderFromOrder: SchemaBmsReorderResult;
  bmsReorderRestaurantAreas: Array<SchemaBmsRestaurantArea>;
  bmsReplaceProductPriceTiers: Array<SchemaBmsProductPriceTier>;
  bmsRequestMoreInformation: SchemaBmsPharmacyAssessment;
  bmsResetStoreCapability: SchemaBmsStoreCapability;
  bmsRetryMessage: SchemaBmsSendResult;
  bmsReturnOrder: Scalars['Boolean']['output'];
  bmsReviewAiQualityCase: SchemaBmsAiQualityCaseDetail;
  bmsReviewAiSynonymCandidate: SchemaBmsAiSynonymCandidate;
  bmsReviewMemberTier: SchemaBmsTierReviewResult;
  bmsReviewPharmacyProductPolicy: SchemaBmsPharmacyProductPolicy;
  bmsReviewPharmacyProtocol: SchemaBmsPharmacyProtocol;
  bmsReviewRestaurantRequest: SchemaBmsMobileRestaurantRequestActionResult;
  bmsRunEtaxQueue: SchemaBmsEtaxRunResult;
  bmsRunFollowupsNow: SchemaBmsFollowupRunResult;
  bmsRunReadOnlySql: SchemaBmsSqlResult;
  bmsRunSandboxedJs: SchemaBmsJsConsoleResult;
  bmsRunSql: SchemaBmsSqlResult;
  bmsSaveRestaurantFloorLayout: Scalars['Boolean']['output'];
  bmsSeedPharmacyQueueDemo: SchemaBmsSeedPharmacyQueueDemoResult;
  bmsSendAllReadyRestockNotifications: SchemaBmsRestockSendAllResult;
  bmsSendMessage: SchemaBmsSendResult;
  bmsSendRestockNotification: SchemaBmsRestockSendResult;
  bmsSendStockTransfer: SchemaBmsMobileStockTransferActionResult;
  bmsSendTestEmail: SchemaBmsTestEmailResult;
  bmsSendTestReportNow: SchemaBmsSendReportResult;
  bmsSetAiKey: Scalars['Boolean']['output'];
  /** posOnly=true → บัญชีนี้ login เข้าหลังบ้านไม่ได้อีก ใช้ได้เฉพาะ PIN ที่เครื่องขาย */
  bmsSetCashierAccountMode: Scalars['Boolean']['output'];
  bmsSetCashierPin: Scalars['Boolean']['output'];
  bmsSetConversationStatus: Scalars['Boolean']['output'];
  bmsSetConversationTags: Scalars['Boolean']['output'];
  bmsSetCustomerTags: Scalars['Boolean']['output'];
  bmsSetDefaultCustomerAddress: SchemaBmsCustomerAddress;
  bmsSetMyAvailability: Scalars['Boolean']['output'];
  bmsSetPharmacistLicense: Scalars['Boolean']['output'];
  /** ตั้งค่าการอนุมัติของเภสัชกรที่เคาน์เตอร์ (9.29) — ไม่ส่งฟิลด์ไหน = ไม่แตะฟิลด์นั้น */
  bmsSetPharmacyCounterSettings: SchemaBmsPharmacyPolicyReadiness;
  bmsSetPharmacyProtocolEnabled: SchemaBmsPharmacyProtocol;
  bmsSetProductActive: Scalars['Boolean']['output'];
  bmsSetProductBundleItems: Array<SchemaBmsBundleItem>;
  bmsSetProductSalesSurfaces: Array<Scalars['String']['output']>;
  bmsSetReorderPoint: SchemaBmsVariant;
  bmsSetRolePermissions: Scalars['Boolean']['output'];
  bmsSetShipmentStatus: Scalars['Boolean']['output'];
  bmsSetTenantActive: Scalars['Boolean']['output'];
  bmsSetTenantPlan: Scalars['Boolean']['output'];
  bmsSetVatCategoryForUnknown: Scalars['Int']['output'];
  bmsShipOrder: Scalars['Boolean']['output'];
  bmsSignup: SchemaBmsSignupResult;
  bmsSoftDeleteAssessment: Scalars['Boolean']['output'];
  bmsStartPharmacistReview: SchemaBmsPharmacyAssessment;
  /** @deprecated Use the named stock-count mutations */
  bmsStockCount: SchemaBmsMobileStockCountActionResult;
  /** @deprecated Use the named stock-transfer mutations */
  bmsStockTransfer: SchemaBmsMobileStockTransferActionResult;
  bmsSubmitPayment: SchemaBmsPaymentResult;
  bmsSubmitPharmacyProductPolicyForReview: SchemaBmsPharmacyProductPolicy;
  bmsSubmitPharmacyProtocolForReview: SchemaBmsPharmacyProtocol;
  bmsSyncShipmentLive: SchemaBmsSyncShipmentLiveResult;
  bmsTestAiKey: SchemaBmsTestAiKeyResult;
  bmsTestChannel: SchemaBmsTestChannelResult;
  bmsTestPlatformAiKey: SchemaBmsTestAiKeyResult;
  bmsTransitionAction: SchemaBmsAction;
  bmsTransitionRetentionCase: SchemaBmsRetentionCase;
  bmsUpdateCustomerAddress: SchemaBmsCustomerAddress;
  bmsUpdateKitchenStation: SchemaBmsKitchenStation;
  bmsUpdateKitchenTicketStatus: SchemaBmsKitchenTicket;
  bmsUpdateKitchenTicketsStatus: Array<SchemaBmsKitchenTicket>;
  bmsUpdateLoyaltySettings: SchemaBmsLoyaltySettings;
  bmsUpdateMyTenant: SchemaBmsTenantInfo;
  bmsUpdateOnboardingProgress: SchemaBmsOnboardingProgress;
  bmsUpdateRestaurantTable: SchemaBmsRestaurantTableAdmin;
  bmsUpdateSupportTicket: SchemaBmsSupportTicket;
  bmsUpdateTaxSettings: SchemaBmsTaxSettings;
  bmsUpdateTracking: Scalars['Boolean']['output'];
  bmsUpsertArAccount: SchemaBmsArAccount;
  bmsUpsertChannel: Scalars['Boolean']['output'];
  bmsUpsertCoupon: SchemaBmsCoupon;
  bmsUpsertCustomer: SchemaBmsCustomer;
  bmsUpsertFollowupRule: SchemaBmsFollowupRule;
  bmsUpsertInventoryPolicy: Scalars['Boolean']['output'];
  bmsUpsertKitchenStationSla: SchemaBmsKitchenStationSla;
  bmsUpsertLocation: SchemaBmsLocation;
  bmsUpsertMembershipTier: SchemaBmsMembershipTier;
  bmsUpsertPharmacyProductPolicy: SchemaBmsPharmacyProductPolicy;
  bmsUpsertPharmacyProtocol: SchemaBmsPharmacyProtocol;
  bmsUpsertPosDevice: SchemaBmsPosDevice;
  bmsUpsertProduct: SchemaBmsProduct;
  bmsUpsertProductCatalogVariant: SchemaBmsProductCatalogVariant;
  bmsUpsertProductModifier: SchemaBmsProductModifier;
  /** pin ว่าง/null = ล้าง PIN ทำให้ขายหน้าร้านไม่ได้ */
  bmsUpsertProductPack: SchemaBmsProductPack;
  bmsUpsertProductPromotion: SchemaBmsProductPromotion;
  bmsUpsertProductRecipe: SchemaBmsProductRecipe;
  bmsUpsertProductStockPolicy: SchemaBmsProductStockPolicy;
  bmsUpsertReportSubscription: SchemaBmsReportSubscription;
  bmsUpsertStoreCapability: SchemaBmsStoreCapability;
  bmsUpsertStoreProfile: SchemaBmsStoreProfile;
  bmsVerifyPaymentSlip: Maybe<SchemaBmsSlipVerification>;
  bmsVerifyShopSignup: SchemaBmsVerifyShopSignupResult;
  bmsWorkAssistant: SchemaBmsWorkAssistantResult;
  bmsWriteOffArInvoice: SchemaBmsArWriteOffResult;
  bookmark: SchemaToggleBookmarkResult;
  clonePost: Scalars['String']['output'];
  createChat: SchemaChat;
  createRole: SchemaRole;
  createSupportTicket: SchemaSupportTicketPayload;
  deleteChat: Scalars['Boolean']['output'];
  deleteComment: Scalars['Boolean']['output'];
  deleteFile: Scalars['Boolean']['output'];
  deleteFiles: Scalars['Boolean']['output'];
  deleteMessage: Scalars['Boolean']['output'];
  deletePost: Scalars['Boolean']['output'];
  deletePosts: Scalars['Boolean']['output'];
  deleteRole: Scalars['Boolean']['output'];
  deleteUser: Scalars['Boolean']['output'];
  deleteUsers: Scalars['Boolean']['output'];
  ingestCallLogs: Scalars['Boolean']['output'];
  login: SchemaLoginResult;
  loginAdmin: SchemaLoginResult;
  loginMobile: SchemaLoginResult;
  loginUser: SchemaLoginResult;
  loginWithSocial: SchemaLoginResult;
  markAllNotificationsRead: Scalars['Boolean']['output'];
  markChatReadUpTo: Scalars['Boolean']['output'];
  markContactSpamPhone: SchemaContactSpamMark;
  markMessageRead: Scalars['Boolean']['output'];
  markNotificationRead: Scalars['Boolean']['output'];
  registerPushToken: Scalars['Boolean']['output'];
  registerUser: Scalars['Boolean']['output'];
  renameChat: Scalars['Boolean']['output'];
  renameFile: Scalars['Boolean']['output'];
  replyComment: SchemaComment;
  reportBankAccount: SchemaScamBankAccount;
  reportNumber: SchemaPhoneCenterActionPayload;
  reportPhone: SchemaPhoneCenterActionPayload;
  reportScamBankAccount: SchemaScamBankAccount;
  reportScamPhone: SchemaScamPhone;
  reportSpam: Scalars['Boolean']['output'];
  requestPasswordReset: Maybe<Scalars['Boolean']['output']>;
  resetPassword: Maybe<Scalars['Boolean']['output']>;
  send: Scalars['Boolean']['output'];
  sendMessage: SchemaMessage;
  setRoleActive: SchemaRole;
  toggleBookmark: SchemaToggleBookmarkResult;
  unblockNumber: SchemaPhoneCenterActionPayload;
  unblockPhone: SchemaBlockPhonePayload;
  unblockScamPhone: SchemaScamPhone;
  unbookmark: SchemaToggleBookmarkResult;
  unmarkContactSpamPhone: SchemaContactSpamMark;
  unregisterPushToken: Scalars['Boolean']['output'];
  unreportScamBankAccount: SchemaScamBankAccount;
  updateComment: SchemaComment;
  updateMe: SchemaUser;
  updateMyChatSettings: SchemaChatMemberSettings;
  updateMyContactSpamProtectionSettings: SchemaContactSpamProtectionSettings;
  updateMyProfile: SchemaUser;
  updateRole: SchemaRole;
  uploadAvatar: Scalars['String']['output'];
  uploadDiagnostics: SchemaUploadDiagnosticsPayload;
  upsertPost: SchemaPost;
  upsertUser: SchemaUser;
  verifyEmail: SchemaBasicResponse;
};


export type SchemaMutationAddCommentArgs = {
  content: Scalars['String']['input'];
  post_id: Scalars['ID']['input'];
};


export type SchemaMutationAddMemberArgs = {
  chat_id: Scalars['ID']['input'];
  user_id: Scalars['ID']['input'];
};


export type SchemaMutationBlockNumberArgs = {
  phoneNumber: Scalars['String']['input'];
};


export type SchemaMutationBlockPhoneArgs = {
  input: SchemaBlockPhoneInput;
};


export type SchemaMutationBmsAddConversationHelperArgs = {
  id: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type SchemaMutationBmsAddConversationNoteArgs = {
  body: Scalars['String']['input'];
  id: Scalars['ID']['input'];
  mentionedUserIds: InputMaybe<Array<Scalars['ID']['input']>>;
};


export type SchemaMutationBmsAddCustomerAddressArgs = {
  address: Scalars['String']['input'];
  id: Scalars['ID']['input'];
  isDefault: InputMaybe<Scalars['Boolean']['input']>;
  label: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsAdjustAiCreditsArgs = {
  amount: Scalars['Int']['input'];
  note: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsAdjustLoyaltyPointsArgs = {
  customerId: Scalars['ID']['input'];
  note: Scalars['String']['input'];
  points: Scalars['Int']['input'];
};


export type SchemaMutationBmsAdjustStockArgs = {
  delta: Scalars['Int']['input'];
  locationId: Scalars['ID']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};


export type SchemaMutationBmsApplyStockCountArgs = {
  countId: Scalars['ID']['input'];
};


export type SchemaMutationBmsApproveAssessmentArgs = {
  assessmentId: Scalars['ID']['input'];
  expectedVersion: Scalars['Int']['input'];
  orderDraft: InputMaybe<Scalars['JSON']['input']>;
  pharmacistResponse: Scalars['String']['input'];
};


export type SchemaMutationBmsArchiveKitchenStationArgs = {
  force?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsAssignConversationArgs = {
  id: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type SchemaMutationBmsAssignCouponToCustomerArgs = {
  channel: InputMaybe<Scalars['String']['input']>;
  code: Scalars['String']['input'];
  conversationId: InputMaybe<Scalars['ID']['input']>;
  customerId: InputMaybe<Scalars['ID']['input']>;
  customerRef: InputMaybe<Scalars['String']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsAssignPharmacistArgs = {
  assessmentId: Scalars['ID']['input'];
  pharmacistUserId: Scalars['ID']['input'];
};


export type SchemaMutationBmsAssistantArgs = {
  history: InputMaybe<Array<SchemaBmsAssistantTurn>>;
  message: Scalars['String']['input'];
};


export type SchemaMutationBmsBackfillEtaxQueueArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaMutationBmsBookShipmentLiveArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsCancelOrderArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsCancelPurchaseOrderArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsCancelRestockSubscriptionArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsCancelShipmentArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsCancelStockCountArgs = {
  countId: Scalars['ID']['input'];
};


export type SchemaMutationBmsCancelStockTransferArgs = {
  transferId: Scalars['ID']['input'];
};


export type SchemaMutationBmsChangePlanArgs = {
  planCode: Scalars['String']['input'];
};


export type SchemaMutationBmsClearKitchenStationSlaArgs = {
  station: Scalars['String']['input'];
};


export type SchemaMutationBmsClosePosShiftArgs = {
  countedCash: Scalars['Float']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  shiftId: Scalars['ID']['input'];
};


export type SchemaMutationBmsCommissionRuleArgs = {
  input: SchemaBmsCommissionRuleInput;
};


export type SchemaMutationBmsCompleteOrderArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsConfirmPaymentArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsCreateInboxDiagnosticMessageArgs = {
  body: InputMaybe<Scalars['String']['input']>;
  channel: Scalars['String']['input'];
};


export type SchemaMutationBmsCreateKitchenStationArgs = {
  input: SchemaBmsKitchenStationInput;
};


export type SchemaMutationBmsCreateOrderArgs = {
  channel: InputMaybe<Scalars['String']['input']>;
  couponCode: InputMaybe<Scalars['String']['input']>;
  customerRef: InputMaybe<Scalars['String']['input']>;
  items: Array<SchemaBmsOrderItemInput>;
  locationId: InputMaybe<Scalars['ID']['input']>;
  preferredCarrier: InputMaybe<SchemaBmsCarrier>;
};


export type SchemaMutationBmsCreatePharmacyLabOrderArgs = {
  items: Array<SchemaBmsPharmacyLabCartItemInput>;
};


export type SchemaMutationBmsCreateProductCategoryArgs = {
  name: Scalars['String']['input'];
};


export type SchemaMutationBmsCreatePurchaseOrderArgs = {
  items: Array<SchemaBmsPurchaseItemInput>;
  note: InputMaybe<Scalars['String']['input']>;
  supplierId: InputMaybe<Scalars['ID']['input']>;
  supplierName: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsCreateRestaurantAreaArgs = {
  locationId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
};


export type SchemaMutationBmsCreateRestaurantTableArgs = {
  areaId: Scalars['ID']['input'];
  locationId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  seats: Scalars['Int']['input'];
  shape: Scalars['String']['input'];
};


export type SchemaMutationBmsCreateShipmentArgs = {
  carrier: SchemaBmsCarrier;
  note: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['ID']['input'];
  trackingNo: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsCreateStockCountArgs = {
  input: SchemaBmsCreateStockCountInput;
};


export type SchemaMutationBmsCreateStockTransferArgs = {
  input: SchemaBmsCreateStockTransferInput;
};


export type SchemaMutationBmsDeactivateProductPromotionArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsDeleteCouponArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsDeleteCustomerArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsDeleteCustomerAddressArgs = {
  addressId: Scalars['ID']['input'];
};


export type SchemaMutationBmsDeleteFollowupRuleArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsDeleteMembershipTierArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsDeleteProductCategoryArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsDeleteProductPackArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsDeleteRestaurantAreaArgs = {
  areaId: Scalars['ID']['input'];
};


export type SchemaMutationBmsDeleteRestaurantTableArgs = {
  tableId: Scalars['ID']['input'];
};


export type SchemaMutationBmsDeleteTenantArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SchemaMutationBmsDismissAiQualityCaseArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsDuplicateProductArgs = {
  sourceSku: Scalars['String']['input'];
  targetName: Scalars['String']['input'];
  targetSku: Scalars['String']['input'];
};


export type SchemaMutationBmsEditAssessmentSummaryArgs = {
  assessmentId: Scalars['ID']['input'];
  summaryText: Scalars['String']['input'];
};


export type SchemaMutationBmsEditPharmacistDecisionNotesArgs = {
  assessmentId: Scalars['ID']['input'];
  decisionNotes: Scalars['String']['input'];
  expectedVersion: Scalars['Int']['input'];
};


export type SchemaMutationBmsEmailReportArgs = {
  fileId: Scalars['Int']['input'];
  subject: InputMaybe<Scalars['String']['input']>;
  to: Scalars['String']['input'];
};


export type SchemaMutationBmsEmitInboxDiagnosticEventArgs = {
  channel: Scalars['String']['input'];
  probeId: Scalars['ID']['input'];
};


export type SchemaMutationBmsEnrollMemberArgs = {
  name: InputMaybe<Scalars['String']['input']>;
  phone: Scalars['String']['input'];
};


export type SchemaMutationBmsEnterTenantArgs = {
  tenantId: Scalars['ID']['input'];
};


export type SchemaMutationBmsEscalateAssessmentToEmergencyArgs = {
  assessmentId: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
};


export type SchemaMutationBmsGenerateMedicationSuggestionsArgs = {
  assessmentId: Scalars['ID']['input'];
};


export type SchemaMutationBmsGenerateReportArgs = {
  input: SchemaBmsGenerateReportInput;
};


export type SchemaMutationBmsImportProductsArgs = {
  commit?: InputMaybe<Scalars['Boolean']['input']>;
  items: Array<SchemaBmsProductImportRowInput>;
};


export type SchemaMutationBmsIssueFullTaxInvoiceArgs = {
  buyer: SchemaBmsTaxInvoiceBuyerInput;
  orderId: Scalars['ID']['input'];
};


export type SchemaMutationBmsIssuePosDeviceTokenArgs = {
  deviceId: Scalars['ID']['input'];
};


export type SchemaMutationBmsIssueRestaurantTableQrArgs = {
  rotate: InputMaybe<Scalars['Boolean']['input']>;
  tableId: Scalars['ID']['input'];
};


export type SchemaMutationBmsIssueStoreCreditArgs = {
  input: SchemaBmsIssueStoreCreditInput;
};


export type SchemaMutationBmsManualFillAssessmentFieldsArgs = {
  assessmentId: Scalars['ID']['input'];
  fields: Scalars['JSON']['input'];
};


export type SchemaMutationBmsMarkConversationReadArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsMarkMentionReadArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsMergeCustomersArgs = {
  keepId: Scalars['ID']['input'];
  mergeId: Scalars['ID']['input'];
};


export type SchemaMutationBmsOpenPosShiftArgs = {
  deviceId: Scalars['ID']['input'];
  openingFloat?: InputMaybe<Scalars['Float']['input']>;
  pharmacistUserId: InputMaybe<Scalars['ID']['input']>;
};


export type SchemaMutationBmsPackOrderArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsPayOrderArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsPharmacyAddClinicalEvidenceArgs = {
  assessmentId: Scalars['ID']['input'];
  kind: Scalars['String']['input'];
  textValue: Scalars['String']['input'];
};


export type SchemaMutationBmsPharmacyAssistantTestArgs = {
  message: Scalars['String']['input'];
  session: InputMaybe<SchemaBmsPharmacyAssistantSessionInput>;
};


export type SchemaMutationBmsPharmacyDeleteClinicalEvidenceArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsPosBlindReturnArgs = {
  input: SchemaBmsPosBlindReturnInput;
};


export type SchemaMutationBmsPosCashMovementArgs = {
  input: SchemaBmsPosCashMovementInput;
};


export type SchemaMutationBmsPosCollectArArgs = {
  input: SchemaBmsPosCollectArInput;
};


export type SchemaMutationBmsPosCompleteRefundArgs = {
  input: SchemaBmsPosCompleteRefundInput;
};


export type SchemaMutationBmsPosDepositArgs = {
  input: SchemaBmsPosDepositInput;
};


export type SchemaMutationBmsPosEnrollMemberArgs = {
  input: SchemaBmsPosEnrollMemberInput;
};


export type SchemaMutationBmsPosExpenseArgs = {
  input: SchemaBmsPosExpenseInput;
};


export type SchemaMutationBmsPosKitchenTicketStatusArgs = {
  input: SchemaBmsPosKitchenTicketStatusInput;
};


export type SchemaMutationBmsPosKitchenTicketsStatusArgs = {
  input: SchemaBmsPosKitchenTicketsStatusInput;
};


export type SchemaMutationBmsPosNoSaleArgs = {
  input: SchemaBmsPosNoSaleInput;
};


export type SchemaMutationBmsPosParkArgs = {
  input: SchemaBmsPosParkInput;
};


export type SchemaMutationBmsPosReceivePurchaseArgs = {
  input: SchemaBmsPosReceivePurchaseInput;
};


export type SchemaMutationBmsPosRequestPharmacyReviewArgs = {
  input: SchemaBmsPosRequestPharmacyReviewInput;
};


export type SchemaMutationBmsPosRestaurantAcceptIncomingOrderArgs = {
  input: SchemaBmsPosRestaurantAcceptIncomingOrderInput;
};


export type SchemaMutationBmsPosRestaurantAcceptQrSubmissionArgs = {
  input: SchemaBmsPosRestaurantQrSubmissionInput;
};


export type SchemaMutationBmsPosRestaurantAcknowledgeServiceCallArgs = {
  input: SchemaBmsPosRestaurantServiceCallInput;
};


export type SchemaMutationBmsPosRestaurantAddCheckItemArgs = {
  checkId: Scalars['ID']['input'];
  input: SchemaBmsPosRestaurantAddCheckItemInput;
};


export type SchemaMutationBmsPosRestaurantAddWaitlistEntryArgs = {
  input: SchemaBmsPosRestaurantAddWaitlistInput;
};


export type SchemaMutationBmsPosRestaurantCallWaitlistEntryArgs = {
  input: SchemaBmsPosRestaurantWaitlistEntryInput;
};


export type SchemaMutationBmsPosRestaurantCancelCheckArgs = {
  checkId: Scalars['ID']['input'];
  input: SchemaBmsPosRestaurantCancelCheckInput;
};


export type SchemaMutationBmsPosRestaurantCancelOrderLinesArgs = {
  input: SchemaBmsPosRestaurantCancelOrderLinesInput;
};


export type SchemaMutationBmsPosRestaurantCancelRequestArgs = {
  input: SchemaBmsPosRestaurantRequestDecisionInput;
};


export type SchemaMutationBmsPosRestaurantCancelWaitlistEntryArgs = {
  input: SchemaBmsPosRestaurantCloseWaitlistInput;
};


export type SchemaMutationBmsPosRestaurantCheckActionArgs = {
  checkId: Scalars['ID']['input'];
  input: SchemaBmsPosRestaurantCheckActionInput;
};


export type SchemaMutationBmsPosRestaurantCompleteServiceCallArgs = {
  input: SchemaBmsPosRestaurantServiceCallInput;
};


export type SchemaMutationBmsPosRestaurantConfirmRequestArgs = {
  input: SchemaBmsPosRestaurantRequestDecisionInput;
};


export type SchemaMutationBmsPosRestaurantContactRequestArgs = {
  input: SchemaBmsPosRestaurantRequestDecisionInput;
};


export type SchemaMutationBmsPosRestaurantFloorSetupArgs = {
  input: SchemaBmsPosRestaurantFloorSetupInput;
};


export type SchemaMutationBmsPosRestaurantIncomingActionArgs = {
  input: SchemaBmsPosRestaurantIncomingActionInput;
};


export type SchemaMutationBmsPosRestaurantMenuAvailabilityArgs = {
  input: SchemaBmsPosRestaurantMenuAvailabilityInput;
};


export type SchemaMutationBmsPosRestaurantMergeChecksArgs = {
  checkId: Scalars['ID']['input'];
  input: SchemaBmsPosRestaurantMergeChecksInput;
};


export type SchemaMutationBmsPosRestaurantMoveCheckArgs = {
  checkId: Scalars['ID']['input'];
  input: SchemaBmsPosRestaurantMoveCheckInput;
};


export type SchemaMutationBmsPosRestaurantNoShowWaitlistEntryArgs = {
  input: SchemaBmsPosRestaurantCloseWaitlistInput;
};


export type SchemaMutationBmsPosRestaurantOpenCheckArgs = {
  input: SchemaBmsPosRestaurantOpenCheckInput;
};


export type SchemaMutationBmsPosRestaurantQrOrderActionArgs = {
  input: SchemaBmsPosRestaurantQrOrderActionInput;
};


export type SchemaMutationBmsPosRestaurantRejectQrSubmissionArgs = {
  input: SchemaBmsPosRestaurantRejectQrSubmissionInput;
};


export type SchemaMutationBmsPosRestaurantRemoveCheckItemArgs = {
  checkId: Scalars['ID']['input'];
  credentials: SchemaBmsPosRestaurantCheckCredentialsInput;
  itemId: Scalars['ID']['input'];
};


export type SchemaMutationBmsPosRestaurantRequestActionArgs = {
  input: SchemaBmsPosRestaurantRequestActionInput;
};


export type SchemaMutationBmsPosRestaurantSeatWaitlistEntryArgs = {
  input: SchemaBmsPosRestaurantSeatWaitlistInput;
};


export type SchemaMutationBmsPosRestaurantSendCheckToKitchenArgs = {
  checkId: Scalars['ID']['input'];
  credentials: SchemaBmsPosRestaurantCheckCredentialsInput;
};


export type SchemaMutationBmsPosRestaurantServiceCallActionArgs = {
  input: SchemaBmsPosRestaurantServiceCallActionInput;
};


export type SchemaMutationBmsPosRestaurantSetCheckGuestCountArgs = {
  checkId: Scalars['ID']['input'];
  input: SchemaBmsPosRestaurantSetGuestCountInput;
};


export type SchemaMutationBmsPosRestaurantSetOrderingPausedArgs = {
  input: SchemaBmsPosRestaurantSetOrderingPausedInput;
};


export type SchemaMutationBmsPosRestaurantSettleCheckArgs = {
  checkId: Scalars['ID']['input'];
  input: SchemaBmsPosRestaurantSettleCheckInput;
};


export type SchemaMutationBmsPosRestaurantSplitCheckArgs = {
  checkId: Scalars['ID']['input'];
  input: SchemaBmsPosRestaurantSplitCheckInput;
};


export type SchemaMutationBmsPosRestaurantWaitlistActionArgs = {
  input: SchemaBmsPosRestaurantWaitlistActionInput;
};


export type SchemaMutationBmsPosReturnArgs = {
  input: SchemaBmsPosReturnInput;
};


export type SchemaMutationBmsPosSaleArgs = {
  input: SchemaBmsPosSaleInput;
};


export type SchemaMutationBmsPosSendReceiptArgs = {
  input: SchemaBmsPosSendReceiptInput;
};


export type SchemaMutationBmsPosShiftArgs = {
  input: SchemaBmsPosShiftInput;
};


export type SchemaMutationBmsPosVerifyCashierArgs = {
  input: SchemaBmsPosCredentialsInput;
};


export type SchemaMutationBmsPosVoidArgs = {
  input: SchemaBmsPosVoidInput;
};


export type SchemaMutationBmsPublishProductArgs = {
  sku: Scalars['String']['input'];
};


export type SchemaMutationBmsReceivePurchaseOrderArgs = {
  id: Scalars['ID']['input'];
  items: Array<SchemaBmsReceiveItemInput>;
};


export type SchemaMutationBmsReceiveStockTransferArgs = {
  input: SchemaBmsReceiveStockTransferInput;
};


export type SchemaMutationBmsRecordArReceiptArgs = {
  accountId: Scalars['ID']['input'];
  amount: Scalars['Float']['input'];
  idempotencyKey: Scalars['String']['input'];
  method: Scalars['String']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  reference: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsRecordInventoryDemandArgs = {
  input: SchemaBmsInventoryDemandInput;
};


export type SchemaMutationBmsRecordInventoryWastageArgs = {
  input: SchemaBmsInventoryWastageInput;
};


export type SchemaMutationBmsRecordPharmacyConsentArgs = {
  assessmentId: Scalars['ID']['input'];
  consentVersion: Scalars['String']['input'];
  status: Scalars['String']['input'];
};


export type SchemaMutationBmsRecordStockCountItemArgs = {
  input: SchemaBmsRecordStockCountItemInput;
};


export type SchemaMutationBmsReferAssessmentToDoctorArgs = {
  assessmentId: Scalars['ID']['input'];
  expectedVersion: Scalars['Int']['input'];
  reason: Scalars['String']['input'];
};


export type SchemaMutationBmsRefundPaymentArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsRejectAssessmentArgs = {
  assessmentId: Scalars['ID']['input'];
  expectedVersion: Scalars['Int']['input'];
  reason: Scalars['String']['input'];
};


export type SchemaMutationBmsRejectPaymentArgs = {
  id: Scalars['ID']['input'];
  note: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsRemoveConversationHelperArgs = {
  id: Scalars['ID']['input'];
  userId: Scalars['ID']['input'];
};


export type SchemaMutationBmsRenameProductCategoryArgs = {
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
};


export type SchemaMutationBmsRenameRestaurantAreaArgs = {
  areaId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
};


export type SchemaMutationBmsReorderFromOrderArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsReorderRestaurantAreasArgs = {
  locationId: Scalars['ID']['input'];
  orderedAreaIds: Array<Scalars['ID']['input']>;
};


export type SchemaMutationBmsReplaceProductPriceTiersArgs = {
  input: SchemaBmsReplacePriceTiersInput;
};


export type SchemaMutationBmsRequestMoreInformationArgs = {
  assessmentId: Scalars['ID']['input'];
  expectedVersion: Scalars['Int']['input'];
  fields: Array<Scalars['String']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsResetStoreCapabilityArgs = {
  capability: Scalars['String']['input'];
};


export type SchemaMutationBmsRetryMessageArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsReturnOrderArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsReviewAiQualityCaseArgs = {
  category: Scalars['String']['input'];
  id: Scalars['ID']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  verdict: Scalars['String']['input'];
};


export type SchemaMutationBmsReviewAiSynonymCandidateArgs = {
  decision: Scalars['String']['input'];
  id: Scalars['ID']['input'];
  productSku: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsReviewMemberTierArgs = {
  customerId: InputMaybe<Scalars['ID']['input']>;
};


export type SchemaMutationBmsReviewPharmacyProductPolicyArgs = {
  decision: Scalars['String']['input'];
  productSku: Scalars['String']['input'];
};


export type SchemaMutationBmsReviewPharmacyProtocolArgs = {
  decision: Scalars['String']['input'];
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsReviewRestaurantRequestArgs = {
  input: SchemaBmsReviewRestaurantRequestInput;
};


export type SchemaMutationBmsRunEtaxQueueArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaMutationBmsRunReadOnlySqlArgs = {
  sql: Scalars['String']['input'];
};


export type SchemaMutationBmsRunSandboxedJsArgs = {
  code: Scalars['String']['input'];
};


export type SchemaMutationBmsRunSqlArgs = {
  sql: Scalars['String']['input'];
};


export type SchemaMutationBmsSaveRestaurantFloorLayoutArgs = {
  locationId: Scalars['ID']['input'];
  positions: Array<SchemaBmsRestaurantTablePositionInput>;
};


export type SchemaMutationBmsSeedPharmacyQueueDemoArgs = {
  answers: InputMaybe<Scalars['JSON']['input']>;
  protocolKey: InputMaybe<Scalars['String']['input']>;
  transcript: InputMaybe<Scalars['JSON']['input']>;
};


export type SchemaMutationBmsSendMessageArgs = {
  attachment: InputMaybe<SchemaBmsAttachmentInput>;
  body: InputMaybe<Scalars['String']['input']>;
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsSendRestockNotificationArgs = {
  body: Scalars['String']['input'];
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsSendStockTransferArgs = {
  transferId: Scalars['ID']['input'];
};


export type SchemaMutationBmsSendTestEmailArgs = {
  html: InputMaybe<Scalars['String']['input']>;
  to: Scalars['String']['input'];
};


export type SchemaMutationBmsSetAiKeyArgs = {
  apiKey: InputMaybe<Scalars['String']['input']>;
  model: InputMaybe<Scalars['String']['input']>;
  provider: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsSetCashierAccountModeArgs = {
  posOnly: Scalars['Boolean']['input'];
  userId: Scalars['ID']['input'];
};


export type SchemaMutationBmsSetCashierPinArgs = {
  pin: InputMaybe<Scalars['String']['input']>;
  userId: Scalars['ID']['input'];
};


export type SchemaMutationBmsSetConversationStatusArgs = {
  id: Scalars['ID']['input'];
  status: SchemaBmsConvStatus;
};


export type SchemaMutationBmsSetConversationTagsArgs = {
  id: Scalars['ID']['input'];
  tags: Array<Scalars['String']['input']>;
};


export type SchemaMutationBmsSetCustomerTagsArgs = {
  id: Scalars['ID']['input'];
  tags: Array<Scalars['String']['input']>;
};


export type SchemaMutationBmsSetDefaultCustomerAddressArgs = {
  addressId: Scalars['ID']['input'];
};


export type SchemaMutationBmsSetMyAvailabilityArgs = {
  available: Scalars['Boolean']['input'];
};


export type SchemaMutationBmsSetPharmacistLicenseArgs = {
  isLicensedPharmacist: Scalars['Boolean']['input'];
  licenseNo: InputMaybe<Scalars['String']['input']>;
  userId: Scalars['ID']['input'];
};


export type SchemaMutationBmsSetPharmacyCounterSettingsArgs = {
  blockShiftOnUnreviewed: InputMaybe<Scalars['Boolean']['input']>;
  counterAuthorization: InputMaybe<Scalars['Boolean']['input']>;
};


export type SchemaMutationBmsSetPharmacyProtocolEnabledArgs = {
  enabled: Scalars['Boolean']['input'];
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsSetProductActiveArgs = {
  active: Scalars['Boolean']['input'];
  sku: Scalars['String']['input'];
};


export type SchemaMutationBmsSetProductBundleItemsArgs = {
  bundleSku: Scalars['String']['input'];
  items: Array<SchemaBmsBundleItemInput>;
};


export type SchemaMutationBmsSetProductSalesSurfacesArgs = {
  productSku: Scalars['String']['input'];
  surfaces: Array<Scalars['String']['input']>;
};


export type SchemaMutationBmsSetReorderPointArgs = {
  locationId: Scalars['ID']['input'];
  reorderPoint: Scalars['Int']['input'];
  size: Scalars['String']['input'];
  sku: Scalars['String']['input'];
};


export type SchemaMutationBmsSetRolePermissionsArgs = {
  permissions: Array<Scalars['String']['input']>;
  roleId: Scalars['ID']['input'];
};


export type SchemaMutationBmsSetShipmentStatusArgs = {
  id: Scalars['ID']['input'];
  status: SchemaBmsShipmentStatus;
};


export type SchemaMutationBmsSetTenantActiveArgs = {
  active: Scalars['Boolean']['input'];
  tenantId: Scalars['ID']['input'];
};


export type SchemaMutationBmsSetTenantPlanArgs = {
  planCode: Scalars['String']['input'];
  tenantId: Scalars['ID']['input'];
};


export type SchemaMutationBmsSetVatCategoryForUnknownArgs = {
  activeOnly: InputMaybe<Scalars['Boolean']['input']>;
  vatCategory: Scalars['String']['input'];
};


export type SchemaMutationBmsShipOrderArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsSignupArgs = {
  businessArchetype: InputMaybe<Scalars['String']['input']>;
  email: Scalars['String']['input'];
  name: InputMaybe<Scalars['String']['input']>;
  password: Scalars['String']['input'];
  shopName: Scalars['String']['input'];
};


export type SchemaMutationBmsSoftDeleteAssessmentArgs = {
  assessmentId: Scalars['ID']['input'];
};


export type SchemaMutationBmsStartPharmacistReviewArgs = {
  assessmentId: Scalars['ID']['input'];
};


export type SchemaMutationBmsStockCountArgs = {
  input: SchemaBmsStockCountInput;
};


export type SchemaMutationBmsStockTransferArgs = {
  input: SchemaBmsStockTransferInput;
};


export type SchemaMutationBmsSubmitPaymentArgs = {
  amount: InputMaybe<Scalars['Float']['input']>;
  method: SchemaBmsPaymentMethod;
  note: InputMaybe<Scalars['String']['input']>;
  orderId: Scalars['ID']['input'];
  slipRef: InputMaybe<Scalars['String']['input']>;
  slipUrl: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsSubmitPharmacyProductPolicyForReviewArgs = {
  productSku: Scalars['String']['input'];
};


export type SchemaMutationBmsSubmitPharmacyProtocolForReviewArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsSyncShipmentLiveArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsTestChannelArgs = {
  channel: Scalars['String']['input'];
};


export type SchemaMutationBmsTestPlatformAiKeyArgs = {
  provider: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsTransitionActionArgs = {
  id: Scalars['ID']['input'];
  measuredOutcome: InputMaybe<Scalars['JSON']['input']>;
  ownerId: InputMaybe<Scalars['ID']['input']>;
  reason: InputMaybe<Scalars['String']['input']>;
  status: SchemaBmsActionStatus;
};


export type SchemaMutationBmsTransitionRetentionCaseArgs = {
  id: Scalars['ID']['input'];
  reason: InputMaybe<Scalars['String']['input']>;
  status: SchemaBmsRetentionStatus;
};


export type SchemaMutationBmsUpdateCustomerAddressArgs = {
  address: Scalars['String']['input'];
  addressId: Scalars['ID']['input'];
  label: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsUpdateKitchenStationArgs = {
  id: Scalars['ID']['input'];
  input: SchemaBmsKitchenStationInput;
};


export type SchemaMutationBmsUpdateKitchenTicketStatusArgs = {
  id: Scalars['ID']['input'];
  status: Scalars['String']['input'];
};


export type SchemaMutationBmsUpdateKitchenTicketsStatusArgs = {
  ids: Array<Scalars['ID']['input']>;
  status: Scalars['String']['input'];
};


export type SchemaMutationBmsUpdateLoyaltySettingsArgs = {
  input: SchemaBmsLoyaltySettingsInput;
};


export type SchemaMutationBmsUpdateMyTenantArgs = {
  name: InputMaybe<Scalars['String']['input']>;
  slug: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsUpdateOnboardingProgressArgs = {
  completed: InputMaybe<Array<Scalars['String']['input']>>;
  dismissed: InputMaybe<Scalars['Boolean']['input']>;
  skipped: InputMaybe<Array<Scalars['String']['input']>>;
};


export type SchemaMutationBmsUpdateRestaurantTableArgs = {
  patch: SchemaBmsRestaurantTablePatchInput;
  tableId: Scalars['ID']['input'];
};


export type SchemaMutationBmsUpdateSupportTicketArgs = {
  input: SchemaBmsUpdateSupportTicketInput;
};


export type SchemaMutationBmsUpdateTaxSettingsArgs = {
  input: SchemaBmsTaxSettingsInput;
};


export type SchemaMutationBmsUpdateTrackingArgs = {
  carrier: InputMaybe<SchemaBmsCarrier>;
  id: Scalars['ID']['input'];
  trackingNo: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsUpsertArAccountArgs = {
  creditLimit: Scalars['Float']['input'];
  customerId: Scalars['ID']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  status: InputMaybe<Scalars['String']['input']>;
  termsDays: Scalars['Int']['input'];
};


export type SchemaMutationBmsUpsertChannelArgs = {
  accessToken: InputMaybe<Scalars['String']['input']>;
  active: InputMaybe<Scalars['Boolean']['input']>;
  channel: Scalars['String']['input'];
  channelSecret: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationBmsUpsertCouponArgs = {
  input: SchemaBmsCouponInput;
};


export type SchemaMutationBmsUpsertCustomerArgs = {
  input: SchemaBmsCustomerInput;
};


export type SchemaMutationBmsUpsertFollowupRuleArgs = {
  input: SchemaBmsFollowupRuleInput;
};


export type SchemaMutationBmsUpsertInventoryPolicyArgs = {
  input: SchemaBmsInventoryPolicyInput;
};


export type SchemaMutationBmsUpsertKitchenStationSlaArgs = {
  lateMinutes: Scalars['Int']['input'];
  station: Scalars['String']['input'];
  warnMinutes: Scalars['Int']['input'];
};


export type SchemaMutationBmsUpsertLocationArgs = {
  input: SchemaBmsLocationInput;
};


export type SchemaMutationBmsUpsertMembershipTierArgs = {
  input: SchemaBmsMembershipTierInput;
};


export type SchemaMutationBmsUpsertPharmacyProductPolicyArgs = {
  input: SchemaBmsPharmacyProductPolicyInput;
};


export type SchemaMutationBmsUpsertPharmacyProtocolArgs = {
  input: SchemaBmsPharmacyProtocolInput;
};


export type SchemaMutationBmsUpsertPosDeviceArgs = {
  input: SchemaBmsPosDeviceInput;
};


export type SchemaMutationBmsUpsertProductArgs = {
  input: SchemaBmsProductInput;
};


export type SchemaMutationBmsUpsertProductCatalogVariantArgs = {
  input: SchemaBmsProductCatalogVariantInput;
};


export type SchemaMutationBmsUpsertProductModifierArgs = {
  input: SchemaBmsProductModifierInput;
};


export type SchemaMutationBmsUpsertProductPackArgs = {
  input: SchemaBmsProductPackInput;
};


export type SchemaMutationBmsUpsertProductPromotionArgs = {
  input: SchemaBmsProductPromotionInput;
};


export type SchemaMutationBmsUpsertProductRecipeArgs = {
  input: SchemaBmsProductRecipeInput;
};


export type SchemaMutationBmsUpsertProductStockPolicyArgs = {
  input: SchemaBmsProductStockPolicyInput;
};


export type SchemaMutationBmsUpsertReportSubscriptionArgs = {
  input: SchemaBmsUpsertReportSubscriptionInput;
};


export type SchemaMutationBmsUpsertStoreCapabilityArgs = {
  capability: Scalars['String']['input'];
  config: InputMaybe<Scalars['JSON']['input']>;
  enabled: Scalars['Boolean']['input'];
};


export type SchemaMutationBmsUpsertStoreProfileArgs = {
  input: SchemaBmsStoreProfileInput;
};


export type SchemaMutationBmsVerifyPaymentSlipArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationBmsVerifyShopSignupArgs = {
  token: Scalars['String']['input'];
};


export type SchemaMutationBmsWorkAssistantArgs = {
  input: SchemaBmsWorkAssistantInput;
};


export type SchemaMutationBmsWriteOffArInvoiceArgs = {
  invoiceId: Scalars['ID']['input'];
  reason: Scalars['String']['input'];
};


export type SchemaMutationBookmarkArgs = {
  postId: Scalars['ID']['input'];
};


export type SchemaMutationClonePostArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationCreateChatArgs = {
  isGroup: Scalars['Boolean']['input'];
  memberIds: Array<Scalars['ID']['input']>;
  name: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationCreateRoleArgs = {
  input: SchemaCreateRoleInput;
};


export type SchemaMutationCreateSupportTicketArgs = {
  input: SchemaSupportTicketInput;
};


export type SchemaMutationDeleteChatArgs = {
  chat_id: Scalars['ID']['input'];
};


export type SchemaMutationDeleteCommentArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationDeleteFileArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationDeleteFilesArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type SchemaMutationDeleteMessageArgs = {
  message_id: Scalars['ID']['input'];
};


export type SchemaMutationDeletePostArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationDeletePostsArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type SchemaMutationDeleteRoleArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationDeleteUserArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationDeleteUsersArgs = {
  ids: Array<Scalars['ID']['input']>;
};


export type SchemaMutationIngestCallLogsArgs = {
  logs: Array<SchemaLogCallInput>;
};


export type SchemaMutationLoginArgs = {
  input: SchemaLoginInput;
};


export type SchemaMutationLoginAdminArgs = {
  input: SchemaLoginInput;
};


export type SchemaMutationLoginMobileArgs = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};


export type SchemaMutationLoginUserArgs = {
  input: SchemaLoginInput;
};


export type SchemaMutationLoginWithSocialArgs = {
  input: SchemaSocialLoginInput;
};


export type SchemaMutationMarkChatReadUpToArgs = {
  chat_id: Scalars['ID']['input'];
  cursor: Scalars['String']['input'];
};


export type SchemaMutationMarkContactSpamPhoneArgs = {
  contact_name: InputMaybe<Scalars['String']['input']>;
  phone: Scalars['String']['input'];
  source: InputMaybe<SchemaContactSpamMarkSource>;
};


export type SchemaMutationMarkMessageReadArgs = {
  message_id: Scalars['ID']['input'];
};


export type SchemaMutationMarkNotificationReadArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaMutationRegisterPushTokenArgs = {
  input: SchemaRegisterPushTokenInput;
};


export type SchemaMutationRegisterUserArgs = {
  input: SchemaRegisterInput;
};


export type SchemaMutationRenameChatArgs = {
  chat_id: Scalars['ID']['input'];
  name: InputMaybe<Scalars['String']['input']>;
};


export type SchemaMutationRenameFileArgs = {
  id: Scalars['ID']['input'];
  name: Scalars['String']['input'];
};


export type SchemaMutationReplyCommentArgs = {
  comment_id: Scalars['ID']['input'];
  content: Scalars['String']['input'];
};


export type SchemaMutationReportBankAccountArgs = {
  input: SchemaReportBankAccountInput;
};


export type SchemaMutationReportNumberArgs = {
  category: InputMaybe<SchemaScamPhoneReportCategory>;
  note: InputMaybe<Scalars['String']['input']>;
  phoneNumber: Scalars['String']['input'];
};


export type SchemaMutationReportPhoneArgs = {
  category: InputMaybe<SchemaScamPhoneReportCategory>;
  note: InputMaybe<Scalars['String']['input']>;
  phone: Scalars['String']['input'];
};


export type SchemaMutationReportScamBankAccountArgs = {
  input: SchemaReportScamBankAccountInput;
};


export type SchemaMutationReportScamPhoneArgs = {
  input: SchemaReportScamPhoneInput;
};


export type SchemaMutationReportSpamArgs = {
  phoneNumber: Scalars['String']['input'];
};


export type SchemaMutationRequestPasswordResetArgs = {
  email: Scalars['String']['input'];
};


export type SchemaMutationResetPasswordArgs = {
  newPassword: Scalars['String']['input'];
  token: Scalars['String']['input'];
};


export type SchemaMutationSendArgs = {
  text: Scalars['String']['input'];
};


export type SchemaMutationSendMessageArgs = {
  audio: InputMaybe<Scalars['Upload']['input']>;
  audio_duration_sec: InputMaybe<Scalars['Int']['input']>;
  chat_id: Scalars['ID']['input'];
  client_message_id: InputMaybe<Scalars['String']['input']>;
  images: InputMaybe<Array<Scalars['Upload']['input']>>;
  location: InputMaybe<SchemaMessageLocationInput>;
  reply_to_id: InputMaybe<Scalars['ID']['input']>;
  text: Scalars['String']['input'];
  to_user_ids: Array<Scalars['ID']['input']>;
};


export type SchemaMutationSetRoleActiveArgs = {
  id: Scalars['ID']['input'];
  is_active: Scalars['Boolean']['input'];
};


export type SchemaMutationToggleBookmarkArgs = {
  postId: Scalars['ID']['input'];
};


export type SchemaMutationUnblockNumberArgs = {
  phoneNumber: Scalars['String']['input'];
};


export type SchemaMutationUnblockPhoneArgs = {
  input: SchemaUnblockPhoneInput;
};


export type SchemaMutationUnblockScamPhoneArgs = {
  input: SchemaUnblockScamPhoneInput;
};


export type SchemaMutationUnbookmarkArgs = {
  postId: Scalars['ID']['input'];
};


export type SchemaMutationUnmarkContactSpamPhoneArgs = {
  phone: Scalars['String']['input'];
};


export type SchemaMutationUnregisterPushTokenArgs = {
  fcmToken: Scalars['String']['input'];
};


export type SchemaMutationUnreportScamBankAccountArgs = {
  input: SchemaUnreportScamBankAccountInput;
};


export type SchemaMutationUpdateCommentArgs = {
  content: Scalars['String']['input'];
  id: Scalars['ID']['input'];
};


export type SchemaMutationUpdateMeArgs = {
  data: SchemaMeInput;
};


export type SchemaMutationUpdateMyChatSettingsArgs = {
  chat_id: Scalars['ID']['input'];
  is_muted: InputMaybe<Scalars['Boolean']['input']>;
  notifications_enabled: InputMaybe<Scalars['Boolean']['input']>;
};


export type SchemaMutationUpdateMyContactSpamProtectionSettingsArgs = {
  input: SchemaContactSpamProtectionSettingsInput;
};


export type SchemaMutationUpdateMyProfileArgs = {
  data: SchemaMyProfileInput;
};


export type SchemaMutationUpdateRoleArgs = {
  id: Scalars['ID']['input'];
  input: SchemaUpdateRoleInput;
};


export type SchemaMutationUploadAvatarArgs = {
  file: Scalars['Upload']['input'];
  user_id: Scalars['ID']['input'];
};


export type SchemaMutationUploadDiagnosticsArgs = {
  input: SchemaUploadDiagnosticsInput;
};


export type SchemaMutationUpsertPostArgs = {
  data: SchemaPostInput;
  id: InputMaybe<Scalars['ID']['input']>;
  image_ids_delete: InputMaybe<Array<Scalars['ID']['input']>>;
  images: InputMaybe<Array<Scalars['Upload']['input']>>;
};


export type SchemaMutationUpsertUserArgs = {
  data: SchemaUserInput;
  id: InputMaybe<Scalars['ID']['input']>;
};


export type SchemaMutationVerifyEmailArgs = {
  token: Scalars['String']['input'];
};

export type SchemaMyBankBlockStatusChangedPayload = {
  __typename?: 'MyBankBlockStatusChangedPayload';
  account_norm: Scalars['String']['output'];
  action: SchemaBlockAction;
  bank_name: Scalars['String']['output'];
  blocked: Scalars['Boolean']['output'];
  updated_at: Scalars['String']['output'];
  user_id: Scalars['ID']['output'];
};

export type SchemaMyBookmarkStatusChangedPayload = {
  __typename?: 'MyBookmarkStatusChangedPayload';
  action: SchemaBookmarkAction;
  bookmarked: Scalars['Boolean']['output'];
  target_id: Scalars['ID']['output'];
  target_type: SchemaBookmarkTargetType;
  updated_at: Scalars['String']['output'];
  user_id: Scalars['ID']['output'];
};

export type SchemaMyContactSpamMarkChangedPayload = {
  __typename?: 'MyContactSpamMarkChangedPayload';
  action: Scalars['String']['output'];
  active: Scalars['Boolean']['output'];
  contact_name: Maybe<Scalars['String']['output']>;
  phone_normalized: Scalars['String']['output'];
  source: Maybe<Scalars['String']['output']>;
  updated_at: Scalars['String']['output'];
  user_id: Scalars['ID']['output'];
};

export type SchemaMyContactSpamSettingsChangedPayload = {
  __typename?: 'MyContactSpamSettingsChangedPayload';
  auto_mark_enabled: Scalars['Boolean']['output'];
  mode: Scalars['String']['output'];
  risk_threshold: Scalars['Int']['output'];
  sync_enabled: Scalars['Boolean']['output'];
  updated_at: Scalars['String']['output'];
  user_id: Scalars['ID']['output'];
};

export type SchemaMyPhoneBlockStatusChangedPayload = {
  __typename?: 'MyPhoneBlockStatusChangedPayload';
  action: SchemaBlockAction;
  blocked: Scalars['Boolean']['output'];
  phone: Scalars['String']['output'];
  phone_normalized: Scalars['String']['output'];
  updated_at: Scalars['String']['output'];
  user_id: Scalars['ID']['output'];
};

export type SchemaMyProfileInput = {
  avatar: InputMaybe<Scalars['String']['input']>;
  name: InputMaybe<Scalars['String']['input']>;
  phone: InputMaybe<Scalars['String']['input']>;
};

export type SchemaMyReportedBankAccount = {
  __typename?: 'MyReportedBankAccount';
  account: Scalars['String']['output'];
  bank_name: Scalars['String']['output'];
  category: Maybe<SchemaScamPhoneReportCategory>;
  created_at: Scalars['String']['output'];
  note: Maybe<Scalars['String']['output']>;
  post_id: Maybe<Scalars['String']['output']>;
  report_count: Scalars['Int']['output'];
  risk_level: Scalars['Int']['output'];
  tags: Array<Scalars['String']['output']>;
  updated_at: Scalars['String']['output'];
};

export type SchemaMyReportedPhone = {
  __typename?: 'MyReportedPhone';
  category: SchemaScamPhoneReportCategory;
  created_at: Scalars['String']['output'];
  note: Maybe<Scalars['String']['output']>;
  phone: Scalars['String']['output'];
  post_id: Maybe<Scalars['String']['output']>;
  report_count: Scalars['Int']['output'];
  risk_level: Scalars['Int']['output'];
  tags: Array<Scalars['String']['output']>;
  updated_at: Scalars['String']['output'];
};

export type SchemaNotification = {
  __typename?: 'Notification';
  created_at: Scalars['String']['output'];
  data: Maybe<Scalars['JSON']['output']>;
  entity_id: Scalars['ID']['output'];
  entity_type: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  is_read: Scalars['Boolean']['output'];
  message: Scalars['String']['output'];
  title: Scalars['String']['output'];
  type: Scalars['String']['output'];
  user_id: Scalars['ID']['output'];
};

export type SchemaPendingSummary = {
  __typename?: 'PendingSummary';
  errors_last24h: Scalars['Int']['output'];
  files_unclassified: Scalars['Int']['output'];
  posts_awaiting_approval: Scalars['Int']['output'];
  users_pending_invite: Scalars['Int']['output'];
};

export type SchemaPhoneCenterActionPayload = {
  __typename?: 'PhoneCenterActionPayload';
  item: SchemaPhoneCenterItem;
  ok: Scalars['Boolean']['output'];
};

export type SchemaPhoneCenterFilter =
  | 'ALL'
  | 'BLOCKED'
  | 'HISTORY'
  | 'REPORTS';

export type SchemaPhoneCenterItem = {
  __typename?: 'PhoneCenterItem';
  filters: Array<Scalars['String']['output']>;
  in_history: Scalars['Boolean']['output'];
  last_history_at: Maybe<Scalars['String']['output']>;
  last_report_at: Maybe<Scalars['String']['output']>;
  latest_post_id: Maybe<Scalars['ID']['output']>;
  my_blocked: Scalars['Boolean']['output'];
  my_blocked_at: Maybe<Scalars['String']['output']>;
  my_reported: Scalars['Boolean']['output'];
  my_reported_at: Maybe<Scalars['String']['output']>;
  phone: Scalars['String']['output'];
  phone_normalized: Scalars['String']['output'];
  post_count: Scalars['Int']['output'];
  post_ids: Array<Scalars['ID']['output']>;
  report_count: Scalars['Int']['output'];
  risk_level: Scalars['Int']['output'];
  updated_at: Scalars['String']['output'];
};

export type SchemaPhoneEntityDetail = {
  __typename?: 'PhoneEntityDetail';
  filters: Array<Scalars['String']['output']>;
  in_history: Scalars['Boolean']['output'];
  last_history_at: Maybe<Scalars['String']['output']>;
  last_report_at: Maybe<Scalars['String']['output']>;
  latest_post_id: Maybe<Scalars['ID']['output']>;
  my_blocked: Scalars['Boolean']['output'];
  my_blocked_at: Maybe<Scalars['String']['output']>;
  my_reported: Scalars['Boolean']['output'];
  my_reported_at: Maybe<Scalars['String']['output']>;
  phone: Scalars['String']['output'];
  phone_normalized: Scalars['String']['output'];
  post_count: Scalars['Int']['output'];
  post_ids: Array<Scalars['ID']['output']>;
  report_count: Scalars['Int']['output'];
  risk_level: Scalars['Int']['output'];
  updated_at: Scalars['String']['output'];
};

export type SchemaPhoneSafetyStatus = {
  __typename?: 'PhoneSafetyStatus';
  blocked_by_count: Scalars['Int']['output'];
  last_blocked_at: Maybe<Scalars['String']['output']>;
  last_report_at: Maybe<Scalars['String']['output']>;
  my_blocked: Scalars['Boolean']['output'];
  my_blocked_at: Maybe<Scalars['String']['output']>;
  phone: Scalars['String']['output'];
  phone_normalized: Scalars['String']['output'];
  report_count: Scalars['Int']['output'];
  risk_level: Scalars['Int']['output'];
  updated_at: Scalars['String']['output'];
};

export type SchemaPost = {
  __typename?: 'Post';
  author: Maybe<SchemaUser>;
  auto_publish: Scalars['Boolean']['output'];
  bookmarks: Array<SchemaBookmark>;
  comments_count: Maybe<Scalars['Int']['output']>;
  created_at: Scalars['String']['output'];
  detail: Maybe<Scalars['String']['output']>;
  /**
   * ลิงก์ไปยังโพสต์บน Facebook Page
   * ใช้สำหรับปุ่ม "ดูโพสต์บน Facebook"
   */
  fb_permalink_url: Maybe<Scalars['String']['output']>;
  /** เวลาที่โพสต์ถูก publish จริงบน Facebook (ISO string) */
  fb_published_at: Maybe<Scalars['String']['output']>;
  /**
   * ID ของโพสต์บน Facebook (page_post_id)
   * ใช้ลบ/อัปเดตในอนาคต
   */
  fb_social_post_id: Maybe<Scalars['String']['output']>;
  /**
   * สถานะจาก social_posts
   * เช่น PENDING | PUBLISHED | FAILED | DELETED
   */
  fb_status: Maybe<Scalars['String']['output']>;
  first_last_name: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  id_card: Maybe<Scalars['String']['output']>;
  images: Array<SchemaImage>;
  is_bookmarked: Scalars['Boolean']['output'];
  province_id: Maybe<Scalars['ID']['output']>;
  province_name: Maybe<Scalars['String']['output']>;
  seller_accounts: Array<SchemaSellerAccount>;
  status: SchemaPostStatus;
  tel_numbers: Array<SchemaTelNumber>;
  title: Maybe<Scalars['String']['output']>;
  transfer_amount: Maybe<Scalars['Float']['output']>;
  transfer_date: Maybe<Scalars['String']['output']>;
  updated_at: Scalars['String']['output'];
  website: Maybe<Scalars['String']['output']>;
};

export type SchemaPostConnection = {
  __typename?: 'PostConnection';
  items: Array<SchemaPost>;
  total: Scalars['Int']['output'];
};

export type SchemaPostInput = {
  auto_publish: InputMaybe<Scalars['Boolean']['input']>;
  detail: InputMaybe<Scalars['String']['input']>;
  first_last_name: InputMaybe<Scalars['String']['input']>;
  id_card: InputMaybe<Scalars['String']['input']>;
  province_id: InputMaybe<Scalars['ID']['input']>;
  seller_accounts: InputMaybe<Array<SchemaSellerAccountInput>>;
  status: SchemaPostStatus;
  tel_numbers: InputMaybe<Array<SchemaTelNumberInput>>;
  title: InputMaybe<Scalars['String']['input']>;
  transfer_amount: InputMaybe<Scalars['Float']['input']>;
  transfer_date: InputMaybe<Scalars['String']['input']>;
  website: InputMaybe<Scalars['String']['input']>;
};

export type SchemaPostStatus =
  | 'public'
  | 'unpublic';

export type SchemaQuery = {
  __typename?: 'Query';
  _health: Scalars['String']['output'];
  _ok: Scalars['String']['output'];
  bankDetail: SchemaBankEntityDetail;
  bmsActingTenant: Maybe<SchemaBmsActingTenant>;
  bmsActionMetrics: SchemaBmsActionMetrics;
  bmsActions: Array<SchemaBmsAction>;
  bmsAiConfig: SchemaBmsAiConfig;
  bmsAiCreditLedger: Array<SchemaBmsAiCreditLedgerEntry>;
  bmsAiFailureSummary: SchemaBmsAiFailureSummary;
  bmsAiProviderHealth: Array<SchemaBmsAiProviderHealth>;
  bmsAiProviderHealthCount: Scalars['Int']['output'];
  bmsAiQualityCase: Maybe<SchemaBmsAiQualityCaseDetail>;
  bmsAiQualityCases: Array<SchemaBmsAiQualityCase>;
  bmsAiQualityMetrics: SchemaBmsAiQualityMetrics;
  bmsAiSynonymCandidates: Array<SchemaBmsAiSynonymCandidate>;
  bmsAiUsage: SchemaBmsAiUsage;
  bmsAiUsageBreakdown: Array<SchemaBmsAiUsageBreakdown>;
  bmsAiUsageEvents: Array<SchemaBmsAiUsageEvent>;
  bmsArAccount: Maybe<SchemaBmsArAccount>;
  bmsArAccounts: Array<SchemaBmsArAccount>;
  bmsArInvoices: Array<SchemaBmsArInvoice>;
  bmsArLedger: Array<SchemaBmsArLedgerEntry>;
  bmsArOutstanding: SchemaBmsArOutstanding;
  bmsAssignableStaff: Array<SchemaBmsStaffRef>;
  bmsAuditLog: Array<SchemaBmsAuditEntry>;
  bmsBilling: SchemaBmsBilling;
  bmsChannelHealth: Array<SchemaBmsChannelHealth>;
  bmsChannelHealthCount: Scalars['Int']['output'];
  bmsChannels: Array<SchemaBmsChannelConfig>;
  bmsCommissionReport: SchemaBmsMobileCommissionReportResult;
  bmsCommissionRules: SchemaBmsMobileCommissionRulesResult;
  bmsConversation: Maybe<SchemaBmsConversation>;
  bmsConversationTimeline: Array<SchemaBmsTimelineEntry>;
  bmsConversations: Array<SchemaBmsConversation>;
  bmsCouponLocations: Array<SchemaBmsLocation>;
  bmsCouponRedemptions: Array<SchemaBmsCouponRedemption>;
  bmsCoupons: Array<SchemaBmsCoupon>;
  bmsCustomer: Maybe<SchemaBmsCustomer>;
  bmsCustomer360: Maybe<SchemaBmsCustomer360>;
  bmsCustomerInsights: Maybe<SchemaBmsCustomerInsights>;
  bmsCustomerLocations: Array<SchemaBmsLocation>;
  bmsCustomerTimeline: Array<SchemaBmsCustomerTimelineEntry>;
  bmsCustomers: Array<SchemaBmsCustomer>;
  bmsDashboard: SchemaBmsDashboard;
  bmsEtaxSubmissions: Array<SchemaBmsEtaxSubmission>;
  bmsEtaxSummary: SchemaBmsEtaxSummary;
  bmsExpiringLots: Array<SchemaBmsInventoryLot>;
  bmsFollowupAnalytics: SchemaBmsFollowupAnalytics;
  bmsFollowupHistory: Array<SchemaBmsFollowupHistoryEntry>;
  bmsFollowupQueue: Array<SchemaBmsFollowupJob>;
  bmsFollowupRules: Array<SchemaBmsFollowupRule>;
  bmsGenerateInvoice: Maybe<SchemaBmsBusinessDoc>;
  bmsGeneratedReports: Array<SchemaBmsGeneratedReport>;
  bmsInboxDiagnosticLatest: Array<SchemaBmsInboxDiagnosticLatest>;
  bmsInboxUnreadCount: Scalars['Int']['output'];
  bmsInventoryActionCenter: SchemaBmsInventoryActionCenter;
  bmsInventoryLots: Array<SchemaBmsInventoryLot>;
  bmsInventorySummary: SchemaBmsInventorySummary;
  bmsInventoryWastage: Array<SchemaBmsInventoryWastage>;
  bmsIsPlatformAdmin: Scalars['Boolean']['output'];
  bmsJsConsoleEnabled: Scalars['Boolean']['output'];
  bmsKitchenBoardEnabled: Scalars['Boolean']['output'];
  bmsKitchenStationSlas: Array<SchemaBmsKitchenStationSla>;
  /** สถานีครัวของร้าน · locationId = กรอง "ใช้ได้ที่สาขานี้" (สถานีระดับร้าน + ของสาขานั้น) */
  bmsKitchenStations: Array<SchemaBmsKitchenStation>;
  bmsKitchenTickets: Array<SchemaBmsKitchenTicket>;
  bmsLocations: Array<SchemaBmsLocation>;
  bmsLotRecall: Array<SchemaBmsLotRecallHit>;
  bmsLotReconcile: Array<SchemaBmsLotMismatch>;
  bmsLowStock: Array<SchemaBmsLowStockItem>;
  bmsLoyaltyActivity: Array<SchemaBmsLoyaltyActivityRow>;
  bmsLoyaltyLedger: Array<SchemaBmsLoyaltyLedgerEntry>;
  bmsLoyaltyOutstanding: SchemaBmsLoyaltyOutstanding;
  bmsLoyaltySettings: SchemaBmsLoyaltySettings;
  bmsMailLog: SchemaBmsMailLogPage;
  bmsMailLogEntry: Maybe<SchemaBmsMailLogEntry>;
  bmsMailLogStats: SchemaBmsMailLogStats;
  bmsMe: SchemaBmsMe;
  bmsMember: Maybe<SchemaBmsMember>;
  bmsMemberDiscountPreview: SchemaBmsMemberDiscountPreview;
  bmsMembers: SchemaBmsMemberPage;
  bmsMembersExpiringPoints: Array<SchemaBmsExpiringPointsRow>;
  bmsMembershipTiers: Array<SchemaBmsMembershipTier>;
  bmsMobileRestaurantRequests: SchemaBmsMobileRestaurantRequestsResult;
  bmsMyMentions: Array<SchemaBmsMention>;
  bmsMyMentionsUnreadCount: Scalars['Int']['output'];
  bmsMyTenant: SchemaBmsTenantInfo;
  bmsOnboardingProgress: SchemaBmsOnboardingProgress;
  bmsOperationalAlerts: SchemaBmsOperationalAlerts;
  bmsOrder: Maybe<SchemaBmsOrder>;
  bmsOrderJourney: Maybe<SchemaBmsOrderJourney>;
  bmsOrderLocations: Array<SchemaBmsLocation>;
  bmsOrders: Array<SchemaBmsOrder>;
  bmsPackToolsConfigured: Scalars['Boolean']['output'];
  bmsPayment: Maybe<SchemaBmsPayment>;
  bmsPayments: Array<SchemaBmsPayment>;
  bmsPermissionCatalog: Array<Scalars['String']['output']>;
  /** บันทึกการจ่ายยาที่เภสัชกรอนุมัติที่เคาน์เตอร์ (9.29) — สิทธิ์ pharmacy.audit.read */
  bmsPharmacistCounterAuthorizations: SchemaBmsPharmacistCounterAuthorizationPage;
  bmsPharmacyAssessment: Maybe<SchemaBmsPharmacyAssessment>;
  bmsPharmacyAssessmentConversationHistory: Maybe<SchemaBmsPharmacyConversationHistory>;
  bmsPharmacyAssessmentEvents: Array<SchemaBmsPharmacyAssessmentEvent>;
  bmsPharmacyAssessments: Array<SchemaBmsPharmacyAssessment>;
  bmsPharmacyCatalog: Array<SchemaBmsPharmacyCatalogItem>;
  bmsPharmacyClinicalEvidence: Array<SchemaBmsPharmacyClinicalEvidence>;
  bmsPharmacyLicenseCandidates: Array<SchemaBmsPharmacyLicenseUser>;
  bmsPharmacyPolicyReadiness: SchemaBmsPharmacyPolicyReadiness;
  bmsPharmacyProductPolicies: SchemaBmsPharmacyProductPolicyPage;
  bmsPharmacyProtocol: Maybe<SchemaBmsPharmacyProtocol>;
  bmsPharmacyProtocols: Array<SchemaBmsPharmacyProtocol>;
  bmsPosArAccount: SchemaBmsPosArAccountResult;
  bmsPosCashMovements: SchemaBmsPosCashMovementsResult;
  bmsPosCashiers: Array<SchemaBmsPosCashier>;
  bmsPosCatalogSearch: SchemaBmsPosCatalogSearchResult;
  bmsPosDeposits: SchemaBmsPosDepositsResult;
  bmsPosDevices: Array<SchemaBmsPosDevice>;
  bmsPosExpenses: SchemaBmsPosExpensesResult;
  bmsPosKitchenTickets: SchemaBmsPosKitchenTicketsResult;
  bmsPosLastSale: Maybe<SchemaBmsPosReceipt>;
  bmsPosMemberPreview: SchemaBmsPosMemberPreviewResult;
  bmsPosMemberSearch: SchemaBmsPosMemberSearchResult;
  bmsPosNoSales: SchemaBmsPosNoSalesResult;
  bmsPosOpenShift: Maybe<SchemaBmsPosShift>;
  bmsPosOperationalReadiness: SchemaBmsPosOperationalReadiness;
  bmsPosParkedSales: SchemaBmsPosParkedSalesResult;
  bmsPosPurchaseOrder: Maybe<SchemaBmsPurchaseOrder>;
  bmsPosPurchaseOrders: SchemaBmsPosPurchaseOrdersResult;
  bmsPosRecentSales: SchemaBmsPosRecentSalesResult;
  bmsPosRestaurantCheck: Maybe<SchemaBmsPosRestaurantCheck>;
  bmsPosRestaurantFloor: SchemaBmsPosRestaurantFloorResult;
  bmsPosRestaurantIncoming: SchemaBmsPosRestaurantIncomingResult;
  bmsPosRestaurantMenu: SchemaBmsPosRestaurantMenuResult;
  bmsPosRestaurantQrOrders: SchemaBmsPosRestaurantQrOrdersResult;
  bmsPosRestaurantRequests: SchemaBmsPosRestaurantRequestsResult;
  bmsPosRestaurantServiceCalls: SchemaBmsPosRestaurantServiceCallsResult;
  bmsPosRestaurantWaitlist: SchemaBmsPosRestaurantWaitlistResult;
  bmsPosReturnAuditSummary: SchemaBmsPosReturnAuditSummaryResult;
  bmsPosReturnSummary: SchemaBmsPosReturnSummaryResult;
  bmsPosScan: SchemaBmsPosScanResult;
  bmsPosSession: SchemaBmsPosSessionResult;
  bmsPosShiftHistory: SchemaBmsPosShiftHistoryResult;
  bmsPosShiftReport: SchemaBmsPosShiftReportResult;
  bmsPosStaff: Array<SchemaBmsPosCashier>;
  bmsPosStoreCredit: SchemaBmsPosStoreCreditResult;
  bmsProductBundleItems: Array<SchemaBmsBundleItem>;
  bmsProductBySku: Maybe<SchemaBmsProduct>;
  bmsProductCategories: Array<SchemaBmsProductCategory>;
  bmsProductModifiers: Array<SchemaBmsProductModifier>;
  bmsProductPacks: SchemaBmsProductPackList;
  bmsProductPriceTiers: Array<SchemaBmsProductPriceTier>;
  bmsProductPromotions: Array<SchemaBmsProductPromotion>;
  bmsProductReadiness: SchemaBmsProductReadiness;
  bmsProductRecipes: Array<SchemaBmsProductRecipe>;
  bmsProductStockPolicy: Maybe<SchemaBmsProductStockPolicy>;
  bmsProducts: SchemaBmsProductConnection;
  bmsProductsNeedingBarcodes: Array<SchemaBmsPackAudit>;
  bmsProductsNeedingPolicyReview: Array<SchemaBmsUnreviewedProduct>;
  bmsPromotionLocations: Array<SchemaBmsLocation>;
  bmsPublicPlans: Array<SchemaBmsPlan>;
  bmsPurchaseOrder: Maybe<SchemaBmsPurchaseOrder>;
  bmsPurchaseOrders: Array<SchemaBmsPurchaseOrder>;
  bmsReportDeliveries: Array<SchemaBmsReportDelivery>;
  bmsReportDeliveriesForTenant: Array<SchemaBmsReportDelivery>;
  bmsReportSubscription: SchemaBmsReportSubscription;
  bmsReportSubscriptions: Array<SchemaBmsReportSubscriptionOverview>;
  bmsRestaurantCancellationLossReport: Array<SchemaBmsRestaurantCancellationLoss>;
  bmsRestaurantFloorAdmin: SchemaBmsRestaurantFloorAdmin;
  bmsRestaurantFloorLocations: Array<SchemaBmsLocation>;
  bmsRestaurantTableQr: Maybe<SchemaBmsRestaurantTableQr>;
  bmsRestockDeliveries: Array<SchemaBmsRestockDelivery>;
  bmsRestockMetrics: SchemaBmsRestockMetrics;
  bmsRestockReadyCount: Scalars['Int']['output'];
  bmsRestockStatusCounts: SchemaBmsRestockStatusCounts;
  bmsRestockSubscriptions: SchemaBmsRestockSubscriptionConnection;
  bmsRetentionAnalytics: SchemaBmsRetentionAnalytics;
  bmsRetentionCases: Array<SchemaBmsRetentionCase>;
  bmsRevisionCompare: Maybe<SchemaBmsRevisionComparison>;
  bmsRevisionDetail: Maybe<SchemaBmsRevisionEntry>;
  bmsRevisionHistory: Array<SchemaBmsRevisionEntry>;
  bmsRolePermissions: Array<SchemaBmsRolePermissions>;
  bmsSalesByTier: Array<SchemaBmsSalesByTierRow>;
  bmsSalesSummary: SchemaBmsSalesSummary;
  bmsShipment: Maybe<SchemaBmsShipment>;
  bmsShipmentLabel: Maybe<SchemaBmsShipmentLabel>;
  bmsShipmentTrackingEvents: Array<SchemaBmsShipmentTrackingEvent>;
  bmsShipments: Array<SchemaBmsShipment>;
  bmsSqlConsoleWriteEnabled: Scalars['Boolean']['output'];
  bmsStockCounts: SchemaBmsMobileStockCountsResult;
  bmsStockMovements: Array<SchemaBmsStockMovement>;
  bmsStockTransfers: SchemaBmsMobileStockTransfersResult;
  bmsStoreCapabilities: Array<SchemaBmsStoreCapability>;
  bmsStoreCredit: SchemaBmsMobileStoreCreditResult;
  bmsStoreProfile: SchemaBmsStoreProfile;
  bmsSupplierProducts: Array<SchemaBmsSupplierProduct>;
  bmsSuppliers: Array<SchemaBmsSupplier>;
  bmsSupportTickets: SchemaBmsSupportTicketPage;
  bmsTaxDocuments: Array<SchemaBmsTaxDocument>;
  bmsTaxSettings: SchemaBmsTaxSettings;
  bmsTenants: Array<SchemaBmsTenantRow>;
  bmsTopSellingProducts: Array<SchemaBmsTopProduct>;
  /** ชื่อสถานีที่ยังถูกใช้อยู่แต่ไม่มีแถวหลัก (ข้อมูลตกค้าง) — ปกติต้องว่าง */
  bmsUnmappedKitchenStationNames: Array<Scalars['String']['output']>;
  /** ใครจองสินค้าไซซ์นี้อยู่ — อธิบายเลข reserved_stock ให้เป็นรายบิล (ต้องมีสิทธิ์ order.view) */
  bmsVariantReservations: SchemaBmsVariantReservations;
  bmsWastageEnabled: Scalars['Boolean']['output'];
  comments: Array<SchemaComment>;
  filesPaged: SchemaFileConnection;
  getCallLogs: Array<SchemaCallHistoryLog>;
  getOrCreateDm: SchemaChat;
  getPhoneInfo: SchemaScamPhone;
  getSpamNumbers: Array<SchemaScamPhone>;
  getUserBlockedNumbers: Array<Scalars['String']['output']>;
  globalSearch: SchemaGlobalSearchResult;
  globalSearchUnified: Array<SchemaSearchType>;
  latestPosts: Array<SchemaPost>;
  latestUsers: Array<SchemaDashboardUser>;
  me: Maybe<SchemaUser>;
  meRole: Scalars['String']['output'];
  messages: Array<SchemaMessage>;
  messagesConnection: SchemaMessageConnection;
  myBlockedPhoneKeys: Array<Scalars['String']['output']>;
  myBlockedPhones: Array<SchemaPhoneSafetyStatus>;
  myBmsPermissions: Array<Scalars['String']['output']>;
  myBookmarks: Array<SchemaPost>;
  myChatSettings: SchemaChatMemberSettings;
  myChats: Array<SchemaChat>;
  myContactSpamMarkedPhoneKeys: Array<Scalars['String']['output']>;
  myContactSpamProtectionSettings: SchemaContactSpamProtectionSettings;
  myNotifications: Array<SchemaNotification>;
  myPosts: Array<SchemaPost>;
  myReportedBankAccountKeys: Array<Scalars['String']['output']>;
  myReportedBankAccounts: Array<SchemaMyReportedBankAccount>;
  myReportedPhoneKeys: Array<Scalars['String']['output']>;
  myReportedPhones: Array<SchemaMyReportedPhone>;
  myUnreadChatCount: Scalars['Int']['output'];
  myUnreadNotificationCount: Scalars['Int']['output'];
  pending: SchemaPendingSummary;
  phoneCenterSearch: Array<SchemaPhoneCenterItem>;
  phoneDetail: SchemaPhoneEntityDetail;
  phoneSafetyStatus: SchemaPhoneSafetyStatus;
  post: Maybe<SchemaPost>;
  posts: Array<SchemaPost>;
  postsByUserId: Array<SchemaPost>;
  postsPaged: SchemaPostConnection;
  relatedPostsByBank: Array<Scalars['ID']['output']>;
  relatedPostsByPhone: Array<Scalars['ID']['output']>;
  role: Maybe<SchemaRole>;
  roles: Array<SchemaRole>;
  scamPhonesDelta: SchemaScamPhoneDeltaPage;
  scamPhonesSnapshot: SchemaScamPhoneSnapshotPage;
  searchBankAccounts: Array<SchemaSearchBankAccountResult>;
  searchScamBankAccounts: Array<SchemaSearchBankAccountResult>;
  searchScamPhones: Array<SchemaScamPhone>;
  stats: SchemaStatsSummary;
  unreadCount: Scalars['Int']['output'];
  user: Maybe<SchemaUser>;
  users: SchemaUserConnection;
  whoRead: Array<SchemaUser>;
};


export type SchemaQueryBankDetailArgs = {
  accountNo: Scalars['String']['input'];
  bankCode: Scalars['String']['input'];
};


export type SchemaQueryBmsActionMetricsArgs = {
  days?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsActionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsAiCreditLedgerArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsAiFailureSummaryArgs = {
  days?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsAiQualityCaseArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsAiQualityCasesArgs = {
  days?: InputMaybe<Scalars['Int']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  outcome: InputMaybe<Scalars['String']['input']>;
  source: InputMaybe<Scalars['String']['input']>;
  status: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsAiQualityMetricsArgs = {
  days?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsAiSynonymCandidatesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  status?: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsAiUsageBreakdownArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsAiUsageEventsArgs = {
  evalRef: InputMaybe<Scalars['String']['input']>;
  feature: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsArAccountArgs = {
  customerId: InputMaybe<Scalars['ID']['input']>;
  id: InputMaybe<Scalars['ID']['input']>;
};


export type SchemaQueryBmsArAccountsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
  status: InputMaybe<Scalars['String']['input']>;
  withBalanceOnly: InputMaybe<Scalars['Boolean']['input']>;
};


export type SchemaQueryBmsArInvoicesArgs = {
  accountId: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  openOnly: InputMaybe<Scalars['Boolean']['input']>;
  overdueOnly: InputMaybe<Scalars['Boolean']['input']>;
};


export type SchemaQueryBmsArLedgerArgs = {
  accountId: InputMaybe<Scalars['ID']['input']>;
  invoiceId: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsAuditLogArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsCommissionReportArgs = {
  from: Scalars['String']['input'];
  to: Scalars['String']['input'];
};


export type SchemaQueryBmsConversationArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsConversationTimelineArgs = {
  id: Scalars['ID']['input'];
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsConversationsArgs = {
  assignedTo: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
  status: InputMaybe<SchemaBmsConvStatus>;
  tag: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsCouponRedemptionsArgs = {
  couponId: Scalars['ID']['input'];
};


export type SchemaQueryBmsCustomerArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsCustomer360Args = {
  channel: InputMaybe<Scalars['String']['input']>;
  conversationId: InputMaybe<Scalars['ID']['input']>;
  customerId: InputMaybe<Scalars['ID']['input']>;
  customerRef: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsCustomerInsightsArgs = {
  customerId: Scalars['ID']['input'];
};


export type SchemaQueryBmsCustomerTimelineArgs = {
  customerId: Scalars['ID']['input'];
};


export type SchemaQueryBmsCustomersArgs = {
  enrolledLocationId: InputMaybe<Scalars['ID']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsEtaxSubmissionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  status: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsExpiringLotsArgs = {
  withinDays?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsFollowupAnalyticsArgs = {
  windowDays: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsFollowupHistoryArgs = {
  conversationId: InputMaybe<Scalars['ID']['input']>;
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsFollowupQueueArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsGenerateInvoiceArgs = {
  orderId: Scalars['ID']['input'];
};


export type SchemaQueryBmsGeneratedReportsArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsInventoryActionCenterArgs = {
  coverageDays?: InputMaybe<Scalars['Int']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  windowDays?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsInventoryLotsArgs = {
  locationId: InputMaybe<Scalars['ID']['input']>;
  productSku: InputMaybe<Scalars['String']['input']>;
  size: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsInventoryWastageArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsKitchenStationsArgs = {
  includeInactive?: InputMaybe<Scalars['Boolean']['input']>;
  locationId: InputMaybe<Scalars['ID']['input']>;
};


export type SchemaQueryBmsKitchenTicketsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  status: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsLotRecallArgs = {
  lotId: Scalars['ID']['input'];
};


export type SchemaQueryBmsLoyaltyActivityArgs = {
  months: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsLoyaltyLedgerArgs = {
  customerId: Scalars['ID']['input'];
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsMailLogArgs = {
  category: InputMaybe<Scalars['String']['input']>;
  page: InputMaybe<Scalars['Int']['input']>;
  pageSize: InputMaybe<Scalars['Int']['input']>;
  provider: InputMaybe<Scalars['String']['input']>;
  q: InputMaybe<Scalars['String']['input']>;
  status: InputMaybe<Scalars['String']['input']>;
  tenantId: InputMaybe<Scalars['ID']['input']>;
};


export type SchemaQueryBmsMailLogEntryArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsMemberArgs = {
  customerId: Scalars['ID']['input'];
};


export type SchemaQueryBmsMemberDiscountPreviewArgs = {
  couponDiscount: InputMaybe<Scalars['Float']['input']>;
  customerId: InputMaybe<Scalars['ID']['input']>;
  pointsToRedeem: InputMaybe<Scalars['Int']['input']>;
  subtotal: Scalars['Float']['input'];
};


export type SchemaQueryBmsMembersArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsMembersExpiringPointsArgs = {
  days: InputMaybe<Scalars['Int']['input']>;
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsMembershipTiersArgs = {
  activeOnly: InputMaybe<Scalars['Boolean']['input']>;
};


export type SchemaQueryBmsMyMentionsArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
  unreadOnly: InputMaybe<Scalars['Boolean']['input']>;
};


export type SchemaQueryBmsOrderArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsOrderJourneyArgs = {
  orderId: Scalars['ID']['input'];
};


export type SchemaQueryBmsOrdersArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  locationId: InputMaybe<Scalars['ID']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
  status: InputMaybe<SchemaBmsOrderStatus>;
};


export type SchemaQueryBmsPaymentArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsPaymentsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderId: InputMaybe<Scalars['ID']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
  status: InputMaybe<SchemaBmsPaymentStatus>;
};


export type SchemaQueryBmsPharmacistCounterAuthorizationsArgs = {
  from: InputMaybe<Scalars['String']['input']>;
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
  to: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsPharmacyAssessmentArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsPharmacyAssessmentConversationHistoryArgs = {
  assessmentId: Scalars['ID']['input'];
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsPharmacyAssessmentEventsArgs = {
  assessmentId: Scalars['ID']['input'];
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsPharmacyAssessmentsArgs = {
  assignedPharmacistId: InputMaybe<Scalars['ID']['input']>;
  channelId: InputMaybe<Scalars['String']['input']>;
  createdAfter: InputMaybe<Scalars['String']['input']>;
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
  riskLevel: InputMaybe<Scalars['String']['input']>;
  status: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsPharmacyCatalogArgs = {
  assessmentId: InputMaybe<Scalars['ID']['input']>;
  limit: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsPharmacyClinicalEvidenceArgs = {
  assessmentId: Scalars['ID']['input'];
};


export type SchemaQueryBmsPharmacyProductPoliciesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsPharmacyProtocolArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsPosArAccountArgs = {
  credentials: SchemaBmsPosCredentialsInput;
  customerId: Scalars['ID']['input'];
};


export type SchemaQueryBmsPosCatalogSearchArgs = {
  q?: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsPosDepositsArgs = {
  q: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsPosExpensesArgs = {
  credentials: SchemaBmsPosCredentialsInput;
};


export type SchemaQueryBmsPosKitchenTicketsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  status: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsPosMemberPreviewArgs = {
  input: SchemaBmsPosMemberPreviewInput;
};


export type SchemaQueryBmsPosMemberSearchArgs = {
  amount: InputMaybe<Scalars['Float']['input']>;
  q: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsPosOpenShiftArgs = {
  deviceId: Scalars['ID']['input'];
};


export type SchemaQueryBmsPosPurchaseOrderArgs = {
  credentials: SchemaBmsPosCredentialsInput;
  poId: Scalars['ID']['input'];
};


export type SchemaQueryBmsPosPurchaseOrdersArgs = {
  credentials: SchemaBmsPosCredentialsInput;
};


export type SchemaQueryBmsPosRecentSalesArgs = {
  deviceOnly?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  q: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsPosRestaurantCheckArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsPosRestaurantRequestsArgs = {
  credentials: SchemaBmsPosCredentialsInput;
};


export type SchemaQueryBmsPosReturnAuditSummaryArgs = {
  from: InputMaybe<Scalars['String']['input']>;
  to: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsPosReturnSummaryArgs = {
  from: InputMaybe<Scalars['String']['input']>;
  to: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsPosScanArgs = {
  code: Scalars['String']['input'];
  packCode: InputMaybe<Scalars['String']['input']>;
  size: InputMaybe<Scalars['String']['input']>;
  surface: InputMaybe<Scalars['String']['input']>;
  withImage?: InputMaybe<Scalars['Boolean']['input']>;
};


export type SchemaQueryBmsPosShiftHistoryArgs = {
  credentials: SchemaBmsPosCredentialsInput;
};


export type SchemaQueryBmsPosShiftReportArgs = {
  credentials: SchemaBmsPosCredentialsInput;
  shiftId: InputMaybe<Scalars['ID']['input']>;
};


export type SchemaQueryBmsPosStoreCreditArgs = {
  code: Scalars['String']['input'];
  credentials: SchemaBmsPosCredentialsInput;
};


export type SchemaQueryBmsProductBundleItemsArgs = {
  bundleSku: Scalars['String']['input'];
};


export type SchemaQueryBmsProductBySkuArgs = {
  sku: Scalars['String']['input'];
};


export type SchemaQueryBmsProductModifiersArgs = {
  productSku: Scalars['String']['input'];
  size: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsProductPacksArgs = {
  productSku: Scalars['String']['input'];
};


export type SchemaQueryBmsProductPriceTiersArgs = {
  locationId: InputMaybe<Scalars['ID']['input']>;
  productSku: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsProductPromotionsArgs = {
  includeInactive?: InputMaybe<Scalars['Boolean']['input']>;
  locationId: InputMaybe<Scalars['ID']['input']>;
  productSku: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsProductReadinessArgs = {
  productSku: Scalars['String']['input'];
};


export type SchemaQueryBmsProductRecipesArgs = {
  productSku: Scalars['String']['input'];
  size: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsProductStockPolicyArgs = {
  productSku: Scalars['String']['input'];
};


export type SchemaQueryBmsProductsArgs = {
  category: InputMaybe<Scalars['String']['input']>;
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsProductsNeedingBarcodesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsProductsNeedingPolicyReviewArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsPurchaseOrderArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsPurchaseOrdersArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsReportDeliveriesArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsReportDeliveriesForTenantArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
  tenantId: Scalars['ID']['input'];
};


export type SchemaQueryBmsRestaurantFloorAdminArgs = {
  locationId: Scalars['ID']['input'];
};


export type SchemaQueryBmsRestaurantTableQrArgs = {
  tableId: Scalars['ID']['input'];
};


export type SchemaQueryBmsRestockDeliveriesArgs = {
  subscriptionId: Scalars['ID']['input'];
};


export type SchemaQueryBmsRestockMetricsArgs = {
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsRestockStatusCountsArgs = {
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsRestockSubscriptionsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
  status: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsRetentionCasesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsRevisionCompareArgs = {
  fromRevisionId: Scalars['ID']['input'];
  kind: SchemaBmsRevisionKind;
  toRevisionId: Scalars['ID']['input'];
};


export type SchemaQueryBmsRevisionDetailArgs = {
  kind: SchemaBmsRevisionKind;
  revisionId: Scalars['ID']['input'];
};


export type SchemaQueryBmsRevisionHistoryArgs = {
  entityId: Scalars['ID']['input'];
  kind: SchemaBmsRevisionKind;
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryBmsSalesSummaryArgs = {
  from: InputMaybe<Scalars['String']['input']>;
  to: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsShipmentArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsShipmentLabelArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryBmsShipmentTrackingEventsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  shipmentId: Scalars['ID']['input'];
};


export type SchemaQueryBmsShipmentsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  orderId: InputMaybe<Scalars['ID']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
  status: InputMaybe<SchemaBmsShipmentStatus>;
};


export type SchemaQueryBmsStockCountsArgs = {
  status: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsStockMovementsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  size: InputMaybe<Scalars['String']['input']>;
  sku: Scalars['String']['input'];
};


export type SchemaQueryBmsStockTransfersArgs = {
  status: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsStoreCreditArgs = {
  code: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsSupplierProductsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
  supplierId: Scalars['ID']['input'];
};


export type SchemaQueryBmsSupportTicketsArgs = {
  page: InputMaybe<Scalars['Int']['input']>;
  pageSize: InputMaybe<Scalars['Int']['input']>;
  q: InputMaybe<Scalars['String']['input']>;
  status: InputMaybe<Scalars['String']['input']>;
  topic: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsTaxDocumentsArgs = {
  orderId: Scalars['ID']['input'];
};


export type SchemaQueryBmsTopSellingProductsArgs = {
  from: InputMaybe<Scalars['String']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  to: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryBmsVariantReservationsArgs = {
  size: InputMaybe<Scalars['String']['input']>;
  sku: Scalars['String']['input'];
};


export type SchemaQueryCommentsArgs = {
  post_id: Scalars['ID']['input'];
};


export type SchemaQueryFilesPagedArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryGetCallLogsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryGetOrCreateDmArgs = {
  user_id: Scalars['ID']['input'];
};


export type SchemaQueryGetPhoneInfoArgs = {
  phone: Scalars['String']['input'];
};


export type SchemaQueryGetSpamNumbersArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  minRisk?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryGlobalSearchArgs = {
  q: Scalars['String']['input'];
};


export type SchemaQueryGlobalSearchUnifiedArgs = {
  limit?: Scalars['Int']['input'];
  q: Scalars['String']['input'];
};


export type SchemaQueryLatestPostsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryLatestUsersArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryMessagesArgs = {
  chat_id: Scalars['ID']['input'];
  includeDeleted: InputMaybe<Scalars['Boolean']['input']>;
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryMessagesConnectionArgs = {
  chat_id: Scalars['ID']['input'];
  cursor: InputMaybe<Scalars['String']['input']>;
  includeDeleted: InputMaybe<Scalars['Boolean']['input']>;
  limit?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryMyBlockedPhonesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryMyBookmarksArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryMyChatSettingsArgs = {
  chat_id: Scalars['ID']['input'];
};


export type SchemaQueryMyNotificationsArgs = {
  limit: InputMaybe<Scalars['Int']['input']>;
  offset: InputMaybe<Scalars['Int']['input']>;
};


export type SchemaQueryMyPostsArgs = {
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryMyReportedBankAccountsArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


export type SchemaQueryMyReportedPhonesArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
};


export type SchemaQueryPhoneCenterSearchArgs = {
  filter?: InputMaybe<SchemaPhoneCenterFilter>;
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  q: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryPhoneDetailArgs = {
  phone: Scalars['String']['input'];
};


export type SchemaQueryPhoneSafetyStatusArgs = {
  phone: Scalars['String']['input'];
};


export type SchemaQueryPostArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryPostsArgs = {
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryPostsByUserIdArgs = {
  user_id: Scalars['ID']['input'];
};


export type SchemaQueryPostsPagedArgs = {
  limit: Scalars['Int']['input'];
  offset: Scalars['Int']['input'];
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryRelatedPostsByBankArgs = {
  accountNo: Scalars['String']['input'];
  bankCode: Scalars['String']['input'];
  sort?: InputMaybe<SchemaRelatedPostsSort>;
};


export type SchemaQueryRelatedPostsByPhoneArgs = {
  phone: Scalars['String']['input'];
  sort?: InputMaybe<SchemaRelatedPostsSort>;
};


export type SchemaQueryRoleArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryScamPhonesDeltaArgs = {
  cursor: InputMaybe<Scalars['String']['input']>;
  limit?: Scalars['Int']['input'];
  sinceVersion: Scalars['String']['input'];
};


export type SchemaQueryScamPhonesSnapshotArgs = {
  cursor: InputMaybe<Scalars['String']['input']>;
  limit?: Scalars['Int']['input'];
};


export type SchemaQuerySearchBankAccountsArgs = {
  limit?: Scalars['Int']['input'];
  q: Scalars['String']['input'];
};


export type SchemaQuerySearchScamBankAccountsArgs = {
  limit?: Scalars['Int']['input'];
  q: Scalars['String']['input'];
};


export type SchemaQuerySearchScamPhonesArgs = {
  limit?: Scalars['Int']['input'];
  q: Scalars['String']['input'];
};


export type SchemaQueryUnreadCountArgs = {
  chatId: Scalars['ID']['input'];
};


export type SchemaQueryUserArgs = {
  id: Scalars['ID']['input'];
};


export type SchemaQueryUsersArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  search: InputMaybe<Scalars['String']['input']>;
};


export type SchemaQueryWhoReadArgs = {
  messageId: Scalars['ID']['input'];
};

export type SchemaRealtimeEvent = {
  __typename?: 'RealtimeEvent';
  actorId: Maybe<Scalars['ID']['output']>;
  actorType: Scalars['String']['output'];
  aggregateVersion: Maybe<Scalars['Float']['output']>;
  deviceId: Maybe<Scalars['ID']['output']>;
  entityId: Scalars['ID']['output'];
  entityType: Scalars['String']['output'];
  eventId: Scalars['ID']['output'];
  eventType: Scalars['String']['output'];
  locationId: Maybe<Scalars['ID']['output']>;
  occurredAt: Scalars['String']['output'];
  payload: Maybe<Scalars['JSON']['output']>;
  schemaVersion: Scalars['Int']['output'];
  tenantId: Scalars['ID']['output'];
  updatedAt: Maybe<Scalars['String']['output']>;
  userId: Maybe<Scalars['ID']['output']>;
};

export type SchemaRegisterInput = {
  agree: InputMaybe<Scalars['Boolean']['input']>;
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
  phone: InputMaybe<Scalars['String']['input']>;
  username: Scalars['String']['input'];
};

export type SchemaRegisterPushTokenInput = {
  appVersion: InputMaybe<Scalars['String']['input']>;
  deviceId: InputMaybe<Scalars['String']['input']>;
  fcmToken: Scalars['String']['input'];
  locale: InputMaybe<Scalars['String']['input']>;
  platform: Scalars['String']['input'];
};

export type SchemaRelatedPostsSort =
  | 'HIGHEST_RISK'
  | 'LATEST'
  | 'MOST_REPORTED';

export type SchemaReportBankAccountInput = {
  account_no: Scalars['String']['input'];
  app_version: InputMaybe<Scalars['String']['input']>;
  bank_name: Scalars['String']['input'];
  client_id: Scalars['String']['input'];
  device_model: InputMaybe<Scalars['String']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  os_version: InputMaybe<Scalars['String']['input']>;
};

export type SchemaReportScamBankAccountInput = {
  account: Scalars['String']['input'];
  app_version: InputMaybe<Scalars['String']['input']>;
  bank_name: Scalars['String']['input'];
  client_id: Scalars['String']['input'];
  device_model: InputMaybe<Scalars['String']['input']>;
  note: InputMaybe<Scalars['String']['input']>;
  os_version: InputMaybe<Scalars['String']['input']>;
};

export type SchemaReportScamPhoneInput = {
  app_version: InputMaybe<Scalars['String']['input']>;
  category: InputMaybe<SchemaScamPhoneReportCategory>;
  client_id: Scalars['String']['input'];
  device_model: InputMaybe<Scalars['String']['input']>;
  local_blocked: Scalars['Boolean']['input'];
  note: InputMaybe<Scalars['String']['input']>;
  os_version: InputMaybe<Scalars['String']['input']>;
  phone: Scalars['String']['input'];
};

export type SchemaRole = {
  __typename?: 'Role';
  created_at: Scalars['String']['output'];
  description: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  is_active: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  updated_at: Scalars['String']['output'];
  user_count: Scalars['Int']['output'];
};

export type SchemaScamBankAccount = {
  __typename?: 'ScamBankAccount';
  account: Scalars['String']['output'];
  account_no_masked: Scalars['String']['output'];
  account_norm: Scalars['String']['output'];
  bank_name: Scalars['String']['output'];
  ctx: Maybe<Scalars['JSON']['output']>;
  is_deleted: Scalars['Boolean']['output'];
  last_report_at: Maybe<Scalars['String']['output']>;
  post_ids: Maybe<Array<Scalars['ID']['output']>>;
  report_count: Scalars['Int']['output'];
  risk_level: Scalars['Int']['output'];
  tags: Maybe<Array<Scalars['String']['output']>>;
  updated_at: Scalars['String']['output'];
};

export type SchemaScamPhone = {
  __typename?: 'ScamPhone';
  ctx: Maybe<Scalars['JSON']['output']>;
  is_deleted: Scalars['Boolean']['output'];
  last_report_at: Maybe<Scalars['String']['output']>;
  phone: Scalars['String']['output'];
  post_ids: Array<Scalars['String']['output']>;
  report_count: Scalars['Int']['output'];
  risk_level: Scalars['Int']['output'];
  tags: Array<Scalars['String']['output']>;
  updated_at: Scalars['String']['output'];
};

export type SchemaScamPhoneDeltaPage = {
  __typename?: 'ScamPhoneDeltaPage';
  cursor: Maybe<Scalars['String']['output']>;
  items: Array<SchemaScamPhone>;
};

export type SchemaScamPhoneReportCategory =
  | 'HARASS'
  | 'OTHER'
  | 'SALES'
  | 'SCAM'
  | 'SPAM';

export type SchemaScamPhoneSnapshotPage = {
  __typename?: 'ScamPhoneSnapshotPage';
  cursor: Maybe<Scalars['String']['output']>;
  items: Array<SchemaScamPhone>;
};

export type SchemaSearchBankAccountResult = {
  __typename?: 'SearchBankAccountResult';
  account: Maybe<Scalars['String']['output']>;
  account_no_masked: Scalars['String']['output'];
  bank_name: Scalars['String']['output'];
  ctx: Maybe<Scalars['JSON']['output']>;
  entity_id: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  ids: Array<Scalars['ID']['output']>;
  is_deleted: Scalars['Boolean']['output'];
  last_report_at: Maybe<Scalars['String']['output']>;
  latest_post_id: Maybe<Scalars['ID']['output']>;
  post_count: Scalars['Int']['output'];
  post_ids: Array<Scalars['ID']['output']>;
  report_count: Scalars['Int']['output'];
  risk_level: Maybe<Scalars['Int']['output']>;
  tags: Array<Scalars['String']['output']>;
  updated_at: Maybe<Scalars['String']['output']>;
};

export type SchemaSearchPhoneReportResult = {
  __typename?: 'SearchPhoneReportResult';
  entity_id: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  ids: Array<Scalars['ID']['output']>;
  last_report_at: Maybe<Scalars['String']['output']>;
  phone: Scalars['String']['output'];
  report_count: Scalars['Int']['output'];
};

export type SchemaSearchPostResult = {
  __typename?: 'SearchPostResult';
  created_at: Maybe<Scalars['String']['output']>;
  entity_id: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  snippet: Maybe<Scalars['String']['output']>;
  title: Scalars['String']['output'];
};

export type SchemaSearchType = SchemaSearchBankAccountResult | SchemaSearchPhoneReportResult | SchemaSearchPostResult | SchemaSearchUserResult;

export type SchemaSearchUserResult = {
  __typename?: 'SearchUserResult';
  avatar: Maybe<Scalars['String']['output']>;
  email: Maybe<Scalars['String']['output']>;
  entity_id: Scalars['ID']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  phone: Maybe<Scalars['String']['output']>;
};

export type SchemaSellerAccount = {
  __typename?: 'SellerAccount';
  bank_id: Maybe<Scalars['String']['output']>;
  bank_name: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  seller_account: Maybe<Scalars['String']['output']>;
};

export type SchemaSellerAccountInput = {
  bank_id: Scalars['String']['input'];
  bank_name: Scalars['String']['input'];
  id: InputMaybe<Scalars['ID']['input']>;
  mode: InputMaybe<Scalars['String']['input']>;
  seller_account: InputMaybe<Scalars['String']['input']>;
};

export type SchemaSocialLoginInput = {
  accessToken: Scalars['String']['input'];
  provider: Scalars['String']['input'];
};

export type SchemaStats = {
  __typename?: 'Stats';
  files: Scalars['Int']['output'];
  logs: Scalars['Int']['output'];
  posts: Scalars['Int']['output'];
  users: Scalars['Int']['output'];
};

export type SchemaStatsSummary = {
  __typename?: 'StatsSummary';
  files: Scalars['Int']['output'];
  logs: Scalars['Int']['output'];
  posts: Scalars['Int']['output'];
  users: Scalars['Int']['output'];
};

export type SchemaSubscription = {
  __typename?: 'Subscription';
  bmsDeviceSessionChanged: SchemaRealtimeEvent;
  bmsInboxChanged: SchemaBmsInboxChangedPayload;
  bmsIncomingOrderChanged: SchemaRealtimeEvent;
  bmsInventoryChanged: SchemaRealtimeEvent;
  bmsKitchenTicketChanged: SchemaRealtimeEvent;
  bmsMenuAvailabilityChanged: SchemaRealtimeEvent;
  bmsNotificationCreated: SchemaRealtimeEvent;
  bmsOrderChanged: SchemaRealtimeEvent;
  bmsPaymentChanged: SchemaRealtimeEvent;
  bmsPosOrderChanged: SchemaRealtimeEvent;
  bmsQrOrderChanged: SchemaRealtimeEvent;
  bmsRestaurantCheckChanged: SchemaRealtimeEvent;
  bmsRestaurantFloorChanged: SchemaRealtimeEvent;
  bmsServiceCallChanged: SchemaRealtimeEvent;
  bmsShiftChanged: SchemaRealtimeEvent;
  bmsStockCountChanged: SchemaRealtimeEvent;
  bmsStockTransferChanged: SchemaRealtimeEvent;
  bmsWaitlistChanged: SchemaRealtimeEvent;
  commentAdded: SchemaComment;
  commentDeleted: Scalars['ID']['output'];
  commentUpdated: SchemaComment;
  incomingMessage: SchemaMessage;
  messageAdded: SchemaMessage;
  messageDeleted: Scalars['ID']['output'];
  myBankBlockStatusChanged: SchemaMyBankBlockStatusChangedPayload;
  myBookmarkStatusChanged: SchemaMyBookmarkStatusChangedPayload;
  myContactSpamMarkChanged: SchemaMyContactSpamMarkChangedPayload;
  myContactSpamSettingsChanged: SchemaMyContactSpamSettingsChangedPayload;
  myPhoneBlockStatusChanged: SchemaMyPhoneBlockStatusChangedPayload;
  notificationCreated: SchemaNotification;
  realtimeEvent: SchemaRealtimeEvent;
  time: Scalars['String']['output'];
  userMessageAdded: SchemaMessage;
};


export type SchemaSubscriptionCommentAddedArgs = {
  post_id: Scalars['ID']['input'];
};


export type SchemaSubscriptionCommentDeletedArgs = {
  post_id: Scalars['ID']['input'];
};


export type SchemaSubscriptionCommentUpdatedArgs = {
  post_id: Scalars['ID']['input'];
};


export type SchemaSubscriptionIncomingMessageArgs = {
  user_id: Scalars['ID']['input'];
};


export type SchemaSubscriptionMessageAddedArgs = {
  chat_id: Scalars['ID']['input'];
};


export type SchemaSubscriptionMessageDeletedArgs = {
  chat_id: Scalars['ID']['input'];
};


export type SchemaSubscriptionUserMessageAddedArgs = {
  user_id: Scalars['ID']['input'];
};

export type SchemaSupportTicketInput = {
  email: Scalars['String']['input'];
  message: Scalars['String']['input'];
  name: Scalars['String']['input'];
  pageUrl: InputMaybe<Scalars['String']['input']>;
  phone: InputMaybe<Scalars['String']['input']>;
  ref: InputMaybe<Scalars['String']['input']>;
  subject: Scalars['String']['input'];
  topic: Scalars['String']['input'];
  userAgent: InputMaybe<Scalars['String']['input']>;
};

export type SchemaSupportTicketPayload = {
  __typename?: 'SupportTicketPayload';
  message: Maybe<Scalars['String']['output']>;
  ok: Scalars['Boolean']['output'];
  ticketId: Maybe<Scalars['String']['output']>;
};

export type SchemaTelNumber = {
  __typename?: 'TelNumber';
  id: Scalars['ID']['output'];
  tel: Scalars['String']['output'];
};

export type SchemaTelNumberInput = {
  id: InputMaybe<Scalars['ID']['input']>;
  mode: InputMaybe<Scalars['String']['input']>;
  tel: Scalars['String']['input'];
};

export type SchemaToggleBookmarkResult = {
  __typename?: 'ToggleBookmarkResult';
  executionTime: Maybe<Scalars['String']['output']>;
  isBookmarked: Scalars['Boolean']['output'];
  status: Scalars['Boolean']['output'];
};

export type SchemaUnblockPhoneInput = {
  phone: Scalars['String']['input'];
};

export type SchemaUnblockScamPhoneInput = {
  app_version: InputMaybe<Scalars['String']['input']>;
  client_id: Scalars['String']['input'];
  device_model: InputMaybe<Scalars['String']['input']>;
  os_version: InputMaybe<Scalars['String']['input']>;
  phone: Scalars['String']['input'];
};

export type SchemaUnreportScamBankAccountInput = {
  account: Scalars['String']['input'];
  app_version: InputMaybe<Scalars['String']['input']>;
  bank_name: Scalars['String']['input'];
  client_id: Scalars['String']['input'];
  device_model: InputMaybe<Scalars['String']['input']>;
  os_version: InputMaybe<Scalars['String']['input']>;
  reason: InputMaybe<Scalars['String']['input']>;
};

export type SchemaUpdateRoleInput = {
  description: InputMaybe<Scalars['String']['input']>;
  is_active: InputMaybe<Scalars['Boolean']['input']>;
  name: InputMaybe<Scalars['String']['input']>;
};

export type SchemaUploadDiagnosticsInput = {
  appVersion: InputMaybe<Scalars['String']['input']>;
  buildNumber: InputMaybe<Scalars['String']['input']>;
  callCheckLogsJson: InputMaybe<Scalars['String']['input']>;
  deviceModel: InputMaybe<Scalars['String']['input']>;
  diagnosticsJson: Scalars['String']['input'];
  exportedAt: Scalars['String']['input'];
  osVersion: InputMaybe<Scalars['String']['input']>;
  packageName: InputMaybe<Scalars['String']['input']>;
  platform: Scalars['String']['input'];
  userId: InputMaybe<Scalars['ID']['input']>;
};

export type SchemaUploadDiagnosticsPayload = {
  __typename?: 'UploadDiagnosticsPayload';
  message: Maybe<Scalars['String']['output']>;
  success: Scalars['Boolean']['output'];
  uploadId: Maybe<Scalars['ID']['output']>;
};

export type SchemaUser = {
  __typename?: 'User';
  avatar: Maybe<Scalars['String']['output']>;
  created_at: Scalars['String']['output'];
  email: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  is_platform_admin: Scalars['Boolean']['output'];
  language: Scalars['String']['output'];
  lastLoginAt: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  notifications_enabled: Scalars['Boolean']['output'];
  phone: Maybe<Scalars['String']['output']>;
  role: Scalars['String']['output'];
  roleDetails: Maybe<SchemaRole>;
  role_id: Maybe<Scalars['ID']['output']>;
  tenantName: Maybe<Scalars['String']['output']>;
  themePreference: Maybe<Scalars['String']['output']>;
  username: Scalars['String']['output'];
};

export type SchemaUserConnection = {
  __typename?: 'UserConnection';
  items: Array<SchemaUser>;
  total: Scalars['Int']['output'];
};

export type SchemaUserInput = {
  avatar: InputMaybe<Scalars['String']['input']>;
  email: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  password: InputMaybe<Scalars['String']['input']>;
  phone: InputMaybe<Scalars['String']['input']>;
  role: InputMaybe<Scalars['String']['input']>;
  role_id: InputMaybe<Scalars['ID']['input']>;
};

export type BmsPosCashMovementInput = {
  amount: number;
  approverPin: string | null | undefined;
  approverUserId: string | number | null | undefined;
  cashierUserId: string | number;
  direction: string;
  idempotencyKey: string;
  pin: string;
  reason: string;
};

export type BmsPosCredentialsInput = {
  cashierUserId: string | number;
  pin: string;
};

export type BmsPosExtraLineInput = {
  label: string;
  qty: number | null | undefined;
  unitAmount: number;
};

export type BmsPosKitchenTicketStatusInput = {
  cashierUserId: string | number;
  pin: string;
  status: string;
  ticketId: string | number;
  userId: string | number | null | undefined;
};

export type BmsPosMemberPreviewInput = {
  couponCode: string | null | undefined;
  customerId: string | number | null | undefined;
  manualDiscount: number | null | undefined;
  pointsToRedeem: number | null | undefined;
  subtotal: number;
};

export type BmsPosParkInput = {
  action: string | null | undefined;
  cart: unknown;
  cashierUserId: string | number;
  itemCount: number | null | undefined;
  label: string | null | undefined;
  parkedId: string | number | null | undefined;
  subtotalHint: number | null | undefined;
};

export type BmsPosPaymentInput = {
  amount: number;
  cashTendered: number | null | undefined;
  method: string;
  ref: string | null | undefined;
};

export type BmsPosRestaurantAcceptIncomingOrderInput = {
  cashierUserId: string | number;
  orderId: string | number;
  pin: string;
};

export type BmsPosRestaurantAddCheckItemInput = {
  cashierUserId: string | number;
  kitchenNote: string | null | undefined;
  modifierCodes: Array<string> | null | undefined;
  packCode: string | null | undefined;
  packQty: number;
  pin: string;
  size: string | null | undefined;
  sku: string;
};

export type BmsPosRestaurantCheckCredentialsInput = {
  cashierUserId: string | number;
  pin: string;
};

export type BmsPosRestaurantOpenCheckInput = {
  cashierUserId: string | number;
  guestCount: number | null | undefined;
  note: string | null | undefined;
  pin: string;
  tableId: string | number;
};

export type BmsPosRestaurantSettleCheckInput = {
  cashierUserId: string | number;
  customerId: string | number | null | undefined;
  payments: Array<BmsPosPaymentInput>;
  pin: string;
};

export type BmsPosReturnInput = {
  approvalPin: string | null | undefined;
  approvalUserId: string | number | null | undefined;
  cashierUserId: string | number;
  idempotencyKey: string;
  lines: Array<BmsPosReturnLineInput> | null | undefined;
  mode: string;
  note: string;
  orderId: string | number;
  pin: string;
  preferredRefundMethod: string | null | undefined;
};

export type BmsPosReturnLineInput = {
  orderItemId: number;
  packQty: number;
};

export type BmsPosSaleInput = {
  cashierUserId: string | number;
  couponCode: string | null | undefined;
  creditApproverPin: string | null | undefined;
  creditApproverUserId: string | number | null | undefined;
  customerId: string | number | null | undefined;
  depositCustomerNote: string | null | undefined;
  depositDueAt: string | null | undefined;
  discountApproverPin: string | null | undefined;
  discountApproverUserId: string | number | null | undefined;
  discountReason: string | null | undefined;
  extraLines: Array<BmsPosExtraLineInput> | null | undefined;
  idempotencyKey: string;
  lines: Array<BmsPosSaleLineInput>;
  manualDiscount: number | null | undefined;
  mode: string | null | undefined;
  payments: Array<BmsPosPaymentInput>;
  pharmacistAuthorizationNote: string | null | undefined;
  pharmacistAuthorizerPin: string | null | undefined;
  pharmacistAuthorizerUserId: string | number | null | undefined;
  pharmacyApprovedAssessmentId: string | number | null | undefined;
  pharmacyReviewAssessmentId: string | number | null | undefined;
  pin: string;
  pointsToRedeem: number | null | undefined;
};

export type BmsPosSaleLineInput = {
  baseQty: number | null | undefined;
  modifierCodes: Array<string> | null | undefined;
  packCode: string | null | undefined;
  packPrice: number | null | undefined;
  packQty: number;
  scaleBarcode: string | null | undefined;
  serials: Array<string> | null | undefined;
  size: string;
  sku: string;
  unitName: string | null | undefined;
};

export type BmsPosShiftInput = {
  action: string;
  cashierUserId: string | number;
  countedCash: number | null | undefined;
  note: string | null | undefined;
  openingFloat: number | null | undefined;
  pin: string;
  userId: string | number | null | undefined;
};

export type BmsPosVoidInput = {
  approverPin: string;
  approverUserId: string | number;
  cashierUserId: string | number;
  idempotencyKey: string;
  orderId: string | number;
  pin: string;
  reason: string;
};

export type MobileRealtimeEventFieldsFragment = { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown };

export type PosBootstrapQueryVariables = Exact<{ [key: string]: never; }>;


export type PosBootstrapQuery = { bmsPosSession: { surface: string, businessArchetype: string | null, device: { id: string, code: string, name: string | null, registeredPosNo: string | null, scanner: { mode: string, prefixKey: string, suffixKey: string, maxGapMs: number } }, location: { id: string, name: string, branchCode: string, vatCode: string | null, pharmacistName: string | null } | null, shift: { id: string, locationId: string, deviceId: string, status: string, openedBy: string, openedAt: string, openingFloat: number, countedCash: number | null, expectedCash: number | null, cashVariance: number | null, closedAt: string | null, pharmacistUserId: string | null } | null, shiftReturnSummary: { returnCount: number, returnTotal: number, settledTotal: number, pendingTotal: number, pendingCount: number }, cashiers: Array<{ id: string, name: string | null, email: string | null, role: string | null, isPharmacist: boolean, hasPin: boolean, posOnly: boolean }>, purchaseReceivers: Array<{ id: string, name: string | null, role: string | null, hasPin: boolean }>, approvers: Array<{ id: string, name: string | null, role: string | null, isPharmacist: boolean, hasPin: boolean, approvals: Array<string> }>, kitchenOperators: Array<{ id: string, name: string | null, role: string | null, hasPin: boolean }>, store: { taxId: string | null, receiptLanguageMode: string }, vat: { registered: boolean, priceIncludesVat: boolean, rate: number, calendarEra: string, cashRounding: string } } };

export type VerifyPosCashierMutationVariables = Exact<{
  input: BmsPosCredentialsInput;
}>;


export type VerifyPosCashierMutation = { bmsPosVerifyCashier: { id: string, name: string | null, email: string | null, role: string | null, isPharmacist: boolean, hasPin: boolean, posOnly: boolean } };

export type MobilePosReceiptFieldsFragment = { orderId: string, receiptNo: string | null, billNo: string | null, soldAt: string, total: number, orderStatus: string, locationName: string | null, branchCode: string | null, cashierName: string | null, memberName: string | null, memberNo: string | null, sourceChannel: string, paymentMethod: string | null, paymentRef: string | null, cashTendered: number | null, cashChange: number | null, returnEligible: boolean, returnBlockedReason: string | null, voidedAt: string | null, roundingAmount: number, lines: Array<{ orderItemId: number, sku: string, size: string, receiptName: string, packCode: string, unitName: string, packQty: number, packPrice: number, baseQty: number, lineTotal: number, refundablePackQty: number, returnedPackQty: number }>, payments: Array<{ id: string, method: string, amount: number, ref: string | null, cashTendered: number | null, cashChange: number | null }>, refunds: Array<{ id: string, method: string, amount: number, completedAt: string | null, externalRef: string | null }>, returnEvents: Array<{ id: string, isVoid: boolean, note: string | null, refundAmount: number, returnedAt: string, returnedByName: string | null, approvedByName: string | null, settlementStatus: string, items: Array<{ orderItemId: number, sku: string, size: string, receiptName: string, packQty: number, refundAmount: number }>, refunds: Array<{ id: string, method: string, amount: number, completedAt: string | null, externalRef: string | null, paymentId: string }> }>, discountLines: Array<{ label: string, amount: number }>, vat: { rate: number, taxableAmount: number, exemptAmount: number, netBeforeVat: number, vatAmount: number, roundingAmount: number } | null };

export type MobileRestaurantCheckFieldsFragment = { id: string, tableId: string, tableCode: string, tableName: string, areaName: string, status: string, version: number, guestCount: number, amountDue: number, openedAt: string | null, reservationStatus: string | null, reservationLost: boolean, items: Array<{ id: string, sku: string, size: string, productName: string, packCode: string | null, unitName: string | null, packQty: number, packPrice: number | null, baseQty: number | null, lineAmount: number | null, status: string, kitchenStatus: string | null, kitchenNote: string | null, modifierCodes: Array<string>, modifierNames: Array<string>, roundNo: number | null, sentAt: string | null }> };

export type MobileKitchenTicketFieldsFragment = { id: string, checkId: string | null, orderId: string | null, orderItemId: string, source: string, tableCode: string | null, tableName: string | null, roundNo: number | null, station: string | null, stationId: string | null, status: string, productSku: string, productName: string, size: string, qty: number, packQty: number | null, modifierCodes: Array<string>, kitchenNote: string | null, createdAt: string, updatedAt: string };

export type MobilePosCatalogQueryVariables = Exact<{
  q?: string | null | undefined;
}>;


export type MobilePosCatalogQuery = { bmsPosCatalogSearch: { items: Array<{ sku: string, name: string, price: number, availability: string, availableTotal: number, imageUrl: string | null, availableSizes: Array<{ size: string, available: number, price: number | null }> }> } };

export type MobilePosScanQueryVariables = Exact<{
  code: string;
}>;


export type MobilePosScanQuery = { bmsPosScan: { sku: string, size: string, productName: string, receiptName: string, baseQty: number, packCode: string, unitName: string, packPrice: number, basePrice: number, available: number, serialTracked: boolean, scaleBarcode: string | null, imageUrl: string | null, modifierCodes: Array<{ code: string }> } };

export type MobilePosSalesQueryVariables = Exact<{
  q: string | null | undefined;
  limit?: number | null | undefined;
}>;


export type MobilePosSalesQuery = { bmsPosRecentSales: { sales: Array<{ orderId: string, receiptNo: string | null, billNo: string | null, soldAt: string, total: number, orderStatus: string, locationName: string | null, branchCode: string | null, cashierName: string | null, memberName: string | null, memberNo: string | null, sourceChannel: string, paymentMethod: string | null, paymentRef: string | null, cashTendered: number | null, cashChange: number | null, returnEligible: boolean, returnBlockedReason: string | null, voidedAt: string | null, roundingAmount: number, lines: Array<{ orderItemId: number, sku: string, size: string, receiptName: string, packCode: string, unitName: string, packQty: number, packPrice: number, baseQty: number, lineTotal: number, refundablePackQty: number, returnedPackQty: number }>, payments: Array<{ id: string, method: string, amount: number, ref: string | null, cashTendered: number | null, cashChange: number | null }>, refunds: Array<{ id: string, method: string, amount: number, completedAt: string | null, externalRef: string | null }>, returnEvents: Array<{ id: string, isVoid: boolean, note: string | null, refundAmount: number, returnedAt: string, returnedByName: string | null, approvedByName: string | null, settlementStatus: string, items: Array<{ orderItemId: number, sku: string, size: string, receiptName: string, packQty: number, refundAmount: number }>, refunds: Array<{ id: string, method: string, amount: number, completedAt: string | null, externalRef: string | null, paymentId: string }> }>, discountLines: Array<{ label: string, amount: number }>, vat: { rate: number, taxableAmount: number, exemptAmount: number, netBeforeVat: number, vatAmount: number, roundingAmount: number } | null }> } };

export type MobilePosLastSaleQueryVariables = Exact<{ [key: string]: never; }>;


export type MobilePosLastSaleQuery = { bmsPosLastSale: { orderId: string, receiptNo: string | null, billNo: string | null, soldAt: string, total: number, orderStatus: string, locationName: string | null, branchCode: string | null, cashierName: string | null, memberName: string | null, memberNo: string | null, sourceChannel: string, paymentMethod: string | null, paymentRef: string | null, cashTendered: number | null, cashChange: number | null, returnEligible: boolean, returnBlockedReason: string | null, voidedAt: string | null, roundingAmount: number, lines: Array<{ orderItemId: number, sku: string, size: string, receiptName: string, packCode: string, unitName: string, packQty: number, packPrice: number, baseQty: number, lineTotal: number, refundablePackQty: number, returnedPackQty: number }>, payments: Array<{ id: string, method: string, amount: number, ref: string | null, cashTendered: number | null, cashChange: number | null }>, refunds: Array<{ id: string, method: string, amount: number, completedAt: string | null, externalRef: string | null }>, returnEvents: Array<{ id: string, isVoid: boolean, note: string | null, refundAmount: number, returnedAt: string, returnedByName: string | null, approvedByName: string | null, settlementStatus: string, items: Array<{ orderItemId: number, sku: string, size: string, receiptName: string, packQty: number, refundAmount: number }>, refunds: Array<{ id: string, method: string, amount: number, completedAt: string | null, externalRef: string | null, paymentId: string }> }>, discountLines: Array<{ label: string, amount: number }>, vat: { rate: number, taxableAmount: number, exemptAmount: number, netBeforeVat: number, vatAmount: number, roundingAmount: number } | null } | null };

export type MobilePosParkedSalesQueryVariables = Exact<{ [key: string]: never; }>;


export type MobilePosParkedSalesQuery = { bmsPosParkedSales: { parked: Array<{ id: string, label: string, createdAt: string, itemCount: number, subtotalHint: number, parkedByName: string | null, cart: { version: number, couponCode: string | null, pointsToRedeem: string | null, member: { customerId: string | null, memberNo: string | null, name: string | null, phone: string | null, pointsBalance: number | null, pointsUsable: number | null } | null, lines: Array<{ key: string | null, sku: string | null, size: string | null, productName: string | null, receiptName: string | null, packCode: string | null, unitName: string | null, packQty: number | null, packPrice: number | null, basePrice: number | null, baseQty: number | null, available: number | null, imageUrl: string | null, modifierCodes: Array<string> | null, serialTracked: boolean | null, scaleBarcode: string | null, serials: Array<string> | null }> } | null }> } };

export type MobilePosMembersQueryVariables = Exact<{
  q: string | null | undefined;
  amount: number | null | undefined;
}>;


export type MobilePosMembersQuery = { bmsPosMemberSearch: { members: Array<{ customerId: string, memberNo: string | null, name: string, phone: string | null, pointsBalance: number, pointsUsable: number, memberSince: string | null, tier: { id: string, code: string, name: string, discountType: string, discountValue: number } | null }>, loyalty: { enabled: boolean, block: string | null, pointsForAmount: number | null } } };

export type MobilePosMemberPreviewQueryVariables = Exact<{
  input: BmsPosMemberPreviewInput;
}>;


export type MobilePosMemberPreviewQuery = { bmsPosMemberPreview: { status: string | null, reason: string | null, subtotal: number | null, netTotal: number | null, totalDiscount: number | null, tierDiscount: number | null, tierLabel: string | null, couponDiscount: number | null, couponError: string | null, manualDiscount: number | null, pointsDiscount: number | null, pointsUsed: number | null, pointsWillEarn: number | null, pointsBalance: number | null, member: { customerId: string, memberNo: string | null, name: string, phone: string | null, pointsBalance: number, pointsUsable: number, tier: { id: string, code: string, name: string, discountType: string, discountValue: number } | null } | null } };

export type MobilePosCashMovementsQueryVariables = Exact<{ [key: string]: never; }>;


export type MobilePosCashMovementsQuery = { bmsPosCashMovements: { movements: Array<{ id: string, direction: string, amount: number, reason: string, actorName: string | null, approvedByName: string | null, createdAt: string }> } };

export type MobilePosShiftReportQueryVariables = Exact<{
  credentials: BmsPosCredentialsInput;
  shiftId: string | number;
}>;


export type MobilePosShiftReportQuery = { bmsPosShiftReport: { report: { shiftId: string, status: string, openedAt: string, openedByName: string | null, openingFloat: number, closedAt: string | null, closedByName: string | null, salesTotal: number, billCount: number, discountTotal: number, returnTotal: number, returnCount: number, voidTotal: number, voidCount: number, cashIn: number, cashOut: number, cashRefunds: number, expectedCash: number | null, expectedCashHidden: boolean, countedCash: number | null, cashVariance: number | null, roundingTotal: number, byMethod: Array<{ method: string, amount: number, count: number }>, byCashier: Array<{ cashier: string, amount: number, billCount: number }> } } };

export type MobilePosShiftHistoryQueryVariables = Exact<{
  credentials: BmsPosCredentialsInput;
}>;


export type MobilePosShiftHistoryQuery = { bmsPosShiftHistory: { shifts: Array<{ id: string, status: string, openedAt: string, openedByName: string | null, closedAt: string | null, closedByName: string | null, expectedCash: number | null, countedCash: number | null, cashVariance: number | null }> } };

export type MobileRestaurantFloorQueryVariables = Exact<{ [key: string]: never; }>;


export type MobileRestaurantFloorQuery = { bmsPosRestaurantFloor: { areas: Array<{ id: string, name: string }>, tables: Array<{ id: string, areaId: string, code: string, name: string, seats: number, status: string, active: boolean, blocked: boolean, shape: string, positionX: number, positionY: number, check: { id: string, status: string, version: number, itemCount: number, unsentCount: number, amountDue: number, guestCount: number, openedAt: string | null } | null, checks: Array<{ id: string, status: string, version: number, itemCount: number, unsentCount: number, amountDue: number, guestCount: number, openedAt: string | null }> }> } };

export type MobileRestaurantMenuQueryVariables = Exact<{ [key: string]: never; }>;


export type MobileRestaurantMenuQuery = { bmsPosRestaurantMenu: { items: Array<{ sku: string, name: string, price: number, sellable: boolean, availability: string, availableTotal: number, imageUrl: string | null, kitchenStation: string | null, kitchenStationId: string | null, hasModifiers: boolean, unavailableReason: string | null, unavailableResetsAt: string | null, availableSizes: Array<{ size: string, available: number }> }> } };

export type MobileRestaurantCheckQueryVariables = Exact<{
  id: string | number;
}>;


export type MobileRestaurantCheckQuery = { bmsPosRestaurantCheck: { id: string, tableId: string, tableCode: string, tableName: string, areaName: string, status: string, version: number, guestCount: number, amountDue: number, openedAt: string | null, reservationStatus: string | null, reservationLost: boolean, items: Array<{ id: string, sku: string, size: string, productName: string, packCode: string | null, unitName: string | null, packQty: number, packPrice: number | null, baseQty: number | null, lineAmount: number | null, status: string, kitchenStatus: string | null, kitchenNote: string | null, modifierCodes: Array<string>, modifierNames: Array<string>, roundNo: number | null, sentAt: string | null }> } | null };

export type MobileKitchenTicketsQueryVariables = Exact<{
  status: string | null | undefined;
}>;


export type MobileKitchenTicketsQuery = { bmsPosKitchenTickets: { generatedAt: string, stations: Array<{ id: string, name: string, sortOrder: number }>, stationSlas: Array<{ stationRef: string, warnMinutes: number, lateMinutes: number }>, tickets: Array<{ id: string, checkId: string | null, orderId: string | null, orderItemId: string, source: string, tableCode: string | null, tableName: string | null, roundNo: number | null, station: string | null, stationId: string | null, status: string, productSku: string, productName: string, size: string, qty: number, packQty: number | null, modifierCodes: Array<string>, kitchenNote: string | null, createdAt: string, updatedAt: string }> } };

export type MobileRestaurantIncomingQueryVariables = Exact<{ [key: string]: never; }>;


export type MobileRestaurantIncomingQuery = { bmsPosRestaurantIncoming: { config: { accepting: boolean, paused: boolean, reason: string | null, hours: Array<{ day: number, open: string, close: string }> }, orders: Array<{ id: string, channel: string, customerRef: string | null, status: string, fulfillmentType: string, createdAt: string, promisedAt: string | null, amountDue: number, items: Array<{ orderItemId: number, sku: string, size: string, name: string | null, unitName: string | null, qty: number, modifierCodes: Array<string> | null }> }>, refunds: Array<{ id: string, orderId: string, method: string, amount: number, channel: string, customerRef: string | null, createdAt: string, cancelledBy: string | null }> } };

export type MobilePosSaleMutationVariables = Exact<{
  input: BmsPosSaleInput;
}>;


export type MobilePosSaleMutation = { bmsPosSale: { status: string, reason: string | null, orderId: string | null, receiptNo: string | null, billNo: string | null, subtotal: number | null, discount: number | null, total: number | null, cashTendered: number | null, cashChange: number | null, pointsUsed: number | null, pointsEarned: number | null, pointsBalance: number | null, replayed: boolean | null } };

export type MobilePosReturnMutationVariables = Exact<{
  input: BmsPosReturnInput;
}>;


export type MobilePosReturnMutation = { bmsPosReturn: { status: string, reason: string | null, orderId: string | null, posReturnId: string | null, refundAmount: number | null, settlementStatus: string | null, creditNoteNo: string | null, replayed: boolean | null } };

export type MobilePosVoidMutationVariables = Exact<{
  input: BmsPosVoidInput;
}>;


export type MobilePosVoidMutation = { bmsPosVoid: { status: string, reason: string | null, orderId: string | null, posReturnId: string | null, refundAmount: number | null, settlementStatus: string | null, creditNoteNo: string | null, replayed: boolean | null } };

export type MobilePosShiftMutationVariables = Exact<{
  input: BmsPosShiftInput;
}>;


export type MobilePosShiftMutation = { bmsPosShift: { status: string, reason: string | null, shift: { id: string, locationId: string, deviceId: string, status: string, openedBy: string, openedAt: string, openingFloat: number, countedCash: number | null, expectedCash: number | null, cashVariance: number | null, closedAt: string | null, pharmacistUserId: string | null } | null } };

export type MobilePosCashMovementMutationVariables = Exact<{
  input: BmsPosCashMovementInput;
}>;


export type MobilePosCashMovementMutation = { bmsPosCashMovement: { status: string, reason: string | null, replayed: boolean | null, drawerAfter: number | null, available: number | null, movement: { id: string, direction: string, amount: number, reason: string, actorName: string | null, approvedByName: string | null, createdAt: string } | null } };

export type MobilePosParkMutationVariables = Exact<{
  input: BmsPosParkInput;
}>;


export type MobilePosParkMutation = { bmsPosPark: { status: string, reason: string | null, label: string | null, parked: { id: string, label: string, createdAt: string, itemCount: number, subtotalHint: number } | null } };

export type MobileRestaurantOpenCheckMutationVariables = Exact<{
  input: BmsPosRestaurantOpenCheckInput;
}>;


export type MobileRestaurantOpenCheckMutation = { bmsPosRestaurantOpenCheck: { check: { id: string, tableId: string, tableCode: string, tableName: string, areaName: string, status: string, version: number, guestCount: number, amountDue: number, openedAt: string | null, reservationStatus: string | null, reservationLost: boolean, items: Array<{ id: string, sku: string, size: string, productName: string, packCode: string | null, unitName: string | null, packQty: number, packPrice: number | null, baseQty: number | null, lineAmount: number | null, status: string, kitchenStatus: string | null, kitchenNote: string | null, modifierCodes: Array<string>, modifierNames: Array<string>, roundNo: number | null, sentAt: string | null }> } | null } };

export type MobileRestaurantAddCheckItemMutationVariables = Exact<{
  checkId: string | number;
  input: BmsPosRestaurantAddCheckItemInput;
}>;


export type MobileRestaurantAddCheckItemMutation = { bmsPosRestaurantAddCheckItem: { status: string | null, reason: string | null, available: number | null, expected: number | null, requested: number | null, check: { id: string, tableId: string, tableCode: string, tableName: string, areaName: string, status: string, version: number, guestCount: number, amountDue: number, openedAt: string | null, reservationStatus: string | null, reservationLost: boolean, items: Array<{ id: string, sku: string, size: string, productName: string, packCode: string | null, unitName: string | null, packQty: number, packPrice: number | null, baseQty: number | null, lineAmount: number | null, status: string, kitchenStatus: string | null, kitchenNote: string | null, modifierCodes: Array<string>, modifierNames: Array<string>, roundNo: number | null, sentAt: string | null }> } | null } };

export type MobileRestaurantRemoveCheckItemMutationVariables = Exact<{
  checkId: string | number;
  itemId: string | number;
  credentials: BmsPosRestaurantCheckCredentialsInput;
}>;


export type MobileRestaurantRemoveCheckItemMutation = { bmsPosRestaurantRemoveCheckItem: { status: string | null, reason: string | null, check: { id: string, tableId: string, tableCode: string, tableName: string, areaName: string, status: string, version: number, guestCount: number, amountDue: number, openedAt: string | null, reservationStatus: string | null, reservationLost: boolean, items: Array<{ id: string, sku: string, size: string, productName: string, packCode: string | null, unitName: string | null, packQty: number, packPrice: number | null, baseQty: number | null, lineAmount: number | null, status: string, kitchenStatus: string | null, kitchenNote: string | null, modifierCodes: Array<string>, modifierNames: Array<string>, roundNo: number | null, sentAt: string | null }> } | null } };

export type MobileRestaurantSendCheckMutationVariables = Exact<{
  checkId: string | number;
  credentials: BmsPosRestaurantCheckCredentialsInput;
}>;


export type MobileRestaurantSendCheckMutation = { bmsPosRestaurantSendCheckToKitchen: { status: string | null, reason: string | null, kitchenTickets: number | null, check: { id: string, tableId: string, tableCode: string, tableName: string, areaName: string, status: string, version: number, guestCount: number, amountDue: number, openedAt: string | null, reservationStatus: string | null, reservationLost: boolean, items: Array<{ id: string, sku: string, size: string, productName: string, packCode: string | null, unitName: string | null, packQty: number, packPrice: number | null, baseQty: number | null, lineAmount: number | null, status: string, kitchenStatus: string | null, kitchenNote: string | null, modifierCodes: Array<string>, modifierNames: Array<string>, roundNo: number | null, sentAt: string | null }> } | null } };

export type MobileRestaurantSettleCheckMutationVariables = Exact<{
  checkId: string | number;
  input: BmsPosRestaurantSettleCheckInput;
}>;


export type MobileRestaurantSettleCheckMutation = { bmsPosRestaurantSettleCheck: { status: string | null, reason: string | null, orderId: string | null, receiptNo: string | null, billNo: string | null, total: number | null, cashTendered: number | null, cashChange: number | null, replayed: boolean | null, check: { id: string, tableId: string, tableCode: string, tableName: string, areaName: string, status: string, version: number, guestCount: number, amountDue: number, openedAt: string | null, reservationStatus: string | null, reservationLost: boolean, items: Array<{ id: string, sku: string, size: string, productName: string, packCode: string | null, unitName: string | null, packQty: number, packPrice: number | null, baseQty: number | null, lineAmount: number | null, status: string, kitchenStatus: string | null, kitchenNote: string | null, modifierCodes: Array<string>, modifierNames: Array<string>, roundNo: number | null, sentAt: string | null }> } | null } };

export type MobileKitchenTicketStatusMutationVariables = Exact<{
  input: BmsPosKitchenTicketStatusInput;
}>;


export type MobileKitchenTicketStatusMutation = { bmsPosKitchenTicketStatus: { status: string | null, reason: string | null, ticket: { id: string, checkId: string | null, orderId: string | null, orderItemId: string, source: string, tableCode: string | null, tableName: string | null, roundNo: number | null, station: string | null, stationId: string | null, status: string, productSku: string, productName: string, size: string, qty: number, packQty: number | null, modifierCodes: Array<string>, kitchenNote: string | null, createdAt: string, updatedAt: string } | null } };

export type MobileRestaurantAcceptIncomingMutationVariables = Exact<{
  input: BmsPosRestaurantAcceptIncomingOrderInput;
}>;


export type MobileRestaurantAcceptIncomingMutation = { bmsPosRestaurantAcceptIncomingOrder: { status: string | null, reason: string | null, ticketsCreated: number | null, replayed: boolean | null } };

export type MobileDeviceSessionChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileDeviceSessionChangedSubscription = { bmsDeviceSessionChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileShiftChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileShiftChangedSubscription = { bmsShiftChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobilePosOrderChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobilePosOrderChangedSubscription = { bmsPosOrderChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileRestaurantFloorChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileRestaurantFloorChangedSubscription = { bmsRestaurantFloorChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileRestaurantCheckChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileRestaurantCheckChangedSubscription = { bmsRestaurantCheckChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileKitchenTicketChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileKitchenTicketChangedSubscription = { bmsKitchenTicketChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileMenuAvailabilityChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileMenuAvailabilityChangedSubscription = { bmsMenuAvailabilityChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileQrOrderChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileQrOrderChangedSubscription = { bmsQrOrderChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileIncomingOrderChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileIncomingOrderChangedSubscription = { bmsIncomingOrderChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileWaitlistChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileWaitlistChangedSubscription = { bmsWaitlistChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileServiceCallChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileServiceCallChangedSubscription = { bmsServiceCallChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileInventoryChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileInventoryChangedSubscription = { bmsInventoryChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileStockTransferChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileStockTransferChangedSubscription = { bmsStockTransferChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileStockCountChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileStockCountChangedSubscription = { bmsStockCountChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobilePaymentChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobilePaymentChangedSubscription = { bmsPaymentChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export type MobileOrderChangedSubscriptionVariables = Exact<{ [key: string]: never; }>;


export type MobileOrderChangedSubscription = { bmsOrderChanged: { eventId: string, eventType: string, schemaVersion: number, tenantId: string, locationId: string | null, userId: string | null, actorType: string, actorId: string | null, deviceId: string | null, entityType: string, entityId: string, aggregateVersion: number | null, updatedAt: string | null, occurredAt: string, payload: unknown } };

export const MobileRealtimeEventFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileRealtimeEventFieldsFragment, unknown>;
export const MobilePosReceiptFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobilePosReceiptFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosReceipt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orderId"}},{"kind":"Field","name":{"kind":"Name","value":"receiptNo"}},{"kind":"Field","name":{"kind":"Name","value":"billNo"}},{"kind":"Field","name":{"kind":"Name","value":"soldAt"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"orderStatus"}},{"kind":"Field","name":{"kind":"Name","value":"locationName"}},{"kind":"Field","name":{"kind":"Name","value":"branchCode"}},{"kind":"Field","name":{"kind":"Name","value":"cashierName"}},{"kind":"Field","name":{"kind":"Name","value":"memberName"}},{"kind":"Field","name":{"kind":"Name","value":"memberNo"}},{"kind":"Field","name":{"kind":"Name","value":"sourceChannel"}},{"kind":"Field","name":{"kind":"Name","value":"paymentMethod"}},{"kind":"Field","name":{"kind":"Name","value":"paymentRef"}},{"kind":"Field","name":{"kind":"Name","value":"cashTendered"}},{"kind":"Field","name":{"kind":"Name","value":"cashChange"}},{"kind":"Field","name":{"kind":"Name","value":"returnEligible"}},{"kind":"Field","name":{"kind":"Name","value":"returnBlockedReason"}},{"kind":"Field","name":{"kind":"Name","value":"voidedAt"}},{"kind":"Field","name":{"kind":"Name","value":"roundingAmount"}},{"kind":"Field","name":{"kind":"Name","value":"lines"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orderItemId"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"receiptName"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"lineTotal"}},{"kind":"Field","name":{"kind":"Name","value":"refundablePackQty"}},{"kind":"Field","name":{"kind":"Name","value":"returnedPackQty"}}]}},{"kind":"Field","name":{"kind":"Name","value":"payments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"ref"}},{"kind":"Field","name":{"kind":"Name","value":"cashTendered"}},{"kind":"Field","name":{"kind":"Name","value":"cashChange"}}]}},{"kind":"Field","name":{"kind":"Name","value":"refunds"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"externalRef"}}]}},{"kind":"Field","name":{"kind":"Name","value":"returnEvents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"isVoid"}},{"kind":"Field","name":{"kind":"Name","value":"note"}},{"kind":"Field","name":{"kind":"Name","value":"refundAmount"}},{"kind":"Field","name":{"kind":"Name","value":"returnedAt"}},{"kind":"Field","name":{"kind":"Name","value":"returnedByName"}},{"kind":"Field","name":{"kind":"Name","value":"approvedByName"}},{"kind":"Field","name":{"kind":"Name","value":"settlementStatus"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orderItemId"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"receiptName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"refundAmount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"refunds"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"externalRef"}},{"kind":"Field","name":{"kind":"Name","value":"paymentId"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"discountLines"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"vat"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rate"}},{"kind":"Field","name":{"kind":"Name","value":"taxableAmount"}},{"kind":"Field","name":{"kind":"Name","value":"exemptAmount"}},{"kind":"Field","name":{"kind":"Name","value":"netBeforeVat"}},{"kind":"Field","name":{"kind":"Name","value":"vatAmount"}},{"kind":"Field","name":{"kind":"Name","value":"roundingAmount"}}]}}]}}]} as unknown as DocumentNode<MobilePosReceiptFieldsFragment, unknown>;
export const MobileRestaurantCheckFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRestaurantCheckFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantCheck"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tableId"}},{"kind":"Field","name":{"kind":"Name","value":"tableCode"}},{"kind":"Field","name":{"kind":"Name","value":"tableName"}},{"kind":"Field","name":{"kind":"Name","value":"areaName"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"guestCount"}},{"kind":"Field","name":{"kind":"Name","value":"amountDue"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"reservationStatus"}},{"kind":"Field","name":{"kind":"Name","value":"reservationLost"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"lineAmount"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenStatus"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenNote"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}},{"kind":"Field","name":{"kind":"Name","value":"modifierNames"}},{"kind":"Field","name":{"kind":"Name","value":"roundNo"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}}]}}]}}]} as unknown as DocumentNode<MobileRestaurantCheckFieldsFragment, unknown>;
export const MobileKitchenTicketFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileKitchenTicketFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsKitchenTicket"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"checkId"}},{"kind":"Field","name":{"kind":"Name","value":"orderId"}},{"kind":"Field","name":{"kind":"Name","value":"orderItemId"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"tableCode"}},{"kind":"Field","name":{"kind":"Name","value":"tableName"}},{"kind":"Field","name":{"kind":"Name","value":"roundNo"}},{"kind":"Field","name":{"kind":"Name","value":"station"}},{"kind":"Field","name":{"kind":"Name","value":"stationId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"productSku"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"qty"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenNote"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<MobileKitchenTicketFieldsFragment, unknown>;
export const PosBootstrapDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"PosBootstrap"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosSession"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"device"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"code"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"registeredPosNo"}},{"kind":"Field","name":{"kind":"Name","value":"scanner"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"mode"}},{"kind":"Field","name":{"kind":"Name","value":"prefixKey"}},{"kind":"Field","name":{"kind":"Name","value":"suffixKey"}},{"kind":"Field","name":{"kind":"Name","value":"maxGapMs"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"location"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"branchCode"}},{"kind":"Field","name":{"kind":"Name","value":"vatCode"}},{"kind":"Field","name":{"kind":"Name","value":"pharmacistName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"shift"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"openedBy"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"openingFloat"}},{"kind":"Field","name":{"kind":"Name","value":"countedCash"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCash"}},{"kind":"Field","name":{"kind":"Name","value":"cashVariance"}},{"kind":"Field","name":{"kind":"Name","value":"closedAt"}},{"kind":"Field","name":{"kind":"Name","value":"pharmacistUserId"}}]}},{"kind":"Field","name":{"kind":"Name","value":"shiftReturnSummary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"returnCount"}},{"kind":"Field","name":{"kind":"Name","value":"returnTotal"}},{"kind":"Field","name":{"kind":"Name","value":"settledTotal"}},{"kind":"Field","name":{"kind":"Name","value":"pendingTotal"}},{"kind":"Field","name":{"kind":"Name","value":"pendingCount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"cashiers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"isPharmacist"}},{"kind":"Field","name":{"kind":"Name","value":"hasPin"}},{"kind":"Field","name":{"kind":"Name","value":"posOnly"}}]}},{"kind":"Field","name":{"kind":"Name","value":"purchaseReceivers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"hasPin"}}]}},{"kind":"Field","name":{"kind":"Name","value":"approvers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"isPharmacist"}},{"kind":"Field","name":{"kind":"Name","value":"hasPin"}},{"kind":"Field","name":{"kind":"Name","value":"approvals"}}]}},{"kind":"Field","name":{"kind":"Name","value":"kitchenOperators"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"hasPin"}}]}},{"kind":"Field","name":{"kind":"Name","value":"store"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"taxId"}},{"kind":"Field","name":{"kind":"Name","value":"receiptLanguageMode"}}]}},{"kind":"Field","name":{"kind":"Name","value":"surface"}},{"kind":"Field","name":{"kind":"Name","value":"businessArchetype"}},{"kind":"Field","name":{"kind":"Name","value":"vat"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"registered"}},{"kind":"Field","name":{"kind":"Name","value":"priceIncludesVat"}},{"kind":"Field","name":{"kind":"Name","value":"rate"}},{"kind":"Field","name":{"kind":"Name","value":"calendarEra"}},{"kind":"Field","name":{"kind":"Name","value":"cashRounding"}}]}}]}}]}}]} as unknown as DocumentNode<PosBootstrapQuery, PosBootstrapQueryVariables>;
export const VerifyPosCashierDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"VerifyPosCashier"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosCredentialsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosVerifyCashier"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"isPharmacist"}},{"kind":"Field","name":{"kind":"Name","value":"hasPin"}},{"kind":"Field","name":{"kind":"Name","value":"posOnly"}}]}}]}}]} as unknown as DocumentNode<VerifyPosCashierMutation, VerifyPosCashierMutationVariables>;
export const MobilePosCatalogDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobilePosCatalog"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"q"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}},"defaultValue":{"kind":"StringValue","value":"","block":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosCatalogSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"q"},"value":{"kind":"Variable","name":{"kind":"Name","value":"q"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"availability"}},{"kind":"Field","name":{"kind":"Name","value":"availableTotal"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"availableSizes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"available"}},{"kind":"Field","name":{"kind":"Name","value":"price"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MobilePosCatalogQuery, MobilePosCatalogQueryVariables>;
export const MobilePosScanDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobilePosScan"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"code"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosScan"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"code"},"value":{"kind":"Variable","name":{"kind":"Name","value":"code"}}},{"kind":"Argument","name":{"kind":"Name","value":"surface"},"value":{"kind":"StringValue","value":"POS","block":false}},{"kind":"Argument","name":{"kind":"Name","value":"withImage"},"value":{"kind":"BooleanValue","value":true}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"receiptName"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"basePrice"}},{"kind":"Field","name":{"kind":"Name","value":"available"}},{"kind":"Field","name":{"kind":"Name","value":"serialTracked"}},{"kind":"Field","name":{"kind":"Name","value":"scaleBarcode"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","alias":{"kind":"Name","value":"modifierCodes"},"name":{"kind":"Name","value":"modifiers"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"code"}}]}}]}}]}}]} as unknown as DocumentNode<MobilePosScanQuery, MobilePosScanQueryVariables>;
export const MobilePosSalesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobilePosSales"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"q"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"limit"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}},"defaultValue":{"kind":"IntValue","value":"50"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosRecentSales"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"q"},"value":{"kind":"Variable","name":{"kind":"Name","value":"q"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"Variable","name":{"kind":"Name","value":"limit"}}},{"kind":"Argument","name":{"kind":"Name","value":"deviceOnly"},"value":{"kind":"BooleanValue","value":false}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sales"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobilePosReceiptFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobilePosReceiptFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosReceipt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orderId"}},{"kind":"Field","name":{"kind":"Name","value":"receiptNo"}},{"kind":"Field","name":{"kind":"Name","value":"billNo"}},{"kind":"Field","name":{"kind":"Name","value":"soldAt"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"orderStatus"}},{"kind":"Field","name":{"kind":"Name","value":"locationName"}},{"kind":"Field","name":{"kind":"Name","value":"branchCode"}},{"kind":"Field","name":{"kind":"Name","value":"cashierName"}},{"kind":"Field","name":{"kind":"Name","value":"memberName"}},{"kind":"Field","name":{"kind":"Name","value":"memberNo"}},{"kind":"Field","name":{"kind":"Name","value":"sourceChannel"}},{"kind":"Field","name":{"kind":"Name","value":"paymentMethod"}},{"kind":"Field","name":{"kind":"Name","value":"paymentRef"}},{"kind":"Field","name":{"kind":"Name","value":"cashTendered"}},{"kind":"Field","name":{"kind":"Name","value":"cashChange"}},{"kind":"Field","name":{"kind":"Name","value":"returnEligible"}},{"kind":"Field","name":{"kind":"Name","value":"returnBlockedReason"}},{"kind":"Field","name":{"kind":"Name","value":"voidedAt"}},{"kind":"Field","name":{"kind":"Name","value":"roundingAmount"}},{"kind":"Field","name":{"kind":"Name","value":"lines"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orderItemId"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"receiptName"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"lineTotal"}},{"kind":"Field","name":{"kind":"Name","value":"refundablePackQty"}},{"kind":"Field","name":{"kind":"Name","value":"returnedPackQty"}}]}},{"kind":"Field","name":{"kind":"Name","value":"payments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"ref"}},{"kind":"Field","name":{"kind":"Name","value":"cashTendered"}},{"kind":"Field","name":{"kind":"Name","value":"cashChange"}}]}},{"kind":"Field","name":{"kind":"Name","value":"refunds"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"externalRef"}}]}},{"kind":"Field","name":{"kind":"Name","value":"returnEvents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"isVoid"}},{"kind":"Field","name":{"kind":"Name","value":"note"}},{"kind":"Field","name":{"kind":"Name","value":"refundAmount"}},{"kind":"Field","name":{"kind":"Name","value":"returnedAt"}},{"kind":"Field","name":{"kind":"Name","value":"returnedByName"}},{"kind":"Field","name":{"kind":"Name","value":"approvedByName"}},{"kind":"Field","name":{"kind":"Name","value":"settlementStatus"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orderItemId"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"receiptName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"refundAmount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"refunds"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"externalRef"}},{"kind":"Field","name":{"kind":"Name","value":"paymentId"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"discountLines"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"vat"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rate"}},{"kind":"Field","name":{"kind":"Name","value":"taxableAmount"}},{"kind":"Field","name":{"kind":"Name","value":"exemptAmount"}},{"kind":"Field","name":{"kind":"Name","value":"netBeforeVat"}},{"kind":"Field","name":{"kind":"Name","value":"vatAmount"}},{"kind":"Field","name":{"kind":"Name","value":"roundingAmount"}}]}}]}}]} as unknown as DocumentNode<MobilePosSalesQuery, MobilePosSalesQueryVariables>;
export const MobilePosLastSaleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobilePosLastSale"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosLastSale"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobilePosReceiptFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobilePosReceiptFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosReceipt"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orderId"}},{"kind":"Field","name":{"kind":"Name","value":"receiptNo"}},{"kind":"Field","name":{"kind":"Name","value":"billNo"}},{"kind":"Field","name":{"kind":"Name","value":"soldAt"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"orderStatus"}},{"kind":"Field","name":{"kind":"Name","value":"locationName"}},{"kind":"Field","name":{"kind":"Name","value":"branchCode"}},{"kind":"Field","name":{"kind":"Name","value":"cashierName"}},{"kind":"Field","name":{"kind":"Name","value":"memberName"}},{"kind":"Field","name":{"kind":"Name","value":"memberNo"}},{"kind":"Field","name":{"kind":"Name","value":"sourceChannel"}},{"kind":"Field","name":{"kind":"Name","value":"paymentMethod"}},{"kind":"Field","name":{"kind":"Name","value":"paymentRef"}},{"kind":"Field","name":{"kind":"Name","value":"cashTendered"}},{"kind":"Field","name":{"kind":"Name","value":"cashChange"}},{"kind":"Field","name":{"kind":"Name","value":"returnEligible"}},{"kind":"Field","name":{"kind":"Name","value":"returnBlockedReason"}},{"kind":"Field","name":{"kind":"Name","value":"voidedAt"}},{"kind":"Field","name":{"kind":"Name","value":"roundingAmount"}},{"kind":"Field","name":{"kind":"Name","value":"lines"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orderItemId"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"receiptName"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"lineTotal"}},{"kind":"Field","name":{"kind":"Name","value":"refundablePackQty"}},{"kind":"Field","name":{"kind":"Name","value":"returnedPackQty"}}]}},{"kind":"Field","name":{"kind":"Name","value":"payments"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"ref"}},{"kind":"Field","name":{"kind":"Name","value":"cashTendered"}},{"kind":"Field","name":{"kind":"Name","value":"cashChange"}}]}},{"kind":"Field","name":{"kind":"Name","value":"refunds"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"externalRef"}}]}},{"kind":"Field","name":{"kind":"Name","value":"returnEvents"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"isVoid"}},{"kind":"Field","name":{"kind":"Name","value":"note"}},{"kind":"Field","name":{"kind":"Name","value":"refundAmount"}},{"kind":"Field","name":{"kind":"Name","value":"returnedAt"}},{"kind":"Field","name":{"kind":"Name","value":"returnedByName"}},{"kind":"Field","name":{"kind":"Name","value":"approvedByName"}},{"kind":"Field","name":{"kind":"Name","value":"settlementStatus"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orderItemId"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"receiptName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"refundAmount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"refunds"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"completedAt"}},{"kind":"Field","name":{"kind":"Name","value":"externalRef"}},{"kind":"Field","name":{"kind":"Name","value":"paymentId"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"discountLines"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"vat"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rate"}},{"kind":"Field","name":{"kind":"Name","value":"taxableAmount"}},{"kind":"Field","name":{"kind":"Name","value":"exemptAmount"}},{"kind":"Field","name":{"kind":"Name","value":"netBeforeVat"}},{"kind":"Field","name":{"kind":"Name","value":"vatAmount"}},{"kind":"Field","name":{"kind":"Name","value":"roundingAmount"}}]}}]}}]} as unknown as DocumentNode<MobilePosLastSaleQuery, MobilePosLastSaleQueryVariables>;
export const MobilePosParkedSalesDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobilePosParkedSales"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosParkedSales"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"parked"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"itemCount"}},{"kind":"Field","name":{"kind":"Name","value":"subtotalHint"}},{"kind":"Field","name":{"kind":"Name","value":"parkedByName"}},{"kind":"Field","name":{"kind":"Name","value":"cart"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"couponCode"}},{"kind":"Field","name":{"kind":"Name","value":"pointsToRedeem"}},{"kind":"Field","name":{"kind":"Name","value":"member"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"customerId"}},{"kind":"Field","name":{"kind":"Name","value":"memberNo"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"pointsBalance"}},{"kind":"Field","name":{"kind":"Name","value":"pointsUsable"}}]}},{"kind":"Field","name":{"kind":"Name","value":"lines"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"key"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"receiptName"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"basePrice"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"available"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}},{"kind":"Field","name":{"kind":"Name","value":"serialTracked"}},{"kind":"Field","name":{"kind":"Name","value":"scaleBarcode"}},{"kind":"Field","name":{"kind":"Name","value":"serials"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<MobilePosParkedSalesQuery, MobilePosParkedSalesQueryVariables>;
export const MobilePosMembersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobilePosMembers"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"q"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"amount"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Float"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosMemberSearch"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"q"},"value":{"kind":"Variable","name":{"kind":"Name","value":"q"}}},{"kind":"Argument","name":{"kind":"Name","value":"amount"},"value":{"kind":"Variable","name":{"kind":"Name","value":"amount"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"members"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"customerId"}},{"kind":"Field","name":{"kind":"Name","value":"memberNo"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"pointsBalance"}},{"kind":"Field","name":{"kind":"Name","value":"pointsUsable"}},{"kind":"Field","name":{"kind":"Name","value":"memberSince"}},{"kind":"Field","name":{"kind":"Name","value":"tier"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"code"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"discountType"}},{"kind":"Field","name":{"kind":"Name","value":"discountValue"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"loyalty"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"block"}},{"kind":"Field","name":{"kind":"Name","value":"pointsForAmount"}}]}}]}}]}}]} as unknown as DocumentNode<MobilePosMembersQuery, MobilePosMembersQueryVariables>;
export const MobilePosMemberPreviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobilePosMemberPreview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosMemberPreviewInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosMemberPreview"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"subtotal"}},{"kind":"Field","name":{"kind":"Name","value":"netTotal"}},{"kind":"Field","name":{"kind":"Name","value":"totalDiscount"}},{"kind":"Field","name":{"kind":"Name","value":"tierDiscount"}},{"kind":"Field","name":{"kind":"Name","value":"tierLabel"}},{"kind":"Field","name":{"kind":"Name","value":"couponDiscount"}},{"kind":"Field","name":{"kind":"Name","value":"couponError"}},{"kind":"Field","name":{"kind":"Name","value":"manualDiscount"}},{"kind":"Field","name":{"kind":"Name","value":"pointsDiscount"}},{"kind":"Field","name":{"kind":"Name","value":"pointsUsed"}},{"kind":"Field","name":{"kind":"Name","value":"pointsWillEarn"}},{"kind":"Field","alias":{"kind":"Name","value":"pointsBalance"},"name":{"kind":"Name","value":"cappedAt"}},{"kind":"Field","name":{"kind":"Name","value":"member"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"customerId"}},{"kind":"Field","name":{"kind":"Name","value":"memberNo"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"phone"}},{"kind":"Field","name":{"kind":"Name","value":"pointsBalance"}},{"kind":"Field","name":{"kind":"Name","value":"pointsUsable"}},{"kind":"Field","name":{"kind":"Name","value":"tier"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"code"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"discountType"}},{"kind":"Field","name":{"kind":"Name","value":"discountValue"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MobilePosMemberPreviewQuery, MobilePosMemberPreviewQueryVariables>;
export const MobilePosCashMovementsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobilePosCashMovements"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosCashMovements"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"movements"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"direction"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"actorName"}},{"kind":"Field","name":{"kind":"Name","value":"approvedByName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<MobilePosCashMovementsQuery, MobilePosCashMovementsQueryVariables>;
export const MobilePosShiftReportDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobilePosShiftReport"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosCredentialsInput"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"shiftId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosShiftReport"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentials"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}}},{"kind":"Argument","name":{"kind":"Name","value":"shiftId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"shiftId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"report"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"shiftId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"openedByName"}},{"kind":"Field","name":{"kind":"Name","value":"openingFloat"}},{"kind":"Field","name":{"kind":"Name","value":"closedAt"}},{"kind":"Field","name":{"kind":"Name","value":"closedByName"}},{"kind":"Field","name":{"kind":"Name","value":"salesTotal"}},{"kind":"Field","name":{"kind":"Name","value":"billCount"}},{"kind":"Field","name":{"kind":"Name","value":"discountTotal"}},{"kind":"Field","name":{"kind":"Name","value":"returnTotal"}},{"kind":"Field","name":{"kind":"Name","value":"returnCount"}},{"kind":"Field","name":{"kind":"Name","value":"voidTotal"}},{"kind":"Field","name":{"kind":"Name","value":"voidCount"}},{"kind":"Field","name":{"kind":"Name","value":"cashIn"}},{"kind":"Field","name":{"kind":"Name","value":"cashOut"}},{"kind":"Field","name":{"kind":"Name","value":"cashRefunds"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCash"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCashHidden"}},{"kind":"Field","name":{"kind":"Name","value":"countedCash"}},{"kind":"Field","name":{"kind":"Name","value":"cashVariance"}},{"kind":"Field","name":{"kind":"Name","value":"roundingTotal"}},{"kind":"Field","name":{"kind":"Name","value":"byMethod"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"count"}}]}},{"kind":"Field","name":{"kind":"Name","value":"byCashier"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cashier"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"billCount"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MobilePosShiftReportQuery, MobilePosShiftReportQueryVariables>;
export const MobilePosShiftHistoryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobilePosShiftHistory"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosCredentialsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosShiftHistory"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"credentials"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"shifts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"openedByName"}},{"kind":"Field","name":{"kind":"Name","value":"closedAt"}},{"kind":"Field","name":{"kind":"Name","value":"closedByName"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCash"}},{"kind":"Field","name":{"kind":"Name","value":"countedCash"}},{"kind":"Field","name":{"kind":"Name","value":"cashVariance"}}]}}]}}]}}]} as unknown as DocumentNode<MobilePosShiftHistoryQuery, MobilePosShiftHistoryQueryVariables>;
export const MobileRestaurantFloorDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobileRestaurantFloor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosRestaurantFloor"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"areas"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"tables"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"areaId"}},{"kind":"Field","name":{"kind":"Name","value":"code"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"seats"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"active"}},{"kind":"Field","name":{"kind":"Name","value":"blocked"}},{"kind":"Field","name":{"kind":"Name","value":"shape"}},{"kind":"Field","name":{"kind":"Name","value":"positionX"}},{"kind":"Field","name":{"kind":"Name","value":"positionY"}},{"kind":"Field","name":{"kind":"Name","value":"check"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"itemCount"}},{"kind":"Field","name":{"kind":"Name","value":"unsentCount"}},{"kind":"Field","name":{"kind":"Name","value":"amountDue"}},{"kind":"Field","name":{"kind":"Name","value":"guestCount"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}}]}},{"kind":"Field","name":{"kind":"Name","value":"checks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"itemCount"}},{"kind":"Field","name":{"kind":"Name","value":"unsentCount"}},{"kind":"Field","name":{"kind":"Name","value":"amountDue"}},{"kind":"Field","name":{"kind":"Name","value":"guestCount"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MobileRestaurantFloorQuery, MobileRestaurantFloorQueryVariables>;
export const MobileRestaurantMenuDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobileRestaurantMenu"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosRestaurantMenu"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"price"}},{"kind":"Field","name":{"kind":"Name","value":"sellable"}},{"kind":"Field","name":{"kind":"Name","value":"availability"}},{"kind":"Field","name":{"kind":"Name","value":"availableTotal"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenStation"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenStationId"}},{"kind":"Field","name":{"kind":"Name","value":"hasModifiers"}},{"kind":"Field","name":{"kind":"Name","value":"unavailableReason"}},{"kind":"Field","name":{"kind":"Name","value":"unavailableResetsAt"}},{"kind":"Field","name":{"kind":"Name","value":"availableSizes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"available"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MobileRestaurantMenuQuery, MobileRestaurantMenuQueryVariables>;
export const MobileRestaurantCheckDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobileRestaurantCheck"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosRestaurantCheck"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRestaurantCheckFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRestaurantCheckFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantCheck"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tableId"}},{"kind":"Field","name":{"kind":"Name","value":"tableCode"}},{"kind":"Field","name":{"kind":"Name","value":"tableName"}},{"kind":"Field","name":{"kind":"Name","value":"areaName"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"guestCount"}},{"kind":"Field","name":{"kind":"Name","value":"amountDue"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"reservationStatus"}},{"kind":"Field","name":{"kind":"Name","value":"reservationLost"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"lineAmount"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenStatus"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenNote"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}},{"kind":"Field","name":{"kind":"Name","value":"modifierNames"}},{"kind":"Field","name":{"kind":"Name","value":"roundNo"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}}]}}]}}]} as unknown as DocumentNode<MobileRestaurantCheckQuery, MobileRestaurantCheckQueryVariables>;
export const MobileKitchenTicketsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobileKitchenTickets"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosKitchenTickets"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}},{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"100"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"generatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"stations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"sortOrder"}}]}},{"kind":"Field","name":{"kind":"Name","value":"stationSlas"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"stationRef"}},{"kind":"Field","name":{"kind":"Name","value":"warnMinutes"}},{"kind":"Field","name":{"kind":"Name","value":"lateMinutes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"tickets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileKitchenTicketFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileKitchenTicketFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsKitchenTicket"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"checkId"}},{"kind":"Field","name":{"kind":"Name","value":"orderId"}},{"kind":"Field","name":{"kind":"Name","value":"orderItemId"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"tableCode"}},{"kind":"Field","name":{"kind":"Name","value":"tableName"}},{"kind":"Field","name":{"kind":"Name","value":"roundNo"}},{"kind":"Field","name":{"kind":"Name","value":"station"}},{"kind":"Field","name":{"kind":"Name","value":"stationId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"productSku"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"qty"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenNote"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<MobileKitchenTicketsQuery, MobileKitchenTicketsQueryVariables>;
export const MobileRestaurantIncomingDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"MobileRestaurantIncoming"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosRestaurantIncoming"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"config"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"accepting"}},{"kind":"Field","name":{"kind":"Name","value":"paused"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"hours"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"day"}},{"kind":"Field","name":{"kind":"Name","value":"open"}},{"kind":"Field","name":{"kind":"Name","value":"close"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"orders"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"channel"}},{"kind":"Field","name":{"kind":"Name","value":"customerRef"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"fulfillmentType"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"promisedAt"}},{"kind":"Field","name":{"kind":"Name","value":"amountDue"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"orderItemId"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"qty"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"refunds"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"orderId"}},{"kind":"Field","name":{"kind":"Name","value":"method"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"channel"}},{"kind":"Field","name":{"kind":"Name","value":"customerRef"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"cancelledBy"}}]}}]}}]}}]} as unknown as DocumentNode<MobileRestaurantIncomingQuery, MobileRestaurantIncomingQueryVariables>;
export const MobilePosSaleDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobilePosSale"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosSaleInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosSale"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"orderId"}},{"kind":"Field","name":{"kind":"Name","value":"receiptNo"}},{"kind":"Field","name":{"kind":"Name","value":"billNo"}},{"kind":"Field","name":{"kind":"Name","value":"subtotal"}},{"kind":"Field","name":{"kind":"Name","value":"discount"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"cashTendered"}},{"kind":"Field","name":{"kind":"Name","value":"cashChange"}},{"kind":"Field","name":{"kind":"Name","value":"pointsUsed"}},{"kind":"Field","name":{"kind":"Name","value":"pointsEarned"}},{"kind":"Field","name":{"kind":"Name","value":"pointsBalance"}},{"kind":"Field","name":{"kind":"Name","value":"replayed"}}]}}]}}]} as unknown as DocumentNode<MobilePosSaleMutation, MobilePosSaleMutationVariables>;
export const MobilePosReturnDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobilePosReturn"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosReturnInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosReturn"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"orderId"}},{"kind":"Field","name":{"kind":"Name","value":"posReturnId"}},{"kind":"Field","name":{"kind":"Name","value":"refundAmount"}},{"kind":"Field","name":{"kind":"Name","value":"settlementStatus"}},{"kind":"Field","name":{"kind":"Name","value":"creditNoteNo"}},{"kind":"Field","name":{"kind":"Name","value":"replayed"}}]}}]}}]} as unknown as DocumentNode<MobilePosReturnMutation, MobilePosReturnMutationVariables>;
export const MobilePosVoidDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobilePosVoid"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosVoidInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosVoid"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"orderId"}},{"kind":"Field","name":{"kind":"Name","value":"posReturnId"}},{"kind":"Field","name":{"kind":"Name","value":"refundAmount"}},{"kind":"Field","name":{"kind":"Name","value":"settlementStatus"}},{"kind":"Field","name":{"kind":"Name","value":"creditNoteNo"}},{"kind":"Field","name":{"kind":"Name","value":"replayed"}}]}}]}}]} as unknown as DocumentNode<MobilePosVoidMutation, MobilePosVoidMutationVariables>;
export const MobilePosShiftDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobilePosShift"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosShiftInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosShift"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"shift"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"openedBy"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"openingFloat"}},{"kind":"Field","name":{"kind":"Name","value":"countedCash"}},{"kind":"Field","name":{"kind":"Name","value":"expectedCash"}},{"kind":"Field","name":{"kind":"Name","value":"cashVariance"}},{"kind":"Field","name":{"kind":"Name","value":"closedAt"}},{"kind":"Field","name":{"kind":"Name","value":"pharmacistUserId"}}]}}]}}]}}]} as unknown as DocumentNode<MobilePosShiftMutation, MobilePosShiftMutationVariables>;
export const MobilePosCashMovementDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobilePosCashMovement"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosCashMovementInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosCashMovement"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"replayed"}},{"kind":"Field","name":{"kind":"Name","value":"drawerAfter"}},{"kind":"Field","name":{"kind":"Name","value":"available"}},{"kind":"Field","name":{"kind":"Name","value":"movement"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"direction"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"actorName"}},{"kind":"Field","name":{"kind":"Name","value":"approvedByName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]}}]} as unknown as DocumentNode<MobilePosCashMovementMutation, MobilePosCashMovementMutationVariables>;
export const MobilePosParkDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobilePosPark"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosParkInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosPark"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"parked"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"label"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"itemCount"}},{"kind":"Field","name":{"kind":"Name","value":"subtotalHint"}}]}}]}}]}}]} as unknown as DocumentNode<MobilePosParkMutation, MobilePosParkMutationVariables>;
export const MobileRestaurantOpenCheckDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobileRestaurantOpenCheck"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantOpenCheckInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosRestaurantOpenCheck"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"check"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRestaurantCheckFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRestaurantCheckFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantCheck"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tableId"}},{"kind":"Field","name":{"kind":"Name","value":"tableCode"}},{"kind":"Field","name":{"kind":"Name","value":"tableName"}},{"kind":"Field","name":{"kind":"Name","value":"areaName"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"guestCount"}},{"kind":"Field","name":{"kind":"Name","value":"amountDue"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"reservationStatus"}},{"kind":"Field","name":{"kind":"Name","value":"reservationLost"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"lineAmount"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenStatus"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenNote"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}},{"kind":"Field","name":{"kind":"Name","value":"modifierNames"}},{"kind":"Field","name":{"kind":"Name","value":"roundNo"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}}]}}]}}]} as unknown as DocumentNode<MobileRestaurantOpenCheckMutation, MobileRestaurantOpenCheckMutationVariables>;
export const MobileRestaurantAddCheckItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobileRestaurantAddCheckItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"checkId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantAddCheckItemInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosRestaurantAddCheckItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"checkId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"checkId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"available"}},{"kind":"Field","name":{"kind":"Name","value":"expected"}},{"kind":"Field","name":{"kind":"Name","value":"requested"}},{"kind":"Field","name":{"kind":"Name","value":"check"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRestaurantCheckFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRestaurantCheckFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantCheck"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tableId"}},{"kind":"Field","name":{"kind":"Name","value":"tableCode"}},{"kind":"Field","name":{"kind":"Name","value":"tableName"}},{"kind":"Field","name":{"kind":"Name","value":"areaName"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"guestCount"}},{"kind":"Field","name":{"kind":"Name","value":"amountDue"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"reservationStatus"}},{"kind":"Field","name":{"kind":"Name","value":"reservationLost"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"lineAmount"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenStatus"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenNote"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}},{"kind":"Field","name":{"kind":"Name","value":"modifierNames"}},{"kind":"Field","name":{"kind":"Name","value":"roundNo"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}}]}}]}}]} as unknown as DocumentNode<MobileRestaurantAddCheckItemMutation, MobileRestaurantAddCheckItemMutationVariables>;
export const MobileRestaurantRemoveCheckItemDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobileRestaurantRemoveCheckItem"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"checkId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"itemId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantCheckCredentialsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosRestaurantRemoveCheckItem"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"checkId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"checkId"}}},{"kind":"Argument","name":{"kind":"Name","value":"itemId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"itemId"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentials"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"check"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRestaurantCheckFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRestaurantCheckFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantCheck"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tableId"}},{"kind":"Field","name":{"kind":"Name","value":"tableCode"}},{"kind":"Field","name":{"kind":"Name","value":"tableName"}},{"kind":"Field","name":{"kind":"Name","value":"areaName"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"guestCount"}},{"kind":"Field","name":{"kind":"Name","value":"amountDue"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"reservationStatus"}},{"kind":"Field","name":{"kind":"Name","value":"reservationLost"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"lineAmount"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenStatus"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenNote"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}},{"kind":"Field","name":{"kind":"Name","value":"modifierNames"}},{"kind":"Field","name":{"kind":"Name","value":"roundNo"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}}]}}]}}]} as unknown as DocumentNode<MobileRestaurantRemoveCheckItemMutation, MobileRestaurantRemoveCheckItemMutationVariables>;
export const MobileRestaurantSendCheckDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobileRestaurantSendCheck"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"checkId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantCheckCredentialsInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosRestaurantSendCheckToKitchen"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"checkId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"checkId"}}},{"kind":"Argument","name":{"kind":"Name","value":"credentials"},"value":{"kind":"Variable","name":{"kind":"Name","value":"credentials"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenTickets"}},{"kind":"Field","name":{"kind":"Name","value":"check"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRestaurantCheckFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRestaurantCheckFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantCheck"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tableId"}},{"kind":"Field","name":{"kind":"Name","value":"tableCode"}},{"kind":"Field","name":{"kind":"Name","value":"tableName"}},{"kind":"Field","name":{"kind":"Name","value":"areaName"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"guestCount"}},{"kind":"Field","name":{"kind":"Name","value":"amountDue"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"reservationStatus"}},{"kind":"Field","name":{"kind":"Name","value":"reservationLost"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"lineAmount"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenStatus"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenNote"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}},{"kind":"Field","name":{"kind":"Name","value":"modifierNames"}},{"kind":"Field","name":{"kind":"Name","value":"roundNo"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}}]}}]}}]} as unknown as DocumentNode<MobileRestaurantSendCheckMutation, MobileRestaurantSendCheckMutationVariables>;
export const MobileRestaurantSettleCheckDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobileRestaurantSettleCheck"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"checkId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantSettleCheckInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosRestaurantSettleCheck"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"checkId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"checkId"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"orderId"}},{"kind":"Field","name":{"kind":"Name","value":"receiptNo"}},{"kind":"Field","name":{"kind":"Name","value":"billNo"}},{"kind":"Field","name":{"kind":"Name","value":"total"}},{"kind":"Field","name":{"kind":"Name","value":"cashTendered"}},{"kind":"Field","name":{"kind":"Name","value":"cashChange"}},{"kind":"Field","name":{"kind":"Name","value":"replayed"}},{"kind":"Field","name":{"kind":"Name","value":"check"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRestaurantCheckFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRestaurantCheckFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantCheck"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"tableId"}},{"kind":"Field","name":{"kind":"Name","value":"tableCode"}},{"kind":"Field","name":{"kind":"Name","value":"tableName"}},{"kind":"Field","name":{"kind":"Name","value":"areaName"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"version"}},{"kind":"Field","name":{"kind":"Name","value":"guestCount"}},{"kind":"Field","name":{"kind":"Name","value":"amountDue"}},{"kind":"Field","name":{"kind":"Name","value":"openedAt"}},{"kind":"Field","name":{"kind":"Name","value":"reservationStatus"}},{"kind":"Field","name":{"kind":"Name","value":"reservationLost"}},{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"sku"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"packCode"}},{"kind":"Field","name":{"kind":"Name","value":"unitName"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"packPrice"}},{"kind":"Field","name":{"kind":"Name","value":"baseQty"}},{"kind":"Field","name":{"kind":"Name","value":"lineAmount"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenStatus"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenNote"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}},{"kind":"Field","name":{"kind":"Name","value":"modifierNames"}},{"kind":"Field","name":{"kind":"Name","value":"roundNo"}},{"kind":"Field","name":{"kind":"Name","value":"sentAt"}}]}}]}}]} as unknown as DocumentNode<MobileRestaurantSettleCheckMutation, MobileRestaurantSettleCheckMutationVariables>;
export const MobileKitchenTicketStatusDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobileKitchenTicketStatus"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosKitchenTicketStatusInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosKitchenTicketStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"ticket"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileKitchenTicketFields"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileKitchenTicketFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"BmsKitchenTicket"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"checkId"}},{"kind":"Field","name":{"kind":"Name","value":"orderId"}},{"kind":"Field","name":{"kind":"Name","value":"orderItemId"}},{"kind":"Field","name":{"kind":"Name","value":"source"}},{"kind":"Field","name":{"kind":"Name","value":"tableCode"}},{"kind":"Field","name":{"kind":"Name","value":"tableName"}},{"kind":"Field","name":{"kind":"Name","value":"roundNo"}},{"kind":"Field","name":{"kind":"Name","value":"station"}},{"kind":"Field","name":{"kind":"Name","value":"stationId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"productSku"}},{"kind":"Field","name":{"kind":"Name","value":"productName"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"qty"}},{"kind":"Field","name":{"kind":"Name","value":"packQty"}},{"kind":"Field","name":{"kind":"Name","value":"modifierCodes"}},{"kind":"Field","name":{"kind":"Name","value":"kitchenNote"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<MobileKitchenTicketStatusMutation, MobileKitchenTicketStatusMutationVariables>;
export const MobileRestaurantAcceptIncomingDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"MobileRestaurantAcceptIncoming"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"BmsPosRestaurantAcceptIncomingOrderInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosRestaurantAcceptIncomingOrder"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"reason"}},{"kind":"Field","name":{"kind":"Name","value":"ticketsCreated"}},{"kind":"Field","name":{"kind":"Name","value":"replayed"}}]}}]}}]} as unknown as DocumentNode<MobileRestaurantAcceptIncomingMutation, MobileRestaurantAcceptIncomingMutationVariables>;
export const MobileDeviceSessionChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileDeviceSessionChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsDeviceSessionChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileDeviceSessionChangedSubscription, MobileDeviceSessionChangedSubscriptionVariables>;
export const MobileShiftChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileShiftChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsShiftChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileShiftChangedSubscription, MobileShiftChangedSubscriptionVariables>;
export const MobilePosOrderChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobilePosOrderChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPosOrderChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobilePosOrderChangedSubscription, MobilePosOrderChangedSubscriptionVariables>;
export const MobileRestaurantFloorChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileRestaurantFloorChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsRestaurantFloorChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileRestaurantFloorChangedSubscription, MobileRestaurantFloorChangedSubscriptionVariables>;
export const MobileRestaurantCheckChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileRestaurantCheckChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsRestaurantCheckChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileRestaurantCheckChangedSubscription, MobileRestaurantCheckChangedSubscriptionVariables>;
export const MobileKitchenTicketChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileKitchenTicketChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsKitchenTicketChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileKitchenTicketChangedSubscription, MobileKitchenTicketChangedSubscriptionVariables>;
export const MobileMenuAvailabilityChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileMenuAvailabilityChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsMenuAvailabilityChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileMenuAvailabilityChangedSubscription, MobileMenuAvailabilityChangedSubscriptionVariables>;
export const MobileQrOrderChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileQrOrderChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsQrOrderChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileQrOrderChangedSubscription, MobileQrOrderChangedSubscriptionVariables>;
export const MobileIncomingOrderChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileIncomingOrderChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsIncomingOrderChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileIncomingOrderChangedSubscription, MobileIncomingOrderChangedSubscriptionVariables>;
export const MobileWaitlistChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileWaitlistChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsWaitlistChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileWaitlistChangedSubscription, MobileWaitlistChangedSubscriptionVariables>;
export const MobileServiceCallChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileServiceCallChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsServiceCallChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileServiceCallChangedSubscription, MobileServiceCallChangedSubscriptionVariables>;
export const MobileInventoryChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileInventoryChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsInventoryChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileInventoryChangedSubscription, MobileInventoryChangedSubscriptionVariables>;
export const MobileStockTransferChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileStockTransferChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsStockTransferChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileStockTransferChangedSubscription, MobileStockTransferChangedSubscriptionVariables>;
export const MobileStockCountChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileStockCountChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsStockCountChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileStockCountChangedSubscription, MobileStockCountChangedSubscriptionVariables>;
export const MobilePaymentChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobilePaymentChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsPaymentChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobilePaymentChangedSubscription, MobilePaymentChangedSubscriptionVariables>;
export const MobileOrderChangedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"MobileOrderChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"bmsOrderChanged"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"MobileRealtimeEventFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MobileRealtimeEventFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"RealtimeEvent"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"eventId"}},{"kind":"Field","name":{"kind":"Name","value":"eventType"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"tenantId"}},{"kind":"Field","name":{"kind":"Name","value":"locationId"}},{"kind":"Field","name":{"kind":"Name","value":"userId"}},{"kind":"Field","name":{"kind":"Name","value":"actorType"}},{"kind":"Field","name":{"kind":"Name","value":"actorId"}},{"kind":"Field","name":{"kind":"Name","value":"deviceId"}},{"kind":"Field","name":{"kind":"Name","value":"entityType"}},{"kind":"Field","name":{"kind":"Name","value":"entityId"}},{"kind":"Field","name":{"kind":"Name","value":"aggregateVersion"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"occurredAt"}},{"kind":"Field","name":{"kind":"Name","value":"payload"}}]}}]} as unknown as DocumentNode<MobileOrderChangedSubscription, MobileOrderChangedSubscriptionVariables>;