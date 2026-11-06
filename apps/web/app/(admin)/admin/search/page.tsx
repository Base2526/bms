"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Input,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  BookOutlined,
  LockOutlined,
  SearchOutlined,
} from "@ant-design/icons";

import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import { useSessionCtx } from "@/lib/session-context";
import { resolveBilingual, type Bilingual } from "@/lib/static-page-i18n";
import {
  SYSTEM_CAPABILITIES,
  SYSTEM_GUIDES,
  capabilityStatusFilterForQuery,
  isBroadCapabilityQuery,
  listAssistantCapabilities,
  searchAssistantKnowledge,
  type AssistantLocale,
  type AssistantKnowledgeResult,
  type CapabilityStatus,
} from "@/lib/bms/assistantKnowledge";

const { Title, Paragraph, Text } = Typography;

type SearchCopy = {
  title: string;
  subtitle: string;
  placeholder: string;
  search: string;
  verified: string;
  broadTitle: string;
  broadDesc: string;
  results: string;
  capability: string;
  guide: string;
  limitation: string;
  details: string;
  prerequisites: string;
  steps: string;
  warnings: string;
  open: string;
  noAccess: string;
  noResults: string;
  startTitle: string;
  suggestions: readonly string[];
  status: Record<CapabilityStatus, string>;
};

const COPY: Bilingual<SearchCopy> = {
  th: {
    title: "ค้นหาความรู้ BMS",
    subtitle: "ค้นหาความสามารถที่ระบบรองรับ คู่มือ ขั้นตอนตั้งค่า และข้อจำกัดจากเอกสารที่ตรวจสอบแล้ว",
    placeholder: "เช่น รองรับระบบอะไรบ้าง, โอนสต็อกข้ามสาขา, ออกใบกำกับภาษี",
    search: "ค้นหา",
    verified: "ข้อมูลจาก capability และคู่มือที่ตรวจสอบแล้ว — ไม่ใช่คำตอบที่ AI เดา",
    broadTitle: "ความสามารถที่ BMS รองรับ",
    broadDesc: "รายการนี้บอกความสามารถของผลิตภัณฑ์ ไม่ได้ยืนยันว่าร้านปัจจุบันเปิดหรือตั้งค่าไว้แล้ว",
    results: "ผลการค้นหา",
    capability: "ความสามารถ",
    guide: "คู่มือ",
    limitation: "ข้อจำกัดสำคัญ",
    details: "ดูรายละเอียดวิธีทำ",
    prerequisites: "ก่อนเริ่ม",
    steps: "ขั้นตอน",
    warnings: "ข้อควรระวัง",
    open: "เปิดหน้าที่เกี่ยวข้อง",
    noAccess: "บัญชีนี้ไม่มีสิทธิ์เปิดหน้านี้",
    noResults: "ยังไม่พบ capability หรือคู่มือที่ตรง ลองใช้ชื่อเมนู งานที่ต้องการทำ หรือคำสั้นลง",
    startTitle: "ลองค้นหาด้วยภาษาที่ใช้ทำงานจริง",
    suggestions: [
      "รองรับระบบอะไรบ้าง",
      "รองรับร้านอาหารไหม",
      "โอนสต็อกข้ามสาขา",
      "ออกใบกำกับภาษีได้ไหม",
      "เชื่อม LINE และ Facebook",
      "POS คืนสินค้าทำอย่างไร",
    ],
    status: {
      AVAILABLE: "พร้อมใช้",
      CONDITIONAL: "ต้องตั้งค่า",
      BETA: "Beta",
      MOCK: "ตัวอย่างเท่านั้น",
      UNAVAILABLE: "ยังไม่รองรับ",
    } satisfies Record<CapabilityStatus, string>,
  },
  en: {
    title: "Search BMS knowledge",
    subtitle: "Find supported capabilities, setup instructions, guides, and verified limitations.",
    placeholder: "e.g. What does BMS support, branch stock transfer, tax invoices",
    search: "Search",
    verified: "Results come from the verified capability and guide catalogs — not an AI guess.",
    broadTitle: "Capabilities supported by BMS",
    broadDesc: "This is a product capability inventory. It does not prove that the current shop has enabled or configured each item.",
    results: "Search results",
    capability: "Capability",
    guide: "Guide",
    limitation: "Important limitation",
    details: "View instructions",
    prerequisites: "Before you start",
    steps: "Steps",
    warnings: "Important",
    open: "Open related page",
    noAccess: "This account cannot open this page",
    noResults: "No verified capability or guide matched. Try a menu name, a task, or a shorter phrase.",
    startTitle: "Try the words you use while working",
    suggestions: [
      "What does BMS support",
      "Does it support restaurants",
      "Branch stock transfer",
      "Can I issue a tax invoice",
      "Connect LINE and Facebook",
      "How do I return a POS sale",
    ],
    status: {
      AVAILABLE: "Available",
      CONDITIONAL: "Configuration required",
      BETA: "Beta",
      MOCK: "Example only",
      UNAVAILABLE: "Not supported",
    } satisfies Record<CapabilityStatus, string>,
  },
} as const;

const STATUS_COLOR: Record<CapabilityStatus, string> = {
  AVAILABLE: "green",
  CONDITIONAL: "gold",
  BETA: "blue",
  MOCK: "default",
  UNAVAILABLE: "red",
};

export default function AdminKnowledgeSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lang } = useI18n();
  const { admin } = useSessionCtx();
  const { perms, loading: permissionsLoading } = useBmsPermissions();
  const locale: AssistantLocale = lang === "en" ? "en" : "th";
  const c = resolveBilingual(COPY, locale);
  const urlQuery = (searchParams?.get("q") || "").trim();
  const [query, setQuery] = useState(urlQuery);

  useEffect(() => setQuery(urlQuery), [urlQuery]);

  const searchContext = useMemo(() => ({
    locale,
    permissions: new Set(perms),
    role: admin?.role ?? null,
    isPlatformAdmin: admin?.is_platform_admin === true,
  }), [admin?.is_platform_admin, admin?.role, locale, perms]);

  const broad = isBroadCapabilityQuery(urlQuery, locale);
  const capabilityStatusFilter = capabilityStatusFilterForQuery(urlQuery, locale);
  const results = useMemo<AssistantKnowledgeResult[]>(() => {
    if (!urlQuery) return [];
    if (broad) {
      const inventory = listAssistantCapabilities(searchContext);
      return capabilityStatusFilter
        ? inventory.filter((result) => result.capabilityStatus === capabilityStatusFilter)
        : inventory;
    }
    const matched = searchAssistantKnowledge(urlQuery, {
      ...searchContext,
      limit: 32,
    }).filter((result) => result.matchedQuery);
    // Present the best capability first (what BMS supports), then the best guide (how to do it),
    // followed by secondary matches in their relevance order. Do not group every capability ahead
    // of the guide: a broad English token such as “product” can match several capabilities and
    // would otherwise push the useful instructions below the first row.
    const primaryCapability = matched.find((result) => result.kind === "capability");
    const primaryGuide = matched.find((result) => result.kind === "guide");
    const primaryIds = new Set([primaryCapability, primaryGuide].filter(Boolean).map((result) => `${result!.kind}:${result!.id}`));
    return [primaryCapability, primaryGuide, ...matched.filter((result) => !primaryIds.has(`${result.kind}:${result.id}`))]
      .filter((result): result is AssistantKnowledgeResult => Boolean(result));
  }, [broad, capabilityStatusFilter, searchContext, urlQuery]);
  const firstGuideIndex = results.findIndex((result) => result.kind === "guide");

  const capabilityById = useMemo(
    () => new Map(SYSTEM_CAPABILITIES.map((entry) => [entry.id, entry] as const)),
    []
  );
  const guideById = useMemo(
    () => new Map(SYSTEM_GUIDES.map((entry) => [entry.id, entry] as const)),
    []
  );
  function submit(next = query) {
    const value = next.trim();
    if (!value) return;
    setQuery(value);
    router.push(`/admin/search?q=${encodeURIComponent(value)}`);
  }

  return (
    <div data-admin-knowledge-search style={{ maxWidth: 1180, margin: "0 auto" }}>
      <Space direction="vertical" size={18} style={{ width: "100%" }}>
        <div>
          <Title level={2} style={{ marginBottom: 6 }}>
            <SearchOutlined /> {c.title}
          </Title>
          <Paragraph type="secondary" style={{ margin: 0, fontSize: 15 }}>
            {c.subtitle}
          </Paragraph>
        </div>

        <Card style={{ borderRadius: 18 }}>
          <Input.Search
            allowClear
            autoFocus
            size="large"
            value={query}
            placeholder={c.placeholder}
            enterButton={c.search}
            onChange={(event) => setQuery(event.target.value)}
            onSearch={submit}
          />
          <Alert
            closable
            type="info"
            showIcon
            message={c.verified}
            style={{ marginTop: 14, borderRadius: 12 }}
          />
        </Card>

        {!urlQuery ? (
          <Card title={c.startTitle} style={{ borderRadius: 18 }}>
            <Space wrap>
              {c.suggestions.map((suggestion) => (
                <Button key={suggestion} onClick={() => submit(suggestion)}>
                  {suggestion}
                </Button>
              ))}
            </Space>
          </Card>
        ) : (
          <>
            <div>
              <Title level={4} style={{ margin: 0 }}>
                {broad
                  ? capabilityStatusFilter ? c.status[capabilityStatusFilter] : c.broadTitle
                  : c.results} ({results.length})
              </Title>
              {broad ? <Text type="secondary">{c.broadDesc}</Text> : null}
            </div>

            <Spin spinning={permissionsLoading}>
              {results.length === 0 ? (
                <Empty description={c.noResults} />
              ) : (
                <Row gutter={[14, 14]}>
                  {results.map((result, index) => {
                    const capability = result.kind === "capability" ? capabilityById.get(result.id) : undefined;
                    const guide = result.kind === "guide" ? guideById.get(result.id) : undefined;
                    const limitation = capability?.limitations[locale];
                    return (
                      <Col xs={24} lg={12} key={`${result.kind}:${result.id}`}>
                        <Card
                          data-knowledge-result={`${result.kind}:${result.id}`}
                          style={{ height: "100%", borderRadius: 16 }}
                          styles={{ body: { height: "100%", display: "flex", flexDirection: "column" } }}
                        >
                          <Space wrap style={{ marginBottom: 10 }}>
                            <Tag icon={result.kind === "capability" ? <AppstoreOutlined /> : <BookOutlined />} color={result.kind === "capability" ? "blue" : "purple"}>
                              {result.kind === "capability" ? c.capability : c.guide}
                            </Tag>
                            {result.capabilityStatus ? (
                              <Tag color={STATUS_COLOR[result.capabilityStatus]}>
                                {c.status[result.capabilityStatus]}
                              </Tag>
                            ) : null}
                          </Space>

                          <Title level={4} style={{ margin: "0 0 8px" }}>{result.title}</Title>
                          <Paragraph style={{ marginBottom: 10 }}>{result.summary}</Paragraph>

                          {limitation ? (
                            <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 14 }}>
                              <Text strong>{c.limitation}: </Text>{limitation}
                            </Paragraph>
                          ) : null}

                          {guide ? (
                            <Collapse
                              ghost
                              size="small"
                              defaultActiveKey={!broad && index === firstGuideIndex ? ["details"] : []}
                              style={{ margin: "0 0 14px" }}
                              items={[{
                                key: "details",
                                label: c.details,
                                children: (
                                  <div data-knowledge-details={guide.id}>
                                    {guide.prerequisites[locale].length > 0 ? (
                                      <section>
                                        <Text strong>{c.prerequisites}</Text>
                                        <ul style={{ marginTop: 6, paddingInlineStart: 22 }}>
                                          {guide.prerequisites[locale].map((item) => <li key={item}>{item}</li>)}
                                        </ul>
                                      </section>
                                    ) : null}
                                    <section>
                                      <Text strong>{c.steps}</Text>
                                      <ol style={{ marginTop: 6, paddingInlineStart: 22 }}>
                                        {guide.steps[locale].map((item) => <li key={item}>{item}</li>)}
                                      </ol>
                                    </section>
                                    {guide.warnings[locale].length > 0 ? (
                                      <section>
                                        <Text strong>{c.warnings}</Text>
                                        <ul style={{ marginTop: 6, marginBottom: 0, paddingInlineStart: 22 }}>
                                          {guide.warnings[locale].map((item) => <li key={item}>{item}</li>)}
                                        </ul>
                                      </section>
                                    ) : null}
                                  </div>
                                ),
                              }]}
                            />
                          ) : null}

                          <div style={{ marginTop: "auto" }}>
                            {result.route && result.accessible ? (
                              <Link href={result.route}>
                                <Button type="primary" icon={<ArrowRightOutlined />}>
                                  {c.open}
                                </Button>
                              </Link>
                            ) : result.route ? (
                              <Tag icon={<LockOutlined />} color="default">{c.noAccess}</Tag>
                            ) : null}
                          </div>
                        </Card>
                      </Col>
                    );
                  })}
                </Row>
              )}
            </Spin>
          </>
        )}
      </Space>
    </div>
  );
}
