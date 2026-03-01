"use client";

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

const TEL_CATEGORIES: Array<{ label: string; value: TelReportCategory }> = [
  { label: "Spam", value: "SPAM" },
  { label: "Scam", value: "SCAM" },
  { label: "Sales/Ads", value: "SALES" },
  { label: "Harassment", value: "HARASS" },
  { label: "Other", value: "OTHER" },
];

export function TelBlockDialog({ open, tel, blocked, defaultDontAskAgain, initialWantReport, initialCategory, initialNote, confirmLoading, undoLoading, onCancel, onConfirm, onUndo }: Props) {
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
          <Typography.Text type="secondary">Number</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Typography.Text strong>{tel || "-"}</Typography.Text>
          </div>
        </div>

        <>
          <Divider style={{ margin: "6px 0" }} />

          <Checkbox checked={wantReport} onChange={(e) => setWantReport(e.target.checked)}>
            Report to help others
          </Checkbox>

          {wantReport ? (
            <>
              <div>
                <Typography.Text type="secondary">Category</Typography.Text>
                <div style={{ marginTop: 6 }}>
                  <Space size={[6, 6]} wrap>
                    {TEL_CATEGORIES.map((c) => (
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
                  placeholder="e.g. sales call / scam / harassment..."
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
          Don&apos;t ask again for this number
        </Checkbox>

        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={onCancel}>Cancel</Button>
          {blocked ? (
            <Button
              danger
              loading={!!undoLoading}
              disabled={!!confirmLoading || !!undoLoading}
              onClick={() => onUndo?.()}
            >
              Unblock
            </Button>
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
