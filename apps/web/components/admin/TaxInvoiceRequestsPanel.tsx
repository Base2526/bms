"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import { useI18n } from "@/lib/i18nContext";
import { TAX_BUYER_TYPES } from "@/lib/taxRequestFields";
export default function TaxInvoiceRequestsPanel({
  canIssue,
  onIssued,
}: {
  canIssue: boolean;
  onIssued: () => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState("PENDING"),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<any>(null),
    [action, setAction] = useState("ISSUE"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [emailKey, setEmailKey] = useState("");
  const validEmail = (value: unknown) => typeof value === "string" && value.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
  const openReview = (row: any, nextAction: string) => {
    setSelected(row);
    setAction(nextAction);
    setReason("");
    setSendEmail(validEmail(row.buyer.email));
    setEmailKey(crypto.randomUUID());
  };
  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/bms/tax-invoice-requests?status=${status}&offset=${offset}`,
        { cache: "no-store" }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setData(result);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, [status, offset]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);
  const review = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/bms/tax-invoice-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          version: selected.version,
          action,
          reason,
          confirmed: true,
          sendEmail: action === "ISSUE" && sendEmail,
          emailRecipient: selected.buyer.email,
          emailKey,
          expectedEmailId: selected.email?.id ?? null,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setSelected(null);
      message.success(t("tax_requests.saved"));
      await load();
      if (result.status === "ISSUED" && action === "ISSUE") {
        setStatus("ISSUED");
        setOffset(0);
        onIssued();
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (data?.enabled === false) return null;
  return (
    <Card
      title={t("tax_requests.title")}
      style={{ marginBottom: 16 }}
      extra={
        <Button onClick={() => void load()}>{t("tax_requests.refresh")}</Button>
      }
    >
      {error && <Alert closable type="error" showIcon message={error} />}
      {data?.enabled === false ? (
        <Alert
          closable
          type="info"
          showIcon
          message={t("tax_requests.disabled")}
        />
      ) : (
        <>
          <Select
            value={status}
            onChange={(v) => {
              setStatus(v);
              setOffset(0);
            }}
            style={{ width: 220, marginBottom: 12 }}
            options={["PENDING", "NEEDS_INFO", "REJECTED", "ISSUED"].map(
              (v) => ({ value: v, label: t(`tax_requests.${v.toLowerCase()}`) })
            )}
          />
          <Table
            rowKey="id"
            dataSource={data?.rows ?? []}
            pagination={false}
            scroll={{ x: true }}
            columns={[
              {
                title: t("tax_requests.date"),
                dataIndex: "createdAt",
                render: (v: string) => new Date(v).toLocaleString(),
              },
              {
                title: t("tax_requests.branch"),
                render: (_: unknown, r: any) =>
                  `${r.branchCode} · ${r.locationName}`,
              },
              {
                title: t("tax_requests.buyer"),
                render: (_: unknown, r: any) => (
                  <>
                    {r.buyer.name}
                    <br />
                    {r.buyer.taxId}
                  </>
                ),
              },
              { title: t("tax_requests.feedback"), dataIndex: "feedback" },
              {
                title: t("tax_requests.email_delivery"),
                render: (_: unknown, r: any) => <>
                  <Tag color={r.email?.status === "SENT" ? "green" : ["FAILED", "UNKNOWN"].includes(r.email?.status) ? "red" : "default"}>
                    {t(`tax_requests.email_${(r.email?.status ?? "NOT_REQUESTED").toLowerCase()}`)}
                  </Tag>
                  {r.email && <><br />{r.email.recipient}<br />{new Date(r.email.finishedAt ?? r.email.createdAt).toLocaleString()}</>}
                </>,
              },
              {
                title: t("tax_requests.usage"),
                render: (_: unknown, r: any) => `${r.submissionCount}/3`,
              },
              {
                title: t("tax_requests.deadline"),
                dataIndex: "requestDeadline",
                render: (v: string) =>
                  new Date(v).toLocaleString("th-TH", {
                    timeZone: "Asia/Bangkok",
                  }) + " (UTC+7)",
              },
              {
                title: t("tax_requests.action"),
                render: (_: unknown, r: any) =>
                  canIssue && ["PENDING", "NEEDS_INFO"].includes(r.status) ? (
                    <Button
                      onClick={() => openReview(r, r.status === "PENDING" ? "ISSUE" : "NEEDS_INFO")}
                    >
                      {t("tax_requests.review")}
                    </Button>
                  ) : canIssue && r.status === "ISSUED" ? (
                    <Button disabled={!validEmail(r.buyer.email) || ["PENDING", "SENDING", "CANCELLED"].includes(r.email?.status)}
                      onClick={() => openReview(r, "EMAIL")}>
                      {t(r.email ? "tax_requests.email_resend" : "tax_requests.email_send")}
                    </Button>
                  ) : null,
              },
            ]}
          />
          <Space style={{ marginTop: 12 }}>
            <Button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              {t("tax_requests.previous")}
            </Button>
            <span>{offset / 50 + 1}</span>
            <Button
              disabled={!data?.hasMore}
              onClick={() => setOffset(offset + 50)}
            >
              {t("tax_requests.next")}
            </Button>
          </Space>
        </>
      )}
      <Modal
        open={Boolean(selected)}
        title={t("tax_requests.confirm")}
        onCancel={() => { if (!busy) setSelected(null); }}
        onOk={() => void review()}
        confirmLoading={busy}
        okText={t(action === "EMAIL" ? "tax_requests.email_confirm" : action === "ISSUE" && sendEmail ? "tax_requests.issue_and_email" : "tax_requests.confirm")}
        cancelText={t("tax_requests.cancel")}
        okButtonProps={{ disabled: ["NEEDS_INFO", "REJECT"].includes(action) && !reason.trim() }}
        cancelButtonProps={{ disabled: busy }}
      >
        {selected && (
          <>
            <Alert
              closable
              showIcon
              type="warning"
              message={t("tax_requests.confirm_hint")}
            />
            <p>
              {selected.locationName} · {selected.branchCode}
              <br />
              {selected.buyer.name}
              {selected.buyer.buyerType && <> · {TAX_BUYER_TYPES.find((item) => item.value === selected.buyer.buyerType)?.label}</>}
              <br />
              {selected.buyer.taxId} · {selected.buyer.branchCode}
              <br />
              {selected.buyer.address}
              <br />
              {selected.buyer.phone}
              <br />
              {selected.buyer.email}
            </p>
            <p>
              {t("tax_requests.order")}: {selected.receiptNo} ·{" "}
              {Number(selected.total).toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}{" "}
              THB
              <br />
              {selected.orderId}
            </p>
            {action !== "EMAIL" && <Select
              disabled={busy}
              value={action}
              onChange={setAction}
              style={{ width: "100%" }}
              options={[
                {
                  value: "ISSUE",
                  label: t("tax_requests.issue"),
                  disabled: selected.status !== "PENDING",
                },
                { value: "NEEDS_INFO", label: t("tax_requests.needs_info") },
                { value: "REJECT", label: t("tax_requests.reject") },
              ]}
            />}
            {action === "ISSUE" && <p>
              <Checkbox checked={sendEmail} disabled={busy || !validEmail(selected.buyer.email)} onChange={e => setSendEmail(e.target.checked)}>
                {t("tax_requests.email_checkbox")}
              </Checkbox>
            </p>}
            {(action === "EMAIL" || (action === "ISSUE" && sendEmail)) && <>
              <p>{t("tax_requests.email_recipient")}: <strong>{selected.buyer.email}</strong></p>
              {/* A newly opened confirmation must show the notice again, even if it was dismissed. */}
              <Alert key={emailKey} closable type={selected.email ? "warning" : "info"} showIcon
                message={t(selected.email ? "tax_requests.email_repeat_warning" : "tax_requests.email_copy_notice")} />
            </>}
            {action === "ISSUE" && !validEmail(selected.buyer.email) && <p>{t("tax_requests.email_missing")}</p>}
            {["NEEDS_INFO", "REJECT"].includes(action) && (
              <Input.TextArea
                disabled={busy}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                placeholder={t("tax_requests.reason")}
                style={{ marginTop: 12 }}
              />
            )}
          </>
        )}
      </Modal>
    </Card>
  );
}
