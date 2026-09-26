"use client";

import { useMemo, useState } from "react";
import {
  AppstoreAddOutlined,
  AppleOutlined,
  ArrowRightOutlined,
  CheckCircleFilled,
  CloudOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  DownloadOutlined,
  FileProtectOutlined,
  HddOutlined,
  InfoCircleOutlined,
  LaptopOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  WindowsOutlined,
} from "@ant-design/icons";
import { Alert, Button, Collapse, Segmented, Tag, Typography } from "antd";
import { useI18n } from "@/lib/i18nContext";
import { resolveBilingual } from "@/lib/static-page-i18n";
import styles from "./page.module.css";

const { Title, Paragraph, Text } = Typography;

type Platform = "windows" | "ubuntu" | "macos";
type PackageType = "server-pos" | "server" | "pos";

type DownloadAsset = {
  id?: string;
  url: string;
  version?: string;
  filename?: string;
  sizeBytes?: number;
  sha256?: string;
  minOs?: string;
  releaseNotes?: string;
  status?: string;
};

type ArchiveAsset = {
  id: string;
  platform: Platform;
  packageType: PackageType;
  version: string;
  filename: string;
  status: string;
  compatibility: string;
  url: string;
};

type PageContent = {
  pilot: string;
  eyebrow: string;
  title: string;
  description: string;
  viewDownloads: string;
  seeRequirements: string;
  localFacts: Array<{ title: string; description: string }>;
  setupEyebrow: string;
  setupTitle: string;
  setupDescription: string;
  recommended: string;
  supported: string;
  experimental: string;
  transition: string;
  notSupported: string;
  os: Record<Platform, {
    name: string;
    edition: string;
    summary: string;
    points: string[];
  }>;
  transitionLabel: string;
  transitionItems: string;
  unsupportedLabel: string;
  unsupportedItems: string;
  hardwareTitle: string;
  hardware: Array<{ label: string; value: string }>;
  internetNote: string;
  flowEyebrow: string;
  flowTitle: string;
  flowDescription: string;
  steps: Array<{ title: string; description: string }>;
  releasesEyebrow: string;
  releasesTitle: string;
  releasesDescription: string;
  installer: string;
  currentPilot: string;
  choosePackageTitle: string;
  choosePackageDescription: string;
  packageTypes: Record<PackageType, { name: string; description: string }>;
  downloadNow: Record<PackageType, string>;
  unavailable: Record<PackageType, string>;
  available: string;
  awaitingArtifact: string;
  includes: string;
  versionLabel: string;
  sizeLabel: string;
  checksumLabel: string;
  minOsLabel: string;
  fallbackFiles: Record<Platform, Record<PackageType, string>>;
  windowsNote: string;
  ubuntuNote: string;
  macosNote: string;
  posNotes: Record<Platform, string>;
  warningTitle: string;
  warningDescription: string;
  archiveTitle: string;
  archiveDescription: string;
  archiveColumns: string[];
  archiveRows: Array<{
    version: string;
    platform: string;
    packageType: string;
    status: string;
    compatibility: string;
  }>;
  legacy: string;
  deprecated: string;
  archiveWarning: string;
  boundaryTitle: string;
  boundaryDescription: string;
  finalTitle: string;
  finalDescription: string;
};

const CONTENT: { th: PageContent; en: PageContent } = {
  th: {
    pilot: "EARLY ACCESS · TECHNICAL PILOT",
    eyebrow: "BMS RETAIL LOCAL",
    title: "ระบบขายหน้าร้านที่ทำงานบนเครื่องของร้าน",
    description:
      "ใช้ Web, POS, ฐานข้อมูล และกติกาธุรกิจชุดเดียวกับ BMS โดยเก็บข้อมูลหลักไว้ที่เครื่องร้าน เหมาะกับร้านที่ต้องการควบคุมระบบภายในและมีทีมดูแลเครื่องตามข้อกำหนด",
    viewDownloads: "ดูไฟล์ดาวน์โหลด",
    seeRequirements: "ตรวจสอบเครื่องที่รองรับ",
    localFacts: [
      { title: "ข้อมูลหลักอยู่ที่ร้าน", description: "PostgreSQL บนเครื่องร้านเป็นแหล่งข้อมูลจริงเพียงชุดเดียว ไม่มี cloud replica" },
      { title: "กติกาชุดเดียวกับ BMS", description: "ราคา สต็อก สิทธิ์ การชำระเงิน และ audit ยังตรวจจาก server เดิม" },
      { title: "หนึ่งเครื่อง หนึ่งร้าน", description: "รุ่นเริ่มต้นรองรับ 1 ร้าน, สาขา MAIN และ POS-01" },
    ],
    setupEyebrow: "RECOMMENDED ENVIRONMENT",
    setupTitle: "เลือก OS ให้ตรงกับวิธีดูแลร้าน",
    setupDescription: "แนะนำ Windows สำหรับร้านทั่วไป, Ubuntu สำหรับทีมที่ดูแล Linux และ macOS Apple Silicon สำหรับการทดลองที่มีทีม IT ดูแล",
    recommended: "แนะนำ",
    supported: "รองรับ",
    experimental: "ทดลอง",
    transition: "รองรับช่วงเปลี่ยนผ่าน",
    notSupported: "ยังไม่รองรับ",
    os: {
      windows: {
        name: "Windows 11 Pro x64",
        edition: "เหมาะกับร้านทั่วไป",
        summary: "ติดตั้งและดูแลหน้างานง่ายกว่า เหมาะกับเครื่องแคชเชียร์หลักที่มีผู้ใช้งานประจำ",
        points: ["เปิดใช้ virtualization และ WSL2", "บัญชี operator เฉพาะสำหรับเครื่องร้าน", "อาจต้อง restart ระหว่างการติดตั้ง"],
      },
      ubuntu: {
        name: "Ubuntu 24.04 LTS x64",
        edition: "เหมาะกับทีม IT / Linux",
        summary: "เหมาะกับร้านที่มีผู้ดูแล Linux และต้องการรัน Managed Runtime ผ่าน systemd กับ Moby",
        points: ["ต้องมีสิทธิ์ sudo สำหรับติดตั้ง", "ใช้ Secret Service หรือ KWallet สำหรับ POS token", "ควรมีผู้ดูแล backup และระบบปฏิบัติการ"],
      },
      macos: {
        name: "macOS 15 Sequoia · Apple Silicon",
        edition: "Experimental technical pilot",
        summary: "สำหรับร้านที่ใช้ Mac รุ่น Apple Silicon และมีทีม IT ดูแล runtime, backup และข้อกำหนดด้านความปลอดภัยของ macOS",
        points: ["รองรับเฉพาะ Apple Silicon (arm64)", "ต้องใช้ installer ที่ sign และ notarize ก่อนใช้งาน production", "ต้องทดสอบ sleep, restart, backup และ peripheral กับเครื่องจริง"],
      },
    },
    transitionLabel: "Windows 10 IoT Enterprise LTSC 2021 x64 และ Ubuntu 22.04 LTS",
    transitionItems: "Windows 10 22H2 ใช้ได้เฉพาะเครื่องที่มี ESU ปัจจุบัน",
    unsupportedLabel: "Intel Mac, ARM64 host อื่น, Windows Server และ Linux distro อื่น",
    unsupportedItems: "macOS Intel (x64) ยังไม่รองรับ และ macOS Apple Silicon ยังอยู่ในระดับ experimental technical pilot",
    hardwareTitle: "สเปกเครื่องแนะนำ",
    hardware: [
      { label: "CPU", value: "4 cores ขึ้นไป" },
      { label: "Memory", value: "16 GB RAM (ขั้นต่ำ 8 GB)" },
      { label: "Storage", value: "SSD ว่างอย่างน้อย 100 GB" },
      { label: "Power", value: "UPS ที่ผ่านการทดสอบกับเครื่องร้าน" },
    ],
    internetNote: "ตัวระบบหลักอยู่ในร้าน แต่ AI, อีเมล, ช่องทางแชท, ผู้ให้บริการชำระเงิน, ขนส่ง และ e-Tax ยังต้องใช้อินเทอร์เน็ต",
    flowEyebrow: "DOWNLOAD FLOW",
    flowTitle: "จากหน้าเว็บจนเปิด POS ได้",
    flowDescription: "เลือกบทบาทของเครื่องและไฟล์ให้ตรงกับ OS ตรวจ checksum แล้วติดตั้งตามลำดับบนเครื่องร้าน",
    steps: [
      { title: "เช็กเครื่อง", description: "เลือก OS และตรวจ CPU, RAM, SSD, UPS และอุปกรณ์หน้าร้าน" },
      { title: "เลือกบทบาทเครื่อง", description: "เลือก Server + POS, Server only หรือ POS Desktop only ให้ตรงกับการใช้งาน" },
      { title: "ดาวน์โหลด", description: "เลือกรุ่นล่าสุดที่ตรงกับ OS, สถาปัตยกรรม และบทบาทของเครื่อง" },
      { title: "ตรวจ SHA-256", description: "เทียบ checksum ของไฟล์ก่อนเปิด installer ทุกครั้ง" },
      { title: "ติดตั้ง", description: "installer ตรวจระบบ ติดตั้ง service และทำ health check ให้ครบ" },
      { title: "เปิด POS", description: "ตั้งค่าร้าน จับคู่ POS-01 และเริ่มใช้งานบน local service" },
    ],
    releasesEyebrow: "RELEASES",
    releasesTitle: "เลือก OS และหน้าที่ของเครื่อง",
    releasesDescription: "ร้านที่ใช้เครื่องเดียวควรเลือก Server + POS ส่วนเครื่องแม่ข่ายและเครื่องแคชเชียร์เพิ่มเติมสามารถติดตั้งแยกกันได้",
    installer: "ไฟล์ติดตั้ง",
    currentPilot: "Technical pilot",
    choosePackageTitle: "เครื่องนี้ใช้ทำอะไร?",
    choosePackageDescription: "เลือกหนึ่งแบบต่อเครื่อง ระบบจะแสดงไฟล์ล่าสุดของ OS ที่เลือก",
    packageTypes: {
      "server-pos": { name: "Server + POS Desktop", description: "แนะนำสำหรับร้านทั่วไป เปิด POS โปรแกรมเดียว ระบบจะเริ่ม Local Server ให้อัตโนมัติ" },
      server: { name: "Server only", description: "สำหรับเครื่องแม่ข่ายที่เก็บข้อมูลและรันบริการของร้าน โดยไม่ใช้เป็นจุดขาย" },
      pos: { name: "POS Desktop only", description: "สำหรับแคชเชียร์เพิ่มเติม เลือก Pair กับ Local Server ในร้านหรือ Server ภายนอกได้" },
    },
    downloadNow: { "server-pos": "ดาวน์โหลด Server + POS", server: "ดาวน์โหลด Server", pos: "ดาวน์โหลด POS Desktop" },
    unavailable: { "server-pos": "ยังไม่เผยแพร่แพ็กเกจรวม", server: "ยังไม่เผยแพร่ Server", pos: "ยังไม่เผยแพร่ POS Desktop" },
    available: "พร้อมดาวน์โหลด",
    awaitingArtifact: "รอ publish artifact",
    includes: "ไฟล์ที่เผยแพร่ต้องระบุ version, ขนาดไฟล์, SHA-256 และ release notes ให้ตรวจสอบก่อนติดตั้ง",
    versionLabel: "เวอร์ชัน",
    sizeLabel: "ขนาด",
    checksumLabel: "SHA-256",
    minOsLabel: "OS ขั้นต่ำ",
    fallbackFiles: {
      windows: { "server-pos": "BMS-Retail-Local-Full-Setup.exe", server: "BMS-Retail-Local-Server-Setup.exe", pos: "BMS-POS-Setup-x64.exe" },
      ubuntu: { "server-pos": "bms-retail-local-full_<version>_amd64.deb", server: "bms-retail-local-server_<version>_amd64.deb", pos: "bms-pos_<version>_amd64.deb" },
      macos: { "server-pos": "BMS-Retail-Local-Full-<version>-arm64.pkg", server: "BMS-Retail-Local-Server-<version>-arm64.pkg", pos: "BMS-POS-<version>-arm64.dmg" },
    },
    windowsNote: "Windows 11 x64 · WSL2 Managed Runtime",
    ubuntuNote: "Ubuntu 24.04 LTS x64 · systemd / Moby",
    macosNote: "macOS 15 · Apple Silicon · Experimental",
    posNotes: {
      windows: "Windows x64 · POS Desktop client",
      ubuntu: "Ubuntu x64 · ต้องมี Secret Service หรือ KWallet",
      macos: "macOS 12 ขึ้นไป · Apple Silicon · Keychain",
    },
    warningTitle: "สถานะปัจจุบัน: Technical pilot",
    warningDescription: "ยังไม่ใช่ General Availability และยังไม่ควรใช้แทน production release จนกว่าจะผ่าน code signing, updater/rollback, hardware certification และ recovery drills ตาม release gate",
    archiveTitle: "ต้องใช้เวอร์ชันเก่า?",
    archiveDescription: "เก็บรุ่นเก่าแยกจากปุ่มหลักเพื่อลดการติดตั้งผิดรุ่น",
    archiveColumns: ["เวอร์ชัน", "ระบบ", "ประเภท", "สถานะ", "ใช้เมื่อ"],
    archiveRows: [
      { version: "0.2.0-internal.3", platform: "Ubuntu 24.04 x64", packageType: "Server only", status: "Legacy", compatibility: "Rollback ตาม release notes" },
      { version: "0.2.0-internal.2", platform: "Ubuntu 24.04 x64", packageType: "Server only", status: "Deprecated", compatibility: "เก็บเพื่อวิเคราะห์เท่านั้น" },
    ],
    legacy: "LEGACY",
    deprecated: "DEPRECATED",
    archiveWarning: "ห้ามติดตั้งรุ่นเก่าทับรุ่นใหม่โดยตรง เพราะ schema และข้อมูลร้านอาจไม่รองรับ ต้องใช้ rollback path และ backup ที่ระบุใน release notes",
    boundaryTitle: "หนึ่ง installer แต่ยังคงแยกหน้าที่ภายใน",
    boundaryDescription: "แพ็กเกจ Server + POS ช่วยลดขั้นตอนติดตั้ง แต่ POS Desktop ยังคงเป็น client ที่เชื่อมกับ Web, WS, PostgreSQL และ Redis ของ Retail Local Server โดยไม่ถือฐานข้อมูลหรือกติกาการขายแยกเอง",
    finalTitle: "เลือกไฟล์ติดตั้งให้ตรงกับเครื่อง",
    finalDescription: "กลับไปที่ไฟล์ล่าสุดสำหรับ Windows, Ubuntu หรือ macOS และตรวจ SHA-256 ก่อนติดตั้ง",
  },
  en: {
    pilot: "EARLY ACCESS · TECHNICAL PILOT",
    eyebrow: "BMS RETAIL LOCAL",
    title: "Run your retail system on the shop computer",
    description:
      "Use the same BMS Web, POS, database and business rules while keeping the primary data on the shop host. Designed for stores that can operate and protect a supported local machine.",
    viewDownloads: "View downloads",
    seeRequirements: "Check system requirements",
    localFacts: [
      { title: "Shop-hosted source of truth", description: "Local PostgreSQL is the only primary datastore; there is no cloud replica." },
      { title: "One BMS rule set", description: "Price, stock, permissions, payments and audit remain server-authoritative." },
      { title: "One host, one store", description: "The initial profile supports one store, MAIN branch and POS-01." },
    ],
    setupEyebrow: "RECOMMENDED ENVIRONMENT",
    setupTitle: "Choose an OS that matches your operations",
    setupDescription: "Windows is recommended for most stores; Ubuntu suits Linux teams, while macOS Apple Silicon is available as an IT-managed experiment.",
    recommended: "Recommended",
    supported: "Supported",
    experimental: "Experimental",
    transition: "Transition support",
    notSupported: "Not supported yet",
    os: {
      windows: {
        name: "Windows 11 Pro x64",
        edition: "Best for most stores",
        summary: "The simpler on-site operating path for a primary cashier computer with a regular operator.",
        points: ["Virtualization and WSL2 enabled", "Dedicated operator account for the shop host", "A restart may be required during setup"],
      },
      ubuntu: {
        name: "Ubuntu 24.04 LTS x64",
        edition: "Best for IT / Linux teams",
        summary: "For stores that can operate Linux and the Managed Runtime through systemd and Moby.",
        points: ["sudo access is required to install", "Secret Service or KWallet stores the POS token", "An owner is needed for backups and OS maintenance"],
      },
      macos: {
        name: "macOS 15 Sequoia · Apple Silicon",
        edition: "Experimental technical pilot",
        summary: "For stores using an Apple Silicon Mac with an IT owner for the runtime, backups and macOS security requirements.",
        points: ["Apple Silicon (arm64) only", "The installer must be signed and notarized before production use", "Test sleep, restart, backup and peripherals on real hardware"],
      },
    },
    transitionLabel: "Windows 10 IoT Enterprise LTSC 2021 x64 and Ubuntu 22.04 LTS",
    transitionItems: "Windows 10 22H2 requires evidence of current ESU coverage",
    unsupportedLabel: "Intel Macs, other ARM64 hosts, Windows Server and other Linux distributions",
    unsupportedItems: "Intel macOS (x64) is not supported; macOS on Apple Silicon remains an experimental technical pilot",
    hardwareTitle: "Recommended hardware",
    hardware: [
      { label: "CPU", value: "4 cores or more" },
      { label: "Memory", value: "16 GB RAM (8 GB minimum)" },
      { label: "Storage", value: "At least 100 GB free on SSD" },
      { label: "Power", value: "A UPS tested with the shop host" },
    ],
    internetNote: "Core services run in the shop, but AI, email, chat channels, payment providers, carriers and e-Tax still require internet access.",
    flowEyebrow: "DOWNLOAD FLOW",
    flowTitle: "From the website to a paired POS",
    flowDescription: "Choose the machine role and installer for your OS, verify its checksum, and follow the release steps.",
    steps: [
      { title: "Check the host", description: "Choose an OS and confirm CPU, RAM, SSD, UPS and retail peripherals." },
      { title: "Choose its role", description: "Select Server + POS, Server only, or POS Desktop only for this machine." },
      { title: "Download", description: "Use the latest build matching the OS, architecture, and machine role." },
      { title: "Verify SHA-256", description: "Compare the published checksum before opening the installer." },
      { title: "Install", description: "Let the installer run preflight, start services and complete health checks." },
      { title: "Open POS", description: "Configure the store, pair POS-01 and start using the local services." },
    ],
    releasesEyebrow: "RELEASES",
    releasesTitle: "Choose the OS and machine role",
    releasesDescription: "Most single-computer stores should choose Server + POS. Dedicated servers and additional cashier devices can install each component separately.",
    installer: "Installer",
    currentPilot: "Technical pilot",
    choosePackageTitle: "What will this machine do?",
    choosePackageDescription: "Choose one role per machine. The latest file for the selected OS is shown below.",
    packageTypes: {
      "server-pos": { name: "Server + POS Desktop", description: "Recommended for most stores. Open POS and it starts the Local Server automatically." },
      server: { name: "Server only", description: "For a dedicated host that stores data and runs shop services without acting as a checkout." },
      pos: { name: "POS Desktop only", description: "For an additional register. Pair it with an in-store Local Server or an external server." },
    },
    downloadNow: { "server-pos": "Download Server + POS", server: "Download Server", pos: "Download POS Desktop" },
    unavailable: { "server-pos": "Combined package not published", server: "Server not published", pos: "POS Desktop not published" },
    available: "Available",
    awaitingArtifact: "Awaiting published artifact",
    includes: "Every published file must show its version, file size, SHA-256 and release notes before installation.",
    versionLabel: "Version",
    sizeLabel: "Size",
    checksumLabel: "SHA-256",
    minOsLabel: "Minimum OS",
    fallbackFiles: {
      windows: { "server-pos": "BMS-Retail-Local-Full-Setup.exe", server: "BMS-Retail-Local-Server-Setup.exe", pos: "BMS-POS-Setup-x64.exe" },
      ubuntu: { "server-pos": "bms-retail-local-full_<version>_amd64.deb", server: "bms-retail-local-server_<version>_amd64.deb", pos: "bms-pos_<version>_amd64.deb" },
      macos: { "server-pos": "BMS-Retail-Local-Full-<version>-arm64.pkg", server: "BMS-Retail-Local-Server-<version>-arm64.pkg", pos: "BMS-POS-<version>-arm64.dmg" },
    },
    windowsNote: "Windows 11 x64 · WSL2 Managed Runtime",
    ubuntuNote: "Ubuntu 24.04 LTS x64 · systemd / Moby",
    macosNote: "macOS 15 · Apple Silicon · Experimental",
    posNotes: {
      windows: "Windows x64 · POS Desktop client",
      ubuntu: "Ubuntu x64 · Secret Service or KWallet required",
      macos: "macOS 12 or newer · Apple Silicon · Keychain",
    },
    warningTitle: "Current status: Technical pilot",
    warningDescription: "This is not General Availability. It should not be presented as a production release until code signing, updater/rollback, hardware certification and recovery drills clear the release gates.",
    archiveTitle: "Need an older version?",
    archiveDescription: "Older builds are separated from the primary action to reduce accidental installs.",
    archiveColumns: ["Version", "Platform", "Package", "Status", "Use case"],
    archiveRows: [
      { version: "0.2.0-internal.3", platform: "Ubuntu 24.04 x64", packageType: "Server only", status: "Legacy", compatibility: "Rollback per release notes" },
      { version: "0.2.0-internal.2", platform: "Ubuntu 24.04 x64", packageType: "Server only", status: "Deprecated", compatibility: "Diagnostic reference only" },
    ],
    legacy: "LEGACY",
    deprecated: "DEPRECATED",
    archiveWarning: "Never install an older build over a newer one. The schema and shop data may be incompatible; use the rollback path and backup documented by the release.",
    boundaryTitle: "One installer, separate responsibilities",
    boundaryDescription: "The Server + POS package reduces setup steps, while POS Desktop remains a client of the Retail Local Web, WS, PostgreSQL and Redis services and owns neither a database nor separate sales rules.",
    finalTitle: "Choose the installer for your host",
    finalDescription: "Return to the latest Windows, Ubuntu or macOS file and verify its SHA-256 before installation.",
  },
};

export default function RetailLocalPageClient({
  downloads,
  archive,
}: {
  downloads: Record<Platform, Record<PackageType, DownloadAsset | null>>;
  archive: ArchiveAsset[];
}) {
  const { lang } = useI18n();
  const content = resolveBilingual(CONTENT, lang);
  const [platform, setPlatform] = useState<Platform>("windows");
  const selected = content.os[platform];

  const platformOptions = useMemo(
    () => [
      { label: <span><WindowsOutlined /> Windows</span>, value: "windows" },
      { label: <span><CodeOutlined /> Ubuntu</span>, value: "ubuntu" },
      { label: <span><AppleOutlined /> macOS</span>, value: "macos" },
    ],
    []
  );

  const archiveRows: Array<{
    version: string;
    platform: string;
    packageType: string;
    status: string;
    compatibility: string;
    url?: string;
  }> = archive.length
    ? archive.map((item) => ({
      version: item.version,
      platform: item.platform === "windows" ? "Windows x64" : item.platform === "ubuntu" ? "Ubuntu x64" : "macOS Apple Silicon",
      packageType: content.packageTypes[item.packageType].name,
      status: item.status,
      compatibility: item.compatibility,
      url: item.url,
    }))
    : content.archiveRows;

  const formatBytes = (value?: number) => {
    if (!value) return "";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <Tag className={styles.pilotTag} icon={<ThunderboltOutlined />}>{content.pilot}</Tag>
          <Text className={styles.eyebrow}>{content.eyebrow}</Text>
          <Title className={styles.heroTitle}>{content.title}</Title>
          <Paragraph className={styles.heroDescription}>{content.description}</Paragraph>
          <div className={styles.heroActions}>
            <Button type="primary" size="large" href="#downloads" icon={<DownloadOutlined />}>{content.viewDownloads}</Button>
            <Button size="large" href="#requirements" icon={<DesktopOutlined />}>{content.seeRequirements}</Button>
          </div>
          <div className={styles.factStrip}>
            {content.localFacts.map((fact, index) => (
              <div key={fact.title}>
                <span>{index === 0 ? <DatabaseOutlined /> : index === 1 ? <LockOutlined /> : <LaptopOutlined />}</span>
                <strong>{fact.title}</strong>
                <small>{fact.description}</small>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.heroVisual} aria-label="BMS Retail Local system overview">
          <div className={styles.visualTopbar}>
            <span><img src="/icons/icon.svg" alt="" /> BMS Retail Local</span>
            <Tag color="processing">LOCAL HOST</Tag>
          </div>
          <div className={styles.hostPanel}>
            <div className={styles.hostIdentity}>
              <span className={styles.hostIcon}><DesktopOutlined /></span>
              <span><strong>Shop host</strong><small>127.0.0.1 · MAIN · POS-01</small></span>
              <CheckCircleFilled />
            </div>
            <div className={styles.serviceGrid}>
              <span><CloudOutlined /><strong>Web + API</strong><small>Healthy</small></span>
              <span><ThunderboltOutlined /><strong>WebSocket</strong><small>Healthy</small></span>
              <span><DatabaseOutlined /><strong>PostgreSQL</strong><small>Local truth</small></span>
              <span><HddOutlined /><strong>Backup</strong><small>Off-host</small></span>
            </div>
            <div className={styles.visualFooter}>
              <span><SafetyCertificateOutlined /> Server-authoritative POS</span>
              <span><LockOutlined /> Loopback only</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.requirements} id="requirements">
        <div className={styles.sectionHeading}>
          <Text className={styles.eyebrow}>{content.setupEyebrow}</Text>
          <Title level={2}>{content.setupTitle}</Title>
          <Paragraph>{content.setupDescription}</Paragraph>
        </div>

        <div className={styles.requirementsGrid}>
          <div className={styles.osChooser}>
            <Segmented
              block
              options={platformOptions}
              value={platform}
              onChange={(value) => setPlatform(value as Platform)}
            />
            <div className={styles.osDetail}>
              <div className={styles.osTitleRow}>
                <span className={styles.osIcon}>{platform === "windows" ? <WindowsOutlined /> : platform === "ubuntu" ? <CodeOutlined /> : <AppleOutlined />}</span>
                <span><strong>{selected.name}</strong><small>{selected.edition}</small></span>
                <Tag color={platform === "windows" ? "green" : platform === "ubuntu" ? "blue" : "gold"}>
                  {platform === "windows" ? content.recommended : platform === "ubuntu" ? content.supported : content.experimental}
                </Tag>
              </div>
              <Paragraph>{selected.summary}</Paragraph>
              <ul>{selected.points.map((point) => <li key={point}><CheckCircleFilled />{point}</li>)}</ul>
            </div>
            <div className={styles.supportMatrix}>
              <div><Tag color="gold">{content.transition}</Tag><strong>{content.transitionLabel}</strong><small>{content.transitionItems}</small></div>
              <div><Tag>{content.notSupported}</Tag><strong>{content.unsupportedLabel}</strong><small>{content.unsupportedItems}</small></div>
            </div>
          </div>

          <aside className={styles.hardwarePanel}>
            <div className={styles.hardwareHeader}><HddOutlined /><Title level={4}>{content.hardwareTitle}</Title></div>
            <dl>
              {content.hardware.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
            </dl>
            <div className={styles.internetNote}><InfoCircleOutlined /><span>{content.internetNote}</span></div>
          </aside>
        </div>
      </section>

      <section className={styles.flowSection}>
        <div className={styles.sectionHeading}>
          <Text className={styles.eyebrow}>{content.flowEyebrow}</Text>
          <Title level={2}>{content.flowTitle}</Title>
          <Paragraph>{content.flowDescription}</Paragraph>
        </div>
        <div className={styles.flowGrid}>
          {content.steps.map((step, index) => (
            <div key={step.title} className={styles.flowStep}>
              <span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step.title}</strong>
              <small>{step.description}</small>
              {index < content.steps.length - 1 && <ArrowRightOutlined className={styles.stepArrow} />}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.releaseSection} id="downloads">
        <div className={styles.sectionHeading}>
          <Text className={styles.eyebrow}>{content.releasesEyebrow}</Text>
          <Title level={2}>{content.releasesTitle}</Title>
          <Paragraph>{content.releasesDescription}</Paragraph>
        </div>

        <Alert
          showIcon
          type="warning"
          message={content.warningTitle}
          description={content.warningDescription}
          className={styles.releaseAlert}
        />

        <div className={styles.downloadChooser}>
          <div>
            <strong>{content.choosePackageTitle}</strong>
            <small>{content.choosePackageDescription}</small>
          </div>
          <Segmented
            block
            options={platformOptions}
            value={platform}
            onChange={(value) => setPlatform(value as Platform)}
          />
        </div>

        <div className={styles.downloadGrid}>
          {(["server-pos", "server", "pos"] as PackageType[]).map((packageType) => {
            const isRecommended = packageType === "server-pos";
            const directDownload = downloads[platform][packageType];
            const filename = directDownload?.filename || content.fallbackFiles[platform][packageType];
            const platformNote = packageType === "pos"
              ? content.posNotes[platform]
              : platform === "windows" ? content.windowsNote : platform === "ubuntu" ? content.ubuntuNote : content.macosNote;
            const role = content.packageTypes[packageType];
            return (
              <article className={`${styles.downloadCard} ${isRecommended ? styles.downloadCardPrimary : ""}`} key={packageType}>
                <div className={styles.downloadCardTop}>
                  <span className={styles.downloadIcon}>
                    {packageType === "server-pos" ? <AppstoreAddOutlined /> : packageType === "server" ? <DatabaseOutlined /> : <DesktopOutlined />}
                  </span>
                  <span><Text>{content.installer}</Text><strong>{role.name}</strong></span>
                  {isRecommended && <Tag color="green">{content.recommended}</Tag>}
                </div>
                <p className={styles.packageDescription}>{role.description}</p>
                <div className={styles.fileIdentity}>
                  <strong>{filename}</strong>
                  <small>{directDownload?.minOs || platformNote}</small>
                </div>
                <div className={styles.downloadMeta}>
                  <Tag color="processing">{content.currentPilot}</Tag>
                  <Tag color={directDownload ? "success" : "default"}>{directDownload ? content.available : content.awaitingArtifact}</Tag>
                  <span><FileProtectOutlined /> SHA-256 + release notes</span>
                </div>
                {directDownload?.version && (
                  <dl className={styles.releaseDetails}>
                    <div><dt>{content.versionLabel}</dt><dd>{directDownload.version}</dd></div>
                    {directDownload.sizeBytes ? <div><dt>{content.sizeLabel}</dt><dd>{formatBytes(directDownload.sizeBytes)}</dd></div> : null}
                    <div><dt>{content.checksumLabel}</dt><dd>{directDownload.sha256 ? directDownload.sha256.slice(0, 16) + "..." : "-"}</dd></div>
                  </dl>
                )}
                {directDownload ? (
                  <a href={directDownload.url} className={styles.downloadLink} download>
                    <Button type={isRecommended ? "primary" : "default"} size="large" block icon={<DownloadOutlined />}>{content.downloadNow[packageType]}</Button>
                  </a>
                ) : (
                  <Button size="large" block disabled icon={<DownloadOutlined />}>{content.unavailable[packageType]}</Button>
                )}
              </article>
            );
          })}
        </div>
        <p className={styles.releaseIncludes}><InfoCircleOutlined />{content.includes}</p>

        <Collapse
          className={styles.archive}
          items={[{
            key: "archive",
            label: <span className={styles.archiveLabel}><span><strong>{content.archiveTitle}</strong><small>{content.archiveDescription}</small></span><Tag>ARCHIVE</Tag></span>,
            children: (
              <div>
                <div className={styles.archiveTable} role="table">
                  <div className={styles.archiveHeader} role="row">{content.archiveColumns.map((column) => <span role="columnheader" key={column}>{column}</span>)}</div>
                  {archiveRows.map((row) => (
                    <div className={styles.archiveRow} role="row" key={`${row.version}-${row.platform}-${row.packageType}`}>
                      <strong role="cell">{("url" in row && row.url) ? <a href={row.url}>{row.version}</a> : row.version}</strong>
                      <span role="cell">{row.platform}</span>
                      <span role="cell">{row.packageType}</span>
                      <span role="cell"><Tag color={row.status === "deprecated" || row.status === "Deprecated" ? "default" : "gold"}>{row.status === "deprecated" || row.status === "Deprecated" ? content.deprecated : content.legacy}</Tag></span>
                      <span role="cell">{row.compatibility}</span>
                    </div>
                  ))}
                </div>
                <Alert showIcon type="error" message={content.archiveWarning} />
              </div>
            ),
          }]}
        />
      </section>

      <section className={styles.boundary}>
        <span><SafetyCertificateOutlined /></span>
        <div><Title level={4}>{content.boundaryTitle}</Title><Paragraph>{content.boundaryDescription}</Paragraph></div>
      </section>

      <section className={styles.finalCta}>
        <div><Title level={3}>{content.finalTitle}</Title><Paragraph>{content.finalDescription}</Paragraph></div>
        <Button type="primary" size="large" href="#downloads" icon={<DownloadOutlined />}>{content.viewDownloads}</Button>
      </section>
    </div>
  );
}
