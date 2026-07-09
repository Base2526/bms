'use client';
import Link from 'next/link';
import { Layout, Menu, Badge, Avatar, Button, message } from 'antd';
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
const COLLAPSE_STORAGE_KEY = 'bms_admin_sidebar_collapsed';

const { Sider } = Layout;

// label ที่มี badge (ถ้า count>0)
const withBadge = (text: string, count = 0) =>
  count > 0 ? (
    <span>
      {text} <Badge count={count} overflowCount={99} size="small" />
    </span>
  ) : (
    text
  );

const link = (href: string, text: string, icon: React.ReactNode, badge = 0) => ({
  key: href,
  icon,
  label: <Link href={href}>{withBadge(text, badge)}</Link>,
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
  const items: MenuProps['items'] = [
    link('/admin/dashboard', 'Dashboard', <DashboardOutlined />),
    link('/admin/reports', 'Reports', <BarChartOutlined />),
    link('/admin/manual', 'คู่มือ', <BookOutlined />),
    // Architecture = เอกสาร dev ภายใน (ERD/security/migrations) → platform admin เท่านั้น
    ...(isPlatformAdmin ? [link('/admin/architecture', 'Architecture', <PartitionOutlined />)] : []),
    {
      key: 'g-bms',
      icon: <ShopOutlined />,
      label: 'ร้านค้า',
      children: [
        link('/admin/inbox', 'Inbox', <MessageOutlined />),
        link('/admin/products', 'Products', <ShoppingCartOutlined />),
        link('/admin/orders', 'Orders', <ShoppingCartOutlined />),
        link('/admin/purchase', 'Purchase (PO)', <ImportOutlined />),
        link('/admin/payment', 'Payment', <DollarOutlined />),
        link('/admin/shipment', 'Shipping', <CarOutlined />),
        link('/admin/customers', 'Customers', <TeamOutlined />),
        link('/admin/playground', 'Playground', <ExperimentOutlined />),
      ],
    },
    {
      key: 'g-saas',
      icon: <ApiOutlined />,
      label: 'SaaS',
      children: [
        link('/admin/settings', 'Settings (เชื่อมช่องทาง)', <ApiOutlined />),
        link('/admin/billing', 'Billing & Plan', <CreditCardOutlined />),
        ...(isPlatformAdmin ? [link('/admin/tenants', 'ร้านค้าทั้งหมด (แพลตฟอร์ม)', <ShopOutlined />)] : []),
      ],
    },
    ...(canManageAccess ? [{
      key: 'g-access',
      icon: <SafetyOutlined />,
      label: 'ผู้ใช้/สิทธิ์',
      children: [
        link('/admin/users', 'Users', <UserOutlined />, 3),
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

      {/* เมนู — เลื่อนได้เฉพาะส่วนนี้ */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <Menu
          mode="inline"
          items={items}
          selectedKeys={selectedKeys}
          defaultOpenKeys={openGroupKey ? [openGroupKey] : []}
          style={{ background: 'transparent', borderRight: 'none' }}
        />
      </div>

      {/* โปรไฟล์ + Logout (ปักล่างสุด) */}
      {admin && (
        <div style={{ borderTop: '1px solid var(--app-border)', padding: 10, flexShrink: 0 }}>
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
