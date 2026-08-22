'use client';

import { useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Col,
  Divider,
  List,
  Row,
  Space,
  Steps,
  Tag,
  Typography,
} from "antd";
import Link from "next/link";
import {
  ApiOutlined,
  CreditCardOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  InboxOutlined,
  RobotOutlined,
  RocketOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  TruckOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual, type Bilingual } from "@/lib/static-page-i18n";

const { Title, Paragraph, Text } = Typography;

type PersonaKey = "owner" | "staff" | "ops";
type FlowKey = "products" | "orders" | "payment" | "shipping";

const ROUTES = {
  inbox: "/admin/inbox",
  products: "/admin/products",
  purchase: "/admin/purchase",
  orders: "/admin/orders",
  payment: "/admin/payment",
  shipment: "/admin/shipment",
  settings: "/admin/settings",
  dashboard: "/admin/dashboard",
  reports: "/admin/reports",
  aiQuality: "/admin/ai-quality",
  assistant: "/admin/assistant",
  customers: "/admin/customers",
  revisions: "/admin/revisions",
  restock: "/admin/restock-subscriptions",
  realtimeDiagnostics: "/admin/inbox/realtime-diagnostics",
  profile: "/admin/profile",
  pos: "/pos",
  loyalty: "/admin/loyalty",
  stockTransfers: "/admin/stock-transfers",
  stockCounts: "/admin/stock-counts",
} as const;

const PERSONA_HREF: Record<PersonaKey, string> = {
  owner: ROUTES.products,
  staff: ROUTES.inbox,
  ops: ROUTES.settings,
};

const L = {
  inbox: <Link href={ROUTES.inbox}>Inbox</Link>,
  products: <Link href={ROUTES.products}>Products</Link>,
  purchase: <Link href={ROUTES.purchase}>Purchase</Link>,
  orders: <Link href={ROUTES.orders}>Orders</Link>,
  payment: <Link href={ROUTES.payment}>Payment</Link>,
  shipment: <Link href={ROUTES.shipment}>Shipping</Link>,
  settings: <Link href={ROUTES.settings}>Settings</Link>,
  dashboard: <Link href={ROUTES.dashboard}>Dashboard</Link>,
  reports: <Link href={ROUTES.reports}>Reports</Link>,
  aiQuality: <Link href={ROUTES.aiQuality}>AI Quality</Link>,
  realtimeDiagnostics: <Link href={ROUTES.realtimeDiagnostics}>Realtime Diagnostics</Link>,
};

const COUPON_CONDITION_CODES = [
  "SAVE10",
  "WELCOME50",
  "FLASH100",
  "VIP25",
  "SAVE10",
  "LAST1",
  "SAVE20",
  "SAVE20",
  "OLD10",
  "USED10",
];

const COUPON_WALLET_STATES = ["ASSIGNED", "RESERVED", "REDEEMED", "EXPIRED", "REVOKED"];

const ARCHETYPE_KEYS = [
  "mini_mart",
  "fashion",
  "home_kitchen",
  "beauty_personal_care",
  "food_beverage",
  "gadgets_accessories",
  "b2b_wholesale",
  "gifts_seasonal",
  "other",
];

const MENU_META: { key: string; icon: React.ReactNode; href: string }[] = [
  { key: "inbox", icon: <InboxOutlined />, href: ROUTES.inbox },
  { key: "products", icon: <DatabaseOutlined />, href: ROUTES.products },
  { key: "pos-loyalty", icon: <ShopOutlined />, href: ROUTES.pos },
  { key: "branch-inventory", icon: <DatabaseOutlined />, href: ROUTES.stockTransfers },
  { key: "restock", icon: <CustomerServiceOutlined />, href: ROUTES.restock },
  { key: "ops", icon: <ShoppingCartOutlined />, href: ROUTES.orders },
  { key: "revisions", icon: <HistoryOutlined />, href: ROUTES.revisions },
  { key: "crm", icon: <UserOutlined />, href: ROUTES.customers },
  { key: "assistant", icon: <RobotOutlined />, href: ROUTES.assistant },
];

type PersonaCard = { title: string; subtitle: string; items: string[]; ctaLabel: string };
type FlowCard = { title: string; path: string; summary: string; checks: string[]; tags: string[] };
type CouponCondition = { condition: string; result: string };
type ArchetypeExample = {
  label: string;
  focus: string;
  customerAsk: string;
  aiReply: string;
  backendFlow: string;
  whyItFits: string;
};
type MenuCard = { title: string; desc: string; bullets: string[] };
type HelpRow = { title: string; answer: string };
type StepItem = { title: string; description: string };
type LinkStep = { title: string; description: React.ReactNode };

type ManualContent = {
  heroTag: string;
  heroTitle: string;
  heroLead: string;
  heroAlertMessage: string;
  heroAlertDesc: string;
  heroCtaQuickstart: string;
  heroCtaWorkflow: string;
  heroCtaMenus: string;
  heroTags: string[];
  anchors: {
    hero: string;
    quickstart: string;
    workflow: string;
    archetypes: string;
    coupons: string;
    menus: string;
    faq: string;
    links: string;
  };
  quickstartTitle: string;
  quickstartSubtitle: string;
  personaButtons: Record<PersonaKey, string>;
  personaCards: Record<PersonaKey, PersonaCard>;
  workflowTitle: string;
  workflowSubtitle: string;
  flowButtons: Record<FlowKey, string>;
  flowCards: Record<FlowKey, FlowCard>;
  archetypesTitle: string;
  archetypesSubtitle: string;
  archetypeAlertMessage: string;
  archetypeAlertDesc: string;
  archetypeCustomerAskLabel: string;
  archetypeAiReplyLabel: string;
  archetypeBackendFlowLabel: string;
  archetypeWhyLabel: string;
  archetypeExamples: ArchetypeExample[];
  couponsTitle: string;
  couponsSubtitle: string;
  couponAlertMessage: string;
  couponAlertDesc: string;
  couponStepsTitle: string;
  couponSteps: StepItem[];
  couponWhereToSeeTitle: string;
  couponWhereToSee: string[];
  couponWalletStatesTitle: string;
  couponWalletMeanings: string[];
  couponConditionsTitle: string;
  couponConditionLabel: string;
  couponConditions: CouponCondition[];
  couponGapsTitle: string;
  couponGaps: string[];
  menusTitle: string;
  menusSubtitle: string;
  menuCards: MenuCard[];
  menuOpenPagePrefix: string;
  menuGroupingAlertMessage: string;
  menuGroupingAlertDesc: string;
  faqTitle: string;
  faqSubtitle: string;
  helpRows: HelpRow[];
  linksTitle: string;
  linksSubtitle: string;
  linkSteps: LinkStep[];
  linksAlertMessage: string;
  linksAlertDesc: string;
  sidebarTocTitle: string;
  sidebarShortcutsTitle: string;
  sidebarShortcuts: string[];
  sidebarNextTitle: string;
  sidebarNextItems: string[];
  noteTitle: string;
  noteBody: string;
  noteTags: string[];
};

const COUPON_CONDITIONS_TH: CouponCondition[] = [
  { condition: "ลด 10%, active, ยังไม่หมดอายุ, quota เหลือ, ลูกค้ายังไม่เกิน per-customer limit, ยอดถึงขั้นต่ำ", result: "ผ่าน: ระบบเพิ่มเข้ากระเป๋าคูปองและแนบลิงก์ให้ลูกค้าเปิดดูได้ ตอนสร้างออเดอร์ backend จะลดราคาจริงใน transaction เดียวกับการจองสต็อก" },
  { condition: "ลด 50 บาท, ไม่มีขั้นต่ำ, แจกเข้ากระเป๋าลูกค้าแล้ว", result: "ผ่าน: ลูกค้าถามว่ามีคูปองอะไร ระบบดึงจาก wallet แล้วตอบโค้ดนี้ก่อนคูปองทั่วไป" },
  { condition: "ลด 100 บาท, ตั้งวันเริ่มใช้เป็นพรุ่งนี้", result: "ไม่ผ่านก่อนเวลาเริ่ม: AI/ฟอร์มสร้างออเดอร์ต้องบอกว่าโค้ดยังไม่เริ่มใช้ได้ และไม่สร้างออเดอร์ครึ่ง ๆ กลาง ๆ" },
  { condition: "ลด 25%, ขั้นต่ำ 1,000 บาท, ตะกร้าปัจจุบัน 850 บาท", result: "ไม่ผ่าน: ระบบบอกว่ายอดยังไม่ถึงขั้นต่ำ และยังไม่ mark เป็น redeemed" },
  { condition: "per-customer limit = 1 และลูกค้าเคยใช้กับออเดอร์ที่ไม่ถูกยกเลิกแล้ว", result: "ไม่ผ่าน: ระบบบอกว่าใช้ครบจำนวนที่กำหนดแล้ว แม้ quota รวมของร้านยังเหลือ" },
  { condition: "max redemptions เต็มแล้ว หรือ remainingRedemptions = 0", result: "ไม่ผ่าน: ระบบตอบว่าโค้ดถูกใช้ครบจำนวนแล้ว และเสนอคูปองอื่นที่ยังใช้ได้ถ้ามี" },
  { condition: "ลูกค้าได้รับคูปองใน wallet แล้วสร้างออเดอร์ แต่ยังไม่จ่ายเงิน", result: "สถานะเป็น RESERVED และผูก order id ไว้: ถ้า order ถูก cancel หรือหมดเวลาจ่าย ระบบคืน quota และย้อนกลับเป็น ASSIGNED" },
  { condition: "ลูกค้าส่งสลิปผิดแล้ว payment ถูก reject แต่ order ยังเปิดอยู่", result: "ยังไม่คืนคูปองทันที: ลูกค้ายังส่งสลิปใหม่ได้ คูปองจะคืนเมื่อ order ถูก cancel หรือ auto-release เท่านั้น" },
  { condition: "คูปองหมดอายุหลังแจกเข้ากระเป๋าแล้ว", result: "สถานะเป็น EXPIRED เมื่อระบบอ่าน wallet ครั้งถัดไป: ลูกค้ายังเห็นประวัติได้ แต่ใช้ไม่ได้" },
  { condition: "คูปองเคยถูกใช้/ผูกกับออเดอร์แล้ว", result: "ลบหรือ rename ไม่ได้: ให้ปิด active แทน เพื่อเก็บประวัติและยอดในออเดอร์เก่าให้ trace ได้" },
];

const COUPON_WHERE_TO_SEE_TH: string[] = [
  "Inbox > Customer 360: ใช้ดูระหว่างคุยกับลูกค้า เห็นคูปองของลูกค้า, ตะกร้าปัจจุบัน, ออเดอร์ล่าสุด, และปุ่มแจกคูปองให้ลูกค้าคนนี้",
  "Customers (CRM): กดขยายแถวลูกค้าเพื่อดู coupon wallet, สถานะ, วันหมดอายุ, เหตุผลที่ใช้ไม่ได้, และ order id ที่เกี่ยวข้อง",
  "Coupons: ใช้จัดการ master coupon และกดจำนวน 'ใช้ไปแล้ว' เพื่อดูว่าโค้ดนี้ถูกใช้กับ order ไหน/ลูกค้าคนไหน",
  "Dashboard: ใช้ดูภาพรวมเดือนนี้ว่าส่วนลดถูกแจกไปเท่าไร ใช้กี่ครั้ง และ top coupon codes คืออะไร",
];

const COUPON_WALLET_MEANINGS_TH: string[] = [
  "ร้านแจกคูปองเข้ากระเป๋าลูกค้าแล้ว ลูกค้าเปิดลิงก์กระเป๋าคูปองเพื่อดูรายละเอียดได้ทันที",
  "คูปองถูกผูกกับออเดอร์ที่สร้างแล้วและยังรอจ่าย/ดำเนินการอยู่",
  "ออเดอร์เข้าสู่ path ที่จ่ายเงินจริงแล้ว คูปองถือว่าใช้สำเร็จ",
  "คูปองหมดอายุแล้ว ใช้ไม่ได้ แต่ยังเก็บประวัติใน wallet",
  "ร้านยกเลิกสิทธิ์ของลูกค้าคนนี้โดยเฉพาะ ใช้ไม่ได้ แม้ master coupon ยัง active",
];

const COUPON_GAPS_TH: string[] = [
  "ตอนนี้มี lifecycle ต่อคนต่อคูปองแล้ว (assigned / reserved / redeemed / expired / revoked) แต่ยังไม่มีหน้ารวมสำหรับทีมการตลาดที่ดึงกลุ่มลูกค้าตาม state แบบ bulk campaign",
  "ยังไม่มีมุมมอง “คูปองใกล้หมดอายุของลูกค้าคนนี้ทั้งหมด” เป็นหน้าหรือ query แยกสำหรับงาน campaign แม้ AI จะอ่านจาก wallet ได้แล้ว",
  "ยังไม่รองรับ coupon เฉพาะสินค้า, หมวดหมู่, ช่องทาง, หรือ stack หลายใบในออเดอร์เดียว",
  "ถ้าลูกค้ายังไม่มี identity/customer_id ใน CRM ระบบยังเช็กได้แค่ quota รวมและเวลา แต่ยังนับ per-customer history แบบเต็มไม่ได้จนกว่าจะผูกตัวตนลูกค้า",
];

const ARCHETYPE_EXAMPLES_TH: ArchetypeExample[] = [
  {
    label: "Mini Mart / Grocery",
    focus: "ลูกค้าซื้อซ้ำเร็ว ถามของพร้อมส่ง ราคาโปร และของหมดบ่อย",
    customerAsk: "มีมาม่าต้มยำลัง 6 ซองไหม ถ้ามีเอา 3 แพ็ก แล้วโค้ก 1.25 ลิตร 2 ขวด",
    aiReply:
      "ได้ค่ะ เดี๋ยวเช็กสต็อกสินค้าที่พร้อมขายก่อน ถ้าครบจะสรุปยอดและสร้างออเดอร์ให้ทันที ถ้าของบางตัวหมด ระบบควรเสนอสินค้าใกล้เคียงหรือชวนกดแจ้งเมื่อของเข้าแทน",
    backendFlow: "search/browse สินค้า -> เช็กสต็อก -> สร้างออเดอร์ -> รับชำระ -> นัดส่งหรือรับเอง",
    whyItFits: "เหมาะกับ flow สั่งไว ตัดสินใจไว และใช้ restock queue ช่วยเก็บยอดจากสินค้าหมดชั่วคราว",
  },
  {
    label: "Fashion & Apparel",
    focus: "ลูกค้าถามไซซ์ สี แมตช์ลุค และอยากรู้ว่าสินค้าคล้ายกันมีไหม",
    customerAsk: "เดรสสีดำรุ่นนี้มีไซซ์ M ไหม ถ้าไม่มีช่วยแนะนำทรงใกล้เคียงให้หน่อย",
    aiReply:
      "ได้ค่ะ เดี๋ยวเช็กไซซ์ M ของรุ่นนี้ก่อน ถ้าหมดจะเสนอรุ่นทรงใกล้เคียงที่ยังมีสต็อก และถ้าลูกค้าอยากรอรุ่นเดิม ระบบควรขอความยินยอมเพื่อแจ้งเมื่อของเข้า",
    backendFlow: "เช็ก stock ต่อ variant -> หา alternative -> restock opt-in -> สร้างออเดอร์เมื่อเลือกได้",
    whyItFits: "บริบทแฟชั่นต้องตอบเรื่องตัวเลือกแทนสินค้าเดิมและเปลี่ยน stock-out ให้เป็นโอกาสขายกลับมา",
  },
  {
    label: "Home & Kitchen",
    focus: "ลูกค้ามักเทียบขนาด วัสดุ และซื้อเป็นชุดมากกว่าชิ้นเดียว",
    customerAsk: "จานเซรามิก 10 นิ้วมีแบบเข้าไมโครเวฟได้ไหม แล้วถ้าซื้อ 6 ใบมีราคาชุดหรือเปล่า",
    aiReply:
      "ได้ค่ะ เดี๋ยวช่วยดูรุ่นที่เข้าไมโครเวฟได้และเทียบตัวเลือกให้ก่อน จากนั้นค่อยแนะนำ bundle หรือจำนวนที่คุ้มที่สุด ถ้ารุ่นที่ต้องการหมด ระบบควรเก็บคิวแจ้งของเข้าไว้ได้",
    backendFlow: "ค้นหาตามคุณสมบัติ -> แนะนำ bundle/ทางเลือก -> เช็กสต็อก -> สร้างออเดอร์หรือ restock queue",
    whyItFits: "ร้านกลุ่มนี้เด่นเรื่องการเปรียบเทียบสินค้าและการเพิ่มยอดต่อบิลผ่านชุดสินค้า",
  },
  {
    label: "Beauty & Personal Care",
    focus: "เน้นคำแนะนำเชิง consultative เช่น สภาพผิว routine และสินค้าใช้คู่กัน",
    customerAsk: "ผิวแพ้ง่าย เป็นสิวง่าย มีเซ็ตล้างหน้า-บำรุงที่อ่อนโยนไหม",
    aiReply:
      "ได้ค่ะ เดี๋ยวคัดสินค้าที่ตรงบริบทผิวแพ้ง่ายจากรายการที่ร้านมีจริงก่อน แล้วค่อยแนะนำเป็น routine สั้น ๆ พร้อมเช็กว่าสินค้าครบชุดหรือมีตัวไหนควรเปิด restock notification ไว้",
    backendFlow: "recommend/browse สินค้า -> cross-sell เป็น routine -> เช็ก stock -> สร้างออเดอร์หรือเปิด restock",
    whyItFits: "AI ช่วยขายแบบแนะนำเป็นชุดได้ดี และ restock ช่วยรักษาลูกค้าที่กลับมาซื้อซ้ำเป็นประจำ",
  },
  {
    label: "Food & Beverage",
    focus: "ลูกค้าคาดหวังการตอบเร็ว คล้ายสั่งเมนูหน้าร้าน แต่ระบบยังยึด flow สินค้า-ออเดอร์ปกติ",
    customerAsk: "พิซซ่าฮาวายเอียนถาดกลางวันนี้มีไหม เพิ่มชีสได้หรือเปล่า",
    aiReply:
      "ได้ค่ะ เดี๋ยวเช็กเมนูที่เปิดขายอยู่ก่อน ถ้ามีจะสรุปรายการและยอดให้ทันที แต่คำตอบต้องอิงสินค้าที่มีจริงใน catalog และไม่ควรสัญญาความสามารถ POS เฉพาะทางที่ระบบยังไม่รองรับ",
    backendFlow: "browse เมนูที่ active -> เช็ก stock/availability -> สร้างออเดอร์ -> รับชำระ -> ส่งหรือรับเอง",
    whyItFits: "ใช้ demo การสั่งเร็วในแชตได้ดี แต่คู่มือต้องย้ำว่าเป็น chat-commerce ไม่ใช่ร้านอาหาร POS เต็มรูปแบบ",
  },
  {
    label: "Gadgets & Accessories",
    focus: "ลูกค้าถามเรื่องความเข้ากันได้ รุ่นเครื่อง และของเสริมที่เกี่ยวข้อง",
    customerAsk: "เคส iPhone 15 Pro มีไหม แล้วมีกระจกกับสายชาร์จที่ใช้ด้วยกันได้แนะนำไหม",
    aiReply:
      "ได้ค่ะ เดี๋ยวเช็กเคสที่ตรงรุ่นก่อน แล้วค่อยเสนออุปกรณ์เสริมที่เข้ากันได้จริง ถ้ารุ่นที่ต้องการหมด ระบบควรเสนอทางเลือกหรือชวนสมัครแจ้งเมื่อของเข้าแทนการปล่อยบทสนทนาจบ",
    backendFlow: "ค้นหาตาม compatibility -> cross-sell accessories -> เช็ก stock -> restock capture หรือสร้างออเดอร์",
    whyItFits: "สินค้ากลุ่มนี้เหมาะกับ AI ที่ช่วยทั้งตอบเรื่องรุ่นและดันยอดด้วยสินค้าเสริม",
  },
  {
    label: "B2B / Wholesale",
    focus: "ลูกค้าถามจำนวนมาก ราคาเหมาส่ง เอกสาร และการซื้อซ้ำรอบถัดไป",
    customerAsk: "ถ้าสั่งแก้วพลาสติก 1,000 ใบมีราคาส่งไหม ออกใบเสนอราคาให้ก่อนได้หรือเปล่า",
    aiReply:
      "ได้ค่ะ เดี๋ยวเช็กสินค้าที่มีและสรุปจำนวนก่อน จากนั้นระบบควรพาไปสู่การออกใบเสนอราคา/ใบแจ้งหนี้และให้ทีมตามงานต่อในหลังบ้าน มากกว่าปิดด้วยข้อความแนะนำสินค้าสั้น ๆ",
    backendFlow: "เช็ก catalog/stock -> สรุปจำนวน -> quotation/invoice -> order -> payment -> shipping",
    whyItFits: "เหมาะกับ use case ที่ conversation ต้องต่อยอดไปเอกสารและกระบวนการขายหลังบ้านจริง",
  },
  {
    label: "Gifts & Seasonal",
    focus: "ลูกค้าซื้อเป็นโอกาส เช่น ของขวัญปีใหม่ วันเกิด และต้องการเซ็ตพร้อมโปรโมชัน",
    customerAsk: "อยากได้ชุดของขวัญงบไม่เกิน 1,500 บาท ส่งให้เพื่อนวันเกิดได้ไหม",
    aiReply:
      "ได้ค่ะ เดี๋ยวช่วยคัดสินค้าที่เหมาะกับงบและโอกาสให้ก่อน แล้วค่อยแนะนำชุดที่พร้อมขายจริง พร้อมเช็กสต็อก ค่าจัดส่ง และคูปองที่ใช้ได้ ถ้าของชุดฮิตหมด ระบบควรชวนเข้าคิวรอของเข้า",
    backendFlow: "discover ตาม budget/occasion -> bundle + coupon -> เช็ก stock -> order/payment/shipping หรือ restock",
    whyItFits: "ใช้โชว์ความสามารถ AI ในการคัดสินค้าเชิงบริบทและใช้คูปอง/seasonality ช่วยปิดการขาย",
  },
  {
    label: "Other",
    focus: "ใช้เมื่อร้านยังไม่ชัดว่าจะอยู่กลุ่มไหน หรือมีหลายรูปแบบผสมกัน",
    customerAsk: "ร้านนี้ขายอะไรเด่นสุด แล้วสั่งยังไง",
    aiReply:
      "ได้ค่ะ เดี๋ยวแนะนำสินค้าที่พร้อมขายจากข้อมูลจริงของร้านก่อน แล้วค่อยพาลูกค้าไปสู่ขั้นเช็กสต็อก สร้างออเดอร์ หรือเก็บคิวรอของเข้าเมื่อเหมาะสม",
    backendFlow: "เริ่มจาก catalog จริง -> ถามต่อเฉพาะข้อมูลที่ขาด -> order/restock/payment/shipping",
    whyItFits: "เป็นค่าเริ่มต้นปลอดภัยสำหรับร้านที่ยังไม่ได้ตั้ง archetype หรือกำลังทดลองหลายโมเดล",
  },
];

const MENU_CARDS_TH: MenuCard[] = [
  {
    title: "Inbox",
    desc: "รับแชท, ดู Customer 360, assign staff, ตามงานต่อจากแชท",
    bullets: ["เริ่มงานจากแชทใหม่", "Customer 360 สร้างออเดอร์และออกใบแจ้งหนี้ได้ตามสิทธิ์", "ออเดอร์ล่าสุดเปิดดูแบบ preview ใน Inbox ได้ก่อน และมีปุ่มเปิดหน้า Orders เต็มจอเป็นแท็บใหม่", "รูป/ไฟล์จะเข้า draft ก่อนส่งและแนบได้ครั้งละ 1 รายการ", "ข้อความ รูป ไฟล์ สินค้า และคูปองจะแสดงคนละรูปแบบ: bubble ข้อความ, การ์ดรูป, การ์ดไฟล์, การ์ดสินค้า และการ์ดคูปอง", "สินค้าแชร์ public link ให้ลูกค้าดูราคา สต็อก และ gallery ได้; ในแชทแนบเฉพาะรูป cover และกด ดูสินค้า จากการ์ดได้", "คูปองส่งเป็นข้อความ fallback ทุกช่องทางพร้อมลิงก์กระเป๋าคูปอง ระบบเพิ่มสิทธิ์เข้า wallet ตอนส่งจริง ลูกค้าไม่ต้องกดรับ", "AI ตรวจคูปองจาก backend ก่อนตอบลูกค้า ถ้าโค้ดใช้ไม่ได้จะบอกเหตุผลและเสนอคูปองที่ยังใช้ได้แทน แต่จะไม่ใช้คูปองจากข้อความอิสระ", "ลิงก์ Products หลังบ้านเปิดแท็บใหม่สำหรับพนักงานและไม่ถูกส่งให้ลูกค้า", "มือถือใช้ flow รายชื่อ → แชทเต็มจอ พร้อมปุ่มย้อนกลับ", "แชทที่เปิดอยู่จะอ่านและล้าง badge อัตโนมัติเมื่อข้อความเข้า", "อยู่ท้ายแชทจะเลื่อนตามอัตโนมัติ; ถ้าอ่านย้อนหลังให้กดปุ่มข้อความใหม่เพื่อลงด้านล่าง", "ดูข้อมูลลูกค้าไม่ต้องสลับหน้า", "เหมาะกับทีมขาย/แอดมินหน้าร้าน"],
  },
  {
    title: "Products & Purchase",
    desc: "เพิ่มสินค้า, รูปหลายรูป, stock, reorder point, รับของเข้าคลัง",
    bullets: ["รูปแรกเป็น cover", "รับของผ่าน Purchase", "กรองหมวดหมู่และค้นหา SKU ได้"],
  },
  {
    title: "POS & สมาชิก",
    desc: "ขายหน้าร้าน, สมาชิก/แต้ม, พักบิล, เงินลิ้นชัก, void และรายงานกะ",
    bullets: [
      "เปิดกะและยืนยันตัวพนักงานด้วย PIN ก่อนขาย; device token ระบุเครื่องและสาขา ไม่ใช่ตัวบุคคล",
      "Bluetooth HID เป็น Keyboard: ตั้ง Scanner ของเครื่องเป็น Prefix Mode (เช่น F9 + ข้อมูล + Enter) ที่หน้าเครื่องขาย เพื่อให้สแกนได้แม้กำลังพิมพ์ค้นสมาชิก/PIN โดยข้อมูลไม่หลุดเข้าช่องนั้น",
      "แท็บรับของให้เลือก PO ก่อน สแกนเป็นรายการร่าง ตรวจจำนวน/lot/วันหมดอายุ แล้วกดยืนยันครั้งเดียว; ต้องมีสิทธิ์ purchase.receive และของเข้าที่สาขาของเครื่องนี้",
      "ค้นหาสมาชิกก่อนชำระเพื่อใช้ส่วนลดตาม tier และแต้ม; ตั้งโปรแกรมและตรวจ ledger ที่ /admin/loyalty",
      "พักบิลได้ไม่เกิน 20 บิลต่อกะ แต่ไม่จอง stock และไม่ล็อกราคา; ตอนกลับมาขายระบบใช้ราคาและ stock ปัจจุบัน",
      "แท็บมัดจำใช้รับเงินครั้งแรก/รับเพิ่ม/รับยอดคงเหลือ/ปิดมัดจำของสาขานี้; รับครบต้องใช้ปุ่มรับยอดคงเหลือเพื่อส่งของ ตัด stock และออกเอกสารในขั้นเดียว — ถ้ามีสินค้าบังคับเลขเครื่อง ให้ยิงสินค้ากับ serial จริงใส่ตะกร้าก่อนกดรับยอดคงเหลือ",
      "เงินเข้า/ออกลิ้นชักต้องมีเหตุผล และเงินออกต้องใช้ PIN ผู้อนุมัติคนที่สองเสมอ",
      "ค่าใช้จ่ายหน้าร้านแยกจากการย้ายเงิน: จ่ายค่าน้ำแข็ง/วัตถุดิบแบบจ่ายตรง หรือเบิกไปซื้อแล้วกลับมาลงยอดจริง; เงินทอนจะกลับเข้าลิ้นชักและเงินเกินจะออกเพิ่มอัตโนมัติ โดยต้องปิดยอดเบิกทั้งหมดก่อนปิดกะ",
      "ร้านที่มีเจ้าของคนเดียวเลือก ‘เจ้าของคนเดียว · สำรองจ่ายส่วนตัว’ ได้ บัญชีต้องมีสิทธิ์ pos.expense.personal และต้องใส่เลขที่ใบเสร็จ/หลักฐาน รายการนี้เป็นค่าใช้จ่ายของร้านแต่ไม่หักเงินในลิ้นชัก; การคืนเงินให้เจ้าของภายหลังยังเป็นเงินออกและต้องมีผู้อนุมัติคนที่สอง",
      "ถ้าต้องจ่ายของจุกจิกบ่อย ให้ Administrator เติม ‘กระเป๋าเงินสดย่อยสาขา’ จากเงินเจ้าของหรือบัญชีร้านพร้อมหลักฐาน แล้วเลือกวิธีจ่าย ‘เงินสดย่อยร้าน’; ระบบหักจากยอดกระเป๋าและเก็บประวัติ แต่ไม่แตะยอดลิ้นชักและไม่ต้องมี PIN คนที่สอง",
      "Void ใช้เมื่อบิลลงผิดและกะยังเปิด ต้องมีเหตุผลกับผู้อนุมัติคนที่สอง; หลังปิดกะให้ทำ Return แทน",
      "ดู X report ระหว่างกะและ Z report หลังปิดกะ เพื่อตรวจยอดคาดหวัง ยอดนับจริง และผลต่าง",
    ],
  },
  {
    title: "โอนสาขา & นับสต็อก",
    desc: "ย้ายของระหว่างสาขาและปรับยอดจากการนับชั้นวางโดยไม่ทับยอดขายระหว่างนับ",
    bullets: [
      "ใบโอนทำสองขั้น: ส่งออกจากต้นทาง แล้วรับเข้าปลายทาง; ของระหว่างทางไม่อยู่ใน stock ของสาขาใด",
      "ส่งได้เฉพาะ stock ที่ไม่ถูกจอง และตอนรับสามารถระบุจำนวนขาดเพื่อบันทึกของหายระหว่างทาง",
      "ใบนับเก็บ snapshot ตอนกรอกรายการครั้งแรก และตอน Apply จะเพิ่มเฉพาะผลต่าง ไม่เขียนทับยอดปัจจุบัน",
      "พนักงานคลังที่มี inventory.count กรอกตัวเลขได้ แต่ต้องมี inventory.count.apply จึงยืนยันผลต่างเข้าสต็อกจริงได้",
      "เริ่มที่ /admin/stock-transfers และเปิด /admin/stock-counts เมื่อต้องตรวจนับสินค้า",
    ],
  },
  {
    title: "แจ้งลูกค้าเมื่อของเข้า",
    desc: "เปลี่ยนความต้องการตอนของหมดให้เป็นคิวติดตามการขาย",
    bullets: ["AI สมัครเฉพาะเมื่อลูกค้ายินยอม", "ของเข้าแล้วรอคนตรวจข้อความก่อนส่ง", "แยกสร้างออเดอร์แล้วออกจากชำระสำเร็จ", "KPI นับยอดกู้กลับเมื่อยืนยันการชำระเงินจริงและตัด refund/cancel/return ออก", "ดู success/error และ Resend พร้อมแก้ข้อความได้"],
  },
  {
    title: "Orders / Payment / Shipping",
    desc: "3 หน้านี้ควรถูกใช้ต่อเนื่องกันเป็น flow เดียว",
    bullets: ["มี search บนทุกหน้า", "ตามสถานะงานได้ชัด", "Orders แสดง subtotal/ส่วนลดคูปอง/ยอดสุทธิ", "เหมาะกับงานปฏิบัติการรายวัน"],
  },
  {
    title: "Revision History",
    desc: "ดู snapshot ก่อนแก้ไข, เปิด detail, และ compare 2 version สำหรับ records สำคัญ",
    bullets: ["รองรับ Products / Orders / Payment / Shipping", "ค้นหาด้วย SKU, ID, status, reference หรือ tracking", "Editor แสดง user login สำหรับ revision ใหม่หลังระบบส่ง editor context แล้ว"],
  },
  {
    title: "Customers / CRM",
    desc: "ดูข้อมูลลูกค้า, ที่อยู่, ประวัติซื้อ, merge และค้นหาชื่อ/เบอร์",
    bullets: ["ที่อยู่หลายรายการ", "ค้นหาเร็วจากชื่อ/เบอร์", "ใช้คู่กับ Customer 360"],
  },
  {
    title: "ผู้ช่วย AI",
    desc: "ถาม/สั่งงานหลังบ้านด้วยภาษาพูด — AI ดึงข้อมูลจริงและทำงานได้ตามสิทธิ์ของบัญชีคุณ",
    bullets: [
      "ถามรายงาน/สต็อก/ออร์เดอร์ลูกค้า ได้คำตอบจากข้อมูลจริงทันที",
      "ขอ ใบเสนอราคา/ใบแจ้งหนี้ · ให้ช่วย คาดการณ์ของใกล้หมด/เสนอจำนวนสั่งซื้อ (ประมาณการ ต้องรีวิวก่อนใช้จริง)",
      "งานที่กระทบเงิน/สต็อก/ลบข้อมูล (คืนเงิน, ปรับสต็อก, ยกเลิกออร์เดอร์, ผสานลูกค้า, ส่งข้อความหาลูกค้า) AI จะเตรียม “คำขอ” ให้เท่านั้น",
      "ต้องกดปุ่ม ยืนยัน เองเสมอ ก่อนระบบจะทำจริง — เหมือนกดปุ่มเดิมในหน้า Payment/Orders",
      "เห็นเฉพาะทูลที่ตรงกับสิทธิ์ (role) ของบัญชีคุณเท่านั้น",
      "ทุกครั้งที่ AI เรียกทูล ระบบบันทึก audit ไว้โดยไม่เก็บข้อความหรือข้อมูลส่วนตัวในรายการ audit กลาง",
      "ฝั่ง Billing เริ่มมี AI credit summary / usage breakdown / ledger แยกร้าน เพื่อดูว่า AI ถูกใช้ไปกับอะไรบ้างในเดือนนี้",
    ],
  },
];

const HELP_ROWS_TH: HelpRow[] = [
  {
    title: "AI แนะนำคำตอบลงท้าย “ค่ะ” แต่ฉันเป็นผู้ชาย อยากได้ “ครับ”",
    answer:
      "ไปที่ โปรไฟล์ (/admin/profile) ตั้งช่อง “คำลงท้าย” เป็น ผู้ชาย — ครับ แล้วบันทึก · คำตอบแนะนำในหน้า Inbox (รวมปุ่ม ขอตรวจสอบ/ขอบคุณ) จะเปลี่ยนเป็น ครับ ให้อัตโนมัติ · ถ้าไม่ตั้ง ระบบใช้ ค่ะ เป็นค่าเริ่มต้น",
  },
  {
    title: "อยากให้ธีมหน้าจอจำตามบัญชี ไม่ใช่เฉพาะเครื่องนี้",
    answer:
      "ไปที่ โปรไฟล์ (/admin/profile) เลือก “ธีมหน้าจอ” เป็น ตามระบบเครื่อง / โหมดสว่าง / โหมดมืด แล้วบันทึก · ระบบจะจำกับบัญชีของคุณและ sync ไปเครื่องอื่นหลังล็อกอิน",
  },
  {
    title: "เพิ่มสินค้าแล้ว แต่ยังขายไม่ได้",
    answer: "เช็กว่าตั้งราคา, เปิด active, และมี stock ในไซซ์ที่ต้องขายแล้วหรือยัง",
  },
  {
    title: "ค้นหา order / payment / shipment ไม่เจอ",
    answer: "ใช้ช่องค้นหาบนหน้า Orders / Payment / Shipping ได้โดยตรง ระบบค้นหาแบบพิมพ์แล้วทำงานเอง",
  },
  {
    title: "ลูกค้าทักมา แต่ไม่รู้ต้องเปิดหน้าไหนต่อ",
    answer: "เริ่มจาก Inbox แล้วดู Customer 360 ก่อน ถ้ามีสิทธิ์ order.create ให้กด สร้างออเดอร์ ใน Quick Actions ได้ทันที จากนั้นค่อยตามงานต่อที่ Orders / Payment / Shipping",
  },
  {
    title: "แชร์สินค้าในแชทแล้วทำไมยังไม่ส่งทันที และลูกค้าเห็นรูปทั้งหมดที่ไหน",
    answer: "ระบบใส่ชื่อ ราคา ไซซ์ สต็อก และ public link ไว้ในข้อความร่างก่อน เพื่อให้ตรวจแล้วค่อยกด ส่ง · เลือกได้ทั้ง ข้อความ + ลิงก์ และ ข้อความ + รูป + ลิงก์ · เมื่อส่งแล้ว Inbox จะแสดงเป็นการ์ดสินค้าและซ่อน URL ยาวไว้หลังปุ่ม ดูสินค้า · ในแชทส่งเฉพาะรูป cover 1 รูป ส่วนลูกค้ากด public link เพื่อดู gallery ทั้งหมดได้โดยไม่ต้อง login · ปุ่ม Products หลังบ้านเป็นแท็บใหม่สำหรับพนักงานและไม่ถูกส่งให้ลูกค้า",
  },
  {
    title: "รูปกับไฟล์ใน Inbox ใช้อย่างไร",
    answer: "กด รูป หรือ ไฟล์ แล้วรอให้อัปโหลดเข้า draft จากนั้นตรวจ preview และกด ส่ง · แนบได้ครั้งละ 1 รายการตามรูปแบบข้อความปัจจุบัน ถ้าเลือกใหม่จะใช้รายการล่าสุด โดย loading ของปุ่มรูปและไฟล์แยกจากกัน",
  },
  {
    title: "ปุ่มจัดส่งกดไม่ได้และขึ้นว่ายังไม่มีที่อยู่",
    answer: "สำหรับ LINE / Facebook / Instagram / Web / TikTok Chat ให้เปิด Customers เพิ่มที่อยู่ชนิดจัดส่งให้ลูกค้าก่อน แล้วกลับมาจัดส่งใหม่ ส่วน Lazada / Shopee ใช้ที่อยู่จาก Seller Center และไม่ถูกบังคับให้เพิ่มซ้ำ",
  },
  {
    title: "ใบแจ้งหนี้จาก Customer 360 บันทึกเป็นเอกสารหรือยืนยันยอดแล้วหรือยัง",
    answer: "ยัง — ใบแจ้งหนี้นี้เป็น preview/print จากข้อมูลออเดอร์จริงและราคา ณ ตอนสั่ง ไม่ได้สร้าง record เอกสารใหม่ และไม่เปลี่ยนสถานะออเดอร์หรือการชำระเงิน",
  },
  {
    title: "อยากเชื่อม LINE / Facebook / Website",
    answer: "ไปที่ Settings แล้วทำตาม webhook/token guide ของแต่ละช่องทาง; LINE OA จะดึงชื่อ/รูปโปรไฟล์แบบ cache หลังข้อความเข้า ถ้ามีสิทธิ์และลูกค้ายังไม่บล็อก OA",
  },
  {
    title: "อยากทดสอบว่าแชทเข้า Inbox ทันทีไหม",
    answer: "เปิด Realtime Diagnostics: กด Emit เพื่อเช็กสัญญาณ realtime อย่างเดียว หรือกด Create Msg เพื่อสร้างข้อความทดสอบให้เห็นใน Inbox จริง",
  },
  {
    title: "ใช้ ผู้ช่วย AI สั่งคืนเงิน/ปรับสต็อก/ยกเลิกออร์เดอร์แล้วทำไมยังไม่เกิดผล",
    answer:
      "ปกติแล้วครับ — งานกลุ่มนี้ AI จะเตรียม “คำขอ” เป็นการ์ดในแชทเท่านั้น ต้องกดปุ่ม ยืนยัน บนการ์ดนั้นก่อนระบบถึงจะทำจริง (เหมือนกดยืนยันในหน้า Payment/Orders ปกติ) ถ้าไม่เห็นปุ่มยืนยันหรือกดแล้วไม่ผ่าน ให้เช็กว่าบัญชีมีสิทธิ์ (permission) ของงานนั้นหรือไม่",
  },
  {
    title: "อยากดูว่าใครแก้สินค้า/ออเดอร์ และเปลี่ยนอะไรบ้าง",
    answer: "เปิด Revision History แล้วเลือกชนิดข้อมูล จากนั้นค้นหา SKU หรือ record id ได้เลย เลือก 2 แถวแล้วกด Compare เพื่อดู field ที่เปลี่ยน",
  },
];


const LINK_STEPS_TH: LinkStep[] = [
  {
    title: "เริ่มตอบลูกค้า",
    description: <>เปิด {L.inbox} เพื่อดูแชทใหม่และ Customer 360</>,
  },
  {
    title: "เพิ่มสินค้า / แก้รูปสินค้า",
    description: (
      <>
        เปิด {L.products} แล้วเพิ่มสินค้า รูปหลายรูป ราคา และ stock · ถ้าจะปรับสต็อกให้กางแถวสินค้าเพื่อใช้ปุ่มลัดต่อไซซ์หรือปรับหลายรายการ
      </>
    ),
  },
  {
    title: "นำเข้าสินค้าจำนวนมากด้วย CSV/XLSX",
    description: (
      <>
        ใน {L.products} กด นำเข้า · ดาวน์โหลดเทมเพลตแล้วกรอกตามหัวคอลัมน์ (SKU / ชื่อสินค้า / ราคาขาย จำเป็น) · อัปโหลดแล้วระบบจะแสดงตัวอย่างว่าจะ สร้างใหม่ / อัปเดต / ข้าม ก่อน จากนั้นกด ยืนยัน Import · ไม่ต้องใส่รูปในไฟล์ (เพิ่มรูปทีหลังในหน้าแก้ไข) และจำกัดสูงสุด 500 แถวต่อครั้ง
      </>
    ),
  },
  {
    title: "รับของเข้าคลัง",
    description: <>เปิด {L.purchase} เพื่อสร้าง PO และรับของ หรือเลือก PO เดิมในแท็บ รับของ ของหน้า POS เพื่อสแกนเป็นร่างและยืนยันเข้าสต็อกสาขาของเครื่อง</>,
  },
  {
    title: "ตาม order / payment / shipment",
    description: (
      <>
        ใช้ {L.orders}, {L.payment}, {L.shipment} เป็น flow เดียวกัน
      </>
    ),
  },
  {
    title: "เชื่อมช่องทางจริง",
    description: (
      <>
        ไปที่ {L.settings} เพื่อวาง token และตั้ง webhook · ถ้าต้องทดสอบ Inbox realtime ให้เปิด{" "}
        {L.realtimeDiagnostics} แล้วกด Create Msg · LINE OA จริงจะ sync ชื่อ/รูปจาก LINE profile cache หลัง webhook เข้า
      </>
    ),
  },
  {
    title: "ตั้ง AI Key ของร้านเอง (BYOK)",
    description: (
      <>
        ใน {L.settings} เลือก Anthropic หรือ DeepSeek แล้วใส่ API Key/Model ของร้านได้ เมื่อเปลี่ยน provider ต้องกรอก key ใหม่
        เสมอ; Slip OCR ยังใช้ provider กลางของแพลตฟอร์ม และการยืนยันเงินยังต้องให้คนกด Confirm
      </>
    ),
  },
  {
    title: "ตั้งชื่อร้าน + กรอกข้อมูลร้าน (ให้ AI ตอบลูกค้าได้)",
    description: (
      <>
        ในการ์ด <b>ข้อมูลร้าน</b> ที่ {L.settings} แก้ <b>ชื่อร้าน</b> ได้เอง
        (Administrator · slug เป็นตัวระบุภายใน ระบบกำหนดให้ แก้ไม่ได้) และกรอก <b>ประเภทร้าน</b>,
        เวลาเปิด-ปิด, ที่อยู่, อีเมล/เว็บไซต์, บัญชีรับเงิน (ธนาคาร/พร้อมเพย์), ค่าส่ง
        โดยถ้ายังไม่กรอกบัญชีรับเงิน AI จะไม่แนะนำช่องทางชำระเงินให้ลูกค้า,
        ประเทศ/สกุลเงิน — AI จะใช้ตอบลูกค้า เช่น “ร้านชื่ออะไร/เปิดกี่โมง” “โอนเข้าบัญชีไหน” “ค่าส่งเท่าไหร่” และจะยกตัวอย่าง/ถามต่อให้เข้ากับประเภทร้านจากข้อมูลจริง ไม่เดา
        · หน้า <b>/shop-signup</b> มีตัวเลือก <b>archetype ร้าน</b> แบบ optional เพื่อเตรียม
        หมวดสินค้า/ข้อมูลตัวอย่าง/คำแนะนำเริ่มต้นให้เหมาะกับร้าน และใช้ชู flow
        <b> restock subscriptions</b> สำหรับร้านที่เสียยอดขายจากของหมดบ่อย
      </>
    ),
  },
  {
    title: "ดูภาพรวมร้าน",
    description: (
      <>
        เปิด {L.dashboard} หรือ {L.reports}
        เพื่อดูยอดขาย สต็อก งานค้าง และการ์ด <b>AI health</b> · ถ้าต้องการไฟล์จริงให้ใช้การ์ด
        <b> AI Report Generator</b> ในหน้า Reports เพื่อสร้าง Excel / CSV / PDF ของยอดขาย สต็อก
        หรือกำไรขั้นต้น (ค่าประมาณ) แล้วดาวน์โหลดภายหลังจากประวัติรายงานเดิมได้ · ถ้าต้องการตรวจคำตอบรายเคสให้เปิด{" "}
        {L.aiQuality} เพื่อดู success/handoff/unresolved rate,
        failure cases และบทสนทนาที่สุ่มตรวจ โดยระบบปิดบังข้อมูลส่วนบุคคลในหน้าตรวจให้อัตโนมัติ
      </>
    ),
  },
  {
    title: "ถาม/สั่งงานด้วย AI",
    description: (
      <>
        เปิด <Link href={ROUTES.assistant}>ผู้ช่วย AI</Link> เพื่อถามรายงาน/สต็อก/ออร์เดอร์ด้วยภาษาพูด
        หรือพิมพ์ขอ export เช่น "export sales to Excel" / "สร้าง PDF รายงานกำไร" ได้เลย
        — งานที่กระทบเงิน/สต็อกจะต้องกดยืนยันเองก่อนเสมอ
      </>
    ),
  },
];

const TH: ManualContent = {
  heroTag: "คู่มือใหม่แบบใช้งานจริง",
  heroTitle: "📘 คู่มือการใช้งาน BMS",
  heroLead:
    "ปรับจากเอกสารยาวแบบเดิม ให้เป็นคู่มือที่เริ่มงานได้เร็ว หาเมนูง่าย และสอนทีมใหม่ได้ง่ายกว่าเดิม",
  heroAlertMessage: "ลูกค้าทัก → Inbox → Orders → Payment → Shipping → Dashboard",
  heroAlertDesc: "อ่านคู่มือตาม flow งานจริง ไม่ต้องไล่อ่านทุกหัวข้อจากบนลงล่างก่อน",
  heroCtaQuickstart: "เริ่มงานใน 3 นาที",
  heroCtaWorkflow: "ดู flow ทั้งระบบ",
  heroCtaMenus: "ดูคู่มือตามเมนู",
  heroTags: [
    "Inbox",
    "Products",
    "Orders",
    "Purchase",
    "Payment",
    "Shipping",
    "Customers",
    "Reports",
    "ผู้ช่วย AI",
  ],
  anchors: {
    hero: "เริ่มต้นเร็ว",
    quickstart: "Quick start ตามบทบาท",
    workflow: "Flow งานทั้งระบบ",
    archetypes: "ตัวอย่างตามประเภทร้าน",
    coupons: "คู่มือคูปอง",
    menus: "คู่มือตามเมนู",
    faq: "คำถามที่เจอบ่อย",
    links: "ลิงก์ไปหน้าที่ใช้บ่อย",
  },
  quickstartTitle: "⚡ Quick start ตามบทบาท",
  quickstartSubtitle: "เลือกจากสิ่งที่คุณกำลังทำอยู่ เพื่อให้คู่มือพาไปหน้าที่ถูกต้องเร็วที่สุด",
  personaButtons: {
    owner: "เจ้าของร้าน",
    staff: "พนักงานหน้าร้าน",
    ops: "แอดมินระบบ",
  },
  personaCards: {
    owner: {
    title: "เจ้าของร้านควรเริ่มจากอะไร",
    subtitle: "เหมาะกับวันแรกที่เริ่มเปิดระบบหรือเซ็ตร้านใหม่",
    items: [
      "เพิ่มสินค้า + รูปสินค้า + ราคา + stock ต่อไซซ์",
      "ลองจำลองออเดอร์ผ่าน Playground ให้เห็น flow จริง",
      "เชื่อมช่องทางขายจริงที่หน้า Settings",
      "เปิด Dashboard ดูภาพรวมร้าน แจ้งเตือน และกางโค้ดส่วนลดเพื่อดูว่าใครใช้กับออเดอร์ไหน",
    ],
    ctaLabel: "เริ่มที่ Products",
    },
    staff: {
    title: "พนักงานหน้าร้านใช้อะไรบ่อยสุด",
    subtitle: "เหมาะกับคนตอบแชท รับออเดอร์ และตามงานประจำวัน",
    items: [
      "เปิด Inbox ดูแชทใหม่และลูกค้าที่ต้องตอบก่อน",
      "ใช้ Customer 360 เพื่อดูประวัติลูกค้าแบบไม่สลับหน้า",
      "เปิดออเดอร์ล่าสุดแบบ preview ในหน้า Inbox ก่อนได้ และถ้าต้องทำงานลึกค่อยเปิดหน้า Orders เต็มจอเป็นแท็บใหม่",
      "แชร์สินค้าและคูปองจาก composer โดยตรวจข้อความร่างก่อนกดส่ง",
      "ถ้าต้องส่งไฟล์รายงานให้หัวหน้าหรือดาวน์โหลดเก็บ ใช้ AI Report Generator ในหน้า Reports เพื่อสร้าง Excel/CSV/PDF",
      "งาน POS หน้าร้านรองรับ recent sales, ค้นเลขบิล, multi-payment, คืนทั้งบิล/คืนบางรายการ, settlement คืนเงินแบบไม่ใช่เงินสด และทำบิลเปลี่ยนสินค้าโดยดึงรายการเดิมขึ้นมาเป็นบิลใหม่",
      "เปิด แจ้งลูกค้าเมื่อของเข้า เพื่อตามรายการที่ลูกค้ายินยอมไว้ ตรวจข้อความ และ Resend เมื่อส่งไม่สำเร็จ",
      "สร้างออเดอร์และออกใบแจ้งหนี้จาก Quick Actions ตามสิทธิ์ของบัญชี",
      "เช็ก Orders / Payment / Shipping ต่อเนื่องเป็นชุดเดียว",
      "ใช้ช่องค้นหาบนแต่ละหน้าเพื่อหา order / payment / tracking เร็วขึ้น",
    ],
    ctaLabel: "ไปที่ Inbox",
    },
    ops: {
    title: "แอดมินระบบควรดูอะไรบ้าง",
    subtitle: "เหมาะกับคนดูสิทธิ์ผู้ใช้ เชื่อมช่องทาง และดูแล tenant",
    items: [
      "ตั้งค่า Roles / Permissions ให้ตรงหน้าที่",
      "เช็ก Channel Health และ webhook status",
      "ดู Billing, package, usage, AI credit summary / ledger และ tenant setting",
      "ใช้คู่มือ API / webhook เมื่อต้อง debug หรือเชื่อมระบบเพิ่ม",
    ],
    ctaLabel: "ไปที่ Settings",
    },
  },
  workflowTitle: "🧭 Flow งานทั้งระบบ",
  workflowSubtitle: "ถ้าคุณยังไม่แน่ใจว่าควรทำอะไรก่อน-หลัง ให้กดดูทีละ step จาก flow นี้",
  flowButtons: {
    products: "เพิ่มสินค้า",
    orders: "รับออเดอร์",
    payment: "ยืนยันเงิน",
    shipping: "จัดส่งและปิดงาน",
  },
  flowCards: {
    products: {
    title: "1) เตรียมสินค้าให้พร้อมขาย",
    path: "Products → เพิ่มสินค้า → รูปหลายรูป → ราคา → stock ต่อไซซ์",
    summary: "เริ่มจากการเพิ่มสินค้าให้ครบก่อน โดยรูปแรกเป็น cover และรูปถัดไปเป็น gallery ของสินค้า",
    checks: [
      "กรอก SKU / Barcode / ราคา ให้ครบ",
      "อัปโหลดรูปสินค้าได้หลายรูป",
      "มีสินค้าเยอะ ใช้ปุ่ม นำเข้า เพื่ออัปโหลด CSV/XLSX — ดาวน์โหลดเทมเพลตก่อน กรอกตามหัวคอลัมน์ แล้วดูตัวอย่าง (สร้างใหม่/อัปเดต/ข้าม) ก่อนกดยืนยัน (ไฟล์ไม่ต้องใส่รูป, สูงสุด 500 แถว/ครั้ง)",
      "กางแถวสินค้าเพื่อดู stock ต่อไซซ์ แล้วใช้ปุ่มปรับสต็อกเร็ว / ระบุเอง / ปรับหลายรายการ",
      "ถ้ามี AI synonym discovery ให้ผูกคำค้นที่ลูกค้าหาไม่พบกับ SKU แล้วอนุมัติ ระบบจึงเพิ่มเป็น keyword ของสินค้า",
      "ตั้ง stock และ reorder point ต่อไซซ์",
      "ถ้ายังไม่มีของเข้า ใช้ Purchase รับเข้าคลังภายหลังได้",
    ],
    tags: ["Products", "นำเข้า CSV/XLSX", "Gallery", "Stock", "Category", "AI Synonym"],
  },
  orders: {
    title: "2) รับแชทและสร้างออเดอร์",
    path: "Inbox → Customer 360 → Quick Actions → Orders",
    summary: "เมื่อมีแชทเข้า ให้ดูข้อมูลลูกค้า สร้างออเดอร์ หรือพิมพ์ใบแจ้งหนี้จาก Customer 360 แล้วตามสถานะต่อที่ Orders",
    checks: [
      "ดูแชทใหม่จาก Inbox ก่อน",
      "ใช้ Customer 360 ดูประวัติและข้อมูลลูกค้า",
      "กด สินค้า ที่แถบพิมพ์ แล้วเลือก ข้อความ + ลิงก์ หรือ ข้อความ + รูป + ลิงก์ — ระบบจะใส่ไว้ในข้อความร่างก่อน ยังไม่ส่งทันที",
      "กด คูปอง เพื่อเลือกโค้ดที่เปิดใช้งาน ระบบจะใส่ข้อความคูปองใน draft และเมื่อกดส่งจริงจะเพิ่มคูปองเข้า wallet ลูกค้าอัตโนมัติ พร้อมแนบลิงก์กระเป๋าคูปอง",
      "ถ้าลูกค้าถามคูปองหรือพิมพ์โค้ดที่มีจริงใน wallet ระบบจะตรวจสิทธิ์ด้วย backend ก่อน AI ตอบเสมอ แต่จะไม่ mark เป็นใช้แล้วจากข้อความอิสระ",
      "กด เปิดออเดอร์ เพื่อดูแบบเร็วใน Inbox ก่อน และใช้ปุ่ม เปิดหน้า Orders เต็มจอ เมื่อต้องทำงานต่อในแท็บใหม่",
      "กด สร้างออเดอร์ เลือกสินค้า/ไซซ์/จำนวน — ระบบใช้ราคาปัจจุบันและจอง stock ทันที",
      "ถ้าแชทมีคูปองล่าสุด ฟอร์มสร้างออเดอร์อาจใส่โค้ดให้อัตโนมัติเป็น suggestion แล้ว backend ตรวจเงื่อนไขจริงอีกครั้ง",
      "ถ้าออเดอร์ใช้คูปอง หน้า Inbox/Customer 360/Orders จะแสดงยอดสินค้า → ส่วนลดพร้อมรหัสคูปอง → ยอดสุทธิ",
      "หลังสร้างออเดอร์จากแชท ระบบจะใช้ชื่อ เบอร์ และที่อยู่จัดส่งเดิมใน CRM อัตโนมัติ ถ้าข้อมูลครบ; ถ้าขาดจะถามลูกค้าเฉพาะรายการแรกที่ขาด ไม่ให้กรอกของเดิมซ้ำ",
      "เมื่อ AI สร้างออเดอร์สำเร็จ ระบบจะส่งลิงก์ Checkout ของออเดอร์จริงให้ลูกค้าเสมอ เพื่อเช็กข้อมูลเดิม กรอกเฉพาะข้อมูลที่ขาด และแนบสลิป",
      "Lazada / Shopee ใช้ข้อมูลจัดส่งและการชำระเงินจาก Seller Center ระบบจึงไม่ถามข้อมูลเหล่านี้ซ้ำในแชท",
      "ถ้าลูกค้าไม่จ่ายหรือยกเลิกก่อนขายจริง ระบบคืน quota คูปองเมื่อออเดอร์ถูก cancel/auto-release; ถ้า reject สลิปอย่างเดียว order ยังเปิดให้ส่งใหม่",
      "กด ออกใบแจ้งหนี้ เพื่อเลือกออเดอร์เดิมและพิมพ์เอกสาร (เอกสารไม่เปลี่ยนสถานะการชำระเงิน)",
      "เปิด Orders เพื่อตามสถานะ PENDING / PAID / PACKING",
      "ค้นหา order / customer / channel ได้จากช่องค้นหาด้านบน",
    ],
    tags: ["Inbox", "Orders", "Customer 360", "Search"],
  },
  payment: {
    title: "3) ยืนยันการชำระเงิน",
    path: "Payment → ตรวจสลิป → Confirm / Reject / Refund",
    summary: "หน้า Payment คือจุดที่ตามสถานะเงินทั้งหมด โดย AI ช่วยตรวจสลิปได้ แต่คนยังต้องกดยืนยันเอง",
    checks: [
      "ค้นหา payment id / order id / slip ref ได้",
      "AI จะแสดงเฉพาะบัญชีธนาคาร/พร้อมเพย์ที่กรอกใช้งานได้จริงใน Settings; ถ้ายังไม่ตั้งค่า ระบบจะไม่เสนอช่องทางชำระเงินแทนร้าน",
      "ลูกค้าที่ส่งสลิปจาก Checkout จะได้สถานะ รอตรวจสอบ เท่านั้น; การส่งซ้ำระหว่าง PENDING/CONFIRMED จะไม่สร้าง payment ซ้ำ",
      "ตรวจสลิปด้วย AI เป็นคำแนะนำเท่านั้น; ถ้า OCR ตัวหลักล้ม ระบบอาจลองตัวสำรองก่อนส่งให้คนตรวจ",
      "Confirm แล้วออเดอร์จะเป็น PAID",
      "Refund ใช้เมื่อรายการอยู่ในสถานะที่คืนเงินได้เท่านั้น",
      "ตั้งแต่ 16 สิงหาคม 2026 หน้า POS แยกการรับคืนสินค้าออกจากการคืนเงินจริง: เงินสดเสร็จทันที ส่วนบัตร/QR/โอน/วอลเล็ทต้องให้ผู้มีสิทธิ์บันทึกเลขอ้างอิง settlement ก่อนปิดกะ พร้อมรองรับ full return, partial return และ exchange",
    ],
    tags: ["Payment", "Slip", "Confirm", "Refund"],
  },
  shipping: {
    title: "4) จัดส่งและปิดงาน",
    path: "Shipping → Tracking → DELIVERED → Dashboard",
    summary: "เมื่อแพ็คของแล้ว ให้เช็กที่อยู่ สร้าง shipment ใส่เลขพัสดุ และเดินสถานะจนปิดงานครบ",
    checks: [
      "LINE / Facebook / Instagram / Web / TikTok Chat ต้องมีที่อยู่จัดส่งใน Customers ก่อนส่ง",
      "Lazada / Shopee ใช้ที่อยู่จาก Seller Center จึงไม่ต้องเพิ่มซ้ำในระบบ",
      "สร้าง shipment จาก order ที่พร้อมส่ง",
      "บันทึก carrier และ tracking number",
      "Flash / Kerry: ถ้ายังไม่มีเลขพัสดุ กด Book carrier เพื่อให้ระบบจองพัสดุให้ (กดซ้ำได้ถ้าล้มเหลว ไม่สร้างพัสดุซ้ำ)",
      "Flash / Kerry: ถ้ามีเลขพัสดุแล้ว กด Sync carrier เพื่อดึงสถานะและไทม์ไลน์ล่าสุดจากขนส่ง",
      "คอลัมน์ Carrier sync บอกว่าซิงก์ล่าสุดเมื่อไร หรือการจองพัสดุติดปัญหาอะไร (เช่น ยังไม่ได้ตั้งค่า API)",
      "ค้นหา shipment / order / tracking ได้จากช่องค้นหา",
      "DELIVERED จะช่วยปิด flow งานให้ครบ",
    ],
    tags: ["Shipping", "Tracking", "Carrier", "Dashboard"],
    },
  },
  archetypesTitle: "🛍 ตัวอย่างถาม-ตอบตาม businessArchetype",
  archetypesSubtitle:
    "ใช้ส่วนนี้ตอนอธิบายทีม, demo ระบบ, หรือเช็กว่า AI ของร้านควรตอบและพาลูกค้าไปสู่ flow หลังบ้านแบบไหน",
  archetypeAlertMessage: "หลักคิดสำคัญ",
  archetypeAlertDesc:
    "BMS ไม่ได้จบที่ตอบแชท แต่ต้องพาลูกค้าไปสู่การทำงานจริงของร้าน: รู้จักลูกค้า -> หา/แนะนำสินค้า -> เช็กสต็อก -> สร้างออเดอร์ -> รับชำระ -> ส่งของ -> ติดตามสถานะ และเมื่อของหมดควรเปลี่ยนบทสนทนาเป็น restock queue เพื่อเก็บโอกาสขายกลับมา",
  archetypeCustomerAskLabel: "ตัวอย่างคำถามลูกค้า",
  archetypeAiReplyLabel: "แนวตอบของ AI",
  archetypeBackendFlowLabel: "flow หลังบ้านที่ควรเกิด",
  archetypeWhyLabel: "ทำไม archetype นี้สำคัญกับ BMS:",
  archetypeExamples: ARCHETYPE_EXAMPLES_TH,
  couponsTitle: "🎟 คู่มือคูปองแบบละเอียด",
  couponsSubtitle: "อธิบายว่าระบบรู้อะไรเกี่ยวกับคูปองของลูกค้า, ใช้อย่างไร, และเงื่อนไขไหนผ่านหรือไม่ผ่าน",
  couponAlertMessage: "สิ่งที่ระบบเก็บอยู่ตอนนี้",
  couponAlertDesc:
    "ระบบเก็บ master ของคูปองไว้ที่ bms_coupons, เก็บว่าลูกค้าคนนี้เคยได้รับคูปองอะไรไว้ที่ bms_customer_coupon_wallet, และเก็บการใช้งานจริงไว้ที่ออเดอร์ (bms_orders.coupon_id / coupon_code / discount_amount) จากนั้นคำนวณสดว่าลูกค้าคนนี้ยังใช้โค้ดใดได้บ้างจากเวลา, quota รวม, per-customer limit, ยอดขั้นต่ำ, และประวัติออเดอร์ที่ไม่ถูกยกเลิก",
  couponStepsTitle: "ขั้นตอนใช้งานจริง",
  couponSteps: [
    {
      title: "1. สร้างคูปองที่หน้า Coupons",
      description:
        "กำหนด code, ประเภทส่วนลด (เปอร์เซ็นต์/บาท), ยอดขั้นต่ำ, จำนวนครั้งรวม, จำนวนครั้งต่อลูกค้า, วันเริ่ม, วันหมดอายุ, และสถานะเปิดใช้งาน",
    },
    {
      title: "2. ส่งคูปองให้ลูกค้าจาก Inbox",
      description:
        "กดปุ่ม คูปอง ที่ composer แล้วเลือกโค้ด ระบบจะแทรกข้อความ fallback ให้ เช่น โค้ด, ส่วนลด, ขั้นต่ำ, วันหมดอายุ, สิทธิ์ที่เหลือ เมื่อกดส่งจริง ระบบจะบันทึกสิทธิ์นี้ไว้ใน customer coupon wallet และแนบลิงก์กระเป๋าคูปองให้ลูกค้าเปิดดูทั้งหมด",
    },
    {
      title: "3. ลูกค้าถามว่ามีคูปองอะไร หรือพิมพ์โค้ดมา",
      description:
        "AI เรียก list_customer_coupons ก่อนถ้าลูกค้าถามคูปองของตัวเองหรือถามว่าอะไรใกล้หมดอายุ และตอบสรุปสั้นพร้อมลิงก์กระเป๋าคูปอง ห้ามเดาเองว่าคูปองใช้ได้ ถ้าลูกค้าพิมพ์โค้ด ระบบจะตอบสถานะ/เงื่อนไขเท่านั้น ไม่ใช้คูปองจากข้อความอิสระ",
    },
    {
      title: "3.5 ทีมงานเปิดดูคูปองของลูกค้าได้ทันที",
      description:
        "ใน Inbox > Customer 360 และหน้า Customers (CRM) ตอนกางแถวลูกค้า จะมี section 'คูปองของลูกค้า' แสดง code, สถานะ (ASSIGNED / RESERVED / REDEEMED / EXPIRED / REVOKED), วันหมดอายุ, เหตุผลที่ยังใช้ไม่ได้, และถ้าผูกกับออเดอร์อยู่จะเห็น order id นั้นได้เลย",
    },
    {
      title: "4. ตอนสร้างออเดอร์ ระบบค่อยใช้คูปองจริง",
      description:
        "create_order จะส่ง couponCode เข้า createOrder() และ backend ตรวจอีกครั้งใน transaction เดียวกับการจอง stock ถ้าไม่ผ่านจะคืนผล COUPON_INVALID และไม่สร้างออเดอร์ครึ่ง ๆ กลาง ๆ ถ้าผ่าน wallet จะขยับเป็น RESERVED พร้อมผูก order ไว้",
    },
    {
      title: "5. ถ้าออเดอร์ไม่จบการขาย ระบบคืน quota เฉพาะบางกรณี",
      description:
        "confirm payment หรือ pay order จะขยับ wallet เป็น REDEEMED; แต่ถ้า cancel order หรือ auto-release unpaid order ระบบจะคืน quota และย้อน wallet จาก RESERVED/REDEEMED (ของออเดอร์นั้น) กลับไปเป็น ASSIGNED ส่วน reject สลิปอย่างเดียวจะยังไม่คืน เพราะ order ยังเปิดให้ลูกค้าส่งสลิปใหม่ได้",
    },
  ],
  couponWhereToSeeTitle: "ดูคูปองของลูกค้าได้จากที่ไหน",
  couponWhereToSee: COUPON_WHERE_TO_SEE_TH,
  couponWalletStatesTitle: "ความหมายสถานะใน wallet",
  couponWalletMeanings: COUPON_WALLET_MEANINGS_TH,
  couponConditionsTitle: "ตัวอย่างเงื่อนไขที่ระบบใช้ตรวจ",
  couponConditionLabel: "เงื่อนไข:",
  couponConditions: COUPON_CONDITIONS_TH,
  couponGapsTitle: "สิ่งที่ระบบยังไม่มีหรือยังไม่ครบ",
  couponGaps: COUPON_GAPS_TH,
  menusTitle: "🧩 คู่มือตามเมนู",
  menusSubtitle: "แยกเป็นการ์ดสั้น ๆ เพื่อให้คนสแกนแล้วรู้ทันทีว่าเมนูนี้เอาไว้ทำอะไร",
  menuCards: MENU_CARDS_TH,
  menuOpenPagePrefix: "เปิดหน้า",
  menuGroupingAlertMessage: "คำแนะนำการจัดกลุ่ม",
  menuGroupingAlertDesc:
    "Orders / Payment / Shipping ควรอยู่ใกล้กันในคู่มือ เพราะผู้ใช้ทำงานต่อเนื่องเป็น flow เดียวกัน ส่วน Products ควรอยู่คู่กับ Purchase เพราะเกี่ยวกับการมีของพร้อมขาย",
  faqTitle: "❓ คำถามที่เจอบ่อย",
  faqSubtitle: "วางแบบถาม-ตอบสั้น ๆ เพื่อช่วยลดเวลาที่ต้องไล่อ่านเอกสารยาว",
  helpRows: HELP_ROWS_TH,
  linksTitle: "🔗 ลิงก์ไปหน้าที่ใช้บ่อย",
  linksSubtitle: "ให้ผู้ใช้ข้ามไปทำงานจริงได้ทันที ไม่ต้องอ่านจบทั้งหน้า",
  linkSteps: LINK_STEPS_TH,
  linksAlertMessage: "แนวคิดของคู่มือใหม่นี้",
  linksAlertDesc:
    "เปิดมาแล้วควรตอบได้ทันทีว่า “ฉันควรเริ่มจากตรงไหน”, “เมนูนี้ใช้ทำอะไร”, และ “ถ้าติดปัญหาควรดูตรงไหนต่อ”",
  sidebarTocTitle: "สารบัญ",
  sidebarShortcutsTitle: "ทางลัดแนะนำ",
  sidebarShortcuts: [
    "ไปที่ Inbox",
    "ไปที่ Products",
    "ไปที่ Orders",
    "ไปที่ ผู้ช่วย AI",
    "ไปที่ Settings",
    "ทดสอบ Realtime Inbox",
  ],
  sidebarNextTitle: "คู่มือที่ควรมีต่อ",
  sidebarNextItems: [
    "search คู่มือจริงด้านบน",
    "FAQ แยกตามเมนู",
    "วิดีโอ/ภาพสั้นอธิบาย flow",
    "ปุ่มเปิดหน้าจริงจากทุก section",
    "คู่มือย่อสำหรับ onboarding พนักงานใหม่ พร้อมบันทึกขั้นที่ทำแล้ว/ข้ามไว้",
  ],
  noteTitle: "หมายเหตุ",
  noteBody:
    "หน้านี้ถูกปรับให้เป็น “คู่มือใช้งานง่าย” ก่อน โดยเน้นการเริ่มงานไวและการมอง flow งานจริง ถ้าคุณชอบทิศทางนี้ รอบถัดไปเราค่อยแตกลงรายละเอียดรายเมนูและเพิ่ม FAQ / search คู่มือจริงต่อได้",
  noteTags: [
    "เหมาะกับร้านใหม่",
    "เหมาะกับ onboarding ทีม",
    "เหมาะกับงานปฏิบัติการรายวัน",
    "ต่อยอดเป็นคู่มือ API ได้",
  ],
};

const COUPON_CONDITIONS_EN: CouponCondition[] = [
  {
    condition:
      "10% off, active, not expired, quota remaining, customer still under the per-customer limit, order meets the minimum spend",
    result:
      "Valid: the coupon is added to the customer's coupon wallet with a link they can open. When the order is created, the backend applies the real discount in the same transaction that reserves stock.",
  },
  {
    condition: "50 THB off, no minimum spend, already issued to the customer's wallet",
    result:
      "Valid: when the customer asks what coupons they have, the system reads their wallet and offers this code ahead of general coupons.",
  },
  {
    condition: "100 THB off, start date set to tomorrow",
    result:
      "Rejected before the start date: the AI and the order form must say the code is not usable yet, and must not create a half-finished order.",
  },
  {
    condition: "25% off, minimum spend 1,000 THB, current cart 850 THB",
    result:
      "Rejected: the system explains the order has not reached the minimum spend, and the coupon is not marked as redeemed.",
  },
  {
    condition:
      "per-customer limit = 1, and the customer already used it on an order that was not cancelled",
    result:
      "Rejected: the system explains this customer has used their full allowance, even though the shop-wide quota still has room.",
  },
  {
    condition: "max redemptions reached, or remainingRedemptions = 0",
    result:
      "Rejected: the system replies that the code has been fully redeemed, and offers another usable coupon if one exists.",
  },
  {
    condition: "the customer received the coupon in their wallet and created an order, but has not paid yet",
    result:
      "The state becomes RESERVED and is linked to the order id: if the order is cancelled or the payment window expires, the system returns the quota and rolls the coupon back to ASSIGNED.",
  },
  {
    condition: "the customer sent the wrong slip and the payment was rejected, but the order is still open",
    result:
      "The coupon is not released yet: the customer can still send a new slip. It is only released when the order is cancelled or auto-released.",
  },
  {
    condition: "the coupon expired after it was issued to the wallet",
    result:
      "The state becomes EXPIRED the next time the system reads the wallet: the customer can still see it in their history but can no longer use it.",
  },
  {
    condition: "the coupon has already been used or linked to an order",
    result:
      "It cannot be deleted or renamed: deactivate it instead, so the history and the amounts on past orders stay traceable.",
  },
];

const COUPON_WHERE_TO_SEE_EN: string[] = [
  "Inbox > Customer 360: use it while chatting — it shows the customer's coupons, current cart, latest orders, and a button to issue a coupon to this customer.",
  "Customers (CRM): expand a customer row to see their coupon wallet, status, expiry date, why a coupon is unusable, and the related order id.",
  "Coupons: manage master coupons, and click the 'used' count to see which order and which customer each redemption belongs to.",
  "Dashboard: see this month's overview — how much discount was given out, how many times coupons were used, and the top coupon codes.",
];

const COUPON_WALLET_MEANINGS_EN: string[] = [
  "The shop has issued this coupon to the customer's wallet; the customer can open the wallet link and see the details right away.",
  "The coupon is linked to an order that has been created and is still awaiting payment or processing.",
  "The order reached a genuinely paid state, so the coupon counts as successfully redeemed.",
  "The coupon has expired and can no longer be used, but it stays in the wallet history.",
  "The shop revoked this specific customer's entitlement; it cannot be used even though the master coupon is still active.",
];

const COUPON_GAPS_EN: string[] = [
  "There is now a per-customer, per-coupon lifecycle (assigned / reserved / redeemed / expired / revoked), but there is still no consolidated page for the marketing team to pull customer segments by state for bulk campaigns.",
  "There is still no dedicated page or query for “all of this customer's coupons that are about to expire” for campaign work, even though the AI can already read the wallet.",
  "Coupons restricted to a specific product, category, or channel — and stacking several coupons on one order — are not supported yet.",
  "If a customer has no identity/customer_id in CRM yet, the system can only check the overall quota and the validity window; full per-customer history cannot be counted until the customer's identity is linked.",
];

const ARCHETYPE_EXAMPLES_EN: ArchetypeExample[] = [
  {
    label: "Mini Mart / Grocery",
    focus: "Customers reorder quickly, ask what is ready to ship, look for deals, and hit out-of-stock items often",
    customerAsk:
      "Do you have the tom yum instant noodles in a 6-pack? If so I'll take 3 packs, plus two 1.25L bottles of Coke.",
    aiReply:
      "Of course. Let me check stock for the items that are ready to sell first. If everything is available I'll total it up and create the order right away. If something is out of stock, the system should offer a close alternative or invite the customer to be notified when it is back in.",
    backendFlow: "search/browse products -> check stock -> create order -> take payment -> arrange delivery or pickup",
    whyItFits:
      "Suits a fast, low-deliberation ordering flow, and uses the restock queue to recover sales lost to temporary stock-outs.",
  },
  {
    label: "Fashion & Apparel",
    focus: "Customers ask about sizes, colours, styling, and whether you have anything similar",
    customerAsk: "Do you have this black dress in size M? If not, could you suggest a similar cut?",
    aiReply:
      "Of course. Let me check size M for this style first. If it is sold out I'll suggest similar cuts that are still in stock, and if the customer would rather wait for the original, the system should ask for consent before signing them up for a back-in-stock alert.",
    backendFlow: "check stock per variant -> find alternatives -> restock opt-in -> create the order once a choice is made",
    whyItFits:
      "Fashion conversations are about options and substitutes, so this turns a stock-out into a recoverable sale.",
  },
  {
    label: "Home & Kitchen",
    focus: "Customers compare sizes and materials, and usually buy sets rather than single pieces",
    customerAsk: "Are the 10-inch ceramic plates microwave safe? And is there a set price if I buy 6?",
    aiReply:
      "Of course. Let me look up the microwave-safe options and compare them for you first, then recommend the bundle or quantity that gives the best value. If the model you want is sold out, the system can add you to the back-in-stock queue.",
    backendFlow: "search by attribute -> suggest bundles/alternatives -> check stock -> create order or restock queue",
    whyItFits: "These shops live on product comparison and on raising basket size through sets.",
  },
  {
    label: "Beauty & Personal Care",
    focus: "Consultative advice — skin type, routines, and products used together",
    customerAsk: "My skin is sensitive and breaks out easily. Do you have a gentle cleanser-and-moisturiser set?",
    aiReply:
      "Of course. Let me first shortlist products suited to sensitive skin from what the shop actually stocks, then suggest a short routine and check whether the full set is available or whether any item should have a restock notification enabled.",
    backendFlow: "recommend/browse products -> cross-sell into a routine -> check stock -> create order or open a restock alert",
    whyItFits:
      "AI is good at selling a recommended set here, and restock keeps regular repeat customers coming back.",
  },
  {
    label: "Food & Beverage",
    focus:
      "Customers expect fast replies, much like ordering at the counter, while the system still follows the normal product-and-order flow",
    customerAsk: "Do you have the medium Hawaiian pizza today? Can I add extra cheese?",
    aiReply:
      "Of course. Let me check the menu items currently on sale first. If it is available I'll summarise the order and the total right away — but every answer has to come from products that really exist in the catalog, and we should not promise specialised POS features the system does not support.",
    backendFlow: "browse active menu items -> check stock/availability -> create order -> take payment -> deliver or pickup",
    whyItFits:
      "Great for demoing fast in-chat ordering, but the manual must stress that this is chat commerce, not a full restaurant POS.",
  },
  {
    label: "Gadgets & Accessories",
    focus: "Customers ask about compatibility, device models, and related add-ons",
    customerAsk:
      "Do you have an iPhone 15 Pro case? And can you recommend a screen protector and a charging cable that work with it?",
    aiReply:
      "Of course. Let me check cases that fit that exact model first, then suggest accessories that genuinely work with it. If the model you want is out of stock, the system should offer an alternative or invite the customer to be notified when it returns, rather than letting the conversation end there.",
    backendFlow: "search by compatibility -> cross-sell accessories -> check stock -> restock capture or create order",
    whyItFits: "This category suits an AI that both answers model questions and lifts the basket with accessories.",
  },
  {
    label: "B2B / Wholesale",
    focus: "Customers ask about large quantities, wholesale pricing, paperwork, and the next repeat order",
    customerAsk: "If I order 1,000 plastic cups, is there a wholesale price? Could you send a quotation first?",
    aiReply:
      "Of course. Let me check availability and confirm the quantity first. From there the system should lead into a quotation or invoice and hand the follow-up to the team in the back office, rather than closing with a short product blurb.",
    backendFlow: "check catalog/stock -> confirm quantity -> quotation/invoice -> order -> payment -> shipping",
    whyItFits:
      "Fits use cases where the conversation has to continue into real documents and back-office sales processes.",
  },
  {
    label: "Gifts & Seasonal",
    focus: "Customers buy for an occasion — new year, birthdays — and want ready-made sets with promotions",
    customerAsk: "I'd like a gift set under 1,500 THB. Can you send it to a friend for their birthday?",
    aiReply:
      "Of course. Let me shortlist products that fit the budget and the occasion first, then recommend sets that are genuinely available, along with stock, shipping cost, and any usable coupons. If a popular set is sold out, the system should invite the customer to join the back-in-stock queue.",
    backendFlow: "discover by budget/occasion -> bundle + coupon -> check stock -> order/payment/shipping or restock",
    whyItFits:
      "Good for showing off contextual product curation, with coupons and seasonality helping to close the sale.",
  },
  {
    label: "Other",
    focus: "Use this when the shop does not clearly fit one category yet, or mixes several models",
    customerAsk: "What does this shop sell? And how do I order?",
    aiReply:
      "Of course. Let me recommend products that are ready to sell based on the shop's real data first, then guide the customer through checking stock, creating an order, or joining the back-in-stock queue where appropriate.",
    backendFlow: "start from the real catalog -> ask only for the missing details -> order/restock/payment/shipping",
    whyItFits: "A safe default for shops that have not set an archetype yet or are still trying several models.",
  },
];

const MENU_CARDS_EN: MenuCard[] = [
  {
    title: "Inbox",
    desc: "Take chats, view Customer 360, assign staff, and carry the work on from the conversation",
    bullets: [
      "Start the day from new chats",
      "Customer 360 can create orders and print invoices, subject to your permissions",
      "Recent orders open as a preview inside Inbox first, with a button to open the full Orders page in a new tab",
      "Images and files land in the draft before sending, and one attachment can be sent at a time",
      "Text, images, files, products, and coupons each render differently: text bubbles, image cards, file cards, product cards, and coupon cards",
      "Products are shared as a public link so customers can see price, stock, and gallery; the chat attaches the cover image only, and the card has a View product button",
      "Coupons are sent as a fallback text message on every channel, together with a wallet link. The entitlement is added to the wallet when the message is actually sent — the customer does not have to claim it",
      "The AI validates coupons against the backend before replying. If a code is unusable it explains why and offers one that still works, but it never redeems a coupon from free-form text",
      "The internal Products link opens in a new tab for staff and is never sent to the customer",
      "On mobile the flow is conversation list → full-screen chat, with a back button",
      "The chat you have open is marked as read and its badge cleared automatically as messages arrive",
      "If you are at the bottom of the thread it scrolls automatically; if you are reading back, use the new-message button to jump down",
      "See customer details without switching pages",
      "Built for sales and front-of-house admin teams",
    ],
  },
  {
    title: "Products & Purchase",
    desc: "Add products, multiple images, stock, reorder points, and receive goods into the warehouse",
    bullets: [
      "The first image is the cover",
      "Receive goods through Purchase",
      "Filter by category and search by SKU",
    ],
  },
  {
    title: "POS & Loyalty",
    desc: "Counter sales, members and points, parked bills, drawer cash, voids, and shift reports",
    bullets: [
      "Open a shift and identify the cashier with a PIN before selling; the device token identifies the register and branch, not the person",
      "A Bluetooth HID scanner is a keyboard: configure the register for Prefix Mode (for example F9 + payload + Enter) so a scan is captured even while member/PIN input is focused without mutating that field",
      "In Receive, select an existing PO, scan into a draft, review quantities/lot/expiry, then confirm once; purchase.receive is checked and stock enters this register's branch",
      "Find the member before payment to apply tier discounts and points; configure the program and inspect its ledger at /admin/loyalty",
      "Park up to 20 bills per shift, but parked carts reserve no stock and lock no price; resume uses current stock and pricing",
      "Use the Deposits tab to take, add, settle, or close layaway for this branch; a full balance must use Settle so stock and documents complete atomically. For serial-tracked goods, scan the delivered items and their serials into the cart before settling",
      "Every drawer cash movement needs a reason, and cash out always needs a second approver's PIN",
      "Use Petty cash for ice, ingredients, or packaging: pay directly, or advance cash and later enter the actual cost. Change returns to the drawer and any shortfall leaves it automatically; every advance must be settled before shift close",
      "A one-person shop can choose ‘Sole owner · personal funds’. The account needs pos.expense.personal and must enter a receipt/evidence reference. It records a shop expense without taking cash from the drawer; reimbursing the owner later is still a separate cash-out with a second approver",
      "For recurring small purchases, an Administrator can fund the branch petty-cash wallet from owner cash or a business account with evidence, then choose ‘Shop petty cash’ when paying. The wallet balance and history update without touching the register drawer or requiring a second PIN",
      "Void a mis-rung bill only while its shift is open, with a reason and a second approver; use Return after the shift closes",
      "Use the X report mid-shift and Z report after close to reconcile expected cash, counted cash, and variance",
    ],
  },
  {
    title: "Branch transfers & stock counts",
    desc: "Move goods between branches and reconcile shelf counts without overwriting sales made during the count",
    bullets: [
      "A transfer has two steps: send from the source, then receive at the destination; in-transit goods belong to no branch",
      "Only unreserved stock can be sent, and receiving can record a shortfall as lost in transit",
      "A count snapshots each line on first entry and Apply adds only the variance instead of replacing current stock",
      "Warehouse staff with inventory.count can enter figures, while inventory.count.apply is required to accept the variance",
      "Start at /admin/stock-transfers and open /admin/stock-counts when running a shelf count",
    ],
  },
  {
    title: "Restock notifications",
    desc: "Turn demand you could not fill into a sales follow-up queue",
    bullets: [
      "The AI only signs a customer up with their consent",
      "Once stock arrives, a person reviews the message before it is sent",
      "Orders created are tracked separately from payments completed",
      "The KPI counts recovered revenue only on confirmed payment, and excludes refunds, cancellations, and returns",
      "See success/error results, and resend after editing the message",
    ],
  },
  {
    title: "Orders / Payment / Shipping",
    desc: "These three pages are meant to be used back to back as a single flow",
    bullets: [
      "Every page has search",
      "Job status is easy to follow",
      "Orders shows subtotal, coupon discount, and net total",
      "Built for day-to-day operations",
    ],
  },
  {
    title: "Revision History",
    desc: "View the snapshot taken before an edit, open the detail, and compare two versions of important records",
    bullets: [
      "Covers Products / Orders / Payment / Shipping",
      "Search by SKU, ID, status, reference, or tracking number",
      "Editor shows the logged-in user for new revisions, now that the system passes editor context",
    ],
  },
  {
    title: "Customers / CRM",
    desc: "View customer details, addresses, purchase history, merge duplicates, and search by name or phone",
    bullets: [
      "Multiple addresses per customer",
      "Fast search by name or phone",
      "Works hand in hand with Customer 360",
    ],
  },
  {
    title: "AI Assistant",
    desc: "Ask questions and run back-office tasks in plain language — the AI reads real data and acts within your account's permissions",
    bullets: [
      "Ask about reports, stock, or a customer's orders and get answers from real data instantly",
      "Request a quotation or invoice, or ask it to forecast low stock and suggest purchase quantities (estimates — review before acting on them)",
      "For anything touching money, stock, or deletion (refunds, stock adjustments, order cancellation, merging customers, messaging a customer) the AI only prepares a request",
      "You always have to press Confirm before the system does anything — the same as pressing the button on the Payment or Orders page",
      "You only see the tools that match your account's role",
      "Every AI tool call is audited, without storing message content or personal data in the central audit trail",
      "Billing now includes an AI credit summary, usage breakdown, and per-shop ledger so you can see what AI was spent on this month",
    ],
  },
];

const HELP_ROWS_EN: HelpRow[] = [
  {
    title: 'The AI suggests replies ending in "ค่ะ", but I am male and want "ครับ"',
    answer: `Go to Profile (${ROUTES.profile}), set the polite-particle field to male — ครับ, and save. Suggested replies in Inbox (including the Checking and Thank you buttons) switch to ครับ automatically. If it is unset, the system defaults to ค่ะ.`,
  },
  {
    title: "I want the theme to follow my account, not just this device",
    answer: `Go to Profile (${ROUTES.profile}), set Theme to System / Light / Dark, and save. The system remembers it against your account and syncs it to other devices after you log in.`,
  },
  {
    title: "I added a product but still cannot sell it",
    answer: "Check that you have set a price, marked it active, and added stock for the size you want to sell.",
  },
  {
    title: "I cannot find an order / payment / shipment",
    answer:
      "Use the search box on the Orders / Payment / Shipping page directly — it searches as you type.",
  },
  {
    title: "A customer messaged me and I do not know which page to open next",
    answer:
      "Start from Inbox and check Customer 360 first. If you have the order.create permission you can press Create order in Quick Actions straight away, then follow the work through Orders / Payment / Shipping.",
  },
  {
    title: "Why is a shared product not sent immediately, and where does the customer see all the images?",
    answer:
      "The system puts the name, price, sizes, stock, and public link into a draft message first so you can review it before pressing Send. You can choose text + link or text + image + link. Once sent, Inbox renders it as a product card and hides the long URL behind a View product button. Only one cover image is sent in chat — the customer opens the public link to see the whole gallery without logging in. The internal Products button opens in a new tab for staff and is never sent to the customer.",
  },
  {
    title: "How do images and files work in Inbox?",
    answer:
      "Press Image or File, wait for the upload to land in the draft, then check the preview and press Send. The current message format allows one attachment at a time; selecting a new one replaces the previous. The image and file buttons have separate loading states.",
  },
  {
    title: "The ship button is disabled and says there is no address",
    answer:
      "For LINE / Facebook / Instagram / Web / TikTok Chat, open Customers and add a shipping address for the customer first, then come back and ship. Lazada / Shopee use the address from Seller Center and are not required to add it again.",
  },
  {
    title: "Does the invoice from Customer 360 save a document or confirm the amount?",
    answer:
      "No — this invoice is a preview/print built from the real order data and the prices at the time of ordering. It does not create a new document record, and it does not change the order or payment status.",
  },
  {
    title: "I want to connect LINE / Facebook / Website",
    answer:
      "Go to Settings and follow the webhook/token guide for each channel. LINE OA caches the display name and profile picture after a message arrives, provided you have permission and the customer has not blocked the OA.",
  },
  {
    title: "I want to test whether chats reach Inbox immediately",
    answer:
      "Open Realtime Diagnostics: press Emit to test the realtime signal alone, or press Create Msg to create a test message that actually appears in Inbox.",
  },
  {
    title:
      "I asked the AI Assistant to refund / adjust stock / cancel an order, so why did nothing happen?",
    answer:
      "That is expected — for this group of tasks the AI only prepares a request as a card in the chat. You have to press Confirm on that card before the system does anything (the same as confirming on the Payment or Orders page). If you do not see a confirm button, or pressing it fails, check whether your account has the permission for that task.",
  },
  {
    title: "I want to see who edited a product or order, and what changed",
    answer:
      "Open Revision History, pick the record type, then search by SKU or record id. Select two rows and press Compare to see which fields changed.",
  },
];

const LINK_STEPS_EN: LinkStep[] = [
  {
    title: "Start replying to customers",
    description: <>Open {L.inbox} to see new chats and Customer 360</>,
  },
  {
    title: "Add products / edit product images",
    description: (
      <>
        Open {L.products} and add products, multiple images, prices, and stock · to adjust stock, expand the product row
        and use the per-size shortcuts or the bulk adjustment
      </>
    ),
  },
  {
    title: "Import products in bulk with CSV/XLSX",
    description: (
      <>
        In {L.products} press Import · download the template and fill it in following the column headers (SKU / product
        name / price are required) · after uploading, the system previews what will be created / updated / skipped before
        you press Confirm import · images are not part of the file (add them afterwards on the edit form), and each
        import is limited to 500 rows
      </>
    ),
  },
  {
    title: "Receive goods into the warehouse",
    description: <>Open {L.purchase} to create a PO and receive goods, or select that PO in the POS Receive tab to scan a draft and confirm it into the register's branch</>,
  },
  {
    title: "Follow an order / payment / shipment",
    description: (
      <>
        Use {L.orders}, {L.payment}, and {L.shipment} as one continuous flow
      </>
    ),
  },
  {
    title: "Connect your real sales channels",
    description: (
      <>
        Go to {L.settings} to paste tokens and set up webhooks · to test Inbox realtime, open{" "}
        {L.realtimeDiagnostics} and press Create Msg · a live LINE OA syncs the display name and picture from the LINE
        profile cache once the webhook arrives
      </>
    ),
  },
  {
    title: "Use your own AI key (BYOK)",
    description: (
      <>
        In {L.settings} choose Anthropic or DeepSeek and enter your shop's own API key/model. You must re-enter the key
        whenever you change provider; slip OCR still uses the platform's shared provider, and payment confirmation still
        requires a person to press Confirm
      </>
    ),
  },
  {
    title: "Name your shop and fill in the shop details (so the AI can answer customers)",
    description: (
      <>
        In the <b>Shop information</b> card on {L.settings} you can edit the <b>shop name</b> yourself (Administrator ·
        the slug is an internal identifier assigned by the system and cannot be changed) and fill in the{" "}
        <b>business type</b>, opening hours, address, email/website, receiving accounts (bank/PromptPay), and shipping
        fees. If no receiving account is filled in, the AI will not suggest payment channels to customers. Country and
        currency matter too — the AI uses all of this to answer questions such as “what is the shop called / what are
        your hours”, “which account do I transfer to”, and “how much is shipping”, and it tailors its examples and
        follow-up questions to your business type using real data rather than guessing · the <b>/shop-signup</b> page
        has an optional <b>shop archetype</b> that pre-fills suitable product categories, sample data, and starter tips,
        and highlights the
        <b> restock subscriptions</b> flow for shops that regularly lose sales to stock-outs
      </>
    ),
  },
  {
    title: "See the shop overview",
    description: (
      <>
        Open {L.dashboard} or {L.reports}
        to see sales, stock, outstanding work, and the <b>AI health</b> card · if you need an actual file, use the
        <b> AI Report Generator</b> card on the Reports page to produce Excel / CSV / PDF exports of sales, inventory,
        or gross profit (estimated), and re-download them later from the report history · to review individual answers,
        open {L.aiQuality} for success/handoff/unresolved rates, failure cases, and sampled conversations, with personal
        data masked automatically on the review screen
      </>
    ),
  },
  {
    title: "Ask or instruct the AI",
    description: (
      <>
        Open <Link href={ROUTES.assistant}>AI Assistant</Link> to ask about reports, stock, or orders in plain language,
        or type an export request such as "export sales to Excel" — anything that touches money or stock always requires
        you to press Confirm first
      </>
    ),
  },
];

const EN: ManualContent = {
  heroTag: "A practical, hands-on manual",
  heroTitle: "📘 BMS user manual",
  heroLead:
    "Reworked from the old long-form document into a manual that gets you working quickly, makes menus easy to find, and is easier to teach a new team with.",
  heroAlertMessage: "Customer messages → Inbox → Orders → Payment → Shipping → Dashboard",
  heroAlertDesc: "Read the manual along the real workflow — you do not have to read every section top to bottom first.",
  heroCtaQuickstart: "Get started in 3 minutes",
  heroCtaWorkflow: "See the whole workflow",
  heroCtaMenus: "Browse the manual by menu",
  heroTags: [
    "Inbox",
    "Products",
    "Orders",
    "Purchase",
    "Payment",
    "Shipping",
    "Customers",
    "Reports",
    "AI Assistant",
  ],
  anchors: {
    hero: "Quick start",
    quickstart: "Quick start by role",
    workflow: "The whole workflow",
    archetypes: "Examples by shop type",
    coupons: "Coupon guide",
    menus: "Guide by menu",
    faq: "Frequently asked questions",
    links: "Links to frequently used pages",
  },
  quickstartTitle: "⚡ Quick start by role",
  quickstartSubtitle: "Pick what you are doing right now so the manual takes you to the right page as fast as possible.",
  personaButtons: {
    owner: "Shop owner",
    staff: "Front-of-house staff",
    ops: "System admin",
  },
  personaCards: {
    owner: {
      title: "Where should a shop owner start?",
      subtitle: "For your first day on the system, or setting up a new shop",
      items: [
        "Add products with images, prices, and stock per size",
        "Simulate an order in the Playground to see the real flow",
        "Connect your live sales channels on the Settings page",
        "Open Dashboard for the shop overview and alerts, and expand a discount code to see who used it on which order",
      ],
      ctaLabel: "Start with Products",
    },
    staff: {
      title: "What do front-of-house staff use most?",
      subtitle: "For people answering chats, taking orders, and following up on daily work",
      items: [
        "Open Inbox to see new chats and the customers who need a reply first",
        "Use Customer 360 to see customer history without switching pages",
        "Preview recent orders inside Inbox first, and open the full Orders page in a new tab only when you need to dig deeper",
        "Share products and coupons from the composer, reviewing the draft message before you send it",
        "To send a report file to your manager or keep a copy, use the AI Report Generator on the Reports page to produce Excel/CSV/PDF",
        "Open Restock notifications to follow up on items customers opted in for, review the message, and resend when delivery fails",
        "Create orders and issue invoices from Quick Actions, subject to your account's permissions",
        "Work through Orders / Payment / Shipping as one continuous set",
        "Use the search box on each page to find an order, payment, or tracking number faster",
      ],
      ctaLabel: "Go to Inbox",
    },
    ops: {
      title: "What should a system admin keep an eye on?",
      subtitle: "For people managing user permissions, channel connections, and tenants",
      items: [
        "Set Roles / Permissions to match each job",
        "Check Channel Health and webhook status",
        "Review billing, package, usage, the AI credit summary / ledger, and tenant settings",
        "Use the API / webhook guide when debugging or connecting another system",
      ],
      ctaLabel: "Go to Settings",
    },
  },
  workflowTitle: "🧭 The whole workflow",
  workflowSubtitle: "If you are not sure what comes first, step through this flow one stage at a time.",
  flowButtons: {
    products: "Add products",
    orders: "Take orders",
    payment: "Confirm payment",
    shipping: "Ship and close out",
  },
  flowCards: {
    products: {
      title: "1) Get products ready to sell",
      path: "Products → add product → multiple images → price → stock per size",
      summary:
        "Start by getting your products in place. The first image is the cover, and the rest form the product gallery.",
      checks: [
        "Fill in SKU / barcode / price completely",
        "Upload several product images",
        "With a lot of products, use the Import button to upload a CSV/XLSX — download the template first, fill it in following the column headers, then review the preview (create / update / skip) before confirming (no images in the file, maximum 500 rows per import)",
        "Expand a product row to see stock per size, then use the quick adjust / manual entry / bulk adjust buttons",
        "If AI synonym discovery is available, map search terms customers could not find to a SKU and approve it — the system then adds it as a product keyword",
        "Set stock and a reorder point per size",
        "If the goods have not arrived yet, you can receive them later through Purchase",
      ],
      tags: ["Products", "CSV/XLSX import", "Gallery", "Stock", "Category", "AI Synonym"],
    },
    orders: {
      title: "2) Take chats and create orders",
      path: "Inbox → Customer 360 → Quick Actions → Orders",
      summary:
        "When a chat arrives, review the customer details, create an order or print an invoice from Customer 360, then follow the status in Orders.",
      checks: [
        "Check new chats in Inbox first",
        "Use Customer 360 to see the customer's history and details",
        "Press Product in the composer and choose text + link or text + image + link — the system puts it into the draft message rather than sending immediately",
        "Press Coupon to pick an active code. The system inserts the coupon message into the draft, and when you actually send it the coupon is added to the customer's wallet automatically, together with a wallet link",
        "If a customer asks about coupons or types a code that genuinely exists in their wallet, the backend validates the entitlement before the AI replies — but a coupon is never marked as used from free-form text",
        "Press Open order for a quick look inside Inbox, and use Open full Orders page when you need to continue in a new tab",
        "Press Create order and choose product / size / quantity — the system uses current prices and reserves stock immediately",
        "If the chat contains a recent coupon, the order form may pre-fill the code as a suggestion, and the backend re-checks the real conditions",
        "If an order uses a coupon, Inbox / Customer 360 / Orders show the item subtotal → the discount with its coupon code → the net total",
        "After an order is created from chat, the system reuses the existing name, phone, and shipping address from CRM if they are complete; if something is missing it asks the customer only for the first missing item, so they never re-enter what you already have",
        "When the AI creates an order successfully, the system always sends the customer a Checkout link for that real order, so they can review existing details, fill in only what is missing, and attach a payment slip",
        "Lazada / Shopee take delivery and payment details from Seller Center, so the system does not ask for them again in chat",
        "If the customer does not pay or cancels before the sale completes, the system returns the coupon quota when the order is cancelled or auto-released; rejecting a slip alone leaves the order open for a new one",
        "Press Issue invoice to pick an existing order and print the document (the document does not change payment status)",
        "Open Orders to follow the PENDING / PAID / PACKING status",
        "Search by order, customer, or channel using the search box at the top",
      ],
      tags: ["Inbox", "Orders", "Customer 360", "Search"],
    },
    payment: {
      title: "3) Confirm payment",
      path: "Payment → review the slip → Confirm / Reject / Refund",
      summary:
        "The Payment page is where all money statuses are tracked. AI can help review slips, but a person still has to confirm.",
      checks: [
        "Search by payment id / order id / slip reference",
        "The AI only shows bank/PromptPay accounts that are actually filled in and usable in Settings; if nothing is set up, it will not offer payment channels on the shop's behalf",
        "Customers who send a slip from Checkout only reach the awaiting-review state; sending again while a payment is PENDING/CONFIRMED does not create a duplicate",
        "AI slip review is advisory only; if the primary OCR fails, the system may try the fallback before handing it to a person",
        "Once confirmed, the order becomes PAID",
        "Refund is only available while the record is in a refundable state",
      ],
      tags: ["Payment", "Slip", "Confirm", "Refund"],
    },
    shipping: {
      title: "4) Ship and close out",
      path: "Shipping → Tracking → DELIVERED → Dashboard",
      summary:
        "Once the goods are packed, check the address, create a shipment with a tracking number, and move the status along until the job is closed.",
      checks: [
        "LINE / Facebook / Instagram / Web / TikTok Chat need a shipping address in Customers before you can ship",
        "Lazada / Shopee use the address from Seller Center, so there is no need to add it again",
        "Create a shipment from an order that is ready to ship",
        "Record the carrier and tracking number",
        "Flash / Kerry: with no tracking number yet, press Book carrier to have the system book the parcel (safe to retry after a failure — it will not create a duplicate parcel)",
        "Flash / Kerry: once there is a tracking number, press Sync carrier to pull the latest status and timeline from the carrier",
        "The Carrier sync column shows when it last synced, or what went wrong with the booking (for example, the API is not configured yet)",
        "Search by shipment / order / tracking from the search box",
        "DELIVERED closes out the workflow",
      ],
      tags: ["Shipping", "Tracking", "Carrier", "Dashboard"],
    },
  },
  archetypesTitle: "🛍 Sample conversations by businessArchetype",
  archetypesSubtitle:
    "Use this section when briefing your team, demoing the system, or checking how your shop's AI should reply and route customers into the back-office flow.",
  archetypeAlertMessage: "The key principle",
  archetypeAlertDesc:
    "BMS does not stop at answering a chat — it has to carry the customer into the shop's real work: know the customer -> find/recommend products -> check stock -> create the order -> take payment -> ship -> track status. And when something is out of stock, the conversation should turn into a restock queue so the sale can be recovered.",
  archetypeCustomerAskLabel: "Example customer question",
  archetypeAiReplyLabel: "How the AI should answer",
  archetypeBackendFlowLabel: "Back-office flow this should trigger",
  archetypeWhyLabel: "Why this archetype matters to BMS:",
  archetypeExamples: ARCHETYPE_EXAMPLES_EN,
  couponsTitle: "🎟 Detailed coupon guide",
  couponsSubtitle:
    "Explains what the system knows about a customer's coupons, how they are used, and which conditions pass or fail.",
  couponAlertMessage: "What the system stores today",
  couponAlertDesc:
    "The system stores master coupons in bms_coupons, records which coupons a customer has received in bms_customer_coupon_wallet, and stores actual usage on the order (bms_orders.coupon_id / coupon_code / discount_amount). It then works out live which codes this customer can still use, based on the validity window, the overall quota, the per-customer limit, the minimum spend, and their history of orders that were not cancelled.",
  couponStepsTitle: "How it works in practice",
  couponSteps: [
    {
      title: "1. Create the coupon on the Coupons page",
      description:
        "Set the code, discount type (percentage/baht), minimum spend, total redemptions, redemptions per customer, start date, expiry date, and whether it is active.",
    },
    {
      title: "2. Send the coupon to the customer from Inbox",
      description:
        "Press the Coupon button in the composer and pick a code. The system inserts a fallback message covering the code, discount, minimum spend, expiry date, and remaining entitlement. When you actually send it, the entitlement is saved to the customer's coupon wallet and a wallet link is attached so they can see everything.",
    },
    {
      title: "3. The customer asks what coupons they have, or types a code",
      description:
        "The AI calls list_customer_coupons first when a customer asks about their own coupons or what is expiring soon, and replies with a short summary plus the wallet link. It must never assume a coupon is valid. If the customer types a code, the system only reports its status and conditions — it never redeems a coupon from free-form text.",
    },
    {
      title: "3.5 Staff can see a customer's coupons instantly",
      description:
        "In Inbox > Customer 360, and on the Customers (CRM) page when you expand a customer row, there is a 'customer coupons' section showing the code, status (ASSIGNED / RESERVED / REDEEMED / EXPIRED / REVOKED), expiry date, why it is not usable yet, and the linked order id if there is one.",
    },
    {
      title: "4. The coupon is only really applied when the order is created",
      description:
        "create_order passes couponCode into createOrder(), and the backend validates it again in the same transaction that reserves stock. If it fails, the result is COUPON_INVALID and no half-finished order is created. If it passes, the wallet entry moves to RESERVED and is linked to the order.",
    },
    {
      title: "5. Quota is only returned in certain cases",
      description:
        "Confirming payment or paying an order moves the wallet entry to REDEEMED. But cancelling an order, or auto-releasing an unpaid one, returns the quota and rolls that order's wallet entry back from RESERVED/REDEEMED to ASSIGNED. Rejecting a slip alone does not return it, because the order is still open for the customer to send a new slip.",
    },
  ],
  couponWhereToSeeTitle: "Where to see a customer's coupons",
  couponWhereToSee: COUPON_WHERE_TO_SEE_EN,
  couponWalletStatesTitle: "What each wallet status means",
  couponWalletMeanings: COUPON_WALLET_MEANINGS_EN,
  couponConditionsTitle: "Examples of the conditions the system checks",
  couponConditionLabel: "Condition:",
  couponConditions: COUPON_CONDITIONS_EN,
  couponGapsTitle: "What the system does not do yet",
  couponGaps: COUPON_GAPS_EN,
  menusTitle: "🧩 Guide by menu",
  menusSubtitle: "Short cards so you can scan and immediately know what each menu is for.",
  menuCards: MENU_CARDS_EN,
  menuOpenPagePrefix: "Open",
  menuGroupingAlertMessage: "A note on grouping",
  menuGroupingAlertDesc:
    "Orders / Payment / Shipping should sit close together in the manual, because people work through them as one continuous flow. Products belongs next to Purchase, because both are about having goods ready to sell.",
  faqTitle: "❓ Frequently asked questions",
  faqSubtitle: "Short questions and answers, so you spend less time hunting through long documents.",
  helpRows: HELP_ROWS_EN,
  linksTitle: "🔗 Links to frequently used pages",
  linksSubtitle: "Jump straight into the real work without reading the whole page.",
  linkSteps: LINK_STEPS_EN,
  linksAlertMessage: "The idea behind this manual",
  linksAlertDesc:
    "Opening it should immediately answer “where do I start”, “what is this menu for”, and “where do I look if I get stuck”.",
  sidebarTocTitle: "Contents",
  sidebarShortcutsTitle: "Suggested shortcuts",
  sidebarShortcuts: [
    "Go to Inbox",
    "Go to Products",
    "Go to Orders",
    "Go to AI Assistant",
    "Go to Settings",
    "Test realtime Inbox",
  ],
  sidebarNextTitle: "What this manual still needs",
  sidebarNextItems: [
    "Search across the manual itself",
    "FAQs split by menu",
    "Short videos or images explaining the flow",
    "A button to open the real page from every section",
    "A condensed onboarding guide for new staff that records which steps are done or skipped",
  ],
  noteTitle: "Note",
  noteBody:
    "This page has been reworked into an easy-to-use manual first, focusing on getting started quickly and seeing the real workflow. If you like this direction, the next round can break it down menu by menu and add more FAQs and a real manual search.",
  noteTags: [
    "Good for new shops",
    "Good for team onboarding",
    "Good for day-to-day operations",
    "Can grow into an API guide",
  ],
};

const MANUAL: Bilingual<ManualContent> = {
  th: TH,
  en: EN,
};

function Section({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ scrollMarginTop: 88 }}>
      <Card style={{ borderRadius: 18 }}>
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Title level={3} style={{ margin: 0 }}>
            {title}
          </Title>
          {subtitle ? (
            <Paragraph type="secondary" style={{ margin: 0 }}>
              {subtitle}
            </Paragraph>
          ) : null}
          <Divider style={{ margin: "8px 0 0" }} />
          <div style={{ paddingTop: 8 }}>{children}</div>
        </Space>
      </Card>
    </section>
  );
}

export default function Page() {
  const { lang } = useI18n();
  const c = resolveBilingual(MANUAL, lang);

  const [persona, setPersona] = useState<PersonaKey>("owner");
  const [flow, setFlow] = useState<FlowKey>("products");

  const activePersona = c.personaCards[persona];
  const activeFlow = c.flowCards[flow];

  const anchorItems = useMemo(
    () => [
      { key: "hero", href: "#hero", title: c.anchors.hero },
      { key: "quickstart", href: "#quickstart", title: c.anchors.quickstart },
      { key: "workflow", href: "#workflow", title: c.anchors.workflow },
      { key: "archetypes", href: "#archetypes", title: c.anchors.archetypes },
      { key: "coupons", href: "#coupons", title: c.anchors.coupons },
      { key: "menus", href: "#menus", title: c.anchors.menus },
      { key: "faq", href: "#faq", title: c.anchors.faq },
      { key: "links", href: "#links", title: c.anchors.links },
    ],
    [c.anchors]
  );

  return (
    <div>
      <div id="hero" style={{ marginBottom: 20 }}>
        <Card
          style={{
            borderRadius: 24,
            background:
              "linear-gradient(135deg, rgba(24,144,255,0.08) 0%, rgba(82,196,26,0.08) 100%)",
          }}
        >
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Tag color="blue" style={{ width: "fit-content", paddingInline: 12, borderRadius: 999 }}>
              {c.heroTag}
            </Tag>
            <Title style={{ margin: 0 }}>{c.heroTitle}</Title>
            <Paragraph type="secondary" style={{ margin: 0, fontSize: 18 }}>
              {c.heroLead}
            </Paragraph>

            <Alert
              type="info"
              showIcon
              message={c.heroAlertMessage}
              description={c.heroAlertDesc}
              style={{ borderRadius: 16 }}
            />

            <Space wrap>
              <Button type="primary" size="large" href="#quickstart">
                {c.heroCtaQuickstart}
              </Button>
              <Button size="large" href="#workflow">
                {c.heroCtaWorkflow}
              </Button>
              <Button size="large" href="#menus">
                {c.heroCtaMenus}
              </Button>
            </Space>

            <Space wrap>
              {c.heroTags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </Space>
          </Space>
        </Card>
        <Alert
          type="success"
          showIcon
          style={{ marginTop: 12, borderRadius: 12 }}
          message={lang === "en" ? "Phase 1: daily actions + smarter purchasing" : "Phase 1: งานวันนี้ + ซื้อของแม่นขึ้น"}
          description={lang === "en"
            ? "On Dashboard, refresh signals, accept an action, then complete or dismiss it with a reason. Inventory recommendations include demand trend, safety stock, lead time, open PO quantities, slow/dead stock and FEFO expiry. Record a lost sale on a low-stock line so unmet demand improves the next recommendation. Recommendations remain advisory and require staff review."
            : "ที่ Dashboard ให้กดอัปเดตสัญญาณ รับทำ Action แล้วปิดงานหรือเลือกไม่ทำพร้อมเหตุผล คำแนะนำสต็อกจะรวมแนวโน้ม Demand, Safety stock, Lead time, ของที่กำลังมากับ PO, Slow/Dead stock และวันหมดอายุแบบ FEFO หากขายไม่ได้เพราะของขาด ให้บันทึก Lost sale ในรายการ Low stock เพื่อให้คำแนะนำรอบถัดไปนับ Demand ที่พลาดด้วย ทุกคำแนะนำยังต้องให้พนักงานทบทวนก่อนสั่งซื้อจริง"}
        />
        <Alert
          type="info" showIcon style={{ marginTop: 12, borderRadius: 12 }}
          message={lang === "en" ? "Phase 2: retention engine" : "Phase 2: Retention engine"}
          description={lang === "en"
            ? "Open Follow-up queue > Retention engine, refresh intelligence, review RFM/risk/evidence and the proposed channel, message, offer and product. Accept before contacting. Never contact HOLDOUT rows; they provide the baseline used to measure incremental conversion."
            : "เปิด Follow-up queue > Retention engine แล้วอัปเดตข้อมูล ตรวจ RFM/ความเสี่ยง/หลักฐาน รวมถึง Channel, Message, Offer และสินค้าที่ระบบเสนอ กดรับทำก่อนติดต่อ และห้ามติดต่อแถว HOLDOUT เพราะเป็น Baseline สำหรับวัด Incremental conversion"}
        />
      </div>

      <Row gutter={[20, 20]} align="top">
        <Col xs={24} lg={17}>
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <Section
              id="quickstart"
              title={c.quickstartTitle}
              subtitle={c.quickstartSubtitle}
            >
              <Space wrap style={{ marginBottom: 16 }}>
                <Button type={persona === "owner" ? "primary" : "default"} onClick={() => setPersona("owner")}>
                  {c.personaButtons.owner}
                </Button>
                <Button type={persona === "staff" ? "primary" : "default"} onClick={() => setPersona("staff")}>
                  {c.personaButtons.staff}
                </Button>
                <Button type={persona === "ops" ? "primary" : "default"} onClick={() => setPersona("ops")}>
                  {c.personaButtons.ops}
                </Button>
              </Space>

              <Card style={{ borderRadius: 16, background: "#fafcff" }}>
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <div>
                    <Title level={4} style={{ margin: 0 }}>
                      {activePersona.title}
                    </Title>
                    <Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                      {activePersona.subtitle}
                    </Paragraph>
                  </div>

                  <List
                    size="small"
                    dataSource={activePersona.items}
                    renderItem={(item, index) => (
                      <List.Item style={{ paddingInline: 0 }}>
                        <Space align="start">
                          <Tag color="blue" style={{ marginTop: 2 }}>{index + 1}</Tag>
                          <span>{item}</span>
                        </Space>
                      </List.Item>
                    )}
                  />

                  <div>
                    <Link href={PERSONA_HREF[persona]}>
                      <Button type="primary" icon={<RocketOutlined />}>
                        {activePersona.ctaLabel}
                      </Button>
                    </Link>
                  </div>
                </Space>
              </Card>
            </Section>

            <Section
              id="workflow"
              title={c.workflowTitle}
              subtitle={c.workflowSubtitle}
            >
              <Row gutter={[14, 14]}>
                <Col xs={24}>
                  <Space wrap>
                    <Button
                      type={flow === "products" ? "primary" : "default"}
                      icon={<DatabaseOutlined />}
                      onClick={() => setFlow("products")}
                    >
                      {c.flowButtons.products}
                    </Button>
                    <Button
                      type={flow === "orders" ? "primary" : "default"}
                      icon={<ShoppingCartOutlined />}
                      onClick={() => setFlow("orders")}
                    >
                      {c.flowButtons.orders}
                    </Button>
                    <Button
                      type={flow === "payment" ? "primary" : "default"}
                      icon={<CreditCardOutlined />}
                      onClick={() => setFlow("payment")}
                    >
                      {c.flowButtons.payment}
                    </Button>
                    <Button
                      type={flow === "shipping" ? "primary" : "default"}
                      icon={<TruckOutlined />}
                      onClick={() => setFlow("shipping")}
                    >
                      {c.flowButtons.shipping}
                    </Button>
                  </Space>
                </Col>

                <Col xs={24}>
                  <Card style={{ borderRadius: 16 }}>
                    <Space direction="vertical" size={14} style={{ width: "100%" }}>
                      <div>
                        <Title level={4} style={{ margin: 0 }}>
                          {activeFlow.title}
                        </Title>
                        <Paragraph type="secondary" style={{ margin: "6px 0 0" }}>
                          {activeFlow.path}
                        </Paragraph>
                      </div>

                      <Alert type="success" showIcon message={activeFlow.summary} style={{ borderRadius: 14 }} />

                      <Space wrap>
                        {activeFlow.tags.map((tag) => (
                          <Tag key={tag} color="blue">
                            {tag}
                          </Tag>
                        ))}
                      </Space>

                      <List
                        size="small"
                        bordered
                        style={{ borderRadius: 14 }}
                        dataSource={activeFlow.checks}
                        renderItem={(item) => <List.Item>{item}</List.Item>}
                      />
                    </Space>
                  </Card>
                </Col>
              </Row>
            </Section>

            <Section
              id="archetypes"
              title={c.archetypesTitle}
              subtitle={c.archetypesSubtitle}
            >
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert
                  type="info"
                  showIcon
                  style={{ borderRadius: 14 }}
                  message={c.archetypeAlertMessage}
                  description={c.archetypeAlertDesc}
                />

                <Row gutter={[14, 14]}>
                  {c.archetypeExamples.map((item, index) => (
                    <Col xs={24} key={ARCHETYPE_KEYS[index]}>
                      <Card style={{ borderRadius: 16 }}>
                        <Space direction="vertical" size={10} style={{ width: "100%" }}>
                          <Space wrap>
                            <Tag color="blue">{item.label}</Tag>
                            <Tag>{item.focus}</Tag>
                          </Space>
                          <div>
                            <Text strong>{c.archetypeCustomerAskLabel}</Text>
                            <Paragraph style={{ margin: "6px 0 0" }}>{item.customerAsk}</Paragraph>
                          </div>
                          <div>
                            <Text strong>{c.archetypeAiReplyLabel}</Text>
                            <Paragraph type="secondary" style={{ margin: "6px 0 0" }}>
                              {item.aiReply}
                            </Paragraph>
                          </div>
                          <div>
                            <Text strong>{c.archetypeBackendFlowLabel}</Text>
                            <Paragraph style={{ margin: "6px 0 0" }}>{item.backendFlow}</Paragraph>
                          </div>
                          <Text type="secondary">
                            {c.archetypeWhyLabel} {item.whyItFits}
                          </Text>
                        </Space>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Space>
            </Section>

            <Section
              id="coupons"
              title={c.couponsTitle}
              subtitle={c.couponsSubtitle}
            >
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert
                  type="info"
                  showIcon
                  style={{ borderRadius: 14 }}
                  message={c.couponAlertMessage}
                  description={c.couponAlertDesc}
                />

                <Card style={{ borderRadius: 16, background: "#fafcff" }}>
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Title level={4} style={{ margin: 0 }}>{c.couponStepsTitle}</Title>
                    <Steps direction="vertical" current={-1} items={c.couponSteps} />
                  </Space>
                </Card>

                <Row gutter={[14, 14]}>
                  <Col xs={24} lg={12}>
                    <Card style={{ borderRadius: 16, height: "100%" }}>
                      <Space direction="vertical" size={10} style={{ width: "100%" }}>
                        <Title level={4} style={{ margin: 0 }}>{c.couponWhereToSeeTitle}</Title>
                        <List
                          size="small"
                          dataSource={c.couponWhereToSee}
                          renderItem={(item) => (
                            <List.Item style={{ paddingInline: 0 }}>
                              <Text type="secondary">• {item}</Text>
                            </List.Item>
                          )}
                        />
                      </Space>
                    </Card>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Card style={{ borderRadius: 16, height: "100%" }}>
                      <Space direction="vertical" size={10} style={{ width: "100%" }}>
                        <Title level={4} style={{ margin: 0 }}>{c.couponWalletStatesTitle}</Title>
                        <List
                          size="small"
                          dataSource={c.couponWalletMeanings}
                          renderItem={(meaning, index) => {
                            const state = COUPON_WALLET_STATES[index];
                            return (
                              <List.Item style={{ paddingInline: 0 }}>
                                <Space direction="vertical" size={2}>
                                  <Tag color={state === "REDEEMED" ? "green" : state === "RESERVED" ? "purple" : state === "EXPIRED" ? "orange" : state === "REVOKED" ? "red" : "blue"}>
                                    {state}
                                  </Tag>
                                  <Text type="secondary">{meaning}</Text>
                                </Space>
                              </List.Item>
                            );
                          }}
                        />
                      </Space>
                    </Card>
                  </Col>
                </Row>

                <Card style={{ borderRadius: 16 }}>
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Title level={4} style={{ margin: 0 }}>{c.couponConditionsTitle}</Title>
                    <List
                      size="small"
                      bordered
                      style={{ borderRadius: 14 }}
                      dataSource={c.couponConditions}
                      renderItem={(item, index) => (
                        <List.Item>
                          <Space direction="vertical" size={2}>
                            <Text strong>{COUPON_CONDITION_CODES[index]}</Text>
                            <Text type="secondary">
                              {c.couponConditionLabel} {item.condition}
                            </Text>
                            <Text>{item.result}</Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Space>
                </Card>

                <Card style={{ borderRadius: 16 }}>
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Title level={4} style={{ margin: 0 }}>{c.couponGapsTitle}</Title>
                    <List
                      size="small"
                      dataSource={c.couponGaps}
                      renderItem={(item) => (
                        <List.Item style={{ paddingInline: 0 }}>
                          <Text type="secondary">• {item}</Text>
                        </List.Item>
                      )}
                    />
                  </Space>
                </Card>
              </Space>
            </Section>

            <Section
              id="menus"
              title={c.menusTitle}
              subtitle={c.menusSubtitle}
            >
              <Row gutter={[14, 14]}>
                {c.menuCards.map((item, index) => (
                  <Col xs={24} md={12} key={MENU_META[index].key}>
                    <Card style={{ borderRadius: 16, height: "100%" }}>
                      <Space direction="vertical" size={10} style={{ width: "100%" }}>
                        <Space>
                          <Tag color="blue" icon={MENU_META[index].icon}>
                            {item.title}
                          </Tag>
                        </Space>
                        <Paragraph style={{ margin: 0 }}>{item.desc}</Paragraph>
                        <List
                          size="small"
                          dataSource={item.bullets}
                          renderItem={(bullet) => (
                            <List.Item style={{ paddingInline: 0 }}>
                              <Text type="secondary">• {bullet}</Text>
                            </List.Item>
                          )}
                        />
                        <div>
                          <Link href={MENU_META[index].href}>
                            <Button>
                              {c.menuOpenPagePrefix} {item.title}
                            </Button>
                          </Link>
                        </div>
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>

              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 16, borderRadius: 14 }}
                message={c.menuGroupingAlertMessage}
                description={c.menuGroupingAlertDesc}
              />
            </Section>

            <Section
              id="faq"
              title={c.faqTitle}
              subtitle={c.faqSubtitle}
            >
              <List
                itemLayout="vertical"
                dataSource={c.helpRows}
                renderItem={(row) => (
                  <List.Item style={{ paddingInline: 0 }}>
                    <Card style={{ borderRadius: 14 }}>
                      <Space direction="vertical" size={6} style={{ width: "100%" }}>
                        <Text strong>{row.title}</Text>
                        <Text type="secondary">{row.answer}</Text>
                      </Space>
                    </Card>
                  </List.Item>
                )}
              />
            </Section>

            <Section
              id="links"
              title={c.linksTitle}
              subtitle={c.linksSubtitle}
            >
              <Steps direction="vertical" current={-1} items={c.linkSteps} />

              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12, borderRadius: 14 }}
                message={c.linksAlertMessage}
                description={c.linksAlertDesc}
              />
            </Section>
          </Space>
        </Col>

        <Col xs={24} lg={7}>
          <div style={{ position: "sticky", top: 16 }}>
            <Card title={c.sidebarTocTitle} style={{ borderRadius: 18, marginBottom: 16 }}>
              <Anchor affix={false} items={anchorItems} />
            </Card>

            <Card title={c.sidebarShortcutsTitle} style={{ borderRadius: 18, marginBottom: 16 }}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Link href={ROUTES.inbox}>
                  <Button block icon={<InboxOutlined />}>
                    {c.sidebarShortcuts[0]}
                  </Button>
                </Link>
                <Link href={ROUTES.products}>
                  <Button block icon={<DatabaseOutlined />}>
                    {c.sidebarShortcuts[1]}
                  </Button>
                </Link>
                <Link href={ROUTES.orders}>
                  <Button block icon={<ShoppingCartOutlined />}>
                    {c.sidebarShortcuts[2]}
                  </Button>
                </Link>
                <Link href={ROUTES.assistant}>
                  <Button block icon={<RobotOutlined />}>
                    {c.sidebarShortcuts[3]}
                  </Button>
                </Link>
                <Link href={ROUTES.settings}>
                  <Button block icon={<CustomerServiceOutlined />}>
                    {c.sidebarShortcuts[4]}
                  </Button>
                </Link>
                <Link href={ROUTES.realtimeDiagnostics}>
                  <Button block icon={<ApiOutlined />}>
                    {c.sidebarShortcuts[5]}
                  </Button>
                </Link>
              </Space>
            </Card>

            <Card title={c.sidebarNextTitle} style={{ borderRadius: 18 }}>
              <List
                size="small"
                dataSource={c.sidebarNextItems}
                renderItem={(item) => (
                  <List.Item style={{ paddingInline: 0 }}>
                    <Text type="secondary">• {item}</Text>
                  </List.Item>
                )}
              />
            </Card>
          </div>
        </Col>
      </Row>

      <Divider />

      <Card style={{ borderRadius: 18 }}>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Title level={4} style={{ margin: 0 }}>
            {c.noteTitle}
          </Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            {c.noteBody}
          </Paragraph>
          <Space wrap>
            <Tag icon={<ShopOutlined />}>{c.noteTags[0]}</Tag>
            <Tag icon={<DashboardOutlined />}>{c.noteTags[1]}</Tag>
            <Tag icon={<FileSearchOutlined />}>{c.noteTags[2]}</Tag>
            <Tag icon={<ApiOutlined />}>{c.noteTags[3]}</Tag>
          </Space>
        </Space>
      </Card>
    </div>
  );
}
