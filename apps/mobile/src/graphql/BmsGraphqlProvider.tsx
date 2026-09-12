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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TICKET_TIMEOUT_MS);
  try {
    const response = await fetch(realtimeTicketUrl(target.serverUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${target.token}`,
        'x-pos-device-token': target.token,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`realtime ticket returned HTTP ${response.status}`);
      Object.assign(error, { status: response.status });
      throw error;
    }
    const body = (await response.json()) as Partial<RealtimeTicketResponse>;
    if (typeof body.ticket !== 'string' || typeof body.expiresAt !== 'number') {
      throw new Error('realtime ticket response is malformed');
    }
    return body as RealtimeTicketResponse;
  } finally {
    clearTimeout(timer);
  }
}

function makeClient(
  target: PairingTarget | null,
  setRealtimeStatus: (status: MobileRealtimeStatus) => void,
): {
  apollo: ApolloClient<NormalizedCacheObject>;
  ws: Client | null;
  stop: () => void;
} {
  let active = true;
  const reportStatus = (status: MobileRealtimeStatus) => {
    if (active) setRealtimeStatus(status);
  };
  const authLink = new ApolloLink((operation, forward) => {
    operation.setContext(({ headers = {} }) => ({
      headers: {
        ...headers,
        authorization: target ? `Bearer ${target.token}` : '',
        'x-pos-device-token': target?.token ?? '',
        'x-scope': 'pos',
      },
    }));
    return forward(operation);
  });

  const errorLink = onError(({ graphQLErrors, networkError }) => {
    const unauthenticated =
      graphQLErrors?.some(
        error => error.extensions?.code === 'UNAUTHENTICATED',
      ) ||
      (networkError &&
        'statusCode' in networkError &&
        networkError.statusCode === 401);
    if (unauthenticated) reportStatus('authentication_required');
  });

  const httpLink = new HttpLink({
    uri: target ? graphqlHttpUrl(target.serverUrl) : '/graphql',
  });
  const http = ApolloLink.from([errorLink, authLink, httpLink]);

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
      shouldRetry: () => !authFailed,
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
          reportStatus(
            authFailed ? 'authentication_required' : 'degraded',
          );
          throw error;
        }
      },
      on: {
        connected: () => reportStatus('connected'),
        closed: () => {
          if (!authFailed) reportStatus('reconnecting');
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
  const { status, target } = useDevice();
  const [realtimeStatus, setRealtimeStatus] =
    useState<MobileRealtimeStatus>('offline');
  const pairedTarget = status === 'PAIRED' ? target : null;
  const bundle = useMemo(
    () => makeClient(pairedTarget, setRealtimeStatus),
    [pairedTarget],
  );

  useEffect(() => {
    setRealtimeStatus(pairedTarget ? 'connecting' : 'offline');
    return bundle.stop;
  }, [bundle, pairedTarget]);

  const transport = useMemo(
    () => ({ realtimeStatus }),
    [realtimeStatus],
  );

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
