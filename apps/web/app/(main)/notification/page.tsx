'use client';

import { useState, useMemo, useEffect } from 'react';
import { gql, useQuery, useMutation } from '@apollo/client';
import {
  List,
  Tabs,
  Badge,
  Button,
  Typography,
  Tag,
  Input,
  Dropdown,
  Menu,
  Space,
  Spin,
  Alert,
} from 'antd';
import {
  BellOutlined,
  MessageOutlined,
  FileTextOutlined,
  MoreOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useI18n } from '@/lib/i18nContext';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const { Title, Text } = Typography;
const { TabPane } = Tabs;
const { Search } = Input;

/* =====================
 * GraphQL
 * ===================== */

const Q_NOTIFICATIONS = gql`
  query MyNotifications($limit: Int, $offset: Int) {
    myNotifications(limit: $limit, offset: $offset) {
      id
      type
      entity_type
      title
      message
      is_read
      created_at
    }
  }
`;

const Q_UNREAD_COUNT = gql`
  query MyUnreadNotificationCount {
    myUnreadNotificationCount
  }
`;

const MUT_MARK_READ = gql`
  mutation MarkNotificationRead($id: ID!) {
    markNotificationRead(id: $id)
  }
`;

const MUT_MARK_ALL_READ = gql`
  mutation MarkAllNotificationsRead {
    markAllNotificationsRead
  }
`;

/* =====================
 * Types
 * ===================== */

type GqlNotification = {
  id: string;
  type: string;
  entity_type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

type NotificationItem = {
  id: string;
  type: string; // CHAT_CREATED, POST_COMMENT, ...
  entity_type: string; // 'chat' | 'post' | 'system'
  title: string;
  message: string;
  is_read: boolean;
  created_at: string; // ISO string
  tagLabel: string; // แสดงใน Tag เช่น 'Chat', 'Post'
  timeLabel: string; // เช่น '5m ago'
  groupLabel: string; // Today | Yesterday | Earlier
};

/* =====================
 * Helpers
 * ===================== */

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

function getTagLabel(entity_type: string, type: string, t: Translate): string {
  if (entity_type === 'chat') return t('notificationPage.tagChat');
  if (entity_type === 'post') return t('notificationPage.tagPost');
  if (type.startsWith('SYSTEM_')) return t('notificationPage.tagSystem');
  return t('notificationPage.tagGeneral');
}

function getTimeLabel(created_at: string | number, t: Translate): string {
  // Normalise input: convert string → number if looks like timestamp
  let created: Date;

  if (typeof created_at === "number") {
    // Already timestamp (ms)
    created = new Date(created_at);
  } else if (/^\d+$/.test(created_at)) {
    // Numeric string timestamp → convert to number
    created = new Date(parseInt(created_at, 10));
  } else {
    // ISO string
    created = new Date(created_at);
  }

  if (isNaN(created.getTime())) return "Invalid date";

  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return t('notificationPage.timeJustNow');
  if (diffMin < 60) return t('notificationPage.timeMinutesAgo', { n: diffMin });
  if (diffHour < 24) return t('notificationPage.timeHoursAgo', { n: diffHour });
  if (diffDay < 7) return t('notificationPage.timeDaysAgo', { n: diffDay });
  return created.toLocaleDateString();
}

function getGroupLabel(created_at: string | number, t: Translate): string {
  // 1) รองรับ timestamp (number หรือ string)
  const d = new Date(typeof created_at === 'number' ? created_at : Number(created_at) || created_at);

  if (isNaN(d.getTime())) return t('notificationPage.groupUnknown');

  const now = new Date();

  // 2) normalize ให้เป็น 00:00 ของวัน (แก้ timezone)
  const createdDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 3) คำนวณ diff เป็นจำนวนวันจริง
  const diffMs = today.getTime() - createdDay.getTime();
  const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDay < 0) return t('notificationPage.groupFuture');       // กันกรณี timestamp คลาด
  if (diffDay === 0) return t('notificationPage.groupToday');
  if (diffDay === 1) return t('notificationPage.groupYesterday');
  if (diffDay <= 7) return t('notificationPage.groupThisWeek');

  return t('notificationPage.groupEarlier');
}

function mapNotificationToItem(n: GqlNotification, t: Translate): NotificationItem {
  return {
    ...n,
    tagLabel: getTagLabel(n.entity_type, n.type, t),
    timeLabel: getTimeLabel(n.created_at, t),
    groupLabel: getGroupLabel(n.created_at, t),
  };
}

/* =====================
 * Component
 * ===================== */

export default function NotificationPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  const limit = 50;
  const offset = 0;

  const {
    data,
    loading,
    error,
    refetch: refetchNotifications,
  } = useQuery(Q_NOTIFICATIONS, {
    variables: { limit, offset },
    fetchPolicy: 'cache-and-network',
  });

  const {
    data: unreadData,
    refetch: refetchUnreadCount,
  } = useQuery(Q_UNREAD_COUNT, {
    fetchPolicy: 'cache-and-network',
  });

  const [markReadMutation] = useMutation(MUT_MARK_READ);
  const [markAllReadMutation] = useMutation(MUT_MARK_ALL_READ);

  const rawNotifications: GqlNotification[] = data?.myNotifications ?? [];

  const items: NotificationItem[] = useMemo(
    () => rawNotifications.map((n) => mapNotificationToItem(n, t)),
    [rawNotifications, t]
  );

  const backendUnreadCount = unreadData?.myUnreadNotificationCount ?? 0;

  const filtered = items.filter((item) => {
    if (tab === 'unread' && item.is_read) return false;
    if (tab === 'chat' && item.entity_type !== 'chat') return false;
    if (tab === 'post' && item.entity_type !== 'post') return false;
    if (
      search &&
      !`${item.title} ${item.message}`.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });

  // group by groupLabel
  const groups = filtered.reduce<Record<string, NotificationItem[]>>((acc, item) => {
    acc[item.groupLabel] = acc[item.groupLabel] || [];
    acc[item.groupLabel].push(item);
    return acc;
  }, {});

  useEffect(()=>{
    console.log("notification =", data);
  }, [data]);

  const alsoRefetch = async () => {
    await Promise.all([refetchNotifications(), refetchUnreadCount()]);
  };

  const onMarkAllRead = async () => {
    try {
      await markAllReadMutation();
      await alsoRefetch();
    } catch (e) {
      console.error('markAllNotificationsRead error', e);
    }
  };

  const onMarkSingleRead = async (id: string, is_read: boolean) => {
    if (is_read) return; // ถ้าอ่านแล้ว ไม่ต้องยิง

    try {
      await markReadMutation({ variables: { id } });
      await alsoRefetch();
    } catch (e) {
      console.error('markNotificationRead error', e);
    }
  };

  const onClickItem = (item: NotificationItem) => {
    onMarkSingleRead(item.id, item.is_read);
    // TODO: navigate to /chat/[id] หรือ /post/[id] ตาม entity_type + entity_id (ต้องขอมาเพิ่มใน GraphQL)
  };

  const menuForItem = (item: NotificationItem) => (
    <Menu
      items={[
        {
          key: 'read',
          label: item.is_read ? t('notificationPage.markAsUnread') : t('notificationPage.markAsRead'),
          onClick: () => {
            if (!item.is_read) {
              onMarkSingleRead(item.id, item.is_read);
            }
            // ถ้าต้องการ support "mark as unread" ฝั่ง backend เพิ่ม field/mutation เพิ่มได้ภายหลัง
          },
        },
        {
          key: 'delete',
          danger: true,
          label: t('notificationPage.deleteTodo'),
          onClick: () => {
            // ถ้าต้องการลบจริง ให้เพิ่ม mutation deleteNotification ก่อน
            console.log('TODO: delete notification', item.id);
          },
        },
      ]}
    />
  );

  return (
    <div style={{ margin: '0 auto', padding: '24px' }}>
      {/* Header */}
      <Space
        style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}
      >
        <Space>
          <Title level={3} style={{ margin: 0 }}>
            {t('notificationPage.title')}
          </Title>
          {backendUnreadCount > 0 && <Badge count={backendUnreadCount} />}
        </Space>
        <Space>
          <Button type="link" icon={<SettingOutlined />}>
            {t('notificationPage.settings')}
          </Button>
          <Button onClick={onMarkAllRead} disabled={backendUnreadCount === 0}>
            {t('notificationPage.markAllRead')}
          </Button>
        </Space>
      </Space>

      {/* Tabs + Search */}
      <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
        <Tabs activeKey={tab} onChange={setTab}>
          <TabPane tab={t('notificationPage.tabAll')} key="all" />
          <TabPane
            tab={`${t('notificationPage.unreadLabel')} (${backendUnreadCount})`}
            key="unread"
          />
          <TabPane tab={t('notificationPage.tabChat')} key="chat" />
          <TabPane tab={t('notificationPage.tabPosts')} key="post" />
        </Tabs>
        <Search
          placeholder={t('notificationPage.searchPlaceholder')}
          allowClear
          onChange={(e) => setSearch(e.target.value)}
        />
      </Space>

      {/* Loading / Error */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Spin />
        </div>
      )}

      {error && (
        <Alert
          type="error"
          message={t('notificationPage.loadFailedTitle')}
          description={error.message}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* List group by day */}
      {!loading && !error && Object.keys(groups).length === 0 ? (
        <Text type="secondary">{t('notificationPage.empty')}</Text>
      ) : (
        Object.entries(groups).map(([groupLabel, groupItems]) => (
          <div key={groupLabel} style={{ marginBottom: 24 }}>
            <Text strong>{groupLabel}</Text>
            <List
              itemLayout="horizontal"
              dataSource={groupItems}
              renderItem={(item) => {
                console.log("[renderItem] = ", item);
                return  <List.Item
                          onClick={() => onClickItem(item)}
                          style={{
                            cursor: 'pointer',
                            background: item.is_read ? 'transparent' : 'rgba(24,144,255,0.06)',
                            paddingLeft: 12,
                            borderRadius: 8,
                            marginTop: 8,
                          }}
                          actions={[
                            <Dropdown
                              key="more"
                              overlay={menuForItem(item)}
                              trigger={['click']}
                            >
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
                              <Space
                                style={{ justifyContent: 'space-between', width: '100%' }}
                              >
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
                  }
              }
            />
          </div>
        ))
      )}
    </div>
  );
}
