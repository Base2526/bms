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

const { Title, Paragraph, Text } = Typography;

type PersonaKey = "owner" | "staff" | "ops";
type FlowKey = "products" | "orders" | "payment" | "shipping";

const personaCards: Record<
  PersonaKey,
  {
    title: string;
    subtitle: string;
    items: string[];
    ctaLabel: string;
    ctaHref: string;
  }
> = {
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
    ctaHref: "/admin/products",
  },
  staff: {
    title: "พนักงานหน้าร้านใช้อะไรบ่อยสุด",
    subtitle: "เหมาะกับคนตอบแชท รับออเดอร์ และตามงานประจำวัน",
    items: [
      "เปิด Inbox ดูแชทใหม่และลูกค้าที่ต้องตอบก่อน",
      "ใช้ Customer 360 เพื่อดูประวัติลูกค้าแบบไม่สลับหน้า",
      "เปิดออเดอร์ล่าสุดแบบ preview ในหน้า Inbox ก่อนได้ และถ้าต้องทำงานลึกค่อยเปิดหน้า Orders เต็มจอเป็นแท็บใหม่",
      "แชร์สินค้าและคูปองจาก composer โดยตรวจข้อความร่างก่อนกดส่ง",
      "สร้างออเดอร์และออกใบแจ้งหนี้จาก Quick Actions ตามสิทธิ์ของบัญชี",
      "เช็ก Orders / Payment / Shipping ต่อเนื่องเป็นชุดเดียว",
      "ใช้ช่องค้นหาบนแต่ละหน้าเพื่อหา order / payment / tracking เร็วขึ้น",
    ],
    ctaLabel: "ไปที่ Inbox",
    ctaHref: "/admin/inbox",
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
    ctaHref: "/admin/settings",
  },
};

const flowCards: Record<
  FlowKey,
  {
    title: string;
    path: string;
    summary: string;
    checks: string[];
    tags: string[];
  }
> = {
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
      "ตรวจสลิปด้วย AI เป็นคำแนะนำเท่านั้น; ถ้า OCR ตัวหลักล้ม ระบบอาจลองตัวสำรองก่อนส่งให้คนตรวจ",
      "Confirm แล้วออเดอร์จะเป็น PAID",
      "Refund ใช้เมื่อรายการอยู่ในสถานะที่คืนเงินได้เท่านั้น",
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
      "ค้นหา shipment / order / tracking ได้จากช่องค้นหา",
      "DELIVERED จะช่วยปิด flow งานให้ครบ",
    ],
    tags: ["Shipping", "Tracking", "Carrier", "Dashboard"],
  },
};

const couponConditions = [
  { code: "SAVE10", condition: "ลด 10%, active, ยังไม่หมดอายุ, quota เหลือ, ลูกค้ายังไม่เกิน per-customer limit, ยอดถึงขั้นต่ำ", result: "ผ่าน: ระบบเพิ่มเข้ากระเป๋าคูปองและแนบลิงก์ให้ลูกค้าเปิดดูได้ ตอนสร้างออเดอร์ backend จะลดราคาจริงใน transaction เดียวกับการจองสต็อก" },
  { code: "WELCOME50", condition: "ลด 50 บาท, ไม่มีขั้นต่ำ, แจกเข้ากระเป๋าลูกค้าแล้ว", result: "ผ่าน: ลูกค้าถามว่ามีคูปองอะไร ระบบดึงจาก wallet แล้วตอบโค้ดนี้ก่อนคูปองทั่วไป" },
  { code: "FLASH100", condition: "ลด 100 บาท, ตั้งวันเริ่มใช้เป็นพรุ่งนี้", result: "ไม่ผ่านก่อนเวลาเริ่ม: AI/ฟอร์มสร้างออเดอร์ต้องบอกว่าโค้ดยังไม่เริ่มใช้ได้ และไม่สร้างออเดอร์ครึ่ง ๆ กลาง ๆ" },
  { code: "VIP25", condition: "ลด 25%, ขั้นต่ำ 1,000 บาท, ตะกร้าปัจจุบัน 850 บาท", result: "ไม่ผ่าน: ระบบบอกว่ายอดยังไม่ถึงขั้นต่ำ และยังไม่ mark เป็น redeemed" },
  { code: "SAVE10", condition: "per-customer limit = 1 และลูกค้าเคยใช้กับออเดอร์ที่ไม่ถูกยกเลิกแล้ว", result: "ไม่ผ่าน: ระบบบอกว่าใช้ครบจำนวนที่กำหนดแล้ว แม้ quota รวมของร้านยังเหลือ" },
  { code: "LAST1", condition: "max redemptions เต็มแล้ว หรือ remainingRedemptions = 0", result: "ไม่ผ่าน: ระบบตอบว่าโค้ดถูกใช้ครบจำนวนแล้ว และเสนอคูปองอื่นที่ยังใช้ได้ถ้ามี" },
  { code: "SAVE20", condition: "ลูกค้าได้รับคูปองใน wallet แล้วสร้างออเดอร์ แต่ยังไม่จ่ายเงิน", result: "สถานะเป็น RESERVED และผูก order id ไว้: ถ้า order ถูก cancel หรือหมดเวลาจ่าย ระบบคืน quota และย้อนกลับเป็น ASSIGNED" },
  { code: "SAVE20", condition: "ลูกค้าส่งสลิปผิดแล้ว payment ถูก reject แต่ order ยังเปิดอยู่", result: "ยังไม่คืนคูปองทันที: ลูกค้ายังส่งสลิปใหม่ได้ คูปองจะคืนเมื่อ order ถูก cancel หรือ auto-release เท่านั้น" },
  { code: "OLD10", condition: "คูปองหมดอายุหลังแจกเข้ากระเป๋าแล้ว", result: "สถานะเป็น EXPIRED เมื่อระบบอ่าน wallet ครั้งถัดไป: ลูกค้ายังเห็นประวัติได้ แต่ใช้ไม่ได้" },
  { code: "USED10", condition: "คูปองเคยถูกใช้/ผูกกับออเดอร์แล้ว", result: "ลบหรือ rename ไม่ได้: ให้ปิด active แทน เพื่อเก็บประวัติและยอดในออเดอร์เก่าให้ trace ได้" },
];

const couponWhereToSee = [
  "Inbox > Customer 360: ใช้ดูระหว่างคุยกับลูกค้า เห็นคูปองของลูกค้า, ตะกร้าปัจจุบัน, ออเดอร์ล่าสุด, และปุ่มแจกคูปองให้ลูกค้าคนนี้",
  "Customers (CRM): กดขยายแถวลูกค้าเพื่อดู coupon wallet, สถานะ, วันหมดอายุ, เหตุผลที่ใช้ไม่ได้, และ order id ที่เกี่ยวข้อง",
  "Coupons: ใช้จัดการ master coupon และกดจำนวน 'ใช้ไปแล้ว' เพื่อดูว่าโค้ดนี้ถูกใช้กับ order ไหน/ลูกค้าคนไหน",
  "Dashboard: ใช้ดูภาพรวมเดือนนี้ว่าส่วนลดถูกแจกไปเท่าไร ใช้กี่ครั้ง และ top coupon codes คืออะไร",
];

const couponWalletStates = [
  { state: "ASSIGNED", meaning: "ร้านแจกคูปองเข้ากระเป๋าลูกค้าแล้ว ลูกค้าเปิดลิงก์กระเป๋าคูปองเพื่อดูรายละเอียดได้ทันที" },
  { state: "RESERVED", meaning: "คูปองถูกผูกกับออเดอร์ที่สร้างแล้วและยังรอจ่าย/ดำเนินการอยู่" },
  { state: "REDEEMED", meaning: "ออเดอร์เข้าสู่ path ที่จ่ายเงินจริงแล้ว คูปองถือว่าใช้สำเร็จ" },
  { state: "EXPIRED", meaning: "คูปองหมดอายุแล้ว ใช้ไม่ได้ แต่ยังเก็บประวัติใน wallet" },
  { state: "REVOKED", meaning: "ร้านยกเลิกสิทธิ์ของลูกค้าคนนี้โดยเฉพาะ ใช้ไม่ได้ แม้ master coupon ยัง active" },
];

const couponGaps = [
  "ตอนนี้มี lifecycle ต่อคนต่อคูปองแล้ว (assigned / reserved / redeemed / expired / revoked) แต่ยังไม่มีหน้ารวมสำหรับทีมการตลาดที่ดึงกลุ่มลูกค้าตาม state แบบ bulk campaign",
  "ยังไม่มีมุมมอง “คูปองใกล้หมดอายุของลูกค้าคนนี้ทั้งหมด” เป็นหน้าหรือ query แยกสำหรับงาน campaign แม้ AI จะอ่านจาก wallet ได้แล้ว",
  "ยังไม่รองรับ coupon เฉพาะสินค้า, หมวดหมู่, ช่องทาง, หรือ stack หลายใบในออเดอร์เดียว",
  "ถ้าลูกค้ายังไม่มี identity/customer_id ใน CRM ระบบยังเช็กได้แค่ quota รวมและเวลา แต่ยังนับ per-customer history แบบเต็มไม่ได้จนกว่าจะผูกตัวตนลูกค้า",
];

const menuCards = [
  {
    key: "inbox",
    icon: <InboxOutlined />,
    title: "Inbox",
    desc: "รับแชท, ดู Customer 360, assign staff, ตามงานต่อจากแชท",
    bullets: ["เริ่มงานจากแชทใหม่", "Customer 360 สร้างออเดอร์และออกใบแจ้งหนี้ได้ตามสิทธิ์", "ออเดอร์ล่าสุดเปิดดูแบบ preview ใน Inbox ได้ก่อน และมีปุ่มเปิดหน้า Orders เต็มจอเป็นแท็บใหม่", "รูป/ไฟล์จะเข้า draft ก่อนส่งและแนบได้ครั้งละ 1 รายการ", "ข้อความ รูป ไฟล์ สินค้า และคูปองจะแสดงคนละรูปแบบ: bubble ข้อความ, การ์ดรูป, การ์ดไฟล์, การ์ดสินค้า และการ์ดคูปอง", "สินค้าแชร์ public link ให้ลูกค้าดูราคา สต็อก และ gallery ได้; ในแชทแนบเฉพาะรูป cover และกด ดูสินค้า จากการ์ดได้", "คูปองส่งเป็นข้อความ fallback ทุกช่องทางพร้อมลิงก์กระเป๋าคูปอง ระบบเพิ่มสิทธิ์เข้า wallet ตอนส่งจริง ลูกค้าไม่ต้องกดรับ", "AI ตรวจคูปองจาก backend ก่อนตอบลูกค้า ถ้าโค้ดใช้ไม่ได้จะบอกเหตุผลและเสนอคูปองที่ยังใช้ได้แทน แต่จะไม่ใช้คูปองจากข้อความอิสระ", "ลิงก์ Products หลังบ้านเปิดแท็บใหม่สำหรับพนักงานและไม่ถูกส่งให้ลูกค้า", "มือถือใช้ flow รายชื่อ → แชทเต็มจอ พร้อมปุ่มย้อนกลับ", "แชทที่เปิดอยู่จะอ่านและล้าง badge อัตโนมัติเมื่อข้อความเข้า", "อยู่ท้ายแชทจะเลื่อนตามอัตโนมัติ; ถ้าอ่านย้อนหลังให้กดปุ่มข้อความใหม่เพื่อลงด้านล่าง", "ดูข้อมูลลูกค้าไม่ต้องสลับหน้า", "เหมาะกับทีมขาย/แอดมินหน้าร้าน"],
    href: "/admin/inbox",
  },
  {
    key: "products",
    icon: <DatabaseOutlined />,
    title: "Products & Purchase",
    desc: "เพิ่มสินค้า, รูปหลายรูป, stock, reorder point, รับของเข้าคลัง",
    bullets: ["รูปแรกเป็น cover", "รับของผ่าน Purchase", "กรองหมวดหมู่และค้นหา SKU ได้"],
    href: "/admin/products",
  },
  {
    key: "ops",
    icon: <ShoppingCartOutlined />,
    title: "Orders / Payment / Shipping",
    desc: "3 หน้านี้ควรถูกใช้ต่อเนื่องกันเป็น flow เดียว",
    bullets: ["มี search บนทุกหน้า", "ตามสถานะงานได้ชัด", "Orders แสดง subtotal/ส่วนลดคูปอง/ยอดสุทธิ", "เหมาะกับงานปฏิบัติการรายวัน"],
    href: "/admin/orders",
  },
  {
    key: "revisions",
    icon: <HistoryOutlined />,
    title: "Revision History",
    desc: "ดู snapshot ก่อนแก้ไข, เปิด detail, และ compare 2 version สำหรับ records สำคัญ",
    bullets: ["รองรับ Products / Orders / Payment / Shipping", "ค้นหาด้วย SKU, ID, status, reference หรือ tracking", "Editor แสดง user login สำหรับ revision ใหม่หลังระบบส่ง editor context แล้ว"],
    href: "/admin/revisions",
  },
  {
    key: "crm",
    icon: <UserOutlined />,
    title: "Customers / CRM",
    desc: "ดูข้อมูลลูกค้า, ที่อยู่, ประวัติซื้อ, merge และค้นหาชื่อ/เบอร์",
    bullets: ["ที่อยู่หลายรายการ", "ค้นหาเร็วจากชื่อ/เบอร์", "ใช้คู่กับ Customer 360"],
    href: "/admin/customers",
  },
  {
    key: "assistant",
    icon: <RobotOutlined />,
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
    href: "/admin/assistant",
  },
];

const helpRows = [
  {
    title: "AI แนะนำคำตอบลงท้าย “ค่ะ” แต่ฉันเป็นผู้ชาย อยากได้ “ครับ”",
    answer:
      "ไปที่ โปรไฟล์ (/admin/profile) ตั้งช่อง “คำลงท้าย” เป็น ผู้ชาย — ครับ แล้วบันทึก · คำตอบแนะนำในหน้า Inbox (รวมปุ่ม ขอตรวจสอบ/ขอบคุณ) จะเปลี่ยนเป็น ครับ ให้อัตโนมัติ · ถ้าไม่ตั้ง ระบบใช้ ค่ะ เป็นค่าเริ่มต้น",
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
  const [persona, setPersona] = useState<PersonaKey>("owner");
  const [flow, setFlow] = useState<FlowKey>("products");

  const activePersona = personaCards[persona];
  const activeFlow = flowCards[flow];

  const anchorItems = useMemo(
    () => [
      { key: "hero", href: "#hero", title: "เริ่มต้นเร็ว" },
      { key: "quickstart", href: "#quickstart", title: "Quick start ตามบทบาท" },
      { key: "workflow", href: "#workflow", title: "Flow งานทั้งระบบ" },
      { key: "coupons", href: "#coupons", title: "คู่มือคูปอง" },
      { key: "menus", href: "#menus", title: "คู่มือตามเมนู" },
      { key: "faq", href: "#faq", title: "คำถามที่เจอบ่อย" },
      { key: "links", href: "#links", title: "ลิงก์ไปหน้าที่ใช้บ่อย" },
    ],
    []
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
              คู่มือใหม่แบบใช้งานจริง
            </Tag>
            <Title style={{ margin: 0 }}>📘 คู่มือการใช้งาน AI-BMS</Title>
            <Paragraph type="secondary" style={{ margin: 0, fontSize: 18 }}>
              ปรับจากเอกสารยาวแบบเดิม ให้เป็นคู่มือที่เริ่มงานได้เร็ว หาเมนูง่าย และสอนทีมใหม่ได้ง่ายกว่าเดิม
            </Paragraph>

            <Alert
              type="info"
              showIcon
              message="ลูกค้าทัก → Inbox → Orders → Payment → Shipping → Dashboard"
              description="อ่านคู่มือตาม flow งานจริง ไม่ต้องไล่อ่านทุกหัวข้อจากบนลงล่างก่อน"
              style={{ borderRadius: 16 }}
            />

            <Space wrap>
              <Button type="primary" size="large" href="#quickstart">
                เริ่มงานใน 3 นาที
              </Button>
              <Button size="large" href="#workflow">
                ดู flow ทั้งระบบ
              </Button>
              <Button size="large" href="#menus">
                ดูคู่มือตามเมนู
              </Button>
            </Space>

            <Space wrap>
              <Tag>Inbox</Tag>
              <Tag>Products</Tag>
              <Tag>Orders</Tag>
              <Tag>Purchase</Tag>
              <Tag>Payment</Tag>
              <Tag>Shipping</Tag>
              <Tag>Customers</Tag>
              <Tag>Reports</Tag>
              <Tag>ผู้ช่วย AI</Tag>
            </Space>
          </Space>
        </Card>
      </div>

      <Row gutter={[20, 20]} align="top">
        <Col xs={24} lg={17}>
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <Section
              id="quickstart"
              title="⚡ Quick start ตามบทบาท"
              subtitle="เลือกจากสิ่งที่คุณกำลังทำอยู่ เพื่อให้คู่มือพาไปหน้าที่ถูกต้องเร็วที่สุด"
            >
              <Space wrap style={{ marginBottom: 16 }}>
                <Button type={persona === "owner" ? "primary" : "default"} onClick={() => setPersona("owner")}>
                  เจ้าของร้าน
                </Button>
                <Button type={persona === "staff" ? "primary" : "default"} onClick={() => setPersona("staff")}>
                  พนักงานหน้าร้าน
                </Button>
                <Button type={persona === "ops" ? "primary" : "default"} onClick={() => setPersona("ops")}>
                  แอดมินระบบ
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
                    <Link href={activePersona.ctaHref}>
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
              title="🧭 Flow งานทั้งระบบ"
              subtitle="ถ้าคุณยังไม่แน่ใจว่าควรทำอะไรก่อน-หลัง ให้กดดูทีละ step จาก flow นี้"
            >
              <Row gutter={[14, 14]}>
                <Col xs={24}>
                  <Space wrap>
                    <Button
                      type={flow === "products" ? "primary" : "default"}
                      icon={<DatabaseOutlined />}
                      onClick={() => setFlow("products")}
                    >
                      เพิ่มสินค้า
                    </Button>
                    <Button
                      type={flow === "orders" ? "primary" : "default"}
                      icon={<ShoppingCartOutlined />}
                      onClick={() => setFlow("orders")}
                    >
                      รับออเดอร์
                    </Button>
                    <Button
                      type={flow === "payment" ? "primary" : "default"}
                      icon={<CreditCardOutlined />}
                      onClick={() => setFlow("payment")}
                    >
                      ยืนยันเงิน
                    </Button>
                    <Button
                      type={flow === "shipping" ? "primary" : "default"}
                      icon={<TruckOutlined />}
                      onClick={() => setFlow("shipping")}
                    >
                      จัดส่งและปิดงาน
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
              id="coupons"
              title="🎟 คู่มือคูปองแบบละเอียด"
              subtitle="อธิบายว่าระบบรู้อะไรเกี่ยวกับคูปองของลูกค้า, ใช้อย่างไร, และเงื่อนไขไหนผ่านหรือไม่ผ่าน"
            >
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Alert
                  type="info"
                  showIcon
                  style={{ borderRadius: 14 }}
                  message="สิ่งที่ระบบเก็บอยู่ตอนนี้"
                  description="ระบบเก็บ master ของคูปองไว้ที่ bms_coupons, เก็บว่าลูกค้าคนนี้เคยได้รับคูปองอะไรไว้ที่ bms_customer_coupon_wallet, และเก็บการใช้งานจริงไว้ที่ออเดอร์ (bms_orders.coupon_id / coupon_code / discount_amount) จากนั้นคำนวณสดว่าลูกค้าคนนี้ยังใช้โค้ดใดได้บ้างจากเวลา, quota รวม, per-customer limit, ยอดขั้นต่ำ, และประวัติออเดอร์ที่ไม่ถูกยกเลิก"
                />

                <Card style={{ borderRadius: 16, background: "#fafcff" }}>
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Title level={4} style={{ margin: 0 }}>ขั้นตอนใช้งานจริง</Title>
                    <Steps
                      direction="vertical"
                      current={-1}
                      items={[
                        {
                          title: "1. สร้างคูปองที่หน้า Coupons",
                          description: "กำหนด code, ประเภทส่วนลด (เปอร์เซ็นต์/บาท), ยอดขั้นต่ำ, จำนวนครั้งรวม, จำนวนครั้งต่อลูกค้า, วันเริ่ม, วันหมดอายุ, และสถานะเปิดใช้งาน",
                        },
                        {
                          title: "2. ส่งคูปองให้ลูกค้าจาก Inbox",
                          description: "กดปุ่ม คูปอง ที่ composer แล้วเลือกโค้ด ระบบจะแทรกข้อความ fallback ให้ เช่น โค้ด, ส่วนลด, ขั้นต่ำ, วันหมดอายุ, สิทธิ์ที่เหลือ เมื่อกดส่งจริง ระบบจะบันทึกสิทธิ์นี้ไว้ใน customer coupon wallet และแนบลิงก์กระเป๋าคูปองให้ลูกค้าเปิดดูทั้งหมด",
                        },
                        {
                          title: "3. ลูกค้าถามว่ามีคูปองอะไร หรือพิมพ์โค้ดมา",
                          description: "AI เรียก list_customer_coupons ก่อนถ้าลูกค้าถามคูปองของตัวเองหรือถามว่าอะไรใกล้หมดอายุ และตอบสรุปสั้นพร้อมลิงก์กระเป๋าคูปอง ห้ามเดาเองว่าคูปองใช้ได้ ถ้าลูกค้าพิมพ์โค้ด ระบบจะตอบสถานะ/เงื่อนไขเท่านั้น ไม่ใช้คูปองจากข้อความอิสระ",
                        },
                        {
                          title: "3.5 ทีมงานเปิดดูคูปองของลูกค้าได้ทันที",
                          description: "ใน Inbox > Customer 360 และหน้า Customers (CRM) ตอนกางแถวลูกค้า จะมี section 'คูปองของลูกค้า' แสดง code, สถานะ (ASSIGNED / RESERVED / REDEEMED / EXPIRED / REVOKED), วันหมดอายุ, เหตุผลที่ยังใช้ไม่ได้, และถ้าผูกกับออเดอร์อยู่จะเห็น order id นั้นได้เลย",
                        },
                        {
                          title: "4. ตอนสร้างออเดอร์ ระบบค่อยใช้คูปองจริง",
                          description: "create_order จะส่ง couponCode เข้า createOrder() และ backend ตรวจอีกครั้งใน transaction เดียวกับการจอง stock ถ้าไม่ผ่านจะคืนผล COUPON_INVALID และไม่สร้างออเดอร์ครึ่ง ๆ กลาง ๆ ถ้าผ่าน wallet จะขยับเป็น RESERVED พร้อมผูก order ไว้",
                        },
                        {
                          title: "5. ถ้าออเดอร์ไม่จบการขาย ระบบคืน quota เฉพาะบางกรณี",
                          description: "confirm payment หรือ pay order จะขยับ wallet เป็น REDEEMED; แต่ถ้า cancel order หรือ auto-release unpaid order ระบบจะคืน quota และย้อน wallet จาก RESERVED/REDEEMED (ของออเดอร์นั้น) กลับไปเป็น ASSIGNED ส่วน reject สลิปอย่างเดียวจะยังไม่คืน เพราะ order ยังเปิดให้ลูกค้าส่งสลิปใหม่ได้",
                        },
                      ]}
                    />
                  </Space>
                </Card>

                <Row gutter={[14, 14]}>
                  <Col xs={24} lg={12}>
                    <Card style={{ borderRadius: 16, height: "100%" }}>
                      <Space direction="vertical" size={10} style={{ width: "100%" }}>
                        <Title level={4} style={{ margin: 0 }}>ดูคูปองของลูกค้าได้จากที่ไหน</Title>
                        <List
                          size="small"
                          dataSource={couponWhereToSee}
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
                        <Title level={4} style={{ margin: 0 }}>ความหมายสถานะใน wallet</Title>
                        <List
                          size="small"
                          dataSource={couponWalletStates}
                          renderItem={(item) => (
                            <List.Item style={{ paddingInline: 0 }}>
                              <Space direction="vertical" size={2}>
                                <Tag color={item.state === "REDEEMED" ? "green" : item.state === "RESERVED" ? "purple" : item.state === "EXPIRED" ? "orange" : item.state === "REVOKED" ? "red" : "blue"}>
                                  {item.state}
                                </Tag>
                                <Text type="secondary">{item.meaning}</Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      </Space>
                    </Card>
                  </Col>
                </Row>

                <Card style={{ borderRadius: 16 }}>
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Title level={4} style={{ margin: 0 }}>ตัวอย่างเงื่อนไขที่ระบบใช้ตรวจ</Title>
                    <List
                      size="small"
                      bordered
                      style={{ borderRadius: 14 }}
                      dataSource={couponConditions}
                      renderItem={(item) => (
                        <List.Item>
                          <Space direction="vertical" size={2}>
                            <Text strong>{item.code}</Text>
                            <Text type="secondary">เงื่อนไข: {item.condition}</Text>
                            <Text>{item.result}</Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Space>
                </Card>

                <Card style={{ borderRadius: 16 }}>
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Title level={4} style={{ margin: 0 }}>สิ่งที่ระบบยังไม่มีหรือยังไม่ครบ</Title>
                    <List
                      size="small"
                      dataSource={couponGaps}
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
              title="🧩 คู่มือตามเมนู"
              subtitle="แยกเป็นการ์ดสั้น ๆ เพื่อให้คนสแกนแล้วรู้ทันทีว่าเมนูนี้เอาไว้ทำอะไร"
            >
              <Row gutter={[14, 14]}>
                {menuCards.map((item) => (
                  <Col xs={24} md={12} key={item.key}>
                    <Card style={{ borderRadius: 16, height: "100%" }}>
                      <Space direction="vertical" size={10} style={{ width: "100%" }}>
                        <Space>
                          <Tag color="blue" icon={item.icon}>
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
                          <Link href={item.href}>
                            <Button>เปิดหน้า {item.title}</Button>
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
                message="คำแนะนำการจัดกลุ่ม"
                description="Orders / Payment / Shipping ควรอยู่ใกล้กันในคู่มือ เพราะผู้ใช้ทำงานต่อเนื่องเป็น flow เดียวกัน ส่วน Products ควรอยู่คู่กับ Purchase เพราะเกี่ยวกับการมีของพร้อมขาย"
              />
            </Section>

            <Section
              id="faq"
              title="❓ คำถามที่เจอบ่อย"
              subtitle="วางแบบถาม-ตอบสั้น ๆ เพื่อช่วยลดเวลาที่ต้องไล่อ่านเอกสารยาว"
            >
              <List
                itemLayout="vertical"
                dataSource={helpRows}
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
              title="🔗 ลิงก์ไปหน้าที่ใช้บ่อย"
              subtitle="ให้ผู้ใช้ข้ามไปทำงานจริงได้ทันที ไม่ต้องอ่านจบทั้งหน้า"
            >
              <Steps
                direction="vertical"
                current={-1}
                items={[
                  {
                    title: "เริ่มตอบลูกค้า",
                    description: (
                      <>
                        เปิด <Link href="/admin/inbox">Inbox</Link> เพื่อดูแชทใหม่และ Customer 360
                      </>
                    ),
                  },
                  {
                    title: "เพิ่มสินค้า / แก้รูปสินค้า",
                    description: (
                      <>
                        เปิด <Link href="/admin/products">Products</Link> แล้วเพิ่มสินค้า รูปหลายรูป ราคา และ stock · ถ้าจะปรับสต็อกให้กางแถวสินค้าเพื่อใช้ปุ่มลัดต่อไซซ์หรือปรับหลายรายการ
                      </>
                    ),
                  },
                  {
                    title: "นำเข้าสินค้าจำนวนมากด้วย CSV/XLSX",
                    description: (
                      <>
                        ใน <Link href="/admin/products">Products</Link> กด นำเข้า · ดาวน์โหลดเทมเพลตแล้วกรอกตามหัวคอลัมน์ (SKU / ชื่อสินค้า / ราคาขาย จำเป็น) · อัปโหลดแล้วระบบจะแสดงตัวอย่างว่าจะ สร้างใหม่ / อัปเดต / ข้าม ก่อน จากนั้นกด ยืนยัน Import · ไม่ต้องใส่รูปในไฟล์ (เพิ่มรูปทีหลังในหน้าแก้ไข) และจำกัดสูงสุด 500 แถวต่อครั้ง
                      </>
                    ),
                  },
                  {
                    title: "รับของเข้าคลัง",
                    description: (
                      <>
                        เปิด <Link href="/admin/purchase">Purchase</Link> เพื่อสร้าง PO และรับของ
                      </>
                    ),
                  },
                  {
                    title: "ตาม order / payment / shipment",
                    description: (
                      <>
                        ใช้ <Link href="/admin/orders">Orders</Link>, <Link href="/admin/payment">Payment</Link>,{" "}
                        <Link href="/admin/shipment">Shipping</Link> เป็น flow เดียวกัน
                      </>
                    ),
                  },
                  {
                    title: "เชื่อมช่องทางจริง",
                    description: (
                      <>
                        ไปที่ <Link href="/admin/settings">Settings</Link> เพื่อวาง token และตั้ง webhook · ถ้าต้องทดสอบ Inbox realtime ให้เปิด{" "}
                        <Link href="/admin/inbox/realtime-diagnostics">Realtime Diagnostics</Link> แล้วกด Create Msg · LINE OA จริงจะ sync ชื่อ/รูปจาก LINE profile cache หลัง webhook เข้า
                      </>
                    ),
                  },
                  {
                    title: "ตั้ง AI Key ของร้านเอง (BYOK)",
                    description: (
                      <>
                        ใน <Link href="/admin/settings">Settings</Link> เลือก Anthropic หรือ DeepSeek
                        แล้วใส่ API Key/Model ของร้านได้ เมื่อเปลี่ยน provider ต้องกรอก key ใหม่
                        เสมอ; Slip OCR ยังใช้ provider กลางของแพลตฟอร์ม และการยืนยันเงินยังต้องให้
                        คนกด Confirm
                      </>
                    ),
                  },
                  {
                    title: "ตั้งชื่อร้าน + กรอกข้อมูลร้าน (ให้ AI ตอบลูกค้าได้)",
                    description: (
                      <>
                        ในการ์ด <b>ข้อมูลร้าน</b> ที่ <Link href="/admin/settings">Settings</Link> แก้ <b>ชื่อร้าน</b> ได้เอง
                        (Administrator · slug เป็นตัวระบุภายใน ระบบกำหนดให้ แก้ไม่ได้) และกรอก <b>ประเภทร้าน</b>,
                        เวลาเปิด-ปิด, ที่อยู่, อีเมล/เว็บไซต์, บัญชีรับเงิน (ธนาคาร/พร้อมเพย์), ค่าส่ง,
                        ประเทศ/สกุลเงิน — AI จะใช้ตอบลูกค้า เช่น “ร้านชื่ออะไร/เปิดกี่โมง” “โอนเข้าบัญชีไหน” “ค่าส่งเท่าไหร่” และจะยกตัวอย่าง/ถามต่อให้เข้ากับประเภทร้านจากข้อมูลจริง ไม่เดา
                      </>
                    ),
                  },
                  {
                    title: "ดูภาพรวมร้าน",
                    description: (
                      <>
                        เปิด <Link href="/admin/dashboard">Dashboard</Link> หรือ <Link href="/admin/reports">Reports</Link>
                        เพื่อดูยอดขาย สต็อก งานค้าง และการ์ด <b>AI health</b> · ถ้าต้องการตรวจคำตอบรายเคสให้เปิด{" "}
                        <Link href="/admin/ai-quality">AI Quality</Link> เพื่อดู success/handoff/unresolved rate,
                        failure cases และบทสนทนาที่สุ่มตรวจ โดยระบบปิดบังข้อมูลส่วนบุคคลในหน้าตรวจให้อัตโนมัติ
                      </>
                    ),
                  },
                  {
                    title: "ถาม/สั่งงานด้วย AI",
                    description: (
                      <>
                        เปิด <Link href="/admin/assistant">ผู้ช่วย AI</Link> เพื่อถามรายงาน/สต็อก/ออร์เดอร์ด้วยภาษาพูด
                        — งานที่กระทบเงิน/สต็อกจะต้องกดยืนยันเองก่อนเสมอ
                      </>
                    ),
                  },
                ]}
              />

              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12, borderRadius: 14 }}
                message="แนวคิดของคู่มือใหม่นี้"
                description="เปิดมาแล้วควรตอบได้ทันทีว่า “ฉันควรเริ่มจากตรงไหน”, “เมนูนี้ใช้ทำอะไร”, และ “ถ้าติดปัญหาควรดูตรงไหนต่อ”"
              />
            </Section>
          </Space>
        </Col>

        <Col xs={24} lg={7}>
          <div style={{ position: "sticky", top: 16 }}>
            <Card title="สารบัญ" style={{ borderRadius: 18, marginBottom: 16 }}>
              <Anchor affix={false} items={anchorItems} />
            </Card>

            <Card title="ทางลัดแนะนำ" style={{ borderRadius: 18, marginBottom: 16 }}>
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Link href="/admin/inbox">
                  <Button block icon={<InboxOutlined />}>
                    ไปที่ Inbox
                  </Button>
                </Link>
                <Link href="/admin/products">
                  <Button block icon={<DatabaseOutlined />}>
                    ไปที่ Products
                  </Button>
                </Link>
                <Link href="/admin/orders">
                  <Button block icon={<ShoppingCartOutlined />}>
                    ไปที่ Orders
                  </Button>
                </Link>
                <Link href="/admin/assistant">
                  <Button block icon={<RobotOutlined />}>
                    ไปที่ ผู้ช่วย AI
                  </Button>
                </Link>
                <Link href="/admin/settings">
                  <Button block icon={<CustomerServiceOutlined />}>
                    ไปที่ Settings
                  </Button>
                </Link>
                <Link href="/admin/inbox/realtime-diagnostics">
                  <Button block icon={<ApiOutlined />}>
                    ทดสอบ Realtime Inbox
                  </Button>
                </Link>
              </Space>
            </Card>

            <Card title="คู่มือที่ควรมีต่อ" style={{ borderRadius: 18 }}>
              <List
                size="small"
                dataSource={[
                  "search คู่มือจริงด้านบน",
                  "FAQ แยกตามเมนู",
                  "วิดีโอ/ภาพสั้นอธิบาย flow",
                  "ปุ่มเปิดหน้าจริงจากทุก section",
                  "คู่มือย่อสำหรับ onboarding พนักงานใหม่",
                ]}
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
            หมายเหตุ
          </Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            หน้านี้ถูกปรับให้เป็น “คู่มือใช้งานง่าย” ก่อน โดยเน้นการเริ่มงานไวและการมอง flow งานจริง ถ้าคุณชอบทิศทางนี้
            รอบถัดไปเราค่อยแตกลงรายละเอียดรายเมนูและเพิ่ม FAQ / search คู่มือจริงต่อได้
          </Paragraph>
          <Space wrap>
            <Tag icon={<ShopOutlined />}>เหมาะกับร้านใหม่</Tag>
            <Tag icon={<DashboardOutlined />}>เหมาะกับ onboarding ทีม</Tag>
            <Tag icon={<FileSearchOutlined />}>เหมาะกับงานปฏิบัติการรายวัน</Tag>
            <Tag icon={<ApiOutlined />}>ต่อยอดเป็นคู่มือ API ได้</Tag>
          </Space>
        </Space>
      </Card>
    </div>
  );
}
