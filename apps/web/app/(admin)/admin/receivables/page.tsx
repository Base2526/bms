'use client';
// ลูกหนี้การค้า / ขายเชื่อ (9.30)
// -------------------------------------------------------------
// สามส่วน: ภาพรวม+อายุหนี้ · บัญชีลูกค้า (วงเงิน/เทอม/ระงับ) · ใบที่ยังค้าง
//
// อายุหนี้อยู่บนสุดโดยตั้งใจ — คำถามแรกของคนที่เปิดหน้านี้คือ "หนี้ก้อนไหนค้างนาน"
// ไม่ใช่ "ลูกค้ามีกี่ราย" · ยอดรวมอย่างเดียวตอบคำถามนั้นไม่ได้เลย
//
// รับชำระ "เงินสด" ที่หน้านี้ไม่ได้โดยตั้งใจ: หลังร้านไม่มีลิ้นชัก เงินสดที่บันทึกโดย
// ไม่ผูกกะคือเงินที่นับปิดกะไม่เจอ — ต้องทำที่เครื่องขาย (ดู 9.30)

import { useMemo, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Alert, Button, Card, Col, Empty, Form, Input, InputNumber, Modal, Row,
  Select, Space, Statistic, Table, Tag, Tooltip, Typography, message,
} from "antd";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const { Text } = Typography;

const Q_OUTSTANDING = gql`
  query {
    bmsArOutstanding {
      outstandingAmount
      overdueAmount
      accountsWithBalance
      openInvoiceCount
      balanceMismatchCount
      aging { current d1to30 d31to60 d61to90 d90plus total }
    }
  }
`;

const Q_ACCOUNTS = gql`
  query ($search: String, $withBalanceOnly: Boolean) {
    bmsArAccounts(search: $search, withBalanceOnly: $withBalanceOnly) {
      id customerId customerName customerPhone creditLimit termsDays status
      balance creditLineAvailable creditBalance availableCredit overdueAmount openInvoiceCount note
    }
  }
`;

const Q_INVOICES = gql`
  query ($accountId: ID, $overdueOnly: Boolean) {
    bmsArInvoices(accountId: $accountId, openOnly: true, overdueOnly: $overdueOnly) {
      id accountId orderId customerName amount settledAmount creditedAmount
      outstanding status issuedAt dueAt docNo overdue daysPastDue
    }
  }
`;

const Q_CUSTOMERS = gql`
  query ($search: String) {
    bmsCustomers(search: $search, limit: 20) { id name phone }
  }
`;

const M_UPSERT = gql`
  mutation ($customerId: ID!, $creditLimit: Float!, $termsDays: Int!, $status: String, $note: String) {
    bmsUpsertArAccount(
      customerId: $customerId, creditLimit: $creditLimit, termsDays: $termsDays,
      status: $status, note: $note
    ) { id }
  }
`;

const M_RECEIPT = gql`
  mutation ($accountId: ID!, $amount: Float!, $method: String!, $reference: String, $idempotencyKey: String!) {
    bmsRecordArReceipt(
      accountId: $accountId, amount: $amount, method: $method,
      reference: $reference, idempotencyKey: $idempotencyKey
    ) { status balanceAfter allocations { invoiceId amount } }
  }
`;

const M_WRITEOFF = gql`
  mutation ($invoiceId: ID!, $reason: String!) {
    bmsWriteOffArInvoice(invoiceId: $invoiceId, reason: $reason) { amount balanceAfter }
  }
`;

type Account = {
  id: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  creditLimit: number;
  termsDays: number;
  status: "ACTIVE" | "ON_HOLD" | "CLOSED";
  balance: number;
  creditLineAvailable: number;
  creditBalance: number;
  availableCredit: number;
  overdueAmount: number;
  openInvoiceCount: number;
  note: string | null;
};

type Invoice = {
  id: string;
  accountId: string;
  orderId: string;
  customerName: string | null;
  amount: number;
  settledAmount: number;
  creditedAmount: number;
  outstanding: number;
  issuedAt: string;
  dueAt: string;
  docNo: string | null;
  overdue: boolean;
  daysPastDue: number;
};

const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => new Date(iso).toLocaleDateString("th-TH");

const STATUS_LABEL: Record<Account["status"], { text: string; color: string }> = {
  ACTIVE: { text: "ใช้งาน", color: "green" },
  ON_HOLD: { text: "ระงับการขายเชื่อ", color: "orange" },
  CLOSED: { text: "ปิดบัญชี", color: "default" },
};

export default function ReceivablesPage() {
  const { can, loading: permLoading } = useBmsPermissions();
  const [search, setSearch] = useState("");
  const [withBalanceOnly, setWithBalanceOnly] = useState(false);
  const [selected, setSelected] = useState<Account | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const [accountModal, setAccountModal] = useState<Account | "new" | null>(null);
  const [receiptFor, setReceiptFor] = useState<Account | null>(null);

  const outstanding = useQuery(Q_OUTSTANDING, { fetchPolicy: "cache-and-network" });
  const accounts = useQuery(Q_ACCOUNTS, {
    variables: { search: search || null, withBalanceOnly },
    fetchPolicy: "cache-and-network",
  });
  const invoices = useQuery(Q_INVOICES, {
    variables: { accountId: selected?.id ?? null, overdueOnly },
    fetchPolicy: "cache-and-network",
  });

  const refetchAll = () => {
    void outstanding.refetch();
    void accounts.refetch();
    void invoices.refetch();
  };

  const [upsertAccount, upsertState] = useMutation(M_UPSERT, {
    onCompleted: () => { message.success("บันทึกบัญชีเครดิตแล้ว"); setAccountModal(null); refetchAll(); },
    onError: (e) => message.error(e.message),
  });
  const [recordReceipt, receiptState] = useMutation(M_RECEIPT, {
    onCompleted: (d) => {
      message.success(`รับชำระแล้ว · ตัด ${d.bmsRecordArReceipt.allocations.length} ใบ`);
      setReceiptFor(null);
      refetchAll();
    },
    onError: (e) => message.error(e.message),
  });
  const [writeOff] = useMutation(M_WRITEOFF, {
    onCompleted: (d) => { message.success(`ตัดหนี้สูญ ฿${baht(d.bmsWriteOffArInvoice.amount)}`); refetchAll(); },
    onError: (e) => message.error(e.message),
  });

  const summary = outstanding.data?.bmsArOutstanding;
  const aging = summary?.aging;
  const accountRows: Account[] = accounts.data?.bmsArAccounts ?? [];
  const invoiceRows: Invoice[] = invoices.data?.bmsArInvoices ?? [];

  const agingCells = useMemo(
    () => [
      { label: "ยังไม่ถึงกำหนด", value: aging?.current ?? 0, color: undefined },
      { label: "เกิน 1–30 วัน", value: aging?.d1to30 ?? 0, color: "#d48806" },
      { label: "เกิน 31–60 วัน", value: aging?.d31to60 ?? 0, color: "#d46b08" },
      { label: "เกิน 61–90 วัน", value: aging?.d61to90 ?? 0, color: "#cf1322" },
      { label: "เกิน 90 วัน", value: aging?.d90plus ?? 0, color: "#a8071a" },
    ],
    [aging]
  );

  if (permLoading) return null;
  if (!can("ar.view")) {
    return <Alert closable type="warning" showIcon message="ไม่มีสิทธิ์ดูข้อมูลลูกหนี้ (ar.view)" />;
  }

  return (
    <div>
      <AdminPageHeader title="ลูกหนี้การค้า (ขายเชื่อ)">
        <Space wrap>
          <Input.Search
            placeholder="ค้นชื่อ/เบอร์ลูกค้า"
            allowClear
            style={{ width: 240 }}
            onSearch={setSearch}
          />
          <Select
            value={withBalanceOnly ? "debt" : "all"}
            style={{ width: 180 }}
            onChange={(v) => setWithBalanceOnly(v === "debt")}
            options={[
              { value: "debt", label: "เฉพาะที่มียอดค้าง" },
              { value: "all", label: "ทุกบัญชี" },
            ]}
          />
          {can("ar.manage") && (
            <Button type="primary" onClick={() => setAccountModal("new")}>เปิดบัญชีเครดิต</Button>
          )}
        </Space>
      </AdminPageHeader>

      {/* ยอดคงค้างเป็นสินทรัพย์ในงบดุล — ตัวเลขนี้ต้องส่งบัญชีก่อนปิดงบ */}
      <Alert closable
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="ยอดลูกหนี้คงค้างเป็นสินทรัพย์ในงบดุล"
        description="ส่งตัวเลขนี้ให้บัญชีก่อนปิดงบทุกงวด · การรับเงินสดต้องทำที่เครื่องขายที่เปิดกะอยู่ เพื่อให้เงินเข้าลิ้นชักและนับได้ตอนปิดกะ"
      />

      {summary?.balanceMismatchCount > 0 && (
        <Alert closable
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={`ยอดในบัญชีไม่ตรงกับสมุดรายวัน ${summary.balanceMismatchCount} บัญชี`}
          description="ตัวเลขนี้ต้องเป็น 0 เสมอ — ไม่ 0 แปลว่ามีทางเขียนที่ไม่ได้คำนวณยอดใหม่จาก ledger อย่าปิดงบด้วยตัวเลขชุดนี้จนกว่าจะแก้"
        />
      )}

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="ยอดค้างรวม" value={summary?.outstandingAmount ?? 0} precision={2} prefix="฿" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="เลยกำหนดชำระ"
              value={summary?.overdueAmount ?? 0}
              precision={2}
              prefix="฿"
              valueStyle={{ color: (summary?.overdueAmount ?? 0) > 0 ? "#cf1322" : undefined }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="ลูกค้าที่มียอดค้าง" value={summary?.accountsWithBalance ?? 0} suffix="ราย" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="ใบที่ยังค้าง" value={summary?.openInvoiceCount ?? 0} suffix="ใบ" />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="อายุหนี้" style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]}>
          {agingCells.map((cell) => (
            <Col xs={12} md={4} key={cell.label}>
              <Statistic
                title={cell.label}
                value={cell.value}
                precision={2}
                prefix="฿"
                valueStyle={{ fontSize: 18, color: cell.value > 0 ? cell.color : undefined }}
              />
            </Col>
          ))}
          <Col xs={12} md={4}>
            <Statistic title="รวม" value={aging?.total ?? 0} precision={2} prefix="฿" valueStyle={{ fontSize: 18 }} />
          </Col>
        </Row>
      </Card>

      <Card size="small" title="บัญชีเครดิตของลูกค้า" style={{ marginBottom: 16 }}>
        <Table<Account>
          rowKey="id"
          size="small"
          loading={accounts.loading}
          dataSource={accountRows}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          onRow={(row) => ({ onClick: () => setSelected(row) })}
          rowClassName={(row) => (row.id === selected?.id ? "ant-table-row-selected" : "")}
          locale={{ emptyText: <Empty description="ยังไม่มีบัญชีเครดิต" /> }}
          columns={[
            {
              title: "ลูกค้า",
              dataIndex: "customerName",
              render: (_v, row) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{row.customerName ?? "(ไม่มีชื่อ)"}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{row.customerPhone ?? "—"}</Text>
                </Space>
              ),
            },
            {
              title: "สถานะ",
              dataIndex: "status",
              width: 150,
              render: (v: Account["status"]) => <Tag color={STATUS_LABEL[v].color}>{STATUS_LABEL[v].text}</Tag>,
            },
            {
              title: "วงเงิน",
              dataIndex: "creditLimit",
              align: "right",
              render: (v: number) => `฿${baht(v)}`,
            },
            {
              title: "ค้างอยู่",
              dataIndex: "balance",
              align: "right",
              render: (v: number) => (
                // ติดลบ = ร้านค้างลูกค้า (คืนของหลังจ่ายครบ) ต้องอ่านออกทันที
                <Text type={v > 0 ? undefined : v < 0 ? "success" : "secondary"} strong={v !== 0}>
                  {v < 0 ? `ร้านค้าง ฿${baht(-v)}` : `฿${baht(v)}`}
                </Text>
              ),
            },
            {
              title: "วงเงินเหลือ",
              dataIndex: "creditLineAvailable",
              align: "right",
              render: (v: number) => `฿${baht(v)}`,
            },
            {
              title: "เครดิตคืนสินค้า",
              dataIndex: "creditBalance",
              align: "right",
              render: (v: number) =>
                v > 0 ? <Text type="success" strong>฿{baht(v)}</Text> : <Text type="secondary">—</Text>,
            },
            {
              title: "เลยกำหนด",
              dataIndex: "overdueAmount",
              align: "right",
              render: (v: number) =>
                v > 0 ? <Text type="danger" strong>฿{baht(v)}</Text> : <Text type="secondary">—</Text>,
            },
            { title: "เทอม", dataIndex: "termsDays", align: "right", render: (v: number) => `${v} วัน` },
            {
              title: "",
              width: 200,
              render: (_v, row) => (
                <Space size={4} onClick={(e) => e.stopPropagation()}>
                  {can("ar.collect") && row.balance > 0 && (
                    <Button size="small" type="primary" ghost onClick={() => setReceiptFor(row)}>
                      รับชำระ
                    </Button>
                  )}
                  {can("ar.manage") && (
                    <Button size="small" onClick={() => setAccountModal(row)}>แก้ไข</Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card
        size="small"
        title={selected ? `ใบที่ยังค้าง — ${selected.customerName ?? ""}` : "ใบที่ยังค้าง (ทุกลูกค้า)"}
        extra={
          <Space>
            <Select
              size="small"
              value={overdueOnly ? "overdue" : "all"}
              style={{ width: 160 }}
              onChange={(v) => setOverdueOnly(v === "overdue")}
              options={[
                { value: "all", label: "ทั้งหมด" },
                { value: "overdue", label: "เฉพาะเลยกำหนด" },
              ]}
            />
            {selected && <Button size="small" onClick={() => setSelected(null)}>ดูทุกลูกค้า</Button>}
          </Space>
        }
      >
        <Table<Invoice>
          rowKey="id"
          size="small"
          loading={invoices.loading}
          dataSource={invoiceRows}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description="ไม่มีใบที่ค้างอยู่" /> }}
          columns={[
            {
              title: "เอกสาร",
              dataIndex: "docNo",
              render: (v: string | null, row) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{v ?? "(ไม่มีเลขใบกำกับ)"}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{day(row.issuedAt)}</Text>
                </Space>
              ),
            },
            ...(selected ? [] : [{ title: "ลูกค้า", dataIndex: "customerName" as const }]),
            { title: "ยอดขายเชื่อ", dataIndex: "amount", align: "right" as const, render: (v: number) => `฿${baht(v)}` },
            {
              title: "จ่ายแล้ว",
              dataIndex: "settledAmount",
              align: "right" as const,
              render: (v: number) => (v > 0 ? `฿${baht(v)}` : "—"),
            },
            {
              title: "คืน/ลดหนี้",
              dataIndex: "creditedAmount",
              align: "right" as const,
              render: (v: number) => (v > 0 ? `฿${baht(v)}` : "—"),
            },
            {
              title: "คงเหลือ",
              dataIndex: "outstanding",
              align: "right" as const,
              render: (v: number) => <Text strong>฿{baht(v)}</Text>,
            },
            {
              title: "ครบกำหนด",
              dataIndex: "dueAt",
              render: (v: string, row) =>
                row.overdue ? (
                  <Tooltip title={`เลยกำหนด ${row.daysPastDue} วัน`}>
                    <Tag color="red">{day(v)} · เกิน {row.daysPastDue} วัน</Tag>
                  </Tooltip>
                ) : (
                  <Text type="secondary">{day(v)}</Text>
                ),
            },
            {
              title: "",
              width: 120,
              render: (_v, row) =>
                can("ar.writeoff") ? (
                  <Button
                    size="small"
                    danger
                    onClick={() =>
                      Modal.confirm({
                        title: "ตัดหนี้สูญ",
                        content: (
                          <div>
                            <p>ตัดยอดคงเหลือ ฿{baht(row.outstanding)} ออกจากลูกหนี้</p>
                            <p style={{ color: "#cf1322" }}>
                              เป็นการลบสินทรัพย์ของร้านทิ้ง · ใบยังอยู่ในระบบพร้อมชื่อคนที่ตัดและเหตุผล
                            </p>
                            <Input.TextArea id="ar-writeoff-reason" rows={2} placeholder="เหตุผล (บังคับ)" />
                          </div>
                        ),
                        okText: "ตัดหนี้สูญ",
                        okButtonProps: { danger: true },
                        cancelText: "ยกเลิก",
                        onOk: async () => {
                          const el = document.getElementById("ar-writeoff-reason") as HTMLTextAreaElement | null;
                          const reason = (el?.value ?? "").trim();
                          if (!reason) {
                            message.error("ต้องระบุเหตุผล");
                            return Promise.reject(new Error("no reason"));
                          }
                          await writeOff({ variables: { invoiceId: row.id, reason } });
                        },
                      })
                    }
                  >
                    ตัดหนี้สูญ
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>

      <AccountModal
        open={accountModal !== null}
        account={accountModal === "new" ? null : accountModal}
        saving={upsertState.loading}
        onCancel={() => setAccountModal(null)}
        onSubmit={(values) => upsertAccount({ variables: values })}
      />

      <ReceiptModal
        account={receiptFor}
        saving={receiptState.loading}
        onCancel={() => setReceiptFor(null)}
        onSubmit={(values) => recordReceipt({ variables: values })}
      />
    </div>
  );
}

// ---------------------------------------------------------------
// เปิด/แก้บัญชีเครดิต
// ---------------------------------------------------------------

function AccountModal({
  open, account, saving, onCancel, onSubmit,
}: {
  open: boolean;
  account: Account | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: {
    customerId: string; creditLimit: number; termsDays: number; status: string; note: string | null;
  }) => void;
}) {
  const [form] = Form.useForm();
  const [customerSearch, setCustomerSearch] = useState("");
  const customers = useQuery(Q_CUSTOMERS, {
    variables: { search: customerSearch || null },
    skip: Boolean(account),
  });

  return (
    <Modal
      open={open}
      title={account ? `บัญชีเครดิต — ${account.customerName ?? ""}` : "เปิดบัญชีเครดิต"}
      okText="บันทึก"
      cancelText="ยกเลิก"
      confirmLoading={saving}
      destroyOnClose
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          customerId: account?.customerId,
          creditLimit: account?.creditLimit ?? 0,
          termsDays: account?.termsDays ?? 30,
          status: account?.status ?? "ACTIVE",
          note: account?.note ?? "",
        }}
        onFinish={(v) =>
          onSubmit({
            customerId: account?.customerId ?? v.customerId,
            creditLimit: Number(v.creditLimit),
            termsDays: Number(v.termsDays),
            status: v.status,
            note: (v.note ?? "").trim() || null,
          })
        }
      >
        {!account && (
          <Form.Item
            name="customerId"
            label="ลูกค้า"
            rules={[{ required: true, message: "เลือกลูกค้า" }]}
            extra="ขายเชื่อต้องผูกลูกค้าเสมอ — หนี้ที่ไม่รู้ว่าใครเป็นหนี้ไม่ใช่ลูกหนี้"
          >
            <Select
              showSearch
              filterOption={false}
              placeholder="ค้นชื่อหรือเบอร์"
              onSearch={setCustomerSearch}
              loading={customers.loading}
              options={(customers.data?.bmsCustomers ?? []).map((c: any) => ({
                value: c.id,
                label: `${c.name ?? "(ไม่มีชื่อ)"} · ${c.phone ?? "—"}`,
              }))}
            />
          </Form.Item>
        )}
        <Form.Item
          name="creditLimit"
          label="วงเงินเครดิต (บาท)"
          rules={[{ required: true, message: "ระบุวงเงิน" }]}
          extra="0 = เปิดบัญชีไว้แต่ยังขายเชื่อไม่ได้"
        >
          <InputNumber min={0} step={1000} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="termsDays"
          label="เครดิตเทอม (วัน)"
          rules={[{ required: true, message: "ระบุเครดิตเทอม" }]}
          extra="ใช้คำนวณวันครบกำหนดของบิลใหม่ · บิลที่ออกไปแล้วไม่เปลี่ยนตาม"
        >
          <InputNumber min={0} max={365} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="status" label="สถานะ">
          <Select
            options={[
              { value: "ACTIVE", label: "ใช้งาน — ขายเชื่อได้" },
              { value: "ON_HOLD", label: "ระงับ — ขายเชื่อไม่ได้ แต่ยังรับชำระได้" },
              { value: "CLOSED", label: "ปิดบัญชี — ต้องไม่มียอดค้าง" },
            ]}
          />
        </Form.Item>
        <Form.Item name="note" label="หมายเหตุ">
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---------------------------------------------------------------
// รับชำระหนี้ (ไม่ใช่เงินสด)
// ---------------------------------------------------------------

function ReceiptModal({
  account, saving, onCancel, onSubmit,
}: {
  account: Account | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: {
    accountId: string; amount: number; method: string; reference: string | null; idempotencyKey: string;
  }) => void;
}) {
  const [form] = Form.useForm();

  return (
    <Modal
      open={account !== null}
      title={`รับชำระหนี้ — ${account?.customerName ?? ""}`}
      okText="บันทึกการรับชำระ"
      cancelText="ยกเลิก"
      confirmLoading={saving}
      destroyOnClose
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Alert closable
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="รับเงินสดที่หน้านี้ไม่ได้"
        description="เงินสดต้องรับที่เครื่องขายที่เปิดกะอยู่ เพื่อให้เงินเข้าลิ้นชักและนับเจอตอนปิดกะ"
      />
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ amount: account?.balance ?? 0, method: "BANK_TRANSFER" }}
        onFinish={(v) =>
          onSubmit({
            accountId: account!.id,
            amount: Number(v.amount),
            method: v.method,
            reference: (v.reference ?? "").trim() || null,
            // คีย์ต่อการกดหนึ่งครั้ง — กดซ้ำเพราะเน็ตช้าต้องไม่รับเงินสองรอบ
            idempotencyKey: `ar-admin-${crypto.randomUUID()}`,
          })
        }
      >
        <Form.Item
          name="amount"
          label="ยอดรับชำระ (บาท)"
          rules={[{ required: true, message: "ระบุยอด" }]}
          extra={`ค้างอยู่ ฿${baht(account?.balance ?? 0)} · รับเกินยอดค้างไม่ได้`}
        >
          <InputNumber min={0.01} step={100} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="method" label="วิธีรับชำระ">
          <Select
            options={[
              { value: "BANK_TRANSFER", label: "โอนเงิน" },
              { value: "QR", label: "QR / พร้อมเพย์" },
              { value: "CARD", label: "บัตร" },
              { value: "WALLET", label: "e-Wallet" },
            ]}
          />
        </Form.Item>
        <Form.Item name="reference" label="เลขอ้างอิง" extra="เลขที่สลิป / เลขอนุมัติ">
          <Input maxLength={120} />
        </Form.Item>
        <Text type="secondary" style={{ fontSize: 12 }}>
          เงินที่รับจะตัดใบที่ครบกำหนดก่อนตามลำดับ (ใบเก่าสุดก่อน)
        </Text>
      </Form>
    </Modal>
  );
}
