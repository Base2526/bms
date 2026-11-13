"use client";

import { useUiText, thaiUiText, type UiTranslator } from "@/lib/useUiText";

import * as React from "react";
import { Modal, Typography, Checkbox, Input, Space, Tag, Divider, Button } from "antd";

export type TelReportCategory = "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";

export type TelBlockDialogValue = {
  wantReport: boolean;
  category: TelReportCategory;
  note: string;
  dontAskAgain: boolean;
};

type Props = {
  open: boolean;
  tel: string;
  blocked: boolean;
  defaultDontAskAgain?: boolean;
  initialWantReport?: boolean;
  initialCategory?: TelReportCategory;
  initialNote?: string;
  confirmLoading?: boolean;
  undoLoading?: boolean;
  onCancel: () => void;
  onConfirm: (value: TelBlockDialogValue) => void;
  onUndo?: () => void;
};

const TEL_CATEGORIES = (uiText: UiTranslator = thaiUiText): Array<{ label: string; value: TelReportCategory }> => ([
  { label: uiText("admin_ui.en_spam_d8628"), value: "SPAM" },
  { label: uiText("admin_ui.en_scam_de94a"), value: "SCAM" },
  { label: uiText("admin_ui.en_sales_ads_320e6"), value: "SALES" },
  { label: uiText("admin_ui.en_harassment_8fddd"), value: "HARASS" },
  { label: uiText("admin_ui.en_other_6e6a6"), value: "OTHER" },
]);

export function TelBlockDialog({ open, tel, blocked, defaultDontAskAgain, initialWantReport, initialCategory, initialNote, confirmLoading, undoLoading, onCancel, onConfirm, onUndo }: Props) {
  const uiText = useUiText();
  const [wantReport, setWantReport] = React.useState<boolean>(true);
  const [category, setCategory] = React.useState<TelReportCategory>("SCAM");
  const [note, setNote] = React.useState<string>("");
  const [dontAskAgain, setDontAskAgain] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!open) return;
    setWantReport(initialWantReport ?? true);
    setCategory(initialCategory ?? "SCAM");
    setNote(initialNote ?? "");
    setDontAskAgain(!!defaultDontAskAgain);
  }, [open, defaultDontAskAgain, initialWantReport, initialCategory, initialNote]);

  const title = blocked ? "Manage blocked number" : "Before blocking, please confirm";
  const primaryLabel = blocked ? "Update Report" : wantReport ? "Block + Report" : "Block";

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={title}
      destroyOnClose
      footer={null}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div>
          <Typography.Text type="secondary">{uiText("admin_ui.en_number_b7baa")}</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Typography.Text strong>{tel || "-"}</Typography.Text>
          </div>
        </div>

        <>
          <Divider style={{ margin: "6px 0" }} />

          <Checkbox checked={wantReport} onChange={(e) => setWantReport(e.target.checked)}>
            {uiText("admin_ui.en_report_to_help_others_015d4")}</Checkbox>

          {wantReport ? (
            <>
              <div>
                <Typography.Text type="secondary">{uiText("admin_ui.en_category_a3c68")}</Typography.Text>
                <div style={{ marginTop: 6 }}>
                  <Space size={[6, 6]} wrap>
                    {TEL_CATEGORIES(uiText).map((c) => (
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
                  placeholder={uiText("admin_ui.en_e_g_sales_call_scam_harassment_2bf5a")}
                  maxLength={120}
                  showCount
                  autoSize={{ minRows: 3, maxRows: 5 }}
                  style={{ marginTop: 6 }}
                />
              </div>
            </>
          ) : null}
        </>

        <Divider style={{ margin: "6px 0" }} />

        <Checkbox checked={dontAskAgain} onChange={(e) => setDontAskAgain(e.target.checked)}>
          {uiText("admin_ui.en_don_apos_t_ask_again_for_this_number_9dba4")}</Checkbox>

        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={onCancel}>{uiText("admin_ui.en_cancel_77dfd")}</Button>
          {blocked ? (
            <Button
              danger
              loading={!!undoLoading}
              disabled={!!confirmLoading || !!undoLoading}
              onClick={() => onUndo?.()}
            >
              {uiText("admin_ui.en_unblock_12aab")}</Button>
          ) : null}
          <Button
            type="primary"
            loading={!!confirmLoading}
            disabled={!!confirmLoading || !!undoLoading}
            onClick={() => onConfirm({ wantReport, category, note, dontAskAgain })}
          >
            {primaryLabel}
          </Button>
        </Space>
      </Space>
    </Modal>
  );
}
