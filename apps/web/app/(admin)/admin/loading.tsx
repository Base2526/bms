import { cookies } from "next/headers";
import { getMessage, type Lang } from "@/i18n";

// Server-rendered route fallback: it paints before the client bundle and Ant styles, so it uses
// plain inline CSS and reads the same `lang` cookie as the root layout.
export default async function AdminLoading() {
  const lang: Lang = (await cookies()).get("lang")?.value === "en" ? "en" : "th";
  return (
    <div
      role="status"
      aria-label={getMessage(lang, "common.loading_app_label")}
      style={{ minHeight: "100vh", width: "100%", display: "grid", placeItems: "center", color: "#4b5563", fontFamily: "sans-serif" }}
    >{getMessage(lang, "common.loading_app")}</div>
  );
}
