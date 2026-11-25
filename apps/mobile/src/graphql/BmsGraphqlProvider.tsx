import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ApolloClient,
  ApolloLink,
  ApolloProvider,
  HttpLink,
  InMemoryCache,
  split,
  type NormalizedCacheObject,
} from '@apollo/client';
import { onError } from '@apollo/client/link/error';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient, type Client } from 'graphql-ws';
import { useDevice } from '../state/DeviceContext';
import {
  graphqlHttpUrl,
  nativeWebSocketOptions,
  realtimeTicketUrl,
  realtimeWsUrl,
  reconnectDelayMs,
  type MobileRealtimeStatus,
  type RealtimeTicketResponse,
} from '../lib/realtime';
import type { PairingTarget } from '../lib/pairing';
import { recordPosDiagnosticEvent } from '../lib/supportDiagnostics';
import { operationTimeoutLink } from './operationTimeoutLink';
import { connectionErrorLink } from './connectionErrorLink';
import { runWithOperationTimeout } from '../lib/operation';
import { describePosConnectionFailure, newPosAttemptId } from '../../../../packages/pos-client-core/src/connectionFailure';
import { safePosDiagnosticOperation } from '../../../../packages/pos-client-core/src/diagnosticOperations';
import { createRealtimeDiagnosticTracker } from './realtimeDiagnosticTracker';

interface BmsGraphqlTransportValue {
  realtimeStatus: MobileRealtimeStatus;
}

const BmsGraphqlTransportContext =
  createContext<BmsGraphqlTransportValue | null>(null);

const TICKET_TIMEOUT_MS = 10_000;

class BmsNativeWebSocket extends WebSocket {
  constructor(url: string, protocols?: string | string[]) {
    super(url, protocols, nativeWebSocketOptions());
  }
}

async function mintRealtimeTicket(
  target: PairingTarget,
): Promise<RealtimeTicketResponse> {
  const attemptId = newPosAttemptId();
  const startedAt = Date.now();
  let serverResponded = false;
  try { return await runWithOperationTimeout(async signal => {
    const response = await fetch(realtimeTicketUrl(target.serverUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${target.token}`,
        'x-pos-device-token': target.token,
        'x-pos-attempt-id': attemptId,
      },
      signal,
    });
    serverResponded = response.headers?.get?.('x-pos-attempt-id') === attemptId;
    if (!response.ok) {
      const error = new Error(
        `realtime ticket returned HTTP ${response.status}`,
      );
      Object.assign(error, { status: response.status });
      Object.assign(error, { statusCode: response.status });
      throw error;
    }
    const body = (await response.json().catch(() => null)) as Partial<RealtimeTicketResponse> | null;
    if (!body || typeof body.ticket !== 'string' || !body.ticket.trim()
      || typeof body.expiresAt !== 'number' || !Number.isFinite(body.expiresAt)) {
      throw Object.assign(new Error('realtime ticket response is malformed'), { code: 'INVALID_RESPONSE', statusCode: 200 });
    }
    return body as RealtimeTicketResponse;
  }, TICKET_TIMEOUT_MS); } catch (error) {
    const failure = describePosConnectionFailure(error);
    recordPosDiagnosticEvent(target, { category: 'pos', action: 'realtime.ticket_failed', status: 'error',
      correlationId: attemptId,
      context: { route: '/api/bms/realtime/ticket', errorCode: failure.code,
        httpStatus: failure.httpStatus ?? undefined, durationMs: Date.now() - startedAt,
        serverResponded, outcome: 'read_failed' } });
    throw error;
  }
}

function makeClient(
  target: PairingTarget | null,
  setRealtimeStatus: (status: MobileRealtimeStatus) => void,
  markAuthenticationRejected: () => void,
): {
  apollo: ApolloClient<NormalizedCacheObject>;
  ws: Client | null;
  stop: () => void;
} {
  let active = true;
  const realtimeDiagnostic = createRealtimeDiagnosticTracker();
  const reportStatus = (status: MobileRealtimeStatus, nativeCode?: string) => {
    if (!active) return;
    setRealtimeStatus(status);
    const diagnostic = realtimeDiagnostic(status);
    if (target && diagnostic) {
      recordPosDiagnosticEvent(target, { category: 'pos',
        action: diagnostic.action, status: diagnostic.status,
        context: { route: '/graphql', errorCode: diagnostic.errorCode,
          previousState: diagnostic.previousState, nextState: diagnostic.nextState, nativeCode,
          outcome: diagnostic.action === 'realtime.recovered' ? undefined : 'read_failed' } });
    }
  };
  let authenticationRejected = false;
  const lastReadFailure = new Map<string, number>();
  const allowFailureLog = (operation: string, code: string, mutation: boolean) => {
    if (mutation) return true;
    const key = `${operation}:${code}`;
    const now = Date.now();
    if (now - (lastReadFailure.get(key) ?? 0) < 30_000) return false;
    lastReadFailure.set(key, now);
    return true;
  };
  const reportAuthenticationRequired = () => {
    if (!active || authenticationRejected) return;
    authenticationRejected = true;
    reportStatus('authentication_required');
    markAuthenticationRejected();
  };
  const authLink = new ApolloLink((operation, forward) => {
    const attemptId = newPosAttemptId();
    operation.setContext(({ headers = {} }) => ({
      posAttemptId: attemptId,
      posStartedAt: Date.now(),
      headers: {
        ...headers,
        authorization: target ? `Bearer ${target.token}` : '',
        'x-pos-device-token': target?.token ?? '',
        'x-scope': 'pos',
        'x-pos-attempt-id': attemptId,
      },
    }));
    return forward(operation);
  });

  const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
    const operationName = safePosDiagnosticOperation(operation.operationName);
    const cashierUserId = operationName === 'VerifyPosCashier'
      && typeof operation.variables?.input?.cashierUserId === 'string'
      ? operation.variables.input.cashierUserId
      : undefined;
    const isMutation = operation.query.definitions.some(definition => definition.kind === 'OperationDefinition'
      && definition.operation === 'mutation');
    const unauthenticated =
      graphQLErrors?.some(
        error => error.extensions?.code === 'UNAUTHENTICATED',
      ) ||
      (networkError &&
        'statusCode' in networkError &&
        networkError.statusCode === 401);
    const networkStatus =
      networkError && 'statusCode' in networkError
        ? Number(networkError.statusCode)
        : undefined;
    const attemptId = operation.getContext().posAttemptId as string | undefined;
    const durationMs = Date.now() - Number(operation.getContext().posStartedAt || Date.now());
    const response = operation.getContext().response as Response | undefined;
    const serverResponded = !!response && response.headers?.get('x-pos-attempt-id') === attemptId;
    const networkFailure = networkError ? describePosConnectionFailure(
      unauthenticated ? { code: 'UNAUTHENTICATED', statusCode: networkStatus } : networkError,
      isMutation) : null;
    if (target && graphQLErrors?.length) {
      for (const error of graphQLErrors.slice(0, 3)) {
        const code = typeof error.extensions?.code === 'string' ? error.extensions.code : 'GRAPHQL_ERROR';
        if (!allowFailureLog(operationName, code, isMutation)) continue;
        recordPosDiagnosticEvent(target, {
          category: 'pos',
          action: `graphql.${operationName}`,
          status: 'error',
          correlationId: attemptId,
          context: {
            cashierUserId,
            route: '/api/graphql',
            errorCode: code,
            httpStatus: networkStatus,
            durationMs, serverResponded,
            outcome: describePosConnectionFailure({ extensions: { code } }, isMutation).outcome,
          },
        });
      }
    }
    if (target && networkError && allowFailureLog(operationName, 'network', isMutation)) {
      recordPosDiagnosticEvent(target, {
        category: 'pos',
        action: `network.${operationName}`,
        status: 'error',
        correlationId: attemptId,
        context: {
          cashierUserId,
          route: '/api/graphql',
          errorName: networkError.name || 'NetworkError',
          errorCode: networkFailure?.code ?? 'POS_NETWORK',
          httpStatus: networkFailure?.httpStatus ?? undefined,
          durationMs, serverResponded,
          outcome: networkFailure?.outcome ?? (isMutation ? 'unknown' : 'read_failed'),
        },
      });
    }
    if (unauthenticated) reportAuthenticationRequired();
  });

  const httpLink = new HttpLink({
    uri: target ? graphqlHttpUrl(target.serverUrl) : '/graphql',
  });
  const http = ApolloLink.from([
    errorLink,
    authLink,
    connectionErrorLink(),
    operationTimeoutLink(),
    httpLink,
  ]);

  let ws: Client | null = null;
  let link: ApolloLink = http;
  if (target) {
    let authFailed = false;
    ws = createClient({
      url: realtimeWsUrl(target.serverUrl),
      webSocketImpl: BmsNativeWebSocket,
      lazy: true,
      retryAttempts: Infinity,
      retryWait: async retryCount => {
        reportStatus('reconnecting');
        await new Promise<void>(resolve =>
          setTimeout(resolve, reconnectDelayMs(retryCount)),
        );
      },
      shouldRetry: () => !authFailed && !authenticationRejected,
      connectionParams: async () => {
        reportStatus('connecting');
        try {
          const ticket = await mintRealtimeTicket(target);
          authFailed = false;
          return { ticket: ticket.ticket };
        } catch (error) {
          authFailed =
            !!error &&
            typeof error === 'object' &&
            'status' in error &&
            error.status === 401;
          if (authFailed) reportAuthenticationRequired();
          else reportStatus('degraded');
          throw error;
        }
      },
      on: {
        connected: () => reportStatus('connected'),
        closed: event => {
          const code = event && typeof event === 'object' && 'code' in event
            ? String((event as { code?: unknown }).code ?? '') : undefined;
          if (!authFailed) reportStatus('reconnecting', code);
        },
        error: () => {
          if (!authFailed) reportStatus('degraded');
        },
      },
    });
    const wsLink = new GraphQLWsLink(ws);
    link = split(
      ({ query }) => {
        const definition = getMainDefinition(query);
        return (
          definition.kind === 'OperationDefinition' &&
          definition.operation === 'subscription'
        );
      },
      wsLink,
      http,
    );
  }

  const apollo = new ApolloClient({
    cache: new InMemoryCache(),
    link,
    defaultOptions: {
      query: { fetchPolicy: 'network-only' },
      watchQuery: { fetchPolicy: 'cache-and-network' },
    },
  });
  return {
    ws,
    apollo,
    stop: () => {
      active = false;
      if (ws) {
        const disposal = ws.dispose();
        if (disposal) disposal.catch(() => undefined);
      }
      apollo.stop();
    },
  };
}

export function BmsGraphqlProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status, target, verify, markAuthenticationRejected } = useDevice();
  const [realtimeStatus, setRealtimeStatus] =
    useState<MobileRealtimeStatus>('offline');
  const pairedTarget =
    status === 'PAIRED' && verify.kind !== 'REJECTED' ? target : null;
  const bundle = useMemo(
    () =>
      makeClient(pairedTarget, setRealtimeStatus, markAuthenticationRejected),
    [pairedTarget, markAuthenticationRejected],
  );

  useEffect(() => {
    setRealtimeStatus(pairedTarget ? 'connecting' : 'offline');
    return bundle.stop;
  }, [bundle, pairedTarget]);

  const transport = useMemo(() => ({ realtimeStatus }), [realtimeStatus]);

  return (
    <BmsGraphqlTransportContext.Provider value={transport}>
      <ApolloProvider client={bundle.apollo}>{children}</ApolloProvider>
    </BmsGraphqlTransportContext.Provider>
  );
}

export function useBmsGraphqlTransport(): BmsGraphqlTransportValue {
  const context = useContext(BmsGraphqlTransportContext);
  if (!context) {
    throw new Error(
      'useBmsGraphqlTransport ต้องถูกเรียกใต้ <BmsGraphqlProvider>',
    );
  }
  return context;
}
