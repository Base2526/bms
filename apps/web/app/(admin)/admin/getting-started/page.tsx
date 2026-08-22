'use client';

import Link from "next/link";
import { gql, useMutation, useQuery } from "@apollo/client";
import { Alert, Button, Card, Col, Divider, Progress, Row, Space, Tag, Typography, message } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ArrowRightOutlined,
  ShopOutlined,
  CreditCardOutlined,
  AppstoreOutlined,
  RobotOutlined,
  BellOutlined,
} from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";
import {
  SHOP_ARCHETYPE_OPTIONS,
  archetypeNeedsRestockEmphasis,
  onboardingChecklistKeysForArchetype,
} from "@/lib/bms/shopArchetypes";
import { useI18n } from "@/lib/i18nContext";

const { Title, Paragraph, Text } = Typography;

const Q = gql`
  query {
    bmsMyTenant { id name slug }
    bmsStoreProfile {
      businessArchetype
      businessType
      phone
      contactEmail
      country
      currency
      businessHours
      shippingFlatRate
      shippingFreeThreshold
      paymentAccounts { type bankName accountName accountNo promptpayId note }
    }
    bmsChannels { channel active has_token }
    bmsProducts(limit: 1, offset: 0) { total }
    bmsRestockStatusCounts { total }
    bmsOnboardingProgress { completed skipped dismissedAt lastSeenAt }
  }
`;

const M_PROGRESS = gql`
  mutation UpdateOnboardingProgress($completed: [String!], $skipped: [String!], $dismissed: Boolean) {
    bmsUpdateOnboardingProgress(completed: $completed, skipped: $skipped, dismissed: $dismissed) {
      completed skipped dismissedAt lastSeenAt
    }
  }
`;

type StepItem = {
  key: string;
  title: string;
  description: string;
  href: string;
  buttonLabel: string;
  done: boolean;
  recommended?: boolean;
  icon: React.ReactNode;
};

function archetypeLabel(value: string | null | undefined) {
  return SHOP_ARCHETYPE_OPTIONS.find((x) => x.value === value)?.label || "General / Not set";
}

export default function Page() {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [saveProgress] = useMutation(M_PROGRESS);
  const [creatingSample, setCreatingSample] = useState(false);
  const syncedProgress = useRef(false);

  const tenant = data?.bmsMyTenant;
  const profile = data?.bmsStoreProfile;
  const channels: Array<{ channel: string; active?: boolean; has_token?: boolean }> = data?.bmsChannels || [];
  const productTotal = Number(data?.bmsProducts?.total || 0);
  const archetype = profile?.businessArchetype || null;
  const checklistKeys = onboardingChecklistKeysForArchetype(archetype);
  const restockFirstClass = archetypeNeedsRestockEmphasis(archetype);
  const canOfferSampleData = productTotal === 0;

  const shopInfoDone = Boolean(
    tenant?.name &&
    (profile?.businessHours || profile?.phone || profile?.contactEmail) &&
    profile?.country &&
    profile?.currency
  );
  const paymentDone = Array.isArray(profile?.paymentAccounts) && profile.paymentAccounts.length > 0;
  const productsDone = productTotal > 0;
  const channelsDone = channels.some((c) => c.active && (c.has_token || c.channel === "web"));
  const restockDone = Number(data?.bmsRestockStatusCounts?.total || 0) > 0;

  const steps: StepItem[] = [
    {
      key: "shop",
      title: t("admin_getting_started.step_shop_title"),
      description: t("admin_getting_started.step_shop_desc"),
      href: "/admin/settings",
      buttonLabel: t("admin_getting_started.step_shop_btn"),
      done: shopInfoDone,
      icon: <ShopOutlined />,
    },
    {
      key: "payment",
      title: t("admin_getting_started.step_payment_title"),
      description: t("admin_getting_started.step_payment_desc"),
      href: "/admin/settings",
      buttonLabel: t("admin_getting_started.step_payment_btn"),
      done: paymentDone,
      icon: <CreditCardOutlined />,
    },
    {
      key: "products",
      title: t("admin_getting_started.step_products_title"),
      description: t("admin_getting_started.step_products_desc"),
      href: "/admin/products",
      buttonLabel: t("admin_getting_started.step_products_btn"),
      done: productsDone,
      icon: <AppstoreOutlined />,
    },
    {
      key: "channels",
      title: t("admin_getting_started.step_channels_title"),
      description: t("admin_getting_started.step_channels_desc"),
      href: "/admin/settings",
      buttonLabel: t("admin_getting_started.step_channels_btn"),
      done: channelsDone,
      icon: <RobotOutlined />,
    },
    {
      key: "restock",
      title: t("admin_getting_started.step_restock_title"),
      description: restockFirstClass
        ? t("admin_getting_started.step_restock_desc_emphasis")
        : t("admin_getting_started.step_restock_desc_default"),
      href: "/admin/restock-subscriptions",
      buttonLabel: t("admin_getting_started.step_restock_btn"),
      done: restockDone,
      recommended: restockFirstClass,
      icon: <BellOutlined />,
    },
  ];

  const storedProgress = data?.bmsOnboardingProgress;
  const skippedKeys: string[] = storedProgress?.skipped || [];
  const completedKeys = steps.filter((step) => step.done).map((step) => step.key);

  useEffect(() => {
    if (loading || !data || syncedProgress.current) return;
    syncedProgress.current = true;
    void saveProgress({
      variables: {
        completed: completedKeys,
        skipped: skippedKeys.filter((key) => !completedKeys.includes(key)),
        dismissed: Boolean(storedProgress?.dismissedAt),
      },
    });
  }, [completedKeys.join("|"), data, loading, saveProgress, skippedKeys.join("|"), storedProgress?.dismissedAt]);

  if (error) {
    return <Alert type="error" showIcon message={t("admin_getting_started.load_error")} description={error.message} />;
  }

  const completed = steps.filter((s) => s.done).length;
  const percent = Math.round((completed / steps.length) * 100);

  async function createSampleData() {
    setCreatingSample(true);
    try {
      const res = await fetch("/api/bms/onboarding/sample-data", {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || t("admin_getting_started.sample_failed"));
      message.success(t("admin_getting_started.sample_success"));
      syncedProgress.current = false;
      await refetch();
    } catch (e: any) {
      message.error(e?.message || t("admin_getting_started.sample_failed"));
    } finally {
      setCreatingSample(false);
    }
  }

  async function skipStep(key: string) {
    const skipped = Array.from(new Set([...skippedKeys, key])).filter((item) => !completedKeys.includes(item));
    await saveProgress({ variables: { completed: completedKeys, skipped, dismissed: false } });
    message.info(t("admin_getting_started.skip_saved"));
    await refetch();
  }

  async function dismissOnboarding() {
    await saveProgress({ variables: { completed: completedKeys, skipped: skippedKeys, dismissed: true } });
    window.location.assign("/admin/dashboard");
  }

  return (
    <div style={{ maxWidth: 1120 }}>
      <Card loading={loading} style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Title level={2} style={{ margin: 0 }}>{t("admin_getting_started.page_title")}</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t("admin_getting_started.page_subtitle")}
          </Paragraph>
          <Space wrap>
            <Tag color="blue">{tenant?.name || t("admin_getting_started.your_shop")}</Tag>
            <Tag>{tenant?.slug ? `/${tenant.slug}` : "slug pending"}</Tag>
            <Tag color="purple">{archetypeLabel(archetype)}</Tag>
            {profile?.businessType ? <Tag color="geekblue">businessType: {profile.businessType}</Tag> : null}
          </Space>
        </Space>
        <Divider />
        <Row gutter={[24, 24]}>
          <Col xs={24} md={10}>
            <Progress type="circle" percent={percent} format={() => `${completed}/${steps.length}`} />
          </Col>
          <Col xs={24} md={14}>
            <Paragraph style={{ marginBottom: 8 }}>
              {t("admin_getting_started.progress_text")} <b>{completed}</b> {t("admin_getting_started.progress_of")} <b>{steps.length}</b> {t("admin_getting_started.progress_steps")}
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>
              {t("admin_getting_started.progress_hint")}
            </Paragraph>
            <Space wrap>
              <Button onClick={dismissOnboarding}>{t("admin_getting_started.btn_skip_to_dashboard")}</Button>
              <Link href={steps.find((s) => !s.done)?.href || "/admin/dashboard"}>
                <Button type="primary" icon={<ArrowRightOutlined />}>
                  {steps.find((s) => !s.done)?.buttonLabel || t("admin_getting_started.btn_go_dashboard")}
                </Button>
              </Link>
            </Space>
          </Col>
        </Row>
      </Card>

      <Alert
        style={{ marginBottom: 16 }}
        type={restockFirstClass ? "success" : "info"}
        showIcon
        message={restockFirstClass ? t("admin_getting_started.alert_emphasis") : t("admin_getting_started.alert_default")}
        description={
          <div>
            {checklistKeys.map((key) => (
              <div key={key}>- {t(`admin_getting_started.${key}`)}</div>
            ))}
            {restockFirstClass && (
              <div style={{ marginTop: 8 }}>
                - {t("admin_getting_started.restock_extra_note")}
              </div>
            )}
          </div>
        }
      />

      {canOfferSampleData && (
        <Card style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Title level={4} style={{ margin: 0 }}>{t("admin_getting_started.sample_card_title")}</Title>
            <Paragraph style={{ marginBottom: 0 }}>
              {t("admin_getting_started.sample_card_desc_1")}{restockFirstClass ? " restock subscriptions" : t("admin_getting_started.sample_card_desc_workflow")}.
            </Paragraph>
            <Space wrap>
              <Tag color="blue">{t("admin_getting_started.tag_products")}</Tag>
              <Tag color="blue">{t("admin_getting_started.tag_customers")}</Tag>
              <Tag color="blue">{t("admin_getting_started.tag_orders")}</Tag>
              <Tag color="blue">{t("admin_getting_started.tag_conversations")}</Tag>
              <Tag color="blue">{t("admin_getting_started.tag_coupons")}</Tag>
              <Tag color="cyan">{t("admin_getting_started.tag_purchase_orders")}</Tag>
              {restockFirstClass ? <Tag color="gold">Restock 8</Tag> : null}
            </Space>
            <Space wrap>
              <Button type="primary" loading={creatingSample} onClick={createSampleData}>
                {t("admin_getting_started.btn_create_sample")}
              </Button>
              <Link href="/admin/products">
                <Button>{t("admin_getting_started.btn_start_empty")}</Button>
              </Link>
            </Space>
          </Space>
        </Card>
      )}

      <Row gutter={[16, 16]}>
        {steps.map((step) => (
          <Col xs={24} md={12} key={step.key}>
            <Card
              title={
                <Space>
                  {step.icon}
                  <span>{step.title}</span>
                  {step.recommended ? <Tag color="gold">Recommended</Tag> : null}
                </Space>
              }
              extra={
                step.done
                  ? <Tag color="green" icon={<CheckCircleOutlined />}>{t("admin_getting_started.tag_ready")}</Tag>
                  : <Tag icon={<ClockCircleOutlined />}>{t("admin_getting_started.tag_incomplete")}</Tag>
              }
              style={{ height: "100%" }}
            >
              <Paragraph>{step.description}</Paragraph>
              <Space wrap>
                <Link href={step.href}>
                  <Button type={step.done ? "default" : "primary"}>{step.buttonLabel}</Button>
                </Link>
                {!step.done && !skippedKeys.includes(step.key) ? (
                  <Button type="text" onClick={() => skipStep(step.key)}>{t("admin_getting_started.btn_later")}</Button>
                ) : null}
                {skippedKeys.includes(step.key) ? <Tag>{t("admin_getting_started.tag_skipped")}</Tag> : null}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
