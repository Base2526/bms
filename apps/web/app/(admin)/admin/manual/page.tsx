'use client';

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Col,
  Input,
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
  DownloadOutlined,
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
// Imported from the FAQ module directly, not the catalog barrel: the barrel also pulls the
// full guide/capability catalog into this page's client bundle for no benefit here.
import { SYSTEM_FAQ } from "@/lib/bms/assistantKnowledge/faq";
import { SYSTEM_LIMITS } from "@/lib/bms/assistantKnowledge/limits";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual, type Bilingual } from "@/lib/static-page-i18n";
import styles from "./manual.module.css";

const { Title, Paragraph, Text } = Typography;

type PersonaKey = "owner" | "staff" | "ops";
type FlowKey = "products" | "orders" | "payment" | "shipping";

const ROUTES = {
  gettingStarted: "/admin/getting-started",
  dashboard: "/admin/dashboard",
  inbox: "/admin/inbox",
  mentions: "/admin/inbox/mentions",
  products: "/admin/products",
  productPacks: "/admin/product-packs",
  productLabels: "/admin/product-labels",
  purchase: "/admin/purchase",
  orders: "/admin/orders",
  payment: "/admin/payment",
  shipment: "/admin/shipment",
  coupons: "/admin/coupons",
  followupRules: "/admin/followup-rules",
  followupQueue: "/admin/followup-queue",
  pharmacyIntakeLab: "/admin/pharmacy-intake-lab",
  pharmacyQueue: "/admin/pharmacy-queue",
  pharmacyProtocols: "/admin/pharmacy-protocols",
  pharmacistLicenses: "/admin/pharmacy-protocols/licenses",
  settings: "/admin/settings",
  reports: "/admin/reports",
  billing: "/admin/billing",
  aiQuality: "/admin/ai-quality",
  assistant: "/admin/assistant",
  customers: "/admin/customers",
  users: "/admin/users",
  permissions: "/admin/permissions",
  audit: "/admin/audit",
  architecture: "/admin/architecture",
  tenants: "/admin/tenants",
  reportSchedule: "/admin/report-schedule",
  roles: "/admin/roles",
  files: "/admin/files",
  logs: "/admin/logs",
  mailLog: "/admin/mail-log",
  supportTickets: "/admin/support-tickets",
  operationsSchedule: "/admin/operations-schedule",
  systemHealth: "/admin/system-health",
  env: "/admin/env",
  devSqlConsole: "/admin/dev/sql-console",
  fakeData: "/admin/dev/fake",
  playground: "/admin/playground",
  locations: "/admin/locations",
  revisions: "/admin/revisions",
  restock: "/admin/restock-subscriptions",
  realtimeDiagnostics: "/admin/inbox/realtime-diagnostics",
  profile: "/admin/profile",
  pos: "/pos",
  posDevices: "/admin/pos-devices",
  posReadiness: "/admin/pos-readiness",
  loyalty: "/admin/loyalty",
  commission: "/admin/commission",
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
  { key: "dashboard", icon: <DashboardOutlined />, href: ROUTES.dashboard },
  { key: "inbox", icon: <InboxOutlined />, href: ROUTES.inbox },
  { key: "products", icon: <DatabaseOutlined />, href: ROUTES.products },
  { key: "purchase", icon: <ShoppingCartOutlined />, href: ROUTES.purchase },
  { key: "ops", icon: <CreditCardOutlined />, href: ROUTES.orders },
  { key: "crm-loyalty", icon: <UserOutlined />, href: ROUTES.customers },
  { key: "coupon-followup", icon: <CustomerServiceOutlined />, href: ROUTES.coupons },
  { key: "pharmacy", icon: <FileSearchOutlined />, href: ROUTES.pharmacyQueue },
  { key: "pos-tools", icon: <ShopOutlined />, href: ROUTES.posDevices },
  { key: "pos-live", icon: <ShopOutlined />, href: ROUTES.pos },
  { key: "branch-inventory", icon: <DatabaseOutlined />, href: ROUTES.locations },
  { key: "reports", icon: <FileSearchOutlined />, href: ROUTES.reports },
  { key: "settings", icon: <ApiOutlined />, href: ROUTES.settings },
  { key: "assistant", icon: <RobotOutlined />, href: ROUTES.assistant },
  { key: "people", icon: <UserOutlined />, href: ROUTES.profile },
  { key: "revisions", icon: <HistoryOutlined />, href: ROUTES.revisions },
  { key: "billing", icon: <CreditCardOutlined />, href: ROUTES.billing },
  { key: "platform", icon: <ApiOutlined />, href: ROUTES.architecture },
  { key: "system", icon: <FileSearchOutlined />, href: ROUTES.systemHealth },
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
type PosGuideCard = { title: string; desc: string; steps: string[]; warning?: string };
type HelpRow = { title: string; answer: string };
type LimitGroup = { title: string; items: string[] };
type StepItem = { title: string; description: string };
type LinkStep = { title: string; description: React.ReactNode };
type ShortcutLink = { label: string; href: string; icon: React.ReactNode };
type OnboardingCard = { title: string; desc: string; steps: string[]; href: string; ctaLabel: string };
type SidebarMapItem = { label: string; href: string; note: string };
type SidebarMapGroup = { title: string; items: SidebarMapItem[] };
type SearchResult = { id: string; title: string; score: number; snippets: string[] };

type ManualContent = {
  heroTag: string;
  heroTitle: string;
  heroLead: string;
  heroAlertMessage: string;
  heroAlertDesc: string;
  heroCtaQuickstart: string;
  heroCtaWorkflow: string;
  heroCtaMenus: string;
  downloadLabel: string;
  heroTags: string[];
  searchPlaceholder: string;
  searchHelp: string;
  searchResultsLabel: string;
  searchNoResults: string;
  searchOpenSection: string;
  anchors: {
    hero: string;
    onboarding: string;
    quickstart: string;
    workflow: string;
    archetypes: string;
    coupons: string;
    pos: string;
    menus: string;
    sidebarMap: string;
    faq: string;
    limits: string;
    links: string;
  };
  onboardingTitle: string;
  onboardingSubtitle: string;
  onboardingCards: OnboardingCard[];
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
  posTitle: string;
  posSubtitle: string;
  posAlertMessage: string;
  posAlertDesc: string;
  posBeforeOpenTitle: string;
  posBeforeOpenSteps: StepItem[];
  posDailyTitle: string;
  posGuideCards: PosGuideCard[];
  posPermissionsTitle: string;
  posPermissions: string[];
  posBoundariesTitle: string;
  posBoundaries: string[];
  posOpenLabels: string[];
  menusTitle: string;
  menusSubtitle: string;
  menuCards: MenuCard[];
  menuOpenPagePrefix: string;
  menuGroupingAlertMessage: string;
  menuGroupingAlertDesc: string;
  sidebarMapTitle: string;
  sidebarMapSubtitle: string;
  sidebarMapGroups: SidebarMapGroup[];
  faqTitle: string;
  faqSubtitle: string;
  helpRows: HelpRow[];
  limitsTitle: string;
  limitsSubtitle: string;
  limitsGroups: LimitGroup[];
  linksTitle: string;
  linksSubtitle: string;
  linkSteps: LinkStep[];
  linksAlertMessage: string;
  linksAlertDesc: string;
  sidebarTocTitle: string;
  sidebarShortcutsTitle: string;
  sidebarShortcuts: ShortcutLink[];
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
    title: "Dashboard",
    desc: "ดูภาพรวมวันนี้, งานค้าง, สต็อกเสี่ยง, action ที่ระบบแนะนำ และสุขภาพช่องทางขาย",
    bullets: [
      "เริ่มวันจากยอดขายวันนี้, จำนวนออเดอร์, ลูกค้า, และ low stock",
      "ดูการ์ดงานด่วน เช่น แชทรอ, สลิปรอตรวจ, ออเดอร์รอแพ็ก และจองสินค้าที่ใกล้หมดเวลา",
      "Phase 1 ใช้ refresh action เพื่อให้ระบบเสนอสิ่งที่ควรทำต่อ เช่น ซื้อเพิ่ม, เร่งแพ็ก, หรือแก้สต็อก",
      "บันทึก lost sale หรือปรับ inventory policy จากหน้าเดียวได้ เพื่อให้คำแนะนำรอบถัดไปแม่นขึ้น",
      "ดูสถานะช่องทางขายว่า ยังไม่ตั้งค่า / ปิดเอง / มีปัญหาจริง และกดต่อไปหน้า Settings ได้",
    ],
  },
  {
    title: "Inbox",
    desc: "รับแชท, ดู Customer 360, assign staff, ตามงานต่อจากแชท",
    bullets: ["เริ่มงานจากแชทใหม่", "Customer 360 สร้างออเดอร์และออกใบแจ้งหนี้ได้ตามสิทธิ์", "ออเดอร์ล่าสุดเปิดดูแบบ preview ใน Inbox ได้ก่อน และมีปุ่มเปิดหน้า Orders เต็มจอเป็นแท็บใหม่", "รูป/ไฟล์จะเข้า draft ก่อนส่งและแนบได้ครั้งละ 1 รายการ", "ข้อความ รูป ไฟล์ สินค้า และคูปองจะแสดงคนละรูปแบบ: bubble ข้อความ, การ์ดรูป, การ์ดไฟล์, การ์ดสินค้า และการ์ดคูปอง", "สินค้าแชร์ public link ให้ลูกค้าดูราคา สต็อก และ gallery ได้; ในแชทแนบเฉพาะรูป cover และกด ดูสินค้า จากการ์ดได้", "คูปองส่งเป็นข้อความ fallback ทุกช่องทางพร้อมลิงก์กระเป๋าคูปอง ระบบเพิ่มสิทธิ์เข้า wallet ตอนส่งจริง ลูกค้าไม่ต้องกดรับ", "AI ตรวจคูปองจาก backend ก่อนตอบลูกค้า ถ้าโค้ดใช้ไม่ได้จะบอกเหตุผลและเสนอคูปองที่ยังใช้ได้แทน แต่จะไม่ใช้คูปองจากข้อความอิสระ", "ลิงก์ Products หลังบ้านเปิดแท็บใหม่สำหรับพนักงานและไม่ถูกส่งให้ลูกค้า", "มือถือใช้ flow รายชื่อ → แชทเต็มจอ พร้อมปุ่มย้อนกลับ", "แชทที่เปิดอยู่จะอ่านและล้าง badge อัตโนมัติเมื่อข้อความเข้า", "อยู่ท้ายแชทจะเลื่อนตามอัตโนมัติ; ถ้าอ่านย้อนหลังให้กดปุ่มข้อความใหม่เพื่อลงด้านล่าง", "ดูข้อมูลลูกค้าไม่ต้องสลับหน้า", "เหมาะกับทีมขาย/แอดมินหน้าร้าน"],
  },
  {
    title: "Products",
    desc: "เพิ่มสินค้า, รูปหลายรูป, SKU/บาร์โค้ด, stock, ราคาขาย, ราคาส่ง และสถานะพร้อมขาย",
    bullets: [
      "รูปแรกเป็น cover และรูปที่เหลือเป็น gallery ของหน้าสินค้าสาธารณะ",
      "ตั้ง SKU, barcode, ราคา, active, reorder point และ stock ต่อไซซ์ให้ครบก่อนขาย",
      "Import CSV/XLSX ใช้กับข้อมูลจำนวนมาก โดยระบบ preview ก่อนว่าจะสร้าง / อัปเดต / ข้ามอะไร",
      "ขยายแถวสินค้าเพื่อดู stock ต่อไซซ์และใช้ quick adjust / manual entry / bulk adjustment",
      "ตัวเลขในคอลัมน์ จอง กดได้ เพื่อดูว่าบิลไหนถือของไซซ์นั้นอยู่ (PENDING / PAID / PACKING) พร้อมจำนวน ลูกค้า ช่องทาง สาขา และป้ายว่าเป็นมัดจำหรือของที่จองผ่านเซ็ต; ต้องมีสิทธิ์ดูออเดอร์ (order.view)",
      "ถ้าหน้านั้นบอกว่ามีของถูกจองแต่ไม่มีบิลเป็นเจ้าของ = มีการจองค้างที่ขายไม่ได้ ให้แจ้งผู้ดูแลระบบ ไม่ใช่ปรับ stock ทับ",
      "สินค้าที่จะใช้หน้าร้านเพิ่มหน่วยขายและบาร์โค้ดเสริมได้ที่ Product packs และพิมพ์สติกเกอร์ได้ที่ Product labels",
    ],
  },
  {
    title: "Purchase",
    desc: "สร้าง PO, เลือกผู้ขาย, รับของเข้าคลัง และอ้างอิงต้นทุนล่าสุดได้จาก workflow เดิม",
    bullets: [
      "เลือก supplier ก่อนสร้าง PO เพื่อค้นได้ทั้ง SKU ร้านและ SKU ผู้ขาย",
      "ครั้งแรกให้จับคู่ SKU ผู้ขายกับ SKU ร้าน + ไซซ์ แล้วระบบจะจำ mapping ไปใช้ครั้งถัดไป",
      "ตอนรับของให้ตรวจจำนวน Lot/Expiry และสถานะ OPEN / PARTIAL / RECEIVED",
      "รับของจากหน้า Purchase ได้ หรือใช้ PO เดิมใน POS Receive เพื่อสแกนเป็นร่างแล้วค่อยยืนยันเข้าสต็อกสาขาของเครื่อง",
    ],
  },
  {
    title: "Orders / Payment / Shipping",
    desc: "สามหน้านี้ใช้ต่อเนื่องกัน: สร้างและตามออเดอร์ → ตรวจรับชำระ → ส่งของและตาม tracking",
    bullets: [
      "Orders ใช้ติดตามสถานะ PENDING / PAID / PACKING / SHIPPED / COMPLETED / CANCELLED / RETURNED",
      "Payment ใช้ตรวจสลิป, ยืนยัน/ปฏิเสธ, และทำ refund ตามสิทธิ์",
      "Shipping ใช้สร้าง shipment, ใส่ tracking, sync carrier และปิดงานเมื่อ DELIVERED",
      "ทุกหน้ามี search เพื่อหา order id, payment id, shipment id, tracking หรือข้อมูลลูกค้าที่เกี่ยวข้อง",
      "ยอดบน Orders แสดง subtotal, ส่วนลดคูปอง, และยอดสุทธิให้เห็นชัดก่อนตามงานต่อ",
    ],
  },
  {
    title: "Customers & สมาชิก",
    desc: "ดูข้อมูล CRM, ที่อยู่, ประวัติซื้อ, คูปองของลูกค้า และโปรแกรมสมาชิก/แต้ม",
    bullets: [
      "Customers ใช้ค้นหาชื่อ/เบอร์/ลูกค้าเดิม และ merge duplicate ตามสิทธิ์",
      "หนึ่งลูกค้ามีหลายที่อยู่ได้ และที่อยู่จัดส่งต้องพร้อมก่อนใช้ Shipping กับช่องทางแชททั่วไป",
      "Loyalty ใช้ตั้งคะแนน, tier, ledger แต้ม, และปรับแต้มด้วยมือเมื่อมีสิทธิ์",
      "Customer 360 ใน Inbox เชื่อมกับ CRM เดิมโดยตรง จึงควรทำความสะอาดข้อมูลลูกค้าที่นี่ด้วย",
    ],
  },
  {
    title: "Coupons / Follow-up Rules / Follow-up Queue",
    desc: "จัดการคูปอง, ดู wallet ลูกค้า, ตั้งกติกาติดตาม และทำงานจากคิว follow-up กับคิวรอของเข้า",
    bullets: [
      "Coupons ใช้สร้าง master coupon, ตั้ง quota/ขั้นต่ำ/วันใช้ได้ และดูว่าแต่ละโค้ดถูกใช้กับใครบ้าง",
      "Follow-up Rules ใช้ตั้งกฎให้ระบบสร้างงานติดตามแบบอัตโนมัติจากพฤติกรรมลูกค้าหรือสถานะงาน",
      "Follow-up Queue ใช้รับงานที่ระบบสร้างแล้ว, review ข้อความ, accept, contact, หรือปิดงานพร้อมเหตุผล",
      "Restock subscriptions เป็นคิวเฉพาะสำหรับลูกค้าที่ยินยอมให้แจ้งเมื่อของกลับเข้า",
    ],
  },
  {
    title: "Pharmacy Intake Lab / Queue / Protocols",
    desc: "สำหรับร้านยาหรือทีมที่ใช้ pharmacy workflow: คัดกรองเคส, ตรวจคิว, และตั้ง protocol/สิทธิ์เภสัชกร",
    bullets: [
      "Pharmacy Intake Lab ใช้ทดลองหรือกรอก intake เพื่อดูว่าเคสไหนต้องส่งต่อเภสัชกรและควรเก็บข้อมูลอะไรเพิ่ม",
      "Pharmacy Intake Queue รวมเคสฉุกเฉิน เคสรอยืนยัน และงานที่ต้องให้คนมีใบอนุญาตตัดสินใจต่อ",
      "Pharmacy Protocols ใช้ตั้งกฎ/คำถาม/เงื่อนไขที่ workflow ร้านยาจะอ้างอิงตอนคัดกรอง",
      "Pharmacist Licenses ใช้ผูกข้อมูลผู้มีใบอนุญาตสำหรับร้านที่เปิด flow นี้ — ตัวโมเดลไม่ใช่ผู้ตัดสินใจทางคลินิก",
    ],
  },
  {
    title: "POS Devices / Product packs / Product labels / POS Readiness",
    desc: "เตรียมเครื่องหน้าร้าน, PIN, หน่วยขาย, สติกเกอร์ และเช็กความพร้อมก่อนเปิดขาย",
    bullets: [
      "POS Devices ใช้เพิ่มเครื่องขาย, ออก token จับคู่, ตั้งสาขา, และจัดการ PIN พนักงานหน้าร้าน",
      "POS Readiness ใช้เช็ก blocker ก่อนเปิดขาย เช่น VAT, สต็อก, refund ค้าง, และสินค้าที่ยังไม่พร้อม",
      "Product packs ใช้เพิ่มหน่วยขาย + barcode ของ pack หรือหลายหน่วย",
      "Product labels ใช้พิมพ์สติกเกอร์บาร์โค้ดจากข้อมูลสินค้า/pack ที่ตั้งไว้แล้ว",
    ],
  },
  {
    title: "POS / Loyalty",
    desc: "ขายหน้าร้าน, สมาชิก/แต้ม, พักบิล, เงินลิ้นชัก, void และรายงานกะ",
    bullets: [
      "เปิดกะและยืนยันตัวพนักงานด้วย PIN ก่อนขาย; device token ระบุเครื่องและสาขา ไม่ใช่ตัวบุคคล",
      "Bluetooth HID เป็น Keyboard: ตั้ง Scanner ของเครื่องเป็น Prefix Mode (เช่น F9 + ข้อมูล + Enter) ที่หน้าเครื่องขาย เพื่อให้สแกนได้แม้กำลังพิมพ์ค้นสมาชิก/PIN โดยข้อมูลไม่หลุดเข้าช่องนั้น",
      "แท็บรับของให้เลือก PO ก่อน สแกนเป็นรายการร่าง ตรวจจำนวน/lot/วันหมดอายุ แล้วกดยืนยันครั้งเดียว; ต้องมีสิทธิ์ purchase.receive และของเข้าที่สาขาของเครื่องนี้",
      "ค้นหาสมาชิกก่อนชำระเพื่อใช้ส่วนลดตาม tier และแต้ม; ตั้งโปรแกรมและตรวจ ledger ที่ /admin/loyalty",
      "ราคาส่งเลือกได้ 2 แบบที่หน้า Products: ราคาคงที่เลือกไซซ์ M/XL ฯลฯ แยกกันได้ (หรือเลือกทุกไซซ์ให้ราคาเดียวกัน) และตั้งขั้นต่ำเท่ากันแต่ราคาคนละค่าได้; แบบรวมทุกไซซ์จะรวมจำนวนแล้วลดเปอร์เซ็นต์จากราคาปกติของแต่ละไซซ์ เช่น S/M/L รวมครบ 10 ชิ้น ลด 20% แต่ละไซซ์จึงยังมีราคาต่างกัน",
      "การแลกแต้มพิมพ์จำนวนในช่องกลางได้ หรือใช้ปุ่ม +/- ซึ่งขยับครั้งละ 1 หน่วยตามอัตราร้าน; ระบบใช้เฉพาะหน่วยเต็มและเก็บเศษไว้ เช่น มี 3,045 แต้ม อัตรา 100 แต้มต่อหน่วย ระบบใช้ 3,000 และคงเหลือ 45 แต้ม",
      "ก่อนรับเงิน ระบบจะตรวจราคาปกติ ราคาส่ง pack และโปรโมชันล่าสุดอีกครั้ง หากมีการแก้สินค้าหลังยิงเข้าตะกร้า ระบบจะอัปเดตยอดและให้ตรวจรับเงินใหม่แทนการขายด้วยราคาเก่า",
      "พักบิลได้ไม่เกิน 20 บิลต่อกะ แต่ไม่จอง stock และไม่ล็อกราคา; ตอนกลับมาขายระบบใช้ราคาและ stock ปัจจุบัน",
      "แท็บมัดจำใช้รับเงินครั้งแรก/รับเพิ่ม/รับยอดคงเหลือ/ปิดมัดจำของสาขานี้; รับครบต้องใช้ปุ่มรับยอดคงเหลือเพื่อส่งของ ตัด stock และออกเอกสารในขั้นเดียว — ถ้ามีสินค้าบังคับเลขเครื่อง ให้ยิงสินค้ากับ serial จริงใส่ตะกร้าก่อนกดรับยอดคงเหลือ",
      "ยอดขายเงินสดถูกนับเข้าลิ้นชักอัตโนมัติเมื่อขายสำเร็จ ห้ามบันทึกเป็นเงินเข้าซ้ำ; เมนูเงินเข้าใช้เฉพาะเงินจากนอกยอดขาย เช่น เติมเงินทอนจากเจ้าของหรือรับจากลิ้นชักอื่น ทุกเงินเข้า/ออกต้องมีเหตุผล และเงินออกต้องใช้ PIN ผู้อนุมัติคนที่สองเสมอ",
      "ค่าใช้จ่ายหน้าร้านแยกจากการย้ายเงิน: จ่ายค่าน้ำแข็ง/วัตถุดิบแบบจ่ายตรง หรือเบิกไปซื้อแล้วกลับมาลงยอดจริง; เงินทอนจะกลับเข้าลิ้นชักและเงินเกินจะออกเพิ่มอัตโนมัติ โดยต้องปิดยอดเบิกทั้งหมดก่อนปิดกะ",
      "ร้านที่มีเจ้าของคนเดียวเลือก ‘เจ้าของคนเดียว · สำรองจ่ายส่วนตัว’ ได้ บัญชีต้องมีสิทธิ์ pos.expense.personal และต้องใส่เลขที่ใบเสร็จ/หลักฐาน รายการนี้เป็นค่าใช้จ่ายของร้านแต่ไม่หักเงินในลิ้นชัก; การคืนเงินให้เจ้าของภายหลังยังเป็นเงินออกและต้องมีผู้อนุมัติคนที่สอง",
      "ถ้าต้องจ่ายของจุกจิกบ่อย ให้เลือกบัญชี Administrator ที่เครื่อง POS ใส่ PIN แล้วกดตรวจสิทธิ์/ยอดใหม่ จากนั้นเติม ‘กระเป๋าเงินสดย่อยสาขา’ จากเงินเจ้าของหรือบัญชีร้านพร้อมหลักฐาน; พนักงานจึงเลือกวิธีจ่าย ‘เงินสดย่อยร้าน’ ได้ ระบบหักจากยอดกระเป๋าและไม่แตะยอดลิ้นชัก",
      "Void ใช้เมื่อบิลลงผิดและกะยังเปิด ต้องมีเหตุผลกับผู้อนุมัติคนที่สอง; หลังปิดกะให้ทำ Return แทน",
      "ดู X report ระหว่างกะและ Z report หลังปิดกะ เพื่อตรวจยอดคาดหวัง ยอดนับจริง และผลต่าง",
    ],
  },
  {
    title: "Locations / Stock Transfers / Stock Counts",
    desc: "จัดการโครงสร้างสาขาและงานคลังระหว่างสาขา รวมถึงการนับชั้นวางแบบไม่ทับยอดขายระหว่างนับ",
    bullets: [
      "Locations ใช้เพิ่ม/แก้สาขาที่จะรับ stock, ใช้กับ POS, และเป็นปลายทางของงานโอน",
      "หน้า Products แสดงสต็อกเป็นสาขา × ไซซ์ พร้อมยอดรวมทุกสาขา ของระหว่างทาง และของกักกัน; การปรับยอดและจุดเตือนต้องระบุสาขาเสมอ",
      "ใบโอนทำสองขั้น: ส่งออกจากต้นทาง แล้วรับเข้าปลายทาง; ของระหว่างทางไม่อยู่ใน stock ของสาขาใด",
      "ตอนรับให้แยกจำนวนรับสภาพดี เสียหาย/กักกัน และไม่พบ; ถ้ามีส่วนต่างต้องเลือกสาเหตุและกรอกหมายเหตุ สินค้าเสียหายจะไม่เข้ายอดพร้อมขาย",
      "ใบนับเก็บ snapshot ตอนกรอกรายการครั้งแรก และตอน Apply จะเพิ่มเฉพาะผลต่าง ไม่เขียนทับยอดปัจจุบัน",
      "พนักงานคลังที่มี inventory.count กรอกตัวเลขได้ แต่ต้องมี inventory.count.apply จึงยืนยันผลต่างเข้าสต็อกจริงได้",
      "เริ่มจาก Locations ถ้าร้านยังไม่มีหลายสาขา จากนั้นค่อยใช้ Stock Transfers และ Stock Counts",
    ],
  },
  {
    title: "Reports & Commission",
    desc: "ดู KPI ย้อนหลัง, ดาวน์โหลดไฟล์รายงาน, และเช็กคอมมิชชันพนักงานขาย",
    bullets: [
      "Reports มี date range, KPI ยอดขาย, top products, inventory summary, และรายงาน POS returns / refunds",
      "AI Report Generator สร้าง Excel / CSV / PDF และเปิดดาวน์โหลดไฟล์ย้อนหลังได้",
      "ถ้าต้นทุนสินค้ายังไม่ครบ รายงานกำไรจะเตือนว่า data ไม่ครบแทนการเดาศูนย์",
      "Commission ใช้ดูอัตราคอม, ผลตามรอบเวลา, และยอดที่โดน claw back จาก return",
    ],
  },
  {
    title: "Settings / Realtime Diagnostics / Billing",
    desc: "ตั้งข้อมูลร้าน, ช่องทางขาย, webhook/token, บัญชีรับเงิน, AI provider, ทดสอบ realtime และดูแพ็กเกจ",
    bullets: [
      "Shop information ใช้กรอกชื่อร้าน, business type, เวลาเปิด, ช่องทางติดต่อ, ประเทศ, สกุลเงิน และค่าจัดส่ง",
      "Payment accounts ใช้กรอก bank / PromptPay ที่ AI และ checkout จะอ้างอิงตามของจริงเท่านั้น",
      "Channels ใช้วาง token, ตรวจสถานะสุขภาพ, และแก้ webhook ตามแต่ละแพลตฟอร์ม",
      "Realtime Diagnostics ใช้ทดสอบสัญญาณ Inbox แบบไม่ต้องรอลูกค้าจริง",
      "ตั้ง AI provider / BYOK ได้ที่นี่ แต่การยืนยันสลิปและงานการเงินยังต้องมีคนกดยืนยันเสมอ",
      "Billing ใช้ดูเครดิต AI, usage, ledger และการใกล้หมด quota ของ shared key หรือ BYOK",
    ],
  },
  {
    title: "AI Assistant / AI Quality",
    desc: "ถามข้อมูลหลังบ้าน, สร้างคำขอให้คนกดยืนยัน, และตรวจคุณภาพคำตอบของ AI",
    bullets: [
      "เปิด AI Work Assistant ได้จากปุ่มลอยทุกหน้าหลังบ้าน เพื่อถามความสามารถของระบบ วิธีใช้เมนู หรือข้อมูลจริงที่สิทธิ์ของคุณอนุญาตให้ดูได้",
      "Assistant ใช้บริบทหน้าปัจจุบันช่วยตอบ เช่น ขั้นตอนหน้า POS, รายงาน, สต็อก, ลูกค้า, แต้มสะสม และคูปอง พร้อมลิงก์ไปหน้าที่ผู้ใช้เข้าถึงได้",
      "งานที่กระทบเงิน/สต็อก/การลบข้อมูลจะเป็น propose-only และต้องกด Confirm เอง",
      "AI Quality ใช้ดู success / handoff / unresolved rates, sampled conversations, และ tool failures",
      "Playground เป็นพื้นที่ทดสอบ flow แชทและ stock สำหรับทีมที่มีสิทธิ์ด้าน AI quality",
    ],
  },
  {
    title: "Profile / Users / Permissions / Audit",
    desc: "ตั้งค่าบัญชีตัวเอง, จัดการผู้ใช้ในร้าน, ดูสิทธิ์ และตรวจย้อนหลังว่าใครแก้อะไร",
    bullets: [
      "Profile ใช้ตั้งธีม, ภาษา, คำลงท้าย, รูปโปรไฟล์, และดู permission ของบัญชีตัวเอง",
      "Users ใช้เพิ่ม/แก้พนักงานในร้านตามสิทธิ์ที่มี โดยงานละเอียดเรื่อง role ยังถูกคุมที่ permission ของ server",
      "Permissions ใช้ดู matrix สิทธิ์ต่อ role สำหรับร้านของคุณ ถ้าบัญชีมีสิทธิ์เข้าถึง",
      "Audit log ใช้ตรวจ action สำคัญย้อนหลัง โดยเฉพาะเรื่องเงิน สต็อก และการอนุมัติ",
      "Getting Started เหมาะกับร้านใหม่ที่ยังตั้งร้านไม่ครบและอยากเดิน checklist แบบ onboarding",
    ],
  },
  {
    title: "Revision History",
    desc: "ดู snapshot ก่อนแก้ไข, เปิด detail, และ compare 2 version สำหรับ records สำคัญ",
    bullets: ["รองรับ Products / Orders / Payment / Shipping", "ค้นหาด้วย SKU, ID, status, reference หรือ tracking", "Editor แสดง user login สำหรับ revision ใหม่หลังระบบส่ง editor context แล้ว"],
  },
  {
    title: "Billing & Plan",
    desc: "ดูแพ็กเกจ, เครดิต AI, usage breakdown, ledger และสิ่งที่ใช้โควตาไปในเดือนนี้",
    bullets: [
      "ดูเครดิตคงเหลือ, ใช้ไปแล้ว, request count, provider calls, และ estimated cost แยกกัน",
      "ถ้าใช้ shared key ระบบจะแจ้งใกล้หมด / หมด quota เพื่อให้ทีมเตรียมรับงานด้วยมือ",
      "เปิดดู ledger เพื่อไล่ว่า AI ถูกใช้กับงานใดของร้านบ้างในรอบบิล",
      "ถ้าใช้ BYOK รายละเอียด quota จะต่างจาก shared key และยังควรกลับไปดู Settings เพื่อเช็ก provider/model",
    ],
  },
  {
    title: "Architecture / Tenants / Report Schedule / Roles",
    desc: "เมนูฝั่ง platform admin สำหรับดูโครงสร้างระบบหลายร้าน, จัดการ tenant, ตารางรายงาน, และ role กลางของทั้งระบบ",
    bullets: [
      "Architecture ใช้ดูภาพรวมองค์ประกอบของระบบและความสัมพันธ์ระดับ platform มากกว่างานปฏิบัติการรายวันของร้าน",
      "Tenants ใช้ดูหรือจัดการข้อมูลร้านทั้งหมดในมุม platform ไม่ใช่เฉพาะร้านปัจจุบัน",
      "Report Schedule ใช้ตั้งหรือทบทวนงานส่งรายงานตามเวลาให้หลายร้านหรือส่วนกลาง",
      "Roles ใช้จัดการ role กลางของระบบ; สำหรับ user ทั่วไปในร้านมักดูที่ Permissions และ Users มากกว่า",
      "กลุ่มนี้เหมาะกับ platform admin หรือทีม implement มากกว่าพนักงานร้านทั่วไป",
    ],
  },
  {
    title: "Files / Logs / Mail log / Support / Batch / Health / ENV / Dev / Playground",
    desc: "เมนูตรวจระบบ แก้ปัญหา และทดสอบภายใน โดยรอบนี้ตั้งใจไม่รวมเมนู Posts ตามที่กำหนด",
    bullets: [
      "Files ใช้ดูไฟล์ที่ระบบเก็บหรือแนบไว้ในงานต่าง ๆ ส่วน Logs และ Mail log ใช้ไล่เหตุการณ์หรือการส่งอีเมลย้อนหลัง",
      "Support Tickets ใช้ตามเรื่องปัญหาที่ถูกรายงานเข้ามา และส่งต่อให้ทีมที่เกี่ยวข้อง",
      "Batch & Cron ใช้ดูงาน background/scheduled jobs, ส่วน System Health ใช้ดูสภาพระบบแบบ read-only",
      "ENV และ Dev Console เป็นเมนูสำหรับตรวจ config หรือ query/debug ภายใน จึงควรใช้โดยคนที่เข้าใจผลกระทบของข้อมูล",
      "Fake data และ Playground ใช้ทดสอบหรือสาธิตระบบโดยไม่ปะปนกับงานร้านจริง เมื่อบัญชีมีสิทธิ์เข้าถึง",
    ],
  },
];

const ONBOARDING_CARDS_TH: OnboardingCard[] = [
  {
    title: "เริ่มร้านใหม่ใน 30 นาทีแรก",
    desc: "เหมาะกับเจ้าของร้านหรือแอดมินที่กำลังเปิดร้านใหม่และอยากให้ทีมเริ่มใช้งานได้เร็วที่สุด",
    steps: [
      "เปิด Getting Started เพื่อไล่ checklist พื้นฐานก่อนว่าร้านยังขาดอะไรบ้าง",
      "เข้า Settings เพื่อกรอกชื่อร้าน, เวลาเปิด, บัญชีรับเงิน, ค่าส่ง, webhook/token และ AI provider",
      "เข้า Products เพื่อเพิ่มสินค้าหลักอย่างน้อยชุดแรก พร้อมราคาและ stock",
      "ถ้าจะขายหน้าร้าน ให้เข้า POS Devices และ POS Readiness ก่อนเปิดขายจริง",
      "ปิดท้ายที่ Dashboard เพื่อดูว่าสัญญาณ low stock, channel health และงานค้างเริ่มสะท้อนแล้วหรือยัง",
    ],
    href: ROUTES.gettingStarted,
    ctaLabel: "เปิด Getting Started",
  },
  {
    title: "วันแรกของพนักงานตอบแชท",
    desc: "สำหรับคนที่ต้องเริ่มรับแชท, แชร์สินค้า, แจกคูปอง, และตามออเดอร์ต่อทั้งวัน",
    steps: [
      "เริ่มที่ Inbox เพื่อดูแชทใหม่, badge, และ Customer 360",
      "เรียนรู้ Mentions และ Restock subscriptions เพื่อไม่พลาดงานที่ทีมโยนต่อหรือรายการรอของเข้า",
      "ฝึกแชร์สินค้า/คูปองจาก draft ก่อนกดส่งจริง และเปิดออเดอร์จากหน้า Inbox",
      "ตามงานต่อที่ Orders, Payment, และ Shipping เป็น flow เดียว",
      "ถ้าหาลูกค้าหรือ order ไม่เจอ ให้ใช้ Customers และ search บนแต่ละหน้าแทนการไล่หาเอง",
    ],
    href: ROUTES.inbox,
    ctaLabel: "เปิด Inbox",
  },
  {
    title: "วันแรกของพนักงาน POS",
    desc: "สำหรับคนขายหน้าร้านที่ต้องเปิดกะ, รับเงิน, จัดการเงินลิ้นชัก และปิดยอดให้ถูกต้อง",
    steps: [
      "เช็ก POS Devices ว่าเครื่องจับคู่แล้ว, PIN ใช้ได้, และผูกสาขาถูกต้อง",
      "เปิด POS Readiness ดู blocker ก่อนขาย เช่น ภาษี, stock, refund ค้าง หรือสิ่งที่ร้านขายยังไม่พร้อม",
      "ลองขายบิลตัวอย่าง 1 ใบให้ครบตั้งแต่สแกน → รับเงิน → พิมพ์/ส่งใบเสร็จ",
      "เข้าใจความต่างระหว่าง Void, Return, Refund settlement, และ Cash movement ก่อนใช้กับลูกค้าจริง",
      "ก่อนจบกะให้ดู X/Z report และเคลียร์รายการค้าง โดยเฉพาะ non-cash refund ที่ยัง pending",
    ],
    href: ROUTES.posDevices,
    ctaLabel: "เปิด POS Devices",
  },
  {
    title: "เวลาไล่ปัญหาหรือเช็กว่าใครทำอะไร",
    desc: "ใช้ตอนระบบดูเหมือนไม่ทำงานตามคาด หรืออยากย้อนดูการแก้ไขและสิทธิ์",
    steps: [
      "เปิด Realtime Diagnostics เมื่อต้องเช็กว่า Inbox รับสัญญาณหรือข้อความทดสอบได้จริงไหม",
      "เปิด Audit log เพื่อตรวจ action สำคัญด้านเงิน, stock, หรือ approval",
      "เปิด Revision History เมื่อต้องดูว่า record ไหนถูกแก้อะไรไปบ้าง",
      "เปิด Permissions หรือ Users ถ้าสงสัยว่าปุ่มหายเพราะสิทธิ์ไม่พอ",
      "เปิด AI Quality เมื่อต้องย้อนดูคุณภาพคำตอบ AI หรือ tool failures",
    ],
    href: ROUTES.realtimeDiagnostics,
    ctaLabel: "เปิด Realtime Diagnostics",
  },
];

const SIDEBAR_MAP_GROUPS_TH: SidebarMapGroup[] = [
  {
    title: "เมนูบนสุดที่ใช้เปิดงานเร็ว",
    items: [
      { label: "Dashboard", href: ROUTES.dashboard, note: "ภาพรวมร้านวันนี้, งานค้าง, low stock, channel health และ action ที่ระบบแนะนำ" },
      { label: "Inbox", href: ROUTES.inbox, note: "แชทหลัก, Customer 360, แชร์สินค้า/คูปอง และจุดเริ่มต้นของงานขายรายวัน" },
      { label: "Restock subscriptions", href: ROUTES.restock, note: "คิวลูกค้าที่ขอให้แจ้งเมื่อของกลับเข้า เหมาะกับร้านที่ของหมดบ่อย" },
      { label: "Mentions", href: ROUTES.mentions, note: "ดูข้อความหรือเคสที่ทีม mention หาเรา เพื่อไม่ให้งานตกหล่น" },
      { label: "AI Assistant", href: ROUTES.assistant, note: "ถามรายงาน สต็อก ลูกค้า หรือให้ AI เตรียมงานที่ต้องให้คนกดยืนยันต่อ" },
    ],
  },
  {
    title: "กลุ่มร้านค้าและออเดอร์",
    items: [
      { label: "Products", href: ROUTES.products, note: "เพิ่มสินค้า, ราคา, stock, รูป, import, และข้อมูลพร้อมขาย" },
      { label: "Orders", href: ROUTES.orders, note: "ติดตามออเดอร์ตั้งแต่ PENDING จนถึงปิดงาน" },
      { label: "Payment", href: ROUTES.payment, note: "ตรวจสลิป, confirm/reject และ refund ตามสิทธิ์" },
      { label: "Shipping", href: ROUTES.shipment, note: "สร้าง shipment, ใส่ tracking, sync carrier และปิดงาน" },
      { label: "Customers", href: ROUTES.customers, note: "CRM, ที่อยู่, ประวัติซื้อ, merge และข้อมูลลูกค้า" },
      { label: "Coupons", href: ROUTES.coupons, note: "สร้างและจัดการ master coupon พร้อมดูการใช้งานจริง" },
      { label: "Members & Points", href: ROUTES.loyalty, note: "โปรแกรมสมาชิก, tier, ledger แต้ม และการปรับแต้ม" },
      { label: "Follow-up Rules", href: ROUTES.followupRules, note: "ตั้งกติกาให้ระบบสร้างงานติดตามอัตโนมัติ" },
      { label: "Follow-up Queue", href: ROUTES.followupQueue, note: "คิวงานติดตามที่ทีมต้องรับทำ ติดต่อ หรือปิดพร้อมเหตุผล" },
      { label: "Purchase (PO)", href: ROUTES.purchase, note: "สร้าง PO, จับคู่ SKU ผู้ขาย, และรับของเข้าคลัง" },
      { label: "Locations", href: ROUTES.locations, note: "ตั้งสาขา/คลังที่ใช้กับ POS และงานโอนสต็อก" },
      { label: "Stock Transfers", href: ROUTES.stockTransfers, note: "โอนของระหว่างสาขาแบบส่งออก/รับเข้า 2 ขั้น" },
      { label: "Stock Counts", href: ROUTES.stockCounts, note: "นับสต็อกแบบ snapshot + apply ส่วนต่างโดยไม่ทับยอดขายระหว่างนับ" },
    ],
  },
  {
    title: "กลุ่ม Pharmacy และ POS",
    items: [
      { label: "Pharmacy Intake Lab", href: ROUTES.pharmacyIntakeLab, note: "ซ้อมหรือกรอก intake เพื่อตรวจว่าต้องถามอะไรและต้องส่งต่อไหม" },
      { label: "Pharmacy Intake Queue", href: ROUTES.pharmacyQueue, note: "คิวเคสจริงที่ต้องให้ทีมร้านยาหรือผู้มีใบอนุญาตตามต่อ" },
      { label: "Pharmacy Protocols", href: ROUTES.pharmacyProtocols, note: "ตั้งคำถาม กฎคัดกรอง และ protocol ของ flow ร้านยา" },
      { label: "Pharmacist Licenses", href: ROUTES.pharmacistLicenses, note: "ข้อมูลผู้มีใบอนุญาตสำหรับร้านที่ใช้ pharmacy workflow" },
      { label: "POS Devices", href: ROUTES.posDevices, note: "เพิ่มเครื่องขาย, ออก token, ตั้งสาขา และ PIN พนักงานหน้าร้าน" },
      { label: "Product packs", href: ROUTES.productPacks, note: "เพิ่มหน่วยขาย/บาร์โค้ดเสริม เช่น pack หรือหลายชิ้นต่อหน่วย" },
      { label: "Product labels", href: ROUTES.productLabels, note: "พิมพ์สติกเกอร์บาร์โค้ดจากสินค้าและ pack ที่ตั้งไว้แล้ว" },
      { label: "POS Readiness", href: ROUTES.posReadiness, note: "เช็ก blocker ก่อนเปิดหน้าร้าน เช่น VAT, stock, refund ค้าง และเงื่อนไขเฉพาะบางธุรกิจ" },
    ],
  },
  {
    title: "รายงาน การตั้งค่า และการควบคุมสิทธิ์",
    items: [
      { label: "Reports", href: ROUTES.reports, note: "KPI ย้อนหลัง, รายงานยอดขาย/สต็อก และ AI Report Generator" },
      { label: "Commission", href: ROUTES.commission, note: "อัตราคอม, ผลตามรอบ และ clawback หลัง return" },
      { label: "AI Quality", href: ROUTES.aiQuality, note: "success/handoff/unresolved, sampled conversations และ tool failures" },
      { label: "Settings", href: ROUTES.settings, note: "ข้อมูลร้าน, payment account, channel token/webhook, AI provider, ค่าส่ง และค่า default ต่าง ๆ" },
      { label: "Realtime Diagnostics", href: ROUTES.realtimeDiagnostics, note: "ทดสอบ realtime signal และสร้างข้อความทดสอบเข้า Inbox" },
      { label: "Billing & Plan", href: ROUTES.billing, note: "เครดิต AI, usage, ledger และสถานะแพ็กเกจ/โควตา" },
      { label: "Users", href: ROUTES.users, note: "เพิ่ม/แก้บัญชีพนักงานตามสิทธิ์ที่มี" },
      { label: "Permissions", href: ROUTES.permissions, note: "ดู matrix สิทธิ์ของ role ใน tenant ปัจจุบัน" },
      { label: "Audit log", href: ROUTES.audit, note: "ตรวจย้อนหลัง action สำคัญ โดยเฉพาะเรื่องเงิน สต็อก และ approval" },
      { label: "Revision History", href: ROUTES.revisions, note: "เทียบก่อน-หลังการแก้ไขของ record สำคัญ" },
    ],
  },
  {
    title: "เมนู platform / system / dev (ไม่รวม Post ตามที่กำหนด)",
    items: [
      { label: "Architecture", href: ROUTES.architecture, note: "ภาพรวมสถาปัตยกรรมและองค์ประกอบระดับ platform" },
      { label: "Tenants", href: ROUTES.tenants, note: "ดูและจัดการร้านทั้งหมดในมุม platform admin" },
      { label: "Report Schedule", href: ROUTES.reportSchedule, note: "ตั้งหรือตรวจงานส่งรายงานแบบตามเวลา" },
      { label: "Roles", href: ROUTES.roles, note: "จัดการ role กลางของทั้งระบบ" },
      { label: "Files", href: ROUTES.files, note: "ดูไฟล์หรือ asset ที่ระบบเก็บและใช้ในงานต่าง ๆ" },
      { label: "Logs", href: ROUTES.logs, note: "ไล่ system logs และเหตุการณ์ย้อนหลัง" },
      { label: "Mail log", href: ROUTES.mailLog, note: "ตรวจการส่งอีเมลและการส่งไม่สำเร็จ" },
      { label: "Support Tickets", href: ROUTES.supportTickets, note: "คิวเรื่องปัญหาหรือ ticket ที่ทีมต้องติดตาม" },
      { label: "Batch & Cron", href: ROUTES.operationsSchedule, note: "ดูงาน background, batch และ schedule ที่รันตามเวลา" },
      { label: "System Health", href: ROUTES.systemHealth, note: "หน้าสรุปสุขภาพระบบแบบ read-only สำหรับเช็กสถานะตอนนี้" },
      { label: "ENV", href: ROUTES.env, note: "ตรวจ environment/config ที่เกี่ยวกับการทำงานของระบบ" },
      { label: "Dev Console", href: ROUTES.devSqlConsole, note: "หน้าสำหรับ debug/query ภายใน ใช้โดยคนที่เข้าใจผลกระทบของข้อมูล" },
      { label: "Fake data", href: ROUTES.fakeData, note: "เตรียมข้อมูลตัวอย่างสำหรับ demo หรือทดสอบ" },
      { label: "Playground", href: ROUTES.playground, note: "พื้นที่ทดสอบ flow และ behavior แบบควบคุมได้" },
    ],
  },
];

/**
 * The FAQ now lives in the assistant's knowledge catalog (`lib/bms/assistantKnowledge/faq.ts`),
 * not here. Two copies of the same answer drift, and only one of them was ever reachable from
 * chat: staff who asked the assistant "กดจัดส่งไม่ได้" got generic steps while the real answer sat
 * on this page. This renders that catalog; the catalog is what the assistant retrieves.
 */
const HELP_ROWS_TH: HelpRow[] = SYSTEM_FAQ.map((faq) => ({ title: faq.question.th, answer: faq.answer.th }));

/**
 * Limits and traps now live in the assistant's catalog (`lib/bms/assistantKnowledge/limits.ts`)
 * so the assistant can quote them. They were unreachable from chat while they lived here: the
 * assistant could explain how to run a profit report but not that it applies today's cost to last
 * month's revenue. This renders that catalog.
 */
const LIMIT_GROUPS_TH: LimitGroup[] = SYSTEM_LIMITS.map((group) => ({ title: group.title.th, items: [...group.items.th] }));

const LINK_STEPS_TH: LinkStep[] = [
  {
    title: "ตั้งร้านใหม่แบบมี checklist",
    description: <>เปิด <Link href={ROUTES.gettingStarted}>Getting Started</Link> เพื่อไล่ setup ร้าน, ช่องทางขาย, สินค้า, และ onboarding step ที่ยังไม่ครบ</>,
  },
  {
    title: "ดูภาพรวมและ action ที่ควรทำวันนี้",
    description: <>เปิด <Link href={ROUTES.dashboard}>Dashboard</Link> เพื่อดู KPI วันนี้, งานค้าง, low stock, channel health, และ action ที่ระบบแนะนำ</>,
  },
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
    description: <>เปิด {L.purchase} เลือกผู้ขาย แล้วจับคู่ SKU ผู้ขายกับ SKU ร้าน + ไซซ์ในรายการ PO ครั้งแรก ระบบจะจำ mapping และทุนล่าสุดไว้ใช้ครั้งถัดไป โดยตอนรับของและตัดสต็อกยังยึด SKU ร้านเสมอ จากนั้นรับของในหน้า Purchase หรือเลือก PO เดิมในแท็บ รับของ ของหน้า POS เพื่อสแกนเป็นร่างและยืนยันเข้าสต็อกสาขาของเครื่อง</>,
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
    title: "จัดการลูกค้า สมาชิก แต้ม และคูปอง",
    description: <>เปิด <Link href={ROUTES.customers}>Customers</Link>, <Link href={ROUTES.loyalty}>Loyalty</Link>, และ <Link href={ROUTES.coupons}>Coupons</Link> เพื่อดู CRM, wallet คูปอง, tier, ledger แต้ม และสิทธิ์ลูกค้า</>,
  },
  {
    title: "ทำงานจากคิวติดตามและคิวรอของเข้า",
    description: <>เปิด <Link href={ROUTES.followupRules}>Follow-up Rules</Link>, <Link href={ROUTES.followupQueue}>Follow-up Queue</Link>, และ <Link href={ROUTES.restock}>Restock subscriptions</Link> เพื่อให้ระบบสร้างงานและให้ทีมปิดงานต่อจากคิว</>,
  },
  {
    title: "ร้านยาหรือเคสที่ต้องคัดกรองโดยเภสัชกร",
    description: <>เปิด <Link href={ROUTES.pharmacyIntakeLab}>Pharmacy Intake Lab</Link> เพื่อซ้อมหรือกรอกเคส, ดู <Link href={ROUTES.pharmacyQueue}>Pharmacy Intake Queue</Link> สำหรับคิวจริง, และใช้ <Link href={ROUTES.pharmacyProtocols}>Pharmacy Protocols</Link> เมื่อต้องปรับกฎคำถามหรือขั้นตอนคัดกรอง</>,
  },
  {
    title: "ตั้งสาขา โอนของ และนับสต็อก",
    description: <>เปิด <Link href={ROUTES.locations}>Locations</Link>, <Link href={ROUTES.stockTransfers}>Stock Transfers</Link>, และ <Link href={ROUTES.stockCounts}>Stock Counts</Link> เมื่อต้องทำงานหลายสาขาหรือเช็กสต็อกจริงบนชั้นวาง</>,
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
        หรือกำไรขั้นต้น (ค่าประมาณ) แล้วดาวน์โหลดภายหลังจากประวัติรายงานเดิมได้ · ยอดขายสุทธิแยก
        refund ตามวันที่คืนเงินจริง และถ้าสินค้าบางตัวไม่มีต้นทุน รายงานกำไรจะแสดงว่า “ข้อมูลไม่ครบ”
        แทนการเดาต้นทุนเป็นศูนย์ · ร้านใหม่ที่ประวัติยังน้อยจะยังไม่แนะนำยอดสั่งซื้อแบบฟันธง · ถ้าต้องการตรวจคำตอบรายเคสให้เปิด{" "}
        {L.aiQuality} เพื่อดู success/handoff/unresolved rate,
        failure cases และบทสนทนาที่สุ่มตรวจ โดยระบบปิดบังข้อมูลส่วนบุคคลในหน้าตรวจให้อัตโนมัติ
      </>
    ),
  },
  {
    title: "ดูคอมมิชชัน รายงาน และเครดิต AI",
    description: <>เปิด <Link href={ROUTES.reports}>Reports</Link>, <Link href={ROUTES.commission}>Commission</Link>, และ <Link href={ROUTES.billing}>Billing</Link> เพื่อดูไฟล์รายงาน, อัตราคอม, usage AI และ ledger ของรอบบิล</>,
  },
  {
    title: "จัดการบัญชีตัวเองและผู้ใช้ในร้าน",
    description: <>เปิด <Link href={ROUTES.profile}>Profile</Link> เพื่อตั้งธีม/ภาษา/คำลงท้าย และเปิด <Link href={ROUTES.users}>Users</Link> เมื่อต้องเพิ่มหรือแก้บัญชีพนักงานตามสิทธิ์ที่มี</>,
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
  downloadLabel: "ดาวน์โหลดคู่มือ (.md)",
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
  searchPlaceholder: "ค้นหาคู่มือ เช่น คืนสินค้า, POS, คูปอง, จัดส่ง",
  searchHelp: "พิมพ์คำที่อยากหา แล้วกดเข้าหัวข้อที่เกี่ยวข้องได้ทันที",
  searchResultsLabel: "ผลลัพธ์ในคู่มือ",
  searchNoResults: "ยังไม่เจอคำนี้ในคู่มือ ลองใช้คำสั้นลงหรือเปลี่ยนคำค้น",
  searchOpenSection: "เปิดหัวข้อนี้",
  anchors: {
    hero: "เริ่มต้นเร็ว",
    onboarding: "Onboarding วันแรก",
    quickstart: "Quick start ตามบทบาท",
    workflow: "Flow งานทั้งระบบ",
    archetypes: "ตัวอย่างตามประเภทร้าน",
    coupons: "คู่มือคูปอง",
    pos: "คู่มือ POS ฉบับเต็ม",
    menus: "คู่มือตามเมนู",
    sidebarMap: "แผนที่เมนูตาม Sidebar",
    faq: "คำถามที่เจอบ่อย",
    limits: "ข้อจำกัดที่ควรรู้",
    links: "ลิงก์ไปหน้าที่ใช้บ่อย",
  },
  onboardingTitle: "🪜 Onboarding วันแรก",
  onboardingSubtitle: "ใช้ส่วนนี้สอนคนใหม่แบบทำตามได้จริง แยกตามงานที่เขาจะรับผิดชอบในวันแรก",
  onboardingCards: ONBOARDING_CARDS_TH,
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
        "ดู Tenants, Report Schedule, Logs, System Health, และ ENV เมื่อต้องดูแลหลายร้านหรือไล่ปัญหาระดับระบบ",
        "ใช้ Dev Console, Fake data, หรือ Playground เฉพาะตอนทดสอบ/ดีบักภายใน",
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
      "ตั้งราคา, stock และ reorder point ต่อไซซ์ · เว้นราคาของไซซ์ว่างเพื่อใช้ราคาหลักของสินค้า",
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
  posTitle: "🧾 คู่มือ POS ฉบับใช้งานจริง",
  posSubtitle: "ตั้งเครื่อง เปิดกะ ขาย รับเงิน คืนสินค้า รับของ และปิดกะ ตามลำดับที่พนักงานใช้จริงบน /pos",
  posAlertMessage: "เครื่องระบุสาขา · PIN ระบุคนทำรายการ · สิทธิ์กำหนดสิ่งที่ทำได้",
  posAlertDesc:
    "การจับคู่เครื่องอย่างเดียวไม่อนุญาตให้ย้ายเงินหรือสต็อก ทุก action สำคัญตรวจ PIN และ permission ที่ server อีกครั้ง และงานที่เงินออกจากการควบคุม เช่น ส่วนลดมือ, void และเงินออกจากลิ้นชัก ต้องใช้ PIN ผู้อนุมัติคนที่สอง",
  posBeforeOpenTitle: "ตั้งค่าก่อนเปิดขายจริง",
  posBeforeOpenSteps: [
    {
      title: "1. ตรวจความพร้อมของร้าน",
      description: "เปิด POS Readiness ตรวจสาขา เครื่อง พนักงาน สินค้าที่ขายได้ สต็อก และ refund ค้าง ร้านจด VAT ต้องตั้งภาษี เลขผู้เสียภาษี และประเภท VAT ของสินค้าทุกตัว; ร้านยาต้องผ่าน pharmacist review และตรวจ lot/วันหมดอายุด้วย",
    },
    {
      title: "2. เพิ่มเครื่องและผูกกับสาขา",
      description: "เปิด POS Devices เพิ่มรหัส/ชื่อเครื่อง เลือกสาขา ใส่ POS # และ prefix ใบเสร็จถ้ามี จากนั้นออก token แล้วเปิดลิงก์จับคู่ที่เครื่องขาย Token แสดงครั้งเดียว; ออกใหม่เมื่อเครื่องหายเท่านั้น เพราะ token เก่าจะใช้ไม่ได้ทันที",
    },
    {
      title: "3. ตั้ง Scanner ให้ตรงกับเครื่องจริง",
      description: "งานจริงแนะนำ PREFIX mode: โปรแกรม scanner ให้ส่ง F9 (หรือ prefix ที่เลือก) ก่อนข้อมูล และ Enter/Tab หลังข้อมูลให้ตรงกับหน้าเครื่องขาย โหมด FOCUS ใช้กับอุปกรณ์เดิมได้ แต่ต้องวาง cursor ในช่องที่ถูกต้องทุกครั้ง",
    },
    {
      title: "4. ตั้งพนักงาน PIN และสิทธิ์",
      description: "ตั้ง PIN ตัวเลข 4–8 หลักและ role ของแต่ละคน พนักงานไม่มี PIN จะเลือกที่จอขายไม่ได้; ใส่ผิด 5 ครั้งล็อก 15 นาที บัญชี “เฉพาะหน้าร้าน” เข้า /admin ไม่ได้จริง จึงควรใช้กับ Cashier ที่ไม่ต้องเห็นข้อมูลหลังบ้าน",
    },
    {
      title: "5. ซ้อมอุปกรณ์และบิลครบวงจร",
      description: "ทดสอบ scanner, พิมพ์ใบเสร็จ, ลิ้นชัก, จอลูกค้า, เงินสด/เงินทอน, QR, บัตร, Wallet, จ่ายผสม, คืนบางรายการ, refund ไม่ใช่เงินสด และปิดกะที่มีผลต่างบนเครื่องจริงทุกเครื่อง",
    },
    {
      title: "6. เตรียมแผนเมื่อระบบหรืออินเทอร์เน็ตล่ม",
      description: "POS นี้ต้องเชื่อม BMS server และ PostgreSQL จึงขาย ค้น คืน หรือปิดกะได้ ให้ร้านมีแบบฟอร์มจดรายการชั่วคราว วิธีเก็บเงิน และขั้นตอนนำรายการกลับเข้าระบบหลังเชื่อมต่อได้",
    },
  ],
  posDailyTitle: "วิธีใช้งานแต่ละงานใน POS",
  posGuideCards: [
    {
      title: "เริ่มกะและเลือกผู้ขาย",
      desc: "ทำทุกครั้งก่อนรับลูกค้าคนแรก",
      steps: [
        "เลือกชื่อพนักงานที่แถบบนและใส่ PIN; PIN อยู่ในหน่วยความจำเท่านั้น รีเฟรชแล้วต้องใส่ใหม่",
        "เปิดแท็บ กะ ใส่เงินตั้งต้นในลิ้นชัก แล้วกด เปิดกะ",
        "ถ้าหน้าจอบอกว่ายังขายไม่ได้ ให้ทำ checklist ที่แสดงอยู่: ตั้ง PIN, เลือกผู้ขาย หรือเปิดกะ",
        "หนึ่งเครื่องดูและปิดได้เฉพาะกะของเครื่องนั้น อย่าใช้เลขกะจากเครื่องอื่น",
      ],
      warning: "ห้ามแชร์ PIN หรือใช้ชื่อคนอื่นขาย เพราะบิล รายงานกะ audit และ commission ผูกกับคนที่ยืนยัน PIN",
    },
    {
      title: "สแกน ค้น และจัดตะกร้า",
      desc: "ขาย base unit, pack, หลายไซซ์ และสินค้ามี serial",
      steps: [
        "ยิงบาร์โค้ด หรือพิมพ์ชื่อ/SKU แล้วกด Enter; ถ้ามีหลายไซซ์ให้เลือกไซซ์ที่มีสต็อก",
        "ปุ่ม เช็คของ แสดงราคาและคงเหลือโดยไม่เพิ่มลงตะกร้า; กล้องมือถือเป็นโหมดทดสอบและใช้เฉพาะเบราว์เซอร์ที่รองรับ",
        "ปรับจำนวนด้วย +/− ระบบใช้ราคา pack, ราคาแยกไซซ์, ราคาส่ง และโปรโมชันที่ตั้งใน Products; pack คงราคาของ pack และโปรโมชันไม่ใช้กับ pack",
        "สินค้าที่ติดตาม serial ต้องใส่หนึ่งเลขต่อ base unit เช่น 2 กล่อง × 10 ชิ้น = 20 serial และห้ามเลขซ้ำทั้งบิล",
        "เพิ่มค่าถุง/ห่อของขวัญ/ค่าบริการที่ส่วนค่าบริการ ไม่ต้องสร้าง SKU ปลอม; รายการนี้ไม่ตัดสต็อก ไม่รับส่วนลด และอยู่ในฐาน VAT",
        "ก่อนรับเงินระบบดึงราคา pack/ขายส่ง/โปรโมชันล่าสุดอีกครั้ง ถ้ายอดเปลี่ยนต้องตรวจและรับเงินใหม่",
      ],
    },
    {
      title: "สมาชิก คูปอง แต้ม และส่วนลด",
      desc: "ผูกลูกค้าก่อนชำระ เพื่อให้สิทธิ์และ ledger ถูกคน",
      steps: [
        "ค้นด้วยเบอร์โทรหรือเลขสมาชิก; ถ้าไม่พบ กด สมัคร กรอกข้อมูล แล้วเลือกสมาชิกใหม่เข้าบิล",
        "ระบบใช้ส่วนลดตาม tier อัตโนมัติ จากนั้นคูปอง แต้ม และส่วนลดหน้าร้านตามลำดับ พร้อมบังคับเพดานส่วนลดต่อบิล",
        "กรอกคูปองแล้วรอผลตรวจจาก server; โค้ดหมดอายุ quota เต็ม ยอดไม่ถึง หรือเกินสิทธิ์ลูกค้าจะใช้ไม่ได้",
        "แลกแต้มเป็นหน่วยเต็มด้วย +/− พิมพ์จำนวน หรือกด ทั้งหมด เศษแต้มไม่หาย",
        "ส่วนลดหน้าร้านต้องใส่จำนวน เหตุผล ผู้อนุมัติ และ PIN แยกอีกครั้ง ผู้อนุมัติต้องเป็นคนละคนกับผู้ขายและมี pos.discount.approve",
        "หลังขาย แต้มที่ได้/ใช้และยอดคงเหลือแสดงบนใบเสร็จ; คืนสินค้าจะย้อนแต้มตามมูลค่าที่คืน",
      ],
    },
    {
      title: "รับเงินและจ่ายผสม",
      desc: "ยอดจากทุกแถวต้องตรงกับยอดที่ server คำนวณ",
      steps: [
        "บิลปกติเลือก เงินสด, QR, บัตร หรือ Wallet จากปุ่มใต้ยอด; เงินสดใส่ยอดที่รับหรือใช้ปุ่ม พอดี/ธนบัตร แล้วตรวจเงินทอน",
        "QR/บัตร/Wallet ล็อกยอดเท่าบิลและใส่เลขอ้างอิงหรือ approval code ได้",
        "กด + จ่ายผสม เพื่อเพิ่มหลายแถว กำหนดยอดแต่ละวิธี และกรอกยอดรับจริงในแถวเงินสด",
        "ปัดเศษเงินสดใช้เฉพาะบิลเงินสดล้วนตามค่าร้าน แสดงเป็นบรรทัดแยกและไม่เปลี่ยนฐาน VAT",
        "ถ้าออกใบกำกับไม่ได้เพราะสินค้ายังไม่ระบุ VAT ให้แก้สินค้าที่ระบบแจ้งเป็น V หรือ N แล้วกลับมากดชำระบิลเดิมซ้ำ ระบบใช้ order และ idempotency key เดิมโดยไม่รับเงินซ้ำ",
        "กดรับเงินครั้งเดียวแล้วรอผล หากเครือข่ายขาด ให้กดซ้ำจากรายการกู้คืนเดิม ระบบใช้ idempotency key เดิมและไม่สร้างบิลซ้ำ",
      ],
      warning: "ปุ่มขายปกติในจอปัจจุบันมี เงินสด/QR/บัตร/Wallet; โอนเงินมีในงานมัดจำ แต่ยังไม่มีปุ่มในบิลขายปกติ",
    },
    {
      title: "ใบเสร็จ เครื่องพิมพ์ และจอลูกค้า",
      desc: "ตรวจผลหลังขายและส่งสำเนาโดยไม่ออกเอกสารใหม่",
      steps: [
        "หลังขาย ตรวจเลขเอกสาร ยอดรับ และเงินทอน แล้วกดพิมพ์หรือดูใบเสร็จ; Enter พิมพ์และ Esc ปิดหน้าต่าง",
        "ใบเสร็จแสดงราคาป้ายตามไซซ์และแยกส่วนลดราคาส่ง/โปรโมชันออกมาให้ยอดตรวจสอบได้ พร้อมค่าบริการ ส่วนลดระดับบิล VAT/ยกเว้น VAT ปัดเศษ วิธีจ่าย แคชเชียร์ สมาชิก และบาร์โค้ดเลขบิล; การพิมพ์ซ้ำใช้ snapshot ตอนขาย ไม่อ่านราคาสินค้าปัจจุบัน",
        "ตั้งเครื่องพิมพ์ WebUSB ในแท็บ ตั้งค่า; ถ้าเบราว์เซอร์ไม่รองรับ ระบบใช้ print dialog และเปิดลิ้นชักจาก dialog ไม่ได้",
        "กด เปิดจอลูกค้า แล้วลากหน้าต่างไปจอที่สองของเครื่องเดียวกัน จอแสดง 8 รายการล่าสุด ยอด ส่วนลด และเงินทอนแบบ read-only",
        "ส่งสำเนาทางอีเมลได้โดยพิมพ์อีเมลเฉพาะครั้ง หรือเว้นว่างให้ใช้ข้อมูลสมาชิก; ส่ง LINE ได้เมื่อลูกค้าผูก LINE กับร้านแล้ว",
        "โหลดบิลล่าสุดจาก server ในแท็บ ตั้งค่าเมื่อต้องพิมพ์ซ้ำหลังรีเฟรช",
      ],
    },
    {
      title: "พักบิลและมัดจำ",
      desc: "แยกงานรอชั่วคราวออกจากการรับเงินแบบจองสินค้า",
      steps: [
        "พักบิลเมื่อคิวยังไม่พร้อมชำระ ตั้งชื่อให้หาเจอ แล้วเรียกกลับหรือทิ้งได้; จำกัด 20 บิลต่อกะ",
        "บิลพักไม่จองสต็อกและไม่ล็อกราคา เมื่อเรียกกลับต้องขายด้วยราคา/สต็อกปัจจุบัน และจะหายเมื่อกะจบ",
        "ถ้าสินค้าติดกฎร้านยาและต้องให้เภสัชกรตรวจ ระบบจะมีปุ่มส่งเคสจากหน้า POS เพื่อสร้างเคส, ผูกกับบิลพัก, และเคลียร์หน้าเคาน์เตอร์ทันที; บิลจะเรียกกลับได้ก็ต่อเมื่อเคสอนุมัติแล้ว",
        "ลูกค้าหน้าร้าน: ใส่สินค้าในตะกร้า ไปแท็บมัดจำ ระบุยอด/วิธีรับเงิน แล้วกด สร้างบิล + รับมัดจำ ระบบสร้าง Order ID คำนวณราคาล่าสุด และจองสต็อกให้อัตโนมัติ",
        "ออเดอร์จาก Inbox / Customer 360: เลือกบิล PENDING ของสาขาจากรายการ ไม่ต้องพิมพ์ UUID หรือใช้บาร์โค้ดสินค้า แล้วใช้ รับครั้งแรก หรือ รับเพิ่ม โดยยอดต้องน้อยกว่ายอดคงเหลือ",
        "เมื่อลูกค้าจ่ายครบ ใช้ รับยอดคงเหลือ + ส่งของ เท่านั้น เพื่อให้ตัดสต็อก lot เอกสาร แต้ม และ audit พร้อมกัน",
        "สินค้ามี serial ต้องสแกนสินค้าที่ส่งจริงและกรอก serial ในตะกร้าก่อน settle",
        "ปิดมัดจำเป็น ยกเลิก หรือ ยึด พร้อมเหตุผล ระบบคืน stock ที่จอง แต่การคืนเงินจริงต้องทำใน refund flow แยกต่างหาก",
      ],
    },
    {
      title: "คืนสินค้า เปลี่ยนสินค้า Void และคืนไม่มีบิล",
      desc: "เริ่มที่แท็บ คืน และเลือกเส้นทางให้ตรงกับเหตุการณ์",
      steps: [
        "ค้นด้วยเลขใบเสร็จ/order id หรือเปิดบิลล่าสุด เลือกเหตุผลและรายละเอียด แล้วคืนทั้งบิลหรือเลือกจำนวนสะสมรายรายการ",
        "เมื่อพิมพ์คำค้น ระบบค้นบิลสำเร็จจาก POS, web และ social ทุกสาขา; บิล Lazada/Shopee ต้องคืนผ่าน marketplace ต้นทาง",
        "บิล POS ต่างเครื่องแต่สาขาเดียวกันคืนได้ตามปกติ; ถ้าขายจากอีกสาขา ต้องใช้ PIN ผู้อนุมัติคนที่สองที่มี pos.return.cross_branch สินค้าจะเข้าสต็อกสาขาที่รับของจริง ส่วนเงินสดออกจากกะสาขานี้",
        "การคืนข้ามสาขาไม่ใช่การโอน stock: ถ้าจะส่งของคืนกลับสาขาที่ขาย ให้สร้างใบโอนจากสาขารับคืนภายหลัง",
        "ถ้าบิลเดิมจ่ายหลายช่องทาง ต้องเลือกก่อนว่าจะคืนจากเงินสด บัตร QR หรือช่องทางเดิมใด ระบบจะแสดงยอดที่ยังคืนได้ของแต่ละช่องทาง จำกัดไม่ให้เกินยอดที่เคยรับ และกระจายเฉพาะส่วนที่เกินไปช่องทางเดิมอื่น",
        "หลังคืน กด ดูใบรับคืนล่าสุด หรือเปิด ดูประวัติบิล แล้วเลือก ดูใบรับคืนรายการนี้ เพื่อพิมพ์เอกสารของการคืนครั้งนั้น; มูลค่าต่อรายการคือยอดคืนจริงหลังเฉลี่ยส่วนลดจากบิลเดิม ส่วน ดูใบขายเดิม ยังคงจำนวน ราคาป้าย ส่วนลด และยอดเดิม เพราะเอกสารขายจะไม่ถูกแก้ย้อนหลัง",
        "บิลใหม่ที่มีกฎราคาตอนขายครบ: คืนบางรายการจะตรวจจำนวนสินค้าที่เหลืออีกครั้ง ถ้าเหลือไม่ครบขั้นต่ำราคาส่ง/โปร ระบบจะปรับมูลค่าของที่เหลือและลดยอดคืนเงิน พร้อมแสดงส่วนต่างในประวัติบิล ส่วนบิลเก่าจะคืนตามสัดส่วนเดิมเพื่อไม่เดากฎย้อนหลัง",
        "กด ดูประวัติบิล ที่บิลแต่ละใบเพื่อดู Timeline ตั้งแต่ยอดขายเดิม การคืนแต่ละครั้ง รายการที่คืน ผู้ทำรายการ/ผู้อนุมัติ สถานะคืนเงินจริง ใบลดหนี้ และยอดคงเหลือหลังคืน โดยใบขายเดิมจะไม่ถูกแก้ย้อนหลัง",
        "เงินสดคืนเสร็จทันที; QR/บัตร/Wallet อยู่สถานะรอยืนยันจนผู้มี payment.refund บันทึกเลขอ้างอิงการคืนเงินจริง กะจะปิดไม่ได้ถ้ายังค้าง",
        "การ์ดบิลแสดง breakdown คืนเงินจริงทุกช่องทางพร้อมกัน ทั้งรายการที่คืนแล้วและที่รอยืนยัน จึงไม่ควรอ่านแถว QR/บัตรที่ค้างว่าเป็นยอดคืนทั้งหมด",
        "เปลี่ยนสินค้า: เลือกจำนวนของเดิมที่จะเปลี่ยน แล้วกด คืนที่เลือก + ทำบิลเปลี่ยน ระบบจะบันทึกรับคืน/คืนเงินของเดิมก่อน เมื่อสำเร็จจึงพาไปแท็บขายและใส่เฉพาะรายการที่รับคืนเป็นตะกร้าบิลใหม่ ให้เปลี่ยนรุ่น/ไซซ์และรับเงินใหม่ตามปกติ",
        "Void ใช้เฉพาะบิลลงผิดในกะที่ยังเปิด ไม่มีรายการคืนมาก่อน ต้องมีเหตุผลและ PIN ผู้อนุมัติคนที่สอง; หลังปิดกะใช้ Return",
        "คืนไม่มีใบเสร็จ: เปิดฟอร์มคืนไม่มีบิล สแกนของ ใส่เหตุผล และให้ผู้มี pos.return.noreceipt อนุมัติ ระบบคืนเป็นเงินสดไม่เกินราคาขายวันนี้และไม่ออกใบลดหนี้",
        "คืนบางส่วนของสินค้ามี serial ที่สาขาเดิมยังไม่ปล่อย serial กลับมาขาย; ถ้าคืนข้ามสาขาระบบจะปฏิเสธการคืนบางส่วนจนกว่าจะระบุ serial รายชิ้นได้ ส่วนคืนเต็มจะย้าย serial มาสาขารับคืน",
      ],
      warning: "ยอดคืนตั้งแต่ ฿500 เริ่มมี approval flow และตั้งแต่ ฿2,000 เป็น high-value return ตามจอ; อย่าปิดกะก่อนเคลียร์ refund ที่ค้าง",
    },
    {
      title: "รับสินค้าจาก PO ที่เครื่องขาย",
      desc: "รับเข้าสต็อกสาขาของเครื่องโดยไม่สร้างขั้นตอนคลังใหม่",
      steps: [
        "เลือกผู้รับ ใส่ PIN แล้วกดโหลด PO ค้างรับ; ระบบตรวจ purchase.receive ทุกครั้ง",
        "เลือก PO สถานะ OPEN/PARTIAL แล้วสแกนสินค้า รายการยังเป็นร่างและยังไม่ขยับสต็อก",
        "ตรวจจำนวนไม่ให้เกินค้างรับ และกรอก lot/วันหมดอายุเมื่อมี",
        "กด ยืนยันรับเข้า เพียงครั้งเดียวหลังตรวจครบ ของจะเข้าที่สาขาของเครื่องนี้ พร้อม movement, PO status และ audit",
        "ถ้าคำตอบจาก server หาย ให้ retry คำขอเดิม ระบบจะ replay ผลเดิมแทนการรับซ้ำ",
      ],
    },
    {
      title: "ค่าใช้จ่าย เงินสดย่อย และเงินลิ้นชัก",
      desc: "เลือกประเภทให้ถูก เพื่อให้ยอดกะและบัญชีอธิบายได้",
      steps: [
        "จ่ายตรง หรือ เบิกไปซื้อ จากลิ้นชัก ต้องมีรายละเอียดและ PIN ผู้อนุมัติคนที่สอง; เงินเบิกต้องกลับมาปิดยอดจริงก่อนปิดกะ เงินทอน/ขาดจะปรับลิ้นชักอัตโนมัติ",
        "เจ้าของคนเดียวสำรองจ่ายส่วนตัว ใช้ได้เฉพาะ Administrator ที่มี pos.expense.personal และต้องมีหลักฐาน ไม่แตะเงินลิ้นชัก",
        "กระเป๋าเงินสดย่อยสาขาอยู่นอกลิ้นชัก Administrator เติมจากเงินเจ้าของ/บัญชีร้านพร้อมหลักฐาน แล้วพนักงานจ่ายค่าใช้จ่ายจากยอดนั้นได้โดยไม่ใช้ PIN คนที่สอง",
        "เงินเข้า–ออกลิ้นชักใช้กับเงินนอกยอดขาย เช่น เติมเงินทอน นำฝากธนาคาร หรือย้ายลิ้นชัก; เงินสดจากยอดขายเข้ายอดอัตโนมัติ ห้ามบันทึกซ้ำ",
        "เงินออกต้องมีผู้อนุมัติคนที่สองและห้ามเกินยอดที่ระบบคาดว่ามี; เงินเข้าต้องติ๊กยืนยันว่าไม่ใช่ยอดขาย",
        "เปิดลิ้นชักโดยไม่ขาย ใช้ปุ่มในแท็บ กะ ใส่เหตุผล และ PIN ทุกครั้ง จำนวนครั้งจะอยู่ในรายงานกะ",
      ],
    },
    {
      title: "X/Z report ภาษี และ commission",
      desc: "ตรวจเงินและเอกสารให้จบก่อนส่งมอบกะ",
      steps: [
        "กด ดูสรุปกะ ระหว่างกะเป็น X report: ยอดสุทธิ บิล ส่วนลด void คืน แยกวิธีจ่าย/พนักงาน เงินเข้าออก ค่าใช้จ่าย no-sale และ refund ค้าง",
        "ถ้าเปิด blind close ยอดเงินสดที่ควรมีจะถูกซ่อนจนปิดกะ ให้พนักงานนับเงินจริงก่อนกรอก counted cash",
        "ปิดกะไม่ได้เมื่อมีสินค้าในตะกร้า เงินเบิกยังไม่ปิดยอด หรือ refund ไม่ใช่เงินสดยังค้าง; หลังปิดรายงานเดียวกันเป็น Z report และแสดง expected/counted/variance",
        "เมื่อยอดมีข้อสงสัย เปิด ประวัติกะของเครื่องนี้ แล้วกด ดาวน์โหลดรายละเอียดกะ เพื่อไล่จากบิล วิธีชำระ เงินเข้าออก คืนเงิน ค่าใช้จ่าย และ no-sale; การคืนบิลเก่าจะอยู่ในกะที่รับคืนจริง",
        "ผู้จัดการที่มี pos.shift.report.all ดูภาพรวมทุกลิ้นชักที่ /admin/pos-shifts ได้ โดยกรองวันที่เปิดกะ สาขา เครื่อง คนเกี่ยวข้อง และสัญญาณผิดปกติ; หน้านี้เป็น read-only ไม่ใช้ปิดกะหรือแก้ยอดแทนหน้า POS และกะเปิดที่ใช้ blind close ต้องปิด/นับเงินก่อนจึงดาวน์โหลด Excel ได้",
        "ค่าภาษีที่ POS Readiness มีผลกับบิลใหม่เท่านั้น เอกสารที่ออกแล้วแก้ย้อนหลังไม่ได้; e-Tax เป็น queue แยกและไม่ได้ส่งอัตโนมัติจากการขาย",
        "รายงาน commission อยู่ /admin/commission ใช้อัตราตามวันที่มีผล สินค้าคืนจะดึง commission คืน และ void ไม่ได้ commission",
      ],
    },
  ],
  posPermissionsTitle: "สิทธิ์ที่ควรตรวจตามหน้าที่",
  posPermissions: [
    "ตั้งเครื่อง/PIN/บัญชีเฉพาะหน้าร้าน: pos.device.manage, pos.pin.manage, pos.staff.manage",
    "ขายและกะ: pos.sell, pos.shift.open, pos.shift.close, pos.shift.report; ภาพรวมทุกเครื่องหลังบ้าน: pos.shift.report.all",
    "สมาชิกและส่วนลด: member.view, member.manage, pos.discount.approve (ผู้อนุมัติต้องเป็นคนละคนกับผู้ขาย)",
    "คืนเงิน: order.return, payment.refund, pos.return.noreceipt, pos.void",
    "เงินและค่าใช้จ่าย: pos.cash.movement, pos.nosale, pos.expense.create, pos.expense.personal, pos.petty_cash.manage",
    "มัดจำ/รับของ/ภาษี/commission: pos.deposit.take, pos.deposit.cancel, purchase.receive, tax.setting.manage, commission.view, commission.manage",
  ],
  posBoundariesTitle: "ขอบเขตที่ต้องรู้ก่อนสอนทีม",
  posBoundaries: [
    "POS เป็นระบบออนไลน์ ไม่รองรับขายแบบ offline-first; งานระหว่างล่มต้องจดและ reconcile ภายหลังตามขั้นตอนร้าน",
    "กล้องมือถือเป็นโหมดทดสอบ และ ESC/POS/WebUSB ยังต้องทดสอบกับ printer แต่ละรุ่น; ไม่มี driver เครื่อง EDC",
    "Store credit/gift card มี service และ API แล้ว แต่ปุ่มรับด้วยเครดิตร้าน/ออกบัตรยังไม่ถูกต่อเข้าจอ POS ปัจจุบัน จึงอย่าสอนเป็นขั้นตอนหน้าร้านที่ใช้งานได้",
    "e-Tax ไม่ได้ส่งกรมสรรพากรอัตโนมัติ และ provider จริงยังต้องเปิด/ตรวจแยก; เอกสารภาษีในเครื่องยังต้องทวนกับผู้ทำบัญชี",
    "POS ปัจจุบันเป็นค้าปลีกทั่วไป ไม่มีโต๊ะร้านอาหาร KDS modifier/topping คิวจองโต๊ะ หรือ printer routing ครัว",
  ],
  posOpenLabels: ["เปิด POS", "ตั้งเครื่องและ PIN", "ตรวจความพร้อม", "ตั้งสมาชิก/แต้ม", "ดู Commission"],
  menusTitle: "🧩 คู่มือตามเมนู",
  menusSubtitle: "แยกเป็นการ์ดสั้น ๆ เพื่อให้คนสแกนแล้วรู้ทันทีว่าเมนูนี้เอาไว้ทำอะไร",
  menuCards: MENU_CARDS_TH,
  menuOpenPagePrefix: "เปิดหน้า",
  menuGroupingAlertMessage: "คำแนะนำการจัดกลุ่ม",
  menuGroupingAlertDesc:
    "Orders / Payment / Shipping ควรอยู่ใกล้กันในคู่มือ เพราะผู้ใช้ทำงานต่อเนื่องเป็น flow เดียวกัน ส่วน Products ควรอยู่คู่กับ Purchase เพราะเกี่ยวกับการมีของพร้อมขาย",
  sidebarMapTitle: "🗺 แผนที่เมนูตาม Sidebar จริง",
  sidebarMapSubtitle: "ถ้าผู้ใช้จำชื่อเมนูจากแถบซ้ายได้อยู่แล้ว ให้ใช้ section นี้เพื่อไปยังหน้าที่ถูกต้องเร็วที่สุด",
  sidebarMapGroups: SIDEBAR_MAP_GROUPS_TH,
  faqTitle: "❓ คำถามที่เจอบ่อย",
  faqSubtitle: "วางแบบถาม-ตอบสั้น ๆ เพื่อช่วยลดเวลาที่ต้องไล่อ่านเอกสารยาว",
  helpRows: HELP_ROWS_TH,
  limitsTitle: "⚠️ ข้อจำกัดและกลไกเบื้องหลังที่ควรรู้",
  limitsSubtitle:
    "สมการและวงจรสถานะที่ระบบยึดถือ, กับดักที่เจอบ่อย, ตัวเลขที่ต้องอ่านเป็นค่าประมาณ, สิทธิ์ตามโมดูล และของที่ยังไม่รองรับ — อ่านก่อนสัญญาอะไรกับลูกค้าหรือทีมงาน",
  limitsGroups: LIMIT_GROUPS_TH,
  linksTitle: "🔗 ลิงก์ไปหน้าที่ใช้บ่อย",
  linksSubtitle: "ให้ผู้ใช้ข้ามไปทำงานจริงได้ทันที ไม่ต้องอ่านจบทั้งหน้า",
  linkSteps: LINK_STEPS_TH,
  linksAlertMessage: "แนวคิดของคู่มือใหม่นี้",
  linksAlertDesc:
    "เปิดมาแล้วควรตอบได้ทันทีว่า “ฉันควรเริ่มจากตรงไหน”, “เมนูนี้ใช้ทำอะไร”, และ “ถ้าติดปัญหาควรดูตรงไหนต่อ”",
  sidebarTocTitle: "สารบัญ",
  sidebarShortcutsTitle: "ทางลัดแนะนำ",
  sidebarShortcuts: [
    { label: "เปิด Dashboard", href: ROUTES.dashboard, icon: <DashboardOutlined /> },
    { label: "เปิด Inbox", href: ROUTES.inbox, icon: <InboxOutlined /> },
    { label: "เปิด Orders", href: ROUTES.orders, icon: <ShoppingCartOutlined /> },
    { label: "เปิด Follow-up Queue", href: ROUTES.followupQueue, icon: <CustomerServiceOutlined /> },
    { label: "เปิด POS Devices", href: ROUTES.posDevices, icon: <ShopOutlined /> },
    { label: "เปิด Pharmacy Intake Queue", href: ROUTES.pharmacyQueue, icon: <FileSearchOutlined /> },
    { label: "เปิด Settings", href: ROUTES.settings, icon: <ApiOutlined /> },
    { label: "เปิด Users", href: ROUTES.users, icon: <UserOutlined /> },
  ],
  sidebarNextTitle: "หลังอ่านหน้านี้ แนะนำให้ทำต่อ",
  sidebarNextItems: [
    "ให้หัวหน้าทีมเลือก onboarding card ที่ตรงกับหน้าที่ของพนักงานใหม่",
    "ให้พนักงานกด shortcut หรือแผนที่เมนูตาม sidebar ไปลองทำงานจริงทันที",
    "ถ้าเป็นร้านใหม่ ให้เริ่มจาก Getting Started → Settings → Products → Dashboard",
    "ถ้าเป็นร้านที่ใช้ POS หรือ Pharmacy ให้ซ้อม flow เฉพาะทางก่อนใช้กับลูกค้าจริง",
  ],
  noteTitle: "หมายเหตุ",
  noteBody:
    "หน้านี้ถูกปรับให้เป็นคู่มือที่ใช้งานได้จริงมากขึ้นแล้ว โดยมีทั้ง quick start, onboarding วันแรก, flow งาน, คู่มือ POS, แผนที่เมนูตาม sidebar และ search ในหน้าเดียว เป้าหมายคือให้คนใหม่เริ่มงานได้ไวและคนเดิมย้อนหาหน้าที่ถูกต้องได้ง่าย",
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
    title: "Dashboard",
    desc: "See today's headline numbers, urgent work, stock risk, suggested actions, and channel health in one place",
    bullets: [
      "Start the day from revenue today, order count, customer count, and low-stock items",
      "Use the urgent-work cards for waiting chats, slips pending review, packing delays, and reservations that are about to expire",
      "Phase 1 action cards can be refreshed so the system proposes what to do next, such as restocking, packing sooner, or fixing stock data",
      "Record lost sales or update inventory policy here so the next recommendation cycle learns from real demand",
      "Channel chips show whether a channel is unset, intentionally disabled, or genuinely unhealthy, with a direct path to Settings",
    ],
  },
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
    title: "Products",
    desc: "Add products, multiple images, SKUs/barcodes, stock, selling prices, wholesale pricing, and sellable status",
    bullets: [
      "The first image is the cover and the rest form the public product gallery",
      "Set SKU, barcode, price, active status, reorder point, and per-size stock before selling",
      "CSV/XLSX import works for larger product batches and previews create / update / skip before you confirm",
      "Expand a row to inspect stock per size and use quick adjust / manual entry / bulk adjustment",
      "The Reserved number is clickable: it lists which bills hold that size (PENDING / PAID / PACKING) with quantity, customer, channel, branch, and whether a deposit or a bundle is the reason. Requires the order.view permission",
      "If that view reports reserved units with no bill behind them, stock is locked and unsellable — report it to an administrator instead of adjusting stock over it",
      "If the item will be used at the counter, configure extra selling units in Product packs and print labels from Product labels",
    ],
  },
  {
    title: "Purchase",
    desc: "Create POs, choose suppliers, receive goods into inventory, and reuse supplier mappings and last costs",
    bullets: [
      "Choose the supplier before creating a PO so search works by either the shop SKU or the supplier SKU",
      "On the first PO, map the supplier SKU to the shop SKU + size, then the system reuses that mapping later",
      "When receiving, review quantities, lot, expiry, and the OPEN / PARTIAL / RECEIVED status carefully",
      "You can receive from the Purchase page, or reopen the same PO in POS Receive to scan a draft and confirm it into the register branch",
    ],
  },
  {
    title: "Orders / Payment / Shipping",
    desc: "These three pages are meant to be used as one flow: order tracking -> payment review -> shipping and tracking",
    bullets: [
      "Orders tracks PENDING / PAID / PACKING / SHIPPED / COMPLETED / CANCELLED / RETURNED",
      "Payment is where staff review slips, confirm or reject payments, and process refunds when authorized",
      "Shipping creates shipments, records tracking numbers, syncs carriers, and closes work at DELIVERED",
      "Every page has search so staff can find an order id, payment id, shipment id, tracking number, or related customer fast",
      "Orders keeps subtotal, coupon discount, and net total visible before the next team picks up the work",
    ],
  },
  {
    title: "Customers & Members",
    desc: "Keep CRM data clean, manage addresses, see purchase history, and run the membership/points program",
    bullets: [
      "Customers is the main CRM page for searching existing customers and merging duplicates when allowed",
      "One customer can hold multiple addresses, and shipping addresses must be complete before using Shipping for chat channels",
      "Loyalty manages member numbers, tiers, point settings, ledgers, and manual point adjustments",
      "Customer 360 inside Inbox reuses the same CRM records, so cleaning data here improves the whole workflow",
    ],
  },
  {
    title: "Coupons / Follow-up Rules / Follow-up Queue",
    desc: "Manage master coupons, inspect wallet usage, define follow-up rules, and work from the follow-up plus restock queues",
    bullets: [
      "Coupons manages master coupon setup, quotas, minimum spend, valid dates, and each coupon's real redemptions",
      "Follow-up Rules defines when the system should create follow-up work from customer behavior or business state",
      "Follow-up Queue is where staff review, accept, contact, or close those generated tasks with a reason",
      "Restock subscriptions remain the dedicated queue for customers who explicitly opted in for back-in-stock updates",
    ],
  },
  {
    title: "Pharmacy Intake Lab / Queue / Protocols",
    desc: "For pharmacy-enabled shops: triage intake cases, process the queue, and maintain pharmacy protocols and licenses",
    bullets: [
      "Pharmacy Intake Lab is the practice/simulation entry point for checking what data a case needs and whether it should escalate",
      "Pharmacy Intake Queue gathers emergency cases, pending confirmations, and anything that requires a licensed human decision",
      "Pharmacy Protocols is where the shop maintains the screening rules and question sets used by the workflow",
      "Pharmacist Licenses stores the licensed-pharmacist records for this flow — the model never makes the clinical decision",
    ],
  },
  {
    title: "POS Devices / Product packs / Product labels / POS Readiness",
    desc: "Prepare registers, PINs, extra selling units, barcode labels, and readiness checks before the counter goes live",
    bullets: [
      "POS Devices adds registers, issues pairing tokens, assigns branches, and manages cashier PINs",
      "POS Readiness checks blockers such as VAT setup, stock readiness, pending refunds, and pharmacy-only prerequisites",
      "Product packs adds extra units and barcodes for packs or alternate selling units",
      "Product labels prints barcode stickers from the product and pack data you already configured",
    ],
  },
  {
    title: "POS / Loyalty",
    desc: "Counter sales, members and points, parked bills, drawer cash, voids, and shift reports",
    bullets: [
      "Open a shift and identify the cashier with a PIN before selling; the device token identifies the register and branch, not the person",
      "A Bluetooth HID scanner is a keyboard: configure the register for Prefix Mode (for example F9 + payload + Enter) so a scan is captured even while member/PIN input is focused without mutating that field",
      "In Receive, select an existing PO, scan into a draft, review quantities/lot/expiry, then confirm once; purchase.receive is checked and stock enters this register's branch",
      "Find the member before payment to apply tier discounts and points; configure the program and inspect its ledger at /admin/loyalty",
      "Wholesale steps have two modes in Products: a fixed price qualifying separately per size, or a cross-size quantity threshold that discounts each size's own regular price by a percentage",
      "Before taking payment, the register rechecks current shelf prices, wholesale steps, packs, and promotions. If product settings changed after scanning, it updates the total and asks the cashier to review and receive payment again instead of selling at stale pricing",
      "Park up to 20 bills per shift, but parked carts reserve no stock and lock no price; resume uses current stock and pricing",
      "Use the Deposits tab to take, add, settle, or close layaway for this branch; a full balance must use Settle so stock and documents complete atomically. For serial-tracked goods, scan the delivered items and their serials into the cart before settling",
      "A completed cash sale is added to expected drawer cash automatically and must never be entered again as cash-in. Use cash-in only for money from outside sales, such as owner-funded change or a transfer from another register. Every movement needs a reason, and cash out always needs a second approver's PIN",
      "Use Petty cash for ice, ingredients, or packaging: pay directly, or advance cash and later enter the actual cost. Change returns to the drawer and any shortfall leaves it automatically; every advance must be settled before shift close",
      "A one-person shop can choose ‘Sole owner · personal funds’. The account needs pos.expense.personal and must enter a receipt/evidence reference. It records a shop expense without taking cash from the drawer; reimbursing the owner later is still a separate cash-out with a second approver",
      "For recurring small purchases, an Administrator can fund the branch petty-cash wallet from owner cash or a business account with evidence, then choose ‘Shop petty cash’ when paying. The wallet balance and history update without touching the register drawer or requiring a second PIN",
      "Void a mis-rung bill only while its shift is open, with a reason and a second approver; use Return after the shift closes",
      "Use the X report mid-shift and Z report after close to reconcile expected cash, counted cash, and variance",
    ],
  },
  {
    title: "Locations / Stock Transfers / Stock Counts",
    desc: "Manage branch structure and warehouse operations across branches without overwriting sales made during a count",
    bullets: [
      "Locations is where the shop adds or edits branches that can receive stock, run POS, or receive transfers",
      "Products shows stock as branch × size plus all-branch, in-transit, and quarantined totals; adjustments and reorder points always name a branch",
      "A transfer has two steps: send from the source, then receive at the destination; in-transit goods belong to no branch",
      "Receiving separates sellable, damaged/quarantined, and missing units; discrepancies require a reason and note, and damaged goods never become sellable stock",
      "A count snapshots each line on first entry and Apply adds only the variance instead of replacing current stock",
      "Warehouse staff with inventory.count can enter figures, while inventory.count.apply is required to accept the variance",
      "Start from Locations if the shop is still setting up branches, then use Stock Transfers and Stock Counts for day-to-day warehouse work",
    ],
  },
  {
    title: "Reports & Commission",
    desc: "Review historical KPIs, generate downloadable files, and inspect salesperson commission results",
    bullets: [
      "Reports includes date-range KPIs, daily sales, top products, inventory summary, and POS return / refund reporting",
      "The AI Report Generator creates Excel / CSV / PDF files and keeps a short download history",
      "If product costs are missing, profit reporting warns that the data is incomplete instead of pretending the cost is zero",
      "Commission shows rates, effective-dated rules, and clawbacks after returns",
    ],
  },
  {
    title: "Settings / Realtime Diagnostics / Billing",
    desc: "Configure shop information, sales channels, webhook/token connections, payment accounts, AI provider, realtime tests, and billing",
    bullets: [
      "Shop information stores the shop name, business type, business hours, contact details, country, currency, and shipping fees",
      "Payment accounts define the real bank / PromptPay destinations that AI and checkout are allowed to mention",
      "Channel settings are where staff paste tokens, inspect connection health, and fix webhook setup per platform",
      "Realtime Diagnostics is the safe place to test Inbox delivery without waiting for a real customer message",
      "BYOK / AI provider settings live here, but financial confirmations still require a human button press elsewhere",
      "Billing is where the shop reviews AI credits, usage, the ledger, and shared-key or BYOK quota pressure",
    ],
  },
  {
    title: "AI Assistant / AI Quality",
    desc: "Ask back-office questions, prepare requests that staff confirm, and review how well AI is performing",
    bullets: [
      "Open AI Work Assistant from the floating button on any back-office page to ask about system capabilities, menu instructions, or live data your permissions allow",
      "The assistant uses current-page context for topics such as POS steps, reports, stock, customers, loyalty, and coupons, and only links to pages you can access",
      "Anything affecting money, stock, or deletion remains propose-only until a person presses Confirm",
      "AI Quality shows success / handoff / unresolved rates, sampled conversations, and top failing tools",
      "Playground remains the controlled test space for AI/chat flows when a team has AI quality access",
    ],
  },
  {
    title: "Profile / Users / Permissions / Audit",
    desc: "Manage your own account settings, staff users, permissions visibility, and historical admin actions",
    bullets: [
      "Profile stores theme, language, polite particle, avatar, and the permissions visible to your own account",
      "Users lets a shop add or edit staff accounts when the role has that access",
      "Permissions gives the role-permission matrix for the current tenant when the account is allowed to see it",
      "Audit log helps investigate important actions such as money movement, stock changes, and approvals",
      "Getting Started is the onboarding checklist for new shops that still need to finish the first setup steps",
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
    title: "Billing & Plan",
    desc: "Review the current plan, AI credits, usage breakdown, and the ledger of what consumed quota this month",
    bullets: [
      "Track remaining credits, used credits, request count, provider calls, and estimated cost separately",
      "When the shop relies on the shared key, Billing is where near-limit and exhausted usage becomes visible to staff",
      "Use the ledger to trace what AI usage the tenant actually spent credits on in the current cycle",
      "When BYOK is enabled, compare Billing with Settings so the team knows which provider and model are active",
    ],
  },
  {
    title: "Architecture / Tenants / Report Schedule / Roles",
    desc: "Platform-admin menus for the overall system structure, multi-tenant administration, scheduled reporting, and global role definitions",
    bullets: [
      "Architecture is for viewing the platform-level system shape and dependencies rather than day-to-day shop work",
      "Tenants is where a platform team reviews or manages shops across the fleet instead of just the current shop",
      "Report Schedule is used to define or review recurring report delivery jobs for multiple shops or central teams",
      "Roles manages the global system roles; ordinary shop users usually work with Permissions and Users instead",
      "This group is mainly for platform admins, implementers, or central operations rather than ordinary shop staff",
    ],
  },
  {
    title: "Files / Logs / Mail log / Support / Batch / Health / ENV / Dev / Playground",
    desc: "System-observability, support, and internal testing menus. This manual intentionally excludes Posts, as requested.",
    bullets: [
      "Files is for stored or uploaded assets, while Logs and Mail log help trace system events and email delivery history",
      "Support Tickets tracks reported issues and helps route them to the right team",
      "Batch & Cron is for background and scheduled jobs, while System Health is the read-only operational status page",
      "ENV and Dev Console are internal debugging/configuration surfaces and should be used by people who understand the operational impact",
      "Fake data and Playground are for safe demos, experiments, and controlled testing when the account has access",
    ],
  },
];

const ONBOARDING_CARDS_EN: OnboardingCard[] = [
  {
    title: "The first 30 minutes for a new shop",
    desc: "For an owner or admin setting up a shop for the first time and trying to get the team usable quickly",
    steps: [
      "Open Getting Started and clear the basic setup checklist first",
      "Go to Settings to fill in the shop name, hours, payment accounts, shipping fees, webhook/token setup, and AI provider",
      "Go to Products and create the first sellable product set with prices and stock",
      "If the shop will sell at the counter, open POS Devices and POS Readiness before the first live sale",
      "Finish at Dashboard to confirm low-stock signals, channel health, and urgent work are already showing up",
    ],
    href: ROUTES.gettingStarted,
    ctaLabel: "Open Getting Started",
  },
  {
    title: "The first day for a chat/order staff member",
    desc: "For a teammate who needs to reply to customers, share products, issue coupons, and follow orders through the day",
    steps: [
      "Start in Inbox to understand new chats, badges, and Customer 360",
      "Learn Mentions and Restock subscriptions so handoffs and back-in-stock work do not get missed",
      "Practice sharing products and coupons through the draft before sending for real",
      "Follow work through Orders, Payment, and Shipping as one continuous flow",
      "If you cannot find a customer or order quickly, use Customers and the page-level search boxes instead of scanning manually",
    ],
    href: ROUTES.inbox,
    ctaLabel: "Open Inbox",
  },
  {
    title: "The first day for a POS staff member",
    desc: "For a cashier or counter team member who needs to open a shift, take payment, manage the drawer, and close properly",
    steps: [
      "Check POS Devices so the register is paired, the PIN works, and the branch assignment is correct",
      "Open POS Readiness to catch blockers such as tax setup, stock readiness, or pending refunds",
      "Run one sample bill end to end: scan/search -> take payment -> print/send receipt",
      "Understand the difference between Void, Return, Refund settlement, and Cash movement before serving real customers",
      "Before the shift ends, review the X/Z report and clear pending items, especially any non-cash refund still waiting for settlement",
    ],
    href: ROUTES.posDevices,
    ctaLabel: "Open POS Devices",
  },
  {
    title: "When you need to investigate or explain what happened",
    desc: "Use this when the system seems off, a page behaves unexpectedly, or you need to trace who changed something",
    steps: [
      "Open Realtime Diagnostics when you need to prove that Inbox realtime or a test message is arriving",
      "Open Audit log for important actions related to money, stock, approvals, or manual actions",
      "Open Revision History when you need a before/after diff of important records",
      "Open Permissions or Users if a button is missing and you suspect an access issue",
      "Open AI Quality when the problem is about AI answers, tool failures, or handoff rates",
    ],
    href: ROUTES.realtimeDiagnostics,
    ctaLabel: "Open Realtime Diagnostics",
  },
];

const SIDEBAR_MAP_GROUPS_EN: SidebarMapGroup[] = [
  {
    title: "Top-level menus for starting work quickly",
    items: [
      { label: "Dashboard", href: ROUTES.dashboard, note: "Today's overview, urgent work, low stock, channel health, and suggested next actions" },
      { label: "Inbox", href: ROUTES.inbox, note: "The main chat workspace, Customer 360, and the usual start of day-to-day sales work" },
      { label: "Restock subscriptions", href: ROUTES.restock, note: "The queue of customers who opted in for back-in-stock alerts" },
      { label: "Mentions", href: ROUTES.mentions, note: "Messages or cases another teammate mentioned you on so follow-up does not get lost" },
      { label: "AI Assistant", href: ROUTES.assistant, note: "Ask for reports, stock, customer answers, or AI-prepared actions that still need human confirmation" },
    ],
  },
  {
    title: "Shop and order operations",
    items: [
      { label: "Products", href: ROUTES.products, note: "Products, price, stock, images, import, and sellable catalog data" },
      { label: "Orders", href: ROUTES.orders, note: "Track orders from PENDING through completion" },
      { label: "Payment", href: ROUTES.payment, note: "Review slips, confirm/reject payments, and handle refunds when allowed" },
      { label: "Shipping", href: ROUTES.shipment, note: "Create shipments, save tracking, sync carriers, and close delivery work" },
      { label: "Customers", href: ROUTES.customers, note: "CRM data, addresses, purchase history, and duplicate cleanup" },
      { label: "Coupons", href: ROUTES.coupons, note: "Master coupon setup and real redemption visibility" },
      { label: "Members & Points", href: ROUTES.loyalty, note: "Membership tiers, point rules, ledgers, and manual adjustments" },
      { label: "Follow-up Rules", href: ROUTES.followupRules, note: "Define when the system should create automatic follow-up work" },
      { label: "Follow-up Queue", href: ROUTES.followupQueue, note: "The generated follow-up work queue for staff to accept, contact, or close" },
      { label: "Purchase (PO)", href: ROUTES.purchase, note: "Create POs, map supplier SKUs, and receive goods" },
      { label: "Locations", href: ROUTES.locations, note: "Branches/warehouses used by POS and inventory operations" },
      { label: "Stock Transfers", href: ROUTES.stockTransfers, note: "Two-step inventory transfer between branches" },
      { label: "Stock Counts", href: ROUTES.stockCounts, note: "Snapshot-based stock counting that applies only the variance" },
    ],
  },
  {
    title: "Pharmacy and POS",
    items: [
      { label: "Pharmacy Intake Lab", href: ROUTES.pharmacyIntakeLab, note: "Practice or enter intake cases and see what data or escalation is needed" },
      { label: "Pharmacy Intake Queue", href: ROUTES.pharmacyQueue, note: "The live queue of pharmacy cases that need follow-up or a licensed human decision" },
      { label: "Pharmacy Protocols", href: ROUTES.pharmacyProtocols, note: "The screening rules and question sets behind the pharmacy flow" },
      { label: "Pharmacist Licenses", href: ROUTES.pharmacistLicenses, note: "Licensed-pharmacist records for shops using the pharmacy workflow" },
      { label: "POS Devices", href: ROUTES.posDevices, note: "Registers, pairing tokens, branch assignment, and cashier PINs" },
      { label: "Product packs", href: ROUTES.productPacks, note: "Extra selling units and alternate barcodes such as packs" },
      { label: "Product labels", href: ROUTES.productLabels, note: "Barcode sticker printing from product and pack data already configured" },
      { label: "POS Readiness", href: ROUTES.posReadiness, note: "Readiness blockers before the counter opens, including tax, stock, and pending refund issues" },
    ],
  },
  {
    title: "Reporting, configuration, and access control",
    items: [
      { label: "Reports", href: ROUTES.reports, note: "Historical KPIs, sales/inventory reporting, and AI Report Generator" },
      { label: "Commission", href: ROUTES.commission, note: "Commission rules, results, and clawbacks after returns" },
      { label: "AI Quality", href: ROUTES.aiQuality, note: "Success/handoff/unresolved rates, sampled conversations, and tool failures" },
      { label: "Settings", href: ROUTES.settings, note: "Shop info, payment accounts, channel token/webhook setup, AI provider, shipping defaults, and more" },
      { label: "Realtime Diagnostics", href: ROUTES.realtimeDiagnostics, note: "Test Inbox realtime and create safe test messages" },
      { label: "Billing & Plan", href: ROUTES.billing, note: "AI credits, usage, ledger, and current plan/quota visibility" },
      { label: "Users", href: ROUTES.users, note: "Add or edit staff accounts within your permission scope" },
      { label: "Permissions", href: ROUTES.permissions, note: "The role-permission matrix for the current tenant" },
      { label: "Audit log", href: ROUTES.audit, note: "Investigate important actions, especially money, stock, and approvals" },
      { label: "Revision History", href: ROUTES.revisions, note: "See and compare record revisions over time" },
    ],
  },
  {
    title: "Platform / system / dev menus (Posts intentionally excluded)",
    items: [
      { label: "Architecture", href: ROUTES.architecture, note: "The platform-level architecture and system-shape view" },
      { label: "Tenants", href: ROUTES.tenants, note: "Review or manage shops across the platform fleet" },
      { label: "Report Schedule", href: ROUTES.reportSchedule, note: "Recurring report delivery configuration and review" },
      { label: "Roles", href: ROUTES.roles, note: "Global role definitions used by the wider system" },
      { label: "Files", href: ROUTES.files, note: "Stored assets and uploaded files used around the system" },
      { label: "Logs", href: ROUTES.logs, note: "Operational logs and system event history" },
      { label: "Mail log", href: ROUTES.mailLog, note: "Email delivery history and failure tracing" },
      { label: "Support Tickets", href: ROUTES.supportTickets, note: "Issue and support-ticket tracking" },
      { label: "Batch & Cron", href: ROUTES.operationsSchedule, note: "Background jobs and scheduled task visibility" },
      { label: "System Health", href: ROUTES.systemHealth, note: "Read-only operational health overview" },
      { label: "ENV", href: ROUTES.env, note: "Environment and configuration visibility for operators" },
      { label: "Dev Console", href: ROUTES.devSqlConsole, note: "Internal debug/query tooling for qualified operators" },
      { label: "Fake data", href: ROUTES.fakeData, note: "Demo and test-data setup for safe experiments" },
      { label: "Playground", href: ROUTES.playground, note: "Controlled testing space for flows and behavior" },
    ],
  },
];

const HELP_ROWS_EN: HelpRow[] = SYSTEM_FAQ.map((faq) => ({ title: faq.question.en, answer: faq.answer.en }));

const LIMIT_GROUPS_EN: LimitGroup[] = SYSTEM_LIMITS.map((group) => ({ title: group.title.en, items: [...group.items.en] }));

const LINK_STEPS_EN: LinkStep[] = [
  {
    title: "Set up a new shop with a checklist",
    description: <>Open <Link href={ROUTES.gettingStarted}>Getting Started</Link> to walk through shop setup, channels, products, and any onboarding steps that are still incomplete.</>,
  },
  {
    title: "See today's overview and suggested actions",
    description: <>Open <Link href={ROUTES.dashboard}>Dashboard</Link> to review today's KPIs, urgent work, low stock, channel health, and the actions the system recommends next.</>,
  },
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
    description: <>Open {L.purchase}, choose a supplier, and map its SKU to the shop SKU + size on the first PO. The system reuses that mapping and latest unit cost next time, while receiving and inventory always remain authoritative on the shop SKU. Receive goods there, or select that PO in the POS Receive tab to scan a draft and confirm it into the register's branch</>,
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
    title: "Manage customers, members, points, and coupons",
    description: <>Open <Link href={ROUTES.customers}>Customers</Link>, <Link href={ROUTES.loyalty}>Loyalty</Link>, and <Link href={ROUTES.coupons}>Coupons</Link> to manage CRM data, coupon wallets, member tiers, point ledgers, and customer entitlements.</>,
  },
  {
    title: "Work from follow-up and restock queues",
    description: <>Open <Link href={ROUTES.followupRules}>Follow-up Rules</Link>, <Link href={ROUTES.followupQueue}>Follow-up Queue</Link>, and <Link href={ROUTES.restock}>Restock subscriptions</Link> so the system can create follow-up work and the team can close it from one queue.</>,
  },
  {
    title: "Run the pharmacy screening workflow",
    description: <>Open <Link href={ROUTES.pharmacyIntakeLab}>Pharmacy Intake Lab</Link> to practice or enter a case, use <Link href={ROUTES.pharmacyQueue}>Pharmacy Intake Queue</Link> for live work, and maintain the rules in <Link href={ROUTES.pharmacyProtocols}>Pharmacy Protocols</Link>.</>,
  },
  {
    title: "Set up branches, transfers, and stock counts",
    description: <>Open <Link href={ROUTES.locations}>Locations</Link>, <Link href={ROUTES.stockTransfers}>Stock Transfers</Link>, and <Link href={ROUTES.stockCounts}>Stock Counts</Link> when the shop works across more than one branch or needs a shelf-count workflow.</>,
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
        or gross profit (estimated), and re-download them later from the report history. Net sales attribute refunds to
        the date money was actually returned; a profit report with missing product costs says the data is incomplete
        instead of assuming zero cost, and a new shop with too little history receives no confident purchase forecast · to review individual answers,
        open {L.aiQuality} for success/handoff/unresolved rates, failure cases, and sampled conversations, with personal
        data masked automatically on the review screen
      </>
    ),
  },
  {
    title: "Review commission, reports, and AI credits",
    description: <>Open <Link href={ROUTES.reports}>Reports</Link>, <Link href={ROUTES.commission}>Commission</Link>, and <Link href={ROUTES.billing}>Billing</Link> to download reports, inspect commission rules/results, and review AI usage plus the billing ledger.</>,
  },
  {
    title: "Manage your own account and shop users",
    description: <>Open <Link href={ROUTES.profile}>Profile</Link> to set theme, language, and polite particle, then open <Link href={ROUTES.users}>Users</Link> when you need to add or edit staff accounts within your permission scope.</>,
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
  downloadLabel: "Download manual (.md)",
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
  searchPlaceholder: "Search the manual: returns, POS, coupon, shipping",
  searchHelp: "Type what you need, then jump straight to the matching section.",
  searchResultsLabel: "Manual search results",
  searchNoResults: "No match yet. Try a shorter phrase or a different keyword.",
  searchOpenSection: "Open this section",
  anchors: {
    hero: "Quick start",
    onboarding: "First-day onboarding",
    quickstart: "Quick start by role",
    workflow: "The whole workflow",
    archetypes: "Examples by shop type",
    coupons: "Coupon guide",
    pos: "Complete POS guide",
    menus: "Guide by menu",
    sidebarMap: "Sidebar menu map",
    faq: "Frequently asked questions",
    limits: "Known limits",
    links: "Links to frequently used pages",
  },
  onboardingTitle: "🪜 First-day onboarding",
  onboardingSubtitle: "Use this section to train a new teammate with real first-day tasks instead of making them read everything first.",
  onboardingCards: ONBOARDING_CARDS_EN,
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
        "Use Tenants, Report Schedule, Logs, System Health, and ENV when operating across multiple shops or investigating system-wide issues",
        "Use Dev Console, Fake data, or Playground only for controlled internal testing and debugging",
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
  posTitle: "🧾 Practical POS guide",
  posSubtitle: "Set up a register, open a shift, sell, take payment, process returns, receive goods, and close the shift in the same order staff use /pos.",
  posAlertMessage: "The device identifies the branch · the PIN identifies the operator · permissions control the action",
  posAlertDesc:
    "Pairing a register does not authorize money or stock movements. Every important action rechecks the operator's PIN and server-side permission. Manual discounts, voids, and cash leaving the drawer also require a separate second approver's PIN.",
  posBeforeOpenTitle: "Set up before going live",
  posBeforeOpenSteps: [
    {
      title: "1. Check shop readiness",
      description: "Open POS Readiness and clear blockers for locations, devices, cashiers, sellable products, stock, and pending refunds. VAT shops must configure tax settings, tax id, and each product's VAT category. Pharmacies must also complete pharmacist review and inspect lots/expiry.",
    },
    {
      title: "2. Add and pair each register",
      description: "In POS Devices, add the code/name, branch, registered POS number, and receipt prefix. Issue a token and open its pairing link on the register. The token is shown once; reissue it only when needed because the old token stops working immediately.",
    },
    {
      title: "3. Configure the physical scanner",
      description: "PREFIX mode is recommended for production: program the scanner to send the selected function key, normally F9, before the payload and Enter/Tab afterward. FOCUS mode supports older hardware but requires the correct input to stay focused.",
    },
    {
      title: "4. Configure staff PINs and permissions",
      description: "Give each operator a 4–8 digit PIN and the appropriate role. Staff without a PIN cannot be selected. Five wrong attempts lock the PIN for 15 minutes. A POS-only Cashier account is genuinely blocked from /admin.",
    },
    {
      title: "5. Rehearse the whole hardware flow",
      description: "On every register, test scanning, receipt printing, the drawer, customer display, cash/change, QR, card, wallet, split tender, a partial return, non-cash refund settlement, and a shift close with a known variance.",
    },
    {
      title: "6. Prepare an outage procedure",
      description: "This POS needs the BMS server and PostgreSQL for search, sales, returns, settlement, and shifts. Keep a paper fallback, a payment procedure, and a written reconciliation process for entering activity after connectivity returns.",
    },
  ],
  posDailyTitle: "How to use every POS workflow",
  posGuideCards: [
    {
      title: "Start a shift and identify the seller",
      desc: "Do this before serving the first customer.",
      steps: [
        "Choose the operator in the top bar and enter their PIN. The PIN is memory-only and must be re-entered after a refresh.",
        "Open the Shift tab, enter the opening drawer float, and press Open shift.",
        "If the screen says selling is blocked, follow its checklist: configure a PIN, select the operator, or open the shift.",
        "A register can read and close only its own shift; do not reuse another register's shift id.",
      ],
      warning: "Never share a PIN or sell under someone else's name: receipts, audit, shift reports, and commission identify the PIN holder.",
    },
    {
      title: "Scan, search, and build the cart",
      desc: "Sell base units, packs, sizes, and serial-tracked products.",
      steps: [
        "Scan a barcode or type a name/SKU and press Enter. If several sizes are available, select the in-stock size.",
        "Check item shows current price and stock without adding to the cart. Camera scanning is a test mode available only in supported browsers.",
        "Change quantities with +/−. The cart applies configured pack prices, size prices, wholesale tiers, and promotions. Packs retain their own price and are excluded from promotions.",
        "Serial-tracked goods need one serial per base unit: two packs of ten require twenty serials, with no duplicate anywhere on the bill.",
        "Add bag, wrapping, or service fees as extra lines instead of fake SKUs. They do not move stock, are not discountable, and remain in the VAT base.",
        "Immediately before payment, the register reloads current pack/wholesale/promotion pricing. Review and retender if the total changes.",
      ],
    },
    {
      title: "Members, coupons, points, and discounts",
      desc: "Attach the customer before payment so benefits and ledgers belong to the right person.",
      steps: [
        "Search by phone or member number. If no match exists, press Enrol, enter the details, and attach the new member.",
        "Discounts stack in order: tier, coupon, points, then manual discount, under the shop's per-bill cap.",
        "Enter a coupon and wait for server validation. Expired, exhausted, below-minimum, or over-limit codes are rejected.",
        "Redeem whole point units with +/−, a typed amount, or All; remainder points stay on the account.",
        "A manual discount needs amount, reason, approver, and a fresh second PIN. The approver must differ from the seller and hold pos.discount.approve.",
        "The receipt shows points earned/redeemed and the balance; returns reverse points proportionally.",
      ],
    },
    {
      title: "Take payment and split tender",
      desc: "All payment rows must equal the server-computed total.",
      steps: [
        "For a normal sale choose Cash, QR, Card, or Wallet. For cash, enter tendered money or use Exact/quick-note buttons and verify change.",
        "QR, card, and wallet stay locked to the bill total and may carry a reference or approval code.",
        "Press + Split payment to add rows, allocate each amount, and enter the actual cash tender on cash rows.",
        "Cash rounding applies only to fully-cash bills and prints as its own line without changing the VAT base.",
        "If invoice issuance reports an unclassified VAT item, classify the named product as V or N, then retry the recovered bill. It reuses the original order and idempotency key without taking payment twice.",
        "Press Pay once and wait. If the response is lost, retry the recovered sale; it reuses the idempotency key and cannot create a second bill.",
      ],
      warning: "The current normal-sale buttons are Cash/QR/Card/Wallet. Bank transfer is available in the deposit workflow but has no normal-sale button yet.",
    },
    {
      title: "Receipts, printer, and customer display",
      desc: "Verify the result and send a copy without issuing a new document.",
      steps: [
        "After payment, verify document number, tender, and change, then print or preview. Enter prints and Esc closes the dialog.",
        "The receipt shows the snapshotted size/list price and a separate wholesale/promotion adjustment so the arithmetic is auditable, together with charges, order-level discounts, VAT/exempt VAT, rounding, payments, cashier, member, and the receipt barcode. Reprints never read today's product price.",
        "Pair a WebUSB printer in Settings. Unsupported browsers fall back to the print dialog, which cannot kick the drawer.",
        "Open Customer display and move it to a second monitor on the same computer. It is read-only and shows the latest eight lines, total, discounts, and change.",
        "Email a copy to a one-off address or leave it blank to use the member profile. LINE delivery requires the customer to have linked LINE to the shop.",
        "Use Load latest receipt from server to reprint after a page refresh.",
      ],
    },
    {
      title: "Park bills and take deposits",
      desc: "Keep a temporary wait separate from a stock-reserving deposit.",
      steps: [
        "Park an unpaid cart with a useful label, then resume or discard it later. The cap is twenty per shift.",
        "Parked bills reserve no stock and lock no price; resume uses current stock/pricing and parked bills end with the shift.",
        "If a pharmacy-controlled item needs pharmacist review, POS can create the pharmacy case from the counter, link it to the parked bill, and clear the register immediately. The bill stays blocked until that case is approved.",
        "For a walk-in deposit, add goods to the POS cart, open Deposits, enter the amount/method, then use Create order + take deposit. The server creates the Order ID, recalculates pricing, and reserves stock.",
        "For an Inbox / Customer 360 order, select its branch-local PENDING bill from the list; do not type a UUID or product barcode. Use Take first deposit or Add, with each amount below the remaining balance.",
        "When fully paid, use Take balance + hand over goods so stock, lots, documents, points, and audit complete together.",
        "For serial-tracked goods, scan the delivered items and enter their serials before settlement.",
        "Close a deposit as cancelled or forfeited with a reason. Reserved stock is released, but any payout uses the separate refund flow.",
      ],
    },
    {
      title: "Returns, exchanges, voids, and no-receipt returns",
      desc: "Start in Returns and choose the path that matches what happened.",
      steps: [
        "Search by receipt/order id or use recent sales. Select a reason and mandatory detail, then return the full bill or cumulative quantities per line.",
        "A search covers completed POS, web, and social bills at every branch. Lazada/Shopee returns stay in the originating marketplace workflow.",
        "A bill from another register in the same branch can be returned normally. Another branch requires a distinct approver PIN with pos.return.cross_branch; stock enters the receiving branch and cash leaves its active shift.",
        "A cross-branch customer return is not a stock transfer. If the item must later go back to the sale branch, create a normal transfer from the receiving branch.",
        "If the original sale used split tender, first choose whether the refund consumes cash, card, QR, or another original method. POS shows the remaining refundable cap for every method, never exceeds what was received there, and spills only the excess into other original methods.",
        "After a return, use View latest return slip, or open Bill history and choose the specific return slip to reprint that event. Line amounts are the actual refund after allocating the original discounts. View original sale keeps the original quantities, shelf prices, discounts, and total because the sale document is never rewritten.",
        "For new bills with an exact sale-time rule snapshot, a partial return rechecks the retained quantity against wholesale/promotion rules. Falling below a threshold reprices the retained goods and reduces the refund; Bill history shows that adjustment. Legacy bills keep proportional refunds rather than guessing old rules.",
        "Use Bill history on each receipt to see the original sale, every return, returned lines, operator/approver, refund settlement, credit note, and remaining net amount. The original sale document is never rewritten.",
        "Cash refunds complete immediately. QR/card/wallet allocations remain pending until someone with payment.refund records the external reference; the shift cannot close while they remain pending.",
        "Open Returns and use the top queue for pending refund settlements. Shift summary links straight to that queue, and the pending filter keeps only receipts that still need confirmation.",
        "The receipt card still shows every refund allocation together, including completed and pending legs. Do not read the one pending QR/card row as the entire refund.",
        "Exchange first returns the old goods, then loads the remaining lines into a new cart for an ordinary new sale.",
        "Void only a mis-rung bill from the still-open shift, with no prior return, a reason, and a second approver PIN. After close, use Return.",
        "For no-receipt returns, explicitly open that form, scan the goods, give a reason, and obtain pos.return.noreceipt approval. Refund is cash, capped at today's shelf price, with no credit note.",
        "A same-branch partial return does not release serials because the system cannot know which unit came back. Cross-branch partial serial returns are refused; a full return moves the serial to the receiving branch.",
      ],
      warning: "The screen starts approval flow at ฿500 and marks ฿2,000+ as high value. Clear pending refund settlements before shift close.",
    },
    {
      title: "Receive a PO at the register",
      desc: "Receive into the device branch through the existing purchase workflow.",
      steps: [
        "Choose the receiver, enter their PIN, and load receivable POs. purchase.receive is checked every time.",
        "Choose an OPEN/PARTIAL PO and scan into a draft; stock does not move while scanning.",
        "Review quantities against the remaining amount and enter lot/expiry when applicable.",
        "Confirm once after review. Goods, movement, PO status, and audit commit to the register's branch together.",
        "If the response is lost, retry the same request so the stored result replays instead of receiving twice.",
      ],
    },
    {
      title: "Expenses, petty cash, and drawer movements",
      desc: "Choose the correct flow so shift cash and expense records remain explainable.",
      steps: [
        "Direct drawer spending or an advance needs detail and a distinct second approver. Every advance must return for actual-cost settlement before close; change/shortfall updates the drawer automatically.",
        "Sole-owner personal funding requires an Administrator with pos.expense.personal plus evidence and does not touch drawer cash.",
        "The branch petty-cash wallet is outside the drawer. An Administrator funds it from owner/business money with evidence, then staff can pay evidenced expenses without a second PIN.",
        "Use Drawer cash in/out only for non-sale money such as added change, bank drops, or till transfers. Cash sales are already included and must never be entered again.",
        "Cash out requires a distinct approver and cannot exceed expected cash. Cash in requires confirmation that it is external to sales.",
        "Use No sale in Shift, with a reason and PIN, whenever opening the drawer without a sale. The report counts every event.",
      ],
    },
    {
      title: "X/Z reports, tax, and commission",
      desc: "Finish reconciliation and document checks before handing over the shift.",
      steps: [
        "View Shift summary mid-shift for the X report: sales, bills, discounts, voids, returns, method/cashier splits, drawer movements, expenses, no-sales, and pending refunds.",
        "With blind close enabled, expected cash stays hidden until close. Count the physical drawer before entering counted cash.",
        "Close is blocked by cart items, open expense advances, or pending non-cash refunds. After close, the same report is the Z report with expected/count/variance.",
        "When a total is disputed, open this register's shift history and download the detailed workbook to trace bills, payment legs, drawer movements, refunds, expenses, and no-sales. An old receipt returned today belongs to today's receiving shift.",
        "Tax settings in POS Readiness affect new bills only. Issued documents are immutable, and e-Tax submission is a separate queue rather than an automatic sale action.",
        "Managers with pos.shift.report.all can review every drawer at /admin/pos-shifts, filtering by shift-open date, location, till, involved person, and exception signal. It is read-only and does not replace POS close-shift/counting; an open blind-close shift must be closed and counted before its Excel export is available.",
        "The /admin/commission report uses effective-dated rules. Returns claw commission back and voids earn none.",
      ],
    },
  ],
  posPermissionsTitle: "Permissions to verify by role",
  posPermissions: [
    "Register/PIN/POS-only setup: pos.device.manage, pos.pin.manage, pos.staff.manage",
    "Sales and shifts: pos.sell, pos.shift.open, pos.shift.close, pos.shift.report; back-office all-till overview: pos.shift.report.all",
    "Members and discounts: member.view, member.manage, pos.discount.approve (approver must differ from seller)",
    "Returns and refunds: order.return, payment.refund, pos.return.noreceipt, pos.void",
    "Cash and expenses: pos.cash.movement, pos.nosale, pos.expense.create, pos.expense.personal, pos.petty_cash.manage",
    "Deposits/receiving/tax/commission: pos.deposit.take, pos.deposit.cancel, purchase.receive, tax.setting.manage, commission.view, commission.manage",
  ],
  posBoundariesTitle: "Boundaries to explain during training",
  posBoundaries: [
    "The POS is online, not offline-first. Record outage work and reconcile it later using the shop's written procedure.",
    "Camera scanning is a test mode, and ESC/POS/WebUSB must be tested per printer model. There is no EDC terminal driver.",
    "Store credit/gift card services and APIs exist, but issue/redeem controls are not connected to the current POS screen; do not train this as an available counter workflow.",
    "e-Tax is not automatically submitted to the Revenue Department and its live provider remains separately gated; verify local tax documents with the accountant.",
    "This is a general-retail POS. It has no restaurant floor plan, KDS, modifiers/toppings, queue/reservation flow, or kitchen printer routing.",
  ],
  posOpenLabels: ["Open POS", "Registers and PINs", "Check readiness", "Members and points", "View commission"],
  menusTitle: "🧩 Guide by menu",
  menusSubtitle: "Short cards so you can scan and immediately know what each menu is for.",
  menuCards: MENU_CARDS_EN,
  menuOpenPagePrefix: "Open",
  menuGroupingAlertMessage: "A note on grouping",
  menuGroupingAlertDesc:
    "Orders / Payment / Shipping should sit close together in the manual, because people work through them as one continuous flow. Products belongs next to Purchase, because both are about having goods ready to sell.",
  sidebarMapTitle: "🗺 Sidebar menu map",
  sidebarMapSubtitle: "If someone already remembers the menu name from the left sidebar, use this section to jump to the correct page quickly.",
  sidebarMapGroups: SIDEBAR_MAP_GROUPS_EN,
  faqTitle: "❓ Frequently asked questions",
  faqSubtitle: "Short questions and answers, so you spend less time hunting through long documents.",
  helpRows: HELP_ROWS_EN,
  limitsTitle: "⚠️ Known limits and the mechanics behind them",
  limitsSubtitle:
    "The equations and state machines the system holds to, common traps, numbers to always read as estimates, permissions by module, and what isn't supported yet — read this before promising anything to a customer or teammate.",
  limitsGroups: LIMIT_GROUPS_EN,
  linksTitle: "🔗 Links to frequently used pages",
  linksSubtitle: "Jump straight into the real work without reading the whole page.",
  linkSteps: LINK_STEPS_EN,
  linksAlertMessage: "The idea behind this manual",
  linksAlertDesc:
    "Opening it should immediately answer “where do I start”, “what is this menu for”, and “where do I look if I get stuck”.",
  sidebarTocTitle: "Contents",
  sidebarShortcutsTitle: "Suggested shortcuts",
  sidebarShortcuts: [
    { label: "Open Dashboard", href: ROUTES.dashboard, icon: <DashboardOutlined /> },
    { label: "Open Inbox", href: ROUTES.inbox, icon: <InboxOutlined /> },
    { label: "Open Orders", href: ROUTES.orders, icon: <ShoppingCartOutlined /> },
    { label: "Open Follow-up Queue", href: ROUTES.followupQueue, icon: <CustomerServiceOutlined /> },
    { label: "Open POS Devices", href: ROUTES.posDevices, icon: <ShopOutlined /> },
    { label: "Open Pharmacy Intake Queue", href: ROUTES.pharmacyQueue, icon: <FileSearchOutlined /> },
    { label: "Open Settings", href: ROUTES.settings, icon: <ApiOutlined /> },
    { label: "Open Users", href: ROUTES.users, icon: <UserOutlined /> },
  ],
  sidebarNextTitle: "What to do after reading this page",
  sidebarNextItems: [
    "Pick the onboarding card that matches the new teammate's real job",
    "Use the shortcuts or sidebar menu map to jump straight into the real page",
    "For a new shop, go Getting Started -> Settings -> Products -> Dashboard",
    "For POS or Pharmacy shops, rehearse the specialized flow before using it with real customers",
  ],
  noteTitle: "Note",
  noteBody:
    "This page has now been reworked into a more practical manual: quick start, first-day onboarding, workflow guidance, the POS guide, a sidebar menu map, and page search all live in one place. The goal is to help new staff start faster and help existing staff find the right page without guessing.",
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
    <section id={id} className={styles.section} style={{ scrollMarginTop: 88 }}>
      <Title level={3} className={styles.sectionTitle}>
        {title}
      </Title>
      {subtitle ? (
        <Paragraph type="secondary" className={styles.sectionSubtitle}>
          {subtitle}
        </Paragraph>
      ) : null}
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function extractDescriptionText(description: React.ReactNode): string {
  if (typeof description === "string") return description;
  if (typeof description === "number") return String(description);
  if (Array.isArray(description)) {
    return description.map((item) => extractDescriptionText(item)).join(" ");
  }
  if (description && typeof description === "object" && "props" in description) {
    return extractDescriptionText((description as { props?: { children?: React.ReactNode } }).props?.children ?? "");
  }
  return "";
}

/**
 * Flattens the whole bilingual manual into one Markdown document for the
 * download button. Reuses the same content object the page renders from, so
 * the file can never drift out of sync with what's on screen — there is no
 * second copy of the text to maintain.
 */
function buildManualMarkdown(c: ManualContent): string {
  const lines: string[] = [];
  const h1 = (t: string) => lines.push(`# ${t}`, "");
  const h2 = (t: string) => lines.push(`## ${t}`, "");
  const h3 = (t: string) => lines.push(`### ${t}`, "");
  const p = (t?: string) => t && lines.push(t, "");
  const bullets = (items: string[]) => {
    items.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  };

  h1(c.heroTitle);
  p(c.heroLead);
  p(`${c.heroAlertMessage} — ${c.heroAlertDesc}`);

  h2(c.onboardingTitle);
  p(c.onboardingSubtitle);
  c.onboardingCards.forEach((card) => {
    h3(card.title);
    p(card.desc);
    bullets(card.steps);
  });

  h2(c.quickstartTitle);
  p(c.quickstartSubtitle);
  (Object.keys(c.personaCards) as PersonaKey[]).forEach((key) => {
    const card = c.personaCards[key];
    h3(`${c.personaButtons[key]} — ${card.title}`);
    p(card.subtitle);
    bullets(card.items);
  });

  h2(c.workflowTitle);
  p(c.workflowSubtitle);
  (Object.keys(c.flowCards) as FlowKey[]).forEach((key) => {
    const card = c.flowCards[key];
    h3(`${c.flowButtons[key]} — ${card.title} (${card.path})`);
    p(card.summary);
    if (card.tags.length) p(card.tags.map((tag) => `\`${tag}\``).join(" "));
    bullets(card.checks);
  });

  h2(c.archetypesTitle);
  p(c.archetypesSubtitle);
  p(`${c.archetypeAlertMessage} — ${c.archetypeAlertDesc}`);
  c.archetypeExamples.forEach((example) => {
    h3(example.label);
    p(example.focus);
    bullets([
      `${c.archetypeCustomerAskLabel}: ${example.customerAsk}`,
      `${c.archetypeAiReplyLabel}: ${example.aiReply}`,
      `${c.archetypeBackendFlowLabel}: ${example.backendFlow}`,
      `${c.archetypeWhyLabel}: ${example.whyItFits}`,
    ]);
  });

  h2(c.couponsTitle);
  p(c.couponsSubtitle);
  p(`${c.couponAlertMessage} — ${c.couponAlertDesc}`);
  h3(c.couponStepsTitle);
  bullets(c.couponSteps.map((step) => `${step.title} — ${step.description}`));
  h3(c.couponWhereToSeeTitle);
  bullets(c.couponWhereToSee);
  h3(c.couponWalletStatesTitle);
  bullets(c.couponWalletMeanings);
  h3(c.couponConditionsTitle);
  c.couponConditions.forEach((row) => lines.push(`- **${row.condition}** — ${row.result}`));
  lines.push("");
  h3(c.couponGapsTitle);
  bullets(c.couponGaps);

  h2(c.posTitle);
  p(c.posSubtitle);
  p(`${c.posAlertMessage} — ${c.posAlertDesc}`);
  h3(c.posBeforeOpenTitle);
  bullets(c.posBeforeOpenSteps.map((step) => `${step.title} — ${step.description}`));
  h3(c.posDailyTitle);
  c.posGuideCards.forEach((card) => {
    lines.push(`- **${card.title}** — ${card.desc}`);
    card.steps.forEach((step) => lines.push(`  - ${step}`));
    if (card.warning) lines.push(`  - ⚠️ ${card.warning}`);
  });
  lines.push("");
  h3(c.posPermissionsTitle);
  bullets(c.posPermissions);
  h3(c.posBoundariesTitle);
  bullets(c.posBoundaries);

  h2(c.menusTitle);
  p(c.menusSubtitle);
  c.menuCards.forEach((card) => {
    h3(card.title);
    p(card.desc);
    bullets(card.bullets);
  });
  p(`${c.menuGroupingAlertMessage} — ${c.menuGroupingAlertDesc}`);

  h2(c.sidebarMapTitle);
  p(c.sidebarMapSubtitle);
  c.sidebarMapGroups.forEach((group) => {
    h3(group.title);
    bullets(group.items.map((item) => `${item.label} (${item.href}) — ${item.note}`));
  });

  h2(c.faqTitle);
  p(c.faqSubtitle);
  c.helpRows.forEach((row) => {
    h3(row.title);
    p(row.answer);
  });

  h2(c.limitsTitle);
  p(c.limitsSubtitle);
  c.limitsGroups.forEach((group) => {
    h3(group.title);
    bullets(group.items);
  });

  h2(c.linksTitle);
  p(c.linksSubtitle);
  bullets(c.linkSteps.map((step) => `${step.title} — ${extractDescriptionText(step.description)}`));
  p(`${c.linksAlertMessage} — ${c.linksAlertDesc}`);

  h2(c.noteTitle);
  p(c.noteBody);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export default function Page() {
  const { lang } = useI18n();
  const c = resolveBilingual(MANUAL, lang);

  const [persona, setPersona] = useState<PersonaKey>("owner");
  const [flow, setFlow] = useState<FlowKey>("products");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery.trim());

  const activePersona = c.personaCards[persona];
  const activeFlow = c.flowCards[flow];

  // Builds the .md fresh from the same content object the page renders, so the
  // file can never go stale relative to what's on screen. No server round trip —
  // this manual has no per-tenant data in it, just static guidance text.
  const handleDownload = useCallback(() => {
    const markdown = buildManualMarkdown(c);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bms-admin-manual-${lang}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [c, lang]);

  const anchorItems = useMemo(
    () => [
      { key: "hero", href: "#hero", title: c.anchors.hero },
      { key: "onboarding", href: "#onboarding", title: c.anchors.onboarding },
      { key: "quickstart", href: "#quickstart", title: c.anchors.quickstart },
      { key: "workflow", href: "#workflow", title: c.anchors.workflow },
      { key: "archetypes", href: "#archetypes", title: c.anchors.archetypes },
      { key: "coupons", href: "#coupons", title: c.anchors.coupons },
      { key: "pos", href: "#pos", title: c.anchors.pos },
      { key: "menus", href: "#menus", title: c.anchors.menus },
      { key: "sidebarMap", href: "#sidebarMap", title: c.anchors.sidebarMap },
      { key: "faq", href: "#faq", title: c.anchors.faq },
      { key: "limits", href: "#limits", title: c.anchors.limits },
      { key: "links", href: "#links", title: c.anchors.links },
    ],
    [c.anchors]
  );

  const searchSections = useMemo(
    () => [
      {
        id: "onboarding",
        title: c.onboardingTitle,
        lines: [
          c.onboardingSubtitle,
          ...c.onboardingCards.flatMap((card) => [card.title, card.desc, card.ctaLabel, ...card.steps]),
        ],
      },
      {
        id: "quickstart",
        title: c.quickstartTitle,
        lines: [
          c.quickstartSubtitle,
          ...Object.values(c.personaButtons),
          ...Object.values(c.personaCards).flatMap((card) => [card.title, card.subtitle, card.ctaLabel, ...card.items]),
        ],
      },
      {
        id: "workflow",
        title: c.workflowTitle,
        lines: [
          c.workflowSubtitle,
          ...Object.values(c.flowButtons),
          ...Object.values(c.flowCards).flatMap((card) => [card.title, card.path, card.summary, ...card.tags, ...card.checks]),
        ],
      },
      {
        id: "archetypes",
        title: c.archetypesTitle,
        lines: [
          c.archetypesSubtitle,
          c.archetypeAlertMessage,
          c.archetypeAlertDesc,
          ...c.archetypeExamples.flatMap((item) => [
            item.label,
            item.focus,
            item.customerAsk,
            item.aiReply,
            item.backendFlow,
            item.whyItFits,
          ]),
        ],
      },
      {
        id: "coupons",
        title: c.couponsTitle,
        lines: [
          c.couponsSubtitle,
          c.couponAlertMessage,
          c.couponAlertDesc,
          c.couponStepsTitle,
          c.couponWhereToSeeTitle,
          c.couponWalletStatesTitle,
          c.couponConditionsTitle,
          c.couponGapsTitle,
          ...c.couponSteps.flatMap((step) => [step.title, step.description]),
          ...c.couponWhereToSee,
          ...c.couponWalletMeanings,
          ...c.couponConditions.flatMap((item) => [item.condition, item.result]),
          ...c.couponGaps,
        ],
      },
      {
        id: "pos",
        title: c.posTitle,
        lines: [
          c.posSubtitle,
          c.posAlertMessage,
          c.posAlertDesc,
          c.posBeforeOpenTitle,
          c.posDailyTitle,
          ...c.posOpenLabels,
          ...c.posBeforeOpenSteps.flatMap((step) => [step.title, step.description]),
          ...c.posGuideCards.flatMap((card) => [card.title, card.desc, ...(card.warning ? [card.warning] : []), ...card.steps]),
          ...c.posPermissions,
          ...c.posBoundaries,
        ],
      },
      {
        id: "menus",
        title: c.menusTitle,
        lines: [
          c.menusSubtitle,
          c.menuGroupingAlertMessage,
          c.menuGroupingAlertDesc,
          ...c.menuCards.flatMap((card) => [card.title, card.desc, ...card.bullets]),
        ],
      },
      {
        id: "sidebarMap",
        title: c.sidebarMapTitle,
        lines: [
          c.sidebarMapSubtitle,
          ...c.sidebarMapGroups.flatMap((group) => [group.title, ...group.items.flatMap((item) => [item.label, item.note])]),
        ],
      },
      {
        id: "faq",
        title: c.faqTitle,
        lines: [c.faqSubtitle, ...c.helpRows.flatMap((row) => [row.title, row.answer])],
      },
      {
        id: "limits",
        title: c.limitsTitle,
        lines: [c.limitsSubtitle, ...c.limitsGroups.flatMap((group) => [group.title, ...group.items])],
      },
      {
        id: "links",
        title: c.linksTitle,
        lines: [
          c.linksSubtitle,
          c.linksAlertMessage,
          c.linksAlertDesc,
          ...c.linkSteps.flatMap((step) => [step.title, extractDescriptionText(step.description)]),
        ],
      },
    ],
    [c]
  );

  const searchResults = useMemo(() => {
    const query = normalizeText(deferredSearch);
    if (!query) return [];

    return searchSections
      .map((section) => {
        const normalizedTitle = normalizeText(section.title);
        const matchedLines = section.lines.filter((line) => normalizeText(line).includes(query));
        const score =
          (normalizedTitle.includes(query) ? 5 : 0) +
          matchedLines.reduce((total, line) => total + (normalizeText(line).startsWith(query) ? 3 : 1), 0);

        return {
          id: section.id,
          title: section.title,
          score,
          snippets: matchedLines.slice(0, 3),
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 8);
  }, [deferredSearch, searchSections]);

  return (
    <div className={styles.page}>
      <div id="hero" className={styles.heroWrap}>
        <Card className={styles.hero}>
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Tag color="blue" style={{ width: "fit-content", paddingInline: 12, borderRadius: 999 }}>
              {c.heroTag}
            </Tag>
            <Title className={styles.heroTitle}>{c.heroTitle}</Title>
            <Paragraph type="secondary" className={styles.heroLead}>
              {c.heroLead}
            </Paragraph>

            <Alert
              type="info"
              showIcon
              closable
              message={c.heroAlertMessage}
              description={c.heroAlertDesc}
              style={{ borderRadius: 16 }}
            />

            <Space wrap className={styles.heroCtas}>
              <Button type="primary" size="large" href="#quickstart">
                {c.heroCtaQuickstart}
              </Button>
              <Button size="large" href="#workflow">
                {c.heroCtaWorkflow}
              </Button>
              <Button size="large" href="#menus">
                {c.heroCtaMenus}
              </Button>
              <Button size="large" href="#pos">
                {c.anchors.pos}
              </Button>
              <Button size="large" icon={<DownloadOutlined />} onClick={handleDownload}>
                {c.downloadLabel}
              </Button>
            </Space>

            <Space wrap>
              {c.heroTags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </Space>

            <Card className={styles.heroSearch}>
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Input.Search
                  allowClear
                  size="large"
                  placeholder={c.searchPlaceholder}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                <Text type="secondary">{c.searchHelp}</Text>
                {deferredSearch ? (
                  searchResults.length > 0 ? (
                    <List<SearchResult>
                      size="small"
                      dataSource={searchResults}
                      renderItem={(item) => (
                        <List.Item style={{ paddingInline: 0 }}>
                          <Card size="small" style={{ width: "100%", borderRadius: 14 }}>
                            <Space direction="vertical" size={8} style={{ width: "100%" }}>
                              <Space wrap align="center">
                                <Tag color="blue">{c.searchResultsLabel}</Tag>
                                <Text strong>{item.title}</Text>
                              </Space>
                              <List
                                size="small"
                                dataSource={item.snippets}
                                renderItem={(snippet) => (
                                  <List.Item style={{ paddingInline: 0 }}>
                                    <Text type="secondary">• {snippet}</Text>
                                  </List.Item>
                                )}
                              />
                              <div>
                                <Button type="link" href={`#${item.id}`} style={{ paddingInline: 0 }}>
                                  {c.searchOpenSection}
                                </Button>
                              </div>
                            </Space>
                          </Card>
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Alert key={deferredSearch} type="warning" showIcon closable message={c.searchNoResults} style={{ borderRadius: 14 }} />
                  )
                ) : null}
              </Space>
            </Card>
          </Space>
        </Card>
        <Alert
          type="success"
          showIcon
          closable
          style={{ marginTop: 12, borderRadius: 12 }}
          message={lang === "en" ? "Phase 1: daily actions + smarter purchasing" : "Phase 1: งานวันนี้ + ซื้อของแม่นขึ้น"}
          description={lang === "en"
            ? "On Dashboard, refresh signals, accept an action, then complete or dismiss it with a reason. Inventory recommendations include demand trend, safety stock, lead time, open PO quantities, slow/dead stock and FEFO expiry. Record a lost sale on a low-stock line so unmet demand improves the next recommendation. Recommendations remain advisory and require staff review."
            : "ที่ Dashboard ให้กดอัปเดตสัญญาณ รับทำ Action แล้วปิดงานหรือเลือกไม่ทำพร้อมเหตุผล คำแนะนำสต็อกจะรวมแนวโน้ม Demand, Safety stock, Lead time, ของที่กำลังมากับ PO, Slow/Dead stock และวันหมดอายุแบบ FEFO หากขายไม่ได้เพราะของขาด ให้บันทึก Lost sale ในรายการ Low stock เพื่อให้คำแนะนำรอบถัดไปนับ Demand ที่พลาดด้วย ทุกคำแนะนำยังต้องให้พนักงานทบทวนก่อนสั่งซื้อจริง"}
        />
        <Alert
          type="info" showIcon closable style={{ marginTop: 12, borderRadius: 12 }}
          message={lang === "en" ? "Phase 2: retention engine" : "Phase 2: Retention engine"}
          description={lang === "en"
            ? "Open Follow-up queue > Retention engine, refresh intelligence, review RFM/risk/evidence and the proposed channel, message, offer and product. Accept before contacting. Never contact HOLDOUT rows; they provide the baseline used to measure incremental conversion."
            : "เปิด Follow-up queue > Retention engine แล้วอัปเดตข้อมูล ตรวจ RFM/ความเสี่ยง/หลักฐาน รวมถึง Channel, Message, Offer และสินค้าที่ระบบเสนอ กดรับทำก่อนติดต่อ และห้ามติดต่อแถว HOLDOUT เพราะเป็น Baseline สำหรับวัด Incremental conversion"}
        />
      </div>

      <div className={styles.layout}>
        <div className={styles.main}>
            <Section
              id="onboarding"
              title={c.onboardingTitle}
              subtitle={c.onboardingSubtitle}
            >
              <Row gutter={[14, 14]}>
                {c.onboardingCards.map((card) => (
                  <Col xs={24} md={12} key={card.title}>
                    <Card style={{ borderRadius: 16, height: "100%", background: "#fafcff" }}>
                      <Space direction="vertical" size={12} style={{ width: "100%" }}>
                        <div>
                          <Title level={4} style={{ margin: 0 }}>
                            {card.title}
                          </Title>
                          <Paragraph type="secondary" style={{ margin: "6px 0 0" }}>
                            {card.desc}
                          </Paragraph>
                        </div>

                        <List
                          size="small"
                          dataSource={card.steps}
                          renderItem={(step, index) => (
                            <List.Item style={{ paddingInline: 0, alignItems: "flex-start" }}>
                              <Text><Text strong>{index + 1}.</Text> {step}</Text>
                            </List.Item>
                          )}
                        />

                        <div>
                          <Link href={card.href}>
                            <Button type="primary" style={{ whiteSpace: "normal", height: "auto", textAlign: "left" }}>
                              {card.ctaLabel}
                            </Button>
                          </Link>
                        </div>
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>
            </Section>

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

                      <Alert key={flow} type="success" showIcon closable message={activeFlow.summary} style={{ borderRadius: 14 }} />

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
                  closable
                  style={{ borderRadius: 14 }}
                  message={c.archetypeAlertMessage}
                  description={c.archetypeAlertDesc}
                />

                <Row gutter={[14, 14]}>
                  {c.archetypeExamples.map((item, index) => (
                    <Col xs={24} key={ARCHETYPE_KEYS[index]}>
                      <Card style={{ borderRadius: 16 }}>
                        <Space direction="vertical" size={10} style={{ width: "100%" }}>
                          <Space wrap style={{ maxWidth: "100%" }}>
                            <Tag color="blue">{item.label}</Tag>
                            <Tag style={{ whiteSpace: "normal", height: "auto", lineHeight: 1.5, maxWidth: "100%" }}>
                              {item.focus}
                            </Tag>
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
                  closable
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
              id="pos"
              title={c.posTitle}
              subtitle={c.posSubtitle}
            >
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert
                  type="warning"
                  showIcon
                  closable
                  style={{ borderRadius: 14 }}
                  message={c.posAlertMessage}
                  description={c.posAlertDesc}
                />

                <Card style={{ borderRadius: 16, background: "#fafcff" }}>
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Title level={4} style={{ margin: 0 }}>{c.posBeforeOpenTitle}</Title>
                    <Steps direction="vertical" current={-1} items={c.posBeforeOpenSteps} />
                  </Space>
                </Card>

                <div>
                  <Title level={4} style={{ margin: "0 0 12px" }}>{c.posDailyTitle}</Title>
                  <Row gutter={[14, 14]}>
                    {c.posGuideCards.map((item) => (
                      <Col xs={24} xl={12} key={item.title}>
                        <Card style={{ borderRadius: 16, height: "100%" }}>
                          <Space direction="vertical" size={8} style={{ width: "100%" }}>
                            <Title level={5} style={{ margin: 0 }}>{item.title}</Title>
                            <Text type="secondary">{item.desc}</Text>
                            <List
                              size="small"
                              dataSource={item.steps}
                              renderItem={(step, index) => (
                                <List.Item style={{ paddingInline: 0, alignItems: "flex-start" }}>
                                  <Text><Text strong>{index + 1}.</Text> {step}</Text>
                                </List.Item>
                              )}
                            />
                            {item.warning ? (
                              <Alert type="warning" showIcon closable message={item.warning} style={{ borderRadius: 12 }} />
                            ) : null}
                          </Space>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                </div>

                <Row gutter={[14, 14]}>
                  <Col xs={24} lg={12}>
                    <Card title={c.posPermissionsTitle} style={{ borderRadius: 16, height: "100%" }}>
                      <List
                        size="small"
                        dataSource={c.posPermissions}
                        renderItem={(item) => (
                          <List.Item style={{ paddingInline: 0 }}>
                            <Text type="secondary">• {item}</Text>
                          </List.Item>
                        )}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} lg={12}>
                    <Card title={c.posBoundariesTitle} style={{ borderRadius: 16, height: "100%" }}>
                      <List
                        size="small"
                        dataSource={c.posBoundaries}
                        renderItem={(item) => (
                          <List.Item style={{ paddingInline: 0 }}>
                            <Text type="secondary">• {item}</Text>
                          </List.Item>
                        )}
                      />
                    </Card>
                  </Col>
                </Row>

                <Space wrap>
                  <Link href={ROUTES.pos}><Button type="primary">{c.posOpenLabels[0]}</Button></Link>
                  <Link href={ROUTES.posDevices}><Button>{c.posOpenLabels[1]}</Button></Link>
                  <Link href={ROUTES.posReadiness}><Button>{c.posOpenLabels[2]}</Button></Link>
                  <Link href={ROUTES.loyalty}><Button>{c.posOpenLabels[3]}</Button></Link>
                  <Link href={ROUTES.commission}><Button>{c.posOpenLabels[4]}</Button></Link>
                </Space>
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
                          <Tag
                            color="blue"
                            icon={MENU_META[index].icon}
                            style={{ whiteSpace: "normal", height: "auto", lineHeight: 1.4, display: "inline-flex", alignItems: "flex-start" }}
                          >
                            <span style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{item.title}</span>
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
                            <Button style={{ whiteSpace: "normal", height: "auto", textAlign: "left" }}>
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
                closable
                style={{ marginTop: 16, borderRadius: 14 }}
                message={c.menuGroupingAlertMessage}
                description={c.menuGroupingAlertDesc}
              />
            </Section>

            <Section
              id="sidebarMap"
              title={c.sidebarMapTitle}
              subtitle={c.sidebarMapSubtitle}
            >
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                {c.sidebarMapGroups.map((group) => (
                  <Card key={group.title} style={{ borderRadius: 16 }}>
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <Title level={4} style={{ margin: 0 }}>
                        {group.title}
                      </Title>
                      <List
                        size="small"
                        dataSource={group.items}
                        renderItem={(item) => (
                          <List.Item style={{ paddingInline: 0 }}>
                            <Space direction="vertical" size={4} style={{ width: "100%" }}>
                              <Link href={item.href}>
                                <Button type="link" style={{ paddingInline: 0, whiteSpace: "normal", height: "auto", textAlign: "left" }}>
                                  {item.label}
                                </Button>
                              </Link>
                              <Text type="secondary">{item.note}</Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    </Space>
                  </Card>
                ))}
              </Space>
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
              id="limits"
              title={c.limitsTitle}
              subtitle={c.limitsSubtitle}
            >
              <Row gutter={[14, 14]}>
                {c.limitsGroups.map((group) => (
                  <Col xs={24} lg={12} key={group.title}>
                    <Card title={group.title} style={{ borderRadius: 16, height: "100%" }}>
                      <List
                        size="small"
                        dataSource={group.items}
                        renderItem={(item) => (
                          <List.Item style={{ paddingInline: 0 }}>
                            <Text type="secondary">• {item}</Text>
                          </List.Item>
                        )}
                      />
                    </Card>
                  </Col>
                ))}
              </Row>
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
                closable
                style={{ marginTop: 12, borderRadius: 14 }}
                message={c.linksAlertMessage}
                description={c.linksAlertDesc}
              />
            </Section>
        </div>

        <div className={styles.side}>
          <div className={styles.toc}>
            <Card title={c.sidebarTocTitle} style={{ borderRadius: 18 }}>
              <div className={styles.tocScroll}>
                <Anchor affix={false} items={anchorItems} />
              </div>
            </Card>
          </div>

          <div className={styles.rail}>
            <Card title={c.sidebarShortcutsTitle} style={{ borderRadius: 18 }}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                {c.sidebarShortcuts.map((shortcut) => (
                  <Link href={shortcut.href} key={shortcut.href}>
                    <Button block icon={shortcut.icon}>
                      {shortcut.label}
                    </Button>
                  </Link>
                ))}
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
        </div>
      </div>

      <div className={styles.footNote}>
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
      </div>
    </div>
  );
}
