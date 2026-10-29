import type { Metadata } from "next";
import { cookies } from "next/headers";

import BmsFlowDiagram from "@/components/marketing/flow/BmsFlowDiagram";
import { resolveBilingual } from "@/lib/static-page-i18n";
import styles from "./page.module.css";
import { publicAlternates, localizedPublicPath, type PublicSeoLocale } from "@/lib/publicSeo";

const content = {
  th: {
    title: "BMS ทำงานอย่างไร",
    description: "ดูเส้นทางตั้งแต่ลูกค้าทักแชทหรือสั่งที่หน้าร้าน ไปจนถึงบิล สต็อก การชำระเงิน ครัว จัดส่ง และรายงานในระบบเดียว",
  },
  en: {
    title: "How BMS works",
    description: "Follow the verified workflow from customer chat or in-store ordering through sales, stock, payment, kitchen, shipping, and reporting in one system.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const lang: PublicSeoLocale = cookieStore.get("lang")?.value === "en" ? "en" : "th";
  const page = resolveBilingual(content, lang);
  return {
    title: page.title,
    description: page.description,
    alternates: publicAlternates("/how-it-works", lang),
    openGraph: { title: page.title, description: page.description, url: localizedPublicPath("/how-it-works", lang), type: "website", images: [{ url: "/og.png", width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: page.title, description: page.description, images: ["/og.png"] },
  };
}
// The page title and description stay in <head> for search and the tab; the
// visible heading is the diagram's own (rendered as this page's h1), so the
// reader is not met by two stacked titles saying the same thing.
export default function HowItWorksPage() {
  return (
    <div className={styles.page}>
      <BmsFlowDiagram variant="full" />
    </div>
  );
}
