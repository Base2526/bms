import type { Metadata } from "next";
import { cookies } from "next/headers";
import { listPublicShops } from "@/lib/bms/products";
import ShopDirectoryView from "./ShopDirectoryView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shop directory",
  description: "Browse active public shops.",
};

export default async function PublicShopDirectoryPage() {
  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "en" ? "en" : "th";
  const shops = await listPublicShops(24);

  return <ShopDirectoryView lang={lang} shops={shops} />;
}
