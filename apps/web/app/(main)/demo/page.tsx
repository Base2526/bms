'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Input,
  message,
  Radio,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  DownOutlined,
  MessageOutlined,
  RobotOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  StarOutlined,
} from '@ant-design/icons';

const { Paragraph, Text } = Typography;

type ArchetypeKey = 'fashion' | 'food' | 'beauty' | 'grocery' | 'gadgets';

type DemoMessage = {
  role: 'customer' | 'assistant';
  text: string;
};

type DemoOrderState = {
  stage: 'browsing' | 'cart_ready' | 'checkout_info' | 'order_created' | 'restock';
  items: Array<{ name: string; qty: number; price: number }>;
  shippingMethod: string | null;
  paymentStatus: string | null;
  orderId: string | null;
  nextStep: string;
};

type DemoShopInfo = {
  key: ArchetypeKey;
  label: string;
  tenantSlug: string;
  name: string;
  ready: boolean;
  productCount?: number;
};

type DemoSessionMap = Partial<Record<ArchetypeKey, string>>;

const DEMO_TENANT_META: Record<ArchetypeKey, { tenantSlug: string; fallbackShopName: string }> = {
  fashion: { tenantSlug: 'demo-fashion', fallbackShopName: 'Nami Fashion Demo' },
  food: { tenantSlug: 'demo-food', fallbackShopName: 'QuickBite Delivery Demo' },
  beauty: { tenantSlug: 'demo-beauty', fallbackShopName: 'Lumi Beauty Demo' },
  grocery: { tenantSlug: 'demo-minimart', fallbackShopName: 'Daily Mart Demo' },
  gadgets: { tenantSlug: 'demo-gadget', fallbackShopName: 'Spark Gadget Demo' },
};

type DemoConfig = {
  label: string;
  angle: string;
  description: string;
  starters: string[];
  intro: string;
  sampleReplies: Record<string, string>;
  businessFlow: string[];
  signals: string[];
  actions: string[];
  closing: string;
};

const DEMOS: Record<ArchetypeKey, DemoConfig> = {
  fashion: {
    label: 'ร้านเสื้อผ้า',
    angle: 'ไซซ์ สี และสินค้าทดแทน',
    description:
      'ร้านแฟชั่นต้องตอบเรื่องไซซ์ สี และตัวเลือกที่ใกล้เคียงกันได้ดี ถ้าของหมดไม่ควรปล่อยบทสนทนาจบง่าย ๆ',
    starters: ['เดรสสีดำมีไซซ์ M ไหม', 'ถ้าไม่มีช่วยแนะนำทรงใกล้เคียงให้หน่อย', 'มีโปรถ้าซื้อ 2 ตัวไหม'],
    intro:
      'สวัสดีค่ะ สนใจดูเดรสหรือถามเรื่องไซซ์ สี และทรงที่ใกล้เคียงกันได้เลยนะคะ',
    sampleReplies: {
      'เดรสสีดำมีไซซ์ m ไหม':
        'ได้ค่ะ เดี๋ยวเช็กไซซ์ M ของรุ่นนี้ก่อน ถ้าหมดจะเสนอรุ่นทรงใกล้เคียงที่ยังมีสต็อก และถ้าคุณลูกค้าอยากรอรุ่นเดิม เราเปิดแจ้งเมื่อของเข้าไว้ให้ได้ค่ะ',
      'ถ้าไม่มีช่วยแนะนำทรงใกล้เคียงให้หน่อย':
        'ได้เลยค่ะ สำหรับร้านเสื้อผ้า เราไม่ควรตอบแค่ว่าไม่มี แต่ควรเสนอรุ่นที่ทรงใกล้ สีใกล้ หรือไซซ์ที่ยังมี เพื่อรักษา intent ซื้อไว้ก่อน',
      'มีโปรถ้าซื้อ 2 ตัวไหม':
        'ถ้าร้านมีคูปองหรือโปรที่ใช้ได้จริง ระบบควรเช็กสิทธิ์จาก backend ก่อนตอบเสมอ แล้วค่อยสรุปว่าใช้กับ 2 ตัวนี้ได้หรือไม่ค่ะ',
      default:
        'สำหรับร้านแฟชั่น BMS ควรตอบโดยดู variant ที่ลูกค้าถามก่อน เช่น สี ไซซ์ และทรง ถ้าของหมดค่อยพาไปสู่สินค้าทดแทนหรือ restock flow แทนค่ะ',
    },
    businessFlow: ['Customer chat', 'Identify requested variant', 'Check stock', 'Suggest alternatives or capture restock', 'Return to sale'],
    signals: ['ถามเรื่องไซซ์ชัดเจน', 'มี intent ซื้ออยู่', 'ยอมรับ flow แจ้งเมื่อของเข้า'],
    actions: ['search_products', 'find_alternatives', 'subscribe_restock_notification'],
    closing: 'BMS สื่อให้เห็นว่า AI เข้าใจเรื่อง variant และช่วยกู้ยอดกลับมาจากของหมดได้',
  },
  food: {
    label: 'ร้านอาหาร / delivery',
    angle: 'ตอบไว เมนูพร้อมขาย และ add-on',
    description:
      'กลุ่มนี้ต้องตอบเร็ว เห็นภาพเมนูที่ขายอยู่ และช่วยพาไปสู่การสั่งซื้อโดยไม่พูดเกิน capability ของระบบ',
    starters: ['วันนี้มีข้าวกะเพราไหม', 'เพิ่มไข่ดาวได้ไหม', 'ส่งถึงคอนโดใช้เวลาประมาณเท่าไร'],
    intro:
      'สวัสดีค่ะ ถามเรื่องเมนู ตัวเลือกเพิ่ม หรือการจัดส่งได้เลยนะคะ',
    sampleReplies: {
      'วันนี้มีข้าวกะเพราไหม':
        'ได้ค่ะ เดี๋ยวเช็กเมนูที่เปิดขายอยู่ก่อน ถ้ามีพร้อมขายจะสรุปรายการให้ทันที และถ้ามีตัวเลือกเสริมที่ร้านตั้งไว้ เราจะแนะนำเพิ่มให้ในข้อความเดียวเลยค่ะ',
      'เพิ่มไข่ดาวได้ไหม':
        'ถ้าร้านตั้ง option เสริมไว้จริง ระบบควรตอบได้ทันทีว่าเพิ่มไข่ดาวได้และมีผลกับราคาอย่างไร โดยไม่ให้ลูกค้าถามซ้ำหลายรอบค่ะ',
      'ส่งถึงคอนโดใช้เวลาประมาณเท่าไร':
        'เดโมนี้จะสื่อว่าร้านอาหารควรตอบสั้นและชัด เช่น เช็กพื้นที่จัดส่งและเวลาประมาณก่อนพาไปสู่การยืนยันออเดอร์ค่ะ',
      default:
        'สำหรับ food delivery BMS ควรช่วยให้คำตอบเร็ว เห็น availability ชัด และพาลูกค้าไปสู่การสั่งจริงโดยไม่หลุดเป็นบทสนทนายาวเกินจำเป็นค่ะ',
    },
    businessFlow: ['Customer chat', 'Discover active menu', 'Check availability', 'Create order path or suggest substitute', 'Payment and delivery'],
    signals: ['ลูกค้าคาดหวังความเร็ว', 'มี add-on intent', 'ควรปิดบทสนทนาให้สั้นและชัด'],
    actions: ['browse_catalog', 'search_products', 'create_order'],
    closing: 'BMS จะทำให้ร้านอาหารดูเป็นระบบสั่งซื้อผ่านแชต ไม่ใช่บอตตอบคำถามเฉย ๆ',
  },
  beauty: {
    label: 'ร้าน beauty',
    angle: 'consultative selling และ routine',
    description:
      'ร้าน beauty ต้องตอบแบบแนะนำเป็นชุด เข้าใจ pain point ของลูกค้า และยังยึดสินค้าที่ร้านมีจริง',
    starters: ['ผิวแพ้ง่ายควรเริ่มตัวไหน', 'มีเซ็ตล้างหน้า-บำรุงไหม', 'ถ้าตัวหลักหมดมีตัวแทนไหม'],
    intro:
      'สวัสดีค่ะ ถามเรื่องสภาพผิว routine หรือสินค้าที่ใช้คู่กันได้เลยนะคะ',
    sampleReplies: {
      'ผิวแพ้ง่ายควรเริ่มตัวไหน':
        'ได้ค่ะ เดี๋ยวคัดสินค้าที่ตรงกับผิวแพ้ง่ายจากรายการที่ร้านมีจริงก่อน แล้วช่วยจัดเป็น routine สั้น ๆ ให้ พร้อมเช็กว่าสินค้าครบชุดหรือมีตัวไหนควรเปิดแจ้งเมื่อของเข้าไว้',
      'มีเซ็ตล้างหน้า-บำรุงไหม':
        'สำหรับ beauty BMS ควรตอบเป็นชุดที่เข้าใจง่าย เช่น ล้างหน้า + บำรุง 1 ตัวหลัก และถ้าร้านมี bundle อยู่จริงค่อยสรุปเป็นตัวเลือกให้ลูกค้าเห็นค่ะ',
      'ถ้าตัวหลักหมดมีตัวแทนไหม':
        'ได้ค่ะ ถ้าตัวหลักหมด ระบบควรหาทางเลือกที่ใกล้เคียงกันก่อน และถ้าลูกค้าอยากรอของเดิมจริงค่อยเสนอ restock flow ค่ะ',
      default:
        'ร้าน beauty ควรตอบโดยแยก observation กับ recommendation ให้ชัด และยังต้องอิงสินค้าที่ร้านมีจริง ไม่ควรให้คำแนะนำลอย ๆ ค่ะ',
    },
    businessFlow: ['Customer chat', 'Interpret skin concern', 'Recommend verified products', 'Check full set availability', 'Order or restock capture'],
    signals: ['ต้องการคำแนะนำมากกว่าค้นชื่อสินค้า', 'มีโอกาส cross-sell เป็นชุด', 'ต้องตอบด้วยน้ำเสียง consultative'],
    actions: ['recommend_products', 'search_products', 'find_alternatives'],
    closing: 'BMS ช่วยให้ AI ดูฉลาดในเชิงขายแบบที่ปรึกษา แต่ยัง grounded กับ stock จริง',
  },
  grocery: {
    label: 'ร้านของชำ / minimart',
    angle: 'สั่งเร็ว หลายชิ้น และของหมดบ่อย',
    description:
      'ร้านของชำเหมาะกับการโชว์ว่า AI รับรายการหลายชิ้น เช็กของไว และใช้ restock queue เป็นเครื่องมือรักษายอด',
    starters: ['มีมาม่าต้มยำไหม', 'เอาโค้ก 2 ขวดด้วย', 'ถ้าของโปรหมดช่วยแจ้งด้วย'],
    intro:
      'สวัสดีค่ะ ส่งรายการที่อยากได้มาได้เลยนะคะ ถ้ามีหลายอย่างพิมพ์มาพร้อมกันได้ค่ะ',
    sampleReplies: {
      'มีมาม่าต้มยำไหม':
        'ได้ค่ะ เดี๋ยวเช็กสินค้าที่พร้อมขายจริงให้ก่อน ถ้าครบจะสรุปรายการและยอดให้ทันที ถ้าตัวไหนหมดเราควรเสนอของใกล้เคียงหรือชวนแจ้งเมื่อของเข้าแทนค่ะ',
      'เอาโค้ก 2 ขวดด้วย':
        'ร้านของชำควรรับหลายรายการในบทสนทนาเดียว แล้วค่อยสรุปเป็นตะกร้าหรือออเดอร์ให้เลย เพื่อให้การซื้อเร็วและลื่นที่สุดค่ะ',
      'ถ้าของโปรหมดช่วยแจ้งด้วย':
        'ได้เลยค่ะ แบบนี้เหมาะกับการเปิด restock subscription ไว้ เพราะร้านจะไม่เสียบทสนทนาไปเปล่า ๆ และยังกลับมาปิดการขายได้เมื่อของเข้าค่ะ',
      default:
        'สำหรับ minimart BMS ควรตอบเร็ว รับหลายรายการได้ และใช้ restock queue เป็นเครื่องมือรักษายอดเมื่อของหมดค่ะ',
    },
    businessFlow: ['Customer chat', 'Parse multi-item basket', 'Check stock', 'Create order or restock capture', 'Follow-up when restocked'],
    signals: ['ตะกร้าหลายรายการ', 'มีโอกาสเสียยอดเพราะของหมด', 'เหมาะกับ conversion เร็ว'],
    actions: ['search_products', 'create_order', 'subscribe_restock_notification'],
    closing: 'BMS ทำให้เห็นว่า even simple retail chat ก็แปลงเป็น order flow หรือ recovery flow ได้',
  },
  gadgets: {
    label: 'ร้าน gadget',
    angle: 'compatibility และ cross-sell',
    description:
      'ร้าน gadget ควรโชว์ว่า AI เข้าใจรุ่นเครื่อง ความเข้ากันได้ และการแนะนำอุปกรณ์เสริมที่เกี่ยวข้อง',
    starters: ['เคส iPhone 15 Pro มีไหม', 'มีกระจกกับสายชาร์จที่เข้ากันไหม', 'ถ้าเคสหมดมีรุ่นอื่นแทนไหม'],
    intro:
      'สวัสดีค่ะ ถามเรื่องรุ่นเครื่อง ความเข้ากันได้ หรืออุปกรณ์เสริมได้เลยนะคะ',
    sampleReplies: {
      'เคส iphone 15 pro มีไหม':
        'ได้ค่ะ เดี๋ยวเช็กเคสที่ตรงรุ่นก่อน แล้วค่อยแนะนำอุปกรณ์เสริมที่เข้ากันได้จริง ถ้ารุ่นที่อยากได้หมด ระบบควรเสนอทางเลือกหรือเปิดคิวแจ้งเมื่อของเข้าไว้ให้ได้ค่ะ',
      'มีกระจกกับสายชาร์จที่เข้ากันไหม':
        'ได้ค่ะ จุดสำคัญของร้าน gadget คือ AI ต้องรู้ว่ากำลังช่วยเลือกของที่ใช้ร่วมกันได้จริง ไม่ใช่เสนอของกว้าง ๆ ที่เข้ากันไม่ได้ค่ะ',
      'ถ้าเคสหมดมีรุ่นอื่นแทนไหม':
        'ได้เลยค่ะ ถ้ารุ่นที่ตรงสุดหมด เราควรเรียงลำดับตัวเลือกแทนตามรุ่น สี และรูปทรงที่ใกล้เคียงก่อน เพื่อรักษาโอกาสขายไว้ค่ะ',
      default:
        'ร้าน gadget ควรตอบจาก compatibility ก่อน แล้วค่อยต่อด้วย cross-sell และ alternative path ตามสิ่งที่ลูกค้าถามค่ะ',
    },
    businessFlow: ['Customer chat', 'Identify compatibility', 'Filter viable products', 'Cross-sell accessories', 'Order or restock path'],
    signals: ['ต้องรู้รุ่นเครื่อง', 'มีโอกาส cross-sell สูง', 'ลูกค้าคาดหวังคำตอบแม่นเรื่อง compatibility'],
    actions: ['search_products', 'recommend_products', 'find_alternatives'],
    closing: 'BMS โชว์ความฉลาดเชิงบริบทร้านได้ดีมากในหมวดที่ต้องแมตช์รุ่นและอุปกรณ์',
  },
};

const FLOW_LABELS = [
  'Customer chat',
  'CRM/identity',
  'Product discovery',
  'Stock decision',
  'Order or Restock capture',
  'Payment',
  'Shipping',
  'Follow-up / Repeat sale',
];

function createIntroMessage(demo: DemoConfig): DemoMessage[] {
  return [{ role: 'assistant', text: demo.intro }];
}

function createInitialOrderState(): DemoOrderState {
  return {
    stage: 'browsing',
    items: [],
    shippingMethod: null,
    paymentStatus: null,
    orderId: null,
    nextStep: 'เริ่มจากถามสินค้า ไซซ์ เมนู หรือสิ่งที่ต้องการก่อน',
  };
}

function normalizeText(input: string) {
  return input.trim().toLowerCase();
}

function getAssistantReply(demo: DemoConfig, input: string) {
  const normalized = normalizeText(input);
  const matchedEntry = Object.entries(demo.sampleReplies).find(([pattern]) => pattern !== 'default' && normalized.includes(pattern));
  if (matchedEntry) return matchedEntry[1];
  return demo.sampleReplies.default;
}

function inferFlowStep(input: string) {
  const normalized = normalizeText(input);
  if (!normalized) return 0;
  if (normalized.includes('ส่ง') || normalized.includes('tracking') || normalized.includes('เลขพัสดุ')) return 6;
  if (normalized.includes('จ่าย') || normalized.includes('สลิป') || normalized.includes('payment')) return 5;
  if (normalized.includes('แจ้ง') || normalized.includes('ของเข้า') || normalized.includes('รอ') || normalized.includes('หมด')) return 4;
  if (normalized.includes('เอา') || normalized.includes('สั่ง') || normalized.includes('order')) return 4;
  if (normalized.includes('มีไหม') || normalized.includes('ไซซ์') || normalized.includes('แนะนำ') || normalized.includes('รุ่น')) return 3;
  return 2;
}

function priceForArchetype(archetype: ArchetypeKey) {
  switch (archetype) {
    case 'fashion':
      return 1290;
    case 'food':
      return 94;
    case 'beauty':
      return 890;
    case 'grocery':
      return 179;
    case 'gadgets':
      return 590;
    default:
      return 499;
  }
}

function primaryItemName(archetype: ArchetypeKey, conversation = '') {
  switch (archetype) {
    case 'fashion':
      return 'เดรสสีดำ รุ่นใกล้เคียง';
    case 'food':
      return conversation.includes('ไข่ต้ม') ? 'ข้าวกะเพราหมู + ไข่ต้ม' : 'ข้าวกะเพราหมู + ไข่ดาว';
    case 'beauty':
      return 'เซ็ตดูแลผิวเริ่มต้น';
    case 'grocery':
      return 'ชุดสินค้าตามรายการล่าสุด';
    case 'gadgets':
      return 'เคส + อุปกรณ์เสริมที่เข้ากัน';
    default:
      return 'สินค้าเดโม';
  }
}

function buildOrderState(
  archetype: ArchetypeKey,
  history: DemoMessage[],
  previous: DemoOrderState = createInitialOrderState(),
): DemoOrderState {
  const joined = history
    .filter((item) => item.role === 'customer')
    .map((item) => item.text.toLowerCase())
    .join(' ');
  const wantsRestock =
    joined.includes('ของเข้า') ||
    joined.includes('แจ้งเมื่อของเข้า') ||
    joined.includes('รอของ');

  if (wantsRestock) {
    return {
      stage: 'restock',
      items: [],
      shippingMethod: null,
      paymentStatus: null,
      orderId: null,
      nextStep: 'เก็บคำขอแจ้งเมื่อของเข้า และกลับมาปิดการขายเมื่อสินค้าพร้อมอีกครั้ง',
    };
  }

  const buyingIntent =
    (joined.includes('เอา') ||
      joined.includes('สั่ง') ||
      joined.includes('รับ') ||
      joined.includes('ซื้อ')) &&
    !joined.includes('มีโปรถ้าซื้อ');

  const asksShipping =
    joined.includes('จัดส่ง') ||
    joined.includes('ส่งที่') ||
    joined.includes('รับเอง');

  const latestCustomerText = history
    .filter((item) => item.role === 'customer')
    .at(-1)?.text.trim().toLowerCase() || '';
  const confirms = ['ยืนยัน', 'ตกลง', 'โอเค', 'confirm'].includes(latestCustomerText);

  const asksPayment =
    joined.includes('จ่าย') ||
    joined.includes('ชำระ') ||
    joined.includes('โอน');

  const items = buyingIntent
    ? [{ name: primaryItemName(archetype, joined), qty: 1, price: priceForArchetype(archetype) }]
    : previous.items;

  if (confirms && previous.stage === 'checkout_info' && items.length) {
    return {
      ...previous,
      stage: 'order_created',
      paymentStatus: 'รอชำระเงิน',
      orderId: 'DEMO-2048',
      nextStep: 'ลูกค้าเข้าสู่ checkout เพื่อกรอกข้อมูลที่จำเป็นและแนบหลักฐานชำระเงิน',
    };
  }

  if (confirms && previous.stage === 'cart_ready') return previous;

  if (asksPayment && items.length) {
    return {
      stage: 'order_created',
      items,
      shippingMethod: previous.shippingMethod || (asksShipping ? 'จัดส่ง' : 'รอเลือกวิธีรับสินค้า'),
      paymentStatus: 'รอชำระเงิน',
      orderId: 'DEMO-2048',
      nextStep: 'ในร้านจริง จุดนี้ลูกค้าจะได้รับ checkout link เพื่อกรอกข้อมูลและแนบสลิป',
    };
  }

  if ((asksShipping || previous.stage === 'checkout_info') && items.length) {
    const shippingMethod = joined.includes('รับเอง') ? 'รับเองที่ร้าน' : 'จัดส่ง';
    return {
      stage: 'checkout_info',
      items,
      shippingMethod,
      paymentStatus: 'ยังไม่เลือกช่องทางชำระเงิน',
      orderId: null,
      nextStep: 'ถามข้อมูลจัดส่งและพาไปสรุปยอดก่อนสร้างออเดอร์',
    };
  }

  if (items.length) {
    return {
      stage: 'cart_ready',
      items,
      shippingMethod: null,
      paymentStatus: null,
      orderId: null,
      nextStep: 'สรุปรายการและถามต่อว่าจะจัดส่งหรือรับเอง',
    };
  }

  return createInitialOrderState();
}

function Bubble({ role, text }: DemoMessage) {
  const isAssistant = role === 'assistant';
  return (
    <div style={{ display: 'flex', justifyContent: isAssistant ? 'flex-start' : 'flex-end' }}>
      <div
        style={{
          maxWidth: '78%',
          borderRadius: isAssistant ? '18px 18px 18px 8px' : '18px 18px 8px 18px',
          padding: '12px 14px',
          background: isAssistant ? '#eef6ea' : '#13293d',
          color: isAssistant ? '#163020' : '#fff',
          boxShadow: '0 8px 20px rgba(19,41,61,0.08)',
        }}
      >
        <Text style={{ color: 'inherit', whiteSpace: 'pre-wrap' }}>{text}</Text>
      </div>
    </div>
  );
}

export default function DemoPage() {
  const [archetype, setArchetype] = useState<ArchetypeKey>('fashion');
  const [messages, setMessages] = useState<DemoMessage[]>(createIntroMessage(DEMOS.fashion));
  const [draft, setDraft] = useState('');
  const [activeStep, setActiveStep] = useState(0);
  const [sending, setSending] = useState(false);
  const [orderState, setOrderState] = useState<DemoOrderState>(createInitialOrderState());
  const [demoShop, setDemoShop] = useState<DemoShopInfo>({
    key: 'fashion',
    label: DEMOS.fashion.label,
    tenantSlug: DEMO_TENANT_META.fashion.tenantSlug,
    name: DEMO_TENANT_META.fashion.fallbackShopName,
    ready: false,
  });
  const [sessions, setSessions] = useState<DemoSessionMap>({});
  const [heroOpen, setHeroOpen] = useState(false);
  const sessionsReadyRef = useRef(false);
  const demo = DEMOS[archetype];

  const heroTags = useMemo(
    () => ['Mockup', 'Archetype-aware AI', 'Chat commerce demo', 'Restock recovery'],
    []
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('bms-demo-sessions');
      if (!raw) return;
      const parsed = JSON.parse(raw) as DemoSessionMap;
      setSessions(parsed || {});
    } catch {
    } finally {
      sessionsReadyRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!sessionsReadyRef.current) return;
    try {
      window.localStorage.setItem('bms-demo-sessions', JSON.stringify(sessions));
    } catch {}
  }, [sessions]);

  useEffect(() => {
    setMessages(createIntroMessage(demo));
    setDraft('');
    setActiveStep(0);
    setOrderState(createInitialOrderState());
    setDemoShop({
      key: archetype,
      label: demo.label,
      tenantSlug: DEMO_TENANT_META[archetype].tenantSlug,
      name: DEMO_TENANT_META[archetype].fallbackShopName,
      ready: false,
    });
  }, [demo]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const nextMessages = [...messages, { role: 'customer' as const, text: trimmed }];
    const nextOrderState = buildOrderState(archetype, nextMessages, orderState);
    setMessages(nextMessages);
    setActiveStep(inferFlowStep(trimmed));
    setOrderState(nextOrderState);
    setDraft('');
    setSending(true);
    try {
      const response = await fetch('/api/bms/demo-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          demoShopKey: archetype,
          message: trimmed,
          sessionId: sessions[archetype] || null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
        shop?: DemoShopInfo;
        sessionId?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'demo chat failed');
      }
      if (data.shop) setDemoShop(data.shop);
      if (data.sessionId) {
        setSessions((current) => ({ ...current, [archetype]: data.sessionId as string }));
      }
      const reply = data.reply?.trim();
      if (!reply) {
        throw new Error('empty demo reply');
      }
      setMessages((current) => {
        const updated: DemoMessage[] = [...current, { role: 'assistant', text: reply }];
        setOrderState((current) => buildOrderState(archetype, updated, current));
        return updated;
      });
    } catch (error) {
      message.error('ส่งข้อความไม่สำเร็จ ลองใหม่อีกครั้งนะคะ');
      setMessages(messages);
      setOrderState(orderState);
    } finally {
      setSending(false);
    }
  }

  const subtotal = orderState.items.reduce((sum, item) => sum + item.qty * item.price, 0);

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', padding: '24px 16px 64px' }}>
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Card
          style={{ borderRadius: 18, border: '1px solid var(--app-border)' }}
          styles={{ body: { padding: '14px 20px' } }}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => setHeroOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setHeroOpen((v) => !v);
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: 'var(--app-surface-2)',
                color: 'var(--app-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transform: heroOpen ? 'rotate(180deg)' : undefined,
                transition: 'transform .15s ease',
              }}
            >
              <DownOutlined style={{ fontSize: 10 }} />
            </span>
            <Text strong style={{ fontSize: 16.5, flex: 1 }}>
              ลองถาม AI ของ BMS บนร้าน demo จริง
            </Text>
            {!heroOpen ? <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>วิธีใช้ ▸</Text> : null}
          </div>

          {heroOpen ? (
            <div style={{ paddingTop: 16, marginTop: 14, borderTop: '1px solid var(--app-border)' }}>
              <Space direction="vertical" size={14} style={{ width: '100%' }}>
                <Space wrap>
                  {heroTags.map((tag) => (
                    <Tag
                      key={tag}
                      style={{
                        borderRadius: 999,
                        paddingInline: 12,
                        background: 'rgba(var(--app-primary-rgb),0.09)',
                        color: 'var(--app-primary)',
                        border: 'none',
                      }}
                    >
                      {tag}
                    </Tag>
                  ))}
                </Space>
                <Paragraph style={{ margin: 0, color: 'var(--app-muted)', fontSize: 14.5 }}>
                  เลือกร้าน demo ก่อนคุย แล้วระบบจะผูกบริบทเป็นร้านนั้นโดยตรง เพื่อให้ AI อ่านสินค้าและตอบตามร้านที่เลือก
                </Paragraph>
                <Alert
                  type="info"
                  showIcon
                  message="ร้านที่เลือกจะถูกใช้เป็น context ของบทสนทนา"
                  description="ถ้า tenant demo ร้านนั้นถูกเตรียมสินค้าไว้แล้ว AI จะตอบบนข้อมูลร้านจริง ถ้ายังไม่พร้อม ระบบจะแจ้ง slug ร้านที่ต้องเตรียมให้ชัดเจน"
                  style={{ borderRadius: 16 }}
                />
              </Space>
            </div>
          ) : null}
        </Card>

        <Row gutter={[20, 20]} align="top">
          <Col xs={24} lg={15}>
            <Card style={{ borderRadius: 22 }}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Radio.Group
                  value={archetype}
                  onChange={(e) => setArchetype(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                  style={{ width: '100%' }}
                >
                  <Space wrap>
                    {Object.entries(DEMOS).map(([key, item]) => (
                      <Radio.Button key={key} value={key}>
                        {item.label}
                      </Radio.Button>
                    ))}
                  </Space>
                </Radio.Group>

                <Card
                  style={{ borderRadius: 18, background: 'linear-gradient(180deg, #fffaf0 0%, #f5fbf7 100%)' }}
                >
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag color="blue">{demo.label}</Tag>
                      <Tag color="green">{demo.angle}</Tag>
                      <Tag color={demoShop.ready ? 'success' : 'warning'}>
                        {demoShop.ready ? `พร้อมใช้งาน: ${demoShop.name}` : `รอเตรียมร้าน: ${demoShop.tenantSlug}`}
                      </Tag>
                    </Space>
                    <Paragraph style={{ margin: 0 }}>{demo.description}</Paragraph>
                    <Text type="secondary">
                      ตอนนี้กำลังคุยกับร้าน <Text strong>{demoShop.name}</Text> ที่ slug <Text code>{demoShop.tenantSlug}</Text>
                      {typeof demoShop.productCount === 'number' ? ` · สินค้าที่อ่านได้ ${demoShop.productCount} รายการ` : ''}
                    </Text>
                    <div>
                      <Text strong>ลองเริ่มด้วยคำถามพวกนี้</Text>
                      <Space wrap style={{ display: 'flex', marginTop: 8 }}>
                        {demo.starters.map((starter) => (
                          <Button
                            key={starter}
                            size="small"
                            shape="round"
                            onClick={() => sendMessage(starter)}
                          >
                            {starter}
                          </Button>
                        ))}
                      </Space>
                    </div>
                  </Space>
                </Card>

                <Card style={{ borderRadius: 20, background: '#f7fafc' }}>
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
                      <Space>
                        <MessageOutlined />
                        <Text strong style={{ fontSize: 18 }}>คุยกับ AI</Text>
                      </Space>
                      <Tag color="processing">ทดลองใช้งาน</Tag>
                    </Space>
                    <Text type="secondary">AI จะตอบเหมือนผู้ช่วยร้านในหมวดนี้ ไม่ใช่คำอธิบายระบบ</Text>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        minHeight: 380,
                        maxHeight: 560,
                        overflowY: 'auto',
                        padding: 8,
                      }}
                    >
                      {messages.map((message, index) => (
                        <Bubble key={`${message.role}-${index}`} {...message} />
                      ))}
                      {sending ? (
                        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                          <div
                            style={{
                              borderRadius: 18,
                              padding: '12px 14px',
                              background: '#eef6ea',
                              color: '#163020',
                            }}
                          >
                            <Space>
                              <Spin size="small" />
                              <Text>AI กำลังพิมพ์คำตอบ...</Text>
                            </Space>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <Divider style={{ margin: '4px 0' }} />
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onPressEnter={() => void sendMessage(draft)}
                        placeholder="ลองพิมพ์คำถามของลูกค้า..."
                        disabled={sending}
                      />
                      <Button type="primary" loading={sending} onClick={() => void sendMessage(draft)}>
                        ส่ง
                      </Button>
                    </Space.Compact>
                    <Space wrap>
                      <Button
                        onClick={() => {
                          setMessages(createIntroMessage(demo));
                          setActiveStep(0);
                          setOrderState(createInitialOrderState());
                          setSessions((current) => {
                            const next = { ...current };
                            delete next[archetype];
                            return next;
                          });
                        }}
                      >
                        เริ่มใหม่
                      </Button>
                      <Button disabled={sending} onClick={() => void sendMessage('ถ้าของหมดช่วยแจ้งเมื่อของเข้าด้วย')}>
                        ลอง restock path
                      </Button>
                    </Space>
                  </Space>
                </Card>
              </Space>
            </Card>
          </Col>

          <Col xs={24} lg={9}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card title="AI กำลังช่วยคิดอะไร" style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Space>
                    <RobotOutlined />
                    <Text strong>Business signals</Text>
                  </Space>
                  {demo.signals.map((signal) => (
                    <Tag key={signal} color="processing" style={{ width: 'fit-content' }}>
                      {signal}
                    </Tag>
                  ))}
                  <Divider style={{ margin: '6px 0' }} />
                  <Space>
                    <CheckCircleOutlined />
                    <Text strong>Would use tools like</Text>
                  </Space>
                  {demo.actions.map((action) => (
                    <Tag key={action} color="blue">
                      {action}
                    </Tag>
                  ))}
                </Space>
              </Card>

              <Card title="Business flow ที่ควรเกิด" style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  {FLOW_LABELS.map((step, index) => (
                    <Card
                      key={step}
                      size="small"
                      style={{
                        borderRadius: 16,
                        borderColor: index === activeStep ? '#216758' : undefined,
                        background: index === activeStep ? '#f5fbf7' : undefined,
                      }}
                    >
                      <Space>
                        <Tag color={index === activeStep ? 'green' : 'gold'} style={{ margin: 0 }}>
                          {index + 1}
                        </Tag>
                        <Text>{step}</Text>
                      </Space>
                    </Card>
                  ))}
                  <Paragraph type="secondary" style={{ margin: 0 }}>
                    Current demo focus: <Text strong>{FLOW_LABELS[activeStep]}</Text>
                  </Paragraph>
                </Space>
              </Card>

              <Card title="Mock cart / order" style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Tag
                    color={
                      orderState.stage === 'order_created'
                        ? 'green'
                        : orderState.stage === 'restock'
                          ? 'gold'
                          : orderState.stage === 'browsing'
                            ? 'default'
                            : 'blue'
                    }
                    style={{ width: 'fit-content' }}
                  >
                    {orderState.stage === 'browsing' && 'กำลังดูสินค้า'}
                    {orderState.stage === 'cart_ready' && 'พร้อมสรุปรายการ'}
                    {orderState.stage === 'checkout_info' && 'กำลังเก็บข้อมูลจัดส่ง'}
                    {orderState.stage === 'order_created' && 'สร้างออเดอร์ทดลองแล้ว'}
                    {orderState.stage === 'restock' && 'เข้า restock path'}
                  </Tag>
                  {orderState.items.length ? (
                    <Card size="small" style={{ borderRadius: 16 }}>
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        {orderState.items.map((item) => (
                          <Space key={item.name} style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Text>{item.name}</Text>
                            <Text>
                              x{item.qty} · {item.price.toLocaleString()} บาท
                            </Text>
                          </Space>
                        ))}
                        <Divider style={{ margin: '4px 0' }} />
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                          <Text strong>ยอดรวม</Text>
                          <Text strong>{subtotal.toLocaleString()} บาท</Text>
                        </Space>
                      </Space>
                    </Card>
                  ) : null}
                  {orderState.orderId ? (
                    <Alert
                      type="success"
                      showIcon
                      message={`Order #${orderState.orderId}`}
                      description={`สถานะ: ${orderState.paymentStatus} · วิธีรับสินค้า: ${orderState.shippingMethod}`}
                      style={{ borderRadius: 14 }}
                    />
                  ) : null}
                  <Paragraph style={{ margin: 0 }}>
                    <Text strong>Next step:</Text> {orderState.nextStep}
                  </Paragraph>
                  {orderState.stage === 'order_created' ? (
                    <Link href="/shop-signup">
                      <Button type="primary" block>
                        เปิดร้านของคุณ แล้วใช้ flow นี้กับสินค้าจริง
                      </Button>
                    </Link>
                  ) : null}
                </Space>
              </Card>

              <Card title="ทำไมหน้านี้น่าสนใจ" style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={10}>
                  <Space>
                    <ShopOutlined />
                    <Text>ช่วยให้คนทั่วไปลองของได้ก่อนสมัคร</Text>
                  </Space>
                  <Space>
                    <StarOutlined />
                    <Text>สื่อว่า BMS ไม่ใช่ chatbot ทั่วไป</Text>
                  </Space>
                  <Space>
                    <ShoppingCartOutlined />
                    <Text>โยงจากคำตอบ AI ไปสู่ flow ธุรกิจจริง</Text>
                  </Space>
                  <Alert
                    type="success"
                    showIcon
                    message="สิ่งที่เดโมนี้กำลังสื่อ"
                    description={demo.closing}
                    style={{ borderRadius: 14 }}
                  />
                </Space>
              </Card>

              <Card style={{ borderRadius: 22, background: '#13293d' }}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Text strong style={{ color: '#fff', fontSize: 16 }}>
                    ถ้าจะต่อจาก mockup นี้
                  </Text>
                  <Paragraph style={{ margin: 0, color: 'rgba(255,255,255,0.82)' }}>
                    version ถัดไปควรเพิ่ม compare mode, จำกัด turn demo, และแสดง side panel ว่า AI จะพาไป order
                    หรือ restock path อย่างไรแบบ interactive มากขึ้น
                  </Paragraph>
                  <Space wrap>
                    <Link href="/help">
                      <Button>ดู Help</Button>
                    </Link>
                    <Link href="/shop-signup">
                      <Button type="primary">สมัครเปิดร้าน</Button>
                    </Link>
                  </Space>
                </Space>
              </Card>
            </Space>
          </Col>
        </Row>
      </Space>
    </div>
  );
}
