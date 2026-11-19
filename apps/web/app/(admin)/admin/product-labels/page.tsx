"use client";

import { useUiText } from "@/lib/useUiText";
// หน้าพิมพ์สติกเกอร์บาร์โค้ดติดสินค้า
// -------------------------------------------------------------
// ปิดวงให้ปุ่ม "สร้างเลขของร้าน" ที่หน้าสินค้า — เลขที่สร้างมาไม่มีประโยชน์จนกว่า
// จะมีทางพิมพ์แปะที่ตัวของ
//
// พิมพ์ผ่าน window.print() ของเบราว์เซอร์ ไม่ใช่ ESC/POS: สติกเกอร์บาร์โค้ดพิมพ์กับ
// เครื่องพิมพ์ฉลากหรือเครื่องพิมพ์กระดาษ A4 แบบสติกเกอร์ตัดสำเร็จก็ได้ ซึ่งเป็นอุปกรณ์
// คนละตัวกับเครื่องพิมพ์ใบเสร็จ · ให้ผู้ใช้เลือกจาก dialog ของ OS เองจึงยืดหยุ่นกว่า
//
// ขนาดฉลากคุมด้วย CSS หน่วย mm — เครื่องพิมพ์ฉลากคิดเป็นมิลลิเมตร ไม่ใช่พิกเซล

import { useMemo, useState } from "react";
import { gql, useQuery } from "@apollo/client";
import { Alert, Button, Card, Empty, Input, InputNumber, Space, Table, Tag, Typography } from "antd";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { eanBars } from "@/lib/pos/barcode";
import { checkBarcode } from "@/lib/bms/barcode";

const Q_PRODUCTS = gql`
  query LabelProducts($search: String, $limit: Int) {
    bmsProducts(search: $search, limit: $limit) {
      items { sku name price barcode }
      total
    }
  }
`;

type Row = { sku: string; name: string; price: number; barcode: string | null };

/**
 * บาร์โค้ด EAN เป็น SVG
 *
 * แท่ง guard ยาวกว่าแท่งข้อมูลตามมาตรฐาน — เครื่องสแกนบางรุ่นใช้หาจุดเริ่ม/จบ
 * ตอนอ่านเฉียง · ตัวเลขพิมพ์ใต้บาร์โค้ดเสมอ เพราะถ้าสติกเกอร์ยับ/เลอะจนสแกนไม่ติด
 * พนักงานต้องพิมพ์เลขเข้าเครื่องเองได้
 */
function EanSvg({ code, heightMm = 12 }: { code: string; heightMm?: number }) {
  const uiText = useUiText();
  const render = eanBars(code);
  if (!render) return null;

  const { bars, width, guardBarIndexes, humanReadable } = render;
  const guard = new Set(guardBarIndexes);
  const barH = 40;
  const guardH = 46;
  const textY = 52;

  return (
    <svg
      viewBox={`0 0 ${width + 12} 56`}
      style={{ display: "block", width: "100%", height: `${heightMm}mm` }}
      role="img"
      aria-label={uiText("admin_ui.barcode_c8c23", { v0: code })}
    >
      {/* เว้นขอบซ้าย-ขวา (quiet zone) — ไม่มีแล้วสแกนไม่ติด แม้แท่งจะถูกทุกแท่ง */}
      <g transform="translate(6,0)">
        {bars.map((bar, i) => (
          <rect key={i} x={bar.x} y={0} width={bar.width} height={guard.has(i) ? guardH : barH} fill="#000" />
        ))}
        <text x={-5} y={textY} fontSize="8" fontFamily="monospace" textAnchor="middle">{humanReadable.lead}</text>
        <text x={24} y={textY} fontSize="8" fontFamily="monospace" textAnchor="middle">{humanReadable.left}</text>
        <text x={71} y={textY} fontSize="8" fontFamily="monospace" textAnchor="middle">{humanReadable.right}</text>
      </g>
    </svg>
  );
}

export default function ProductLabelsPage() {
  const uiText = useUiText();
  const { can, loading: permLoading } = useBmsPermissions();
  const [search, setSearch] = useState("");
  const [copies, setCopies] = useState<Record<string, number>>({});

  const { data, loading } = useQuery(Q_PRODUCTS, {
    variables: { search: search.trim() || null, limit: 200 },
    fetchPolicy: "cache-and-network",
  });
  const rows: Row[] = data?.bmsProducts?.items ?? [];

  /** สินค้าที่เลือกไว้ กางเป็นสติกเกอร์ทีละใบตามจำนวนที่สั่ง */
  const labels = useMemo(() => {
    const out: Row[] = [];
    for (const row of rows) {
      const n = copies[row.sku] ?? 0;
      for (let i = 0; i < n; i += 1) out.push(row);
    }
    return out;
  }, [rows, copies]);

  const unprintable = useMemo(
    () => rows.filter((r) => (copies[r.sku] ?? 0) > 0 && !eanBars(r.barcode ?? "")),
    [rows, copies]
  );

  if (!permLoading && !can("product.view")) {
    return <Alert closable type="error" showIcon message={uiText("admin_ui.you_do_not_have_permission_to_view_products_ee80e")} />;
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div className="labels-screen-only">
        <AdminPageHeader title={uiText("admin_ui.print_barcode_labels_b19c1")} />

        <Alert closable
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={uiText("admin_ui.print_only_for_products_without_manufacturer_barcodes_a7414")}
          description={uiText("admin_ui.do_not_cover_manufacturer_barcodes_the_existing_product_3aaa4")}
        />

        <Card
          title={uiText("admin_ui.select_products_and_label_quantities_b5aea")}
          loading={loading && rows.length === 0}
          extra={
            <Space>
              <Typography.Text type="secondary">{labels.length}  {uiText("admin_ui.labels_73f6e")}</Typography.Text>
              <Button type="primary" disabled={labels.length === 0} onClick={() => window.print()}>
                {uiText("admin_ui.print_c6afc")}</Button>
            </Space>
          }
        >
          <Input.Search
            placeholder={uiText("admin_ui.search_name_sku_barcode_f5fc3")}
            allowClear
            onSearch={setSearch}
            style={{ marginBottom: 12, maxWidth: 360 }}
          />

          {unprintable.length > 0 && (
            <Alert closable
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={uiText("admin_ui.selected_products_cannot_be_printed_as_barcodes_9a405", { v0: unprintable.length })}
              description={
                <>
                  {unprintable.map((r) => {
                    const res = checkBarcode(r.barcode ?? "");
                    return (
                      <div key={r.sku}>
                        {r.sku} — {res.kind === "EMPTY" ? uiText("admin_ui.no_barcode_yet_be4ed")
                          : res.kind === "BAD_CHECK_DIGIT" ? uiText("admin_ui.invalid_check_digit_should_end_in_a6647", { v0: res.expected })
                          : res.kind === "NON_STANDARD" ? res.reason
                          : uiText("admin_ui.cannot_be_printed_in_ean_format_f30e3")}
                      </div>
                    );
                  })}
                  <div style={{ marginTop: 6 }}>
                    {uiText("admin_ui.select_generate_store_code_on_the_560d2")} <a href="/admin/products">{uiText("admin_ui.products_page_6a963")}</a>  {uiText("admin_ui.for_these_products_first_d8bf2")}</div>
                </>
              }
            />
          )}

          <Table<Row>
            size="small"
            rowKey="sku"
            dataSource={rows}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            columns={[
              { title: "SKU", dataIndex: "sku", width: 160 },
              { title: uiText("admin_ui.product_name_c9863"), dataIndex: "name" },
              {
                title: uiText("admin_ui.en_barcode_8e54d"),
                dataIndex: "barcode",
                width: 220,
                render: (v: string | null) => {
                  if (!v) return <Tag>{uiText("admin_ui.none_yet_6c944")}</Tag>;
                  return eanBars(v)
                    ? <Typography.Text code>{v}</Typography.Text>
                    : <Space size={4}><Typography.Text code>{v}</Typography.Text><Tag color="orange">{uiText("admin_ui.cannot_print_c972c")}</Tag></Space>;
                },
              },
              {
                title: uiText("admin_ui.label_quantity_7ac00"),
                width: 120,
                render: (_: unknown, row: Row) => (
                  <InputNumber
                    min={0}
                    max={500}
                    value={copies[row.sku] ?? 0}
                    onChange={(v) => setCopies((cur) => ({ ...cur, [row.sku]: Number(v ?? 0) }))}
                    style={{ width: 90 }}
                  />
                ),
              },
            ]}
          />
        </Card>
      </div>

      {/* แผ่นสติกเกอร์ — ซ่อนบนจอ โผล่เฉพาะตอนพิมพ์ */}
      <div className="labels-sheet">
        {labels.length === 0 ? (
          <div className="labels-screen-only"><Empty description={uiText("admin_ui.no_products_selected_afe90")} /></div>
        ) : (
          labels.map((row, i) => (
            <div className="label" key={`${row.sku}-${i}`}>
              <div className="label-name">{row.name}</div>
              {row.barcode && <EanSvg code={row.barcode} />}
              <div className="label-price">฿{Number(row.price).toLocaleString("th-TH")}</div>
            </div>
          ))
        )}
      </div>

      <style jsx global>{`
        /* ฉลากมาตรฐาน 40×30mm — ขนาดที่เครื่องพิมพ์ฉลากไทยใช้กันมากที่สุด
           และวางบนกระดาษสติกเกอร์ A4 ได้ด้วย */
        .labels-sheet {
          display: flex;
          flex-wrap: wrap;
          gap: 2mm;
        }
        .label {
          width: 40mm;
          height: 30mm;
          padding: 1.5mm;
          box-sizing: border-box;
          border: 1px dashed #ddd;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          overflow: hidden;
          background: #fff;
        }
        .label-name {
          font-size: 7pt;
          line-height: 1.2;
          /* ชื่อยาวต้องตัด ไม่ใช่ดันบาร์โค้ดตกขอบฉลาก */
          max-height: 2.4em;
          overflow: hidden;
        }
        .label-price { font-size: 10pt; font-weight: 700; text-align: right; }

        @media screen {
          .labels-sheet { margin-top: 8px; }
        }
        @media print {
          /* ซ่อนทุกอย่างที่ไม่ใช่แผ่นสติกเกอร์ — เมนู หัวข้อ ตาราง ปุ่ม */
          .labels-screen-only { display: none !important; }
          nav, header, aside, .ant-layout-sider, .ant-layout-header { display: none !important; }
          .label { border: none; }
          @page { margin: 4mm; }
        }
      `}</style>
    </Space>
  );
}
