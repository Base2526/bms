'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Layout,
  Menu,
  Card,
  Form,
  Input,
  Button,
  Upload,
  Avatar,
  Select,
  Switch,
  message,
  Space,
  Divider,
  List,
  Popconfirm,
  Tag,
  Table,
  Tooltip,
  Drawer,
  Grid,
  Row,
  Col,
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  CloudUploadOutlined,
  FileOutlined,
  DeleteOutlined,
  EditOutlined,
  DownloadOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  TeamOutlined,
  ArrowLeftOutlined,
  BookOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import { gql, useQuery, useMutation } from '@apollo/client';
import Link from 'next/link';
import BookmarkButton from '@/components/BookmarkButton';
import { useSessionCtx } from '@/lib/session-context';
import { useTheme } from '@/lib/useTheme';
import type { ThemeMode } from '@/lib/theme';
import { useRouter } from 'next/navigation';
import { getLangCookie, setLangCookie, isLang } from '@/lib/lang';
import { useI18n } from '@/lib/i18nContext';

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

type MenuKey = 'profile' | 'security' | 'posts' | 'bookmarks' | 'users' | 'files' | 'logs';

type FileRow = {
  id: number;
  filename: string;
  original_name: string | null;
  mimetype: string | null;
  size: number;
  checksum: string;
  relpath: string;
  created_at: string;
  updated_at: string;
};

type LogRow = {
  id: number;
  level: 'debug' | 'info' | 'warn' | 'error' | string;
  category: string;
  message: string;
  meta: any;
  created_by: number | null;
  created_at: string;
};

/* ================= GraphQL ================= */

// Users
const Q_USERS = gql`query($search:String){ users(search:$search){ id name email phone role created_at avatar } }`;
const Q_USER  = gql`query($id:ID!){ user(id:$id){ id name email phone avatar role } }`;
const M_DELETE_USER = gql`mutation($id:ID!){ deleteUser(id:$id) }`;
const M_UPSERT_USER = gql`mutation($id:ID, $data:UserInput!){ upsertUser(id:$id, data:$data){ id } }`;

// Upload Avatar
const M_UPLOAD_AVATAR = gql`
mutation($user_id:ID!, $file:Upload!){
  uploadAvatar(user_id:$user_id, file:$file)
}
`;

// My Bookmarks
const Q_MY_BOOKMARKS = gql`
  query MyBookmarks {
    myBookmarks {
      id
      title
      status
      created_at
      author { id name }
      images { id url }
      is_bookmarked
    }
  }
`;

// Me
const Q_ME = gql`
  query {
    me {
      id
      name
      email
      phone
      username
      language
      themePreference
      notifications_enabled
      role
      avatar
      created_at
    }
  }
`;

const M_UPDATE_ME = gql`
  mutation($data: MeInput!) {
    updateMe(data: $data) {
      id
      name
      email
      phone
      username
      language
      themePreference
      notifications_enabled
      avatar
    }
  }
`;

async function sha256Hex(input: string) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ================= REST helpers (Files/Logs) ================= */

async function fetchList(q: string, page: number, pageSize: number) {
  const url = `/api/files?q=${encodeURIComponent(q)}&page=${page}&pageSize=${pageSize}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
}

async function fetchLogs(params: { q?: string; level?: string; category?: string; page: number; pageSize: number }) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.level) qs.set('level', params.level);
  if (params.category) qs.set('category', params.category);
  qs.set('page', String(params.page));
  qs.set('pageSize', String(params.pageSize));
  const res = await fetch('/api/logs?' + qs.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load logs');
  return res.json();
}

/* ================= small UI helpers ================= */

function useResponsiveShell() {
  const screens = useBreakpoint();
  const isMobile = !screens.lg; // < lg
  const contentPadding = isMobile ? 12 : 20;
  const cardMaxWidth = isMobile ? '100%' : 980;

  return { screens, isMobile, contentPadding, cardMaxWidth };
}

function PanelWrap({
  title,
  extra,
  children,
  loading,
  maxWidth,
}: {
  title: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  loading?: boolean;
  maxWidth: number | string;
}) {
  return (
    <div style={{ width: '100%' }}>
      <Card
        title={title}
        extra={extra}
        loading={loading}
        style={{
          width: '100%',
          maxWidth,
          margin: '0 auto',
        }}
      >
        {children}
      </Card>
    </div>
  );
}

function isImage(m?: string | null) {
  return !!m && m.toLowerCase().startsWith('image/');
}
function fmtSize(n: number) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
function levelTag(level: string) {
  const color = level === 'error' ? 'red' : level === 'warn' ? 'orange' : level === 'info' ? 'blue' : 'default';
  return <Tag color={color}>{level}</Tag>;
}

/* ================= Users (หลังบ้าน) ================= */

function UsersPanel() {
  const [mode, setMode] = useState<'list' | 'new' | 'edit'>('list');
  const [editId, setEditId] = useState<string>('');

  return (
    <div>
      {mode === 'list' && (
        <UsersList
          onNew={() => setMode('new')}
          onEdit={(id) => {
            setEditId(id);
            setMode('edit');
          }}
        />
      )}
      {mode === 'new' && <UserFormNew onBack={() => setMode('list')} />}
      {mode === 'edit' && <UserFormEdit id={editId} onBack={() => setMode('list')} />}
    </div>
  );
}

function UsersList({ onNew, onEdit }: { onNew: () => void; onEdit: (id: string) => void }) {
  const { isMobile, cardMaxWidth } = useResponsiveShell();
  const { data, refetch } = useQuery(Q_USERS, { variables: { search: '' } });
  const [doDelete] = useMutation(M_DELETE_USER);

  const cols = useMemo(
    () => [
      { title: 'Name', dataIndex: 'name', responsive: ['xs', 'sm', 'md', 'lg'] as any },
      { title: 'Email', dataIndex: 'email', responsive: ['md', 'lg'] as any },
      { title: 'Phone', dataIndex: 'phone', responsive: ['sm', 'md', 'lg'] as any },
      { title: 'Role', dataIndex: 'role', render: (r: string) => <Tag>{r}</Tag> },
      {
        title: 'Actions',
        fixed: isMobile ? undefined : ('right' as const),
        render: (_: any, r: any) => (
          <Space wrap>
            <a onClick={() => onEdit(String(r.id))}>edit</a>
            <Popconfirm
              title="Delete this user?"
              onConfirm={async () => {
                const res = await doDelete({ variables: { id: r.id } });
                if (res.data?.deleteUser) {
                  message.success('Deleted');
                  refetch();
                } else {
                  message.error('Delete failed');
                }
              }}
            >
              <a>delete</a>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [doDelete, onEdit, refetch, isMobile]
  );

  return (
    <PanelWrap
      title="Users"
      maxWidth={cardMaxWidth}
      extra={
        <Space wrap>
          <Input.Search
            placeholder="Search name/email/phone"
            onSearch={(q) => refetch({ search: q })}
            allowClear
            enterButton
            style={{ width: isMobile ? 220 : 320 }}
          />
          <Button type="primary" onClick={onNew}>
            + New User
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        dataSource={data?.users || []}
        columns={cols as any}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
      />
    </PanelWrap>
  );
}

function UserFormNew({ onBack }: { onBack: () => void }) {
  const { cardMaxWidth } = useResponsiveShell();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [upsert] = useMutation(M_UPSERT_USER);

  async function onFinish(values: any) {
    try {
      setLoading(true);
      const { name, email, phone, avatar, role, password } = values;
      const data: any = { name, email, phone, avatar, role };
      if (password) data.password_hash = await sha256Hex(password);

      const res = await upsert({ variables: { data } });
      if (res.data?.upsertUser?.id) {
        message.success('User created');
        onBack();
      } else {
        message.error('Create failed');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <PanelWrap
      title={
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack} />
          <span>New User</span>
        </Space>
      }
      maxWidth={cardMaxWidth}
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="name" label="Name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="phone" label="Phone">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="avatar" label="Avatar URL">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="role" label="Role" initialValue="Subscriber" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'Subscriber', label: 'Subscriber' },
                  { value: 'Author', label: 'Author' },
                  { value: 'Administrator', label: 'Administrator' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="password" label="Password" rules={[{ required: true, min: 8 }]}>
              <Input.Password />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="confirm"
              label="Confirm Password"
              dependencies={['password']}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator(_, v) {
                    if (!v || getFieldValue('password') === v) return Promise.resolve();
                    return Promise.reject(new Error('Passwords do not match'));
                  },
                }),
              ]}
            >
              <Input.Password />
            </Form.Item>
          </Col>
        </Row>

        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            Back
          </Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            Create
          </Button>
        </Space>
      </Form>
    </PanelWrap>
  );
}

function UserFormEdit({ id, onBack }: { id: string; onBack: () => void }) {
  const { cardMaxWidth } = useResponsiveShell();
  const [form] = Form.useForm();
  const { data } = useQuery(Q_USER, { variables: { id } });
  const [upsert] = useMutation(M_UPSERT_USER);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const u = data?.user;
    if (u) form.setFieldsValue({ name: u.name, email: u.email, phone: u.phone, avatar: u.avatar, role: u.role });
  }, [data, form]);

  async function onFinish(values: any) {
    try {
      setLoading(true);
      const { name, phone, avatar, role, password } = values;
      const payload: any = { name, phone, avatar, role };
      if (password) payload.password_hash = await sha256Hex(password);

      const res = await upsert({ variables: { id, data: payload } });
      if (res.data?.upsertUser?.id) {
        message.success('Saved');
        onBack();
      } else {
        message.error('Save failed');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <PanelWrap
      title={
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack} />
          <span>Edit User</span>
        </Space>
      }
      maxWidth={cardMaxWidth}
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="name" label="Name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
              <Input disabled />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="phone" label="Phone">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="avatar" label="Avatar URL">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="role" label="Role" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'Subscriber', label: 'Subscriber' },
                  { value: 'Author', label: 'Author' },
                  { value: 'Administrator', label: 'Administrator' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="password" label="New Password" tooltip="Fill in only if you want to change it">
              <Input.Password />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="confirm"
              label="Confirm New Password"
              dependencies={['password']}
              rules={[
                ({ getFieldValue }) => ({
                  validator(_, v) {
                    if (!getFieldValue('password') || getFieldValue('password') === v) return Promise.resolve();
                    return Promise.reject(new Error('Passwords do not match'));
                  },
                }),
              ]}
            >
              <Input.Password />
            </Form.Item>
          </Col>
        </Row>

        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            Back
          </Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            Save
          </Button>
        </Space>
      </Form>
    </PanelWrap>
  );
}

/* ================= My Posts (Responsive) ================= */

const Q_MY_POSTS = gql`query($q:String){ myPosts(search:$q){ id title detail status created_at } }`;
const MUT_DEL_POST = gql`mutation($id:ID!){ deletePost(id:$id) }`;

function PostsPanel() {
  const { t } = useI18n();
  const { isMobile, cardMaxWidth } = useResponsiveShell();
  const [q, setQ] = useState('');
  const { data, refetch, loading } = useQuery(Q_MY_POSTS, { variables: { q: '' } });
  const [deletePost, { loading: deleting }] = useMutation(MUT_DEL_POST);

  const rows = data?.myPosts || [];

  const handleDelete = async (id: string) => {
    try {
      const { data: res } = await deletePost({ variables: { id } });
      if (res?.deletePost) {
        message.success(t('settingsPage.deleted'));
        refetch();
      } else {
        message.warning(t('settingsPage.delete_failed'));
      }
    } catch (err: any) {
      message.error(err?.message || t('settingsPage.delete_error'));
    }
  };

  // ✅ Desktop/table columns (mobile จะใช้ List แทน)
  const cols = useMemo(
    () => [
      {
        title: t('settingsPage.col_title'),
        dataIndex: 'title',
        width: 260,
        ellipsis: true,
        render: (_: any, r: any) => <Link href={`/post/${r.id}`}>{r.title}</Link>,
      },
      {
        title: t('settingsPage.col_detail'),
        dataIndex: 'detail',
        width: 420,
        ellipsis: true,
        responsive: ['md', 'lg'] as any,
      },
      {
        title: t('settingsPage.col_status'),
        dataIndex: 'status',
        width: 120,
        render: (s: string) => <Tag color={s === 'public' ? 'green' : 'red'}>{s}</Tag>,
      },
      {
        title: t('settingsPage.col_created'),
        dataIndex: 'created_at',
        width: 180,
        responsive: ['lg'] as any,
        render: (v: string) => new Date(v).toLocaleString(),
      },
      {
        title: t('settingsPage.col_action'),
        width: 120,
        fixed: 'right' as const,
        render: (_: any, r: any) => (
          <Space>
            <Tooltip title={t('settingsPage.edit')}>
              <Link href={`/post/${r.id}/edit`} prefetch={false}>
                <Button type="text" size="small" icon={<EditOutlined />} />
              </Link>
            </Tooltip>
            <Popconfirm
              title={t('settingsPage.confirm_delete')}
              okText={t('settingsPage.yes')}
              cancelText={t('settingsPage.no')}
              onConfirm={() => handleDelete(r.id)}
            >
              <Tooltip title={t('settingsPage.delete')}>
                <Button type="text" size="small" danger loading={deleting} icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [deleting, t]
  );

  return (
    <PanelWrap
      title={t('settingsPage.posts_title')}
      maxWidth={cardMaxWidth}
      extra={
        <Space wrap>
          <Input
            placeholder={t('settingsPage.posts_search_placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: isMobile ? 200 : 260 }}
          />
          <Button onClick={() => refetch({ q })}>{t('settingsPage.posts_search')}</Button>
          <Button type="primary">
            <a href="/post/new" style={{ color: 'inherit' }}>
              {t('settingsPage.posts_new')}
            </a>
          </Button>
        </Space>
      }
    >
      {/* ✅ Mobile = List cards (responsive จริง) */}
      {isMobile ? (
        <List
          loading={loading}
          dataSource={rows}
          rowKey={(r: any) => String(r.id)}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          renderItem={(r: any) => (
            <List.Item
              actions={[
                <Link key="edit" href={`/post/${r.id}/edit`} prefetch={false}>
                  <Button size="small" icon={<EditOutlined />}>{t('settingsPage.edit')}</Button>
                </Link>,
                <Popconfirm key="del" title={t('settingsPage.confirm_delete')} onConfirm={() => handleDelete(r.id)}>
                  <Button size="small" danger loading={deleting} icon={<DeleteOutlined />}>
                    {t('settingsPage.delete')}
                  </Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={<Link href={`/post/${r.id}`}>{r.title}</Link>}
                description={
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <div style={{ color: 'rgba(var(--app-text-rgb),0.72)' }}>
                      {(r.detail || '').slice(0, 120)}
                      {(r.detail || '').length > 120 ? '…' : ''}
                    </div>
                    <Space wrap>
                      <Tag color={r.status === 'public' ? 'green' : 'red'}>{r.status}</Tag>
                      <span style={{ color: 'rgba(var(--app-text-rgb),0.55)' }}>
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                    </Space>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      ) : (
        // ✅ Desktop = Table + scroll
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={cols as any}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 'max-content' }}
        />
      )}
    </PanelWrap>
  );
}


/* ================= Files ================= */

function FilesPanel() {
  const { cardMaxWidth } = useResponsiveShell();
  const [q, setQ] = useState('');
  const [data, setData] = useState<FileRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchList(q, page, pageSize);
      setData(res.items);
      setTotal(res.total);
    } catch (e: any) {
      message.error(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, page, pageSize]);

  function onUploaded(info: any) {
    if (info.file.status === 'done') { message.success('Uploaded'); load(); }
    else if (info.file.status === 'error') { message.error('Upload failed'); }
  }

  async function delFile(id: number) {
    const res = await fetch(`/api/files/${id}`, { method: 'DELETE' });
    if (res.ok) { message.success('Deleted'); load(); } else { message.error('Delete failed'); }
  }
  async function renameFile(r: FileRow) {
    const name = prompt('Rename to:', r.filename);
    if (!name) return;
    const res = await fetch(`/api/files/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) { message.success('Renamed'); load(); } else { message.error('Rename failed'); }
  }

  return (
    <PanelWrap
      title="Files"
      maxWidth={cardMaxWidth}
      extra={
        <Space wrap>
          <Input.Search placeholder="Search name" onSearch={setQ} allowClear enterButton style={{ width: 240 }} />
          <Upload name="file" action="/api/files" onChange={onUploaded} showUploadList={false}>
            <Button icon={<CloudUploadOutlined />}>Upload</Button>
          </Upload>
        </Space>
      }
    >
      <List
        loading={loading}
        itemLayout="horizontal"
        dataSource={data}
        rowKey={(x) => String(x.id)}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        renderItem={(item) => {
          const thumbSrc = isImage(item.mimetype) ? `/api/files/${item.id}` : undefined;
          return (
            <List.Item
              actions={[
                <a key="dl" href={`/api/files/${item.id}?dl=1`}><DownloadOutlined /> Download</a>,
                <a key="ed" onClick={() => renameFile(item)}><EditOutlined /> Rename</a>,
                <Popconfirm key="rm" title="Delete this file?" onConfirm={() => delFile(item.id)}>
                  <a><DeleteOutlined /> Delete</a>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                avatar={
                  thumbSrc ? (
                    <img
                      src={thumbSrc}
                      alt={item.original_name || item.filename}
                      style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }}
                    />
                  ) : (
                    <Avatar shape="square" size={56} icon={<FileOutlined />} />
                  )
                }
                title={
                  <Space split={<Divider type="vertical" />} wrap>
                    <span style={{ wordBreak: 'break-word' }}>{item.original_name || item.filename}</span>
                    {isImage(item.mimetype) && <Tag>image</Tag>}
                    {!!item.mimetype && !isImage(item.mimetype) && <Tag>{item.mimetype}</Tag>}
                  </Space>
                }
                description={
                  <Space size="small" wrap>
                    <span>{fmtSize(item.size)}</span>
                    <span>•</span>
                    <span>{new Date(item.created_at).toLocaleString()}</span>
                  </Space>
                }
              />
            </List.Item>
          );
        }}
      />
    </PanelWrap>
  );
}

/* ================= Logs ================= */

function LogsPanel() {
  const { cardMaxWidth } = useResponsiveShell();
  const [q, setQ] = useState('');
  const [level, setLevel] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [data, setData] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchLogs({ q, level, category, page, pageSize });
      setData(res.items);
      setTotal(res.total);
    } catch (e: any) {
      message.error(e.message || 'Load logs failed');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, level, category, page, pageSize]);

  async function addTest() {
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'info', category: 'settings', message: 'Test log from Settings > Logs' }),
    });
    if (res.ok) { message.success('Created'); load(); } else { message.error('Create failed'); }
  }

  async function purgeByFilter() {
    const qs = new URLSearchParams();
    if (level) qs.set('level', level);
    if (category) qs.set('category', category);
    if (q) qs.set('q', q);
    const res = await fetch('/api/logs?' + qs.toString(), { method: 'DELETE' });
    const j = await res.json();
    if (res.ok) { message.success(`Deleted ${j.deleted} logs`); load(); } else { message.error(j.error || 'Purge failed'); }
  }

  return (
    <PanelWrap
      title="System Logs"
      maxWidth={cardMaxWidth}
      extra={
        <Space wrap>
          <Input.Search placeholder="Search text" onSearch={setQ} allowClear enterButton style={{ width: 220 }} />
          <Select
            allowClear
            placeholder="Level"
            style={{ width: 140 }}
            onChange={setLevel}
            options={['debug', 'info', 'warn', 'error'].map((v) => ({ value: v, label: v }))}
          />
          <Input
            placeholder="Category"
            allowClear
            style={{ width: 180 }}
            onChange={(e) => setCategory(e.target.value || undefined)}
          />
          <Button onClick={addTest}>Add test</Button>
          <Popconfirm title="Delete logs by current filters?" onConfirm={purgeByFilter}>
            <Button danger>Purge by filter</Button>
          </Popconfirm>
        </Space>
      }
    >
      <List
        loading={loading}
        itemLayout="vertical"
        dataSource={data}
        rowKey={(x) => String(x.id)}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => { setPage(p); setPageSize(ps || 50); },
        }}
        renderItem={(item) => (
          <List.Item
            key={item.id}
            actions={[
              <span key="time">{new Date(item.created_at).toLocaleString()}</span>,
              <span key="cat"><Tag>{item.category}</Tag></span>,
            ]}
          >
            <List.Item.Meta
              avatar={levelTag(item.level)}
              title={
                <Space split={<Divider type="vertical" />} wrap>
                  <span>#{item.id}</span>
                  <strong style={{ wordBreak: 'break-word' }}>{item.message}</strong>
                </Space>
              }
              description={
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0, overflowX: 'auto' }}>
                  {JSON.stringify(item.meta || {}, null, 2)}
                </pre>
              }
            />
          </List.Item>
        )}
      />
    </PanelWrap>
  );
}

/* ================= MyBookmarks ================= */

function MyBookmarksPanel() {
  const { t } = useI18n();
  const { cardMaxWidth, isMobile } = useResponsiveShell();
  const { data, loading, refetch } = useQuery(Q_MY_BOOKMARKS);

  const cols = useMemo(
    () => [
      {
        title: t('settingsPage.col_title'),
        dataIndex: 'title',
        render: (_: any, r: any) => (
          <Space>
            <Link href={`/post/${r.id}`}>{r.title}</Link>
          </Space>
        ),
      },
      { title: t('settingsPage.col_status'), dataIndex: 'status', render: (s: string) => <Tag color={s === 'public' ? 'green' : 'red'}>{s}</Tag>, responsive: ['sm', 'md', 'lg'] as any },
      { title: t('settingsPage.col_author'), dataIndex: ['author', 'name'], responsive: ['md', 'lg'] as any },
      {
        title: t('settingsPage.col_action'),
        fixed: isMobile ? undefined : ('right' as const),
        render: (_: any, r: any) => <BookmarkButton postId={r.id} defaultBookmarked={r?.is_bookmarked ?? false} />,
      },
    ],
    [isMobile, t]
  );

  return (
    <PanelWrap
      title={t('settingsPage.bookmarks_title')}
      maxWidth={cardMaxWidth}
      extra={<Button onClick={() => refetch()}>{t('settingsPage.refresh')}</Button>}
    >
      <Table
        rowKey="id"
        dataSource={data?.myBookmarks || []}
        columns={cols as any}
        loading={loading}
        scroll={{ x: 'max-content' }}
      />
    </PanelWrap>
  );
}

/* ================= Main Settings Page (Responsive Shell) ================= */

export default function SettingsPage() {
  const { t } = useI18n();
  const { isMobile, contentPadding, cardMaxWidth } = useResponsiveShell();

  const [active, setActive] = useState<MenuKey>('profile');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string>('');

  const [uploadAvatar] = useMutation(M_UPLOAD_AVATAR);
  const [updateMe, { loading: updatingMe }] = useMutation(M_UPDATE_ME);
  const [savingNotifications, setSavingNotifications] = useState(false);

  const { user } = useSessionCtx();
  const { setTheme } = useTheme();
  const router = useRouter();
  const { data: meData, loading: meLoading, refetch: refetchMe } = useQuery(Q_ME);
  const me = meData?.me;

  // profile form
  const [formProfile] = Form.useForm();
  useEffect(() => {
    if (!me) return;
    formProfile.setFieldsValue({
      name: me.name ?? '',
      phone: me.phone ?? '',
      language: me.language ?? 'en',
      themePreference: me.themePreference ?? 'system',
      notifications_enabled: me.notifications_enabled !== false,
      email: me.email ?? '',
      username: me.username ?? '',
    });
  }, [me, formProfile]);

  const items = useMemo(
    () => [
      { key: 'profile', icon: <UserOutlined />, label: t('settingsPage.menu_profile') },
      { key: 'posts', icon: <FileTextOutlined />, label: t('settingsPage.menu_posts') },
      { key: 'bookmarks', icon: <BookOutlined />, label: t('settingsPage.menu_bookmarks') },
      { key: 'security', icon: <LockOutlined />, label: t('settingsPage.menu_security') },
      // { key: 'users', icon: <TeamOutlined />, label: 'Users' },
      // { key: 'files', icon: <FileOutlined />, label: 'Files' },
      // { key: 'logs', icon: <DatabaseOutlined />, label: 'Logs' },
    ],
    [t]
  );

  const menuNode = (
    <Menu
      mode="inline"
      selectedKeys={[active]}
      items={items}
      onClick={(e) => {
        setActive(e.key as MenuKey);
        if (isMobile) setDrawerOpen(false);
      }}
    />
  );

  async function handleUpload(file: File) {
    try {
      const { data } = await uploadAvatar({ variables: { user_id: user?.id, file } });
      const url = data?.uploadAvatar;
      if (url) {
        setAvatarUrl(url);
        message.success(t('settingsPage.avatar_updated'));
        refetchMe();
      }
    } catch (e) {
      console.error(e);
      message.error(t('settingsPage.upload_failed'));
    }
  }

  async function onSaveProfile(values: any) {
    try {
      const payload = {
        name: values.name?.trim() || '',
        phone: values.phone?.trim() || '',
        language: values.language || 'en',
        themePreference: values.themePreference || 'system',
        notifications_enabled: values.notifications_enabled !== false,
        username: values.username?.trim() || '',
      };

      const res = await updateMe({ variables: { data: payload } });
      if (res?.data?.updateMe?.id) {
        const nextTheme = res.data.updateMe.themePreference as ThemeMode | undefined;
        if (nextTheme === 'light' || nextTheme === 'dark' || nextTheme === 'system') {
          setTheme(nextTheme);
        }
        const nextLang = res.data.updateMe.language;
        if (isLang(nextLang) && getLangCookie() !== nextLang) {
          setLangCookie(nextLang);
          router.refresh();
        }
        message.success(t('settingsPage.saved'));
        refetchMe();
      } else {
        message.error(t('settingsPage.save_failed'));
      }
    } catch (err: any) {
      message.error(err?.message || t('settingsPage.save_error'));
    }
  }

  async function onToggleNotifications(checked: boolean) {
    const previous = me?.notifications_enabled !== false;
    formProfile.setFieldValue('notifications_enabled', checked);
    setSavingNotifications(true);
    try {
      const res = await updateMe({ variables: { data: { notifications_enabled: checked } } });
      if (res?.data?.updateMe?.id) {
        message.success(t('settingsPage.notif_updated'));
        refetchMe();
      } else {
        throw new Error('Update failed');
      }
    } catch (err: any) {
      formProfile.setFieldValue('notifications_enabled', previous);
      message.error(err?.message || t('settingsPage.notif_update_failed'));
    } finally {
      setSavingNotifications(false);
    }
  }

  return (
    <Layout style={{ minHeight: '100vh', background: 'var(--app-bg)' }}>
      {/* Mobile header */}
      {isMobile && (
        <Header
          style={{
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--app-surface)',
            borderBottom: '1px solid var(--app-border)',
          }}
        >
          <Button icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} />
          <div style={{ fontWeight: 600 }}>{t('settingsPage.title')}</div>
        </Header>
      )}

      {/* Drawer (mobile menu) */}
      <Drawer
        title={t('settingsPage.title')}
        placement="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        bodyStyle={{ padding: 0 }}
        width={280}
      >
        {menuNode}
      </Drawer>

      {/* Desktop sider */}
      {!isMobile && (
        <Sider width={240} style={{ background: 'var(--app-surface)', borderRight: '1px solid var(--app-border)' }}>
          <div style={{ padding: 12 }}>
            <Card styles={{ body: { padding: 0 } }}>
              {menuNode}
            </Card>
          </div>
        </Sider>
      )}

      <Layout style={{ background: 'var(--app-bg)' }}>
        <Content style={{ padding: contentPadding, background: 'var(--app-bg)' }}>
          {/* PROFILE */}
          {active === 'profile' && (
            <PanelWrap title={t('settingsPage.profile_title')} maxWidth={cardMaxWidth} loading={meLoading}>
              <Row gutter={[12, 12]} align="middle">
                <Col xs={24} sm={8} style={{ display: 'flex', justifyContent: isMobile ? 'flex-start' : 'center' }}>
                  <Avatar size={96} src={avatarUrl || me?.avatar} icon={<UserOutlined />} />
                </Col>
                <Col xs={24} sm={16}>
                  <Space wrap>
                    <Upload accept="image/*" showUploadList={false} beforeUpload={handleUpload}>
                      <Button icon={<CloudUploadOutlined />}>{t('settingsPage.upload_avatar')}</Button>
                    </Upload>
                  </Space>
                </Col>
              </Row>

              <Divider />

              <Form form={formProfile} layout="vertical" onFinish={onSaveProfile}>
                <Row gutter={12}>
                  <Col xs={24} md={12}>
                    <Form.Item name="name" label={t('settingsPage.display_name')} rules={[{ required: true }]}>
                      <Input placeholder={t('settingsPage.display_name_placeholder')} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="phone" label={t('settingsPage.phone')}>
                      <Input placeholder={t('settingsPage.phone_placeholder')} />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item name="email" label={t('settingsPage.email')} rules={[{ required: true, type: 'email' }]}>
                      <Input placeholder="name@example.com" disabled />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="username"
                      label={t('settingsPage.username')}
                      tooltip={t('settingsPage.username_tooltip')}
                      rules={[{ required: true }]}
                    >
                      <Input placeholder="username" disabled />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item name="language" label={t('settingsPage.language')}>
                      <Select
                        options={[
                          { value: 'en', label: t('settingsPage.language_en') },
                          { value: 'th', label: t('settingsPage.language_th') },
                        ]}
                      />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item name="themePreference" label={t('settingsPage.theme')}>
                      <Select
                        options={[
                          { value: 'system', label: t('settingsPage.theme_system') },
                          { value: 'light', label: t('settingsPage.theme_light') },
                          { value: 'dark', label: t('settingsPage.theme_dark') },
                        ]}
                      />
                    </Form.Item>
                  </Col>

                  <Col xs={24} md={12}>
                    <Form.Item
                      name="notifications_enabled"
                      label={t('settingsPage.notifications')}
                      valuePropName="checked"
                      extra={t('settingsPage.notifications_extra')}
                    >
                      <Switch
                        onChange={onToggleNotifications}
                        disabled={savingNotifications || updatingMe}
                        loading={savingNotifications}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Button type="primary" htmlType="submit" loading={updatingMe} block={isMobile}>
                  {t('settingsPage.save_changes')}
                </Button>
              </Form>
            </PanelWrap>
          )}

          {/* SECURITY */}
          {active === 'security' && (
            <PanelWrap title={t('settingsPage.security_title')} maxWidth={cardMaxWidth}>
              <Form layout="vertical" onFinish={() => message.success(t('settingsPage.password_changed'))}>
                <Row gutter={12}>
                  <Col xs={24} md={12}>
                    <Form.Item name="current" label={t('settingsPage.current_password')} rules={[{ required: true }]}>
                      <Input.Password />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="new" label={t('settingsPage.new_password')} rules={[{ required: true, min: 8 }]}>
                      <Input.Password />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="confirm"
                      label={t('settingsPage.confirm_new_password')}
                      dependencies={['new']}
                      rules={[
                        { required: true },
                        ({ getFieldValue }) => ({
                          validator(_, v) {
                            if (!v || getFieldValue('new') === v) return Promise.resolve();
                            return Promise.reject(new Error(t('settingsPage.password_mismatch')));
                          },
                        }),
                      ]}
                    >
                      <Input.Password />
                    </Form.Item>
                  </Col>
                </Row>

                <Button type="primary" htmlType="submit" block={isMobile}>
                  {t('settingsPage.change_password')}
                </Button>
              </Form>
            </PanelWrap>
          )}

          {/* OTHERS */}
          {active === 'users' && <UsersPanel />}
          {active === 'posts' && <PostsPanel />}
          {active === 'files' && <FilesPanel />}
          {active === 'logs' && <LogsPanel />}
          {active === 'bookmarks' && <MyBookmarksPanel />}
        </Content>
      </Layout>
    </Layout>
  );
}
