'use client';
import { gql, useQuery, useMutation } from "@apollo/client";
import { Card, Input, InputNumber, Button, Space, Tag, message, Form, Divider, Typography, Select, Row, Col, Switch, Alert, Collapse } from "antd";
import { ShopOutlined, SaveOutlined, PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { localizedShopArchetypeOptions, onboardingChecklistKeysForArchetype, archetypeToBusinessType } from "@/lib/bms/shopArchetypes";
import { shopExperienceForArchetype } from "@/lib/bms/shopExperience";
import { CARRIER_CODES, CARRIER_LABELS } from "@/lib/bms/carriers/constants";
import { useI18n } from "@/lib/i18nContext";

const { Text } = Typography;

const Q = gql`
  query {
    bmsMyTenant { id name slug }
    bmsStoreProfile {
      businessArchetype businessArchetypeLocked businessType aiLanguage aiOrderingStyle aiRequiredFields aiInterpretShortReplies aiHandoffAfterFailedTurns
      receiptLanguageMode
      about address phone contactEmail website logoUrl taxId timezone country currency
      businessHours restaurantOrderHours restaurantOrdersPaused shippingPolicy returnPolicy
      paymentAccounts { type bankName accountName accountNo promptpayId note }
      shippingFlatRate shippingFreeThreshold shippingEstDaysMin shippingEstDaysMax
      enabledCarriers
      shippingMode shippingOriginProvince shippingOriginPostcode
      shippingZoneRates { zone fee }
      shippingWeightTiers { maxGrams surcharge }
      emailThemeColor emailFooterText
    }
  }
`;

const M_TENANT = gql`
  mutation ($name: String, $slug: String) {
    bmsUpdateMyTenant(name: $name, slug: $slug) { id name slug }
  }
`;
const M_PROFILE = gql`
  mutation ($input: BmsStoreProfileInput!) {
    bmsUpsertStoreProfile(input: $input) { about }
  }
`;

const PROFILE_KEYS = [
  "businessType", "aiLanguage", "aiOrderingStyle", "aiRequiredFields", "aiInterpretShortReplies",
  "receiptLanguageMode",
  "businessArchetype",
  "aiHandoffAfterFailedTurns", "about", "address", "phone", "contactEmail", "website", "logoUrl", "taxId",
  "timezone", "country", "currency", "businessHours", "restaurantOrderHours", "restaurantOrdersPaused", "shippingPolicy", "returnPolicy",
  "shippingFlatRate", "shippingFreeThreshold", "shippingEstDaysMin", "shippingEstDaysMax",
  "enabledCarriers",
  "shippingMode", "shippingOriginProvince", "shippingOriginPostcode",
  "emailThemeColor", "emailFooterText",
] as const;

const DEFAULT_EMAIL_THEME_COLOR = "#1677ff";

function SectionHeader({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <Space size={8} wrap>
      <Text strong style={{ fontSize: 13.5 }}>{children}</Text>
      {note && <Text type="secondary" style={{ fontSize: 12 }}>{note}</Text>}
    </Space>
  );
}

export default function StoreProfileCard() {
  const { t } = useI18n();
  const archetypeOptions = localizedShopArchetypeOptions(t);
  const SHIPPING_MODE_OPTIONS = [
    { value: "flat", label: t("admin_store_profile.shipping_mode_flat") },
    { value: "zone", label: t("admin_store_profile.shipping_mode_zone") },
    { value: "carrier", label: t("admin_store_profile.shipping_mode_carrier") },
  ];
  const ZONE_OPTIONS = [
    { value: "BANGKOK", label: t("admin_store_profile.zone_bangkok") },
    { value: "PERIMETER", label: t("admin_store_profile.zone_perimeter") },
    { value: "UPCOUNTRY", label: t("admin_store_profile.zone_upcountry") },
  ];

  const [form] = Form.useForm();
  const { data, loading, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [saveTenant, { loading: savingT }] = useMutation(M_TENANT);
  const [saveProfile, { loading: savingP }] = useMutation(M_PROFILE);
  const selectedArchetype = Form.useWatch("businessArchetype", form);
  const archetypeLocked = Boolean(data?.bmsStoreProfile?.businessArchetypeLocked);
  const checklistKeys = onboardingChecklistKeysForArchetype(selectedArchetype);
  const shopExperience = shopExperienceForArchetype(selectedArchetype);
  const highlightRestock = shopExperience.restockEmphasis;

  useEffect(() => {
    const tenantData = data?.bmsMyTenant;
    const p = data?.bmsStoreProfile;
    if (tenantData || p) {
      form.setFieldsValue({
        name: tenantData?.name || "",
        slug: tenantData?.slug || "",
        businessArchetype: p?.businessArchetype || undefined,
        businessType: p?.businessType || undefined,
        aiLanguage: p?.aiLanguage || "th",
        aiOrderingStyle: p?.aiOrderingStyle || "catalog_variant",
        aiRequiredFields: p?.aiRequiredFields || ["product", "size", "qty"],
        aiInterpretShortReplies: p?.aiInterpretShortReplies !== false,
        aiHandoffAfterFailedTurns: p?.aiHandoffAfterFailedTurns || 3,
        receiptLanguageMode: p?.receiptLanguageMode || "th",
        about: p?.about, address: p?.address, phone: p?.phone,
        contactEmail: p?.contactEmail, website: p?.website, logoUrl: p?.logoUrl, taxId: p?.taxId,
        timezone: p?.timezone, country: p?.country || undefined, currency: p?.currency || undefined,
        businessHours: p?.businessHours,
        restaurantOrderHours: p?.restaurantOrderHours || [],
        restaurantOrdersPaused: p?.restaurantOrdersPaused === true,
        shippingPolicy: p?.shippingPolicy, returnPolicy: p?.returnPolicy,
        paymentAccounts: (p?.paymentAccounts || []).map((a: any) => ({ ...a })),
        shippingFlatRate: p?.shippingFlatRate, shippingFreeThreshold: p?.shippingFreeThreshold,
        shippingEstDaysMin: p?.shippingEstDaysMin, shippingEstDaysMax: p?.shippingEstDaysMax,
        enabledCarriers: p?.enabledCarriers || [],
        shippingMode: p?.shippingMode || "flat",
        shippingOriginProvince: p?.shippingOriginProvince,
        shippingOriginPostcode: p?.shippingOriginPostcode,
        shippingZoneRates: (p?.shippingZoneRates || []).map((r: any) => ({ zone: r.zone, fee: r.fee })),
        shippingWeightTiers: (p?.shippingWeightTiers || []).map((wt: any) => ({ maxGrams: wt.maxGrams, surcharge: wt.surcharge })),
        emailThemeColor: p?.emailThemeColor || DEFAULT_EMAIL_THEME_COLOR, emailFooterText: p?.emailFooterText,
      });
    }
  }, [data, form]);

  const onFinish = async (v: any) => {
    try {
      // 1) ชื่อร้าน → bms_tenants (slug ปิดไม่ให้แก้ ส่ง null = คงค่าเดิม)
      await saveTenant({ variables: { name: v.name?.trim() || null, slug: null } });
      // 2) ข้อมูลร้านที่เหลือ → bms_store_profile
      const input: any = {};
      for (const k of PROFILE_KEYS) input[k] = v[k] ?? null;
      // Archetype is now the single visible driver, but older shops may have only the
      // legacy AI business type. Preserve that value until the operator actually picks
      // an archetype; saving an unrelated profile field must not silently reset AI context.
      input.businessType = v.businessArchetype
        ? archetypeToBusinessType(v.businessArchetype)
        : (v.businessType ?? null);
      input.paymentAccounts = (v.paymentAccounts || []).map((a: any) => ({
        type: a.type || "BANK", bankName: a.bankName ?? null, accountName: a.accountName ?? null,
        accountNo: a.accountNo ?? null, promptpayId: a.promptpayId ?? null, note: a.note ?? null,
      }));
      // Form.List rows can be half-filled while editing — drop those instead of
      // sending nulls the backend parser would silently discard anyway.
      input.shippingZoneRates = (v.shippingZoneRates || [])
        .filter((r: any) => r?.zone && r?.fee != null)
        .map((r: any) => ({ zone: r.zone, fee: Number(r.fee) }));
      input.shippingWeightTiers = (v.shippingWeightTiers || [])
        .filter((wt: any) => wt?.maxGrams != null && wt?.surcharge != null)
        .map((wt: any) => ({ maxGrams: Number(wt.maxGrams), surcharge: Number(wt.surcharge) }));
      await saveProfile({ variables: { input } });
      message.success(t("admin_store_profile.save_success"));
      refetch();
    } catch (e: any) {
      message.error(e?.message || t("admin_store_profile.save_failed"));
    }
  };

  return (
    <Card
      title={<Space><Tag color="green"><ShopOutlined /> {t("admin_store_profile.card_title")}</Tag><Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{t("admin_store_profile.card_subtitle")}</Text></Space>}
      loading={loading}
      style={{ marginBottom: 16 }}
    >
      <div style={{ maxWidth: 920 }}>
        <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
          {t("admin_store_profile.intro")}
        </Text>
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark="optional">
          {/* แต่ละหมวดเป็น Collapse panel — เดิมทั้ง 8 หมวดเรียงต่อกันเป็นฟอร์มยาวเดียว ต้องเลื่อนผ่าน
              ทุกหมวดแม้จะมาแก้แค่จุดเดียว (เช่น มาต่ออายุบัญชีรับเงินแต่ต้องเลื่อนผ่าน AI/ค่าส่งก่อน)
              forceRender เพื่อให้ทุก Form.Item ลงทะเบียนกับ form store ตั้งแต่แรก ไม่ต้องพึ่ง lazy-mount */}
          <Collapse
            defaultActiveKey={["shop-name"]}
            style={{ marginBottom: 20 }}
            items={[
              {
                key: "shop-name",
                forceRender: true,
                label: <SectionHeader>{t("admin_store_profile.section_shop_name")}</SectionHeader>,
                children: (
                  <Row gutter={16}>
                    <Col xs={24} md={14}>
                      <Form.Item name="name" label={t("admin_store_profile.shop_name_label")} rules={[{ required: true, message: t("admin_store_profile.shop_name_required") }]}>
                        <Input placeholder={t("admin_store_profile.shop_name_placeholder")} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={10}>
                      <Form.Item name="slug" label={t("admin_store_profile.slug_label")} tooltip={t("admin_store_profile.slug_tooltip")}>
                        <Input disabled addonBefore="/" />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "business-profile",
                forceRender: true,
                label: <SectionHeader note={t("admin_store_profile.section_business_profile_note")}>{t("admin_store_profile.section_business_profile")}</SectionHeader>,
                children: (
                  <>
                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item name="businessArchetype" label={t("admin_store_profile.shop_archetype_label")}>
                          <Select
                            allowClear
                            disabled={archetypeLocked}
                            placeholder={t("admin_store_profile.shop_archetype_placeholder")}
                            options={archetypeOptions}
                            onChange={(value) => form.setFieldValue(
                              "businessType",
                              value ? archetypeToBusinessType(value) : null
                            )}
                          />
                        </Form.Item>
                        <Form.Item name="businessType" hidden><Input /></Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Alert closable
                          type={shopExperience.specialMode === "NONE" ? "info" : "warning"}
                          showIcon
                          message={t(shopExperience.descriptionKey)}
                          description={shopExperience.specialMode === "NONE"
                            ? t("admin_store_profile.archetype_effect_desc")
                            : t(`admin_store_profile.special_mode_${shopExperience.specialMode.toLowerCase()}`)}
                        />
                      </Col>
                    </Row>
                    {archetypeLocked && (
                      <Alert closable
                        style={{ marginBottom: 12 }}
                        type="warning"
                        showIcon
                        message={t("admin_store_profile.archetype_locked_title")}
                        description={t("admin_store_profile.archetype_locked_desc")}
                      />
                    )}
                    {shopExperience.recommendedCapabilities.length > 0 && (
                      <Space wrap style={{ marginBottom: 12 }}>
                        <Text type="secondary">{t("admin_store_profile.recommended_capabilities")}</Text>
                        {shopExperience.recommendedCapabilities.map((capability) => (
                          <Tag key={capability}>{t(`admin_stock.cap_${capability.toLowerCase()}_title`)}</Tag>
                        ))}
                      </Space>
                    )}
                    <Alert closable
                      style={{ marginBottom: 4 }}
                      type={highlightRestock ? "success" : "info"}
                      showIcon
                      message={highlightRestock ? t("admin_store_profile.checklist_highlight_title") : t("admin_store_profile.checklist_default_title")}
                      description={
                        <div>
                          {checklistKeys.map((key) => <div key={key}>- {t(`admin_getting_started.${key}`)}</div>)}
                          {highlightRestock && (
                            <div style={{ marginTop: 8 }}>
                              - {t("admin_store_profile.checklist_restock_hint")} <b>/admin/restock-subscriptions</b> {t("admin_store_profile.checklist_restock_hint_end")}
                            </div>
                          )}
                        </div>
                      }
                    />
                  </>
                ),
              },
              {
                key: "receipt-language",
                forceRender: true,
                label: <SectionHeader note={t("admin_store_profile.section_receipt_language_note")}>{t("admin_store_profile.section_receipt_language")}</SectionHeader>,
                children: (
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item name="receiptLanguageMode" label={t("admin_store_profile.receipt_language_label")}>
                        <Select options={[
                          { value: "th", label: t("admin_store_profile.receipt_language_th") },
                          { value: "en", label: t("admin_store_profile.receipt_language_en") },
                          { value: "bilingual", label: t("admin_store_profile.receipt_language_bilingual") },
                        ]} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Alert closable type="info" showIcon message={t("admin_store_profile.receipt_language_help")} />
                    </Col>
                  </Row>
                ),
              },
              {
                key: "ai-context",
                forceRender: true,
                label: <SectionHeader note={t("admin_store_profile.section_ai_context_note")}>{t("admin_store_profile.section_ai_context")}</SectionHeader>,
                children: (
                  <>
                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item name="aiLanguage" label={t("admin_store_profile.ai_language_label")}>
                          <Select options={[
                            { value: "th", label: t("admin_store_profile.lang_th") },
                            { value: "en", label: t("admin_store_profile.lang_en") },
                            { value: "th-en", label: t("admin_store_profile.lang_th_en") },
                          ]} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="aiOrderingStyle" label={t("admin_store_profile.ai_ordering_style_label")}>
                          <Select options={[
                            { value: "catalog_variant", label: t("admin_store_profile.ordering_catalog_variant") },
                            { value: "simple_catalog", label: t("admin_store_profile.ordering_simple_catalog") },
                            { value: "inquiry_first", label: t("admin_store_profile.ordering_inquiry_first") },
                          ]} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="aiRequiredFields"
                          label={t("admin_store_profile.required_fields_label")}
                          rules={[{ required: true, message: t("admin_store_profile.required_fields_rule") }]}
                        >
                          <Select mode="multiple" options={[
                            { value: "product", label: t("admin_store_profile.field_product") },
                            { value: "size", label: t("admin_store_profile.field_size") },
                            { value: "qty", label: t("admin_store_profile.field_qty") },
                          ]} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={6}>
                        <Form.Item name="aiHandoffAfterFailedTurns" label={t("admin_store_profile.handoff_label")}>
                          <InputNumber min={1} max={10} addonAfter={t("admin_store_profile.handoff_addon")} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={6}>
                        <Form.Item name="aiInterpretShortReplies" label={t("admin_store_profile.interpret_short_replies_label")} valuePropName="checked">
                          <Switch checkedChildren={t("admin_store_profile.switch_on")} unCheckedChildren={t("admin_store_profile.switch_off")} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </>
                ),
              },
              {
                key: "contact-brand",
                forceRender: true,
                label: <SectionHeader>{t("admin_store_profile.section_contact_brand")}</SectionHeader>,
                children: (
                  <>
                    <Row gutter={16}>
                      <Col xs={24} sm={12} md={8}><Form.Item name="phone" label={t("admin_store_profile.phone_label")}><Input placeholder={t("admin_store_profile.phone_placeholder")} /></Form.Item></Col>
                      <Col xs={24} sm={12} md={8}><Form.Item name="contactEmail" label={t("admin_store_profile.contact_email_label")}><Input type="email" placeholder={t("admin_store_profile.contact_email_placeholder")} /></Form.Item></Col>
                      <Col xs={24} sm={12} md={8}><Form.Item name="website" label={t("admin_store_profile.website_label")}><Input placeholder="https://..." /></Form.Item></Col>
                      <Col xs={24} sm={12} md={12}><Form.Item name="logoUrl" label={t("admin_store_profile.logo_url_label")}><Input placeholder="https://.../logo.png" /></Form.Item></Col>
                      <Col xs={24} sm={12} md={12}><Form.Item name="taxId" label={t("admin_store_profile.tax_id_label")}><Input /></Form.Item></Col>
                    </Row>
                    <Row gutter={16}>
                      <Col xs={24} md={12}><Form.Item name="about" label={t("admin_store_profile.about_label")} style={{ marginBottom: 12 }}><Input.TextArea rows={3} /></Form.Item></Col>
                      <Col xs={24} md={12}><Form.Item name="address" label={t("admin_store_profile.address_label")} style={{ marginBottom: 12 }}><Input.TextArea rows={3} /></Form.Item></Col>
                    </Row>
                  </>
                ),
              },
              {
                key: "region",
                forceRender: true,
                label: <SectionHeader>{t("admin_store_profile.section_region")}</SectionHeader>,
                children: (
                  <Row gutter={16}>
                    <Col xs={12} md={6}>
                      <Form.Item name="country" label={t("admin_store_profile.country_label")}>
                        <Select allowClear placeholder={t("admin_store_profile.country_placeholder")} options={[
                          { value: "TH", label: t("admin_store_profile.country_th") },
                          { value: "AU", label: t("admin_store_profile.country_au") },
                          { value: "UK", label: t("admin_store_profile.country_uk") },
                        ]} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item name="currency" label={t("admin_store_profile.currency_label")}>
                        <Select allowClear placeholder={t("admin_store_profile.country_placeholder")} options={[
                          { value: "THB", label: t("admin_store_profile.currency_thb") },
                          { value: "AUD", label: "AUD" },
                          { value: "GBP", label: "GBP" },
                        ]} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={6}><Form.Item name="timezone" label={t("admin_store_profile.timezone_label")}><Input placeholder="Asia/Bangkok" /></Form.Item></Col>
                    <Col xs={24} md={6}><Form.Item name="businessHours" label={t("admin_store_profile.business_hours_label")}><Input placeholder={t("admin_store_profile.business_hours_placeholder")} /></Form.Item></Col>
                    {selectedArchetype === "restaurant" && <Col span={24}>
                      <Form.Item name="restaurantOrdersPaused" label={t("admin_store_profile.restaurant_pause_label")} valuePropName="checked">
                        <Switch checkedChildren={t("admin_store_profile.restaurant_paused")} unCheckedChildren={t("admin_store_profile.restaurant_accepting")} />
                      </Form.Item>
                      <Form.List name="restaurantOrderHours">
                        {(fields, { add, remove }) => <Space direction="vertical" style={{ width: "100%" }}>
                          <Text strong>{t("admin_store_profile.restaurant_hours_label")}</Text>
                          {fields.map((field) => <Space key={field.key} wrap>
                            <Form.Item {...field} name={[field.name, "day"]} rules={[{ required: true }]}>
                              <Select style={{ width: 150 }} placeholder={t("admin_store_profile.restaurant_day_placeholder")}
                                options={[0,1,2,3,4,5,6].map((day) => ({ value: day, label: t(`admin_store_profile.restaurant_day_${day}`) }))} />
                            </Form.Item>
                            <Form.Item {...field} name={[field.name, "open"]} rules={[{ required: true }]}><Input type="time" /></Form.Item>
                            <Form.Item {...field} name={[field.name, "close"]} rules={[{ required: true }]}><Input type="time" /></Form.Item>
                            <Button danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                          </Space>)}
                          <Button icon={<PlusOutlined />} onClick={() => add({ day: 1, open: "09:00", close: "21:00" })}>
                            {t("admin_store_profile.restaurant_add_hours")}
                          </Button>
                        </Space>}
                      </Form.List>
                    </Col>}
                  </Row>
                ),
              },
              {
                key: "policy",
                forceRender: true,
                label: <SectionHeader>{t("admin_store_profile.section_policy")}</SectionHeader>,
                children: (
                  <Row gutter={16}>
                    <Col xs={24} md={12}><Form.Item name="shippingPolicy" label={t("admin_store_profile.shipping_policy_label")} style={{ marginBottom: 12 }}><Input.TextArea rows={2} placeholder={t("admin_store_profile.shipping_policy_placeholder")} /></Form.Item></Col>
                    <Col xs={24} md={12}><Form.Item name="returnPolicy" label={t("admin_store_profile.return_policy_label")} style={{ marginBottom: 12 }}><Input.TextArea rows={2} /></Form.Item></Col>
                  </Row>
                ),
              },
              {
                key: "shipping",
                forceRender: true,
                label: <SectionHeader note={t("admin_store_profile.section_shipping_note")}>{t("admin_store_profile.section_shipping")}</SectionHeader>,
                children: (
                  <>
                    <Row gutter={16}>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name="shippingMode"
                          label={t("admin_store_profile.shipping_mode_label")}
                          tooltip={t("admin_store_profile.shipping_mode_tooltip")}
                        >
                          <Select options={SHIPPING_MODE_OPTIONS} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item name="shippingOriginProvince" label={t("admin_store_profile.origin_province_label")}>
                          <Input placeholder={t("admin_store_profile.origin_province_placeholder")} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={8}>
                        <Form.Item name="shippingOriginPostcode" label={t("admin_store_profile.origin_postcode_label")}>
                          <Input placeholder="10110" maxLength={5} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={16}>
                      <Col xs={12} md={6}><Form.Item name="shippingFlatRate" label={t("admin_store_profile.flat_rate_label")}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={12} md={6}><Form.Item name="shippingFreeThreshold" label={t("admin_store_profile.free_threshold_label")}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={12} md={6}><Form.Item name="shippingEstDaysMin" label={t("admin_store_profile.est_days_min_label")}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                      <Col xs={12} md={6}><Form.Item name="shippingEstDaysMax" label={t("admin_store_profile.est_days_max_label")}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
                    </Row>
                    <Form.Item
                      label={t("admin_store_profile.zone_rates_label")}
                      tooltip={t("admin_store_profile.zone_rates_tooltip")}
                      style={{ marginBottom: 8 }}
                    >
                      <Form.List name="shippingZoneRates">
                        {(fields, { add, remove }) => (
                          <Space direction="vertical" style={{ width: "100%" }} size={8}>
                            {fields.map((field) => (
                              <Space key={field.key} align="baseline" wrap>
                                <Form.Item name={[field.name, "zone"]} noStyle>
                                  <Select placeholder={t("admin_store_profile.zone_placeholder")} options={ZONE_OPTIONS} style={{ width: 160 }} />
                                </Form.Item>
                                <Form.Item name={[field.name, "fee"]} noStyle>
                                  <InputNumber min={0} placeholder={t("admin_store_profile.zone_fee_placeholder")} style={{ width: 140 }} />
                                </Form.Item>
                                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                              </Space>
                            ))}
                            <Button size="small" icon={<PlusOutlined />} onClick={() => add({ zone: undefined, fee: null })}>
                              {t("admin_store_profile.add_zone")}
                            </Button>
                          </Space>
                        )}
                      </Form.List>
                    </Form.Item>

                    <Form.Item
                      label={t("admin_store_profile.weight_tiers_label")}
                      tooltip={t("admin_store_profile.weight_tiers_tooltip")}
                      style={{ marginBottom: 8 }}
                    >
                      <Form.List name="shippingWeightTiers">
                        {(fields, { add, remove }) => (
                          <Space direction="vertical" style={{ width: "100%" }} size={8}>
                            {fields.map((field) => (
                              <Space key={field.key} align="baseline" wrap>
                                <Form.Item name={[field.name, "maxGrams"]} noStyle>
                                  <InputNumber min={1} placeholder={t("admin_store_profile.max_grams_placeholder")} style={{ width: 160 }} />
                                </Form.Item>
                                <Form.Item name={[field.name, "surcharge"]} noStyle>
                                  <InputNumber min={0} placeholder={t("admin_store_profile.surcharge_placeholder")} style={{ width: 140 }} />
                                </Form.Item>
                                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                              </Space>
                            ))}
                            <Button size="small" icon={<PlusOutlined />} onClick={() => add({ maxGrams: null, surcharge: null })}>
                              {t("admin_store_profile.add_weight_tier")}
                            </Button>
                          </Space>
                        )}
                      </Form.List>
                    </Form.Item>

                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name="enabledCarriers"
                          label={t("admin_store_profile.enabled_carriers_label")}
                          tooltip={t("admin_store_profile.enabled_carriers_tooltip")}
                          extra={t("admin_store_profile.enabled_carriers_extra")}
                        >
                          <Select
                            mode="multiple"
                            allowClear
                            placeholder={t("admin_store_profile.enabled_carriers_placeholder")}
                            options={CARRIER_CODES.map((c) => ({ value: c, label: CARRIER_LABELS[c] }))}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  </>
                ),
              },
              {
                key: "order-emails",
                forceRender: true,
                label: <SectionHeader note={t("admin_store_profile.section_order_emails_note")}>{t("admin_store_profile.section_order_emails")}</SectionHeader>,
                children: (
                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item name="emailThemeColor" label={t("admin_store_profile.email_theme_color_label")} tooltip={t("admin_store_profile.email_theme_color_tooltip")}>
                        <Input type="color" style={{ width: 64, height: 32, padding: 2, cursor: "pointer" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={16}>
                      <Form.Item name="emailFooterText" label={t("admin_store_profile.email_footer_label")}>
                        <Input placeholder={t("admin_store_profile.email_footer_placeholder")} maxLength={300} />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "payment-accounts",
                forceRender: true,
                label: <SectionHeader note={t("admin_store_profile.section_payment_accounts_note")}>{t("admin_store_profile.section_payment_accounts")}</SectionHeader>,
                children: (
                  <Form.List name="paymentAccounts">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map((field) => (
                          <Row key={field.key} gutter={8} align="middle" style={{ marginBottom: 8 }}>
                            <Col xs={24} sm={5}>
                              <Form.Item name={[field.name, "type"]} noStyle initialValue="BANK">
                                <Select style={{ width: "100%" }} options={[
                                  { value: "BANK", label: t("admin_store_profile.account_type_bank") },
                                  { value: "PROMPTPAY", label: t("admin_store_profile.account_type_promptpay") },
                                  { value: "OTHER", label: t("admin_store_profile.account_type_other") },
                                ]} />
                              </Form.Item>
                            </Col>
                            <Col xs={12} sm={4}><Form.Item name={[field.name, "bankName"]} noStyle><Input placeholder={t("admin_store_profile.bank_name_placeholder")} /></Form.Item></Col>
                            <Col xs={12} sm={5}><Form.Item name={[field.name, "accountName"]} noStyle><Input placeholder={t("admin_store_profile.account_name_placeholder")} /></Form.Item></Col>
                            <Col xs={12} sm={5}><Form.Item name={[field.name, "accountNo"]} noStyle><Input placeholder={t("admin_store_profile.account_no_placeholder")} /></Form.Item></Col>
                            <Col xs={10} sm={4}><Form.Item name={[field.name, "promptpayId"]} noStyle><Input placeholder={t("admin_store_profile.promptpay_placeholder")} /></Form.Item></Col>
                            <Col xs={2} sm={1} style={{ textAlign: "center" }}>
                              <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                            </Col>
                          </Row>
                        ))}
                        <Button type="dashed" onClick={() => add({ type: "BANK" })} icon={<PlusOutlined />} block style={{ marginTop: 4 }}>
                          {t("admin_store_profile.add_account")}
                        </Button>
                      </>
                    )}
                  </Form.List>
                ),
              },
            ]}
          />

          <Divider style={{ margin: "4px 0 16px" }} />
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} size="large" loading={savingT || savingP}>
            {t("admin_store_profile.save_btn")}
          </Button>
        </Form>
      </div>
    </Card>
  );
}
