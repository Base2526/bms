'use client';
import Link from 'next/link';
import { Button, Badge, Typography, Layout, Menu, message, Avatar, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  UserOutlined,
  FileTextOutlined,
  FileImageOutlined,
  DatabaseOutlined,
  LogoutOutlined,
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
} from '@ant-design/icons';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/useSession';
import { gql, useQuery } from '@apollo/client';
import { useBmsPermissions } from '@/app/hooks/useBmsPermissions';

const Q_PLATFORM_ADMIN = gql`query { bmsIsPlatformAdmin }`;

const { Title } = Typography;
const { Header } = Layout;

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

export default function AdminHeader() {
  const pathname = usePathname();
  const { admin, refreshSession } = useSession();
  const { data: paData } = useQuery(Q_PLATFORM_ADMIN, { fetchPolicy: 'cache-and-network' });
  const isPlatformAdmin = paData?.bmsIsPlatformAdmin === true;
  const isAdministrator = admin?.role === 'Administrator';
  const canManageAccess = isAdministrator || isPlatformAdmin; // เห็น Users/Permissions/Audit
  const { can } = useBmsPermissions();
  // Fake data (dev): ให้ร้านค้าเทสในมุมตัวเองได้ (seed ลง tenant ตัวเอง) → ผูกกับสิทธิ์แก้สินค้า
  const canSeedFake = isPlatformAdmin || can('product.edit');
  // ระบบ = ของระดับแพลตฟอร์ม (Posts/Files/Queue/Logs/ENV) → platform admin เท่านั้น
  const showSystemGroup = isPlatformAdmin || canSeedFake;

  // จัดกลุ่มเมนูเป็นหมวด → dropdown
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

  // ไฮไลต์เมนูที่ตรง path ปัจจุบัน
  const selectedKeys = [pathname];

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

  return (
    <Header
      style={{
        background: 'var(--app-surface)',
        boxShadow: '0 2px 8px rgba(var(--app-shadow-rgb),0.08)',
        borderBottom: '1px solid var(--app-border)',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        height: 56,
        lineHeight: '56px',
      }}
    >
      <Title level={4} style={{ margin: 0, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
        <Link href="/admin" style={{ color: 'var(--app-text)' }}>
          <ShopOutlined /> AI-BMS
        </Link>
      </Title>

      {/* เมนูจัดกลุ่ม — overflow อัตโนมัติเมื่อจอแคบ */}
      <Menu
        mode="horizontal"
        items={items}
        selectedKeys={selectedKeys}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          borderBottom: 'none',
        }}
      />

      {admin && (
        <Tooltip title="ดูโปรไฟล์ของฉัน">
          <Link
            href="/admin/profile"
            style={{
              flex: '0 0 auto',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 10px',
              height: 36,
              borderRadius: 18,
              border: '1px solid var(--app-border)',
              color: 'var(--app-text)',
              maxWidth: 220,
              overflow: 'hidden',
            }}
          >
            <Avatar size={26} src={admin.avatar || undefined} icon={<UserOutlined />} />
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {admin.name || admin.username || admin.email}
              </span>
              <span style={{ fontSize: 11, color: 'var(--app-text-secondary, #888)' }}>{admin.role}</span>
            </span>
          </Link>
        </Tooltip>
      )}

      <Button
        icon={<LogoutOutlined />}
        onClick={onLogout}
        danger
        type="primary"
        style={{ flex: '0 0 auto' }}
      >
        Logout
      </Button>
    </Header>
  );
}
