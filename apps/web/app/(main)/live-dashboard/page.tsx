'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
// ⚠️ สถานะของหน้านี้: เลย์เอาต์รอบนี้ยัง "ยังไม่ต่อข้อมูลจริง" ตามที่ตกลงกันไว้
//    ตัวเลขเกือบทั้งหมดในหน้านี้มาจากค่า MOCK_* ด้านล่าง และมีป้าย "ตัวอย่าง" กำกับทุกจุด
//    ห้ามถอดป้ายนั้นออกจนกว่าจะต่อ query จริงของแต่ละส่วนแล้ว (ผิดกฎ AI rules เรื่องห้ามกุ
//    ตัวเลขยอดขาย/สต็อก) — แผนการต่อข้อมูลจริงต่อส่วน ดูคอมเมนต์ // TODO(real): ในแต่ละก้อน
// =============================================================================

const Q_PERMS = gql`
  query LiveDashboardPermissions {
    myBmsPermissions
  }
`;

// query จริงตัวเดียวที่หน้านี้ยังเรียกอยู่ — ใช้แค่เช็คว่าเข้าถึงได้/มีสิทธิ์จริง
// ตัวเลขที่แสดงในหน้ายังไม่ได้ผูกกับผลลัพธ์นี้ (รอบถัดไปจะสลับมาใช้ของจริง)
const Q_DASH = gql`
  query LiveDashboardData {
    bmsDashboard {
      revenueToday
      orderCount
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

// ============================== MOCK DATA ====================================
// ทั้งหมดนี้เป็นค่าสมมติสำหรับ preview เลย์เอาต์ ไม่ใช่ข้อมูลของร้านจริง

// TODO(real): salesDaily[] จาก bmsDashboard (คำนวณ delta เทียบวันก่อนหน้าฝั่ง frontend)
const MOCK_KPI = {
  revenueToday: 48920,
  revenueDelta: 24.3,
  orderCount: 41,
  orderDelta: 8,
  avgOrderValue: 1193,
  avgDelta: -6.1,
  customerCount: 3209,
  customerDelta: 12,
};

// TODO(real): bmsOperationalAlerts (มี query พร้อมใช้แล้ว หน้า /admin/dashboard ใช้อยู่)
const MOCK_ALERTS = [
  { key: "slip", label: "สลิปรอตรวจ", value: 7, tone: "hot" as const, href: "/admin/payment" },
  { key: "packing", label: "ค้างแพ็คเกินเวลา", value: 3, tone: "warn" as const, href: "/admin/orders" },
  { key: "chat", label: "แชทรอตอบ", value: 12, tone: "hot" as const, href: "/admin/inbox" },
  { key: "reserve", label: "สต็อกจองใกล้หมดอายุ", value: 2, tone: "calm" as const, href: "/admin/orders" },
];

// TODO(real): bmsOrders(limit) เรียง created_at DESC
const MOCK_FEED = [
  { id: "1", who: "คุณนัชชา ท.", channel: "LINE", amount: 1290, ago: "12 วิ", fresh: true },
  { id: "2", who: "@beam.b", channel: "TikTok", amount: 890, ago: "48 วิ", fresh: true },
  { id: "3", who: "คุณปราวี ส.", channel: "Facebook", amount: 2150, ago: "2 นาที", fresh: false },
  { id: "4", who: "คุณกฤตพล ม.", channel: "LINE", amount: 640, ago: "4 นาที", fresh: false },
  { id: "5", who: "mayy.shop", channel: "Instagram", amount: 1780, ago: "6 นาที", fresh: false },
];

// TODO(real): bmsSalesSummary(from,to).byChannel — มี query จริงอยู่แล้ว ไม่ต้องต่อ API แพลตฟอร์ม
const MOCK_CHANNEL_SALES = [
  { channel: "LINE", revenue: 20050, orders: 18, pct: 41, color: "#2dd4bf", health: "ok" as const, note: "" },
  { channel: "TikTok", revenue: 13210, orders: 11, pct: 27, color: "#9b8cff", health: "ok" as const, note: "" },
  { channel: "Facebook", revenue: 7340, orders: 6, pct: 15, color: "#ff7ab8", health: "bad" as const, note: "token หมดอายุ" },
  { channel: "Instagram", revenue: 5380, orders: 4, pct: 11, color: "#f0a93c", health: "warn" as const, note: "ไม่มี event 3 วัน" },
  { channel: "Web", revenue: 2940, orders: 2, pct: 6, color: "#5b6778", health: "ok" as const, note: "" },
];

// TODO(real): salesDaily[] (รายวัน) — ถ้าอยากรายชั่วโมงในวันไลฟ์ ต้องเพิ่ม query ใหม่ 1 อัน
const MOCK_TREND_CURRENT = [12, 26, 22, 38, 32, 50, 46, 62, 56, 72, 76, 68, 86, 94];
const MOCK_TREND_PREV = [10, 18, 16, 30, 26, 40, 36, 50, 44, 58, 62, 56, 70, 78];

// TODO(real): bmsDashboard.topProducts (ข้อมูลจริงมีอยู่แล้ว รอบถัดไปสลับมาใช้ได้เลย)
const MOCK_TOP_PRODUCTS = [
  { sku: "SERUM-30", name: "เซรั่มบำรุงผิว 30ml", qty: 386, revenue: 324560 },
  { sku: "LIP-MATTE-12", name: "ลิปสติกเนื้อแมท 12 เฉด", qty: 278, revenue: 198760 },
  { sku: "VAC-CORDLESS", name: "เครื่องดูดฝุ่นไร้สาย", qty: 147, revenue: 145320 },
  { sku: "SUN-SPF50", name: "ครีมกันแดด SPF50+ PA++++", qty: 116, revenue: 98650 },
  { sku: "BT-ANC-PRO", name: "หูฟังบลูทูธ ANC Pro", qty: 89, revenue: 76540 },
];

// TODO(real): bmsDashboard.ordersByStatus
const MOCK_STATUS = [
  { status: "PENDING", label: "รอชำระ", count: 14, tone: "warn" as const },
  { status: "PAID", label: "จ่ายแล้ว", count: 18, tone: "ok" as const },
  { status: "PACKING", label: "พร้อมส่ง", count: 6, tone: "calm" as const },
  { status: "SHIPPED", label: "จัดส่งแล้ว", count: 3, tone: "calm" as const },
];

// TODO(real): lowStockCount มีใน query แล้ว แต่ "รายการ" ต้องดึงจาก bmsProducts/inventory
const MOCK_LOW_STOCK = [
  { sku: "SERUM-30", name: "เซรั่มบำรุงผิว 30ml", left: 2 },
  { sku: "LIP-04", name: "ลิปสติกเนื้อแมท · เฉด 04", left: 1 },
  { sku: "SUN-SPF50", name: "ครีมกันแดด SPF50+", left: 3 },
];

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
  Web: <ShopOutlined />,
};

const HEALTH_COLOR = { ok: "#2dd4bf", warn: "#f0a93c", bad: "#ff5d5d" };

function MockTag({ title }: { title?: string }) {
  return (
    <Tooltip title={title ?? "ข้อมูลตัวอย่าง — ยังไม่ได้ต่อข้อมูลจริงของร้าน"}>
      <span className="ld-mock-tag">ตัวอย่าง</span>
    </Tooltip>
  );
}

function Delta({ value, unit = "%" }: { value: number; unit?: string }) {
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
  const { admin: adminSession, loading: sessionLoading } = useSession();
  const isAdminSession = Boolean(adminSession);

  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "1";

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

  const { error, refetch, networkStatus } = useQuery(Q_DASH, {
    skip: !canView || isDemo,
    fetchPolicy: "cache-and-network",
    pollInterval: 30000,
    notifyOnNetworkStatusChange: true,
  });

  // max ร่วมของสองเส้นในกราฟ (ดูเหตุผลใน trendPath)
  const trendMax = useMemo(() => Math.max(...MOCK_TREND_CURRENT, ...MOCK_TREND_PREV, 1), []);

  const channelDonutCss = useMemo(() => {
    let acc = 0;
    const stops = MOCK_CHANNEL_SALES.map((s) => {
      const from = acc;
      acc += s.pct;
      return `${s.color} ${from}% ${acc}%`;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }, []);

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

  if (sessionLoading) {
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

  if (!isDemo && !permsLoading && !canView) {
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

  return (
    <div ref={frameRef} className="ld-shell">
      <div className="ld-layout">
        {/* ---------------- Sidebar: ช่องทาง + ยอดขาย + สถานะเชื่อมต่อ ---------------- */}
        <aside className="ld-sidebar">
          <div className="ld-sidebar-brand">
            <span className="ld-pulse" /> LIVE
          </div>
          <div className="ld-sidebar-item ld-sidebar-item--active">ภาพรวม</div>

          <div className="ld-sidebar-section">
            ช่องทาง <MockTag />
          </div>
          {/* บนมือถือ list นี้กลายเป็นแถบเลื่อนแนวนอน (ดู @media ท้ายไฟล์) จึงต้องมี wrapper จริง
              ไม่ใช่ปล่อยแถวลอยอยู่ใน aside ตรง ๆ */}
          <div className="ld-side-list">
            {MOCK_CHANNEL_SALES.map((c) => (
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
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="ยังไม่ได้ต่อข้อมูลจริง — ตัวเลขในหน้านี้เป็นข้อมูลตัวอย่างทั้งหมด"
            description="รอบนี้ทำเฉพาะเลย์เอาต์ไว้ให้ตรวจก่อน ทุกส่วนมีป้าย “ตัวอย่าง” กำกับ และในโค้ดมี TODO(real) ระบุว่าแต่ละก้อนจะดึงจาก query ไหน"
          />

          <div className="ld-topbar">
            <div className="ld-topbar-left">
              <h1>LIVE Dashboard</h1>
              <span className="ld-status-pill">
                <span className="ld-pulse" />
                {isDemo ? "Demo · ข้อมูลตัวอย่าง" : "Live · ซิงก์ทุก 30 วินาที"}
              </span>
            </div>
            <div className="ld-topbar-right">
              <Tooltip title="สถานะการดึงข้อมูล — ยังไม่พบข้อผิดพลาดจากการซิงก์ล่าสุด">
                <span className="ld-chip">{error ? "⚠ พบข้อผิดพลาด" : "✓ Source OK"}</span>
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
              <button className="ld-chip ld-chip--btn" onClick={() => refetch()}>
                <ReloadOutlined spin={networkStatus === 4} /> รีเฟรช
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
                ยอดขายวันนี้ <MockTag />
              </div>
              <div className="ld-kpi-value">{money(MOCK_KPI.revenueToday)}</div>
              <Delta value={MOCK_KPI.revenueDelta} />
            </div>
            <div className="ld-kpi">
              <div className="ld-kpi-label">
                ออเดอร์ <MockTag />
              </div>
              <div className="ld-kpi-value">{MOCK_KPI.orderCount.toLocaleString("th-TH")}</div>
              <Delta value={MOCK_KPI.orderDelta} unit=" ออเดอร์" />
            </div>
            <div className="ld-kpi">
              <div className="ld-kpi-label">
                ยอดเฉลี่ย/ออเดอร์ <MockTag />
              </div>
              <div className="ld-kpi-value">{money(MOCK_KPI.avgOrderValue)}</div>
              <Delta value={MOCK_KPI.avgDelta} />
            </div>
            <div className="ld-kpi">
              <div className="ld-kpi-label">
                ลูกค้าทั้งหมด <MockTag />
              </div>
              <div className="ld-kpi-value">{MOCK_KPI.customerCount.toLocaleString("th-TH")}</div>
              <Delta value={MOCK_KPI.customerDelta} unit=" คน" />
            </div>
          </div>

          {/* ---- 2. แถบงานค้าง ---- */}
          <div className="ld-alerts-head">
            งานค้างที่ต้องรีบทำ <MockTag />
          </div>
          <div className="ld-alerts">
            {MOCK_ALERTS.map((a) => (
              <Link href={a.href} key={a.key} className={`ld-alert-tile ld-alert-tile--${a.tone}`}>
                <span className="ld-alert-label">{a.label}</span>
                <span className="ld-alert-value">{a.value}</span>
                <RightOutlined className="ld-alert-arrow" />
              </Link>
            ))}
          </div>

          {/* ---- 3. ออเดอร์ที่เพิ่งเข้า + สัดส่วนช่องทาง ---- */}
          <div className="ld-grid2">
            <div className="ld-panel">
              <h2>
                ออเดอร์ที่เพิ่งเข้า <MockTag />
              </h2>
              <div className="ld-feed">
                {MOCK_FEED.map((f) => (
                  <div className={`ld-feed-row ${f.fresh ? "ld-feed-row--fresh" : ""}`} key={f.id}>
                    <span
                      className="ld-feed-ch"
                      style={{ background: MOCK_CHANNEL_SALES.find((c) => c.channel === f.channel)?.color ?? "#5b6778" }}
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
                สัดส่วนยอดขายตามช่องทาง <MockTag />
              </h2>
              <div className="ld-donut-row">
                <div className="ld-donut" style={{ background: channelDonutCss }}>
                  <div className="ld-donut-center">
                    <b>{money(MOCK_KPI.revenueToday)}</b>
                    <span>วันนี้</span>
                  </div>
                </div>
                <div className="ld-legend">
                  {MOCK_CHANNEL_SALES.map((s) => (
                    <div className="ld-legend-row" key={s.channel}>
                      <span className="ld-legend-dot" style={{ background: s.color }} />
                      {s.channel}
                      <b>
                        {s.pct}% · {s.orders}
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ---- 4. กราฟยอดขาย + สินค้าขายดี ---- */}
          <div className="ld-grid2">
            <div className="ld-panel">
              <h2>
                ยอดขาย 14 วันล่าสุด <MockTag />
              </h2>
              <svg className="ld-chart" viewBox="0 0 320 100" preserveAspectRatio="none" role="img" aria-label="กราฟยอดขาย 14 วันล่าสุด">
                <line x1="0" y1="25" x2="320" y2="25" className="ld-chart-grid" />
                <line x1="0" y1="50" x2="320" y2="50" className="ld-chart-grid" />
                <line x1="0" y1="75" x2="320" y2="75" className="ld-chart-grid" />
                <path d={trendPath(MOCK_TREND_PREV, trendMax)} className="ld-chart-prev" />
                <path d={trendPath(MOCK_TREND_CURRENT, trendMax, 320, 100, true)} className="ld-chart-fill" />
                <path d={trendPath(MOCK_TREND_CURRENT, trendMax)} className="ld-chart-line" />
              </svg>
              <div className="ld-chart-legend">
                <span>
                  <i className="ld-chart-key" /> ช่วงนี้
                </span>
                <span>
                  <i className="ld-chart-key ld-chart-key--prev" /> ช่วงก่อนหน้า
                </span>
              </div>
            </div>

            <div className="ld-panel">
              <h2>
                สินค้าขายดี <MockTag />
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
                    {MOCK_TOP_PRODUCTS.map((p) => (
                      <tr key={p.sku}>
                        <td className="ld-table-name">{p.name}</td>
                        <td className="ld-table-num">{p.qty.toLocaleString("th-TH")}</td>
                        <td className="ld-table-num">{money(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ---- 5. สถานะออเดอร์ + สินค้าใกล้หมด + metric ที่ยังต่อไม่ได้ ---- */}
          <div className="ld-grid2">
            <div className="ld-panel">
              <h2>
                ออเดอร์ตามสถานะ <MockTag />
              </h2>
              {MOCK_STATUS.map((s) => (
                <div className="ld-status-row" key={s.status}>
                  <span className={`ld-pill ld-pill--${s.tone}`}>{s.label}</span>
                  <b>{s.count}</b>
                </div>
              ))}

              <h2 style={{ marginTop: 18 }}>
                สินค้าใกล้หมด <MockTag />
              </h2>
              <div className="ld-table-wrap">
                <table className="ld-table">
                  <tbody>
                    {MOCK_LOW_STOCK.map((p) => (
                      <tr key={p.sku}>
                        <td className="ld-table-name">{p.name}</td>
                        <td className="ld-table-num">เหลือ {p.left}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
