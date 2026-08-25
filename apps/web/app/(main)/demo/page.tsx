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
import { useI18n } from '@/lib/i18nContext';
import { resolveBilingual, type Bilingual } from '@/lib/static-page-i18n';
import type { Lang } from '@/i18n';

const { Paragraph, Text } = Typography;

type ArchetypeKey = 'fashion' | 'food' | 'beauty' | 'grocery' | 'gadgets';

type DemoMessage = {
  role: 'customer' | 'assistant';
  text: string;
};

type NextStepCode = 'START' | 'RESTOCK' | 'ORDER_FROM_CHECKOUT' | 'ORDER_DIRECT' | 'ASK_SHIPPING' | 'SUMMARIZE';
type PaymentStatusCode = 'PENDING' | 'UNSELECTED';
type ShippingMethodCode = 'DELIVERY' | 'PICKUP' | 'UNSELECTED';

type DemoOrderState = {
  stage: 'browsing' | 'cart_ready' | 'checkout_info' | 'order_created' | 'restock';
  items: Array<{ name: string; qty: number; price: number }>;
  shippingMethod: ShippingMethodCode | null;
  paymentStatus: PaymentStatusCode | null;
  orderId: string | null;
  nextStep: NextStepCode;
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
  fashion: { tenantSlug: 'demo-fashion', fallbackShopName: 'Nami Studio' },
  food: { tenantSlug: 'demo-food', fallbackShopName: 'QuickBite Kitchen' },
  beauty: { tenantSlug: 'demo-beauty', fallbackShopName: 'Lumi Skin' },
  grocery: { tenantSlug: 'demo-minimart', fallbackShopName: 'Daily Mart' },
  gadgets: { tenantSlug: 'demo-gadget', fallbackShopName: 'Spark Mobile' },
};

type DemoConfig = {
  label: string;
  angle: string;
  description: string;
  starters: string[];
  intro: string;
  sampleReplies: Record<string, string>;
  signals: string[];
  actions: string[];
  closing: string;
};

const DEMOS: Record<Lang, Record<ArchetypeKey, DemoConfig>> = {
  th: {
    fashion: {
      label: 'ร้านเสื้อผ้า',
      angle: 'ไซซ์ สี และสินค้าทดแทน',
      description:
        'ร้านแฟชั่นต้องตอบเรื่องไซซ์ สี และตัวเลือกที่ใกล้เคียงกันได้ดี ถ้าของหมดไม่ควรปล่อยบทสนทนาจบง่าย ๆ',
      starters: ['เดรสสีดำมีไซซ์ M ไหม', 'ถ้าไม่มีช่วยแนะนำทรงใกล้เคียงให้หน่อย', 'มีโปรถ้าซื้อ 2 ตัวไหม'],
      intro: 'สวัสดีค่ะ สนใจดูเดรสหรือถามเรื่องไซซ์ สี และทรงที่ใกล้เคียงกันได้เลยนะคะ',
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
      intro: 'สวัสดีค่ะ ถามเรื่องเมนู ตัวเลือกเพิ่ม หรือการจัดส่งได้เลยนะคะ',
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
      signals: ['ลูกค้าคาดหวังความเร็ว', 'มี add-on intent', 'ควรปิดบทสนทนาให้สั้นและชัด'],
      actions: ['browse_catalog', 'search_products', 'create_order'],
      closing: 'BMS จะทำให้ร้านอาหารดูเป็นระบบสั่งซื้อผ่านแชต ไม่ใช่บอตตอบคำถามเฉย ๆ',
    },
    beauty: {
      label: 'ร้าน beauty',
      angle: 'consultative selling และ routine',
      description: 'ร้าน beauty ต้องตอบแบบแนะนำเป็นชุด เข้าใจ pain point ของลูกค้า และยังยึดสินค้าที่ร้านมีจริง',
      starters: ['ผิวแพ้ง่ายควรเริ่มตัวไหน', 'มีเซ็ตล้างหน้า-บำรุงไหม', 'ถ้าตัวหลักหมดมีตัวแทนไหม'],
      intro: 'สวัสดีค่ะ ถามเรื่องสภาพผิว routine หรือสินค้าที่ใช้คู่กันได้เลยนะคะ',
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
      intro: 'สวัสดีค่ะ ส่งรายการที่อยากได้มาได้เลยนะคะ ถ้ามีหลายอย่างพิมพ์มาพร้อมกันได้ค่ะ',
      sampleReplies: {
        'มีมาม่าต้มยำไหม':
          'ได้ค่ะ เดี๋ยวเช็กสินค้าที่พร้อมขายจริงให้ก่อน ถ้าครบจะสรุปรายการและยอดให้ทันที ถ้าตัวไหนหมดเราควรเสนอของใกล้เคียงหรือชวนแจ้งเมื่อของเข้าแทนค่ะ',
        'เอาโค้ก 2 ขวดด้วย':
          'ร้านของชำควรรับหลายรายการในบทสนทนาเดียว แล้วค่อยสรุปเป็นตะกร้าหรือออเดอร์ให้เลย เพื่อให้การซื้อเร็วและลื่นที่สุดค่ะ',
        'ถ้าของโปรหมดช่วยแจ้งด้วย':
          'ได้เลยค่ะ แบบนี้เหมาะกับการเปิด restock subscription ไว้ เพราะร้านจะไม่เสียบทสนทนาไปเปล่า ๆ และยังกลับมาปิดการขายได้เมื่อของเข้าค่ะ',
        default: 'สำหรับ minimart BMS ควรตอบเร็ว รับหลายรายการได้ และใช้ restock queue เป็นเครื่องมือรักษายอดเมื่อของหมดค่ะ',
      },
      signals: ['ตะกร้าหลายรายการ', 'มีโอกาสเสียยอดเพราะของหมด', 'เหมาะกับ conversion เร็ว'],
      actions: ['search_products', 'create_order', 'subscribe_restock_notification'],
      closing: 'BMS ทำให้เห็นว่า even simple retail chat ก็แปลงเป็น order flow หรือ recovery flow ได้',
    },
    gadgets: {
      label: 'ร้าน gadget',
      angle: 'compatibility และ cross-sell',
      description: 'ร้าน gadget ควรโชว์ว่า AI เข้าใจรุ่นเครื่อง ความเข้ากันได้ และการแนะนำอุปกรณ์เสริมที่เกี่ยวข้อง',
      starters: ['เคส iPhone 15 Pro มีไหม', 'มีกระจกกับสายชาร์จที่เข้ากันไหม', 'ถ้าเคสหมดมีรุ่นอื่นแทนไหม'],
      intro: 'สวัสดีค่ะ ถามเรื่องรุ่นเครื่อง ความเข้ากันได้ หรืออุปกรณ์เสริมได้เลยนะคะ',
      sampleReplies: {
        'เคส iphone 15 pro มีไหม':
          'ได้ค่ะ เดี๋ยวเช็กเคสที่ตรงรุ่นก่อน แล้วค่อยแนะนำอุปกรณ์เสริมที่เข้ากันได้จริง ถ้ารุ่นที่อยากได้หมด ระบบควรเสนอทางเลือกหรือเปิดคิวแจ้งเมื่อของเข้าไว้ให้ได้ค่ะ',
        'มีกระจกกับสายชาร์จที่เข้ากันไหม':
          'ได้ค่ะ จุดสำคัญของร้าน gadget คือ AI ต้องรู้ว่ากำลังช่วยเลือกของที่ใช้ร่วมกันได้จริง ไม่ใช่เสนอของกว้าง ๆ ที่เข้ากันไม่ได้ค่ะ',
        'ถ้าเคสหมดมีรุ่นอื่นแทนไหม':
          'ได้เลยค่ะ ถ้ารุ่นที่ตรงสุดหมด เราควรเรียงลำดับตัวเลือกแทนตามรุ่น สี และรูปทรงที่ใกล้เคียงก่อน เพื่อรักษาโอกาสขายไว้ค่ะ',
        default: 'ร้าน gadget ควรตอบจาก compatibility ก่อน แล้วค่อยต่อด้วย cross-sell และ alternative path ตามสิ่งที่ลูกค้าถามค่ะ',
      },
      signals: ['ต้องรู้รุ่นเครื่อง', 'มีโอกาส cross-sell สูง', 'ลูกค้าคาดหวังคำตอบแม่นเรื่อง compatibility'],
      actions: ['search_products', 'recommend_products', 'find_alternatives'],
      closing: 'BMS โชว์ความฉลาดเชิงบริบทร้านได้ดีมากในหมวดที่ต้องแมตช์รุ่นและอุปกรณ์',
    },
  },
  en: {
    fashion: {
      label: 'Fashion shop',
      angle: 'Size, color, and substitutes',
      description:
        'A fashion shop needs to handle size, color, and similar-alternative questions well. If something is out of stock, the conversation should not just end there.',
      starters: ['Do you have the black dress in size M?', "If not, can you suggest something similar?", 'Any discount if I buy 2?'],
      intro: "Hi! Feel free to ask about our dresses, or about sizes, colors, and similar styles.",
      sampleReplies: {
        'black dress in size m':
          "Sure, let me check size M for this style first. If it's out, I'll suggest a similar style that's still in stock, and if you'd rather wait for the original, I can set up a restock alert for you.",
        'suggest something similar':
          "Absolutely! For a fashion shop, we shouldn't just say \"not available\" — we should offer a similar style, similar color, or a size that's still in stock, to keep your interest in buying.",
        'discount if i buy 2':
          "If the shop has a real, active coupon or promo, the system should always check eligibility from the backend first, then confirm whether it applies to these 2 items.",
        default:
          "For a fashion shop, BMS should reply based on the variant the customer asked about — color, size, style — and if it's out of stock, guide them to a substitute or the restock flow instead.",
      },
      signals: ['Asks about size clearly', 'Has buying intent', 'Accepts the restock-notify flow'],
      actions: ['search_products', 'find_alternatives', 'subscribe_restock_notification'],
      closing: 'BMS shows that AI understands variants and can recover a sale that would have been lost to an out-of-stock item.',
    },
    food: {
      label: 'Restaurant / delivery',
      angle: 'Fast replies, live menu, and add-ons',
      description:
        'This category needs fast replies, a clear picture of what is on the active menu, and guidance toward ordering without overstating what the system can do.',
      starters: ["Do you have basil stir-fry today?", 'Can I add a fried egg?', 'How long does delivery to a condo take?'],
      intro: 'Hi! Ask me about the menu, add-ons, or delivery any time.',
      sampleReplies: {
        'basil stir-fry today':
          "Sure, let me check what's on the active menu first. If it's available, I'll summarize your order right away, and if the shop has add-ons set up, I'll suggest them in the same message.",
        'add a fried egg':
          'If the shop has a real add-on option configured, the system should immediately confirm that a fried egg can be added and how it affects the price — without making the customer ask twice.',
        'how long does delivery to a condo take':
          "This demo shows that a restaurant should reply short and clear — for example, checking the delivery area and estimated time before moving to order confirmation.",
        default:
          "For food delivery, BMS should give fast answers, show clear availability, and guide the customer toward a real order without turning into an unnecessarily long conversation.",
      },
      signals: ['Customer expects speed', 'Has add-on intent', 'Conversation should stay short and clear'],
      actions: ['browse_catalog', 'search_products', 'create_order'],
      closing: 'BMS makes a restaurant feel like a real chat-ordering system, not just a bot answering questions.',
    },
    beauty: {
      label: 'Beauty shop',
      angle: 'Consultative selling and routines',
      description:
        'A beauty shop needs to reply with a curated set, understand the customer\'s pain point, and still stay grounded in what the shop actually carries.',
      starters: ['I have sensitive skin — where should I start?', 'Do you have a cleanser + moisturizer set?', 'Is there a substitute if the main item is out of stock?'],
      intro: 'Hi! Ask me about your skin type, routine, or products that work well together.',
      sampleReplies: {
        'sensitive skin':
          "Sure, let me pick products suited for sensitive skin from what the shop actually carries, then put together a short routine for you — and check whether the full set is in stock or if something needs a restock alert.",
        'cleanser + moisturizer set':
          'For beauty, BMS should reply with an easy-to-understand set — like a cleanser plus one core moisturizer — and if the shop has a real bundle, summarize it as an option for the customer.',
        'substitute if the main item is out of stock':
          'Sure — if the main item is out, the system should first look for a close alternative, and if the customer really wants to wait for the original, offer the restock flow.',
        default:
          "A beauty shop should clearly separate observation from recommendation, and still base its advice on what the shop actually has — never a vague, ungrounded suggestion.",
      },
      signals: ['Wants advice, not just a product search', 'Good cross-sell opportunity as a set', 'Should reply in a consultative tone'],
      actions: ['recommend_products', 'search_products', 'find_alternatives'],
      closing: 'BMS makes AI sound like a knowledgeable consultant while staying grounded in real stock.',
    },
    grocery: {
      label: 'Grocery / mini-mart',
      angle: 'Fast, multi-item orders, frequent stockouts',
      description:
        'A grocery store is a good fit for showing that AI can take a multi-item order, check stock quickly, and use the restock queue as a tool to protect revenue.',
      starters: ['Do you have Tom Yum instant noodles?', 'Add 2 bottles of Coke too', "Please let me know if a promo item is back in stock"],
      intro: 'Hi! Send me your shopping list — if it\'s several items, feel free to type them all at once.',
      sampleReplies: {
        'tom yum instant noodles':
          "Sure, let me check what's actually available first. If everything is in stock, I'll summarize the order and total right away. If anything is out, we should suggest a similar item or offer to notify you when it's back.",
        'add 2 bottles of coke':
          'A grocery shop should be able to take multiple items in one conversation, then summarize them into a cart or order — keeping the purchase as fast and smooth as possible.',
        'let me know if a promo item is back in stock':
          "Absolutely — this is a great case for opening a restock subscription, so the shop doesn't lose the conversation for nothing, and can still close the sale once stock is back.",
        default:
          'For a mini-mart, BMS should reply fast, handle multiple items at once, and use the restock queue as a tool to protect revenue when something is out of stock.',
      },
      signals: ['Multi-item basket', 'Risk of lost sales from stockouts', 'Good fit for fast conversion'],
      actions: ['search_products', 'create_order', 'subscribe_restock_notification'],
      closing: 'BMS shows that even a simple retail chat can turn into an order flow or a recovery flow.',
    },
    gadgets: {
      label: 'Gadget shop',
      angle: 'Compatibility and cross-sell',
      description: 'A gadget shop should show that AI understands device models, compatibility, and recommending related accessories.',
      starters: ['Do you have a case for iPhone 15 Pro?', 'Do you have a compatible screen protector and charging cable?', 'Is there another model if the case is out of stock?'],
      intro: 'Hi! Ask me about your device model, compatibility, or accessories any time.',
      sampleReplies: {
        'case for iphone 15 pro':
          "Sure, let me check the case for your exact model first, then recommend accessories that are actually compatible. If the model you want is out of stock, the system should offer alternatives or set up a restock alert for you.",
        'compatible screen protector and charging cable':
          'The key thing for a gadget shop is that AI needs to know it is helping pick items that are genuinely compatible together — not just offering generic items that might not fit.',
        'another model if the case is out of stock':
          'Absolutely — if the exact match is out, we should rank substitute options by model, color, and shape closest to the original, to keep the sales opportunity alive.',
        default: 'A gadget shop should reply based on compatibility first, then follow up with cross-sell and alternative paths based on what the customer asked.',
      },
      signals: ['Needs to know the device model', 'High cross-sell potential', 'Customer expects precise compatibility answers'],
      actions: ['search_products', 'recommend_products', 'find_alternatives'],
      closing: 'BMS shows strong contextual intelligence in categories that require matching models and accessories.',
    },
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

type DemoUiContent = {
  heroCollapsedTitle: string;
  heroCollapsedHint: string;
  heroTags: string[];
  heroBody: string;
  heroAlertMessage: string;
  heroAlertDesc: string;
  shopReadyPrefix: string;
  shopPendingPrefix: string;
  chattingWithPrefix: string;
  atSlugLabel: string;
  productCountSuffix: (n: number) => string;
  tryStartersLabel: string;
  chatWithAiLabel: string;
  tryingBadge: string;
  chatSubtext: string;
  aiTypingLabel: string;
  inputPlaceholder: string;
  sendLabel: string;
  restartLabel: string;
  tryRestockLabel: string;
  restockTrigger: string;
  sendFailedToast: string;
  aiThinkingTitle: string;
  businessSignalsLabel: string;
  wouldUseToolsLabel: string;
  businessFlowTitle: string;
  currentFocusLabel: string;
  mockCartTitle: string;
  stageLabels: Record<DemoOrderState['stage'], string>;
  totalLabel: string;
  currencyUnit: string;
  statusLabel: string;
  shippingMethodLabel: string;
  nextStepLabel: string;
  openShopCta: string;
  whyInterestingTitle: string;
  whyPoint1: string;
  whyPoint2: string;
  whyPoint3: string;
  demoMeaningLabel: string;
  nextUpTitle: string;
  nextUpBody: string;
  viewHelpCta: string;
  signUpShopCta: string;
  initialNextStep: string;
  nextStepMap: Record<NextStepCode, string>;
  paymentStatusMap: Record<PaymentStatusCode, string>;
  shippingMethodMap: Record<ShippingMethodCode, string>;
};

const DEMO_UI: Bilingual<DemoUiContent> = {
  en: {
    heroCollapsedTitle: "Try asking BMS's AI on a live demo shop",
    heroCollapsedHint: 'How it works ▸',
    heroTags: ['Mockup', 'Archetype-aware AI', 'Chat commerce demo', 'Restock recovery'],
    heroBody:
      "Pick a demo shop before chatting — the system binds the conversation to that shop's context so AI reads its products and replies accordingly.",
    heroAlertMessage: 'The shop you pick becomes the context for this conversation',
    heroAlertDesc:
      "If that demo tenant already has products prepared, AI will answer using real shop data. If not, the system clearly shows which shop slug still needs to be set up.",
    shopReadyPrefix: 'Ready:',
    shopPendingPrefix: 'Preparing shop:',
    chattingWithPrefix: "You're currently chatting with",
    atSlugLabel: 'at slug',
    productCountSuffix: (n) => ` · ${n} products readable`,
    tryStartersLabel: 'Try starting with one of these',
    chatWithAiLabel: 'Chat with AI',
    tryingBadge: 'Trying it out',
    chatSubtext: "AI will reply like a shop assistant for this category, not a system explainer.",
    aiTypingLabel: 'AI is typing...',
    inputPlaceholder: "Try typing a customer's question...",
    sendLabel: 'Send',
    restartLabel: 'Restart',
    tryRestockLabel: 'Try the restock path',
    restockTrigger: "If it's out of stock, please notify me when it's back",
    sendFailedToast: 'Failed to send. Please try again.',
    aiThinkingTitle: 'What the AI is thinking about',
    businessSignalsLabel: 'Business signals',
    wouldUseToolsLabel: 'Would use tools like',
    businessFlowTitle: 'The business flow that should happen',
    currentFocusLabel: 'Current demo focus:',
    mockCartTitle: 'Mock cart / order',
    stageLabels: {
      browsing: 'Browsing products',
      cart_ready: 'Ready to summarize',
      checkout_info: 'Collecting delivery info',
      order_created: 'Demo order created',
      restock: 'Entered restock path',
    },
    totalLabel: 'Total',
    currencyUnit: 'THB',
    statusLabel: 'Status:',
    shippingMethodLabel: 'Fulfillment:',
    nextStepLabel: 'Next step:',
    openShopCta: 'Open your own shop and use this flow with real products',
    whyInterestingTitle: 'Why this page is interesting',
    whyPoint1: 'Lets anyone try it before signing up',
    whyPoint2: "Shows that BMS isn't a generic chatbot",
    whyPoint3: "Connects AI's answers to a real business flow",
    demoMeaningLabel: 'What this demo is showing',
    nextUpTitle: 'Where this mockup could go next',
    nextUpBody:
      'The next version should add a compare mode, a turn limit for the demo, and a side panel showing more interactively how AI leads to an order or a restock path.',
    viewHelpCta: 'View Help',
    signUpShopCta: 'Sign up your shop',
    initialNextStep: 'Start by asking about a product, size, menu item, or whatever you need',
    nextStepMap: {
      START: 'Start by asking about a product, size, menu item, or whatever you need',
      RESTOCK: 'Capture the restock request, then come back to close the sale once stock is ready again.',
      ORDER_FROM_CHECKOUT: 'The customer enters checkout to fill in required details and attach proof of payment.',
      ORDER_DIRECT:
        'In a real shop, at this point the customer would get a checkout link to fill in details and attach a slip.',
      ASK_SHIPPING: 'Ask for delivery details and walk through the total before creating the order.',
      SUMMARIZE: 'Summarize the order and ask whether they want delivery or pickup.',
    },
    paymentStatusMap: { PENDING: 'Awaiting payment', UNSELECTED: 'Payment method not chosen yet' },
    shippingMethodMap: { DELIVERY: 'Delivery', PICKUP: 'Pickup at store', UNSELECTED: 'Fulfillment method not chosen yet' },
  },
  th: {
    heroCollapsedTitle: 'ลองถาม AI ของ BMS บนร้าน demo จริง',
    heroCollapsedHint: 'วิธีใช้ ▸',
    heroTags: ['Mockup', 'Archetype-aware AI', 'Chat commerce demo', 'Restock recovery'],
    heroBody: 'เลือกร้าน demo ก่อนคุย แล้วระบบจะผูกบริบทเป็นร้านนั้นโดยตรง เพื่อให้ AI อ่านสินค้าและตอบตามร้านที่เลือก',
    heroAlertMessage: 'ร้านที่เลือกจะถูกใช้เป็น context ของบทสนทนา',
    heroAlertDesc: 'ถ้า tenant demo ร้านนั้นถูกเตรียมสินค้าไว้แล้ว AI จะตอบบนข้อมูลร้านจริง ถ้ายังไม่พร้อม ระบบจะแจ้ง slug ร้านที่ต้องเตรียมให้ชัดเจน',
    shopReadyPrefix: 'พร้อมใช้งาน:',
    shopPendingPrefix: 'รอเตรียมร้าน:',
    chattingWithPrefix: 'ตอนนี้กำลังคุยกับร้าน',
    atSlugLabel: 'ที่ slug',
    productCountSuffix: (n) => ` · สินค้าที่อ่านได้ ${n} รายการ`,
    tryStartersLabel: 'ลองเริ่มด้วยคำถามพวกนี้',
    chatWithAiLabel: 'คุยกับ AI',
    tryingBadge: 'ทดลองใช้งาน',
    chatSubtext: 'AI จะตอบเหมือนผู้ช่วยร้านในหมวดนี้ ไม่ใช่คำอธิบายระบบ',
    aiTypingLabel: 'AI กำลังพิมพ์คำตอบ...',
    inputPlaceholder: 'ลองพิมพ์คำถามของลูกค้า...',
    sendLabel: 'ส่ง',
    restartLabel: 'เริ่มใหม่',
    tryRestockLabel: 'ลอง restock path',
    restockTrigger: 'ถ้าของหมดช่วยแจ้งเมื่อของเข้าด้วย',
    sendFailedToast: 'ส่งข้อความไม่สำเร็จ ลองใหม่อีกครั้งนะคะ',
    aiThinkingTitle: 'AI กำลังช่วยคิดอะไร',
    businessSignalsLabel: 'Business signals',
    wouldUseToolsLabel: 'Would use tools like',
    businessFlowTitle: 'Business flow ที่ควรเกิด',
    currentFocusLabel: 'Current demo focus:',
    mockCartTitle: 'Mock cart / order',
    stageLabels: {
      browsing: 'กำลังดูสินค้า',
      cart_ready: 'พร้อมสรุปรายการ',
      checkout_info: 'กำลังเก็บข้อมูลจัดส่ง',
      order_created: 'สร้างออเดอร์ทดลองแล้ว',
      restock: 'เข้า restock path',
    },
    totalLabel: 'ยอดรวม',
    currencyUnit: 'บาท',
    statusLabel: 'สถานะ:',
    shippingMethodLabel: 'วิธีรับสินค้า:',
    nextStepLabel: 'Next step:',
    openShopCta: 'เปิดร้านของคุณ แล้วใช้ flow นี้กับสินค้าจริง',
    whyInterestingTitle: 'ทำไมหน้านี้น่าสนใจ',
    whyPoint1: 'ช่วยให้คนทั่วไปลองของได้ก่อนสมัคร',
    whyPoint2: 'สื่อว่า BMS ไม่ใช่ chatbot ทั่วไป',
    whyPoint3: 'โยงจากคำตอบ AI ไปสู่ flow ธุรกิจจริง',
    demoMeaningLabel: 'สิ่งที่เดโมนี้กำลังสื่อ',
    nextUpTitle: 'ถ้าจะต่อจาก mockup นี้',
    nextUpBody: 'version ถัดไปควรเพิ่ม compare mode, จำกัด turn demo, และแสดง side panel ว่า AI จะพาไป order หรือ restock path อย่างไรแบบ interactive มากขึ้น',
    viewHelpCta: 'ดู Help',
    signUpShopCta: 'สมัครเปิดร้าน',
    initialNextStep: 'เริ่มจากถามสินค้า ไซซ์ เมนู หรือสิ่งที่ต้องการก่อน',
    nextStepMap: {
      START: 'เริ่มจากถามสินค้า ไซซ์ เมนู หรือสิ่งที่ต้องการก่อน',
      RESTOCK: 'เก็บคำขอแจ้งเมื่อของเข้า และกลับมาปิดการขายเมื่อสินค้าพร้อมอีกครั้ง',
      ORDER_FROM_CHECKOUT: 'ลูกค้าเข้าสู่ checkout เพื่อกรอกข้อมูลที่จำเป็นและแนบหลักฐานชำระเงิน',
      ORDER_DIRECT: 'ในร้านจริง จุดนี้ลูกค้าจะได้รับ checkout link เพื่อกรอกข้อมูลและแนบสลิป',
      ASK_SHIPPING: 'ถามข้อมูลจัดส่งและพาไปสรุปยอดก่อนสร้างออเดอร์',
      SUMMARIZE: 'สรุปรายการและถามต่อว่าจะจัดส่งหรือรับเอง',
    },
    paymentStatusMap: { PENDING: 'รอชำระเงิน', UNSELECTED: 'ยังไม่เลือกช่องทางชำระเงิน' },
    shippingMethodMap: { DELIVERY: 'จัดส่ง', PICKUP: 'รับเองที่ร้าน', UNSELECTED: 'รอเลือกวิธีรับสินค้า' },
  },
};

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
    nextStep: 'START',
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

// keyword sets check both Thai and English so the demo works no matter which language the UI (and its starter phrases) is in
const KEYWORDS = {
  shipping: ['ส่ง', 'เลขพัสดุ', 'ship', 'deliver', 'delivery'],
  payment: ['จ่าย', 'สลิป', 'payment', 'pay', 'slip'],
  restock: ['แจ้ง', 'ของเข้า', 'รอ', 'หมด', 'notify', 'restock', 'back in stock', 'out of stock'],
  order: ['เอา', 'สั่ง', 'order', 'buy', 'add'],
  discover: ['มีไหม', 'ไซซ์', 'แนะนำ', 'รุ่น', 'do you have', 'size', 'suggest', 'recommend', 'model'],
  wantsRestock: ['ของเข้า', 'แจ้งเมื่อของเข้า', 'รอของ', 'notify me when', "let me know", 'back in stock'],
  buyingIntent: ['เอา', 'สั่ง', 'รับ', 'ซื้อ', 'buy', 'order', 'take', "i'll get", 'add'],
  notPromoQuestion: ['มีโปรถ้าซื้อ', 'discount if i buy'],
  asksShipping: ['จัดส่ง', 'ส่งที่', 'รับเอง', 'delivery', 'deliver', 'pickup', 'pick up'],
  confirms: ['ยืนยัน', 'ตกลง', 'โอเค', 'confirm', 'ok', 'okay', 'yes'],
  asksPayment: ['จ่าย', 'ชำระ', 'โอน', 'pay', 'payment', 'transfer'],
  pickup: ['รับเอง', 'pickup', 'pick up'],
};

function includesAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function inferFlowStep(input: string) {
  const normalized = normalizeText(input);
  if (!normalized) return 0;
  if (includesAny(normalized, KEYWORDS.shipping)) return 6;
  if (includesAny(normalized, KEYWORDS.payment)) return 5;
  if (includesAny(normalized, KEYWORDS.restock)) return 4;
  if (includesAny(normalized, KEYWORDS.order)) return 4;
  if (includesAny(normalized, KEYWORDS.discover)) return 3;
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

function primaryItemName(archetype: ArchetypeKey, lang: Lang, conversation = '') {
  if (lang === 'en') {
    switch (archetype) {
      case 'fashion':
        return 'Black dress, similar style';
      case 'food':
        return conversation.includes('boiled egg') ? 'Basil stir-fry + boiled egg' : 'Basil stir-fry + fried egg';
      case 'beauty':
        return 'Starter skincare set';
      case 'grocery':
        return 'Items from your latest list';
      case 'gadgets':
        return 'Case + compatible accessories';
      default:
        return 'Demo product';
    }
  }
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
  lang: Lang,
  history: DemoMessage[],
  previous: DemoOrderState = createInitialOrderState(),
): DemoOrderState {
  const joined = history
    .filter((item) => item.role === 'customer')
    .map((item) => item.text.toLowerCase())
    .join(' ');
  const wantsRestock = includesAny(joined, KEYWORDS.wantsRestock);

  if (wantsRestock) {
    return {
      stage: 'restock',
      items: [],
      shippingMethod: null,
      paymentStatus: null,
      orderId: null,
      nextStep: 'RESTOCK',
    };
  }

  const buyingIntent = includesAny(joined, KEYWORDS.buyingIntent) && !includesAny(joined, KEYWORDS.notPromoQuestion);

  const asksShipping = includesAny(joined, KEYWORDS.asksShipping);

  const latestCustomerText = history
    .filter((item) => item.role === 'customer')
    .at(-1)?.text.trim().toLowerCase() || '';
  const confirms = KEYWORDS.confirms.includes(latestCustomerText);

  const asksPayment = includesAny(joined, KEYWORDS.asksPayment);

  const items = buyingIntent
    ? [{ name: primaryItemName(archetype, lang, joined), qty: 1, price: priceForArchetype(archetype) }]
    : previous.items;

  if (confirms && previous.stage === 'checkout_info' && items.length) {
    return {
      ...previous,
      stage: 'order_created',
      paymentStatus: 'PENDING',
      orderId: 'DEMO-2048',
      nextStep: 'ORDER_FROM_CHECKOUT',
    };
  }

  if (confirms && previous.stage === 'cart_ready') return previous;

  if (asksPayment && items.length) {
    return {
      stage: 'order_created',
      items,
      shippingMethod: previous.shippingMethod || (asksShipping ? 'DELIVERY' : 'UNSELECTED'),
      paymentStatus: 'PENDING',
      orderId: 'DEMO-2048',
      nextStep: 'ORDER_DIRECT',
    };
  }

  if ((asksShipping || previous.stage === 'checkout_info') && items.length) {
    const shippingMethod: ShippingMethodCode = includesAny(joined, KEYWORDS.pickup) ? 'PICKUP' : 'DELIVERY';
    return {
      stage: 'checkout_info',
      items,
      shippingMethod,
      paymentStatus: 'UNSELECTED',
      orderId: null,
      nextStep: 'ASK_SHIPPING',
    };
  }

  if (items.length) {
    return {
      stage: 'cart_ready',
      items,
      shippingMethod: null,
      paymentStatus: null,
      orderId: null,
      nextStep: 'SUMMARIZE',
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
  const { lang } = useI18n();
  const ui = resolveBilingual(DEMO_UI, lang);
  const DEMOS_FOR_LANG = DEMOS[lang] ?? DEMOS.en;

  const [archetype, setArchetype] = useState<ArchetypeKey>('fashion');
  const [messages, setMessages] = useState<DemoMessage[]>(createIntroMessage(DEMOS_FOR_LANG.fashion));
  const [draft, setDraft] = useState('');
  const [activeStep, setActiveStep] = useState(0);
  const [sending, setSending] = useState(false);
  const [orderState, setOrderState] = useState<DemoOrderState>(createInitialOrderState());
  const [demoShop, setDemoShop] = useState<DemoShopInfo>({
    key: 'fashion',
    label: DEMOS_FOR_LANG.fashion.label,
    tenantSlug: DEMO_TENANT_META.fashion.tenantSlug,
    name: DEMO_TENANT_META.fashion.fallbackShopName,
    ready: false,
  });
  const [sessions, setSessions] = useState<DemoSessionMap>({});
  const [heroOpen, setHeroOpen] = useState(false);
  const sessionsReadyRef = useRef(false);
  const demo = DEMOS_FOR_LANG[archetype];

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const nextMessages = [...messages, { role: 'customer' as const, text: trimmed }];
    const nextOrderState = buildOrderState(archetype, lang, nextMessages, orderState);
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
        setOrderState((current) => buildOrderState(archetype, lang, updated, current));
        return updated;
      });
    } catch (error) {
      message.error(ui.sendFailedToast);
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
              {ui.heroCollapsedTitle}
            </Text>
            {!heroOpen ? <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{ui.heroCollapsedHint}</Text> : null}
          </div>

          {heroOpen ? (
            <div style={{ paddingTop: 16, marginTop: 14, borderTop: '1px solid var(--app-border)' }}>
              <Space direction="vertical" size={14} style={{ width: '100%' }}>
                <Space wrap>
                  {ui.heroTags.map((tag) => (
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
                  {ui.heroBody}
                </Paragraph>
                <Alert closable
                  type="info"
                  showIcon
                  message={ui.heroAlertMessage}
                  description={ui.heroAlertDesc}
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
                    {Object.entries(DEMOS_FOR_LANG).map(([key, item]) => (
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
                        {demoShop.ready ? `${ui.shopReadyPrefix} ${demoShop.name}` : `${ui.shopPendingPrefix} ${demoShop.tenantSlug}`}
                      </Tag>
                    </Space>
                    <Paragraph style={{ margin: 0 }}>{demo.description}</Paragraph>
                    <Text type="secondary">
                      {ui.chattingWithPrefix} <Text strong>{demoShop.name}</Text> {ui.atSlugLabel} <Text code>{demoShop.tenantSlug}</Text>
                      {typeof demoShop.productCount === 'number' ? ui.productCountSuffix(demoShop.productCount) : ''}
                    </Text>
                    <div>
                      <Text strong>{ui.tryStartersLabel}</Text>
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
                        <Text strong style={{ fontSize: 18 }}>{ui.chatWithAiLabel}</Text>
                      </Space>
                      <Tag color="processing">{ui.tryingBadge}</Tag>
                    </Space>
                    <Text type="secondary">{ui.chatSubtext}</Text>
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
                              <Text>{ui.aiTypingLabel}</Text>
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
                        placeholder={ui.inputPlaceholder}
                        disabled={sending}
                      />
                      <Button type="primary" loading={sending} onClick={() => void sendMessage(draft)}>
                        {ui.sendLabel}
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
                        {ui.restartLabel}
                      </Button>
                      <Button disabled={sending} onClick={() => void sendMessage(ui.restockTrigger)}>
                        {ui.tryRestockLabel}
                      </Button>
                    </Space>
                  </Space>
                </Card>
              </Space>
            </Card>
          </Col>

          <Col xs={24} lg={9}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card title={ui.aiThinkingTitle} style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Space>
                    <RobotOutlined />
                    <Text strong>{ui.businessSignalsLabel}</Text>
                  </Space>
                  {demo.signals.map((signal) => (
                    <Tag key={signal} color="processing" style={{ width: 'fit-content' }}>
                      {signal}
                    </Tag>
                  ))}
                  <Divider style={{ margin: '6px 0' }} />
                  <Space>
                    <CheckCircleOutlined />
                    <Text strong>{ui.wouldUseToolsLabel}</Text>
                  </Space>
                  {demo.actions.map((action) => (
                    <Tag key={action} color="blue">
                      {action}
                    </Tag>
                  ))}
                </Space>
              </Card>

              <Card title={ui.businessFlowTitle} style={{ borderRadius: 22 }}>
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
                    {ui.currentFocusLabel} <Text strong>{FLOW_LABELS[activeStep]}</Text>
                  </Paragraph>
                </Space>
              </Card>

              <Card title={ui.mockCartTitle} style={{ borderRadius: 22 }}>
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
                    {ui.stageLabels[orderState.stage]}
                  </Tag>
                  {orderState.items.length ? (
                    <Card size="small" style={{ borderRadius: 16 }}>
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        {orderState.items.map((item) => (
                          <Space key={item.name} style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Text>{item.name}</Text>
                            <Text>
                              x{item.qty} · {item.price.toLocaleString()} {ui.currencyUnit}
                            </Text>
                          </Space>
                        ))}
                        <Divider style={{ margin: '4px 0' }} />
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                          <Text strong>{ui.totalLabel}</Text>
                          <Text strong>{subtotal.toLocaleString()} {ui.currencyUnit}</Text>
                        </Space>
                      </Space>
                    </Card>
                  ) : null}
                  {orderState.orderId ? (
                    <Alert closable
                      type="success"
                      showIcon
                      message={`Order #${orderState.orderId}`}
                      description={`${ui.statusLabel} ${orderState.paymentStatus ? ui.paymentStatusMap[orderState.paymentStatus] : ''} · ${ui.shippingMethodLabel} ${orderState.shippingMethod ? ui.shippingMethodMap[orderState.shippingMethod] : ''}`}
                      style={{ borderRadius: 14 }}
                    />
                  ) : null}
                  <Paragraph style={{ margin: 0 }}>
                    <Text strong>{ui.nextStepLabel}</Text> {ui.nextStepMap[orderState.nextStep]}
                  </Paragraph>
                  {orderState.stage === 'order_created' ? (
                    <Link href="/shop-signup">
                      <Button type="primary" block>
                        {ui.openShopCta}
                      </Button>
                    </Link>
                  ) : null}
                </Space>
              </Card>

              <Card title={ui.whyInterestingTitle} style={{ borderRadius: 22 }}>
                <Space direction="vertical" size={10}>
                  <Space>
                    <ShopOutlined />
                    <Text>{ui.whyPoint1}</Text>
                  </Space>
                  <Space>
                    <StarOutlined />
                    <Text>{ui.whyPoint2}</Text>
                  </Space>
                  <Space>
                    <ShoppingCartOutlined />
                    <Text>{ui.whyPoint3}</Text>
                  </Space>
                  <Alert closable
                    type="success"
                    showIcon
                    message={ui.demoMeaningLabel}
                    description={demo.closing}
                    style={{ borderRadius: 14 }}
                  />
                </Space>
              </Card>

              <Card style={{ borderRadius: 22, background: '#13293d' }}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Text strong style={{ color: '#fff', fontSize: 16 }}>
                    {ui.nextUpTitle}
                  </Text>
                  <Paragraph style={{ margin: 0, color: 'rgba(255,255,255,0.82)' }}>
                    {ui.nextUpBody}
                  </Paragraph>
                  <Space wrap>
                    <Link href="/help">
                      <Button>{ui.viewHelpCta}</Button>
                    </Link>
                    <Link href="/shop-signup">
                      <Button type="primary">{ui.signUpShopCta}</Button>
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
