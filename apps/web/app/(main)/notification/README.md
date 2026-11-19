# Notifications

Current implementation (2026-11-14): `/notification` reads a bounded, user-scoped GraphQL list.
The server scopes read, unread and delete mutations to `ctx.user.id`; a missing or other user's
notification returns `false`. The row links to `/post/[id]` or to an existing room in `/chat?chat=`;
the chat page opens the room only if `myChats` includes it, and message reads still check membership.
The Settings button opens `/settings`. The notification row delete action asks for confirmation.
The design sketches below predate this implementation; use `page.tsx`, `graphql/typeDefs.ts` and
`graphql/resolvers.ts` for the current contract.

---- #1

## 1. ภาพรวม Concept

แยก 3 ชั้นชัด ๆ

1. **Event Layer** – ระบบไหนมี event ก็ยิงเข้ามา (chat created, new message, comment, follow ฯลฯ)
2. **Notification Service** – รับ event → คิดว่า “ใครควรได้ noti อะไรบ้าง” → สร้าง `notifications` record
3. **Delivery Layer** – ส่ง noti ไปยัง:

   * In-app (WebSocket / GraphQL subscription)
   * (เผื่อในอนาคต) Email / Push / Line ฯลฯ

---

## 2. โครงสร้าง Table / Model ที่แนะนำ

```sql
-- notifications: เก็บ noti ที่ fan-out แล้วต่อ user
CREATE TABLE notifications (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL, -- คนที่จะเห็น noti
  type            TEXT NOT NULL, -- เช่น CHAT_NEW, POST_COMMENT, POST_FOLLOWED_COMMENT
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  entity_type     TEXT NOT NULL, -- 'chat' | 'post' | 'comment' | ...
  entity_id       UUID NOT NULL, -- id ของ chat/post/comment ที่เกี่ยวข้อง
  data            JSONB,         -- เก็บข้อมูลเพิ่ม เช่น { chat_id, post_id, comment_id, actor_name }
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_notification_settings: เผื่อ config ว่าอยากได้ noti อะไรบ้าง
CREATE TABLE user_notification_settings (
  user_id         UUID PRIMARY KEY,
  chat_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  post_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled   BOOLEAN NOT NULL DEFAULT FALSE -- เผื่อใช้ต่อ
);
```

GraphQL type (คร่าว ๆ):

```graphql
type Notification {
  id: ID!
  type: String!
  title: String!
  message: String!
  entity_type: String!
  entity_id: ID!
  data: JSON
  is_read: Boolean!
  created_at: String!
}

type Query {
  myNotifications(limit: Int, offset: Int): [Notification!]!
  myUnreadNotificationCount: Int!
}

type Mutation {
  markNotificationRead(id: ID!): Boolean!
  markAllNotificationsRead: Boolean!
}

type Subscription {
  notificationCreated: Notification!  # push real-time
}
```

ฝั่ง WS / Realtime server ก็แค่ broadcast `notificationCreated` ไปเฉพาะ user ที่เกี่ยวข้อง (ใช้ user_id จาก JWT หรือ session)

---

## 3. เคส: createChat (chat 1:1 และ group chat)

### 3.1 Event: `createChat`

เวลาเรียก `mutation createChat(...)` แล้วสำเร็จ ให้เรียก Notification Service แบบนี้:

```ts
async function onChatCreated(chat, currentUser) {
  const members = chat.members; // array user_id ทั้งห้อง
  const recipients = members.filter(m => m.id !== currentUser.id);

  for (const user of recipients) {
    await createNotification({
      user_id: user.id,
      type: 'CHAT_CREATED',
      title: chat.is_group
        ? `คุณถูกเพิ่มในกลุ่ม "${chat.name}"`
        : `เริ่มแชทใหม่กับ ${currentUser.name}`,
      message: chat.is_group
        ? `${currentUser.name} สร้างห้อง และเพิ่มคุณเข้ากลุ่ม`
        : `${currentUser.name} เริ่มคุยกับคุณ`,
      entity_type: 'chat',
      entity_id: chat.id,
      data: {
        chat_id: chat.id,
        chat_name: chat.name,
        is_group: chat.is_group,
        actor_id: currentUser.id,
        actor_name: currentUser.name,
      },
    });

    // push real-time
    pubsub.publish(`NOTI_${user.id}`, { notificationCreated: noti });
  }
}
```

### UX ฝั่ง Frontend (Antd)

* มี **Notification Bell** ที่ header
* มี badge แสดงจำนวน unread
* เมื่อรับ subscription `notificationCreated`:

  * แสดง Antd `notification.open` หรือ message
  * อัพเดตรายการใน Notification Center (drawer / dropdown)

ตัวอย่างรูปแบบ text:

* **1:1 chat**

  * Title: `New chat`
  * Message: `Jarvis started a chat with you.`
* **Group chat**

  * Title: `Added to group`
  * Message: `Jarvis added you to group "Developer Team".`

---

## 4. เคส: Post + Comment + Follow

มองเป็น event หลัก ๆ:

1. `POST_COMMENTED`
2. `POST_FOLLOWED`
3. `POST_NEW_FOR_FOLLOWERS`
4. (optional) `POST_MENTION` เวลา tag user ใน comment

### 4.1 เจ้าของโพสต์ เมื่อมีคน comment

**Event:** `onPostCommentCreated(post, comment, actor)`

Recipient:

* `post.owner_id` (ถ้าไม่ใช่คนเดียวกับ actor)
* คนที่มี role พิเศษ เช่น admin (ถ้าต้องการ)

Pseudo-code:

```ts
async function onPostCommentCreated(post, comment, actor) {
  // 1) แจ้งเจ้าของโพสต์
  if (post.owner_id !== actor.id) {
    await createNotification({
      user_id: post.owner_id,
      type: 'POST_COMMENT',
      title: 'มีคอมเมนต์ใหม่ในโพสต์ของคุณ',
      message: `${actor.name}: ${comment.text.slice(0, 80)}`,
      entity_type: 'post',
      entity_id: post.id,
      data: {
        post_id: post.id,
        comment_id: comment.id,
        actor_id: actor.id,
        actor_name: actor.name,
      },
    });
  }

  // 2) แจ้ง Followers ของโพสต์ (จะอธิบายในหัวข้อถัดไป)
  await notifyPostFollowers(post, comment, actor);
}
```

### 4.2 คนที่ follow post แล้วมี comment ใหม่

มี table เช่น:

```sql
CREATE TABLE post_followers (
  post_id   UUID NOT NULL,
  user_id   UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);
```

ฟังก์ชัน notification:

```ts
async function notifyPostFollowers(post, comment, actor) {
  const followers = await db('post_followers')
    .where({ post_id: post.id })
    .select('user_id');

  const recipients = followers
    .map(f => f.user_id)
    .filter(uid => uid !== actor.id && uid !== post.owner_id); // กันซ้ำ

  for (const user_id of recipients) {
    await createNotification({
      user_id,
      type: 'POST_FOLLOWED_COMMENT',
      title: 'โพสต์ที่คุณติดตามมีคอมเมนต์ใหม่',
      message: `${actor.name}: ${comment.text.slice(0, 80)}`,
      entity_type: 'post',
      entity_id: post.id,
      data: {
        post_id: post.id,
        comment_id: comment.id,
        actor_id: actor.id,
        actor_name: actor.name,
      },
    });
  }
}
```

### 4.3 เจ้าของ post ได้ noti เวลาโดน follow

**Event:** `onPostFollowed(post, follower)`

```ts
async function onPostFollowed(post, follower) {
  if (post.owner_id === follower.id) return; // ไม่ต้องแจ้งตัวเอง

  await createNotification({
    user_id: post.owner_id,
    type: 'POST_FOLLOWED',
    title: 'มีคนติดตามโพสต์ของคุณ',
    message: `${follower.name} กดติดตามโพสต์ของคุณ`,
    entity_type: 'post',
    entity_id: post.id,
    data: {
      post_id: post.id,
      follower_id: follower.id,
      follower_name: follower.name,
    },
  });
}
```

---

## 5. ออกแบบประเภท Notification เผื่อในอนาคต

ลอง define enum ไว้ใน system (ไม่ต้องเป็น enum จริงใน DB แต่อย่างน้อยมี list กลาง):

```ts
// notificationTypes.ts
export const NotificationTypes = {
  // Chat related
  CHAT_CREATED: 'CHAT_CREATED',
  CHAT_NEW_MESSAGE: 'CHAT_NEW_MESSAGE',
  CHAT_MENTION: 'CHAT_MENTION',

  // Post related
  POST_COMMENT: 'POST_COMMENT',
  POST_FOLLOWED: 'POST_FOLLOWED',
  POST_FOLLOWED_COMMENT: 'POST_FOLLOWED_COMMENT',
  POST_LIKED: 'POST_LIKED',

  // System / Admin
  SYSTEM_ANNOUNCEMENT: 'SYSTEM_ANNOUNCEMENT',
  SYSTEM_MAINTENANCE: 'SYSTEM_MAINTENANCE',
} as const;
```

ในอนาคตถ้าอยากเพิ่ม:

* `TASK_ASSIGNED` – มีคน assign task ให้เรา
* `BOOKING_STATUS_CHANGED` – สถานะ booking เปลี่ยน
* `PAYMENT_RECEIVED` – มีการชำระเงินเข้ามา
* `DRIVER_ASSIGNED` – driver ถูก assign งาน

ไม่ต้องแตะโครง DB, แค่เพิ่ม type + logic ใน Notification Service

---

## 6. Notification Service Helper (จุดกลางที่ทุก event เรียกใช้)

ทำเป็นฟังก์ชันกลางใน backend:

```ts
async function createNotification(input) {
  const { user_id } = input;

  // 1) ตรวจว่า user เปิด noti ประเภทนี้ไว้ไหม (เช่น chat/post)
  const setting = await getUserSettings(user_id);
  if (!isNotificationEnabled(setting, input.type)) {
    return null;
  }

  // 2) เขียน DB
  const [noti] = await db('notifications')
    .insert({
      id: uuidv4(),
      ...input,
    })
    .returning('*');

  // 3) ส่ง real-time ผ่าน WS/GraphQL
  pubsub.publish(`NOTI_${user_id}`, { notificationCreated: noti });

  return noti;
}

function isNotificationEnabled(setting, type) {
  // Logic ง่าย ๆ
  if (type.startsWith('CHAT_')) return setting.chat_enabled;
  if (type.startsWith('POST_')) return setting.post_enabled;
  return true;
}
```

---

## 7. สรุป Flow ที่คุณเอาไปใช้ได้เลย

### createChat (1:1 / group)

1. `mutation createChat`
2. Save chat + members
3. Call `onChatCreated(chat, currentUser)`
4. `createNotification` → insert DB + push subscription ให้สมาชิก 1:1 หรือ group (ยกเว้นคนสร้าง)

### Comment Post

1. `mutation addComment(post_id, text)`
2. Save comment
3. `onPostCommentCreated(post, comment, actor)`

   * ส่ง noti ให้ owner
   * ส่ง noti ให้ followers (ยกเว้น owner + actor)

### Follow Post

1. `mutation followPost(post_id)`
2. Save follower
3. `onPostFollowed(post, follower)` → แจ้ง owner



--- #2

## 1. โครงหน้า (Layout)

นึกเป็นหน้า `/notifications` หรือ Drawer จาก icon กระดิ่งได้เหมือนกัน โครงหลัก ๆ แบบนี้:

1. **Header**

   * ชื่อหน้า: `Notifications`
   * ด้านขวา:

     * ปุ่ม `Mark all as read`
     * ปุ่ม/ไอคอน ⚙ `Settings` (ลิงก์ไปหน้า notification settings)
2. **Filter Bar (ใต้ Header เลย)**

   * Tabs:

     * `All`
     * `Unread`
     * `Chat`
     * `Posts`
     * (เผื่อ) `System`
   * Search box (เล็ก ๆ): `Search notifications...`
3. **Notification List**

   * แบ่งกลุ่มตามวัน: `Today`, `Yesterday`, `This week`, `Earlier`
   * แต่ละ group มีหัวข้อเป็นวันที่ และด้านล่างเป็น List
4. **Footer (optional)**

   * ปุ่ม `Load more` หรือ infinite scroll

---

## 2. โครงของ Notification Item

1 แถวควรมี:

* **Unread dot** (จุดเล็ก ๆ สีน้ำเงิน/เขียว) แสดงเฉพาะถ้ายังไม่อ่าน
* **Icon / Avatar เล็ก ๆ**

  * Chat: bubble icon
  * Post: document / message icon
  * System: bell / info icon
* **Title + Message**

  * Title: ตัวหนา สำหรับ unread
  * Message: ข้อความสั้น ๆ สรุป event
* **Meta Section (ด้านขวา/ด้านล่าง)**

  * เวลา: `5m ago`, `2 hours ago`, `Yesterday`, หรือ format ตามระบบ
  * Tag: `Chat`, `Post`, `System`
* **Action (hover / menu)**

  * `Mark as read / unread`
  * `Open`
  * `Delete`

ตัวอย่าง layout ให้จินตนาการ:

```text
[•] [💬]   New chat with Jarvis         [Chat]      2m ago
          Jarvis started a chat with you.

[ ] [📝]   New comment on your post     [Post]      1h ago
          John: "I have a question about..."
```

* `[•]` = unread dot
* icon ตามประเภท noti
* `[Chat]`, `[Post]` = Tag ด้วยสี

---

## 3. การจัดกลุ่มตามวัน

ตัวอย่าง grouping:

* **Today**

  * Noti 1
  * Noti 2
* **Yesterday**

  * Noti 3
* **This week**

  * Noti 4, 5
* **Earlier**

  * Noti เก่าทั้งหมด

ช่วยให้ user scan ง่ายว่าเป็นเรื่องใหม่/เก่าแค่ไหน

---

## 4. ฟังก์ชันหลักบนหน้า List

1. **Mark all as read**

   * ปุ่มด้านบนขวา
   * ยิง `mutation markAllNotificationsRead`
   * เคลียร์ unread badge ที่ icon กระดิ่งด้วย

2. **Mark one notification as read**

   * เมื่อ user คลิกแถว →

     * ยิง `mutation markNotificationRead(id)`
     * Redirect ไปยังหน้าที่เกี่ยวข้อง เช่น chat หรือ post
   * หรือคลิกจาก menu (สามจุด) ข้างขวา

3. **Filter**

   * Tab `Unread` → ส่งตัวแปร `is_read=false` ไปใน query
   * Tab `Chat` → filter ตาม `type` หรือ `entity_type='chat'`
   * Tab `Posts` → filter `entity_type='post'`

4. **Search**

   * ฟิลเตอร์จาก `title` / `message` ใน frontend หรือส่งตัวแปร `q` ไป backend

5. **Pagination / Load more**

   * ใช้ `limit/offset` หรือ cursor-based
   * ปุ่ม `Load more` ใต้ list

---

## 5. ตัวอย่างหน้าด้วย Ant Design + React (Next.js client)

โค้ดนี้เป็นแค่ตัวอย่างโครง ไม่ผูก backend จริง แต่คุณเอา pattern ไปต่อยอดกับ GraphQL ได้เลย:

```tsx
'use client';

import { useState } from 'react';
import { List, Tabs, Badge, Button, Typography, Tag, Input, Dropdown, Menu, Space } from 'antd';
import { BellOutlined, MessageOutlined, FileTextOutlined, MoreOutlined, SettingOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { TabPane } = Tabs;
const { Search } = Input;

type NotificationItem = {
  id: string;
  type: string;        // CHAT_CREATED, POST_COMMENT, ...
  entity_type: string; // 'chat' | 'post' | 'system'
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;  // ISO string
  tagLabel: string;    // สำหรับแสดงใน Tag เช่น 'Chat', 'Post'
  timeLabel: string;   // เช่น '5m ago'
  groupLabel: string;  // Today | Yesterday | Earlier
};

const mockData: NotificationItem[] = [
  {
    id: '1',
    type: 'CHAT_CREATED',
    entity_type: 'chat',
    title: 'New chat with Jarvis',
    message: 'Jarvis started a chat with you.',
    is_read: false,
    created_at: new Date().toISOString(),
    tagLabel: 'Chat',
    timeLabel: '2m ago',
    groupLabel: 'Today',
  },
  {
    id: '2',
    type: 'POST_COMMENT',
    entity_type: 'post',
    title: 'New comment on your post',
    message: 'John: "I have a question about..."',
    is_read: true,
    created_at: new Date().toISOString(),
    tagLabel: 'Post',
    timeLabel: '1h ago',
    groupLabel: 'Today',
  },
];

function getIcon(entity_type: string) {
  switch (entity_type) {
    case 'chat':
      return <MessageOutlined />;
    case 'post':
      return <FileTextOutlined />;
    default:
      return <BellOutlined />;
  }
}

export default function NotificationPage() {
  const [tab, setTab] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [items, setItems] = useState<NotificationItem[]>(mockData);

  const unreadCount = items.filter((i) => !i.is_read).length;

  const filtered = items.filter((item) => {
    if (tab === 'unread' && item.is_read) return false;
    if (tab === 'chat' && item.entity_type !== 'chat') return false;
    if (tab === 'post' && item.entity_type !== 'post') return false;
    if (search && !`${item.title} ${item.message}`.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  // group by groupLabel
  const groups = filtered.reduce<Record<string, NotificationItem[]>>((acc, item) => {
    acc[item.groupLabel] = acc[item.groupLabel] || [];
    acc[item.groupLabel].push(item);
    return acc;
  }, {});

  const onMarkAllRead = () => {
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
    // TODO: call mutation markAllNotificationsRead
  };

  const onClickItem = (item: NotificationItem) => {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, is_read: true } : i)),
    );
    // TODO: navigate to chat/post based on entity_type & entity_id
  };

  const menuForItem = (item: NotificationItem) => (
    <Menu
      items={[
        {
          key: 'read',
          label: item.is_read ? 'Mark as unread' : 'Mark as read',
          onClick: () => {
            setItems((prev) =>
              prev.map((i) =>
                i.id === item.id ? { ...i, is_read: !i.is_read } : i,
              ),
            );
          },
        },
        {
          key: 'delete',
          danger: true,
          label: 'Delete',
          onClick: () => {
            setItems((prev) => prev.filter((i) => i.id !== item.id));
          },
        },
      ]}
    />
  );

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px' }}>
      {/* Header */}
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Title level={3} style={{ margin: 0 }}>
            Notifications
          </Title>
          {unreadCount > 0 && <Badge count={unreadCount} />}
        </Space>
        <Space>
          <Button type="link" icon={<SettingOutlined />}>
            Settings
          </Button>
          <Button onClick={onMarkAllRead} disabled={unreadCount === 0}>
            Mark all as read
          </Button>
        </Space>
      </Space>

      {/* Tabs + Search */}
      <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
        <Tabs activeKey={tab} onChange={setTab}>
          <TabPane tab="All" key="all" />
          <TabPane tab={`Unread (${unreadCount})`} key="unread" />
          <TabPane tab="Chat" key="chat" />
          <TabPane tab="Posts" key="post" />
        </Tabs>
        <Search
          placeholder="Search notifications..."
          allowClear
          onChange={(e) => setSearch(e.target.value)}
        />
      </Space>

      {/* List group by day */}
      {Object.keys(groups).length === 0 ? (
        <Text type="secondary">No notifications.</Text>
      ) : (
        Object.entries(groups).map(([groupLabel, groupItems]) => (
          <div key={groupLabel} style={{ marginBottom: 24 }}>
            <Text strong>{groupLabel}</Text>
            <List
              itemLayout="horizontal"
              dataSource={groupItems}
              renderItem={(item) => (
                <List.Item
                  onClick={() => onClickItem(item)}
                  style={{
                    cursor: 'pointer',
                    background: item.is_read ? 'transparent' : 'rgba(24,144,255,0.06)',
                    paddingLeft: 12,
                    borderRadius: 8,
                    marginTop: 8,
                  }}
                  actions={[
                    <Dropdown key="more" overlay={menuForItem(item)} trigger={['click']}>
                      <MoreOutlined onClick={(e) => e.stopPropagation()} />
                    </Dropdown>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <div style={{ position: 'relative' }}>
                        {getIcon(item.entity_type)}
                        {!item.is_read && (
                          <span
                            style={{
                              position: 'absolute',
                              top: -2,
                              right: -2,
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: '#1890ff',
                            }}
                          />
                        )}
                      </div>
                    }
                    title={
                      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                        <span style={{ fontWeight: item.is_read ? 400 : 600 }}>
                          {item.title}
                        </span>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.timeLabel}
                        </Text>
                      </Space>
                    }
                    description={
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Text type="secondary" ellipsis>
                          {item.message}
                        </Text>
                        <Tag>{item.tagLabel}</Tag>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </div>
        ))
      )}
    </div>
  );
}
```

---

## 6. ต่อกับ GraphQL / Backend ยังไง

พอคุณมี:

* `Query myNotifications(limit, offset, filter)`
* `Mutation markNotificationRead / markAllNotificationsRead`
* `Subscription notificationCreated`

ก็:

* เปลี่ยน `mockData` → ใช้ `useQuery(Q_NOTIFICATIONS)`
* เวลาได้ `notificationCreated` จาก subscription → `cache.updateQuery` เติมเข้า list + หรือใช้ `refetch()`
* ปุ่ม `Mark all as read` / เปลี่ยนสถานะ item → call `useMutation` แทนการ setState ตรง ๆ

--- #3

โอเค เดี๋ยวผมจัดให้เป็น “ชุดเดียวกัน” เลยนะครับ:

* GraphQL typeDef ครบ `Notification` + Query/Mutation/Subscription
* Resolver ฝั่ง Node/Apollo + Postgres (ใช้ `query(...)` แบบที่คุณให้มา)
* Helper `createNotification()` ที่เอาไว้ใช้ตอน createChat / comment / follow

---

## 1. GraphQL Schema (typeDefs)

```graphql
scalar JSON

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

type Query {
  myNotifications(limit: Int, offset: Int): [Notification!]!
  myUnreadNotificationCount: Int!
}

type Mutation {
  markNotificationRead(id: ID!): Boolean!
  markAllNotificationsRead: Boolean!
}

type Subscription {
  notificationCreated: Notification!  # push real-time
}
```

> ตรง `JSON` ใช้ scalar ของ Apollo `graphql-type-json` หรือ custom scalar ตามที่คุณใช้ปัจจุบัน

---

## 2. PostgreSQL Table (ตามที่คุณมี + index แนะนำ)

```sql
-- notifications: เก็บ noti ที่ fan-out แล้วต่อ user
CREATE TABLE notifications (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL, -- คนที่จะเห็น noti
  type            TEXT NOT NULL, -- เช่น CHAT_NEW, POST_COMMENT, POST_FOLLOWED_COMMENT
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  entity_type     TEXT NOT NULL, -- 'chat' | 'post' | 'comment' | ...
  entity_id       UUID NOT NULL, -- id ของ chat/post/comment ที่เกี่ยวข้อง
  data            JSONB,         -- เก็บข้อมูลเพิ่ม เช่น { chat_id, post_id, comment_id, actor_name }
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_notification_settings: เผื่อ config ว่าอยากได้ noti อะไรบ้าง
CREATE TABLE user_notification_settings (
  user_id         UUID PRIMARY KEY,
  chat_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  post_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled   BOOLEAN NOT NULL DEFAULT FALSE -- เผื่อใช้ต่อ
);

-- แนะนำ index เพื่อให้ query เร็วขึ้น
CREATE INDEX idx_notifications_user_created_at
  ON notifications (user_id, created_at DESC);

CREATE INDEX idx_notifications_user_is_read
  ON notifications (user_id, is_read);
```

---

## 3. Resolver ฝั่ง Server (Query/Mutation/Subscription)

สมมติว่าคุณมี:

```ts
import { query } from '../db'; // wrapper pg
import { PubSub, withFilter } from 'apollo-server'; // หรือของ Apollo v4 ที่คุณใช้
import { v4 as uuidv4 } from 'uuid';

const pubsub = new PubSub();
const NOTI_TOPIC = 'NOTIFICATION_CREATED';
```

### 3.1 Query: myNotifications, myUnreadNotificationCount

```ts
const resolvers = {
  Query: {
    myNotifications: async (
      _: any,
      args: { limit?: number; offset?: number },
      ctx: any
    ) => {
      const user = ctx.user; // สมมติ auth middleware ใส่มาแล้ว
      if (!user) throw new Error('Unauthorized');

      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;

      const { rows } = await query(
        `
        SELECT
          id,
          user_id,
          type,
          title,
          message,
          entity_type,
          entity_id,
          data,
          is_read,
          created_at
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        OFFSET $3
        `,
        [user.id, limit, offset]
      );

      return rows;
    },

    myUnreadNotificationCount: async (_: any, __: any, ctx: any) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');

      const { rows } = await query(
        `
        SELECT COUNT(*)::int AS count
        FROM notifications
        WHERE user_id = $1
          AND is_read = FALSE
        `,
        [user.id]
      );

      return rows[0]?.count ?? 0;
    },
  },
```

### 3.2 Mutation: markNotificationRead, markAllNotificationsRead

```ts
  Mutation: {
    markNotificationRead: async (
      _: any,
      args: { id: string },
      ctx: any
    ) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');

      const { rows } = await query(
        `
        UPDATE notifications
        SET is_read = TRUE
        WHERE id = $1
          AND user_id = $2
        RETURNING id
        `,
        [args.id, user.id]
      );

      return rows.length > 0;
    },

    markAllNotificationsRead: async (_: any, __: any, ctx: any) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');

      await query(
        `
        UPDATE notifications
        SET is_read = TRUE
        WHERE user_id = $1
          AND is_read = FALSE
        `,
        [user.id]
      );

      return true;
    },
  },
```

### 3.3 Subscription: notificationCreated (filter ตาม user)

```ts
  Subscription: {
    notificationCreated: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(NOTI_TOPIC),
        (payload: any, _variables: any, ctx: any) => {
          const user = ctx.user;
          if (!user) return false;
          // รับเฉพาะ noti ที่ส่งให้ user นี้
          return payload.notificationCreated.user_id === user.id;
        }
      ),
    },
  },
};
```

---

## 4. Helper: createNotification() (ใช้ร่วมใน createChat / comment / follow)

อันนี้คือฟังก์ชันกลางที่ event อื่น ๆ (createChat, comment, follow) เรียกใช้:

```ts
type CreateNotificationInput = {
  user_id: string;
  type: string;
  title: string;
  message: string;
  entity_type: string; // 'chat' | 'post' | ...
  entity_id: string;
  data?: any;
};

export async function createNotification(input: CreateNotificationInput) {
  const id = uuidv4();

  const { rows } = await query(
    `
    INSERT INTO notifications (
      id,
      user_id,
      type,
      title,
      message,
      entity_type,
      entity_id,
      data
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING
      id,
      user_id,
      type,
      title,
      message,
      entity_type,
      entity_id,
      data,
      is_read,
      created_at
    `,
    [
      id,
      input.user_id,
      input.type,
      input.title,
      input.message,
      input.entity_type,
      input.entity_id,
      input.data ?? null,
    ]
  );

  const notification = rows[0];

  // broadcast ไป subscription
  await pubsub.publish(NOTI_TOPIC, {
    notificationCreated: notification,
  });

  return notification;
}
```

ตัวอย่างใช้ใน `createChat` resolver:

```ts
// ภายใน Mutation.createChat
async (_: any, args: any, ctx: any) => {
  const user = ctx.user;
  // ... logic create chat + members เสร็จแล้ว
  const chat = createdChat;
  const members = chat.members; // [{id, name}, ...]

  for (const m of members) {
    if (m.id === user.id) continue; // ไม่ต้องส่งหาตัวเอง

    await createNotification({
      user_id: m.id,
      type: 'CHAT_CREATED',
      title: chat.is_group
        ? `คุณถูกเพิ่มในกลุ่ม "${chat.name}"`
        : `เริ่มแชทใหม่กับ ${user.name}`,
      message: chat.is_group
        ? `${user.name} สร้างห้องและเพิ่มคุณเข้ากลุ่ม`
        : `${user.name} เริ่มคุยกับคุณ`,
      entity_type: 'chat',
      entity_id: chat.id,
      data: {
        chat_id: chat.id,
        chat_name: chat.name,
        is_group: chat.is_group,
        actor_id: user.id,
        actor_name: user.name,
      },
    });
  }

  return chat;
}
```

---

## 5. Binding รูปแบบเดียวกับที่คุณใช้ตอนนี้

ถ้าคุณชอบเขียน resolver แบบ:

```ts
myNotifications: async (_:any, args:any, ctx:any) => {
  const { rows } = await query(
    `SELECT ...`,
    [ctx.user.id, args.limit ?? 20, args.offset ?? 0]
  );
  return rows;
}
```

คุณสามารถเอา snippet ด้านบนไปปรับได้ตรง ๆ แทบไม่ต้องคิดเพิ่มครับ แก้แค่ชื่อไฟล์ `db/query`, `ctx.user` ตามโครงโปรเจกต์จริงของคุณ

---


ได้เลย เดี๋ยวผมเอาโค้ด `createChat` ตัวจริงของคุณมารวมกับ logic สร้าง notification ให้เรียบร้อย ใช้ `createNotification(...)` หลังจาก transaction เสร็จ (ปลอดภัยกว่า กรณี transaction rollback noti จะไม่หลุด)

ด้านล่างนี้คือเวอร์ชัน “รวมแล้ว” 👇

```ts
import { createNotification } from '../notifications/service'; // ปรับ path ตามโปรเจกต์จริง

createChat: async (
  _: any,
  { name, isGroup, memberIds }: { name?: string; isGroup: boolean; memberIds: string[] },
  ctx: any
) => {
  const author_id = requireAuth(ctx);
  console.log("[Mutation] createChat :", author_id);

  // ✅ 1) รันทุกอย่างใน transaction (สร้าง chat + members + log)
  const result = await runInTransaction(author_id, async (client) => {
    // 1) สร้าง chat ใหม่
    const { rows } = await client.query(
      `INSERT INTO chats (name, is_group, created_by)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [name || null, isGroup, author_id]
    );
    const chat = rows[0];

    // 2) เพิ่มสมาชิกทั้งหมด (รวม creator)
    const allMembers = Array.from(new Set([author_id, ...memberIds]));
    for (const uid of allMembers) {
      await client.query(
        `INSERT INTO chat_members (chat_id, user_id)
         VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [chat.id, uid]
      );
    }

    // 3) ดึงข้อมูลสมาชิกและผู้สร้าง
    const mem = await client.query(
      `SELECT u.* 
         FROM chat_members m
         JOIN users u ON m.user_id = u.id
        WHERE m.chat_id = $1`,
      [chat.id]
    );
    const creator = await client.query(
      `SELECT * FROM users WHERE id = $1`,
      [chat.created_by]
    );

    // 4) บันทึก log
    await addLog('info', 'chat-create', 'Chat created', {
      chatId: chat.id,
      userId: author_id,
      members: allMembers.length,
    });

    // 5) คืนค่าผลลัพธ์ (ใช้เป็น response และใช้สร้าง noti ต่อ)
    return {
      ...chat,                 // id, name, is_group, created_by (เป็น uuid จาก table)
      created_by: creator.rows[0], // override ให้ field created_by เป็น object user (ตามที่คุณใช้ใน GraphQL)
      members: mem.rows,       // [{ id, name, ... }]
    };
  });

  // ✅ 2) สร้าง Notification ให้สมาชิกคนอื่น (อยู่นอก transaction → ไม่โดน rollback ถ้า noti พลาด)
  const chat = result; // แค่ rename ให้สั้น
  const creatorUser = chat.created_by; // user object
  const members = chat.members as any[];

  // member คนอื่นที่ไม่ใช่คนสร้าง
  const recipients = members.filter((m: any) => m.id !== author_id);

  await Promise.all(
    recipients.map((m: any) =>
      createNotification({
        user_id: m.id,
        type: 'CHAT_CREATED',
        title: chat.is_group
          ? `คุณถูกเพิ่มในกลุ่ม "${chat.name || ''}"`
          : `เริ่มแชทใหม่กับ ${creatorUser.name}`,
        message: chat.is_group
          ? `${creatorUser.name} สร้างห้องและเพิ่มคุณเข้ากลุ่ม`
          : `${creatorUser.name} เริ่มคุยกับคุณ`,
        entity_type: 'chat',
        entity_id: chat.id,
        data: {
          chat_id: chat.id,
          chat_name: chat.name,
          is_group: chat.is_group,
          actor_id: creatorUser.id,
          actor_name: creatorUser.name,
        },
      })
    )
  );

  // ✅ 3) คืนค่า chat ตามเดิม (เดิมคุณ return object นี้อยู่แล้ว)
  return chat;
},
```

### อธิบายสั้น ๆ ว่าปรับอะไร

1. ใช้ `runInTransaction(...)` เหมือนเดิมเลย ไม่แตะ logic เดิมของคุณ
2. หลัง transaction เสร็จ → เราใช้ `result` (ที่มี `members` + `created_by`)
3. ทำ `recipients = members.filter(m.id !== author_id)`
4. ยิง `createNotification(...)` ด้วยข้อมูล:

   * `type: 'CHAT_CREATED'`
   * แยกข้อความกรณี group / 1:1 เหมือนโค้ดเดิมของคุณ
   * `entity_type: 'chat'`, `entity_id: chat.id`
   * `data` เก็บ `chat_id`, `chat_name`, `is_group`, `actor` ฯลฯ
5. ใช้ `Promise.all` เพื่อรัน parallel หลาย noti
