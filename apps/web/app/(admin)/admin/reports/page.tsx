'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Statistic, Row, Col, Table, Tag, Button, Alert, DatePicker, Typography, Select, Space, message, Switch } from "antd";
import { DollarOutlined, ShoppingCartOutlined, ReloadOutlined, InboxOutlined, WarningOutlined, FileExcelOutlined, DownloadOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useEffect } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";

const { RangePicker } = DatePicker;

// ---- AI Report Generator (MVP core) -------------------------
const Q_GENERATED_REPORTS = gql`
  query {
    bmsGeneratedReports(limit: 20) {
      id reportType format fileUrl summary generatedBy createdAt
    }
  }
`;
const M_GENERATE_REPORT = gql`
  mutation ($input: BmsGenerateReportInput!) {
    bmsGenerateReport(input: $input) { fileId fileUrl reportType format summary }
  }
`;

function ReportGeneratorCard({ from, to }: { from: string; to: string }) {
  const { t } = useI18n();
  const REPORT_TYPE_OPTIONS = [
    { value: "SALES", label: t("admin_reports.report_type_sales") },
    { value: "INVENTORY", label: t("admin_reports.report_type_inventory") },
    { value: "PROFIT", label: t("admin_reports.report_type_profit") },
  ];
  const FORMAT_OPTIONS = [
    { value: "XLSX", label: t("admin_reports.format_xlsx") },
    { value: "CSV", label: t("admin_reports.format_csv") },
    { value: "PDF", label: t("admin_reports.format_pdf") },
  ];
  const [reportType, setReportType] = useState("SALES");
  const [format, setFormat] = useState("XLSX");
  const [includeSummary, setIncludeSummary] = useState(true);
  const { data, loading, refetch } = useQuery(Q_GENERATED_REPORTS, { fetchPolicy: "cache-and-network" });
  const [generate, { loading: generating }] = useMutation(M_GENERATE_REPORT, {
    onCompleted: (d) => {
      message.success(t("admin_reports.generate_success"));
      if (d?.bmsGenerateReport?.fileUrl) window.open(d.bmsGenerateReport.fileUrl, "_blank");
      refetch();
    },
    onError: (e) => message.error(e?.message || t("admin_reports.generate_failed")),
  });

  const rows = data?.bmsGeneratedReports || [];

  return (
    <Card title={t("admin_reports.generator_title")} style={{ marginTop: 16 }}>
      <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
        {t("admin_reports.generator_desc")}{" "}
        <a href="/admin/assistant">/admin/assistant</a> {t("admin_reports.generator_desc_end")}
      </Typography.Paragraph>
      <Space wrap>
        <Select value={reportType} onChange={setReportType} options={REPORT_TYPE_OPTIONS} style={{ width: 220 }} />
        <Select value={format} onChange={setFormat} options={FORMAT_OPTIONS} style={{ width: 160 }} />
        <Space size={6}><Switch checked={includeSummary} onChange={setIncludeSummary} size="small" /> {t("admin_reports.ai_summary_label")}</Space>
        <Button
          type="primary"
          icon={<FileExcelOutlined />}
          loading={generating}
          onClick={() =>
            generate({
              variables: {
                input: { reportType, format, includeSummary, dateFrom: from, dateTo: to },
              },
            })
          }
        >
          {t("admin_reports.generate_report_btn")}
        </Button>
      </Space>

      <Table
        rowKey="id"
        style={{ marginTop: 16 }}
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 10 }}
        scroll={{ x: "max-content" }}
        columns={[
          { title: t("admin_reports.col_report_type"), dataIndex: "reportType" },
          { title: t("admin_reports.col_format"), dataIndex: "format" },
          {
            title: t("admin_reports.col_ai_summary"), dataIndex: "summary",
            render: (v: string | null) => v ? <Typography.Text style={{ maxWidth: 320 }} ellipsis={{ tooltip: v }}>{v}</Typography.Text> : "—",
          },
          { title: t("admin_reports.col_generated_by"), dataIndex: "generatedBy" },
          { title: t("admin_reports.col_generated_at"), dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
          {
            title: "", key: "download",
            render: (_: any, r: any) => r.fileUrl
              ? <Button size="small" icon={<DownloadOutlined />} href={r.fileUrl} target="_blank">{t("admin_reports.download")}</Button>
              : "—",
          },
        ]}
      />
    </Card>
  );
}

// ---- GraphQL ------------------------------------------------
const Q_REPORTS = gql`
  query ($from: String, $to: String) {
    bmsSalesSummary(from: $from, to: $to) {
      from to revenue refundTotal netRevenue orderCount avgOrderValue
      byDay { day revenue orders }
      byStatus { status count }
      byChannel { channel revenue orders }
    }
    bmsTopSellingProducts(from: $from, to: $to, limit: 10) { sku name qty revenue }
    bmsInventorySummary {
      skuCount variantCount totalUnits reservedUnits availableUnits stockValue lowStockCount outOfStockCount
    }
  }
`;

const STATUS_COLOR: Record<string, string> = {
  PENDING: "orange", PAID: "blue", PACKING: "cyan", SHIPPED: "geekblue",
  COMPLETED: "green", CANCELLED: "default", RETURNED: "red",
};
const CHANNEL_COLOR: Record<string, string> = {
  line: "green", tiktok: "magenta", facebook: "blue", instagram: "purple", web: "geekblue",
  shopee: "orange", lazada: "purple", test: "default",
};
const baht = (v: number) => `${Number(v).toLocaleString()} ฿`;

export default function Page() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(29, "day"), dayjs()]);
  const from = range[0].format("YYYY-MM-DD");
  const to = range[1].format("YYYY-MM-DD");

  const { data, loading, error, refetch } = useQuery(Q_REPORTS, {
    variables: { from, to }, fetchPolicy: "cache-and-network",
  });
  const [posReturns, setPosReturns] = useState<any | null>(null);
  const [posReturnsLoading, setPosReturnsLoading] = useState(false);
  const [posReturnAudit, setPosReturnAudit] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPosReturnsLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/bms/reports/pos-returns?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
          cache: "no-store",
        });
        const body = await res.json().catch(() => null);
        if (!cancelled) setPosReturns(body);
        const auditRes = await fetch(`/api/bms/reports/pos-return-audit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
          cache: "no-store",
        });
        const auditBody = await auditRes.json().catch(() => null);
        if (!cancelled) setPosReturnAudit(auditBody);
      } catch {
        if (!cancelled) setPosReturns(null);
        if (!cancelled) setPosReturnAudit(null);
      } finally {
        if (!cancelled) setPosReturnsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  if (error) return <Alert closable type="error" message={t("admin_reports.load_error")} description={error.message} showIcon />;

  const s = data?.bmsSalesSummary;
  const inv = data?.bmsInventorySummary;
  const top = data?.bmsTopSellingProducts || [];
  const maxRev = Math.max(1, ...(s?.byDay || []).map((x: any) => x.revenue));

  return (
    <div>
      <AdminPageHeader title={t("admin_reports.page_title")}>
        <RangePicker value={range} allowClear={false}
          style={{ width: isMobile ? "100%" : undefined }}
          onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
          presets={[
            { label: t("admin_reports.preset_7d"), value: [dayjs().subtract(6, "day"), dayjs()] },
            { label: t("admin_reports.preset_30d"), value: [dayjs().subtract(29, "day"), dayjs()] },
            { label: t("admin_reports.preset_this_month"), value: [dayjs().startOf("month"), dayjs()] },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={loading}>{t("admin_reports.refresh")}</Button>
      </AdminPageHeader>

      {/* ---- Sales KPIs ---- */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8}>
          <Card><Statistic title={t("admin_reports.kpi_sales_range", { from, to })} value={s?.netRevenue ?? 0} precision={0} suffix="฿" prefix={<DollarOutlined />} valueStyle={{ color: "#389e0d" }} /></Card>
        </Col>
        <Col xs={12} sm={12} md={8}>
          <Card><Statistic title={t("admin_reports.kpi_order_count")} value={s?.orderCount ?? 0} prefix={<ShoppingCartOutlined />} /></Card>
        </Col>
        <Col xs={12} sm={12} md={8}>
          <Card><Statistic title={t("admin_reports.kpi_avg_order")} value={s?.avgOrderValue ?? 0} precision={0} suffix="฿" /></Card>
        </Col>
      </Row>
      {Number(s?.refundTotal ?? 0) > 0 && (
        <Alert closable
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message={t("admin_reports.refund_event_summary", {
            gross: baht(s?.revenue ?? 0),
            refunds: baht(s?.refundTotal ?? 0),
            net: baht(s?.netRevenue ?? 0),
          })}
        />
      )}

      {/* ---- Sales by day (mini bars) ---- */}
      <Card title={t("admin_reports.daily_sales")} style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 140, overflowX: "auto" }}>
          {(s?.byDay || []).map((x: any) => (
            <div key={x.day} title={t("admin_reports.daily_sales_tooltip", { day: x.day, revenue: baht(x.revenue), orders: x.orders })}
              style={{ flex: "1 0 8px", minWidth: 8, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
              <div style={{ width: "100%", height: `${(x.revenue / maxRev) * 120}px`, background: "#52c41a", borderRadius: 2 }} />
            </div>
          ))}
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_reports.hover_hint")}</Typography.Text>
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* ---- By channel ---- */}
        <Col xs={24} md={12}>
          <Card title={t("admin_reports.sales_by_channel")}>
            <Table rowKey="channel" size="small" pagination={false} dataSource={s?.byChannel || []}
              scroll={{ x: "max-content" }}
              columns={[
                { title: t("admin_reports.col_channel"), dataIndex: "channel", render: (c: string) => <Tag color={CHANNEL_COLOR[c] || "default"}>{c}</Tag> },
                { title: t("admin_reports.col_orders"), dataIndex: "orders", align: "right" as const },
                { title: t("admin_reports.col_sales"), dataIndex: "revenue", align: "right" as const, render: baht },
              ]} />
          </Card>
        </Col>
        {/* ---- By status ---- */}
        <Col xs={24} md={12}>
          <Card title={t("admin_reports.orders_by_status")}>
            <Table rowKey="status" size="small" pagination={false} dataSource={s?.byStatus || []}
              scroll={{ x: "max-content" }}
              columns={[
                { title: t("admin_reports.col_status"), dataIndex: "status", render: (v: string) => <Tag color={STATUS_COLOR[v] || "default"}>{v}</Tag> },
                { title: t("admin_reports.col_count"), dataIndex: "count", align: "right" as const },
              ]} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={10}>
          <Card title="POS returns / refunds" loading={posReturnsLoading}>
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Statistic title="Return count" value={posReturns?.returnCount ?? 0} />
              </Col>
              <Col span={8}>
                <Statistic title="คืนเงินจริงแล้ว" value={posReturns?.settledTotal ?? 0} precision={2} suffix="฿" />
              </Col>
              <Col span={8}>
                <Statistic title="รอคืนเงินจริง" value={posReturns?.pendingTotal ?? 0} precision={2} suffix="฿" />
              </Col>
            </Row>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 8 }}>
              รับคืนสินค้ารวม ฿{baht(posReturns?.refundTotal ?? 0)} ในช่วง {from} ถึง {to}
              {Number(posReturns?.pendingCount ?? 0) > 0 ? ` · ค้างยืนยัน ${posReturns.pendingCount} รายการ` : ""}
            </Typography.Paragraph>
            <Table
              rowKey={(row: any) => `${row.reasonCode}-${row.reasonText}`}
              size="small"
              pagination={false}
              dataSource={posReturns?.topReasons || []}
              columns={[
                { title: "Reason code", dataIndex: "reasonCode" },
                { title: "Detail", dataIndex: "reasonText" },
                { title: "Count", dataIndex: "count", align: "right" as const },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card title="Recent POS return log" loading={posReturnsLoading}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={posReturns?.recent || []}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "When", dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
                { title: "Order", dataIndex: "orderId" },
                { title: "Refund", dataIndex: "refundAmount", align: "right" as const, render: baht },
                { title: "Mode", dataIndex: "returnMode" },
                { title: "Settlement", dataIndex: "settlementStatus", render: (v: string) => <Tag color={v === "COMPLETED" ? "green" : "orange"}>{v}</Tag> },
                { title: "Pending", dataIndex: "pendingAmount", align: "right" as const, render: baht },
                { title: "By", dataIndex: "returnedBy", render: (v: string | null) => v || "—" },
                { title: "Reason code", dataIndex: "reasonCode" },
                { title: "Reason", dataIndex: "reasonText" },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <Card title="POS return controls" loading={posReturnsLoading}>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Statistic title="Approval candidates" value={posReturnAudit?.approvalCandidateCount ?? 0} />
              </Col>
              <Col span={12}>
                <Statistic title="High-value returns" value={posReturnAudit?.highValueReturnCount ?? 0} />
              </Col>
            </Row>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              ตั้งแต่ 16 สิงหาคม 2026 รายการคืนตั้งแต่ ฿500 ต้องผ่านผู้มีสิทธิ์คืนเงิน และบันทึกผู้อนุมัติไว้ตรวจสอบ
            </Typography.Paragraph>
            {(posReturnAudit?.anomalySignals || []).length > 0 && (
              <Alert closable
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message="Anomaly signals"
                description={
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(posReturnAudit?.anomalySignals || []).map((signal: string) => (
                      <li key={signal}>{signal}</li>
                    ))}
                  </ul>
                }
              />
            )}
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card title="POS return by cashier" loading={posReturnsLoading}>
            <Table
              rowKey="cashier"
              size="small"
              pagination={false}
              dataSource={posReturnAudit?.byCashier || []}
              columns={[
                { title: "Cashier", dataIndex: "cashier" },
                { title: "Returns", dataIndex: "returnCount", align: "right" as const },
                { title: "Refund total", dataIndex: "refundTotal", align: "right" as const, render: baht },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* ---- Top selling ---- */}
      <Card title={t("admin_reports.top_products")} style={{ marginTop: 16 }}>
        <Table rowKey="sku" size="small" pagination={false} dataSource={top} loading={loading}
          scroll={{ x: "max-content" }}
          columns={[
            { title: "SKU", dataIndex: "sku" },
            { title: t("admin_reports.col_product"), dataIndex: "name" },
            { title: t("admin_reports.col_qty_sold"), dataIndex: "qty", align: "right" as const },
            { title: t("admin_reports.col_sales"), dataIndex: "revenue", align: "right" as const, render: baht },
          ]} />
      </Card>

      {/* ---- Inventory summary ---- */}
      <Card title={t("admin_reports.inventory_summary")} style={{ marginTop: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.stock_value")} value={inv?.stockValue ?? 0} precision={0} suffix="฿" prefix={<InboxOutlined />} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.sku_count")} value={inv?.skuCount ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.total_units")} value={inv?.totalUnits ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.available_units")} value={inv?.availableUnits ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.reserved_units")} value={inv?.reservedUnits ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.variant_count")} value={inv?.variantCount ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.low_stock")} value={inv?.lowStockCount ?? 0} valueStyle={{ color: "#d46b08" }} prefix={<WarningOutlined />} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.out_of_stock")} value={inv?.outOfStockCount ?? 0} valueStyle={{ color: "#cf1322" }} /></Col>
        </Row>
      </Card>

      <ReportGeneratorCard from={from} to={to} />
    </div>
  );
}
