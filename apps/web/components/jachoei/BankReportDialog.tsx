"use client";

import * as React from "react";
import { Modal, Typography, Input, Space, Tag, Divider, Button } from "antd";

export type BankReportCategory = "SCAM" | "MONEY_MULE" | "SALES_ADS" | "DISPUTE" | "OTHER";

export type BankReportDialogValue = {
  category: BankReportCategory;
  note: string;
};

type Props = {
  open: boolean;
  bankName: string | null;
  account: string;
  reported: boolean;
  initialCategory?: BankReportCategory;
  initialNote?: string;
  confirmLoading?: boolean;
  undoLoading?: boolean;
  onCancel: () => void;
  onConfirm: (value: BankReportDialogValue) => void;
  onUndo?: () => void;
};

const BANK_CATEGORIES: Array<{ label: string; value: BankReportCategory }> = [
  { label: "Scam", value: "SCAM" },
  { label: "Money Mule", value: "MONEY_MULE" },
  { label: "Sales/Ads", value: "SALES_ADS" },
  { label: "Dispute", value: "DISPUTE" },
  { label: "Other", value: "OTHER" },
];

export function BankReportDialog({ open, bankName, account, reported, initialCategory, initialNote, confirmLoading, undoLoading, onCancel, onConfirm, onUndo }: Props) {
  const [category, setCategory] = React.useState<BankReportCategory>("SCAM");
  const [note, setNote] = React.useState<string>("");

  React.useEffect(() => {
    if (!open) return;
    setCategory(initialCategory ?? "SCAM");
    setNote(initialNote ?? "");
  }, [open, initialCategory, initialNote]);

  const primaryLabel = reported ? "Update Report" : "Report";

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="Report bank account"
      destroyOnClose
      footer={null}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div>
          <Typography.Text type="secondary">Account</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Typography.Text strong>
              {bankName ? `${bankName} · ` : ""}
              {account || "-"}
            </Typography.Text>
          </div>
          {reported ? (
            <Typography.Text type="success" style={{ display: "block", marginTop: 6 }}>
              Reported (on this device)
            </Typography.Text>
          ) : null}
        </div>

        <Divider style={{ margin: "6px 0" }} />

        <div>
          <Typography.Text type="secondary">Category</Typography.Text>
          <div style={{ marginTop: 6 }}>
            <Space size={[6, 6]} wrap>
              {BANK_CATEGORIES.map((c) => (
                <Tag.CheckableTag
                  key={c.value}
                  checked={category === c.value}
                  onChange={() => setCategory(c.value)}
                >
                  {c.label}
                </Tag.CheckableTag>
              ))}
            </Space>
          </div>
        </div>

        <div>
          <Typography.Text type="secondary">Note (optional)</Typography.Text>
          <Input.TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. scam transfer / money mule..."
            maxLength={160}
            showCount
            autoSize={{ minRows: 3, maxRows: 5 }}
            style={{ marginTop: 6 }}
          />
        </div>

        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={onCancel}>Cancel</Button>
          {reported ? (
            <Button
              danger
              loading={!!undoLoading}
              disabled={!!confirmLoading || !!undoLoading}
              onClick={() => onUndo?.()}
            >
              Undo report
            </Button>
          ) : null}
          <Button
            type="primary"
            loading={!!confirmLoading}
            disabled={!!confirmLoading || !!undoLoading}
            onClick={() => onConfirm({ category, note })}
          >
            {primaryLabel}
          </Button>
        </Space>
      </Space>
    </Modal>
  );
}
