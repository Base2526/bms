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
import { InboxOutlined, DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import * as XLSX from "xlsx";
import { PRODUCT_IMPORT_MAX_ROWS } from "@/lib/bms/productImport.constants";
import { useI18n } from "@/lib/i18nContext";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — กันไฟล์ใหญ่ทำ browser jank ก่อนแม้แต่จะ parse

type DraftRow = {
  rowNumber: number;
  sku: string;
  name: string;
  price: number;
  barcode: string | null;
  description: string | null;
  cost_price: number | null;
  category: string | null;
  brand: string | null;
  keywords: string[];
  active: boolean;
  creation_template: string | null;
  stock_policy: string | null;
  base_unit: string | null;
  variant_codes: string[] | null;
  sales_surfaces: string[] | null;
};

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
// ⚠️ ห้ามแปลค่าพวกนี้เป็น i18n (HEADER_MAP keys / TEMPLATE_HEADERS / TEMPLATE_EXAMPLE /
// TRUE_WORDS / FALSE_WORDS) — มันไม่ใช่ UI copy แต่เป็น "สัญญารูปแบบไฟล์": parser เทียบหัว
// คอลัมน์ในไฟล์ที่ผู้ใช้อัปโหลดกับสตริงพวกนี้ตรง ๆ ถ้าแปลตามภาษา UI ไฟล์ที่สร้างจากเทมเพลต
// ภาษาหนึ่งจะ import ไม่ได้อีกภาษา (หลักเดียวกับ regex ที่ match ข้อความไทยที่ลูกค้าพิมพ์)
const HEADER_MAP: Record<string, keyof DraftRow> = {
  "sku": "sku",
  "บาร์โค้ด": "barcode",
  "ชื่อสินค้า": "name",
  "รายละเอียด": "description",
  "ราคาขาย": "price",
  "ต้นทุน": "cost_price",
  "หมวดหมู่": "category",
  "ยี่ห้อ": "brand",
  "คีย์เวิร์ด": "keywords",
  "เปิดขาย": "active",
  "รูปแบบสินค้า": "creation_template",
  "stock policy": "stock_policy",
  "หน่วยฐาน": "base_unit",
  "ตัวเลือก": "variant_codes",
  "ช่องทางขาย": "sales_surfaces",
};
const REQUIRED_FIELDS: (keyof DraftRow)[] = ["sku", "name", "price"];
const TEMPLATE_HEADERS = ["SKU", "บาร์โค้ด", "ชื่อสินค้า", "รายละเอียด", "ราคาขาย", "ต้นทุน", "หมวดหมู่", "ยี่ห้อ", "คีย์เวิร์ด", "เปิดขาย", "รูปแบบสินค้า", "Stock Policy", "หน่วยฐาน", "ตัวเลือก", "ช่องทางขาย"];
const TEMPLATE_EXAMPLE = ["MENU-KAPRAO", "", "ข้าวกะเพรา", "เมนูปรุงสด", "79", "", "อาหารจานเดียว", "", "กะเพรา|ผัดกะเพรา", "FALSE", "PREPARED_MENU", "RECIPE", "PIECE", "STD", "RESTAURANT_POS"];

function normalizeHeader(h: unknown): string {
  return String(h ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

const TRUE_WORDS = ["true", "1", "yes", "y", "ใช่"];
const FALSE_WORDS = ["false", "0", "no", "n", "ไม่ใช่", "ปิด"];

function parseWorkbook(buf: ArrayBuffer, t: TFn): DraftRow[] {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error(t("admin_product_import.err_no_sheet"));
  const sheet = wb.Sheets[sheetName];
  const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  if (aoa.length === 0) throw new Error(t("admin_product_import.err_empty_file"));

  const headerRow = (aoa[0] || []).map(normalizeHeader);
  const colIndex: Partial<Record<keyof DraftRow, number>> = {};
  for (const [thHeader, field] of Object.entries(HEADER_MAP)) {
    const idx = headerRow.indexOf(thHeader.toLowerCase());
    if (idx >= 0) colIndex[field] = idx;
  }
  const missing = REQUIRED_FIELDS.filter((f) => colIndex[f] === undefined);
  if (missing.length > 0) {
    throw new Error(t("admin_product_import.err_bad_template"));
  }

  const dataRows = aoa.slice(1).filter((r) => (r || []).some((c) => String(c ?? "").trim() !== ""));

  return dataRows.map((r, i) => {
    const get = (field: keyof DraftRow): string => {
      const idx = colIndex[field];
      return idx === undefined ? "" : String(r[idx] ?? "").trim();
    };
    const activeRaw = get("active").toLowerCase();
    const active = activeRaw === "" ? true : !FALSE_WORDS.includes(activeRaw) || TRUE_WORDS.includes(activeRaw);
    const keywordsRaw = get("keywords");
    const keywords = keywordsRaw
      ? keywordsRaw.split(keywordsRaw.includes("|") ? "|" : ",").map((k) => k.trim().toLowerCase()).filter(Boolean)
      : [];
    const costRaw = get("cost_price");
    const splitCodes = (raw: string) => raw
      .split(raw.includes("|") ? "|" : ",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    return {
      rowNumber: i + 2, // +1 header row, +1 เพื่อให้นับแบบ 1-based ตรงกับที่เห็นใน Excel
      sku: get("sku"),
      name: get("name"),
      price: Number(get("price")),
      barcode: get("barcode") || null,
      description: get("description") || null,
      cost_price: costRaw ? Number(costRaw) : null,
      category: get("category") || null,
      brand: get("brand") || null,
      keywords,
      active,
      creation_template: get("creation_template") || null,
      stock_policy: get("stock_policy") || null,
      base_unit: get("base_unit") || null,
      variant_codes: colIndex.variant_codes === undefined ? null : splitCodes(get("variant_codes")),
      sales_surfaces: colIndex.sales_surfaces === undefined ? null : splitCodes(get("sales_surfaces")),
    };
  });
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, TEMPLATE_EXAMPLE]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  XLSX.writeFile(wb, "bms_product_import_template.xlsx");
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

export default function ImportModal({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [stage, setStage] = useState<"upload" | "preview" | "result">("upload");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [finalResult, setFinalResult] = useState<ImportResult | null>(null);

  const [runImport, { loading: previewing }] = useMutation(M_IMPORT);
  const [committing, setCommitting] = useState(false);

  const reset = () => {
    setRows([]);
    setStage("upload");
    setPreview(null);
    setFinalResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      message.error(t("admin_product_import.err_file_too_large"));
      return false;
    }
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseWorkbook(buf, t);
      if (parsed.length === 0) {
        message.error(t("admin_product_import.err_no_rows"));
        return false;
      }
      if (parsed.length > PRODUCT_IMPORT_MAX_ROWS) {
        message.error(t("admin_product_import.err_too_many_rows", { count: parsed.length, max: PRODUCT_IMPORT_MAX_ROWS }));
        return false;
      }
      setRows(parsed);
      const res = await runImport({ variables: { items: parsed, commit: false } });
      setPreview(res.data.bmsImportProducts);
      setStage("preview");
    } catch (e: any) {
      message.error(e?.message || t("admin_product_import.err_read_failed"));
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
      if (result.createCount + result.updateCount > 0) {
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
      footer={
        stage === "preview"
          ? [
              <Button key="back" onClick={reset}>{t("admin_product_import.btn_pick_new_file")}</Button>,
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
            : [<Button key="close" onClick={handleClose}>{t("admin_product_import.btn_close")}</Button>]
      }
    >
      {stage === "upload" && (
        <div>
          <Alert closable
            type="info" showIcon style={{ marginBottom: 16 }}
            message={t("admin_product_import.no_images_title")}
            description={t("admin_product_import.no_images_desc", { max: PRODUCT_IMPORT_MAX_ROWS })}
          />
          <Button icon={<DownloadOutlined />} onClick={downloadTemplate} style={{ marginBottom: 16 }}>
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
            {stage === "result" && (
              <Alert closable
                type={current.errorCount > 0 ? "warning" : "success"}
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
