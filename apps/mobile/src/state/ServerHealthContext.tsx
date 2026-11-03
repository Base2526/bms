import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { print } from 'graphql';
import { PosBootstrapDocument } from '../graphql/generated';
import { graphqlHttpUrl } from '../lib/realtime';
import { useDevice } from './DeviceContext';

export type ServerHealthStatus = 'checking' | 'online' | 'offline';

interface ServerHealthValue {
  status: ServerHealthStatus;
  lastOnlineAt: number | null;
  checkNow: () => Promise<boolean>;
  markOffline: () => void;
}

const ServerHealthContext = createContext<ServerHealthValue | null>(null);
const PROBE_TIMEOUT_MS = 3_000;

export function ServerHealthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    status: pairingStatus,
    target,
    verify,
    markAuthenticationRejected,
  } = useDevice();
  const [status, setStatus] = useState<ServerHealthStatus>('checking');
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(null);
  const activeProbe = useRef<Promise<boolean> | null>(null);
  const probeController = useRef<AbortController | null>(null);
  const probeGeneration = useRef(0);
  const authenticationRejected = verify.kind === 'REJECTED';

  const checkNow = useCallback(async () => {
    if (activeProbe.current) return activeProbe.current;
    if (pairingStatus !== 'PAIRED' || !target || authenticationRejected) {
      setStatus('offline');
      return false;
    }
    const generation = probeGeneration.current;
    const isCurrent = () => generation === probeGeneration.current;
    const probe = (async () => {
      const controller = new AbortController();
      probeController.current = controller;
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const response = await fetch(graphqlHttpUrl(target.serverUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${target.token}`,
            'x-pos-device-token': target.token,
            'x-scope': 'pos',
          },
          body: JSON.stringify({ query: print(PosBootstrapDocument) }),
          signal: controller.signal,
        });
        if (!isCurrent()) return false;
        if (response.status === 401) {
          markAuthenticationRejected();
          setStatus('offline');
          return false;
        }
        if (!response.ok) {
          setStatus('offline');
          return false;
        }
        const body = (await response.json().catch(() => null)) as {
          data?: { bmsPosSession?: unknown };
          errors?: Array<{ extensions?: { code?: string } }>;
        } | null;
        if (!isCurrent()) return false;
        if (
          body?.errors?.some(
            error => error.extensions?.code === 'UNAUTHENTICATED',
          )
        ) {
          markAuthenticationRejected();
          setStatus('offline');
          return false;
        }
        if (!body?.data?.bmsPosSession) {
          setStatus('offline');
          return false;
        }
        setStatus('online');
        setLastOnlineAt(Date.now());
        return true;
      } catch {
        if (isCurrent()) setStatus('offline');
        return false;
      } finally {
        clearTimeout(timer);
        if (isCurrent()) {
          activeProbe.current = null;
          probeController.current = null;
        }
      }
    })();
    activeProbe.current = probe;
    return probe;
  }, [authenticationRejected, markAuthenticationRejected, pairingStatus, target]);

  useEffect(() => {
    setStatus('checking');
    setLastOnlineAt(null);
    checkNow().catch(() => undefined);
    const appState = AppState.addEventListener('change', next => {
      if (next === 'active') checkNow().catch(() => undefined);
    });
    return () => {
      probeGeneration.current += 1;
      probeController.current?.abort();
      probeController.current = null;
      activeProbe.current = null;
      appState.remove();
    };
  }, [checkNow]);

  useEffect(() => {
    const timer = setInterval(
      () => checkNow().catch(() => undefined),
      status === 'offline' ? 10_000 : 30_000,
    );
    return () => clearInterval(timer);
  }, [checkNow, status]);

  const value = useMemo<ServerHealthValue>(
    () => ({
      status,
      lastOnlineAt,
      checkNow,
      markOffline: () => setStatus('offline'),
    }),
    [checkNow, lastOnlineAt, status],
  );
  return (
    <ServerHealthContext.Provider value={value}>
      {children}
    </ServerHealthContext.Provider>
  );
}

export function useServerHealth(): ServerHealthValue {
  const value = useContext(ServerHealthContext);
  if (!value)
    throw new Error('useServerHealth ต้องอยู่ใต้ <ServerHealthProvider>');
  return value;
}
