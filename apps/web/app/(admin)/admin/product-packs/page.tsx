'use client';
// หน่วยขาย + บาร์โค้ดต่อไซซ์
// -------------------------------------------------------------
// หลังจาก 7.93 บาร์โค้ดผูกกับ "หน่วยขาย" ไม่ใช่ "สินค้า" — แผง 10 เม็ดกับ
// กล่อง 100 เม็ดคนละเลข คนละราคา ตามที่ร้านค้าปลีกทำกันจริง
//
// หน้านี้คือที่ที่ตั้งค่านั้น และที่สำคัญกว่าคือ "รายการที่ยังตั้งไม่ครบ" —
// ไซซ์ที่ไม่มีบาร์โค้ดของตัวเองจะยิงไม่เจอ ต้องค้นชื่อแล้วกดเลือกไซซ์เอง
// ซึ่งช้าและพลาดง่ายตอนมีคิวหน้าร้าน
import { gql, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import {
  Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select,
  Space, Switch, Table, Tag, Typography, message,
} from "antd";
import { useState } from "react";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

const Q_AUDIT = gql`
  query PacksNeedingBarcodes {
    bmsProductsNeedingBarcodes(limit: 200) { sku name sizes packs sizesWithoutBarcode }
  }
`;
const Q_PACKS = gql`
  query ProductPacks($productSku: String!) {
    bmsProductPacks(productSku: $productSku) {
      sizes
      packs { id productSku size packCode unitName baseQty barcode price isBase active }
    }
  }
`;
const M_UPSERT = gql`
  mutation($input: BmsProductPackInput!) { bmsUpsertProductPack(input: $input) { id } }
`;
const M_DELETE = gql`
  mutation($id: ID!) { bmsDeleteProductPack(id: $id) }
`;

type Pack = {
  id: string; productSku: string; size: string | null; packCode: string;
  unitName: string; baseQty: number; barcode: string | null;
  price: number | null; isBase: boolean; active: boolean;
};

export default function ProductPacksPage() {
  const { can, loading: permsLoading } = useBmsPermissions();
  const canView = can("product.view");
  const canEdit = can("product.edit");

  const [sku, setSku] = useState("");
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<Pack | null>(null);
  const [open, setOpen] = useState(false);

  const audit = useQuery(Q_AUDIT, { fetchPolicy: "cache-and-network", skip: !canView });
  const [loadPacks, packsQuery] = useLazyQuery(Q_PACKS, { fetchPolicy: "network-only" });
  const [upsert, { loading: saving }] = useMutation(M_UPSERT);
  const [remove] = useMutation(M_DELETE);

  if (!permsLoading && !canView) {
    return <Alert type="error" showIcon message="ไม่มีสิทธิ์ดูหน้านี้ (ต้องมี product.view)" />;
  }

  const packs: Pack[] = packsQuery.data?.bmsProductPacks?.packs ?? [];
  const sizes: string[] = packsQuery.data?.bmsProductPacks?.sizes ?? [];
  const auditRows = audit.data?.bmsProductsNeedingBarcodes ?? [];
  const loadedSku = packsQuery.variables?.productSku as string | undefined;

  function openFor(sizeValue: string | null, pack?: Pack) {
    if (!loadedSku) return;
    setEditing(pack ?? null);
    form.setFieldsValue(
      pack ?? {
        size: sizeValue,
        packCode: "BASE",
        unitName: "ชิ้น",
        baseQty: 1,
        barcode: "",
        price: null,
        isBase: true,
        active: true,
      }
    );
    setOpen(true);
  }

  async function save() {
    try {
      const values = await form.validateFields();
      await upsert({
        variables: {
          input: {
            ...values,
            id: editing?.id ?? null,
            productSku: loadedSku,
            barcode: values.barcode?.trim() || null,
            price: values.price ?? null,
          },
        },
      });
      message.success("บันทึกหน่วยขายแล้ว");
      setOpen(false);
      setEditing(null);
      form.resetFields();
      await packsQuery.refetch?.();
      await audit.refetch();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message ?? "บันทึกไม่สำเร็จ");
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <AdminPageHeader title="หน่วยขาย + บาร์โค้ด" />

      <Alert
        type="info"
        showIcon
        message="บาร์โค้ด 1 อัน = หน่วยขาย 1 อย่าง"
        description="แผง 10 เม็ดกับกล่อง 100 เม็ดต้องเป็นคนละบาร์โค้ด และตั้งราคาแยกกันได้ · ไซซ์ที่ไม่มีบาร์โค้ดของตัวเองจะยิงไม่เจอที่หน้าร้าน ต้องค้นชื่อแล้วเลือกไซซ์เอง"
      />

      <Card title="เปิดสินค้าเพื่อตั้งหน่วยขาย">
        <Space.Compact style={{ width: "100%", maxWidth: 520 }}>
          <Input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            onPressEnter={() => sku.trim() && loadPacks({ variables: { productSku: sku.trim() } })}
            placeholder="ใส่ SKU แล้วกด Enter"
          />
          <Button
            type="primary"
            onClick={() => sku.trim() && loadPacks({ variables: { productSku: sku.trim() } })}
          >
            เปิด
          </Button>
        </Space.Compact>

        {loadedSku && (
          <div style={{ marginTop: 16 }}>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              <b>{loadedSku}</b> · ไซซ์ที่มีสต็อก: {sizes.length === 0 ? "—" : sizes.join(" / ")}
            </Typography.Paragraph>

            {sizes.map((sz) => {
              const rows = packs.filter((p) => p.size === sz);
              const noBarcode = rows.every((r) => !r.barcode);
              return (
                <Card
                  key={sz}
                  size="small"
                  style={{ marginBottom: 10 }}
                  title={
                    <Space>
                      <span>ไซซ์ {sz}</span>
                      {noBarcode && <Tag color="red">ยังไม่มีบาร์โค้ด</Tag>}
                    </Space>
                  }
                  extra={canEdit && <Button size="small" onClick={() => openFor(sz)}>เพิ่มหน่วยขาย</Button>}
                >
                  {rows.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีหน่วยขายของไซซ์นี้" />
                  ) : (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={rows}
                      pagination={false}
                      columns={[
                        {
                          title: "หน่วย",
                          render: (_: unknown, p: Pack) => (
                            <Space>
                              <b>{p.unitName}</b>
                              <Tag>{p.packCode}</Tag>
                              {p.isBase && <Tag color="blue">หน่วยฐาน</Tag>}
                              {!p.active && <Tag>ปิด</Tag>}
                            </Space>
                          ),
                        },
                        { title: "= กี่หน่วยฐาน", dataIndex: "baseQty", width: 120 },
                        {
                          title: "บาร์โค้ด",
                          dataIndex: "barcode",
                          width: 190,
                          render: (v: string | null) =>
                            v ? <code>{v}</code> : <Tag color="red">ยังไม่ตั้ง</Tag>,
                        },
                        {
                          title: "ราคา",
                          dataIndex: "price",
                          width: 130,
                          render: (v: number | null) =>
                            v == null ? <span style={{ color: "#999" }}>ตามราคาสินค้า</span> : `฿${v.toLocaleString()}`,
                        },
                        ...(canEdit
                          ? [
                              {
                                title: "",
                                width: 140,
                                render: (_: unknown, p: Pack) => (
                                  <Space>
                                    <Button size="small" onClick={() => openFor(p.size, p)}>แก้ไข</Button>
                                    <Popconfirm
                                      title="ลบหน่วยขายนี้?"
                                      description="บาร์โค้ดของหน่วยนี้จะยิงไม่เจออีก"
                                      okText="ลบ"
                                      cancelText="ยกเลิก"
                                      onConfirm={async () => {
                                        await remove({ variables: { id: p.id } });
                                        await packsQuery.refetch?.();
                                        await audit.refetch();
                                      }}
                                    >
                                      <Button size="small" danger>ลบ</Button>
                                    </Popconfirm>
                                  </Space>
                                ),
                              },
                            ]
                          : []),
                      ]}
                    />
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="สินค้าหลายไซซ์ที่บาร์โค้ดยังไม่ครบ" loading={audit.loading}>
        {auditRows.length === 0 ? (
          <Empty description="ครบทุกไซซ์แล้ว" />
        ) : (
          <Table
            size="small"
            rowKey="sku"
            dataSource={auditRows}
            pagination={{ pageSize: 15, showSizeChanger: false }}
            columns={[
              { title: "SKU", dataIndex: "sku", width: 170 },
              { title: "ชื่อสินค้า", dataIndex: "name" },
              { title: "ไซซ์", dataIndex: "sizes", width: 80 },
              {
                title: "ไซซ์ที่ยังไม่มีบาร์โค้ด",
                dataIndex: "sizesWithoutBarcode",
                render: (v: string[]) => (
                  <Space wrap>
                    {v.map((s) => <Tag color="red" key={s}>{s}</Tag>)}
                  </Space>
                ),
              },
              {
                title: "",
                width: 90,
                render: (_: unknown, r: any) => (
                  <Button
                    size="small"
                    onClick={() => { setSku(r.sku); loadPacks({ variables: { productSku: r.sku } }); }}
                  >
                    เปิด
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? `แก้ไขหน่วยขาย · ${editing.unitName}` : "เพิ่มหน่วยขาย"}
        onCancel={() => { setOpen(false); setEditing(null); }}
        onOk={() => void save()}
        confirmLoading={saving}
        okText="บันทึก"
        cancelText="ยกเลิก"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="size" label="ไซซ์" rules={[{ required: true, message: "ต้องเลือกไซซ์" }]}>
            <Select options={sizes.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item
            name="packCode"
            label="รหัสหน่วยขาย"
            extra="ตัวย่อภายใน เช่น BASE (หน่วยฐาน) · STRIP (แผง) · BOX (กล่อง)"
            rules={[{ required: true, message: "ต้องระบุรหัส" }]}
          >
            <Input placeholder="BOX" />
          </Form.Item>
          <Form.Item name="unitName" label="ชื่อหน่วยที่พิมพ์บนใบเสร็จ" rules={[{ required: true, message: "ต้องระบุชื่อหน่วย" }]}>
            <Input placeholder="กล่อง" />
          </Form.Item>
          <Form.Item
            name="baseQty"
            label="1 หน่วยนี้ = กี่หน่วยฐาน"
            extra="กล่องบรรจุ 10 แผง → ใส่ 10 · ขายกล่องหนึ่งจะตัดสต็อก 10"
            rules={[{ required: true, message: "ต้องระบุจำนวน" }]}
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="barcode"
            label="บาร์โค้ด"
            extra="ต้องไม่ซ้ำกับหน่วยขายอื่นในร้าน · เว้นว่างได้แต่จะยิงไม่เจอ"
          >
            <Input placeholder="8850000000123" />
          </Form.Item>
          <Form.Item
            name="price"
            label="ราคาต่อหน่วยนี้"
            extra="เว้นว่าง = ราคาสินค้า × จำนวนหน่วยฐาน (ไม่มีส่วนลดยกกล่อง)"
          >
            <InputNumber min={0} style={{ width: "100%" }} placeholder="230" />
          </Form.Item>
          <Form.Item
            name="isBase"
            label="เป็นหน่วยฐานของไซซ์นี้"
            valuePropName="checked"
            extra="หน่วยที่สต็อกนับเป็น — มีได้ตัวเดียวต่อไซซ์ และต้องมีจำนวน = 1"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="active" label="เปิดใช้งาน" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
