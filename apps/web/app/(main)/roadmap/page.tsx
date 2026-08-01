"use client";

import React, { useMemo } from "react";
import { Badge, Card, Col, Divider, Progress, Row, Space, Tag, Timeline, Typography } from "antd";
import type { TimelineProps } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  FileTextOutlined,
  ShareAltOutlined,
  TeamOutlined,
  SearchOutlined,
  AlertOutlined,
  BarChartOutlined,
} from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";

const { Title, Text, Paragraph } = Typography;

type Status = "done" | "in_progress" | "planned";

type RoadmapItem = {
  id: string;
  quarter: string;
  title: string;
  status: Status;
  goals: string[];
  deliverables: string[];
  tags?: string[];
  icon?: React.ReactNode;
};

type RoadmapPageContent = {
  labels: {
    pageTitle: string;
    subtitle: string;
    done: string;
    inProgress: string;
    planned: string;
    progressLabel: string;
    keyObjectives: string;
    objectives: string[];
    notes: string;
    recommendTag: string;
    notesText: string;
    tip1: string;
    tip2: string;
    suggestedAdd: string;
    suggest: Array<{ color: string; text: string }>;
    roadmap: string;
    status: string;
    goals: string;
    deliverables: string;
  };
  items: Array<Omit<RoadmapItem, "icon">>;
};

const ROADMAP_CONTENT: { en: RoadmapPageContent; th: RoadmapPageContent } = {
  en: {
    labels: {
      pageTitle: "BMS Product Roadmap",
      subtitle:
        "A business-system roadmap for turning customer chat into verified commerce operations, from CRM and product discovery to payment, shipping, and repeat sales.",
      done: "Done",
      inProgress: "In progress",
      planned: "Planned",
      progressLabel: "Estimated progress",
      keyObjectives: "Key objectives",
      objectives: [
        "Customer chat -> CRM/identity -> Product discovery -> Stock decision",
        "Order or restock capture -> Payment -> Shipping -> Follow-up / Repeat sale",
        "Keep AI grounded in verified backend facts, never guesses",
        "Help stores recover lost demand when stock is unavailable",
      ],
      notes: "Notes",
      recommendTag: "Recommendation",
      notesText:
        "This roadmap is designed around the real business loop of BMS: a customer starts with chat, the system verifies facts through CRM and product tools, then either closes the sale immediately or captures demand for restock follow-up.",
      tip1: "Design every stage so staff can move from chat to order, payment, and shipping without re-keying the same facts.",
      tip2: "Treat restock capture as revenue recovery, not just a notification feature.",
      suggestedAdd: "Suggested additions (recommended)",
      suggest: [
        { color: "purple", text: "Archetype-aware AI conversations" },
        { color: "purple", text: "Restock recovery dashboard" },
        { color: "purple", text: "Verified product alternatives engine" },
        { color: "purple", text: "Follow-up and repeat-sale playbooks" },
        { color: "gold", text: "Operator search across orders/payments/shipping" },
        { color: "gold", text: "AI usage and routing transparency" },
        { color: "gold", text: "Document generation and quote workflows" },
        { color: "gold", text: "Partner API / webhook expansion" },
      ],
      roadmap: "Quarterly roadmap",
      status: "Status",
      goals: "Goals",
      deliverables: "Deliverables",
    },
    items: [
      {
        id: "built",
        quarter: "Built (current)",
        title: "Commerce foundation already in place",
        status: "done",
        tags: ["done", "foundation"],
        goals: ["Build the operational backbone from customer chat to back-office execution"],
        deliverables: [
          "Inbox + Customer 360 foundation",
          "Orders, Payment, and Shipping operational surfaces",
          "Public checkout link for real orders",
          "AI tool runtime with permission-aware execution",
        ],
      },
      {
        id: "q1",
        quarter: "Q1 2026",
        title: "Customer-to-order workflow and verified checkout",
        status: "in_progress",
        tags: ["core", "workflow", "checkout"],
        goals: [
          "Move from customer chat into a verified order flow with minimal re-entry",
          "Collect only the missing checkout facts and keep payment human-confirmed",
        ],
        deliverables: [
          "Customer-safe AI tools for product discovery and ordering",
          "Signed checkout flow bound to a real persisted order",
          "Payment submission that stays pending until a staff member confirms it",
        ],
      },
      {
        id: "q2",
        quarter: "Q2 2026",
        title: "Product discovery, alternatives, and stock decisions",
        status: "planned",
        tags: ["discovery", "catalog", "stock"],
        goals: [
          "Help stores answer product questions with verified availability",
          "Turn stock checks into a decision point: sell now, suggest alternatives, or capture restock demand",
        ],
        deliverables: [
          "Live catalog search over active and in-stock products",
          "Alternative product and size suggestions when the requested item is unavailable",
          "Clear stock-aware guidance for both AI and staff surfaces",
        ],
      },
      {
        id: "q3",
        quarter: "Q3 2026",
        title: "Restock capture and demand recovery loop",
        status: "planned",
        tags: ["restock", "retention", "recovery"],
        goals: ["Recover sales that would otherwise be lost when stock is unavailable", "Give staff a structured way to follow up when inventory returns"],
        deliverables: [
          "Customer opt-in restock subscriptions from chat",
          "Staff review, resend, and follow-up flow when stock is available again",
          "Revenue-recovery framing: from out-of-stock conversation to reopened sale",
        ],
      },
      {
        id: "q4",
        quarter: "Q4 2026",
        title: "Archetype-aware AI and store-specific selling patterns",
        status: "done",
        tags: ["ai", "archetype", "done"],
        goals: [
          "Let AI respond differently for different store types without inventing facts",
          "Support consultative, fast-moving, or compatibility-heavy sales conversations",
        ],
        deliverables: [
          "Archetype-driven examples for fashion, grocery, beauty, gadgets, and more",
          "Grounded product recommendations using approved tools only",
          "Safer messaging patterns for out-of-stock and alternative suggestions",
        ],
      },
      {
        id: "q1_2027",
        quarter: "Q1 2027",
        title: "Follow-up, repeat sale, and business visibility",
        status: "planned",
        tags: ["analytics", "api", "growth"],
        goals: [
          "Help stores see which conversations become orders, restock recoveries, or repeat sales",
          "Expose clean operational data to partners and internal reporting surfaces",
        ],
        deliverables: [
          "Operational analytics across chat, orders, payments, shipping, and restock recovery",
          "Follow-up / repeat-sale visibility after delivery or failed purchase",
          "Read-only API + webhook events for ecosystem integrations",
        ],
      },
    ],
  },
  th: {
    labels: {
      pageTitle: "Roadmap การพัฒนาระบบ BMS",
      subtitle:
        "แผนพัฒนาระบบธุรกิจที่เปลี่ยน customer chat ให้กลายเป็น workflow ที่ตรวจสอบได้ ตั้งแต่รู้จักลูกค้า หา/แนะนำสินค้า ไปจนถึงการชำระเงิน การจัดส่ง และการขายซ้ำ",
      done: "เสร็จแล้ว",
      inProgress: "กำลังทำ",
      planned: "วางแผน",
      progressLabel: "ความคืบหน้าโดยประมาณ",
      keyObjectives: "เป้าหมายหลัก",
      objectives: [
        "Customer chat -> CRM/identity -> Product discovery -> Stock decision",
        "Order or restock capture -> Payment -> Shipping -> Follow-up / Repeat sale",
        "ให้ AI ตอบจากข้อมูล backend ที่ตรวจสอบได้ ไม่ใช่การเดา",
        "เปลี่ยนของหมดให้กลายเป็นโอกาสปิดการขายกลับมา",
      ],
      notes: "หมายเหตุ",
      recommendTag: "คำแนะนำ",
      notesText:
        "Roadmap นี้ออกแบบจาก loop ธุรกิจจริงของ BMS: ลูกค้าเริ่มจากแชท ระบบต้องรู้จักตัวตนลูกค้า ค้นสินค้า เช็กสต็อก แล้วตัดสินใจว่าจะปิดการขายทันทีหรือเก็บ demand ไว้ผ่าน restock เพื่อกลับมาปิดยอดในรอบถัดไป",
      tip1: "ออกแบบให้ทีมงานไหลจากแชทไปออเดอร์ การชำระเงิน และการจัดส่งได้โดยไม่ต้องกรอกข้อมูลเดิมซ้ำหลายรอบ",
      tip2: "มอง restock capture เป็นเครื่องมือกู้รายได้ ไม่ใช่แค่ระบบแจ้งเตือนของเข้า",
      suggestedAdd: "ข้อเสนอแนะเพิ่มเติม (แนะนำ)",
      suggest: [
        { color: "purple", text: "AI ตอบตาม archetype ของร้าน" },
        { color: "purple", text: "Dashboard วัดการกู้ยอดจาก restock" },
        { color: "purple", text: "Engine แนะนำสินค้าทดแทนที่ตรวจสอบได้" },
        { color: "purple", text: "Flow follow-up และ repeat sale" },
        { color: "gold", text: "Operator search ข้าม Orders / Payment / Shipping" },
        { color: "gold", text: "มองเห็น AI usage และ routing ชัดขึ้น" },
        { color: "gold", text: "เอกสารใบเสนอราคา/ใบแจ้งหนี้ที่ใช้ต่อการขายจริง" },
        { color: "gold", text: "ขยาย API / webhook สำหรับ partner" },
      ],
      roadmap: "แผนงานตามไตรมาส",
      status: "สถานะ",
      goals: "เป้าหมาย",
      deliverables: "สิ่งที่จะส่งมอบ",
    },
    items: [
      {
        id: "built",
        quarter: "Built (ปัจจุบัน)",
        title: "มีรากฐาน commerce พร้อมใช้งานแล้ว",
        status: "done",
        tags: ["done", "foundation"],
        goals: ["วางแกนระบบปฏิบัติการจาก customer chat ไปสู่การทำงานหลังบ้านจริง"],
        deliverables: [
          "Inbox + Customer 360",
          "หน้า Orders / Payment / Shipping สำหรับทีมปฏิบัติการ",
          "Checkout link แบบ public ที่ผูกกับออเดอร์จริง",
          "AI tool runtime ที่เคารพสิทธิ์และขอบเขตการทำงาน",
        ],
      },
      {
        id: "q1",
        quarter: "Q1 2026",
        title: "Workflow จากแชทสู่การสร้างออเดอร์และ checkout ที่ตรวจสอบได้",
        status: "in_progress",
        tags: ["core", "workflow", "checkout"],
        goals: [
          "เปลี่ยนบทสนทนาลูกค้าให้ไหลเข้าสู่การสร้างออเดอร์จริงโดยกรอกซ้ำน้อยที่สุด",
          "เก็บเฉพาะข้อมูล checkout ที่ยังขาด และคงการยืนยันการชำระเงินไว้ให้คนกดเอง",
        ],
        deliverables: [
          "ชุด AI tools ฝั่งลูกค้าสำหรับค้นสินค้าและสร้างออเดอร์อย่างปลอดภัย",
          "หน้า checkout แบบ signed link ที่อิงออเดอร์จริงที่บันทึกแล้ว",
          "การส่งสลิปที่อยู่สถานะรอตรวจและยังต้องให้ staff กด confirm เอง",
        ],
      },
      {
        id: "q2",
        quarter: "Q2 2026",
        title: "Product discovery, สินค้าทดแทน, และการตัดสินใจเรื่องสต็อก",
        status: "planned",
        tags: ["discovery", "catalog", "stock"],
        goals: [
          "ช่วยให้ร้านตอบคำถามเรื่องสินค้าได้จาก availability ที่ตรวจสอบได้",
          "ทำให้การเช็กสต็อกนำไปสู่การตัดสินใจที่ชัดเจน: ขายเลย, เสนอของแทน, หรือเก็บ restock demand",
        ],
        deliverables: [
          "ค้น catalog ที่ขายได้จริงแบบสดจากสินค้า active + in-stock",
          "เสนอสินค้า/ไซซ์ทางเลือกเมื่อรายการที่ลูกค้าถามไม่มี",
          "แนวทางการตอบเรื่องสต็อกที่ชัดทั้งฝั่ง AI และ staff",
        ],
      },
      {
        id: "q3",
        quarter: "Q3 2026",
        title: "Restock capture และ loop กู้ยอดขายกลับมา",
        status: "planned",
        tags: ["restock", "retention", "recovery"],
        goals: [
          "กู้ยอดขายที่อาจหายไปเมื่อสินค้าหมด",
          "ให้ทีมงานมี flow ติดตามลูกค้ากลับมาอย่างเป็นระบบเมื่อของเข้า",
        ],
        deliverables: [
          "restock subscription จากบทสนทนาลูกค้าเมื่อมีการยินยอม",
          "หน้าให้ทีมงานตรวจข้อความ ส่งซ้ำ และติดตามเมื่อตัวสินค้ากลับมาพร้อมขาย",
          "วาง framing เรื่องรายได้ที่กู้กลับมาได้จากแชทที่เคยจบเพราะของหมด",
        ],
      },
      {
        id: "q4",
        quarter: "Q4 2026",
        title: "AI ตอบตาม archetype ร้านและรูปแบบการขายของแต่ละธุรกิจ",
        status: "done",
        tags: ["ai", "archetype", "done"],
        goals: [
          "ให้ AI ตอบต่างกันตามประเภทร้าน โดยไม่หลุดจาก facts จริง",
          "รองรับทั้งร้านที่ขายเร็ว ร้านที่ต้องแนะนำเยอะ และร้านที่ต้องตอบเรื่อง compatibility",
        ],
        deliverables: [
          "ตัวอย่างบทสนทนาตาม archetype เช่น fashion, grocery, beauty, gadgets",
          "การแนะนำสินค้าที่ยังยึด approved tools และข้อมูล backend เป็นฐาน",
          "pattern การตอบที่ปลอดภัยขึ้นสำหรับของหมดและการเสนอสินค้าทดแทน",
        ],
      },
      {
        id: "q1_2027",
        quarter: "Q1 2027",
        title: "Follow-up, repeat sale, และภาพรวมธุรกิจที่มองเห็นได้",
        status: "planned",
        tags: ["analytics", "api", "growth"],
        goals: [
          "ให้ร้านเห็นว่าแชทไหนกลายเป็นออเดอร์, restock recovery, หรือ repeat sale",
          "เปิดข้อมูลปฏิบัติการที่สะอาดพอสำหรับ partner และ reporting ภายใน",
        ],
        deliverables: [
          "analytics ข้าม chat, orders, payments, shipping และ restock recovery",
          "การมองเห็น follow-up / repeat sale หลังส่งของหรือหลังลูกค้าไม่ได้ซื้อรอบแรก",
          "API read-only + webhook events สำหรับการเชื่อมต่อ ecosystem",
        ],
      },
    ],
  },
};

function statusColor(status: Status) {
  if (status === "done") return "green";
  if (status === "in_progress") return "blue";
  return "default";
}

function statusIcon(status: Status) {
  if (status === "done") return <CheckCircleOutlined />;
  if (status === "in_progress") return <ClockCircleOutlined />;
  return <RocketOutlined />;
}

export default function RoadmapRedBoxContent() {
  const { lang } = useI18n();
  const content = resolveBilingual(ROADMAP_CONTENT, lang);

  const iconsById: Record<string, React.ReactNode> = {
    built: <CheckCircleOutlined />,
    q1: <SafetyCertificateOutlined />,
    q2: <TeamOutlined />,
    q3: <ShareAltOutlined />,
    q4: <RocketOutlined />,
    q1_2027: <BarChartOutlined />,
  };

  const items: RoadmapItem[] = useMemo(
    () =>
      content.items.map((it) => ({
        ...it,
        icon: iconsById[it.id] ?? undefined,
      })),
    [content]
  );

  const doneCount = items.filter((i) => i.status === "done").length;
  const inProgressCount = items.filter((i) => i.status === "in_progress").length;
  const plannedCount = items.filter((i) => i.status === "planned").length;

  const progress =
    Math.round(
      (items.reduce((sum, i) => sum + (i.status === "done" ? 100 : i.status === "in_progress" ? 50 : 0), 0) /
        (items.length * 100)) *
        100
    ) || 0;

  const timelineItems: TimelineProps["items"] = items.map((it) => ({
    dot: it.icon || statusIcon(it.status),
    color: statusColor(it.status) as any,
    children: (
      <div style={{ paddingBottom: 6 }}>
        <Row gutter={[12, 6]} align="middle" justify="space-between">
          <Col>
            <Space direction="vertical" size={0}>
              <Text type="secondary">{it.quarter}</Text>
              <Text strong style={{ fontSize: 15 }}>
                {it.title}
              </Text>
            </Space>
          </Col>
          <Col>
            <Tag color={statusColor(it.status)} icon={statusIcon(it.status)}>
              {content.labels.status}:{" "}
              {it.status === "done"
                ? content.labels.done
                : it.status === "in_progress"
                  ? content.labels.inProgress
                  : content.labels.planned}
            </Tag>
          </Col>
        </Row>

        <Row gutter={[12, 12]} style={{ marginTop: 10 }}>
          <Col xs={24} md={12}>
            <Text strong>{content.labels.goals}</Text>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {it.goals.map((g) => (
                <li key={g}>
                  <Text>{g}</Text>
                </li>
              ))}
            </ul>
          </Col>
          <Col xs={24} md={12}>
            <Text strong>{content.labels.deliverables}</Text>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {it.deliverables.map((d) => (
                <li key={d}>
                  <Text>{d}</Text>
                </li>
              ))}
            </ul>
          </Col>
        </Row>

        {it.tags?.length ? (
          <div style={{ marginTop: 6 }}>
            <Space wrap>
              {it.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </Space>
          </div>
        ) : null}

        <Divider style={{ margin: "12px 0 0" }} />
      </div>
    ),
  }));

  return (
    <div style={{ width: "100%", minHeight: 520, padding: 16 }}>
      <Card
        bordered={false}
        style={{
          borderRadius: 14,
          boxShadow: "0 1px 10px rgba(var(--app-shadow-rgb),0.12)",
          overflow: "hidden",
          height: "100%",
        }}
        bodyStyle={{ padding: 16 }}
      >
        <Row align="middle" justify="space-between" style={{ marginBottom: 8 }}>
          <Col>
            <Space direction="vertical" size={0}>
              <Title level={4} style={{ margin: 0 }}>
                {content.labels.pageTitle}
              </Title>
              <Text type="secondary">{content.labels.subtitle}</Text>
            </Space>
          </Col>
          <Col>
            <Space wrap>
              <Tag color="green">
                {content.labels.done}: {doneCount}
              </Tag>
              <Tag color="blue">
                {content.labels.inProgress}: {inProgressCount}
              </Tag>
              <Tag>
                {content.labels.planned}: {plannedCount}
              </Tag>
            </Space>
          </Col>
        </Row>

        <Divider style={{ margin: "12px 0" }} />

        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}>
            <Card size="small" title={content.labels.progressLabel} bordered>
              <Progress percent={progress} />
            </Card>

            <Card size="small" title={content.labels.keyObjectives} bordered style={{ marginTop: 12 }}>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {content.labels.objectives.map((p) => (
                  <li key={p}>
                    <Text>{p}</Text>
                  </li>
                ))}
              </ul>
            </Card>
          </Col>

          <Col xs={24} md={12}>
            <Card
              size="small"
              title={content.labels.notes}
              bordered
              extra={<Tag icon={<AlertOutlined />}>{content.labels.recommendTag}</Tag>}
            >
              <Paragraph style={{ marginBottom: 0 }}>{content.labels.notesText}</Paragraph>
              <Divider style={{ margin: "12px 0" }} />
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Space>
                  <FileTextOutlined />
                  <Text>{content.labels.tip1}</Text>
                </Space>
                <Space>
                  <SearchOutlined />
                  <Text>{content.labels.tip2}</Text>
                </Space>
              </Space>
            </Card>
          </Col>
        </Row>

        <Divider style={{ margin: "12px 0" }} />

        <Card size="small" title={content.labels.suggestedAdd} bordered style={{ marginBottom: 12 }}>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={12}>
              <Space direction="vertical" size={6}>
                {content.labels.suggest.slice(0, 4).map((s) => (
                  <Badge key={s.text} color={s.color as any} text={s.text} />
                ))}
              </Space>
            </Col>
            <Col xs={24} md={12}>
              <Space direction="vertical" size={6}>
                {content.labels.suggest.slice(4).map((s) => (
                  <Badge key={s.text} color={s.color as any} text={s.text} />
                ))}
              </Space>
            </Col>
          </Row>
        </Card>

        <Card size="small" title={content.labels.roadmap} bordered>
          <Timeline items={timelineItems} />
        </Card>
      </Card>
    </div>
  );
}
