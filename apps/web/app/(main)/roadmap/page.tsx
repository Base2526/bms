"use client";

import React, { useMemo } from "react";
import { Badge, Card, Col, Divider, Progress, Row, Space, Tag, Timeline, Typography } from "antd";
import type { TimelineProps } from "antd";
import {
  AlertOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  MobileOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ShareAltOutlined,
  ShopOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";

const { Title, Text, Paragraph } = Typography;

type Status = "done" | "in_progress" | "planned";
type CapabilityStatus = "available" | "limited";

type CapabilityGroup = {
  id: string;
  title: string;
  status: CapabilityStatus;
  features: string[];
};

type MarketPackage = {
  id: string;
  title: string;
  summary: string;
  bullets: string[];
  tag?: string;
};

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
    availableNow: string;
    availableNowNote: string;
    available: string;
    limited: string;
    intelligenceLayers: string;
    layers: Array<{ color: string; text: string }>;
    packages: string;
    packagesNote: string;
    packageIncludes: string;
    roadmap: string;
    status: string;
    goals: string;
    deliverables: string;
  };
  capabilities: CapabilityGroup[];
  packages: MarketPackage[];
  items: Array<Omit<RoadmapItem, "icon">>;
};

const ROADMAP_CONTENT: { en: RoadmapPageContent; th: RoadmapPageContent } = {
  en: {
    labels: {
      pageTitle: "BMS Product Roadmap",
      subtitle:
        "A delivery roadmap connecting POS, online commerce, inventory, and CRM into a digital business advisor that tells each store what to do next.",
      done: "Done",
      inProgress: "In progress",
      planned: "Planned",
      progressLabel: "Q1-Q4 estimated progress",
      keyObjectives: "Product principles",
      objectives: [
        "Data -> Insight -> Recommended action -> Verified business outcome",
        "Prioritize the few actions that protect cash, stock, customers, and margin",
        "Explain every recommendation with evidence, expected impact, and confidence",
        "Keep sensitive actions human-confirmed and measure whether each action worked",
      ],
      notes: "Delivery model",
      recommendTag: "Important",
      notesText:
        "Q1-Q4 are delivery phases rather than fixed calendar promises. Each phase builds on existing BMS services and must produce measurable actions before the next intelligence layer is added.",
      tip1:
        "Start with deterministic rules and verified data; add model-generated explanations only after the recommendation can be reproduced.",
      tip2:
        "Measure action acceptance, completion, and business impact so recommendations improve instead of becoming another alert feed.",
      availableNow: "Available in BMS today",
      availableNowNote:
        "These capabilities are already built. Items marked limited have a feature flag, beta integration, hardware dependency, or production verification still outstanding.",
      available: "Available",
      limited: "Limited / verification pending",
      intelligenceLayers: "Core intelligence layers",
      layers: [
        { color: "red", text: "Today's Action Center" },
        { color: "orange", text: "Smart reorder and stock-out risk" },
        { color: "gold", text: "Slow-moving, dead-stock, and expiry actions" },
        { color: "cyan", text: "At-risk customer and comeback actions" },
        { color: "blue", text: "RFM and next-best-offer" },
        { color: "green", text: "Profit and margin diagnosis" },
        { color: "geekblue", text: "Basket and cross-sell opportunities" },
        { color: "magenta", text: "Promotion, pricing, and scenario simulation" },
      ],
      packages: "Go-to-market packaging",
      packagesNote:
        "Sell the roadmap as outcome-based phases. Phase 1 bundles Q1 and Q2 into one clear promise: know what to do today and buy the right stock with confidence.",
      packageIncludes: "Includes",
      roadmap: "Delivery roadmap (Q1-Q4)",
      status: "Status",
      goals: "Goals",
      deliverables: "Definition of done",
    },
    capabilities: [
      {
        id: "channels-ai",
        title: "Omnichannel inbox and AI",
        status: "available",
        features: [
          "LINE, Facebook, Instagram, TikTok, and Web inbound channels with a unified inbox",
          "Customer 360, identities across channels, assignments, notes, tags, attachments, and search",
          "Customer AI workflow and staff assistant using permission-aware approved tools",
          "Work assistant on every back-office page: how-to guidance for every menu, what the system supports, and live data or actions your permissions already allow",
          "Answers are grounded in a verified bilingual capability and guide catalog, so the assistant states what is implemented rather than guessing; the register gets the same guidance offline",
          "AI quality review, usage/cost accounting, provider health, channel health, and failure alerts",
        ],
      },
      {
        id: "commerce-crm",
        title: "Commerce, CRM, and repeat sales",
        status: "available",
        features: [
          "Products, variants, categories, brands, galleries, and CSV/XLSX bulk import",
          "CRM merge, orders, staff reorder, coupons, and consent-based restock notifications",
          "Signed customer checkout, payment workflow, and advisory AI slip verification",
          "Shipping records, packing, labels, tracking events, follow-up automation, membership, and loyalty",
        ],
      },
      {
        id: "inventory-purchase",
        title: "Inventory and purchasing",
        status: "available",
        features: [
          "Current, reserved, and available stock with an append-only movement history",
          "Supplier purchase orders and retry-safe receiving at admin and POS surfaces",
          "Two-step branch transfers and snapshot-difference stock counts",
          "Locations, FEFO lots, product packs, barcode scanning, and serial-number controls",
        ],
      },
      {
        id: "pos-tax",
        title: "POS and Thai tax",
        status: "available",
        features: [
          "Counter sales, returns, refunds, voids, parked bills, discounts, and split payments",
          "Cashier PIN permissions, shifts, drawer movements, and X/Z reports",
          "Member lookup, loyalty, PO receiving, barcode scanning, product packs, FEFO lots, and serial controls",
          "VAT invoices, credit notes, cash rounding, whole-bill serial checks, and idempotent settlement",
        ],
      },
      {
        id: "reports-automation",
        title: "Reports and automation",
        status: "available",
        features: [
          "Sales, inventory, customer, and profit-estimate dashboards",
          "Generated XLSX, CSV, and PDF reports plus an AI report generator",
          "Email, Slack, and LINE sales-digest workflow and a heuristic follow-up queue",
          "Heuristic demand forecast, stock-out prediction, and purchase-order suggestions",
        ],
      },
      {
        id: "platform-control",
        title: "SaaS administration and control",
        status: "available",
        features: [
          "Self-serve signup, shop archetypes, sample data, plans, and tenant isolation",
          "Staff management, RBAC, RLS, audit log, revision history, and tenant drill-down",
          "User language/theme profiles, support tickets, and platform administration",
          "Operations schedule, job-run history, system health, and daily AI log triage",
        ],
      },
      {
        id: "limited",
        title: "Built foundation with external verification pending",
        status: "limited",
        features: [
          "Shopee/Lazada inbound webhooks are beta; real Open Platform signature verification is pending",
          "Flash/Kerry booking, tracking, and label safety layer is built; live merchant adapters are pending",
          "Pharmacy intake and e-Tax submission queue are flag-gated; licensed/provider verification is required",
          "ESC/POS WebUSB printing needs real hardware testing; on the public live dashboard only the live-stream viewer, conversion, and comment tiles are still sample numbers",
          "Advanced POS features including blind close, price tiers, blind returns, commission, promotions, bundles, store credit, and deposits passed development verification but await production migrations",
        ],
      },
    ],
    packages: [
      {
        id: "phase1",
        title: "Phase 1 - Daily Action + Inventory Cashflow",
        summary: "Know what to do today and buy the right stock with confidence.",
        tag: "Primary sales package",
        bullets: [
          "Bundle Q1 Today's Action Center with Q2 Inventory Intelligence as the first commercial package",
          "Lead with owner-facing daily priorities, then prove ROI through stock-out reduction and trapped-cash release",
          "Best fit for new deals, pilots, and first expansion inside existing shops",
        ],
      },
      {
        id: "phase2",
        title: "Phase 2 - Customer Retention Engine",
        summary: "Bring valuable customers back with targeted next-best actions.",
        bullets: [
          "Use Q3 once customer identity coverage and purchase history are reliable enough",
          "Position as growth on top of a stable operations and inventory base",
        ],
      },
      {
        id: "phase3",
        title: "Phase 3 - Profit Diagnosis and Growth Simulation",
        summary: "Explain margin shifts and test pricing or promotion decisions before committing.",
        bullets: [
          "Use Q4 as the premium owner/manager intelligence layer",
          "Sell after the business trusts daily actions, stock recommendations, and retention workflows",
        ],
      },
    ],
    items: [
      {
        id: "q1",
        quarter: "Q1 - First release",
        title: "Today's Action Center",
        status: "done",
        tags: ["killer-feature", "phase-1", "action-center", "measurement"],
        goals: [
          "Give the owner one prioritized list of what the store should do today",
          "Turn existing alerts and operational signals into traceable, measurable actions",
        ],
        deliverables: [
          "Unified action feed for POS exceptions, stock, margin, retention, sales opportunity, and operational risk",
          "Priority, evidence, expected impact, confidence, owner, due date, and deep link on every action",
          "Action lifecycle: new, accepted, completed, dismissed, and expired, with reason and audit trail",
          "Baseline metrics: acceptance, completion, time-to-action, and measured outcome",
        ],
      },
      {
        id: "q2",
        quarter: "Q2 - Inventory intelligence",
        title: "Buy the right stock and release trapped cash",
        status: "done",
        tags: ["phase-1", "inventory", "cash-flow", "reorder"],
        goals: [
          "Reduce stock-outs without creating excess stock",
          "Identify slow-moving, dead, and expiring inventory early enough to act",
        ],
        deliverables: [
          "Stock-out date, reorder quantity, safety stock, lead-time, and demand-trend recommendations using POS and online sales",
          "Slow-moving and dead-stock classification with markdown, bundle, transfer, or discontinue actions",
          "Expiry-aware actions using FEFO lots where lot data is available",
          "Lost-sales and restock-demand feedback loop to improve purchase suggestions",
        ],
      },
      {
        id: "q3",
        quarter: "Q3 - Customer retention",
        title: "Bring valuable customers back",
        status: "done",
        tags: ["crm", "rfm", "retention"],
        goals: [
          "Detect customers whose buying rhythm has changed before they are lost",
          "Give staff a specific next-best action instead of a generic customer list",
        ],
        deliverables: [
          "RFM segments, customer value, expected return window, and at-risk scoring across identified POS and online purchases",
          "Comeback queue with recommended channel, message, offer, and reason",
          "Next-best-product suggestions based on verified purchase history and basket patterns",
          "Campaign holdout and conversion tracking to measure incremental retention impact",
        ],
      },
      {
        id: "q4",
        quarter: "Q4 - Profit and growth",
        title: "Diagnose profit and simulate growth decisions",
        status: "planned",
        tags: ["profit", "growth", "simulation"],
        goals: [
          "Explain why sales or profit changed and which controllable factor matters most",
          "Help owners test pricing and promotion decisions before committing",
        ],
        deliverables: [
          "Revenue and margin variance diagnosis by product, category, branch, sales channel, and time window",
          "Frequently-bought-together, cross-sell, and missed-opportunity insights",
          "Promotion ROI and contribution-margin measurement",
          "Human-confirmed price recommendations and what-if scenarios with assumptions shown",
        ],
      },
      {
        id: "q5",
        quarter: "Q5 - POS mobile",
        title: "POS mobile app (iOS/Android)",
        status: "planned",
        tags: ["pos", "mobile", "cashier"],
        goals: [
          "Give cashiers a lightweight mobile POS that reuses the existing device-token + PIN authenticated REST API, with no new backend auth scheme",
          "Extend counter hardware support (barcode scanning, receipt printing, cash drawer) to phones and tablets without duplicating pricing, tax, or inventory logic",
        ],
        deliverables: [
          "React Native (Expo) app authenticated with the existing POS device-token + cashier PIN model, sharing the same sale/shift/return REST endpoints as the counter register",
          "Camera-based and Bluetooth barcode scanning, ESC/POS receipt printing, and cash-drawer trigger verified against real hardware",
          "Idempotency hardening for every money-moving action (including cash drawer movements) verified before rollout, since mobile networks retry more than counter LAN",
          "Internal distribution (TestFlight / Play internal track) since this is a staff tool, not a public consumer app",
        ],
      },
      {
        id: "q6",
        quarter: "Q6 - Insurance module",
        title: "Insurance sales inbox (new BMS module)",
        status: "planned",
        tags: ["insurance", "inbox", "crm", "new-module"],
        goals: [
          "Add a new BMS module for selling insurance policies, reusing the existing omnichannel inbox, CRM, and AI pipeline instead of building a parallel system",
          "Keep every policy-binding action human-confirmed by a licensed agent, matching BMS's existing sensitive-action guardrails",
        ],
        deliverables: [
          "Policy, premium, payment-schedule, claim, and renewal schema with tenant-scoped RBAC and audit history, following the standard new-module checklist",
          "LINE-first lead capture through the existing omnichannel inbox, with an AI assistant that proposes quotes and answers FAQs but never confirms coverage itself",
          "Cross-channel customer identity matching hardened before go-live, since a wrong merge risks misattributing claims or beneficiaries",
          "Renewal reminders on the existing follow-up automation engine, verified against a real database before it is relied on for premium due dates",
        ],
      },
    ],
  },
  th: {
    labels: {
      pageTitle: "Roadmap การพัฒนาระบบ BMS",
      subtitle:
        "แผนส่งมอบที่เชื่อม POS, Online commerce, Inventory และ CRM ให้เป็น Digital Business Advisor ที่บอกเจ้าของร้านได้ว่าวันนี้ควรทำอะไร",
      done: "เสร็จแล้ว",
      inProgress: "กำลังทำ",
      planned: "วางแผน",
      progressLabel: "ความคืบหน้า Q1-Q4 โดยประมาณ",
      keyObjectives: "หลักการของ Product",
      objectives: [
        "Data -> Insight -> Action ที่แนะนำ -> ผลลัพธ์ธุรกิจที่ตรวจสอบได้",
        "จัดลำดับเฉพาะเรื่องสำคัญที่ช่วยรักษาเงิน สต็อก ลูกค้า และกำไร",
        "ทุกคำแนะนำต้องมีหลักฐาน ผลกระทบที่คาด และระดับความมั่นใจ",
        "Action สำคัญยังต้องให้คนยืนยัน และต้องวัดได้ว่าทำแล้วเกิดผลจริงหรือไม่",
      ],
      notes: "รูปแบบการส่งมอบ",
      recommendTag: "สำคัญ",
      notesText:
        "Q1-Q4 ในหน้านี้คือลำดับการส่งมอบ ไม่ใช่คำสัญญาตามเดือนตายตัว แต่ละช่วงจะต่อยอดจาก service ที่ BMS มีอยู่ และต้องสร้าง Action ที่วัดผลได้ก่อนเพิ่ม intelligence ชั้นถัดไป",
      tip1:
        "เริ่มจากกฎที่ตรวจสอบซ้ำได้และข้อมูลจริงก่อน แล้วค่อยใช้ AI ช่วยอธิบายเมื่อระบบพิสูจน์ที่มาของคำแนะนำได้",
      tip2:
        "วัดการยอมรับ การทำสำเร็จ และผลลัพธ์ของ Action เพื่อให้ระบบเรียนรู้ ไม่กลายเป็นแค่กล่องแจ้งเตือนอีกใบ",
      availableNow: "ความสามารถที่ BMS มีแล้ววันนี้",
      availableNowNote:
        "รายการเหล่านี้สร้างในระบบแล้ว ส่วนรายการที่ระบุว่าจำกัดยังมี Feature flag, การเชื่อมต่อแบบ beta, ข้อจำกัดด้าน Hardware หรือรอการตรวจสอบก่อนใช้งาน Production",
      available: "พร้อมใช้งาน",
      limited: "มีข้อจำกัด / รอตรวจสอบ",
      intelligenceLayers: "ชั้น Intelligence หลัก",
      layers: [
        { color: "red", text: "ศูนย์รวม วันนี้ร้านควรทำอะไร" },
        { color: "orange", text: "Smart reorder และความเสี่ยงของหมด" },
        { color: "gold", text: "Slow-moving, Dead stock และสินค้าใกล้หมดอายุ" },
        { color: "cyan", text: "ลูกค้าเสี่ยงหายและ Action เรียกกลับ" },
        { color: "blue", text: "RFM และ Next-best-offer" },
        { color: "green", text: "วิเคราะห์ต้นเหตุด้านกำไรและ Margin" },
        { color: "geekblue", text: "Basket analysis และโอกาส Cross-sell" },
        { color: "magenta", text: "Promotion, Pricing และ Scenario simulation" },
      ],
      packages: "แพ็กเกจสำหรับการขาย",
      packagesNote:
        "สื่อสาร roadmap เป็น Phase ตามผลลัพธ์ธุรกิจ โดยให้ Phase 1 รวม Q1 และ Q2 เป็นคำสัญญาที่เข้าใจง่าย: รู้ว่าวันนี้ต้องทำอะไร และซื้อของได้แม่นขึ้นอย่างมั่นใจ",
      packageIncludes: "ประกอบด้วย",
      roadmap: "แผนส่งมอบ Q1-Q4",
      status: "สถานะ",
      goals: "เป้าหมาย",
      deliverables: "เกณฑ์ส่งมอบ",
    },
    capabilities: [
      {
        id: "channels-ai",
        title: "Omnichannel Inbox และ AI",
        status: "available",
        features: [
          "รับข้อความจาก LINE, Facebook, Instagram, TikTok และ Web เข้าสู่ Inbox กลาง",
          "Customer 360, ตัวตนข้ามช่องทาง, มอบหมายงาน, Note, Tag, Attachment และ Search",
          "AI workflow ฝั่งลูกค้าและ Staff assistant ผ่าน Approved tools ที่ตรวจสิทธิ์",
          "ผู้ช่วยการทำงานอยู่ทุกหน้าหลังบ้าน: ถามวิธีใช้แต่ละเมนู ระบบทำอะไรได้ และดูข้อมูลจริงหรือสั่งงานได้เท่าที่สิทธิ์ของคุณอนุญาต",
          "คำตอบอ้างอิงคลังความสามารถและคู่มือสองภาษาที่ตรวจสอบแล้ว จึงบอกตามที่ระบบทำได้จริงไม่ใช่เดา และเครื่องขายหน้าร้านใช้คู่มือชุดเดียวกันแบบไม่ต้องต่อ AI",
          "AI quality, Usage/Cost, Provider health, Channel health และ Failure alert",
        ],
      },
      {
        id: "commerce-crm",
        title: "Commerce, CRM และการขายซ้ำ",
        status: "available",
        features: [
          "สินค้า Variant หมวด Brand รูปภาพ และ Bulk import CSV/XLSX",
          "CRM merge, Order, Reorder, Coupon และแจ้งของเข้าเมื่อได้รับ Consent",
          "Signed checkout, Payment workflow และ AI ตรวจสลิปแบบช่วยตัดสินใจ",
          "Shipment, Packing, Label, Tracking event, Follow-up, Membership และ Loyalty",
        ],
      },
      {
        id: "inventory-purchase",
        title: "Inventory และ Purchase",
        status: "available",
        features: [
          "Current, Reserved และ Available stock พร้อมประวัติ Movement แบบ Append-only",
          "Purchase order และการรับสินค้าแบบ Retry-safe ทั้งหน้า Admin และ POS",
          "โอนสินค้าข้ามสาขา 2 ขั้นตอน และ Stock count แบบเทียบ Snapshot",
          "Location, FEFO lot, Product pack, Barcode scan และควบคุม Serial number",
        ],
      },
      {
        id: "pos-tax",
        title: "POS และภาษีไทย",
        status: "available",
        features: [
          "ขาย คืน Refund Void พักบิล ส่วนลด และรับชำระหลายช่องทางในบิลเดียว",
          "Cashier PIN, กะ, เงินเข้าออกลิ้นชัก และรายงาน X/Z",
          "ค้นสมาชิก, Loyalty, รับ PO, Scan barcode, Product pack, FEFO lot และ Serial number",
          "ใบกำกับภาษี VAT, Credit note, Cash rounding และ Settlement แบบ Atomic/Idempotent",
        ],
      },
      {
        id: "reports-automation",
        title: "Reports และ Automation",
        status: "available",
        features: [
          "Dashboard ยอดขาย สต็อก ลูกค้า และประมาณการกำไร",
          "รายงาน XLSX, CSV และ PDF พร้อม AI Report Generator",
          "Sales digest ทาง Email, Slack และ LINE พร้อม Follow-up queue แบบ heuristic",
          "Forecast demand, คาดวันของหมด และแนะนำ Purchase order แบบ heuristic",
        ],
      },
      {
        id: "platform-control",
        title: "SaaS Administration และ Control",
        status: "available",
        features: [
          "Self-serve signup, Shop archetype, Sample data, Plan และ Tenant isolation",
          "Staff management, RBAC, RLS, Audit log, Revision history และ Tenant drill-down",
          "ภาษา/Theme รายบุคคล, Support ticket และ Platform administration",
          "Operations schedule, Job-run history, System health และ Daily AI log triage",
        ],
      },
      {
        id: "limited",
        title: "มีโครงระบบแล้ว แต่ยังรอ External/Production Verification",
        status: "limited",
        features: [
          "Shopee/Lazada inbound เป็น beta และยังรอยืนยัน Signature กับ Open Platform จริง",
          "Safety layer ของ Flash/Kerry booking, tracking และ label พร้อม แต่ยังรอ Live merchant adapter",
          "Pharmacy intake และ e-Tax queue ปิดด้วย Feature flag และยังต้องมีผู้เชี่ยวชาญ/Provider ยืนยัน",
          "ESC/POS WebUSB ยังต้องทดสอบ Hardware จริง ส่วนหน้า Public live dashboard เหลือเฉพาะการ์ดผู้ชม/Conversion/คอมเมนต์ของไลฟ์ที่ยังเป็นตัวอย่าง",
          "Advanced POS ชุด Blind close, Price tier, Blind return, Commission, Promotion, Bundle, Store credit และ Deposit ผ่าน Dev verification แต่ยังรอ Migration Production",
        ],
      },
    ],
    packages: [
      {
        id: "phase1",
        title: "Phase 1 - วันนี้ต้องทำอะไร + ซื้อของแม่นขึ้น",
        summary: "รู้ว่าวันนี้ต้องทำอะไร และซื้อของให้พอดีอย่างมั่นใจ",
        tag: "แพ็กขายหลัก",
        bullets: [
          "รวม Q1 ศูนย์รวม Action รายวัน กับ Q2 Inventory Intelligence เป็นแพ็กเชิงพาณิชย์ชุดแรก",
          "เปิดการขายด้วยรายการที่เจ้าของร้านเห็นแล้วลงมือทำได้ทันที แล้วพิสูจน์ ROI ด้วยการลดของขาดและปลดเงินจมสต็อก",
          "เหมาะที่สุดสำหรับดีลใหม่ การทดลองใช้งาน และการขยายในร้านที่ใช้อยู่แล้ว",
        ],
      },
      {
        id: "phase2",
        title: "Phase 2 - เครื่องยนต์ดึงลูกค้ากลับมา",
        summary: "พาลูกค้าที่มีคุณค่ากลับมาซื้อด้วย next-best action ที่เฉพาะเจาะจง",
        bullets: [
          "ใช้ Q3 เมื่อความครอบคลุมข้อมูลตัวตนลูกค้าและประวัติซื้อมีความน่าเชื่อถือพอ",
          "วางตำแหน่งเป็นชั้นการเติบโตบนฐานงานปฏิบัติการและสต็อกที่นิ่งแล้ว",
        ],
      },
      {
        id: "phase3",
        title: "Phase 3 - วินิจฉัยกำไรและจำลองการเติบโต",
        summary: "อธิบายการเปลี่ยนแปลงของ Margin และลองแผนราคา/โปรโมชั่นก่อนตัดสินใจจริง",
        bullets: [
          "ใช้ Q4 เป็นชั้น intelligence ระดับ owner/manager แบบพรีเมียม",
          "ขายต่อเมื่อธุรกิจเชื่อใจ action รายวัน คำแนะนำสต็อก และ workflow retention แล้ว",
        ],
      },
    ],
    items: [
      {
        id: "q1",
        quarter: "Q1 - รุ่นแรก",
        title: "ศูนย์รวม วันนี้ร้านควรทำอะไร",
        status: "done",
        tags: ["killer-feature", "phase-1", "action-center", "measurement"],
        goals: [
          "เปิดระบบมาแล้วเห็นรายการสำคัญที่ร้านควรจัดการวันนี้ เรียงตามผลกระทบ",
          "เปลี่ยน Alert และสัญญาณที่ระบบมีอยู่ให้เป็น Action ที่ติดตามและวัดผลได้",
        ],
        deliverables: [
          "Action feed รวมข้อผิดปกติจาก POS, สต็อก, Margin, ลูกค้า, โอกาสขาย และความเสี่ยงงานปฏิบัติการ",
          "ทุก Action มี Priority, หลักฐาน, ผลกระทบ, Confidence, ผู้รับผิดชอบ, กำหนดเวลา และ Deep link",
          "วงจร Action: ใหม่, รับทำ, เสร็จ, ไม่ทำ, หมดอายุ พร้อมเหตุผลและ Audit trail",
          "ตัวชี้วัดเริ่มต้น: Acceptance, Completion, Time-to-action และผลลัพธ์หลังทำ",
        ],
      },
      {
        id: "q2",
        quarter: "Q2 - Inventory Intelligence",
        title: "ซื้อของให้พอดีและปลดเงินที่จมในสต็อก",
        status: "done",
        tags: ["phase-1", "inventory", "cash-flow", "reorder"],
        goals: [
          "ลดโอกาสของหมดโดยไม่ทำให้ร้านแบกสต็อกเกินจำเป็น",
          "พบสินค้าขายช้า ค้างสต็อก และใกล้หมดอายุก่อนที่จะสายเกินแก้",
        ],
        deliverables: [
          "คาดวันของหมด จำนวนสั่งซื้อ Safety stock Lead time และแนวโน้ม Demand จากยอด POS และ Online",
          "แยก Slow-moving/Dead stock พร้อม Action ลดราคา จัดชุด โอนสาขา หรือเลิกขาย",
          "Action ตามวันหมดอายุจาก FEFO lot เมื่อร้านมีข้อมูล lot",
          "นำ Lost sales และ Restock demand กลับมาปรับคำแนะนำการซื้อ",
        ],
      },
      {
        id: "q3",
        quarter: "Q3 - Customer Retention",
        title: "พาลูกค้าที่มีคุณค่ากลับมาซื้อ",
        status: "done",
        tags: ["crm", "rfm", "retention"],
        goals: [
          "ตรวจจับว่าจังหวะการซื้อของลูกค้าเปลี่ยนไปก่อนที่จะเสียลูกค้า",
          "ให้ทีมงานเห็น Next-best-action ที่เฉพาะเจาะจงแทนรายชื่อลูกค้าทั่วไป",
        ],
        deliverables: [
          "RFM Segment, มูลค่าลูกค้า, ช่วงที่คาดว่าจะกลับมา และคะแนนเสี่ยงหายจากรายการซื้อ POS และ Online ที่ระบุตัวลูกค้าได้",
          "Comeback queue พร้อม Channel, ข้อความ, Offer และเหตุผลที่แนะนำ",
          "Next-best-product จากประวัติซื้อจริงและ Basket pattern ที่ตรวจสอบได้",
          "Holdout และ Conversion tracking เพื่อวัดผล Retention ที่เพิ่มขึ้นจริง",
        ],
      },
      {
        id: "q4",
        quarter: "Q4 - Profit & Growth",
        title: "วิเคราะห์ต้นเหตุกำไรและจำลองการเติบโต",
        status: "planned",
        tags: ["profit", "growth", "simulation"],
        goals: [
          "อธิบายว่ายอดขายหรือกำไรเปลี่ยนเพราะอะไร และปัจจัยใดแก้ได้ก่อน",
          "ช่วยเจ้าของร้านทดสอบการตั้งราคาและ Promotion ก่อนตัดสินใจจริง",
        ],
        deliverables: [
          "วิเคราะห์ Revenue และ Margin variance ตามสินค้า หมวด สาขา ช่องทางขาย และช่วงเวลา",
          "Frequently-bought-together, Cross-sell และโอกาสขายที่พลาด",
          "วัด Promotion ROI และ Contribution margin",
          "คำแนะนำราคาแบบให้คนยืนยัน และ What-if scenario ที่แสดงสมมติฐานชัดเจน",
        ],
      },
      {
        id: "q5",
        quarter: "Q5 - POS มือถือ",
        title: "แอป POS บนมือถือ (iOS/Android)",
        status: "planned",
        tags: ["pos", "mobile", "cashier"],
        goals: [
          "ให้พนักงานหน้าร้านมี POS บนมือถือ/แท็บเล็ตที่ใช้ Auth แบบเดิม (Device token + PIN) ผ่าน REST API ที่มีอยู่แล้ว ไม่ต้องสร้าง Auth scheme ใหม่ที่ Backend",
          "ต่อยอด Hardware ที่เคาน์เตอร์ (สแกนบาร์โค้ด พิมพ์ใบเสร็จ เปิดลิ้นชักเงินสด) ให้ใช้งานบนมือถือ/แท็บเล็ตได้ โดยไม่ทำ Logic ราคา ภาษี และสต็อกซ้ำสอง",
        ],
        deliverables: [
          "แอป React Native (Expo) ที่ Auth ด้วย Device token + Cashier PIN เดิม ใช้ Endpoint ขาย/กะ/คืนสินค้าเดียวกับเครื่องเคาน์เตอร์",
          "สแกนบาร์โค้ดด้วยกล้อง/Bluetooth, พิมพ์ใบเสร็จ ESC/POS และเปิดลิ้นชักเงินสด ทดสอบกับ Hardware จริงแล้ว",
          "เสริมความแข็งแรงของ Idempotency ทุก Action ที่เกี่ยวกับเงิน (รวมเงินเข้าออกลิ้นชัก) และ Verify ก่อนปล่อยใช้จริง เพราะเน็ตมือถือ Retry บ่อยกว่าสาย LAN หลังเคาน์เตอร์",
          "กระจายแบบ Internal distribution (TestFlight / Play internal track) เพราะเป็นเครื่องมือพนักงาน ไม่ใช่แอปสาธารณะ",
        ],
      },
      {
        id: "q6",
        quarter: "Q6 - โมดูลประกันภัย",
        title: "Inbox ขายประกันภัย (โมดูลใหม่ใน BMS)",
        status: "planned",
        tags: ["insurance", "inbox", "crm", "new-module"],
        goals: [
          "เพิ่มโมดูลขายประกันภัยใน BMS โดยใช้ Omnichannel Inbox, CRM และ AI pipeline เดิมที่มีอยู่แล้ว ไม่สร้างระบบคู่ขนานแยกต่างหาก",
          "Action ที่ผูกมัดกรมธรรม์ต้องให้ตัวแทนที่มีใบอนุญาตยืนยันเสมอ ตาม Guardrail เดิมของ BMS สำหรับ Action ที่อ่อนไหว",
        ],
        deliverables: [
          "Schema กรมธรรม์ เบี้ยประกัน งวดชำระ การเคลม และวันต่ออายุ พร้อม RBAC ต่อ Tenant และ Audit history ตาม Checklist มาตรฐานของการเพิ่มโมดูลใหม่",
          "รับ Lead ผ่าน LINE เป็นช่องทางหลักบน Inbox เดิม พร้อม AI ที่เสนอราคาและตอบคำถามได้ แต่ไม่ยืนยันความคุ้มครองเอง",
          "ปิดช่องโหว่การ Dedup ลูกค้าข้ามช่องทางให้แข็งแรงก่อน Go-live เพราะ Merge ผิดคนหมายถึงข้อมูลเคลม/ผู้รับผลประโยชน์สลับกัน",
          "ใช้ Follow-up Automation เดิมแจ้งเตือนต่ออายุกรมธรรม์ โดยต้อง Verify กับ Database จริงก่อนนำไปใช้กับกำหนดชำระเบี้ยประกัน",
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

export default function RoadmapPage() {
  const { lang } = useI18n();
  const content = resolveBilingual(ROADMAP_CONTENT, lang);

  const iconsById: Record<string, React.ReactNode> = {
    q1: <SafetyCertificateOutlined />,
    q2: <TeamOutlined />,
    q3: <ShareAltOutlined />,
    q4: <BarChartOutlined />,
    q5: <MobileOutlined />,
    q6: <FileProtectOutlined />,
  };
  const capabilityIconsById: Record<string, React.ReactNode> = {
    "channels-ai": <ShareAltOutlined />,
    "commerce-crm": <TeamOutlined />,
    "inventory-purchase": <SearchOutlined />,
    "pos-tax": <ShopOutlined />,
    "reports-automation": <BarChartOutlined />,
    "platform-control": <SafetyCertificateOutlined />,
    limited: <AlertOutlined />,
  };

  const items: RoadmapItem[] = useMemo(
    () =>
      content.items.map((item) => ({
        ...item,
        icon: iconsById[item.id],
      })),
    [content]
  );

  const doneCount = items.filter((item) => item.status === "done").length;
  const inProgressCount = items.filter((item) => item.status === "in_progress").length;
  const plannedCount = items.filter((item) => item.status === "planned").length;
  const progress = Math.round(
    items.reduce(
      (sum, item) => sum + (item.status === "done" ? 100 : item.status === "in_progress" ? 50 : 0),
      0
    ) / items.length
  );

  const timelineItems: TimelineProps["items"] = items.map((item) => ({
    dot: item.icon ?? statusIcon(item.status),
    color: statusColor(item.status),
    children: (
      <div style={{ paddingBottom: 6 }}>
        <Row gutter={[12, 6]} align="middle" justify="space-between">
          <Col>
            <Space direction="vertical" size={0}>
              <Text type="secondary">{item.quarter}</Text>
              <Text strong style={{ fontSize: 15 }}>
                {item.title}
              </Text>
            </Space>
          </Col>
          <Col>
            <Tag color={statusColor(item.status)} icon={statusIcon(item.status)}>
              {content.labels.status}:{" "}
              {item.status === "done"
                ? content.labels.done
                : item.status === "in_progress"
                  ? content.labels.inProgress
                  : content.labels.planned}
            </Tag>
          </Col>
        </Row>

        <Row gutter={[12, 12]} style={{ marginTop: 10 }}>
          <Col xs={24} md={12}>
            <Text strong>{content.labels.goals}</Text>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {item.goals.map((goal) => (
                <li key={goal}>
                  <Text>{goal}</Text>
                </li>
              ))}
            </ul>
          </Col>
          <Col xs={24} md={12}>
            <Text strong>{content.labels.deliverables}</Text>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {item.deliverables.map((deliverable) => (
                <li key={deliverable}>
                  <Text>{deliverable}</Text>
                </li>
              ))}
            </ul>
          </Col>
        </Row>

        {item.tags?.length ? (
          <Space wrap style={{ marginTop: 6 }}>
            {item.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        ) : null}

        <Divider style={{ margin: "12px 0 0" }} />
      </div>
    ),
  }));

  return (
    <div style={{ width: "100%", minHeight: 520, padding: 16 }}>
      <Card
        variant="borderless"
        style={{
          borderRadius: 14,
          boxShadow: "0 1px 10px rgba(var(--app-shadow-rgb),0.12)",
          overflow: "hidden",
          height: "100%",
        }}
        styles={{ body: { padding: 16 } }}
      >
        <Row align="middle" justify="space-between" gutter={[12, 8]} style={{ marginBottom: 8 }}>
          <Col flex="auto">
            <Space direction="vertical" size={0}>
              <Title level={4} style={{ margin: 0 }}>
                {content.labels.pageTitle}
              </Title>
              <Text type="secondary">{content.labels.subtitle}</Text>
            </Space>
          </Col>
          <Col>
            <Space wrap>
              {doneCount > 0 ? (
                <Tag color="green">
                  {content.labels.done}: {doneCount}
                </Tag>
              ) : null}
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
            <Card size="small" title={content.labels.progressLabel} variant="outlined">
              <Progress percent={progress} />
            </Card>
            <Card size="small" title={content.labels.keyObjectives} variant="outlined" style={{ marginTop: 12 }}>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {content.labels.objectives.map((objective) => (
                  <li key={objective}>
                    <Text>{objective}</Text>
                  </li>
                ))}
              </ul>
            </Card>
          </Col>

          <Col xs={24} md={12}>
            <Card
              size="small"
              title={content.labels.notes}
              variant="outlined"
              extra={<Tag icon={<AlertOutlined />}>{content.labels.recommendTag}</Tag>}
            >
              <Paragraph style={{ marginBottom: 0 }}>{content.labels.notesText}</Paragraph>
              <Divider style={{ margin: "12px 0" }} />
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Space align="start">
                  <FileTextOutlined />
                  <Text>{content.labels.tip1}</Text>
                </Space>
                <Space align="start">
                  <SearchOutlined />
                  <Text>{content.labels.tip2}</Text>
                </Space>
              </Space>
            </Card>
          </Col>
        </Row>

        <Divider style={{ margin: "12px 0" }} />

        <Card
          size="small"
          title={content.labels.availableNow}
          variant="outlined"
          style={{ marginBottom: 12 }}
          extra={
            <Space wrap>
              <Tag color="green" icon={<CheckCircleOutlined />}>
                {content.labels.available}
              </Tag>
              <Tag color="gold" icon={<AlertOutlined />}>
                {content.labels.limited}
              </Tag>
            </Space>
          }
        >
          <Paragraph type="secondary" style={{ marginBottom: 12 }}>
            {content.labels.availableNowNote}
          </Paragraph>
          <Row gutter={[12, 12]}>
            {content.capabilities.map((capability) => (
              <Col key={capability.id} xs={24} md={12} xl={8}>
                <Card
                  size="small"
                  variant="outlined"
                  style={{ height: "100%" }}
                  title={
                    <Space>
                      {capabilityIconsById[capability.id]}
                      <Text strong>{capability.title}</Text>
                    </Space>
                  }
                  extra={
                    <Tag
                      color={capability.status === "available" ? "green" : "gold"}
                      icon={capability.status === "available" ? <CheckCircleOutlined /> : <AlertOutlined />}
                    >
                      {capability.status === "available" ? content.labels.available : content.labels.limited}
                    </Tag>
                  }
                >
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {capability.features.map((feature) => (
                      <li key={feature}>
                        <Text>{feature}</Text>
                      </li>
                    ))}
                  </ul>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>

        <Card size="small" title={content.labels.intelligenceLayers} variant="outlined" style={{ marginBottom: 12 }}>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={12}>
              <Space direction="vertical" size={6}>
                {content.labels.layers.slice(0, 4).map((layer) => (
                  <Badge key={layer.text} color={layer.color} text={layer.text} />
                ))}
              </Space>
            </Col>
            <Col xs={24} md={12}>
              <Space direction="vertical" size={6}>
                {content.labels.layers.slice(4).map((layer) => (
                  <Badge key={layer.text} color={layer.color} text={layer.text} />
                ))}
              </Space>
            </Col>
          </Row>
        </Card>

        <Card size="small" title={content.labels.packages} variant="outlined" style={{ marginBottom: 12 }}>
          <Paragraph type="secondary" style={{ marginBottom: 12 }}>
            {content.labels.packagesNote}
          </Paragraph>
          <Row gutter={[12, 12]}>
            {content.packages.map((pkg) => (
              <Col key={pkg.id} xs={24} md={8}>
                <Card
                  size="small"
                  variant="outlined"
                  style={{ height: "100%" }}
                  extra={pkg.tag ? <Tag color={pkg.id === "phase1" ? "blue" : "default"}>{pkg.tag}</Tag> : null}
                >
                  <Space direction="vertical" size={6} style={{ width: "100%" }}>
                    <Text strong>{pkg.title}</Text>
                    <Text type="secondary">{pkg.summary}</Text>
                    <Text strong>{content.labels.packageIncludes}</Text>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {pkg.bullets.map((bullet) => (
                        <li key={bullet}>
                          <Text>{bullet}</Text>
                        </li>
                      ))}
                    </ul>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>

        <Card size="small" title={content.labels.roadmap} variant="outlined">
          <Timeline items={timelineItems} />
        </Card>
      </Card>
    </div>
  );
}
