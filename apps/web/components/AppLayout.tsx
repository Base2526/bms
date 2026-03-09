"use client";

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Layout, theme, Grid, Space, Typography, Divider, Tag, Tooltip, Button } from "antd";
import {
  FileTextOutlined,
  SafetyCertificateOutlined,
  CodeOutlined,
  BookOutlined,
  HeartOutlined,
  CustomerServiceOutlined,
  RocketOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SettingOutlined,
  AndroidFilled,
  AppleFilled,
  DownloadOutlined,
  MobileOutlined,
} from "@ant-design/icons";

import Breadcrumbs from "./Breadcrumbs";
import HeaderBar from "./HeaderBar";
import { useI18n } from "@/lib/i18nContext";

const { Content, Footer } = Layout;
const { useBreakpoint } = Grid;
const { Text, Title } = Typography;

/* -----------------------------------
 * constants
 * ----------------------------------- */
type ConsentValue = "allow" | "reject";
const CONSENT_KEY = "pdpa_consent_v1";

const FOOTER_LINK_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.08)",
  background: "rgba(0,0,0,0.02)",
  color: "rgba(0,0,0,0.68)",
  textDecoration: "none",
  lineHeight: 1,
  transition: "all 160ms ease",
};

const MOBILE_FOOTER_LINK_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 38,
  height: 38,
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.08)",
  background: "rgba(0,0,0,0.02)",
  color: "rgba(0,0,0,0.7)",
  textDecoration: "none",
  lineHeight: 1,
  transition: "all 160ms ease",
};

const APP_DOWNLOAD_CARD_DESKTOP: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  width: "100%",
  borderRadius: 24,
  padding: "24px 24px",
  background:
    "radial-gradient(circle at top left, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.92) 18%, rgba(249,250,251,0.96) 40%, rgba(243,244,246,0.98) 100%)",
  border: "1px solid rgba(0,0,0,0.06)",
  boxShadow: "0 14px 38px rgba(15,23,42,0.06)",
};

const APP_DOWNLOAD_CARD_MOBILE: React.CSSProperties = {
  ...APP_DOWNLOAD_CARD_DESKTOP,
  borderRadius: 20,
  padding: "18px 14px",
};

const APP_BUTTON_BASE_DESKTOP: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  gap: 14,
  minHeight: 64,
  padding: "14px 18px",
  borderRadius: 20,
  textDecoration: "none",
  color: "#fff",
  overflow: "hidden",
  transition: "all 180ms ease",
  boxShadow: "0 10px 28px rgba(16,24,40,0.12)",
  border: "1px solid rgba(255,255,255,0.14)",
  backdropFilter: "blur(10px)",
  width: 250,
};

const APP_BUTTON_BASE_MOBILE: React.CSSProperties = {
  ...APP_BUTTON_BASE_DESKTOP,
  width: "100%",
  padding: "14px 14px",
};

const ANDROID_BUTTON_BG: React.CSSProperties = {
  background: "linear-gradient(135deg, #0f172a 0%, #111827 45%, #1f2937 100%)",
};

const IOS_BUTTON_BG: React.CSSProperties = {
  background: "linear-gradient(135deg, #111111 0%, #18181b 52%, #27272a 100%)",
};

const STATIC_LINKS = [
  { href: "/roadmap", label: "Roadmap", icon: <RocketOutlined /> },
  { href: "/terms", label: "Terms", icon: <FileTextOutlined /> },
  { href: "/privacy", label: "Privacy", icon: <SafetyCertificateOutlined /> },
  { href: "/open-source", label: "Open Source", icon: <CodeOutlined /> },
  { href: "/license", label: "License", icon: <BookOutlined /> },
  { href: "/donate", label: "Donate", icon: <HeartOutlined /> },
] as const;

/* -----------------------------------
 * utilities
 * ----------------------------------- */
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
    // ignore
  }
}

function hoverIn(e: React.MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.style.background = "rgba(0,0,0,0.045)";
  e.currentTarget.style.borderColor = "rgba(0,0,0,0.14)";
}

function hoverOut(e: React.MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.style.background = "rgba(0,0,0,0.02)";
  e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)";
}

function premiumHoverIn(e: React.MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.style.transform = "translateY(-3px)";
  e.currentTarget.style.boxShadow = "0 18px 40px rgba(16,24,40,0.16)";
  e.currentTarget.style.borderColor = "rgba(255,255,255,0.24)";
  e.currentTarget.style.opacity = "0.98";
}

function premiumHoverOut(e: React.MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.style.transform = "translateY(0)";
  e.currentTarget.style.boxShadow = "0 10px 28px rgba(16,24,40,0.12)";
  e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
  e.currentTarget.style.opacity = "1";
}

/* -----------------------------------
 * memoized components
 * ----------------------------------- */
const PDPAConsentBar = memo(function PDPAConsentBar({
  isMobile,
  visible,
  onAllow,
  onReject,
  onClose,
}: {
  isMobile: boolean;
  visible: boolean;
  onAllow: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        padding: isMobile ? "10px 10px" : "14px 16px",
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "blur(12px)",
        borderTop: "1px solid rgba(0,0,0,0.06)",
      }}
      role="dialog"
      aria-label="PDPA cookie consent"
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          borderRadius: 18,
          border: "1px solid rgba(0,0,0,0.08)",
          background: "rgba(255,255,255,0.96)",
          padding: isMobile ? "12px 12px" : "14px 16px",
          boxShadow: "0 14px 40px rgba(16,24,40,0.08)",
        }}
      >
        <Space
          direction={isMobile ? "vertical" : "horizontal"}
          size={12}
          style={{
            width: "100%",
            justifyContent: "space-between",
            alignItems: isMobile ? "stretch" : "center",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Text style={{ fontWeight: 700, color: "rgba(0,0,0,0.88)" }}>PDPA / Cookies</Text>
            <div style={{ marginTop: 4 }}>
              <Text style={{ color: "rgba(0,0,0,0.58)" }}>
                เราใช้คุกกี้ที่จำเป็นเพื่อให้เว็บไซต์ทำงาน และอาจใช้คุกกี้วิเคราะห์เพื่อปรับปรุงประสบการณ์ใช้งาน
                คุณสามารถเลือก Allow หรือ Reject ได้
              </Text>
              <div style={{ marginTop: 8 }}>
                <Space size={12} wrap>
                  <Link href="/privacy" style={{ color: "rgba(0,0,0,0.65)" }}>
                    Privacy Policy
                  </Link>
                  <Link href="/terms" style={{ color: "rgba(0,0,0,0.65)" }}>
                    Terms
                  </Link>
                </Space>
              </div>
            </div>
          </div>

          <Space size={8} wrap style={{ justifyContent: "flex-end", flexShrink: 0 }}>
            <Button onClick={onReject} icon={<CloseCircleOutlined />} style={{ borderRadius: 12 }}>
              Reject
            </Button>
            <Button type="primary" onClick={onAllow} icon={<CheckCircleOutlined />} style={{ borderRadius: 12 }}>
              Allow
            </Button>
            {!isMobile && (
              <Button onClick={onClose} style={{ borderRadius: 12 }}>
                Close
              </Button>
            )}
          </Space>
        </Space>
      </div>
    </div>
  );
});

const AppDownloadSection = memo(function AppDownloadSection({ isMobile }: { isMobile: boolean }) {
  const androidHref = "/download/android";
  const iosHref = "/download/ios";

  const cardStyle = isMobile ? APP_DOWNLOAD_CARD_MOBILE : APP_DOWNLOAD_CARD_DESKTOP;
  const androidStyle = isMobile
    ? { ...APP_BUTTON_BASE_MOBILE, ...ANDROID_BUTTON_BG }
    : { ...APP_BUTTON_BASE_DESKTOP, ...ANDROID_BUTTON_BG };
  const iosStyle = isMobile
    ? { ...APP_BUTTON_BASE_MOBILE, ...IOS_BUTTON_BG }
    : { ...APP_BUTTON_BASE_DESKTOP, ...IOS_BUTTON_BG };

  return (
    <div style={cardStyle}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -80,
          right: -40,
          width: 220,
          height: 220,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(59,130,246,0.12) 0%, rgba(59,130,246,0.04) 42%, transparent 72%)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: -70,
          left: -30,
          width: 180,
          height: 180,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0.03) 42%, transparent 72%)",
          pointerEvents: "none",
        }}
      />

      <Space
        direction={isMobile ? "vertical" : "horizontal"}
        size={isMobile ? 16 : 20}
        style={{
          width: "100%",
          justifyContent: "space-between",
          alignItems: isMobile ? "stretch" : "center",
        }}
      >
        <Space align="start" size={14} style={{ flex: 1, width: "100%" }}>
          <div
            style={{
              width: isMobile ? 46 : 56,
              height: isMobile ? 46 : 56,
              borderRadius: isMobile ? 14 : 18,
              background: "linear-gradient(135deg, #111827 0%, #1f2937 100%)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 10px 24px rgba(15,23,42,0.14)",
              flexShrink: 0,
            }}
          >
            <MobileOutlined style={{ fontSize: isMobile ? 22 : 26, color: "#fff" }} />
          </div>

          <div style={{ minWidth: 0 }}>
            <Title
              level={isMobile ? 5 : 4}
              style={{
                margin: 0,
                color: "#101828",
                lineHeight: 1.15,
                letterSpacing: -0.2,
              }}
            >
              ดาวน์โหลดแอป JACHOEI
            </Title>

            <Text
              style={{
                display: "block",
                marginTop: 6,
                color: "rgba(0,0,0,0.58)",
                maxWidth: 620,
              }}
            >
              ใช้งานสะดวกกว่าเดิมบนมือถือ แจ้งเตือนเร็ว เข้าถึงฟีเจอร์สำคัญได้ง่าย และรองรับทั้ง Android กับ iPhone
            </Text>

            {!isMobile && (
              <Space size={8} wrap style={{ marginTop: 12 }}>
                <Tag
                  style={{
                    borderRadius: 999,
                    padding: "4px 10px",
                    margin: 0,
                    borderColor: "rgba(0,0,0,0.06)",
                    background: "rgba(255,255,255,0.78)",
                    color: "rgba(0,0,0,0.68)",
                  }}
                >
                  Fast Access
                </Tag>
                <Tag
                  style={{
                    borderRadius: 999,
                    padding: "4px 10px",
                    margin: 0,
                    borderColor: "rgba(0,0,0,0.06)",
                    background: "rgba(255,255,255,0.78)",
                    color: "rgba(0,0,0,0.68)",
                  }}
                >
                  Better on Mobile
                </Tag>
                <Tag
                  style={{
                    borderRadius: 999,
                    padding: "4px 10px",
                    margin: 0,
                    borderColor: "rgba(0,0,0,0.06)",
                    background: "rgba(255,255,255,0.78)",
                    color: "rgba(0,0,0,0.68)",
                  }}
                >
                  Responsive Website Support
                </Tag>
              </Space>
            )}
          </div>
        </Space>

        <Space
          direction={isMobile ? "vertical" : "horizontal"}
          size={12}
          style={{
            width: isMobile ? "100%" : "auto",
            justifyContent: "flex-end",
            alignItems: "stretch",
          }}
        >
          <Link
            href={androidHref}
            style={androidStyle}
            onMouseEnter={premiumHoverIn}
            onMouseLeave={premiumHoverOut}
            aria-label="Download Android app"
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 14,
                background: "rgba(255,255,255,0.10)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
              }}
            >
              <AndroidFilled style={{ fontSize: 22, color: "#fff" }} />
            </div>

            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
              <span style={{ fontSize: 11, opacity: 0.72, lineHeight: 1.1, letterSpacing: 0.2 }}>Get it on</span>
              <span style={{ marginTop: 3, fontSize: 16, fontWeight: 700, lineHeight: 1.1, letterSpacing: 0.2 }}>
                Android App
              </span>
            </div>

            <DownloadOutlined style={{ fontSize: 18, opacity: 0.92 }} />
          </Link>

          <Link
            href={iosHref}
            style={iosStyle}
            onMouseEnter={premiumHoverIn}
            onMouseLeave={premiumHoverOut}
            aria-label="Download iOS app"
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 14,
                background: "rgba(255,255,255,0.10)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
              }}
            >
              <AppleFilled style={{ fontSize: 22, color: "#fff" }} />
            </div>

            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
              <span style={{ fontSize: 11, opacity: 0.72, lineHeight: 1.1, letterSpacing: 0.2 }}>Download on</span>
              <span style={{ marginTop: 3, fontSize: 16, fontWeight: 700, lineHeight: 1.1, letterSpacing: 0.2 }}>
                iPhone / iOS
              </span>
            </div>

            <DownloadOutlined style={{ fontSize: 18, opacity: 0.92 }} />
          </Link>
        </Space>
      </Space>
    </div>
  );
});

const FooterArea = memo(function FooterArea({
  isMobile,
  year,
  brandTitle,
  supportLabel,
  consent,
  onOpenPdpa,
}: {
  isMobile: boolean;
  year: number;
  brandTitle: string;
  supportLabel: string;
  consent: ConsentValue | null;
  onOpenPdpa: () => void;
}) {
  const footerLinks = useMemo(
    () => [
      ...STATIC_LINKS.slice(0, 5),
      { href: "/support", label: supportLabel, icon: <CustomerServiceOutlined /> },
      STATIC_LINKS[5],
    ],
    [supportLabel]
  );

  return (
    <Footer
      style={{
        background: "#ffffff",
        padding: isMobile ? "12px 10px" : "22px 16px",
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          borderRadius: 20,
          border: "1px solid rgba(0,0,0,0.06)",
          background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)",
          padding: isMobile ? "12px 10px" : "18px 18px",
          boxShadow: "0 10px 30px rgba(15,23,42,0.04)",
        }}
      >
        <Space direction="vertical" size={16} style={{ width: "100%", alignItems: "center" }}>
          <AppDownloadSection isMobile={isMobile} />

          <Space
            wrap
            size={10}
            style={{
              width: "100%",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "rgba(0,0,0,0.55)" }}>
              <Text>
                © {year} {brandTitle}.
              </Text>
            </Text>

            <Space size={8} wrap style={{ justifyContent: "center" }}>
              <Tag
                icon={<SafetyCertificateOutlined />}
                style={{
                  borderRadius: 999,
                  padding: "2px 10px",
                  margin: 0,
                  background: "rgba(255,255,255,0.84)",
                  borderColor: "rgba(0,0,0,0.08)",
                  color: "rgba(0,0,0,0.65)",
                }}
              >
                AS IS / No Warranty
              </Tag>

              {!isMobile && (
                <Tag
                  icon={<CodeOutlined />}
                  style={{
                    borderRadius: 999,
                    padding: "2px 10px",
                    margin: 0,
                    background: "rgba(255,255,255,0.84)",
                    borderColor: "rgba(0,0,0,0.08)",
                    color: "rgba(0,0,0,0.65)",
                  }}
                >
                  Open-source components
                </Tag>
              )}
            </Space>
          </Space>

          <Divider style={{ margin: "2px 0", borderColor: "rgba(0,0,0,0.06)" }} />

          {isMobile ? (
            <Space wrap size={8} style={{ justifyContent: "center", width: "100%" }}>
              {footerLinks.map((it) => (
                <Tooltip key={it.href} title={it.label} placement="top">
                  <Link
                    href={it.href}
                    style={MOBILE_FOOTER_LINK_STYLE}
                    onMouseEnter={hoverIn}
                    onMouseLeave={hoverOut}
                    aria-label={it.label}
                  >
                    <span style={{ fontSize: 18, lineHeight: 1, display: "inline-flex" }}>{it.icon}</span>
                  </Link>
                </Tooltip>
              ))}

              <Tooltip
                title={consent ? `PDPA: ${consent.toUpperCase()} (tap to change)` : "PDPA settings"}
                placement="top"
              >
                <button
                  type="button"
                  onClick={onOpenPdpa}
                  style={{
                    ...MOBILE_FOOTER_LINK_STYLE,
                    cursor: "pointer",
                  }}
                  aria-label="PDPA settings"
                >
                  <SettingOutlined style={{ fontSize: 18 }} />
                </button>
              </Tooltip>
            </Space>
          ) : (
            <Space wrap size={10} style={{ justifyContent: "center" }}>
              {footerLinks.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  style={FOOTER_LINK_STYLE}
                  onMouseEnter={hoverIn}
                  onMouseLeave={hoverOut}
                >
                  {it.icon}
                  {it.label}
                </Link>
              ))}

              <button
                type="button"
                onClick={onOpenPdpa}
                style={{
                  ...FOOTER_LINK_STYLE,
                  cursor: "pointer",
                }}
                aria-label="PDPA settings"
              >
                <SettingOutlined />
                PDPA
                {consent ? (
                  <span style={{ marginLeft: 6, opacity: 0.75, fontSize: 12 }}>({consent.toUpperCase()})</span>
                ) : null}
              </button>
            </Space>
          )}

          {!isMobile && (
            <Text style={{ color: "rgba(0,0,0,0.45)", textAlign: "center" }}>
              Some components of this website are open-source. Software is provided “AS IS” without warranties. See Open
              Source / License for details.
            </Text>
          )}
        </Space>
      </div>
    </Footer>
  );
});

/* -----------------------------------
 * main layout
 * ----------------------------------- */
export default function AppLayout({
  children,
  initialLang,
}: {
  children: React.ReactNode;
  initialLang?: "th" | "en";
}) {
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const { t } = useI18n();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
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

  const brandTitle = useMemo(() => String(t("header.title") ?? "จ่าเฉย (JACHOEI)"), [t, initialLang]);
  const supportLabel = useMemo(() => String(t("footer.support") ?? "Support"), [t, initialLang]);

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

  const onClosePdpa = useCallback(() => {
    setShowPdpa(false);
  }, []);

  const onOpenPdpa = useCallback(() => {
    setShowPdpa(true);
  }, []);

  const layoutPaddingBottom = showPdpa ? (isMobile ? 120 : 98) : 0;

  return (
    <Layout
      style={{
        minHeight: "100vh",
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
        paddingBottom: layoutPaddingBottom,
      }}
    >
      <HeaderBar isMobile={isMobile} />

      <Content
        style={{
          margin: isMobile ? "0px auto" : "16px auto",
          width: "100%",
          maxWidth: isMobile ? "100%" : 1400,
          padding: isMobile ? "0 0px" : "0 16px",
        }}
      >
        {!isMobile && <Breadcrumbs />}

        <div
          style={{
            padding: isMobile ? 0 : 16,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
            minHeight: isMobile ? "auto" : 360,
            boxShadow: isMobile ? "0 0 4px rgba(0,0,0,0.06)" : "none",
          }}
        >
          {children}
        </div>
      </Content>

      <FooterArea
        isMobile={isMobile}
        year={year}
        brandTitle={brandTitle}
        supportLabel={supportLabel}
        consent={consent}
        onOpenPdpa={onOpenPdpa}
      />

      <PDPAConsentBar
        isMobile={isMobile}
        visible={showPdpa}
        onAllow={onAllow}
        onReject={onReject}
        onClose={onClosePdpa}
      />
    </Layout>
  );
}