'use client';

// Reachable without an admin session — a pos_only cashier account is blocked
// from every /admin/** page at the login level (see the manual's own "Access"
// section), so the copy at /admin/pos-manual would otherwise be permanently
// unreachable from a register locked to that role. This route lives under the
// same (pos) group as /pos and /pos/display for the same reason they do: no
// admin login, no admin layout, just the counter screen's own auth model
// (device token + PIN, checked per-action by the POS API routes this page
// never calls — reading a manual needs neither).
//
// Content/rendering is shared with /admin/pos-manual via
// lib/pos/posManualContent.tsx, so the two copies can never drift apart.
import { LeftOutlined, ReadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useI18n } from "@/lib/i18nContext";
import { PosManualBody } from "@/lib/pos/posManualContent";

export default function PosManualStandalonePage() {
  const { lang } = useI18n();
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "16px 16px 48px" }}>
      <Link
        href="/pos"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 12,
          fontSize: 14,
          color: "inherit",
          textDecoration: "none",
        }}
      >
        <LeftOutlined /> {lang === "th" ? "กลับไปหน้าขาย" : "Back to Sell"}
      </Link>
      <PosManualBody lang={lang === "th" ? "th" : "en"} heroIcon={<ReadOutlined />} />
    </div>
  );
}
