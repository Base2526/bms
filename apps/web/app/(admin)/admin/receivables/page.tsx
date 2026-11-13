"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";
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
const day = (iso: string, uiText: UiTranslator = thaiUiText) => new Date(iso).toLocaleDateString(uiText.locale);

const STATUS_LABEL = (uiText: UiTranslator = thaiUiText): Record<Account["status"], { text: string; color: string }> => ({
  ACTIVE: { text: uiText("admin_ui.active_3a6f5"), color: "green" },
  ON_HOLD: { text: uiText("admin_ui.credit_sales_suspended_62498"), color: "orange" },
  CLOSED: { text: uiText("admin_ui.account_closed_89c87"), color: "default" },
});

export default function ReceivablesPage() {
  const uiText = useUiText();
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
    onCompleted: () => { message.success(uiText("admin_ui.credit_account_saved_73272")); setAccountModal(null); refetchAll(); },
    onError: (e) => message.error(e.message),
  });
  const [recordReceipt, receiptState] = useMutation(M_RECEIPT, {
    onCompleted: (d) => {
      message.success(uiText("admin_ui.payment_recorded_allocated_to_bills_c04bd", { v0: d.bmsRecordArReceipt.allocations.length }));
      setReceiptFor(null);
      refetchAll();
    },
    onError: (e) => message.error(e.message),
  });
  const [writeOff] = useMutation(M_WRITEOFF, {
    onCompleted: (d) => { message.success(uiText("admin_ui.bad_debt_written_off_830ef", { v0: baht(d.bmsWriteOffArInvoice.amount) })); refetchAll(); },
    onError: (e) => message.error(e.message),
  });

  const summary = outstanding.data?.bmsArOutstanding;
  const aging = summary?.aging;
  const accountRows: Account[] = accounts.data?.bmsArAccounts ?? [];
  const invoiceRows: Invoice[] = invoices.data?.bmsArInvoices ?? [];

  const agingCells = useMemo(
    () => [
      { label: uiText("admin_ui.not_yet_due_dc672"), value: aging?.current ?? 0, color: undefined },
      { label: uiText("admin_ui.label_1_30_days_overdue_3550f"), value: aging?.d1to30 ?? 0, color: "#d48806" },
      { label: uiText("admin_ui.label_31_60_days_overdue_56b0a"), value: aging?.d31to60 ?? 0, color: "#d46b08" },
      { label: uiText("admin_ui.label_61_90_days_overdue_9dee4"), value: aging?.d61to90 ?? 0, color: "#cf1322" },
      { label: uiText("admin_ui.over_90_days_overdue_60771"), value: aging?.d90plus ?? 0, color: "#a8071a" },
    ],
    [uiText, aging]
  );

  if (permLoading) return null;
  if (!can("ar.view")) {
    return <Alert closable type="warning" showIcon message={uiText("admin_ui.you_do_not_have_permission_to_view_receivables_170fe")} />;
  }

  return (
    <div>
      <AdminPageHeader title={uiText("admin_ui.accounts_receivable_credit_sales_3afdb")}>
        <Space wrap>
          <Input.Search
            placeholder={uiText("admin_ui.search_customer_name_phone_2218a")}
            allowClear
            style={{ width: 240 }}
            onSearch={setSearch}
          />
          <Select
            value={withBalanceOnly ? "debt" : "all"}
            style={{ width: 180 }}
            onChange={(v) => setWithBalanceOnly(v === "debt")}
            options={[
              { value: "debt", label: uiText("admin_ui.with_outstanding_balances_only_8beae") },
              { value: "all", label: uiText("admin_ui.all_accounts_c5a20") },
            ]}
          />
          {can("ar.manage") && (
            <Button type="primary" onClick={() => setAccountModal("new")}>{uiText("admin_ui.open_credit_account_876f4")}</Button>
          )}
        </Space>
      </AdminPageHeader>

      {/* ยอดคงค้างเป็นสินทรัพย์ในงบดุล — ตัวเลขนี้ต้องส่งบัญชีก่อนปิดงบ */}
      <Alert closable
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={uiText("admin_ui.outstanding_receivables_are_assets_on_the_balance_sheet_ab55e")}
        description={uiText("admin_ui.send_these_figures_to_accounting_before_each_period_4516d")}
      />

      {summary?.balanceMismatchCount > 0 && (
        <Alert closable
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={uiText("admin_ui.account_balances_do_not_match_the_ledger_17bc3", { v0: summary.balanceMismatchCount })}
          description={uiText("admin_ui.this_must_always_be_0_a_nonzero_count_2b6e4")}
        />
      )}

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={uiText("admin_ui.total_outstanding_6aa3a")} value={summary?.outstandingAmount ?? 0} precision={2} prefix="฿" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title={uiText("admin_ui.overdue_e8c27")}
              value={summary?.overdueAmount ?? 0}
              precision={2}
              prefix="฿"
              valueStyle={{ color: (summary?.overdueAmount ?? 0) > 0 ? "#cf1322" : undefined }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={uiText("admin_ui.customers_with_balances_57653")} value={summary?.accountsWithBalance ?? 0} suffix={uiText("admin_ui.people_fe594")} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={uiText("admin_ui.outstanding_bills_dd4a1")} value={summary?.openInvoiceCount ?? 0} suffix={uiText("admin_ui.coupon_s_a8880")} />
          </Card>
        </Col>
      </Row>

      <Card size="small" title={uiText("admin_ui.receivables_aging_c69a8")} style={{ marginBottom: 16 }}>
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
            <Statistic title={uiText("admin_ui.amount_7b26a")} value={aging?.total ?? 0} precision={2} prefix="฿" valueStyle={{ fontSize: 18 }} />
          </Col>
        </Row>
      </Card>

      <Card size="small" title={uiText("admin_ui.customer_credit_accounts_2ee78")} style={{ marginBottom: 16 }}>
        <Table<Account>
          rowKey="id"
          size="small"
          loading={accounts.loading}
          dataSource={accountRows}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          onRow={(row) => ({ onClick: () => setSelected(row) })}
          rowClassName={(row) => (row.id === selected?.id ? "ant-table-row-selected" : "")}
          locale={{ emptyText: <Empty description={uiText("admin_ui.no_credit_accounts_yet_ecbfd")} /> }}
          columns={[
            {
              title: uiText("admin_ui.customer_3011a"),
              dataIndex: "customerName",
              render: (_v, row) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{row.customerName ?? uiText("admin_ui.unnamed_071dd")}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{row.customerPhone ?? "—"}</Text>
                </Space>
              ),
            },
            {
              title: uiText("admin_ui.status_2e8c4"),
              dataIndex: "status",
              width: 150,
              render: (v: Account["status"]) => <Tag color={STATUS_LABEL(uiText)[v].color}>{STATUS_LABEL(uiText)[v].text}</Tag>,
            },
            {
              title: uiText("admin_ui.credit_limit_28307"),
              dataIndex: "creditLimit",
              align: "right",
              render: (v: number) => `฿${baht(v)}`,
            },
            {
              title: uiText("admin_ui.pending_1412c"),
              dataIndex: "balance",
              align: "right",
              render: (v: number) => (
                // ติดลบ = ร้านค้างลูกค้า (คืนของหลังจ่ายครบ) ต้องอ่านออกทันที
                <Text type={v > 0 ? undefined : v < 0 ? "success" : "secondary"} strong={v !== 0}>
                  {v < 0 ? uiText("admin_ui.store_owes_ec910", { v0: baht(-v) }) : `฿${baht(v)}`}
                </Text>
              ),
            },
            {
              title: uiText("admin_ui.available_credit_a1227"),
              dataIndex: "creditLineAvailable",
              align: "right",
              render: (v: number) => `฿${baht(v)}`,
            },
            {
              title: uiText("admin_ui.return_credit_31226"),
              dataIndex: "creditBalance",
              align: "right",
              render: (v: number) =>
                v > 0 ? <Text type="success" strong>฿{baht(v)}</Text> : <Text type="secondary">—</Text>,
            },
            {
              title: uiText("admin_ui.overdue_f7099"),
              dataIndex: "overdueAmount",
              align: "right",
              render: (v: number) =>
                v > 0 ? <Text type="danger" strong>฿{baht(v)}</Text> : <Text type="secondary">—</Text>,
            },
            { title: uiText("admin_ui.terms_bdab1"), dataIndex: "termsDays", align: "right", render: (v: number) => uiText("admin_ui.days_bc9c4", { v0: v }) },
            {
              title: "",
              width: 200,
              render: (_v, row) => (
                <Space size={4} onClick={(e) => e.stopPropagation()}>
                  {can("ar.collect") && row.balance > 0 && (
                    <Button size="small" type="primary" ghost onClick={() => setReceiptFor(row)}>
                      {uiText("admin_ui.receive_payment_c383e")}</Button>
                  )}
                  {can("ar.manage") && (
                    <Button size="small" onClick={() => setAccountModal(row)}>{uiText("admin_ui.edit_e7eca")}</Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card
        size="small"
        title={selected ? uiText("admin_ui.outstanding_bills_09800", { v0: selected.customerName ?? "" }) : uiText("admin_ui.outstanding_bills_all_customers_a25a5")}
        extra={
          <Space>
            <Select
              size="small"
              value={overdueOnly ? "overdue" : "all"}
              style={{ width: 160 }}
              onChange={(v) => setOverdueOnly(v === "overdue")}
              options={[
                { value: "all", label: uiText("admin_ui.all_56eff") },
                { value: "overdue", label: uiText("admin_ui.overdue_only_25dc9") },
              ]}
            />
            {selected && <Button size="small" onClick={() => setSelected(null)}>{uiText("admin_ui.view_all_customers_19a8b")}</Button>}
          </Space>
        }
      >
        <Table<Invoice>
          rowKey="id"
          size="small"
          loading={invoices.loading}
          dataSource={invoiceRows}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty description={uiText("admin_ui.no_outstanding_bills_0f5e1")} /> }}
          columns={[
            {
              title: uiText("admin_ui.document_b21e6"),
              dataIndex: "docNo",
              render: (v: string | null, row) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{v ?? uiText("admin_ui.no_tax_invoice_number_9e39d")}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{day(row.issuedAt, uiText)}</Text>
                </Space>
              ),
            },
            ...(selected ? [] : [{ title: uiText("admin_ui.customer_3011a"), dataIndex: "customerName" as const }]),
            { title: uiText("admin_ui.credit_sale_amount_d2f5b"), dataIndex: "amount", align: "right" as const, render: (v: number) => `฿${baht(v)}` },
            {
              title: uiText("admin_ui.paid_c9fbb"),
              dataIndex: "settledAmount",
              align: "right" as const,
              render: (v: number) => (v > 0 ? `฿${baht(v)}` : "—"),
            },
            {
              title: uiText("admin_ui.returns_credits_37a2b"),
              dataIndex: "creditedAmount",
              align: "right" as const,
              render: (v: number) => (v > 0 ? `฿${baht(v)}` : "—"),
            },
            {
              title: uiText("admin_ui.available_dd579"),
              dataIndex: "outstanding",
              align: "right" as const,
              render: (v: number) => <Text strong>฿{baht(v)}</Text>,
            },
            {
              title: uiText("admin_ui.due_date_105c3"),
              dataIndex: "dueAt",
              render: (v: string, row) =>
                row.overdue ? (
                  <Tooltip title={uiText("admin_ui.days_overdue_e9867", { v0: row.daysPastDue })}>
                    <Tag color="red">{day(v, uiText)}  {uiText("admin_ui.overdue_61a3c")} {row.daysPastDue}  {uiText("admin_ui.day_3a8f3")}</Tag>
                  </Tooltip>
                ) : (
                  <Text type="secondary">{day(v, uiText)}</Text>
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
                        title: uiText("admin_ui.write_off_bad_debt_ad7e0"),
                        content: (
                          <div>
                            <p>{uiText("admin_ui.write_off_the_remaining_80967")}{baht(row.outstanding)}  {uiText("admin_ui.from_receivables_272f7")}</p>
                            <p style={{ color: "#cf1322" }}>
                              {uiText("admin_ui.this_removes_an_asset_from_the_store_the_a93d9")}</p>
                            <Input.TextArea id="ar-writeoff-reason" rows={2} placeholder={uiText("admin_ui.reason_required_c8d06")} />
                          </div>
                        ),
                        okText: uiText("admin_ui.write_off_bad_debt_ad7e0"),
                        okButtonProps: { danger: true },
                        cancelText: uiText("admin_ui.cancelled_fba6e"),
                        onOk: async () => {
                          const el = document.getElementById("ar-writeoff-reason") as HTMLTextAreaElement | null;
                          const reason = (el?.value ?? "").trim();
                          if (!reason) {
                            message.error(uiText("admin_ui.a_reason_is_required_61dc0"));
                            return Promise.reject(new Error(uiText("admin_ui.en_no_reason_611b1")));
                          }
                          await writeOff({ variables: { invoiceId: row.id, reason } });
                        },
                      })
                    }
                  >
                    {uiText("admin_ui.write_off_bad_debt_ad7e0")}</Button>
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
  const uiText = useUiText();
  const [form] = Form.useForm();
  const [customerSearch, setCustomerSearch] = useState("");
  const customers = useQuery(Q_CUSTOMERS, {
    variables: { search: customerSearch || null },
    skip: Boolean(account),
  });

  return (
    <Modal
      open={open}
      title={account ? uiText("admin_ui.credit_account_5e2c1", { v0: account.customerName ?? "" }) : uiText("admin_ui.open_credit_account_876f4")}
      okText={uiText("admin_ui.save_f658a")}
      cancelText={uiText("admin_ui.cancelled_fba6e")}
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
            label={uiText("admin_ui.customer_3011a")}
            rules={[{ required: true, message: uiText("admin_ui.select_customer_1caf2") }]}
            extra={uiText("admin_ui.credit_sales_must_always_be_linked_to_a_87013")}
          >
            <Select
              showSearch
              filterOption={false}
              placeholder={uiText("admin_ui.search_name_or_phone_fe41a")}
              onSearch={setCustomerSearch}
              loading={customers.loading}
              options={(customers.data?.bmsCustomers ?? []).map((c: any) => ({
                value: c.id,
                label: `${c.name ?? uiText("admin_ui.unnamed_071dd")} · ${c.phone ?? "—"}`,
              }))}
            />
          </Form.Item>
        )}
        <Form.Item
          name="creditLimit"
          label={uiText("admin_ui.credit_limit_baht_626be")}
          rules={[{ required: true, message: uiText("admin_ui.enter_a_credit_limit_b3331") }]}
          extra={uiText("admin_ui.label_0_account_open_but_credit_sales_unavailable_e6e7b")}
        >
          <InputNumber min={0} step={1000} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="termsDays"
          label={uiText("admin_ui.payment_terms_days_da3cf")}
          rules={[{ required: true, message: uiText("admin_ui.enter_payment_terms_0b672") }]}
          extra={uiText("admin_ui.used_to_calculate_due_dates_for_new_bills_16887")}
        >
          <InputNumber min={0} max={365} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="status" label={uiText("admin_ui.status_2e8c4")}>
          <Select
            options={[
              { value: "ACTIVE", label: uiText("admin_ui.active_credit_sales_allowed_17ef1") },
              { value: "ON_HOLD", label: uiText("admin_ui.suspended_no_credit_sales_payments_still_accepted_67352") },
              { value: "CLOSED", label: uiText("admin_ui.closed_must_have_no_outstanding_balance_c205e") },
            ]}
          />
        </Form.Item>
        <Form.Item name="note" label={uiText("admin_ui.note_ddbdb")}>
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
  const uiText = useUiText();
  const [form] = Form.useForm();

  return (
    <Modal
      open={account !== null}
      title={uiText("admin_ui.receive_debt_payment_a70eb", { v0: account?.customerName ?? "" })}
      okText={uiText("admin_ui.record_payment_131f0")}
      cancelText={uiText("admin_ui.cancelled_fba6e")}
      confirmLoading={saving}
      destroyOnClose
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Alert closable
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={uiText("admin_ui.cash_cannot_be_received_on_this_page_542b1")}
        description={uiText("admin_ui.receive_cash_at_a_register_with_an_open_b4efd")}
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
          label={uiText("admin_ui.payment_amount_baht_56243")}
          rules={[{ required: true, message: uiText("admin_ui.enter_an_amount_c6678") }]}
          extra={uiText("admin_ui.outstanding_payment_cannot_exceed_the_balance_06c13", { v0: baht(account?.balance ?? 0) })}
        >
          <InputNumber min={0.01} step={100} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="method" label={uiText("admin_ui.payment_method_1dd41")}>
          <Select
            options={[
              { value: "BANK_TRANSFER", label: uiText("admin_ui.bank_transfer_acc4a") },
              { value: "QR", label: uiText("admin_ui.qr_promptpay_4d56f") },
              { value: "CARD", label: uiText("admin_ui.card_64593") },
              { value: "WALLET", label: "e-Wallet" },
            ]}
          />
        </Form.Item>
        <Form.Item name="reference" label={uiText("admin_ui.reference_number_4d443")} extra={uiText("admin_ui.slip_approval_reference_d353d")}>
          <Input maxLength={120} />
        </Form.Item>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {uiText("admin_ui.payments_are_allocated_to_bills_in_due_date_b210f")}</Text>
      </Form>
    </Modal>
  );
}
