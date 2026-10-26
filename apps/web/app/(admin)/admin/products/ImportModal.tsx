'use client';
import { useState } from "react";
import { gql, useMutation } from "@apollo/client";
import {
  Modal,
  Upload,
  Button,
  Table,
  Tag,
  Alert,
  Space,
  Typography,
  message,
} from "antd";
import { InboxOutlined, DownloadOutlined } from "@ant-design/icons";
import * as XLSX from "xlsx";
import { PRODUCT_IMPORT_MAX_ROWS } from "@/lib/bms/productImport.constants";
import { useI18n } from "@/lib/i18nContext";
import { shopExperienceForArchetype } from "@/lib/bms/shopExperience";
import {
  ProductImportTemplateError,
  selectProductImportSheetName,
  type ParsedProductImportRow,
} from "@/lib/bms/productImportTemplate";
import { buildProductImportWorkbook, parseProductImportWorkbook } from "@/lib/bms/productImportWorkbook";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — กันไฟล์ใหญ่ทำ browser jank ก่อนแม้แต่จะ parse

type DraftRow = ParsedProductImportRow;

type RowResult = {
  rowNumber: number;
  sku: string | null;
  action: "CREATE" | "UPDATE" | "ERROR";
  error: string | null;
};

type ImportResult = {
  rows: RowResult[];
  quotaExceeded: boolean;
  quotaMessage: string | null;
  createCount: number;
  updateCount: number;
  errorCount: number;
};

// header ในเทมเพลต (ไทย) -> field ภายในที่ตรงกับ UpsertProductInput เดิม
// ⚠️ ห้ามแปล PRODUCT_IMPORT_TEMPLATE_COLUMNS เป็น i18n
// — มันไม่ใช่ UI copy แต่เป็น "สัญญารูปแบบไฟล์": parser เทียบหัว
// คอลัมน์ในไฟล์ที่ผู้ใช้อัปโหลดกับสตริงพวกนี้ตรง ๆ ถ้าแปลตามภาษา UI ไฟล์ที่สร้างจากเทมเพลต
// ภาษาหนึ่งจะ import ไม่ได้อีกภาษา (หลักเดียวกับ regex ที่ match ข้อความไทยที่ลูกค้าพิมพ์)
// ไม่มีคอลัมน์ "เปิดขาย" โดยตั้งใจ: ตั้งแต่ 9.51 lifecycle เปลี่ยนได้ทาง
// bmsSetProductActive/publishProduct ที่ตรวจ readiness เท่านั้น upsertProduct
// จึงไม่สนใจค่า active ที่ส่งมา — คอลัมน์ที่กรอกแล้วไม่มีผลแย่กว่าไม่มีคอลัมน์
function parseWorkbook(buf: ArrayBuffer, t: TFn): DraftRow[] {
  const wb = XLSX.read(buf, { type: "array", raw: true, cellNF: true, cellDates: true });
  const sheetName = selectProductImportSheetName(wb.SheetNames);
  if (!sheetName) throw new Error(t("admin_product_import.err_no_sheet"));
  try {
    return parseProductImportWorkbook(wb);
  } catch (error) {
    if (error instanceof ProductImportTemplateError) {
      if (error.code === "EMPTY_FILE") throw new Error(t("admin_product_import.err_empty_file"));
      if (error.code === "DUPLICATE_HEADERS") {
        throw new Error(t("admin_product_import.err_duplicate_headers", { headers: error.headers.join(", ") }));
      }
      if (error.code === "UNKNOWN_HEADERS") throw new Error(t("admin_product_import.err_unknown_headers", { headers: error.headers.join(", ") }));
      if (error.code === "FORMULA_CELL") throw new Error(t("admin_product_import.err_formula_cell", { cells: error.headers.join(", ") }));
      if (error.code === "INVALID_IDENTIFIER") throw new Error(t("admin_product_import.err_identifier", { cells: error.headers.join(", ") }));
      if (error.code === "INVALID_CELL") throw new Error(t("admin_product_import.err_invalid_cell", { cells: error.headers.join(", ") }));
      throw new Error(t("admin_product_import.err_missing_headers", { headers: error.headers.join(", ") }));
    }
    throw error;
  }
}

function downloadTemplate(examples: readonly (readonly string[])[], archetype: string) {
  XLSX.writeFile(buildProductImportWorkbook(examples, archetype), `bms_product_import_${archetype}_template.xlsx`);
}

const M_IMPORT = gql`
  mutation ($items: [BmsProductImportRowInput!]!, $commit: Boolean) {
    bmsImportProducts(items: $items, commit: $commit) {
      rows { rowNumber sku action error }
      quotaExceeded
      quotaMessage
      createCount
      updateCount
      errorCount
    }
  }
`;

const ACTION_COLOR: Record<RowResult["action"], string> = {
  CREATE: "green",
  UPDATE: "blue",
  ERROR: "red",
};
const actionLabel = (a: RowResult["action"], t: TFn) =>
  a === "CREATE" ? t("admin_product_import.action_create")
  : a === "UPDATE" ? t("admin_product_import.action_update")
  : t("admin_product_import.action_error");

export default function ImportModal({ open, businessArchetype, onClose, onImported }: {
  open: boolean;
  businessArchetype?: string | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useI18n();
  const shopExperience = shopExperienceForArchetype(businessArchetype);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [stage, setStage] = useState<"upload" | "preview" | "result">("upload");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [finalResult, setFinalResult] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [runImport, { loading: previewing }] = useMutation(M_IMPORT);
  const [committing, setCommitting] = useState(false);

  const reset = () => {
    setRows([]);
    setStage("upload");
    setPreview(null);
    setFinalResult(null);
    setFileError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setFileError(null);
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(t("admin_product_import.err_file_too_large"));
      return false;
    }
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseWorkbook(buf, t);
      if (parsed.length === 0) {
        setFileError(t("admin_product_import.err_no_rows"));
        return false;
      }
      if (parsed.length > PRODUCT_IMPORT_MAX_ROWS) {
        setFileError(t("admin_product_import.err_too_many_rows", { count: parsed.length, max: PRODUCT_IMPORT_MAX_ROWS }));
        return false;
      }
      setRows(parsed);
      const res = await runImport({ variables: { items: parsed, commit: false } });
      setPreview(res.data.bmsImportProducts);
      setStage("preview");
    } catch (e: any) {
      setFileError(e?.message || t("admin_product_import.err_read_failed"));
    }
    return false; // กัน antd Upload อัปโหลดไฟล์เอง
  };

  const handleConfirm = async () => {
    setCommitting(true);
    try {
      const res = await runImport({ variables: { items: rows, commit: true } });
      const result: ImportResult = res.data.bmsImportProducts;
      setFinalResult(result);
      setStage("result");
      if (!result.quotaExceeded && result.createCount + result.updateCount > 0) {
        message.success(t("admin_product_import.import_success", { created: result.createCount, updated: result.updateCount }));
        onImported();
      } else {
        message.warning(t("admin_product_import.import_none"));
      }
    } catch (e: any) {
      message.error(e?.message || t("admin_product_import.import_failed"));
    } finally {
      setCommitting(false);
    }
  };

  const resultColumns = [
    { title: t("admin_product_import.col_row"), dataIndex: "rowNumber", key: "rowNumber", width: 70 },
    { title: "SKU", dataIndex: "sku", key: "sku", width: 140,
      render: (s: string | null) => s || <span style={{ color: "#999" }}>—</span> },
    {
      title: t("admin_product_import.col_status"), dataIndex: "action", key: "action", width: 110,
      render: (a: RowResult["action"]) => <Tag color={ACTION_COLOR[a]}>{actionLabel(a, t)}</Tag>,
    },
    {
      title: t("admin_product_import.col_note"), dataIndex: "error", key: "error",
      render: (e: string | null) => e || <span style={{ color: "#999" }}>—</span>,
    },
  ];

  const current = stage === "result" ? finalResult : preview;

  return (
    <Modal
      title={t("admin_product_import.modal_title")}
      open={open}
      onCancel={handleClose}
      width={720}
      closable={!committing && !previewing}
      maskClosable={!committing && !previewing}
      keyboard={!committing && !previewing}
      footer={
        stage === "preview"
          ? [
              <Button key="back" disabled={committing} onClick={reset}>{t("admin_product_import.btn_pick_new_file")}</Button>,
              <Button
                key="confirm" type="primary" loading={committing}
                disabled={!preview || preview.quotaExceeded || preview.createCount + preview.updateCount === 0}
                onClick={handleConfirm}
              >
                {t("admin_product_import.btn_confirm_import")}
              </Button>,
            ]
          : stage === "result"
            ? [<Button key="close" type="primary" onClick={handleClose}>{t("admin_product_import.btn_done")}</Button>]
            : [<Button key="close" disabled={previewing} onClick={handleClose}>{t("admin_product_import.btn_close")}</Button>]
      }
    >
      {stage === "upload" && (
        <div>
          {fileError && <Alert closable onClose={() => setFileError(null)} type="error" showIcon message={fileError} style={{ marginBottom: 16 }} />}
          <Alert closable
            type="info" showIcon style={{ marginBottom: 16 }}
            message={t("admin_product_import.no_images_title")}
            description={
              <>
                <div>{t("admin_product_import.no_images_desc", { max: PRODUCT_IMPORT_MAX_ROWS })}</div>
                <div>{t("admin_product_import.draft_only_desc")}</div>
              </>
            }
          />
          <Button
            icon={<DownloadOutlined />}
            onClick={() => downloadTemplate(shopExperience.importExamples, shopExperience.archetype)}
            style={{ marginBottom: 16 }}
          >
            {t("admin_product_import.btn_download_template")}
          </Button>
          <Upload.Dragger
            accept=".csv,.xlsx,.xls"
            multiple={false}
            showUploadList={false}
            beforeUpload={handleFile}
            disabled={previewing}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">{t("admin_product_import.upload_text")}</p>
            <p className="ant-upload-hint">{t("admin_product_import.upload_hint")}</p>
          </Upload.Dragger>
          {previewing && <Typography.Text type="secondary">{t("admin_product_import.checking_file")}</Typography.Text>}
        </div>
      )}

      {(stage === "preview" || stage === "result") && current && (
        <div>
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Space wrap>
              <Tag color="green">{t("admin_product_import.summary_create", { count: current.createCount })}</Tag>
              <Tag color="blue">{t("admin_product_import.summary_update", { count: current.updateCount })}</Tag>
              <Tag color="red">{t("admin_product_import.summary_error", { count: current.errorCount })}</Tag>
            </Space>
            {current.quotaExceeded && (
              <Alert closable type="error" showIcon message={t("admin_product_import.quota_exceeded")} description={current.quotaMessage} />
            )}
            {stage === "preview" && current.errorCount > 0 && (
              <Alert closable type="warning" showIcon message={t("admin_product_import.partial_warning")} />
            )}
            {stage === "result" && (
              <Alert closable
                type={current.quotaExceeded || current.errorCount > 0 ? "warning" : "success"}
                showIcon
                message={stage === "result" ? t("admin_product_import.result_done") : t("admin_product_import.result_preview")}
              />
            )}
            <Table
              size="small"
              rowKey="rowNumber"
              columns={resultColumns}
              dataSource={current.rows}
              pagination={{ pageSize: 10 }}
              scroll={{ y: 320 }}
            />
          </Space>
        </div>
      )}
    </Modal>
  );
}
