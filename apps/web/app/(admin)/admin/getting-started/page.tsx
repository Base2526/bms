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
  onboardingChecklistForArchetype,
} from "@/lib/bms/shopArchetypes";

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
  const { data, loading, error, refetch } = useQuery(Q, { fetchPolicy: "cache-and-network" });
  const [saveProgress] = useMutation(M_PROGRESS);
  const [creatingSample, setCreatingSample] = useState(false);
  const syncedProgress = useRef(false);

  const tenant = data?.bmsMyTenant;
  const profile = data?.bmsStoreProfile;
  const channels: Array<{ channel: string; active?: boolean; has_token?: boolean }> = data?.bmsChannels || [];
  const productTotal = Number(data?.bmsProducts?.total || 0);
  const archetype = profile?.businessArchetype || null;
  const checklist = onboardingChecklistForArchetype(archetype);
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
      title: "ข้อมูลร้าน",
      description: "ตั้งชื่อร้าน เวลาเปิดปิด ประเทศ สกุลเงิน และช่องทางติดต่อ เพื่อให้ AI ตอบลูกค้าได้จากข้อมูลจริง",
      href: "/admin/settings",
      buttonLabel: "ไปตั้งค่าข้อมูลร้าน",
      done: shopInfoDone,
      icon: <ShopOutlined />,
    },
    {
      key: "payment",
      title: "บัญชีรับเงิน",
      description: "เพิ่มบัญชีธนาคารหรือพร้อมเพย์ เพื่อให้ AI และ checkout บอกช่องทางชำระเงินได้",
      href: "/admin/settings",
      buttonLabel: "เพิ่มบัญชีรับเงิน",
      done: paymentDone,
      icon: <CreditCardOutlined />,
    },
    {
      key: "products",
      title: "สินค้าชุดแรก",
      description: "เพิ่มสินค้าอย่างน้อย 1 รายการก่อน เพื่อให้ AI เช็กของ สร้างออเดอร์ และแนะนำสินค้าได้จริง",
      href: "/admin/products",
      buttonLabel: "เพิ่มสินค้า",
      done: productsDone,
      icon: <AppstoreOutlined />,
    },
    {
      key: "channels",
      title: "ช่องทางขาย / AI flow",
      description: "เชื่อมอย่างน้อย 1 ช่องทาง หรือเริ่มทดสอบจากหลังบ้านก่อน แล้วลองถาม AI หรือสร้างออเดอร์จริงหนึ่งรอบ",
      href: "/admin/settings",
      buttonLabel: "ตั้งค่าช่องทาง",
      done: channelsDone,
      icon: <RobotOutlined />,
    },
    {
      key: "restock",
      title: "เก็บยอดขายจากของหมด",
      description: restockFirstClass
        ? "ร้านประเภทนี้เหมาะมากกับ restock subscriptions: เปลี่ยนลูกค้าที่ถามของแล้วของหมดให้กลายเป็นคิวตามกลับเมื่อสต๊อกเข้า"
        : "ถ้าร้านคุณมีสินค้าหมดบ่อย สามารถใช้ restock subscriptions เพื่อเก็บ demand ที่กำลังจะหลุดได้",
      href: "/admin/restock-subscriptions",
      buttonLabel: "เปิดหน้า Restock",
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
    return <Alert type="error" showIcon message="โหลดหน้าเริ่มต้นใช้งานไม่สำเร็จ" description={error.message} />;
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
      if (!res.ok) throw new Error(body?.error || "สร้าง sample data ไม่สำเร็จ");
      message.success("สร้าง sample data ตาม archetype ให้ร้านนี้แล้ว");
      syncedProgress.current = false;
      await refetch();
    } catch (e: any) {
      message.error(e?.message || "สร้าง sample data ไม่สำเร็จ");
    } finally {
      setCreatingSample(false);
    }
  }

  async function skipStep(key: string) {
    const skipped = Array.from(new Set([...skippedKeys, key])).filter((item) => !completedKeys.includes(item));
    await saveProgress({ variables: { completed: completedKeys, skipped, dismissed: false } });
    message.info("บันทึกว่าข้ามขั้นตอนนี้ไว้แล้ว");
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
          <Title level={2} style={{ margin: 0 }}>เริ่มต้นใช้งานร้านของคุณ</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            ใช้ checklist นี้เพื่อพาร้านจาก “สมัครสำเร็จ” ไปสู่ “พร้อมขายผ่าน AI และ workflow หลังบ้านจริง”
          </Paragraph>
          <Space wrap>
            <Tag color="blue">{tenant?.name || "ร้านของคุณ"}</Tag>
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
              ตอนนี้คุณทำไปแล้ว <b>{completed}</b> จาก <b>{steps.length}</b> ขั้นตอน
            </Paragraph>
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>
              ระบบจะใช้อ้างอิงข้อมูลจริงของร้านเพื่อบอกว่าอะไรยังขาด เช่น บัญชีรับเงิน, สินค้า, หรือการตั้งค่าที่เกี่ยวกับการขาย
            </Paragraph>
            <Space wrap>
              <Button onClick={dismissOnboarding}>ข้ามไป Dashboard</Button>
              <Link href={steps.find((s) => !s.done)?.href || "/admin/dashboard"}>
                <Button type="primary" icon={<ArrowRightOutlined />}>
                  {steps.find((s) => !s.done)?.buttonLabel || "ไปที่ Dashboard"}
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
        message={restockFirstClass ? "จุดเน้นสำหรับร้านประเภทนี้: กู้ยอดขายจากของหมด" : "Checklist ตาม archetype ร้าน"}
        description={
          <div>
            {checklist.map((item) => (
              <div key={item}>- {item}</div>
            ))}
            {restockFirstClass && (
              <div style={{ marginTop: 8 }}>
                - `restock subscriptions` ช่วยเปลี่ยน `out-of-stock` จากปลายทางของแชต ให้กลายเป็น queue ที่ทีมขายตามกลับเมื่อสต๊อกกลับมา
              </div>
            )}
          </div>
        }
      />

      {canOfferSampleData && (
        <Card style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Title level={4} style={{ margin: 0 }}>เริ่มเร็วขึ้นด้วยข้อมูลตัวอย่าง</Title>
            <Paragraph style={{ marginBottom: 0 }}>
              ร้านนี้ยังไม่มีสินค้า คุณสามารถให้ระบบสร้าง sample data ตาม archetype ปัจจุบันได้ทันที
              เพื่อใช้ demo การตอบ AI, ออเดอร์, การชำระเงิน, บทสนทนา และ{restockFirstClass ? " restock subscriptions" : " workflow หลังบ้าน"}.
            </Paragraph>
            <Space wrap>
              <Tag color="blue">สินค้า 12</Tag>
              <Tag color="blue">ลูกค้า 10</Tag>
              <Tag color="blue">ออเดอร์ 12</Tag>
              <Tag color="blue">บทสนทนา 8</Tag>
              <Tag color="blue">คูปอง 3</Tag>
              <Tag color="cyan">ใบสั่งซื้อ 6</Tag>
              {restockFirstClass ? <Tag color="gold">Restock 8</Tag> : null}
            </Space>
            <Space wrap>
              <Button type="primary" loading={creatingSample} onClick={createSampleData}>
                สร้าง sample data ตาม archetype
              </Button>
              <Link href="/admin/products">
                <Button>เริ่มจากร้านเปล่า</Button>
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
                  ? <Tag color="green" icon={<CheckCircleOutlined />}>พร้อมแล้ว</Tag>
                  : <Tag icon={<ClockCircleOutlined />}>ยังไม่ครบ</Tag>
              }
              style={{ height: "100%" }}
            >
              <Paragraph>{step.description}</Paragraph>
              <Space wrap>
                <Link href={step.href}>
                  <Button type={step.done ? "default" : "primary"}>{step.buttonLabel}</Button>
                </Link>
                {!step.done && !skippedKeys.includes(step.key) ? (
                  <Button type="text" onClick={() => skipStep(step.key)}>ไว้ทำภายหลัง</Button>
                ) : null}
                {skippedKeys.includes(step.key) ? <Tag>ข้ามไว้</Tag> : null}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
