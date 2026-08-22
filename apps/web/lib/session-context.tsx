// apps/web/lib/session-context.tsx
'use client';
import React, { createContext, useContext, useMemo } from 'react';
import { useSession } from '@/lib/useSession';

// avatar/name/username เป็น optional ตั้งใจ — JWTPayload/refreshAdminIdentity() ไม่มี field
// พวกนี้จริง (เช็คแล้วที่ lib/auth/token.ts, lib/auth/adminIdentity.ts) ก่อนหน้านี้โค้ดที่ใช้
// field พวกนี้ (AdminSidebar.tsx โปรไฟล์ท้ายเมนู) เข้าถึงผ่าน useSession() ที่ type เป็น `any`
// เงียบ ๆ เลย compile ผ่านแม้ field ไม่มีจริง (runtime ได้ undefined แล้ว fallback ปกติอยู่แล้ว:
// Avatar ไม่มี src ก็โชว์ icon, ชื่อไม่มีก็ fallback ไป email) — ประกาศ optional ให้ตรงกับ
// พฤติกรรมเดิมแทนที่จะลบ field ที่ยังมีโค้ดพึ่งอยู่
type SessionValue = {
  user: { id:number; email:string; role:string; themePreference?: string | null; language?: string | null; avatar?: string | null; name?: string | null; username?: string | null } | null;
  admin: { id:number; email:string; role:string; themePreference?: string | null; language?: string | null; avatar?: string | null; name?: string | null; username?: string | null } | null;
  isAuthenticated: boolean;
  loading: boolean;
  refreshSession: () => void;
};

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { user: rawUser, admin, isAuthenticated, loading, refreshSession } = useSession();
  const user = rawUser ?? admin ?? null;
  const value = useMemo(
    () => ({ user, admin, isAuthenticated, loading, refreshSession }),
    [user, admin, isAuthenticated, loading, refreshSession]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSessionCtx() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSessionCtx must be used within <SessionProvider>');
  return v;
}
