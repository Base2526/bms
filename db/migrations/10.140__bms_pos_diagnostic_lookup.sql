-- 10.140: server-backed POS diagnostic search over the existing tenant/RLS event table.
-- No new data authority or grants; 9.46 owns bms_support_events and its tenant policy.
-- Legacy clients sent free-text messages before ingestion was restricted to coded metadata.
-- Remove those historical values rather than exposing them through future exports.
UPDATE bms_support_events SET message = NULL WHERE message IS NOT NULL;
-- Earlier POS and browser clients could submit arbitrary string values in context keys.
-- Keep only typed/coded metadata on every run; this also makes a migration rerun safe for new rows.
UPDATE bms_support_events AS e
   SET context = COALESCE((
     SELECT jsonb_object_agg(k, v)
       FROM jsonb_each(CASE WHEN jsonb_typeof(e.context) = 'object' THEN e.context ELSE '{}'::jsonb END) AS item(k, v)
      WHERE
        (k = 'errorCode' AND jsonb_typeof(v) = 'string' AND v #>> '{}' = ANY(ARRAY[
          'POS_AUTHENTICATION', 'POS_PERMISSION', 'POS_RATE_LIMIT', 'POS_TIMEOUT',
          'POS_CANCELLED', 'POS_SERVER', 'POS_VERSION', 'POS_PROTOCOL', 'POS_NETWORK',
          'POS_BUSINESS', 'POS_RECOVERED', 'POS_REALTIME', 'POS_DIAGNOSTIC_GAP',
          'POS_RENDERER', 'POS_RENDERER_CRASHED', 'POS_RENDERER_OOM', 'POS_RENDERER_KILLED',
          'POS_RENDERER_LAUNCH_FAILED', 'POS_RENDERER_INTEGRITY_FAILURE',
          'POS_RENDERER_ABNORMAL_EXIT', 'POS_UNKNOWN_ERROR', 'UNAUTHENTICATED',
          'FORBIDDEN', 'BAD_USER_INPUT', 'CONFLICT', 'NOT_FOUND',
          'INTERNAL_SERVER_ERROR', 'GRAPHQL_VALIDATION_FAILED', 'GRAPHQL_PARSE_FAILED',
          'GRAPHQL_ERROR', 'INVALID_RESPONSE', 'INVALID_POS_BOOTSTRAP',
          'INVALID_GRAPHQL_RESPONSE']))
        OR (k = 'errorCode' AND jsonb_typeof(v) = 'string' AND v #>> '{}' ~ '^HTTP_[1-5][0-9]{2}$')
        OR (k = 'cashierUserId' AND jsonb_typeof(v) = 'string'
            AND v #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
        OR (k IN ('route', 'previousRoute') AND jsonb_typeof(v) = 'string' AND v #>> '{}' = ANY(ARRAY[
          '/graphql', '/api/graphql', '/api/bms/realtime/ticket', '/pos', '/pos/app',
          '/pos/restaurant', '/pos/display', '/pos/manual', '/pos/queue-board',
          '/api/pos', '/api/pos/session', '/api/pos/diagnostics/events',
          '/api/pos/support-diagnostics', '/api/pos/ar', '/api/pos/ar/collect',
          '/api/pos/blind-return', '/api/pos/board-game', '/api/pos/board-game/session',
          '/api/pos/cash-movement', '/api/pos/deposit', '/api/pos/expense',
          '/api/pos/kitchen/tickets', '/api/pos/kitchen/tickets/status',
          '/api/pos/last-sale', '/api/pos/member', '/api/pos/member/preview',
          '/api/pos/no-sale', '/api/pos/park', '/api/pos/pharmacy-evidence',
          '/api/pos/pharmacy-review', '/api/pos/purchase', '/api/pos/scan',
          '/api/pos/recent-sales', '/api/pos/refund-settlement', '/api/pos/return',
          '/api/pos/sale', '/api/pos/search', '/api/pos/send-receipt',
          '/api/pos/shift-report', '/api/pos/shift-report/export', '/api/pos/shifts',
          '/api/pos/void',
          '/api/pos/restaurant/checks', '/api/pos/restaurant/floor',
          '/api/pos/restaurant/incoming', '/api/pos/restaurant/menu',
          '/api/pos/restaurant/qr-orders', '/api/pos/restaurant/service-calls',
          '/api/pos/restaurant/waitlist', '/api/pos/shift', '/admin',
          '/admin/support-diagnostics', '/admin/pos-devices']))
        OR (k = 'errorName' AND jsonb_typeof(v) = 'string'
            AND v #>> '{}' IN ('Error', 'TypeError', 'AbortError', 'TimeoutError',
                                'NetworkError', 'FetchError', 'SyntaxError', 'ApolloError'))
        OR (k IN ('online', 'serverResponded') AND jsonb_typeof(v) = 'boolean')
        OR (k = 'httpStatus' AND jsonb_typeof(v) = 'number'
            AND v #>> '{}' ~ '^[1-5][0-9]{2}$')
        OR (k = 'durationMs' AND jsonb_typeof(v) = 'number'
            AND v #>> '{}' ~ '^[0-9]{1,6}$' AND (v #>> '{}')::integer <= 120000)
        OR (k = 'droppedCount' AND jsonb_typeof(v) = 'number'
            AND v #>> '{}' ~ '^[1-9][0-9]{0,5}$')
        OR (k = 'appVersion' AND jsonb_typeof(v) = 'string'
            AND v #>> '{}' ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}([-+][A-Za-z0-9][A-Za-z0-9.-]{0,60})?$')
        OR (k = 'platform' AND jsonb_typeof(v) = 'string'
            AND v #>> '{}' IN ('windows', 'win32', 'linux', 'darwin', 'android', 'ios', 'browser', 'web'))
        OR (k = 'source' AND jsonb_typeof(v) = 'string'
            AND v #>> '{}' IN ('native-pos', 'desktop-pos', 'restaurant-pos', 'browser-pos', 'admin'))
        OR (k IN ('previousState', 'nextState') AND jsonb_typeof(v) = 'string'
            AND v #>> '{}' IN ('unchecked', 'checking', 'online', 'offline', 'degraded',
                                'reconnecting', 'authentication_required'))
        OR (k = 'outcome' AND jsonb_typeof(v) = 'string'
            AND v #>> '{}' IN ('unknown', 'rejected', 'read_failed'))
        OR (k = 'nativeCode' AND jsonb_typeof(v) = 'string'
            AND v #>> '{}' ~ '^-?[0-9]{1,4}$')
        OR (k IN ('gapFrom', 'gapTo') AND jsonb_typeof(v) = 'string'
            AND v #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')
        OR (k = 'gapReason' AND jsonb_typeof(v) = 'string'
            AND v #>> '{}' IN ('local_retention', 'local_capacity', 'target_history_rotated',
                                'gap_summary_rotated', 'secure_storage_unavailable',
                                'journal_invalid_event', 'journal_invalid_gap',
                                'journal_invalid_target', 'journal_unreadable', 'server_rejected',
                                'event_too_old', 'clock_ahead', 'invalid_time', 'invalid_event',
                                'invalid_event_id', 'invalid_location', 'invalid_device',
                                'invalid_category', 'invalid_action', 'invalid_status', 'invalid_correlation_id',
                                'batch_limit', 'token_rejected', 'permission_denied',
                                'payload_rejected', 'invalid_acknowledgement', 'rate_limited',
                                'server_error', 'network_or_timeout', 'transport_failure'))
   ), '{}'::jsonb)
 WHERE e.context <> '{}'::jsonb;
-- Historical columns outside context were also client-controlled in 9.46. Normalize them
-- before they can be queried directly or included by a future bundle implementation.
WITH allowed_operations(name) AS (
  SELECT unnest(ARRAY[
    'DesktopPosBoardGameCheckout', 'DesktopPosLastSale', 'MobileDeviceSessionChanged', 'MobileIncomingOrderChanged', 'MobileInventoryChanged',
    'MobileKitchenTicketChanged', 'MobileKitchenTickets', 'MobileKitchenTicketsStatus', 'MobileKitchenTicketStatus', 'MobileMenuAvailabilityChanged',
    'MobileOrderChanged', 'MobilePaymentChanged', 'MobilePosAcknowledgeBoardGameServiceCall', 'MobilePosAddBoardGameParticipant', 'MobilePosAddBoardGameReservation',
    'MobilePosAddBoardGameTabItem', 'MobilePosAddBoardGameWaitlistEntry', 'MobilePosAdjustBoardGameTiming', 'MobilePosApplyStockCount', 'MobilePosArAccount',
    'MobilePosBlindReturn', 'MobilePosBoardGameCheckout', 'MobilePosBoardGameServiceCalls', 'MobilePosBoardGameSession', 'MobilePosBoardGameWorkspace',
    'MobilePosCallBoardGameWaitlistEntry', 'MobilePosCancelBoardGameSession', 'MobilePosCancelStockCount', 'MobilePosCancelStockTransfer', 'MobilePosCashMovement',
    'MobilePosCashMovements', 'MobilePosCatalog', 'MobilePosCheckInBoardGameReservation', 'MobilePosCheckoutBoardGameCopy', 'MobilePosCloseBoardGameBillingGroup',
    'MobilePosCloseBoardGameSession', 'MobilePosCloseBoardGameWaitlistEntry', 'MobilePosCollectAr', 'MobilePosCompleteBoardGameServiceCall', 'MobilePosCompleteRefund',
    'MobilePosCreateStockCount', 'MobilePosCreateStockTransfer', 'MobilePosDeposit', 'MobilePosDeposits', 'MobilePosDetachBoardGameBillingGroup',
    'MobilePosEnrollMember', 'MobilePosExpense', 'MobilePosExpenses', 'MobilePosIssueBoardGameGuestAccess', 'MobilePosLastSale',
    'MobilePosLeaveBoardGameParticipant', 'MobilePosMemberPreview', 'MobilePosMembers', 'MobilePosMergeBoardGameBillingGroups', 'MobilePosMergeBoardGameSeating',
    'MobilePosMoveBoardGameSeating', 'MobilePosNoSale', 'MobilePosNoSales', 'MobilePosOpenBoardGameSession', 'MobilePosOrderChanged',
    'MobilePosPark', 'MobilePosParkedSales', 'MobilePosPickupQueue', 'MobilePosPickupQueueAction', 'MobilePosPurchaseOrder',
    'MobilePosPurchaseOrders', 'MobilePosReceiptPreview', 'MobilePosReceivePurchase', 'MobilePosReceiveStockTransfer', 'MobilePosRecordStockCountItem',
    'MobilePosReleaseBoardGameIdentityHold', 'MobilePosRemoveBoardGameTabItem', 'MobilePosRequestPharmacyReview', 'MobilePosReturn', 'MobilePosReturnBoardGameCopy',
    'MobilePosReviewBoardGameReservation', 'MobilePosSale', 'MobilePosSaleRecovery', 'MobilePosSales', 'MobilePosScan',
    'MobilePosSeatBoardGameWaitlistEntry', 'MobilePosSendReceipt', 'MobilePosSendStockTransfer', 'MobilePosShift', 'MobilePosShiftHistory',
    'MobilePosShiftReport', 'MobilePosStockCounts', 'MobilePosStockSearch', 'MobilePosStockTransfers', 'MobilePosStoreCredit',
    'MobilePosTakeBoardGameIdentityHold', 'MobilePosUpdateBoardGameReservation', 'MobilePosVoid', 'MobileQrOrderChanged', 'MobileRestaurantAcceptIncoming',
    'MobileRestaurantAcceptQrSubmission', 'MobileRestaurantAcknowledgeServiceCall', 'MobileRestaurantAddCheckItem', 'MobileRestaurantAddWaitlistEntry', 'MobileRestaurantCallWaitlistEntry',
    'MobileRestaurantCancelCheck', 'MobileRestaurantCancelOrderLines', 'MobileRestaurantCancelRequest', 'MobileRestaurantCancelWaitlistEntry', 'MobileRestaurantCheck',
    'MobileRestaurantCheckChanged', 'MobileRestaurantCompleteServiceCall', 'MobileRestaurantConfirmRequest', 'MobileRestaurantContactRequest', 'MobileRestaurantFloor',
    'MobileRestaurantFloorChanged', 'MobileRestaurantFloorSetup', 'MobileRestaurantIncoming', 'MobileRestaurantMenu', 'MobileRestaurantMenuAvailability',
    'MobileRestaurantMergeChecks', 'MobileRestaurantMoveCheck', 'MobileRestaurantNoShowWaitlistEntry', 'MobileRestaurantOpenCheck', 'MobileRestaurantQrOrders',
    'MobileRestaurantRejectQrSubmission', 'MobileRestaurantRemoveCheckItem', 'MobileRestaurantRequests', 'MobileRestaurantSeatWaitlistEntry', 'MobileRestaurantSendCheck',
    'MobileRestaurantServiceCalls', 'MobileRestaurantSetGuestCount', 'MobileRestaurantSetOrderingPaused', 'MobileRestaurantSettleCheck', 'MobileRestaurantSplitCheck',
    'MobileRestaurantWaitlist', 'MobileServiceCallChanged', 'MobileShiftChanged', 'MobileStockCountChanged', 'MobileStockTransferChanged',
    'MobileWaitlistChanged', 'PosBootstrap', 'VerifyPosCashier'
  ]::text[])
)
UPDATE bms_support_events AS e
   SET actor_id = CASE WHEN e.actor_id ~* '^(?:[0-9]{1,18}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|pos:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
                       THEN e.actor_id ELSE NULL END,
       session_id = CASE WHEN e.session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                         THEN e.session_id ELSE NULL END,
       correlation_id = CASE WHEN e.correlation_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                             THEN e.correlation_id ELSE NULL END,
       category = CASE WHEN e.category IN ('pos', 'navigation', 'network', 'ui', 'support')
                       THEN e.category ELSE 'support' END,
       action = CASE
         WHEN e.category = 'pos' AND (
           e.action IN ('desktop.renderer.crash', 'desktop.navigation.failed', 'desktop.connection.recovered',
             'desktop.startup.failed', 'desktop.pairing.failed', 'desktop.api.request',
             'pos.device.verify', 'pos.cashier.verify', 'pos.diagnostic_gap', 'pos.unknown_operation',
             'health.failed', 'health.recovered', 'health.online', 'realtime.ticket_failed',
             'realtime.disconnected', 'realtime.recovered', 'restaurant.api.failed',
             'restaurant.api.result', 'restaurant.api.request')
           OR e.action IN ('graphql.Unknown', 'network.Unknown')
           OR EXISTS (SELECT 1 FROM allowed_operations op
                       WHERE e.action IN ('graphql.' || op.name, 'network.' || op.name))
         ) THEN e.action
         WHEN e.category = 'pos' THEN 'pos.unknown_operation'
         WHEN e.action IN ('ui.route_view', 'network.online', 'network.offline',
           'ui.window_error', 'ui.unhandled_rejection', 'support.bundle_send_confirmed',
           'support.activity_gap', 'support.unknown_event') THEN e.action
         ELSE 'support.unknown_event'
       END,
       status = CASE WHEN e.status IN ('success', 'error', 'warning', 'info')
                     THEN e.status ELSE NULL END;
-- Older identifiable POS GraphQL and POS REST server faults may have retained an
-- exception stack/message in system_logs. Keep the structured columns needed to
-- correlate a received request, and erase free text from identifiable POS rows.
-- Uncorrelated historical GraphQL rows cannot safely be identified as POS.
UPDATE system_logs
   SET message = CASE WHEN category = 'graphql' THEN 'POS GraphQL error'
                      ELSE 'unhandled POS route error' END,
       error_message = NULL,
       stack = NULL,
       correlation_id = CASE
         WHEN correlation_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         THEN correlation_id ELSE NULL END,
       route_name = CASE
         WHEN category = 'graphql' THEN 'gql:Unknown'
         WHEN route_name ~ '^(GET|POST|PUT|PATCH|DELETE) /api/pos/[A-Za-z0-9/_-]+$'
         THEN route_name ELSE 'POST /api/pos/unknown' END,
       status = CASE WHEN category = 'graphql' THEN 'GRAPHQL_ERROR' ELSE '500' END,
       meta = '{}'::jsonb
 WHERE (category = 'api' AND route_name ~ '^[A-Z]+ /api/pos/')
    OR (category = 'graphql' AND route_name LIKE 'gql:%'
        AND (correlation_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             OR route_name ~ '^gql:(Mobile|DesktopPos|PosBootstrap|VerifyPosCashier)[A-Za-z0-9]*$'));
CREATE INDEX IF NOT EXISTS idx_bms_support_events_pos_correlation
  ON bms_support_events (tenant_id, correlation_id, occurred_at DESC, id DESC)
  WHERE category = 'pos' AND correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_support_events_pos_code
  ON bms_support_events (tenant_id, (context->>'errorCode'), occurred_at DESC, id DESC)
  WHERE category = 'pos' AND context ? 'errorCode';

-- ROLLBACK (only if the new search must be removed):
-- DROP INDEX IF EXISTS idx_bms_support_events_pos_code;
-- DROP INDEX IF EXISTS idx_bms_support_events_pos_correlation;
