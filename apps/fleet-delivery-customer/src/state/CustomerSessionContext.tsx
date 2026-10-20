import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CustomerActivation } from '@bms/fleet-delivery-customer-core';
import {
  clearCustomerSession,
  loadCustomerSession,
  saveCustomerSession,
} from '../storage/secureStore';

type CustomerSessionState =
  | { kind: 'LOADING' }
  | { kind: 'LOCKED' }
  | { kind: 'EMPTY' }
  | { kind: 'EXPIRED' }
  | { kind: 'ACTIVE'; session: CustomerActivation }
  | { kind: 'UNAVAILABLE'; error: string };

type CustomerSessionValue = {
  state: CustomerSessionState;
  activate(input: CustomerActivation): Promise<void>;
  clear(): Promise<void>;
  reload(): Promise<void>;
};

const CustomerSessionContext = createContext<CustomerSessionValue | null>(null);

export function permitsSyntheticCustomerSession(isDevelopmentBuild: boolean): boolean {
  return isDevelopmentBuild;
}

export function CustomerSessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CustomerSessionState>({ kind: 'LOADING' });

  const reload = useCallback(async () => {
    setState({ kind: 'LOADING' });
    if (!permitsSyntheticCustomerSession(__DEV__)) {
      setState({ kind: 'LOCKED' });
      return;
    }
    const loaded = await loadCustomerSession();
    if (loaded.status === 'ACTIVE') setState({ kind: 'ACTIVE', session: loaded.session });
    else if (loaded.status === 'UNAVAILABLE') setState({ kind: 'UNAVAILABLE', error: loaded.error });
    else setState({ kind: loaded.status });
  }, []);

  useEffect(() => {
    reload().catch(error => setState({
      kind: 'UNAVAILABLE',
      error: error instanceof Error ? error.message : String(error),
    }));
  }, [reload]);

  const activate = useCallback(async (input: CustomerActivation) => {
    if (!permitsSyntheticCustomerSession(__DEV__)) throw new Error('DEBUG_ACTIVATION_DISABLED');
    await saveCustomerSession(input);
    setState({ kind: 'ACTIVE', session: input });
  }, []);

  const clear = useCallback(async () => {
    await clearCustomerSession();
    setState({ kind: 'EMPTY' });
  }, []);

  const value = useMemo<CustomerSessionValue>(() => ({ state, activate, clear, reload }), [state, activate, clear, reload]);
  return <CustomerSessionContext.Provider value={value}>{children}</CustomerSessionContext.Provider>;
}

export function useCustomerSession(): CustomerSessionValue {
  const value = useContext(CustomerSessionContext);
  if (!value) throw new Error('useCustomerSession must be used inside CustomerSessionProvider');
  return value;
}
