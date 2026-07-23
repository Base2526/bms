"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeOutlined, RightOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18nContext";
import { useBreadcrumbsOverride, type BreadcrumbItem } from "./breadcrumbs-context";

const PUBLIC_PRODUCT_PATH_RE = /^\/shop\/[^/]+\/products\/[^/]+$/;

export default function Breadcrumbs() {
  const pathname = usePathname() || "/";
  const { t } = useI18n();
  const override = useBreadcrumbsOverride();

  const items = useMemo<BreadcrumbItem[] | null>(() => {
    if (override.pathname === pathname && override.items?.length) {
      return override.items.map((item, idx) => ({
        ...item,
        isLast: item.isLast ?? idx === override.items!.length - 1,
        isClickable: item.isClickable ?? Boolean(item.href),
      }));
    }

    if (PUBLIC_PRODUCT_PATH_RE.test(pathname)) return null;

    const segmentsRaw = pathname
      .split("?")[0]
      .split("#")[0]
      .split("/")
      .filter(Boolean);

    const isPostDetailRoute = segmentsRaw[0] === "post" && segmentsRaw.length === 2;

    const segments =
      isPostDetailRoute
        ? segmentsRaw.slice(1)
        : segmentsRaw;

    const first = [
      {
        href: "/",
        label: t("breadcrumbs.home"),
        isLast: segments.length === 0,
        isClickable: true,
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
        isClickable: true,
      };
    });

    return [...first, ...rest];
  }, [override.items, override.pathname, pathname, t]);

  if (!items?.length) return null;

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
          background: "rgba(var(--app-surface-rgb),0.82)",
          border: "1px solid var(--app-border)",
          boxShadow: "0 8px 20px rgba(var(--app-shadow-rgb),0.06), inset 0 1px 0 rgba(var(--app-surface-rgb),0.9)",
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
                    color: "rgba(var(--app-text-rgb),0.40)",
                  }}
                />
              )}

              {item.isLast || item.isClickable === false || !item.href ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    color: "var(--app-text)",
                    fontSize: 13,
                    fontWeight: 600,
                    lineHeight: 1,
                  }}
                >
                  {isHome && <HomeOutlined style={{ color: "var(--app-muted)" }} />}
                  <span>{item.label}</span>
                </span>
              ) : (
                <Link
                  href={item.href}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    color: "rgba(var(--app-text-rgb),0.60)",
                    textDecoration: "none",
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1,
                    transition: "color .16s ease",
                  }}
                >
                  {isHome && <HomeOutlined style={{ color: "var(--app-muted)" }} />}
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
