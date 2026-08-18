'use client';
// ค่าคอมมิชชันพนักงานขาย (8.5)
// -------------------------------------------------------------
// สองส่วน: อัตรา (แก้ได้ด้วย commission.manage) และรายงาน (ดูได้ด้วย commission.view)
//
// อัตราแสดงเป็น "ประวัติ" ไม่ใช่ช่องเดียวให้พิมพ์ทับ — เพราะอัตราคือของที่มีวันเริ่มใช้
// การทำให้หน้าจอดูเหมือนแก้ทับได้จะทำให้คนคาดว่ารายงานเดือนก่อนเปลี่ยนตาม ซึ่งไม่ใช่

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, DatePicker, Empty, InputNumber, Select, Space, Statistic, Table, Tag, Typography, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
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
    return <Alert type="error" showIcon message="ไม่มีสิทธิ์ดูค่าคอม" />;
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
      if (!res.ok) throw new Error(data.reason ?? data.error ?? "บันทึกไม่สำเร็จ");
      message.success("บันทึกอัตราแล้ว");
      await loadRules();
      await loadReport();
    } catch (e: any) {
      message.error(e?.message ?? "บันทึกไม่สำเร็จ");
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
    else message.error("ลบไม่สำเร็จ");
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title="ค่าคอมพนักงานขาย" />

      <Alert
        type="info"
        showIcon
        message="อัตราคอมผูกกับวันที่ขาย ไม่ใช่วันที่เปิดดู"
        description="ขึ้นอัตราวันนี้ไม่กระทบยอดของเดือนที่จ่ายไปแล้ว — รายงานใช้อัตราที่มีผลอยู่ ณ วันที่ของบิลนั้น ๆ · การแก้อัตราคือการเพิ่มแถวใหม่ที่มีวันเริ่มใช้ใหม่"
      />

      {can("commission.manage") && (
        <Card title="อัตราคอม">
          <Space wrap align="end" style={{ marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>ใช้กับ</div>
              <Select
                value={scope}
                onChange={(v) => setScope(v)}
                style={{ width: 160 }}
                options={[
                  { value: "DEFAULT", label: "ทุกสินค้า" },
                  { value: "CATEGORY", label: "เจาะจงหมวด" },
                  { value: "PRODUCT", label: "เจาะจงสินค้า (SKU)" },
                ]}
              />
            </div>
            {scope !== "DEFAULT" && (
              <div>
                <div style={{ fontSize: 12, marginBottom: 4 }}>{scope === "PRODUCT" ? "SKU" : "ชื่อหมวด"}</div>
                <input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  style={{ padding: 7, fontSize: 14, width: 200 }}
                />
              </div>
            )}
            <div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>อัตรา (%)</div>
              <InputNumber min={0} max={100} step={0.1} value={percent} onChange={setPercent} style={{ width: 110 }} />
            </div>
            <div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>เริ่มใช้วันที่</div>
              <DatePicker value={from} onChange={(d) => d && setFrom(d)} allowClear={false} />
            </div>
            <Button type="primary" loading={busy} onClick={() => void saveRule()}>บันทึกอัตรา</Button>
          </Space>

          {rules.length === 0 ? (
            <Empty description="ยังไม่ได้ตั้งอัตราคอม — ทุกยอดจะเป็น 0" />
          ) : (
            <Table<Rule>
              size="small"
              rowKey="id"
              dataSource={rules}
              pagination={false}
              columns={[
                {
                  title: "ใช้กับ", width: 220,
                  render: (_, r) => r.scope === "DEFAULT"
                    ? <Tag>ทุกสินค้า</Tag>
                    : <Space size={4}><Tag color={r.scope === "PRODUCT" ? "blue" : "purple"}>{r.scope === "PRODUCT" ? "สินค้า" : "หมวด"}</Tag><Typography.Text code>{r.ref}</Typography.Text></Space>,
                },
                { title: "อัตรา", dataIndex: "percent", width: 110, render: (v: number) => `${v}%` },
                { title: "เริ่มใช้", dataIndex: "effectiveFrom", width: 140 },
                { title: "หมายเหตุ", dataIndex: "note" },
                {
                  title: "", width: 80,
                  render: (_, r) => <Button type="text" danger onClick={() => void removeRule(r.id)}>ลบ</Button>,
                },
              ]}
            />
          )}
        </Card>
      )}

      <Card
        title="ยอดคอมตามช่วงเวลา"
        extra={
          <Space>
            <DatePicker.RangePicker
              value={range}
              onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
              allowClear={false}
            />
            <Button onClick={() => void loadReport()}>คำนวณใหม่</Button>
          </Space>
        }
      >
        {report?.noRulesConfigured && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="ยังไม่ได้ตั้งอัตราคอมของร้าน — ตัวเลขทั้งหมดจึงเป็น 0 ไม่ใช่เพราะไม่มียอดขาย"
          />
        )}
        <Space size="large" wrap style={{ marginBottom: 12 }}>
          <Statistic title="คอมรวมทั้งช่วง" value={report?.totalCommission ?? 0} precision={2} prefix="฿" />
          <Statistic title="พนักงานที่มียอด" value={report?.rows.length ?? 0} />
        </Space>
        <Table<Row>
          size="small"
          rowKey="staffId"
          dataSource={report?.rows ?? []}
          pagination={false}
          columns={[
            { title: "พนักงาน", dataIndex: "staffName" },
            { title: "บิล", dataIndex: "billCount", width: 90 },
            { title: "ยอดขาย", width: 140, render: (_, r) => `฿${baht(r.grossSales)}` },
            {
              title: "ถูกคืน", width: 140,
              render: (_, r) => r.returnedSales > 0
                ? <span style={{ color: "#cf1322" }}>−฿{baht(r.returnedSales)}</span>
                : "—",
            },
            { title: "ยอดที่นับคอม", width: 150, render: (_, r) => `฿${baht(r.eligibleSales)}` },
            {
              title: "คอม", width: 140,
              render: (_, r) => <strong>฿{baht(r.commission)}</strong>,
            },
          ]}
        />
      </Card>
    </Space>
  );
}
