"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PosCashier } from "@/lib/pos/mobileFlowGraphql";

/**
 * The paired device and the human using it have different lifetimes.
 *
 * Keep the verified human credentials only in this in-memory provider so navigating between
 * /pos/app and /pos/restaurant does not ask for the same PIN twice. Never persist this value:
 * a refresh, app restart, lock, or unpair must require the human to identify themselves again.
 * Every mutation still sends the PIN to the server, where permission and shift checks remain
 * authoritative.
 */
export type PosVerifiedOperator = {
  cashier: PosCashier;
  pin: string;
};

type PosOperatorSessionValue = {
  operator: PosVerifiedOperator | null;
  rememberOperator: (cashier: PosCashier, pin: string) => void;
  clearOperator: () => void;
};

const PosOperatorSessionContext = createContext<PosOperatorSessionValue | null>(null);

export function PosOperatorSessionProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<PosVerifiedOperator | null>(null);
  const rememberOperator = useCallback((cashier: PosCashier, pin: string) => {
    setOperator({ cashier, pin });
  }, []);
  const clearOperator = useCallback(() => setOperator(null), []);
  const value = useMemo(
    () => ({ operator, rememberOperator, clearOperator }),
    [operator, rememberOperator, clearOperator],
  );

  return (
    <PosOperatorSessionContext.Provider value={value}>
      {children}
    </PosOperatorSessionContext.Provider>
  );
}

export function usePosOperatorSession(): PosOperatorSessionValue {
  const value = useContext(PosOperatorSessionContext);
  if (!value) throw new Error("usePosOperatorSession must be used inside PosOperatorSessionProvider");
  return value;
}
