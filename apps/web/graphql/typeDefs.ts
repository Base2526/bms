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
    themePreference: String
    notifications_enabled: Boolean!
    tenantName: String # ชื่อร้านของ user นี้ — ให้ platform admin เห็นว่า user เป็นของร้านไหน (null ถ้าไม่มี tenant_id)
    lastLoginAt: String # ISO string ล่าสุดที่ login สำเร็จ (null = ยังไม่เคย login ตั้งแต่มี column นี้)
    is_platform_admin: Boolean!
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
    password: String
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


  # ---- POS / สาขา / lot ----
  type BmsLocation {
    id: ID!
    code: String!
    name: String!
    branchCode: String!
    isHeadOffice: Boolean!
    vatCode: String
    address: String
    phone: String
    pharmacyLicenseNo: String
    pharmacistName: String
    pharmacistLicenseNo: String
    active: Boolean!
  }

  input BmsLocationInput {
    id: ID
    code: String!
    name: String!
    branchCode: String!
    address: String
    phone: String
    active: Boolean
  }

  type BmsPosDevice {
    id: ID!
    tenantId: ID!
    locationId: ID!
    code: String!
    name: String
    registeredPosNo: String
    receiptPrefix: String
    scannerMode: String!
    scannerPrefixKey: String!
    scannerSuffixKey: String!
    scannerMaxGapMs: Int!
    active: Boolean!
  }

  input BmsPosDeviceInput {
    id: ID
    locationId: ID!
    code: String!
    name: String
    registeredPosNo: String
    receiptPrefix: String
    scannerMode: String
    scannerPrefixKey: String
    scannerSuffixKey: String
    scannerMaxGapMs: Int
    active: Boolean
  }

  " token ค่าจริงคืนครั้งเดียวตอนออกเท่านั้น ฐานข้อมูลเก็บแต่ hash "
  type BmsPosDeviceToken {
    token: String!
  }

  type BmsPosOperationalReadiness {
    ready: Boolean!
    blockers: [String!]!
    warnings: [String!]!
    activeLocations: Int!
    activeDevices: Int!
    pairedDevices: Int!
    cashiersWithPin: Int!
    cashiersReady: Int!
    sellableProducts: Int!
    unknownVatProducts: Int!
    stockedVariants: Int!
    openShifts: Int!
    pendingRefundCount: Int!
    pendingRefundAmount: Float!
  }

  " หน่วยขาย: สิ่งที่ลูกค้าซื้อจริงและมีบาร์โค้ดของตัวเอง (แผง / กล่อง) "
  type BmsProductPack {
    id: ID!
    productSku: String!
    size: String
    packCode: String!
    unitName: String!
    baseQty: Int!
    barcode: String
    " null = คิดจากราคาสินค้า × baseQty "
    price: Float
    isBase: Boolean!
    active: Boolean!
  }

  type BmsProductPackList {
    packs: [BmsProductPack!]!
    " ไซซ์ที่มีแถวสต็อกจริง "
    sizes: [String!]!
  }

  input BmsProductPackInput {
    id: ID
    productSku: String!
    size: String
    packCode: String!
    unitName: String!
    baseQty: Int!
    barcode: String
    price: Float
    isBase: Boolean
    active: Boolean
  }

  type BmsPackAudit {
    sku: String!
    name: String!
    sizes: Int!
    packs: Int!
    sizesWithoutBarcode: [String!]!
  }

  type BmsEtaxSummary {
    enabled: Boolean!
    pending: Int!
    sent: Int!
    accepted: Int!
    rejected: Int!
    failed: Int!
    " ใบกำกับที่ออกแล้วแต่ยังไม่เคยเข้าคิว "
    notQueued: Int!
  }

  type BmsEtaxSubmission {
    id: ID!
    documentId: ID!
    docNo: String
    status: String!
    provider: String
    providerRef: String
    attempts: Int!
    lastError: String
    nextAttemptAt: String
    sentAt: String
    settledAt: String
  }

  type BmsEtaxRunResult {
    processed: Int!
    accepted: Int!
    failed: Int!
    rejected: Int!
  }

  type BmsPosCashier {
    id: ID!
    name: String
    email: String
    role: String
    isPharmacist: Boolean!
    hasPin: Boolean!
    posOnly: Boolean!
  }

  type BmsPosShift {
    id: ID!
    locationId: ID!
    deviceId: ID!
    status: String!
    openedBy: ID!
    openedAt: String!
    openingFloat: Float!
    pharmacistUserId: ID
    closedAt: String
    expectedCash: Float
    countedCash: Float
    cashVariance: Float
  }

  type BmsOpenShiftResult {
    status: String!
    shift: BmsPosShift
    reason: String
  }

  type BmsCloseShiftResult {
    status: String!
    shift: BmsPosShift
    count: Int
    amount: Float
  }

  type BmsInventoryLot {
    id: ID!
    locationId: ID!
    productSku: String!
    size: String!
    lotNo: String!
    expiryDate: String
    receivedAt: String!
    supplierId: ID
    unitCost: Float
    qty: Int!
    note: String
  }

  type BmsLotRecallHit {
    orderId: ID!
    orderCreatedAt: String!
    channel: String!
    productSku: String!
    qty: Int!
    customerId: ID
    customerName: String
    customerPhone: String
  }

  type BmsLotMismatch {
    locationId: ID!
    productSku: String!
    size: String!
    currentStock: Int!
    lotTotal: Int!
  }

  type BmsTaxDocument {
    id: ID!
    locationId: ID!
    orderId: ID!
    deviceId: ID
    docType: String!
    docNo: String!
    issuedAt: String!
    issueDate: String!
    replacesDocumentId: ID
    cancelledAt: String
    cancelledReason: String
    buyerName: String
    buyerTaxId: String
    buyerBranchCode: String
    buyerAddress: String
    buyerPhone: String
    taxableAmount: Float!
    exemptAmount: Float!
    vatAmount: Float!
    roundingAmount: Float!
    grandTotal: Float!
    vatRate: Float!
  }

  input BmsTaxInvoiceBuyerInput {
    name: String!
    taxId: String!
    branchCode: String
    address: String
    phone: String
  }

  "ค่าตั้งภาษีของร้าน — มีผลกับบิลใหม่เท่านั้น เอกสารเก่าเก็บอัตราของตัวเองไว้แล้ว"
  type BmsTaxSettings {
    vatRegistered: Boolean!
    priceIncludesVat: Boolean!
    vatRate: Float!
    "BASE_FIRST | VAT_FIRST_TRUNCATE | VAT_FIRST_ROUND"
    vatRounding: String!
    "BE | CE — ปีบนเอกสาร"
    calendarEra: String!
    abbreviatedApproved: Boolean!
    "NONE | 0.25 | 0.50 | 1.00 — ปัดเฉพาะบิลที่จ่ายสดล้วน"
    cashRounding: String!
  }

  input BmsTaxSettingsInput {
    vatRegistered: Boolean!
    priceIncludesVat: Boolean!
    vatRate: Float!
    vatRounding: String!
    calendarEra: String!
    abbreviatedApproved: Boolean!
    cashRounding: String!
  }

  type BmsIssueFullTaxInvoiceResult {
    status: String!
    document: BmsTaxDocument
    cancelledAbbreviated: BmsTaxDocument
    reason: String
    skus: [String!]
  }

  type BmsPharmacyPolicyReadiness {
    pharmacyArchetype: Boolean!
    totalProducts: Int!
    approved: Int!
    pendingReview: Int!
    draft: Int!
    missing: Int!
    ready: Boolean!
  }

  type BmsUnreviewedProduct {
    sku: String!
    name: String!
    policyStatus: String!
  }

  type Query {

    # ---- POS / สาขา / lot (7.84–7.87) ----
    bmsLocations: [BmsLocation!]!
    bmsPosDevices: [BmsPosDevice!]!
    bmsProductPacks(productSku: String!): BmsProductPackList!
    bmsProductsNeedingBarcodes(limit: Int = 200): [BmsPackAudit!]!
    bmsEtaxSummary: BmsEtaxSummary!
    bmsEtaxSubmissions(status: String, limit: Int = 100): [BmsEtaxSubmission!]!
    bmsPosCashiers: [BmsPosCashier!]!
    bmsPosStaff: [BmsPosCashier!]!
    bmsPosOpenShift(deviceId: ID!): BmsPosShift
    bmsPosOperationalReadiness: BmsPosOperationalReadiness!
    bmsInventoryLots(productSku: String, size: String, locationId: ID): [BmsInventoryLot!]!
    bmsExpiringLots(withinDays: Int = 90): [BmsInventoryLot!]!
    bmsLotRecall(lotId: ID!): [BmsLotRecallHit!]!
    bmsLotReconcile: [BmsLotMismatch!]!
    bmsTaxDocuments(orderId: ID!): [BmsTaxDocument!]!
    bmsTaxSettings: BmsTaxSettings!
    bmsPharmacyPolicyReadiness: BmsPharmacyPolicyReadiness!
    bmsProductsNeedingPolicyReview(limit: Int = 100, offset: Int = 0): [BmsUnreviewedProduct!]!
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
    bmsOrders(search: String, status: BmsOrderStatus, limit: Int = 50, offset: Int = 0): [BmsOrder!]!
    bmsOrder(id: ID!): BmsOrder
    bmsOrderJourney(orderId: ID!): BmsOrderJourney
    bmsGenerateInvoice(orderId: ID!): BmsBusinessDoc   # ใบแจ้งหนี้จากออร์เดอร์จริง (คำนวณสด ไม่ persist)

    # ===== BMS products & inventory (admin) =====
    bmsProducts(search: String, category: String, limit: Int, offset: Int): BmsProductConnection!
    bmsAiSynonymCandidates(status: String = "PENDING", limit: Int = 50): [BmsAiSynonymCandidate!]!
    bmsProductCategories: [BmsProductCategory!]!
    bmsLowStock: [BmsLowStockItem!]!
    bmsStockMovements(sku: String!, size: String, limit: Int = 50): [BmsStockMovement!]!

    # ===== BMS Purchase (admin) =====
    bmsPurchaseOrders(search: String, limit: Int = 50, offset: Int = 0): [BmsPurchaseOrder!]!
    bmsPurchaseOrder(id: ID!): BmsPurchaseOrder
    bmsSuppliers: [BmsSupplier!]!

    # ===== BMS Payment (admin) =====
    bmsPayments(search: String, orderId: ID, status: BmsPaymentStatus, limit: Int = 50, offset: Int = 0): [BmsPayment!]!
    bmsPayment(id: ID!): BmsPayment

    # ===== BMS Shipping (admin) =====
    bmsShipments(search: String, orderId: ID, status: BmsShipmentStatus, limit: Int = 50, offset: Int = 0): [BmsShipment!]!
    bmsShipment(id: ID!): BmsShipment
    bmsShipmentLabel(id: ID!): BmsShipmentLabel
    bmsShipmentTrackingEvents(shipmentId: ID!, limit: Int = 100): [BmsShipmentTrackingEvent!]!

    # ===== BMS Inbox (admin) =====
    # assignedTo = user id ของ staff — กรอง conversation ที่เป็น staff หลัก "หรือ" คนช่วยตอบของคนนั้น (ใช้ทำ filter "ของฉัน")
    bmsConversations(status: BmsConvStatus, assignedTo: ID, tag: String, search: String, limit: Int = 50, offset: Int = 0): [BmsConversation!]!
    bmsConversation(id: ID!): BmsConversation
    bmsConversationTimeline(id: ID!, limit: Int): [BmsTimelineEntry!]!   # limit = เพดานต่อแหล่งข้อมูล (default/สูงสุด 200)
    bmsAssignableStaff: [BmsStaffRef!]!
    bmsInboxUnreadCount: Int!   # แชท OPEN/PENDING ที่ยังไม่อ่านรวม (Sales เห็นแค่ของตัวเอง) — ใช้ทำ badge บนเมนู sidebar
    bmsInboxDiagnosticLatest: [BmsInboxDiagnosticLatest!]!
    bmsMyMentionsUnreadCount: Int!          # @mention ที่ยังไม่อ่านของฉัน — ใช้ทำ badge บนเมนู sidebar
    bmsMyMentions(unreadOnly: Boolean, limit: Int): [BmsMention!]!
    bmsRestockSubscriptions(status: String, search: String, limit: Int = 50, offset: Int = 0): BmsRestockSubscriptionConnection!
    bmsRestockDeliveries(subscriptionId: ID!): [BmsRestockDelivery!]!
    bmsRestockReadyCount: Int!
    # ยอดรวมจริงต่อสถานะ (ไม่ผูก pagination) — ใช้ทำ tab บนหน้า /admin/restock-subscriptions
    bmsRestockStatusCounts(search: String): BmsRestockStatusCounts!
    # KPI ของ restock queue เพื่อให้ร้านเห็นว่า queue นี้กู้ยอดขายกลับมาได้เท่าไร
    bmsRestockMetrics(search: String): BmsRestockMetrics!

    # ===== BMS Reports (admin) =====
    bmsSalesSummary(from: String, to: String): BmsSalesSummary!
    bmsInventorySummary: BmsInventorySummary!
    bmsTopSellingProducts(from: String, to: String, limit: Int = 10): [BmsTopProduct!]!

    # ===== BMS AI Report & Document Generation (MVP core) =====
    bmsGeneratedReports(limit: Int): [BmsGeneratedReport!]!

    # ===== BMS CRM (admin) =====
    bmsCustomers(search: String, limit: Int = 50, offset: Int = 0): [BmsCustomer!]!
    bmsCustomer(id: ID!): BmsCustomer

    # ===== BMS Customer 360 (Inbox right panel) =====
    # bmsCustomer360 = eager read (summary/contact/stats/recentOrders/products/draftOrder/notes)
    # bmsCustomerTimeline/bmsCustomerInsights = lazy — fetch only when their panel section is expanded
    bmsCustomer360(customerId: ID, channel: String, customerRef: String, conversationId: ID): BmsCustomer360
    bmsCustomerTimeline(customerId: ID!): [BmsCustomerTimelineEntry!]!
    bmsCustomerInsights(customerId: ID!): BmsCustomerInsights

    # ===== BMS Dashboard (admin) =====
    bmsDashboard: BmsDashboard!
    bmsOperationalAlerts: BmsOperationalAlerts!
    bmsInventoryActionCenter(windowDays: Int = 30, coverageDays: Int = 30, limit: Int = 5): BmsInventoryActionCenter!
    bmsActions(limit: Int = 50): [BmsAction!]!
    bmsActionMetrics(days: Int = 30): BmsActionMetrics!
    bmsRetentionCases(limit: Int = 100): [BmsRetentionCase!]!
    bmsRetentionAnalytics: BmsRetentionAnalytics!

    # ===== BMS settings / channels (admin) =====
    bmsMyTenant: BmsTenantInfo!
    bmsChannels: [BmsChannelConfig!]!
    bmsChannelHealth: [BmsChannelHealth!]!
    bmsChannelHealthCount: Int!   # จำนวนช่องทาง active ที่สถานะไม่ปกติ — badge sidebar (poll เหมือน bmsInboxUnreadCount)
    bmsReportSubscription: BmsReportSubscription!         # ค่าตั้งของร้านตัวเอง (default ถ้ายังไม่เคยตั้ง)
    bmsReportDeliveries(limit: Int): [BmsReportDelivery!]! # ประวัติส่งของร้านตัวเอง

    # ===== BMS Follow-up Automation (MVP core) =====
    bmsFollowupRules: [BmsFollowupRule!]!
    bmsFollowupQueue(limit: Int): [BmsFollowupJob!]!
    bmsFollowupHistory(conversationId: ID, limit: Int): [BmsFollowupHistoryEntry!]!
    bmsFollowupAnalytics(windowDays: Int): BmsFollowupAnalytics!

    # ===== AI Pharmacy Intake Assistant =====
    bmsPharmacyAssessments(status: String, riskLevel: String, assignedPharmacistId: ID, channelId: String, createdAfter: String, limit: Int, offset: Int): [BmsPharmacyAssessment!]!
    bmsPharmacyAssessment(id: ID!): BmsPharmacyAssessment
    bmsPharmacyAssessmentConversationHistory(assessmentId: ID!, limit: Int): BmsPharmacyConversationHistory
    bmsPharmacyAssessmentEvents(assessmentId: ID!, limit: Int): [BmsPharmacyAssessmentEvent!]!
    bmsPharmacyCatalog(search: String, limit: Int): [BmsPharmacyCatalogItem!]!
    bmsPharmacyProtocols: [BmsPharmacyProtocol!]!
    bmsPharmacyProductPolicies(search: String, limit: Int = 20, offset: Int = 0): BmsPharmacyProductPolicyPage!
    bmsPharmacyProtocol(id: ID!): BmsPharmacyProtocol
    bmsPharmacyLicenseCandidates: [BmsPharmacyLicenseUser!]!
    bmsAiConfig: BmsAiConfig!     # BYOK key ของร้าน (mask แล้ว)
    bmsAiUsage: BmsAiUsage!       # การใช้งาน AI ผ่าน shared key เดือนนี้ + quota
    bmsAiCreditLedger(limit: Int): [BmsAiCreditLedgerEntry!]!
    bmsAiUsageBreakdown(limit: Int): [BmsAiUsageBreakdown!]!
    bmsAiUsageEvents(limit: Int = 20, evalRef: String, feature: String): [BmsAiUsageEvent!]!
    # platform-admin เท่านั้น (ไม่ผูก tenant) — สถานะเชื่อมต่อจริงของ shared AI provider
    bmsAiProviderHealth: [BmsAiProviderHealth!]!
    bmsAiProviderHealthCount: Int!   # จำนวน provider/purpose ที่ configured แต่สถานะไม่ปกติ — badge sidebar
    bmsAiFailureSummary(days: Int = 7): BmsAiFailureSummary!
    bmsAiQualityMetrics(days: Int = 30): BmsAiQualityMetrics!
    bmsAiQualityCases(days: Int = 30, status: String, source: String, outcome: String, limit: Int = 50, offset: Int = 0): [BmsAiQualityCase!]!
    bmsAiQualityCase(id: ID!): BmsAiQualityCaseDetail
    bmsSqlConsoleWriteEnabled: Boolean!  # platform admin เท่านั้น — false เสมอเมื่อ NODE_ENV=production
    bmsJsConsoleEnabled: Boolean!        # platform admin เท่านั้น — false เสมอเมื่อ NODE_ENV=production
    bmsStoreProfile: BmsStoreProfile!   # ข้อมูลร้าน + ค่าส่ง (สำหรับหน้า Settings)
    bmsOnboardingProgress: BmsOnboardingProgress!
    bmsCoupons: [BmsCoupon!]!           # โค้ดส่วนลดของร้าน (permission coupon.view)
    bmsCouponRedemptions(couponId: ID!): [BmsCouponRedemption!]!   # ประวัติการใช้โค้ด (query ตรงจาก bms_orders)

    # ===== BMS membership + แต้มสะสม (7.96) =====
    bmsLoyaltySettings: BmsLoyaltySettings!                        # permission member.view
    bmsMembershipTiers(activeOnly: Boolean): [BmsMembershipTier!]!
    bmsMembers(search: String, limit: Int, offset: Int): BmsMemberPage!   # ไม่ส่ง search = รายชื่อสมาชิกล่าสุด
    bmsMember(customerId: ID!): BmsMember
    bmsLoyaltyLedger(customerId: ID!, limit: Int): [BmsLoyaltyLedgerEntry!]!
    bmsLoyaltyOutstanding: BmsLoyaltyOutstanding!                   # แต้มค้าง = หนี้สิน (permission report.view)
    bmsLoyaltyActivity(months: Int): [BmsLoyaltyActivityRow!]!      # แต้มออก/แลก/หมดอายุรายเดือน
    bmsSalesByTier: [BmsSalesByTierRow!]!                           # ยอดขาย 12 เดือนแยกตามชั้น (มีแถวไม่ใช่สมาชิกให้เทียบ)
    bmsMembersExpiringPoints(days: Int, limit: Int): [BmsExpiringPointsRow!]!   # รายชื่อคนที่แต้มใกล้หมด (ยังไม่มีระบบส่งข้อความอัตโนมัติ)
    bmsMemberDiscountPreview(customerId: ID, subtotal: Float!, pointsToRedeem: Int, couponDiscount: Float): BmsMemberDiscountPreview!

    # ===== BMS billing (admin) =====
    bmsBilling: BmsBilling!

    # ===== BMS public plans (หน้าแรก/landing — ไม่ต้อง auth) =====
    bmsPublicPlans: [BmsPlan!]!

    # ===== BMS profile (admin ที่ล็อกอินอยู่) =====
    bmsMe: BmsMe!

    # ===== BMS platform admin (ข้ามร้าน) =====
    bmsIsPlatformAdmin: Boolean!          # ใช้ gate เมนู/หน้า
    bmsTenants: [BmsTenantRow!]!          # รายการทุกร้าน (platform admin เท่านั้น)
    bmsActingTenant: BmsActingTenant      # ร้านที่กำลัง drill-down อยู่ (null = ไม่ได้เข้าดู)
    bmsReportSubscriptions: [BmsReportSubscriptionOverview!]!  # ทุกร้าน + ค่าตั้งส่งรายงาน (platform admin เท่านั้น)
    bmsReportDeliveriesForTenant(tenantId: ID!, limit: Int): [BmsReportDelivery!]!  # ประวัติส่งของร้านที่ระบุ (platform admin)
    # log อีเมลทุกฉบับที่ระบบสั่งส่งจริง ทุกร้าน + ระบบ (platform admin เท่านั้น)
    bmsMailLog(q: String, status: String, provider: String, category: String, tenantId: ID, page: Int, pageSize: Int): BmsMailLogPage!
    bmsMailLogEntry(id: ID!): BmsMailLogEntry
    bmsMailLogStats: BmsMailLogStats!   # สรุปย้อนหลัง 24 ชม. — stat tile
    bmsSupportTickets(q: String, status: String, topic: String, page: Int, pageSize: Int): BmsSupportTicketPage!

    # ===== BMS RBAC (admin) =====
    myBmsPermissions: [String!]!          # สิทธิ์ของ admin ปัจจุบัน (UI gating)
    bmsPermissionCatalog: [String!]!      # รายการสิทธิ์ทั้งหมด
    bmsRolePermissions: [BmsRolePermissions!]!
    bmsAuditLog(limit: Int = 100): [BmsAuditEntry!]!
    bmsRevisionHistory(kind: BmsRevisionKind!, entityId: ID!, limit: Int = 50): [BmsRevisionEntry!]!
    bmsRevisionDetail(kind: BmsRevisionKind!, revisionId: ID!): BmsRevisionEntry
    bmsRevisionCompare(kind: BmsRevisionKind!, fromRevisionId: ID!, toRevisionId: ID!): BmsRevisionComparison
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
    discount_amount: Float!
    shipping_fee: Float!
    amount_due: Float!
    coupon_code: String
    preferred_carrier: BmsCarrier   # ขนส่งที่ลูกค้าแจ้งไว้ตอนสั่ง — เป็นความต้องการ ไม่ใช่ขนส่งจริงที่ใช้ส่ง (7.46)
    created_at: String!
    updated_at: String!
    items: [BmsOrderItem!]!
    hasShippingAddress: Boolean!   # false = ช่องทางที่ร้านต้องเก็บที่อยู่เอง แต่ลูกค้ายังไม่มีที่อยู่จัดส่ง — จัดส่งไม่ได้
    # ส่วนลดแยกที่มา (7.96) — ผลรวมเท่ากับ discount_amount เสมอ
    # discount_amount ยังเป็นตัวเลขที่ฐาน VAT/ใบกำกับใช้ ตารางนี้ตอบว่ามาจากอะไร
    discountLines: [BmsOrderDiscountLine!]!
  }
  type BmsOrderDiscountLine {
    source: String!             # TIER | COUPON | POINTS | MANUAL
    label: String!
    amount: Float!
    pointsUsed: Int!
  }

  # ===== BMS order journey (เส้นทางออเดอร์: ต้นทางแชท + stepper + timeline) =====
  type BmsOrderStep {
    status: String!         # PENDING/PAID/PACKING/SHIPPED/COMPLETED หรือ CANCELLED/RETURNED (branch)
    at: String              # null = ยังไม่ถึงขั้นนี้
    actorName: String       # ใครทำ ("ระบบ" ถ้า auto)
    reached: Boolean!
    branch: Boolean!        # true = กิ่งยกเลิก/คืน (ไม่ใช่เส้นหลัก)
  }
  type BmsOrderEvent {
    kind: String!           # chat_start | order_status | assign | helper_add | helper_remove | shipment
    at: String!
    text: String!
    actorName: String
  }
  type BmsOrderJourney {
    orderId: ID!
    channel: String!
    status: BmsOrderStatus!
    conversationId: ID       # แชทต้นทาง (null = ไม่มี/สร้างเอง)
    assignedStaff: BmsStaffRef
    helpers: [BmsStaffRef!]!
    steps: [BmsOrderStep!]!
    events: [BmsOrderEvent!]!
  }

  type BmsReorderResult {
    status: String!             # CREATED / INSUFFICIENT / NOT_FOUND / EMPTY / SOURCE_NOT_FOUND / COUPON_INVALID
    orderId: ID
    total: Float
    message: String!
  }

  input BmsOrderItemInput {
    sku: String!
    size: String!
    qty: Int!
  }

  input BmsPharmacyLabCartItemInput {
    sku: String!
    qty: Int!
    size: String
  }

  # ===== BMS documents (invoice/quotation) — คำนวณสด ไม่ persist =====
  type BmsDocLine {
    sku: String!
    name: String!
    size: String!
    qty: Int!
    unitPrice: Float!
    amount: Float!
  }
  type BmsStoreSummary {
    name: String
    address: String
    phone: String
    taxId: String
  }
  type BmsBusinessDoc {
    type: String!            # INVOICE / QUOTATION
    number: String!
    date: String!
    store: BmsStoreSummary!
    customerRef: String
    channel: String
    lines: [BmsDocLine!]!
    subtotal: Float!
    discount: Float!
    couponCode: String
    shippingFee: Float
    total: Float!
    paymentStatus: String
    note: String!
  }

  # ===== BMS purchase (PO) =====
  enum BmsPurchaseStatus {
    OPEN
    PARTIAL
    RECEIVED
    CANCELLED
  }

  type BmsSupplier {
    id: ID!
    name: String!
    phone: String
    email: String
    note: String
  }

  type BmsPurchaseItem {
    sku: String!
    size: String!
    qtyOrdered: Int!
    qtyReceived: Int!
    unitCost: Float!
  }

  type BmsPurchaseOrder {
    id: ID!
    status: BmsPurchaseStatus!
    total: Float!
    note: String
    supplier: BmsSupplier
    qtyOrdered: Int!
    qtyReceived: Int!
    createdAt: String!
    updatedAt: String!
    items: [BmsPurchaseItem!]!
  }

  input BmsPurchaseItemInput {
    sku: String!
    size: String!
    qty: Int!
    unitCost: Float
  }

  input BmsReceiveItemInput {
    sku: String!
    size: String!
    qty: Int!
  }

  # ผลลัพธ์ mutation แบบรวม (status: CREATED/RECEIVED/PARTIAL/NOT_FOUND/…)
  type BmsPurchaseResult {
    status: String!
    poId: ID
    message: String
  }

  # ===== BMS payment =====
  enum BmsPaymentMethod {
    BANK_TRANSFER
    QR
    CARD
    TIKTOK
    CASH
    WALLET
    STORE_CREDIT
  }

  enum BmsPaymentStatus {
    PENDING
    CONFIRMED
    REJECTED
    REFUNDED
  }

  type BmsPayment {
    id: ID!
    orderId: ID!
    method: BmsPaymentMethod!
    amount: Float!
    status: BmsPaymentStatus!
    slipUrl: String
    slipRef: String
    verifyResult: String    # JSON string ของผลตรวจสลิป (OCR/AI)
    note: String
    verifiedBy: String
    confirmedAt: String
    rejectedAt: String
    refundedAt: String
    createdAt: String!
    updatedAt: String!
  }

  # ผลตรวจสลิปด้วย OCR/AI (แนะนำเท่านั้น — ไม่เปลี่ยนสถานะ)
  type BmsSlipVerification {
    method: String!         # ai | heuristic
    provider: String        # anthropic หรือ provider อื่น; null เมื่อ fallback ให้คนตรวจ
    expectedAmount: Float!
    amountMatch: Boolean!
    verified: Boolean!
    reason: String!
    checkedAt: String!
  }

  type BmsPaymentResult {
    status: String!
    paymentId: ID
    message: String
  }

  # ===== BMS shipping =====
  enum BmsCarrier {
    FLASH
    KERRY
    DHL
    AUSPOST
    NZPOST
    OTHER
  }

  enum BmsShipmentStatus {
    PENDING
    SHIPPED
    IN_TRANSIT
    DELIVERED
    RETURNED
    CANCELLED
  }

  type BmsShipment {
    id: ID!
    orderId: ID!
    carrier: BmsCarrier!
    trackingNo: String
    status: BmsShipmentStatus!
    labelUrl: String
    externalShipmentId: String
    carrierLastSyncedAt: String
    carrierTrackingSource: String
    carrierBookingStatus: String!
    carrierBookingError: String
    carrierBookingAttemptedAt: String
    marketplaceManaged: Boolean!
    note: String
    createdAt: String!
    updatedAt: String!
  }

  type BmsLabelItem { sku: String!  size: String!  qty: Int! }
  type BmsLabelShipTo { name: String  phone: String  address: String }
  type BmsShipmentLabel {
    shipmentId: ID!
    orderId: ID!
    carrier: String!
    trackingNo: String
    labelUrl: String
    shipTo: BmsLabelShipTo!
    items: [BmsLabelItem!]!
    createdAt: String!
  }

  type BmsShipmentTrackingEvent {
    id: ID!
    carrierStatus: String!
    description: String!
    occurredAt: String!
    source: String!
  }

  type BmsShipmentResult {
    status: String!
    shipmentId: ID
    message: String
    carrierIntegration: String
    carrierBookingStatus: String
  }

  type BmsSyncShipmentLiveResult {
    status: String!
    shipmentId: ID
    trackingNo: String
    shipmentStatus: BmsShipmentStatus
    source: String
    eventCount: Int
    completedOrder: Boolean
    detail: String
  }

  type BmsCarrierBookingResult {
    status: String!
    shipmentId: ID
    trackingNo: String
    externalShipmentId: String
    labelUrl: String
    source: String
    detail: String
  }

  # ===== BMS inbox =====
  enum BmsConvStatus {
    OPEN
    PENDING
    CLOSED
  }

  type BmsMessageAttachment {
    url: String!
    name: String
    mimeType: String
    isImage: Boolean!
  }
  input BmsAttachmentInput {
    url: String!
    name: String
    mimeType: String
  }

  type BmsMessage {
    id: ID!
    direction: String!      # IN | OUT
    body: String!
    sender: String          # customer | ai | staff:<email>
    createdAt: String!
    attachment: BmsMessageAttachment
    status: String          # (OUT only) SENT | FAILED · null = ไม่มีสถานะ
    canReportDelivery: Boolean!   # ช่องนี้ push/รายงานผลได้ไหม (LINE/FB/IG=true · web/tiktok=false)
  }

  type BmsConversationNote {
    id: ID!
    author: String
    body: String!
    createdAt: String!
    mentionedUserIds: [ID!]!
  }

  # แถวใน "เมนชันของฉัน" — โน้ตที่มีคน @mention เรา, สำหรับ badge + หน้ารวมของตัวเอง
  type BmsMention {
    id: ID!
    conversationId: ID!
    channel: String!
    customerName: String
    author: String
    body: String!
    createdAt: String!
    readAt: String
  }

  # staff ที่เลือกได้ใน dropdown มอบหมาย/เพิ่มคนช่วยตอบ (Sales/Manager/Administrator)
  type BmsStaffRef {
    id: ID!
    name: String
    email: String
    avatar: String
    role: String
    isAvailable: Boolean
    openCount: Int
  }

  # system event ที่แทรกในสายแชท (มอบหมาย/ช่วยตอบ/เปลี่ยนสถานะ) — resolve ชื่อคนแล้ว
  type BmsSystemEvent {
    id: ID!
    kind: String!           # assign | helper_add | helper_remove | status
    at: String!
    actorName: String!      # ใครเป็นคนทำ ("ระบบ" ถ้า auto)
    targetName: String      # ผู้ถูกมอบหมาย/ช่วยตอบ
    statusValue: String     # สถานะใหม่ (kind=status)
    auto: Boolean!
  }

  type BmsConversation {
    id: ID!
    channel: String!
    customerRef: String
    customerId: ID
    customerName: String
    customerAvatar: String
    sourceDisplayName: String
    sourceHandle: String
    sourceAvatar: String
    status: BmsConvStatus!
    assignedStaff: BmsStaffRef
    helpers: [BmsStaffRef!]!
    tags: [String!]!
    unread: Int!
    lastMessage: String
    lastMessageAt: String
    createdAt: String!
    updatedAt: String!
    messages(limit: Int): [BmsMessage!]!
    systemEvents(limit: Int): [BmsSystemEvent!]!
    notes(limit: Int): [BmsConversationNote!]!
  }

  type BmsRestockSubscription {
    id: ID!
    conversationId: ID
    customerId: ID
    customerName: String
    channel: String!
    customerRef: String!
    productSku: String!
    productName: String!
    size: String!
    requestedQty: Int!
    available: Int!
    status: String!
    source: String!
    consentedAt: String!
    readyAt: String
    lastNotifiedAt: String
    orderedAt: String
    resolvedAt: String
    resolvedOrderId: ID
    recoveredRevenue: Float
    createdAt: String!
    updatedAt: String!
  }

  type BmsRestockSubscriptionConnection {
    items: [BmsRestockSubscription!]!
    total: Int!
  }

  type BmsRestockDelivery {
    id: ID!
    attemptNo: Int!
    channel: String!
    body: String!
    status: String!
    inboxMessageId: ID
    error: String
    triggeredBy: String
    createdAt: String!
    completedAt: String
  }

  type BmsRestockSendResult {
    status: String!
    delivered: Boolean!
    message: String!
    attemptId: ID
  }

  type BmsRestockStatusCounts {
    total: Int!
    active: Int!
    readyToNotify: Int!
    notified: Int!
    ordered: Int!
  }

  type BmsRestockMetrics {
    total: Int!
    active: Int!
    readyToNotify: Int!
    notified: Int!
    ordered: Int!
    purchased: Int!
    cancelled: Int!
    expired: Int!
    sentDeliveries: Int!
    failedDeliveries: Int!
    recoveredSalesCount: Int!
    recoveredCustomersCount: Int!
    recoveredOrdersCount: Int!
    recoveredRevenue: Float!
    notifiedSubscriptions: Int!
    recoveredFromNotified: Int!
    readyRate: Float!
    notifyRate: Float!
    recoveryRateFromNotified: Float!
    recoveryRateOverall: Float!
  }

  type BmsRestockSendAllResult {
    attempted: Int!
    sent: Int!
    failed: Int!
  }

  type BmsTimelineEntry {
    type: String!           # MESSAGE_IN | MESSAGE_OUT | NOTE | ORDER | ASSIGN | STATUS
    at: String!             # เวลาที่เหตุการณ์เกิดจริง (ORDER = เวลาสร้างออร์เดอร์)
    text: String!
    ref: String             # ผู้ส่ง/ผู้เขียนโน้ต/ชื่อ staff · ORDER = order id 8 ตัวแรก
    channel: String         # ORDER: ช่องทางที่สั่ง (อาจต่างจากช่องทางของแชทนี้)
    entityId: ID            # ORDER: order id เต็ม
    status: String          # ORDER: สถานะปัจจุบัน (ไม่ใช่สถานะ ณ เวลา at)
    statusAt: String        # ORDER: เวลาที่สถานะถูกแก้ครั้งล่าสุด
  }

  type BmsSendResult {
    status: String!
    delivered: Boolean!
    message: String
  }
  type BmsInboxDiagnosticMessageResult {
    ok: Boolean!
    message: String!
    channel: String!
    conversationId: ID!
    messageId: ID!
    customerRef: String!
    occurredAt: String!
  }
  type BmsInboxDiagnosticLatest {
    channel: String!
    conversationId: ID!
    customerRef: String!
    lastInboundAt: String!
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
    imageUrl: String
    images: [Image!]!
    description: String
    costPrice: Float
    weightGrams: Int   # น้ำหนักต่อชิ้น (กรัม) — ใช้คิดค่าส่งตามน้ำหนัก (7.47)
    category: String
    brand: String
    # ประเภท VAT (7.88) — 'V' คิด VAT · 'N' ยกเว้น VAT · 'UNKNOWN' ยังไม่ระบุ
    # ร้านที่จด VAT ต้องไม่มี UNKNOWN เหลือ ไม่งั้นติด blocker ที่ /admin/pos-readiness
    vatCategory: String
    # ขั้นราคาส่ง (8.1) — ซื้อครบ minQty ชิ้นในบิลเดียวได้ราคา unitPrice ต่อชิ้น
    priceTiers: [BmsPriceTier!]!
    variants: [BmsVariant!]!
  }

  type BmsPriceTier {
    minQty: Int!
    unitPrice: Float!
  }

  input BmsPriceTierInput {
    minQty: Int!
    unitPrice: Float!
  }

  type BmsAiSynonymCandidate {
    id: ID!
    term: String!
    occurrences: Int!
    status: String!
    productSku: String
    firstSeenAt: String!
    lastSeenAt: String!
    reviewedAt: String
  }

  type BmsProductConnection {
    items: [BmsProduct!]!
    total: Int!
  }

  input BmsProductInput {
    sku: String!
    name: String!
    price: Float!
    keywords: [String!]
    active: Boolean
    barcode: String
    image_url: String
    image_urls: [String!]
    description: String
    cost_price: Float
    weight_grams: Int
    category: String
    brand: String
    # ไม่ส่งมา = คงค่าเดิม (ไม่รีเซ็ตเป็น UNKNOWN)
    vat_category: String
    # ส่งมา = แทนที่ขั้นราคาทั้งชุด · ไม่ส่ง = ไม่แตะของเดิม
    price_tiers: [BmsPriceTierInput!]
  }

  # ===== BMS product bulk import (CSV/XLSX) =====
  input BmsProductImportRowInput {
    rowNumber: Int!
    sku: String!
    name: String!
    price: Float!
    keywords: [String!]
    active: Boolean
    barcode: String
    description: String
    cost_price: Float
    category: String
    brand: String
  }
  type BmsProductImportRowResult {
    rowNumber: Int!
    sku: String
    action: String!   # CREATE | UPDATE | ERROR
    error: String
  }
  type BmsProductImportResult {
    rows: [BmsProductImportRowResult!]!
    quotaExceeded: Boolean!
    quotaMessage: String
    createCount: Int!
    updateCount: Int!
    errorCount: Int!
  }

  type BmsProductCategory {
    id: ID!
    name: String!
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
    coupons: [BmsCustomerCoupon360!]!
    # สมาชิก + แต้ม (7.96) — null = ลูกค้าคนนี้ยังไม่ได้สมัครสมาชิก
    membership: BmsMember
    loyaltyLedger: [BmsLoyaltyLedgerEntry!]!
  }

  input BmsCustomerInput {
    id: ID
    name: String!
    phone: String
    note: String
    tags: [String!]
  }

  # ===== BMS Customer 360 (Inbox right panel — ดู lib/bms/customer360.ts) =====
  type BmsCustomerProfile360 {
    id: ID!
    name: String!
    phone: String
    email: String
    note: String
    tags: [String!]!
    createdAt: String
    preferredLanguage: String
    timezone: String
    orderCount: Int!
    totalSpent: Float!
    isNewCustomer: Boolean!
    isReturningCustomer: Boolean!
  }

  type BmsCustomerIdentity360 {
    channel: String!
    externalRef: String!
  }

  type BmsCustomerAddress360 {
    id: ID!
    label: String
    address: String!
    isDefault: Boolean!
    addressType: String!   # shipping | billing
  }

  type BmsCustomerStats {
    lifetimeValue: Float!
    totalOrders: Int!
    avgOrderValue: Float!
    completedOrders: Int!
    cancelledOrders: Int!
    refundCount: Int!
    lastOrderDate: String
    lastConversationAt: String
    avgResponseTimeSeconds: Int
  }

  type BmsCustomerOrderItem360 {
    sku: String!
    size: String!
    qty: Int!
    unitPrice: Float!
  }

  type BmsCustomerRecentOrder {
    id: ID!
    channel: String!
    status: BmsOrderStatus!
    createdAt: String
    totalAmount: Float!
    discountAmount: Float!
    couponCode: String
    items: [BmsCustomerOrderItem360!]!
    paymentStatus: BmsPaymentStatus
    paymentMethod: String
    shipmentStatus: BmsShipmentStatus
    carrier: String
    trackingNo: String
  }

  type BmsCustomerProductStat {
    sku: String!
    name: String!
    category: String
    qty: Int!
    revenue: Float!
    lastPurchasedAt: String
    orderCount: Int!
  }

  type BmsCustomerFavoriteCategory {
    category: String!
    qty: Int!
  }

  type BmsCustomerProducts {
    topPurchased: [BmsCustomerProductStat!]!
    recentlyPurchased: [BmsCustomerProductStat!]!
    frequentlyPurchased: [BmsCustomerProductStat!]!
    favoriteCategories: [BmsCustomerFavoriteCategory!]!
  }

  type BmsCustomerDraftOrder {
    id: ID!
    channel: String!
    createdAt: String
    totalAmount: Float!
    discountAmount: Float!
    couponCode: String
    items: [BmsCustomerOrderItem360!]!
  }

  type BmsCustomerNote360 {
    id: ID!
    conversationId: ID!
    author: String
    body: String!
    createdAt: String
  }

  type BmsCustomerCoupon360 {
    id: ID!
    walletId: ID
    code: String!
    type: String!
    value: Float!
    minOrderAmount: Float
    maxRedemptions: Int
    redemptionsCount: Int!
    perCustomerLimit: Int
    startsAt: String
    expiresAt: String
    active: Boolean!
    note: String
    available: Boolean!
    reason: String
    discountPreview: Float
    assigned: Boolean!
    assignedAt: String
    source: String
    state: String!
    reservedAt: String
    reservedOrderId: ID
    redeemedAt: String
    redeemedOrderId: ID
    expiredAt: String
    revokedAt: String
    remainingRedemptions: Int
    customerUsedCount: Int!
  }

  type BmsCustomer360 {
    customer: BmsCustomerProfile360
    identities: [BmsCustomerIdentity360!]!
    addresses: [BmsCustomerAddress360!]!
    stats: BmsCustomerStats!
    recentOrders: [BmsCustomerRecentOrder!]!
    products: BmsCustomerProducts!
    draftOrder: BmsCustomerDraftOrder
    notes: [BmsCustomerNote360!]!
    coupons: [BmsCustomerCoupon360!]!
  }

  type BmsCustomerTimelineEntry {
    type: String!   # CUSTOMER_REGISTERED | FIRST_PURCHASE | ORDER | SHIPMENT | REFUND | NOTE | AI_SUMMARY
    at: String!
    text: String!
    ref: String
  }

  type BmsCustomerInsights {
    summary: String!    # AI (หรือ template ถ้าไม่มี ANTHROPIC_API_KEY) — สรุปจากข้อมูลจริงเท่านั้น ห้ามเดา
    generatedAt: String
    cached: Boolean!
  }

  # ===== BMS Dashboard =====
  type BmsStatusCount { status: String!  count: Int! }
  type BmsTopProduct  { sku: String!  name: String!  qty: Int!  revenue: Float! }
  type BmsTopCustomer { id: ID!  name: String!  tags: [String!]!  spent: Float!  orders: Int! }
  type BmsDailySales  { day: String!  revenue: Float!  orders: Int! }

  # ===== BMS reports (แยกส่วนจาก dashboard) =====
  type BmsChannelSales { channel: String!  revenue: Float!  orders: Int! }

  type BmsSalesSummary {
    from: String!
    to: String!
    revenue: Float!
    refundTotal: Float!
    netRevenue: Float!
    orderCount: Int!
    avgOrderValue: Float!
    byDay: [BmsDailySales!]!
    byStatus: [BmsStatusCount!]!
    byChannel: [BmsChannelSales!]!
  }

  type BmsInventorySummary {
    skuCount: Int!
    variantCount: Int!
    totalUnits: Int!
    reservedUnits: Int!
    availableUnits: Int!
    stockValue: Float!
    lowStockCount: Int!
    outOfStockCount: Int!
  }

  # ===== BMS AI Report & Document Generation (MVP core) =====
  input BmsGenerateReportInput {
    reportType: String!   # SALES / INVENTORY / PROFIT
    dateFrom: String       # YYYY-MM-DD, ไม่ใช้กับ INVENTORY
    dateTo: String
    format: String!        # XLSX / CSV / PDF
    includeSummary: Boolean
  }

  type BmsGenerateReportResult {
    fileId: Int!
    fileUrl: String!
    reportType: String!
    format: String!
    summary: String
  }

  type BmsGeneratedReport {
    id: ID!
    reportType: String!
    format: String!
    params: JSON!
    fileId: Int
    fileUrl: String
    summary: String
    generatedBy: String
    createdAt: String!
  }

  type BmsEmailReportResult {
    fileId: Int!
    to: String!
    reportType: String!
    format: String!
  }

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
    couponSummary: BmsCouponSummary   # null ถ้า role ไม่มี coupon.view (เช่น Sales) — ดู field resolver
  }

  # ส่วนลดที่แจกไปเดือนนี้ (ตัดที่ต้นเดือนปัจจุบัน) — permission coupon.view เท่านั้น
  # (margin-sensitive เหมือนหน้า /admin/coupons เอง ไม่ใช่ทุกคนที่มี report.view จะเห็นได้)
  type BmsTopCoupon {
    code: String!
    redemptions: Int!
    discount: Float!
    usages: [BmsCouponRedemption!]!
  }
  type BmsCouponSummary {
    discountThisMonth: Float!
    redemptionsThisMonth: Int!
    topCoupons: [BmsTopCoupon!]!
  }

  type BmsOperationalAlerts {
    packingOverdueCount: Int!
    slipPendingCount: Int!
    reservationExpiringCount: Int!
    chatWaitingCount: Int!
  }

  type BmsInventoryActionSummary {
    lowStockCount: Int!
    outOfStockCount: Int!
    stockoutWithin7DaysCount: Int!
    purchaseSuggestionCount: Int!
    totalSuggestedQty: Int!
    slowMovingCount: Int!
    deadStockCount: Int!
    expiringLotCount: Int!
    expiringUnits: Int!
    windowDays: Int!
    coverageDays: Int!
    disclaimer: String!
  }

  type BmsInventoryActionLowStockItem {
    sku: String!
    name: String!
    size: String!
    available: Int!
    reorderPoint: Int!
  }

  type BmsStockoutRiskItem {
    sku: String!
    name: String!
    size: String!
    available: Int!
    avgPerDay: Float!
    daysToStockout: Float
    projectedStockoutDate: String
  }

  type BmsPurchaseSuggestionItem {
    sku: String!
    name: String!
    size: String!
    available: Int!
    avgPerDay: Float!
    suggestedQty: Int!
    soldInWindow: Int!
    demandFeedback: Int!
    incomingQty: Int!
    trendPct: Float!
    safetyStock: Int!
    leadTimeDays: Int!
    classification: String!
    recommendedAction: String!
  }

  type BmsSlowMovingItem { sku: String! name: String! size: String! available: Int! soldInWindow: Int! trendPct: Float! classification: String! recommendedAction: String! }
  type BmsExpiringLotItem { sku: String! name: String! size: String! lotNo: String! expiryDate: String! qty: Int! daysToExpiry: Int! recommendedAction: String! }

  type BmsInventoryActionCenter {
    summary: BmsInventoryActionSummary!
    lowStock: [BmsInventoryActionLowStockItem!]!
    stockoutRisk: [BmsStockoutRiskItem!]!
    purchaseSuggestions: [BmsPurchaseSuggestionItem!]!
    slowMoving: [BmsSlowMovingItem!]!
    expiringLots: [BmsExpiringLotItem!]!
  }

  type BmsAction { id: ID! actionKey: String! category: String! priority: String! title: String! titleEn: String! evidence: JSON! expectedImpact: String! expectedImpactEn: String! confidence: Float! ownerId: ID ownerName: String dueAt: String deepLink: String! status: BmsActionStatus! statusReason: String measuredOutcome: JSON firstSeenAt: String! lastSeenAt: String! }
  type BmsActionMetrics { days: Int! total: Int! accepted: Int! completed: Int! acceptanceRate: Float! completionRate: Float! avgTimeToActionMinutes: Float! measuredOutcomeCount: Int! }
  enum BmsRetentionStatus { NEW ACCEPTED CONTACTED CONVERTED DISMISSED EXPIRED }
  type BmsRetentionCase { id: ID! customerId: ID! customerName: String! cohort: String! status: BmsRetentionStatus! rfmSegment: String! recencyDays: Int! frequency: Int! monetary: Float! expectedReturnAt: String riskScore: Int! recommendedChannel: String recommendedMessageTh: String! recommendedMessageEn: String! recommendedOffer: String! recommendedProductSku: String reasonTh: String! reasonEn: String! contactedAt: String convertedAt: String convertedRevenue: Float }
  type BmsRetentionAnalytics { treatmentTotal: Int! holdoutTotal: Int! treatmentConverted: Int! holdoutConverted: Int! treatmentRate: Float! holdoutRate: Float! incrementalLift: Float! retentionRevenue: Float! }
  enum BmsActionStatus { NEW ACCEPTED COMPLETED DISMISSED EXPIRED }
  enum BmsInventoryDemandKind { LOST_SALE RESTOCK_REQUEST }
  input BmsInventoryDemandInput { sku: String! size: String! kind: BmsInventoryDemandKind! qty: Int! note: String }
  input BmsInventoryPolicyInput { sku: String! size: String! safetyStockDays: Int! leadTimeDays: Int! }

  type BmsAiToolFailureRow {
    tool: String!
    outcome: String!
    count: Int!
  }

  type BmsAiFailureSummary {
    days: Int!
    totalToolCalls: Int!
    errorCalls: Int!
    handoffCount: Int!
    topFailingTools: [BmsAiToolFailureRow!]!
  }

  type BmsAiQualityDaily {
    day: String!
    totalTurns: Int!
    successCount: Int!
    handoffCount: Int!
    unresolvedCount: Int!
  }

  type BmsAiQualityMetrics {
    days: Int!
    totalTurns: Int!
    successCount: Int!
    clarificationCount: Int!
    handoffCount: Int!
    unresolvedCount: Int!
    successRate: Float!
    handoffRate: Float!
    unresolvedRate: Float!
    pendingReviews: Int!
    reviewedCount: Int!
    humanFailCount: Int!
    daily: [BmsAiQualityDaily!]!
  }

  type BmsAiQualityMessage {
    id: ID!
    direction: String!
    sender: String
    body: String!
    createdAt: String!
  }

  type BmsAiQualityCase {
    id: ID!
    conversationId: ID!
    messageId: ID!
    channel: String!
    conversationStatus: String!
    source: String!
    signalOutcome: String!
    reasonCodes: [String!]!
    severity: String!
    status: String!
    verdict: String
    category: String
    customerPreview: String!
    aiPreview: String!
    reviewerNote: String
    reviewerName: String
    reviewedAt: String
    createdAt: String!
    updatedAt: String!
  }

  type BmsAiQualityCaseDetail {
    id: ID!
    conversationId: ID!
    messageId: ID!
    channel: String!
    conversationStatus: String!
    source: String!
    signalOutcome: String!
    reasonCodes: [String!]!
    severity: String!
    status: String!
    verdict: String
    category: String
    customerPreview: String!
    aiPreview: String!
    reviewerNote: String
    reviewerName: String
    reviewedAt: String
    createdAt: String!
    updatedAt: String!
    messages: [BmsAiQualityMessage!]!
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

  enum BmsRevisionKind {
    products
    orders
    payments
    shipments
    purchase
    purchaseItems
    coupons
  }

  type BmsRevisionEntry {
    id: ID!
    tenant_id: ID!
    editor_id: ID
    editorLabel: String
    revision_id: ID
    kind: BmsRevisionKind!
    kindLabel: String!
    entityId: ID!
    snapshot: JSON!
    created_at: String!
  }

  type BmsRevisionDiff {
    path: String!
    before: JSON
    after: JSON
  }

  type BmsRevisionComparison {
    kind: BmsRevisionKind!
    kindLabel: String!
    fromRevisionId: ID!
    toRevisionId: ID!
    fromSnapshot: JSON!
    toSnapshot: JSON!
    diff: [BmsRevisionDiff!]!
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
    max_products: Int!  max_channels: Int!  max_orders_month: Int!  max_users: Int!
    max_ai_messages_month: Int!
    ai_credits_monthly: Int!
  }
  type BmsUsage { products: Int!  channels: Int!  orders_month: Int!  users: Int! }
  type BmsBilling {
    plan: BmsPlan!
    usage: BmsUsage!
    plans: [BmsPlan!]!
  }
  type BmsSignupResult { status: String!  tenantId: ID  slug: String }
  type BmsVerifyShopSignupResult { status: String!  tenantId: ID  slug: String }

  # ===== BMS current-user profile (admin ที่ล็อกอินอยู่) =====
  type BmsMeTenant { id: ID!  name: String!  slug: String!  plan: String! }
  type BmsMe {
    id: ID!  name: String  username: String  email: String  phone: String  avatar: String
    role: String!  language: String  gender: String   # 'male' | 'female' | null (ไม่ระบุ)
    themePreference: String!
    is_platform_admin: Boolean!
    is_available: Boolean!
    created_at: String
    tenant: BmsMeTenant
    permissions: [String!]!
  }

  # ===== BMS platform admin (เจ้าของแพลตฟอร์ม — ข้ามร้าน) =====
  type BmsTenantRow {
    id: ID!  name: String!  slug: String!  plan: String!  active: Boolean!
    created_at: String!
    users: Int!  products: Int!  orders: Int!  revenue: Float!
  }
  type BmsActingTenant { id: ID!  name: String!  slug: String! }

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

  type BmsChannelHealth {
    channel: String!
    active: Boolean!
    status: String!            # connected / token_expired / webhook_failed / rate_limited / no_events / send_failed
    status_detail: String
    last_error_at: String
    last_inbound_event_at: String
    last_outbound_success_at: String
    last_checked_at: String
  }

  type BmsTestChannelResult { ok: Boolean!  message: String! }

  # ===== BMS Report Subscriptions (สรุปยอดขายรายวัน/สัปดาห์/เดือน — email/Slack/LINE) =====
  type BmsReportSubscription {
    tenantId: ID!
    frequency: String!        # DAILY / WEEKLY / MONTHLY
    sendHour: Int!            # 0-23 (Asia/Bangkok)
    sendWeekday: Int          # 0-6 (0=อาทิตย์) — ใช้เฉพาะ WEEKLY
    sendDayOfMonth: Int       # 1-28 — ใช้เฉพาะ MONTHLY
    emailEnabled: Boolean!
    recipientEmail: String
    slackEnabled: Boolean!
    hasSlackWebhook: Boolean!
    lineEnabled: Boolean!
    lineUserId: String
    enabled: Boolean!
    platformAllowed: Boolean!
    lastSentAt: String
    lastStatus: String        # SUCCESS / PARTIAL / FAILED
    lastPeriodKey: String
  }

  type BmsReportSubscriptionOverview {
    tenantId: ID!
    tenantName: String!
    tenantSlug: String!
    frequency: String!
    sendHour: Int!
    sendWeekday: Int
    sendDayOfMonth: Int
    emailEnabled: Boolean!
    recipientEmail: String
    slackEnabled: Boolean!
    hasSlackWebhook: Boolean!
    lineEnabled: Boolean!
    lineUserId: String
    enabled: Boolean!
    lastSentAt: String
    lastStatus: String
    lastPeriodKey: String
  }

  type BmsReportDelivery {
    id: ID!
    frequency: String!
    periodKey: String!
    periodStart: String!
    periodEnd: String!
    channel: String!           # EMAIL / SLACK / LINE
    status: String!            # SUCCESS / FAILED
    error: String
    payloadSnapshot: JSON      # snapshot ของสิ่งที่ส่งจริง — EMAIL:{subject,html} SLACK:{payload} LINE:{text}
    createdAt: String!
  }

  type BmsReportChannelResult { channel: String!  ok: Boolean!  error: String }
  type BmsSendReportResult { overallStatus: String!  results: [BmsReportChannelResult!]! }

  # ===== BMS Follow-up Automation (MVP core) =====
  type BmsFollowupRule {
    id: ID!
    tenantId: ID!
    intent: String!         # ASK_PRICE / PRODUCT_INFORMATION / ORDER / BOOKING / SUPPORT /
                             # COMPLAINT / PAYMENT / DELIVERY / GENERAL_QUESTION / OTHER
    enabled: Boolean!
    priority: Int!
    delayMinutes: Int!
    maxRetry: Int!
    stopConditions: [String!]!   # เก็บไว้สำหรับ workflow engine ในอนาคต — scheduler ยังไม่อ่านค่านี้
    messageGoal: String!         # CLOSE_SALE / COLLECT_MISSING_INFO / CONTINUE_CONVERSATION / CONFIRM_BOOKING /
                                  # CUSTOMER_SATISFACTION / PAYMENT_REMINDER / RECOVER_ABANDONED_CART / SUPPORT_FOLLOWUP
    businessHoursOnly: Boolean!
    template: String
    createdAt: String!
    updatedAt: String!
  }

  input BmsFollowupRuleInput {
    id: ID
    intent: String!
    enabled: Boolean
    priority: Int
    delayMinutes: Int!
    maxRetry: Int
    stopConditions: [String!]
    messageGoal: String!
    businessHoursOnly: Boolean
    template: String
  }

  type BmsFollowupJob {
    id: ID!
    status: String!          # PENDING / SENT / STOPPED / FAILED
    nextRunAt: String!
    retryCount: Int!
    lastResult: String
    conversationId: ID!
    ruleId: ID!
    intent: String!
    messageGoal: String!
    priority: Int!
    maxRetry: Int!
    businessHoursOnly: Boolean!
    customerName: String
    lastMessageAt: String
    idleMinutes: Int
    customerLifetimeValue: Float
    totalOrders: Int!
    score: Int!
    scoreLabel: String!      # HOT / WARM / COOL
    scoreReasons: [String!]!
    createdAt: String!
    updatedAt: String!
  }

  type BmsFollowupHistoryEntry {
    id: ID!
    jobId: ID
    conversationId: ID!
    ruleId: ID
    outcome: String!         # SENT / SKIPPED / FAILED
    reason: String
    messageBody: String
    goal: String
    createdAt: String!
  }

  type BmsFollowupAnalyticsBucket {
    key: String!
    sent: Int!
    replied: Int!
    ordered: Int!
    failed: Int!
    skipped: Int!
  }

  type BmsFollowupAnalyticsDaily {
    day: String!
    sent: Int!
    replied: Int!
    ordered: Int!
    failed: Int!
    skipped: Int!
  }

  type BmsFollowupAnalytics {
    windowDays: Int!
    activeJobs: Int!
    pendingJobs: Int!
    sentJobs: Int!
    stoppedJobs: Int!
    failedJobs: Int!
    totalHistory: Int!
    sentHistory: Int!
    skippedHistory: Int!
    failedHistory: Int!
    repliedAfterFollowup: Int!
    orderedAfterFollowup: Int!
    replyRate: Float!
    orderRate: Float!
    avgRetryCount: Float!
    avgIdleMinutesAtSend: Float
    byGoal: [BmsFollowupAnalyticsBucket!]!
    byIntent: [BmsFollowupAnalyticsBucket!]!
    daily: [BmsFollowupAnalyticsDaily!]!
  }

  type BmsFollowupRunResult { scanned: Int!  sent: Int!  skipped: Int!  failed: Int! }

  type BmsSeedPharmacyQueueDemoResult {
    createdCount: Int!
    assessmentId: ID
    assessmentIds: [ID!]!
  }

  # ===== AI Pharmacy Intake Assistant =====
  # AI never writes status — see lib/bms/pharmacy/assessments.ts. Approve/
  # reject/refer additionally require users.is_licensed_pharmacist, checked
  # server-side regardless of role/permission.
  type BmsPharmacyAssessment {
    id: ID!
    tenantId: ID!
    customerId: ID
    channelId: String
    conversationId: ID
    protocolId: ID
    patientRelationship: String!   # SELF / CHILD / PARENT / OTHER
    consentStatus: String!         # PENDING / GRANTED / REVOKED
    consentAt: String
    consentVersion: String
    status: String!                # DRAFT / COLLECTING_INFORMATION / WAITING_FOR_PHARMACIST /
                                    # PHARMACIST_REVIEWING / NEED_MORE_INFORMATION / APPROVED /
                                    # REJECTED / REFER_TO_DOCTOR / EMERGENCY_REFERRAL / CLOSED
    needsManualIntake: Boolean!
    riskLevel: String!             # LOW / MODERATE / HIGH / EMERGENCY / UNKNOWN
    assignedPharmacistId: ID
    approvedBy: ID
    approvedAt: String
    decisionReason: String
    patientDob: String
    patientAgeYears: Int
    biologicalSex: String!         # MALE / FEMALE / UNKNOWN
    weightKg: Float
    heightCm: Float
    pregnancyStatus: String!       # YES / NO / UNKNOWN / NOT_APPLICABLE
    breastfeedingStatus: String!   # YES / NO / UNKNOWN / NOT_APPLICABLE
    complaint: JSON!
    medicalInfo: JSON!
    currentQuestionKey: String
    missingFields: [String!]!
    conflictingFields: [String!]!
    anomalies: JSON!
    completenessStatus: String!
    detectedRedFlags: JSON!
    customerConfirmationStatus: String!   # NOT_REQUESTED / PENDING / CONFIRMED
    customerConfirmationSummary: JSON!
    customerConfirmedAt: String
    outOfScopeReason: String
    escalationReason: String
    rawMessages: JSON!
    structuredAnswers: JSON!
    aiSummary: String
    aiSummaryVersion: Int!
    aiPromptVersion: String
    aiModelVersion: String
    pharmacistEdits: JSON!
    pharmacistDecisionNotes: String
    medicationSuggestions: JSON! # pharmacist-only — never sent to the customer, see README
    checkoutOrderDraft: JSON
    version: Int!
    expiresAt: String
    closedAt: String
    createdAt: String!
    updatedAt: String!
  }

  type BmsPharmacyConversationHistoryMessage {
    id: ID!
    direction: String!
    body: String!
    sender: String
    createdAt: String!
    status: String
  }

  type BmsPharmacyConversationHistory {
    conversationId: ID!
    channel: String!
    customerName: String
    customerRef: String
    status: String!
    messages: [BmsPharmacyConversationHistoryMessage!]!
  }

  type BmsPharmacyAssessmentEvent {
    id: ID!
    assessmentId: ID!
    actor: String!
    action: String!
    previousState: String
    nextState: String
    meta: JSON!
    createdAt: String!
  }

  type BmsPharmacyCatalogVariant {
    size: String!
    available: Int!
  }

  type BmsPharmacyCatalogItem {
    sku: String!
    name: String!
    price: Float!
    category: String
    brand: String
    availableTotal: Int!
    productType: String!
    salePolicy: String!
    policyStatus: String!
    variants: [BmsPharmacyCatalogVariant!]!
  }

  type BmsPharmacyProtocol {
    id: ID!
    tenantId: ID!
    protocolKey: String!
    name: String!
    version: Int!
    supportedSymptomGroup: String!
    displayLabel: String!
    triggerTerms: [String!]!
    requiredFields: JSON!
    conditionalQuestions: JSON!
    redFlagRules: JSON!
    completionRules: JSON!
    escalationRules: JSON!
    status: String!            # DRAFT / PENDING_REVIEW / APPROVED / RETIRED
    clinicallyApproved: Boolean!
    enabled: Boolean!
    platformAllowed: Boolean!  # protocol key is present in the server-side PHARMACY_PROTOCOLS_ENABLED allowlist
    reviewedBy: ID
    reviewedAt: String
    createdAt: String!
    updatedAt: String!
  }

  type BmsPharmacyProductPolicy {
    id: ID!
    tenantId: ID!
    productSku: String!
    productName: String!
    productType: String!
    regulatoryFramework: String!
    regulatoryClass: String!
    regulatoryEvidenceSource: String!
    regulatoryEvidenceRef: String
    salePolicy: String!
    registrationNo: String
    maxQuantity: Int
    safetyRuleKey: String
    status: String!
    reviewedBy: ID
    reviewedAt: String
    createdAt: String!
    updatedAt: String!
  }

  type BmsPharmacyProductPolicyPage {
    items: [BmsPharmacyProductPolicy!]!
    total: Int!
    limit: Int!
    offset: Int!
  }

  input BmsPharmacyProductPolicyInput {
    productSku: String!
    productType: String!
    regulatoryFramework: String!
    regulatoryClass: String!
    regulatoryEvidenceSource: String!
    regulatoryEvidenceRef: String
    salePolicy: String!
    registrationNo: String
    maxQuantity: Int
    safetyRuleKey: String
  }

  type BmsPharmacyLicenseUser {
    id: ID!
    name: String!
    email: String
    isLicensedPharmacist: Boolean!
    pharmacistLicenseNo: String
  }

  input BmsPharmacyProtocolInput {
    id: ID
    protocolKey: String!
    name: String!
    version: Int
    supportedSymptomGroup: String!
    displayLabel: String!
    triggerTerms: [String!]!
    requiredFields: JSON!
    conditionalQuestions: JSON!
    redFlagRules: JSON!
    completionRules: JSON!
    escalationRules: JSON!
  }

  type BmsMailLogEntry {
    id: ID!
    tenantId: ID
    tenantName: String    # null = อีเมลระดับระบบ ไม่ผูกร้าน (test/auth ของ user เดิม/support ticket)
    category: String!     # digest / order / auth / support / test / other
    provider: String!     # sendgrid / gmail
    toEmail: String!
    fromEmail: String
    subject: String
    status: String!       # success / error
    messageId: String
    statusCode: Int
    error: String
    html: String
    textBody: String
    triggeredBy: String
    createdAt: String!
  }

  type BmsMailLogPage {
    items: [BmsMailLogEntry!]!
    total: Int!
  }

  type BmsMailLogStats {
    total: Int!
    success: Int!
    error: Int!
    topErrorProvider: String
  }

  input BmsUpsertReportSubscriptionInput {
    frequency: String
    sendHour: Int
    sendWeekday: Int
    sendDayOfMonth: Int
    emailEnabled: Boolean
    recipientEmail: String
    slackEnabled: Boolean
    slackWebhookUrl: String
    lineEnabled: Boolean
    lineUserId: String
    enabled: Boolean
  }

  # ===== BMS AI config (BYOK ต่อร้าน + shared-key quota) =====
  type BmsAiConfig {
    has_key: Boolean!
    api_key_masked: String
    model: String
    provider: String!
  }
  type BmsAiUsage {
    count: Int!  limit: Int!  remaining: Int!  unlimited: Boolean!
    planCode: String!  planName: String!
    requestCount: Int!
    sharedRequests: Int!
    byokRequests: Int!
    blockedRequests: Int!
    grantedCredits: Int!
    bonusCredits: Int!
    adjustedCredits: Int!
    billableCredits: Int!
    providerCalls: Int!
    actualCostUsd: Float!
    unpricedProviderCalls: Int!
    estimatedCost: Float!
  }
  type BmsAiCreditLedgerEntry {
    id: ID!
    yearMonth: String!
    entryType: String!
    amount: Int!
    balanceAfter: Int!
    referenceType: String
    referenceId: String
    note: String
    createdAt: String!
  }
  type BmsAiUsageBreakdown {
    feature: String!
    requests: Int!
    billableCredits: Int!
    creditsUsed: Int!
    providerCalls: Int!
    unpricedProviderCalls: Int!
    actualCostUsd: Float!
    estimatedCost: Float!
  }
  type BmsAiUsageEvent {
    id: ID!
    source: String!
    surface: String!
    feature: String!
    channel: String
    provider: String!
    model: String
    status: String!
    billableCredits: Int!
    creditsUsed: Int!
    inputTokens: Int
    outputTokens: Int
    providerCalls: Int!
    unpricedProviderCalls: Int!
    actualCostUsd: Float
    estimatedCost: Float!
    routingReason: String
    configuredProvider: String
    effectiveProvider: String
    fallbackFrom: String
    sensitive: Boolean!
    createdAt: String!
    completedAt: String
  }
  type BmsTestAiKeyResult { ok: Boolean!  message: String! }

  # ===== BMS AI Provider Health (platform-wide, ไม่ผูก tenant — ดู docs/local-notes-archive.md § AI Provider Health) =====
  type BmsAiProviderHealth {
    provider: String!          # anthropic / deepseek / qwen
    purpose: String!           # chat / ocr
    status: String!            # connected / stale (derived) / token_expired / rate_limited / send_failed / unconfigured
    status_detail: String
    last_error_at: String
    last_success_at: String
    last_checked_at: String
  }

  # Dev SQL Console (platform admin only) — ดู docs/AI Context Strategy for Multi-Tenant Shops.md
  # และ lib/bms/sqlConsole.ts: read-only ใช้ได้ทุก env, write-mode ปิดใน production เสมอ
  type BmsSqlResult {
    ok: Boolean!
    columns: [String!]!
    rows: JSON!
    rowCount: Int!
    durationMs: Int!
    error: String
  }

  type BmsJsConsoleLog {
    level: String!
    text: String!
  }
  type BmsJsConsoleResult {
    ok: Boolean!
    logs: [BmsJsConsoleLog!]!
    result: String
    durationMs: Int!
    error: String
  }

  type BmsTestEmailResult {
    ok: Boolean!
    message: String!
    sent: Int!
    details: [String!]!
  }

  type BmsInboxDiagnosticEventResult {
    ok: Boolean!
    message: String!
    channel: String!
    conversationId: ID!
    kind: String!
    occurredAt: String!
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
    gender: String
    themePreference: String
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

  type BmsSupportTicket {
    id: ID!
    ticketId: String!
    name: String
    email: String!
    phone: String
    topic: String!
    subject: String!
    message: String!
    ref: String
    pageUrl: String
    userAgent: String
    ip: String
    status: String!
    createdAt: String!
    updatedAt: String
    closedAt: String
    comments: [BmsSupportTicketComment!]!
  }

  type BmsSupportTicketPage {
    items: [BmsSupportTicket!]!
    total: Int!
  }

  type BmsSupportTicketComment {
    id: ID!
    authorId: ID
    authorEmail: String
    fromStatus: String
    toStatus: String
    body: String!
    createdAt: String!
  }

  input BmsUpdateSupportTicketInput {
    id: ID!
    status: String
    comment: String
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

  # ===== BMS store profile (ข้อมูลร้าน + ค่าส่ง) =====
  type BmsPaymentAccount {
    type: String!
    bankName: String
    accountName: String
    accountNo: String
    promptpayId: String
    note: String
  }
  input BmsPaymentAccountInput {
    type: String!
    bankName: String
    accountName: String
    accountNo: String
    promptpayId: String
    note: String
  }
  type BmsStoreProfile {
    businessArchetype: String
    businessType: String
    aiLanguage: String!
    aiOrderingStyle: String!
    aiRequiredFields: [String!]!
    aiInterpretShortReplies: Boolean!
    aiHandoffAfterFailedTurns: Int!
    about: String
    address: String
    phone: String
    contactEmail: String
    website: String
    logoUrl: String
    taxId: String
    timezone: String
    country: String
    currency: String
    businessHours: String
    shippingPolicy: String
    returnPolicy: String
    paymentAccounts: [BmsPaymentAccount!]!
    shippingFlatRate: Float
    shippingFreeThreshold: Float
    shippingEstDaysMin: Int
    shippingEstDaysMax: Int
    enabledCarriers: [BmsCarrier!]!   # ขนส่งที่ร้านใช้จริง (ว่าง = ไม่ให้ลูกค้าเลือก) (7.46)
    shippingMode: String!             # flat | zone | carrier (7.47)
    shippingOriginProvince: String
    shippingOriginPostcode: String
    shippingZoneRates: [BmsShippingZoneRate!]!
    shippingWeightTiers: [BmsShippingWeightTier!]!
    emailThemeColor: String   # #RRGGBB — สีแบรนด์ในอีเมลแจ้งสถานะออร์เดอร์ (7.20)
    emailFooterText: String   # ข้อความท้ายอีเมลแจ้งสถานะออร์เดอร์ (ไม่บังคับ)
  }
  type BmsOnboardingProgress {
    completed: [String!]!
    skipped: [String!]!
    dismissedAt: String
    lastSeenAt: String
  }
  input BmsStoreProfileInput {
    businessArchetype: String
    businessType: String
    aiLanguage: String
    aiOrderingStyle: String
    aiRequiredFields: [String!]
    aiInterpretShortReplies: Boolean
    aiHandoffAfterFailedTurns: Int
    about: String
    address: String
    phone: String
    contactEmail: String
    website: String
    logoUrl: String
    taxId: String
    timezone: String
    country: String
    currency: String
    businessHours: String
    shippingPolicy: String
    returnPolicy: String
    paymentAccounts: [BmsPaymentAccountInput!]
    shippingFlatRate: Float
    shippingFreeThreshold: Float
    shippingEstDaysMin: Int
    shippingEstDaysMax: Int
    enabledCarriers: [BmsCarrier!]
    shippingMode: String
    shippingOriginProvince: String
    shippingOriginPostcode: String
    shippingZoneRates: [BmsShippingZoneRateInput!]
    shippingWeightTiers: [BmsShippingWeightTierInput!]
    emailThemeColor: String
    emailFooterText: String
  }

  # ค่าส่งตามโซนปลายทาง / ขั้นน้ำหนัก (7.47)
  type BmsShippingZoneRate { zone: String!, fee: Float! }
  input BmsShippingZoneRateInput { zone: String!, fee: Float! }
  type BmsShippingWeightTier { maxGrams: Int!, surcharge: Float! }
  input BmsShippingWeightTierInput { maxGrams: Int!, surcharge: Float! }

  # ===== BMS Coupons (โค้ดส่วนลด) =====
  type BmsCoupon {
    id: ID!
    code: String!
    type: String!               # PERCENT | FIXED
    value: Float!
    minOrderAmount: Float
    maxRedemptions: Int
    redemptionsCount: Int!
    perCustomerLimit: Int
    startsAt: String
    expiresAt: String
    active: Boolean!
    note: String
    createdAt: String!
    updatedAt: String!
  }
  # ===== BMS membership + แต้มสะสม (7.96) =====
  type BmsLoyaltySettings {
    enabled: Boolean!
    earnMode: String!             # SPEND | VISIT
    earnPointsPerBaht: Float!
    visitPoints: Int!
    earnMinSpend: Float!
    earnBase: String!             # AFTER_DISCOUNT | BEFORE_DISCOUNT
    redeemPointsPerUnit: Int!     # แต้มต่อ 1 หน่วยแลก
    redeemBahtPerUnit: Float!     # มูลค่าบาทต่อ 1 หน่วยแลก
    redeemMinPoints: Int!
    maxDiscountPct: Float!        # เพดานส่วนลดรวมทุกชั้นต่อบิล
    pointsExpireMonths: Int!      # 0 = ไม่หมดอายุ
  }
  input BmsLoyaltySettingsInput {
    enabled: Boolean
    earnMode: String
    earnPointsPerBaht: Float
    visitPoints: Int
    earnMinSpend: Float
    earnBase: String
    redeemPointsPerUnit: Int
    redeemBahtPerUnit: Float
    redeemMinPoints: Int
    maxDiscountPct: Float
    pointsExpireMonths: Int
  }
  type BmsMembershipTier {
    id: ID!
    code: String!
    name: String!
    discountType: String!         # NONE | PERCENT | FIXED
    discountValue: Float!
    qualifySpend12m: Float!       # ยอดซื้อ 12 เดือนที่เข้าเกณฑ์
    qualifyPoints: Int!           # หรือแต้มสะสมตลอดชีพ
    sortOrder: Int!               # มากกว่า = ชั้นสูงกว่า
    active: Boolean!
  }
  input BmsMembershipTierInput {
    id: ID
    code: String!
    name: String!
    discountType: String!
    discountValue: Float!
    qualifySpend12m: Float!
    qualifyPoints: Int!
    sortOrder: Int!
    active: Boolean!
  }
  type BmsTierDeleteResult {
    deleted: Boolean!
    deactivated: Boolean!         # true = ยังมีสมาชิกอยู่ จึงปิดใช้งานแทนการลบ
  }
  type BmsMember {
    customerId: ID!
    name: String!
    phone: String
    memberNo: String
    memberSince: String
    tier: BmsMembershipTier
    pointsBalance: Int!           # SUM ทั้ง ledger — ติดลบได้เมื่อคืนของหลังใช้แต้ม
    pointsUsable: Int!            # แลกได้จริงตอนนี้ (ตัดก้อนหมดอายุออกแล้ว)
  }
  type BmsMemberPage {
    members: [BmsMember!]!
    total: Int!                   # จำนวนที่ตรงคำค้น (ไม่ใช่แค่หน้านี้)
  }
  type BmsEnrollMemberResult {
    status: String!               # ENROLLED | ALREADY_MEMBER | INVALID
    reason: String
    member: BmsMember
  }
  type BmsLoyaltyLedgerEntry {
    id: ID!
    kind: String!                 # EARN | REDEEM | REVERSE | EXPIRE | ADJUST
    points: Int!
    orderId: ID
    posReturnId: ID
    expiresAt: String
    note: String
    createdAt: String!
  }
  type BmsLoyaltyBalance {
    balance: Int!
  }
  type BmsTierReviewResult {
    reviewed: Int!
    changed: Int!
  }
  type BmsLoyaltyExpireResult {
    customers: Int!
    points: Int!
  }
  type BmsLoyaltyOutstanding {
    members: Int!
    outstandingPoints: Int!       # ภาระผูกพัน (IFRS 15 deferred revenue)
    outstandingValue: Float!      # มูลค่าบาทตามอัตราแลกปัจจุบัน
    expiringIn30Days: Int!
    balanceMismatchCount: Int!    # cache ไม่ตรง ledger — ต้องเป็น 0 เสมอ
  }
  type BmsLoyaltyActivityRow {
    month: String!
    earned: Int!
    redeemed: Int!
    expired: Int!
    reversedNet: Int!            # บวก = คืนแต้มให้ลูกค้าสุทธิ
    adjustedNet: Int!
  }
  type BmsExpiringPointsRow {
    customerId: ID!
    name: String!
    phone: String
    memberNo: String
    expiringPoints: Int!
    firstExpiresAt: String!
  }
  type BmsSalesByTierRow {
    tierCode: String!            # NON_MEMBER = ลูกค้าที่ไม่ได้สมัคร
    tierName: String!
    members: Int!
    orders: Int!
    revenue: Float!
    averageBasket: Float!
  }
  type BmsMemberDiscountPreview {
    subtotal: Float!
    tierDiscount: Float!
    tierLabel: String
    couponDiscount: Float!
    pointsDiscount: Float!
    pointsUsed: Int!
    manualDiscount: Float!
    totalDiscount: Float!
    netTotal: Float!
    capped: Boolean!              # true = ส่วนลดถูกตัดเพราะชนเพดาน
    cappedAt: Float!
    member: BmsMember
  }

  # แถวประวัติการใช้โค้ด — ไม่มีตาราง redemption แยก, derive จาก bms_orders.coupon_code ตรงๆ
  type BmsCouponRedemption {
    orderId: ID!
    customerId: ID
    customerName: String
    channel: String!
    status: String!
    discountAmount: Float!
    totalAmount: Float!
    createdAt: String!
  }
  input BmsCouponInput {
    id: ID
    code: String!
    type: String!
    value: Float!
    minOrderAmount: Float
    maxRedemptions: Int
    perCustomerLimit: Int
    startsAt: String
    expiresAt: String
    active: Boolean
    note: String
  }

  # ===== BMS AI Assistant (staff) =====
  input BmsAssistantTurn {
    role: String!
    text: String!
  }
  input BmsPharmacyAssistantSessionInput {
    protocolKey: String
    phase: String
    protocolId: String
    answers: JSON
    currentQuestionKey: String
    currentFieldKey: String
  }
  type BmsAssistantProposal {
    tool: String!
    mutation: String!
    args: JSON!
    summary: String!
  }
  type BmsAssistantTrace {
    tool: String!
    ok: Boolean!
    summary: String!
  }
  type BmsAssistantResult {
    reply: String!
    proposals: [BmsAssistantProposal!]!
    trace: [BmsAssistantTrace!]!
  }
  type BmsPharmacyAssistantResult {
    reply: String!
    session: JSON!
  }

  type Mutation {

    bmsRefreshActions: Int!
    bmsTransitionAction(id: ID!, status: BmsActionStatus!, reason: String, ownerId: ID, measuredOutcome: JSON): BmsAction!
    bmsRecordInventoryDemand(input: BmsInventoryDemandInput!): ID!
    bmsUpsertInventoryPolicy(input: BmsInventoryPolicyInput!): Boolean!
    bmsRefreshRetention: Int!
    bmsTransitionRetentionCase(id: ID!, status: BmsRetentionStatus!, reason: String): BmsRetentionCase!

    # ---- สาขา (9.1) ----
    bmsUpsertLocation(input: BmsLocationInput!): BmsLocation!

    # ---- POS (7.87) ----
    bmsUpsertPosDevice(input: BmsPosDeviceInput!): BmsPosDevice!
    bmsIssuePosDeviceToken(deviceId: ID!): BmsPosDeviceToken!
    bmsIssueFullTaxInvoice(orderId: ID!, buyer: BmsTaxInvoiceBuyerInput!): BmsIssueFullTaxInvoiceResult!
    bmsUpdateTaxSettings(input: BmsTaxSettingsInput!): BmsTaxSettings!
    # ตั้งประเภท VAT ให้สินค้าที่ยังเป็น UNKNOWN ทั้งหมด — คืนจำนวนแถวที่เปลี่ยน
    # แตะเฉพาะ UNKNOWN: สินค้าที่ตั้งค่าไว้แล้วต้องไม่ถูกเขียนทับด้วยการกดครั้งเดียว
    bmsSetVatCategoryForUnknown(vatCategory: String!, activeOnly: Boolean): Int!
    # ออกบาร์โค้ด EAN-13 ช่วงร้านใช้ภายใน (20xx) ให้สินค้าที่ไม่มีบาร์โค้ดจากโรงงาน
    # ไม่ได้บันทึกลงสินค้าให้ — คืนเลขให้จอเอาไปใส่ในฟอร์มแล้วผู้ใช้กดบันทึกเอง
    bmsGenerateInStoreBarcode: String!
    "pin ว่าง/null = ล้าง PIN ทำให้ขายหน้าร้านไม่ได้"
    bmsUpsertProductPack(input: BmsProductPackInput!): BmsProductPack!
    bmsDeleteProductPack(id: ID!): Boolean!
    bmsRunEtaxQueue(limit: Int = 20): BmsEtaxRunResult!
    bmsBackfillEtaxQueue(limit: Int = 500): Int!
    bmsSetCashierPin(userId: ID!, pin: String): Boolean!
    "posOnly=true → บัญชีนี้ login เข้าหลังบ้านไม่ได้อีก ใช้ได้เฉพาะ PIN ที่เครื่องขาย"
    bmsSetCashierAccountMode(userId: ID!, posOnly: Boolean!): Boolean!
    bmsOpenPosShift(deviceId: ID!, openingFloat: Float = 0, pharmacistUserId: ID): BmsOpenShiftResult!
    bmsClosePosShift(shiftId: ID!, countedCash: Float!, note: String): BmsCloseShiftResult!
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
    bmsUpdateSupportTicket(input: BmsUpdateSupportTicketInput!): BmsSupportTicket!


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
    bmsReorderFromOrder(id: ID!): BmsReorderResult!   # "ซื้อซ้ำ" — สร้างออร์เดอร์ใหม่จากรายการเดิม
    bmsCreateOrder(channel: String, customerRef: String, items: [BmsOrderItemInput!]!, couponCode: String, preferredCarrier: BmsCarrier): BmsReorderResult!  # แอดมิน/staff สร้างออร์เดอร์เอง (จองสต็อก atomic เหมือน AI create_order)

    # ===== BMS products & inventory (admin) =====
    bmsUpsertProduct(input: BmsProductInput!): BmsProduct!
    bmsReviewAiSynonymCandidate(id: ID!, decision: String!, productSku: String): BmsAiSynonymCandidate!
    bmsImportProducts(items: [BmsProductImportRowInput!]!, commit: Boolean = false): BmsProductImportResult!
    bmsSetProductActive(sku: String!, active: Boolean!): Boolean!
    bmsCreateProductCategory(name: String!): BmsProductCategory!
    bmsRenameProductCategory(id: ID!, name: String!): BmsProductCategory!
    bmsDeleteProductCategory(id: ID!): Boolean!
    bmsAdjustStock(sku: String!, size: String!, delta: Int!, note: String): BmsVariant!
    bmsSetReorderPoint(sku: String!, size: String!, reorderPoint: Int!): BmsVariant!

    # ===== BMS purchase (admin) — PO lifecycle =====
    bmsCreatePurchaseOrder(supplierId: ID, supplierName: String, note: String, items: [BmsPurchaseItemInput!]!): BmsPurchaseResult!
    bmsReceivePurchaseOrder(id: ID!, items: [BmsReceiveItemInput!]!): BmsPurchaseResult!  # OPEN/PARTIAL → PARTIAL/RECEIVED (STOCK_IN)
    bmsCancelPurchaseOrder(id: ID!): Boolean!                                            # OPEN/PARTIAL → CANCELLED

    # ===== BMS payment (admin) =====
    bmsSubmitPayment(orderId: ID!, method: BmsPaymentMethod!, amount: Float, slipUrl: String, slipRef: String, note: String): BmsPaymentResult!
    bmsConfirmPayment(id: ID!): BmsPaymentResult!   # PENDING → CONFIRMED + order → PAID
    bmsRejectPayment(id: ID!, note: String): Boolean!
    bmsRefundPayment(id: ID!): Boolean!             # CONFIRMED → REFUNDED (manager)
    bmsVerifyPaymentSlip(id: ID!): BmsSlipVerification   # OCR/AI แนะนำ (ไม่เปลี่ยนสถานะ)

    # ===== BMS shipping (admin) =====
    bmsCreateShipment(orderId: ID!, carrier: BmsCarrier!, trackingNo: String, note: String): BmsShipmentResult!  # PACKING → SHIPPED (ตัดสต็อก)
    bmsUpdateTracking(id: ID!, trackingNo: String, carrier: BmsCarrier): Boolean!
    bmsSetShipmentStatus(id: ID!, status: BmsShipmentStatus!): Boolean!   # DELIVERED → order COMPLETED
    bmsCancelShipment(id: ID!): Boolean!
    bmsBookShipmentLive(id: ID!): BmsCarrierBookingResult!
    bmsSyncShipmentLive(id: ID!): BmsSyncShipmentLiveResult!

    # ===== BMS inbox (admin) =====
    bmsSendMessage(id: ID!, body: String, attachment: BmsAttachmentInput): BmsSendResult!   # ตอบเอง (persist + ยิงกลับช่องทาง) · body หรือ attachment อย่างน้อยหนึ่ง
    bmsRetryMessage(id: ID!): BmsSendResult!                                                # ส่งข้อความเดิมซ้ำ (จากสถานะ FAILED)
    bmsAssignConversation(id: ID!, userId: ID!): Boolean!            # เปลี่ยน staff หลัก (โอนแชท) — ต้องมี user เสมอ
    bmsAddConversationHelper(id: ID!, userId: ID!): Boolean!         # เพิ่มคนช่วยตอบ (ไม่กระทบ staff หลัก)
    bmsRemoveConversationHelper(id: ID!, userId: ID!): Boolean!
    bmsSetMyAvailability(available: Boolean!): Boolean!              # ปิด/เปิดรับแชทใหม่ (ไม่กระทบแชทที่ถืออยู่แล้ว)
    bmsSetConversationStatus(id: ID!, status: BmsConvStatus!): Boolean!
    bmsSetConversationTags(id: ID!, tags: [String!]!): Boolean!
    bmsMarkConversationRead(id: ID!): Boolean!
    bmsAddConversationNote(id: ID!, body: String!, mentionedUserIds: [ID!]): BmsConversationNote
    bmsMarkMentionRead(id: ID!): Boolean!
    bmsMarkAllMentionsRead: Boolean!
    bmsCreateInboxDiagnosticMessage(channel: String!, body: String): BmsInboxDiagnosticMessageResult!
    bmsSendRestockNotification(id: ID!, body: String!): BmsRestockSendResult!
    bmsCancelRestockSubscription(id: ID!): Boolean!
    # แจ้งลูกค้าที่ READY_TO_NOTIFY ทั้งหมดในครั้งเดียว ด้วยข้อความ template (ปุ่ม "แจ้งทั้งหมด")
    bmsSendAllReadyRestockNotifications: BmsRestockSendAllResult!
    bmsReviewAiQualityCase(id: ID!, verdict: String!, category: String!, note: String): BmsAiQualityCaseDetail!
    bmsDismissAiQualityCase(id: ID!): BmsAiQualityCaseDetail!

    # ===== BMS CRM (admin) =====
    bmsUpsertCustomer(input: BmsCustomerInput!): BmsCustomer!
    bmsSetCustomerTags(id: ID!, tags: [String!]!): Boolean!
    bmsAddCustomerAddress(id: ID!, label: String, address: String!, isDefault: Boolean): BmsCustomerAddress!
    bmsUpdateCustomerAddress(addressId: ID!, label: String, address: String!): BmsCustomerAddress!
    bmsSetDefaultCustomerAddress(addressId: ID!): BmsCustomerAddress!
    bmsDeleteCustomerAddress(addressId: ID!): Boolean!
    bmsDeleteCustomer(id: ID!): Boolean!
    bmsMergeCustomers(keepId: ID!, mergeId: ID!): Boolean!

    # ===== BMS AI Assistant (staff) — ตอบด้วย tool-calling; A3 คืน proposal ให้กดยืนยันเอง =====
    bmsAssistant(message: String!, history: [BmsAssistantTurn!]): BmsAssistantResult!
    bmsPharmacyAssistantTest(message: String!, session: BmsPharmacyAssistantSessionInput): BmsPharmacyAssistantResult!
    bmsCreatePharmacyLabOrder(items: [BmsPharmacyLabCartItemInput!]!): BmsReorderResult!
    bmsSeedPharmacyQueueDemo(protocolKey: String, answers: JSON, transcript: JSON): BmsSeedPharmacyQueueDemoResult!
    bmsUpsertStoreProfile(input: BmsStoreProfileInput!): BmsStoreProfile!   # ตั้งค่าข้อมูลร้าน/ค่าส่ง
    bmsUpdateOnboardingProgress(completed: [String!], skipped: [String!], dismissed: Boolean): BmsOnboardingProgress!
    bmsUpdateMyTenant(name: String, slug: String): BmsTenantInfo!          # แก้ชื่อร้าน/slug (Administrator ของร้าน)
    bmsGenerateReport(input: BmsGenerateReportInput!): BmsGenerateReportResult!   # permission report.view
    bmsEmailReport(fileId: Int!, to: String!, subject: String): BmsEmailReportResult!   # permission report.email — ปุ่ม Confirm ของ proposal email_report (A3) เท่านั้น
    bmsUpsertCoupon(input: BmsCouponInput!): BmsCoupon!    # สร้าง/แก้โค้ดส่วนลด (permission coupon.manage)
    bmsDeleteCoupon(id: ID!): Boolean!
    bmsAssignCouponToCustomer(customerId: ID, channel: String, customerRef: String, conversationId: ID, code: String!, note: String): Boolean!   # แจกคูปองเข้ากระเป๋าลูกค้าโดยตรง (permission coupon.manage)

    # ===== BMS membership + แต้มสะสม (7.96) =====
    bmsUpdateLoyaltySettings(input: BmsLoyaltySettingsInput!): BmsLoyaltySettings!   # permission loyalty.settings
    bmsUpsertMembershipTier(input: BmsMembershipTierInput!): BmsMembershipTier!
    bmsDeleteMembershipTier(id: ID!): BmsTierDeleteResult!          # ยังมีสมาชิกอยู่ = ปิดใช้งานแทนลบ
    bmsEnrollMember(phone: String!, name: String): BmsEnrollMemberResult!   # permission member.manage
    bmsAdjustLoyaltyPoints(customerId: ID!, points: Int!, note: String!): BmsLoyaltyBalance!   # permission loyalty.adjust — ต้องมีเหตุผล
    bmsReviewMemberTier(customerId: ID): BmsTierReviewResult!       # ไม่ส่ง customerId = ทบทวนทุกคน
    bmsExpireLoyaltyPoints: BmsLoyaltyExpireResult!                 # ยังไม่มี cron จริง ต้องกดเอง

    # ===== BMS RBAC (admin) =====
    bmsSetRolePermissions(roleId: ID!, permissions: [String!]!): Boolean!

    # ===== BMS settings / channels (admin) =====
    bmsUpsertChannel(channel: String!, accessToken: String, channelSecret: String, active: Boolean): Boolean!
    bmsTestChannel(channel: String!): BmsTestChannelResult!
    bmsUpsertReportSubscription(input: BmsUpsertReportSubscriptionInput!): BmsReportSubscription!
    bmsSendTestReportNow: BmsSendReportResult!

    # ===== BMS Follow-up Automation (MVP core) =====
    bmsUpsertFollowupRule(input: BmsFollowupRuleInput!): BmsFollowupRule!
    bmsDeleteFollowupRule(id: ID!): Boolean!
    bmsRunFollowupsNow: BmsFollowupRunResult!

    # ===== AI Pharmacy Intake Assistant =====
    bmsAssignPharmacist(assessmentId: ID!, pharmacistUserId: ID!): BmsPharmacyAssessment!
    bmsStartPharmacistReview(assessmentId: ID!): BmsPharmacyAssessment!
    bmsRequestMoreInformation(assessmentId: ID!, expectedVersion: Int!, fields: [String!]!, note: String): BmsPharmacyAssessment!
    bmsApproveAssessment(assessmentId: ID!, expectedVersion: Int!, pharmacistResponse: String!, orderDraft: JSON): BmsPharmacyAssessment!
    bmsRejectAssessment(assessmentId: ID!, expectedVersion: Int!, reason: String!): BmsPharmacyAssessment!
    bmsReferAssessmentToDoctor(assessmentId: ID!, expectedVersion: Int!, reason: String!): BmsPharmacyAssessment!
    bmsEscalateAssessmentToEmergency(assessmentId: ID!, reason: String!): BmsPharmacyAssessment!
    bmsEditAssessmentSummary(assessmentId: ID!, summaryText: String!): BmsPharmacyAssessment!
    bmsEditPharmacistDecisionNotes(assessmentId: ID!, expectedVersion: Int!, decisionNotes: String!): BmsPharmacyAssessment!
    bmsManualFillAssessmentFields(assessmentId: ID!, fields: JSON!): BmsPharmacyAssessment!
    bmsGenerateMedicationSuggestions(assessmentId: ID!): BmsPharmacyAssessment!
    bmsSoftDeleteAssessment(assessmentId: ID!): Boolean!
    bmsSetPharmacistLicense(userId: ID!, isLicensedPharmacist: Boolean!, licenseNo: String): Boolean!
    bmsRecordPharmacyConsent(assessmentId: ID!, status: String!, consentVersion: String!): BmsPharmacyAssessment!
    bmsUpsertPharmacyProtocol(input: BmsPharmacyProtocolInput!): BmsPharmacyProtocol!
    bmsSubmitPharmacyProtocolForReview(id: ID!): BmsPharmacyProtocol!
    bmsReviewPharmacyProtocol(id: ID!, decision: String!): BmsPharmacyProtocol!
    bmsSetPharmacyProtocolEnabled(id: ID!, enabled: Boolean!): BmsPharmacyProtocol!
    bmsUpsertPharmacyProductPolicy(input: BmsPharmacyProductPolicyInput!): BmsPharmacyProductPolicy!
    bmsSubmitPharmacyProductPolicyForReview(productSku: String!): BmsPharmacyProductPolicy!
    bmsReviewPharmacyProductPolicy(productSku: String!, decision: String!): BmsPharmacyProductPolicy!
    bmsSetAiKey(apiKey: String, model: String, provider: String): Boolean!
    bmsRemoveAiKey: Boolean!
    bmsTestAiKey: BmsTestAiKeyResult!
    bmsAdjustAiCredits(amount: Int!, note: String): Boolean!
    bmsTestPlatformAiKey(provider: String): BmsTestAiKeyResult!
    # ยิงทดสอบ anthropic/deepseek/qwen พร้อมกันแล้วคืนสถานะล่าสุดทั้งหมด — ใช้กับปุ่ม
    # "ตรวจสอบทั้งหมดตอนนี้" ในหน้า /admin/env (ไม่ต้องรอ cron ที่ยังไม่ได้ตั้ง schedule)
    bmsCheckAllAiProviderHealth: [BmsAiProviderHealth!]!
    bmsEmitInboxDiagnosticEvent(channel: String!, probeId: ID!): BmsInboxDiagnosticEventResult!

    # ===== Dev SQL Console (platform admin only) =====
    bmsRunReadOnlySql(sql: String!): BmsSqlResult!   # SELECT/WITH เท่านั้น, ใช้ได้ทุก env
    bmsRunSql(sql: String!): BmsSqlResult!           # เขียนได้ — ปิดใช้งานเมื่อ NODE_ENV=production เสมอ
    bmsRunSandboxedJs(code: String!): BmsJsConsoleResult! # JS sync sandbox + console.log — non-production only
    bmsSendTestEmail(to: String!, html: String): BmsTestEmailResult!

    # ===== BMS SaaS: signup (public) + billing (admin) =====
    bmsSignup(shopName: String!, name: String, email: String!, password: String!, businessArchetype: String): BmsSignupResult!
    bmsVerifyShopSignup(token: String!): BmsVerifyShopSignupResult!
    bmsChangePlan(planCode: String!): Boolean!

    # ===== BMS platform admin (ข้ามร้าน) =====
    bmsSetTenantActive(tenantId: ID!, active: Boolean!): Boolean!
    bmsSetTenantPlan(tenantId: ID!, planCode: String!): Boolean!
    bmsEnterTenant(tenantId: ID!): Boolean!   # drill-down เข้ามุมร้าน
    bmsExitTenant: Boolean!                   # ออกจากมุมร้าน
    bmsDeleteTenant(tenantId: ID!): Boolean!  # ลบร้านถาวร — เฉพาะร้านทดสอบ (slug ขึ้นต้น "test-")
  }
`;
