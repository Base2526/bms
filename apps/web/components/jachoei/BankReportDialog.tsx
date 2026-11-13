"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";

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

const BANK_CATEGORIES = (uiText: UiTranslator = thaiUiText): Array<{ label: string; value: BankReportCategory }> => ([
  { label: uiText("admin_ui.en_scam_de94a"), value: "SCAM" },
  { label: uiText("admin_ui.en_money_mule_44236"), value: "MONEY_MULE" },
  { label: uiText("admin_ui.en_sales_ads_320e6"), value: "SALES_ADS" },
  { label: uiText("admin_ui.en_dispute_3e05b"), value: "DISPUTE" },
  { label: uiText("admin_ui.en_other_6e6a6"), value: "OTHER" },
]);

export function BankReportDialog({ open, bankName, account, reported, initialCategory, initialNote, confirmLoading, undoLoading, onCancel, onConfirm, onUndo }: Props) {
  const uiText = useUiText();
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
      title={uiText("admin_ui.en_report_bank_account_ae57f")}
      destroyOnClose
      footer={null}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div>
          <Typography.Text type="secondary">{uiText("admin_ui.en_account_85dfa")}</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Typography.Text strong>
              {bankName ? `${bankName} · ` : ""}
              {account || "-"}
            </Typography.Text>
          </div>
          {reported ? (
            <Typography.Text type="success" style={{ display: "block", marginTop: 6 }}>
              {uiText("admin_ui.en_reported_on_this_device_32401")}</Typography.Text>
          ) : null}
        </div>

        <Divider style={{ margin: "6px 0" }} />

        <div>
          <Typography.Text type="secondary">{uiText("admin_ui.en_category_a3c68")}</Typography.Text>
          <div style={{ marginTop: 6 }}>
            <Space size={[6, 6]} wrap>
              {BANK_CATEGORIES(uiText).map((c) => (
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
          <Typography.Text type="secondary">{uiText("admin_ui.en_note_optional_4e395")}</Typography.Text>
          <Input.TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={uiText("admin_ui.en_e_g_scam_transfer_money_mule_611ab")}
            maxLength={160}
            showCount
            autoSize={{ minRows: 3, maxRows: 5 }}
            style={{ marginTop: 6 }}
          />
        </div>

        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={onCancel}>{uiText("admin_ui.en_cancel_77dfd")}</Button>
          {reported ? (
            <Button
              danger
              loading={!!undoLoading}
              disabled={!!confirmLoading || !!undoLoading}
              onClick={() => onUndo?.()}
            >
              {uiText("admin_ui.en_undo_report_40eba")}</Button>
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
