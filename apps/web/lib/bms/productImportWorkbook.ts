import * as XLSX from "xlsx";
import {
  PRODUCT_IMPORT_TEMPLATE_HEADERS, ProductImportTemplateError,
  parseProductImportWorksheet, selectProductImportSheetName,
} from "./productImportTemplate";

/** Read raw numeric values; callers read with cellDates/cellNF/raw enabled. */
export function parseProductImportWorkbook(workbook: XLSX.WorkBook) {
  const name = selectProductImportSheetName(workbook.SheetNames);
  if (!name) throw new ProductImportTemplateError("EMPTY_FILE");
  const sheet = workbook.Sheets[name];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1, raw: true, defval: "", blankrows: true, range: 0,
  });
  const headers = (aoa[0] ?? []).map((value) => String(value).trim().toLowerCase());
  for (let row = 1; row < aoa.length; row++) {
    for (let col = 0; col < headers.length; col++) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];
      if (!cell) continue;
      const location = [`${name}!${address} (${aoa[0][col]})`];
      if (cell.f) throw new ProductImportTemplateError("FORMULA_CELL", location);
      if (cell.t === "e" || cell.t === "d") {
        throw new ProductImportTemplateError("INVALID_CELL", location);
      }
      if (["sku", "บาร์โค้ด"].includes(headers[col]) && cell.t === "n") {
        // Excel retains only 15 significant digits. Lost digits cannot be reconstructed.
        if (!Number.isSafeInteger(cell.v) || cell.v < 0 || cell.v >= 1e15) {
          throw new ProductImportTemplateError("INVALID_IDENTIFIER", location);
        }
        // Honour an explicit zero-padding mask, but never scientific/rounded display text.
        aoa[row][col] = cell.z && /^0+$/.test(cell.z) ? XLSX.utils.format_cell(cell) : String(cell.v);
      }
    }
  }
  return parseProductImportWorksheet(aoa);
}

/** Build the exact workbook downloaded by the Products import modal. */
export function buildProductImportWorkbook(examples: readonly (readonly string[])[], archetype: string): XLSX.WorkBook {
  const columnWidths = PRODUCT_IMPORT_TEMPLATE_HEADERS.map((header, index) => ({
    wch: Math.max(header.length + 3, index === 2 ? 26 : index === 3 ? 42 : index === 13 ? 48 : 14),
  }));
  // Products is intentionally ready for customer data, without importable sample records.
  const products = XLSX.utils.aoa_to_sheet([PRODUCT_IMPORT_TEMPLATE_HEADERS]);
  products["!cols"] = columnWidths;
  products["!autofilter"] = { ref: "A1:N1" };

  const toWorkbookRow = (example: readonly string[]) => example.map((value, index) => {
    if ((index === 4 || index === 5) && value !== "") return Number(value);
    return value;
  });
  const exampleSheet = XLSX.utils.aoa_to_sheet([
    PRODUCT_IMPORT_TEMPLATE_HEADERS,
    ...examples.map(toWorkbookRow),
  ]);
  exampleSheet["!cols"] = columnWidths;
  for (let row = 1; row <= examples.length; row++) {
    for (const col of [0, 1]) {
      const cell = exampleSheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell) cell.z = "@"; // Copying an example row also copies the safe identifier format.
    }
  }
  exampleSheet["!autofilter"] = { ref: `A1:N${examples.length + 1}` };

  const guide = XLSX.utils.aoa_to_sheet([
    ["คู่มือ / Guide", `Template: ${archetype}`],
    ["1. ดูตัวอย่าง", "ดูรูปแบบที่เหมาะกับประเภทร้านในชีต Examples"],
    ["2. กรอกข้อมูล", "คัดลอกแถวที่ต้องการจาก Examples มาวางในชีต Products แล้วเปลี่ยนเป็นข้อมูลจริงของร้าน"],
    ["3. ตรวจไฟล์", "เก็บชีต Products ไว้และห้ามแก้หัวคอลัมน์ ระบบนำเข้าเฉพาะชีตนี้เมื่อมีอยู่"],
    ["4. นำเข้า", "อัปโหลดไฟล์ ดู Preview และแก้ทุกแถวที่ขึ้น error ก่อนกดยืนยัน Import"],
    ["ข้อควรระวัง", "อย่านำแถวตัวอย่างเข้าระบบโดยตรง ตัวอย่างอยู่แยกชีตเพื่อป้องกันการสร้างสินค้าตัวอย่างโดยไม่ตั้งใจ"],
    ["SKU *", "รหัสสินค้าห้ามว่าง และห้ามซ้ำในไฟล์"],
    ["SKU / บาร์โค้ด", "ตั้งเซลล์เป็น Text ก่อนกรอกเพื่อรักษาเลขศูนย์นำหน้าและรหัสยาว; ใช้รหัสจริงของร้าน ไม่ใช้บาร์โค้ดตัวอย่าง"],
    ["สูตร / วันที่", "ไม่รับสูตรหรือวันที่ในช่องสินค้า ให้ Paste Special > Values แล้วตรวจค่าก่อนนำเข้า"],
    ["ชื่อสินค้า *", "ห้ามว่าง"],
    ["ราคาขาย *", "ตัวเลข 0 ขึ้นไป ไม่ใส่สัญลักษณ์เงินตรา"],
    ["อัปเดต SKU เดิม", "SKU ที่มีแล้วคืออัปเดต ไม่ใช่สร้างซ้ำ; คอลัมน์ที่ไม่ส่งมาคงค่าเดิม แต่ช่องว่างในคอลัมน์ข้อมูลทั่วไปจะล้างค่าเดิม"],
    ["รูป / น้ำหนัก / สต็อก", "ไฟล์นี้ไม่เปลี่ยนรูป น้ำหนัก หรือยอดสต็อก; สูตร แพ็ก ส่วนประกอบ ล็อต serial และราคาแยกตัวเลือกต้องตั้งในหน้าที่เกี่ยวข้อง"],
    ["รูปแบบสต็อกเดิม", "Stock Policy / หน่วยฐาน ใช้สร้างสินค้าใหม่; เปลี่ยนของ SKU เดิมที่หน้ารูปแบบสต็อก ไม่ใช่ Excel"],
    ["ตัวเลือก / ช่องทางว่าง", "ตัวเลือกว่างจะไม่เพิ่มตัวเลือก (ไม่ลบตัวเลือกเดิม); ช่องทางขายว่างหมายถึงปิดทุกช่องทาง"],
    ["รูปแบบสินค้า", "GENERAL | QUICK_MENU | PREPARED_MENU | READY_GOOD | INGREDIENT"],
    ["Stock Policy", "DIRECT | PACK | BUNDLE | WEIGHTED | RECIPE | SERIALIZED | NON_STOCK"],
    ["ตั้งค่าต่อ", "PACK, BUNDLE, WEIGHTED และ RECIPE สร้างเป็น draft; ต้องกำหนดหน่วยขาย/ส่วนประกอบ/เครื่องชั่ง/สูตรให้ครบก่อนเปิดขาย"],
    ["หน่วยฐาน", "รหัส A-Z, 0-9, underscore เท่านั้น เช่น PIECE, BAG, REAM"],
    ["ตัวเลือก", "คั่นหลายค่าด้วย | เช่น S|M|L; ใช้กับไซซ์/สี/รุ่น ไม่ใช่จำนวนต่อแพ็ก (จำนวนต่อแพ็กตั้งใน Product Packs)"],
    ["ช่องทางขาย", "RETAIL_POS | RESTAURANT_POS | PUBLIC_STOREFRONT | CUSTOMER_AI | ONLINE_ORDER"],
    ["ก่อนยืนยัน", "Preview จะแจ้งแถวที่ผิด แก้ไฟล์แล้วอัปโหลดใหม่; no data is written until confirmation."],
  ]);
  guide["!cols"] = [{ wch: 24 }, { wch: 96 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, products, "Products");
  XLSX.utils.book_append_sheet(workbook, exampleSheet, "Examples");
  XLSX.utils.book_append_sheet(workbook, guide, "Guide");
  return workbook;
}
