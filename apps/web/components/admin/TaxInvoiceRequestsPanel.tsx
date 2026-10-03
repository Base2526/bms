"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Space,
  Table,
  message,
} from "antd";
import { useI18n } from "@/lib/i18nContext";
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
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setSelected(null);
      message.success(t("tax_requests.saved"));
      await load();
      if (result.status === "ISSUED") onIssued();
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
                      onClick={() => {
                        setSelected(r);
                        setAction(
                          r.status === "PENDING" ? "ISSUE" : "NEEDS_INFO"
                        );
                        setReason("");
                      }}
                    >
                      {t("tax_requests.review")}
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
        onCancel={() => setSelected(null)}
        onOk={() => void review()}
        confirmLoading={busy}
        okText={t("tax_requests.confirm")}
        cancelText={t("tax_requests.cancel")}
        okButtonProps={{ disabled: action !== "ISSUE" && !reason.trim() }}
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
              <br />
              {selected.buyer.taxId} · {selected.buyer.branchCode}
              <br />
              {selected.buyer.address}
              <br />
              {selected.buyer.phone}
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
            <Select
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
            />
            {action !== "ISSUE" && (
              <Input.TextArea
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
