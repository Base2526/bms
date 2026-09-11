export const coreTypeDefs = /* GraphQL */ `
  scalar JSON

  enum BlockAction {
    BLOCK
    UNBLOCK
  }

  enum BookmarkAction {
    BOOKMARK
    UNBOOKMARK
  }

  enum BookmarkTargetType {
    POST
  }

  type MyPhoneBlockStatusChangedPayload {
    user_id: ID!
    action: BlockAction!
    phone: String!
    phone_normalized: String!
    blocked: Boolean!
    updated_at: String!
  }

  type MyBankBlockStatusChangedPayload {
    user_id: ID!
    action: BlockAction!
    bank_name: String!
    account_norm: String!
    blocked: Boolean!
    updated_at: String!
  }

  type MyBookmarkStatusChangedPayload {
    user_id: ID!
    action: BookmarkAction!
    target_type: BookmarkTargetType!
    target_id: ID!
    bookmarked: Boolean!
    updated_at: String!
  }

  type MyContactSpamMarkChangedPayload {
    user_id: ID!
    action: String!
    phone_normalized: String!
    contact_name: String
    source: String
    active: Boolean!
    updated_at: String!
  }

  type MyContactSpamSettingsChangedPayload {
    user_id: ID!
    mode: String!
    risk_threshold: Int!
    sync_enabled: Boolean!
    auto_mark_enabled: Boolean!
    updated_at: String!
  }

  type BmsInboxChangedPayload {
    conversationId: ID!
    kind: String!
    messageSource: String
    messageId: ID
    occurredAt: String!
  }
  type User {
    id: ID!
    name: String!
    avatar: String
    phone: String
    email: String
    role: String!
    created_at: String!
  }

  type MessageImage {
    id: ID!
    file_id: ID!    # ← ใช้ bind กับ files.id
    url: String!
    mime: String
    width: Int
    height: Int
  }

  type MessageReceipt {
    deliveredAt: String!
    readAt: String
    isRead: Boolean!
  }

  type MessageLocation {
    latitude: Float!
    longitude: Float!
    placeName: String
    googleMapsUrl: String!
  }

  type Message {
    id: ID!
    chat_id: ID!
    sender: User
    type: String!
    text: String!
    location: MessageLocation
    created_at: String!
    to_user_ids: [ID!]!

    images: [MessageImage!]! 

    is_deleted: Boolean!
    deleted_at: String

    myReceipt: MessageReceipt!
    readers: [User!]!
    readersCount: Int!

    reply_to_id: ID
    reply_to: Message
  }

  type Notification {
    id: ID!
    user_id: ID!
    type: String!
    title: String!
    message: String!
    entity_type: String!
    entity_id: ID!
    data: JSON
    is_read: Boolean!
    created_at: String!
  }

  type Comment {
    id: ID!
    post_id: ID!
    user_id: ID!
    parent_id: ID
    content: String!
    created_at: String!
    updated_at: String!
    user: User!
    replies: [Comment!]!
  }

  type RealtimeEvent {
    eventId: ID!
    eventType: String!
    schemaVersion: Int!
    tenantId: ID!
    locationId: ID
    userId: ID
    actorType: String!
    actorId: ID
    deviceId: ID
    entityType: String!
    entityId: ID!
    aggregateVersion: Float
    updatedAt: String
    occurredAt: String!
    payload: JSON
  }

  type Query { _ok: String! }
  type Mutation { 
    send(text: String!): Boolean! 
  }
  type Subscription { 
    time: String!
    messageAdded(chat_id: ID!): Message! 
    userMessageAdded(user_id: ID!): Message! 

    messageDeleted(chat_id: ID!): ID!


    notificationCreated: Notification!  # push real-time


    commentAdded(post_id: ID!): Comment!
    commentUpdated(post_id: ID!): Comment!
    commentDeleted(post_id: ID!): ID!          # ส่ง id ที่ลบ



    incomingMessage(user_id: ID!): Message!

    # ✅ realtime multi-device sync (same-user)
    myPhoneBlockStatusChanged: MyPhoneBlockStatusChangedPayload!
    myBankBlockStatusChanged: MyBankBlockStatusChangedPayload!

    myBookmarkStatusChanged: MyBookmarkStatusChangedPayload!
    myContactSpamMarkChanged: MyContactSpamMarkChangedPayload!
    myContactSpamSettingsChanged: MyContactSpamSettingsChangedPayload!

    # Small tenant-scoped invalidation event. Conversation data remains behind
    # the normal BMS queries so their RBAC and tenant rules stay authoritative.
    bmsInboxChanged: BmsInboxChangedPayload!

    # Versioned safe invalidations. The ticket determines tenant/user/location topics;
    # event payloads never authorize or replace the authoritative query.
    realtimeEvent: RealtimeEvent!

    # Named domain views over the same invalidation stream. Each one is scoped by the
    # ticket (tenant, and location/device where the domain is branch-bound), filtered by
    # the same central permission rule, and carries no authoritative data — the client
    # refetches the real query. They exist so a register can subscribe to the few domains
    # it renders instead of waking on every event in its scope.
    bmsDeviceSessionChanged: RealtimeEvent!  # device pairing/revocation for this register
    bmsShiftChanged: RealtimeEvent!  # shift open/close and drawer cash movement
    bmsPosOrderChanged: RealtimeEvent!  # a sale owned by a register
    bmsRestaurantFloorChanged: RealtimeEvent!  # zones and tables
    bmsRestaurantCheckChanged: RealtimeEvent!  # open check lifecycle and kitchen rounds
    bmsKitchenTicketChanged: RealtimeEvent!  # both kitchen queues (retail and restaurant)
    bmsMenuAvailabilityChanged: RealtimeEvent!  # sold-out today and catalog availability
    bmsQrOrderChanged: RealtimeEvent!  # table QR proposals
    bmsIncomingOrderChanged: RealtimeEvent!  # chat/online order requests
    bmsWaitlistChanged: RealtimeEvent!  # queue tickets and reservations
    bmsInventoryChanged: RealtimeEvent!  # stock and reservation movement
    bmsStockTransferChanged: RealtimeEvent!  # inter-branch transfer send/receive
    bmsStockCountChanged: RealtimeEvent!  # stock count applied
    bmsPaymentChanged: RealtimeEvent!  # payment submit/confirm/reject/refund
    bmsOrderChanged: RealtimeEvent!  # order create/status/fulfilment
    bmsNotificationCreated: RealtimeEvent!  # notification for this principal
  }
`;
