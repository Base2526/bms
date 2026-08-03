'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  AutoComplete,
  message,
  Alert,
  Typography,
  Tooltip,
  Upload,
  Image,
  Avatar,
  List,
  Popconfirm,
  Card,
} from "antd";
import { useState, useMemo, useCallback, useEffect } from "react";
import {
  PlusOutlined,
  EditOutlined,
  ReloadOutlined,
  WarningOutlined,
  HistoryOutlined,
  UploadOutlined,
  PictureOutlined,
  DeleteOutlined,
  TagsOutlined,
  ImportOutlined,
} from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import debounce from "lodash/debounce";
import ImportModal from "./ImportModal";

// ---- Types --------------------------------------------------
type Variant = {
  size: string;
  current_stock: number;
  reserved_stock: number;
  available: number;
  reorder_point: number;
  low: boolean;
};
type Product = {
  sku: string;
  name: string;
  active: boolean;
  price: number;
  keywords: string[];
  barcode: string | null;
  imageUrl: string | null;
  images: Array<{ id: string | number; url: string }>;
  description: string | null;
  costPrice: number | null;
  weightGrams: number | null;
  category: string | null;
  brand: string | null;
  variants: Variant[];
};
type Movement = {
  id: string;
  size: string;
  type: string;
  qty: number;
  ref_order_id: string | null;
  note: string | null;
  actor: string | null;
  created_at: string;
};

// ---- GraphQL ------------------------------------------------
const Q_PRODUCTS = gql`
  query BmsProducts($search: String, $category: String, $limit: Int, $offset: Int) {
    bmsProducts(search: $search, category: $category, limit: $limit, offset: $offset) {
      total
      items {
        sku
        name
        active
        price
        keywords
        barcode
        imageUrl
        images { id url }
        description
        costPrice
        weightGrams
        category
        brand
        variants {
          size
          current_stock
          reserved_stock
          available
          reorder_point
          low
        }
      }
    }
  }
`;
const Q_CATEGORIES = gql`query { bmsProductCategories { id name } }`;
const Q_LOW = gql`query { bmsLowStock { sku name size available reorder_point } }`;
const Q_MOVEMENTS = gql`
  query ($sku: String!) {
    bmsStockMovements(sku: $sku, limit: 30) {
      id
      size
      type
      qty
      ref_order_id
      note
      actor
      created_at
    }
  }
`;

const M_UPSERT = gql`mutation ($input: BmsProductInput!) { bmsUpsertProduct(input: $input) { sku } }`;
const M_SET_ACTIVE = gql`mutation ($sku: String!, $active: Boolean!) { bmsSetProductActive(sku: $sku, active: $active) }`;
const M_ADJUST = gql`
  mutation ($sku: String!, $size: String!, $delta: Int!) {
    bmsAdjustStock(sku: $sku, size: $size, delta: $delta) { size available }
  }
`;
const M_REORDER = gql`
  mutation ($sku: String!, $size: String!, $rp: Int!) {
    bmsSetReorderPoint(sku: $sku, size: $size, reorderPoint: $rp) { size low }
  }
`;
const M_CREATE_CATEGORY = gql`mutation ($name: String!) { bmsCreateProductCategory(name: $name) { id name } }`;
const M_RENAME_CATEGORY = gql`mutation ($id: ID!, $name: String!) { bmsRenameProductCategory(id: $id, name: $name) { id name } }`;
const M_DELETE_CATEGORY = gql`mutation ($id: ID!) { bmsDeleteProductCategory(id: $id) }`;
const Q_SYNONYMS = gql`
  query {
    bmsAiSynonymCandidates(status: "PENDING", limit: 50) {
      id term occurrences lastSeenAt
    }
  }
`;
const M_REVIEW_SYNONYM = gql`
  mutation ($id: ID!, $decision: String!, $productSku: String) {
    bmsReviewAiSynonymCandidate(id: $id, decision: $decision, productSku: $productSku) {
      id status productSku
    }
  }
`;

const MOVE_COLOR: Record<string, string> = {
  STOCK_IN: "green",
  STOCK_OUT: "volcano",
  RESERVE: "orange",
  RELEASE: "blue",
  FULFILL: "purple",
};

const LOW_STOCK_EXPANDED_KEY = "bms_products_lowstock_expanded";
const MOBILE_QUERY = "(max-width: 767px)";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

function ProductsManagement() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [lowExpanded, setLowExpanded] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(LOW_STOCK_EXPANDED_KEY) === "1";
  });
  const toggleLowExpanded = () => {
    setLowExpanded((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") window.localStorage.setItem(LOW_STOCK_EXPANDED_KEY, next ? "1" : "0");
      return next;
    });
  };

  // ค้นหา + paging ฝั่ง server (สินค้าอาจมีหลักพันแถวจาก fake seeder)
  const [searchInput, setSearchInput] = useState("");   // ค่าในกล่องพิมพ์ (แสดงผลทันที)
  const [search, setSearch] = useState("");             // ค่าที่ debounce แล้ว → ใช้ query จริง
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const debouncedSetSearch = useMemo(() => debounce((v: string) => { setSearch(v); setPage(1); }, 400), []);
  const onSearchChange = (v: string) => { setSearchInput(v); debouncedSetSearch(v); };

  const { can } = useBmsPermissions();
  const { data, loading, error, refetch } = useQuery(Q_PRODUCTS, {
    variables: { search: search || null, category: categoryFilter || null, limit: pageSize, offset: (page - 1) * pageSize },
    fetchPolicy: "cache-and-network",
  });
  const { data: catData, refetch: refetchCategories } = useQuery(Q_CATEGORIES, { fetchPolicy: "cache-and-network" });
  const { data: lowData, refetch: refetchLow } = useQuery(Q_LOW, {
    fetchPolicy: "cache-and-network",
  });

  const onErr = (e: any) => message.error(e?.message || "ทำรายการไม่สำเร็จ");
  const refreshAll = () => {
    refetch();
    refetchLow();
  };

  const [upsertProduct, { loading: saving }] = useMutation(M_UPSERT, {
    onCompleted: () => {
      message.success("บันทึกสินค้าแล้ว");
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      refreshAll();
    },
    onError: onErr,
  });
  const [setActive] = useMutation(M_SET_ACTIVE, {
    onCompleted: () => { message.success("อัปเดตสถานะแล้ว"); refreshAll(); },
    onError: onErr,
  });

  const products: Product[] = data?.bmsProducts?.items || [];
  const total: number = data?.bmsProducts?.total || 0;
  const categories: { id: string; name: string }[] = catData?.bmsProductCategories || [];
  const lowItems: any[] = lowData?.bmsLowStock || [];
  const lowCount: number = lowItems.length;
  const outOfStockItems = lowItems.filter((x) => x.available <= 0);
  const lowStockItems = lowItems.filter((x) => x.available > 0).sort((a, b) => a.available - b.available);

  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  // ยี่ห้อ: พิมพ์อิสระได้ (autocomplete จากค่าที่เคยใช้) — หมวดหมู่ใช้ list กลางที่จัดการแล้ว (bmsProductCategories)
  const brandOptions = useMemo(
    () => Array.from(new Set(products.map((p) => p.brand).filter(Boolean))) as string[],
    [products]
  );

  const openCreate = () => {
    setEditing(null);
    setImageUrls([]);
    form.resetFields();
    form.setFieldsValue({ active: true, keywords: [] });
    setModalOpen(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setImageUrls(
      Array.isArray(p.images) && p.images.length > 0
        ? p.images.map((img) => img.url)
        : p.imageUrl
          ? [p.imageUrl]
          : []
    );
    form.setFieldsValue({
      sku: p.sku, name: p.name, price: p.price,
      keywords: p.keywords, active: p.active, barcode: p.barcode || "",
      description: p.description || "", costPrice: p.costPrice ?? undefined,
      weightGrams: p.weightGrams ?? undefined,
      category: p.category || "", brand: p.brand || "",
    });
    setModalOpen(true);
  };

  const uploadImage = async (file: File) => {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/bms/products/upload", { method: "POST", body: fd, credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "อัปโหลดรูปไม่สำเร็จ");
      setImageUrls((prev) => (prev.includes(j.url) ? prev : [...prev, j.url]));
      message.success("อัปโหลดรูปแล้ว");
    } catch (e: any) {
      message.error(e?.message || "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setUploadingImage(false);
    }
    return false; // กัน antd Upload อัปโหลดซ้ำเอง
  };

  const submit = async () => {
    const v = await form.validateFields();
    await upsertProduct({
      variables: {
        input: {
          sku: v.sku.trim(), name: v.name.trim(), price: Number(v.price),
          keywords: v.keywords || [], active: v.active,
          barcode: v.barcode?.trim() || null,
          image_url: imageUrls[0] || null,
          image_urls: imageUrls,
          description: v.description?.trim() || null,
          cost_price: v.costPrice != null && v.costPrice !== "" ? Number(v.costPrice) : null,
          weight_grams: v.weightGrams != null && v.weightGrams !== "" ? Number(v.weightGrams) : null,
          category: v.category?.trim() || null,
          brand: v.brand?.trim() || null,
        },
      },
    });
  };

  const columns = useMemo(
    () => [
      {
        title: "", key: "image", width: 56,
        render: (_: any, p: Product) =>
          p.imageUrl
            ? (
              <div style={{ position: "relative", width: 40, height: 40 }}>
                <Image src={p.imageUrl} alt={p.name} width={40} height={40} style={{ objectFit: "cover", borderRadius: 6 }} />
                {(p.images?.length || 0) > 1 && (
                  <span style={{
                    position: "absolute",
                    right: -6,
                    bottom: -6,
                    minWidth: 18,
                    height: 18,
                    padding: "0 4px",
                    borderRadius: 999,
                    background: "#1677ff",
                    color: "#fff",
                    fontSize: 10,
                    lineHeight: "18px",
                    textAlign: "center",
                    boxShadow: "0 0 0 2px #fff",
                  }}>
                    +{p.images.length - 1}
                  </span>
                )}
              </div>
            )
            : <Avatar shape="square" size={40} icon={<PictureOutlined />} style={{ opacity: 0.4 }} />,
      },
      { title: "SKU", dataIndex: "sku", key: "sku", width: 120,
        render: (s: string) => <Typography.Text code>{s}</Typography.Text> },
      { title: "Barcode", dataIndex: "barcode", key: "barcode", width: 130,
        render: (b: string | null) => b || <span style={{ color: "#999" }}>—</span> },
      {
        title: "Name", dataIndex: "name", key: "name",
        render: (name: string, p: Product) => (
          <Space direction="vertical" size={0}>
            <span>{name}</span>
            {(p.category || p.brand) && (
              <Space size={4}>
                {p.brand && <Tag color="blue" style={{ marginInlineEnd: 0 }}>{p.brand}</Tag>}
                {p.category && <Tag style={{ marginInlineEnd: 0 }}>{p.category}</Tag>}
              </Space>
            )}
          </Space>
        ),
      },
      {
        title: "Price", dataIndex: "price", key: "price", width: 110, align: "right" as const,
        render: (v: number, p: Product) => (
          <Space direction="vertical" size={0} align="end">
            <span>{Number(v).toLocaleString()} ฿</span>
            {p.costPrice != null && (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                กำไร {(Number(v) - p.costPrice).toLocaleString()} ฿
              </Typography.Text>
            )}
          </Space>
        ),
      },
      {
        title: "Stock", key: "stock", width: 170,
        render: (_: any, p: Product) => {
          const avail = p.variants.reduce((n, v) => n + v.available, 0);
          const lows = p.variants.filter((v) => v.low).length;
          return (
            <Space size={4}>
              <Tag color={avail > 0 ? "green" : "default"}>{avail} ชิ้น</Tag>
              {lows > 0 && (
                <Tag icon={<WarningOutlined />} color="warning">ใกล้หมด {lows}</Tag>
              )}
            </Space>
          );
        },
      },
      {
        title: "Active", dataIndex: "active", key: "active", width: 80,
        render: (active: boolean, p: Product) => (
          <Switch size="small" checked={active} disabled={!can("product.delete")}
            onChange={(c) => setActive({ variables: { sku: p.sku, active: c } })} />
        ),
      },
      {
        title: "", key: "actions", width: 80,
        render: (_: any, p: Product) =>
          can("product.edit")
            ? <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(p)}>Edit</Button>
            : <span style={{ color: "#ccc" }}>—</span>,
      },
    ],
    [can]
  );

  if (error) {
    return <Alert type="error" message="โหลดสินค้าไม่ได้" description={error.message} showIcon />;
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Products & Inventory</h2>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refreshAll} loading={loading}>Refresh</Button>
            {can("product.edit") && <Button icon={<ImportOutlined />} onClick={() => setImportModalOpen(true)}>นำเข้า</Button>}
            {can("product.edit") && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>เพิ่มสินค้า</Button>}
          </Space>
        </Space>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 6 }}>
          กดกางแต่ละแถวเพื่อดู stock ต่อไซซ์ ปรับสต็อกเร็ว และเช็กประวัติการเคลื่อนไหว
        </Typography.Text>
      </div>

      <SynonymReviewCard canEdit={can("product.edit")} />

      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search
            allowClear placeholder="ค้นหาชื่อ / SKU / barcode" style={{ width: 280 }}
            value={searchInput} onChange={(e) => onSearchChange(e.target.value)}
          />
          <Select
            allowClear placeholder="ทุกหมวดหมู่" style={{ width: 180 }}
            value={categoryFilter} onChange={(v) => { setCategoryFilter(v); setPage(1); }}
            options={categories.map((c) => ({ value: c.name, label: c.name }))}
          />
          {can("product.edit") && (
            <Button icon={<TagsOutlined />} onClick={() => setCategoryModalOpen(true)}>จัดการหมวดหมู่</Button>
          )}
        </Space>
      </div>

      {lowCount > 0 && (
        <div style={{ marginBottom: 16, border: "1px solid #ffe58f", background: "#fffbe6", borderRadius: 8, overflow: "hidden" }}>
          <button
            type="button"
            onClick={toggleLowExpanded}
            aria-expanded={lowExpanded}
            style={{
              width: "100%", display: "flex", flexDirection: isMobile ? "column" : "row",
              alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between",
              gap: 8, padding: isMobile ? "10px 12px" : "12px 14px", border: 0, background: "transparent",
              cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit",
            }}
          >
            <Space wrap size={8} style={{ minWidth: 0 }}>
              <span style={{ display: "inline-block", transition: "transform .15s ease", transform: lowExpanded ? "rotate(90deg)" : "none" }}>▸</span>
              <WarningOutlined style={{ color: "#ad6800" }} />
              <Typography.Text strong style={{ color: "#ad6800", fontSize: isMobile ? 13 : 14 }}>
                มีสินค้าใกล้หมด/หมด {lowCount} รายการ
              </Typography.Text>
              {outOfStockItems.length > 0 && <Tag color="error" style={{ marginInlineEnd: 0 }}>หมด {outOfStockItems.length}</Tag>}
              {lowStockItems.length > 0 && <Tag color="warning" style={{ marginInlineEnd: 0 }}>ใกล้หมด {lowStockItems.length}</Tag>}
            </Space>
            {!isMobile && (
              <Typography.Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                คลิกเพื่อ{lowExpanded ? "ย่อ" : "ขยาย"}
              </Typography.Text>
            )}
          </button>

          {lowExpanded && (
            <div style={{ padding: `0 ${isMobile ? 12 : 14}px ${isMobile ? 12 : 14}px`, display: "grid", gap: 10 }}>
              {outOfStockItems.length > 0 && (
                <div style={{ border: "1px solid #ffa39e", background: "#fff1f0", borderRadius: 8, padding: isMobile ? "8px 10px" : "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                    <Typography.Text strong style={{ color: "#cf1322", fontSize: isMobile ? 12 : 12.5 }}>⛔ หมดสต็อก</Typography.Text>
                    <Typography.Text style={{ color: "#cf1322", fontSize: 11 }}>{outOfStockItems.length} รายการ</Typography.Text>
                  </div>
                  <Space wrap size={6}>
                    {outOfStockItems.map((x: any) => (
                      <Tag
                        color="error" key={`${x.sku}-${x.size}`} style={{ marginInlineEnd: 0, cursor: "pointer" }}
                        onClick={() => onSearchChange(x.sku)}
                      >
                        {x.name} {x.size}: เหลือ {x.available} (จุดเตือน {x.reorder_point})
                      </Tag>
                    ))}
                  </Space>
                </div>
              )}
              {lowStockItems.length > 0 && (
                <div style={{ border: "1px solid #ffe58f", background: "#fffbe6", borderRadius: 8, padding: isMobile ? "8px 10px" : "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                    <Typography.Text strong style={{ color: "#ad6800", fontSize: isMobile ? 12 : 12.5 }}>⚠️ ใกล้หมด</Typography.Text>
                    <Typography.Text style={{ color: "#ad6800", fontSize: 11 }}>{lowStockItems.length} รายการ</Typography.Text>
                  </div>
                  <Space wrap size={6}>
                    {lowStockItems.map((x: any) => (
                      <Tag
                        color="warning" key={`${x.sku}-${x.size}`} style={{ marginInlineEnd: 0, cursor: "pointer" }}
                        onClick={() => onSearchChange(x.sku)}
                      >
                        {x.name} {x.size}: เหลือ {x.available} (จุดเตือน {x.reorder_point})
                      </Tag>
                    ))}
                  </Space>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Table
        rowKey="sku"
        loading={loading}
        dataSource={products}
        columns={columns}
        scroll={{ x: "max-content" }}
        expandable={{
          expandedRowRender: (p: Product) => (
            <ProductDetail
              product={p}
              onChanged={refreshAll}
              canAdjust={can("stock.adjust")}
              canEdit={can("product.edit")}
              canToggleActive={can("product.delete")}
              onEdit={() => openEdit(p)}
              onToggleActive={(active) => setActive({ variables: { sku: p.sku, active } })}
            />
          ),
        }}
        pagination={{
          current: page, pageSize, total,
          showSizeChanger: true, showTotal: (t) => `ทั้งหมด ${t} รายการ`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      <Modal
        title={editing ? `แก้ไขสินค้า: ${editing.sku}` : "เพิ่มสินค้า"}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); setImageUrls([]); form.resetFields(); }}
        onOk={submit} confirmLoading={saving}
        okText={editing ? "บันทึก" : "สร้าง"} width={560}
      >
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item label="รูปสินค้า" extra="รูปแรกจะถูกใช้เป็นรูปหลักของสินค้า">
            <Space align="start" wrap>
              {imageUrls.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 320 }}>
                  {imageUrls.map((url, index) => (
                    <div key={`${url}-${index}`} style={{ position: "relative" }}>
                      <Image
                        src={url}
                        alt={`preview-${index + 1}`}
                        width={72}
                        height={72}
                        style={{ objectFit: "cover", borderRadius: 8 }}
                      />
                      {index === 0 && (
                        <Tag color="blue" style={{ position: "absolute", left: 4, top: 4, margin: 0 }}>
                          Cover
                        </Tag>
                      )}
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => setImageUrls((prev) => prev.filter((_, imageIndex) => imageIndex !== index))}
                        style={{
                          position: "absolute",
                          right: 2,
                          top: 2,
                          background: "rgba(255,255,255,0.92)",
                          borderRadius: 999,
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <Avatar shape="square" size={72} icon={<PictureOutlined />} style={{ opacity: 0.4 }} />
              )}
              <Upload accept="image/*" multiple showUploadList={false} beforeUpload={uploadImage}>
                <Button icon={<UploadOutlined />} loading={uploadingImage}>
                  {imageUrls.length > 0 ? "เพิ่มรูป" : "อัปโหลดรูป"}
                </Button>
              </Upload>
              {imageUrls.length > 0 && (
                <Button type="text" danger onClick={() => setImageUrls([])}>
                  ลบรูปทั้งหมด
                </Button>
              )}
            </Space>
          </Form.Item>

          <Form.Item label="SKU" name="sku" rules={[{ required: true, message: "ระบุ SKU" }]}>
            <Input placeholder="เช่น NIKE-AIR" disabled={!!editing} />
          </Form.Item>
          <Form.Item label="Barcode" name="barcode">
            <Input placeholder="เช่น 8850001234567 (ไม่บังคับ)" />
          </Form.Item>
          <Form.Item label="ชื่อสินค้า" name="name" rules={[{ required: true, message: "ระบุชื่อ" }]}>
            <Input placeholder="เช่น Nike Air" />
          </Form.Item>
          <Form.Item label="รายละเอียดสินค้า" name="description">
            <Input.TextArea rows={3} placeholder="เช่น รองเท้าวิ่ง Nike Air รุ่นล่าสุด เบา ระบายอากาศดี" />
          </Form.Item>

          <Space.Compact block>
            <Form.Item label="ราคาขาย (บาท)" name="price" rules={[{ required: true, message: "ระบุราคา" }]} style={{ flex: 1, marginInlineEnd: 8 }}>
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="ต้นทุน (บาท, ไม่บังคับ)" name="costPrice" style={{ flex: 1, marginInlineEnd: 8 }}>
              <InputNumber min={0} style={{ width: "100%" }} placeholder="ใช้คำนวณกำไร" />
            </Form.Item>
            <Form.Item
              label="น้ำหนัก (กรัม, ไม่บังคับ)"
              name="weightGrams"
              style={{ flex: 1 }}
              tooltip="ใช้คิดค่าส่งตามน้ำหนัก · ถ้าไม่กรอก ระบบจะไม่คิดค่าน้ำหนักส่วนเพิ่มให้สินค้านี้"
            >
              <InputNumber min={0} style={{ width: "100%" }} placeholder="เช่น 500" />
            </Form.Item>
          </Space.Compact>

          <Space.Compact block>
            <Form.Item
              label={<span>หมวดหมู่ <a onClick={() => setCategoryModalOpen(true)} style={{ fontSize: 12 }}>(จัดการ)</a></span>}
              name="category" style={{ flex: 1, marginInlineEnd: 8 }}
            >
              <Select
                allowClear showSearch placeholder="เลือกหมวดหมู่"
                options={categories.map((c) => ({ value: c.name, label: c.name }))}
                notFoundContent="ยังไม่มีหมวดหมู่ — กด (จัดการ) เพื่อเพิ่ม"
              />
            </Form.Item>
            <Form.Item label="ยี่ห้อ" name="brand" style={{ flex: 1 }}>
              <AutoComplete options={brandOptions.map((b) => ({ value: b }))} placeholder="เช่น Nike" filterOption />
            </Form.Item>
          </Space.Compact>

          <Form.Item label="Keywords (คำที่ลูกค้าพิมพ์แล้ว match สินค้านี้)" name="keywords">
            <Select mode="tags" tokenSeparators={[",", " "]} placeholder="nike, ไนกี้, air" />
          </Form.Item>
          <Form.Item label="เปิดขาย" name="active" valuePropName="checked">
            <Switch checkedChildren="ขายอยู่" unCheckedChildren="ปิด" />
          </Form.Item>
        </Form>
      </Modal>

      <CategoryManagerModal
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        categories={categories}
        onChanged={refetchCategories}
      />

      <ImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={refreshAll}
      />
    </div>
  );
}

function SynonymReviewCard({ canEdit }: { canEdit: boolean }) {
  const [skuById, setSkuById] = useState<Record<string, string>>({});
  const { data, loading, refetch } = useQuery(Q_SYNONYMS, { fetchPolicy: "cache-and-network" });
  const [review, { loading: reviewing }] = useMutation(M_REVIEW_SYNONYM, {
    onCompleted: () => {
      message.success("ตรวจคำค้นแล้ว");
      refetch();
    },
    onError: (error) => message.error(error.message),
  });
  const candidates = data?.bmsAiSynonymCandidates || [];
  if (!loading && candidates.length === 0) return null;

  return (
    <Card
      size="small"
      loading={loading}
      title="AI synonym discovery"
      extra={<Tag color="gold">{candidates.length} คำรอตรวจ</Tag>}
      style={{ marginBottom: 16 }}
    >
      <Typography.Paragraph type="secondary">
        คำที่ลูกค้าใช้ค้นหาแล้วไม่พบสินค้า ต้องให้ staff ผูกกับ SKU ก่อน ระบบจึงเพิ่มลง keywords ของสินค้านั้น
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={candidates}
        columns={[
          { title: "คำที่ลูกค้าใช้", dataIndex: "term" },
          { title: "พบ", dataIndex: "occurrences", width: 70, render: (value: number) => `${value} ครั้ง` },
          {
            title: "ผูกกับ SKU",
            key: "sku",
            render: (_value: unknown, row: any) => (
              <Input
                size="small"
                value={skuById[row.id] || ""}
                disabled={!canEdit}
                placeholder="เช่น SKU-001"
                onChange={(event) => setSkuById((current) => ({ ...current, [row.id]: event.target.value }))}
              />
            ),
          },
          {
            title: "ตรวจ",
            key: "actions",
            width: 180,
            render: (_value: unknown, row: any) => (
              <Space>
                <Button
                  size="small"
                  type="primary"
                  disabled={!canEdit || !skuById[row.id]?.trim()}
                  loading={reviewing}
                  onClick={() => review({
                    variables: { id: row.id, decision: "APPROVED", productSku: skuById[row.id].trim() },
                  })}
                >
                  อนุมัติ
                </Button>
                <Button
                  size="small"
                  danger
                  disabled={!canEdit}
                  loading={reviewing}
                  onClick={() => review({ variables: { id: row.id, decision: "REJECTED", productSku: null } })}
                >
                  ปฏิเสธ
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}

// ---- Modal: จัดการรายการหมวดหมู่ (เพิ่ม/แก้ชื่อ/ลบ) ------------
function CategoryManagerModal({
  open, onClose, categories, onChanged,
}: { open: boolean; onClose: () => void; categories: { id: string; name: string }[]; onChanged: () => void }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const onErr = (e: any) => message.error(e?.message || "ทำรายการไม่สำเร็จ");

  const [createCategory, { loading: creating }] = useMutation(M_CREATE_CATEGORY, {
    onCompleted: () => { setNewName(""); onChanged(); },
    onError: onErr,
  });
  const [renameCategoryMut, { loading: renaming }] = useMutation(M_RENAME_CATEGORY, {
    onCompleted: () => { setEditingId(null); onChanged(); },
    onError: onErr,
  });
  const [deleteCategoryMut] = useMutation(M_DELETE_CATEGORY, {
    onCompleted: () => { message.success("ลบหมวดหมู่แล้ว"); onChanged(); },
    onError: onErr,
  });

  return (
    <Modal title="จัดการหมวดหมู่สินค้า" open={open} onCancel={onClose} footer={null} width={420}>
      <Space.Compact block style={{ marginBottom: 16 }}>
        <Input
          placeholder="ชื่อหมวดหมู่ใหม่ เช่น รองเท้า" value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={() => newName.trim() && createCategory({ variables: { name: newName.trim() } })}
        />
        <Button type="primary" icon={<PlusOutlined />} loading={creating} disabled={!newName.trim()}
          onClick={() => createCategory({ variables: { name: newName.trim() } })}>เพิ่ม</Button>
      </Space.Compact>

      <List
        size="small"
        dataSource={categories}
        locale={{ emptyText: "ยังไม่มีหมวดหมู่" }}
        renderItem={(c) => (
          <List.Item
            actions={
              editingId === c.id
                ? [
                    <Button key="save" size="small" type="link" loading={renaming} disabled={!editingName.trim()}
                      onClick={() => renameCategoryMut({ variables: { id: c.id, name: editingName.trim() } })}>บันทึก</Button>,
                    <Button key="cancel" size="small" type="link" onClick={() => setEditingId(null)}>ยกเลิก</Button>,
                  ]
                : [
                    <Button key="edit" size="small" type="link" icon={<EditOutlined />}
                      onClick={() => { setEditingId(c.id); setEditingName(c.name); }} />,
                    <Popconfirm key="del" title={`ลบหมวดหมู่ "${c.name}"?`} okText="ลบ" okButtonProps={{ danger: true }}
                      onConfirm={() => deleteCategoryMut({ variables: { id: c.id } })}
                    >
                      <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]
            }
          >
            {editingId === c.id
              ? <Input size="small" value={editingName} onChange={(e) => setEditingName(e.target.value)}
                  onPressEnter={() => renameCategoryMut({ variables: { id: c.id, name: editingName.trim() } })} />
              : c.name}
          </List.Item>
        )}
      />
    </Modal>
  );
}

// ---- Expanded row: inventory editor + movement history ------
function ProductDetail({
  product,
  onChanged,
  canAdjust,
  canEdit,
  canToggleActive,
  onEdit,
  onToggleActive,
}: {
  product: Product;
  onChanged: () => void;
  canAdjust: boolean;
  canEdit: boolean;
  canToggleActive: boolean;
  onEdit: () => void;
  onToggleActive: (next: boolean) => void;
}) {
  const onErr = (e: any) => message.error(e?.message || "ทำรายการไม่สำเร็จ");
  const [adjustStockMut, { loading: adjustingStock }] = useMutation(M_ADJUST, { onError: onErr });
  const [setReorder] = useMutation(M_REORDER, {
    onCompleted: () => { message.success("ตั้งจุดแจ้งเตือนแล้ว"); onChanged(); },
    onError: onErr,
  });
  const { data: movesData, refetch: refetchMoves } = useQuery(Q_MOVEMENTS, {
    variables: { sku: product.sku },
    fetchPolicy: "cache-and-network",
  });

  const [newSize, setNewSize] = useState<string | undefined>();
  const [newQty, setNewQty] = useState<number>(1);
  const [manualVariant, setManualVariant] = useState<Variant | null>(null);
  const [manualDelta, setManualDelta] = useState<number>(1);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [bulkDraft, setBulkDraft] = useState<Record<string, number>>({});

  const totalAvailable = useMemo(
    () => product.variants.reduce((sum, variant) => sum + variant.available, 0),
    [product.variants]
  );
  const totalReserved = useMemo(
    () => product.variants.reduce((sum, variant) => sum + variant.reserved_stock, 0),
    [product.variants]
  );
  const lowCount = useMemo(
    () => product.variants.filter((variant) => variant.low).length,
    [product.variants]
  );
  const moves: Movement[] = movesData?.bmsStockMovements || [];
  const visibleMoves = historyExpanded ? moves : moves.slice(0, 4);

  const runAdjust = useCallback(async (size: string, delta: number, successText = "ปรับสต็อกแล้ว") => {
    if (!delta) return;
    await adjustStockMut({ variables: { sku: product.sku, size, delta } });
    message.success(successText);
    onChanged();
    refetchMoves();
  }, [adjustStockMut, onChanged, product.sku, refetchMoves]);

  const openBulkAdjust = () => {
    setBulkDraft(
      Object.fromEntries(product.variants.map((variant) => [variant.size, 0]))
    );
    setBulkOpen(true);
  };

  const variantCols = [
    {
      title: "Size",
      dataIndex: "size",
      key: "size",
      width: 100,
      render: (size: string) => (
        <Typography.Text strong style={{ fontSize: 16 }}>
          {size}
        </Typography.Text>
      ),
    },
    {
      title: "พร้อมขาย",
      dataIndex: "available",
      key: "avail",
      width: 170,
      align: "right" as const,
      render: (v: number, r: Variant) => (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span
            style={{
              fontSize: 22,
              lineHeight: 1,
              fontWeight: 700,
              color: r.low ? "#d46b08" : v > 0 ? "#389e0d" : "#999",
            }}
          >
            {v}
          </span>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            คงคลังจริง {r.current_stock}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "จอง",
      dataIndex: "reserved_stock",
      key: "res",
      width: 120,
      align: "right" as const,
      render: (v: number) => (
        <Typography.Text style={{ color: v > 0 ? "#ad6800" : "#8c8c8c", fontWeight: 500 }}>
          {v}
        </Typography.Text>
      ),
    },
    {
      title: "จุดเตือน", key: "reorder", width: 130,
      render: (_: any, r: Variant) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <InputNumber
            size="small"
            min={0}
            defaultValue={r.reorder_point}
            style={{ width: 72 }}
            disabled={!canAdjust}
            onBlur={(e) => {
              const rp = Number((e.target as HTMLInputElement).value);
              if (rp !== r.reorder_point) {
                setReorder({ variables: { sku: product.sku, size: r.size, rp } });
              }
            }}
          />
          {r.low && <Tag color="warning" icon={<WarningOutlined />} style={{ width: "fit-content", margin: 0 }}>ใกล้หมด</Tag>}
        </div>
      ),
    },
    {
      title: "ปรับสต็อกเร็ว", key: "adjust", width: 320,
      render: (_: any, v: Variant) => canAdjust ? (
        <Space wrap size={8}>
          {[-1, 1, 5, 10].map((delta) => (
            <Button
              key={`${v.size}-${delta}`}
              size="small"
              style={{ minWidth: 52 }}
              loading={adjustingStock}
              onClick={() => runAdjust(v.size, delta)}
            >
              {delta > 0 ? `+${delta}` : `${delta}`}
            </Button>
          ))}
          <Button
            size="small"
            onClick={() => {
              setManualVariant(v);
              setManualDelta(1);
            }}
          >
            ระบุเอง
          </Button>
        </Space>
      ) : <span style={{ color: "#ccc" }}>ไม่มีสิทธิ์</span>,
    },
  ];

  const moveCols = [
    { title: "เวลา", dataIndex: "created_at", key: "t", width: 165,
      render: (d: string) => new Date(d).toLocaleString() },
    { title: "ประเภท", dataIndex: "type", key: "type", width: 110,
      render: (t: string) => <Tag color={MOVE_COLOR[t] || "default"}>{t}</Tag> },
    { title: "Size", dataIndex: "size", key: "size", width: 60 },
    { title: "Qty", dataIndex: "qty", key: "qty", width: 60, align: "right" as const },
    { title: "Order", dataIndex: "ref_order_id", key: "ref", width: 100,
      render: (o: string | null) => o ? <Typography.Text code>{o.slice(0, 8)}</Typography.Text> : "—" },
    { title: "โดย", dataIndex: "actor", key: "actor", render: (a: string | null) => a || "—" },
  ];

  const SIZE_OPTS = ["S", "M", "L", "XL", "XXL"].filter((s) => !product.variants.some((v) => v.size === s));

  return (
    <div style={{ display: "grid", gap: 16, padding: 8 }}>
      <div
        style={{
          border: "1px solid #f0f0f0",
          borderRadius: 16,
          padding: 16,
          background: "#fff",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 16,
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 16, minWidth: 280, flex: 1 }}>
            {product.imageUrl
              ? <Image src={product.imageUrl} alt={product.name} width={84} height={84} style={{ objectFit: "cover", borderRadius: 12 }} />
              : <Avatar shape="square" size={84} icon={<PictureOutlined />} style={{ opacity: 0.4 }} />}
            <div style={{ minWidth: 220, display: "grid", gap: 8 }}>
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {product.name}
                </Typography.Title>
                <Typography.Text type="secondary">รหัสสินค้า: {product.sku}</Typography.Text>
              </div>
              <Space wrap size={6}>
                {product.brand && <Tag color="blue" style={{ margin: 0 }}>{product.brand}</Tag>}
                {product.category && <Tag style={{ margin: 0 }}>{product.category}</Tag>}
                {lowCount > 0 && <Tag color="warning" icon={<WarningOutlined />} style={{ margin: 0 }}>ใกล้หมด {lowCount} ไซซ์</Tag>}
              </Space>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "stretch", justifyContent: "flex-end", flex: 1 }}>
            <div style={{ minWidth: 128, padding: "10px 14px", border: "1px solid #f0f0f0", borderRadius: 12, background: "#fafafa" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>ราคา</Typography.Text>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>{Number(product.price).toLocaleString()} ฿</div>
              {product.costPrice != null && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  ต้นทุน {Number(product.costPrice).toLocaleString()} ฿
                </Typography.Text>
              )}
            </div>

            <div style={{ minWidth: 128, padding: "10px 14px", border: "1px solid #d9f7be", borderRadius: 12, background: "#f6ffed" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>สต็อกรวม</Typography.Text>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: totalAvailable > 0 ? "#389e0d" : "#8c8c8c" }}>
                {totalAvailable}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                จองอยู่ {totalReserved}
              </Typography.Text>
            </div>

            <div style={{ minWidth: 128, padding: "10px 14px", border: "1px solid #f0f0f0", borderRadius: 12, background: "#fff" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>สถานะ</Typography.Text>
              <Space direction="vertical" size={8}>
                <Switch checked={product.active} disabled={!canToggleActive} onChange={onToggleActive} />
                <Typography.Text style={{ fontSize: 12 }}>{product.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</Typography.Text>
              </Space>
            </div>

            <div style={{ display: "flex", alignItems: "center" }}>
              <Button icon={<EditOutlined />} type="primary" ghost disabled={!canEdit} onClick={onEdit}>
                แก้ไขสินค้า
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #f0f0f0",
          borderRadius: 16,
          background: "#fff",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: 16,
            borderBottom: "1px solid #f5f5f5",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <Typography.Text strong style={{ fontSize: 18 }}>สต็อกสินค้า (แยกตามไซซ์)</Typography.Text>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                เน้นดูพร้อมขายก่อน แล้วค่อยปรับสต็อกเร็วจากแถวเดียว
              </Typography.Text>
            </div>
          </div>

          <Space wrap size={8} style={{ display: canAdjust ? "inline-flex" : "none" }}>
            <Select
              placeholder="size"
              style={{ width: 96 }}
              value={newSize}
              onChange={setNewSize}
              options={SIZE_OPTS.map((s) => ({ value: s, label: s }))}
            />
            <InputNumber min={1} value={newQty} onChange={(v) => setNewQty(Number(v) || 1)} />
            <Button
              icon={<PlusOutlined />}
              disabled={!newSize}
              onClick={async () => {
                if (!newSize) return;
                await runAdjust(newSize, newQty, "เพิ่มไซซ์ใหม่แล้ว");
                setNewSize(undefined);
                setNewQty(1);
              }}
            >
              เพิ่มไซซ์ใหม่
            </Button>
            <Button type="primary" ghost onClick={openBulkAdjust}>
              ปรับสต็อกหลายรายการ
            </Button>
          </Space>
        </div>

        <Table
          rowKey="size"
          dataSource={product.variants}
          columns={variantCols}
          pagination={false}
          size="middle"
          scroll={{ x: "max-content" }}
        />
      </div>

      <div
        style={{
          border: "1px solid #f0f0f0",
          borderRadius: 16,
          background: "#fff",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: 16,
            borderBottom: "1px solid #f5f5f5",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <Typography.Text strong style={{ fontSize: 18 }}>
            <HistoryOutlined /> ประวัติการเคลื่อนไหว
          </Typography.Text>
          {moves.length > 4 && (
            <Button type="link" onClick={() => setHistoryExpanded((prev) => !prev)}>
              {historyExpanded ? "ย่อรายการ" : "ดูทั้งหมด"}
            </Button>
          )}
        </div>

        <Table
          rowKey="id"
          dataSource={visibleMoves}
          columns={moveCols}
          size="small"
          scroll={{ x: "max-content" }}
          pagination={false}
          locale={{ emptyText: "ยังไม่มีประวัติ" }}
        />
      </div>

      <Modal
        title={manualVariant ? `ระบุจำนวนเอง · ไซซ์ ${manualVariant.size}` : "ระบุจำนวนเอง"}
        open={!!manualVariant}
        onCancel={() => setManualVariant(null)}
        onOk={async () => {
          if (!manualVariant || !manualDelta) return;
          await runAdjust(manualVariant.size, manualDelta);
          setManualVariant(null);
          setManualDelta(1);
        }}
        okText="ยืนยัน"
        cancelText="ยกเลิก"
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            ใส่จำนวนบวกเพื่อเพิ่มสต็อก หรือจำนวนลบเพื่อลดสต็อก
          </Typography.Text>
          <InputNumber
            value={manualDelta}
            onChange={(value) => setManualDelta(Number(value) || 0)}
            style={{ width: "100%" }}
            step={1}
          />
        </Space>
      </Modal>

      <Modal
        title="ปรับสต็อกหลายรายการ"
        open={bulkOpen}
        onCancel={() => setBulkOpen(false)}
        confirmLoading={bulkApplying}
        okText="ยืนยันการปรับ"
        cancelText="ยกเลิก"
        onOk={async () => {
          const entries = Object.entries(bulkDraft).filter(([, delta]) => Number(delta) !== 0);
          if (!entries.length) {
            message.info("ยังไม่มีรายการที่ต้องปรับ");
            return;
          }
          setBulkApplying(true);
          try {
            for (const [size, delta] of entries) {
              await adjustStockMut({ variables: { sku: product.sku, size, delta: Number(delta) } });
            }
            message.success(`ปรับสต็อก ${entries.length} ไซซ์แล้ว`);
            setBulkOpen(false);
            onChanged();
            refetchMoves();
          } catch (error: any) {
            onErr(error);
          } finally {
            setBulkApplying(false);
          }
        }}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            ใส่จำนวนที่ต้องการเพิ่ม/ลดต่อไซซ์ โดย 0 หมายถึงไม่เปลี่ยน
          </Typography.Text>
          {product.variants.map((variant) => (
            <div
              key={variant.size}
              style={{
                display: "grid",
                gridTemplateColumns: "72px 1fr 140px",
                gap: 12,
                alignItems: "center",
              }}
            >
              <Typography.Text strong>{variant.size}</Typography.Text>
              <Typography.Text type="secondary">
                พร้อมขาย {variant.available} · จอง {variant.reserved_stock}
              </Typography.Text>
              <InputNumber
                value={bulkDraft[variant.size] ?? 0}
                onChange={(value) => setBulkDraft((prev) => ({ ...prev, [variant.size]: Number(value) || 0 }))}
                style={{ width: "100%" }}
              />
            </div>
          ))}
        </Space>
      </Modal>
    </div>
  );
}

export default function Page() {
  return <ProductsManagement />;
}
