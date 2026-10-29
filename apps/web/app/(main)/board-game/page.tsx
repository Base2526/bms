import type { Metadata } from "next";
import { cookies } from "next/headers";
import { listPublicBoardGameCafes } from "@/lib/bms/boardGameCafe";
import BoardGameDirectoryView from "./BoardGameDirectoryView";
import { localizedPublicPath, publicAlternates, type PublicSeoLocale } from "@/lib/publicSeo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const lang: PublicSeoLocale = cookies().get("lang")?.value === "en" ? "en" : "th";
  const title = lang === "th" ? "ค้นหาร้านบอร์ดเกมคาเฟ่" : "Find board game cafes";
  const description = lang === "th"
    ? "ค้นหาร้านบอร์ดเกมคาเฟ่ที่เผยแพร่ พร้อมราคาเล่น เกมเด่น และภาพรวมสถานะโต๊ะ"
    : "Find published board game cafes, play rates, game highlights and aggregate table availability.";
  return {
    title,
    description,
    alternates: publicAlternates("/board-game", lang),
    openGraph: { title, description, url: localizedPublicPath("/board-game", lang), type: "website", images: [{ url: "/og.png", width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export default async function BoardGameDirectoryPage() {
  const cookieStore = await cookies();
  const lang: PublicSeoLocale = cookieStore.get("lang")?.value === "en" ? "en" : "th";
  const cafes = await listPublicBoardGameCafes({ limit: 60 });
  return <BoardGameDirectoryView initialCafes={cafes} lang={lang} />;
}
