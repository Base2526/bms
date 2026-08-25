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
import { useI18n } from '@/lib/i18nContext';
import { resolveBilingual, type Bilingual } from '@/lib/static-page-i18n';

const { Title, Paragraph, Text } = Typography;

const ICONS: Record<string, React.ReactNode> = {
  shop: <ShopOutlined />,
  message: <MessageOutlined />,
  robot: <RobotOutlined />,
  cart: <ShoppingCartOutlined />,
  check: <CheckCircleOutlined />,
  truck: <TruckOutlined />,
};

type QuickPath = { key: string; title: string; points: string[]; href: string; cta: string };
type FlowCard = { key: string; title: string; text: string };
type SurfaceCard = { title: string; subtitle: string; bullets: string[]; href: string };
type RestockBenefit = { title: string; detail: string };
type RestockExample = { situation: string; outcome: string };
type ArchetypeConversation = { title: string; customer: string; assistant: string; why: string };
type FaqItem = { key: string; label: string; body: React.ReactNode };

type HelpContent = {
  badge: string;
  heroTitle: string;
  heroLead: string;
  heroAlertDesc: string;
  ctaPrimary: string;
  ctaSecondary: string;
  anchors: {
    overview: string;
    quickPaths: string;
    flow: string;
    restock: string;
    archetypes: string;
    surfaces: string;
    guardrails: string;
    faq: string;
  };
  quickPathsTitle: string;
  quickPaths: QuickPath[];
  flowTitle: string;
  flowIntro: string;
  flowCards: FlowCard[];
  restockTitle: string;
  restockAlertMessage: string;
  restockAlertDesc: string;
  restockBenefits: RestockBenefit[];
  restockExamplesLabel: string;
  restockExamples: RestockExample[];
  archetypesTitle: string;
  archetypesIntro: string;
  customerLabel: string;
  assistantLabel: string;
  whyLabel: string;
  archetypeConversations: ArchetypeConversation[];
  surfacesTitle: string;
  surfaceCards: SurfaceCard[];
  openPageCta: string;
  guardrailsTitle: string;
  guardrailsAlertMessage: string;
  guardrailsAlertDesc: string;
  aiCanTitle: string;
  aiCanTags: string[];
  aiCannotTitle: string;
  aiCannotTags: string[];
  faqSectionTitle: string;
  faqItems: FaqItem[];
  noteTitle: string;
  noteBody1: string;
  noteBody2: string;
  sidebarTocTitle: string;
  sidebarShortcutsTitle: string;
  sidebarStatusTitle: string;
  sidebarStatusTag: string;
  sidebarStatusDesc: string;
};

function faqBody(text: React.ReactNode): React.ReactNode {
  return <Paragraph style={{ marginBottom: 0 }}>{text}</Paragraph>;
}

const HELP: Bilingual<HelpContent> = {
  en: {
    badge: 'Mockup /help for the new system',
    heroTitle: 'BMS Help Center',
    heroLead:
      'This page has been reworked for BMS to explain "when a customer messages in, how does the system carry that through to an order, payment, and shipping" instead of the old generic help page.',
    heroAlertDesc:
      'Use this as a starting point for anyone who wants to understand the system overview before diving into the admin manual.',
    ctaPrimary: 'Keep reading this mockup',
    ctaSecondary: 'Go to the real admin manual',
    anchors: {
      overview: 'System overview',
      quickPaths: 'Where to start',
      flow: 'The real workflow',
      restock: 'Restock queue',
      archetypes: 'Conversations by archetype',
      surfaces: 'Main pages',
      guardrails: 'AI ground rules',
      faq: 'FAQ',
    },
    quickPathsTitle: 'Where should you start?',
    quickPaths: [
      {
        key: 'shop',
        title: 'Getting started as a shop owner',
        points: [
          'Add products, prices, images, and stock so you are ready to sell',
          'Set up your payment channels and shop information completely',
          'Try the real flow through Inbox and Checkout',
        ],
        href: '/admin/manual',
        cta: 'View the admin manual',
      },
      {
        key: 'message',
        title: 'Getting started as sales/admin staff',
        points: [
          'Start from Inbox and Customer 360',
          'Create orders from real data without re-typing across pages',
          'Follow up in Orders, Payment, and Shipping',
        ],
        href: '/admin/inbox',
        cta: 'Open Inbox',
      },
      {
        key: 'robot',
        title: 'Getting started with the AI assistant',
        points: [
          'AI only answers from data it can verify',
          'Risky actions like refund or cancel still need a human to confirm',
          "If information is missing, the system should ask, not guess",
        ],
        href: '/admin/assistant',
        cta: 'View the AI assistant',
      },
    ],
    flowTitle: 'The real workflow of the system',
    flowIntro:
      'This is the core of the new system: AI is not just a chat responder — it is the link from a conversation to a verifiable business workflow.',
    flowCards: [
      {
        key: 'message',
        title: '1. The customer reaches out',
        text: 'Start at Inbox to read the conversation, check Customer 360, and see what this customer has ordered before.',
      },
      {
        key: 'robot',
        title: '2. AI helps interpret and search',
        text: 'AI only uses approved tools to search products, check stock, suggest alternatives, or open a restock queue.',
      },
      {
        key: 'cart',
        title: '3. Create the order and checkout',
        text: 'Once the information is complete, the system creates a real order and sends a checkout link tied directly to it.',
      },
      {
        key: 'check',
        title: '4. Receive payment and verify the slip',
        text: 'Customers can send proof of payment, but confirmation always still requires a human to review and click Confirm.',
      },
      {
        key: 'truck',
        title: '5. Ship and close out',
        text: 'After payment, the team follows up in Shipping until it is complete, and reviews the overview in Dashboard or Reports.',
      },
    ],
    restockTitle: 'How the restock queue brings a sale back',
    restockAlertMessage: 'The restock queue turns "out of stock" into the next sales opportunity',
    restockAlertDesc:
      'Good for shops where some items run out often, but the customer still has real buying intent. Ending the conversation too quickly loses both the sale and the demand data worth keeping.',
    restockBenefits: [
      {
        title: "Don't lose the conversation just because stock ran out",
        detail:
          'Instead of ending with just "out of stock," the system can invite the customer to opt in for a restock alert, so the sales opportunity does not disappear along with that message.',
      },
      {
        title: 'Turn demand you cannot fulfill yet into a follow-up queue',
        detail:
          'The shop can see who is waiting for what, and use that as a signal for restocking, prioritizing sales work, or measuring which out-of-stock item is costing the most revenue.',
      },
      {
        title: 'Help the sales team close the sale systematically',
        detail:
          'When stock arrives, the team can open the queue, review the messages, and reach out only to customers who already opted in — instead of manually digging through old chats.',
      },
    ],
    restockExamplesLabel: 'A few concrete examples',
    restockExamples: [
      {
        situation: 'Fashion shop: black dress, size M is out of stock',
        outcome:
          'AI should offer a similar size or style first. If the customer still wants the original, the system invites them to opt in for a restock alert — once stock returns, sales can follow up immediately.',
      },
      {
        situation: 'Grocery store: a bestselling promo item is temporarily out',
        outcome:
          'Instead of losing the customer, the shop can capture who is waiting, then use that list to gauge how much to restock next round and reach out when the new batch arrives.',
      },
      {
        situation: 'Beauty shop: one core item in a routine is missing',
        outcome:
          'AI can still suggest what is available, but if the customer really wants that exact item, the system should keep a restock queue to close the sale once the full set is back in stock.',
      },
    ],
    archetypesTitle: 'Conversations by shop archetype',
    archetypesIntro:
      "This section shows that BMS doesn't reply with one script for every business — it adjusts its tone to the shop's context while still relying on real product and stock data from the backend.",
    customerLabel: 'Customer asks',
    assistantLabel: 'AI should reply along these lines',
    whyLabel: 'What this example illustrates',
    archetypeConversations: [
      {
        title: 'Mini Mart / Grocery',
        customer: 'Do you have Tom Yum instant noodles, 6-pack? I want 3 packs, and 2 bottles of 1.25L Coke.',
        assistant:
          "Sure! Let me check what's actually available first. If everything is in stock, I'll summarize the order and total right away. If anything is out, the system should suggest a similar item or offer to notify you when it's back.",
        why: 'Shows that AI understands fast, multi-item orders and is ready to move straight into creating a real order.',
      },
      {
        title: 'Fashion & Apparel',
        customer: 'Does this dress come in size M? If not, can you suggest something similar?',
        assistant:
          "Sure, let me check size M for this style first. If it's out, I'll suggest a similar style that's still in stock, and if you'd rather wait for the original, I can set up a restock alert for you.",
        why: 'Shows that AI does more than say yes/no — it understands sizing, alternatives, and capturing the sale for later.',
      },
      {
        title: 'Beauty & Personal Care',
        customer: 'I have sensitive, acne-prone skin. Do you have a gentle cleanser + moisturizer set?',
        assistant:
          "Sure, let me pick products suited for sensitive skin from what the shop actually carries, then put together a short routine for you — and check whether the full set is in stock or if something needs a restock alert.",
        why: 'Shows that AI can respond in a consultative way while still grounding itself in the shop\'s real product catalog.',
      },
      {
        title: 'Gadgets & Accessories',
        customer: 'Do you have a case for iPhone 15 Pro? And can you recommend a compatible screen protector and charging cable?',
        assistant:
          "Sure, let me check the case for your exact model first, then recommend accessories that are actually compatible. If the model you want is out of stock, the system should offer alternatives or set up a restock alert for you.",
        why: 'Shows that AI understands compatibility and can cross-sell related products.',
      },
    ],
    surfacesTitle: 'The main pages you will use',
    surfaceCards: [
      {
        title: 'Inbox + Customer 360',
        subtitle: 'The hub for talking with customers',
        bullets: [
          'See new chats, returning customers, and purchase history without switching between pages',
          'Share products, coupons, or create an order directly from the conversation',
          'The natural home page for a team that replies to customers every day',
        ],
        href: '/admin/inbox',
      },
      {
        title: 'Orders / Payment / Shipping',
        subtitle: 'Three pages that work together as one flow',
        bullets: [
          'Orders — track sale status and net totals',
          'Payment — verify slips and confirm payments',
          'Shipping — record the carrier and tracking number until delivered',
        ],
        href: '/admin/orders',
      },
      {
        title: 'Products / Purchase',
        subtitle: 'Manage what you sell and what you need to restock',
        bullets: [
          'Add products with multiple images, prices, and stock per size',
          'Use Purchase to receive stock without splitting the logic into a separate path',
          'When something is out, AI should suggest an alternative or offer a restock alert',
        ],
        href: '/admin/products',
      },
      {
        title: 'Admin Manual',
        subtitle: 'The in-system operational manual',
        bullets: [
          'Good for onboarding new staff',
          'Explains real work flows rather than technical descriptions',
          'The main reference when the team wants to know what a menu item does',
        ],
        href: '/admin/manual',
      },
    ],
    openPageCta: 'Open this page',
    guardrailsTitle: 'AI ground rules the help page must make clear',
    guardrailsAlertMessage: 'AI is an orchestration helper, not the source of business truth',
    guardrailsAlertDesc:
      'Stock, prices, orders, payments, and permissions must always come from a verifiable backend — never from something AI guessed at.',
    aiCanTitle: 'What AI can do',
    aiCanTags: ['Search products', 'Check stock', 'Summarize information', 'Suggest alternatives', 'Prepare a proposal'],
    aiCannotTitle: 'What still needs a human to confirm',
    aiCannotTags: ['Confirm payment', 'Refund', 'Cancel order', 'Adjust stock', 'Merge customer'],
    faqSectionTitle: 'Questions you are likely to run into on the new system',
    faqItems: [
      {
        key: 'faq-1',
        label: 'How is this page different from the manual at /admin/manual?',
        body: faqBody(
          <>
            The <Text code>/help</Text> page is a mockup of the system-wide help center, while{' '}
            <Text code>/admin/manual</Text> is an operational manual for admin staff that goes into more
            detail per workflow.
          </>
        ),
      },
      {
        key: 'faq-2',
        label: 'What can AI actually do, and what still needs a human to click?',
        body: faqBody(
          'AI can help search for information, summarize, recommend products, or prepare a request for an important action. But refunds, confirming a slip, cancelling an order, adjusting stock, or merging customers still need a person with the right permission to confirm it themselves.'
        ),
      },
      {
        key: 'faq-3',
        label: 'How should the system respond when something is out of stock?',
        body: faqBody(
          "The new system shouldn't just end with \"out of stock\" — it should offer an available size or alternative product, or invite the customer to opt in for a restock alert, following the flow the system actually supports."
        ),
      },
      {
        key: 'faq-4',
        label: 'How does the public checkout link work?',
        body: faqBody(
          'The checkout link is generated from a real, saved order. Customers use it to fill in any missing delivery details and attach a payment slip — but the checkout page never confirms payment automatically.'
        ),
      },
    ],
    noteTitle: 'A note about this mockup',
    noteBody1:
      'This page is still a static mockup to refine the messaging and information architecture first — it is not yet wired to search, analytics, or dynamic help content.',
    noteBody2:
      'If this direction looks good, the next round will build out a production version — search, role-based quick links, and deep links into per-menu guides.',
    sidebarTocTitle: 'Contents',
    sidebarShortcutsTitle: 'Related shortcuts',
    sidebarStatusTitle: 'Current status',
    sidebarStatusTag: 'The help page has been reworked into this new mockup',
    sidebarStatusDesc: 'Use this to review the direction before expanding into a full help center.',
  },
  th: {
    badge: 'Mockup /help สำหรับระบบใหม่',
    heroTitle: 'BMS Help Center',
    heroLead:
      'หน้านี้ถูกปรับใหม่ให้เข้ากับ BMS โดยสรุปว่า "ลูกค้าทักมาแล้วระบบพาไปถึงออเดอร์ การชำระเงิน และการจัดส่งอย่างไร" แทน help page แบบ generic เดิม',
    heroAlertDesc: 'ใช้เป็นหน้าเริ่มต้นสำหรับคนที่อยากเข้าใจภาพรวมระบบก่อนลงลึกในคู่มือฝั่งแอดมิน',
    ctaPrimary: 'ดู mockup นี้ต่อ',
    ctaSecondary: 'ไปที่คู่มือแอดมินจริง',
    anchors: {
      overview: 'ภาพรวมระบบ',
      quickPaths: 'เริ่มจากตรงไหนดี',
      flow: 'Flow งานจริง',
      restock: 'Restock queue',
      archetypes: 'บทสนทนาตาม archetype',
      surfaces: 'หน้าหลักในระบบ',
      guardrails: 'กติกา AI',
      faq: 'FAQ',
    },
    quickPathsTitle: 'เริ่มจากตรงไหนดี',
    quickPaths: [
      {
        key: 'shop',
        title: 'เริ่มใช้สำหรับเจ้าของร้าน',
        points: [
          'เพิ่มสินค้า ราคา รูป และ stock ให้พร้อมขาย',
          'ตั้งค่าช่องทางรับเงินและข้อมูลร้านให้ครบ',
          'ลอง flow จริงผ่าน Inbox และ Checkout',
        ],
        href: '/admin/manual',
        cta: 'ดูคู่มือฝั่งแอดมิน',
      },
      {
        key: 'message',
        title: 'เริ่มใช้สำหรับทีมขาย/แอดมิน',
        points: [
          'เริ่มจาก Inbox และ Customer 360',
          'สร้างออเดอร์จากข้อมูลจริง ไม่คีย์ซ้ำหลายหน้า',
          'ตามงานต่อใน Orders, Payment และ Shipping',
        ],
        href: '/admin/inbox',
        cta: 'เปิด Inbox',
      },
      {
        key: 'robot',
        title: 'เริ่มใช้ผู้ช่วย AI',
        points: [
          'AI ช่วยตอบจากข้อมูลที่ตรวจสอบได้เท่านั้น',
          'งานเสี่ยง เช่น refund หรือ cancel ยังต้องให้คนกดยืนยัน',
          'ถ้าข้อมูลไม่พอ ระบบควรถามต่อ ไม่เดาเอง',
        ],
        href: '/admin/assistant',
        cta: 'ดูผู้ช่วย AI',
      },
    ],
    flowTitle: 'Flow งานจริงของระบบ',
    flowIntro: 'นี่คือแกนของระบบใหม่: AI ไม่ใช่แค่ตอบแชท แต่เป็นตัวเชื่อมจากบทสนทนาไปสู่ workflow ธุรกิจที่ตรวจสอบได้',
    flowCards: [
      {
        key: 'message',
        title: '1. ลูกค้าทักเข้ามา',
        text: 'เริ่มที่ Inbox เพื่ออ่านบทสนทนา ดู Customer 360 และดูว่าลูกค้าคนนี้เคยสั่งอะไรไว้แล้วบ้าง',
      },
      {
        key: 'robot',
        title: '2. AI ช่วยตีความและค้นของ',
        text: 'AI ใช้เฉพาะเครื่องมือที่อนุมัติไว้เพื่อค้นสินค้า เช็กสต็อก แนะนำทางเลือก หรือเปิดคิวแจ้งเมื่อของเข้า',
      },
      {
        key: 'cart',
        title: '3. สร้างออเดอร์และ Checkout',
        text: 'เมื่อข้อมูลครบ ระบบสร้างออเดอร์จริงและส่งลิงก์ Checkout ที่ผูกกับออเดอร์นั้นโดยตรง',
      },
      {
        key: 'check',
        title: '4. รับชำระและตรวจสลิป',
        text: 'ลูกค้าส่งหลักฐานชำระเงินได้ แต่การยืนยันยังต้องมีคนตรวจและกด Confirm เองเสมอ',
      },
      {
        key: 'truck',
        title: '5. จัดส่งและปิดงาน',
        text: 'หลังชำระแล้ว ทีมงานตามต่อใน Shipping จนงานครบ และดูภาพรวมที่ Dashboard หรือ Reports',
      },
    ],
    restockTitle: 'Restock queue ปิดการขายกลับมาได้อย่างไร',
    restockAlertMessage: 'Restock queue คือการเปลี่ยนคำว่า "ของหมด" ให้กลายเป็นโอกาสขายรอบถัดไป',
    restockAlertDesc:
      'เหมาะกับร้านที่ของบางรายการหมดบ่อย แต่ลูกค้ายังมี intent ซื้ออยู่ ถ้าจบแชทเร็วเกินไป ร้านจะเสียทั้งยอดขายและข้อมูล demand ที่ควรเก็บไว้',
    restockBenefits: [
      {
        title: 'ไม่เสียบทสนทนาเพราะของหมด',
        detail:
          'แทนที่จะตอบจบแค่ว่า "สินค้าหมด" ระบบสามารถชวนลูกค้า opt-in เพื่อรอแจ้งเมื่อของเข้า ทำให้โอกาสขายไม่หายไปพร้อมกับข้อความนั้น',
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
    ],
    restockExamplesLabel: 'ตัวอย่างที่เห็นภาพ',
    restockExamples: [
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
    ],
    archetypesTitle: 'บทสนทนาตาม archetype ของร้าน',
    archetypesIntro:
      'ส่วนนี้ใช้สื่อว่า BMS ไม่ได้ตอบแบบสคริปต์เดียวทุกธุรกิจ แต่ปรับน้ำหนักการตอบตามบริบทร้าน โดยยังต้องยึดข้อมูลสินค้าและสต็อกจริงจาก backend เหมือนเดิม',
    customerLabel: 'ลูกค้าถาม',
    assistantLabel: 'AI ควรตอบในแนวนี้',
    whyLabel: 'สิ่งที่ตัวอย่างนี้สื่อ',
    archetypeConversations: [
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
    ],
    surfacesTitle: 'หน้าหลักที่ผู้ใช้จะเจอ',
    surfaceCards: [
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
    ],
    openPageCta: 'เปิดหน้านี้',
    guardrailsTitle: 'กติกา AI ที่หน้า help ต้องสื่อให้ชัด',
    guardrailsAlertMessage: 'AI เป็นตัวช่วย orchestration ไม่ใช่แหล่งความจริงของธุรกิจ',
    guardrailsAlertDesc:
      'ข้อมูลสต็อก ราคา ออเดอร์ การจ่ายเงิน และสิทธิ์ต่าง ๆ ต้องมาจาก backend ที่ตรวจสอบได้ ไม่ใช่จากข้อความที่ AI เดาเอง',
    aiCanTitle: 'สิ่งที่ AI ทำได้',
    aiCanTags: ['ค้นสินค้า', 'เช็กสต็อก', 'สรุปข้อมูล', 'แนะนำทางเลือก', 'เตรียม proposal'],
    aiCannotTitle: 'สิ่งที่ยังต้องให้คนยืนยัน',
    aiCannotTags: ['Confirm payment', 'Refund', 'Cancel order', 'Adjust stock', 'Merge customer'],
    faqSectionTitle: 'คำถามที่น่าจะเจอบ่อยในระบบใหม่',
    faqItems: [
      {
        key: 'faq-1',
        label: 'หน้านี้ต่างจากคู่มือใน /admin/manual ยังไง',
        body: faqBody(
          <>
            หน้า <Text code>/help</Text> เป็น mockup ของศูนย์ช่วยเหลือภาพรวมระบบ ส่วนหน้า{' '}
            <Text code>/admin/manual</Text> เป็นคู่มือปฏิบัติงานฝั่งแอดมินที่ลงรายละเอียดราย flow มากกว่า
          </>
        ),
      },
      {
        key: 'faq-2',
        label: 'AI ทำอะไรได้จริง และอะไรยังต้องให้คนกดเอง',
        body: faqBody(
          'AI ช่วยค้นข้อมูล สรุป แนะนำสินค้า หรือเตรียมคำขอสำหรับงานสำคัญได้ แต่การคืนเงิน ยืนยันสลิป ยกเลิกออเดอร์ ปรับสต็อก หรือ merge ลูกค้า ยังต้องให้คนที่มีสิทธิ์กดยืนยันเอง'
        ),
      },
      {
        key: 'faq-3',
        label: 'ถ้าสินค้าหมด ระบบควรตอบอย่างไร',
        body: faqBody(
          'ระบบใหม่ไม่ควรจบแค่คำว่าไม่มีสินค้า แต่ควรเสนอไซซ์หรือสินค้าทางเลือกที่ยังมีอยู่ หรือชวนลูกค้า opt-in เพื่อแจ้งเมื่อของเข้าตาม flow ที่ระบบรองรับจริง'
        ),
      },
      {
        key: 'faq-4',
        label: 'Checkout public link ใช้อย่างไร',
        body: faqBody(
          'ลิงก์ Checkout ถูกสร้างจากออเดอร์จริงที่บันทึกแล้ว ลูกค้าใช้ลิงก์นี้เพื่อเช็กข้อมูลจัดส่งที่ขาดและแนบสลิปได้ แต่หน้า Checkout ไม่ได้ยืนยันการชำระเงินให้อัตโนมัติ'
        ),
      },
    ],
    noteTitle: 'หมายเหตุของ mockup นี้',
    noteBody1: 'หน้านี้ยังเป็น static mockup เพื่อปรับ message และ information architecture ก่อน ยังไม่ได้ต่อ search, analytics หรือ dynamic help content',
    noteBody2: 'ถ้าทิศทางนี้โอเค รอบถัดไปเราค่อยแตกต่อเป็น version ใช้งานจริง เช่น search, role-based quick links, และ deep-link ไปยังคู่มือรายเมนู',
    sidebarTocTitle: 'สารบัญ',
    sidebarShortcutsTitle: 'ทางลัดที่เกี่ยวข้อง',
    sidebarStatusTitle: 'สถานะตอนนี้',
    sidebarStatusTag: 'Help page ถูกปรับเป็น mockup ใหม่แล้ว',
    sidebarStatusDesc: 'ใช้สำหรับรีวิว direction ก่อนขยายเป็น help center เต็มรูปแบบ',
  },
};

export default function HelpPage() {
  const { lang } = useI18n();
  const c = resolveBilingual(HELP, lang);

  const faqCollapseItems = useMemo(
    () => c.faqItems.map((item) => ({ key: item.key, label: item.label, children: item.body })),
    [c.faqItems]
  );

  const anchorItems = useMemo(
    () => [
      { key: 'overview', href: '#overview', title: c.anchors.overview },
      { key: 'quick-paths', href: '#quick-paths', title: c.anchors.quickPaths },
      { key: 'flow', href: '#flow', title: c.anchors.flow },
      { key: 'restock', href: '#restock', title: c.anchors.restock },
      { key: 'archetypes', href: '#archetypes', title: c.anchors.archetypes },
      { key: 'surfaces', href: '#surfaces', title: c.anchors.surfaces },
      { key: 'guardrails', href: '#guardrails', title: c.anchors.guardrails },
      { key: 'faq', href: '#faq', title: c.anchors.faq },
    ],
    [c.anchors]
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
                    {c.badge}
                  </Tag>
                  <Title level={1} style={{ margin: 0, color: '#fff' }}>
                    {c.heroTitle}
                  </Title>
                  <Paragraph style={{ margin: 0, color: 'rgba(255,255,255,0.88)', fontSize: 17 }}>
                    {c.heroLead}
                  </Paragraph>
                  <Alert closable
                    type="info"
                    showIcon
                    message="Customer → AI → CRM → Order → Inventory → Payment → Shipping → Dashboard"
                    description={c.heroAlertDesc}
                    style={{ borderRadius: 16 }}
                  />
                  <Space wrap>
                    <Button type="primary" size="large" href="#quick-paths">
                      {c.ctaPrimary}
                    </Button>
                    <Button size="large" href="/admin/manual">
                      {c.ctaSecondary}
                    </Button>
                  </Space>
                </Space>
              </Card>
            </section>

            <section id="quick-paths" style={{ scrollMarginTop: 88 }}>
              <Card title={c.quickPathsTitle} style={{ borderRadius: 22 }}>
                <Row gutter={[16, 16]}>
                  {c.quickPaths.map((item) => (
                    <Col xs={24} md={12} xl={8} key={item.title}>
                      <Card style={{ height: '100%', borderRadius: 18 }}>
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          <Space>
                            {ICONS[item.key]}
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
              <Card title={c.flowTitle} style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Paragraph type="secondary" style={{ margin: 0 }}>
                    {c.flowIntro}
                  </Paragraph>
                  <Row gutter={[16, 16]}>
                    {c.flowCards.map((item) => (
                      <Col xs={24} md={12} xl={8} key={item.title}>
                        <Card style={{ height: '100%', borderRadius: 18 }}>
                          <Space direction="vertical" size={10}>
                            <Space>
                              {ICONS[item.key]}
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
              <Card title={c.restockTitle} style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Alert closable
                    type="success"
                    showIcon
                    message={c.restockAlertMessage}
                    description={c.restockAlertDesc}
                    style={{ borderRadius: 16 }}
                  />
                  <Row gutter={[16, 16]}>
                    {c.restockBenefits.map((item) => (
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
                      {c.restockExamplesLabel}
                    </Text>
                    <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                      {c.restockExamples.map((item) => (
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
              <Card title={c.archetypesTitle} style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Paragraph type="secondary" style={{ margin: 0 }}>
                    {c.archetypesIntro}
                  </Paragraph>
                  <Row gutter={[16, 16]}>
                    {c.archetypeConversations.map((item) => (
                      <Col xs={24} md={12} key={item.title}>
                        <Card style={{ height: '100%', borderRadius: 18 }}>
                          <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            <Tag color="blue">{item.title}</Tag>
                            <div>
                              <Text strong>{c.customerLabel}</Text>
                              <Paragraph style={{ margin: '4px 0 0' }}>{item.customer}</Paragraph>
                            </div>
                            <div>
                              <Text strong>{c.assistantLabel}</Text>
                              <Paragraph style={{ margin: '4px 0 0' }}>{item.assistant}</Paragraph>
                            </div>
                            <Alert closable
                              type="info"
                              showIcon
                              message={c.whyLabel}
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
              <Card title={c.surfacesTitle} style={{ borderRadius: 22 }}>
                <Row gutter={[16, 16]}>
                  {c.surfaceCards.map((item) => (
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
                              {c.openPageCta}
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
              <Card title={c.guardrailsTitle} style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Alert closable
                    type="warning"
                    showIcon
                    icon={<SafetyOutlined />}
                    message={c.guardrailsAlertMessage}
                    description={c.guardrailsAlertDesc}
                    style={{ borderRadius: 16 }}
                  />
                  <Row gutter={[12, 12]}>
                    <Col xs={24} md={12}>
                      <Card size="small" style={{ borderRadius: 16 }}>
                        <Space direction="vertical" size={8}>
                          <Text strong>{c.aiCanTitle}</Text>
                          {c.aiCanTags.map((tag) => (
                            <Tag color="blue" key={tag}>
                              {tag}
                            </Tag>
                          ))}
                        </Space>
                      </Card>
                    </Col>
                    <Col xs={24} md={12}>
                      <Card size="small" style={{ borderRadius: 16 }}>
                        <Space direction="vertical" size={8}>
                          <Text strong>{c.aiCannotTitle}</Text>
                          {c.aiCannotTags.map((tag) => (
                            <Tag color="red" key={tag}>
                              {tag}
                            </Tag>
                          ))}
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
                    <span>{c.faqSectionTitle}</span>
                  </Space>
                }
                style={{ borderRadius: 22 }}
              >
                <Collapse items={faqCollapseItems} bordered={false} />
              </Card>
            </section>

            <Card style={{ borderRadius: 22 }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space>
                  <CompassOutlined />
                  <Text strong>{c.noteTitle}</Text>
                </Space>
                <Paragraph style={{ margin: 0 }}>{c.noteBody1}</Paragraph>
                <Divider style={{ margin: '8px 0' }} />
                <Paragraph type="secondary" style={{ margin: 0 }}>
                  {c.noteBody2}
                </Paragraph>
              </Space>
            </Card>
          </Space>
        </Col>

        <Col xs={24} lg={7}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title={c.sidebarTocTitle} style={{ borderRadius: 20 }}>
              <Anchor items={anchorItems} affix={false} />
            </Card>

            <Card title={c.sidebarShortcutsTitle} style={{ borderRadius: 20 }}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Link href="/admin/manual">/admin/manual</Link>
                <Link href="/admin/inbox">/admin/inbox</Link>
                <Link href="/admin/orders">/admin/orders</Link>
                <Link href="/admin/assistant">/admin/assistant</Link>
              </Space>
            </Card>

            <Card title={c.sidebarStatusTitle} style={{ borderRadius: 20 }}>
              <Space direction="vertical" size={10}>
                <Tag color="processing" icon={<BookOutlined />}>
                  {c.sidebarStatusTag}
                </Tag>
                <Paragraph type="secondary" style={{ margin: 0 }}>
                  {c.sidebarStatusDesc}
                </Paragraph>
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>
    </div>
  );
}
