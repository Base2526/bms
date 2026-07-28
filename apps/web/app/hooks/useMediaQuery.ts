'use client';
import { useEffect, useState } from "react";

// breakpoint เดียวกับ `md` ของ antd (768px) — แคบกว่านี้ถือเป็น "มือถือ"
// ใช้ค่าเดียวทั้งระบบ ไม่งั้น header/ตาราง/sidebar จะสลับโหมดคนละจุดกัน
export const MOBILE_QUERY = "(max-width: 767.98px)";

/**
 * matchMedia แบบ SSR-safe — ค่าเริ่มต้นเป็น false เสมอแล้วค่อย sync ใน effect
 * (server ไม่มี window; ถ้าเดาค่าไว้ก่อนจะ hydration mismatch)
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY);
}

/** ความกว้าง Modal/Drawer — มือถือให้เต็มจอ, จออื่นใช้ค่าที่ออกแบบไว้ */
export function panelWidth(isMobile: boolean, desktop: number | string) {
  return isMobile ? "100%" : desktop;
}
