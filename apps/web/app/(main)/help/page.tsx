'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import {
  Alert,
  Anchor,
  Button,
  Card,
  Col,
  Collapse,
  Divider,
  List,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  BookOutlined,
  CheckCircleOutlined,
  CompassOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  SafetyOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  TruckOutlined,
} from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

const quickPaths = [
  {
    title: 'เริ่มใช้สำหรับเจ้าของร้าน',
    icon: <ShopOutlined />,
    points: [
      'เพิ่มสินค้า ราคา รูป และ stock ให้พร้อมขาย',
      'ตั้งค่าช่องทางรับเงินและข้อมูลร้านให้ครบ',
      'ลอง flow จริงผ่าน Inbox และ Checkout',
    ],
    href: '/admin/manual',
    cta: 'ดูคู่มือฝั่งแอดมิน',
  },
  {
    title: 'เริ่มใช้สำหรับทีมขาย/แอดมิน',
    icon: <MessageOutlined />,
    points: [
      'เริ่มจาก Inbox และ Customer 360',
      'สร้างออเดอร์จากข้อมูลจริง ไม่คีย์ซ้ำหลายหน้า',
      'ตามงานต่อใน Orders, Payment และ Shipping',
    ],
    href: '/admin/inbox',
    cta: 'เปิด Inbox',
  },
  {
    title: 'เริ่มใช้ผู้ช่วย AI',
    icon: <RobotOutlined />,
    points: [
      'AI ช่วยตอบจากข้อมูลที่ตรวจสอบได้เท่านั้น',
      'งานเสี่ยง เช่น refund หรือ cancel ยังต้องให้คนกดยืนยัน',
      'ถ้าข้อมูลไม่พอ ระบบควรถามต่อ ไม่เดาเอง',
    ],
    href: '/admin/assistant',
    cta: 'ดูผู้ช่วย AI',
  },
];

const flowCards = [
  {
    title: '1. ลูกค้าทักเข้ามา',
    icon: <MessageOutlined />,
    text: 'เริ่มที่ Inbox เพื่ออ่านบทสนทนา ดู Customer 360 และดูว่าลูกค้าคนนี้เคยสั่งอะไรไว้แล้วบ้าง',
  },
  {
    title: '2. AI ช่วยตีความและค้นของ',
    icon: <RobotOutlined />,
    text: 'AI ใช้เฉพาะเครื่องมือที่อนุมัติไว้เพื่อค้นสินค้า เช็กสต็อก แนะนำทางเลือก หรือเปิดคิวแจ้งเมื่อของเข้า',
  },
  {
    title: '3. สร้างออเดอร์และ Checkout',
    icon: <ShoppingCartOutlined />,
    text: 'เมื่อข้อมูลครบ ระบบสร้างออเดอร์จริงและส่งลิงก์ Checkout ที่ผูกกับออเดอร์นั้นโดยตรง',
  },
  {
    title: '4. รับชำระและตรวจสลิป',
    icon: <CheckCircleOutlined />,
    text: 'ลูกค้าส่งหลักฐานชำระเงินได้ แต่การยืนยันยังต้องมีคนตรวจและกด Confirm เองเสมอ',
  },
  {
    title: '5. จัดส่งและปิดงาน',
    icon: <TruckOutlined />,
    text: 'หลังชำระแล้ว ทีมงานตามต่อใน Shipping จนงานครบ และดูภาพรวมที่ Dashboard หรือ Reports',
  },
];

const surfaceCards = [
  {
    title: 'Inbox + Customer 360',
    subtitle: 'ศูนย์กลางการคุยกับลูกค้า',
    bullets: [
      'ดูแชทใหม่ ลูกค้าคนเดิม และประวัติซื้อโดยไม่ต้องสลับหลายหน้า',
      'แชร์สินค้า คูปอง หรือสร้างออเดอร์ต่อจากบทสนทนาได้',
      'เหมาะเป็นหน้าแรกของทีมที่ต้องตอบลูกค้าทุกวัน',
    ],
    href: '/admin/inbox',
  },
  {
    title: 'Orders / Payment / Shipping',
    subtitle: 'สามหน้าที่ทำงานต่อกันเป็น flow เดียว',
    bullets: [
      'Orders ใช้ตามสถานะขายและยอดสุทธิ',
      'Payment ใช้ตรวจสลิปและยืนยันการชำระเงิน',
      'Shipping ใช้บันทึกขนส่งและเลขพัสดุจนส่งสำเร็จ',
    ],
    href: '/admin/orders',
  },
  {
    title: 'Products / Purchase',
    subtitle: 'ดูแลของที่ขายและของที่ต้องรับเข้า',
    bullets: [
      'เพิ่มสินค้าแบบมีรูปหลายรูป ราคา และ stock ต่อไซซ์',
      'ใช้ Purchase เพื่อรับของเข้าคลังโดยไม่แยก logic คนละทาง',
      'ถ้าของหมด AI ควรเสนอของแทนหรือชวนกดแจ้งเมื่อของเข้า',
    ],
    href: '/admin/products',
  },
  {
    title: 'Admin Manual',
    subtitle: 'คู่มือเชิงปฏิบัติการในระบบ',
    bullets: [
      'เหมาะกับการ onboard พนักงานใหม่',
      'อธิบาย flow งานจริงมากกว่าคำอธิบายเชิงเทคนิค',
      'เป็นจุดอ้างอิงหลักเมื่อทีมอยากรู้ว่าเมนูไหนใช้ทำอะไร',
    ],
    href: '/admin/manual',
  },
];

const restockBenefits = [
  {
    title: 'ไม่เสียบทสนทนาเพราะของหมด',
    detail:
      'แทนที่จะตอบจบแค่ว่า “สินค้าหมด” ระบบสามารถชวนลูกค้า opt-in เพื่อรอแจ้งเมื่อของเข้า ทำให้โอกาสขายไม่หายไปพร้อมกับข้อความนั้น',
  },
  {
    title: 'เปลี่ยน demand ที่ยังซื้อไม่ได้ให้กลายเป็นคิวติดตาม',
    detail:
      'ร้านเห็นได้ว่ามีใครรอสินค้าอะไรอยู่บ้าง จึงใช้เป็นสัญญาณสำหรับเติมสต็อก จัดลำดับงานขาย หรือวัดว่าของหมดตัวไหนทำให้เสียยอดมากที่สุด',
  },
  {
    title: 'ช่วยให้ทีมขายกลับมาปิดการขายได้เป็นระบบ',
    detail:
      'เมื่อของเข้า ทีมสามารถเปิดรายการคิว ตรวจข้อความ และส่งหาเฉพาะลูกค้าที่เคยยินยอมไว้ แทนการไล่ค้นแชทย้อนหลังด้วยมือ',
  },
];

const restockExamples = [
  {
    situation: 'ร้านแฟชั่น: เดรสสีดำไซซ์ M หมด',
    outcome:
      'AI ควรเสนอไซซ์หรือรุ่นใกล้เคียงก่อน ถ้าลูกค้ายังอยากรอรุ่นเดิม ระบบจึงชวนเปิดแจ้งเมื่อของเข้าไว้ พอ stock กลับมา ทีมขายส่ง follow-up ได้ทันที',
  },
  {
    situation: 'ร้านของชำ: สินค้าโปรขายดีหมดชั่วคราว',
    outcome:
      'แทนที่จะเสียลูกค้าไป ร้านเก็บชื่อคนที่รอสินค้าไว้ได้ แล้วใช้รายการนี้ช่วยประเมินว่าควรเติมของรอบหน้าเท่าไร พร้อมติดต่อกลับเมื่อล็อตใหม่มาถึง',
  },
  {
    situation: 'ร้าน beauty: routine ขาดตัวหลักหนึ่งชิ้น',
    outcome:
      'AI ยังช่วยแนะนำสินค้าที่มีอยู่ได้ แต่ถ้าลูกค้าอยากได้ตัวเดิมจริง ระบบควรเก็บ restock queue ไว้เพื่อปิดการขายกลับมาเมื่อสินค้าครบชุดอีกครั้ง',
  },
];

const archetypeConversations = [
  {
    title: 'Mini Mart / Grocery',
    customer: 'มีมาม่าต้มยำ 6 ซองไหม เอา 3 แพ็ก แล้วโค้ก 1.25 ลิตร 2 ขวด',
    assistant:
      'ได้ค่ะ เดี๋ยวเช็กสินค้าที่พร้อมขายจริงให้ก่อน ถ้าครบจะสรุปรายการและยอดให้ทันที ถ้าตัวไหนหมด ระบบควรเสนอของใกล้เคียงหรือชวนแจ้งเมื่อของเข้าแทน',
    why: 'สื่อว่า AI เข้าใจการสั่งแบบเร็ว หลายชิ้น และพร้อมพาไปสู่การสร้างออเดอร์จริง',
  },
  {
    title: 'Fashion & Apparel',
    customer: 'เดรสรุ่นนี้มีไซซ์ M ไหม ถ้าไม่มีช่วยแนะนำทรงใกล้เคียงให้หน่อย',
    assistant:
      'ได้ค่ะ เดี๋ยวเช็กไซซ์ M ของรุ่นนี้ก่อน ถ้าหมดจะเสนอรุ่นใกล้เคียงที่ยังมีสต็อก และถ้าคุณลูกค้าอยากรอรุ่นเดิม เราเปิดแจ้งเมื่อของเข้าไว้ให้ได้ค่ะ',
    why: 'สื่อว่า AI ไม่ได้ตอบแค่มีหรือไม่มี แต่เข้าใจเรื่องไซซ์ ทางเลือก และการเก็บโอกาสขายกลับมา',
  },
  {
    title: 'Beauty & Personal Care',
    customer: 'ผิวแพ้ง่าย เป็นสิวง่าย มีเซ็ตล้างหน้า-บำรุงที่อ่อนโยนไหม',
    assistant:
      'ได้ค่ะ เดี๋ยวคัดสินค้าที่ตรงกับผิวแพ้ง่ายจากรายการที่ร้านมีจริงก่อน แล้วช่วยจัดเป็น routine สั้น ๆ ให้ พร้อมเช็กว่าสินค้าครบชุดหรือมีตัวไหนควรเปิดแจ้งเมื่อของเข้าไว้',
    why: 'สื่อว่า AI ตอบแบบ consultative ได้ และยังยึดสินค้าที่ร้านมีจริงเป็นฐาน',
  },
  {
    title: 'Gadgets & Accessories',
    customer: 'เคส iPhone 15 Pro มีไหม แล้วมีกระจกกับสายชาร์จที่ใช้ด้วยกันได้แนะนำไหม',
    assistant:
      'ได้ค่ะ เดี๋ยวเช็กเคสที่ตรงรุ่นก่อน แล้วค่อยแนะนำอุปกรณ์เสริมที่เข้ากันได้จริง ถ้ารุ่นที่อยากได้หมด ระบบควรเสนอทางเลือกหรือเปิดคิวแจ้งเมื่อของเข้าไว้ให้ได้ค่ะ',
    why: 'สื่อว่า AI เข้าใจเรื่อง compatibility และ cross-sell สินค้าที่เกี่ยวข้อง',
  },
];

const faqItems = [
  {
    key: 'faq-1',
    label: 'หน้านี้ต่างจากคู่มือใน /admin/manual ยังไง',
    children: (
      <Paragraph style={{ marginBottom: 0 }}>
        หน้า <Text code>/help</Text> เป็น mockup ของศูนย์ช่วยเหลือภาพรวมระบบ ส่วนหน้า{' '}
        <Text code>/admin/manual</Text> เป็นคู่มือปฏิบัติงานฝั่งแอดมินที่ลงรายละเอียดราย flow มากกว่า
      </Paragraph>
    ),
  },
  {
    key: 'faq-2',
    label: 'AI ทำอะไรได้จริง และอะไรยังต้องให้คนกดเอง',
    children: (
      <Paragraph style={{ marginBottom: 0 }}>
        AI ช่วยค้นข้อมูล สรุป แนะนำสินค้า หรือเตรียมคำขอสำหรับงานสำคัญได้ แต่การคืนเงิน ยืนยันสลิป ยกเลิกออเดอร์
        ปรับสต็อก หรือ merge ลูกค้า ยังต้องให้คนที่มีสิทธิ์กดยืนยันเอง
      </Paragraph>
    ),
  },
  {
    key: 'faq-3',
    label: 'ถ้าสินค้าหมด ระบบควรตอบอย่างไร',
    children: (
      <Paragraph style={{ marginBottom: 0 }}>
        ระบบใหม่ไม่ควรจบแค่คำว่าไม่มีสินค้า แต่ควรเสนอไซซ์หรือสินค้าทางเลือกที่ยังมีอยู่ หรือชวนลูกค้า opt-in
        เพื่อแจ้งเมื่อของเข้าตาม flow ที่ระบบรองรับจริง
      </Paragraph>
    ),
  },
  {
    key: 'faq-4',
    label: 'Checkout public link ใช้อย่างไร',
    children: (
      <Paragraph style={{ marginBottom: 0 }}>
        ลิงก์ Checkout ถูกสร้างจากออเดอร์จริงที่บันทึกแล้ว ลูกค้าใช้ลิงก์นี้เพื่อเช็กข้อมูลจัดส่งที่ขาดและแนบสลิปได้
        แต่หน้า Checkout ไม่ได้ยืนยันการชำระเงินให้อัตโนมัติ
      </Paragraph>
    ),
  },
];

export default function HelpPage() {
  const anchorItems = useMemo(
    () => [
      { key: 'overview', href: '#overview', title: 'ภาพรวมระบบ' },
      { key: 'quick-paths', href: '#quick-paths', title: 'เริ่มจากตรงไหนดี' },
      { key: 'flow', href: '#flow', title: 'Flow งานจริง' },
      { key: 'restock', href: '#restock', title: 'Restock queue' },
      { key: 'archetypes', href: '#archetypes', title: 'บทสนทนาตาม archetype' },
      { key: 'surfaces', href: '#surfaces', title: 'หน้าหลักในระบบ' },
      { key: 'guardrails', href: '#guardrails', title: 'กติกา AI' },
      { key: 'faq', href: '#faq', title: 'FAQ' },
    ],
    []
  );

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px 64px' }}>
      <Row gutter={[24, 24]} align="top">
        <Col xs={24} lg={17}>
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <section id="overview" style={{ scrollMarginTop: 88 }}>
              <Card
                style={{
                  borderRadius: 24,
                  overflow: 'hidden',
                  background:
                    'linear-gradient(135deg, rgba(10,37,64,1) 0%, rgba(17,85,110,1) 54%, rgba(146,199,109,1) 100%)',
                }}
                styles={{ body: { padding: 28 } }}
              >
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Tag
                    color="gold"
                    style={{ width: 'fit-content', borderRadius: 999, paddingInline: 12, margin: 0 }}
                  >
                    Mockup /help สำหรับระบบใหม่
                  </Tag>
                  <Title level={1} style={{ margin: 0, color: '#fff' }}>
                    BMS Help Center
                  </Title>
                  <Paragraph style={{ margin: 0, color: 'rgba(255,255,255,0.88)', fontSize: 17 }}>
                    หน้านี้ถูกปรับใหม่ให้เข้ากับ BMS โดยสรุปว่า “ลูกค้าทักมาแล้วระบบพาไปถึงออเดอร์ การชำระเงิน
                    และการจัดส่งอย่างไร” แทน help page แบบ generic เดิม
                  </Paragraph>
                  <Alert
                    type="info"
                    showIcon
                    message="Customer → AI → CRM → Order → Inventory → Payment → Shipping → Dashboard"
                    description="ใช้เป็นหน้าเริ่มต้นสำหรับคนที่อยากเข้าใจภาพรวมระบบก่อนลงลึกในคู่มือฝั่งแอดมิน"
                    style={{ borderRadius: 16 }}
                  />
                  <Space wrap>
                    <Button type="primary" size="large" href="#quick-paths">
                      ดู mockup นี้ต่อ
                    </Button>
                    <Button size="large" href="/admin/manual">
                      ไปที่คู่มือแอดมินจริง
                    </Button>
                  </Space>
                </Space>
              </Card>
            </section>

            <section id="quick-paths" style={{ scrollMarginTop: 88 }}>
              <Card title="เริ่มจากตรงไหนดี" style={{ borderRadius: 22 }}>
                <Row gutter={[16, 16]}>
                  {quickPaths.map((item) => (
                    <Col xs={24} md={12} xl={8} key={item.title}>
                      <Card style={{ height: '100%', borderRadius: 18 }}>
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          <Space>
                            {item.icon}
                            <Text strong>{item.title}</Text>
                          </Space>
                          <List
                            size="small"
                            dataSource={item.points}
                            renderItem={(point) => <List.Item>{point}</List.Item>}
                          />
                          <Link href={item.href}>
                            <Button type="link" style={{ paddingInline: 0 }}>
                              {item.cta}
                            </Button>
                          </Link>
                        </Space>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Card>
            </section>

            <section id="flow" style={{ scrollMarginTop: 88 }}>
              <Card title="Flow งานจริงของระบบ" style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Paragraph type="secondary" style={{ margin: 0 }}>
                    นี่คือแกนของระบบใหม่: AI ไม่ใช่แค่ตอบแชท แต่เป็นตัวเชื่อมจากบทสนทนาไปสู่ workflow ธุรกิจที่ตรวจสอบได้
                  </Paragraph>
                  <Row gutter={[16, 16]}>
                    {flowCards.map((item) => (
                      <Col xs={24} md={12} xl={8} key={item.title}>
                        <Card style={{ height: '100%', borderRadius: 18 }}>
                          <Space direction="vertical" size={10}>
                            <Space>
                              {item.icon}
                              <Text strong>{item.title}</Text>
                            </Space>
                            <Paragraph style={{ margin: 0 }}>{item.text}</Paragraph>
                          </Space>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                </Space>
              </Card>
            </section>

            <section id="restock" style={{ scrollMarginTop: 88 }}>
              <Card title="Restock queue ปิดการขายกลับมาได้อย่างไร" style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Alert
                    type="success"
                    showIcon
                    message="Restock queue คือการเปลี่ยนคำว่า “ของหมด” ให้กลายเป็นโอกาสขายรอบถัดไป"
                    description="เหมาะกับร้านที่ของบางรายการหมดบ่อย แต่ลูกค้ายังมี intent ซื้ออยู่ ถ้าจบแชทเร็วเกินไป ร้านจะเสียทั้งยอดขายและข้อมูล demand ที่ควรเก็บไว้"
                    style={{ borderRadius: 16 }}
                  />
                  <Row gutter={[16, 16]}>
                    {restockBenefits.map((item) => (
                      <Col xs={24} md={8} key={item.title}>
                        <Card style={{ height: '100%', borderRadius: 18 }}>
                          <Space direction="vertical" size={8}>
                            <Text strong>{item.title}</Text>
                            <Paragraph style={{ margin: 0 }}>{item.detail}</Paragraph>
                          </Space>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                  <Divider style={{ margin: '4px 0' }} />
                  <div>
                    <Text strong style={{ fontSize: 16 }}>
                      ตัวอย่างที่เห็นภาพ
                    </Text>
                    <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                      {restockExamples.map((item) => (
                        <Col xs={24} md={8} key={item.situation}>
                          <Card size="small" style={{ height: '100%', borderRadius: 16 }}>
                            <Space direction="vertical" size={8}>
                              <Tag color="gold">{item.situation}</Tag>
                              <Paragraph style={{ margin: 0 }}>{item.outcome}</Paragraph>
                            </Space>
                          </Card>
                        </Col>
                      ))}
                    </Row>
                  </div>
                </Space>
              </Card>
            </section>

            <section id="archetypes" style={{ scrollMarginTop: 88 }}>
              <Card title="บทสนทนาตาม archetype ของร้าน" style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Paragraph type="secondary" style={{ margin: 0 }}>
                    ส่วนนี้ใช้สื่อว่า BMS ไม่ได้ตอบแบบสคริปต์เดียวทุกธุรกิจ แต่ปรับน้ำหนักการตอบตามบริบทร้าน
                    โดยยังต้องยึดข้อมูลสินค้าและสต็อกจริงจาก backend เหมือนเดิม
                  </Paragraph>
                  <Row gutter={[16, 16]}>
                    {archetypeConversations.map((item) => (
                      <Col xs={24} md={12} key={item.title}>
                        <Card style={{ height: '100%', borderRadius: 18 }}>
                          <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            <Tag color="blue">{item.title}</Tag>
                            <div>
                              <Text strong>ลูกค้าถาม</Text>
                              <Paragraph style={{ margin: '4px 0 0' }}>{item.customer}</Paragraph>
                            </div>
                            <div>
                              <Text strong>AI ควรตอบในแนวนี้</Text>
                              <Paragraph style={{ margin: '4px 0 0' }}>{item.assistant}</Paragraph>
                            </div>
                            <Alert
                              type="info"
                              showIcon
                              message="สิ่งที่ตัวอย่างนี้สื่อ"
                              description={item.why}
                              style={{ borderRadius: 14 }}
                            />
                          </Space>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                </Space>
              </Card>
            </section>

            <section id="surfaces" style={{ scrollMarginTop: 88 }}>
              <Card title="หน้าหลักที่ผู้ใช้จะเจอ" style={{ borderRadius: 22 }}>
                <Row gutter={[16, 16]}>
                  {surfaceCards.map((item) => (
                    <Col xs={24} md={12} key={item.title}>
                      <Card style={{ height: '100%', borderRadius: 18 }}>
                        <Space direction="vertical" size={10} style={{ width: '100%' }}>
                          <div>
                            <Text strong style={{ fontSize: 16 }}>
                              {item.title}
                            </Text>
                            <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                              {item.subtitle}
                            </Paragraph>
                          </div>
                          <List
                            size="small"
                            dataSource={item.bullets}
                            renderItem={(point) => <List.Item>{point}</List.Item>}
                          />
                          <Link href={item.href}>
                            <Button type="link" style={{ paddingInline: 0 }}>
                              เปิดหน้านี้
                            </Button>
                          </Link>
                        </Space>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Card>
            </section>

            <section id="guardrails" style={{ scrollMarginTop: 88 }}>
              <Card title="กติกา AI ที่หน้า help ต้องสื่อให้ชัด" style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Alert
                    type="warning"
                    showIcon
                    icon={<SafetyOutlined />}
                    message="AI เป็นตัวช่วย orchestration ไม่ใช่แหล่งความจริงของธุรกิจ"
                    description="ข้อมูลสต็อก ราคา ออเดอร์ การจ่ายเงิน และสิทธิ์ต่าง ๆ ต้องมาจาก backend ที่ตรวจสอบได้ ไม่ใช่จากข้อความที่ AI เดาเอง"
                    style={{ borderRadius: 16 }}
                  />
                  <Row gutter={[12, 12]}>
                    <Col xs={24} md={12}>
                      <Card size="small" style={{ borderRadius: 16 }}>
                        <Space direction="vertical" size={8}>
                          <Text strong>สิ่งที่ AI ทำได้</Text>
                          <Tag color="blue">ค้นสินค้า</Tag>
                          <Tag color="blue">เช็กสต็อก</Tag>
                          <Tag color="blue">สรุปข้อมูล</Tag>
                          <Tag color="blue">แนะนำทางเลือก</Tag>
                          <Tag color="blue">เตรียม proposal</Tag>
                        </Space>
                      </Card>
                    </Col>
                    <Col xs={24} md={12}>
                      <Card size="small" style={{ borderRadius: 16 }}>
                        <Space direction="vertical" size={8}>
                          <Text strong>สิ่งที่ยังต้องให้คนยืนยัน</Text>
                          <Tag color="red">Confirm payment</Tag>
                          <Tag color="red">Refund</Tag>
                          <Tag color="red">Cancel order</Tag>
                          <Tag color="red">Adjust stock</Tag>
                          <Tag color="red">Merge customer</Tag>
                        </Space>
                      </Card>
                    </Col>
                  </Row>
                </Space>
              </Card>
            </section>

            <section id="faq" style={{ scrollMarginTop: 88 }}>
              <Card
                title={
                  <Space>
                    <QuestionCircleOutlined />
                    <span>คำถามที่น่าจะเจอบ่อยในระบบใหม่</span>
                  </Space>
                }
                style={{ borderRadius: 22 }}
              >
                <Collapse items={faqItems} bordered={false} />
              </Card>
            </section>

            <Card style={{ borderRadius: 22 }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space>
                  <CompassOutlined />
                  <Text strong>หมายเหตุของ mockup นี้</Text>
                </Space>
                <Paragraph style={{ margin: 0 }}>
                  หน้านี้ยังเป็น static mockup เพื่อปรับ message และ information architecture ก่อน ยังไม่ได้ต่อ search,
                  analytics หรือ dynamic help content
                </Paragraph>
                <Divider style={{ margin: '8px 0' }} />
                <Paragraph type="secondary" style={{ margin: 0 }}>
                  ถ้าทิศทางนี้โอเค รอบถัดไปเราค่อยแตกต่อเป็น version ใช้งานจริง เช่น search, role-based quick links,
                  และ deep-link ไปยังคู่มือรายเมนู
                </Paragraph>
              </Space>
            </Card>
          </Space>
        </Col>

        <Col xs={24} lg={7}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title="สารบัญ" style={{ borderRadius: 20 }}>
              <Anchor items={anchorItems} affix={false} />
            </Card>

            <Card title="ทางลัดที่เกี่ยวข้อง" style={{ borderRadius: 20 }}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Link href="/admin/manual">/admin/manual</Link>
                <Link href="/admin/inbox">/admin/inbox</Link>
                <Link href="/admin/orders">/admin/orders</Link>
                <Link href="/admin/assistant">/admin/assistant</Link>
              </Space>
            </Card>

            <Card title="สถานะตอนนี้" style={{ borderRadius: 20 }}>
              <Space direction="vertical" size={10}>
                <Tag color="processing" icon={<BookOutlined />}>
                  Help page ถูกปรับเป็น mockup ใหม่แล้ว
                </Tag>
                <Paragraph type="secondary" style={{ margin: 0 }}>
                  ใช้สำหรับรีวิว direction ก่อนขยายเป็น help center เต็มรูปแบบ
                </Paragraph>
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>
    </div>
  );
}
