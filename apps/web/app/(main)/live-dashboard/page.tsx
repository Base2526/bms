'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { gql, useQuery } from "@apollo/client";
import { Alert, Result, Skeleton, Tooltip } from "antd";
import {
  BellOutlined,
  ExpandOutlined,
  FacebookFilled,
  InboxOutlined,
  InstagramOutlined,
  LoginOutlined,
  ReloadOutlined,
  RightOutlined,
  SettingOutlined,
  ShopOutlined,
  TikTokOutlined,
  YoutubeFilled,
} from "@ant-design/icons";
import Link from "next/link";

import { useSession } from "@/lib/useSession";

// =============================================================================
// สถานะปัจจุบันของหน้านี้:
// - เฟส 1 ต่อข้อมูลจริงแล้วสำหรับ KPI / alerts / recent orders / channel mix / trend /
//   top products / order status
// - low stock detail ต่อแล้วเมื่อผู้ใช้มี product.view
// - live-platform metrics (viewers/comments/conversion) ยังไม่มี data source จึงต้องคงสถานะ
//   pending ไว้ ห้ามกุข้อมูลขึ้นมาเติม
// - ?demo=1 ไม่ยิง query จริงและไม่ render dashboard ตัวอย่างแล้ว
// =============================================================================

const Q_PERMS = gql`
  query LiveDashboardPermissions {
    myBmsPermissions
  }
`;

const Q_DASH = gql`
  query LiveDashboardData {
    bmsDashboard {
      revenueToday
      customerCount
      orderCount
      lowStockCount
      ordersByStatus {
        status
        count
      }
      topProducts {
        sku
        name
        qty
        revenue
      }
      salesDaily {
        day
        revenue
        orders
      }
    }
  }
`;

const Q_ALERTS = gql`
  query LiveDashboardAlerts {
    bmsOperationalAlerts {
      packingOverdueCount
      slipPendingCount
      reservationExpiringCount
      chatWaitingCount
    }
  }
`;

const Q_SALES = gql`
  query LiveDashboardSales(
    $from: String,
    $to: String,
    $currentFrom: String,
    $currentTo: String,
    $previousFrom: String,
    $previousTo: String
  ) {
    bmsSalesSummary(from: $from, to: $to) {
      revenue
      orderCount
      byStatus {
        status
        count
      }
      byChannel {
        channel
        revenue
        orders
      }
    }
    currentWeek: bmsSalesSummary(from: $currentFrom, to: $currentTo) {
      byDay {
        day
        revenue
        orders
      }
    }
    previousWeek: bmsSalesSummary(from: $previousFrom, to: $previousTo) {
      byDay {
        day
        revenue
        orders
      }
    }
    todayTopProducts: bmsTopSellingProducts(from: $from, to: $to, limit: 5) {
      sku
      name
      qty
      revenue
    }
  }
`;

const Q_CHANNEL_HEALTH = gql`
  query LiveDashboardChannelHealth {
    bmsChannelHealth {
      channel
      active
      status
      status_detail
    }
  }
`;

const Q_ORDERS = gql`
  query LiveDashboardOrders {
    bmsOrders(limit: 5) {
      id
      channel
      customer_ref
      status
      amount_due
      created_at
    }
  }
`;

const Q_LOW_STOCK = gql`
  query LiveDashboardLowStock {
    bmsLowStock {
      sku
      name
      size
      available
      reorder_point
    }
  }
`;

function money(n: number) {
  return `฿${Math.round(n).toLocaleString("th-TH")}`;
}

function elapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

const BANGKOK_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function bangkokDateKey(value: number): string {
  const parts = BANGKOK_DATE_FORMATTER.formatToParts(new Date(value));
  const get = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function agoLabel(value: string | null | undefined, now: number) {
  if (!value) return "เมื่อสักครู่";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "เมื่อสักครู่";
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} วิ`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} นาที`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.`;
  const day = Math.floor(hr / 24);
  return `${day} วัน`;
}

function normalizeChannel(channel: string | null | undefined) {
  const key = String(channel ?? "").toLowerCase();
  if (key === "line") return "LINE";
  if (key === "tiktok") return "TikTok";
  if (key === "facebook") return "Facebook";
  if (key === "instagram") return "Instagram";
  if (key === "youtube") return "YouTube";
  if (key === "shopee") return "Shopee";
  if (key === "lazada") return "Lazada";
  if (key === "web") return "Web";
  return channel || "Other";
}

// TODO(real): ยังทำไม่ได้ — ต้องต่อ Live API ของแต่ละแพลตฟอร์มก่อน (ดู tier 3 ใน mockup)
const MOCK_LIVE_ONLY = {
  viewers: 12845,
  conversion: 11.49,
  comments: 5382,
};

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  LINE: <InboxOutlined />,
  TikTok: <TikTokOutlined />,
  Facebook: <FacebookFilled />,
  Instagram: <InstagramOutlined />,
  YouTube: <YoutubeFilled />,
  Shopee: <ShopOutlined />,
  Lazada: <ShopOutlined />,
  Web: <ShopOutlined />,
};

const CHANNEL_COLOR: Record<string, string> = {
  LINE: "#2dd4bf",
  TikTok: "#9b8cff",
  Facebook: "#ff7ab8",
  Instagram: "#f0a93c",
  YouTube: "#ef4444",
  Shopee: "#ee4d2d",
  Lazada: "#2563eb",
  Web: "#5b6778",
};

const HEALTH_COLOR = { ok: "#2dd4bf", warn: "#f0a93c", bad: "#ff5d5d", unknown: "#94a3b8" };
type HealthTone = keyof typeof HEALTH_COLOR;
type AlertTone = "hot" | "warn" | "calm";
type StatusTone = "warn" | "ok" | "calm" | "bad";

type LiveAlert = {
  key: string;
  label: string;
  value: number | null;
  tone: AlertTone;
  href: string | null;
};

type LiveChannelSale = {
  channel: string;
  revenue: number;
  orders: number;
  pct: number;
  color: string;
  health: HealthTone;
  note: string;
};

type LiveFeedItem = {
  id: string;
  who: string;
  channel: string;
  amount: number;
  ago: string;
  fresh: boolean;
};

type LiveOrderStatus = {
  status: string;
  label: string;
  count: number;
  tone: StatusTone;
};

type LowStockItem = {
  sku: string;
  name: string;
  size: string;
  available: number;
  reorder_point: number;
};

type DailySalesRow = { day: string; revenue: number; orders: number };
type StatusCountRow = { status: string; count: number };
type TopProductRow = { sku: string; name: string; qty: number; revenue: number };
type ChannelSalesRow = { channel: string; revenue: number; orders: number };
type ChannelHealthRow = { channel: string; active: boolean; status: string; status_detail?: string | null };
type RecentOrderRow = {
  id: string;
  channel: string;
  customer_ref?: string | null;
  amount_due: number;
  created_at: string;
};

type DisplayMode = "auto" | "tv" | "desk" | "compact";

const DISPLAY_MODES: Array<{ value: DisplayMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "tv", label: "TV" },
  { value: "desk", label: "Desk" },
  { value: "compact", label: "Compact" },
];

function MockTag({ title }: { title?: string }) {
  return (
    <Tooltip title={title ?? "ข้อมูลตัวอย่าง — ยังไม่ได้ต่อข้อมูลจริงของร้าน"}>
      <span className="ld-mock-tag">ตัวอย่าง</span>
    </Tooltip>
  );
}

function Delta({ value, unit = "%" }: { value: number | null; unit?: string }) {
  if (value === null) return <span className="ld-delta ld-delta--muted">— เทียบเมื่อวาน</span>;
  const up = value >= 0;
  return (
    <span className={`ld-delta ${up ? "" : "ld-delta--down"}`}>
      {up ? "↑" : "↓"} {Math.abs(value).toLocaleString("th-TH")}
      {unit}
    </span>
  );
}

/**
 * สร้าง path ของกราฟเส้นจากชุดตัวเลข
 * ⚠️ ต้องส่ง `max` ร่วมกันระหว่างเส้น "ช่วงนี้" กับ "ช่วงก่อนหน้า" เสมอ — ถ้าให้แต่ละเส้น
 * normalize ด้วย max ของตัวเอง เส้นทั้งสองจะสูงเท่ากันตลอดและการเทียบจะไม่มีความหมายเลย
 */
function trendPath(values: number[], max: number, width = 320, height = 100, close = false) {
  if (values.length === 0) return "";
  if (values.length === 1) {
    const y = Math.round((height - (values[0] / max) * (height - 8) - 4) * 10) / 10;
    const line = `M0,${y} L${width},${y}`;
    return close ? `${line} L${width},${height} L0,${height} Z` : line;
  }
  const stepX = width / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = Math.round(i * stepX * 10) / 10;
    const y = Math.round((height - (v / max) * (height - 8) - 4) * 10) / 10;
    return `${x},${y}`;
  });
  const line = `M${pts.join(" L")}`;
  return close ? `${line} L${width},${height} L0,${height} Z` : line;
}

export default function LiveDashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { admin: adminSession, loading: sessionLoading } = useSession();
  const isAdminSession = Boolean(adminSession);

  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "1";
  const requestedMode = searchParams.get("mode");
  const displayMode: DisplayMode =
    requestedMode === "tv" || requestedMode === "desk" || requestedMode === "compact" ? requestedMode : "auto";

  const frameRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [startedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // ฟัง fullscreenchange เพราะผู้ใช้ออกจากเต็มจอด้วย Esc ของเบราว์เซอร์เองได้ (ไม่ผ่านปุ่มเรา)
  // ถ้าไม่ฟัง state จะค้างเป็น true แล้ว label ปุ่มจะเพี้ยนเป็น "ออกจากเต็มจอ" ทั้งที่ออกมาแล้ว
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const { data: permsData, loading: permsLoading } = useQuery(Q_PERMS, {
    skip: !isAdminSession || isDemo,
    fetchPolicy: "cache-and-network",
  });
  const permissions: string[] = permsData?.myBmsPermissions ?? [];
  const canView = isDemo || (isAdminSession && permissions.includes("report.view"));
  const canViewOrders = isAdminSession && permissions.includes("order.view");
  const canViewLowStock = isAdminSession && permissions.includes("product.view");

  const today = bangkokDateKey(now);
  const salesRange = useMemo(() => {
    const base = new Date(`${today}T12:00:00Z`);
    const toIso = (offsetDays: number) => {
      const d = new Date(base);
      d.setDate(d.getDate() + offsetDays);
      return d.toISOString().slice(0, 10);
    };
    return {
      today,
      currentFrom: toIso(-6),
      currentTo: today,
      previousFrom: toIso(-13),
      previousTo: toIso(-7),
    };
  }, [today]);

  const {
    data: dashData,
    error: dashError,
    loading: dashLoading,
    refetch: refetchDash,
    networkStatus: dashNetworkStatus,
  } = useQuery(Q_DASH, {
    skip: !canView || isDemo,
    fetchPolicy: "cache-and-network",
    pollInterval: 30000,
    notifyOnNetworkStatusChange: true,
  });
  const {
    data: alertsData,
    error: alertsError,
    refetch: refetchAlerts,
    networkStatus: alertsNetworkStatus,
  } = useQuery(Q_ALERTS, {
    skip: !canView || isDemo,
    fetchPolicy: "cache-and-network",
    pollInterval: 30000,
    notifyOnNetworkStatusChange: true,
  });
  const {
    data: salesData,
    error: salesError,
    loading: salesLoading,
    refetch: refetchSales,
    networkStatus: salesNetworkStatus,
  } = useQuery(Q_SALES, {
    variables: {
      from: salesRange.today,
      to: salesRange.today,
      currentFrom: salesRange.currentFrom,
      currentTo: salesRange.currentTo,
      previousFrom: salesRange.previousFrom,
      previousTo: salesRange.previousTo,
    },
    skip: !canView || isDemo,
    fetchPolicy: "cache-and-network",
    pollInterval: 30000,
    notifyOnNetworkStatusChange: true,
  });
  const {
    data: channelHealthData,
    error: channelHealthError,
    refetch: refetchChannelHealth,
    networkStatus: channelHealthNetworkStatus,
  } = useQuery(Q_CHANNEL_HEALTH, {
    skip: !canView || isDemo,
    fetchPolicy: "cache-and-network",
    pollInterval: 30000,
    notifyOnNetworkStatusChange: true,
  });
  const {
    data: ordersData,
    error: ordersError,
    refetch: refetchOrders,
    networkStatus: ordersNetworkStatus,
  } = useQuery(Q_ORDERS, {
    skip: !canView || !canViewOrders || isDemo,
    fetchPolicy: "cache-and-network",
    pollInterval: 30000,
    notifyOnNetworkStatusChange: true,
  });
  const {
    data: lowStockData,
    error: lowStockError,
    refetch: refetchLowStock,
    networkStatus: lowStockNetworkStatus,
  } = useQuery(Q_LOW_STOCK, {
    skip: !canViewLowStock || isDemo,
    fetchPolicy: "cache-and-network",
    pollInterval: 30000,
    notifyOnNetworkStatusChange: true,
  });

  const dashboard = dashData?.bmsDashboard;
  const alerts = alertsData?.bmsOperationalAlerts;
  const channelHealthRows: ChannelHealthRow[] = channelHealthData?.bmsChannelHealth ?? [];
  const todaySales = salesData?.bmsSalesSummary;
  const currentWeek: DailySalesRow[] = salesData?.currentWeek?.byDay ?? [];
  const previousWeek: DailySalesRow[] = salesData?.previousWeek?.byDay ?? [];
  const todayTopProducts: TopProductRow[] = salesData?.todayTopProducts ?? [];
  const lowStockItems: LowStockItem[] = (lowStockData?.bmsLowStock ?? []).slice(0, 5);

  const daily: DailySalesRow[] = dashboard?.salesDaily ?? [];
  const currentDaily = currentWeek.length > 0 ? currentWeek : daily;
  const todayPoint = currentDaily[currentDaily.length - 1] ?? null;
  const yesterdayPoint = currentDaily[currentDaily.length - 2] ?? null;

  const revenueToday = Number(todaySales?.revenue ?? dashboard?.revenueToday ?? todayPoint?.revenue ?? 0);
  const ordersToday = Number(todaySales?.orderCount ?? todayPoint?.orders ?? 0);
  const avgToday = ordersToday > 0 ? revenueToday / ordersToday : 0;
  const avgYesterday = Number(yesterdayPoint?.orders ?? 0) > 0
    ? Number(yesterdayPoint?.revenue ?? 0) / Number(yesterdayPoint?.orders ?? 0)
    : 0;

  const hasComparison = Boolean(todayPoint && yesterdayPoint);
  const revenueDelta = !hasComparison
    ? null
    : Number(yesterdayPoint?.revenue ?? 0) > 0
    ? ((revenueToday - Number(yesterdayPoint?.revenue ?? 0)) / Number(yesterdayPoint?.revenue ?? 0)) * 100
    : 0;
  const orderDelta = hasComparison ? ordersToday - Number(yesterdayPoint?.orders ?? 0) : null;
  const avgDelta = !hasComparison ? null : avgYesterday > 0 ? ((avgToday - avgYesterday) / avgYesterday) * 100 : 0;

  const hasPermission = (permission: string) => permissions.includes(permission);

  const realAlerts: LiveAlert[] = [
    { key: "slip", label: "สลิปรอตรวจ", value: alerts ? Number(alerts.slipPendingCount) : null, tone: "hot", href: hasPermission("payment.view") ? "/admin/payment" : null },
    { key: "packing", label: "ค้างแพ็คเกินเวลา", value: alerts ? Number(alerts.packingOverdueCount) : null, tone: "warn", href: canViewOrders ? "/admin/orders" : null },
    { key: "chat", label: "แชทรอตอบ", value: alerts ? Number(alerts.chatWaitingCount) : null, tone: "hot", href: hasPermission("inbox.view") ? "/admin/inbox" : null },
    { key: "reserve", label: "สต็อกจองใกล้หมดอายุ", value: alerts ? Number(alerts.reservationExpiringCount) : null, tone: "calm", href: canViewOrders ? "/admin/orders" : null },
  ];

  const healthByChannel = new Map<string, { status: string; detail: string | null }>(
    channelHealthRows
      .filter((row) => row.active)
      .map((row) => [String(row.channel).toLowerCase(), { status: row.status, detail: row.status_detail ?? null }])
  );

  const salesByChannel = new Map<string, ChannelSalesRow>(
    ((todaySales?.byChannel ?? []) as ChannelSalesRow[]).map((row) => [String(row.channel).toLowerCase(), row])
  );
  const channelKeys = Array.from(new Set([...healthByChannel.keys(), ...salesByChannel.keys()]));
  const realChannelSales: LiveChannelSale[] = channelKeys.map((key, index) => {
    const row = salesByChannel.get(key);
    const channel = normalizeChannel(row?.channel ?? key);
    const revenue = Number(row?.revenue ?? 0);
    const orders = Number(row?.orders ?? 0);
    const totalRevenue = Math.max(Number(todaySales?.revenue ?? 0), 1);
    const pct = (revenue / totalRevenue) * 100;
    const palette = ["#2dd4bf", "#9b8cff", "#ff7ab8", "#f0a93c", "#5b6778", "#60a5fa", "#34d399"];
    const health = healthByChannel.get(key);
    const tone = !health
      ? "unknown"
      : health.status === "connected"
        ? "ok"
        : health.status === "no_events"
          ? "warn"
          : "bad";
    return {
      channel,
      revenue,
      orders,
      pct,
      color: CHANNEL_COLOR[channel] ?? palette[index % palette.length],
      health: tone,
      note: !health
        ? "ไม่พบสถานะเชื่อมต่อ"
        : health.status !== "connected"
          ? health.detail || health.status.replaceAll("_", " ")
          : "",
    };
  });

  const recentFeed: LiveFeedItem[] = ((ordersData?.bmsOrders ?? []) as RecentOrderRow[]).map((row) => {
    const channel = normalizeChannel(row.channel);
    const amount = Number(row.amount_due ?? 0);
    return {
      id: row.id,
      who: row.customer_ref || row.id.slice(0, 8),
      channel,
      amount,
      ago: agoLabel(row.created_at, now),
      fresh: now - new Date(row.created_at).getTime() < 5 * 60 * 1000,
    };
  });

  const statusMeta: Record<string, { label: string; tone: StatusTone }> = {
    PENDING: { label: "รอชำระ", tone: "warn" },
    PAID: { label: "จ่ายแล้ว", tone: "ok" },
    PACKING: { label: "กำลังแพ็ค", tone: "calm" },
    SHIPPED: { label: "จัดส่งแล้ว", tone: "calm" },
    COMPLETED: { label: "สำเร็จ", tone: "ok" },
    CANCELLED: { label: "ยกเลิก", tone: "bad" },
    RETURNED: { label: "คืนสินค้า", tone: "bad" },
  };
  const realStatus: LiveOrderStatus[] = ((todaySales?.byStatus ?? []) as StatusCountRow[])
    .filter((row) => statusMeta[row.status])
    .map((row) => ({ status: row.status, count: Number(row.count ?? 0), ...statusMeta[row.status] }));

  // max ร่วมของสองเส้นในกราฟ (ดูเหตุผลใน trendPath)
  const trendCurrent = currentWeek.map((row) => Number(row.revenue ?? 0));
  const trendPrev = previousWeek.map((row) => Number(row.revenue ?? 0));
  const trendMax = useMemo(() => Math.max(...trendCurrent, ...trendPrev, 1), [trendCurrent, trendPrev]);

  const channelDonutCss = useMemo(() => {
    const totalShare = realChannelSales.reduce((sum, channel) => sum + channel.pct, 0);
    if (totalShare <= 0) return "conic-gradient(#d1d5db 0 100%)";
    let acc = 0;
    const stops = realChannelSales.map((s: LiveChannelSale) => {
      const from = acc;
      acc += s.pct;
      return `${s.color} ${from}% ${acc}%`;
    });
    return stops.length > 0 ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(#d1d5db 0 100%)";
  }, [realChannelSales]);

  const syncErrors = [
    dashError && "ภาพรวม",
    alertsError && "งานค้าง",
    salesError && "ยอดขาย",
    channelHealthError && "สถานะช่องทาง",
    ordersError && "ออเดอร์ล่าสุด",
    lowStockError && "สินค้าใกล้หมด",
  ].filter(Boolean) as string[];
  const isRefreshing = [
    dashNetworkStatus,
    alertsNetworkStatus,
    salesNetworkStatus,
    channelHealthNetworkStatus,
    ordersNetworkStatus,
    lowStockNetworkStatus,
  ].includes(4);

  const refreshAll = async () => {
    const requests = [refetchDash(), refetchAlerts(), refetchSales(), refetchChannelHealth()];
    if (canViewOrders) requests.push(refetchOrders());
    if (canViewLowStock) requests.push(refetchLowStock());
    await Promise.allSettled(requests);
  };

  const toggleFullscreen = () => {
    const el = frameRef.current;
    if (!el) return;
    // state ที่แท้จริงมาจาก fullscreenchange ด้านบน ที่นี่แค่สั่งเข้า/ออก
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const setDisplayMode = (mode: DisplayMode) => {
    const params = new URLSearchParams(searchParams.toString());
    if (mode === "auto") params.delete("mode");
    else params.set("mode", mode);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  if (sessionLoading || (isAdminSession && !isDemo && permsLoading)) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (!isAdminSession && !isDemo) {
    return (
      <div style={{ padding: "48px 16px" }}>
        <Result
          icon={<LoginOutlined style={{ color: "var(--app-primary)" }} />}
          title="เข้าสู่ระบบเพื่อดูยอดขายสด"
          subTitle="ล็อกอินด้วยบัญชีเดียวกับหลังบ้าน ไม่ต้องเข้า /admin ก็เห็นยอดขายเรียลไทม์ของร้านได้ทันที"
          extra={
            <Link href="/admin/login?next=/live-dashboard">
              <button className="ld-primary-btn">
                <LoginOutlined /> เข้าสู่ระบบ
              </button>
            </Link>
          }
        />
      </div>
    );
  }

  if (isDemo) {
    return (
      <div style={{ padding: "48px 16px" }}>
        <Result
          status="info"
          title="Demo preview ของ Live Dashboard ยังไม่เปิดใช้หลังต่อข้อมูลจริง"
          subTitle="หน้านี้เริ่มใช้ query จริงแล้วในเฟส 1 จึงปิด demo mode ที่ไม่ล็อกอินไว้ก่อน เพื่อไม่ให้ preview ที่ไม่มีข้อมูลจริงดูเหมือนหน้าจอร้านสด"
          extra={
            <Link href="/admin/login?next=/live-dashboard">
              <button className="ld-primary-btn">
                <LoginOutlined /> เข้าสู่ระบบเพื่อดูข้อมูลจริง
              </button>
            </Link>
          }
        />
      </div>
    );
  }

  if (!permsLoading && !canView) {
    return (
      <div style={{ padding: "48px 16px" }}>
        <Result
          status="403"
          title="ไม่มีสิทธิ์ดูรายงาน"
          subTitle="บัญชีนี้ยังไม่มีสิทธิ์ report.view — ติดต่อผู้ดูแลร้านเพื่อขอสิทธิ์เข้าดู Live Dashboard"
        />
      </div>
    );
  }

  if (!dashData && !salesData && (dashLoading || salesLoading)) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    );
  }

  return (
    <div ref={frameRef} className={`ld-shell ld-shell--mode-${displayMode}`}>
        <div className="ld-layout">
          {/* ---------------- Sidebar: ช่องทาง + ยอดขาย + สถานะเชื่อมต่อ ---------------- */}
        <aside className="ld-sidebar">
          <div className="ld-sidebar-brand">
            <span className="ld-pulse" /> LIVE
          </div>
          <div className="ld-sidebar-item ld-sidebar-item--active">ภาพรวม</div>

          <div className="ld-sidebar-section">
            ช่องทาง
          </div>
          {/* บนมือถือ list นี้กลายเป็นแถบเลื่อนแนวนอน (ดู @media ท้ายไฟล์) จึงต้องมี wrapper จริง
              ไม่ใช่ปล่อยแถวลอยอยู่ใน aside ตรง ๆ */}
          <div className="ld-side-list">
            {salesError ? <p className="ld-empty-state">โหลดข้อมูลช่องทางไม่สำเร็จ</p> : null}
            {!salesError && salesData && realChannelSales.length === 0 ? (
              <p className="ld-empty-state">ยังไม่มีช่องทางที่เปิดใช้งานหรือมียอดขายวันนี้</p>
            ) : null}
            {realChannelSales.map((c: LiveChannelSale) => (
              <div className="ld-side-row" key={c.channel}>
                <span className="ld-side-dot" style={{ background: HEALTH_COLOR[c.health] }} />
                <span className="ld-side-name">
                  {CHANNEL_ICON[c.channel]} {c.channel}
                </span>
                <span className="ld-side-fig">
                  <b>{money(c.revenue)}</b>
                  <span style={c.note ? { color: HEALTH_COLOR[c.health] } : undefined}>
                    {c.note || `${c.orders} ออเดอร์`}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </aside>

        {/* ---------------- Main ---------------- */}
        <div className="ld-main">
          {/* บนมือถือคำอธิบายยาว ๆ กิน ~370px จาก 812px ดันตัวเลขจริงตกไปใต้ fold
              จึงซ่อนเฉพาะ description ไว้ (ดู @media) แต่ยังคงข้อความหลัก + ป้าย "ตัวอย่าง" ทุกจุดไว้ครบ */}
          <Alert
            className="ld-mock-banner"
            type="info"
            showIcon
            closable
            style={{ marginBottom: 16 }}
            message="เฟส 1 ต่อข้อมูลจริงแล้วสำหรับ KPI, งานค้าง, ออเดอร์ล่าสุด, ช่องทางขาย, กราฟ และสินค้าขายดี"
            description="สินค้าใกล้หมดจะแสดงเป็นรายการเมื่อบัญชีมี product.view; metric live platform (ผู้ชม/คอมเมนต์/conversion) ยังไม่มี data source จึงคงป้ายตัวอย่างไว้"
          />

          {syncErrors.length > 0 ? (
            <Alert
              className="ld-sync-alert"
              type="warning"
              showIcon
              closable
              style={{ marginBottom: 16 }}
              message={`ข้อมูลบางส่วนซิงก์ไม่สำเร็จ: ${syncErrors.join(", ")}`}
              description="ค่าที่โหลดไม่ได้จะแสดงเป็นขีดหรือข้อความแจ้งแทนเลขศูนย์ เพื่อไม่ให้สับสนกับข้อมูลจริง"
            />
          ) : null}

          <div className="ld-topbar">
            <div className="ld-topbar-left">
              <h1>LIVE Dashboard</h1>
              <span className="ld-status-pill">
                <span className="ld-pulse" />
                {isDemo ? "Demo · ข้อมูลตัวอย่าง" : "Live · ซิงก์ทุก 30 วินาที"}
              </span>
            </div>
            <div className="ld-topbar-right">
              <div className="ld-mode-switch" role="group" aria-label="เลือกมุมมองหน้าจอ">
                {DISPLAY_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    className={`ld-mode-btn ${displayMode === mode.value ? "ld-mode-btn--active" : ""}`}
                    onClick={() => setDisplayMode(mode.value)}
                    aria-pressed={displayMode === mode.value}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <Tooltip title={syncErrors.length > 0 ? `โหลดไม่ได้: ${syncErrors.join(", ")}` : "ซิงก์ข้อมูลล่าสุดสำเร็จ"}>
                <span className="ld-chip">{syncErrors.length > 0 ? "⚠ Sync บางส่วนล้มเหลว" : "✓ Source OK"}</span>
              </Tooltip>
              {/* ไม่มีปุ่มสลับธีมที่นี่ — ใช้ปุ่มเดียวใน HeaderBar เป็นจุดควบคุมเดียว (เดิมซ้ำกัน 2 ที่) */}
              <Link href="/notification" className="ld-icon-btn" aria-label="การแจ้งเตือน">
                <BellOutlined />
              </Link>
              <Link href="/admin/settings" className="ld-icon-btn" aria-label="ตั้งค่า">
                <SettingOutlined />
              </Link>
            </div>
          </div>

          <div className="ld-toolbar">
            <span className="ld-session-pill">
              <span className="ld-pulse" /> เปิดหน้านี้มาแล้ว {elapsed(now - startedAt)}
            </span>
            <div className="ld-toolbar-right">
              <button className="ld-chip ld-chip--btn" onClick={() => void refreshAll()} disabled={isRefreshing}>
                <ReloadOutlined spin={isRefreshing} /> รีเฟรชทั้งหมด
              </button>
              <button className="ld-chip ld-chip--btn ld-chip--accent" onClick={toggleFullscreen}>
                <ExpandOutlined /> {isFullscreen ? "ออกจากเต็มจอ" : "เต็มจอ"}
              </button>
            </div>
          </div>

          {/* ---- 1. KPI + เทียบเมื่อวาน ---- */}
          <div className="ld-kpi-grid">
            <div className="ld-kpi">
              <div className="ld-kpi-label">
                ยอดขายวันนี้
              </div>
              <div className="ld-kpi-value">{todaySales || dashboard ? money(revenueToday) : "—"}</div>
              <Delta value={revenueDelta} />
            </div>
            <div className="ld-kpi">
              <div className="ld-kpi-label">
                ออเดอร์วันนี้
              </div>
              <div className="ld-kpi-value">{todaySales || todayPoint ? ordersToday.toLocaleString("th-TH") : "—"}</div>
              <Delta value={orderDelta} unit=" ออเดอร์" />
            </div>
            <div className="ld-kpi">
              <div className="ld-kpi-label">
                ยอดเฉลี่ย/ออเดอร์
              </div>
              <div className="ld-kpi-value">{todaySales || todayPoint ? money(avgToday) : "—"}</div>
              <Delta value={avgDelta} />
            </div>
            <div className="ld-kpi">
              <div className="ld-kpi-label">
                ลูกค้าทั้งหมด
              </div>
              <div className="ld-kpi-value">{dashboard ? Number(dashboard.customerCount).toLocaleString("th-TH") : "—"}</div>
            </div>
          </div>

          {/* ---- 2. แถบงานค้าง ---- */}
          <div className="ld-alerts-head">
            งานค้างที่ต้องรีบทำ
          </div>
          <div className="ld-alerts">
            {realAlerts.map((a) => {
              const content = (
                <>
                  <span className="ld-alert-label">{a.label}</span>
                  <span className="ld-alert-value">{a.value === null ? "—" : a.value}</span>
                  {a.href ? <RightOutlined className="ld-alert-arrow" /> : null}
                </>
              );
              return a.href ? (
                <Link href={a.href} key={a.key} className={`ld-alert-tile ld-alert-tile--${a.tone}`}>
                  {content}
                </Link>
              ) : (
                <div
                  key={a.key}
                  className={`ld-alert-tile ld-alert-tile--${a.tone} ld-alert-tile--disabled`}
                  title="บัญชีนี้ดูจำนวนในรายงานได้ แต่ไม่มีสิทธิ์เปิดหน้าจัดการรายการนี้"
                >
                  {content}
                </div>
              );
            })}
          </div>

          {/* ---- 3. ออเดอร์ที่เพิ่งเข้า + สัดส่วนช่องทาง ---- */}
          <div className="ld-grid2 ld-section-live">
            <div className="ld-panel">
              <h2>
                ออเดอร์ที่เพิ่งเข้า
              </h2>
              <div className="ld-feed">
                {!canViewOrders ? (
                  <p className="ld-empty-state">ต้องมีสิทธิ์ order.view จึงดูรายการออเดอร์ล่าสุดได้</p>
                ) : ordersError ? (
                  <p className="ld-empty-state">โหลดออเดอร์ล่าสุดไม่สำเร็จ</p>
                ) : ordersData && recentFeed.length === 0 ? (
                  <p className="ld-empty-state">ยังไม่มีออเดอร์</p>
                ) : recentFeed.map((f: LiveFeedItem) => (
                  <div className={`ld-feed-row ${f.fresh ? "ld-feed-row--fresh" : ""}`} key={f.id}>
                    <span
                      className="ld-feed-ch"
                      style={{ background: realChannelSales.find((c: LiveChannelSale) => c.channel === f.channel)?.color ?? "#5b6778" }}
                    >
                      {CHANNEL_ICON[f.channel]}
                    </span>
                    <span className="ld-feed-who">{f.who}</span>
                    <span className="ld-feed-amt">{money(f.amount)}</span>
                    <span className="ld-feed-t">{f.ago}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="ld-panel">
              <h2>
                สัดส่วนยอดขายตามช่องทาง
              </h2>
              <div className="ld-donut-row">
                <div className="ld-donut" style={{ background: channelDonutCss }}>
                  <div className="ld-donut-center">
                    <b>{money(Number(todaySales?.revenue ?? 0))}</b>
                    <span>วันนี้</span>
                  </div>
                </div>
                <div className="ld-legend">
                  {salesError ? <p className="ld-empty-state">โหลดสัดส่วนยอดขายไม่สำเร็จ</p> : null}
                  {!salesError && salesData && realChannelSales.length === 0 ? (
                    <p className="ld-empty-state">วันนี้ยังไม่มียอดขายตามช่องทาง</p>
                  ) : null}
                  {realChannelSales.map((s: LiveChannelSale) => (
                    <div className="ld-legend-row" key={s.channel}>
                      <span className="ld-legend-dot" style={{ background: s.color }} />
                      {s.channel}
                      <b>
                        {Math.round(s.pct)}% · {s.orders}
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ---- 4. กราฟยอดขาย + สินค้าขายดี ---- */}
          <div className="ld-grid2 ld-section-analysis">
            <div className="ld-panel">
              <h2>
                ยอดขาย 7 วันล่าสุด
              </h2>
              {salesError ? (
                <p className="ld-empty-state">โหลดกราฟยอดขายไม่สำเร็จ</p>
              ) : (
                <>
                  <svg className="ld-chart" viewBox="0 0 320 100" preserveAspectRatio="none" role="img" aria-label="กราฟยอดขาย 7 วันล่าสุด">
                    <line x1="0" y1="25" x2="320" y2="25" className="ld-chart-grid" />
                    <line x1="0" y1="50" x2="320" y2="50" className="ld-chart-grid" />
                    <line x1="0" y1="75" x2="320" y2="75" className="ld-chart-grid" />
                    <path d={trendPath(trendPrev, trendMax)} className="ld-chart-prev" />
                    <path d={trendPath(trendCurrent, trendMax, 320, 100, true)} className="ld-chart-fill" />
                    <path d={trendPath(trendCurrent, trendMax)} className="ld-chart-line" />
                  </svg>
                  <div className="ld-chart-legend">
                    <span>
                      <i className="ld-chart-key" /> 7 วันล่าสุด
                    </span>
                    <span>
                      <i className="ld-chart-key ld-chart-key--prev" /> 7 วันก่อนหน้า
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="ld-panel">
              <h2>
                สินค้าขายดีวันนี้
              </h2>
              <div className="ld-table-wrap">
                <table className="ld-table">
                  <thead>
                    <tr>
                      <th>สินค้า</th>
                      <th style={{ textAlign: "right" }}>จำนวน</th>
                      <th style={{ textAlign: "right" }}>ยอดขาย</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayTopProducts.map((p) => (
                      <tr key={p.sku}>
                        <td className="ld-table-name">{p.name}</td>
                        <td className="ld-table-num">{Number(p.qty ?? 0).toLocaleString("th-TH")}</td>
                        <td className="ld-table-num">{money(Number(p.revenue ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {salesError ? <p className="ld-empty-state">โหลดสินค้าขายดีไม่สำเร็จ</p> : null}
                {!salesError && salesData && todayTopProducts.length === 0 ? (
                  <p className="ld-empty-state">วันนี้ยังไม่มีสินค้าขายดี</p>
                ) : null}
              </div>
            </div>
          </div>

          {/* ---- 5. สถานะออเดอร์ + สินค้าใกล้หมด + metric ที่ยังต่อไม่ได้ ---- */}
          <div className="ld-grid2 ld-section-operations">
            <div className="ld-panel">
              <h2>
                ออเดอร์วันนี้ตามสถานะ
              </h2>
              {salesError ? <p className="ld-empty-state">โหลดสถานะออเดอร์ไม่สำเร็จ</p> : null}
              {!salesError && salesData && realStatus.length === 0 ? <p className="ld-empty-state">วันนี้ยังไม่มีออเดอร์</p> : null}
              {realStatus.map((s: LiveOrderStatus) => (
                <div className="ld-status-row" key={s.status}>
                  <span className={`ld-pill ld-pill--${s.tone}`}>{s.label}</span>
                  <b>{s.count}</b>
                </div>
              ))}

              <h2 style={{ marginTop: 18 }}>
                สินค้าใกล้หมด
              </h2>
              {canViewLowStock ? (
                <div className="ld-table-wrap">
                  {lowStockError ? <p className="ld-empty-state">โหลดสินค้าใกล้หมดไม่สำเร็จ</p> : null}
                  <table className="ld-table">
                    <tbody>
                      {lowStockItems.map((p: LowStockItem) => (
                        <tr key={`${p.sku}:${p.size}`}>
                          <td className="ld-table-name">
                            {p.name}
                            <div className="ld-low-stock-meta">
                              {p.sku} · {p.size}
                            </div>
                          </td>
                          <td className="ld-table-num">
                            เหลือ {Number(p.available).toLocaleString("th-TH")}
                            <div className="ld-low-stock-meta">
                              จุดสั่งซื้อ {Number(p.reorder_point).toLocaleString("th-TH")}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lowStockData && lowStockItems.length === 0 ? <p className="ld-empty-state">ไม่มีสินค้าใกล้หมด</p> : null}
                </div>
              ) : (
                <>
                  <div className="ld-low-stock-summary">
                    <b>{Number(dashboard?.lowStockCount ?? 0).toLocaleString("th-TH")}</b>
                    <span>SKU ใกล้หมดในระบบ</span>
                  </div>
                  <p className="ld-pending-note" style={{ marginTop: 10, marginBottom: 0 }}>
                    บัญชีนี้มีสิทธิ์ดูรายงาน แต่ยังไม่มี `product.view` จึงแสดงได้เฉพาะจำนวนรวม
                  </p>
                </>
              )}
            </div>

            <div className="ld-panel ld-panel--pending">
              <h2>
                ผู้ชม · Conversion · คอมเมนต์
                <MockTag title="ยังทำไม่ได้จริง — ต้องต่อ Live API ของแต่ละแพลตฟอร์มก่อน (Facebook Live / TikTok Live / Shopee-Lazada Live)" />
              </h2>
              <p className="ld-pending-note">
                กลุ่มนี้ต่างจากที่อื่นในหน้านี้ — ไม่ใช่แค่ยังไม่ได้ต่อ แต่ <b>ยังไม่มีข้อมูลใน BMS ให้ต่อเลย</b>
                ต้องขออนุญาตและต่อ Live API ของแต่ละแพลตฟอร์มแยกกันก่อน
              </p>
              <div className="ld-pending-grid">
                <div>
                  <div className="ld-kpi-label">ผู้ชมรวม</div>
                  <div className="ld-kpi-value">{MOCK_LIVE_ONLY.viewers.toLocaleString("th-TH")}</div>
                </div>
                <div>
                  <div className="ld-kpi-label">Conversion</div>
                  <div className="ld-kpi-value">{MOCK_LIVE_ONLY.conversion}%</div>
                </div>
                <div>
                  <div className="ld-kpi-label">คอมเมนต์</div>
                  <div className="ld-kpi-value">{MOCK_LIVE_ONLY.comments.toLocaleString("th-TH")}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .ld-shell {
          background: var(--app-bg);
          border-radius: 12px;
          overflow: hidden;
        }

        .ld-layout {
          display: flex;
          min-height: 560px;
          min-width: 0;
        }

        /* ---------------- sidebar ---------------- */
        .ld-sidebar {
          width: 226px;
          flex: none;
          min-width: 226px;
          background: var(--app-bg);
          border-right: 1px solid var(--app-border);
          padding: 18px 12px;
        }

        .ld-sidebar-brand {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 800;
          font-size: 13px;
          color: var(--app-text);
          margin-bottom: 18px;
          padding: 0 4px;
        }

        .ld-sidebar-item {
          font-size: 12.5px;
          color: var(--text-secondary);
          padding: 8px 9px;
          border-radius: 8px;
          margin-bottom: 2px;
        }

        .ld-sidebar-item--active {
          background: var(--app-surface-2);
          color: var(--app-text);
          font-weight: 700;
        }

        .ld-sidebar-section {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-soft);
          margin: 16px 4px 6px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .ld-side-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px;
          border-radius: 8px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .ld-side-row + .ld-side-row {
          border-top: 1px solid var(--app-border);
        }

        .ld-side-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex: none;
        }

        .ld-side-name {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--app-text);
          font-weight: 600;
          min-width: 0;
        }

        .ld-side-fig {
          margin-left: auto;
          text-align: right;
          line-height: 1.25;
          min-width: 0;
        }

        .ld-side-fig b {
          display: block;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
          color: var(--app-text);
        }

        .ld-side-fig span {
          font-size: 10px;
          color: var(--text-soft);
        }

        /* ---------------- main / topbar ---------------- */
        .ld-main {
          flex: 1;
          min-width: 0;
          padding: 20px 22px 26px;
        }

        .ld-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 16px;
        }

        .ld-topbar-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .ld-topbar-left h1 {
          margin: 0;
          font-size: 21px;
          font-weight: 800;
          letter-spacing: -0.01em;
          color: var(--app-text);
        }

        .ld-status-pill, .ld-session-pill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          background: var(--app-surface-2);
          border: 1px solid var(--app-border);
          padding: 5px 12px;
          border-radius: 999px;
        }

        .ld-session-pill { font-variant-numeric: tabular-nums; }

        .ld-pulse {
          position: relative;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #ff4d4f;
          flex: none;
        }

        .ld-pulse::after {
          content: "";
          position: absolute;
          inset: -5px;
          border-radius: 50%;
          border: 1.5px solid #ff4d4f;
          animation: ld-pulse-anim 1.8s ease-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .ld-pulse::after { animation: none; opacity: .5; }
        }

        @keyframes ld-pulse-anim {
          0% { transform: scale(.5); opacity: .9; }
          100% { transform: scale(2); opacity: 0; }
        }

        .ld-topbar-right, .ld-toolbar-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ld-mode-switch {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px;
          border-radius: 10px;
          background: var(--app-surface-2);
          border: 1px solid var(--app-border);
        }

        .ld-mode-btn {
          border: none;
          background: transparent;
          color: var(--text-secondary);
          padding: 6px 10px;
          border-radius: 8px;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .ld-mode-btn--active {
          background: var(--app-surface);
          color: var(--app-text);
          box-shadow: 0 1px 1px rgba(0, 0, 0, 0.04);
        }

        .ld-mode-btn:focus-visible,
        .ld-chip--btn:focus-visible,
        .ld-icon-btn:focus-visible {
          outline: 2px solid var(--app-primary);
          outline-offset: 2px;
        }

        .ld-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 16px;
        }

        .ld-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--text-secondary);
          background: var(--app-surface-2);
          border: 1px solid var(--app-border);
          padding: 6px 11px;
          border-radius: 8px;
        }

        .ld-chip--btn { cursor: pointer; font-family: inherit; }
        .ld-chip--btn:disabled { cursor: wait; opacity: 0.65; }

        .ld-chip--accent {
          color: var(--app-primary);
          border-color: rgba(var(--app-primary-rgb), 0.35);
        }

        .ld-icon-btn {
          width: 34px;
          height: 34px;
          border-radius: 9px;
          background: var(--app-surface-2);
          border: 1px solid var(--app-border);
          color: var(--text-secondary);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 15px;
        }

        .ld-icon-btn:hover {
          border-color: rgba(var(--app-primary-rgb), 0.4);
          color: var(--app-primary);
        }

        .ld-primary-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 700;
          color: #fff;
          background: var(--app-primary);
          border: none;
          padding: 10px 18px;
          border-radius: 10px;
          cursor: pointer;
        }

        .ld-mock-tag {
          display: inline-flex;
          align-items: center;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: #d97706;
          background: rgba(217, 119, 6, 0.12);
          border: 1px dashed rgba(217, 119, 6, 0.55);
          padding: 1px 6px;
          border-radius: 999px;
          text-transform: none;
          cursor: help;
          flex: none;
        }

        /* ---------------- KPI ---------------- */
        .ld-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 18px;
        }

        @media (max-width: 900px) {
          .ld-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        .ld-kpi {
          background: var(--app-surface);
          border: 1px solid var(--app-border);
          border-radius: 12px;
          padding: 15px 16px;
          min-width: 0;
        }

        .ld-kpi-label {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: var(--text-soft);
          margin-bottom: 8px;
        }

        .ld-kpi-value {
          font-size: 21px;
          font-weight: 800;
          letter-spacing: -0.01em;
          color: var(--app-text);
          font-variant-numeric: tabular-nums;
        }

        .ld-delta {
          display: inline-block;
          margin-top: 5px;
          font-size: 11px;
          font-weight: 700;
          color: #16a34a;
          font-variant-numeric: tabular-nums;
        }

        .ld-delta--down { color: #dc2626; }

        /* ---------------- แถบงานค้าง ---------------- */
        .ld-alerts-head {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-soft);
          margin-bottom: 8px;
        }

        .ld-alerts {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 18px;
        }

        @media (max-width: 900px) {
          .ld-alerts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        /* เป็น <a> (Link) จึงต้องล้าง underline ที่ globals.css ใส่ให้ลิงก์ทุกตัว
           ไม่งั้นทั้ง label และตัวเลขจะขีดเส้นใต้ ดูเหมือนข้อความลิงก์ ไม่ใช่การ์ดตัวเลข */
        .ld-alert-tile,
        .ld-alert-tile:hover {
          text-decoration: none;
        }

        .ld-alert-tile {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--app-surface);
          border: 1px solid var(--app-border);
          border-left: 3px solid var(--app-border);
          border-radius: 10px;
          padding: 12px 13px;
          min-width: 0;
          color: var(--text-secondary);
        }

        .ld-alert-tile:hover { border-color: rgba(var(--app-primary-rgb), 0.4); }

        .ld-alert-tile--hot {
          border-left-color: #dc2626;
          background: rgba(220, 38, 38, 0.06);
        }

        .ld-alert-tile--warn { border-left-color: #d97706; }

        .ld-alert-label {
          font-size: 11.5px;
          font-weight: 600;
          line-height: 1.35;
          min-width: 0;
        }

        .ld-alert-value {
          margin-left: auto;
          font-size: 20px;
          font-weight: 800;
          color: var(--app-text);
          font-variant-numeric: tabular-nums;
        }

        .ld-alert-tile--hot .ld-alert-value { color: #dc2626; }

        .ld-alert-arrow { font-size: 10px; color: var(--text-soft); flex: none; }

        /* ---------------- panels ---------------- */
        .ld-grid2 {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 14px;
          margin-bottom: 14px;
        }

        @media (max-width: 900px) {
          .ld-grid2 { grid-template-columns: minmax(0, 1fr); }
          .ld-layout { flex-direction: column; }
          .ld-sidebar { width: 100%; min-width: 0; border-right: none; border-bottom: 1px solid var(--app-border); }
        }

        /* =================== มือถือ (≤ 640px) ===================
           หลักคิด: หน้านี้เป็นจอเฝ้าตัวเลข ไม่ใช่หน้าอ่าน — บนมือถือจึงต้องเห็น "ยอดขาย + งานค้าง"
           ครบในหน้าจอแรกโดยไม่ต้องเลื่อนหา ส่วนที่กว้างเกิน (ช่องทาง/ตาราง) ให้เลื่อนในกรอบตัวเอง
           ห้ามปล่อยให้ดันหน้าเลื่อนแนวนอน */
        @media (max-width: 640px) {
          .ld-shell { border-radius: 10px; }
          .ld-main { padding: 14px 12px 20px; }

          /* ย่อแบนเนอร์เตือนให้เหลือบรรทัดเดียว คืนพื้นที่ให้ตัวเลขที่เป็นเหตุผลของหน้านี้
             (นี่คือ <style> ธรรมดา ไม่ใช่ CSS Module — ห้ามใช้ :global() จะกลายเป็น CSS ที่ถูกทิ้ง) */
          .ld-mock-banner { margin-bottom: 12px !important; padding: 8px 12px !important; }
          .ld-mock-banner .ant-alert-description { display: none; }
          .ld-mock-banner .ant-alert-message { font-size: 12px; line-height: 1.45; }

          /* --- sidebar กลายเป็นแถบช่องทางเลื่อนแนวนอน ไม่กินความสูงเป็นลิสต์ยาว --- */
          .ld-sidebar { padding: 12px; }
          .ld-sidebar-brand { margin-bottom: 10px; }
          .ld-sidebar-item { display: none; }
          .ld-sidebar-section { margin: 0 0 8px; }

          .ld-side-list {
            display: flex;
            gap: 8px;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            padding-bottom: 2px;
          }

          .ld-side-list::-webkit-scrollbar { display: none; }

          .ld-side-row {
            position: relative;
            flex: none;
            min-width: 148px;
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
            padding: 10px 11px 10px 24px;
            background: var(--app-surface);
            border: 1px solid var(--app-border);
            border-radius: 10px;
          }

          /* เดสก์ท็อปคั่นแถวด้วยเส้นบน (rule ด้านบน) แต่บนมือถือแต่ละใบมีขอบรอบตัวเองแล้ว
             จึงต้องล้างเส้นคั่นนั้น ไม่งั้นขอบด้านบนจะหนาเป็นสองชั้น */
          .ld-side-row + .ld-side-row { border-top-width: 1px; }

          /* จุดสถานะย้ายไปมุมซ้ายบนของการ์ด (เดิมอยู่ในแถว flex เดียวกับชื่อ) */
          .ld-side-dot { position: absolute; left: 10px; top: 14px; }
          .ld-side-fig { margin-left: 0; text-align: left; }

          /* --- KPI: 2 คอลัมน์ ตัวเลขยังต้องใหญ่พออ่านผ่าน ๆ ได้ --- */
          .ld-topbar { gap: 8px; margin-bottom: 12px; }
          .ld-topbar-left { gap: 8px; }
          .ld-topbar-left h1 { font-size: 18px; }
          .ld-mode-switch { width: 100%; justify-content: space-between; }
          .ld-mode-btn { flex: 1; padding: 7px 8px; }
          .ld-toolbar { margin-bottom: 12px; }
          .ld-kpi-grid { gap: 8px; margin-bottom: 14px; }
          .ld-kpi { padding: 12px 13px; border-radius: 10px; }
          .ld-kpi-label { font-size: 10px; margin-bottom: 6px; }
          .ld-kpi-value { font-size: 18px; }
          .ld-delta { font-size: 10.5px; }

          /* --- งานค้าง: 2x2 ตัวเลขเด่นไว้ เพราะเป็นเหตุผลหลักที่เปิดหน้านี้บนมือถือ --- */
          .ld-alerts { gap: 8px; margin-bottom: 14px; }
          .ld-alert-tile { padding: 10px 11px; border-radius: 9px; }
          .ld-alert-label { font-size: 11px; }
          .ld-alert-value { font-size: 18px; }
          .ld-alert-arrow { display: none; }

          /* --- panel --- */
          .ld-grid2 { gap: 10px; margin-bottom: 10px; }
          .ld-panel { padding: 14px; border-radius: 10px; }
          .ld-panel h2 { font-size: 12.5px; margin-bottom: 11px; }

          .ld-donut-row { gap: 14px; justify-content: center; }
          .ld-donut { width: 108px; height: 108px; }
          .ld-donut::after { inset: 19px; }
          .ld-legend { min-width: 100%; font-size: 12px; }

          .ld-chart { height: 104px; }
          .ld-feed-row { font-size: 12px; gap: 8px; }
          .ld-feed-ch { width: 20px; height: 20px; font-size: 10px; }
          .ld-table { font-size: 12px; }
          .ld-pending-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .ld-pending-note { font-size: 11.5px; }
        }

        .ld-panel {
          background: var(--app-surface);
          border: 1px solid var(--app-border);
          border-radius: 12px;
          padding: 18px;
          min-width: 0;
        }

        .ld-panel h2 {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin: 0 0 14px;
          font-size: 13.5px;
          font-weight: 700;
          color: var(--app-text);
        }

        .ld-panel--pending { border-style: dashed; }

        .ld-pending-note {
          margin: 0 0 14px;
          font-size: 12px;
          line-height: 1.6;
          color: var(--text-soft);
        }

        .ld-pending-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          opacity: 0.62;
        }

        /* ---------------- feed ---------------- */
        .ld-feed { display: flex; flex-direction: column; }

        .ld-feed-row {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 9px 0;
          border-bottom: 1px solid var(--app-border);
          font-size: 12.5px;
          color: var(--text-secondary);
        }

        .ld-feed-row:last-child { border-bottom: none; }

        .ld-empty-state {
          margin: 8px 0;
          color: var(--text-soft);
          font-size: 12px;
          line-height: 1.5;
        }

        .ld-feed-ch {
          width: 22px;
          height: 22px;
          border-radius: 7px;
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #fff;
        }

        .ld-feed-who {
          color: var(--app-text);
          font-weight: 600;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ld-feed-amt {
          margin-left: auto;
          font-weight: 700;
          color: var(--app-text);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        .ld-feed-row--fresh .ld-feed-amt { color: #16a34a; }

        .ld-feed-t {
          color: var(--text-soft);
          font-size: 10.5px;
          white-space: nowrap;
          min-width: 44px;
          text-align: right;
        }

        /* ---------------- donut ---------------- */
        .ld-donut-row {
          display: flex;
          align-items: center;
          gap: 18px;
          flex-wrap: wrap;
        }

        .ld-donut {
          width: 126px;
          height: 126px;
          border-radius: 50%;
          flex: none;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .ld-donut::after {
          content: "";
          position: absolute;
          inset: 22px;
          border-radius: 50%;
          background: var(--app-surface);
        }

        .ld-donut-center { position: relative; z-index: 1; text-align: center; }

        .ld-donut-center b {
          display: block;
          font-size: 14px;
          font-weight: 800;
          color: var(--app-text);
          font-variant-numeric: tabular-nums;
        }

        .ld-donut-center span { font-size: 10px; color: var(--text-soft); }

        .ld-legend { flex: 1; min-width: 170px; font-size: 12.5px; }

        .ld-legend-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 0;
          color: var(--text-secondary);
        }

        .ld-legend-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }

        .ld-legend-row b {
          margin-left: auto;
          color: var(--app-text);
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }

        /* ---------------- chart ---------------- */
        .ld-chart { width: 100%; height: 128px; display: block; }
        .ld-chart-grid { stroke: var(--app-border); stroke-width: 1; }
        .ld-chart-prev { fill: none; stroke: var(--text-soft); stroke-width: 1.5; stroke-dasharray: 3 3; }
        .ld-chart-fill { fill: rgba(var(--app-primary-rgb), 0.12); }
        .ld-chart-line { fill: none; stroke: var(--app-primary); stroke-width: 2; }

        .ld-chart-legend {
          display: flex;
          gap: 16px;
          margin-top: 10px;
          font-size: 11px;
          color: var(--text-secondary);
        }

        .ld-chart-legend span { display: inline-flex; align-items: center; gap: 6px; }

        .ld-chart-key {
          width: 14px;
          height: 2px;
          background: var(--app-primary);
          display: inline-block;
        }

        .ld-chart-key--prev {
          background: none;
          border-top: 2px dashed var(--text-soft);
          height: 0;
        }

        /* ---------------- table / status ---------------- */
        /* ตารางต้องเลื่อนในกรอบตัวเอง ไม่ดันหน้าให้เลื่อนแนวนอนทั้งหน้า (บทเรียนจากรอบ header ล้นจอ) */
        .ld-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }

        .ld-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }

        .ld-table th {
          text-align: left;
          color: var(--text-soft);
          font-weight: 700;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          padding: 0 0 9px;
          border-bottom: 1px solid var(--app-border);
        }

        .ld-table td {
          padding: 9px 0;
          border-bottom: 1px solid var(--app-border);
          color: var(--text-secondary);
        }

        .ld-table tr:last-child td { border-bottom: none; }

        .ld-table-name { color: var(--app-text); font-weight: 600; }

        .ld-table-num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          color: var(--app-text);
        }

        .ld-status-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 0;
          font-size: 12.5px;
        }

        .ld-status-row b { font-variant-numeric: tabular-nums; color: var(--app-text); }

        .ld-alert-tile--disabled {
          cursor: not-allowed;
          opacity: 0.72;
        }

        .ld-delta--muted {
          color: var(--text-soft);
        }

        .ld-low-stock-summary {
          display: flex;
          align-items: baseline;
          gap: 8px;
          padding: 4px 0 2px;
        }

        .ld-low-stock-summary b {
          font-size: 28px;
          line-height: 1;
          font-weight: 800;
          color: var(--app-text);
          font-variant-numeric: tabular-nums;
        }

        .ld-low-stock-summary span {
          font-size: 12px;
          color: var(--text-soft);
        }

        .ld-low-stock-meta {
          font-size: 10.5px;
          color: var(--text-soft);
          margin-top: 3px;
        }

        .ld-pill {
          font-size: 11.5px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 999px;
          border: 1px solid var(--app-border);
          color: var(--text-secondary);
          background: var(--app-surface-2);
        }

        .ld-pill--ok { color: #16a34a; border-color: rgba(22, 163, 74, 0.4); background: rgba(22, 163, 74, 0.08); }
        .ld-pill--warn { color: #d97706; border-color: rgba(217, 119, 6, 0.4); background: rgba(217, 119, 6, 0.08); }
        .ld-pill--bad { color: #dc2626; border-color: rgba(220, 38, 38, 0.4); background: rgba(220, 38, 38, 0.08); }

        .ld-shell--mode-tv .ld-mock-banner,
        .ld-shell--mode-compact .ld-mock-banner {
          display: none;
        }

        @media (min-width: 901px) {
          .ld-shell--mode-tv .ld-main {
            padding: 24px 26px 30px;
          }

          .ld-shell--mode-tv .ld-kpi-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }

          .ld-shell--mode-tv .ld-kpi {
            padding: 18px 20px;
          }

          .ld-shell--mode-tv .ld-kpi-value {
            font-size: 30px;
          }

          .ld-shell--mode-desk .ld-sidebar {
            width: 190px;
            min-width: 190px;
            padding: 14px 10px;
          }
        }

        .ld-shell--mode-tv .ld-section-operations,
        .ld-shell--mode-tv .ld-panel--pending {
          display: none;
        }

        .ld-shell--mode-tv .ld-feed-row,
        .ld-shell--mode-tv .ld-legend,
        .ld-shell--mode-tv .ld-table,
        .ld-shell--mode-tv .ld-status-row {
          font-size: 14px;
        }

        .ld-shell--mode-desk .ld-main {
          padding: 16px 18px 22px;
        }

        .ld-shell--mode-desk .ld-kpi,
        .ld-shell--mode-desk .ld-panel {
          padding: 14px;
        }

        .ld-shell--mode-desk .ld-kpi-value {
          font-size: 22px;
        }

        .ld-shell--mode-desk .ld-grid2,
        .ld-shell--mode-desk .ld-kpi-grid,
        .ld-shell--mode-desk .ld-alerts {
          gap: 10px;
        }

        .ld-shell--mode-compact .ld-sidebar,
        .ld-shell--mode-compact .ld-section-analysis,
        .ld-shell--mode-compact .ld-section-operations,
        .ld-shell--mode-compact .ld-panel--pending,
        .ld-shell--mode-compact .ld-sync-alert .ant-alert-description {
          display: none;
        }

        .ld-shell--mode-compact .ld-layout {
          display: block;
        }

        .ld-shell--mode-compact .ld-main {
          padding: 16px 16px 22px;
        }

        .ld-shell--mode-compact .ld-kpi-grid,
        .ld-shell--mode-compact .ld-alerts {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .ld-shell--mode-compact .ld-grid2 {
          grid-template-columns: minmax(0, 1fr);
        }

        /* ---------- โหมดเต็มจอ ----------
           use case คือเสียบจอทีวี/มอนิเตอร์แยกในร้านให้ทีมยืนดูระหว่างไลฟ์ จึงต้อง
           (1) ยืดเนื้อหาให้เต็มความสูงจริง ไม่กองอยู่ด้านบนแล้วเหลือพื้นที่ว่างครึ่งจอ
           (2) ขยายตัวเลขให้อ่านได้จากที่นั่งไกลจอ
           ใช้ :fullscreen แทนการผูกกับ state React เพื่อให้ style ตรงกับสถานะจริงของเบราว์เซอร์เสมอ */
        .ld-shell:fullscreen {
          border-radius: 0;
          height: 100vh;
          overflow-y: auto;
        }

        .ld-shell:fullscreen .ld-layout {
          min-height: 100vh;
          align-items: stretch;
        }

        .ld-shell:fullscreen .ld-sidebar {
          width: 250px;
          min-width: 250px;
          padding: 26px 16px;
        }

        .ld-shell:fullscreen .ld-main {
          display: flex;
          flex-direction: column;
          padding: 26px 30px 30px;
        }

        .ld-shell:fullscreen .ld-topbar-left h1 { font-size: 27px; }
        .ld-shell:fullscreen .ld-kpi { padding: 20px 22px; }
        .ld-shell:fullscreen .ld-kpi-label { font-size: 12.5px; }
        .ld-shell:fullscreen .ld-kpi-value { font-size: 32px; }
        .ld-shell:fullscreen .ld-delta { font-size: 12.5px; }
        .ld-shell:fullscreen .ld-alert-value { font-size: 26px; }
        .ld-shell:fullscreen .ld-alert-label { font-size: 13px; }

        /* ให้แถวการ์ดสุดท้ายกินความสูงที่เหลือ แทนที่จะปล่อยจอว่างด้านล่าง */
        .ld-shell:fullscreen .ld-grid2:last-child {
          flex: 1;
          min-height: 0;
          margin-bottom: 0;
        }

        .ld-shell:fullscreen .ld-panel { padding: 22px; }
        .ld-shell:fullscreen .ld-panel h2 { font-size: 15px; }
        .ld-shell:fullscreen .ld-donut { width: 168px; height: 168px; }
        .ld-shell:fullscreen .ld-donut::after { inset: 29px; }
        .ld-shell:fullscreen .ld-donut-center b { font-size: 17px; }
        .ld-shell:fullscreen .ld-legend { font-size: 14.5px; }
        .ld-shell:fullscreen .ld-legend-row { padding: 7px 0; }
        .ld-shell:fullscreen .ld-feed-row { font-size: 14.5px; padding: 12px 0; }
        .ld-shell:fullscreen .ld-feed-ch { width: 26px; height: 26px; }
        .ld-shell:fullscreen .ld-table { font-size: 14.5px; }
        .ld-shell:fullscreen .ld-table td { padding: 12px 0; }
        .ld-shell:fullscreen .ld-chart { height: 168px; }
        .ld-shell:fullscreen .ld-side-row { font-size: 13.5px; }
        .ld-shell:fullscreen .ld-sidebar-item { font-size: 14px; padding: 10px 11px; }
      `}</style>
    </div>
  );
}
