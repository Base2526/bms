// app/(main)/layout.tsx
import { cookies } from "next/headers";
import type { Metadata } from "next";
import dynamic from "next/dynamic";
import AppFooter from "@/components/footer/AppFooter";
import { BreadcrumbsProvider } from "@/components/breadcrumbs-context";
import { publicAlternates, type PublicSeoLocale } from "@/lib/publicSeo";

const HeaderBar = dynamic(() => import("@/components/HeaderBar"), {
  ssr: false,
  loading: () => <div style={{ height: 64, background: "var(--app-surface)" }} />,
});

const Breadcrumbs = dynamic(() => import("@/components/Breadcrumbs"), {
  ssr: false,
  loading: () => null,
});

const SITE_NAME = "BMS";
const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://jachoei.com";

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const lang: PublicSeoLocale = cookieStore.get("lang")?.value === "en" ? "en" : "th";

  const seo = {
    th: {
      title: "BMS — AI ช่วยขายของออนไลน์ ตอบแชทและเปิดออเดอร์อัตโนมัติ",
      desc: "รวมแชทจาก LINE, TikTok, Facebook, Instagram และ Website ไว้ที่เดียว ให้ AI ตอบลูกค้า เช็คสต็อก สร้างออเดอร์ ครบวงจรตั้งแต่แชทแรกจนของถึงมือ",
    },
    en: {
      title: "BMS — AI sales assistant for online sellers",
      desc: "Unify chats from LINE, TikTok, Facebook, Instagram and your website — let AI handle stock checks, orders, and fulfillment end to end.",
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
      <HeaderBar isMobile={false} />

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
              <Breadcrumbs />
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
