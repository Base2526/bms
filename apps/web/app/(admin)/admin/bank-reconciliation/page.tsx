"use client";

import { useUiText } from "@/lib/useUiText";

import { gql, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Upload,
  message,
} from "antd";
import {
  BankOutlined,
  CheckOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";

const Q_BOOT = gql`
  query BankReconciliationBoot($accountId: ID, $month: String) {
    bmsBankAccounts(includeArchived: true) {
      id
      bankCode
      displayName
      accountLast4
      currency
      status
      createdAt
    }
    bmsBankStatementImports(accountId: $accountId, limit: 200) {
      id
      bankAccountId
      accountName
      accountLast4
      originalFilename
      periodStart
      periodEnd
      rowCount
      status
      createdAt
      committedAt
      voidReason
    }
    bmsBankReconciliationSummary(accountId: $accountId, month: $month) {
      totalCount
      matchedCount
      unresolvedCount
      netMovement
      matchedAmount
    }
    bmsBankReconciliationPeriods(accountId: $accountId) {
      bankAccountId
      periodMonth
      status
      openingBalance
      closingBalance
      version
      closedAt
      reopenedAt
      reopenReason
    }
    bmsBankReconciliationReadiness {
      enabled
      fileImport
      supportedFormats
      deterministicMatching
      humanConfirmationRequired
      openBanking
      sourceMutation
    }
  }
`;
const Q_ENTRIES = gql`
  query BankEntries($input: BmsBankEntryListInput!) {
    bmsBankStatementEntries(input: $input) {
      id
      importId
      bankAccountId
      postedOn
      direction
      amount
      balanceAfter
      reference
      description
      counterpartyMasked
      status
      matchedAmount
    }
  }
`;
const Q_CANDIDATES = gql`
  query BankCandidates($entryId: ID!) {
    bmsBankMatchCandidates(entryId: $entryId) {
      sourceKey
      sourceType
      sourceDate
      amount
      reference
      label
      ruleCode
      confidence
      sourceFingerprint
    }
  }
`;
const Q_LINKS = gql`
  query BankLinks($entryId: ID!) {
    bmsBankReconciliationLinks(entryId: $entryId) {
      id
      sourceKey
      matchedAmount
      ruleCode
      confidence
      status
      stale
      confirmedAt
      voidedAt
      voidReason
    }
  }
`;
const M_CREATE_ACCOUNT = gql`
  mutation CreateBankAccount($input: BmsCreateBankAccountInput!) {
    bmsCreateBankAccount(input: $input) {
      id
      bankCode
      displayName
      accountLast4
      currency
      status
    }
  }
`;
const M_ARCHIVE_ACCOUNT = gql`
  mutation ArchiveBankAccount($id: ID!) {
    bmsArchiveBankAccount(id: $id) {
      id
      status
    }
  }
`;
const M_COMMIT_IMPORT = gql`
  mutation CommitBankImport($id: ID!) {
    bmsCommitBankStatementImport(id: $id, confirmed: true) {
      id
      status
    }
  }
`;
const M_VOID_IMPORT = gql`
  mutation VoidBankImport($id: ID!, $reason: String!) {
    bmsVoidBankStatementImport(id: $id, reason: $reason, confirmed: true) {
      id
      status
    }
  }
`;
const M_CONFIRM = gql`
  mutation ConfirmBankMatch($input: BmsConfirmBankMatchInput!) {
    bmsConfirmBankMatch(input: $input, confirmed: true) {
      id
      status
    }
  }
`;
const M_VOID_MATCH = gql`
  mutation VoidBankMatch($id: ID!, $reason: String!) {
    bmsVoidBankMatch(id: $id, reason: $reason, confirmed: true) {
      id
      status
    }
  }
`;
const M_IGNORE = gql`
  mutation IgnoreBankEntry($id: ID!, $reason: String!) {
    bmsIgnoreBankStatementEntry(id: $id, reason: $reason, confirmed: true) {
      id
      status
    }
  }
`;
const M_CLOSE = gql`
  mutation CloseBankMonth($accountId: ID!, $month: String!) {
    bmsCloseBankReconciliationPeriod(
      accountId: $accountId
      month: $month
      confirmed: true
    ) {
      bankAccountId
      periodMonth
      status
      version
    }
  }
`;
const M_REOPEN = gql`
  mutation ReopenBankMonth($accountId: ID!, $month: String!, $reason: String!) {
    bmsReopenBankReconciliationPeriod(
      accountId: $accountId
      month: $month
      reason: $reason
      confirmed: true
    ) {
      bankAccountId
      periodMonth
      status
      version
    }
  }
`;

const baht = (value: unknown) => {
  const match = String(value ?? "0").match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return "0.00";
  return `${match[1]}${BigInt(match[2]).toLocaleString("th-TH")}.${(match[3] || "").padEnd(2, "0")}`;
};
const moneyCents = (value: unknown): bigint => {
  const match = String(value ?? "0").match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0n;
  const amount =
    BigInt(match[2]) * 100n + BigInt((match[3] || "").padEnd(2, "0"));
  return match[1] ? -amount : amount;
};
const centsMoney = (value: bigint): string => {
  const safe = value < 0n ? 0n : value;
  return `${safe / 100n}.${String(safe % 100n).padStart(2, "0")}`;
};
const remainingMoney = (total: unknown, matched: unknown): string =>
  centsMoney(moneyCents(total) - moneyCents(matched));
const smallerMoney = (left: unknown, right: unknown): string =>
  centsMoney(
    moneyCents(left) < moneyCents(right)
      ? moneyCents(left)
      : moneyCents(right),
  );
const statusColor: Record<string, string> = {
  COMMITTED: "green",
  VALIDATED: "blue",
  VOID: "red",
  MATCHED: "green",
  PARTIAL: "orange",
  UNMATCHED: "default",
  STALE: "red",
  IGNORED: "default",
  CLOSED: "green",
  REOPENED: "orange",
};

export default function BankReconciliationPage() {
  const uiText = useUiText();
  const { lang } = useI18n();
  const th = lang === "th";
  const L = (thai: string, english: string) => (th ? thai : english);
  const { can, loading: permissionLoading } = useBmsPermissions();
  const allowed = can("bank_reconciliation.view"),
    canImport = can("bank_reconciliation.import"),
    canReview = can("bank_reconciliation.review"),
    canClose = can("bank_reconciliation.close");
  const [accountId, setAccountId] = useState<string>();
  const [month, setMonth] = useState<Dayjs>(dayjs().startOf("month"));
  const [entryPage, setEntryPage] = useState(1);
  const entryPageSize = 100;
  const monthText = month.format("YYYY-MM-01");
  const variables = { accountId: accountId || null, month: monthText };
  const boot = useQuery(Q_BOOT, {
    skip: !allowed,
    variables,
    fetchPolicy: "cache-and-network",
  });
  const entries = useQuery(Q_ENTRIES, {
    skip: !allowed,
    variables: {
      input: {
        accountId: accountId || null,
        month: monthText,
        limit: entryPageSize,
        offset: (entryPage - 1) * entryPageSize,
      },
    },
    fetchPolicy: "cache-and-network",
  });
  const [loadCandidates, candidateQuery] = useLazyQuery(Q_CANDIDATES, {
    fetchPolicy: "network-only",
  });
  const [loadLinks, linkQuery] = useLazyQuery(Q_LINKS, {
    fetchPolicy: "network-only",
  });
  const [createAccount, { loading: creatingAccount }] =
    useMutation(M_CREATE_ACCOUNT);
  const [archiveAccount] = useMutation(M_ARCHIVE_ACCOUNT);
  const [commitImport] = useMutation(M_COMMIT_IMPORT);
  const [voidImport] = useMutation(M_VOID_IMPORT);
  const [confirmMatch, { loading: confirming }] = useMutation(M_CONFIRM);
  const [voidMatch] = useMutation(M_VOID_MATCH);
  const [ignoreEntry] = useMutation(M_IGNORE);
  const [closeMonth] = useMutation(M_CLOSE);
  const [reopenMonth] = useMutation(M_REOPEN);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountForm] = Form.useForm();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<any>();
  const [selectedEntry, setSelectedEntry] = useState<any>();
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [matchAmounts, setMatchAmounts] = useState<Record<string, string>>({});
  const accounts = boot.data?.bmsBankAccounts || [];
  const activeAccounts = accounts.filter((a: any) => a.status === "ACTIVE");
  const imports = boot.data?.bmsBankStatementImports || [];
  const summary = boot.data?.bmsBankReconciliationSummary;
  const matchPercent = summary?.totalCount
    ? Math.round(
        ((summary.totalCount - summary.unresolvedCount) / summary.totalCount) *
          100,
      )
    : 0;
  const refresh = async () => {
    await Promise.all([boot.refetch(), entries.refetch()]);
  };
  const selectAccount = (value: string | undefined) => {
    setAccountId(value);
    setEntryPage(1);
  };
  const selectMonth = (value: Dayjs) => {
    setMonth(value.startOf("month"));
    setEntryPage(1);
  };

  const accountOptions = useMemo(
    () =>
      activeAccounts.map((a: any) => ({
        value: a.id,
        label: `${a.bankCode} · ${a.displayName} ••••${a.accountLast4}`,
      })),
    [activeAccounts],
  );
  if (!permissionLoading && !allowed)
    return (
      <Alert
        closable
        type="error"
        showIcon
        message={L(
          "ไม่มีสิทธิ์ดูกระทบยอดธนาคาร",
          "You do not have permission to view bank reconciliation",
        )}
      />
    );
  const featureError = boot.error?.graphQLErrors?.some(
    (e: any) => e.extensions?.code === "FEATURE_DISABLED",
  );
  if (featureError)
    return (
      <Alert
        closable
        type="info"
        showIcon
        message={L(
          "ระบบกระทบยอดยังไม่เปิดใช้",
          "Bank reconciliation is not enabled",
        )}
        description={L(
          "เปิด BMS_BANK_RECONCILIATION_ENABLED และ NEXT_PUBLIC_BMS_BANK_RECONCILIATION_ENABLED หลังรัน migration 10.110",
          "Apply migration 10.110, then enable both bank reconciliation feature flags.",
        )}
      />
    );

  const uploadFile = async (file: File) => {
    if (!accountId) {
      message.warning(L("เลือกบัญชีก่อน", "Select an account first"));
      return false;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("accountId", accountId);
      form.set("idempotencyKey", crypto.randomUUID());
      const response = await fetch(
        "/api/bms/bank-reconciliation/imports/preview",
        { method: "POST", body: form },
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || uiText("admin_ui.en_upload_failed_c2a7d"));
      setPreview(json);
      message.success(
        L(
          "ตรวจไฟล์แล้ว กรุณาดูตัวอย่างก่อนยืนยัน",
          "File validated. Review the preview before committing.",
        ),
      );
      await boot.refetch();
    } catch (error: any) {
      message.error(error?.message || L("นำเข้าไม่สำเร็จ", "Import failed"));
    } finally {
      setUploading(false);
    }
    return false;
  };
  const addAccount = async (values: any) => {
    try {
      await createAccount({ variables: { input: values } });
      message.success(L("เพิ่มบัญชีแล้ว", "Account added"));
      setAccountOpen(false);
      accountForm.resetFields();
      await boot.refetch();
    } catch (e: any) {
      message.error(e.message);
    }
  };
  const openCandidates = async (row: any) => {
    setSelectedEntry(row);
    setMatchAmounts({});
    setCandidateOpen(true);
    await Promise.all([
      loadCandidates({ variables: { entryId: row.id } }),
      loadLinks({ variables: { entryId: row.id } }),
    ]);
  };
  const confirmCandidate = async (candidate: any) => {
    try {
      const remaining = remainingMoney(
        selectedEntry.amount,
        selectedEntry.matchedAmount,
      );
      const matchedAmount =
        matchAmounts[candidate.sourceKey] ??
        smallerMoney(candidate.amount, remaining);
      await confirmMatch({
        variables: {
          input: {
            entryId: selectedEntry.id,
            sourceKey: candidate.sourceKey,
            matchedAmount,
            sourceFingerprint: candidate.sourceFingerprint,
          },
        },
      });
      message.success(L("ยืนยันการจับคู่แล้ว", "Match confirmed"));
      setCandidateOpen(false);
      await refresh();
    } catch (e: any) {
      message.error(e.message);
    }
  };
  const reasonPrompt = (
    title: string,
    onOk: (reason: string) => Promise<void>,
  ) => {
    let reason = "";
    Modal.confirm({
      title,
      content: (
        <Input.TextArea
          autoFocus
          onChange={(e) => {
            reason = e.target.value;
          }}
          placeholder={L("ระบุเหตุผล", "Enter a reason")}
        />
      ),
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!reason.trim())
          throw new Error(L("กรุณาระบุเหตุผล", "Reason is required"));
        await onOk(reason.trim());
      },
    });
  };

  const overview = (
    <>
      <Alert
        closable
        showIcon
        type="info"
        style={{ marginBottom: 16 }}
        message={L(
          "รายการธนาคารเป็นหลักฐานประกอบเท่านั้น",
          "Bank data is supporting evidence only",
        )}
        description={L(
          "ระบบนี้ไม่แก้ยอดขาย รายจ่าย ภาษี ลูกหนี้ หรือเงินคืน และคำแนะนำจะไม่ถูกยืนยันอัตโนมัติ",
          "This module never changes sales, expenses, tax, receivables, or refunds. Suggestions always require human confirmation.",
        )}
      />
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic
              title={L("รายการทั้งหมด", "Total entries")}
              value={summary?.totalCount || 0}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic
              title={L("จับคู่แล้ว", "Matched")}
              value={summary?.matchedCount || 0}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic
              title={L("รอตรวจ", "Unresolved")}
              value={summary?.unresolvedCount || 0}
              valueStyle={{
                color: summary?.unresolvedCount ? "#d46b08" : undefined,
              }}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic
              title={L("เงินเคลื่อนไหวสุทธิ", "Net movement")}
              value={String(summary?.netMovement || "0")}
              formatter={() => baht(summary?.netMovement)}
              suffix="฿"
            />
          </Card>
        </Col>
      </Row>
      <Card
        style={{ marginTop: 16 }}
        title={L("ความคืบหน้าเดือนนี้", "Monthly progress")}
      >
        <Progress
          percent={matchPercent}
          status={summary?.unresolvedCount ? "active" : "success"}
        />
      </Card>
    </>
  );

  const accountTab = (
    <Card
      title={L("บัญชีธนาคาร", "Bank accounts")}
      extra={
        canImport && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAccountOpen(true)}
          >
            {L("เพิ่มบัญชี", "Add account")}
          </Button>
        )
      }
    >
      <Table
        rowKey="id"
        dataSource={accounts}
        pagination={false}
        columns={[
          { title: L("ธนาคาร", "Bank"), dataIndex: "bankCode" },
          { title: L("ชื่อเรียก", "Name"), dataIndex: "displayName" },
          {
            title: L("เลขท้าย", "Last 4"),
            render: (_: any, r: any) => `•••• ${r.accountLast4}`,
          },
          { title: L("สกุลเงิน", "Currency"), dataIndex: "currency" },
          {
            title: L("สถานะ", "Status"),
            render: (_: any, r: any) => (
              <Tag color={r.status === "ACTIVE" ? "green" : "default"}>
                {r.status}
              </Tag>
            ),
          },
          {
            title: "",
            render: (_: any, r: any) =>
              canImport && r.status === "ACTIVE" ? (
                <Popconfirm
                  title={L("เก็บบัญชีนี้เข้าประวัติ?", "Archive this account?")}
                  onConfirm={async () => {
                    await archiveAccount({ variables: { id: r.id } });
                    await boot.refetch();
                  }}
                >
                  <Button danger size="small">
                    {L("เก็บ", "Archive")}
                  </Button>
                </Popconfirm>
              ) : null,
          },
        ]}
      />
    </Card>
  );

  const importTab = (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Card title={L("1. เลือกไฟล์และตรวจสอบ", "1. Upload and validate")}>
        <Space wrap>
          <Select
            style={{ width: 340 }}
            placeholder={L("เลือกบัญชี", "Select account")}
            value={accountId}
            onChange={selectAccount}
            options={accountOptions}
          />
          {canImport && (
            <Upload
              accept=".csv,.xlsx,.xls"
              showUploadList={false}
              beforeUpload={uploadFile}
            >
              <Button
                icon={<UploadOutlined />}
                loading={uploading}
                disabled={!accountId}
              >
                {L("เลือก CSV / Excel", "Choose CSV / Excel")}
              </Button>
            </Upload>
          )}
        </Space>
        {preview && (
          <Card
            size="small"
            style={{ marginTop: 16 }}
            title={L("ตัวอย่างก่อนยืนยัน", "Preview before commit")}
            extra={<Tag color="blue">{preview.preview.rowCount}  {uiText("admin_ui.en_rows_6c30d")}</Tag>}
          >
            <Descriptions
              size="small"
              column={{ xs: 1, md: 3 }}
              items={[
                {
                  key: "period",
                  label: L("ช่วงวันที่", "Period"),
                  children: `${preview.preview.periodStart} – ${preview.preview.periodEnd}`,
                },
                {
                  key: "open",
                  label: L("ยอดยกมา", "Opening"),
                  children: preview.preview.openingBalance ?? "-",
                },
                {
                  key: "close",
                  label: L("ยอดคงเหลือ", "Closing"),
                  children: preview.preview.closingBalance ?? "-",
                },
              ]}
            />
            {preview.preview.warnings?.length ? (
              <Alert
                closable
                type="warning"
                showIcon
                message={uiText("admin_ui.en_warning_s_5affa", { v0: preview.preview.warnings.length })}
                description={preview.preview.warnings.slice(0, 5).join(" · ")}
              />
            ) : null}
            <Table
              size="small"
              rowKey="lineNo"
              pagination={false}
              scroll={{ x: true }}
              dataSource={preview.preview.rows.slice(0, 10)}
              columns={[
                { title: L("วันที่", "Date"), dataIndex: "postedOn" },
                {
                  title: L("รายละเอียด", "Description"),
                  dataIndex: "description",
                },
                { title: L("ทิศทาง", "Direction"), dataIndex: "direction" },
                {
                  title: L("ยอด", "Amount"),
                  render: (_: any, r: any) => baht(r.amount),
                },
                {
                  title: L("คงเหลือ", "Balance"),
                  render: (_: any, r: any) =>
                    r.balanceAfter == null ? "-" : baht(r.balanceAfter),
                },
              ]}
            />
            <Button
              style={{ marginTop: 12 }}
              type="primary"
              icon={<CheckOutlined />}
              onClick={async () => {
                await commitImport({ variables: { id: preview.import.id } });
                message.success(L("ยืนยันนำเข้าแล้ว", "Import committed"));
                setPreview(null);
                await refresh();
              }}
            >
              {L("ยืนยันนำเข้ารายการ", "Commit imported entries")}
            </Button>
          </Card>
        )}
      </Card>
      <Card title={L("ประวัตินำเข้า", "Import history")}>
        <Table
          rowKey="id"
          dataSource={imports}
          scroll={{ x: true }}
          columns={[
            { title: L("ไฟล์", "File"), dataIndex: "originalFilename" },
            {
              title: L("บัญชี", "Account"),
              render: (_: any, r: any) =>
                `${r.accountName} ••••${r.accountLast4}`,
            },
            {
              title: L("ช่วง", "Period"),
              render: (_: any, r: any) => `${r.periodStart} – ${r.periodEnd}`,
            },
            { title: L("แถว", "Rows"), dataIndex: "rowCount" },
            {
              title: L("สถานะ", "Status"),
              render: (_: any, r: any) => (
                <Tag color={statusColor[r.status]}>{r.status}</Tag>
              ),
            },
            {
              title: "",
              render: (_: any, r: any) => (
                <Space>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    href={`/api/bms/bank-reconciliation/imports/${r.id}/file`}
                  >
                    {L("ไฟล์ต้นฉบับ", "Source")}
                  </Button>
                  {canImport && r.status === "VALIDATED" ? (
                    <Button
                      size="small"
                      type="primary"
                      onClick={async () => {
                        await commitImport({ variables: { id: r.id } });
                        await refresh();
                      }}
                    >
                      {L("ยืนยัน", "Commit")}
                    </Button>
                  ) : null}
                  {canImport && r.status !== "VOID" ? (
                    <Button
                      danger
                      size="small"
                      onClick={() =>
                        reasonPrompt(
                          L("ยกเลิกชุดนำเข้า", "Void import"),
                          async (reason) => {
                            await voidImport({
                              variables: { id: r.id, reason },
                            });
                            await refresh();
                          },
                        )
                      }
                    >
                      {L("ยกเลิก", "Void")}
                    </Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );

  const reviewTab = (
    <Card
      title={L("ตรวจและจับคู่รายการ", "Review and match entries")}
      extra={
        <Space>
          <Select
            allowClear
            style={{ width: 320 }}
            placeholder={L("ทุกบัญชี", "All accounts")}
            value={accountId}
            onChange={selectAccount}
            options={accountOptions}
          />
          <DatePicker
            picker="month"
            allowClear={false}
            value={month}
            onChange={(v) => v && selectMonth(v)}
          />
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={entries.loading}
        dataSource={entries.data?.bmsBankStatementEntries || []}
        scroll={{ x: true }}
        pagination={{
          current: entryPage,
          pageSize: entryPageSize,
          total: summary?.totalCount || 0,
          showSizeChanger: false,
          onChange: setEntryPage,
        }}
        columns={[
          { title: L("วันที่", "Date"), dataIndex: "postedOn" },
          {
            title: L("รายละเอียด", "Description"),
            render: (_: any, r: any) => (
              <Space direction="vertical" size={0}>
                <span>{r.description || "-"}</span>
                <small>{r.reference || r.counterpartyMasked || ""}</small>
              </Space>
            ),
          },
          {
            title: L("เข้า/ออก", "In/Out"),
            render: (_: any, r: any) => (
              <Tag color={r.direction === "IN" ? "green" : "red"}>
                {r.direction}
              </Tag>
            ),
          },
          {
            title: L("ยอด", "Amount"),
            align: "right" as const,
            render: (_: any, r: any) => baht(r.amount),
          },
          {
            title: L("จับคู่แล้ว", "Matched"),
            align: "right" as const,
            render: (_: any, r: any) => baht(r.matchedAmount),
          },
          {
            title: L("สถานะ", "Status"),
            render: (_: any, r: any) => (
              <Tag color={statusColor[r.status]}>{r.status}</Tag>
            ),
          },
          {
            title: L("จัดการ", "Action"),
            render: (_: any, r: any) =>
              canReview && r.status !== "IGNORED" ? (
                <Space>
                  <Button
                    type={r.status === "MATCHED" ? "default" : "primary"}
                    size="small"
                    onClick={() => void openCandidates(r)}
                  >
                    {r.status === "MATCHED"
                      ? L("ดูการจับคู่", "View matches")
                      : L("หาเอกสาร", "Find matches")}
                  </Button>
                  {["UNMATCHED", "SUGGESTED"].includes(r.status) ? (
                    <Button
                      size="small"
                      onClick={() =>
                        reasonPrompt(
                          L("ข้ามรายการนี้", "Ignore entry"),
                          async (reason) => {
                            await ignoreEntry({
                              variables: { id: r.id, reason },
                            });
                            await refresh();
                          },
                        )
                      }
                    >
                      {L("ข้าม", "Ignore")}
                    </Button>
                  ) : null}
                </Space>
              ) : null,
          },
        ]}
      />
    </Card>
  );

  const closeTab = (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Card title={L("ปิดกระทบยอดรายเดือน", "Monthly close")}>
        <Alert
          closable
          type="warning"
          showIcon
          message={L(
            "ปิดเดือนได้เมื่อไม่มีรายการค้าง และยอดยกมา + เงินเคลื่อนไหว = ยอดคงเหลือ",
            "A month can close only when no unresolved entries remain and balances reconcile.",
          )}
        />
        <Space wrap style={{ marginTop: 16 }}>
          <Select
            style={{ width: 340 }}
            value={accountId}
            onChange={selectAccount}
            options={accountOptions}
            placeholder={L("เลือกบัญชี", "Select account")}
          />
          <DatePicker
            picker="month"
            allowClear={false}
            value={month}
            onChange={(v) => v && selectMonth(v)}
          />
          {canClose && (
            <Popconfirm
              title={L("ยืนยันปิดเดือนนี้?", "Close this month?")}
              onConfirm={async () => {
                if (!accountId) return;
                await closeMonth({
                  variables: { accountId, month: monthText },
                });
                message.success(L("ปิดเดือนแล้ว", "Month closed"));
                await boot.refetch();
              }}
            >
              <Button
                type="primary"
                disabled={!accountId || Boolean(summary?.unresolvedCount)}
              >
                {L("ปิดเดือน", "Close month")}
              </Button>
            </Popconfirm>
          )}
          <Button
            disabled={!accountId}
            icon={<FileExcelOutlined />}
            href={
              accountId
                ? `/api/bms/bank-reconciliation/export?${new URLSearchParams({ accountId, month: monthText, format: "xlsx" })}`
                : undefined
            }
          >
            {L("ชุดส่งบัญชี XLSX", "Accountant pack")}
          </Button>
        </Space>
      </Card>
      <Card title={L("ประวัติปิดเดือน", "Period history")}>
        <Table
          rowKey={(r: any) => `${r.bankAccountId}:${r.periodMonth}`}
          dataSource={boot.data?.bmsBankReconciliationPeriods || []}
          pagination={false}
          columns={[
            { title: L("เดือน", "Month"), dataIndex: "periodMonth" },
            {
              title: L("ยอดยกมา", "Opening"),
              render: (_: any, r: any) =>
                r.openingBalance == null ? "-" : baht(r.openingBalance),
            },
            {
              title: L("ยอดคงเหลือ", "Closing"),
              render: (_: any, r: any) =>
                r.closingBalance == null ? "-" : baht(r.closingBalance),
            },
            {
              title: L("สถานะ", "Status"),
              render: (_: any, r: any) => (
                <Tag color={statusColor[r.status]}>{r.status}</Tag>
              ),
            },
            { title: L("เวอร์ชัน", "Version"), dataIndex: "version" },
            {
              title: "",
              render: (_: any, r: any) =>
                canClose && r.status === "CLOSED" ? (
                  <Button
                    size="small"
                    onClick={() =>
                      reasonPrompt(
                        L("เปิดเดือนใหม่", "Reopen month"),
                        async (reason) => {
                          await reopenMonth({
                            variables: {
                              accountId: r.bankAccountId,
                              month: String(r.periodMonth).slice(0, 10),
                              reason,
                            },
                          });
                          await boot.refetch();
                        },
                      )
                    }
                  >
                    {L("เปิดใหม่", "Reopen")}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>
    </Space>
  );

  const readiness = boot.data?.bmsBankReconciliationReadiness;
  const phaseTab = (
    <Card title={L("ความพร้อม Phase 1–6", "Phase 1–6 readiness")}>
      <Descriptions
        bordered
        column={{ xs: 1, md: 2 }}
        items={[
          {
            key: "import",
            label: uiText("admin_ui.en_phase_1_foundation_8df56"),
            children: (
              <Tag color="green">
                {L(
                  "พร้อม · Sidecar + RLS + RBAC",
                  "Ready · Sidecar + RLS + RBAC",
                )}
              </Tag>
            ),
          },
          {
            key: "match",
            label: uiText("admin_ui.en_phase_2_matching_34592"),
            children: (
              <Tag color="green">
                {readiness?.deterministicMatching
                  ? L(
                      "พร้อม · ต้องยืนยันโดยคน",
                      "Ready · Human confirmation required",
                    )
                  : "-"}
              </Tag>
            ),
          },
          {
            key: "review",
            label: uiText("admin_ui.en_phase_3_review_2782d"),
            children: (
              <Tag color="green">
                {L(
                  "พร้อม · จับคู่/ข้าม/ยกเลิกมี audit",
                  "Ready · Match/ignore/void are audited",
                )}
              </Tag>
            ),
          },
          {
            key: "close",
            label: uiText("admin_ui.en_phase_4_month_close_0296a"),
            children: (
              <Tag color="green">
                {L("พร้อม · Lock + XLSX/CSV", "Ready · Lock + XLSX/CSV")}
              </Tag>
            ),
          },
          {
            key: "pilot",
            label: uiText("admin_ui.en_phase_5_pilot_64478"),
            children: (
              <Tag color="blue">
                {L(
                  "ควบคุมการเปิดด้วย feature flag และสิทธิ์ของร้าน",
                  "Controlled rollout via feature flags and tenant permissions",
                )}
              </Tag>
            ),
          },
          {
            key: "api",
            label: uiText("admin_ui.en_phase_6_optional_api_4f615"),
            children: (
              <Tag color="default">
                {readiness?.openBanking || uiText("admin_ui.en_not_configured_04bca")}
              </Tag>
            ),
          },
        ]}
      />
      <Alert
        closable
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message={L(
          "ยังไม่เชื่อม Open Banking โดยไม่มี provider contract/credential",
          "Open Banking stays disabled until a provider contract and credentials exist",
        )}
        description={L(
          "ไม่สร้างการเชื่อมต่อจำลองและไม่ส่งข้อมูลธนาคารออกนอกระบบ",
          "No fake connection is exposed and bank data is not sent outside the system.",
        )}
      />
    </Card>
  );

  return (
    <div>
      <AdminPageHeader title={L("กระทบยอดธนาคาร", "Bank reconciliation")}>
        <Select
          allowClear
          style={{ width: 320 }}
          placeholder={L("ทุกบัญชี", "All accounts")}
          value={accountId}
          onChange={selectAccount}
          options={accountOptions}
        />
        <DatePicker
          picker="month"
          allowClear={false}
          value={month}
          onChange={(v) => v && selectMonth(v)}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()} />
      </AdminPageHeader>
      {boot.error && !featureError ? (
        <Alert
          closable
          type="error"
          showIcon
          message={L(
            "โหลดข้อมูลไม่สำเร็จ",
            "Could not load reconciliation data",
          )}
          description={boot.error.message}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Tabs
        items={[
          {
            key: "overview",
            label: L("ภาพรวม", "Overview"),
            children: overview,
          },
          {
            key: "accounts",
            label: L("บัญชี", "Accounts"),
            children: accountTab,
          },
          {
            key: "import",
            label: L("นำเข้าและประวัติ", "Import & history"),
            children: importTab,
          },
          {
            key: "review",
            label: L("ตรวจจับคู่", "Review"),
            children: reviewTab,
          },
          {
            key: "close",
            label: L("ปิดเดือน", "Month close"),
            children: closeTab,
          },
          { key: "readiness", label: uiText("admin_ui.en_phase_1_6_b789e"), children: phaseTab },
        ]}
      />
      <Modal
        open={accountOpen}
        title={L("เพิ่มบัญชีธนาคาร", "Add bank account")}
        okText={L("บันทึก", "Save")}
        cancelText={L("ยกเลิก", "Cancel")}
        confirmLoading={creatingAccount}
        onCancel={() => setAccountOpen(false)}
        onOk={() => accountForm.submit()}
      >
        <Form
          form={accountForm}
          layout="vertical"
          initialValues={{ currency: "THB" }}
          onFinish={addAccount}
        >
          <Form.Item
            name="bankCode"
            label={L("รหัสธนาคาร เช่น KBANK", "Bank code, e.g. KBANK")}
            rules={[{ required: true }]}
          >
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item
            name="displayName"
            label={L("ชื่อเรียกบัญชี", "Account display name")}
            rules={[{ required: true }]}
          >
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item
            name="accountNumber"
            label={L(
              "เลขบัญชี (ใช้สร้าง fingerprint แล้วไม่เก็บเลขเต็ม)",
              "Account number (fingerprinted; full number is not stored)",
            )}
            rules={[{ required: true }]}
          >
            <Input maxLength={30} />
          </Form.Item>
          <Form.Item
            name="currency"
            label={L("สกุลเงิน", "Currency")}
            rules={[{ required: true }]}
          >
            <Input maxLength={3} disabled />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={candidateOpen}
        width={900}
        footer={null}
        title={L(
          "ตรวจหลักฐานและเอกสารที่อาจตรงกัน",
          "Review evidence and possible matches",
        )}
        onCancel={() => setCandidateOpen(false)}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          {selectedEntry?.status === "STALE" ? (
            <Alert
              closable
              type="error"
              showIcon
              message={L(
                "ข้อมูลต้นทางของการจับคู่เดิมเปลี่ยนไป",
                "A previously matched source has changed",
              )}
              description={L(
                "ยกเลิกการจับคู่เดิมที่เกี่ยวข้อง แล้วค้นหาและยืนยันใหม่",
                "Void the affected existing link, then find and confirm the current source again.",
              )}
            />
          ) : null}
          <Alert
            closable
            type="info"
            showIcon
            message={L(
              "ระบบเพียงแนะนำ ไม่มีการยืนยันอัตโนมัติ",
              "Suggestions are deterministic and never auto-confirmed",
            )}
          />
          <Card
            size="small"
            title={L("หลักฐานที่เชื่อมไว้", "Existing evidence links")}
          >
            <Table
              size="small"
              rowKey="id"
              loading={linkQuery.loading}
              dataSource={linkQuery.data?.bmsBankReconciliationLinks || []}
              pagination={false}
              columns={[
                { title: L("แหล่งข้อมูล", "Source"), dataIndex: "sourceKey" },
                {
                  title: L("ยอด", "Amount"),
                  render: (_: any, r: any) => baht(r.matchedAmount),
                },
                {
                  title: L("สถานะ", "Status"),
                  render: (_: any, r: any) => (
                    <Tag
                      color={
                        r.stale
                          ? "red"
                          : r.status === "CONFIRMED"
                            ? "green"
                            : "default"
                      }
                    >
                      {r.stale ? uiText("admin_ui.en_stale_600a5") : r.status}
                    </Tag>
                  ),
                },
                {
                  title: "",
                  render: (_: any, r: any) =>
                    r.status === "CONFIRMED" ? (
                      <Button
                        danger
                        size="small"
                        onClick={() =>
                          reasonPrompt(
                            L("ยกเลิกการจับคู่นี้", "Void this match"),
                            async (reason) => {
                              await voidMatch({
                                variables: { id: r.id, reason },
                              });
                              setSelectedEntry((current: any) =>
                                current
                                  ? (() => {
                                      const matchedAmount = centsMoney(
                                        moneyCents(current.matchedAmount) -
                                          moneyCents(r.matchedAmount),
                                      );
                                      return {
                                        ...current,
                                        matchedAmount,
                                        status:
                                          moneyCents(matchedAmount) === 0n
                                            ? "UNMATCHED"
                                            : "PARTIAL",
                                      };
                                    })()
                                  : current,
                              );
                              await Promise.all([
                                linkQuery.refetch(),
                                candidateQuery.refetch(),
                                refresh(),
                              ]);
                            },
                          )
                        }
                      >
                        {L("ยกเลิก", "Void")}
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
          <Table
            rowKey="sourceKey"
            loading={candidateQuery.loading}
            dataSource={candidateQuery.data?.bmsBankMatchCandidates || []}
            pagination={false}
            columns={[
              {
                title: L("แหล่งข้อมูล", "Source"),
                render: (_: any, r: any) => (
                  <Space direction="vertical" size={0}>
                    <b>{r.label}</b>
                    <small>
                      {r.sourceType} · {r.sourceDate}
                    </small>
                  </Space>
                ),
              },
              {
                title: L("ยอดจับคู่", "Match amount"),
                render: (_: any, r: any) => {
                  const remaining = remainingMoney(
                    selectedEntry?.amount,
                    selectedEntry?.matchedAmount,
                  );
                  const maximum = smallerMoney(r.amount, remaining);
                  return (
                    <InputNumber<string>
                      stringMode
                      min="0.01"
                      max={maximum}
                      precision={2}
                      value={matchAmounts[r.sourceKey] ?? maximum}
                      onChange={(v) =>
                        setMatchAmounts((current) => ({
                          ...current,
                          [r.sourceKey]: v || "0.00",
                        }))
                      }
                    />
                  );
                },
              },
              {
                title: L("ความมั่นใจ", "Confidence"),
                render: (_: any, r: any) => (
                  <Progress type="circle" size={44} percent={r.confidence} />
                ),
              },
              {
                title: "",
                render: (_: any, r: any) => {
                  const remaining = remainingMoney(
                    selectedEntry?.amount,
                    selectedEntry?.matchedAmount,
                  );
                  const maximum = smallerMoney(r.amount, remaining);
                  const unavailable = moneyCents(maximum) < 1n;
                  return (
                    <Popconfirm
                      disabled={unavailable}
                      title={L(
                        "ยืนยันเชื่อมหลักฐานนี้?",
                        "Confirm this evidence link?",
                      )}
                      description={L(
                        "ไม่แก้รายการต้นทาง",
                        "The source record will not be changed",
                      )}
                      onConfirm={() => void confirmCandidate(r)}
                    >
                      <Button
                        type="primary"
                        disabled={unavailable}
                        loading={confirming}
                      >
                        {L("ยืนยันจับคู่", "Confirm match")}
                      </Button>
                    </Popconfirm>
                  );
                },
              },
            ]}
          />
        </Space>
      </Modal>
    </div>
  );
}
