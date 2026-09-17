import type { Metadata } from "next";
import { cookies } from "next/headers";
import BookingManageView from "./BookingManageView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Manage board game booking",
  robots: { index: false, follow: false },
};

export default async function BookingManagePage({ params }: { params: { token: string } }) {
  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "en" ? "en" : "th";
  return <BookingManageView token={params.token} lang={lang} />;
}
