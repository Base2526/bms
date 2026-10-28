"use client";

import { useEffect, useMemo, useState } from "react";
import { gql, useQuery } from "@apollo/client";
import { Alert, Button, Card, Col, Row, Skeleton, Space, Tag, Typography } from "antd";
import Link from "next/link";
import {
  AndroidFilled,
  AppleFilled,
  ApiOutlined,
  AuditOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  DownloadOutlined,
  FacebookFilled,
  GlobalOutlined,
  InboxOutlined,
  InstagramFilled,
  LockOutlined,
  MessageOutlined,
  MobileOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  RocketOutlined,
  SafetyOutlined,
  ShareAltOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  TikTokFilled,
  UserOutlined,
} from "@ant-design/icons";
import { useSessionCtx } from "@/lib/session-context";
import { useI18n } from "@/lib/i18nContext";
import BmsFlowDiagram from "@/components/marketing/flow/BmsFlowDiagram";
import PlanAiChangeNotice from "@/components/billing/PlanAiChangeNotice";
import { LineIcon } from "@/components/marketing/LineOa";
import { BMS_LINE_OA_URL } from "@/lib/bms/lineOfficialAccount";
import styles from "./page.module.css";

const { Title, Paragraph, Text } = Typography;

const Q_PLANS = gql`
  query {
    bmsPublicPlans {
      code
      name
      price_monthly
      price_yearly
      max_products
      max_channels
      max_branches
      max_devices
      max_orders_month
      max_users
      ai_credits_monthly
      ai_credits_next_monthly
      ai_credits_change_at
      feature_keys
    }
  }
`;

const CHANNELS = [
  { label: "LINE", className: styles.channelLine, icon: <MessageOutlined /> },
  { label: "TikTok", className: styles.channelTikTok, icon: <TikTokFilled /> },
  { label: "Facebook", className: styles.channelFacebook, icon: <FacebookFilled /> },
  { label: "Instagram", className: styles.channelInstagram, icon: <InstagramFilled /> },
  { label: "Website", className: styles.channelWebsite, icon: <GlobalOutlined /> },
];

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function buildSafetyPoints(t: Translate) {
  return [
  {
    icon: <DatabaseOutlined />,
    title: t("landing.safety.tenant.title"),
    description: t("landing.safety.tenant.description"),
  },
  {
    icon: <LockOutlined />,
    title: t("landing.safety.rbac.title"),
    description: t("landing.safety.rbac.description"),
  },
  {
    icon: <UserOutlined />,
    title: t("landing.safety.human.title"),
    description: t("landing.safety.human.description"),
  },
  ];
}

const lim = (value: number, t: Translate) => (value < 0 ? t("landing.unlimited") : value.toLocaleString());

type PublicPlan = {
  code: string;
  name: string;
  price_monthly: number;
  price_yearly: number;
  max_products: number;
  max_channels: number;
  max_branches: number;
  max_devices: number;
  max_orders_month: number;
  max_users: number;
  ai_credits_monthly: number;
  ai_credits_next_monthly?: number | null;
  ai_credits_change_at?: string | null;
  feature_keys?: string[];
};

function PlanComparison({
  plans,
  t,
  ctaHref,
  ctaLabel,
}: {
  plans: PublicPlan[];
  t: Translate;
  ctaHref: string;
  ctaLabel: string;
}) {
  const limits: Array<{ label: string; field: keyof Pick<PublicPlan,
    "max_products" | "max_orders_month" | "max_users" | "max_branches" | "max_devices" | "max_channels"> }> = [
    { label: t("landing.productLimit"), field: "max_products" },
    { label: t("landing.orderLimit"), field: "max_orders_month" },
    { label: t("landing.teamLimit"), field: "max_users" },
    { label: t("package_metrics.branches"), field: "max_branches" },
    { label: t("package_metrics.devices"), field: "max_devices" },
    { label: t("package_metrics.channels"), field: "max_channels" },
  ];
  const features = [
    { label: t("admin_billing.features_core"), key: null },
    { label: t("admin_billing.feature_report_schedule"), key: "REPORT_SCHEDULE" },
    { label: t("admin_billing.feature_retention_engine"), key: "RETENTION_ENGINE" },
  ];
  const highlight = (plan: PublicPlan) => plan.code === "pro" ? styles.planRecommended : undefined;
  const pendingChanges = plans.filter(plan => plan.ai_credits_next_monthly != null && plan.ai_credits_change_at);
  return (
    <>
      <div className={styles.planTableScroll} role="region" aria-label={t("landing.planComparison")} tabIndex={0}>
        <table className={styles.planTable} aria-label={t("landing.planComparison")}>
          <thead>
            <tr>
              <th scope="col">{t("landing.monthlyPlans")}</th>
              {plans.map(plan => (
                <th scope="col" key={plan.code} className={highlight(plan)}>
                  <div className={styles.planBadgeSlot}>
                    {plan.code === "pro" && <span className={styles.planBadge}>{t("landing.recommended")}</span>}
                  </div>
                  <span className={styles.planName}>{plan.name}</span>
                  <div className={styles.planPrice}>
                    {plan.code === "enterprise" && <span className={styles.planPricePrefix}>{t("landing.startingAt")}</span>}
                    {plan.price_monthly > 0 ? Number(plan.price_monthly).toLocaleString() : t("landing.free")}
                  </div>
                  <span className={styles.planUnit}>{plan.price_monthly > 0 ? t("landing.perMonth") : "\u00a0"}</span>
                  {plan.price_yearly > 0 && (
                    <span className={styles.planAnnual}>
                      {plan.code === "enterprise" ? t("landing.annualFrom") : t("landing.annualPrice")}{" "}
                      {Number(plan.price_yearly).toLocaleString()} {t("landing.perYear")}
                      {plan.code !== "enterprise" && <> · {t("landing.annualAverage", { count: Math.round(plan.price_yearly / 12).toLocaleString() })}</>}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t("landing.monthlyAi")}</th>
              {plans.map(plan => (
                <td key={plan.code} className={highlight(plan)}>
                  {plan.ai_credits_monthly < 0 ? t("admin.ai_unlimited") : t("admin_billing.points_per_month", {
                    count: Number(plan.ai_credits_monthly).toLocaleString("en-US"),
                  })}
                </td>
              ))}
            </tr>
            {limits.map(({ label, field }) => (
              <tr key={field}>
                <th scope="row">{label}</th>
                {plans.map(plan => <td key={plan.code} className={highlight(plan)}>{lim(plan[field], t)}</td>)}
              </tr>
            ))}
            {features.map(({ label, key }) => (
              <tr key={key ?? "core"}>
                <th scope="row">{label}</th>
                {plans.map(plan => {
                  const included = plan.feature_keys ? key === null || plan.feature_keys.includes(key) : null;
                  return (
                    <td key={plan.code} className={highlight(plan)}>
                      <span className={included ? styles.planIncluded : styles.planUnavailable}
                        aria-label={included === null ? t("landing.planUnknown") : included ? t("landing.planIncluded") : t("landing.planExcluded")}>
                        {included === null ? "…" : included ? "✓" : "—"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row"><span className={styles.srOnly}>{t("landing.startUsing")}</span></th>
              {plans.map(plan => (
                <td key={plan.code} className={highlight(plan)}>
                  {plan.code === "enterprise" ? (
                    <a href={BMS_LINE_OA_URL} className={styles.planCta} target="_blank" rel="noreferrer">
                      <Button block size="large">{t("landing.contactSales")}</Button>
                    </a>
                  ) : (
                    <Link href={ctaHref} className={styles.planCta}>
                      <Button type={plan.code === "pro" ? "primary" : "default"} block size="large">{ctaLabel}</Button>
                    </Link>
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={styles.planScrollHint}>{t("landing.planScrollHint")}</p>
      {plans.some(plan => plan.code === "enterprise") && <p className={styles.enterpriseTerms}>{t("landing.enterpriseTerms")}</p>}
      {pendingChanges.length > 0 && (
        <div className={styles.planNotices}>
          {pendingChanges.map(plan => (
            <div key={plan.code}><strong>{plan.name}</strong><PlanAiChangeNotice plan={plan} /></div>
          ))}
        </div>
      )}
    </>
  );
}

function PackageActions({ lang, t, disabled }: { lang: "th" | "en"; t: Translate; disabled: boolean }) {
  const [shareStatus, setShareStatus] = useState<"" | "shared" | "copied" | "failed">("");
  const shareLatest = async () => {
    const url = `${window.location.origin}${window.location.pathname}#pricing`;
    setShareStatus("");
    try {
      if (navigator.share) {
        await navigator.share({ title: t("landing.packageShareTitle"), text: t("landing.packageShareText"), url });
        setShareStatus("shared");
        return;
      }
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else {
        const input = document.createElement("textarea");
        input.value = url;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        if (!document.execCommand("copy")) throw new Error("COPY_FAILED");
        input.remove();
      }
      setShareStatus("copied");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareStatus("failed");
    }
  };
  const status = shareStatus ? t(`landing.packageShareStatus.${shareStatus}`) : "";
  return (
    <div className={styles.packageActions}>
      <Button href={`/api/public/packages/pdf?lang=${lang}`} disabled={disabled} icon={<DownloadOutlined />}>
        {t("landing.downloadPackagesPdf")}
      </Button>
      <Button disabled={disabled} icon={<ShareAltOutlined />} onClick={() => void shareLatest()}>
        {t("landing.sharePackages")}
      </Button>
      <span className={shareStatus === "failed" ? styles.packageActionError : styles.packageActionStatus} aria-live="polite">{status}</span>
    </div>
  );
}

export default function HomePage() {
  const { admin, loading: sessionLoading } = useSessionCtx();
  const { t, lang } = useI18n();
  const [appDownloads, setAppDownloads] = useState({ androidUrl: "", iosUrl: "" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/app-downloads", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((settings) => { if (settings) setAppDownloads(settings); })
      .catch(() => { /* Keep unconfigured buttons on this page if settings cannot load. */ });
    return () => controller.abort();
  }, []);
  const { data, loading, error } = useQuery(Q_PLANS, { fetchPolicy: "cache-and-network" });
  const plans: PublicPlan[] = data?.bmsPublicPlans || [];
  const safetyPoints = useMemo(() => buildSafetyPoints(t), [t]);

  const primaryCta = !sessionLoading && admin
    ? { href: "/admin/dashboard", label: t("landing.goToDashboard") }
    : { href: "/shop-signup", label: t("landing.startFree") };
  const planCta = !sessionLoading && admin
    ? { href: "/admin/dashboard", label: t("landing.manageStore") }
    : { href: "/shop-signup", label: t("landing.startUsing") };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <Tag color="blue" icon={<ShopOutlined />} className={styles.heroTag}>{t("landing.badge")}</Tag>
          <Title className={styles.heroTitle}>
            {t("landing.heroTitle")}<br />
            <span>{t("landing.heroAccent")}</span>
          </Title>
          <Paragraph className={styles.heroDescription}>
            {t("landing.heroDescription")}
          </Paragraph>
          <Space size={12} wrap>
            {!admin && (
              <Link href="/demo">
                <Button type="primary" size="large" icon={<MessageOutlined />}>{t("landing.tryDemo")}</Button>
              </Link>
            )}
            <Link href={primaryCta.href}>
              <Button type={admin ? "primary" : "default"} size="large" icon={<RocketOutlined />}>{primaryCta.label}</Button>
            </Link>
            <Button size="large" icon={<PlayCircleOutlined />} href="#workflow">{t("landing.viewWorkflow")}</Button>
          </Space>
          <div className={styles.channels} aria-label={t("landing.supportedChannels")}>
            {CHANNELS.map((channel) => (
              <span key={channel.label} className={`${styles.channel} ${channel.className}`}>
                {channel.icon}{channel.label}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.heroVisual} aria-label={t("landing.storyAria")}>
          <div className={styles.storyHeader}>
            <span><ApiOutlined /> {t("landing.storyTitle")}</span>
            <Tag color="success">{t("landing.liveWorkflow")}</Tag>
          </div>
          <div className={styles.customerBubble}>
            <div className={styles.bubbleIcon}>
              <MessageOutlined />
            </div>
            <span>
              <strong>{t("landing.sampleMessage")}</strong>
              <small>{t("landing.newMessage")}</small>
            </span>
          </div>
          <div className={styles.storyFlow}>
            <span>
              <RobotOutlined />
              <strong>{t("landing.understand")}</strong>
            </span>
            <span>
              <DatabaseOutlined />
              <strong>{t("landing.checkStock")}</strong>
            </span>
            <span>
              <ShoppingCartOutlined />
              <strong>{t("landing.createOrder")}</strong>
            </span>
            <span>
              <InboxOutlined />
              <strong>{t("landing.shipping")}</strong>
            </span>
          </div>
          <div className={styles.systemBubble}>
            <div className={styles.bubbleIcon}>
              <SafetyOutlined />
            </div>
            <span>
              <strong>{t("landing.factsTitle")}</strong>
              <small>{t("landing.factsDescription")}</small>
            </span>
          </div>
        </div>
      </section>

      <section className={styles.appDownloads} aria-labelledby="app-downloads-title">
        <div className={styles.appDownloadCopy}>
          <h2 id="app-downloads-title">{t("landing.appDownloadsTitle")}</h2>
          <p>{t("landing.appDownloadsDescription")}</p>
        </div>
        <div className={styles.appDownloadActions}>
          {[
            { name: "Android", url: appDownloads.androidUrl, icon: <AndroidFilled aria-hidden="true" />, label: t("landing.downloadAndroid") },
            { name: "App Store", url: appDownloads.iosUrl, icon: <AppleFilled aria-hidden="true" />, label: t("landing.downloadIos") },
          ].map((app) => {
            const content = <>{app.icon}<span><small>{t("landing.downloadApp")}</small><strong>{app.name}</strong></span></>;
            return app.url ? (
              <a key={app.name} className={styles.appDownloadBadge} href={app.url} aria-label={app.label}>{content}</a>
            ) : (
              <button key={app.name} type="button" className={styles.appDownloadBadge} aria-label={app.label}>{content}</button>
            );
          })}
        </div>
      </section>

      <BmsFlowDiagram variant="compact" />
      <p style={{ textAlign: "center", margin: "24px 0" }}>
        <Link href="/restaurant"><Button size="large">{t("landing.restaurantGuideCta")}</Button></Link>
      </p>

      <section className={styles.resilienceSection} id="resilience">
        <div className={styles.sectionHeadingSimple}>
          <Text className={styles.eyebrow}>{t("landing.hybridEyebrow")}</Text>
          <Title level={2}>{t("landing.hybridTitle")}</Title>
          <Paragraph>{t("landing.hybridDescription")}</Paragraph>
        </div>
        <div className={styles.resilienceGrid}>
          <article className={styles.resilienceCard}>
            <span className={styles.resilienceIcon}><CloudServerOutlined /></span>
            <div>
              <Tag color="blue">{t("landing.hybridCloudTag")}</Tag>
              <Title level={4}>{t("landing.hybridCloudTitle")}</Title>
              <Paragraph>{t("landing.hybridCloudDescription")}</Paragraph>
            </div>
          </article>
          <article className={`${styles.resilienceCard} ${styles.resilienceCardAccent}`}>
            <span className={styles.resilienceIcon}><MobileOutlined /></span>
            <div>
              <Tag color="green">{t("landing.hybridEmergencyTag")}</Tag>
              <Title level={4}>{t("landing.hybridEmergencyTitle")}</Title>
              <Paragraph>{t("landing.hybridEmergencyDescription")}</Paragraph>
            </div>
          </article>
        </div>
        <div className={styles.resilienceBoundary}>
          <DesktopOutlined />
          <span>
            <strong>{t("landing.hybridBoundaryTitle")}</strong>
            <small>{t("landing.hybridBoundaryDescription")}</small>
          </span>
          <Link href="/retail-local"><Button>{t("landing.retailLocalCta")}</Button></Link>
        </div>
      </section>

      <section className={styles.safetySection} id="security">
        <div className={styles.sectionHeadingSimple}>
          <Text className={styles.eyebrow}>{t("landing.safetyEyebrow")}</Text>
          <Title level={2}>{t("landing.safetyTitle")}</Title>
        </div>
        <div className={styles.safetyGrid}>
          {safetyPoints.map((point) => (
            <div key={point.title} className={styles.safetyItem}>
              <span className={styles.safetyIcon}>{point.icon}</span>
              <span><strong>{point.title}</strong><small>{point.description}</small></span>
            </div>
          ))}
        </div>
        <div className={styles.auditLine}><AuditOutlined /> {t("landing.auditLog")}</div>
      </section>

      <section className={styles.pricingSection} id="pricing">
        <div className={styles.sectionHeadingSimple}>
          <Text className={styles.eyebrow}>{t("landing.pricingEyebrow")}</Text>
          <Title level={2}>{t("landing.pricingTitle")}</Title>
          <Paragraph>{t("landing.pricingDescription")}</Paragraph>
          <div className={styles.productIncluded}><CheckCircleFilled /> {t("landing.hybridIncluded")}</div>
        </div>

        {error && <Alert closable type="error" showIcon message={t("landing.pricingLoadError")} description={error.message} />}

        {loading && !plans.length ? (
          <Row gutter={[20, 20]}>
            {[1, 2, 3].map((item) => <Col xs={24} md={8} key={item}><Card><Skeleton active paragraph={{ rows: 5 }} /></Card></Col>)}
          </Row>
        ) : (
          plans.length > 0 && <PlanComparison plans={plans} t={t} ctaHref={planCta.href} ctaLabel={planCta.label} />
        )}
        <div className={styles.pricingFooter}>
          <PackageActions lang={lang} t={t} disabled={!plans.length} />
          <Link href="/demo"><Button icon={<MessageOutlined />}>{t("landing.tryBeforeSignup")}</Button></Link>
        </div>
      </section>

      <section className={styles.finalCta}>
        <div>
          <Title level={3}>{t("landing.finalTitle")}</Title>
          <Paragraph>{t("landing.finalDescription")}</Paragraph>
        </div>
        <Space wrap>
          <Link href="/demo"><Button size="large" icon={<MessageOutlined />}>{t("landing.tryBeforeSignup")}</Button></Link>
          <Link href={primaryCta.href}>
            <Button type="primary" size="large" icon={<RocketOutlined />}>{primaryCta.label}</Button>
          </Link>
          {/* Outlined on purpose: signing up stays the one primary action here. */}
          <Button size="large" className={styles.lineCta} icon={<LineIcon />}
            href={BMS_LINE_OA_URL} target="_blank" rel="noopener noreferrer">
            {t("landing.lineAsk")}
          </Button>
        </Space>
      </section>
    </div>
  );
}
