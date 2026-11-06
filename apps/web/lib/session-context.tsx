// apps/web/lib/session-context.tsx
'use client';
import React, { createContext, useContext, useMemo } from 'react';
import { useSession } from '@/lib/useSession';

// avatar/name/username เป็น display-only identity ที่ refreshAdminIdentity() อ่านสดจาก DB;
// ไม่เชื่อค่าจาก JWT เพื่อให้การเปลี่ยนรูปหรือชื่อสะท้อนใน sidebar/header ทุก session surface
// โดยไม่ต้องออกจากระบบแล้วเข้าใหม่
type SessionValue = {
  user: { id:string | number; email:string; role:string; themePreference?: string | null; language?: string | null; avatar?: string | null; name?: string | null; username?: string | null } | null;
  admin: { id:string | number; email:string; role:string; tenant_id?: string | null; is_platform_admin?: boolean; themePreference?: string | null; language?: string | null; avatar?: string | null; name?: string | null; username?: string | null } | null;
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
