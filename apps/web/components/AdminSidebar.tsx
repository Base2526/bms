'use client';
import Link from 'next/link';
import { Layout, Menu, Avatar, Button, message, Tooltip, Drawer, Badge, Skeleton, Segmented } from 'antd';
import type { MenuProps } from 'antd';
import {
  SearchOutlined,
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
  ApiOutlined,
  CreditCardOutlined,
  ShopOutlined,
  MailOutlined,
  AppstoreOutlined,
  BookOutlined,
  ReadOutlined,
  PartitionOutlined,
  ImportOutlined,
  SwapOutlined,
  BuildOutlined,
  CoffeeOutlined,
  DeleteOutlined,
  ContainerOutlined,
  AuditOutlined,
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
  TrophyOutlined,
  CodeOutlined,
  FundViewOutlined,
  ClockCircleOutlined,
  MedicineBoxOutlined,
  FileSearchOutlined,
  FileProtectOutlined,
  IdcardOutlined,
  DesktopOutlined,
  SafetyCertificateOutlined,
  HeartOutlined,
  ClusterOutlined,
  ScanOutlined,
  PrinterOutlined,
  PercentageOutlined,
  OrderedListOutlined,
  BranchesOutlined,
  CloudOutlined,
  KeyOutlined,
  BankOutlined,
  CustomerServiceOutlined,
  ScheduleOutlined,
  ThunderboltOutlined,
  BugOutlined,
  AlertOutlined,
  ProfileOutlined,
  ControlOutlined,
} from '@ant-design/icons';
import { usePathname, useRouter } from 'next/navigation';
import { gql, useQuery } from '@apollo/client';
import { useBmsPermissions } from '@/app/hooks/useBmsPermissions';
import { useIsMobile } from '@/app/hooks/useMediaQuery';
import { useSessionCtx } from '@/lib/session-context';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18nContext';
import {
  ADMIN_NAV_SECTION_LABELS,
  buildAdminNavigation,
  hasPlatformWorkspace,
  searchableAdminNavItems,
  selectAdminNavItem,
  workspaceForRoute,
  type AdminNavBadge,
  type AdminNavContext,
  type AdminNavItem,
  type AdminNavSectionId,
  type AdminWorkspace,
} from '@/lib/bms/adminNavigation';
import AdminCommandPalette from '@/components/work-assistant/AdminCommandPalette';

const Q_SIDEBAR_BOOTSTRAP = gql`
  query {
    bmsIsPlatformAdmin
    bmsStoreProfile {
      businessArchetype
    }
    bmsKitchenBoardEnabled
    bmsWastageEnabled
    bmsPackToolsConfigured
  }
`;
const Q_INBOX_UNREAD = gql`query { bmsInboxUnreadCount }`;
const Q_MENTIONS_UNREAD = gql`query { bmsMyMentionsUnreadCount }`;
const Q_RESTOCK_READY = gql`query { bmsRestockReadyCount }`;
const Q_CHANNEL_HEALTH_COUNT = gql`query { bmsChannelHealthCount }`;
const Q_PHARMACY_EMERGENCY_COUNT = gql`query { bmsPharmacyAssessments(riskLevel: "EMERGENCY", limit: 50) { id } }`;
const Q_PHARMACY_PENDING_CONFIRMATION_COUNT = gql`
  query {
    bmsPharmacyAssessments(status: "PENDING_CONFIRMATION", limit: 50) { id }
  }
`;
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

const GOLD_PILL_STYLE: React.CSSProperties = {
  minWidth: 20, height: 20, padding: '0 7px', borderRadius: 10,
  background: '#d48806', color: '#fff', fontSize: 11, fontWeight: 600,
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
      // whiteSpace: 'normal' (ไม่ nowrap/ellipsis) — เดิมตัดข้อความยาวเป็น "..." อ่านไม่ออกว่าเมนูอะไร
      <Link href={href} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', wordBreak: 'break-word' }}>{text}</span>
        <span style={{ ...PILL_STYLE, flexShrink: 0 }}>{badgeText(badge)}</span>
      </Link>
    ) : (
      <Link href={href}>{text}</Link>
    ),
});

// ⚠️ ใช้ label จาก labelKey ของรายการเมนูเดียวกัน ห้ามอ่านคีย์ของตัวเอง — ไม่งั้นเมนูนี้จะมีชื่อ
// สองที่ แก้ที่นิยามเมนูแล้วหน้าจอไม่เปลี่ยน (กับดักเดียวกับที่ CLAUDE.md เรียกว่า "สองสำเนา")
const pharmacyQueueLink = (
  route: string,
  label: string,
  collapsed: boolean,
  emergencyCount: number,
  pendingConfirmationCount: number,
  pendingLabel: string,
  emergencyLabel: string,
) => {
  const totalBadge = emergencyCount + pendingConfirmationCount;
  return {
    key: route,
    icon: collapsed && totalBadge > 0
      ? iconWithBadge(<AlertOutlined />, totalBadge)
      : <AlertOutlined />,
    label: !collapsed ? (
      // whiteSpace: 'normal' (ไม่ nowrap/ellipsis) — เดิมตัดข้อความยาวเป็น "..." อ่านไม่ออกว่าเมนูอะไร
      <Link href={route} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', wordBreak: 'break-word' }}>
          {label}
        </span>
        {/* เดิม hardcode ไทยตรง ๆ ไม่มี fallback ภาษาอังกฤษเลย — ต่างกับ label อื่นในไฟล์นี้ที่เป็น
            English เสมอหรือผ่าน t() ทั้งคู่ ตอนนี้ผ่าน t() ให้ตรงตาม lang cookie จริง */}
        {pendingConfirmationCount > 0 ? <span style={{ ...GOLD_PILL_STYLE, flexShrink: 0 }}>{pendingLabel} {badgeText(pendingConfirmationCount)}</span> : null}
        {emergencyCount > 0 ? <span style={{ ...PILL_STYLE, flexShrink: 0 }}>{emergencyLabel} {badgeText(emergencyCount)}</span> : null}
      </Link>
    ) : (
      <Link href={route}>{label}</Link>
    ),
  };
};

// ไอคอนอยู่ที่นี่ไม่ได้อยู่ในนิยามเมนู — นิยามต้องเป็นโมดูล pure ที่เทสได้โดยไม่ต้องมี React
const SECTION_ICONS: Record<AdminNavSectionId, React.ReactNode> = {
  sales: <OrderedListOutlined />,
  inventory: <ShoppingCartOutlined />,
  customers: <MessageOutlined />,
  finance: <DollarOutlined />,
  shopfloor: <MedicineBoxOutlined />,
  settings: <ControlOutlined />,
  platform_shops: <BankOutlined />,
  platform_content: <FileTextOutlined />,
  platform_ops: <AppstoreOutlined />,
};

const NAV_ICONS: Record<string, React.ReactNode> = {
  'overview.dashboard': <DashboardOutlined />,
  'overview.getting-started': <ThunderboltOutlined />,
  'sales.orders': <OrderedListOutlined />,
  'sales.shipment': <CarOutlined />,
  'sales.pos-shifts': <ProfileOutlined />,
  'sales.kitchen': <CoffeeOutlined />,
  'sales.pos-manual': <ReadOutlined />,
  'inventory.products': <ShoppingCartOutlined />,
  'inventory.stock-models': <BuildOutlined />,
  'inventory.product-packs': <ScanOutlined />,
  'inventory.product-labels': <PrinterOutlined />,
  'inventory.purchase': <ImportOutlined />,
  'inventory.stock-transfers': <SwapOutlined />,
  'inventory.stock-counts': <ContainerOutlined />,
  'inventory.wastage': <DeleteOutlined />,
  'customers.inbox': <MessageOutlined />,
  'customers.mentions': <NotificationOutlined />,
  'customers.customers': <TeamOutlined />,
  'customers.restock': <BellOutlined />,
  'customers.loyalty': <TrophyOutlined />,
  'customers.coupons': <TagsOutlined />,
  'customers.followup-rules': <BranchesOutlined />,
  'customers.followup-queue': <ClockCircleOutlined />,
  'finance.payment': <DollarOutlined />,
  'finance.receivables': <AuditOutlined />,
  'finance.commission': <PercentageOutlined />,
  'finance.reports': <BarChartOutlined />,
  'shopfloor.pharmacy-queue': <AlertOutlined />,
  'shopfloor.pharmacy-intake-lab': <FileSearchOutlined />,
  'shopfloor.pharmacy-protocols': <FileProtectOutlined />,
  'shopfloor.pharmacist-licenses': <IdcardOutlined />,
  'shopfloor.pharmacist-manual': <ReadOutlined />,
  'settings.store': <ApiOutlined />,
  'settings.locations': <ClusterOutlined />,
  'settings.pos-devices': <DesktopOutlined />,
  'settings.pos-readiness': <SafetyCertificateOutlined />,
  'settings.users': <UserOutlined />,
  'settings.permissions': <KeyOutlined />,
  'settings.revisions': <HistoryOutlined />,
  'settings.audit': <ProfileOutlined />,
  'settings.billing': <CreditCardOutlined />,
  'settings.ai-quality': <FundViewOutlined />,
  'settings.playground': <ExperimentOutlined />,
  'settings.support-diagnostics': <CustomerServiceOutlined />,
  'settings.realtime-diagnostics': <BugOutlined />,
  'settings.manual': <BookOutlined />,
  'platform.tenants': <BankOutlined />,
  'platform.roles': <SnippetsOutlined />,
  'platform.report-schedule': <ScheduleOutlined />,
  'platform.support-tickets': <CustomerServiceOutlined />,
  'platform.posts': <FileTextOutlined />,
  'platform.files': <FileImageOutlined />,
  'platform.architecture': <PartitionOutlined />,
  'platform.logs': <DatabaseOutlined />,
  'platform.mail-log': <MailOutlined />,
  'platform.operations-schedule': <ControlOutlined />,
  'platform.system-health': <HeartOutlined />,
  'platform.env': <EnvironmentOutlined />,
  'platform.sql-console': <CodeOutlined />,
  'platform.fake-data': <ThunderboltOutlined />,
};

const WORKSPACE_STORAGE_KEY = 'bms_admin_workspace';

export default function AdminSidebar() {
  const { t, lang } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  // จอมือถือไม่มีที่ให้ rail 64px (เหลือเนื้อหา ~272px บนจอ 360px) → ซ่อน Sider ทั้งตัว
  // แล้วเปิดเมนูเดิมใน Drawer จากแถบบนแทน
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // กดเมนูแล้วต้องปิดเอง — Drawer ไม่รู้เรื่อง client-side navigation ของ Next
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  // เดิมเป็น Q_PLATFORM_ADMIN แยกก้อน + Q_STORE_PROFILE แยกก้อนด้านล่าง — รวมเป็น query
  // เดียวเพื่อลดจำนวน round-trip ที่ยิงพร้อมกันตอน mount ครั้งแรก (ตอนแคชยังว่าง คือจุดที่
  // เมนูทั้งหมดด้านล่างนี้ยังไม่โผล่เพราะรอ can()/isPlatformAdmin — ยิ่งน้อย request ยิ่งเร็ว)
  //
  // เช็คแล้วว่าปลอดภัยที่จะรวมสองตัวนี้: bmsStoreProfile ใช้ requireTenantAdmin ซึ่ง throw
  // FORBIDDEN ถ้า scope !== "admin" เป๊ะ ๆ ส่วน bmsIsPlatformAdmin (isPlatformAdmin() ที่
  // lib/bms/platform.ts) เองก็ return false ทันทีถ้า scope !== "admin" เหมือนกัน — เงื่อนไข
  // ที่ทำให้ bmsStoreProfile พัง คือเงื่อนไขเดียวกันที่ทำให้ isPlatformAdmin เป็น false อยู่แล้ว
  // ไม่มีทางที่การรวม query จะทำให้ค่า isPlatformAdmin เพี้ยนไปจากที่ยิงแยกกัน (ทั้งสอง field
  // เป็น non-null ในสคีมา ถ้า bmsStoreProfile throw จริง GraphQL null-bubbling จะทำให้ทั้ง
  // response เป็น data:null — แต่ isPlatformAdmin ที่อ่านได้จาก null ก็คือ false เหมือนที่
  // resolver ของมันเองจะตอบอยู่แล้ว ไม่ใช่ข้อมูลที่หายไปจริง)
  // *** ด้วยเหตุผลเดียวกันนี้ ห้ามเอา myBmsPermissions มารวมด้วย *** — loadPermissions()
  // (permissions.ts) ยอมรับ scope "web" + admin identity ด้วย ซึ่งกว้างกว่า requireTenantAdmin
  // ถ้ารวมเข้ามา เคส scope="web"+adminIdentity จะได้สิทธิ์จริงจาก resolver เอง แต่ถูก
  // bmsStoreProfile ที่ throw ทับให้เป็น data:null ไปด้วย — นี่คือข้อมูลที่หายไปจริง ไม่เหมือน
  // isPlatformAdmin ข้างบน
  // errorPolicy: 'all' ไว้เป็นค่า defensive ทั่วไป (ไม่ให้ error link/console โวยวายเปล่า ๆ
  // เวลาเจอ FORBIDDEN ที่คาดไว้แล้ว) ไม่ใช่ตัวกู้ partial data — ตอน root field non-null พังจน
  // null-bubble ถึง data ทั้งก้อน ฝั่ง client กู้อะไรกลับมาไม่ได้อยู่ดี
  const { data: bootstrapData, loading: bootstrapLoading } = useQuery(Q_SIDEBAR_BOOTSTRAP, {
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  });
  const isPlatformAdmin = bootstrapData?.bmsIsPlatformAdmin === true;
  const { admin, refreshSession } = useSessionCtx();
  const isAdministrator = admin?.role === 'Administrator';
  const { can, perms, loading: permsLoading } = useBmsPermissions();
  // เกือบทุกรายการเมนูด้านล่างนี้ถูกกำหนดด้วย can(...)/isPlatformAdmin ซึ่งทั้งคู่เป็น false
  // เสมอก่อน query จะตอบกลับรอบแรก (แคชว่าง) — ใช้ธงนี้โชว์ skeleton แทนเมนูที่ดูเหมือนหายไป
  const menuGateLoading = permsLoading || bootstrapLoading;
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

  // AI Pharmacy Intake — เคสความเสี่ยง EMERGENCY ที่ยังไม่ปิด, poll แบบเดียวกับ channel health
  const canViewPharmacy = can('pharmacy.assessment.read');
  const { data: pharmacyData } = useQuery(Q_PHARMACY_EMERGENCY_COUNT, {
    skip: !canViewPharmacy, fetchPolicy: 'cache-and-network', pollInterval: 30000,
  });
  const pharmacyEmergencyCount: number = pharmacyData?.bmsPharmacyAssessments?.length ?? 0;
  const { data: pharmacyPendingConfirmationData } = useQuery(Q_PHARMACY_PENDING_CONFIRMATION_COUNT, {
    skip: !canViewPharmacy, fetchPolicy: 'cache-and-network', pollInterval: 30000,
  });
  const pharmacyPendingConfirmationCount: number = pharmacyPendingConfirmationData?.bmsPharmacyAssessments?.length ?? 0;
  // กระดานครัวตามความสามารถที่ร้านเปิดจริง ไม่ใช่ตามประเภทร้าน — preset ของร้านอาหาร
  // เปิด KITCHEN_WORKFLOW ให้อยู่แล้ว ส่วนร้านประเภทอื่นที่เปิดเองก็ต้องเห็นเมนูนี้ด้วย
  // (เดิม gate ด้วย archetype === "restaurant" ร้านที่เปิดเองจึงมีตั๋วครัวแต่ไม่มีทางเปิดดู)
  const kitchenBoardEnabled = bootstrapData?.bmsKitchenBoardEnabled === true;

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
  // พื้นที่ทำงานที่ผู้ใช้เลือกไว้ (ดูแลร้าน / ดูแลแพลตฟอร์ม) — เป็นการเลือก "ชุดเครื่องมือ"
  // ไม่ใช่การสลับ tenant: drill-down กับแถบเตือนร้านที่กำลังดูแลยังทำงานเหมือนเดิมทั้งสองพื้นที่
  const [workspace, setWorkspace] = useState<AdminWorkspace>('SHOP');
  useEffect(() => {
    if (window.localStorage.getItem(WORKSPACE_STORAGE_KEY) === 'PLATFORM') setWorkspace('PLATFORM');
  }, []);
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

  // เมนูทั้งหมดมาจาก lib/bms/adminNavigation.ts (pure, ทดสอบได้โดยไม่ต้อง render แอป)
  // ไฟล์นี้เหลือหน้าที่ 3 อย่าง: ผูกไอคอน, ผูก badge จากตัวนับที่ poll อยู่แล้ว, และเรนเดอร์
  // ⚠️ การซ่อนเมนูไม่ใช่การกันสิทธิ์ — ทุกหน้ายังตรวจสิทธิ์ของตัวเองฝั่ง server เหมือนเดิม
  const navContext: AdminNavContext = {
    can,
    isPlatformAdmin,
    isAdministrator,
    archetype: bootstrapData?.bmsStoreProfile?.businessArchetype ?? null,
    kitchenBoardEnabled,
    wastageEnabled: bootstrapData?.bmsWastageEnabled === true,
    packToolsConfigured: bootstrapData?.bmsPackToolsConfigured === true,
  };
  const platformAvailable = hasPlatformWorkspace(navContext);
  // พื้นที่ทำงานตามหน้าที่เปิดอยู่ชนะค่าที่ผู้ใช้เลือกไว้ — deep link หรือ back/forward เข้าหน้า
  // ของอีกพื้นที่แล้วเมนูต้องสอดคล้องกับหน้าที่เห็น ไม่ใช่ค้างอยู่พื้นที่เดิม
  const routeWorkspace = workspaceForRoute(pathname);
  const effectiveWorkspace: AdminWorkspace = !platformAvailable
    ? 'SHOP'
    : routeWorkspace ?? workspace;
  const { topLevel, sections } = buildAdminNavigation(navContext, effectiveWorkspace);
  const selectedNavItem = selectAdminNavItem(pathname);

  // ⚠️ กดสวิตช์ตอนยืนอยู่บนหน้าของอีกพื้นที่ต้องพาไปหน้าแรกของพื้นที่ที่เลือก — ไม่งั้น
  // routeWorkspace (ซึ่งชนะโดยตั้งใจ เพื่อให้ deep link/back สอดคล้อง) จะทับค่าที่เพิ่งเลือก
  // แล้วปุ่มดูเหมือนกดไม่ติดจนกว่าจะเปลี่ยนหน้าเอง
  const chooseWorkspace = (next: AdminWorkspace) => {
    setWorkspace(next);
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, next);
    if (routeWorkspace && routeWorkspace !== next) {
      const nextNav = buildAdminNavigation(navContext, next);
      const target = nextNav.topLevel[0]?.route ?? nextNav.sections[0]?.items[0]?.route;
      if (target) router.push(target);
    }
  };

  // ค้นหาเมนู (⌘K / Ctrl+K) — ครอบคลุมทั้งสองพื้นที่เสมอ ไม่ผูกกับ effectiveWorkspace ปัจจุบัน
  // เพราะประโยชน์หลักคือกระโดดข้ามพื้นที่ได้โดยไม่ต้องสลับสวิตช์ก่อน (ดู searchableAdminNavItems)
  const [paletteOpen, setPaletteOpen] = useState(false);
  const searchableItems = searchableAdminNavItems(navContext);
  const labelForNavItem = (item: AdminNavItem) => t(item.labelKey);
  const sectionLabelForNavItem = (item: AdminNavItem) => t(ADMIN_NAV_SECTION_LABELS[item.section]);
  const iconForNavItem = (item: AdminNavItem) => NAV_ICONS[item.id] ?? <AppstoreOutlined />;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const badgeCounts: Record<AdminNavBadge, number> = {
    inbox: inboxUnread,
    mentions: mentionsUnread,
    restockReady: restockReady,
    channelHealth: channelHealthCount,
    pharmacyQueue: pharmacyEmergencyCount + pharmacyPendingConfirmationCount,
    aiProviderHealth: aiProviderHealthCount,
  };

  // topLevel = หน้าแรกที่คนกลับมาทั้งวัน + คิวที่มีคนรออยู่ เรนเดอร์แบน ๆ เหนือทุกหมวด
  // คิวโชว์ badge บนไอคอนตอนย่อด้วย เพราะหัวหมวดของ antd ไม่รวมเลขของลูก และหมวดที่ยุบอยู่
  // กลายเป็น popup ที่ต้อง hover → เลขที่อยู่ในหมวดมองไม่เห็นจากทุกหน้าที่ไม่ใช่หน้านั้นเอง
  const renderItem = (item: AdminNavItem) => (
    item.id === 'shopfloor.pharmacy-queue'
      ? pharmacyQueueLink(
          item.route,
          t(item.labelKey),
          effectiveCollapsed,
          pharmacyEmergencyCount,
          pharmacyPendingConfirmationCount,
          t('admin.pharmacy_queue_pending'),
          t('admin.pharmacy_queue_emergency'),
        )
      : link(
          item.route,
          t(item.labelKey),
          NAV_ICONS[item.id] ?? <AppstoreOutlined />,
          item.badge ? badgeCounts[item.badge] : 0,
          effectiveCollapsed,
          item.topLevel === 'queue',
        )
  );

  const items: MenuProps['items'] = [
    ...topLevel.map(renderItem),
    ...sections.map((section) => ({
      key: `nav-${section.id}`,
      icon: SECTION_ICONS[section.id],
      label: t(section.labelKey),
      children: section.items.map(renderItem),
    })),
  ];

  // ไฮไลต์เมนูที่ "เป็นเจ้าของ" path ปัจจุบัน (จับคู่ตามขอบเขต route เลือกตัวที่เจาะจงที่สุด)
  // หน้ารายละเอียดอย่าง /admin/users/new หรือ /admin/pharmacy-queue/<id> จึงเลือกเมนูแม่ถูก
  const selectedKeys = selectedNavItem ? [selectedNavItem.route] : [];
  // รายการที่อยู่ด้านบนไม่มีหมวดให้เปิด — ยืนอยู่บนกล่องข้อความไม่ควรไปกางหมวดอื่นทิ้งไว้
  const activeSectionKey = selectedNavItem && !selectedNavItem.topLevel
    ? `nav-${selectedNavItem.section}`
    : null;
  // ⚠️ hook นี้ต้องอยู่หลัง activeSectionKey (const ตัวนั้นอยู่ใน TDZ ถ้าเรียกก่อน)
  // ย้ายไปหมวดใหม่ = เปิดหมวดนั้นหมวดเดียว (เดิมเวอร์ชันแรกของผมสะสมไปเรื่อย ๆ เดินไป 5 หมวด
  // แล้วเมนูกางค้างทั้ง 5 ซึ่งกลับหัวกับเหตุผลที่จัดหมวดตั้งแต่แรก) · เดินภายในหมวดเดิมไม่รีเซ็ต
  // อะไร ผู้ใช้จึงยังกางหลายหมวดเทียบกันเองได้ตามต้องการ
  const [openKeys, setOpenKeys] = useState<string[]>(() => (activeSectionKey ? [activeSectionKey] : []));
  useEffect(() => {
    if (!activeSectionKey) return;
    setOpenKeys((prev) => (prev.includes(activeSectionKey) ? prev : [activeSectionKey]));
  }, [activeSectionKey]);

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

      {/* ค้นหาเมนู — ทางเข้าเดียวกับ ⌘K/Ctrl+K แต่ต้องมีปุ่มให้กดเห็น ๆ ด้วย เพราะ rail ย่อ 64px
          และ Drawer มือถือไม่มีคีย์บอร์ดจริงให้กด ⌘K เลย ปุ่มนี้จึงเป็นทางเข้าเดียวของทั้งสองกรณี */}
      <div style={{ padding: mini ? '0 10px 8px' : '0 16px 10px', flexShrink: 0 }}>
        <button
          type="button"
          className="bms-sider-quiet"
          onClick={() => setPaletteOpen(true)}
          aria-label={t('admin_nav.search_placeholder')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            justifyContent: mini ? 'center' : 'flex-start',
            padding: mini ? '8px 0' : '8px 10px', cursor: 'pointer', borderRadius: 8,
            // กรอบ+พื้นหลังคงไว้ทั้งสองโหมด — ช่องค้นหาเป็นคนละชนิดกับรายการเมนู มันคือกล่องรับ
            // คำพิมพ์ ไม่ใช่ปลายทาง จึงควรอ่านออกว่าเป็นตัวรับข้อความแม้ตอนเหลือแค่ไอคอน
            background: 'var(--app-surface-2)',
            border: '1px solid var(--app-border)',
            color: 'var(--text-secondary)', fontSize: 13,
          }}
        >
          <SearchOutlined />
          {!mini && <span style={{ flex: 1, textAlign: 'left' }}>{t('admin_nav.search_placeholder')}</span>}
          {!mini && !inDrawer && (
            <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
              <kbd style={{ fontSize: 10.5, border: '1px solid var(--app-border)', borderRadius: 4, padding: '1px 5px' }}>⌘</kbd>
              <kbd style={{ fontSize: 10.5, border: '1px solid var(--app-border)', borderRadius: 4, padding: '1px 5px' }}>K</kbd>
            </span>
          )}
        </button>
      </div>

      {/* สลับพื้นที่ทำงาน — เฉพาะคนที่มีเครื่องมือระดับแพลตฟอร์มจริง (คนอื่นไม่เห็นแถบนี้เลย)
          ⚠️ นี่คือการสลับ "ชุดเมนู" ไม่ใช่การสลับร้าน — drill-down/แถบเตือนร้านที่กำลังดูแล
          ทำงานเหมือนเดิมทั้งสองพื้นที่ และไม่มีสิทธิ์ใดถูกเพิ่มจากการกดปุ่มนี้ */}
      {platformAvailable && !menuGateLoading && (
        <div
          className={effectiveWorkspace === 'PLATFORM' ? 'bms-workspace-switch bms-workspace-platform' : 'bms-workspace-switch'}
          style={{ padding: mini ? '0 6px 8px' : '0 12px 10px', flexShrink: 0 }}
        >
          {/* ป้ายสั้น ("ร้าน"/"แพลตฟอร์ม") เพราะแถบกว้าง 264px ตัดคำยาวทิ้ง — ของเดิม
              "ดูแลแพลตฟอร์ม" เหลือ "ดูแลแพ…" ซึ่งเป็นปุ่มที่อ่านไม่จบ · ความหมายเต็มอยู่ที่
              tooltip/aria-label ทั้งสองโหมด ไม่ใช่เฉพาะตอนแถบย่อ */}
          <Segmented
            block
            size="small"
            value={effectiveWorkspace}
            onChange={(value) => chooseWorkspace(value as AdminWorkspace)}
            aria-label={t('admin_nav.workspace_switch_label')}
            options={mini
              ? [
                  { value: 'SHOP', icon: <Tooltip title={t('admin_nav.workspace_shop_full')} placement="right"><ShopOutlined /></Tooltip> },
                  { value: 'PLATFORM', icon: <Tooltip title={t('admin_nav.workspace_platform_full')} placement="right"><CloudOutlined /></Tooltip> },
                ]
              : [
                  {
                    value: 'SHOP',
                    label: <Tooltip title={t('admin_nav.workspace_shop_full')} placement="bottom">
                      <span>{t('admin_nav.workspace_shop')}</span></Tooltip>,
                    icon: <ShopOutlined />,
                  },
                  {
                    value: 'PLATFORM',
                    label: <Tooltip title={t('admin_nav.workspace_platform_full')} placement="bottom">
                      <span>{t('admin_nav.workspace_platform')}</span></Tooltip>,
                    icon: <CloudOutlined />,
                  },
                ]}
          />
        </div>
      )}

      {/* เมนู — เลื่อนได้เฉพาะส่วนนี้ (overflowX ต้อง visible ไม่งั้น badge ที่ล้นขอบไอคอนโดนตัด) */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'visible' }}>
        {menuGateLoading ? (
          // แทบทุกรายการข้างบนถูกกำหนดด้วย can()/isPlatformAdmin ที่ยัง false อยู่ตอนนี้
          // (แคชว่าง รอ query รอบแรก) — ไม่โชว์ <Menu> เปล่า ๆ ที่ดูเหมือนเมนูหายไปเงียบ ๆ
          <div style={{ padding: mini ? '8px 6px' : '8px 16px' }}>
            <Skeleton active title={false} paragraph={{ rows: mini ? 4 : 8 }} />
          </div>
        ) : (
          <Menu
            className={effectiveWorkspace === 'PLATFORM'
              ? 'bms-admin-sidebar-menu bms-admin-sidebar-menu-platform'
              : 'bms-admin-sidebar-menu'}
            mode="inline"
            items={items}
            selectedKeys={selectedKeys}
            openKeys={openKeys}
            onOpenChange={(keys) => setOpenKeys(keys as string[])}
            style={{ background: 'transparent', borderRight: 'none' }}
          />
        )}
      </div>

      {/* โควตา AI shared key ฟรี — โชว์ตลอดเมื่อใช้ Shared Key และยกระดับสีเมื่อใกล้/เกินโควตา
          ปักไว้เหนือคู่มือ/โปรไฟล์ เหมือน balance strip ของ Claude Console */}
      {aiShouldShow && (
        <div style={{ padding: mini ? '0 10px 10px' : '0 10px 8px', flexShrink: 0 }}>
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

      {/* ผู้ช่วย AI + คู่มือ + โปรไฟล์ + Logout (ปักล่างสุด) — สองตัวแรกคือของที่คนหยิบตอน "ไม่รู้จะทำ
          ยังไง" จึงอยู่ที่เดิมเสมอโดยไม่ต้องกางหมวด · ผู้ช่วยมี Drawer อยู่ทุกหน้าแล้ว (AdminLayoutClient)
          หน้าเต็มจึงเป็นทางเข้าที่สอง ไม่ใช่ทางหลัก — ให้แถวบนสุดกับ Dashboard คุ้มกว่า */}
      {/* ⚠️ ระยะห่างของกลุ่มล่างต้องคิดแยกสองโหมด — ตอนขยายมี label ยืดความสูงให้เอง แต่ตอนย่อ
          เหลือแค่ไอคอน 16px กอง ๆ กัน 4 ตัว (ผู้ช่วย/คู่มือ/โปรไฟล์/ออก) ถ้าใช้ padding ชุดเดียวกัน
          ทั้งสองโหมด รางจะดูอัดกันจนแยกไม่ออกว่าอันไหนคืออะไร */}
      <div style={{ borderTop: '1px solid var(--app-border)', padding: mini ? '12px 10px 0' : '10px 10px 0', flexShrink: 0 }}>
        {[
          { href: '/admin/assistant', icon: <RobotOutlined />, label: t('admin_nav.assistant') },
          { href: '/admin/manual', icon: <BookOutlined />, label: t('admin.manual') },
        ].map((entry) => (
          <Tooltip key={entry.href} title={mini ? entry.label : ''} placement="right">
            <Link
              className="bms-sider-quiet"
              href={entry.href}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                justifyContent: mini ? 'center' : 'flex-start',
                padding: mini ? '8px 0' : '4px 8px', marginBottom: mini ? 8 : 6, borderRadius: 8,
                color: 'var(--text-secondary)', fontSize: 13,
              }}
            >
              {entry.icon}
              {!mini && <span>{entry.label}</span>}
            </Link>
          </Tooltip>
        ))}
      </div>
      {admin && (
        <div style={{ padding: mini ? '0 10px 12px' : '0 10px 10px', flexShrink: 0 }}>
          <Link
            className="bms-sider-quiet"
            href="/admin/profile"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: mini ? 'center' : 'flex-start',
              padding: mini ? '5px 0' : '4px', marginBottom: mini ? 12 : 8, borderRadius: 8,
              color: 'var(--app-text)',
            }}
          >
            <Avatar size={26} src={admin.avatar || undefined} icon={<UserOutlined />} />
            {!mini && (
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {admin.name || admin.username || admin.email}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{admin.role}</span>
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
                <MessageOutlined style={{ fontSize: 18, color: 'var(--text-secondary)' }} />
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
        <AdminCommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          items={searchableItems}
          labelFor={labelForNavItem}
          sectionLabelFor={sectionLabelForNavItem}
          iconFor={iconForNavItem}
          searchContext={{ locale: lang, permissions: perms, role: admin?.role, isPlatformAdmin }}
          t={t}
        />
      </>
    );
  }

  return (
    <>
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
      <AdminCommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={searchableItems}
        labelFor={labelForNavItem}
        sectionLabelFor={sectionLabelForNavItem}
        iconFor={iconForNavItem}
        searchContext={{ locale: lang, permissions: perms, role: admin?.role, isPlatformAdmin }}
        t={t}
      />
    </>
  );
}
