import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "สั่งอาหารที่โต๊ะ",
  robots: { index: false, follow: false },
};

export default function RestaurantQrLayout({ children }: { children: ReactNode }) {
  return <main style={{ minHeight: "100vh" }}>{children}</main>;
}
