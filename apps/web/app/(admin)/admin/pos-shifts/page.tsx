'use client';

import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import {
  ClockCircleOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  ReloadOutlined,
  ShopOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";

const { RangePicker } = DatePicker;

type ShiftStatus = "OPEN" | "CLOSED";
type Signal = "ALL" | "VARIANCE" | "STALE_OPEN" | "PENDING_REFUND" | "OPEN_EXPENSE" | "RETURN" | "VOID" | "NO_SALE";

type PosShiftOverviewRow = {
  id: string;
  status: ShiftStatus;
  openedAt: string;
  closedAt: string | null;
  durationMinutes: number;
  locationId: string;
  locationName: string | null;
  deviceId: string;
  deviceCode: string;
  deviceName: string | null;
  openedByName: string | null;
  closedByName: string | null;
  pharmacistName: string | null;
  cashierNames: string[];
  cashierCount: number;
  billCount: number;
  salesTotal: number;
  discountTotal: number;
  voidCount: number;
  voidTotal: number;
  returnCount: number;
  returnTotal: number;
  cashIn: number;
  cashOut: number;
  cashRefunds: number;
  openExpenseCount: number;
  openExpenseAmount: number;
  noSaleCount: number;
  pendingRefundCount: number;
  pendingRefundAmount: number;
  expectedCash: number | null;
  expectedCashHidden: boolean;
  countedCash: number | null;
  cashVariance: number | null;
  isStaleOpen: boolean;
};

type PosShiftOverview = {
  rows: PosShiftOverviewRow[];
  summary: {
    totalShifts: number;
    openShifts: number;
    closedShifts: number;
    staleOpenShifts: number;
    salesTotal: number;
    returnTotal: number;
    voidTotal: number;
    cashVarianceTotal: number;
    shortageTotal: number;
    overageTotal: number;
    pendingRefundCount: number;
    pendingRefundAmount: number;
    openExpenseCount: number;
    openExpenseAmount: number;
    noSaleCount: number;
  };
  total: number;
  limit: number;
  offset: number;
  filters: {
    locations: Array<{ id: string; name: string; branchCode: string | null }>;
    devices: Array<{ id: string; locationId: string; code: string; name: string | null }>;
    people: Array<{ id: string; label: string }>;
  };
};

const COPY = {
  th: {
    title: "ภาพรวมกะ POS",
    subtitle: "ดูทุกลิ้นชักในร้านตามวันที่เปิดกะ ใช้ตรวจยอด เงินขาด/เกิน และคนที่เกี่ยวข้องกับกะ",
    noPermission: "ไม่มีสิทธิ์ดูภาพรวมกะ POS (ต้องมี pos.shift.report.all)",
    dateNote: "ช่วงวันที่นี้หมายถึงวันที่เปิดกะตามเวลา Asia/Bangkok ถ้ากะข้ามคืน ระบบยังเก็บกะนั้นเป็นก้อนเดียว ไม่แตกเป็นรายวัน",
    open: "เปิดอยู่",
    closed: "ปิดแล้ว",
    all: "ทั้งหมด",
    location: "สาขา",
    device: "เครื่อง",
    person: "คนเกี่ยวข้อง",
    signal: "สัญญาณ",
    refresh: "Refresh",
    totalShifts: "กะทั้งหมด",
    openShifts: "กะเปิดอยู่",
    staleOpen: "เปิดนานผิดปกติ",
    sales: "ยอดขายกะ",
    returns: "คืนสินค้า",
    variance: "ส่วนต่างเงินสด",
    shortage: "เงินขาด",
    pending: "รายการค้างปิดกะ",
    openedAt: "เปิดกะ",
    closedAt: "ปิดกะ",
    status: "สถานะ",
    till: "สาขา / เครื่อง",
    people: "คนในกะ",
    bills: "บิล",
    cash: "เงินสด",
    signals: "สัญญาณ",
    action: "",
    detail: "รายละเอียด",
    export: "Excel",
    hidden: "ซ่อนตาม blind close",
    expected: "ควรมี",
    counted: "นับได้",
    cashIn: "นำเข้า",
    cashOut: "นำออก",
    refundCash: "คืนสด",
    opener: "เปิดโดย",
    closer: "ปิดโดย",
    cashier: "แคชเชียร์",
    pharmacist: "เภสัชกรเวร",
    duration: "ระยะเวลา",
    discount: "ส่วนลด",
    voids: "Void",
    noSales: "No-sale",
    openExpenses: "ค่าใช้จ่ายค้าง",
    pendingRefunds: "คืนเงินค้าง",
    empty: "ไม่พบกะตามตัวกรอง",
    loadFailed: "โหลดข้อมูลกะไม่สำเร็จ",
    exportFailed: "ดาวน์โหลด Excel ไม่สำเร็จ",
    exportLocked: "ดาวน์โหลดได้หลังปิดกะและนับเงินเสร็จ เพราะร้านเปิด blind close",
    signalAll: "ทุกสัญญาณ",
    signalVariance: "เงินขาด/เกิน",
    signalStale: "กะเปิดนาน",
    signalPendingRefund: "คืนเงินค้าง",
    signalOpenExpense: "ค่าใช้จ่ายค้าง",
    signalReturn: "มีคืนสินค้า",
    signalVoid: "มี void",
    signalNoSale: "เปิดลิ้นชักไม่ขาย",
  },
  en: {
    title: "POS Shift Overview",
    subtitle: "Review every drawer by shift-open date: totals, variance, and everyone involved.",
    noPermission: "You don't have permission to view POS shift overview (requires pos.shift.report.all)",
    dateNote: "This date range means shift-open date in Asia/Bangkok. Cross-midnight shifts stay as one shift, not split by calendar day.",
    open: "Open",
    closed: "Closed",
    all: "All",
    location: "Location",
    device: "Till",
    person: "Person",
    signal: "Signal",
    refresh: "Refresh",
    totalShifts: "Total shifts",
    openShifts: "Open shifts",
    staleOpen: "Stale open",
    sales: "Shift sales",
    returns: "Returns",
    variance: "Cash variance",
    shortage: "Shortage",
    pending: "Close blockers",
    openedAt: "Opened",
    closedAt: "Closed",
    status: "Status",
    till: "Location / till",
    people: "People",
    bills: "Bills",
    cash: "Cash",
    signals: "Signals",
    action: "",
    detail: "Detail",
    export: "Excel",
    hidden: "Hidden by blind close",
    expected: "Expected",
    counted: "Counted",
    cashIn: "Cash in",
    cashOut: "Cash out",
    refundCash: "Cash refunds",
    opener: "Opened by",
    closer: "Closed by",
    cashier: "Cashiers",
    pharmacist: "Pharmacist on duty",
    duration: "Duration",
    discount: "Discount",
    voids: "Void",
    noSales: "No-sale",
    openExpenses: "Open expenses",
    pendingRefunds: "Pending refunds",
    empty: "No shifts match these filters",
    loadFailed: "Couldn't load shifts",
    exportFailed: "Couldn't download Excel",
    exportLocked: "Available after the shift is closed and cash is counted because blind close is enabled",
    signalAll: "All signals",
    signalVariance: "Cash variance",
    signalStale: "Stale open shift",
    signalPendingRefund: "Pending refund",
    signalOpenExpense: "Open expense",
    signalReturn: "Has returns",
    signalVoid: "Has voids",
    signalNoSale: "No-sale drawer open",
  },
} as const;

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ฿`;
}

function when(value: string | null) {
  return value ? dayjs(value).format("DD/MM/YYYY HH:mm") : "—";
}

function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export default function PosShiftsPage() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const { lang } = useI18n();
  const text = COPY[lang === "en" ? "en" : "th"];
  const isMobile = useIsMobile();
  const canView = can("pos.shift.report.all");
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, "day"), dayjs()]);
  const [status, setStatus] = useState<"ALL" | ShiftStatus>("ALL");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [signal, setSignal] = useState<Signal>("ALL");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PosShiftOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PosShiftOverviewRow | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const from = range[0].format("YYYY-MM-DD");
  const to = range[1].format("YYYY-MM-DD");
  const pageSize = 30;

  const deviceOptions = useMemo(() => {
    const devices = data?.filters.devices ?? [];
    return devices
      .filter((d) => !locationId || d.locationId === locationId)
      .map((d) => ({ value: d.id, label: d.name ? `${d.code} · ${d.name}` : d.code }));
  }, [data?.filters.devices, locationId]);

  async function load() {
    if (!canView) return;
    const requestId = ++requestSequence.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        from,
        to,
        status,
        signal,
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
      });
      if (locationId) qs.set("locationId", locationId);
      if (deviceId) qs.set("deviceId", deviceId);
      if (personId) qs.set("personId", personId);
      const res = await fetch(`/api/bms/pos-shifts?${qs}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? text.loadFailed);
      if (requestId === requestSequence.current) setData(body);
    } catch (err: any) {
      if (requestId === requestSequence.current) {
        message.error(err?.message ?? text.loadFailed);
        setData(null);
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [canView, from, to, status, locationId, deviceId, personId, signal, page]);

  async function downloadShift(row: PosShiftOverviewRow) {
    setExportingId(row.id);
    try {
      const res = await fetch("/api/bms/pos-shifts/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId: row.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? text.exportFailed);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename = `pos-shift-${row.deviceCode}-${row.openedAt.slice(0, 10)}.xlsx`;
      a.href = url;
      a.download = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      message.error(err?.message ?? text.exportFailed);
    } finally {
      setExportingId(null);
    }
  }

  if (!permsLoading && !canView) {
    return <Alert closable type="error" showIcon message={text.noPermission} />;
  }

  const summary = data?.summary;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title={text.title}>
        <RangePicker
          value={range}
          allowClear={false}
          style={{ width: isMobile ? "100%" : undefined }}
          onChange={(value) => value?.[0] && value?.[1] && (setPage(1), setRange([value[0], value[1]]))}
          presets={[
            { label: "7D", value: [dayjs().subtract(6, "day"), dayjs()] },
            { label: "30D", value: [dayjs().subtract(29, "day"), dayjs()] },
            { label: "MTD", value: [dayjs().startOf("month"), dayjs()] },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={() => load()} loading={loading}>{text.refresh}</Button>
      </AdminPageHeader>

      <Alert closable type="info" showIcon message={text.subtitle} description={text.dateNote} />

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}><Card><Statistic title={text.totalShifts} value={summary?.totalShifts ?? 0} prefix={<ShopOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={text.openShifts} value={summary?.openShifts ?? 0} prefix={<ClockCircleOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={text.staleOpen} value={summary?.staleOpenShifts ?? 0} prefix={<WarningOutlined />} valueStyle={{ color: (summary?.staleOpenShifts ?? 0) ? "#cf1322" : undefined }} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={text.sales} value={summary?.salesTotal ?? 0} suffix="฿" precision={0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={text.returns} value={summary?.returnTotal ?? 0} suffix="฿" precision={0} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={text.variance} value={summary?.cashVarianceTotal ?? 0} suffix="฿" precision={0} valueStyle={{ color: (summary?.cashVarianceTotal ?? 0) < 0 ? "#cf1322" : undefined }} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={text.shortage} value={summary?.shortageTotal ?? 0} suffix="฿" precision={0} valueStyle={{ color: (summary?.shortageTotal ?? 0) ? "#cf1322" : undefined }} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={text.pending} value={(summary?.pendingRefundCount ?? 0) + (summary?.openExpenseCount ?? 0)} prefix={<ExclamationCircleOutlined />} /></Card></Col>
      </Row>

      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            value={status}
            style={{ width: 140 }}
            onChange={(v) => { setPage(1); setStatus(v); }}
            options={[
              { value: "ALL", label: text.all },
              { value: "OPEN", label: text.open },
              { value: "CLOSED", label: text.closed },
            ]}
          />
          <Select
            allowClear
            showSearch
            placeholder={text.location}
            value={locationId ?? undefined}
            style={{ width: 220 }}
            onChange={(v) => { setPage(1); setLocationId(v ?? null); setDeviceId(null); }}
            optionFilterProp="label"
            options={(data?.filters.locations ?? []).map((l) => ({ value: l.id, label: l.branchCode ? `${l.name} · ${l.branchCode}` : l.name }))}
          />
          <Select
            allowClear
            showSearch
            placeholder={text.device}
            value={deviceId ?? undefined}
            style={{ width: 220 }}
            onChange={(v) => { setPage(1); setDeviceId(v ?? null); }}
            optionFilterProp="label"
            options={deviceOptions}
          />
          <Select
            allowClear
            showSearch
            placeholder={text.person}
            value={personId ?? undefined}
            style={{ width: 240 }}
            onChange={(v) => { setPage(1); setPersonId(v ?? null); }}
            optionFilterProp="label"
            options={(data?.filters.people ?? []).map((p) => ({ value: p.id, label: p.label }))}
          />
          <Select
            value={signal}
            style={{ width: 210 }}
            onChange={(v) => { setPage(1); setSignal(v); }}
            options={[
              { value: "ALL", label: text.signalAll },
              { value: "VARIANCE", label: text.signalVariance },
              { value: "STALE_OPEN", label: text.signalStale },
              { value: "PENDING_REFUND", label: text.signalPendingRefund },
              { value: "OPEN_EXPENSE", label: text.signalOpenExpense },
              { value: "RETURN", label: text.signalReturn },
              { value: "VOID", label: text.signalVoid },
              { value: "NO_SALE", label: text.signalNoSale },
            ]}
          />
        </Space>

        <Table<PosShiftOverviewRow>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data?.rows ?? []}
          locale={{ emptyText: <Empty description={text.empty} /> }}
          scroll={{ x: "max-content" }}
          pagination={{
            current: page,
            pageSize,
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            {
              title: text.openedAt,
              dataIndex: "openedAt",
              width: 150,
              render: (_: string, row) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>{when(row.openedAt)}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{duration(row.durationMinutes)}</Typography.Text>
                </Space>
              ),
            },
            {
              title: text.till,
              width: 220,
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>{row.locationName ?? "—"}</Typography.Text>
                  <Typography.Text type="secondary">{row.deviceName ? `${row.deviceCode} · ${row.deviceName}` : row.deviceCode}</Typography.Text>
                </Space>
              ),
            },
            {
              title: text.people,
              width: 260,
              render: (_, row) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text>{row.openedByName ?? "—"} → {row.closedByName ?? (row.status === "OPEN" ? text.open : "—")}</Typography.Text>
                  <Typography.Text type="secondary" ellipsis style={{ maxWidth: 250 }}>
                    {row.cashierNames.length ? row.cashierNames.join(", ") : "—"}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: text.status,
              dataIndex: "status",
              width: 110,
              render: (value: ShiftStatus, row) => (
                <Space direction="vertical" size={4}>
                  <Tag color={value === "OPEN" ? "blue" : "green"}>{value === "OPEN" ? text.open : text.closed}</Tag>
                  {row.isStaleOpen && <Tag color="red">{text.staleOpen}</Tag>}
                </Space>
              ),
            },
            { title: text.bills, dataIndex: "billCount", width: 90, align: "right" },
            {
              title: text.sales,
              dataIndex: "salesTotal",
              width: 130,
              align: "right",
              render: money,
            },
            {
              title: text.returns,
              width: 130,
              align: "right",
              render: (_, row) => row.returnCount ? `${row.returnCount} · ${money(row.returnTotal)}` : "—",
            },
            {
              title: text.cash,
              width: 190,
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text>{text.expected}: {row.expectedCashHidden ? text.hidden : money(row.expectedCash)}</Typography.Text>
                  <Typography.Text type={row.cashVariance && row.cashVariance < 0 ? "danger" : undefined}>
                    {text.variance}: {row.cashVariance == null ? "—" : money(row.cashVariance)}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: text.signals,
              width: 220,
              render: (_, row) => (
                <Space wrap size={4}>
                  {row.pendingRefundCount > 0 && <Tag color="orange">{text.pendingRefunds} {row.pendingRefundCount}</Tag>}
                  {row.openExpenseCount > 0 && <Tag color="orange">{text.openExpenses} {row.openExpenseCount}</Tag>}
                  {row.voidCount > 0 && <Tag color="red">{text.voids} {row.voidCount}</Tag>}
                  {row.noSaleCount > 0 && <Tag color="purple">{text.noSales} {row.noSaleCount}</Tag>}
                  {row.pendingRefundCount + row.openExpenseCount + row.voidCount + row.noSaleCount === 0 && "—"}
                </Space>
              ),
            },
            {
              title: text.action,
              fixed: isMobile ? undefined : "right",
              width: 155,
              render: (_, row) => (
                <Space>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => setSelected(row)}>{text.detail}</Button>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    loading={exportingId === row.id}
                    disabled={row.expectedCashHidden}
                    title={row.expectedCashHidden ? text.exportLocked : undefined}
                    onClick={() => downloadShift(row)}
                  >{text.export}</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        title={selected ? `${text.detail} · ${selected.deviceCode} · ${when(selected.openedAt)}` : text.detail}
        open={!!selected}
        onClose={() => setSelected(null)}
        width={isMobile ? "100%" : 680}
        extra={selected && (
          <Button
            icon={<DownloadOutlined />}
            loading={exportingId === selected.id}
            disabled={selected.expectedCashHidden}
            title={selected.expectedCashHidden ? text.exportLocked : undefined}
            onClick={() => downloadShift(selected)}
          >{text.export}</Button>
        )}
      >
        {selected && (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={text.status}>{selected.status === "OPEN" ? text.open : text.closed}</Descriptions.Item>
              <Descriptions.Item label={text.location}>{selected.locationName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label={text.device}>{selected.deviceName ? `${selected.deviceCode} · ${selected.deviceName}` : selected.deviceCode}</Descriptions.Item>
              <Descriptions.Item label={text.openedAt}>{when(selected.openedAt)}</Descriptions.Item>
              <Descriptions.Item label={text.closedAt}>{when(selected.closedAt)}</Descriptions.Item>
              <Descriptions.Item label={text.duration}>{duration(selected.durationMinutes)}</Descriptions.Item>
              <Descriptions.Item label={text.opener}>{selected.openedByName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label={text.closer}>{selected.closedByName ?? "—"}</Descriptions.Item>
              <Descriptions.Item label={text.cashier}>{selected.cashierNames.length ? selected.cashierNames.join(", ") : "—"}</Descriptions.Item>
              <Descriptions.Item label={text.pharmacist}>{selected.pharmacistName ?? "—"}</Descriptions.Item>
            </Descriptions>

            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={text.bills}>{selected.billCount}</Descriptions.Item>
              <Descriptions.Item label={text.sales}>{money(selected.salesTotal)}</Descriptions.Item>
              <Descriptions.Item label={text.discount}>{money(selected.discountTotal)}</Descriptions.Item>
              <Descriptions.Item label={text.returns}>{selected.returnCount} · {money(selected.returnTotal)}</Descriptions.Item>
              <Descriptions.Item label={text.voids}>{selected.voidCount} · {money(selected.voidTotal)}</Descriptions.Item>
              <Descriptions.Item label={text.expected}>{selected.expectedCashHidden ? text.hidden : money(selected.expectedCash)}</Descriptions.Item>
              <Descriptions.Item label={text.counted}>{money(selected.countedCash)}</Descriptions.Item>
              <Descriptions.Item label={text.variance}>{money(selected.cashVariance)}</Descriptions.Item>
              <Descriptions.Item label={text.cashIn}>{money(selected.cashIn)}</Descriptions.Item>
              <Descriptions.Item label={text.cashOut}>{money(selected.cashOut)}</Descriptions.Item>
              <Descriptions.Item label={text.refundCash}>{money(selected.cashRefunds)}</Descriptions.Item>
              <Descriptions.Item label={text.pendingRefunds}>{selected.pendingRefundCount} · {money(selected.pendingRefundAmount)}</Descriptions.Item>
              <Descriptions.Item label={text.openExpenses}>{selected.openExpenseCount} · {money(selected.openExpenseAmount)}</Descriptions.Item>
              <Descriptions.Item label={text.noSales}>{selected.noSaleCount}</Descriptions.Item>
            </Descriptions>
          </Space>
        )}
      </Drawer>
    </Space>
  );
}
