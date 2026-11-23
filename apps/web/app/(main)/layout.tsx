// app/(main)/layout.tsx
import { cookies } from "next/headers";
import type { Metadata } from "next";
import AppFooter from "@/components/footer/AppFooter";
import { BreadcrumbsProvider } from "@/components/breadcrumbs-context";
import { PublicHeaderBar, PublicBreadcrumbs } from "@/components/PublicChrome";
import { publicAlternates, type PublicSeoLocale } from "@/lib/publicSeo";

const SITE_NAME = "BMS POS+";
const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://jachoei.com";

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const lang: PublicSeoLocale = cookieStore.get("lang")?.value === "en" ? "en" : "th";

  const seo = {
    th: {
      title: "BMS POS+ — ขายหน้าร้านและบริหารธุรกิจด้วย AI",
      desc: "ระบบขายหน้าร้านที่เชื่อมสต็อก ลูกค้า ออร์เดอร์ การชำระเงิน รายงาน และงานขายผ่านแชท โดยข้อมูลธุรกิจยึดบริการและฐานข้อมูลของระบบ",
    },
    en: {
      title: "BMS POS+ — Point of sale and business operations with AI",
      desc: "Point of sale connected to inventory, customers, orders, payments, reporting and customer chat, with backend services and the database as the source of truth.",
    },
  }[lang];

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: seo.title,
      template: `%s | ${SITE_NAME}`,
    },
    description: seo.desc,
    alternates: publicAlternates("/", lang),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: seo.title,
      description: seo.desc,
      url: `/${lang}`,
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: seo.title,
      description: seo.desc,
      images: ["/og.png"],
    },
    robots: { index: true, follow: true },
  };
}

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "en" ? "en" : "th";

  return (
    <>
      <PublicHeaderBar isMobile={false} />

      <main
        className="bms-main-layout"
        style={{
          minHeight: "100vh",
          background: "var(--app-bg)",
        }}
      >
        <BreadcrumbsProvider>
          <div className="jachoei-main-shell">
            <div className="jachoei-breadcrumb-wrap">
              <PublicBreadcrumbs />
            </div>

            <div className="jachoei-main-content">{children}</div>
          </div>
        </BreadcrumbsProvider>
      </main>

      <AppFooter lang={lang} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .jachoei-main-shell {
              width: 100%;
              max-width: 1400px;
              margin: 16px auto 0;
              padding: 0 16px;
            }

            .jachoei-breadcrumb-wrap {
              display: block;
              margin-bottom: 12px;
            }

            .jachoei-main-content {
              min-height: 360px;
              background: var(--app-surface);
              border: 1px solid var(--app-border);
              border-radius: 16px;
              padding: 16px;
            }

            .bms-main-layout:has([data-bms-not-found]) {
              display: flex;
              flex-direction: column;
              min-height: calc(100svh - 72px) !important;
            }

            .bms-main-layout:has([data-bms-not-found]) .jachoei-main-shell {
              display: flex;
              flex: 1;
              flex-direction: column;
              max-width: none;
              margin: 0;
              padding: 0;
            }

            .bms-main-layout:has([data-bms-not-found]) .jachoei-breadcrumb-wrap {
              margin: 0;
              padding: 16px max(24px, 5vw) 12px;
            }

            .bms-main-layout:has([data-bms-not-found]) .jachoei-main-content {
              display: flex;
              flex: 1;
              flex-direction: column;
              min-height: 0;
              border: 0;
              border-radius: 0;
              padding: 0;
              box-shadow: none;
            }

            .bms-main-layout:has([data-bms-not-found]) + .bms-footer {
              display: none;
            }

            @media (max-width: 767px) {
              .bms-main-layout:has([data-bms-not-found]) {
                min-height: calc(100svh - 58px) !important;
              }
              .jachoei-main-shell {
                max-width: 100%;
                margin: 0 auto;
                padding: 0;
              }

              .jachoei-breadcrumb-wrap {
                display: none;
              }

              .jachoei-main-content {
                min-height: auto;
                border-radius: 0;
                padding: 0;
                box-shadow: 0 0 4px rgba(var(--app-shadow-rgb),0.12);
              }
            }
          `,
        }}
      />
    </>
  );
}
