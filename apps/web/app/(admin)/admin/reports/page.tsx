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
import { localizedShopArchetypeLabel } from "@/lib/bms/shopArchetypes";

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

function ReportGeneratorCard({ from, to, locationId, archetype }: { from: string; to: string; locationId?: string; archetype?: string | null }) {
  const { t } = useI18n();
  const REPORT_TYPE_OPTIONS = [
    { value: "SALES", label: t("admin_reports.report_type_sales") },
    { value: "INVENTORY", label: t("admin_reports.report_type_inventory") },
    { value: "PROFIT", label: t("admin_reports.report_type_profit") },
    { value: "PRODUCTS", label: t("admin_reports.report_type_products") },
    { value: "PAYMENTS", label: t("admin_reports.report_type_payments") },
    { value: "PURCHASES", label: t("admin_reports.report_type_purchases") },
    { value: "CUSTOMERS", label: t("admin_reports.report_type_customers") },
    { value: "OPERATIONS", label: t("admin_reports.report_type_operations") },
    { value: "SPECIALIZED", label: t("admin_reports.report_type_specialized", { archetype: localizedShopArchetypeLabel(archetype, t) }) },
    { value: "VAT_SALES", label: t("admin_reports.report_type_vat_sales") },
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
                input: { reportType, format, includeSummary, dateFrom: from, dateTo: to, locationId },
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
  query ($from: String, $to: String, $locationId: ID) {
    bmsSalesSummary(from: $from, to: $to, locationId: $locationId) {
      from to revenue refundTotal netRevenue orderCount avgOrderValue
      byDay { day revenue orders }
      byStatus { status count }
      byChannel { channel revenue orders }
    }
    bmsTopSellingProducts(from: $from, to: $to, limit: 10, locationId: $locationId) { sku name qty revenue }
    bmsInventorySummary(locationId: $locationId) {
      skuCount variantCount totalUnits reservedUnits availableUnits stockValue stockRetailValue
      stockCostValue knownStockCostValue missingCostVariantCount lowStockCount outOfStockCount
    }
    bmsManagementReport(from: $from, to: $to, locationId: $locationId) {
      from to locationId
      archetype {
        profile { archetype group moduleKeys }
        catalog {
          activeVariantCount productsWithVariants multiVariantProductCount
          activePackCount productsWithPacks alternatePackCount
          stockedLotCount lotUnits expiredLotCount expiredUnits expiringLotCount expiringUnits lotsMissingExpiry
          serialTrackedSkuCount serialInStockCount serialSoldCount serialReturnedCount
        }
        restaurant {
          checkCount paidCheckCount cancelledCheckCount guestCount avgTableMinutes
          kitchenTicketCount servedTicketCount cancelledTicketCount avgKitchenMinutes
          qrSubmissionCount qrAcceptedCount qrRejectedCount
        }
        pharmacy { policyCount approvedPolicyCount draftPolicyCount pendingReviewPolicyCount retiredPolicyCount missingPolicySkuCount }
        boardGame {
          sessionCount paidSessionCount cancelledSessionCount guestCount avgPlayMinutes paidBillingGroupCount openBillingGroupCount settledAmount
          titleCount copyCount availableCopyCount attentionCopyCount checkedOutCopyCount
          activePassCount minutePassCount remainingPassMinutes
        }
      }
      profit { method disclaimer revenue cost knownCost profit marginPct complete authoritative legacyCostLineCount missingCostLineCount missingCostSkuCount missingCostRevenue }
      comparison {
        previousFrom previousTo currentNetRevenue previousNetRevenue revenueChangePct
        currentOrderCount previousOrderCount orderChangePct currentProfit previousProfit profitChangePct
      }
      reconciliation {
        paidOrderCount paidOrderAmount paymentReceivedAmount completedRefundAmount netPaymentAmount netOrderAmount paymentDifference
        taxDocumentCount taxDocumentAmount expectedCash countedCash cashDifference varianceShiftCount mismatchCount
      }
      inventoryAging {
        stockedVariantCount missingCostVariantCount stockUnits knownCostValue
        age31To60Count age61To90Count age91To180Count age180PlusCount
        deadStockUnits deadStockValue estimatedDaysCover method
      }
      supplierPerformance {
        supplier poCount orderedAmount receivedAmount orderedQty receivedQty fillRate avgLeadDays openPoCount
      }
      discountPerformance {
        paidOrderCount discountedOrderCount beforeDiscountRevenue netRevenue discountAmount discountRate promotionLineCount
      }
      customerSegments { key count amount }
      branches { locationId code name orders revenue }
      products {
        activeSkuCount soldSkuCount unsoldSkuCount missingCostSkuCount
        top { sku name category qty revenue profit marginPct missingCost }
        slow { sku name category qty revenue profit marginPct missingCost }
      }
      payments {
        receivedAmount refundedAmount pendingAmount pendingCount
        byMethod { key count amount }
        byStatus { key count amount }
      }
      purchases {
        poCount orderedAmount openAmount openCount
        byStatus { key count amount }
        bySupplier { key count amount }
      }
      customers {
        totalCustomers newCustomers purchasingCustomers repeatCustomers repeatRate
        anonymousOrders identifiedRevenue avgRevenuePerCustomer
      }
      fulfillment {
        shipmentCount deliveredCount inProgressCount exceptionCount avgDeliveryHours
        byStatus { key count amount }
      }
      controls {
        discountAmount voidCount voidAmount noSaleCount cashIn cashOut absoluteCashVariance
        closedShiftCount wastageQty stockMovements { key count amount }
      }
      liabilities {
        loyaltyPoints loyaltyValue storeCreditAmount arOutstandingAmount arOverdueAmount balanceMismatchCount
      }
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
const changeColor = (value: number | null | undefined) => value == null ? undefined : value >= 0 ? "#389e0d" : "#cf1322";
const changePrefix = (value: number | null | undefined) => value == null ? "—" : value >= 0 ? "+" : "";

export default function Page() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(29, "day"), dayjs()]);
  const [locationId, setLocationId] = useState<string | undefined>();
  const from = range[0].format("YYYY-MM-DD");
  const to = range[1].format("YYYY-MM-DD");

  const { data, loading, error, refetch } = useQuery(Q_REPORTS, {
    variables: { from, to, locationId }, fetchPolicy: "cache-and-network",
  });
  const [posReturns, setPosReturns] = useState<any | null>(null);
  const [posReturnsLoading, setPosReturnsLoading] = useState(false);
  const [posReturnAudit, setPosReturnAudit] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPosReturnsLoading(true);
    void (async () => {
      try {
        const branchParam = locationId ? `&locationId=${encodeURIComponent(locationId)}` : "";
        const res = await fetch(`/api/bms/reports/pos-returns?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${branchParam}`, {
          cache: "no-store",
        });
        const body = await res.json().catch(() => null);
        if (!cancelled) setPosReturns(body);
        const auditRes = await fetch(`/api/bms/reports/pos-return-audit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${branchParam}`, {
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
  }, [from, to, locationId]);

  if (error) return <Alert closable type="error" message={t("admin_reports.load_error")} description={error.message} showIcon />;

  const s = data?.bmsSalesSummary;
  const inv = data?.bmsInventorySummary;
  const top = data?.bmsTopSellingProducts || [];
  const management = data?.bmsManagementReport;
  const archetypeReport = management?.archetype;
  const reportProfile = archetypeReport?.profile;
  const reportModules = new Set<string>(reportProfile?.moduleKeys || []);
  const archetypeLabel = localizedShopArchetypeLabel(reportProfile?.archetype, t);
  const hasReportModule = (key: string) => reportModules.has(key);
  const anomalyLabels: Record<string, string> = {
    MISSING_APPROVAL: t("admin_reports.anomaly_missing_approval"),
    HIGH_VALUE_RETURN: t("admin_reports.anomaly_high_value"),
    FREQUENT_CASHIER_RETURNS: t("admin_reports.anomaly_frequent_returns"),
    HIGH_CASHIER_REFUND_TOTAL: t("admin_reports.anomaly_high_refund_total"),
    NO_RECEIPT_RETURN: t("admin_reports.anomaly_no_receipt"),
  };
  const maxRev = Math.max(1, ...(s?.byDay || []).map((x: any) => x.revenue));

  return (
    <div>
      <AdminPageHeader title={t("admin_reports.page_title")}>
        <Select
          allowClear
          value={locationId}
          placeholder={t("admin_reports.all_branches")}
          style={{ width: isMobile ? "100%" : 220 }}
          onChange={(value) => setLocationId(value || undefined)}
          options={(management?.branches || []).map((branch: any) => ({
            value: branch.locationId,
            label: `${branch.code} · ${branch.name}`,
          }))}
        />
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

      <Alert
        closable
        type="info"
        showIcon
        message={t("admin_reports.archetype_report_title", { archetype: archetypeLabel })}
        description={t("admin_reports.archetype_report_desc", {
          group: t(`admin_reports.report_group_${String(reportProfile?.group || "RETAIL").toLowerCase()}`),
        })}
        action={<Space wrap>{(reportProfile?.moduleKeys || []).map((key: string) => <Tag key={key}>{key}</Tag>)}</Space>}
      />

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

      <Card title={t("admin_reports.comparison_title")} style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary">
          {t("admin_reports.comparison_desc", {
            from: management?.comparison?.previousFrom || "—",
            to: management?.comparison?.previousTo || "—",
          })}
        </Typography.Paragraph>
        <Row gutter={[16, 16]}>
          {[
            ["revenue_change", management?.comparison?.revenueChangePct],
            ["order_change", management?.comparison?.orderChangePct],
            ["profit_change", management?.comparison?.profitChangePct],
          ].map(([key, value]) => (
            <Col xs={24} md={8} key={String(key)}>
              <Statistic
                title={t(`admin_reports.${key}`)}
                value={(value as number | null | undefined) ?? 0}
                precision={1}
                prefix={changePrefix(value as number | null | undefined)}
                suffix="%"
                valueStyle={{ color: changeColor(value as number | null | undefined) }}
              />
            </Col>
          ))}
        </Row>
      </Card>

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
          <Card title={t("admin_reports.pos_returns_title")} loading={posReturnsLoading}>
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Statistic title={t("admin_reports.return_count")} value={posReturns?.returnCount ?? 0} />
              </Col>
              <Col span={8}>
                <Statistic title={t("admin_reports.refund_settled")} value={posReturns?.settledTotal ?? 0} precision={2} suffix="฿" />
              </Col>
              <Col span={8}>
                <Statistic title={t("admin_reports.refund_pending")} value={posReturns?.pendingTotal ?? 0} precision={2} suffix="฿" />
              </Col>
            </Row>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 8 }}>
              {t("admin_reports.return_summary", {
                amount: baht(posReturns?.refundTotal ?? 0),
                from,
                to,
                pending: posReturns?.pendingCount ?? 0,
              })}
            </Typography.Paragraph>
            <Table
              rowKey={(row: any) => `${row.reasonCode}-${row.reasonText}`}
              size="small"
              pagination={false}
              dataSource={posReturns?.topReasons || []}
              columns={[
                { title: t("admin_reports.col_reason_code"), dataIndex: "reasonCode" },
                { title: t("admin_reports.col_detail"), dataIndex: "reasonText" },
                { title: t("admin_reports.col_count"), dataIndex: "count", align: "right" as const },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card title={t("admin_reports.return_log_title")} loading={posReturnsLoading}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={posReturns?.recent || []}
              scroll={{ x: "max-content" }}
              columns={[
                { title: t("admin_reports.col_when"), dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
                { title: t("admin_reports.col_order"), dataIndex: "orderId" },
                { title: t("admin_reports.col_channel"), dataIndex: "sourceChannel" },
                {
                  title: t("admin_reports.col_branch"),
                  key: "branch",
                  render: (_: unknown, row: any) => row.crossBranch
                    ? `${row.saleLocationName || "—"} → ${row.returnLocationName || "—"}`
                    : row.returnLocationName || row.saleLocationName || "—",
                },
                { title: t("admin_reports.col_refund"), dataIndex: "refundAmount", align: "right" as const, render: baht },
                { title: t("admin_reports.col_mode"), dataIndex: "returnMode" },
                { title: t("admin_reports.col_settlement"), dataIndex: "settlementStatus", render: (v: string) => <Tag color={v === "COMPLETED" ? "green" : "orange"}>{v}</Tag> },
                { title: t("admin_reports.col_pending"), dataIndex: "pendingAmount", align: "right" as const, render: baht },
                { title: t("admin_reports.col_by"), dataIndex: "returnedBy", render: (v: string | null) => v || "—" },
                { title: t("admin_reports.col_reason_code"), dataIndex: "reasonCode" },
                { title: t("admin_reports.col_reason"), dataIndex: "reasonText" },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <Card title={t("admin_reports.return_controls_title")} loading={posReturnsLoading}>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Statistic title={t("admin_reports.approval_candidates")} value={posReturnAudit?.approvalCandidateCount ?? 0} />
              </Col>
              <Col span={12}>
                <Statistic title={t("admin_reports.high_value_returns")} value={posReturnAudit?.highValueReturnCount ?? 0} />
              </Col>
            </Row>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              {t("admin_reports.return_control_note")}
            </Typography.Paragraph>
            {(posReturnAudit?.anomalyCodes || []).length > 0 && (
              <Alert closable
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message={t("admin_reports.anomaly_signals")}
                description={
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(posReturnAudit?.anomalyCodes || []).map((code: string) => (
                      <li key={code}>{anomalyLabels[code] || code}</li>
                    ))}
                  </ul>
                }
              />
            )}
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card title={t("admin_reports.returns_by_cashier")} loading={posReturnsLoading}>
            <Table
              rowKey="cashier"
              size="small"
              pagination={false}
              dataSource={posReturnAudit?.byCashier || []}
              columns={[
                { title: t("admin_reports.col_cashier"), dataIndex: "cashier" },
                { title: t("admin_reports.return_count"), dataIndex: "returnCount", align: "right" as const },
                { title: t("admin_reports.refund_total"), dataIndex: "refundTotal", align: "right" as const, render: baht },
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
          <Col xs={12} md={6}><Statistic title={t("admin_reports.stock_cost_value")} value={inv?.stockCostValue ?? inv?.knownStockCostValue ?? 0} precision={0} suffix="฿" prefix={<InboxOutlined />} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.stock_retail_value")} value={inv?.stockRetailValue ?? inv?.stockValue ?? 0} precision={0} suffix="฿" /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.sku_count")} value={inv?.skuCount ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.total_units")} value={inv?.totalUnits ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.available_units")} value={inv?.availableUnits ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.reserved_units")} value={inv?.reservedUnits ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.variant_count")} value={inv?.variantCount ?? 0} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.low_stock")} value={inv?.lowStockCount ?? 0} valueStyle={{ color: "#d46b08" }} prefix={<WarningOutlined />} /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.out_of_stock")} value={inv?.outOfStockCount ?? 0} valueStyle={{ color: "#cf1322" }} /></Col>
        </Row>
        {Number(inv?.missingCostVariantCount ?? 0) > 0 && (
          <Alert
            closable
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message={t("admin_reports.inventory_cost_incomplete", { count: inv.missingCostVariantCount })}
          />
        )}
      </Card>

      <Card title={t("admin_reports.profit_title")} style={{ marginTop: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.profit_revenue")} value={management?.profit?.revenue ?? 0} precision={2} suffix="฿" /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.profit_known_cost")} value={management?.profit?.knownCost ?? 0} precision={2} suffix="฿" /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.profit_gross")} value={management?.profit?.profit ?? 0} precision={2} suffix="฿" /></Col>
          <Col xs={12} md={6}><Statistic title={t("admin_reports.profit_margin")} value={management?.profit?.marginPct ?? 0} precision={1} suffix="%" /></Col>
        </Row>
        {management?.profit && (
          <Alert
            closable
            style={{ marginTop: 12 }}
            type={management.profit.complete ? "info" : "warning"}
            showIcon
            message={management.profit.disclaimer}
          />
        )}
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.reconciliation_title")}>
            <Row gutter={[12, 12]}>
              <Col span={12}><Statistic title={t("admin_reports.net_payment_amount")} value={management?.reconciliation?.netPaymentAmount ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={12}><Statistic title={t("admin_reports.payment_difference")} value={management?.reconciliation?.paymentDifference ?? 0} precision={2} suffix="฿" valueStyle={{ color: Math.abs(management?.reconciliation?.paymentDifference ?? 0) > 0.009 ? "#cf1322" : "#389e0d" }} /></Col>
              <Col span={12}><Statistic title={t("admin_reports.tax_document_amount")} value={management?.reconciliation?.taxDocumentAmount ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={12}><Statistic title={t("admin_reports.cash_difference")} value={management?.reconciliation?.cashDifference ?? 0} precision={2} suffix="฿" /></Col>
            </Row>
            <Alert
              closable
              style={{ marginTop: 12 }}
              type={(management?.reconciliation?.mismatchCount ?? 0) === 0 ? "success" : "warning"}
              showIcon
              message={t("admin_reports.reconciliation_result", { count: management?.reconciliation?.mismatchCount ?? 0 })}
              description={t("admin_reports.reconciliation_desc")}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.inventory_aging_title")}>
            <Typography.Paragraph type="secondary">{t("admin_reports.inventory_aging_desc")}</Typography.Paragraph>
            <Row gutter={[12, 12]}>
              <Col span={8}><Statistic title={t("admin_reports.dead_stock_units")} value={management?.inventoryAging?.deadStockUnits ?? 0} /></Col>
              <Col span={8}><Statistic title={t("admin_reports.dead_stock_value")} value={management?.inventoryAging?.deadStockValue ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={8}><Statistic title={t("admin_reports.estimated_days_cover")} value={management?.inventoryAging?.estimatedDaysCover ?? 0} precision={1} /></Col>
              <Col span={6}><Statistic title="31–60" value={management?.inventoryAging?.age31To60Count ?? 0} /></Col>
              <Col span={6}><Statistic title="61–90" value={management?.inventoryAging?.age61To90Count ?? 0} /></Col>
              <Col span={6}><Statistic title="91–180" value={management?.inventoryAging?.age91To180Count ?? 0} /></Col>
              <Col span={6}><Statistic title="180+" value={management?.inventoryAging?.age180PlusCount ?? 0} /></Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.discount_performance_title")}>
            <Typography.Paragraph type="secondary">{t("admin_reports.discount_performance_desc")}</Typography.Paragraph>
            <Row gutter={[12, 12]}>
              <Col span={8}><Statistic title={t("admin_reports.discounted_orders")} value={management?.discountPerformance?.discountedOrderCount ?? 0} /></Col>
              <Col span={8}><Statistic title={t("admin_reports.discount_rate")} value={management?.discountPerformance?.discountRate ?? 0} precision={1} suffix="%" /></Col>
              <Col span={8}><Statistic title={t("admin_reports.promotion_lines")} value={management?.discountPerformance?.promotionLineCount ?? 0} /></Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.customer_segments_title")}>
            <Typography.Paragraph type="secondary">{t("admin_reports.customer_segments_desc")}</Typography.Paragraph>
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={management?.customerSegments || []}
              columns={[
                { title: t("admin_reports.col_segment"), dataIndex: "key" },
                { title: t("admin_reports.col_customers"), dataIndex: "count", align: "right" as const },
                { title: t("admin_reports.col_lifetime_value"), dataIndex: "amount", align: "right" as const, render: baht },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card title={t("admin_reports.supplier_performance_title")} style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary">{t("admin_reports.supplier_performance_desc")}</Typography.Paragraph>
        <Table
          rowKey="supplier"
          size="small"
          pagination={{ pageSize: 10 }}
          scroll={{ x: "max-content" }}
          dataSource={management?.supplierPerformance || []}
          columns={[
            { title: t("admin_reports.col_supplier"), dataIndex: "supplier" },
            { title: t("admin_reports.po_count"), dataIndex: "poCount", align: "right" as const },
            { title: t("admin_reports.fill_rate"), dataIndex: "fillRate", align: "right" as const, render: (v: number) => `${Number(v).toFixed(1)}%` },
            { title: t("admin_reports.avg_lead_days"), dataIndex: "avgLeadDays", align: "right" as const, render: (v: number) => Number(v).toFixed(1) },
            { title: t("admin_reports.open_po_count"), dataIndex: "openPoCount", align: "right" as const },
          ]}
        />
      </Card>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.branch_performance")}>
            <Table
              rowKey="locationId"
              size="small"
              pagination={false}
              dataSource={management?.branches || []}
              columns={[
                { title: t("admin_reports.col_branch"), key: "branch", render: (_: unknown, row: any) => `${row.code} · ${row.name}` },
                { title: t("admin_reports.col_orders"), dataIndex: "orders", align: "right" as const },
                { title: t("admin_reports.col_sales"), dataIndex: "revenue", align: "right" as const, render: baht },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.product_performance")}>
            <Row gutter={[12, 12]}>
              <Col span={6}><Statistic title={t("admin_reports.active_skus")} value={management?.products?.activeSkuCount ?? 0} /></Col>
              <Col span={6}><Statistic title={t("admin_reports.sold_skus")} value={management?.products?.soldSkuCount ?? 0} /></Col>
              <Col span={6}><Statistic title={t("admin_reports.unsold_skus")} value={management?.products?.unsoldSkuCount ?? 0} /></Col>
              <Col span={6}><Statistic title={t("admin_reports.missing_cost_skus")} value={management?.products?.missingCostSkuCount ?? 0} valueStyle={{ color: management?.products?.missingCostSkuCount ? "#cf1322" : undefined }} /></Col>
            </Row>
            <Table
              style={{ marginTop: 12 }}
              rowKey="sku"
              size="small"
              pagination={false}
              dataSource={management?.products?.slow || []}
              columns={[
                { title: t("admin_reports.slow_products"), dataIndex: "name" },
                { title: "SKU", dataIndex: "sku" },
                { title: t("admin_reports.col_qty_sold"), dataIndex: "qty", align: "right" as const },
                { title: t("admin_reports.col_sales"), dataIndex: "revenue", align: "right" as const, render: baht },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.payments_title")}>
            <Row gutter={[12, 12]}>
              <Col span={8}><Statistic title={t("admin_reports.received_amount")} value={management?.payments?.receivedAmount ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={8}><Statistic title={t("admin_reports.refunded_amount")} value={management?.payments?.refundedAmount ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={8}><Statistic title={t("admin_reports.pending_amount")} value={management?.payments?.pendingAmount ?? 0} precision={2} suffix="฿" /></Col>
            </Row>
            <Table
              style={{ marginTop: 12 }} rowKey="key" size="small" pagination={false}
              dataSource={management?.payments?.byMethod || []}
              columns={[
                { title: t("admin_reports.col_payment_method"), dataIndex: "key" },
                { title: t("admin_reports.col_count"), dataIndex: "count", align: "right" as const },
                { title: t("admin_reports.col_amount"), dataIndex: "amount", align: "right" as const, render: baht },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.purchases_title")}>
            <Typography.Paragraph type="secondary">{t("admin_reports.purchase_scope_note")}</Typography.Paragraph>
            <Row gutter={[12, 12]}>
              <Col span={6}><Statistic title={t("admin_reports.po_count")} value={management?.purchases?.poCount ?? 0} /></Col>
              <Col span={6}><Statistic title={t("admin_reports.ordered_amount")} value={management?.purchases?.orderedAmount ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={6}><Statistic title={t("admin_reports.open_po_count")} value={management?.purchases?.openCount ?? 0} /></Col>
              <Col span={6}><Statistic title={t("admin_reports.open_po_amount")} value={management?.purchases?.openAmount ?? 0} precision={2} suffix="฿" /></Col>
            </Row>
            <Table
              style={{ marginTop: 12 }} rowKey="key" size="small" pagination={false}
              dataSource={management?.purchases?.bySupplier || []}
              columns={[
                { title: t("admin_reports.col_supplier"), dataIndex: "key" },
                { title: t("admin_reports.col_count"), dataIndex: "count", align: "right" as const },
                { title: t("admin_reports.col_amount"), dataIndex: "amount", align: "right" as const, render: baht },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.customers_title")}>
            <Typography.Paragraph type="secondary">{t("admin_reports.customer_scope_note")}</Typography.Paragraph>
            <Row gutter={[12, 12]}>
              <Col span={8}><Statistic title={t("admin_reports.new_customers")} value={management?.customers?.newCustomers ?? 0} /></Col>
              <Col span={8}><Statistic title={t("admin_reports.repeat_customers")} value={management?.customers?.repeatCustomers ?? 0} /></Col>
              <Col span={8}><Statistic title={t("admin_reports.repeat_rate")} value={management?.customers?.repeatRate ?? 0} precision={1} suffix="%" /></Col>
              <Col span={12}><Statistic title={t("admin_reports.identified_revenue")} value={management?.customers?.identifiedRevenue ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={12}><Statistic title={t("admin_reports.anonymous_orders")} value={management?.customers?.anonymousOrders ?? 0} /></Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.fulfillment_title")}>
            <Row gutter={[12, 12]}>
              <Col span={6}><Statistic title={t("admin_reports.shipments")} value={management?.fulfillment?.shipmentCount ?? 0} /></Col>
              <Col span={6}><Statistic title={t("admin_reports.delivered")} value={management?.fulfillment?.deliveredCount ?? 0} /></Col>
              <Col span={6}><Statistic title={t("admin_reports.in_progress")} value={management?.fulfillment?.inProgressCount ?? 0} /></Col>
              <Col span={6}><Statistic title={t("admin_reports.exceptions")} value={management?.fulfillment?.exceptionCount ?? 0} /></Col>
            </Row>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
              {t("admin_reports.delivery_time_note", { hours: Number(management?.fulfillment?.avgDeliveryHours ?? 0).toFixed(1) })}
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.controls_title")}>
            <Row gutter={[12, 12]}>
              <Col span={8}><Statistic title={t("admin_reports.discount_amount")} value={management?.controls?.discountAmount ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={8}><Statistic title={t("admin_reports.void_amount")} value={management?.controls?.voidAmount ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={8}><Statistic title={t("admin_reports.cash_variance")} value={management?.controls?.absoluteCashVariance ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={8}><Statistic title={t("admin_reports.no_sale_count")} value={management?.controls?.noSaleCount ?? 0} /></Col>
              <Col span={8}><Statistic title={t("admin_reports.cash_in")} value={management?.controls?.cashIn ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={8}><Statistic title={t("admin_reports.cash_out")} value={management?.controls?.cashOut ?? 0} precision={2} suffix="฿" /></Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={t("admin_reports.liabilities_title")}>
            <Typography.Paragraph type="secondary">{t("admin_reports.liability_scope_note")}</Typography.Paragraph>
            <Row gutter={[12, 12]}>
              <Col span={8}><Statistic title={t("admin_reports.loyalty_liability")} value={management?.liabilities?.loyaltyValue ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={8}><Statistic title={t("admin_reports.store_credit_liability")} value={management?.liabilities?.storeCreditAmount ?? 0} precision={2} suffix="฿" /></Col>
              <Col span={8}><Statistic title={t("admin_reports.ar_outstanding")} value={management?.liabilities?.arOutstandingAmount ?? 0} precision={2} suffix="฿" /></Col>
            </Row>
            <Alert
              closable
              style={{ marginTop: 12 }}
              type={(management?.liabilities?.balanceMismatchCount ?? 0) === 0 ? "success" : "error"}
              showIcon
              message={t("admin_reports.balance_mismatch", { count: management?.liabilities?.balanceMismatchCount ?? 0 })}
            />
          </Card>
        </Col>
      </Row>

      {["VARIANTS", "PACKS", "LOTS_EXPIRY", "SERIALS", "WASTAGE", "ACCOUNTS_RECEIVABLE", "RESTAURANT"].some(hasReportModule) && (
      <Card title={t("admin_reports.catalog_controls_title", { archetype: archetypeLabel })} style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary">{t("admin_reports.catalog_controls_desc")}</Typography.Paragraph>
        <Row gutter={[16, 16]}>
          {(hasReportModule("VARIANTS") || hasReportModule("RESTAURANT")) && (
            <>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.active_variants")} value={archetypeReport?.catalog?.activeVariantCount ?? 0} /></Col>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.multi_variant_products")} value={archetypeReport?.catalog?.multiVariantProductCount ?? 0} /></Col>
            </>
          )}
          {hasReportModule("PACKS") && (
            <>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.active_packs")} value={archetypeReport?.catalog?.activePackCount ?? 0} /></Col>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.alternate_packs")} value={archetypeReport?.catalog?.alternatePackCount ?? 0} /></Col>
            </>
          )}
          {hasReportModule("LOTS_EXPIRY") && (
            <>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.expiring_lots")} value={archetypeReport?.catalog?.expiringLotCount ?? 0} valueStyle={{ color: archetypeReport?.catalog?.expiringLotCount ? "#d46b08" : undefined }} /></Col>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.expiring_units")} value={archetypeReport?.catalog?.expiringUnits ?? 0} /></Col>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.expired_lots")} value={archetypeReport?.catalog?.expiredLotCount ?? 0} valueStyle={{ color: archetypeReport?.catalog?.expiredLotCount ? "#cf1322" : undefined }} /></Col>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.lots_missing_expiry")} value={archetypeReport?.catalog?.lotsMissingExpiry ?? 0} /></Col>
            </>
          )}
          {hasReportModule("SERIALS") && (
            <>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.serial_tracked_skus")} value={archetypeReport?.catalog?.serialTrackedSkuCount ?? 0} /></Col>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.serials_in_stock")} value={archetypeReport?.catalog?.serialInStockCount ?? 0} /></Col>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.serials_sold")} value={archetypeReport?.catalog?.serialSoldCount ?? 0} /></Col>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.serials_returned")} value={archetypeReport?.catalog?.serialReturnedCount ?? 0} /></Col>
            </>
          )}
          {hasReportModule("WASTAGE") && (
            <Col xs={12} md={6}><Statistic title={t("admin_reports.wastage_units")} value={management?.controls?.wastageQty ?? 0} /></Col>
          )}
          {hasReportModule("ACCOUNTS_RECEIVABLE") && (
            <>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.ar_outstanding")} value={management?.liabilities?.arOutstandingAmount ?? 0} precision={2} suffix="฿" /></Col>
              <Col xs={12} md={6}><Statistic title={t("admin_reports.ar_overdue")} value={management?.liabilities?.arOverdueAmount ?? 0} precision={2} suffix="฿" valueStyle={{ color: management?.liabilities?.arOverdueAmount ? "#cf1322" : undefined }} /></Col>
            </>
          )}
        </Row>
      </Card>
      )}

      {archetypeReport?.restaurant && (
        <Card title={t("admin_reports.restaurant_operations_title")} style={{ marginTop: 16 }}>
          <Typography.Paragraph type="secondary">{t("admin_reports.restaurant_operations_desc")}</Typography.Paragraph>
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.restaurant_checks")} value={archetypeReport.restaurant.checkCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.restaurant_guests")} value={archetypeReport.restaurant.guestCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.avg_table_minutes")} value={archetypeReport.restaurant.avgTableMinutes} precision={1} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.cancelled_checks")} value={archetypeReport.restaurant.cancelledCheckCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.kitchen_tickets")} value={archetypeReport.restaurant.kitchenTicketCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.served_tickets")} value={archetypeReport.restaurant.servedTicketCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.avg_kitchen_minutes")} value={archetypeReport.restaurant.avgKitchenMinutes} precision={1} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.qr_acceptance")} value={archetypeReport.restaurant.qrAcceptedCount} suffix={`/ ${archetypeReport.restaurant.qrSubmissionCount}`} /></Col>
          </Row>
        </Card>
      )}

      {archetypeReport?.pharmacy && (
        <Card title={t("admin_reports.pharmacy_operations_title")} style={{ marginTop: 16 }}>
          <Alert closable type="info" showIcon message={t("admin_reports.pharmacy_privacy_note")} style={{ marginBottom: 16 }} />
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.pharmacy_policies")} value={archetypeReport.pharmacy.policyCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.approved_policies")} value={archetypeReport.pharmacy.approvedPolicyCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.draft_policies")} value={archetypeReport.pharmacy.draftPolicyCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.pending_review_policies")} value={archetypeReport.pharmacy.pendingReviewPolicyCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.missing_policy_skus")} value={archetypeReport.pharmacy.missingPolicySkuCount} valueStyle={{ color: archetypeReport.pharmacy.missingPolicySkuCount ? "#cf1322" : undefined }} /></Col>
          </Row>
        </Card>
      )}

      {archetypeReport?.boardGame && (
        <Card title={t("admin_reports.board_game_operations_title")} style={{ marginTop: 16 }}>
          <Typography.Paragraph type="secondary">{t("admin_reports.board_game_operations_desc")}</Typography.Paragraph>
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.play_sessions")} value={archetypeReport.boardGame.sessionCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.play_guests")} value={archetypeReport.boardGame.guestCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.avg_play_minutes")} value={archetypeReport.boardGame.avgPlayMinutes} precision={1} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.paid_billing_groups")} value={archetypeReport.boardGame.paidBillingGroupCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.open_billing_groups")} value={archetypeReport.boardGame.openBillingGroupCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.settled_play_amount")} value={archetypeReport.boardGame.settledAmount} precision={2} suffix="฿" /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.game_titles")} value={archetypeReport.boardGame.titleCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.available_game_copies")} value={archetypeReport.boardGame.availableCopyCount} suffix={`/ ${archetypeReport.boardGame.copyCount}`} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.game_copies_attention")} value={archetypeReport.boardGame.attentionCopyCount} valueStyle={{ color: archetypeReport.boardGame.attentionCopyCount ? "#d46b08" : undefined }} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.active_member_passes")} value={archetypeReport.boardGame.activePassCount} /></Col>
            <Col xs={12} md={6}><Statistic title={t("admin_reports.remaining_pass_minutes")} value={archetypeReport.boardGame.remainingPassMinutes} /></Col>
          </Row>
        </Card>
      )}

      <ReportGeneratorCard from={from} to={to} locationId={locationId} archetype={reportProfile?.archetype} />
    </div>
  );
}
