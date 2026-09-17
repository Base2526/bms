import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import {
  MobilePosBoardGameServiceCallsDocument,
  type MobilePosBoardGameServiceCallsQuery,
} from '../graphql/generated';
import { useSession } from './SessionContext';
import { useStoreMode } from './StoreModeContext';

type ServiceCall =
  MobilePosBoardGameServiceCallsQuery['bmsPosBoardGameServiceCalls']['calls'][number];
const EMPTY_CALLS: ServiceCall[] = [];

type Value = {
  calls: ServiceCall[];
  activeIds: string[];
  pendingCount: number;
  initialized: boolean;
  refresh: () => Promise<void>;
};

const Context = createContext<Value | null>(null);

export function BoardGameServiceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session } = useSession();
  const { mode } = useStoreMode();
  const skip = !session?.credentials || mode !== 'board_game_cafe';
  const result = useQuery(MobilePosBoardGameServiceCallsDocument, {
    variables: {
      credentials: session?.credentials ?? { cashierUserId: '', pin: '' },
    },
    skip,
    notifyOnNetworkStatusChange: true,
  });
  const calls = result.data?.bmsPosBoardGameServiceCalls.calls ?? EMPTY_CALLS;
  const activeIds = useMemo(
    () =>
      calls
        .filter(call => ['PENDING', 'ACKNOWLEDGED'].includes(call.status))
        .map(call => call.id),
    [calls],
  );
  const refresh = useCallback(async () => {
    await result.refetch();
  }, [result]);
  const value = useMemo<Value>(
    () => ({
      calls,
      activeIds,
      pendingCount: activeIds.length,
      initialized: skip || !result.loading,
      refresh,
    }),
    [activeIds, calls, refresh, result.loading, skip],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBoardGameService(): Value {
  const value = useContext(Context);
  if (!value)
    throw new Error(
      'useBoardGameService ต้องถูกเรียกใต้ <BoardGameServiceProvider>',
    );
  return value;
}
