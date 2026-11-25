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
import { runWithOperationTimeout } from '../lib/operation';
import { describePosConnectionFailure, newPosAttemptId } from '../../../../packages/pos-client-core/src/connectionFailure';
import { recordPosDiagnosticEvent, retryPosDiagnosticUpload } from '../lib/supportDiagnostics';
import { useDevice } from './DeviceContext';

export type ServerHealthStatus = 'checking' | 'online' | 'offline';

interface ServerHealthValue {
  status: ServerHealthStatus;
  lastOnlineAt: number | null;
  lastCheckedAt: number | null;
  lastCode: string | null;
  lastHttpStatus: number | null;
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
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [lastHttpStatus, setLastHttpStatus] = useState<number | null>(null);
  const lastReported = useRef<{ state: string; code: string; at: number }>({ state: 'checking', code: '', at: 0 });
  const activeProbe = useRef<Promise<boolean> | null>(null);
  const probeController = useRef<AbortController | null>(null);
  const probeGeneration = useRef(0);
  const authenticationRejected = verify.kind === 'REJECTED';

  const reportProbe = useCallback((next: ServerHealthStatus, code: string | null,
    httpStatus: number | null, attemptId: string, durationMs: number, serverResponded: boolean) => {
    const now = Date.now();
    const previous = lastReported.current;
    setLastCheckedAt(now);
    setLastCode(code);
    setLastHttpStatus(httpStatus);
    setStatus(next);
    if (target && (previous.state !== next || (code && previous.code !== code)
      || (next === 'offline' && now - previous.at >= 60_000))) {
      recordPosDiagnosticEvent(target, { category: 'pos',
        action: next === 'online' ? previous.state === 'offline' ? 'health.recovered' : 'health.online' : 'health.failed',
        status: next === 'online' ? 'success' : 'error', correlationId: attemptId,
        context: { route: '/api/graphql', errorCode: code ?? 'POS_RECOVERED',
          httpStatus: httpStatus ?? undefined, durationMs,
          previousState: previous.state, nextState: next, serverResponded,
          outcome: next === 'offline' ? 'read_failed' : undefined } });
      lastReported.current = { state: next, code: code ?? '', at: now };
    }
    if (next === 'online' && target) retryPosDiagnosticUpload(target).catch(() => undefined);
  }, [target]);

  const checkNow = useCallback(async () => {
    if (activeProbe.current) return activeProbe.current;
    if (pairingStatus !== 'PAIRED' || !target || authenticationRejected) {
      setStatus('offline');
      return false;
    }
    const generation = probeGeneration.current;
    const isCurrent = () => generation === probeGeneration.current;
    const probe = (async () => {
      const startedAt = Date.now();
      const attemptId = newPosAttemptId();
      const controller = new AbortController();
      probeController.current = controller;
      try {
        const { response, body } = await runWithOperationTimeout(async signal => {
          const probeResponse = await fetch(graphqlHttpUrl(target.serverUrl), {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${target.token}`,
              'x-pos-device-token': target.token,
              'x-scope': 'pos',
              'x-pos-attempt-id': attemptId,
            },
            body: JSON.stringify({ query: print(PosBootstrapDocument) }),
            signal,
          });
          const probeBody = probeResponse.ok ? (await probeResponse.json().catch(() => null)) as {
            data?: { bmsPosSession?: unknown };
            errors?: Array<{ extensions?: { code?: string } }>;
          } | null : null;
          return { response: probeResponse, body: probeBody };
        }, PROBE_TIMEOUT_MS, controller.signal);
        if (!isCurrent()) return false;
        const serverResponded = response.headers?.get?.('x-pos-attempt-id') === attemptId;
        if (response.status === 401) {
          markAuthenticationRejected();
          reportProbe('offline', 'POS_AUTHENTICATION', 401, attemptId, Date.now() - startedAt, serverResponded);
          return false;
        }
        if (!response.ok) {
          const failure = describePosConnectionFailure({ statusCode: response.status });
          reportProbe('offline', failure.code, response.status, attemptId, Date.now() - startedAt, serverResponded);
          return false;
        }
        if (!isCurrent()) return false;
        const graphQLErrorCodes = Array.isArray(body?.errors)
          ? body.errors.map(error => error?.extensions?.code) : [];
        if (graphQLErrorCodes.includes('UNAUTHENTICATED')) {
          markAuthenticationRejected();
          reportProbe('offline', 'POS_AUTHENTICATION', 200, attemptId, Date.now() - startedAt, serverResponded);
          return false;
        }
        if (graphQLErrorCodes.length) {
          const code = graphQLErrorCodes.includes('FORBIDDEN') ? 'POS_PERMISSION'
            : graphQLErrorCodes.includes('TOO_MANY_REQUESTS') ? 'POS_RATE_LIMIT'
              : graphQLErrorCodes.includes('INTERNAL_SERVER_ERROR') ? 'POS_SERVER'
                : graphQLErrorCodes.some(value => value === 'GRAPHQL_VALIDATION_FAILED'
                  || value === 'GRAPHQL_PARSE_FAILED') ? 'POS_VERSION' : 'POS_PROTOCOL';
          reportProbe('offline', code, 200, attemptId, Date.now() - startedAt, serverResponded);
          return false;
        }
        if (!body?.data?.bmsPosSession) {
          reportProbe('offline', 'POS_PROTOCOL', 200, attemptId, Date.now() - startedAt, serverResponded);
          return false;
        }
        reportProbe('online', null, 200, attemptId, Date.now() - startedAt, serverResponded);
        setLastOnlineAt(Date.now());
        return true;
      } catch (error) {
        if (isCurrent()) reportProbe('offline', describePosConnectionFailure(error).code,
          null, attemptId, Date.now() - startedAt, false);
        return false;
      } finally {
        if (isCurrent()) {
          activeProbe.current = null;
          probeController.current = null;
        }
      }
    })();
    activeProbe.current = probe;
    return probe;
  }, [authenticationRejected, markAuthenticationRejected, pairingStatus, reportProbe, target]);

  useEffect(() => {
    setStatus('checking');
    setLastOnlineAt(null);
    setLastCheckedAt(null);
    setLastCode(null);
    setLastHttpStatus(null);
    lastReported.current = { state: 'checking', code: '', at: 0 };
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
      lastCheckedAt,
      lastCode,
      lastHttpStatus,
      checkNow,
      markOffline: () => setStatus('offline'),
    }),
    [checkNow, lastOnlineAt, lastCheckedAt, lastCode, lastHttpStatus, status],
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
