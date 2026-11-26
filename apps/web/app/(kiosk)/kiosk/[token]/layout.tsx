import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "จอสั่งอาหารด้วยตัวเอง",
  robots: { index: false, follow: false },
};

export default function KioskLayout({ children }: { children: ReactNode }) {
  return <main>{children}</main>;
}
