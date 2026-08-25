'use client';
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
      aria-label={`บาร์โค้ด ${code}`}
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
    return <Alert closable type="error" showIcon message="ไม่มีสิทธิ์ดูสินค้า" />;
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div className="labels-screen-only">
        <AdminPageHeader title="พิมพ์สติกเกอร์บาร์โค้ด" />

        <Alert closable
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="พิมพ์เฉพาะสินค้าที่ไม่มีบาร์โค้ดจากโรงงาน"
          description="ของที่ผู้ผลิตติดบาร์โค้ดมาแล้วไม่ต้องแปะทับ — เลขบนตัวสินค้าใช้ได้อยู่แล้ว การแปะทับทำให้ยิงได้เลขที่ไม่ตรงกับที่ซัพพลายเออร์และคู่ค้าใช้"
        />

        <Card
          title="เลือกสินค้าและจำนวนดวง"
          loading={loading && rows.length === 0}
          extra={
            <Space>
              <Typography.Text type="secondary">{labels.length} ดวง</Typography.Text>
              <Button type="primary" disabled={labels.length === 0} onClick={() => window.print()}>
                พิมพ์
              </Button>
            </Space>
          }
        >
          <Input.Search
            placeholder="ค้นหาชื่อ / SKU / barcode"
            allowClear
            onSearch={setSearch}
            style={{ marginBottom: 12, maxWidth: 360 }}
          />

          {unprintable.length > 0 && (
            <Alert closable
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`${unprintable.length} รายการที่เลือกไว้พิมพ์เป็นบาร์โค้ดไม่ได้`}
              description={
                <>
                  {unprintable.map((r) => {
                    const res = checkBarcode(r.barcode ?? "");
                    return (
                      <div key={r.sku}>
                        {r.sku} — {res.kind === "EMPTY" ? "ยังไม่มีบาร์โค้ด"
                          : res.kind === "BAD_CHECK_DIGIT" ? `หลักตรวจสอบผิด (ควรลงท้าย ${res.expected})`
                          : res.kind === "NON_STANDARD" ? res.reason
                          : "รูปแบบที่พิมพ์เป็น EAN ไม่ได้"}
                      </div>
                    );
                  })}
                  <div style={{ marginTop: 6 }}>
                    กด &quot;สร้างเลขของร้าน&quot; ที่ <a href="/admin/products">หน้าสินค้า</a> ให้สินค้าเหล่านี้ก่อน
                  </div>
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
              { title: "ชื่อสินค้า", dataIndex: "name" },
              {
                title: "Barcode",
                dataIndex: "barcode",
                width: 220,
                render: (v: string | null) => {
                  if (!v) return <Tag>ยังไม่มี</Tag>;
                  return eanBars(v)
                    ? <Typography.Text code>{v}</Typography.Text>
                    : <Space size={4}><Typography.Text code>{v}</Typography.Text><Tag color="orange">พิมพ์ไม่ได้</Tag></Space>;
                },
              },
              {
                title: "จำนวนดวง",
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
          <div className="labels-screen-only"><Empty description="ยังไม่ได้เลือกสินค้า" /></div>
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
