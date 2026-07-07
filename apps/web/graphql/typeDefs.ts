export const typeDefs = /* GraphQL */ `
  scalar JSON
  scalar Upload
  enum PostStatus { public unpublic }

  type Role {
    id: ID!
    name: String!
    description: String
    is_active: Boolean!
    created_at: String!
    updated_at: String!
    user_count: Int!
  }

  type User {
    id: ID!
    name: String!
    avatar: String
    phone: String
    email: String
    role: String! # Legacy text field (backward compatibility)
    role_id: ID # New normalized field
    roleDetails: Role # Related role object
    created_at: String!
    username: String!
    language: String!
    notifications_enabled: Boolean!
  }

  type UserConnection {
    items: [User!]!
    total: Int!
  }

  type Chat {
    id: ID!
    name: String
    is_group: Boolean!
    is_undeletable: Boolean!
    created_by: User
    created_at: String!
    members: [User!]!

    last_message: Message
    last_message_at: String
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

  input MessageLocationInput {
    latitude: Float!
    longitude: Float!
    placeName: String
    googleMapsUrl: String
  }

  type ChatMemberSettings {
    is_muted: Boolean!
    notifications_enabled: Boolean!
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

    audio: MessageAudio

    is_deleted: Boolean!
    deleted_at: String

    myReceipt: MessageReceipt!
    readers: [User!]!
    readersCount: Int!

    reply_to_id: ID
    reply_to: Message
  }

  type MessageAudio {
    file_id: ID!
    url: String!
    mime: String
    duration_sec: Int
  }

  type MessageImage {
    id: ID!
    file_id: ID!    # ← ใช้ bind กับ files.id
    url: String!
    mime: String
    width: Int
    height: Int
  }

  type MessageConnection {
    items: [Message!]!
    nextCursor: String
    hasMore: Boolean!
  }

  input UserInput {
    name: String!
    avatar: String
    phone: String
    email: String
    role: String # Legacy field (optional, backward compatibility)
    role_id: ID # New field - use this for new code
    passwordHash: String
  }

  input CreateRoleInput {
    name: String!
    description: String
    is_active: Boolean
  }

  input UpdateRoleInput {
    name: String
    description: String
    is_active: Boolean
  }

  type LoginResult {
    ok: Boolean!
    message: String
    token: String
    user: User
  }

  input SocialLoginInput {
    provider: String!      # "google" | "facebook"
    accessToken: String!   # จาก Google/Facebook
  }

  input LoginInput {
    email: String
    username: String
    password: String!
  }

  type Bookmark {
    user_id: ID!
  }

  type TelNumber {
    id: ID!
    tel: String!
  }

  type SellerAccount {
    id: ID!
    bank_id: String
    bank_name: String
    seller_account: String
  }

  type Post {
    id: ID!
    author: User
    status: PostStatus!
    created_at: String!
    updated_at: String!
    images: [Image!]! 
    bookmarks: [Bookmark!]!
    is_bookmarked: Boolean!
    first_last_name: String
    id_card: String
    title: String
    transfer_amount: Float
    transfer_date: String
    website: String
    province_id: ID
    province_name: String
    detail: String
    tel_numbers: [TelNumber!]!
    seller_accounts: [SellerAccount!]!

    comments_count: Int
    auto_publish: Boolean!

    # ---------------------------
    # ✅ Social (Facebook)
    # ---------------------------

    """
    ลิงก์ไปยังโพสต์บน Facebook Page
    ใช้สำหรับปุ่ม "ดูโพสต์บน Facebook"
    """
    fb_permalink_url: String

    """
    เวลาที่โพสต์ถูก publish จริงบน Facebook (ISO string)
    """
    fb_published_at: String

    """
    สถานะจาก social_posts
    เช่น PENDING | PUBLISHED | FAILED | DELETED
    """
    fb_status: String

    """
    ID ของโพสต์บน Facebook (page_post_id)
    ใช้ลบ/อัปเดตในอนาคต
    """
    fb_social_post_id: String
  }

  type Chat { id: ID!, name: String, is_group: Boolean!, created_at: String! }

  # type Message { 
  #  id: ID!, chat_id: ID!, sender_id: ID!, text: String!, created_at: String! 
  # }

  type Stats {
    users: Int!
    posts: Int!
    files: Int!
    logs: Int!
  }

  type DashboardUser {
    id: ID!
    name: String
    email: String
    role: String
    created_at: String
    avatar: String
  }

  type DashboardPost {
    id: ID!
    title: String
    status: String
    created_at: String
  }

  type PendingSummary {
    posts_awaiting_approval: Int!
    users_pending_invite: Int!
    files_unclassified: Int!
    errors_last24h: Int!
  }

  type StatsSummary {
    users: Int!
    posts: Int!
    files: Int!
    logs: Int!
  }

  type PostConnection {
    items: [Post!]!
    total: Int!
  }

  type File {
    id: ID!
    filename: String!
    original_name: String
    mimetype: String
    size: Int!
    relpath: String!
    created_at: String!
    updated_at: String!
    url: String!        # เสิร์ฟผ่าน /api/files/:id
    thumb: String       # สำหรับรูปภาพ (อาจใช้ url เดิม)
  }

  type FileConnection {
    items: [File!]!
    total: Int!
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

  # ==== Types แยกตาม entity ====
  type SearchPostResult {
    id: ID!
    entity_id: ID!        # = post id
    title: String!
    snippet: String
    created_at: String
  }

  type SearchUserResult {
    id: ID!
    entity_id: ID!        # = user id
    name: String!
    email: String
    phone: String
    avatar: String
  }

  type SearchPhoneReportResult {
    id: ID!
    entity_id: String!    # = หมายเลขโทรตรง ๆ ไว้ /phone/[number]
    ids: [ID!]! 
    phone: String!
    report_count: Int!
    last_report_at: String
  }

  type SearchBankAccountResult {
    id: ID!
    entity_id: ID!
    ids: [ID!]!

    bank_name: String!
    account_no_masked: String!
    report_count: Int!
    last_report_at: String

    # ✅ client fields
    account: String
    risk_level: Int
    tags: [String!]!
    updated_at: String
    is_deleted: Boolean!
    post_ids: [ID!]!
    post_count: Int!
    latest_post_id: ID
    ctx: JSON
  }


  type GlobalSearchResult {
    posts: [SearchPostResult!]!
    users: [SearchUserResult!]!
    phones: [SearchPhoneReportResult!]!
    bank_accounts: [SearchBankAccountResult!]!
  }

  type ScamPhoneSnapshotPage {
    cursor: String
    items: [ScamPhone!]!
  }

  type ScamPhoneDeltaPage {
    cursor: String
    items: [ScamPhone!]!
  }

  # =========================
  # Types
  # =========================
  type PhoneSafetyStatus {
    phone: String!
    phone_normalized: String!

    # ของฉัน
    my_blocked: Boolean!
    my_blocked_at: String

    # community (ไม่บอกว่าใคร)
    blocked_by_count: Int!
    last_blocked_at: String

    report_count: Int!
    last_report_at: String

    risk_level: Int!
    updated_at: String!
  }

  enum PhoneCenterFilter {
    ALL
    BLOCKED
    REPORTS
    HISTORY
  }

  enum RelatedPostsSort {
    LATEST
    HIGHEST_RISK
    MOST_REPORTED
  }

  type PhoneCenterItem {
    phone: String!
    phone_normalized: String!
    my_blocked: Boolean!
    my_blocked_at: String
    my_reported: Boolean!
    my_reported_at: String
    in_history: Boolean!
    last_history_at: String
    report_count: Int!
    last_report_at: String
    risk_level: Int!
    updated_at: String!
    post_count: Int!
    latest_post_id: ID
    post_ids: [ID!]!
    filters: [String!]!
  }

  type PhoneEntityDetail {
    phone: String!
    phone_normalized: String!
    my_blocked: Boolean!
    my_blocked_at: String
    my_reported: Boolean!
    my_reported_at: String
    in_history: Boolean!
    last_history_at: String
    report_count: Int!
    last_report_at: String
    risk_level: Int!
    updated_at: String!
    post_count: Int!
    latest_post_id: ID
    post_ids: [ID!]!
    filters: [String!]!
  }

  type BankEntityDetail {
    bank_code: String!
    bank_name: String!
    account: String!
    report_count: Int!
    last_report_at: String
    risk_level: Int!
    updated_at: String!
    post_count: Int!
    latest_post_id: ID
    post_ids: [ID!]!
    is_reported: Boolean!
    tags: [String!]!
  }

  type PhoneCenterActionPayload {
    ok: Boolean!
    item: PhoneCenterItem!
  }

  input BlockPhoneInput {
    phone: String!
    note: String
    postId: ID
  }

  input UnblockPhoneInput {
    phone: String!
  }

  type BlockPhonePayload {
    ok: Boolean!
    status: PhoneSafetyStatus!
  }

  type CallHistoryLog {
    id: ID!
    normalized_number: String!
    type: String!
    source: String!
    action: String!
    matched_by: String
    created_at: String!
  }

  input LogCallInput {
    normalized_number: String!
    type: String!
    source: String!
    action: String!
    matched_by: String
    created_at: String
  }

  # =========================
  # Bank account (Search + Report)
  # =========================

  type ScamBankAccount {
    bank_name: String!
    account_no_masked: String!
    account_norm: String!
    report_count: Int!
    last_report_at: String
    risk_level: Int!
    updated_at: String!
  }

  input ReportBankAccountInput {
    bank_name: String!
    account_no: String!
    note: String
    client_id: String!         # UUID v4
    device_model: String
    os_version: String
    app_version: String
  }

  # =========================
  # ✅ Union for client (ใช้ __typename)
  # =========================
  union SearchType =
      SearchPostResult
    | SearchUserResult
    | SearchPhoneReportResult
    | SearchBankAccountResult


  type MyReportedPhone {
    phone: String!
    created_at: String!
    updated_at: String!
    report_count: Int!
    risk_level: Int!
    tags: [String!]!
    category: ScamPhoneReportCategory!
    note: String
    post_id: String
  }

  type MyReportedBankAccount {
    account: String!
    bank_name: String!
    created_at: String!
    updated_at: String!
    report_count: Int!
    risk_level: Int!
    tags: [String!]!
    category: ScamPhoneReportCategory
    note: String
    post_id: String
  }

  type Query {
    _health: String!
    meRole: String!
    posts(search: String): [Post!]!
    postsPaged(search: String, limit: Int!, offset: Int!): PostConnection!  
    post(id: ID!): Post
    myPosts(search: String): [Post!]!

    getOrCreateDm(user_id: ID!): Chat!

    roles: [Role!]!
    role(id: ID!): Role
    users(search: String, limit: Int = 10, offset: Int = 0): UserConnection!
    user(id: ID!): User

    postsByUserId(user_id: ID!): [Post!]!


    myChats: [Chat!]!
    myChatSettings(chat_id: ID!): ChatMemberSettings!
    messages(chat_id: ID!, limit: Int, offset: Int, includeDeleted: Boolean): [Message!]!
    messagesConnection(chat_id: ID!, limit: Int = 30, cursor: String, includeDeleted: Boolean): MessageConnection!

    me: User

    unreadCount(chatId: ID!): Int!
    myUnreadChatCount: Int!
    whoRead(messageId: ID!): [User!]!


    stats: StatsSummary!
    pending: PendingSummary!
    # stats: Stats!
    latestUsers(limit: Int = 5): [DashboardUser!]!
    latestPosts(limit: Int = 5): [Post!]!

    filesPaged(search: String, limit: Int!, offset: Int!): FileConnection!

    myBookmarks(limit: Int, offset: Int): [Post!]!

    myNotifications(limit: Int, offset: Int): [Notification!]!
    myUnreadNotificationCount: Int!

    comments(post_id: ID!): [Comment!]!

    globalSearch(q: String!): GlobalSearchResult!


    # ใช้ initial sync
    scamPhonesSnapshot(cursor: String, limit: Int! = 1000): ScamPhoneSnapshotPage!
    # ใช้ delta sync
    scamPhonesDelta(sinceVersion: String!, cursor: String, limit: Int! = 1000): ScamPhoneDeltaPage!
    # ใช้ manual search (เหมือน globalSearch แต่เฉพาะเบอร์)
    searchScamPhones(q: String!, limit: Int! = 20): [ScamPhone!]!


    phoneSafetyStatus(phone: String!): PhoneSafetyStatus!
    getPhoneInfo(phone: String!): ScamPhone!
    phoneCenterSearch(q: String, filter: PhoneCenterFilter = ALL, limit: Int = 50, offset: Int = 0): [PhoneCenterItem!]!
    phoneDetail(phone: String!): PhoneEntityDetail!
    relatedPostsByPhone(phone: String!, sort: RelatedPostsSort = LATEST): [ID!]!
    myBlockedPhones(limit: Int = 50, offset: Int = 0): [PhoneSafetyStatus!]!

    # compact key sets for client-side status checks (source of truth: backend)
    myBlockedPhoneKeys: [String!]!

    # Spec-required (additive) call-block APIs
    getUserBlockedNumbers: [String!]!
    getSpamNumbers(minRisk: Int = 60, limit: Int = 200): [ScamPhone!]!
    getCallLogs(limit: Int = 100, offset: Int = 0): [CallHistoryLog!]!

    # exact + prefix (ตัวเลขล้วน) + (option) bank_name prefix
    searchBankAccounts(q: String!, limit: Int! = 20): [SearchBankAccountResult!]!
    bankDetail(bankCode: String!, accountNo: String!): BankEntityDetail!
    relatedPostsByBank(bankCode: String!, accountNo: String!, sort: RelatedPostsSort = LATEST): [ID!]!

    searchScamBankAccounts(q: String!, limit: Int! = 20): [SearchBankAccountResult!]!

    # (optional) unified search array (client ใช้ __typename)
    globalSearchUnified(q: String!, limit: Int! = 20): [SearchType!]!

    myReportedPhones(limit: Int!, offset: Int!): [MyReportedPhone!]!

    myReportedPhoneKeys: [String!]!

    myReportedBankAccounts(limit: Int!, offset: Int!): [MyReportedBankAccount!]!

    myReportedBankAccountKeys: [String!]!

    myContactSpamProtectionSettings: ContactSpamProtectionSettings!
    myContactSpamMarkedPhoneKeys: [String!]!

    # ===== BMS orders (admin) =====
    bmsOrders(status: BmsOrderStatus, limit: Int = 50, offset: Int = 0): [BmsOrder!]!
    bmsOrder(id: ID!): BmsOrder

    # ===== BMS products & inventory (admin) =====
    bmsProducts: [BmsProduct!]!
    bmsLowStock: [BmsLowStockItem!]!
    bmsStockMovements(sku: String!, size: String, limit: Int = 50): [BmsStockMovement!]!

    # ===== BMS CRM (admin) =====
    bmsCustomers(search: String, limit: Int = 50, offset: Int = 0): [BmsCustomer!]!
    bmsCustomer(id: ID!): BmsCustomer

    # ===== BMS Dashboard (admin) =====
    bmsDashboard: BmsDashboard!

    # ===== BMS settings / channels (admin) =====
    bmsMyTenant: BmsTenantInfo!
    bmsChannels: [BmsChannelConfig!]!

    # ===== BMS billing (admin) =====
    bmsBilling: BmsBilling!

    # ===== BMS RBAC (admin) =====
    myBmsPermissions: [String!]!          # สิทธิ์ของ admin ปัจจุบัน (UI gating)
    bmsPermissionCatalog: [String!]!      # รายการสิทธิ์ทั้งหมด
    bmsRolePermissions: [BmsRolePermissions!]!
    bmsAuditLog(limit: Int = 100): [BmsAuditEntry!]!
  }

  # ===== BMS orders =====
  enum BmsOrderStatus {
    PENDING
    PAID
    PACKING
    SHIPPED
    COMPLETED
    CANCELLED
    RETURNED
  }

  type BmsOrderItem {
    product_sku: String!
    size: String!
    qty: Int!
    unit_price: Float!
  }

  type BmsOrder {
    id: ID!
    channel: String!
    customer_ref: String
    status: BmsOrderStatus!
    total_amount: Float!
    created_at: String!
    updated_at: String!
    items: [BmsOrderItem!]!
  }

  # ===== BMS products & inventory =====
  type BmsVariant {
    size: String!
    current_stock: Int!
    reserved_stock: Int!
    available: Int!
    reorder_point: Int!
    low: Boolean!
  }

  type BmsProduct {
    sku: String!
    name: String!
    active: Boolean!
    price: Float!
    keywords: [String!]!
    barcode: String
    variants: [BmsVariant!]!
  }

  input BmsProductInput {
    sku: String!
    name: String!
    price: Float!
    keywords: [String!]
    active: Boolean
    barcode: String
  }

  type BmsLowStockItem {
    sku: String!
    name: String!
    size: String!
    available: Int!
    reorder_point: Int!
  }

  type BmsStockMovement {
    id: ID!
    product_sku: String!
    size: String!
    type: String!
    qty: Int!
    ref_order_id: String
    note: String
    actor: String
    created_at: String!
  }

  # ===== BMS CRM =====
  type BmsCustomerAddress {
    id: ID!
    label: String
    address: String!
    is_default: Boolean!
  }

  type BmsCustomerIdentity {
    channel: String!
    external_ref: String!
  }

  type BmsCustomer {
    id: ID!
    name: String!
    phone: String
    note: String
    tags: [String!]!
    total_spent: Float!
    order_count: Int!
    created_at: String!
    addresses: [BmsCustomerAddress!]!
    identities: [BmsCustomerIdentity!]!
    orders: [BmsOrder!]!
  }

  input BmsCustomerInput {
    id: ID
    name: String!
    phone: String
    note: String
    tags: [String!]
  }

  # ===== BMS Dashboard =====
  type BmsStatusCount { status: String!  count: Int! }
  type BmsTopProduct  { sku: String!  name: String!  qty: Int!  revenue: Float! }
  type BmsTopCustomer { id: ID!  name: String!  tags: [String!]!  spent: Float!  orders: Int! }
  type BmsDailySales  { day: String!  revenue: Float!  orders: Int! }

  type BmsDashboard {
    revenueTotal: Float!
    revenueToday: Float!
    orderCount: Int!
    lowStockCount: Int!
    customerCount: Int!
    ordersByStatus: [BmsStatusCount!]!
    topProducts: [BmsTopProduct!]!
    topCustomers: [BmsTopCustomer!]!
    salesDaily: [BmsDailySales!]!
  }

  # ===== BMS audit log =====
  type BmsAuditEntry {
    id: ID!
    actor: String
    action: String!
    target: String
    meta: JSON
    created_at: String!
  }

  # ===== BMS RBAC =====
  type BmsRolePermissions {
    id: ID!
    name: String!
    is_super: Boolean!
    permissions: [String!]!
  }

  # ===== BMS SaaS: plans / billing / signup =====
  type BmsPlan {
    code: String!  name: String!  price_monthly: Float!
    max_products: Int!  max_channels: Int!  max_orders_month: Int!
  }
  type BmsUsage { products: Int!  channels: Int!  orders_month: Int! }
  type BmsBilling {
    plan: BmsPlan!
    usage: BmsUsage!
    plans: [BmsPlan!]!
  }
  type BmsSignupResult { status: String!  tenantId: ID  slug: String }

  # ===== BMS channels / settings =====
  type BmsTenantInfo { id: ID!  name: String!  slug: String! }

  type BmsChannelConfig {
    channel: String!
    active: Boolean!
    has_token: Boolean!
    has_secret: Boolean!
    access_token_masked: String
    channel_secret_masked: String
  }

  input RegisterPushTokenInput {
    platform: String! # 'android'
    fcmToken: String!
    deviceId: String
    appVersion: String
    locale: String
  }

  input TelNumberInput {
    id: ID
    tel: String!
    mode: String # "new" | "edited" | "deleted"
  }
  input SellerAccountInput {
    id: ID
    bank_id: String!
    bank_name: String!
    seller_account: String
    mode: String
  }

  input PostInput {
    # new fields
    first_last_name: String
    id_card: String
    title: String
    transfer_amount: Float
    transfer_date: String   # ISO string
    website: String
    province_id: ID
    detail: String

    # arrays
    tel_numbers: [TelNumberInput!]
    seller_accounts: [SellerAccountInput!]
    status: PostStatus!

    auto_publish: Boolean
  }

  input MyProfileInput {
    name: String
    avatar: String
    phone: String
  }

  input RegisterInput {
    username: String!
    email: String!
    phone: String
    password: String!
    agree: Boolean
  }

  type Image {
    id: ID!
    url: String!
  }

  type ToggleBookmarkResult {
    status: Boolean!
    isBookmarked: Boolean!
    executionTime: String
  }

  input MeInput {
    name: String
    email: String
    phone: String
    username: String
    language: String
    notifications_enabled: Boolean
  }

  enum ContactSpamProtectionMode {
    OFF
    PROMPT
    AUTO
  }

  enum ContactSpamMarkSource {
    MANUAL
    SUGGESTED
    AUTO
  }

  type ContactSpamProtectionSettings {
    user_id: ID!
    mode: ContactSpamProtectionMode!
    risk_threshold: Int!
    sync_enabled: Boolean!
    auto_mark_enabled: Boolean!
    updated_at: String!
  }

  type ContactSpamMark {
    user_id: ID!
    action: String!
    phone_normalized: String!
    contact_name: String
    source: ContactSpamMarkSource
    active: Boolean!
    updated_at: String!
  }

  input ContactSpamProtectionSettingsInput {
    mode: ContactSpamProtectionMode!
    risk_threshold: Int!
    sync_enabled: Boolean!
    auto_mark_enabled: Boolean!
  }

  
  enum ScamPhoneReportCategory {
    SPAM
    SCAM
    SALES
    HARASS
    OTHER
  }

  type ScamPhone {
    phone: String!
    report_count: Int!
    last_report_at: String
    risk_level: Int!
    tags: [String!]!
    updated_at: String!
    is_deleted: Boolean!
    post_ids: [String!]!
    ctx: JSON
  }

  input ReportScamPhoneInput {
    phone: String!
    note: String
    local_blocked: Boolean!
    client_id: String!
    device_model: String
    os_version: String
    app_version: String
    category: ScamPhoneReportCategory
  }






  type BasicResponse {
    ok: Boolean!
    message: String!
  }

  input SupportTicketInput {
    name: String!
    email: String!
    phone: String
    topic: String!
    subject: String!
    message: String!
    ref: String
    pageUrl: String
    userAgent: String
  }

  type SupportTicketPayload {
    ok: Boolean!
    message: String
    ticketId: String
  }

  input UploadDiagnosticsInput {
    userId: ID
    platform: String!
    appVersion: String
    buildNumber: String
    packageName: String
    deviceModel: String
    osVersion: String
    exportedAt: String!
    diagnosticsJson: String!
    callCheckLogsJson: String
  }

  type UploadDiagnosticsPayload {
    success: Boolean!
    message: String
    uploadId: ID
  }

  input ReportScamBankAccountInput {
    bank_name: String!
    account: String!
    note: String
    client_id: String!
    device_model: String
    os_version: String
    app_version: String
  }

  type ScamBankAccount {
    account: String!
    bank_name: String!
    report_count: Int!
    last_report_at: String
    risk_level: Int!
    tags: [String!]
    updated_at: String!
    is_deleted: Boolean!
    post_ids: [ID!]
    ctx: JSON
  }

   input UnblockScamPhoneInput {
    phone: String!
    client_id: String!
    device_model: String
    os_version: String
    app_version: String
  }


   input UnreportScamBankAccountInput {
    bank_name: String!
    account: String!
    client_id: String!
    device_model: String
    os_version: String
    app_version: String
    reason: String
  }

  type Mutation {
    # login
    login(input: LoginInput!): LoginResult!
    loginUser(input: LoginInput!): LoginResult!
    loginWithSocial(input: SocialLoginInput!): LoginResult!
    loginAdmin(input: LoginInput!): LoginResult!
    loginMobile(email:String!, password:String!): LoginResult!

    registerUser(input: RegisterInput!): Boolean!
    verifyEmail(token: String!): BasicResponse!

    upsertPost(id: ID, data: PostInput!, images: [Upload!], image_ids_delete: [ID!]): Post!
    deletePost(id: ID!): Boolean!
    deletePosts(ids: [ID!]!): Boolean! 
    clonePost(id: ID!): String!

    upsertUser(id: ID, data: UserInput!): User!
    uploadAvatar(user_id: ID!, file: Upload!): String! 
    deleteUser(id: ID!): Boolean!
    deleteUsers(ids: [ID!]!): Boolean!

    createChat(name: String, isGroup: Boolean!, memberIds: [ID!]!): Chat!
    addMember(chat_id: ID!, user_id: ID!): Boolean!
    sendMessage(
      chat_id: ID!
      text: String!
      to_user_ids: [ID!]!
      images: [Upload!]
      audio: Upload
      audio_duration_sec: Int
      location: MessageLocationInput
      reply_to_id: ID
      client_message_id: String
    ): Message!

    updateMyProfile(data: MyProfileInput!): User!

    renameChat(chat_id: ID!, name: String): Boolean!
    deleteChat(chat_id: ID!): Boolean!
    updateMyChatSettings(
      chat_id: ID!
      is_muted: Boolean
      notifications_enabled: Boolean
    ): ChatMemberSettings!

    markMessageRead(message_id: ID!): Boolean!
    markChatReadUpTo(chat_id: ID!, cursor: String!): Boolean!

    registerPushToken(input: RegisterPushTokenInput!): Boolean!
    unregisterPushToken(fcmToken: String!): Boolean!

    deleteMessage(message_id: ID!): Boolean!

    requestPasswordReset(email: String!): Boolean
    resetPassword(token: String!, newPassword: String!): Boolean

    deleteFile(id: ID!): Boolean!
    deleteFiles(ids: [ID!]!): Boolean!    
    renameFile(id: ID!, name: String!): Boolean!

    toggleBookmark(postId: ID!): ToggleBookmarkResult!

    # Explicit operations (avoids ambiguous "toggle" semantics)
    bookmark(postId: ID!): ToggleBookmarkResult!
    unbookmark(postId: ID!): ToggleBookmarkResult!

    updateMe(data: MeInput!): User!

    markNotificationRead(id: ID!): Boolean!
    markAllNotificationsRead: Boolean!

    addComment(post_id: ID!, content: String!): Comment!
    replyComment(comment_id: ID!, content: String!): Comment!
    updateComment(id: ID!, content: String!): Comment!
    deleteComment(id: ID!): Boolean!

    reportScamPhone(input: ReportScamPhoneInput!): ScamPhone!
    unblockScamPhone(input: UnblockScamPhoneInput!): ScamPhone!

    createSupportTicket(input: SupportTicketInput!): SupportTicketPayload!


    blockPhone(input: BlockPhoneInput!): BlockPhonePayload!
    unblockPhone(input: UnblockPhoneInput!): BlockPhonePayload!
    reportPhone(phone: String!, category: ScamPhoneReportCategory, note: String): PhoneCenterActionPayload!

    # Spec-required (additive) call-block APIs
    blockNumber(phoneNumber: String!): PhoneCenterActionPayload!
    unblockNumber(phoneNumber: String!): PhoneCenterActionPayload!
    reportNumber(phoneNumber: String!, category: ScamPhoneReportCategory, note: String): PhoneCenterActionPayload!
    reportSpam(phoneNumber: String!): Boolean!
    ingestCallLogs(logs: [LogCallInput!]!): Boolean!

    uploadDiagnostics(input: UploadDiagnosticsInput!): UploadDiagnosticsPayload!

    reportBankAccount(input: ReportBankAccountInput!): ScamBankAccount!

    reportScamBankAccount(input: ReportScamBankAccountInput!): ScamBankAccount!
    unreportScamBankAccount(input: UnreportScamBankAccountInput!): ScamBankAccount!

    updateMyContactSpamProtectionSettings(input: ContactSpamProtectionSettingsInput!): ContactSpamProtectionSettings!
    markContactSpamPhone(phone: String!, contact_name: String, source: ContactSpamMarkSource): ContactSpamMark!
    unmarkContactSpamPhone(phone: String!): ContactSpamMark!

    # Role Management
    createRole(input: CreateRoleInput!): Role!
    updateRole(id: ID!, input: UpdateRoleInput!): Role!
    deleteRole(id: ID!): Boolean!
    setRoleActive(id: ID!, is_active: Boolean!): Role!

    # ===== BMS orders (admin) — OMS state machine =====
    bmsPayOrder(id: ID!): Boolean!        # PENDING → PAID
    bmsPackOrder(id: ID!): Boolean!       # PAID → PACKING
    bmsShipOrder(id: ID!): Boolean!       # PACKING → SHIPPED (ตัดสต็อก)
    bmsCompleteOrder(id: ID!): Boolean!   # SHIPPED → COMPLETED
    bmsCancelOrder(id: ID!): Boolean!     # (PENDING/PAID/PACKING) → CANCELLED (คืน reserved)
    bmsReturnOrder(id: ID!): Boolean!     # (SHIPPED/COMPLETED) → RETURNED (คืนสต็อก)

    # ===== BMS products & inventory (admin) =====
    bmsUpsertProduct(input: BmsProductInput!): BmsProduct!
    bmsSetProductActive(sku: String!, active: Boolean!): Boolean!
    bmsAdjustStock(sku: String!, size: String!, delta: Int!, note: String): BmsVariant!
    bmsSetReorderPoint(sku: String!, size: String!, reorderPoint: Int!): BmsVariant!

    # ===== BMS CRM (admin) =====
    bmsUpsertCustomer(input: BmsCustomerInput!): BmsCustomer!
    bmsSetCustomerTags(id: ID!, tags: [String!]!): Boolean!
    bmsAddCustomerAddress(id: ID!, label: String, address: String!, isDefault: Boolean): BmsCustomerAddress!
    bmsDeleteCustomer(id: ID!): Boolean!

    # ===== BMS RBAC (admin) =====
    bmsSetRolePermissions(roleId: ID!, permissions: [String!]!): Boolean!

    # ===== BMS settings / channels (admin) =====
    bmsUpsertChannel(channel: String!, accessToken: String, channelSecret: String, active: Boolean): Boolean!

    # ===== BMS SaaS: signup (public) + billing (admin) =====
    bmsSignup(shopName: String!, name: String, email: String!, password: String!): BmsSignupResult!
    bmsChangePlan(planCode: String!): Boolean!
  }
`;
