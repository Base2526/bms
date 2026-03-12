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

  type Message {
    id: ID!
    chat_id: ID!
    sender: User
    text: String!
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
  }
`;
