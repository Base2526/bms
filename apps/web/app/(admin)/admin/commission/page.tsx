"use client";

import { useUiText } from "@/lib/useUiText";
// ค่าคอมมิชชันพนักงานขาย (8.5)
// -------------------------------------------------------------
// สองส่วน: อัตรา (แก้ได้ด้วย commission.manage) และรายงาน (ดูได้ด้วย commission.view)
//
// อัตราแสดงเป็น "ประวัติ" ไม่ใช่ช่องเดียวให้พิมพ์ทับ — เพราะอัตราคือของที่มีวันเริ่มใช้
// การทำให้หน้าจอดูเหมือนแก้ทับได้จะทำให้คนคาดว่ารายงานเดือนก่อนเปลี่ยนตาม ซึ่งไม่ใช่

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, DatePicker, Empty, InputNumber, Select, Space, Statistic, Table, Tag, Typography, message } from "antd";
import { ReadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import Link from "next/link";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

type Rule = {
  id: number;
  scope: "DEFAULT" | "PRODUCT" | "CATEGORY";
  ref: string | null;
  percent: number;
  effectiveFrom: string;
  note: string | null;
};

type Row = {
  staffId: string;
  staffName: string;
  grossSales: number;
  returnedSales: number;
  eligibleSales: number;
  commission: number;
  billCount: number;
};

type Report = {
  from: string;
  to: string;
  rows: Row[];
  totalCommission: number;
  noRulesConfigured: boolean;
};

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CommissionPage() {
  const uiText = useUiText();
  const { can, loading: permLoading } = useBmsPermissions();
  const [rules, setRules] = useState<Rule[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf("month"), dayjs()]);
  const [busy, setBusy] = useState(false);

  // ฟอร์มเพิ่มอัตรา
  const [scope, setScope] = useState<Rule["scope"]>("DEFAULT");
  const [ref, setRef] = useState("");
  const [percent, setPercent] = useState<number | null>(2);
  const [from, setFrom] = useState<Dayjs>(dayjs());

  const loadRules = useCallback(async () => {
    const res = await fetch("/api/bms/commission?rules=1", { credentials: "include" });
    if (res.ok) setRules((await res.json()).rules ?? []);
  }, []);

  const loadReport = useCallback(async () => {
    const qs = new URLSearchParams({
      from: range[0].format("YYYY-MM-DD"),
      to: range[1].format("YYYY-MM-DD"),
    });
    const res = await fetch(`/api/bms/commission?${qs}`, { credentials: "include" });
    if (res.ok) setReport((await res.json()).report);
    else setReport(null);
  }, [range]);

  useEffect(() => { if (can("commission.view")) void loadRules(); }, [can, loadRules]);
  useEffect(() => { if (can("commission.view")) void loadReport(); }, [can, loadReport]);

  if (!permLoading && !can("commission.view")) {
    return <Alert closable type="error" showIcon message={uiText("admin_ui.you_do_not_have_permission_to_view_commissions_1138e")} />;
  }

  const saveRule = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/bms/commission", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "upsert", scope,
          ref: scope === "DEFAULT" ? null : ref.trim(),
          percent, effectiveFrom: from.format("YYYY-MM-DD"),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.reason ?? data.error ?? uiText("admin_ui.could_not_save_2fe23"));
      message.success(uiText("admin_ui.commission_rate_saved_9b57f"));
      await loadRules();
      await loadReport();
    } catch (e: any) {
      message.error(e?.message ?? uiText("admin_ui.could_not_save_2fe23"));
    } finally {
      setBusy(false);
    }
  };

  const removeRule = async (id: number) => {
    const res = await fetch("/api/bms/commission", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    if (res.ok) { await loadRules(); await loadReport(); }
    else message.error(uiText("admin_ui.delete_failed_cbec2"));
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title={uiText("admin_ui.sales_staff_commissions_7091c")}>
        <Link href="/admin/pos-manual"><Button icon={<ReadOutlined />}>{uiText("admin_ui.cashier_manual_3e8eb")}</Button></Link>
      </AdminPageHeader>

      <Alert closable
        type="info"
        showIcon
        message={uiText("admin_ui.rates_apply_on_the_sale_date_not_the_87cef")}
        description={uiText("admin_ui.increasing_the_rate_today_does_not_change_commissions_ce7a7")}
      />

      {can("commission.manage") && (
        <Card title={uiText("admin_ui.commission_rates_3499b")}>
          <Space wrap align="end" style={{ marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>{uiText("admin_ui.applies_to_bde54")}</div>
              <Select
                value={scope}
                onChange={(v) => setScope(v)}
                style={{ width: 160 }}
                options={[
                  { value: "DEFAULT", label: uiText("admin_ui.all_products_b9bc7") },
                  { value: "CATEGORY", label: uiText("admin_ui.specific_category_c5985") },
                  { value: "PRODUCT", label: uiText("admin_ui.specific_product_sku_2b02f") },
                ]}
              />
            </div>
            {scope !== "DEFAULT" && (
              <div>
                <div style={{ fontSize: 12, marginBottom: 4 }}>{scope === "PRODUCT" ? "SKU" : uiText("admin_ui.category_name_08a90")}</div>
                <input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  style={{ padding: 7, fontSize: 14, width: 200 }}
                />
              </div>
            )}
            <div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>{uiText("admin_ui.rate_c3ce2")}</div>
              <InputNumber min={0} max={100} step={0.1} value={percent} onChange={setPercent} style={{ width: 110 }} />
            </div>
            <div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>{uiText("admin_ui.effective_from_a75de")}</div>
              <DatePicker value={from} onChange={(d) => d && setFrom(d)} allowClear={false} />
            </div>
            <Button type="primary" loading={busy} onClick={() => void saveRule()}>{uiText("admin_ui.save_rate_0aad1")}</Button>
          </Space>

          {rules.length === 0 ? (
            <Empty description={uiText("admin_ui.no_commission_rates_configured_all_amounts_will_be_3447b")} />
          ) : (
            <Table<Rule>
              size="small"
              rowKey="id"
              dataSource={rules}
              pagination={false}
              columns={[
                {
                  title: uiText("admin_ui.applies_to_bde54"), width: 220,
                  render: (_, r) => r.scope === "DEFAULT"
                    ? <Tag>{uiText("admin_ui.all_products_b9bc7")}</Tag>
                    : <Space size={4}><Tag color={r.scope === "PRODUCT" ? "blue" : "purple"}>{r.scope === "PRODUCT" ? uiText("admin_ui.product_8432c") : uiText("admin_ui.category_f7bae")}</Tag><Typography.Text code>{r.ref}</Typography.Text></Space>,
                },
                { title: uiText("admin_ui.rate_10542"), dataIndex: "percent", width: 110, render: (v: number) => `${v}%` },
                { title: uiText("admin_ui.starts_fb055"), dataIndex: "effectiveFrom", width: 140 },
                { title: uiText("admin_ui.note_ddbdb"), dataIndex: "note" },
                {
                  title: "", width: 80,
                  render: (_, r) => <Button type="text" danger onClick={() => void removeRule(r.id)}>{uiText("admin_ui.remove_f535f")}</Button>,
                },
              ]}
            />
          )}
        </Card>
      )}

      <Card
        title={uiText("admin_ui.commissions_by_period_71387")}
        extra={
          <Space>
            <DatePicker.RangePicker
              value={range}
              onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
              allowClear={false}
            />
            <Button onClick={() => void loadReport()}>{uiText("admin_ui.recalculate_1e2f1")}</Button>
          </Space>
        }
      >
        {report?.noRulesConfigured && (
          <Alert closable
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={uiText("admin_ui.no_commission_rates_are_configured_for_this_store_f26c0")}
          />
        )}
        <Space size="large" wrap style={{ marginBottom: 12 }}>
          <Statistic title={uiText("admin_ui.total_commission_for_the_period_abf3c")} value={report?.totalCommission ?? 0} precision={2} prefix="฿" />
          <Statistic title={uiText("admin_ui.staff_with_sales_82869")} value={report?.rows.length ?? 0} />
        </Space>
        <Table<Row>
          size="small"
          rowKey="staffId"
          dataSource={report?.rows ?? []}
          pagination={false}
          columns={[
            { title: uiText("admin_ui.staff_e82d8"), dataIndex: "staffName" },
            { title: uiText("admin_ui.bills_14331"), dataIndex: "billCount", width: 90 },
            { title: uiText("admin_ui.revenue_36cc1"), width: 140, render: (_, r) => `฿${baht(r.grossSales)}` },
            {
              title: uiText("admin_ui.returned_78d55"), width: 140,
              render: (_, r) => r.returnedSales > 0
                ? <span style={{ color: "#cf1322" }}>−฿{baht(r.returnedSales)}</span>
                : "—",
            },
            { title: uiText("admin_ui.commissionable_sales_b41ee"), width: 150, render: (_, r) => `฿${baht(r.eligibleSales)}` },
            {
              title: uiText("admin_ui.commission_bc83b"), width: 140,
              render: (_, r) => <strong>฿{baht(r.commission)}</strong>,
            },
          ]}
        />
      </Card>
    </Space>
  );
}
