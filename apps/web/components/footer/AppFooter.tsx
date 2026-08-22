"use client";

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ApiOutlined,
  BarChartOutlined,
  BookOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  CustomerServiceOutlined,
  FileTextOutlined,
  LockOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShopOutlined,
} from "@ant-design/icons";

type ConsentValue = "allow" | "reject";
type Lang = "th" | "en";

const CONSENT_KEY = "pdpa_consent_v1";

function readConsent(): { value: ConsentValue; at: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.value === "allow" || parsed?.value === "reject") return parsed;
    return null;
  } catch {
    return null;
  }
}

function writeConsent(value: ConsentValue) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ value, at: new Date().toISOString() }));
  } catch {
    // Local storage may be unavailable in privacy mode. Consent remains session-only.
  }
}

const COPY = {
  th: {
    description: "ระบบบริหารธุรกิจที่เปลี่ยนทุกบทสนทนาของลูกค้าให้เป็น Workflow ที่ตรวจสอบได้",
    start: "เริ่มใช้ฟรี",
    product: "ผลิตภัณฑ์",
    workflow: "การทำงานของ BMS",
    demo: "ทดลองคุยกับ AI",
    security: "ความปลอดภัย",
    pricing: "แพ็กเกจราคา",
    dashboard: "Dashboard ร้านค้า",
    resources: "เรียนรู้และช่วยเหลือ",
    help: "ศูนย์ช่วยเหลือ",
    roadmap: "Roadmap",
    support: "ติดต่อทีมงาน",
    faq: "คำถามที่พบบ่อย",
    legal: "กฎหมายและข้อมูล",
    terms: "ข้อกำหนดการใช้งาน",
    privacy: "นโยบายความเป็นส่วนตัว",
    openSource: "Open Source",
    license: "License",
    footerLine: "AI Business Management System",
    pdpa: "ตั้งค่า PDPA",
    pdpaTitle: "PDPA / Cookies",
    pdpaDesc: "เราใช้คุกกี้ที่จำเป็นเพื่อให้เว็บไซต์ทำงาน และอาจใช้คุกกี้วิเคราะห์เพื่อปรับปรุงประสบการณ์ใช้งาน คุณสามารถเลือกอนุญาตหรือปฏิเสธได้",
    allow: "อนุญาต",
    reject: "ปฏิเสธ",
    close: "ปิด",
    homeAria: "หน้าแรก BMS",
    pdpaDialogAria: "การตั้งค่าคุกกี้ PDPA",
    allowedState: "อนุญาตแล้ว",
    rejectedState: "ปฏิเสธแล้ว",
  },
  en: {
    description: "A business operating system that turns every customer conversation into an auditable workflow.",
    start: "Start free",
    product: "Product",
    workflow: "How BMS works",
    demo: "Try the AI",
    security: "Security",
    pricing: "Pricing",
    dashboard: "Store dashboard",
    resources: "Learn and support",
    help: "Help center",
    roadmap: "Roadmap",
    support: "Contact support",
    faq: "FAQ",
    legal: "Legal and data",
    terms: "Terms of service",
    privacy: "Privacy policy",
    openSource: "Open Source",
    license: "License",
    footerLine: "AI Business Management System",
    pdpa: "PDPA settings",
    pdpaTitle: "PDPA / Cookies",
    pdpaDesc: "We use necessary cookies to keep the website working and may use analytics cookies to improve your experience. You can allow or reject them.",
    allow: "Allow",
    reject: "Reject",
    close: "Close",
    homeAria: "BMS home",
    pdpaDialogAria: "PDPA cookie settings",
    allowedState: "Allowed",
    rejectedState: "Rejected",
  },
} as const;

function AppFooterInner({ lang }: { lang?: Lang }) {
  const locale = lang === "en" ? "en" : "th";
  const t = COPY[locale];
  const year = useMemo(() => new Date().getFullYear(), []);
  const [consent, setConsent] = useState<ConsentValue | null>(null);
  const [showPdpa, setShowPdpa] = useState(false);

  useEffect(() => {
    const current = readConsent();
    if (current?.value) {
      setConsent(current.value);
      setShowPdpa(false);
    } else {
      setShowPdpa(true);
    }
  }, []);

  const onAllow = useCallback(() => {
    writeConsent("allow");
    setConsent("allow");
    setShowPdpa(false);
  }, []);

  const onReject = useCallback(() => {
    writeConsent("reject");
    setConsent("reject");
    setShowPdpa(false);
  }, []);

  const productLinks = [
    { href: "/#workflow", label: t.workflow, icon: <ApiOutlined /> },
    { href: "/demo", label: t.demo, icon: <MessageOutlined /> },
    { href: "/#security", label: t.security, icon: <LockOutlined /> },
    { href: "/#pricing", label: t.pricing, icon: <ShopOutlined /> },
    { href: "/admin/dashboard", label: t.dashboard, icon: <BarChartOutlined /> },
  ];

  const resourceLinks = [
    { href: "/help", label: t.help, icon: <QuestionCircleOutlined /> },
    { href: "/roadmap", label: t.roadmap, icon: <ApiOutlined /> },
    { href: "/support", label: t.support, icon: <CustomerServiceOutlined /> },
    { href: "/help", label: t.faq, icon: <BookOutlined /> },
  ];

  const legalLinks = [
    { href: "/terms", label: t.terms, icon: <FileTextOutlined /> },
    { href: "/privacy", label: t.privacy, icon: <SafetyCertificateOutlined /> },
    { href: "/open-source", label: t.openSource, icon: <CodeOutlined /> },
    { href: "/license", label: t.license, icon: <BookOutlined /> },
  ];

  return (
    <>
      <footer className={`bms-footer ${showPdpa ? "bms-footer--with-pdpa" : ""}`}>
        <div className="bms-footer-shell">
          <div className="bms-footer-grid">
            <div className="bms-footer-brand">
              <Link href="/" className="bms-footer-brand-line" aria-label={t.homeAria}>
                <span className="bms-footer-logo">
                  <img src="/icons/icon.svg" alt="" width={48} height={48} />
                </span>
                <span><strong>BMS</strong><small>{t.footerLine}</small></span>
              </Link>
              <p>{t.description}</p>
              <Link href="/shop-signup" className="bms-footer-cta"><RocketOutlined />{t.start}</Link>
            </div>

            <div className="bms-footer-columns">
              <FooterColumn title={t.product} links={productLinks} />
              <FooterColumn title={t.resources} links={resourceLinks} />
              <FooterColumn title={t.legal} links={legalLinks} />
            </div>
          </div>

          <div className="bms-footer-bottom">
            <span>© {year} BMS · {t.footerLine}</span>
            <button type="button" onClick={() => setShowPdpa(true)} aria-label={t.pdpa}>
              <SettingOutlined />{t.pdpa}{consent ? <em>({consent === "allow" ? t.allowedState : t.rejectedState})</em> : null}
            </button>
          </div>
        </div>
      </footer>

      {showPdpa && (
        <div className="bms-pdpa-bar" role="dialog" aria-label={t.pdpaDialogAria}>
          <div className="bms-pdpa-card">
            <div className="bms-pdpa-copy">
              <strong>{t.pdpaTitle}</strong>
              <span>{t.pdpaDesc}</span>
              <span className="bms-pdpa-links"><Link href="/privacy">{t.privacy}</Link><Link href="/terms">{t.terms}</Link></span>
            </div>
            <div className="bms-pdpa-actions">
              <button type="button" className="bms-pdpa-secondary" onClick={onReject}><CloseCircleOutlined />{t.reject}</button>
              <button type="button" className="bms-pdpa-primary" onClick={onAllow}><CheckCircleOutlined />{t.allow}</button>
              <button type="button" className="bms-pdpa-close" onClick={() => setShowPdpa(false)}>{t.close}</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .bms-footer {
          background: var(--app-bg);
          padding: 26px 16px 30px;
        }

        .bms-footer--with-pdpa { padding-bottom: 120px; }

        .bms-footer-shell {
          max-width: 1400px;
          margin: 0 auto;
          border-top: 1px solid var(--app-border);
          padding: 34px 6px 0;
        }

        .bms-footer-grid {
          display: grid;
          grid-template-columns: minmax(260px, 1.45fr) repeat(3, minmax(150px, .8fr));
          gap: 42px;
        }

        .bms-footer-columns { display: contents; }

        .bms-footer-brand { display: grid; gap: 15px; align-content: start; }
        .bms-footer-brand p { margin: 0; max-width: 390px; color: var(--app-muted); line-height: 1.7; }

        .bms-footer-brand-line {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          color: var(--app-text);
          text-decoration: none;
          justify-self: start;
        }

        .bms-footer-logo {
          width: 48px;
          height: 48px;
          border-radius: 16px;
          display: inline-flex;
          overflow: hidden;
          background: rgba(var(--app-primary-rgb),.1);
        }

        .bms-footer-logo img { width: 100%; height: 100%; object-fit: cover; transform: scale(1.18); }
        .bms-footer-brand-line > span:last-child { display: grid; gap: 3px; }
        .bms-footer-brand-line strong { font-size: 18px; }
        .bms-footer-brand-line small { color: var(--app-muted); }

        .bms-footer-cta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          justify-self: start;
          border-radius: 999px;
          padding: 9px 15px;
          background: var(--app-primary);
          color: #fff;
          text-decoration: none;
          font-weight: 600;
          box-shadow: 0 10px 24px rgba(var(--app-primary-rgb),.18);
        }

        .bms-footer-column { display: grid; align-content: start; gap: 11px; }
        .bms-footer-column h2 { margin: 0 0 4px; color: var(--app-text); font-size: 14px; }

        .bms-footer-link {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--app-muted);
          text-decoration: none;
          transition: color .16s ease;
        }

        .bms-footer-link:hover { color: var(--app-primary); }

        .bms-footer-bottom {
          margin-top: 30px;
          padding-top: 18px;
          border-top: 1px solid var(--app-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          color: var(--app-muted);
          font-size: 12px;
        }

        .bms-footer-bottom button {
          appearance: none;
          border: 0;
          background: transparent;
          color: inherit;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 6px;
        }

        .bms-footer-bottom button:hover { color: var(--app-primary); }
        .bms-footer-bottom em { font-style: normal; opacity: .7; }

        .bms-pdpa-bar {
          position: fixed;
          inset: auto 0 0;
          z-index: 1500;
          padding: 12px;
          background: rgba(var(--app-bg-rgb),.78);
          backdrop-filter: blur(14px);
        }

        .bms-pdpa-card {
          max-width: 1120px;
          margin: 0 auto;
          border: 1px solid var(--app-border);
          border-radius: 18px;
          background: rgba(var(--app-surface-rgb),.98);
          box-shadow: 0 18px 50px rgba(var(--app-shadow-rgb),.16);
          padding: 14px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }

        .bms-pdpa-copy { display: grid; gap: 4px; color: var(--app-text); }
        .bms-pdpa-copy > span { color: var(--app-muted); line-height: 1.5; }
        .bms-pdpa-links { display: flex; gap: 12px; font-size: 12px; }
        .bms-pdpa-links a { color: var(--app-primary); }
        .bms-pdpa-actions { display: flex; gap: 8px; flex-shrink: 0; }

        .bms-pdpa-actions button {
          border-radius: 999px;
          padding: 8px 13px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .bms-pdpa-secondary, .bms-pdpa-close {
          border: 1px solid var(--app-border);
          background: var(--app-surface);
          color: var(--app-text);
        }

        .bms-pdpa-primary { border: 1px solid var(--app-primary); background: var(--app-primary); color: #fff; }

        @media (max-width: 980px) {
          .bms-footer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        @media (max-width: 640px) {
          .bms-footer { padding-inline: 18px; }
          .bms-footer--with-pdpa { padding-bottom: 210px; }
          .bms-footer-shell { padding-top: 26px; }
          .bms-footer-grid { grid-template-columns: 1fr; gap: 22px; }

          .bms-footer-brand p { max-width: none; font-size: 13.5px; }
          .bms-footer-logo { width: 40px; height: 40px; border-radius: 13px; }
          .bms-footer-brand-line strong { font-size: 16px; }
          .bms-footer-brand-line small { font-size: 12.5px; }
          .bms-footer-cta { width: 100%; justify-content: center; font-size: 13.5px; padding: 10px 15px; }

          /* Collapse the 3 link columns into a tighter 2-up grid so the footer
             doesn't run into one long stack of rows on narrow screens. */
          .bms-footer-columns {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            column-gap: 16px;
            row-gap: 22px;
          }
          .bms-footer-columns .bms-footer-column:last-child { grid-column: 1 / -1; }

          .bms-footer-column { gap: 9px; }
          .bms-footer-column h2 { font-size: 12.5px; margin-bottom: 2px; }
          .bms-footer-link { font-size: 13.5px; gap: 7px; }
          .bms-footer-link svg { font-size: 13px; }

          .bms-footer-bottom { margin-top: 22px; padding-top: 14px; gap: 10px; }
          .bms-footer-bottom, .bms-pdpa-card { align-items: flex-start; flex-direction: column; }
          .bms-pdpa-actions { width: 100%; flex-wrap: wrap; }
          .bms-pdpa-actions button { justify-content: center; flex: 1; }
          .bms-pdpa-primary { order: -1; flex: 1 1 100%; }
        }
      `}</style>
    </>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string; icon: React.ReactNode }>;
}) {
  return (
    <nav className="bms-footer-column" aria-label={title}>
      <h2>{title}</h2>
      {links.map((link) => (
        <Link key={`${link.href}-${link.label}`} href={link.href} className="bms-footer-link">
          {link.icon}<span>{link.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export default memo(AppFooterInner);
