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
  TeamOutlined,
  LockOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import { checkBarcode, isInStoreBarcode } from "@/lib/bms/barcode";
import { inferProductCreationTemplate, productTemplateDefaults, type ProductCreationTemplate } from "@/lib/bms/productTemplatePresets";
import { additionalProductTemplates, productFormFieldVisibility, shopExperienceForArchetype } from "@/lib/bms/shopExperience";
import debounce from "lodash/debounce";
import ImportModal from "./ImportModal";

// ---- Types --------------------------------------------------
type Variant = {
  locationId: string;
  locationName: string | null;
  branchCode: string | null;
  size: string;
  current_stock: number;
  reserved_stock: number;
  quarantine_stock: number;
  inTransitQty: number;
  transferLostQty: number;
  available: number;
  reorder_point: number;
  low: boolean;
  price: number;
  priceOverride: number | null;
  basePackId: string | null;
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
  vatCategory: string | null;
  priceTiers: Array<{
    minQty: number;
    scope: "PER_VARIANT_FIXED" | "CROSS_VARIANT_PERCENT";
    size: string | null;
    unitPrice: number | null;
    discountPct: number | null;
  }>;
  variants: Variant[];
  catalogVariants: Array<{ code: string; displayName: string | null; active: boolean; sortOrder: number }>;
  salesSurfaces: string[];
  readiness: {
    ready: boolean;
    blockers: Array<{ code: string; message: string; field: string | null }>;
    warnings: Array<{ code: string; message: string; field: string | null }>;
    recipeCostEstimate: number | null;
    recipeCostMaxEstimate: number | null;
  };
  stockPolicy: { stockPolicy: string } | null;
};
type ReservationOrder = {
  orderId: string;
  size: string;
  status: string;
  channel: string;
  customerRef: string | null;
  customerName: string | null;
  customerPhone: string | null;
  qty: number;
  viaBundleSkus: string[];
  locationName: string | null;
  branchCode: string | null;
  depositStatus: string | null;
  createdAt: string;
};
type Movement = {
  id: string;
  size: string;
  type: string;
  qty: number;
  location_name: string | null;
  branch_code: string | null;
  ref_order_id: string | null;
  note: string | null;
  actor: string | null;
  created_at: string;
};

// ---- GraphQL ------------------------------------------------
const Q_PRODUCTS = gql`
  query BmsProducts($search: String, $category: String, $limit: Int, $offset: Int) {
    bmsStoreProfile { businessArchetype }
    bmsLocations { id code name branchCode active }
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
        vatCategory
        priceTiers { minQty scope size unitPrice discountPct }
        variants {
          locationId
          locationName
          branchCode
          size
          current_stock
          reserved_stock
          quarantine_stock
          inTransitQty
          transferLostQty
          available
          reorder_point
          low
          price
          priceOverride
          basePackId
        }
      }
    }
  }
`;
const Q_PRODUCT_CONFIGURATION = gql`
  query BmsProductConfiguration($sku: String!) {
    bmsProductBySku(sku: $sku) {
      sku
      catalogVariants { code displayName active sortOrder }
      salesSurfaces
      readiness {
        ready
        blockers { code message field }
        warnings { code message field }
        recipeCostEstimate
        recipeCostMaxEstimate
      }
      stockPolicy { stockPolicy }
    }
  }
`;
const Q_CATEGORIES = gql`query { bmsProductCategories { id name } }`;
const Q_LOW = gql`query { bmsLowStock { sku name locationId locationName branchCode size available reorder_point } }`;
const Q_MOVEMENTS = gql`
  query ($sku: String!) {
    bmsStockMovements(sku: $sku, limit: 30) {
      id
      size
      type
      qty
      location_name
      branch_code
      ref_order_id
      note
      actor
      created_at
    }
  }
`;

const Q_RESERVATIONS = gql`
  query BmsVariantReservations($sku: String!, $size: String) {
    bmsVariantReservations(sku: $sku, size: $size) {
      sku
      size
      reservedTotal
      attributedTotal
      unattributed
      overAttributed
      orderCount
      lineCount
      orders {
        orderId
        size
        status
        channel
        customerRef
        customerName
        customerPhone
        qty
        viaBundleSkus
        locationName
        branchCode
        depositStatus
        createdAt
      }
    }
  }
`;

const M_GENERATE_BARCODE = gql`
  mutation GenerateInStoreBarcode {
    bmsGenerateInStoreBarcode
  }
`;

const M_UPSERT = gql`mutation ($input: BmsProductInput!) { bmsUpsertProduct(input: $input) { sku } }`;
const M_SET_ACTIVE = gql`mutation ($sku: String!, $active: Boolean!) { bmsSetProductActive(sku: $sku, active: $active) }`;
const M_ADJUST = gql`
  mutation ($sku: String!, $size: String!, $locationId: ID!, $delta: Int!) {
    bmsAdjustStock(sku: $sku, size: $size, locationId: $locationId, delta: $delta) { size available }
  }
`;
const M_REORDER = gql`
  mutation ($sku: String!, $size: String!, $locationId: ID!, $rp: Int!) {
    bmsSetReorderPoint(sku: $sku, size: $size, locationId: $locationId, reorderPoint: $rp) { size low }
  }
`;
const M_VARIANT_PRICE = gql`
  mutation ($input: BmsProductPackInput!) {
    bmsUpsertProductPack(input: $input) { id price size }
  }
`;
const M_CATALOG_VARIANT = gql`
  mutation ($input: BmsProductCatalogVariantInput!) {
    bmsUpsertProductCatalogVariant(input: $input) { code displayName active sortOrder }
  }
`;
const M_DUPLICATE_PRODUCT = gql`
  mutation ($sourceSku: String!, $targetSku: String!, $targetName: String!) {
    bmsDuplicateProduct(sourceSku: $sourceSku, targetSku: $targetSku, targetName: $targetName) { sku name }
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
  TRANSFER_IN: "cyan",
  TRANSFER_OUT: "geekblue",
  QUARANTINE_IN: "red",
  TRANSFER_LOST: "volcano",
  WASTAGE: "red",
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
  const basePriceDraft = Form.useWatch("price", form);
  const creationTemplate = Form.useWatch("creationTemplate", form);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [variantPriceDrafts, setVariantPriceDrafts] = useState<Record<string, number | null>>({});
  const [savingVariantPrices, setSavingVariantPrices] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [showSpecializedTemplates, setShowSpecializedTemplates] = useState(false);
  const [showRestaurantAdditionalFields, setShowRestaurantAdditionalFields] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<Product | null>(null);
  const [duplicateForm] = Form.useForm();
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
  const [loadProductConfiguration] = useLazyQuery(Q_PRODUCT_CONFIGURATION, {
    fetchPolicy: "network-only",
  });

  const onErr = (e: any) => message.error(e?.message || t("admin_products.action_failed"));
  const refreshAll = () => {
    refetch();
    refetchLow();
  };

  const [upsertProduct, { loading: saving }] = useMutation(M_UPSERT, { onError: onErr });
  const [saveModalVariantPrice] = useMutation(M_VARIANT_PRICE, { onError: onErr });
  const [setActive] = useMutation(M_SET_ACTIVE, {
    onCompleted: () => { message.success(t("admin_products.status_updated")); refreshAll(); },
    onError: onErr,
  });
  const [duplicateProduct, { loading: duplicating }] = useMutation(M_DUPLICATE_PRODUCT, { onError: onErr });

  const openDuplicate = (product: Product) => {
    setDuplicateSource(product);
    duplicateForm.setFieldsValue({
      targetSku: `${product.sku}-COPY`,
      targetName: `${product.name} (${t("admin_products.copy_suffix")})`,
    });
  };

  const submitDuplicate = async () => {
    if (!duplicateSource) return;
    const values = await duplicateForm.validateFields().catch(() => null);
    if (!values) return;
    try {
      await duplicateProduct({ variables: {
        sourceSku: duplicateSource.sku,
        targetSku: String(values.targetSku).trim(),
        targetName: String(values.targetName).trim(),
      } });
      message.success(t("admin_products.duplicate_success"));
      setDuplicateSource(null);
      duplicateForm.resetFields();
      refreshAll();
    } catch {
      // mutation onError keeps the modal open for correction
    }
  };

  const products: Product[] = data?.bmsProducts?.items || [];
  const locations: Array<{ id: string; code: string; name: string; branchCode: string; active: boolean }> =
    data?.bmsLocations || [];
  const total: number = data?.bmsProducts?.total || 0;
  const categories: { id: string; name: string }[] = catData?.bmsProductCategories || [];
  const lowItems: any[] = lowData?.bmsLowStock || [];
  const lowCount: number = lowItems.length;
  const outOfStockItems = lowItems.filter((x) => x.available <= 0);
  const lowStockItems = lowItems.filter((x) => x.available > 0).sort((a, b) => a.available - b.available);
  const shopExperience = shopExperienceForArchetype(data?.bmsStoreProfile?.businessArchetype);
  const isRestaurantShop = shopExperience.specialMode === "RESTAURANT";
  const templateLabel = (template: ProductCreationTemplate) => ({
    QUICK_MENU: t("admin_products.template_quick_menu"),
    PREPARED_MENU: t("admin_products.template_prepared_menu"),
    READY_GOOD: t("admin_products.template_ready_good"),
    INGREDIENT: t("admin_products.template_ingredient"),
    GENERAL: t("admin_products.template_general"),
  })[template];
  const recommendedTemplateOptions = shopExperience.recommendedTemplates.map((value) => ({ value, label: templateLabel(value) }));
  const additionalTemplateOptions = additionalProductTemplates(shopExperience).map((value) => ({ value, label: templateLabel(value) }));
  const visibleAdditionalTemplateOptions = showSpecializedTemplates
    ? additionalTemplateOptions
    : additionalTemplateOptions.filter((option) => option.value === creationTemplate);
  const templateSelectOptions: any[] = visibleAdditionalTemplateOptions.length > 0 ? [
    { label: t("admin_products.templates_recommended"), options: recommendedTemplateOptions },
    { label: t("admin_products.templates_additional"), options: visibleAdditionalTemplateOptions },
  ] : recommendedTemplateOptions;

  const applyCreationTemplate = (template: ProductCreationTemplate) => {
    const defaults = productTemplateDefaults(template);
    form.setFieldsValue({
      stockPolicy: defaults.stockPolicy,
      baseUnit: defaults.baseUnit,
      salesSurfaces: [...defaults.surfaces],
    });
    form.setFields([
      { name: "stockPolicy", touched: false },
      { name: "baseUnit", touched: false },
      { name: "salesSurfaces", touched: false },
    ]);
  };

  const changeCreationTemplate = (template: ProductCreationTemplate) => {
    const defaults = productTemplateDefaults(template);
    const current = form.getFieldsValue(["stockPolicy", "baseUnit", "salesSurfaces"]);
    const wouldOverwriteCustomizedValue =
      (form.isFieldTouched("stockPolicy") && current.stockPolicy !== defaults.stockPolicy)
      || (form.isFieldTouched("baseUnit") && current.baseUnit !== defaults.baseUnit)
      || (form.isFieldTouched("salesSurfaces")
        && JSON.stringify(current.salesSurfaces ?? []) !== JSON.stringify(defaults.surfaces));

    if (!wouldOverwriteCustomizedValue) {
      applyCreationTemplate(template);
      return;
    }

    Modal.confirm({
      title: t("admin_products.template_change_confirm_title"),
      content: t("admin_products.template_change_confirm_description"),
      okText: t("admin_products.template_change_confirm_ok"),
      cancelText: t("admin_products.template_change_confirm_cancel"),
      onOk: () => applyCreationTemplate(template),
      onCancel: () => {
        form.setFieldValue("creationTemplate", creationTemplate);
        form.setFields([{ name: "creationTemplate", touched: false }]);
      },
    });
  };

  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  // ยี่ห้อ: พิมพ์อิสระได้ (autocomplete จากค่าที่เคยใช้) — หมวดหมู่ใช้ list กลางที่จัดการแล้ว (bmsProductCategories)
  const brandOptions = useMemo(
    () => Array.from(new Set(products.map((p) => p.brand).filter(Boolean))) as string[],
    [products]
  );

  // ---- Barcode ----
  // เก็บค่าที่พิมพ์แยกไว้ใน state เพื่อคำนวณคำเตือนสด ๆ · อ่านจาก form ตรง ๆ ไม่ได้
  // เพราะ Form.Item ไม่ re-render ตัว label/help ให้เมื่อค่าเปลี่ยน
  const [barcodeDraft, setBarcodeDraft] = useState("");
  // ขั้นราคาส่ง (8.1) — เก็บนอก Form เพราะเป็นรายการที่เพิ่ม/ลบแถวได้
  const [priceTiers, setPriceTiers] = useState<Array<{
    minQty: string;
    scope: "PER_VARIANT_FIXED" | "CROSS_VARIANT_PERCENT";
    size: string | null;
    unitPrice: string;
    discountPct: string;
  }>>([]);
  const productFieldVisibility = productFormFieldVisibility(
    shopExperience,
    creationTemplate,
    showRestaurantAdditionalFields
  );
  const [genBarcode, { loading: generatingBarcode }] = useMutation(M_GENERATE_BARCODE);

  const generateBarcode = async () => {
    try {
      const res = await genBarcode();
      const code = res.data?.bmsGenerateInStoreBarcode;
      if (!code) throw new Error(t("admin_products.barcode_generate_failed"));
      form.setFieldsValue({ barcode: code });
      setBarcodeDraft(code);
      message.success(t("admin_products.barcode_generated").replace("{code}", code));
    } catch (e: any) {
      message.error(e?.message || t("admin_products.barcode_generate_failed"));
    }
  };

  /** คำเตือนใต้ช่อง — เตือนอย่างเดียว ไม่บล็อกการบันทึก (ร้านมีบาร์โค้ดแปลก ๆ จริง) */
  const barcodeNotice = useMemo((): { tone: "success" | "warning" | "danger"; text: string } | null => {
    const res = checkBarcode(barcodeDraft);
    if (res.kind === "EMPTY") return null;
    if (res.kind === "VALID") {
      return isInStoreBarcode(barcodeDraft.trim())
        ? { tone: "warning", text: t("admin_products.barcode_in_store") }
        : { tone: "success", text: t("admin_products.barcode_valid").replace("{symbology}", res.symbology) };
    }
    if (res.kind === "BAD_CHECK_DIGIT") {
      return {
        tone: "danger",
        text: t("admin_products.barcode_bad_check")
          .replace("{symbology}", res.symbology)
          .replace("{expected}", String(res.expected)),
      };
    }
    return {
      tone: "warning",
      text: t("admin_products.barcode_non_standard").replace("{reason}", res.reason),
    };
  }, [barcodeDraft, t]);

  const openCreate = () => {
    setEditing(null);
    setVariantPriceDrafts({});
    setImageUrls([]);
    setShowSpecializedTemplates(false);
    setShowRestaurantAdditionalFields(false);
    form.resetFields();
    const restaurant = shopExperience.specialMode === "RESTAURANT";
    const template: ProductCreationTemplate = restaurant ? "PREPARED_MENU" : "GENERAL";
    const defaults = productTemplateDefaults(template);
    form.setFieldsValue({
      active: false,
      keywords: [],
      vatCategory: "UNKNOWN",
      creationTemplate: template,
      stockPolicy: defaults.stockPolicy,
      baseUnit: defaults.baseUnit,
      variantCodes: ["STD"],
      salesSurfaces: [...shopExperience.primarySalesSurfaces],
    });
    setBarcodeDraft("");
    setPriceTiers([]);
    setModalOpen(true);
  };
  const openEdit = async (p: Product) => {
    let configuredProduct = p;
    try {
      const result = await loadProductConfiguration({ variables: { sku: p.sku } });
      if (!result.data?.bmsProductBySku) throw new Error(t("admin_products.product_not_found"));
      configuredProduct = { ...p, ...result.data.bmsProductBySku };
    } catch (error: any) {
      message.error(error?.message || t("admin_products.action_failed"));
      return;
    }
    setEditing(configuredProduct);
    setShowRestaurantAdditionalFields(Boolean(
      configuredProduct.barcode
      || configuredProduct.weightGrams != null
      || configuredProduct.brand
      || configuredProduct.priceTiers?.length
    ));
    setVariantPriceDrafts(Object.fromEntries(
      configuredProduct.variants.map((variant) => [variant.size, variant.priceOverride])
    ));
    setImageUrls(
      Array.isArray(configuredProduct.images) && configuredProduct.images.length > 0
        ? configuredProduct.images.map((img) => img.url)
        : configuredProduct.imageUrl
          ? [configuredProduct.imageUrl]
          : []
    );
    form.setFieldsValue({
      sku: configuredProduct.sku, name: configuredProduct.name, price: configuredProduct.price,
      keywords: configuredProduct.keywords, active: configuredProduct.active, barcode: configuredProduct.barcode || "",
      description: configuredProduct.description || "", costPrice: configuredProduct.costPrice ?? undefined,
      weightGrams: configuredProduct.weightGrams ?? undefined,
      category: configuredProduct.category || "", brand: configuredProduct.brand || "",
      vatCategory: configuredProduct.vatCategory || "UNKNOWN",
      creationTemplate: inferProductCreationTemplate(
        configuredProduct.stockPolicy?.stockPolicy,
        configuredProduct.salesSurfaces
      ),
      stockPolicy: configuredProduct.stockPolicy?.stockPolicy || "DIRECT",
      variantCodes: configuredProduct.catalogVariants.filter((variant) => variant.active).map((variant) => variant.code),
      salesSurfaces: configuredProduct.salesSurfaces,
    });
    setBarcodeDraft(configuredProduct.barcode || "");
    setPriceTiers((configuredProduct.priceTiers ?? []).map((t) => ({
      minQty: String(t.minQty),
      scope: t.scope ?? "PER_VARIANT_FIXED",
      size: t.size ?? null,
      unitPrice: t.unitPrice == null ? "" : String(t.unitPrice),
      discountPct: t.discountPct == null ? "" : String(t.discountPct),
    })));
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
    const normalizedPriceTiers = priceTiers.map((tier) => ({
      minQty: Number(tier.minQty),
      scope: tier.scope,
      size: tier.scope === "PER_VARIANT_FIXED" ? tier.size : null,
      unitPrice: tier.scope === "PER_VARIANT_FIXED" && tier.unitPrice !== "" ? Number(tier.unitPrice) : null,
      discountPct: tier.scope === "CROSS_VARIANT_PERCENT" && tier.discountPct !== ""
        ? Number(tier.discountPct)
        : null,
    }));
    const validTiers = normalizedPriceTiers.every((tier) => (
      Number.isInteger(tier.minQty) && tier.minQty >= 2 && (
        (tier.scope === "PER_VARIANT_FIXED" && Number.isFinite(tier.unitPrice) && Number(tier.unitPrice) >= 0)
        || (tier.scope === "CROSS_VARIANT_PERCENT" && Number.isFinite(tier.discountPct)
          && Number(tier.discountPct) > 0 && Number(tier.discountPct) <= 100)
      )
    ));
    const uniqueRules = new Set(normalizedPriceTiers.map((tier) => (
      `${tier.scope}\u0000${tier.size ?? ""}\u0000${tier.minQty}`
    ))).size === normalizedPriceTiers.length;
    if (!validTiers || !uniqueRules) {
      message.error(t("admin_products.price_tiers_invalid"));
      return;
    }
    try {
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
            vat_category: v.vatCategory || null,
            // ส่งเสมอเมื่อเปิดจากฟอร์มนี้ — ลบขั้นสุดท้ายทิ้งแล้วกดบันทึกต้องลบจริง
            price_tiers: normalizedPriceTiers,
            creation_template: editing ? null : v.creationTemplate,
            stock_policy: v.stockPolicy,
            base_unit: v.baseUnit,
            variant_codes: v.variantCodes || [],
            sales_surfaces: v.salesSurfaces || [],
          },
        },
      });

      if (editing?.variants.length) {
        const changedVariants = editing.variants.filter((variant) => {
          const next = variantPriceDrafts[variant.size] ?? null;
          return next !== variant.priceOverride;
        });
        if (changedVariants.length) {
          setSavingVariantPrices(true);
          await Promise.all(changedVariants.map((variant) => saveModalVariantPrice({
            variables: {
              input: {
                id: variant.basePackId,
                productSku: editing.sku,
                size: variant.size,
                packCode: "BASE",
                unitName: "ชิ้น",
                baseQty: 1,
                price: variantPriceDrafts[variant.size] ?? null,
                isBase: true,
                active: true,
              },
            },
          })));
        }
      }

      message.success(t("admin_products.product_saved"));
      setModalOpen(false);
      setEditing(null);
      setVariantPriceDrafts({});
      form.resetFields();
      refreshAll();
    } catch {
      // useMutation แสดงข้อความจาก onError แล้ว; คง modal ไว้ให้แก้/ลองใหม่
    } finally {
      setSavingVariantPrices(false);
    }
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
        title: "", key: "actions", width: 190,
        render: (_: any, p: Product) =>
          can("product.edit")
            ? <Space size={0}>
                <Button type="link" size="small" icon={<EditOutlined />} onClick={() => void openEdit(p)}>{t("admin_products.btn_edit_product")}</Button>
                <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => openDuplicate(p)}>{t("admin_products.btn_duplicate")}</Button>
              </Space>
            : <span style={{ color: "#ccc" }}>—</span>,
      },
    ],
    [can, t]
  );

  if (error) {
    return <Alert closable type="error" message={t("admin_products.load_error")} description={error.message} showIcon />;
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <h2 style={{ margin: 0 }}>Products & Inventory</h2>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refreshAll} loading={loading}>Refresh</Button>
            {can("product.edit") && <Button icon={<ImportOutlined />} disabled={loading} onClick={() => setImportModalOpen(true)}>{t("admin_products.btn_import")}</Button>}
            {can("product.edit") && <Button type="primary" icon={<PlusOutlined />} disabled={loading} onClick={openCreate}>{t("admin_products.btn_add_product")}</Button>}
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
                        color="error" key={`${x.locationId}-${x.sku}-${x.size}`} style={{ marginInlineEnd: 0, cursor: "pointer" }}
                        onClick={() => onSearchChange(x.sku)}
                      >
                        {t("admin_products.low_item_tag", { branch: x.locationName, name: x.name, size: x.size, available: x.available, rp: x.reorder_point })}
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
                        color="warning" key={`${x.locationId}-${x.sku}-${x.size}`} style={{ marginInlineEnd: 0, cursor: "pointer" }}
                        onClick={() => onSearchChange(x.sku)}
                      >
                        {t("admin_products.low_item_tag", { branch: x.locationName, name: x.name, size: x.size, available: x.available, rp: x.reorder_point })}
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
              locations={locations.filter((location) => location.active)}
              onChanged={refreshAll}
              canAdjust={can("stock.adjust")}
              canEdit={can("product.edit")}
              canToggleActive={can("product.delete")}
              canViewOrders={can("order.view")}
              onEdit={() => void openEdit(p)}
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
        onCancel={() => { setModalOpen(false); setEditing(null); setVariantPriceDrafts({}); setImageUrls([]); form.resetFields(); }}
        onOk={submit} confirmLoading={saving || savingVariantPrices}
        okText={editing ? t("admin_products.btn_save") : t("admin_products.btn_create")} width={680}
      >
        <Form form={form} layout="vertical" autoComplete="off">
          {!editing && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={t("admin_products.draft_first_title")}
              description={t("admin_products.draft_first_description")}
            />
          )}
          {!editing && (
            <Form.Item
              label={t("admin_products.creation_template")}
              name="creationTemplate"
              rules={[{ required: true }]}
              extra={creationTemplate === "QUICK_MENU"
                ? t("admin_products.template_quick_menu_hint")
                : t("admin_products.creation_template_hint")}
            >
              <Select
                options={templateSelectOptions}
                onChange={changeCreationTemplate}
              />
            </Form.Item>
          )}
          {!editing && additionalTemplateOptions.length > 0 && (
            <Button
              type="link"
              style={{ paddingInline: 0, marginTop: -18, marginBottom: 12 }}
              onClick={() => setShowSpecializedTemplates((current) => !current)}
            >
              {showSpecializedTemplates
                ? t("admin_products.hide_specialized_templates")
                : t("admin_products.show_specialized_templates")}
            </Button>
          )}

          <Space.Compact block>
            <Form.Item
              label={t("admin_products.label_stock_policy")}
              name="stockPolicy"
              rules={[{ required: true }]}
              style={{ flex: 1, marginInlineEnd: 8 }}
              extra={editing ? t("admin_products.stock_policy_edit_hint") : undefined}
            >
              <Select
                disabled={Boolean(editing)}
                options={["DIRECT", "PACK", "BUNDLE", "WEIGHTED", "RECIPE", "SERIALIZED", "NON_STOCK"].map((value) => ({
                  value,
                  label: t(`admin_products.stock_policy_${value.toLowerCase()}`),
                }))}
              />
            </Form.Item>
            <Form.Item
              label={t("admin_products.label_catalog_variants")}
              name="variantCodes"
              rules={[{ required: true, type: "array", min: 1 }]}
              style={{ flex: 1 }}
              extra={t("admin_products.catalog_variants_hint")}
            >
              <Select disabled={Boolean(editing)} mode="tags" tokenSeparators={[",", " "]} placeholder="STD / S / M / LARGE" />
            </Form.Item>
          </Space.Compact>

          {!editing && (
            <Form.Item
              label={t("admin_products.base_unit")}
              name="baseUnit"
              rules={[{ required: true }]}
              extra={t("admin_products.base_unit_hint")}
            >
              <Select
                showSearch
                options={["PIECE", "GRAM", "ML", "MM", "CM", "METER"].map((value) => ({
                  value,
                  label: value === "PIECE" ? t("admin_products.unit_piece") : value,
                }))}
              />
            </Form.Item>
          )}

          <Form.Item
            label={t("admin_products.label_sales_surfaces")}
            name="salesSurfaces"
            extra={t("admin_products.sales_surfaces_hint")}
          >
            <Select
              mode="multiple"
              allowClear
              options={[
                ...(shopExperience.specialMode === "RESTAURANT" || showSpecializedTemplates
                  ? [{ value: "RESTAURANT_POS", label: t("admin_products.surface_restaurant_pos") }]
                  : []),
                { value: "RETAIL_POS", label: t("admin_products.surface_retail_pos") },
                { value: "PUBLIC_STOREFRONT", label: t("admin_products.surface_storefront") },
                { value: "CUSTOMER_AI", label: t("admin_products.surface_customer_ai") },
                { value: "ONLINE_ORDER", label: t("admin_products.surface_online_order") },
              ]}
            />
          </Form.Item>

          {isRestaurantShop && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={t("admin_products.restaurant_core_fields_title")}
              description={
                <Space direction="vertical" size={4}>
                  <span>{t("admin_products.restaurant_core_fields_description")}</span>
                  <Button
                    type="link"
                    style={{ paddingInline: 0, alignSelf: "flex-start" }}
                    onClick={() => setShowRestaurantAdditionalFields((current) => !current)}
                  >
                    {showRestaurantAdditionalFields
                      ? t("admin_products.hide_restaurant_additional_fields")
                      : t("admin_products.show_restaurant_additional_fields")}
                  </Button>
                  {showRestaurantAdditionalFields && (
                    <Typography.Text type="secondary">
                      {t("admin_products.restaurant_additional_fields_description")}
                    </Typography.Text>
                  )}
                </Space>
              }
            />
          )}

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
          {/* Barcode — เจตนาของช่องนี้คือ "ยิงเข้า" ไม่ใช่ "พิมพ์เอง"
              ของที่โรงงานติดบาร์โค้ดมาแล้ว เลขนั้นเป็นของ GS1 สร้างใหม่ทับไม่ได้
              ปุ่มสร้างเลขมีไว้สำหรับของแบ่งขาย/ของทำเองที่ไม่มีบาร์โค้ดเท่านั้น */}
          {productFieldVisibility.barcode && <Form.Item label="Barcode" tooltip={t("admin_products.barcode_scan_hint")}>
            <Space.Compact style={{ width: "100%" }}>
              <Form.Item name="barcode" noStyle>
                <Input
                  placeholder={t("admin_products.placeholder_barcode")}
                  onChange={(e) => setBarcodeDraft(e.target.value)}
                />
              </Form.Item>
              <Button loading={generatingBarcode} onClick={() => void generateBarcode()}>
                {t("admin_products.barcode_generate")}
              </Button>
            </Space.Compact>
            {barcodeNotice && (
              <Typography.Text
                type={barcodeNotice.tone}
                style={{ fontSize: 12, display: "block", marginTop: 4 }}
              >
                {barcodeNotice.text}
              </Typography.Text>
            )}
          </Form.Item>}
          <Form.Item label={t("admin_products.label_name")} name="name" rules={[{ required: true, message: t("admin_products.rule_name") }]}>
            <Input placeholder={t("admin_products.placeholder_name")} />
          </Form.Item>
          <Form.Item label={t("admin_products.label_description")} name="description">
            <Input.TextArea rows={3} placeholder={t("admin_products.placeholder_description")} />
          </Form.Item>

          <Space.Compact block>
            <Form.Item label={editing?.variants.length ? t("admin_products.label_base_price") : t("admin_products.label_price")} name="price" rules={[{ required: true, message: t("admin_products.rule_price") }]} style={{ flex: 1, marginInlineEnd: 8 }}>
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label={t("admin_products.label_cost")} name="costPrice" style={{ flex: 1, marginInlineEnd: 8 }}>
              <InputNumber min={0} style={{ width: "100%" }} placeholder={t("admin_products.placeholder_cost")} />
            </Form.Item>
            {productFieldVisibility.shippingWeight && <Form.Item
              label={t("admin_products.label_weight")}
              name="weightGrams"
              style={{ flex: 1 }}
              tooltip={t("admin_products.weight_tooltip")}
            >
              <InputNumber min={0} style={{ width: "100%" }} placeholder={t("admin_products.placeholder_weight")} />
            </Form.Item>}
          </Space.Compact>

          {editing && editing.variants.length > 0 && (
            <Form.Item
              label={t("admin_products.label_variant_prices")}
              extra={t("admin_products.variant_prices_extra")}
            >
              <div style={{ display: "grid", gap: 8 }}>
                {editing.variants.map((variant) => {
                  const override = variantPriceDrafts[variant.size] ?? null;
                  const fallback = Number(basePriceDraft ?? editing.price);
                  return (
                    <div
                      key={variant.size}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(56px, auto) minmax(130px, 1fr) auto",
                        alignItems: "center",
                        gap: 8,
                        padding: 8,
                        border: "1px solid #f0f0f0",
                        borderRadius: 8,
                      }}
                    >
                      <Typography.Text strong>{variant.size}</Typography.Text>
                      <InputNumber
                        min={0}
                        step={1}
                        value={override ?? fallback}
                        addonAfter="฿"
                        onChange={(value) => setVariantPriceDrafts((current) => ({
                          ...current,
                          [variant.size]: value == null ? null : Number(value),
                        }))}
                        style={{ width: "100%" }}
                      />
                      <Button
                        size="small"
                        type={override == null ? "default" : "link"}
                        disabled={override == null}
                        onClick={() => setVariantPriceDrafts((current) => ({ ...current, [variant.size]: null }))}
                      >
                        {override == null
                          ? t("admin_products.variant_uses_base")
                          : t("admin_products.variant_use_base")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </Form.Item>
          )}

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
            {productFieldVisibility.brand && <Form.Item label={t("admin_products.label_brand")} name="brand" style={{ flex: 1, marginInlineEnd: 8 }}>
              <AutoComplete options={brandOptions.map((b) => ({ value: b }))} placeholder={t("admin_products.placeholder_brand")} filterOption />
            </Form.Item>}
            {/* ประเภท VAT (7.88) — คอลัมน์มีมานานแต่ไม่มีช่องให้กรอก ร้านที่จด VAT
                จึงติด blocker ที่ /admin/pos-readiness โดยไม่มีปุ่มแก้ · ค่า default
                ของฟอร์มคือ UNKNOWN เพื่อไม่ให้การกดบันทึกกลาย ๆ ตั้งค่าภาษีให้เอง */}
            <Form.Item
              label={t("admin_products.label_vat_category")}
              name="vatCategory"
              style={{ flex: 1 }}
              tooltip={t("admin_products.vat_category_tooltip")}
            >
              <Select
                options={[
                  { value: "V", label: t("admin_products.vat_v") },
                  { value: "N", label: t("admin_products.vat_n") },
                  { value: "UNKNOWN", label: t("admin_products.vat_unknown") },
                ]}
              />
            </Form.Item>
          </Space.Compact>

          {/* ขั้นราคาส่ง — แบบราคาคงที่นับแยกไซซ์; แบบเปอร์เซ็นต์นับรวมข้ามไซซ์
              แต่ยังลดจากราคาฐานของแต่ละไซซ์ ไม่บีบทุกไซซ์ให้เป็นราคาเดียว
              ยุบไว้ตอนไม่มีขั้น เพราะสินค้าส่วนใหญ่ขายราคาเดียว */}
          {productFieldVisibility.wholesalePriceTiers && <Form.Item label={t("admin_products.label_price_tiers")} tooltip={t("admin_products.price_tiers_tooltip")}>
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              {priceTiers.map((tier, idx) => (
                <Space key={idx} align="baseline" wrap>
                  <span style={{ fontSize: 12 }}>{t("admin_products.tier_from")}</span>
                  <InputNumber
                    min={2}
                    value={tier.minQty === "" ? null : Number(tier.minQty)}
                    onChange={(v) => setPriceTiers((cur) =>
                      cur.map((row, i) => (i === idx ? { ...row, minQty: v == null ? "" : String(v) } : row)))}
                    style={{ width: 90 }}
                  />
                  <Select
                    value={tier.scope}
                    onChange={(scope) => setPriceTiers((cur) => cur.map((row, i) => (
                      i === idx ? { ...row, scope, size: scope === "PER_VARIANT_FIXED" ? row.size : null } : row
                    )))}
                    style={{ width: 190 }}
                    options={[
                      { value: "PER_VARIANT_FIXED", label: t("admin_products.tier_scope_variant") },
                      { value: "CROSS_VARIANT_PERCENT", label: t("admin_products.tier_scope_cross") },
                    ]}
                  />
                  {tier.scope === "PER_VARIANT_FIXED" ? (
                    <>
                      <Select
                        value={tier.size ?? "__ALL__"}
                        onChange={(value) => setPriceTiers((cur) => cur.map((row, i) => (
                          i === idx ? { ...row, size: value === "__ALL__" ? null : value } : row
                        )))}
                        style={{ minWidth: 150 }}
                        options={[
                          { value: "__ALL__", label: t("admin_products.tier_all_sizes") },
                          ...(editing?.variants ?? []).map((variant) => ({
                            value: variant.size,
                            label: t("admin_products.tier_size").replace("{size}", variant.size),
                          })),
                        ]}
                      />
                      <span style={{ fontSize: 12 }}>{t("admin_products.tier_price_each")}</span>
                      <InputNumber
                        min={0}
                        value={tier.unitPrice === "" ? null : Number(tier.unitPrice)}
                        onChange={(v) => setPriceTiers((cur) =>
                          cur.map((row, i) => (i === idx ? { ...row, unitPrice: v == null ? "" : String(v) } : row)))}
                        style={{ width: 110 }}
                      />
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 12 }}>{t("admin_products.tier_discount_pct")}</span>
                      <InputNumber
                        min={0.0001}
                        max={100}
                        step={0.5}
                        value={tier.discountPct === "" ? null : Number(tier.discountPct)}
                        onChange={(v) => setPriceTiers((cur) => cur.map((row, i) => (
                          i === idx ? { ...row, discountPct: v == null ? "" : String(v) } : row
                        )))}
                        addonAfter="%"
                        style={{ width: 130 }}
                      />
                    </>
                  )}
                  <Button
                    type="text"
                    danger
                    onClick={() => setPriceTiers((cur) => cur.filter((_, i) => i !== idx))}
                  >
                    ✕
                  </Button>
                </Space>
              ))}
              <Button
                type="dashed"
                onClick={() => setPriceTiers((cur) => [...cur, {
                  minQty: "",
                  scope: "PER_VARIANT_FIXED",
                  size: null,
                  unitPrice: "",
                  discountPct: "",
                }])}
              >
                + {t("admin_products.tier_add")}
              </Button>
            </Space>
          </Form.Item>}

          <Form.Item label={t("admin_products.label_keywords")} name="keywords">
            <Select mode="tags" tokenSeparators={[",", " "]} placeholder={t("admin_products.placeholder_keywords")} />
          </Form.Item>
          <Form.Item label={t("admin_products.label_active")} name="active" valuePropName="checked">
            <Switch
              disabled
              checkedChildren={t("admin_products.switch_on")}
              unCheckedChildren={t("admin_products.switch_off")}
            />
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
        businessArchetype={data?.bmsStoreProfile?.businessArchetype}
        onClose={() => setImportModalOpen(false)}
        onImported={refreshAll}
      />

      <Modal
        open={Boolean(duplicateSource)}
        title={t("admin_products.duplicate_title")}
        onCancel={() => { setDuplicateSource(null); duplicateForm.resetFields(); }}
        onOk={() => void submitDuplicate()}
        confirmLoading={duplicating}
      >
        <Alert
          type="info"
          showIcon
          message={t("admin_products.duplicate_draft_hint")}
          style={{ marginBottom: 16 }}
        />
        <Form form={duplicateForm} layout="vertical">
          <Form.Item label={t("admin_products.duplicate_source")}>
            <Input value={duplicateSource ? `${duplicateSource.sku} · ${duplicateSource.name}` : ""} disabled />
          </Form.Item>
          <Form.Item name="targetSku" label={t("admin_products.duplicate_target_sku")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="targetName" label={t("admin_products.label_name")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
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
  locations,
  onChanged,
  canAdjust,
  canEdit,
  canToggleActive,
  canViewOrders,
  onEdit,
  onToggleActive,
}: {
  product: Product;
  locations: Array<{ id: string; code: string; name: string; branchCode: string }>;
  onChanged: () => void;
  canAdjust: boolean;
  canEdit: boolean;
  canToggleActive: boolean;
  canViewOrders: boolean;
  onEdit: () => void;
  onToggleActive: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const onErr = (e: any) => message.error(e?.message || t("admin_products.action_failed"));
  const { data: configurationData, refetch: refetchConfiguration } = useQuery(Q_PRODUCT_CONFIGURATION, {
    variables: { sku: product.sku },
    fetchPolicy: "cache-and-network",
  });
  const productConfiguration = configurationData?.bmsProductBySku ?? null;
  const catalogVariants: Product["catalogVariants"] = productConfiguration?.catalogVariants ?? [];
  const salesSurfaces: string[] = productConfiguration?.salesSurfaces ?? [];
  const readiness: Product["readiness"] | null = productConfiguration?.readiness ?? null;
  const [adjustStockMut, { loading: adjustingStock }] = useMutation(M_ADJUST, { onError: onErr });
  const [setReorder] = useMutation(M_REORDER, {
    onCompleted: () => { message.success(t("admin_products.reorder_saved")); onChanged(); },
    onError: onErr,
  });
  const [setVariantPrice, { loading: savingVariantPrice }] = useMutation(M_VARIANT_PRICE, {
    onCompleted: () => { message.success(t("admin_products.variant_price_saved")); onChanged(); },
    onError: onErr,
  });
  const [saveCatalogVariant, { loading: savingCatalogVariant }] = useMutation(M_CATALOG_VARIANT, {
    onCompleted: () => {
      message.success(t("admin_products.catalog_variant_saved"));
      void refetchConfiguration();
      onChanged();
    },
    onError: onErr,
  });
  const [loadMoves, { data: movesData, loading: movesLoading, called: movesCalled, refetch: refetchMoves }] = useLazyQuery(Q_MOVEMENTS, {
    fetchPolicy: "cache-first",
  });
  // การจองเปลี่ยนได้ทุกวินาที (บิลใหม่/ยกเลิก) — network-only เพื่อไม่ให้พนักงาน
  // เห็นรายชื่อบิลเก่าที่ปิดไปแล้วเวลากดดูซ้ำ
  const [loadReservations, { data: resvData, loading: resvLoading, error: resvError }] = useLazyQuery(Q_RESERVATIONS, {
    fetchPolicy: "network-only",
  });

  const [newVariantCode, setNewVariantCode] = useState("");
  const [newVariantName, setNewVariantName] = useState("");
  const [manualVariant, setManualVariant] = useState<Variant | null>(null);
  const [manualDelta, setManualDelta] = useState<number>(1);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  // undefined = ปิด · null = เปิดแบบรวมทุกไซซ์ · string = เปิดไซซ์นั้น
  const [reservedSize, setReservedSize] = useState<string | null | undefined>(undefined);
  const [bulkDraft, setBulkDraft] = useState<Record<string, number>>({});

  const totalAvailable = useMemo(
    () => product.variants.reduce((sum, variant) => sum + variant.available, 0),
    [product.variants]
  );
  const totalReserved = useMemo(
    () => product.variants.reduce((sum, variant) => sum + variant.reserved_stock, 0),
    [product.variants]
  );
  const totalOnHand = useMemo(
    () => product.variants.reduce((sum, variant) => sum + variant.current_stock, 0),
    [product.variants]
  );
  const totalQuarantine = useMemo(
    () => product.variants.reduce((sum, variant) => sum + variant.quarantine_stock, 0),
    [product.variants]
  );
  const totalInTransit = useMemo(
    () => product.variants.reduce((sum, variant) => sum + variant.inTransitQty, 0),
    [product.variants]
  );
  const totalTransferLost = useMemo(
    () => product.variants.reduce((sum, variant) => sum + variant.transferLostQty, 0),
    [product.variants]
  );
  const lowCount = useMemo(
    () => product.variants.filter((variant) => variant.low).length,
    [product.variants]
  );
  const resvSnapshot = resvData?.bmsVariantReservations ?? null;
  const moves: Movement[] = movesData?.bmsStockMovements || [];
  const visibleMoves = historyExpanded ? moves : moves.slice(0, 4);
  const ensureMovesLoaded = useCallback(() => {
    if (!movesCalled) void loadMoves({ variables: { sku: product.sku } });
  }, [loadMoves, movesCalled, product.sku]);

  const openReservations = useCallback((size: string | null) => {
    setReservedSize(size);
    void loadReservations({ variables: { sku: product.sku, size } });
  }, [loadReservations, product.sku]);

  const runAdjust = useCallback(async (
    locationId: string, size: string, delta: number, successText?: string
  ) => {
    if (!delta) return;
    await adjustStockMut({ variables: { sku: product.sku, locationId, size, delta } });
    message.success(successText || t("admin_products.stock_adjusted"));
    onChanged();
    if (movesCalled) void refetchMoves?.({ sku: product.sku });
  }, [adjustStockMut, movesCalled, onChanged, product.sku, refetchMoves, t]);

  const openBulkAdjust = () => {
    setBulkDraft(
      Object.fromEntries(product.variants.map((variant) => [`${variant.locationId}\u0000${variant.size}`, 0]))
    );
    setBulkOpen(true);
  };

  const variantCols = [
    {
      title: t("admin_products.col_branch"), key: "branch", width: 190,
      render: (_: unknown, variant: Variant) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{variant.locationName || "—"}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {variant.branchCode || "—"}
          </Typography.Text>
        </Space>
      ),
    },
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
      title: t("admin_products.col_variant_price"),
      key: "price",
      width: 190,
      render: (_: any, variant: Variant) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <InputNumber
            key={`${variant.size}:${variant.priceOverride ?? "default"}`}
            min={0}
            step={1}
            defaultValue={variant.priceOverride ?? undefined}
            placeholder={Number(product.price).toLocaleString()}
            addonAfter="฿"
            disabled={!canEdit || savingVariantPrice}
            style={{ width: 150 }}
            onBlur={async (event) => {
              const raw = event.target.value.trim().replace(/,/g, "");
              const value = raw === "" ? null : Number(raw);
              if (value != null && (!Number.isFinite(value) || value < 0)) return;
              if (value === variant.priceOverride) return;
              await setVariantPrice({
                variables: {
                  input: {
                    id: variant.basePackId,
                    productSku: product.sku,
                    size: variant.size,
                    packCode: "BASE",
                    unitName: "ชิ้น",
                    baseQty: 1,
                    price: value,
                    isBase: true,
                    active: true,
                  },
                },
              });
            }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {variant.priceOverride == null
              ? t("admin_products.variant_price_fallback", { amount: Number(variant.price).toLocaleString() })
              : t("admin_products.variant_price_override")}
          </Typography.Text>
        </div>
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
      render: (v: number, r: Variant) => {
        // ตัวเลขจองอธิบายตัวเองไม่ได้ — กดแล้วต้องบอกได้ว่าบิลไหนถือของอยู่
        // ซ่อนปุ่มเมื่อไม่มีสิทธิ์ order.view เพราะคำตอบมีชื่อ/เบอร์ลูกค้า
        if (v <= 0) {
          return <Typography.Text style={{ color: "#8c8c8c", fontWeight: 500 }}>{v}</Typography.Text>;
        }
        if (!canViewOrders) {
          // ไม่มีสิทธิ์: ต้องดูออกว่า "กดไม่ได้เพราะสิทธิ์" ตั้งแต่แรกเห็น ไม่ใช่กดแล้วเงียบ
          // แล้วเดาเองว่าพัง — ตัวเลขเปล่า + กุญแจ ไม่มีเส้นใต้ ไม่มีกรอบ
          return (
            <Tooltip title={t("admin_products.reserved_needs_order_view")}>
              <span style={{ color: "#ad6800", fontWeight: 500, whiteSpace: "nowrap" }}>
                {v} <LockOutlined style={{ fontSize: 10, color: "#bfbfbf" }} />
              </span>
            </Tooltip>
          );
        }
        // ตัวเลขสีเดียวกันแต่กดได้/กดไม่ได้ = คนอ่านไม่รู้ว่ากดได้ (ผู้ใช้รายงานว่า "กดไม่ได้"
        // ทั้งที่ปุ่มทำงาน) — ใส่เส้นใต้ + ไอคอน + พื้นอ่อน ให้เห็นว่าเป็นของกดได้จากการมองครั้งเดียว
        return (
          <Tooltip title={t("admin_products.reserved_who_hint")}>
            <Button
              type="link"
              size="small"
              icon={<TeamOutlined style={{ fontSize: 12 }} />}
              style={{
                padding: "0 6px",
                height: "auto",
                color: "#ad6800",
                fontWeight: 700,
                textDecoration: "underline",
                background: "#fff7e6",
                border: "1px solid #ffd591",
                borderRadius: 6,
              }}
              onClick={() => openReservations(r.size)}
            >
              {v}
            </Button>
          </Tooltip>
        );
      },
    },
    {
      title: t("admin_products.col_in_transit"), dataIndex: "inTransitQty", width: 110,
      align: "right" as const,
      render: (value: number) => value > 0 ? <Tag color="processing">{value}</Tag> : "0",
    },
    {
      title: t("admin_products.col_quarantine"), dataIndex: "quarantine_stock", width: 110,
      align: "right" as const,
      render: (value: number) => value > 0 ? <Tag color="error">{value}</Tag> : "0",
    },
    {
      title: t("admin_products.col_transfer_lost"), dataIndex: "transferLostQty", width: 120,
      align: "right" as const,
      render: (value: number) => value > 0 ? <Tag color="volcano">{value}</Tag> : "0",
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
                setReorder({ variables: {
                  sku: product.sku, locationId: r.locationId, size: r.size, rp,
                } });
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
              onClick={() => runAdjust(v.locationId, v.size, delta)}
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
    { title: t("admin_products.col_branch"), key: "branch", width: 170,
      render: (_: unknown, move: Movement) => move.location_name || move.branch_code || "—" },
    { title: "Size", dataIndex: "size", key: "size", width: 60 },
    { title: "Qty", dataIndex: "qty", key: "qty", width: 60, align: "right" as const },
    { title: "Order", dataIndex: "ref_order_id", key: "ref", width: 100,
      render: (o: string | null) => o ? <Typography.Text code>{o.slice(0, 8)}</Typography.Text> : "—" },
    { title: t("admin_products.col_actor"), dataIndex: "actor", key: "actor", render: (a: string | null) => a || "—" },
  ];

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
                {salesSurfaces.map((surface) => <Tag key={surface} color="geekblue" style={{ margin: 0 }}>{surface}</Tag>)}
              </Space>
              {readiness && !readiness.ready && (
                <Alert
                  type="warning"
                  showIcon
                  message={t("admin_products.publish_blocked")}
                  description={readiness.blockers.map((issue) => issue.message).join(" · ")}
                />
              )}
              {readiness?.ready && readiness.warnings.length > 0 && (
                <Alert
                  type="info"
                  showIcon
                  message={t("admin_products.publish_warnings")}
                  description={readiness.warnings.map((issue) => issue.message).join(" · ")}
                />
              )}
              {readiness?.recipeCostEstimate != null && (
                <Typography.Text type="secondary">
                  {readiness.recipeCostMaxEstimate != null
                    && readiness.recipeCostMaxEstimate !== readiness.recipeCostEstimate
                    ? t("admin_products.recipe_cost_range", {
                        min: readiness.recipeCostEstimate.toLocaleString(),
                        max: readiness.recipeCostMaxEstimate.toLocaleString(),
                      })
                    : t("admin_products.recipe_cost_estimate", { amount: readiness.recipeCostEstimate.toLocaleString() })}
                </Typography.Text>
              )}
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
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_products.stat_total_available")}</Typography.Text>
              <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: totalAvailable > 0 ? "#389e0d" : "#8c8c8c" }}>
                {totalAvailable}
              </div>
              {totalReserved > 0 && canViewOrders ? (
                // การ์ดนี้เป็นตัวเลขที่คนกดก่อนเสมอ (ผู้ใช้เล็งมาที่นี่สองครั้ง) — ต้องกดได้
                // และเปิดแบบรวมทุกไซซ์ ไม่ใช่บังคับให้ไปหาไซซ์ที่ถูกจองในตารางเอง
                <Tooltip title={t("admin_products.stat_reserved_hint_all")}>
                  <Button
                    type="link"
                    size="small"
                    icon={<TeamOutlined style={{ fontSize: 12 }} />}
                    style={{
                      padding: 0, height: "auto", fontSize: 12, fontWeight: 600,
                      color: "#ad6800", textDecoration: "underline",
                    }}
                    onClick={() => openReservations(null)}
                  >
                    {t("admin_products.stat_reserved", { n: totalReserved })}
                  </Button>
                </Tooltip>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t("admin_products.stat_reserved", { n: totalReserved })}
                </Typography.Text>
              )}
            </div>

            <div style={{ minWidth: 150, padding: "10px 14px", border: "1px solid #bae0ff", borderRadius: 12, background: "#e6f4ff" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("admin_products.stat_company_stock")}</Typography.Text>
              <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>
                {totalOnHand + totalQuarantine + totalInTransit}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {t("admin_products.stat_stock_breakdown", {
                  onHand: totalOnHand, transit: totalInTransit, quarantine: totalQuarantine,
                })}
              </Typography.Text>
              {totalTransferLost > 0 && (
                <Typography.Text type="danger" style={{ display: "block", fontSize: 11 }}>
                  {t("admin_products.stat_transfer_lost", { n: totalTransferLost })}
                </Typography.Text>
              )}
            </div>

            <div style={{ minWidth: 128, padding: "10px 14px", border: "1px solid #f0f0f0", borderRadius: 12, background: "#fff" }}>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>{t("admin_products.stat_status")}</Typography.Text>
              <Space direction="vertical" size={8}>
                <Switch checked={product.active} disabled={!canToggleActive} onChange={onToggleActive} />
                <Typography.Text style={{ fontSize: 12 }}>{product.active ? t("admin_products.status_enabled") : t("admin_products.status_disabled")}</Typography.Text>
              </Space>
            </div>

            <div style={{ display: "flex", alignItems: "center" }}>
              <Space direction="vertical">
                <Button icon={<EditOutlined />} type="primary" ghost disabled={!canEdit} onClick={onEdit}>
                  {t("admin_products.btn_edit_product")}
                </Button>
                <Button href={`/admin/stock-models?sku=${encodeURIComponent(product.sku)}`} disabled={!canEdit}>
                  {t("admin_products.btn_configure_stock_model")}
                </Button>
              </Space>
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

          <Space wrap size={8}>
            <Input
              placeholder={t("admin_products.variant_code_placeholder")}
              style={{ width: 145 }}
              value={newVariantCode}
              disabled={!canEdit}
              onChange={(event) => setNewVariantCode(event.target.value.toUpperCase())}
            />
            <Input
              placeholder={t("admin_products.variant_name_placeholder")}
              style={{ width: 180 }}
              value={newVariantName}
              disabled={!canEdit}
              onChange={(event) => setNewVariantName(event.target.value)}
            />
            <Button
              icon={<PlusOutlined />}
              loading={savingCatalogVariant}
              disabled={!canEdit || !newVariantCode.trim()}
              onClick={async () => {
                if (!newVariantCode.trim()) return;
                await saveCatalogVariant({ variables: { input: {
                  productSku: product.sku,
                  code: newVariantCode,
                  displayName: newVariantName.trim() || null,
                  active: true,
                  sortOrder: catalogVariants.length,
                } } });
                setNewVariantCode("");
                setNewVariantName("");
              }}
            >
              {t("admin_products.btn_add_catalog_variant")}
            </Button>
            <Button type="primary" ghost disabled={!canAdjust} onClick={openBulkAdjust}>
              {t("admin_products.btn_bulk_adjust")}
            </Button>
          </Space>
        </div>

        {catalogVariants.length > 0 && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #f5f5f5", background: "#fafafa" }}>
            <Space wrap size={8}>
              <Typography.Text type="secondary">{t("admin_products.label_catalog_variants")}:</Typography.Text>
              {catalogVariants.map((variant) => (
                <Tag key={variant.code} color={variant.active ? "blue" : "default"} style={{ margin: 0, padding: "3px 8px" }}>
                  <Space size={6}>
                    <span>{variant.displayName || variant.code}</span>
                    {variant.displayName && <Typography.Text type="secondary">({variant.code})</Typography.Text>}
                    <Switch
                      size="small"
                      checked={variant.active}
                      disabled={!canEdit || savingCatalogVariant}
                      onChange={(active) => void saveCatalogVariant({ variables: { input: {
                        productSku: product.sku,
                        code: variant.code,
                        displayName: variant.displayName,
                        active,
                        sortOrder: variant.sortOrder,
                      } } })}
                    />
                  </Space>
                </Tag>
              ))}
            </Space>
          </div>
        )}

        <Table
          rowKey={(variant: Variant) => `${variant.locationId}:${variant.size}`}
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
          await runAdjust(manualVariant.locationId, manualVariant.size, manualDelta);
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
            for (const [key, delta] of entries) {
              const [locationId, size] = key.split("\u0000");
              await adjustStockMut({ variables: {
                sku: product.sku, locationId, size, delta: Number(delta),
              } });
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
              key={`${variant.locationId}:${variant.size}`}
              style={{
                display: "grid",
                gridTemplateColumns: "180px 72px 1fr 140px",
                gap: 12,
                alignItems: "center",
              }}
            >
              <Typography.Text>{variant.locationName || variant.branchCode || "—"}</Typography.Text>
              <Typography.Text strong>{variant.size}</Typography.Text>
              <Typography.Text type="secondary">
                {t("admin_products.bulk_row_info", { available: variant.available, reserved: variant.reserved_stock })}
              </Typography.Text>
              <InputNumber
                value={bulkDraft[`${variant.locationId}\u0000${variant.size}`] ?? 0}
                onChange={(value) => setBulkDraft((prev) => ({
                  ...prev,
                  [`${variant.locationId}\u0000${variant.size}`]: Number(value) || 0,
                }))}
                style={{ width: "100%" }}
              />
            </div>
          ))}
        </Space>
      </Modal>

      <ReservedOrdersModal
        open={reservedSize !== undefined}
        sku={product.sku}
        size={reservedSize}
        // คำตอบของไซซ์ก่อนหน้าต้องไม่ถูกแสดงใต้หัวข้อของไซซ์ใหม่ — รายชื่อบิลผิดไซซ์
        // ที่หน้าเคาน์เตอร์คือคำตอบผิด ไม่ใช่แค่ภาพกระพริบ
        loading={resvLoading}
        data={
          resvSnapshot
          && resvSnapshot.sku === product.sku
          && (resvSnapshot.size ?? null) === (reservedSize ?? null)
            ? resvSnapshot
            : null
        }
        error={resvError ? resvError.message : null}
        onClose={() => setReservedSize(undefined)}
      />
    </div>
  );
}

// ---- Modal: ใครจองไซซ์นี้อยู่ -------------------------------
// ระบบไม่ได้เก็บว่าแต่ละหน่วยที่จองเป็นของบิลไหน (ไม่มี ledger ของการจอง) — หน้านี้
// ประกอบคำอธิบายกลับจากบิลที่ยังถือของอยู่ ส่วนที่อธิบายไม่ได้จึงต้องโชว์ตรง ๆ
function ReservedOrdersModal({
  open,
  sku,
  size,
  loading,
  data,
  error,
  onClose,
}: {
  open: boolean;
  sku: string;
  /** null = รวมทุกไซซ์ */
  size: string | null | undefined;
  loading: boolean;
  data: {
    sku: string;
    size: string | null;
    reservedTotal: number;
    attributedTotal: number;
    unattributed: number;
    overAttributed: number;
    orderCount: number;
    lineCount: number;
    orders: ReservationOrder[];
  } | null;
  error: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const orders = data?.orders ?? [];
  const truncated = (data?.lineCount ?? 0) > orders.length;

  const cols = [
    // ถามรวมทุกไซซ์แล้วไม่บอกไซซ์ = พนักงานไม่รู้ว่าของที่ถูกจองคือไซซ์ไหน
    ...(size ? [] : [{
      title: "Size",
      dataIndex: "size",
      key: "size",
      width: 80,
      render: (v: string) => <Typography.Text strong>{v}</Typography.Text>,
    }]),
    {
      title: t("admin_products.resv_col_order"),
      key: "order",
      render: (_: any, r: ReservationOrder) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong copyable={{ text: r.orderId }} style={{ fontSize: 12 }}>
            {r.orderId.slice(0, 8)}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {new Date(r.createdAt).toLocaleString()}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t("admin_products.resv_col_customer"),
      key: "customer",
      render: (_: any, r: ReservationOrder) => (
        <Space direction="vertical" size={0}>
          <Typography.Text style={{ fontSize: 13 }}>
            {r.customerName || r.customerRef || t("admin_products.resv_walkin")}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {[r.customerPhone, r.channel].filter(Boolean).join(" · ")}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t("admin_products.resv_col_qty"),
      dataIndex: "qty",
      key: "qty",
      align: "right" as const,
      width: 80,
      render: (v: number) => <Typography.Text strong style={{ color: "#ad6800" }}>{v}</Typography.Text>,
    },
    {
      title: t("admin_products.resv_col_status"),
      key: "status",
      render: (_: any, r: ReservationOrder) => (
        <Space size={4} wrap>
          <Tag color={r.status === "PENDING" ? "orange" : r.status === "PAID" ? "green" : "blue"} style={{ margin: 0 }}>
            {r.status}
          </Tag>
          {r.depositStatus && (
            <Tag color="gold" style={{ margin: 0 }}>{t("admin_products.resv_tag_deposit")}</Tag>
          )}
          {r.viaBundleSkus.length > 0 && (
            <Tooltip title={t("admin_products.resv_tag_bundle_hint", { sku: r.viaBundleSkus.join(", ") })}>
              <Tag color="purple" style={{ margin: 0 }}>{t("admin_products.resv_tag_bundle")}</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: t("admin_products.resv_col_branch"),
      key: "branch",
      render: (_: any, r: ReservationOrder) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {r.locationName || r.branchCode || "—"}
        </Typography.Text>
      ),
    },
  ];

  return (
    <Modal
      title={size
        ? t("admin_products.resv_title", { sku, size })
        : t("admin_products.resv_title_all", { sku })}
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("admin_products.resv_subtitle")}
        </Typography.Text>

        {data && (
          <Space size={8} wrap>
            <Tag color="orange" style={{ margin: 0 }}>
              {t("admin_products.resv_stat_reserved", { n: data.reservedTotal })}
            </Tag>
            <Tag style={{ margin: 0 }}>
              {t("admin_products.resv_stat_held", { n: data.attributedTotal, orders: data.orderCount })}
            </Tag>
            {data.unattributed > 0 && (
              <Tag color="red" style={{ margin: 0 }}>
                {t("admin_products.resv_stat_unattributed", { n: data.unattributed })}
              </Tag>
            )}
            {data.overAttributed > 0 && (
              <Tag color="red" style={{ margin: 0 }}>
                {t("admin_products.resv_stat_over", { n: data.overAttributed })}
              </Tag>
            )}
          </Space>
        )}

        {error && (
          // ล้มเหลวแล้วโชว์ตารางว่างคือการตอบว่า "ไม่มีใครจอง" ซึ่งผิดคนละเรื่องกับ "ยังไม่รู้"
          <Alert closable type="error" showIcon message={t("admin_products.resv_error")} description={error} />
        )}

        {data && data.unattributed > 0 && (
          <Alert closable
            type="warning"
            showIcon
            message={t("admin_products.resv_unattributed_title", { n: data.unattributed })}
            description={t("admin_products.resv_unattributed_desc")}
          />
        )}

        {data && data.overAttributed > 0 && (
          // ทิศทางตรงข้ามของ unattributed และอันตรายกว่า: ยอดจองในตารางต่ำกว่าที่บิลถือ
          // = ของที่ขายไปแล้วบนกระดาษยังโชว์ว่าพร้อมขาย ต้องเตือน ไม่ใช่ปัดให้เป็น 0 เงียบ ๆ
          <Alert closable
            type="error"
            showIcon
            message={t("admin_products.resv_over_title", { n: data.overAttributed })}
            description={t("admin_products.resv_over_desc")}
          />
        )}

        <Table<ReservationOrder>
          rowKey="orderId"
          size="small"
          loading={loading}
          dataSource={orders}
          columns={cols}
          pagination={false}
          scroll={{ x: "max-content", y: 360 }}
          locale={{ emptyText: loading || error || !data ? " " : t("admin_products.resv_empty") }}
        />

        {truncated && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("admin_products.resv_truncated", { shown: orders.length, total: data?.orderCount ?? 0 })}
          </Typography.Text>
        )}
      </Space>
    </Modal>
  );
}

export default function Page() {
  return <ProductsManagement />;
}
