'use client';
// ใบกำกับภาษี + รายงานภาษีขาย (ประกอบ ภ.พ.30)
// -------------------------------------------------------------
// อ่านอย่างเดียว · สิทธิ์ tax.document.view · ส่งออก XLSX ผ่าน bmsGenerateReport (report.view)
//
// ส่วน "ต้องตรวจสอบ" อยู่เหนือตารางเอกสารโดยตั้งใจ — มันคือสิ่งที่ทำให้ยอดในรายงานไม่ครบ
// ถ้าซ่อนไว้ใต้ตาราง คนจะส่งยอดให้นักบัญชีโดยไม่เห็นว่ามีบิลที่ไม่มีใบกำกับค้างอยู่

import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Alert, Button, Card, Col, DatePicker, Empty, Input, Row, Select, Space, Statistic, Switch, Table, Tag, Typography, message,
} from "antd";
import { FileExcelOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useI18n } from "@/lib/i18nContext";

const Q_ESTABLISHMENTS = gql`
  query TaxEstablishments {
    bmsTaxEstablishments { locationId code name branchCode isHeadOffice }
  }
`;

const Q_SUMMARY = gql`
  query SalesTaxSummary($input: BmsSalesTaxReportInput!) {
    bmsSalesTaxReport(input: $input) {
      vatRegistered sellerTaxId from to cancelledCount
      grandTotal { documentCount base exempt vat total rounding }
      totals { locationId branchCode documentCount base exempt vat total rounding }
      exceptions { kind locationId orderId at amount reference detail }
      exceptionCounts { paidWithoutTaxDocument returnWithoutCreditNote fullReplacesOtherMonth }
    }
  }
`;

const Q_DOCUMENTS = gql`
  query TaxDocumentList($input: BmsTaxDocumentListInput!) {
    bmsTaxDocumentList(input: $input) {
      total
      rows {
        id orderId locationId locationCode branchCode deviceCode docType docNo issueDate issuedAt
        cancelledAt cancelledReason buyerName buyerTaxId referenceDocNo channel base exempt vat total rounding
      }
    }
  }
`;

const M_GENERATE = gql`
  mutation GenerateSalesTaxReport($input: BmsGenerateReportInput!) {
    bmsGenerateReport(input: $input) { fileId fileUrl }
  }
`;

type Establishment = { locationId: string; code: string; name: string; branchCode: string; isHeadOffice: boolean };

const baht = (n: number) =>
  Number(n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAGE_SIZE = 50;

export default function TaxDocumentsPage() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { can, loading: permLoading } = useBmsPermissions();
  const allowed = can("tax.document.view");

  const [month, setMonth] = useState<Dayjs>(dayjs().startOf("month"));
  const [locationId, setLocationId] = useState<string | undefined>();
  const [docType, setDocType] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [page, setPage] = useState(1);

  const from = month.startOf("month").format("YYYY-MM-DD");
  const to = month.endOf("month").format("YYYY-MM-DD");

  const est = useQuery(Q_ESTABLISHMENTS, { skip: !allowed });
  const summary = useQuery(Q_SUMMARY, {
    skip: !allowed,
    variables: { input: { from, to, locationId: locationId ?? null } },
    fetchPolicy: "cache-and-network",
  });
  const docs = useQuery(Q_DOCUMENTS, {
    skip: !allowed,
    variables: {
      input: {
        from, to, locationId: locationId ?? null, docType: docType ?? null,
        search: search.trim() || null, includeCancelled,
        limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE,
      },
    },
    fetchPolicy: "cache-and-network",
  });
  const [generate, { loading: generating }] = useMutation(M_GENERATE);

  const establishments: Establishment[] = est.data?.bmsTaxEstablishments ?? [];
  const placeLabel = useMemo(() => {
    const byId = new Map(establishments.map((e) => [e.locationId, e]));
    return (id: string | null | undefined) => {
      const e = id ? byId.get(id) : undefined;
      if (!e) return "—";
      return e.isHeadOffice
        ? t("admin_tax_documents.head_office", { code: e.branchCode })
        : t("admin_tax_documents.branch_no", { code: e.branchCode });
    };
  }, [establishments, t]);

  if (!permLoading && !allowed) {
    return <Alert closable type="error" showIcon message={t("admin_tax_documents.no_permission")} />;
  }

  const s = summary.data?.bmsSalesTaxReport;
  const counts = s?.exceptionCounts;
  const exceptionTotal = counts
    ? counts.paidWithoutTaxDocument + counts.returnWithoutCreditNote + counts.fullReplacesOtherMonth
    : 0;

  const kindLabel: Record<string, string> = {
    ABBREVIATED: t("admin_tax_documents.type_abbreviated"),
    FULL: t("admin_tax_documents.type_full"),
    CREDIT_NOTE: t("admin_tax_documents.type_credit_note"),
  };
  const exceptionLabel: Record<string, string> = {
    PAID_WITHOUT_TAX_DOCUMENT: t("admin_tax_documents.exception_paid_without_doc"),
    RETURN_WITHOUT_CREDIT_NOTE: t("admin_tax_documents.exception_return_without_note"),
    FULL_REPLACES_OTHER_MONTH: t("admin_tax_documents.exception_full_other_month"),
  };

  const exportXlsx = async (reportType: "VAT_SALES" | "STOCK_LEDGER") => {
    try {
      const res = await generate({
        variables: { input: { reportType, format: "XLSX", dateFrom: from, dateTo: to, locationId: locationId ?? null, includeSummary: false } },
      });
      const url = res.data?.bmsGenerateReport?.fileUrl;
      if (url) window.open(url, "_blank");
      message.success(t("admin_tax_documents.export_done"));
    } catch (err: any) {
      message.error(err?.message || t("admin_tax_documents.export_failed"));
    }
  };

  const shownExceptions = s?.exceptions?.length ?? 0;

  return (
    <div>
      <AdminPageHeader title={t("admin_tax_documents.page_title")}>
        <Select
          allowClear
          value={locationId}
          placeholder={t("admin_tax_documents.all_establishments")}
          style={{ width: isMobile ? "100%" : 240 }}
          onChange={(v) => { setLocationId(v || undefined); setPage(1); }}
          options={establishments.map((e) => ({ value: e.locationId, label: `${placeLabel(e.locationId)} · ${e.name}` }))}
        />
        <DatePicker
          picker="month"
          allowClear={false}
          value={month}
          style={{ width: isMobile ? "100%" : undefined }}
          onChange={(v) => { if (v) { setMonth(v.startOf("month")); setPage(1); } }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => { void summary.refetch(); void docs.refetch(); }}>
          {t("admin_tax_documents.refresh")}
        </Button>
        {can("report.view") && (
          <>
            <Button type="primary" icon={<FileExcelOutlined />} loading={generating} onClick={() => exportXlsx("VAT_SALES")}>
              {t("admin_tax_documents.export_xlsx")}
            </Button>
            <Button icon={<FileExcelOutlined />} loading={generating} onClick={() => exportXlsx("STOCK_LEDGER")}>
              {t("admin_tax_documents.export_stock_ledger")}
            </Button>
          </>
        )}
      </AdminPageHeader>

      <Alert
        closable
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t("admin_tax_documents.intro_title")}
        description={t("admin_tax_documents.intro_desc")}
      />

      {summary.error && (
        <Alert closable type="error" showIcon style={{ marginBottom: 16 }} message={t("admin_tax_documents.load_error")} description={summary.error.message} />
      )}

      {s && !s.vatRegistered && (
        <Alert closable type="warning" showIcon style={{ marginBottom: 16 }} message={t("admin_tax_documents.not_vat_registered")} />
      )}
      {s && s.vatRegistered && !s.sellerTaxId && (
        <Alert closable type="warning" showIcon style={{ marginBottom: 16 }} message={t("admin_tax_documents.missing_tax_id")} />
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}><Card><Statistic title={t("admin_tax_documents.kpi_base")} value={s?.grandTotal.base ?? 0} precision={2} suffix="฿" /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={t("admin_tax_documents.kpi_vat")} value={s?.grandTotal.vat ?? 0} precision={2} suffix="฿" /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={t("admin_tax_documents.kpi_exempt")} value={s?.grandTotal.exempt ?? 0} precision={2} suffix="฿" /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title={t("admin_tax_documents.kpi_documents")} value={s?.grandTotal.documentCount ?? 0} /></Card></Col>
      </Row>

      <Card
        title={t("admin_tax_documents.exceptions_title")}
        style={{ marginBottom: 16 }}
        extra={exceptionTotal === 0
          ? <Tag color="green">{t("admin_tax_documents.exceptions_none")}</Tag>
          : <Tag color="red">{t("admin_tax_documents.exceptions_count", { count: exceptionTotal })}</Tag>}
      >
        {counts && (
          <Space wrap style={{ marginBottom: 12 }}>
            <Tag color={counts.paidWithoutTaxDocument ? "red" : "default"}>
              {exceptionLabel.PAID_WITHOUT_TAX_DOCUMENT}: {counts.paidWithoutTaxDocument}
            </Tag>
            <Tag color={counts.returnWithoutCreditNote ? "red" : "default"}>
              {exceptionLabel.RETURN_WITHOUT_CREDIT_NOTE}: {counts.returnWithoutCreditNote}
            </Tag>
            <Tag color={counts.fullReplacesOtherMonth ? "orange" : "default"}>
              {exceptionLabel.FULL_REPLACES_OTHER_MONTH}: {counts.fullReplacesOtherMonth}
            </Tag>
          </Space>
        )}
        {exceptionTotal > shownExceptions && (
          <Alert closable type="warning" showIcon style={{ marginBottom: 12 }}
            message={t("admin_tax_documents.exceptions_truncated", { shown: shownExceptions, total: exceptionTotal })} />
        )}
        {shownExceptions === 0 ? (
          <Empty description={t("admin_tax_documents.exceptions_empty")} />
        ) : (
          <Table
            size="small"
            rowKey={(r: any) => `${r.kind}:${r.orderId}:${r.reference ?? ""}`}
            dataSource={s?.exceptions ?? []}
            pagination={{ pageSize: 10 }}
            scroll={{ x: true }}
            columns={[
              { title: t("admin_tax_documents.col_issue"), dataIndex: "kind", render: (k: string) => exceptionLabel[k] ?? k },
              { title: t("admin_tax_documents.col_date"), dataIndex: "at", render: (v: string) => dayjs(v).format("DD/MM/YYYY") },
              { title: t("admin_tax_documents.col_establishment"), dataIndex: "locationId", render: (v: string) => placeLabel(v) },
              { title: t("admin_tax_documents.col_order"), dataIndex: "orderId", render: (v: string) => <Typography.Text code copyable>{v.slice(0, 8)}</Typography.Text> },
              { title: t("admin_tax_documents.col_reference"), dataIndex: "reference", render: (v: string | null) => v ?? "—" },
              { title: t("admin_tax_documents.col_amount"), dataIndex: "amount", align: "right" as const, render: baht },
              { title: t("admin_tax_documents.col_detail"), dataIndex: "detail", render: (v: string | null) => v ?? "" },
            ]}
          />
        )}
      </Card>

      {(s?.totals?.length ?? 0) > 1 && (
        <Card title={t("admin_tax_documents.by_establishment")} style={{ marginBottom: 16 }}>
          <Table
            size="small"
            rowKey="locationId"
            pagination={false}
            dataSource={s?.totals ?? []}
            scroll={{ x: true }}
            columns={[
              { title: t("admin_tax_documents.col_establishment"), dataIndex: "locationId", render: (v: string) => placeLabel(v) },
              { title: t("admin_tax_documents.col_documents"), dataIndex: "documentCount", align: "right" as const },
              { title: t("admin_tax_documents.col_base"), dataIndex: "base", align: "right" as const, render: baht },
              { title: t("admin_tax_documents.col_exempt"), dataIndex: "exempt", align: "right" as const, render: baht },
              { title: t("admin_tax_documents.col_vat"), dataIndex: "vat", align: "right" as const, render: baht },
            ]}
          />
        </Card>
      )}

      <Card
        title={t("admin_tax_documents.documents_title")}
        extra={
          <Space wrap>
            <Select
              allowClear
              value={docType}
              placeholder={t("admin_tax_documents.all_types")}
              style={{ width: 200 }}
              onChange={(v) => { setDocType(v || undefined); setPage(1); }}
              options={Object.entries(kindLabel).map(([value, label]) => ({ value, label }))}
            />
            <Input.Search
              allowClear
              placeholder={t("admin_tax_documents.search_placeholder")}
              style={{ width: isMobile ? "100%" : 240 }}
              onSearch={(v) => { setSearch(v); setPage(1); }}
            />
            <Space>
              <Switch checked={includeCancelled} onChange={(v) => { setIncludeCancelled(v); setPage(1); }} />
              <span>{t("admin_tax_documents.include_cancelled")}</span>
            </Space>
          </Space>
        }
      >
        {docs.error && <Alert closable type="error" showIcon message={docs.error.message} style={{ marginBottom: 12 }} />}
        <Table
          size="small"
          rowKey="id"
          loading={docs.loading}
          dataSource={docs.data?.bmsTaxDocumentList?.rows ?? []}
          scroll={{ x: true }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total: docs.data?.bmsTaxDocumentList?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            { title: t("admin_tax_documents.col_date"), dataIndex: "issueDate", render: (v: string) => dayjs(v).format("DD/MM/YYYY") },
            { title: t("admin_tax_documents.col_doc_no"), dataIndex: "docNo", render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
            {
              title: t("admin_tax_documents.col_type"), dataIndex: "docType",
              render: (v: string, r: any) => (
                <Space size={4} wrap>
                  <Tag color={v === "CREDIT_NOTE" ? "orange" : v === "FULL" ? "blue" : "default"}>{kindLabel[v] ?? v}</Tag>
                  {r.cancelledAt && <Tag color="red" title={r.cancelledReason ?? undefined}>{t("admin_tax_documents.cancelled")}</Tag>}
                </Space>
              ),
            },
            { title: t("admin_tax_documents.col_establishment"), dataIndex: "locationId", render: (v: string) => placeLabel(v) },
            { title: t("admin_tax_documents.col_device"), dataIndex: "deviceCode", render: (v: string | null) => v ?? "—" },
            {
              title: t("admin_tax_documents.col_buyer"), dataIndex: "buyerName",
              render: (v: string | null, r: any) => v ? <span>{v}{r.buyerTaxId ? <><br /><Typography.Text type="secondary">{r.buyerTaxId}</Typography.Text></> : null}</span> : "—",
            },
            { title: t("admin_tax_documents.col_reference"), dataIndex: "referenceDocNo", render: (v: string | null) => v ?? "—" },
            { title: t("admin_tax_documents.col_base"), dataIndex: "base", align: "right" as const, render: baht },
            { title: t("admin_tax_documents.col_vat"), dataIndex: "vat", align: "right" as const, render: baht },
            { title: t("admin_tax_documents.col_total"), dataIndex: "total", align: "right" as const, render: baht },
          ]}
        />
      </Card>
    </div>
  );
}
