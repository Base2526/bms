'use client';
import { gql, useLazyQuery, useQuery, useMutation } from "@apollo/client";
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
import { useI18n } from "@/lib/i18nContext";
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
  const { t } = useI18n();
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
  const { data: catData, refetch: refetchCategories } = useQuery(Q_CATEGORIES, { fetchPolicy: "cache-first" });
  const { data: lowData, refetch: refetchLow } = useQuery(Q_LOW, {
    fetchPolicy: "cache-and-network",
  });

  const onErr = (e: any) => message.error(e?.message || t("admin_products.action_failed"));
  const refreshAll = () => {
    refetch();
    refetchLow();
  };

  const [upsertProduct, { loading: saving }] = useMutation(M_UPSERT, {
    onCompleted: () => {
      message.success(t("admin_products.product_saved"));
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      refreshAll();
    },
    onError: onErr,
  });
  const [setActive] = useMutation(M_SET_ACTIVE, {
    onCompleted: () => { message.success(t("admin_products.status_updated")); refreshAll(); },
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
      if (!res.ok) throw new Error(j?.error || t("admin_products.upload_failed"));
      setImageUrls((prev) => (prev.includes(j.url) ? prev : [...prev, j.url]));
      message.success(t("admin_products.upload_success"));
    } catch (e: any) {
      message.error(e?.message || t("admin_products.upload_failed"));
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
                {t("admin_products.profit", { amount: (Number(v) - p.costPrice).toLocaleString() })}
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
              <Tag color={avail > 0 ? "green" : "default"}>{t("admin_products.units", { n: avail })}</Tag>
              {lows > 0 && (
                <Tag icon={<WarningOutlined />} color="warning">{t("admin_products.low_n", { n: lows })}</Tag>
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
    [can, t]
  );

  if (error) {
    return <Alert type="error" message={t("admin_products.load_error")} description={error.message} showIcon />;
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Products & Inventory</h2>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refreshAll} loading={loading}>Refresh</Button>
            {can("product.edit") && <Button icon={<ImportOutlined />} onClick={() => setImportModalOpen(true)}>{t("admin_products.btn_import")}</Button>}
            {can("product.edit") && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("admin_products.btn_add_product")}</Button>}
          </Space>
        </Space>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 6 }}>
          {t("admin_products.subtitle")}
        </Typography.Text>
      </div>

      <SynonymReviewCard canEdit={can("product.edit")} />

      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search
            allowClear placeholder={t("admin_products.search_placeholder")} style={{ width: 280 }}
            value={searchInput} onChange={(e) => onSearchChange(e.target.value)}
          />
          <Select
            allowClear placeholder={t("admin_products.all_categories")} style={{ width: 180 }}
            value={categoryFilter} onChange={(v) => { setCategoryFilter(v); setPage(1); }}
            options={categories.map((c) => ({ value: c.name, label: c.name }))}
          />
          {can("product.edit") && (
            <Button icon={<TagsOutlined />} onClick={() => setCategoryModalOpen(true)}>{t("admin_products.btn_manage_categories")}</Button>
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
                {t("admin_products.low_banner_title", { n: lowCount })}
              </Typography.Text>
              {outOfStockItems.length > 0 && <Tag color="error" style={{ marginInlineEnd: 0 }}>{t("admin_products.tag_out_n", { n: outOfStockItems.length })}</Tag>}
              {lowStockItems.length > 0 && <Tag color="warning" style={{ marginInlineEnd: 0 }}>{t("admin_products.low_n", { n: lowStockItems.length })}</Tag>}
            </Space>
            {!isMobile && (
              <Typography.Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                {lowExpanded ? t("admin_products.click_to_collapse") : t("admin_products.click_to_expand")}
              </Typography.Text>
            )}
          </button>

          {lowExpanded && (
            <div style={{ padding: `0 ${isMobile ? 12 : 14}px ${isMobile ? 12 : 14}px`, display: "grid", gap: 10 }}>
              {outOfStockItems.length > 0 && (
                <div style={{ border: "1px solid #ffa39e", background: "#fff1f0", borderRadius: 8, padding: isMobile ? "8px 10px" : "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                    <Typography.Text strong style={{ color: "#cf1322", fontSize: isMobile ? 12 : 12.5 }}>{t("admin_products.out_of_stock_heading")}</Typography.Text>
                    <Typography.Text style={{ color: "#cf1322", fontSize: 11 }}>{t("admin_products.items_count", { n: outOfStockItems.length })}</Typography.Text>
                  </div>
                  <Space wrap size={6}>
                    {outOfStockItems.map((x: any) => (
                      <Tag
                        color="error" key={`${x.sku}-${x.size}`} style={{ marginInlineEnd: 0, cursor: "pointer" }}
                        onClick={() => onSearchChange(x.sku)}
                      >
                        {t("admin_products.low_item_tag", { name: x.name, size: x.size, available: x.available, rp: x.reorder_point })}
                      </Tag>
                    ))}
                  </Space>
                </div>
              )}
              {lowStockItems.length > 0 && (
                <div style={{ border: "1px solid #ffe58f", background: "#fffbe6", borderRadius: 8, padding: isMobile ? "8px 10px" : "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                    <Typography.Text strong style={{ color: "#ad6800", fontSize: isMobile ? 12 : 12.5 }}>{t("admin_products.low_stock_heading")}</Typography.Text>
                    <Typography.Text style={{ color: "#ad6800", fontSize: 11 }}>{t("admin_products.items_count", { n: lowStockItems.length })}</Typography.Text>
                  </div>
                  <Space wrap size={6}>
                    {lowStockItems.map((x: any) => (
                      <Tag
                        color="warning" key={`${x.sku}-${x.size}`} style={{ marginInlineEnd: 0, cursor: "pointer" }}
                        onClick={() => onSearchChange(x.sku)}
                      >
                        {t("admin_products.low_item_tag", { name: x.name, size: x.size, available: x.available, rp: x.reorder_point })}
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
          showSizeChanger: true, showTotal: (n) => t("admin_products.total_items", { n }),
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />

      <Modal
        title={editing ? t("admin_products.modal_edit_title", { sku: editing.sku }) : t("admin_products.btn_add_product")}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); setImageUrls([]); form.resetFields(); }}
        onOk={submit} confirmLoading={saving}
        okText={editing ? t("admin_products.btn_save") : t("admin_products.btn_create")} width={560}
      >
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item label={t("admin_products.label_images")} extra={t("admin_products.images_extra")}>
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
                  {imageUrls.length > 0 ? t("admin_products.btn_add_image") : t("admin_products.btn_upload_image")}
                </Button>
              </Upload>
              {imageUrls.length > 0 && (
                <Button type="text" danger onClick={() => setImageUrls([])}>
                  {t("admin_products.btn_remove_all_images")}
                </Button>
              )}
            </Space>
          </Form.Item>

          <Form.Item label="SKU" name="sku" rules={[{ required: true, message: t("admin_products.rule_sku") }]}>
            <Input placeholder={t("admin_products.placeholder_sku")} disabled={!!editing} />
          </Form.Item>
          <Form.Item label="Barcode" name="barcode">
            <Input placeholder={t("admin_products.placeholder_barcode")} />
          </Form.Item>
          <Form.Item label={t("admin_products.label_name")} name="name" rules={[{ required: true, message: t("admin_products.rule_name") }]}>
            <Input placeholder={t("admin_products.placeholder_name")} />
          </Form.Item>
          <Form.Item label={t("admin_products.label_description")} name="description">
            <Input.TextArea rows={3} placeholder={t("admin_products.placeholder_description")} />
          </Form.Item>

          <Space.Compact block>
            <Form.Item label={t("admin_products.label_price")} name="price" rules={[{ required: true, message: t("admin_products.rule_price") }]} style={{ flex: 1, marginInlineEnd: 8 }}>
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={t("admin_products.label_cost")} name="costPrice" style={{ flex: 1, marginInlineEnd: 8 }}>
              <InputNumber min={0} style={{ width: "100%" }} placeholder={t("admin_products.placeholder_cost")} />
            </Form.Item>
            <Form.Item
              label={t("admin_products.label_weight")}
              name="weightGrams"
              style={{ flex: 1 }}
              tooltip={t("admin_products.weight_tooltip")}
            >
              <InputNumber min={0} style={{ width: "100%" }} placeholder={t("admin_products.placeholder_weight")} />
            </Form.Item>
          </Space.Compact>

          <Space.Compact block>
            <Form.Item
              label={<span>{t("admin_products.label_category")} <a onClick={() => setCategoryModalOpen(true)} style={{ fontSize: 12 }}>{t("admin_products.manage_link")}</a></span>}
              name="category" style={{ flex: 1, marginInlineEnd: 8 }}
            >
              <Select
                allowClear showSearch placeholder={t("admin_products.placeholder_category")}
                options={categories.map((c) => ({ value: c.name, label: c.name }))}
                notFoundContent={t("admin_products.category_not_found")}
              />
            </Form.Item>
            <Form.Item label={t("admin_products.label_brand")} name="brand" style={{ flex: 1 }}>
              <AutoComplete options={brandOptions.map((b) => ({ value: b }))} placeholder={t("admin_products.placeholder_brand")} filterOption />
            </Form.Item>
          </Space.Compact>

          <Form.Item label={t("admin_products.label_keywords")} name="keywords">
            <Select mode="tags" tokenSeparators={[",", " "]} placeholder={t("admin_products.placeholder_keywords")} />
          </Form.Item>
          <Form.Item label={t("admin_products.label_active")} name="active" valuePropName="checked">
            <Switch checkedChildren={t("admin_products.switch_on")} unCheckedChildren={t("admin_products.switch_off")} />
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
  const { t } = useI18n();
  const [skuById, setSkuById] = useState<Record<string, string>>({});
  const { data, loading, refetch } = useQuery(Q_SYNONYMS, { fetchPolicy: "cache-and-network" });
  const [review, { loading: reviewing }] = useMutation(M_REVIEW_SYNONYM, {
    onCompleted: () => {
      message.success(t("admin_products.synonym_reviewed"));
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
      extra={<Tag color="gold">{t("admin_products.synonym_pending", { n: candidates.length })}</Tag>}
      style={{ marginBottom: 16 }}
    >
      <Typography.Paragraph type="secondary">
        {t("admin_products.synonym_desc")}
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={candidates}
        columns={[
          { title: t("admin_products.col_term"), dataIndex: "term" },
          { title: t("admin_products.col_occurrences"), dataIndex: "occurrences", width: 70, render: (value: number) => t("admin_products.occurrence_times", { n: value }) },
          {
            title: t("admin_products.col_link_sku"),
            key: "sku",
            render: (_value: unknown, row: any) => (
              <Input
                size="small"
                value={skuById[row.id] || ""}
                disabled={!canEdit}
                placeholder={t("admin_products.placeholder_link_sku")}
                onChange={(event) => setSkuById((current) => ({ ...current, [row.id]: event.target.value }))}
              />
            ),
          },
          {
            title: t("admin_products.col_review"),
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
                  {t("admin_products.btn_approve")}
                </Button>
                <Button
                  size="small"
                  danger
                  disabled={!canEdit}
                  loading={reviewing}
                  onClick={() => review({ variables: { id: row.id, decision: "REJECTED", productSku: null } })}
                >
                  {t("admin_products.btn_reject")}
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
  const { t } = useI18n();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const onErr = (e: any) => message.error(e?.message || t("admin_products.action_failed"));

  const [createCategory, { loading: creating }] = useMutation(M_CREATE_CATEGORY, {
    onCompleted: () => { setNewName(""); onChanged(); },
    onError: onErr,
  });
  const [renameCategoryMut, { loading: renaming }] = useMutation(M_RENAME_CATEGORY, {
    onCompleted: () => { setEditingId(null); onChanged(); },
    onError: onErr,
  });
  const [deleteCategoryMut] = useMutation(M_DELETE_CATEGORY, {
    onCompleted: () => { message.success(t("admin_products.category_deleted")); onChanged(); },
    onError: onErr,
  });

  return (
    <Modal title={t("admin_products.category_modal_title")} open={open} onCancel={onClose} footer={null} width={420}>
      <Space.Compact block style={{ marginBottom: 16 }}>
        <Input
          placeholder={t("admin_products.placeholder_new_category")} value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={() => newName.trim() && createCategory({ variables: { name: newName.trim() } })}
        />
        <Button type="primary" icon={<PlusOutlined />} loading={creating} disabled={!newName.trim()}
          onClick={() => createCategory({ variables: { name: newName.trim() } })}>{t("admin_products.btn_add")}</Button>
      </Space.Compact>

      <List
        size="small"
        dataSource={categories}
        locale={{ emptyText: t("admin_products.no_categories") }}
        renderItem={(c) => (
          <List.Item
            actions={
              editingId === c.id
                ? [
                    <Button key="save" size="small" type="link" loading={renaming} disabled={!editingName.trim()}
                      onClick={() => renameCategoryMut({ variables: { id: c.id, name: editingName.trim() } })}>{t("admin_products.btn_save")}</Button>,
                    <Button key="cancel" size="small" type="link" onClick={() => setEditingId(null)}>{t("admin_products.btn_cancel")}</Button>,
                  ]
                : [
                    <Button key="edit" size="small" type="link" icon={<EditOutlined />}
                      onClick={() => { setEditingId(c.id); setEditingName(c.name); }} />,
                    <Popconfirm key="del" title={t("admin_products.delete_category_confirm", { name: c.name })} okText={t("admin_products.btn_delete")} okButtonProps={{ danger: true }}
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
  const { t } = useI18n();
  const onErr = (e: any) => message.error(e?.message || t("admin_products.action_failed"));
  const [adjustStockMut, { loading: adjustingStock }] = useMutation(M_ADJUST, { onError: onErr });
  const [setReorder] = useMutation(M_REORDER, {
    onCompleted: () => { message.success(t("admin_products.reorder_saved")); onChanged(); },
    onError: onErr,
  });
  const [loadMoves, { data: movesData, loading: movesLoading, called: movesCalled, refetch: refetchMoves }] = useLazyQuery(Q_MOVEMENTS, {
    fetchPolicy: "cache-first",
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
  const ensureMovesLoaded = useCallback(() => {
    if (!movesCalled) void loadMoves({ variables: { sku: product.sku } });
  }, [loadMoves, movesCalled, product.sku]);

  const runAdjust = useCallback(async (size: string, delta: number, successText?: string) => {
    if (!delta) return;
    await adjustStockMut({ variables: { sku: product.sku, size, delta } });
    message.success(successText || t("admin_products.stock_adjusted"));
    onChanged();
    if (movesCalled) void refetchMoves?.({ sku: product.sku });
  }, [adjustStockMut, movesCalled, onChanged, product.sku, refetchMoves, t]);

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
      title: t("admin_products.col_available"),
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
            {t("admin_products.on_hand", { n: r.current_stock })}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t("admin_products.col_reserved"),
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
      title: t("admin_products.col_reorder"), key: "reorder", width: 130,
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
          {r.low && <Tag color="warning" icon={<WarningOutlined />} style={{ width: "fit-content", margin: 0 }}>{t("admin_products.tag_low")}</Tag>}
        </div>
      ),
    },
    {
      title: t("admin_products.col_quick_adjust"), key: "adjust", width: 320,
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
            {t("admin_products.btn_manual")}
          </Button>
        </Space>
      ) : <span style={{ color: "#ccc" }}>{t("admin_products.no_permission")}</span>,
    },
  ];

  const moveCols = [
    { title: t("admin_products.col_time"), dataIndex: "created_at", key: "t", width: 165,
      render: (d: string) => new Date(d).toLocaleString() },
    { title: t("admin_products.col_type"), dataIndex: "type", key: "type", width: 110,
      render: (moveType: string) => <Tag color={MOVE_COLOR[moveType] || "default"}>{moveType}</Tag> },
    { title: "Size", dataIndex: "size", key: "size", width: 60 },
    { title: "Qty", dataIndex: "qty", key: "qty", width: 60, align: "right" as const },
    { title: "Order", dataIndex: "ref_order_id", key: "ref", width: 100,
      render: (o: string | null) => o ? <Typography.Text code>{o.slice(0, 8)}</Typography.Text> : "—" },
    { title: t("admin_products.col_actor"), dataIndex: "actor", key: "actor", render: (a: string | null) => a || "—" },
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
                <Typography.Text type="secondary">{t("admin_products.sku_label", { sku: product.sku })}</Typography.Text>
              </div>
              <Space wrap size={6}>
                {product.brand && <Tag color="blue" style={{ margin: 0 }}>{product.brand}</Tag>}
                {product.category && <Tag style={{ margin: 0 }}>{product.category}</Tag>}
                {lowCount > 0 && <Tag color="warning" icon={<WarningOutlined />} style={{ margin: 0 }}>{t("admin_products.low_sizes", { n: lowCount })}</Tag>}
              </Space>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "stretch", justifyContent: "flex-end", flex: 1 }}>
            <div style={{ minWidth: 128, padding: "10px 14px", border: "1px solid #f0f0f0", borderRadius: 12, background: "#fafafa" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_products.stat_price")}</Typography.Text>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>{Number(product.price).toLocaleString()} ฿</div>
              {product.costPrice != null && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t("admin_products.stat_cost", { amount: Number(product.costPrice).toLocaleString() })}
                </Typography.Text>
              )}
            </div>

            <div style={{ minWidth: 128, padding: "10px 14px", border: "1px solid #d9f7be", borderRadius: 12, background: "#f6ffed" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_products.stat_total_stock")}</Typography.Text>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: totalAvailable > 0 ? "#389e0d" : "#8c8c8c" }}>
                {totalAvailable}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("admin_products.stat_reserved", { n: totalReserved })}
              </Typography.Text>
            </div>

            <div style={{ minWidth: 128, padding: "10px 14px", border: "1px solid #f0f0f0", borderRadius: 12, background: "#fff" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>{t("admin_products.stat_status")}</Typography.Text>
              <Space direction="vertical" size={8}>
                <Switch checked={product.active} disabled={!canToggleActive} onChange={onToggleActive} />
                <Typography.Text style={{ fontSize: 12 }}>{product.active ? t("admin_products.status_enabled") : t("admin_products.status_disabled")}</Typography.Text>
              </Space>
            </div>

            <div style={{ display: "flex", alignItems: "center" }}>
              <Button icon={<EditOutlined />} type="primary" ghost disabled={!canEdit} onClick={onEdit}>
                {t("admin_products.btn_edit_product")}
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
            <Typography.Text strong style={{ fontSize: 18 }}>{t("admin_products.stock_section_title")}</Typography.Text>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("admin_products.stock_section_hint")}
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
                await runAdjust(newSize, newQty, t("admin_products.size_added"));
                setNewSize(undefined);
                setNewQty(1);
              }}
            >
              {t("admin_products.btn_add_size")}
            </Button>
            <Button type="primary" ghost onClick={openBulkAdjust}>
              {t("admin_products.btn_bulk_adjust")}
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
            <HistoryOutlined /> {t("admin_products.history_title")}
          </Typography.Text>
          {movesCalled ? (
            moves.length > 4 && (
              <Button type="link" onClick={() => setHistoryExpanded((prev) => !prev)}>
                {historyExpanded ? t("admin_products.btn_collapse_list") : t("admin_products.btn_view_all")}
              </Button>
            )
          ) : (
            <Button type="link" icon={<HistoryOutlined />} onClick={ensureMovesLoaded}>
              {t("admin_products.btn_load_history")}
            </Button>
          )}
        </div>

        <Table
          rowKey="id"
          dataSource={visibleMoves}
          columns={moveCols}
          size="small"
          loading={movesLoading}
          scroll={{ x: "max-content" }}
          pagination={false}
          locale={{ emptyText: movesCalled ? t("admin_products.no_history") : t("admin_products.load_history_hint") }}
        />
      </div>

      <Modal
        title={manualVariant ? t("admin_products.manual_modal_title_size", { size: manualVariant.size }) : t("admin_products.manual_modal_title")}
        open={!!manualVariant}
        onCancel={() => setManualVariant(null)}
        onOk={async () => {
          if (!manualVariant || !manualDelta) return;
          await runAdjust(manualVariant.size, manualDelta);
          setManualVariant(null);
          setManualDelta(1);
        }}
        okText={t("admin_products.btn_confirm")}
        cancelText={t("admin_products.btn_cancel")}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {t("admin_products.manual_hint")}
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
        title={t("admin_products.btn_bulk_adjust")}
        open={bulkOpen}
        onCancel={() => setBulkOpen(false)}
        confirmLoading={bulkApplying}
        okText={t("admin_products.btn_confirm_adjust")}
        cancelText={t("admin_products.btn_cancel")}
        onOk={async () => {
          const entries = Object.entries(bulkDraft).filter(([, delta]) => Number(delta) !== 0);
          if (!entries.length) {
            message.info(t("admin_products.bulk_nothing"));
            return;
          }
          setBulkApplying(true);
          try {
            for (const [size, delta] of entries) {
              await adjustStockMut({ variables: { sku: product.sku, size, delta: Number(delta) } });
            }
            message.success(t("admin_products.bulk_success", { n: entries.length }));
            setBulkOpen(false);
            onChanged();
            if (movesCalled) void refetchMoves?.({ sku: product.sku });
          } catch (error: any) {
            onErr(error);
          } finally {
            setBulkApplying(false);
          }
        }}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {t("admin_products.bulk_hint")}
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
                {t("admin_products.bulk_row_info", { available: variant.available, reserved: variant.reserved_stock })}
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
