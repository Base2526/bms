"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeOutlined, RightOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";

export default function Breadcrumbs() {
  const pathname = usePathname() || "/";
  const { t } = useI18n();

  const items = useMemo(() => {
    const segmentsRaw = pathname
      .split("?")[0]
      .split("#")[0]
      .split("/")
      .filter(Boolean);

    const isPostDetailRoute = segmentsRaw[0] === "post" && segmentsRaw.length === 2;

    // Route-specific tweak: for post detail pages `/post/[id]`, skip the middle "Post" crumb.
    // Keep other routes intact (e.g. `/post`, `/post/new`, `/post/[id]/edit`).
    const segments =
      isPostDetailRoute
        ? segmentsRaw.slice(1)
        : segmentsRaw;

    const first = [
      {
        href: "/",
        label: t("breadcrumbs.home"),
        isLast: segments.length === 0,
      },
    ];

    const rest = segments.map((seg, idx) => {
      const href = isPostDetailRoute
        ? `/post/${seg}`
        : "/" + segments.slice(0, idx + 1).join("/");

      const label = isPostDetailRoute
        ? decodeURIComponent(seg)
        : decodeURIComponent(seg)
            .replace(/^\[|\]$/g, "")
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());

      return {
        href,
        label,
        isLast: idx === segments.length - 1,
      };
    });

    return [...first, ...rest];
  }, [pathname, t]);

  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.82)",
          border: "1px solid rgba(15,23,42,0.06)",
          boxShadow: "0 8px 20px rgba(15,23,42,0.04), inset 0 1px 0 rgba(255,255,255,0.9)",
        }}
      >
        {items.map((item, index) => {
          const isHome = index === 0;

          return (
            <React.Fragment key={`${item.href}-${index}`}>
              {index > 0 && (
                <RightOutlined
                  style={{
                    fontSize: 10,
                    color: "rgba(15,23,42,0.35)",
                  }}
                />
              )}

              {item.isLast ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    color: "#0f172a",
                    fontSize: 13,
                    fontWeight: 600,
                    lineHeight: 1,
                  }}
                >
                  {isHome && <HomeOutlined style={{ color: "#64748b" }} />}
                  <span>{item.label}</span>
                </span>
              ) : (
                <Link
                  href={item.href}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    color: "rgba(15,23,42,0.56)",
                    textDecoration: "none",
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1,
                    transition: "color .16s ease",
                  }}
                >
                  {isHome && <HomeOutlined style={{ color: "#64748b" }} />}
                  <span>{item.label}</span>
                </Link>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
}