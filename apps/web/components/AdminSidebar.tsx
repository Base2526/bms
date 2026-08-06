'use client';
import Link from 'next/link';
import { Layout, Menu, Avatar, Button, message, Tooltip, Drawer, Badge } from 'antd';
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
  MailOutlined,
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
  RobotOutlined,
  HistoryOutlined,
  NotificationOutlined,
  BellOutlined,
  TagsOutlined,
  CodeOutlined,
  FundViewOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { usePathname } from 'next/navigation';
import { gql, useQuery } from '@apollo/client';
import { useBmsPermissions } from '@/app/hooks/useBmsPermissions';
import { useIsMobile } from '@/app/hooks/useMediaQuery';
import { useSession } from '@/lib/useSession';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18nContext';

const Q_PLATFORM_ADMIN = gql`query { bmsIsPlatformAdmin }`;
const Q_INBOX_UNREAD = gql`query { bmsInboxUnreadCount }`;
const Q_MENTIONS_UNREAD = gql`query { bmsMyMentionsUnreadCount }`;
const Q_RESTOCK_READY = gql`query { bmsRestockReadyCount }`;
const Q_CHANNEL_HEALTH_COUNT = gql`query { bmsChannelHealthCount }`;
const Q_AI_PROVIDER_HEALTH_COUNT = gql`query { bmsAiProviderHealthCount }`;
const Q_AI_USAGE = gql`
  query {
    bmsAiConfig { has_key }
    bmsAiUsage { count limit remaining unlimited }
  }
`;
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
  const { t } = useI18n();
  const pathname = usePathname();
  // จอมือถือไม่มีที่ให้ rail 64px (เหลือเนื้อหา ~272px บนจอ 360px) → ซ่อน Sider ทั้งตัว
  // แล้วเปิดเมนูเดิมใน Drawer จากแถบบนแทน
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // กดเมนูแล้วต้องปิดเอง — Drawer ไม่รู้เรื่อง client-side navigation ของ Next
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  const { data: paData } = useQuery(Q_PLATFORM_ADMIN, { fetchPolicy: 'cache-first' });
  const isPlatformAdmin = paData?.bmsIsPlatformAdmin === true;
  const { admin, refreshSession } = useSession();
  const isAdministrator = admin?.role === 'Administrator';
  const canManageAccess = isAdministrator || isPlatformAdmin; // เห็น Users/Permissions/Audit
  const { can } = useBmsPermissions();
  // Fake data (dev): platform admin เท่านั้น — ต้องตรงกับ requirePlatformAdminPage() ใน
  // app/(admin)/admin/dev/fake/layout.tsx และ requirePlatformAdminSeeder() ที่ API
  // (เดิมผูกกับ can('product.edit') ทำให้ staff เห็นเมนูแล้วกดเข้าไปโดน redirect)
  const canSeedFake = isPlatformAdmin;
  // ระบบ = ของระดับแพลตฟอร์ม (Posts/Files/Queue/Logs/ENV) → platform admin เท่านั้น
  const showSystemGroup = isPlatformAdmin || canSeedFake;

  // แชทเข้าคือจุดเริ่ม workflow ทั้งหมด (ตาม CLAUDE.md) — badge unread ต้อง poll เอง
  // เพราะ sidebar ติดอยู่ทุกหน้า ไม่ใช่แค่หน้า Inbox
  const canViewInbox = can('inbox.view');
  const { data: unreadData } = useQuery(Q_INBOX_UNREAD, {
    skip: !canViewInbox, fetchPolicy: 'cache-and-network', pollInterval: 30000,
  });
  const inboxUnread: number = unreadData?.bmsInboxUnreadCount ?? 0;

  // @mention ที่ยังไม่อ่านของฉัน — badge แยกจาก inboxUnread (คนละความหมาย: ข้อความลูกค้า vs ถูกกล่าวถึง)
  const { data: mentionsData } = useQuery(Q_MENTIONS_UNREAD, {
    skip: !canViewInbox, fetchPolicy: 'cache-and-network', pollInterval: 30000,
  });
  const mentionsUnread: number = mentionsData?.bmsMyMentionsUnreadCount ?? 0;

  const { data: restockData } = useQuery(Q_RESTOCK_READY, {
    skip: !canViewInbox, fetchPolicy: 'cache-and-network', pollInterval: 30000,
  });
  const restockReady: number = restockData?.bmsRestockReadyCount ?? 0;

  // ช่องทาง active แต่ status ไม่ปกติ (token หมดอายุ/webhook fail/rate limit/no events) —
  // poll เอง 15s แบบเดียวกับ inboxUnread เพื่อให้เห็น badge แม้ไม่ได้อยู่หน้า Settings
  const { data: healthData } = useQuery(Q_CHANNEL_HEALTH_COUNT, {
    fetchPolicy: 'cache-and-network', pollInterval: 60000,
  });
  const channelHealthCount: number = healthData?.bmsChannelHealthCount ?? 0;

  // shared AI provider (Anthropic/DeepSeek/Qwen) configured แต่เชื่อมต่อไม่ได้จริง —
  // platform-wide ไม่ผูก tenant จึงเช็คเฉพาะ platform admin (คนอื่น query นี้ก็ FORBIDDEN อยู่แล้ว)
  const { data: aiProviderHealthData } = useQuery(Q_AI_PROVIDER_HEALTH_COUNT, {
    skip: !isPlatformAdmin, fetchPolicy: 'cache-first', pollInterval: 120000,
  });
  const aiProviderHealthCount: number = aiProviderHealthData?.bmsAiProviderHealthCount ?? 0;

  // โควตา AI (shared key ฟรี) — poll ห่างกว่า inbox/channel เพราะเปลี่ยนไม่บ่อย (นับเป็นเดือน ไม่ใช่วินาที)
  const { data: aiData } = useQuery(Q_AI_USAGE, {
    fetchPolicy: 'cache-first', pollInterval: 300000,
  });
  const aiHasKey: boolean = aiData?.bmsAiConfig?.has_key ?? false;
  const aiUsage = aiData?.bmsAiUsage;
  const aiOverLimit = !aiHasKey && aiUsage && !aiUsage.unlimited && aiUsage.remaining === 0;
  const aiNearLimit = !aiHasKey && aiUsage && !aiUsage.unlimited && aiUsage.limit > 0 && aiUsage.remaining > 0 && aiUsage.remaining <= aiUsage.limit * 0.2;
  const aiShouldShow = !aiHasKey && aiUsage && !aiUsage.unlimited && aiUsage.limit > 0;
  const aiNeedsManualAttention = aiOverLimit && inboxUnread > 0;
  const aiTone = aiOverLimit ? '#e5484d' : aiNearLimit ? '#d48806' : '#1677ff';
  const aiBg = aiOverLimit ? 'rgba(229,72,77,0.1)' : aiNearLimit ? 'rgba(212,136,6,0.1)' : 'rgba(22,119,255,0.1)';
  const aiTooltip = aiOverLimit
    ? aiNeedsManualAttention
      ? t('admin.ai_tooltip_exhausted_pending', { n: inboxUnread })
      : t('admin.ai_tooltip_exhausted')
    : aiNearLimit
      ? t('admin.ai_tooltip_near_limit', { remaining: aiUsage?.remaining ?? 0, limit: aiUsage?.limit ?? 0 })
      : t('admin.ai_tooltip_normal', { count: aiUsage?.count ?? 0, limit: aiUsage?.limit ?? 0 });
  const aiStripText = aiOverLimit
    ? aiNeedsManualAttention
      ? t('admin.ai_strip_exhausted_pending', { n: inboxUnread })
      : t('admin.ai_strip_exhausted')
    : aiNearLimit
      ? t('admin.ai_strip_near_limit', { remaining: aiUsage?.remaining ?? 0, limit: aiUsage?.limit ?? 0 })
      : t('admin.ai_strip_normal', { count: aiUsage?.count ?? 0, limit: aiUsage?.limit ?? 0 });

  // จำสถานะ ย่อ/ขยาย ข้ามหน้า (localStorage) — ผสมกับจอแคบ (breakpoint="lg" ของ Sider ด้านล่าง)
  // ต้องคำนวณทั้งสองเงื่อนไขในเอฟเฟกต์เดียวกัน ไม่งั้นเอฟเฟกต์ breakpoint ของ Sider (child)
  // กับเอฟเฟกต์นี้ (parent) จะแย่งกันเซ็ต state ตอน mount แล้วค่าจอแคบโดนทับกลับเป็นขยาย
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
    const narrow = typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 991.98px)').matches;
    setCollapsed(stored || narrow);
  }, []);
  // type = 'responsive' มาจาก breakpoint (จอแคบ) ไม่ persist ทับค่าที่ผู้ใช้ตั้งไว้ตอนจอกว้าง
  // ตอนกลับมาจอกว้าง ให้คืนค่าตาม preference เดิมใน localStorage แทนที่จะบังคับขยายเสมอ
  const onCollapse = (value: boolean, type?: 'clickTrigger' | 'responsive') => {
    if (type === 'responsive') {
      setCollapsed(value ? true : window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1');
      return;
    }
    setCollapsed(value);
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, value ? '1' : '0');
  };
  // ใน Drawer มีที่ให้เมนูเต็มความกว้างเสมอ → ไม่ใช้โหมดย่อ (และ badge ใช้แบบ pill ไม่ใช่แบบเกาะไอคอน)
  const effectiveCollapsed = isMobile ? false : collapsed;

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
    ...(canViewInbox ? [link('/admin/inbox', 'Inbox', <MessageOutlined />, inboxUnread, effectiveCollapsed, true)] : []),
    ...(canViewInbox ? [link('/admin/restock-subscriptions', t('admin.menu_restock_subscriptions'), <BellOutlined />, restockReady, effectiveCollapsed, true)] : []),
    ...(canViewInbox ? [link('/admin/inbox/mentions', t('admin.menu_mentions'), <NotificationOutlined />, mentionsUnread, effectiveCollapsed, true)] : []),
    // ผู้ช่วย AI หลังบ้าน — ถาม/สั่งงานด้วยภาษาพูด (tool-calling); งาน sensitive ต้องกดยืนยันเอง
    link('/admin/assistant', t('admin.menu_assistant'), <RobotOutlined />),
    // Architecture = เอกสาร dev ภายใน (ERD/security/migrations) → platform admin เท่านั้น
    ...(isPlatformAdmin ? [link('/admin/architecture', 'Architecture', <PartitionOutlined />)] : []),
    {
      key: 'g-bms',
      icon: <ShopOutlined />,
      label: t('admin.group_shop'),
      children: [
        link('/admin/products', 'Products', <ShoppingCartOutlined />),
        link('/admin/orders', 'Orders', <ShoppingCartOutlined />),
        ...(can('coupon.view') ? [link('/admin/coupons', 'Coupons', <TagsOutlined />)] : []),
        ...(can('followup.view') ? [link('/admin/followup-rules', 'Follow-up Rules', <ClockCircleOutlined />)] : []),
        ...(can('followup.view') ? [link('/admin/followup-queue', 'Follow-up Queue', <ClockCircleOutlined />)] : []),
        link('/admin/revisions', 'Revision History', <HistoryOutlined />),
        link('/admin/purchase', 'Purchase (PO)', <ImportOutlined />),
        link('/admin/payment', 'Payment', <DollarOutlined />),
        link('/admin/shipment', 'Shipping', <CarOutlined />),
        link('/admin/customers', 'Customers', <TeamOutlined />),
        link('/admin/playground', 'Playground', <ExperimentOutlined />),
      ],
    },
    link('/admin/reports', 'Reports', <BarChartOutlined />),
    ...(can('ai_quality.view') ? [link('/admin/ai-quality', 'AI Quality', <FundViewOutlined />)] : []),
    {
      key: 'g-saas',
      icon: <ApiOutlined />,
      label: 'SaaS',
      children: [
        link('/admin/settings', t('admin.menu_settings_channels'), <ApiOutlined />, channelHealthCount, effectiveCollapsed),
        ...(canManageAccess ? [link('/admin/inbox/realtime-diagnostics', 'Realtime Diagnostics', <ExperimentOutlined />)] : []),
        link('/admin/billing', 'Billing & Plan', <CreditCardOutlined />),
        ...(isPlatformAdmin ? [link('/admin/tenants', t('admin.menu_all_shops'), <ShopOutlined />)] : []),
        ...(isPlatformAdmin ? [link('/admin/report-schedule', t('admin.menu_report_schedule'), <MailOutlined />)] : []),
      ],
    },
    ...(canManageAccess ? [{
      key: 'g-access',
      icon: <SafetyOutlined />,
      label: t('admin.group_access'),
      children: [
        link('/admin/users', 'Users', <UserOutlined />),
        // Roles = นิยามกลางทั้งระบบ → เฉพาะ platform admin
        ...(isPlatformAdmin ? [link('/admin/roles', 'Roles', <SnippetsOutlined />)] : []),
        link('/admin/permissions', 'Permissions', <SafetyOutlined />),
        link('/admin/audit', 'Audit log', <BookOutlined />),
      ],
    }] : []),
    ...(showSystemGroup ? [{
      key: 'g-system',
      icon: <AppstoreOutlined />,
      label: t('admin.group_system'),
      children: [
        // ระดับแพลตฟอร์ม → platform admin เท่านั้น
        ...(isPlatformAdmin ? [
          link('/admin/posts', 'Posts', <FileTextOutlined />, 2),
          link('/admin/files', 'Files', <FileImageOutlined />, 5),
          link('/admin/logs', 'Logs', <DatabaseOutlined />, 1),
          link('/admin/mail-log', 'Mail log', <MailOutlined />),
          link('/admin/support-tickets', 'Support Tickets', <MessageOutlined />),
          link('/admin/operations-schedule', 'Batch & Cron', <ClockCircleOutlined />),
          link('/admin/env', 'ENV', <EnvironmentOutlined />, aiProviderHealthCount, effectiveCollapsed),
          link('/admin/dev/sql-console', 'Dev Console', <CodeOutlined />),
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

  // เนื้อเมนู — ใช้ร่วมกันทั้ง Sider (desktop) และ Drawer (มือถือ)
  // `mini` = โหมดย่อเหลือไอคอน · `inDrawer` = อยู่ใน Drawer (ไม่ต้องมีปุ่มย่อ/ขยาย)
  const sidebarBody = (mini: boolean, inDrawer = false) => (
      /* wrapper flex ของตัวเอง — .ant-layout-sider-children ที่ antd แทรกให้ไม่ใช่ flex container
          ถ้าไม่มี div นี้ flex:1 ของเมนูด้านล่างจะไม่มีผล โปรไฟล์/logout จะไม่ติดล่างสุด */
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* โลโก้ + ปุ่มย่อ/ขยาย (อยู่บนสุด) */}
      <div
        style={{
          display: 'flex', alignItems: 'center',
          justifyContent: mini ? 'center' : 'space-between',
          gap: 8, padding: mini ? '14px 0' : '14px 16px', flexShrink: 0,
        }}
      >
        {!mini && (
          <Link href="/admin" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--app-text)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <ShopOutlined />
            <span>BMS</span>
          </Link>
        )}
        {!inDrawer && (
          <div
            role="button"
            aria-label={mini ? t('admin.expand_menu') : t('admin.collapse_menu')}
            onClick={() => onCollapse(!mini)}
            style={{
              cursor: 'pointer', width: 28, height: 28, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--app-border)', borderRadius: 6, color: 'var(--app-text)',
            }}
          >
            {mini ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>
        )}
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

      {/* โควตา AI shared key ฟรี — โชว์ตลอดเมื่อใช้ Shared Key และยกระดับสีเมื่อใกล้/เกินโควตา
          ปักไว้เหนือคู่มือ/โปรไฟล์ เหมือน balance strip ของ Claude Console */}
      {aiShouldShow && (
        <div style={{ padding: mini ? '0 10px' : '0 10px 8px', flexShrink: 0 }}>
          <Tooltip
            title={aiTooltip}
            placement="right"
          >
            <Link
              href="/admin/settings"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                justifyContent: mini ? 'center' : 'flex-start',
                padding: mini ? '6px 0' : '6px 8px', borderRadius: 8,
                background: aiBg,
                color: aiTone,
              }}
            >
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <RobotOutlined />
                <span style={{
                  position: 'absolute', top: -2, right: -3, width: 7, height: 7, borderRadius: '50%',
                  background: aiTone, boxShadow: '0 0 0 1.5px var(--app-surface)',
                }} />
              </span>
              {!mini && (
                <span style={{ fontSize: 12, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {aiStripText}
                </span>
              )}
            </Link>
          </Tooltip>
        </div>
      )}

      {/* คู่มือ + โปรไฟล์ + Logout (ปักล่างสุด) — คู่มือใช้ไม่บ่อย เลยลดความสำคัญมาไว้แถบนี้แทน top-level */}
      <div style={{ borderTop: '1px solid var(--app-border)', padding: '10px 10px 0', flexShrink: 0 }}>
        <Tooltip title={mini ? t('admin.manual') : ''} placement="right">
          <Link
            href="/admin/manual"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: mini ? 'center' : 'flex-start',
              padding: '4px 8px', marginBottom: 6, borderRadius: 8,
              color: 'var(--app-text-secondary, #888)', fontSize: 13,
            }}
          >
            <BookOutlined />
            {!mini && <span>{t('admin.manual')}</span>}
          </Link>
        </Tooltip>
      </div>
      {admin && (
        <div style={{ padding: '0 10px 10px', flexShrink: 0 }}>
          <Link
            href="/admin/profile"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: mini ? 'center' : 'flex-start',
              padding: '4px', marginBottom: 8, borderRadius: 8, color: 'var(--app-text)',
            }}
          >
            <Avatar size={26} src={admin.avatar || undefined} icon={<UserOutlined />} />
            {!mini && (
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
            block={!mini}
            style={mini ? { width: 32, height: 32, padding: 0, minWidth: 0 } : {}}
          >
            {!mini && 'Logout'}
          </Button>
        </div>
      )}
      </div>
  );

  // ---- มือถือ: แถบบน (hamburger + โลโก้ + badge สำคัญ) + เมนูเดิมใน Drawer ----
  // ไม่ render <Sider> เลย → antd Layout เลิกเป็น has-sider แล้วเนื้อหาได้ความกว้างเต็มจอ
  if (isMobile) {
    const alerts = inboxUnread + mentionsUnread;
    return (
      <>
        <div
          style={{
            position: 'sticky', top: 0, zIndex: 20,
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px',
            background: 'var(--app-surface)',
            borderBottom: '1px solid var(--app-border)',
          }}
        >
          <Button
            type="text"
            aria-label={t('admin.open_menu')}
            icon={<MenuUnfoldOutlined />}
            onClick={() => setDrawerOpen(true)}
          />
          <Link
            href="/admin"
            style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--app-text)', fontWeight: 600 }}
          >
            <ShopOutlined />
            <span>BMS</span>
          </Link>
          {canViewInbox && alerts > 0 && (
            <Link href="/admin/inbox" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
              <Badge count={alerts > 99 ? '99+' : alerts} size="small" offset={[-2, 2]}>
                <MessageOutlined style={{ fontSize: 18, color: 'var(--app-text-secondary, #888)' }} />
              </Badge>
            </Link>
          )}
          {admin && (
            <Link href="/admin/profile" style={{ marginLeft: canViewInbox && alerts > 0 ? 0 : 'auto', display: 'flex' }}>
              <Avatar size={28} src={admin.avatar || undefined} icon={<UserOutlined />} />
            </Link>
          )}
        </div>
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={260}
          closable={false}
          styles={{ body: { padding: 0, background: 'var(--app-surface)' } }}
        >
          {sidebarBody(false, true)}
        </Drawer>
      </>
    );
  }

  return (
    <Sider
      collapsed={collapsed}
      collapsedWidth={64}
      width={220}
      breakpoint="lg"
      onCollapse={onCollapse}
      style={{
        background: 'var(--app-surface)',
        borderRight: '1px solid var(--app-border)',
        height: '100vh',
        position: 'sticky',
        top: 0,
        overflow: 'hidden',
      }}
    >
      {sidebarBody(collapsed)}
    </Sider>
  );
}
