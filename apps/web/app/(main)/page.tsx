"use client";

import { useMemo } from "react";
import { gql, useQuery } from "@apollo/client";
import { Alert, Button, Card, Col, Row, Skeleton, Space, Tag, Typography } from "antd";
import Link from "next/link";
import {
  ApiOutlined,
  AuditOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  DatabaseOutlined,
  DesktopOutlined,
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
  ShopOutlined,
  ShoppingCartOutlined,
  TikTokFilled,
  UserOutlined,
} from "@ant-design/icons";
import { useSessionCtx } from "@/lib/session-context";
import { useI18n } from "@/lib/i18nContext";
import BmsFlowDiagram from "@/components/marketing/flow/BmsFlowDiagram";
import styles from "./page.module.css";

const { Title, Paragraph, Text } = Typography;

const Q_PLANS = gql`
  query {
    bmsPublicPlans {
      code
      name
      price_monthly
      max_products
      max_channels
      max_orders_month
      max_users
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

type Translate = (key: string) => string;

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

function PlanCard({
  plan,
  highlight,
  t,
  ctaHref,
  ctaLabel,
}: {
  plan: any;
  highlight?: boolean;
  t: Translate;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <Card className={`${styles.planCard} ${highlight ? styles.planCardHighlight : ""}`}>
      {highlight && <Tag color="blue" className={styles.planBadge}>{t("landing.recommended")}</Tag>}
      <Title level={4} className={styles.planName}>{plan.name}</Title>
      <div className={styles.planPrice}>
        {plan.price_monthly > 0 ? (
          <>
            {Number(plan.price_monthly).toLocaleString()}
            <Text type="secondary" className={styles.planUnit}>{t("landing.perMonth")}</Text>
          </>
        ) : (
          t("landing.free")
        )}
      </div>
      <Space direction="vertical" size={9} className={styles.planFeatures}>
        <span><CheckCircleFilled />{t("landing.productLimit")} {lim(plan.max_products, t)}</span>
        <span><CheckCircleFilled />{t("landing.channelLimit")} {lim(plan.max_channels, t)}</span>
        <span><CheckCircleFilled />{t("landing.orderLimit")} {lim(plan.max_orders_month, t)}</span>
        <span><CheckCircleFilled />{t("landing.teamLimit")} {lim(plan.max_users, t)} {t("landing.people")}</span>
      </Space>
      <Link href={ctaHref}>
        <Button type={highlight ? "primary" : "default"} block size="large">{ctaLabel}</Button>
      </Link>
    </Card>
  );
}

export default function HomePage() {
  const { admin, loading: sessionLoading } = useSessionCtx();
  const { t } = useI18n();
  const { data, loading, error } = useQuery(Q_PLANS, { fetchPolicy: "cache-and-network" });
  const plans: any[] = data?.bmsPublicPlans || [];
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

      <BmsFlowDiagram variant="compact" />

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
          <Link href="/demo"><Button icon={<MessageOutlined />}>{t("landing.tryBeforeSignup")}</Button></Link>
        </div>

        {error && <Alert closable type="error" showIcon message={t("landing.pricingLoadError")} description={error.message} />}

        {loading && !plans.length ? (
          <Row gutter={[20, 20]}>
            {[1, 2, 3].map((item) => <Col xs={24} md={8} key={item}><Card><Skeleton active paragraph={{ rows: 5 }} /></Card></Col>)}
          </Row>
        ) : (
          <Row gutter={[20, 20]}>
            {plans.map((plan) => (
              <Col xs={24} md={8} key={plan.code}>
                <PlanCard
                  plan={plan}
                  highlight={plan.code === "pro"}
                  t={t}
                  ctaHref={planCta.href}
                  ctaLabel={planCta.label}
                />
              </Col>
            ))}
          </Row>
        )}
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
        </Space>
      </section>
    </div>
  );
}
