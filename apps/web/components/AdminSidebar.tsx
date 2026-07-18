'use client';
import Link from 'next/link';
import { Layout, Menu, Avatar, Button, message, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  UserOutlined,
  FileTextOutlined,
  FileImageOutlined,
  DatabaseOutlined,
  SnippetsOutlined,
  EnvironmentOutlined,
  ShoppingCartOutlined,
  ExperimentOutlined,
  TeamOutlined,
  DashboardOutlined,
  SafetyOutlined,
  ApiOutlined,
  CreditCardOutlined,
  ShopOutlined,
  SettingOutlined,
  AppstoreOutlined,
  BookOutlined,
  PartitionOutlined,
  ImportOutlined,
  DollarOutlined,
  CarOutlined,
  MessageOutlined,
  BarChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { usePathname } from 'next/navigation';
import { gql, useQuery } from '@apollo/client';
import { useBmsPermissions } from '@/app/hooks/useBmsPermissions';
import { useSession } from '@/lib/useSession';
import { useEffect, useState } from 'react';

const Q_PLATFORM_ADMIN = gql`query { bmsIsPlatformAdmin }`;
const Q_INBOX_UNREAD = gql`query { bmsInboxUnreadCount }`;
const Q_CHANNEL_HEALTH_COUNT = gql`query { bmsChannelHealthCount }`;
const COLLAPSE_STORAGE_KEY = 'bms_admin_sidebar_collapsed';

const { Sider } = Layout;

const badgeText = (n: number) => (n > 99 ? '99+' : String(n));

// pill ชิดขวาในแถว — ใช้ตอนขยาย (มีที่ว่างพอ ไม่ทับ label)
const PILL_STYLE: React.CSSProperties = {
  minWidth: 20, height: 20, padding: '0 7px', borderRadius: 10,
  background: '#e5484d', color: '#fff', fontSize: 11, fontWeight: 600,
  lineHeight: '20px', textAlign: 'center', flexShrink: 0,
};

// badge เกาะมุมบนขวาของไอคอน — ใช้เฉพาะตอนย่อ (label ถูกซ่อน เหลือแต่ไอคอน)
// วางให้อยู่ในกรอบ .ant-menu-item (กว้าง 55px) ไม่งั้นโดน overflow:hidden ของ li ตัด
// className + !important กัน antd บังคับ opacity:0 กับ child ตัวที่ 2 ในสล็อตไอคอนตอนย่อ
const iconWithBadge = (icon: React.ReactNode, count: number) => (
  <span style={{ position: 'relative', display: 'inline-flex' }}>
    {icon}
    <span className="bms-sider-badge" style={{
      position: 'absolute', top: 1, right: -7,
      minWidth: 15, height: 15, padding: '0 3px', borderRadius: 8,
      background: '#e5484d', color: '#fff', fontSize: 9, fontWeight: 600,
      lineHeight: '15px', textAlign: 'center', boxShadow: '0 0 0 1.5px var(--app-surface)',
    }}>
      {badgeText(count)}
    </span>
  </span>
);

// collapsed = true → badge เกาะไอคอน (เห็นตอนย่อ) เฉพาะเมนูหลักที่จำเป็นจริง
// เมนูย่อยใน popup ของ antd ถ้าใส่ badge ไว้ในสล็อต icon จะทำให้ label หายบางรายการ
const link = (
  href: string,
  text: string,
  icon: React.ReactNode,
  badge = 0,
  collapsed = false,
  showCollapsedBadge = false,
) => ({
  key: href,
  icon: collapsed && showCollapsedBadge && badge > 0 ? iconWithBadge(icon, badge) : icon,
  // flex+pill เฉพาะตอนขยาย+มี badge (Inbox) เท่านั้น — item อื่น/ลูกเมนูใน popup ใช้ Link ธรรมดา
  // ไม่งั้น span flex:1 overflow:hidden จะยุบเหลือ 0 ใน popup flyout ตอนย่อ → text หาย
  label:
    !collapsed && badge > 0 ? (
      <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
        <span style={PILL_STYLE}>{badgeText(badge)}</span>
      </Link>
    ) : (
      <Link href={href}>{text}</Link>
    ),
});

export default function AdminSidebar() {
  const pathname = usePathname();
  const { data: paData } = useQuery(Q_PLATFORM_ADMIN, { fetchPolicy: 'cache-and-network' });
  const isPlatformAdmin = paData?.bmsIsPlatformAdmin === true;
  const { admin, refreshSession } = useSession();
  const isAdministrator = admin?.role === 'Administrator';
  const canManageAccess = isAdministrator || isPlatformAdmin; // เห็น Users/Permissions/Audit
  const { can } = useBmsPermissions();
  // Fake data (dev): ให้ร้านค้าเทสในมุมตัวเองได้ (seed ลง tenant ตัวเอง) → ผูกกับสิทธิ์แก้สินค้า
  const canSeedFake = isPlatformAdmin || can('product.edit');
  // ระบบ = ของระดับแพลตฟอร์ม (Posts/Files/Queue/Logs/ENV) → platform admin เท่านั้น
  const showSystemGroup = isPlatformAdmin || canSeedFake;

  // แชทเข้าคือจุดเริ่ม workflow ทั้งหมด (ตาม CLAUDE.md) — badge unread ต้อง poll เอง
  // เพราะ sidebar ติดอยู่ทุกหน้า ไม่ใช่แค่หน้า Inbox
  const canViewInbox = can('inbox.view');
  const { data: unreadData } = useQuery(Q_INBOX_UNREAD, {
    skip: !canViewInbox, fetchPolicy: 'cache-and-network', pollInterval: 15000,
  });
  const inboxUnread: number = unreadData?.bmsInboxUnreadCount ?? 0;

  // ช่องทาง active แต่ status ไม่ปกติ (token หมดอายุ/webhook fail/rate limit/no events) —
  // poll เอง 15s แบบเดียวกับ inboxUnread เพื่อให้เห็น badge แม้ไม่ได้อยู่หน้า Settings
  const { data: healthData } = useQuery(Q_CHANNEL_HEALTH_COUNT, {
    fetchPolicy: 'cache-and-network', pollInterval: 15000,
  });
  const channelHealthCount: number = healthData?.bmsChannelHealthCount ?? 0;

  // จำสถานะ ย่อ/ขยาย ข้ามหน้า (localStorage)
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1');
  }, []);
  const onCollapse = (value: boolean) => {
    setCollapsed(value);
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, value ? '1' : '0');
  };

  async function onLogout() {
    const res = await fetch('/api/auth/logout-admin', { method: 'POST' });
    refreshSession();
    if (res.ok) {
      message.success('Logged out');
      window.location.href = '/admin/login';
    } else {
      message.error('Logout failed');
    }
  }

  // จัดกลุ่มเมนูเป็นหมวด → submenu แบบ inline
  // Inbox = จุดเริ่ม workflow ทั้งหมด (ลูกค้าทักเข้ามา) → ดึงออกมาเป็น top-level แยกจาก
  // กลุ่ม "ร้านค้า" เดิม (เคยฝังลึก 2 คลิกกว่าจะถึง) พร้อม badge unread ให้เห็นทันที
  // Reports/คู่มือ ใช้ไม่บ่อยเท่า Inbox → Reports ย้ายลงมาไว้หลังกลุ่มร้านค้า, คู่มือย้ายไปแถบล่างสุด
  const items: MenuProps['items'] = [
    link('/admin/dashboard', 'Dashboard', <DashboardOutlined />),
    ...(canViewInbox ? [link('/admin/inbox', 'Inbox', <MessageOutlined />, inboxUnread, collapsed, true)] : []),
    // Architecture = เอกสาร dev ภายใน (ERD/security/migrations) → platform admin เท่านั้น
    ...(isPlatformAdmin ? [link('/admin/architecture', 'Architecture', <PartitionOutlined />)] : []),
    {
      key: 'g-bms',
      icon: <ShopOutlined />,
      label: 'ร้านค้า',
      children: [
        link('/admin/products', 'Products', <ShoppingCartOutlined />),
        link('/admin/orders', 'Orders', <ShoppingCartOutlined />),
        link('/admin/purchase', 'Purchase (PO)', <ImportOutlined />),
        link('/admin/payment', 'Payment', <DollarOutlined />),
        link('/admin/shipment', 'Shipping', <CarOutlined />),
        link('/admin/customers', 'Customers', <TeamOutlined />),
        link('/admin/playground', 'Playground', <ExperimentOutlined />),
      ],
    },
    link('/admin/reports', 'Reports', <BarChartOutlined />),
    {
      key: 'g-saas',
      icon: <ApiOutlined />,
      label: 'SaaS',
      children: [
        link('/admin/settings', 'Settings (เชื่อมช่องทาง)', <ApiOutlined />, channelHealthCount, collapsed),
        ...(canManageAccess ? [link('/admin/inbox/realtime-diagnostics', 'Realtime Diagnostics', <ExperimentOutlined />)] : []),
        link('/admin/billing', 'Billing & Plan', <CreditCardOutlined />),
        ...(isPlatformAdmin ? [link('/admin/tenants', 'ร้านค้าทั้งหมด (แพลตฟอร์ม)', <ShopOutlined />)] : []),
      ],
    },
    ...(canManageAccess ? [{
      key: 'g-access',
      icon: <SafetyOutlined />,
      label: 'ผู้ใช้/สิทธิ์',
      children: [
        link('/admin/users', 'Users', <UserOutlined />, 3, collapsed),
        // Roles = นิยามกลางทั้งระบบ → เฉพาะ platform admin
        ...(isPlatformAdmin ? [link('/admin/roles', 'Roles', <SnippetsOutlined />)] : []),
        link('/admin/permissions', 'Permissions', <SafetyOutlined />),
        link('/admin/audit', 'Audit log', <BookOutlined />),
      ],
    }] : []),
    ...(showSystemGroup ? [{
      key: 'g-system',
      icon: <AppstoreOutlined />,
      label: 'ระบบ',
      children: [
        // ระดับแพลตฟอร์ม → platform admin เท่านั้น
        ...(isPlatformAdmin ? [
          link('/admin/posts', 'Posts', <FileTextOutlined />, 2),
          link('/admin/files', 'Files', <FileImageOutlined />, 5),
          link('/admin/queue', 'Social Queue', <DatabaseOutlined />),
          link('/admin/logs', 'Logs', <DatabaseOutlined />, 1),
          link('/admin/env', 'ENV', <EnvironmentOutlined />),
        ] : []),
        // Fake data (dev) → ร้านค้าเทสในมุมตัวเองได้
        ...(canSeedFake ? [link('/admin/dev/fake', 'Fake data', <SnippetsOutlined />)] : []),
      ],
    }] : []),
  ];

  // ไฮไลต์เมนูที่ตรง path ปัจจุบัน + เปิด submenu ของกลุ่มที่ path อยู่ (เฉพาะตอนขยาย)
  const selectedKeys = [pathname];
  const openGroupKey = ['g-bms', 'g-saas', 'g-access', 'g-system'].find((g) =>
    (items.find((i: any) => i?.key === g) as any)?.children?.some((c: any) => c.key === pathname)
  );

  return (
    <Sider
      collapsed={collapsed}
      collapsedWidth={64}
      width={220}
      style={{
        background: 'var(--app-surface)',
        borderRight: '1px solid var(--app-border)',
        height: '100vh',
        position: 'sticky',
        top: 0,
        overflow: 'hidden',
      }}
    >
      {/* wrapper flex ของตัวเอง — .ant-layout-sider-children ที่ antd แทรกให้ไม่ใช่ flex container
          ถ้าไม่มี div นี้ flex:1 ของเมนูด้านล่างจะไม่มีผล โปรไฟล์/logout จะไม่ติดล่างสุด */}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* โลโก้ + ปุ่มย่อ/ขยาย (อยู่บนสุด) */}
      <div
        style={{
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 8, padding: collapsed ? '14px 0' : '14px 16px', flexShrink: 0,
        }}
      >
        {!collapsed && (
          <Link href="/admin" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--app-text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <ShopOutlined />
            <span>AI-BMS</span>
          </Link>
        )}
        <div
          role="button"
          aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
          onClick={() => onCollapse(!collapsed)}
          style={{
            cursor: 'pointer', width: 28, height: 28, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--app-border)', borderRadius: 6, color: 'var(--app-text)',
          }}
        >
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        </div>
      </div>

      {/* เมนู — เลื่อนได้เฉพาะส่วนนี้ (overflowX ต้อง visible ไม่งั้น badge ที่ล้นขอบไอคอนโดนตัด) */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'visible' }}>
        <Menu
          mode="inline"
          items={items}
          selectedKeys={selectedKeys}
          defaultOpenKeys={openGroupKey ? [openGroupKey] : []}
          style={{ background: 'transparent', borderRight: 'none' }}
        />
      </div>

      {/* คู่มือ + โปรไฟล์ + Logout (ปักล่างสุด) — คู่มือใช้ไม่บ่อย เลยลดความสำคัญมาไว้แถบนี้แทน top-level */}
      <div style={{ borderTop: '1px solid var(--app-border)', padding: '10px 10px 0', flexShrink: 0 }}>
        <Tooltip title={collapsed ? 'คู่มือ' : ''} placement="right">
          <Link
            href="/admin/manual"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: '4px 8px', marginBottom: 6, borderRadius: 8,
              color: 'var(--app-text-secondary, #888)', fontSize: 13,
            }}
          >
            <BookOutlined />
            {!collapsed && <span>คู่มือ</span>}
          </Link>
        </Tooltip>
      </div>
      {admin && (
        <div style={{ padding: '0 10px 10px', flexShrink: 0 }}>
          <Link
            href="/admin/profile"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: '4px', marginBottom: 8, borderRadius: 8, color: 'var(--app-text)',
            }}
          >
            <Avatar size={26} src={admin.avatar || undefined} icon={<UserOutlined />} />
            {!collapsed && (
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {admin.name || admin.username || admin.email}
                </span>
                <span style={{ fontSize: 11, color: 'var(--app-text-secondary, #888)' }}>{admin.role}</span>
              </span>
            )}
          </Link>
          <Button
            danger type="primary" icon={<LogoutOutlined />} onClick={onLogout}
            block={!collapsed}
            style={collapsed ? { width: 32, height: 32, padding: 0, minWidth: 0 } : {}}
          >
            {!collapsed && 'Logout'}
          </Button>
        </div>
      )}
      </div>
    </Sider>
  );
}
