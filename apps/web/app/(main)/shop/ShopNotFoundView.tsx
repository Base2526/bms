import { cookies } from "next/headers";
import { localizedPublicPath } from "@/lib/publicSeo";
import BrandedNotFound from "@/components/not-found/BrandedNotFound";
import MissingShopBreadcrumb from "./MissingShopBreadcrumb";

export type ShopNotFoundKind = "generic" | "shop" | "product" | "cart";

export default async function ShopNotFoundView({ kind }: { kind: ShopNotFoundKind }) {
  const lang = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
  const copy = {
    generic: lang === "en"
      ? { title: "We couldn't find this Shop page", description: "This shop or product link is unavailable. Browse the shops that are open now." }
      : { title: "ไม่พบหน้านี้ใน Shop", description: "ลิงก์หน้าร้านหรือสินค้าไม่พร้อมให้เข้าชม ลองเลือกร้านที่เปิดอยู่ตอนนี้" },
    shop: lang === "en"
      ? { title: "We couldn't find this shop", description: "This shop is unavailable at this link. Check the address or browse the shops that are open now." }
      : { title: "ไม่พบร้านนี้", description: "ร้านที่ลิงก์นี้ไม่พร้อมให้เข้าชม ลองตรวจสอบที่อยู่หรือเลือกร้านที่เปิดอยู่ตอนนี้" },
    product: lang === "en"
      ? { title: "We couldn't find this product", description: "This product is unavailable at this link. Browse the public shops to find what is available now." }
      : { title: "ไม่พบสินค้านี้", description: "สินค้าที่ลิงก์นี้ไม่พร้อมให้เข้าชม ลองเลือกร้านเพื่อดูสินค้าที่เปิดขายอยู่" },
    cart: lang === "en"
      ? { title: "This cart is unavailable", description: "The cart at this link may not be available for this shop. Browse the shops to continue." }
      : { title: "ตะกร้านี้ไม่พร้อมใช้งาน", description: "ตะกร้าที่ลิงก์นี้อาจยังไม่เปิดให้ใช้งาน ลองกลับไปเลือกร้านก่อน" },
  }[kind];

  return (
    <>
      <MissingShopBreadcrumb lang={lang} />
      <BrandedNotFound
        id="shop-not-found-title"
        eyebrow="SHOP · 404"
        title={copy.title}
        description={copy.description}
        kind="store"
        primary={{ href: "/shop", label: lang === "en" ? "Browse shops" : "ดูร้านค้าทั้งหมด" }}
        secondary={{ href: localizedPublicPath("/", lang), label: lang === "en" ? "Back to home" : "กลับหน้าหลัก" }}
      />
    </>
  );
}
