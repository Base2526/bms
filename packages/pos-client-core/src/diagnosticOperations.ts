// Explicit POS operation allowlist. Update with the Mobile GraphQL documents and desktop POS queries.
export const POS_DIAGNOSTIC_OPERATIONS = new Set([
  'DesktopPosBoardGameCheckout',
  'DesktopPosLastSale',
  'MobileDeviceSessionChanged',
  'MobileIncomingOrderChanged',
  'MobileInventoryChanged',
  'MobileKitchenTicketChanged',
  'MobileKitchenTickets',
  'MobileKitchenTicketsStatus',
  'MobileKitchenTicketStatus',
  'MobileMenuAvailabilityChanged',
  'MobileOrderChanged',
  'MobilePaymentChanged',
  'MobilePosAcknowledgeBoardGameServiceCall',
  'MobilePosAddBoardGameParticipant',
  'MobilePosAddBoardGameReservation',
  'MobilePosAddBoardGameTabItem',
  'MobilePosAddBoardGameWaitlistEntry',
  'MobilePosAdjustBoardGameTiming',
  'MobilePosApplyStockCount',
  'MobilePosArAccount',
  'MobilePosBlindReturn',
  'MobilePosBoardGameCheckout',
  'MobilePosBoardGameServiceCalls',
  'MobilePosBoardGameSession',
  'MobilePosBoardGameWorkspace',
  'MobilePosCallBoardGameWaitlistEntry',
  'MobilePosCancelBoardGameSession',
  'MobilePosCancelStockCount',
  'MobilePosCancelStockTransfer',
  'MobilePosCashMovement',
  'MobilePosCashMovements',
  'MobilePosCatalog',
  'MobilePosCheckInBoardGameReservation',
  'MobilePosCheckoutBoardGameCopy',
  'MobilePosCloseBoardGameBillingGroup',
  'MobilePosCloseBoardGameSession',
  'MobilePosCloseBoardGameWaitlistEntry',
  'MobilePosCollectAr',
  'MobilePosCompleteBoardGameServiceCall',
  'MobilePosCompleteRefund',
  'MobilePosCreateStockCount',
  'MobilePosCreateStockTransfer',
  'MobilePosDeposit',
  'MobilePosDeposits',
  'MobilePosDetachBoardGameBillingGroup',
  'MobilePosEnrollMember',
  'MobilePosExpense',
  'MobilePosExpenses',
  'MobilePosIssueBoardGameGuestAccess',
  'MobilePosLastSale',
  'MobilePosLeaveBoardGameParticipant',
  'MobilePosMemberPreview',
  'MobilePosMembers',
  'MobilePosMergeBoardGameBillingGroups',
  'MobilePosMergeBoardGameSeating',
  'MobilePosMoveBoardGameSeating',
  'MobilePosNoSale',
  'MobilePosNoSales',
  'MobilePosOpenBoardGameSession',
  'MobilePosOrderChanged',
  'MobilePosPark',
  'MobilePosParkedSales',
  'MobilePosPickupQueue',
  'MobilePosPickupQueueAction',
  'MobilePosPurchaseOrder',
  'MobilePosPurchaseOrders',
  'MobilePosReceiptPreview',
  'MobilePosReceivePurchase',
  'MobilePosReceiveStockTransfer',
  'MobilePosRecordStockCountItem',
  'MobilePosReleaseBoardGameIdentityHold',
  'MobilePosRemoveBoardGameTabItem',
  'MobilePosRequestPharmacyReview',
  'MobilePosReturn',
  'MobilePosReturnBoardGameCopy',
  'MobilePosReviewBoardGameReservation',
  'MobilePosSale',
  'MobilePosSaleRecovery',
  'MobilePosSales',
  'MobilePosScan',
  'MobilePosSeatBoardGameWaitlistEntry',
  'MobilePosSendReceipt',
  'MobilePosSendStockTransfer',
  'MobilePosShift',
  'MobilePosShiftHistory',
  'MobilePosShiftReport',
  'MobilePosStockCounts',
  'MobilePosStockSearch',
  'MobilePosStockTransfers',
  'MobilePosStoreCredit',
  'MobilePosTakeBoardGameIdentityHold',
  'MobilePosUpdateBoardGameReservation',
  'MobilePosVoid',
  'MobileQrOrderChanged',
  'MobileRestaurantAcceptIncoming',
  'MobileRestaurantAcceptQrSubmission',
  'MobileRestaurantAcknowledgeServiceCall',
  'MobileRestaurantAddCheckItem',
  'MobileRestaurantAddWaitlistEntry',
  'MobileRestaurantCallWaitlistEntry',
  'MobileRestaurantCancelCheck',
  'MobileRestaurantCancelOrderLines',
  'MobileRestaurantCancelRequest',
  'MobileRestaurantCancelWaitlistEntry',
  'MobileRestaurantCheck',
  'MobileRestaurantCheckChanged',
  'MobileRestaurantCompleteServiceCall',
  'MobileRestaurantConfirmRequest',
  'MobileRestaurantContactRequest',
  'MobileRestaurantFloor',
  'MobileRestaurantFloorChanged',
  'MobileRestaurantFloorSetup',
  'MobileRestaurantIncoming',
  'MobileRestaurantMenu',
  'MobileRestaurantMenuAvailability',
  'MobileRestaurantMergeChecks',
  'MobileRestaurantMoveCheck',
  'MobileRestaurantNoShowWaitlistEntry',
  'MobileRestaurantOpenCheck',
  'MobileRestaurantQrOrders',
  'MobileRestaurantRejectQrSubmission',
  'MobileRestaurantRemoveCheckItem',
  'MobileRestaurantRequests',
  'MobileRestaurantSeatWaitlistEntry',
  'MobileRestaurantSendCheck',
  'MobileRestaurantServiceCalls',
  'MobileRestaurantSetGuestCount',
  'MobileRestaurantSetOrderingPaused',
  'MobileRestaurantSettleCheck',
  'MobileRestaurantSplitCheck',
  'MobileRestaurantWaitlist',
  'MobileServiceCallChanged',
  'MobileShiftChanged',
  'MobileStockCountChanged',
  'MobileStockTransferChanged',
  'MobileWaitlistChanged',
  'PosBootstrap',
  'VerifyPosCashier',
]);

export function safePosDiagnosticOperation(value: unknown): string {
  return typeof value === 'string' && POS_DIAGNOSTIC_OPERATIONS.has(value) ? value : 'Unknown';
}

const POS_DIAGNOSTIC_ROUTES = new Set([
  '/graphql', '/api/graphql', '/api/bms/realtime/ticket',
  '/pos', '/pos/app', '/pos/restaurant', '/pos/display', '/pos/manual', '/pos/queue-board',
  '/api/pos', '/api/pos/session', '/api/pos/diagnostics/events', '/api/pos/support-diagnostics',
  '/api/pos/ar', '/api/pos/ar/collect', '/api/pos/blind-return',
  '/api/pos/board-game', '/api/pos/board-game/session', '/api/pos/cash-movement',
  '/api/pos/deposit', '/api/pos/expense', '/api/pos/kitchen/tickets',
  '/api/pos/kitchen/tickets/status', '/api/pos/last-sale', '/api/pos/member',
  '/api/pos/member/preview', '/api/pos/no-sale', '/api/pos/park',
  '/api/pos/pharmacy-evidence', '/api/pos/pharmacy-review', '/api/pos/purchase',
  '/api/pos/scan', '/api/pos/recent-sales', '/api/pos/refund-settlement',
  '/api/pos/return', '/api/pos/sale', '/api/pos/search', '/api/pos/send-receipt',
  '/api/pos/shift-report', '/api/pos/shift-report/export', '/api/pos/shifts', '/api/pos/void',
  '/api/pos/restaurant/checks', '/api/pos/restaurant/floor', '/api/pos/restaurant/incoming',
  '/api/pos/restaurant/menu', '/api/pos/restaurant/qr-orders',
  '/api/pos/restaurant/service-calls', '/api/pos/restaurant/waitlist', '/api/pos/shift',
]);

/** A route family only: never retain a query string, check/ticket id or raw URL. */
export function safePosDiagnosticRoute(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (POS_DIAGNOSTIC_ROUTES.has(value)) return value;
  if (/^\/api\/pos\/restaurant\/checks\/[0-9a-f-]{36}$/i.test(value)) return '/api/pos/restaurant/checks';
  if (/^\/api\/pos\/kitchen\/tickets\/[0-9a-f-]{36}\/status$/i.test(value))
    return '/api/pos/kitchen/tickets/status';
  return null;
}

const POS_DIAGNOSTIC_CODES = new Set([
  'POS_AUTHENTICATION', 'POS_PERMISSION', 'POS_RATE_LIMIT', 'POS_TIMEOUT',
  'POS_CANCELLED', 'POS_SERVER', 'POS_VERSION', 'POS_PROTOCOL', 'POS_NETWORK',
  'POS_BUSINESS', 'POS_RECOVERED', 'POS_REALTIME', 'POS_DIAGNOSTIC_GAP',
  'POS_RENDERER', 'POS_RENDERER_CRASHED', 'POS_RENDERER_OOM', 'POS_RENDERER_KILLED',
  'POS_RENDERER_LAUNCH_FAILED', 'POS_RENDERER_INTEGRITY_FAILURE',
  'POS_RENDERER_ABNORMAL_EXIT', 'POS_UNKNOWN_ERROR',
  'UNAUTHENTICATED', 'FORBIDDEN', 'BAD_USER_INPUT', 'CONFLICT', 'NOT_FOUND',
  'INTERNAL_SERVER_ERROR', 'GRAPHQL_VALIDATION_FAILED', 'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_ERROR', 'INVALID_RESPONSE', 'INVALID_POS_BOOTSTRAP',
  'INVALID_GRAPHQL_RESPONSE',
]);

/** Unknown extension codes cannot become a free-text/PII channel. */
export function safePosDiagnosticErrorCode(value: unknown): string {
  return typeof value === 'string' && (POS_DIAGNOSTIC_CODES.has(value) || /^HTTP_[1-5][0-9]{2}$/.test(value))
    ? value : 'POS_UNKNOWN_ERROR';
}

const POS_DIAGNOSTIC_REASONS = new Set([
  'local_retention', 'local_capacity', 'target_history_rotated', 'gap_summary_rotated',
  'secure_storage_unavailable', 'journal_invalid_event', 'journal_invalid_gap',
  'journal_invalid_target', 'journal_unreadable', 'server_rejected',
  'event_too_old', 'clock_ahead', 'invalid_time', 'invalid_event', 'invalid_event_id',
  'invalid_location', 'invalid_device', 'invalid_category', 'invalid_action', 'invalid_status',
  'invalid_correlation_id', 'batch_limit', 'token_rejected', 'permission_denied',
  'payload_rejected', 'invalid_acknowledgement', 'rate_limited', 'server_error',
  'network_or_timeout', 'transport_failure',
]);

export function safePosDiagnosticReason(value: unknown): string | null {
  return typeof value === 'string' && POS_DIAGNOSTIC_REASONS.has(value) ? value : null;
}

const POS_DIAGNOSTIC_ACTIONS = new Set([
  'desktop.renderer.crash', 'desktop.navigation.failed', 'desktop.connection.recovered',
  'desktop.startup.failed', 'desktop.pairing.failed', 'desktop.api.request',
  'pos.device.verify', 'pos.cashier.verify', 'pos.diagnostic_gap', 'pos.unknown_operation',
  'health.failed', 'health.recovered', 'health.online', 'realtime.ticket_failed',
  'realtime.disconnected', 'realtime.recovered',
  'restaurant.api.failed', 'restaurant.api.result', 'restaurant.api.request',
]);

export function isAllowedPosDiagnosticAction(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (POS_DIAGNOSTIC_ACTIONS.has(value)) return true;
  const match = /^(graphql|network)\.([A-Za-z][A-Za-z0-9]*)$/.exec(value);
  return !!match && (match[2] === 'Unknown' || POS_DIAGNOSTIC_OPERATIONS.has(match[2]));
}
