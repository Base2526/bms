"use client";

import { useEffect, useMemo, useState } from "react";
import { gql, useQuery } from "@apollo/client";
import { Alert, Button, Card, Col, Row, Skeleton, Space, Tag, Typography } from "antd";
import Link from "next/link";
import {
  ApiOutlined,
  ArrowRightOutlined,
  AuditOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  CheckOutlined,
  ContactsOutlined,
  CreditCardOutlined,
  DatabaseOutlined,
  FacebookFilled,
  GlobalOutlined,
  InboxOutlined,
  InstagramFilled,
  LockOutlined,
  MessageOutlined,
  PauseCircleOutlined,
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

function buildFlowSteps(t: Translate) {
  return [
  {
    key: "message",
    label: "Message",
    short: t("landing.flow.message.short"),
    kicker: t("landing.flow.message.kicker"),
    title: t("landing.flow.message.title"),
    description: t("landing.flow.message.description"),
    path: [t("landing.flow.message.path1"), t("landing.flow.message.path2"), t("landing.flow.message.path3")],
    source: t("landing.flow.message.source"),
    status: t("landing.flow.message.status"),
    icon: <MessageOutlined />,
  },
  {
    key: "intent",
    label: "AI Intent",
    short: t("landing.flow.intent.short"),
    kicker: t("landing.flow.intent.kicker"),
    title: t("landing.flow.intent.title"),
    description: t("landing.flow.intent.description"),
    path: [t("landing.flow.intent.path1"), t("landing.flow.intent.path2"), t("landing.flow.intent.path3")],
    source: t("landing.flow.intent.source"),
    status: t("landing.flow.intent.status"),
    icon: <RobotOutlined />,
  },
  {
    key: "crm",
    label: "CRM",
    short: t("landing.flow.crm.short"),
    kicker: t("landing.flow.crm.kicker"),
    title: t("landing.flow.crm.title"),
    description: t("landing.flow.crm.description"),
    path: [t("landing.flow.crm.path1"), t("landing.flow.crm.path2"), t("landing.flow.crm.path3")],
    source: t("landing.flow.crm.source"),
    status: t("landing.flow.crm.status"),
    icon: <ContactsOutlined />,
  },
  {
    key: "order",
    label: "Order",
    short: t("landing.flow.order.short"),
    kicker: t("landing.flow.order.kicker"),
    title: t("landing.flow.order.title"),
    description: t("landing.flow.order.description"),
    path: [t("landing.flow.order.path1"), t("landing.flow.order.path2"), t("landing.flow.order.path3")],
    source: t("landing.flow.order.source"),
    status: t("landing.flow.order.status"),
    icon: <ShoppingCartOutlined />,
  },
  {
    key: "inventory",
    label: "Inventory",
    short: t("landing.flow.inventory.short"),
    kicker: t("landing.flow.inventory.kicker"),
    title: t("landing.flow.inventory.title"),
    description: t("landing.flow.inventory.description"),
    path: [t("landing.flow.inventory.path1"), t("landing.flow.inventory.path2"), t("landing.flow.inventory.path3")],
    source: t("landing.flow.inventory.source"),
    status: t("landing.flow.inventory.status"),
    icon: <DatabaseOutlined />,
  },
  {
    key: "payment",
    label: "Payment",
    short: t("landing.flow.payment.short"),
    kicker: t("landing.flow.payment.kicker"),
    title: t("landing.flow.payment.title"),
    description: t("landing.flow.payment.description"),
    path: [t("landing.flow.payment.path1"), t("landing.flow.payment.path2"), t("landing.flow.payment.path3")],
    source: t("landing.flow.payment.source"),
    status: t("landing.flow.payment.status"),
    icon: <CreditCardOutlined />,
  },
  {
    key: "shipping",
    label: "Shipping",
    short: t("landing.flow.shipping.short"),
    kicker: t("landing.flow.shipping.kicker"),
    title: t("landing.flow.shipping.title"),
    description: t("landing.flow.shipping.description"),
    path: [t("landing.flow.shipping.path1"), t("landing.flow.shipping.path2"), t("landing.flow.shipping.path3")],
    source: t("landing.flow.shipping.source"),
    status: t("landing.flow.shipping.status"),
    icon: <InboxOutlined />,
  },
  {
    key: "dashboard",
    label: "Dashboard",
    short: t("landing.flow.dashboard.short"),
    kicker: t("landing.flow.dashboard.kicker"),
    title: t("landing.flow.dashboard.title"),
    description: t("landing.flow.dashboard.description"),
    path: [t("landing.flow.dashboard.path1"), t("landing.flow.dashboard.path2"), t("landing.flow.dashboard.path3")],
    source: t("landing.flow.dashboard.source"),
    status: t("landing.flow.dashboard.status"),
    icon: <BarChartOutlined />,
  },
  ];
}

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
  const flowSteps = useMemo(() => buildFlowSteps(t), [t]);
  const safetyPoints = useMemo(() => buildSafetyPoints(t), [t]);
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);

  const currentStep = flowSteps[activeStep];
  const isFinished = activeStep === flowSteps.length - 1 && completedSteps.has(activeStep);
  const isApprovalStep = activeStep === 5 && !running;

  const primaryCta = !sessionLoading && admin
    ? { href: "/admin/dashboard", label: t("landing.goToDashboard") }
    : { href: "/shop-signup", label: t("landing.startFree") };
  const planCta = !sessionLoading && admin
    ? { href: "/admin/dashboard", label: t("landing.manageStore") }
    : { href: "/shop-signup", label: t("landing.startUsing") };

  const flowStatus = useMemo(() => {
    if (isFinished) return t("landing.journeyCompleted");
    if (isApprovalStep) return t("landing.waitingApproval");
    if (running) return `${t("landing.running")} · ${currentStep.title}`;
    return `${t("landing.viewing")} · ${currentStep.title}`;
  }, [currentStep.title, isApprovalStep, isFinished, running, t]);

  useEffect(() => {
    if (!running) return;

    if (activeStep === 5) {
      setRunning(false);
      return;
    }

    const timer = window.setTimeout(() => {
      if (activeStep >= flowSteps.length - 1) {
        setCompletedSteps(new Set(flowSteps.map((_, index) => index)));
        setRunning(false);
        return;
      }

      setCompletedSteps((previous) => new Set(previous).add(activeStep));
      setActiveStep((previous) => previous + 1);
    }, 950);

    return () => window.clearTimeout(timer);
  }, [activeStep, flowSteps, running]);

  const selectStep = (index: number) => {
    setRunning(false);
    setCompletedSteps(new Set());
    setActiveStep(index);
  };

  const toggleSimulation = () => {
    if (running) {
      setRunning(false);
      return;
    }

    if (isFinished || activeStep === 5) {
      setCompletedSteps(new Set());
      setActiveStep(0);
    }

    setRunning(true);
  };

  const continueAfterApproval = () => {
    setCompletedSteps((previous) => new Set(previous).add(5));
    setActiveStep(6);
    setRunning(true);
  };

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
            <Link href={primaryCta.href}>
              <Button type="primary" size="large" icon={<RocketOutlined />}>{primaryCta.label}</Button>
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

      <section className={styles.workflowSection} id="workflow">
        <div className={styles.sectionHeading}>
          <div>
            <Text className={styles.eyebrow}>{t("landing.workflowEyebrow")}</Text>
            <Title level={2}>{t("landing.workflowTitle")}</Title>
            <Paragraph>{t("landing.workflowDescription")}</Paragraph>
          </div>
          <Space wrap>
            <span className={styles.flowStatus}><i />{flowStatus}</span>
            <Button
              type="primary"
              icon={running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={toggleSimulation}
            >
              {running
                ? t("landing.pause")
                : isFinished
                  ? t("landing.replay")
                  : isApprovalStep
                    ? t("landing.restart")
                    : t("landing.startSimulation")}
            </Button>
          </Space>
        </div>

        <div className={styles.stepGrid} role="group" aria-label={t("landing.selectStepAria")}>
          {flowSteps.map((step, index) => {
            const active = index === activeStep;
            const complete = completedSteps.has(index);
            return (
              <button
                type="button"
                key={step.key}
                className={`${styles.stepButton} ${active ? styles.stepButtonActive : ""}`}
                aria-pressed={active}
                onClick={() => selectStep(index)}
              >
                <span className={styles.stepTop}>
                  <span className={styles.stepIcon}>{step.icon}</span>
                  <span className={`${styles.stepCheck} ${complete ? styles.stepCheckVisible : ""}`}><CheckOutlined /></span>
                </span>
                <span className={styles.stepNumber}>STEP {index + 1}</span>
                <strong>{step.label}</strong>
                <small>{step.short}</small>
              </button>
            );
          })}
        </div>

        <Card className={styles.detailCard}>
          <div className={styles.detailHeader}>
            <div>
              <Text className={styles.eyebrow}>{currentStep.kicker}</Text>
              <Title level={4}>{currentStep.title}</Title>
              <Paragraph>{currentStep.description}</Paragraph>
            </div>
            <Tag color={activeStep === 5 ? "gold" : "blue"}>{currentStep.status}</Tag>
          </div>
          <div className={styles.path} aria-label={t("landing.dataPathAria")}>
            {currentStep.path.map((item, index) => (
              <span key={item} className={styles.pathGroup}>
                <span className={styles.pathChip}>{item}</span>
                {index < currentStep.path.length - 1 && <ArrowRightOutlined />}
              </span>
            ))}
          </div>
          {activeStep === 5 && (
            <div className={styles.approvalGate}>
              <span><UserOutlined /><span><strong>{t("landing.humanConfirmation")}</strong><small>{t("landing.approvalDescription")}</small></span></span>
              <Button type="primary" icon={<CheckOutlined />} onClick={continueAfterApproval}>{t("landing.continueSimulation")}</Button>
            </div>
          )}
          <div className={styles.detailFooter}>
            <span><DatabaseOutlined /> {t("landing.source")}: {currentStep.source}</span>
            <span>{activeStep + 1} / {flowSteps.length}</span>
          </div>
        </Card>
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
        </div>

        {error && <Alert type="error" showIcon message={t("landing.pricingLoadError")} description={error.message} />}

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
        <Link href={primaryCta.href}>
          <Button type="primary" size="large" icon={<RocketOutlined />}>{primaryCta.label}</Button>
        </Link>
      </section>
    </div>
  );
}
