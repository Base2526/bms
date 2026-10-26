import type { UpsertProductInput } from "./products";

export type ProductImportTemplateField =
  | "sku" | "barcode" | "name" | "description" | "price" | "cost_price"
  | "category" | "brand" | "keywords" | "creation_template" | "stock_policy"
  | "base_unit" | "variant_codes" | "sales_surfaces";

export type ParsedProductImportRow = UpsertProductInput & { rowNumber: number };

export class ProductImportTemplateError extends Error {
  constructor(
    readonly code: "EMPTY_FILE" | "MISSING_HEADERS" | "DUPLICATE_HEADERS" | "UNKNOWN_HEADERS" | "FORMULA_CELL" | "INVALID_IDENTIFIER" | "INVALID_CELL",
    readonly headers: readonly string[] = []
  ) {
    super(code);
  }
}

/**
 * One schema for the downloaded workbook, its parser, and archetype examples.
 * Headers are intentionally stable Thai/English literals because uploaded files match them exactly.
 */
export const PRODUCT_IMPORT_TEMPLATE_COLUMNS = [
  { header: "SKU", field: "sku", required: true },
  { header: "บาร์โค้ด", field: "barcode", required: false },
  { header: "ชื่อสินค้า", field: "name", required: true },
  { header: "รายละเอียด", field: "description", required: false },
  { header: "ราคาขาย", field: "price", required: true },
  { header: "ต้นทุน", field: "cost_price", required: false },
  { header: "หมวดหมู่", field: "category", required: false },
  { header: "ยี่ห้อ", field: "brand", required: false },
  { header: "คีย์เวิร์ด", field: "keywords", required: false },
  { header: "รูปแบบสินค้า", field: "creation_template", required: false },
  { header: "Stock Policy", field: "stock_policy", required: false },
  { header: "หน่วยฐาน", field: "base_unit", required: false },
  { header: "ตัวเลือก", field: "variant_codes", required: false },
  { header: "ช่องทางขาย", field: "sales_surfaces", required: false },
] as const satisfies readonly {
  header: string;
  field: ProductImportTemplateField;
  required: boolean;
}[];

export const PRODUCT_IMPORT_TEMPLATE_HEADERS = PRODUCT_IMPORT_TEMPLATE_COLUMNS.map((column) => column.header);
export const PRODUCT_IMPORT_REQUIRED_FIELDS = PRODUCT_IMPORT_TEMPLATE_COLUMNS
  .filter((column) => column.required)
  .map((column) => column.field);

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Prefer the import-only Products sheet even if Excel reorders the workbook tabs. */
export function selectProductImportSheetName(sheetNames: readonly string[]): string | null {
  const products = sheetNames.find((name) => name.trim().toLowerCase() === "products");
  if (products) return products;
  // A damaged template must never import its sample records as customer data.
  if (sheetNames.some((name) => ["examples", "guide"].includes(name.trim().toLowerCase()))) return null;
  return sheetNames[0] ?? null;
}

/** A finite invalid value survives GraphQL Float / JSON transport and is rejected by the server. */
function parseImportNumber(raw: string): number {
  const normalized = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw) ? raw.replace(/,/g, "") : raw;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return -1;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : -1;
}

/** Parse the worksheet AOA used by XLSX. This is shared so downloaded examples can be round-tripped in tests. */
export function parseProductImportWorksheet(aoa: readonly (readonly unknown[])[]): ParsedProductImportRow[] {
  if (aoa.length === 0) throw new ProductImportTemplateError("EMPTY_FILE");

  const headerRow = (aoa[0] ?? []).map(normalizeHeader);
  const duplicateHeaders = Array.from(new Set(headerRow.filter((header, index) => header && headerRow.indexOf(header) !== index)));
  if (duplicateHeaders.length > 0) {
    throw new ProductImportTemplateError("DUPLICATE_HEADERS", duplicateHeaders);
  }
  const colIndex: Partial<Record<ProductImportTemplateField, number>> = {};
  for (const { header, field } of PRODUCT_IMPORT_TEMPLATE_COLUMNS) {
    const index = headerRow.indexOf(normalizeHeader(header));
    if (index >= 0) colIndex[field] = index;
  }
  const missingHeaders = PRODUCT_IMPORT_TEMPLATE_COLUMNS
    .filter(({ field, required }) => required && colIndex[field] === undefined)
    .map(({ header }) => header);
  if (missingHeaders.length > 0) {
    throw new ProductImportTemplateError("MISSING_HEADERS", missingHeaders);
  }
  const knownHeaders = new Set(PRODUCT_IMPORT_TEMPLATE_HEADERS.map(normalizeHeader));
  const unknownHeaders = headerRow.filter((header) => header && !knownHeaders.has(header));
  if (unknownHeaders.length) throw new ProductImportTemplateError("UNKNOWN_HEADERS", unknownHeaders);

  return aoa.slice(1).flatMap((row, index) => {
    if (!row.some((cell) => String(cell ?? "").trim() !== "")) return [];
    const get = (field: ProductImportTemplateField): string => {
      const column = colIndex[field];
      return column === undefined ? "" : String(row[column] ?? "").trim();
    };
    const split = (raw: string, transform: (value: string) => string = (value) => value) => raw
      .split(raw.includes("|") ? "|" : ",")
      .map((item) => transform(item.trim()))
      .filter(Boolean);
    const cost = get("cost_price");
    const parsed: ParsedProductImportRow = {
      rowNumber: index + 2,
      sku: get("sku"),
      barcode: get("barcode") || null,
      name: get("name"),
      description: get("description") || null,
      // Never use NaN: JSON turns it into null and GraphQL rejects the entire batch.
      price: parseImportNumber(get("price")),
      cost_price: cost ? parseImportNumber(cost) : null,
      category: get("category") || null,
      brand: get("brand") || null,
      keywords: split(get("keywords"), (value) => value.toLowerCase()),
      creation_template: (get("creation_template") || null) as UpsertProductInput["creation_template"],
      stock_policy: (get("stock_policy") || null) as UpsertProductInput["stock_policy"],
      base_unit: get("base_unit") || null,
      // Variant codes are shop-authored labels. Preserve spelling/case exactly like the product form.
      variant_codes: colIndex.variant_codes === undefined ? null : split(get("variant_codes")),
      sales_surfaces: colIndex.sales_surfaces === undefined
        ? null
        : split(get("sales_surfaces"), (value) => value.toUpperCase()) as UpsertProductInput["sales_surfaces"],
    };
    // Absent columns are not instructions to erase an existing product's fields.
    for (const column of PRODUCT_IMPORT_TEMPLATE_COLUMNS) {
      if (!column.required && colIndex[column.field] === undefined) delete parsed[column.field];
    }
    return [parsed];
  });
}

export function productImportExampleToInput(example: readonly string[]): UpsertProductInput {
  if (example.length !== PRODUCT_IMPORT_TEMPLATE_COLUMNS.length) {
    throw new Error("Product import example does not match the workbook schema");
  }
  const { rowNumber: _rowNumber, ...input } = parseProductImportWorksheet([PRODUCT_IMPORT_TEMPLATE_HEADERS, example])[0];
  return input;
}
