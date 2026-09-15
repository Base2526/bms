import type { Metadata } from "next";
import { cookies } from "next/headers";
import { listPublicBoardGameCafes } from "@/lib/bms/boardGameCafe";
import BoardGameDirectoryView from "./BoardGameDirectoryView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Board game cafes near me",
  description: "Find published board game cafes, play rates, game highlights and aggregate table availability.",
};

export default async function BoardGameDirectoryPage() {
  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "en" ? "en" : "th";
  const cafes = await listPublicBoardGameCafes({ limit: 60 });
  return <BoardGameDirectoryView initialCafes={cafes} lang={lang} />;
}
