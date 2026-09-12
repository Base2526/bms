import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useDevice } from './DeviceContext';

export interface PosSessionBranch {
  id: string;
  name: string;
  code: string;
}

export interface PosSessionCashier {
  id: string;
  name: string;
  role: string;
}

// PIN อยู่ใน React memory เฉพาะช่วงที่ cashier login และไม่ลง Keychain/AsyncStorage/log
// เพราะ backend ต้องตรวจ credentials ซ้ำในทุกคำสั่งขาย เงิน สต็อก และครัว
export interface PosSession {
  branch: PosSessionBranch;
  cashier: PosSessionCashier;
  credentials: { cashierUserId: string; pin: string };
  signedInAt: string;
}

interface SessionContextValue {
  session: PosSession | null;
  signIn: (
    branch: PosSessionBranch,
    cashier: PosSessionCashier,
    pin: string,
  ) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { status, target } = useDevice();
  const [session, setSession] = useState<PosSession | null>(null);
  const pairingKey = target ? `${target.serverUrl}:${target.token}` : null;
  const previousPairingKey = useRef(pairingKey);

  useEffect(() => {
    if (
      status !== 'PAIRED' ||
      previousPairingKey.current !== pairingKey
    ) {
      setSession(null);
    }
    previousPairingKey.current = pairingKey;
  }, [pairingKey, status]);

  const signIn = useCallback(
    (branch: PosSessionBranch, cashier: PosSessionCashier, pin: string) => {
      setSession({
        branch,
        cashier,
        credentials: { cashierUserId: cashier.id, pin },
        signedInAt: new Date().toISOString(),
      });
    },
    [],
  );

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

export function sessionCashierName(session: PosSession | null): string {
  return session?.cashier.name ?? 'ยังไม่ได้เข้าใช้งาน';
}

export function sessionBranchName(session: PosSession | null): string {
  return session?.branch.name ?? 'ยังไม่ทราบสาขา';
}
