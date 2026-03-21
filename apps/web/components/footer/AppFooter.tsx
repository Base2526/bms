"use client";

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AndroidFilled,
  AppleFilled,
  BookOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  CustomerServiceOutlined,
  DownloadOutlined,
  FacebookFilled,
  FileTextOutlined,
  HeartOutlined,
  MobileOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
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
    window.localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({
        value,
        at: new Date().toISOString(),
      })
    );
  } catch {
      // ignore
  }
}

const COPY = {
  th: {
    brand: "จ่าเฉย (JACHOEI)",
    support: "Support",
    roadmap: "Roadmap",
    terms: "Terms",
    privacy: "Privacy",
    openSource: "Open Source",
    license: "License",
    donate: "Donate",
    appTitle: "ดาวน์โหลดแอป JACHOEI",
    appDesc:
      "ใช้งานสะดวกกว่าเดิมบนมือถือ แจ้งเตือนเร็ว เข้าถึงฟีเจอร์สำคัญได้ง่าย พร้อมประสบการณ์ที่ลื่นไหลยิ่งขึ้นทั้ง Android และ iPhone",
    androidLabelTop: "Get it on",
    androidLabelBottom: "Android App",
    iosLabelTop: "Download on",
    iosLabelBottom: "iPhone / iOS",
    fastAccess: "Fast Access",
    betterMobile: "Better on Mobile",
    responsiveSupport: "Responsive Website Support",
    communityDriven: "Community-driven Reports",
    asIs: "AS IS / No Warranty",
    openSourceComponents: "Open-source components",
    footerNote:
      "Some components of this website are open-source. Software is provided “AS IS” without warranties. Please see Open Source / License for details.",
    pdpa: "PDPA",
    pdpaTitle: "PDPA / Cookies",
    pdpaDesc:
      "เราใช้คุกกี้ที่จำเป็นเพื่อให้เว็บไซต์ทำงาน และอาจใช้คุกกี้วิเคราะห์เพื่อปรับปรุงประสบการณ์การใช้งาน คุณสามารถเลือก Allow หรือ Reject ได้",
    allow: "Allow",
    reject: "Reject",
    close: "Close",
    pdpaSettings: "PDPA settings",
    trustTitle: "Trusted by community reports",
    trustDesc: "ตรวจสอบข้อมูล เตือนภัย และติดตามเคสได้สะดวกยิ่งขึ้นบนแอป",
  },
  en: {
    brand: "JACHOEI",
    support: "Support",
    roadmap: "Roadmap",
    terms: "Terms",
    privacy: "Privacy",
    openSource: "Open Source",
    license: "License",
    donate: "Donate",
    appTitle: "Download JACHOEI App",
    appDesc:
      "A smoother mobile experience with faster access to key features, alerts, and community reports on both Android and iPhone.",
    androidLabelTop: "Get it on",
    androidLabelBottom: "Android App",
    iosLabelTop: "Download on",
    iosLabelBottom: "iPhone / iOS",
    fastAccess: "Fast Access",
    betterMobile: "Better on Mobile",
    responsiveSupport: "Responsive Website Support",
    communityDriven: "Community-driven Reports",
    asIs: "AS IS / No Warranty",
    openSourceComponents: "Open-source components",
    footerNote:
      "Some components of this website are open-source. Software is provided “AS IS” without warranties. Please see Open Source / License for details.",
    pdpa: "PDPA",
    pdpaTitle: "PDPA / Cookies",
    pdpaDesc:
      "We use necessary cookies to keep the website working and may use analytics cookies to improve the experience. You can choose Allow or Reject.",
    allow: "Allow",
    reject: "Reject",
    close: "Close",
    pdpaSettings: "PDPA settings",
    trustTitle: "Trusted by community reports",
    trustDesc: "Check reports, stay alert, and access scam information more easily in the app.",
  },
} as const;

function AppFooterInner({ lang }: { lang?: Lang }) {
  const locale = lang === "en" ? "en" : "th";
  const t = COPY[locale];
  const year = useMemo(() => new Date().getFullYear(), []);

  const [consent, setConsent] = useState<ConsentValue | null>(null);
  const [showPdpa, setShowPdpa] = useState(false);

  useEffect(() => {
    const c = readConsent();
    if (c?.value) {
      setConsent(c.value);
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

  const onClose = useCallback(() => {
    setShowPdpa(false);
  }, []);

  const onOpenPdpa = useCallback(() => {
    setShowPdpa(true);
  }, []);

  const footerLinks = useMemo(
    () => [
      { href: "/roadmap", label: t.roadmap, icon: <RocketOutlined /> },
      { href: "/terms", label: t.terms, icon: <FileTextOutlined /> },
      { href: "/privacy", label: t.privacy, icon: <SafetyCertificateOutlined /> },
      { href: "/open-source", label: t.openSource, icon: <CodeOutlined /> },
      { href: "/license", label: t.license, icon: <BookOutlined /> },
      { href: "/support", label: t.support, icon: <CustomerServiceOutlined /> },
      { href: "/donate", label: t.donate, icon: <HeartOutlined /> },
    ],
    [t]
  );

  return (
    <>
      <footer className={`footer-root ${showPdpa ? "footer-root--with-pdpa" : ""}`}>
        <div className="footer-shell">
          <section className="hero-card">
            <div className="hero-glow hero-glow-right" />
            <div className="hero-glow hero-glow-left" />
            <div className="hero-noise" />

            <div className="hero-content">
              <div className="hero-left">
                <div className="hero-badge">
                  <span className="hero-badge-icon">
                    <MobileOutlined />
                  </span>
                  <span>{t.trustTitle}</span>
                </div>

                <h3 className="hero-title">{t.appTitle}</h3>
                <p className="hero-desc">{t.appDesc}</p>

                <div className="hero-meta">{t.trustDesc}</div>

                <div className="feature-tags">
                  <span>{t.fastAccess}</span>
                  <span>{t.betterMobile}</span>
                  <span>{t.responsiveSupport}</span>
                  <span>{t.communityDriven}</span>
                </div>
              </div>

              <div className="hero-right">
                <Link href="https://play.google.com/store/apps/details?id=com.jachoei" className="store-btn store-btn--android" target="_blank" aria-label="Download Android app">
                  <span className="store-btn__icon">
                    <AndroidFilled />
                  </span>
                  <span className="store-btn__text">
                    <small>{t.androidLabelTop}</small>
                    <strong>{t.androidLabelBottom}</strong>
                  </span>
                  <DownloadOutlined className="store-btn__download" />
                </Link>

                <Link href="/download/ios" className="store-btn store-btn--ios" aria-label="Download iOS app">
                  <span className="store-btn__icon">
                    <AppleFilled />
                  </span>
                  <span className="store-btn__text">
                    <small>{t.iosLabelTop}</small>
                    <strong>{t.iosLabelBottom}</strong>
                  </span>
                  <DownloadOutlined className="store-btn__download" />
                </Link>
              </div>
            </div>
          </section>

          <div className="footer-main">
            <div className="footer-brand-block">
              <div className="brand-line">
                <span className="brand-mark">J</span>
                <div className="brand-copy">
                  <div className="brand-name">{t.brand}</div>
                  <div className="brand-sub">© {year} · Community scam intelligence</div>
                </div>
              </div>
            </div>

            <div className="footer-badges">
              <span className="pill">
                <SafetyCertificateOutlined />
                {t.asIs}
              </span>
              <span className="pill desktop-only">
                <CodeOutlined />
                {t.openSourceComponents}
              </span>
            </div>
          </div>

          <div className="footer-divider" />

          <nav className="footer-links" aria-label="Footer navigation">
            {footerLinks.map((it) => (
              <Link key={it.href} href={it.href} className="footer-link" aria-label={it.label}>
                <span className="footer-link__icon">{it.icon}</span>
                <span className="footer-link__label">{it.label}</span>
              </Link>
            ))}

            {/* NEW: Facebook link */}
            <a
              href="https://www.facebook.com/jachoei"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link footer-link--external"
              aria-label="Facebook"
              title="Follow us on Facebook"
            >
              <span className="footer-link__icon">
                <FacebookFilled />
              </span>
              <span className="footer-link__label">Facebook</span>
            </a>

            <button
              type="button"
              className="footer-link footer-link--button"
              onClick={onOpenPdpa}
              aria-label={t.pdpaSettings}
            >
              <span className="footer-link__icon">
                <SettingOutlined />
              </span>
              <span className="footer-link__label">{t.pdpa}</span>
              {consent ? <em>({consent.toUpperCase()})</em> : null}
            </button>
          </nav>

          <div className="footer-note desktop-only">{t.footerNote}</div>
        </div>
      </footer>

      {showPdpa && (
        <div className="pdpa-bar" role="dialog" aria-label="PDPA cookie consent">
          <div className="pdpa-card">
            <div className="pdpa-copy">
              <div className="pdpa-title">{t.pdpaTitle}</div>
              <div className="pdpa-desc">{t.pdpaDesc}</div>

              <div className="pdpa-links">
                <Link href="/privacy" className="pdpa-inline-link">
                  {t.privacy}
                </Link>
                <Link href="/terms" className="pdpa-inline-link">
                  {t.terms}
                </Link>
              </div>
            </div>

            <div className="pdpa-actions">
              <button type="button" className="btn btn-secondary" onClick={onReject}>
                <CloseCircleOutlined />
                <span>{t.reject}</span>
              </button>

              <button type="button" className="btn btn-primary" onClick={onAllow}>
                <CheckCircleOutlined />
                <span>{t.allow}</span>
              </button>

              <button type="button" className="btn btn-secondary desktop-only-inline" onClick={onClose}>
                <span>{t.close}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .footer-root {
          background:
            radial-gradient(circle at top, rgba(37,99,235,0.035), transparent 30%),
            #ffffff;
          padding: 28px 16px;
        }

        .footer-root--with-pdpa {
          padding-bottom: 110px;
        }

        .footer-shell {
          max-width: 1400px;
          margin: 0 auto;
          border-radius: 28px;
          border: 1px solid rgba(15, 23, 42, 0.06);
          background:
            linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(248,250,252,0.985) 100%);
          padding: 20px;
          box-shadow:
            0 16px 50px rgba(15,23,42,0.05),
            inset 0 1px 0 rgba(255,255,255,0.9);
        }

        .hero-card {
          position: relative;
          overflow: hidden;
          width: 100%;
          border-radius: 26px;
          padding: 28px;
          background:
            linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(246,248,252,0.98) 56%, rgba(241,245,249,0.98) 100%);
          border: 1px solid rgba(15,23,42,0.06);
          box-shadow:
            0 18px 48px rgba(15,23,42,0.06),
            inset 0 1px 0 rgba(255,255,255,0.95);
        }

        .hero-glow {
          position: absolute;
          border-radius: 999px;
          pointer-events: none;
          filter: blur(2px);
        }

        .hero-glow-right {
          top: -90px;
          right: -30px;
          width: 240px;
          height: 240px;
          background: radial-gradient(circle, rgba(59,130,246,0.16) 0%, rgba(59,130,246,0.05) 42%, transparent 74%);
        }

        .hero-glow-left {
          bottom: -80px;
          left: -20px;
          width: 210px;
          height: 210px;
          background: radial-gradient(circle, rgba(16,185,129,0.14) 0%, rgba(16,185,129,0.04) 42%, transparent 72%);
        }

        .hero-noise {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
          background-size: 24px 24px;
          mask-image: linear-gradient(to bottom, rgba(0,0,0,0.14), transparent 70%);
          pointer-events: none;
          opacity: 0.22;
        }

        .hero-content {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
        }

        .hero-left {
          flex: 1;
          min-width: 0;
        }

        .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          border-radius: 999px;
          background: rgba(255,255,255,0.76);
          border: 1px solid rgba(15,23,42,0.08);
          color: rgba(15,23,42,0.72);
          font-size: 13px;
          font-weight: 600;
          box-shadow: 0 8px 18px rgba(15,23,42,0.05);
        }

        .hero-badge-icon {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #111827 0%, #334155 100%);
          color: #ffffff;
          font-size: 14px;
        }

        .hero-title {
          margin: 16px 0 0;
          color: #0f172a;
          line-height: 1.08;
          letter-spacing: -0.6px;
          font-size: 34px;
          font-weight: 800;
        }

        .hero-desc {
          margin: 12px 0 0;
          color: rgba(15,23,42,0.68);
          max-width: 700px;
          line-height: 1.68;
          font-size: 15px;
        }

        .hero-meta {
          margin-top: 10px;
          color: rgba(15,23,42,0.5);
          font-size: 13px;
          line-height: 1.6;
        }

        .feature-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 18px;
        }

        .feature-tags span {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 7px 12px;
          border: 1px solid rgba(15,23,42,0.07);
          background: rgba(255,255,255,0.78);
          color: rgba(15,23,42,0.72);
          font-size: 13px;
          font-weight: 500;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
        }

        .hero-right {
          display: flex;
          flex-direction: column;
          gap: 12px;
          flex-shrink: 0;
        }

        .store-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 14px;
          min-height: 68px;
          width: 270px;
          padding: 15px 18px;
          border-radius: 22px;
          text-decoration: none;
          color: #ffffff;
          overflow: hidden;
          transition:
            transform 180ms ease,
            box-shadow 180ms ease,
            opacity 180ms ease,
            border-color 180ms ease;
          box-shadow:
            0 12px 32px rgba(16,24,40,0.14),
            inset 0 1px 0 rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.14);
          backdrop-filter: blur(10px);
        }

        .store-btn::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.10) 32%, transparent 60%);
          transform: translateX(-120%);
          transition: transform 500ms ease;
          pointer-events: none;
        }

        .store-btn:hover {
          transform: translateY(-3px);
          box-shadow:
            0 20px 42px rgba(16,24,40,0.18),
            inset 0 1px 0 rgba(255,255,255,0.12);
          opacity: 0.99;
        }

        .store-btn:hover::after {
          transform: translateX(120%);
        }

        .store-btn--android {
          background: linear-gradient(135deg, #0f172a 0%, #111827 46%, #1e293b 100%);
        }

        .store-btn--ios {
          background: linear-gradient(135deg, #101010 0%, #18181b 55%, #27272a 100%);
        }

        .store-btn__icon {
          width: 42px;
          height: 42px;
          border-radius: 15px;
          background: rgba(255,255,255,0.10);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
          font-size: 22px;
        }

        .store-btn__text {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          flex: 1;
          line-height: 1.12;
        }

        .store-btn__text small {
          font-size: 11px;
          opacity: 0.72;
          letter-spacing: 0.2px;
        }

        .store-btn__text strong {
          margin-top: 4px;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.2px;
        }

        .store-btn__download {
          font-size: 18px;
          opacity: 0.92;
        }

        .footer-main {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          width: 100%;
          margin-top: 18px;
        }

        .footer-brand-block {
          min-width: 0;
        }

        .brand-line {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .brand-mark {
          width: 42px;
          height: 42px;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #111827 0%, #334155 100%);
          color: #ffffff;
          font-weight: 800;
          font-size: 18px;
          box-shadow: 0 10px 24px rgba(15,23,42,0.14);
          flex-shrink: 0;
        }

        .brand-copy {
          min-width: 0;
        }

        .brand-name {
          color: rgba(15,23,42,0.88);
          font-size: 15px;
          font-weight: 700;
          line-height: 1.2;
        }

        .brand-sub {
          margin-top: 4px;
          color: rgba(15,23,42,0.5);
          font-size: 13px;
          line-height: 1.4;
        }

        .footer-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          padding: 6px 12px;
          background: rgba(255,255,255,0.92);
          border: 1px solid rgba(15,23,42,0.08);
          color: rgba(15,23,42,0.68);
          font-size: 13px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
        }

        .footer-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent 0%, rgba(15,23,42,0.08) 20%, rgba(15,23,42,0.08) 80%, transparent 100%);
          margin: 16px 0 14px;
        }

        .footer-links {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10px;
        }

        .footer-link {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(15,23,42,0.08);
          background: rgba(255,255,255,0.72);
          color: rgba(15,23,42,0.74);
          text-decoration: none;
          line-height: 1;
          transition:
            background 160ms ease,
            border-color 160ms ease,
            transform 160ms ease,
            box-shadow 160ms ease;
          font-size: 14px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.86);
        }

        .footer-link:hover {
          background: rgba(255,255,255,0.98);
          border-color: rgba(15,23,42,0.14);
          transform: translateY(-1px);
          box-shadow: 0 8px 18px rgba(15,23,42,0.06);
        }

        .footer-link--external:hover {
          color: #1677ff;
        }

        .footer-link--button {
          cursor: pointer;
          font: inherit;
        }

        .footer-link__icon,
        .footer-link__label {
          display: inline-flex;
          align-items: center;
        }

        .footer-link--button em {
          margin-left: 6px;
          opacity: 0.75;
          font-size: 12px;
          font-style: normal;
        }

        .footer-note {
          margin-top: 16px;
          color: rgba(15,23,42,0.45);
          text-align: center;
          font-size: 13px;
          line-height: 1.7;
        }

        .pdpa-bar {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 9999;
          padding: 14px 16px;
          background: rgba(255,255,255,0.72);
          backdrop-filter: blur(14px);
          border-top: 1px solid rgba(15,23,42,0.06);
        }

        .pdpa-card {
          max-width: 1400px;
          margin: 0 auto;
          border-radius: 20px;
          border: 1px solid rgba(15,23,42,0.08);
          background: rgba(255,255,255,0.96);
          padding: 15px 16px;
          box-shadow:
            0 18px 44px rgba(16,24,40,0.10),
            inset 0 1px 0 rgba(255,255,255,0.9);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }

        .pdpa-copy {
          min-width: 0;
          flex: 1;
        }

        .pdpa-title {
          font-weight: 700;
          color: rgba(15,23,42,0.9);
          font-size: 15px;
        }

        .pdpa-desc {
          margin-top: 4px;
          color: rgba(15,23,42,0.58);
          line-height: 1.6;
          font-size: 14px;
        }

        .pdpa-links {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 8px;
        }

        .pdpa-inline-link {
          color: rgba(15,23,42,0.7);
          text-decoration: none;
          font-weight: 500;
        }

        .pdpa-inline-link:hover {
          color: rgba(15,23,42,0.95);
        }

        .pdpa-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-shrink: 0;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 12px;
          padding: 10px 14px;
          cursor: pointer;
          font: inherit;
          border: 1px solid rgba(15,23,42,0.08);
          transition:
            background 160ms ease,
            border-color 160ms ease,
            opacity 160ms ease,
            transform 160ms ease;
        }

        .btn:hover {
          transform: translateY(-1px);
        }

        .btn-secondary {
          background: #ffffff;
          color: rgba(15,23,42,0.82);
        }

        .btn-secondary:hover {
          background: rgba(15,23,42,0.03);
        }

        .btn-primary {
          background: linear-gradient(135deg, #1677ff 0%, #2563eb 100%);
          border-color: #1677ff;
          color: #ffffff;
          box-shadow: 0 10px 22px rgba(37,99,235,0.20);
        }

        .btn-primary:hover {
          opacity: 0.96;
        }

        .desktop-only-inline,
        .desktop-only {
          display: inline-flex;
        }

        @media (max-width: 991px) {
          .hero-content {
            flex-direction: column;
            align-items: stretch;
          }

          .hero-right {
            width: 100%;
          }

          .store-btn {
            width: 100%;
          }

          .footer-main {
            flex-direction: column;
            align-items: flex-start;
          }
        }

        @media (max-width: 767px) {
          .footer-root {
            padding: 12px 10px;
          }

          .footer-root--with-pdpa {
            padding-bottom: 128px;
          }

          .footer-shell {
            padding: 12px;
            border-radius: 22px;
          }

          .hero-card {
            border-radius: 22px;
            padding: 18px 14px;
          }

          .hero-badge {
            padding: 7px 11px;
            font-size: 12px;
          }

          .hero-title {
            margin-top: 14px;
            font-size: 24px;
            line-height: 1.14;
          }

          .hero-desc {
            font-size: 14px;
          }

          .hero-meta {
            font-size: 12px;
          }

          .feature-tags {
            display: none;
          }

          .hero-right {
            gap: 10px;
          }

          .store-btn {
            min-height: 62px;
            padding: 14px;
            border-radius: 18px;
          }

          .store-btn__text strong {
            font-size: 15px;
          }

          .brand-mark {
            width: 38px;
            height: 38px;
            border-radius: 12px;
            font-size: 16px;
          }

          .brand-name {
            font-size: 14px;
          }

          .brand-sub {
            font-size: 12px;
          }

          .footer-links {
            gap: 8px;
          }

          .footer-link {
            justify-content: center;
            padding: 8px 10px;
          }

          .footer-link__label {
            display: none;
          }

          .footer-link--button em {
            display: none;
          }

          .desktop-only,
          .desktop-only-inline {
            display: none;
          }

          .pdpa-bar {
            padding: 10px;
          }

          .pdpa-card {
            flex-direction: column;
            align-items: stretch;
            padding: 12px;
            border-radius: 18px;
          }

          .pdpa-actions {
            justify-content: flex-end;
          }
        }
      `}</style>
    </>
  );
}

export default memo(AppFooterInner);