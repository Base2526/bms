import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  clearDriverSession,
  driverSessionSchema,
  loadDriverSession,
  saveDriverSession,
  type DriverSession,
} from '../storage/secureStore';

type DriverSessionState =
  | { kind: 'LOADING' }
  | { kind: 'EMPTY' }
  | { kind: 'ACTIVE'; session: DriverSession }
  | { kind: 'UNAVAILABLE'; error: string };

type DriverSessionValue = {
  state: DriverSessionState;
  activate(input: DriverSession): Promise<void>;
  signOut(): Promise<void>;
  reload(): Promise<void>;
};

const DriverSessionContext = createContext<DriverSessionValue | null>(null);

export function permitsSyntheticDriverSession(isDevelopmentBuild: boolean): boolean {
  return isDevelopmentBuild;
}

export function DriverSessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DriverSessionState>({ kind: 'LOADING' });

  const reload = useCallback(async () => {
    setState({ kind: 'LOADING' });
    if (!permitsSyntheticDriverSession(__DEV__)) {
      setState({ kind: 'EMPTY' });
      return;
    }
    const loaded = await loadDriverSession();
    if (loaded.status === 'ACTIVE') setState({ kind: 'ACTIVE', session: loaded.session });
    else if (loaded.status === 'EMPTY') setState({ kind: 'EMPTY' });
    else setState({ kind: 'UNAVAILABLE', error: loaded.error });
  }, []);

  useEffect(() => {
    reload().catch(error => setState({
      kind: 'UNAVAILABLE',
      error: error instanceof Error ? error.message : String(error),
    }));
  }, [reload]);

  const activate = useCallback(async (input: DriverSession) => {
    if (!permitsSyntheticDriverSession(__DEV__)) throw new Error('DEBUG_ACTIVATION_DISABLED');
    const session = driverSessionSchema.parse(input);
    await saveDriverSession(session);
    setState({ kind: 'ACTIVE', session });
  }, []);

  const signOut = useCallback(async () => {
    await clearDriverSession();
    setState({ kind: 'EMPTY' });
  }, []);

  const value = useMemo<DriverSessionValue>(() => ({ state, activate, signOut, reload }), [state, activate, signOut, reload]);
  return <DriverSessionContext.Provider value={value}>{children}</DriverSessionContext.Provider>;
}

export function useDriverSession(): DriverSessionValue {
  const value = useContext(DriverSessionContext);
  if (!value) throw new Error('useDriverSession must be used inside DriverSessionProvider');
  return value;
}
