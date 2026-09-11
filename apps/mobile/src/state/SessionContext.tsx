import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { mockBranches, mockCashiers } from '../mocks/devices';
import type { MockBranch, MockCashier } from '../mocks/devices';

// ⚠️ ไม่ใช่ session จริง — เก็บแค่ "ใครกดเข้าใช้งานที่หน้า Login และเลือกสาขาไหน"
// เพื่อให้หน้าจออื่น (กะ/ใบเสร็จ) พูดชื่อเดียวกับที่คนเลือกไว้
//
// ก่อนหน้านี้ LoginScreen ทิ้งค่าที่เลือกทั้งคู่แล้ว `navigation.replace('Main')` เฉย ๆ
// หน้ากะจึงประกาศชื่อผู้เปิดกะจาก mock ตายตัว = เข้าใช้งานเป็นคนหนึ่งแต่กะบอกอีกชื่อหนึ่ง
//
// ตอนต่อ backend ของจริงชั้นนี้จะถูกแทนด้วย cashier session (auth ต่อคน + idle timeout)
// และ "สาขา" ต้องมาจาก device token ฝั่ง server เท่านั้น ห้ามมาจากสิ่งที่คนเลือกที่จอ
export interface MockSession {
  branch: MockBranch;
  cashier: MockCashier;
  signedInAt: string;
}

interface SessionContextValue {
  session: MockSession | null;
  signIn: (branch: MockBranch, cashier: MockCashier) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<MockSession | null>(null);

  const signIn = useCallback((branch: MockBranch, cashier: MockCashier) => {
    setSession({ branch, cashier, signedInAt: new Date().toISOString() });
  }, []);

  const signOut = useCallback(() => setSession(null), []);

  const value = useMemo(
    () => ({ session, signIn, signOut }),
    [session, signIn, signOut],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession ต้องถูกเรียกใต้ <SessionProvider>');
  return ctx;
}

/** ชื่อที่เอาไปแสดงได้เสมอ — ยังไม่ได้ล็อกอินให้ตกกลับไปที่ mock ตัวแรก */
export function sessionCashierName(session: MockSession | null): string {
  return session?.cashier.name ?? mockCashiers[0].name;
}

export function sessionBranchName(session: MockSession | null): string {
  return session?.branch.name ?? mockBranches[0].name;
}
