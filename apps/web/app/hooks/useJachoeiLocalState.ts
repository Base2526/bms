"use client";

import * as React from "react";

import { gql, useQuery } from "@apollo/client";

import { useSessionCtx } from "@/lib/session-context";

import {
  getBlockedTelEntry as getBlockedTelEntryInStorage,
  getReportedBankEntry as getReportedBankEntryInStorage,
  normalizeBank,
  normalizeTel,
  removeBlockedTelEntry as removeBlockedTelEntryInStorage,
  removeReportedBankEntry as removeReportedBankEntryInStorage,
  setBlockedTelEntry as setBlockedTelEntryInStorage,
  setReportedBankEntry as setReportedBankEntryInStorage,
} from "../lib/jachoeiLocalState";

import type { StoredBlockedTelEntry, StoredReportedBankEntry } from "../lib/jachoeiLocalState";

export type JachoeiLocalState = {
  blockedTelSet: ReadonlySet<string>;
  reportedBankSet: ReadonlySet<string>;
  isBlockedTel: (tel: string) => boolean;
  isReportedBank: (account: string) => boolean;
  getBlockedTelEntry: (tel: string) => StoredBlockedTelEntry | null;
  setBlockedTelEntry: (tel: string, entry: StoredBlockedTelEntry) => void;
  removeBlockedTelEntry: (tel: string) => void;
  getReportedBankEntry: (account: string) => StoredReportedBankEntry | null;
  setReportedBankEntry: (account: string, entry: StoredReportedBankEntry) => void;
  removeReportedBankEntry: (account: string) => void;
  refresh: () => void;
};

const Q_MY_BLOCKED_PHONE_KEYS = gql`
  query MyBlockedPhoneKeys {
    myBlockedPhoneKeys
  }
`;

const Q_MY_REPORTED_BANK_ACCOUNT_KEYS = gql`
  query MyReportedBankAccountKeys {
    myReportedBankAccountKeys
  }
`;


type MyBlockedPhoneKeysResponse = { myBlockedPhoneKeys: string[] };
type MyReportedBankAccountKeysResponse = { myReportedBankAccountKeys: string[] };

export function useJachoeiLocalState(): JachoeiLocalState {
  const { user } = useSessionCtx();
  const userId = user?.id != null ? String(user.id) : null;

  const [optimisticBlocked, setOptimisticBlocked] = React.useState<Set<string>>(() => new Set());
  const [optimisticReportedBank, setOptimisticReportedBank] = React.useState<Set<string>>(() => new Set());

  const blockedKeysQ = useQuery<MyBlockedPhoneKeysResponse>(Q_MY_BLOCKED_PHONE_KEYS, {
    fetchPolicy: "network-only",
    notifyOnNetworkStatusChange: true,
    errorPolicy: "all",
    skip: !userId,
  });

  const reportedBankKeysQ = useQuery<MyReportedBankAccountKeysResponse>(Q_MY_REPORTED_BANK_ACCOUNT_KEYS, {
    fetchPolicy: "network-only",
    notifyOnNetworkStatusChange: true,
    errorPolicy: "all",
    skip: !userId,
  });

  const serverBlockedSet = React.useMemo(() => {
    if (!userId) return new Set<string>();
    const rows = blockedKeysQ.data?.myBlockedPhoneKeys ?? [];
    const set = new Set<string>();
    for (const raw of rows) {
      const t = normalizeTel(raw);
      if (t) set.add(t);
    }
    return set;
  }, [blockedKeysQ.data]);

  const serverReportedBankSet = React.useMemo(() => {
    if (!userId) return new Set<string>();
    const rows = reportedBankKeysQ.data?.myReportedBankAccountKeys ?? [];
    const set = new Set<string>();
    for (const raw of rows) {
      const a = normalizeBank(raw);
      if (a) set.add(a);
    }
    return set;
  }, [reportedBankKeysQ.data]);

  React.useEffect(() => {
    setOptimisticBlocked((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const t of prev) {
        if (serverBlockedSet.has(t)) next.delete(t);
      }
      return next;
    });
  }, [serverBlockedSet]);

  React.useEffect(() => {
    setOptimisticReportedBank((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const a of prev) {
        if (serverReportedBankSet.has(a)) next.delete(a);
      }
      return next;
    });
  }, [serverReportedBankSet]);

  const blockedTelSet = React.useMemo(() => {
    const next = new Set(serverBlockedSet);
    for (const t of optimisticBlocked) next.add(t);
    return next;
  }, [optimisticBlocked, serverBlockedSet]);

  const reportedBankSet = React.useMemo(() => {
    const next = new Set(serverReportedBankSet);
    for (const a of optimisticReportedBank) next.add(a);
    return next;
  }, [optimisticReportedBank, serverReportedBankSet]);

  const refresh = React.useCallback(() => {
    if (!userId) return;
    void blockedKeysQ.refetch().catch(() => {});
    void reportedBankKeysQ.refetch().catch(() => {});
  }, [blockedKeysQ, reportedBankKeysQ, userId]);

  // Realtime invalidation is handled globally in `GlobalChatListener`.

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!userId) return;

    const onFocus = () => refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh, userId]);

  React.useEffect(() => {
    if (userId) return;
    setOptimisticBlocked(new Set());
    setOptimisticReportedBank(new Set());
  }, [userId]);

  const isBlockedTel = React.useCallback(
    (tel: string) => {
      const t = normalizeTel(tel);
      return !!(t && blockedTelSet.has(t));
    },
    [blockedTelSet]
  );

  const isReportedBank = React.useCallback(
    (account: string) => {
      const a = normalizeBank(account);
      return !!(a && reportedBankSet.has(a));
    },
    [reportedBankSet]
  );

  const getBlockedTelEntry = React.useCallback((tel: string) => {
    const t = normalizeTel(tel);
    if (!t) return null;
    return getBlockedTelEntryInStorage(t);
  }, []);

  const setBlockedTelEntry = React.useCallback((tel: string, entry: StoredBlockedTelEntry) => {
    const t = normalizeTel(tel);
    if (!t) return;

    setBlockedTelEntryInStorage(t, entry);

    // keep UX snappy (optimistic), but backend remains source of truth
    setOptimisticBlocked((prev) => {
      const next = new Set(prev);
      next.add(t);
      return next;
    });
  }, []);

  const removeBlockedTelEntry = React.useCallback((tel: string) => {
    const t = normalizeTel(tel);
    if (!t) return;

    removeBlockedTelEntryInStorage(t);

    setOptimisticBlocked((prev) => {
      const next = new Set(prev);
      next.delete(t);
      return next;
    });
  }, []);

  const getReportedBankEntry = React.useCallback((account: string) => {
    const a = normalizeBank(account);
    if (!a) return null;
    return getReportedBankEntryInStorage(a);
  }, []);

  const setReportedBankEntry = React.useCallback((account: string, entry: StoredReportedBankEntry) => {
    const a = normalizeBank(account);
    if (!a) return;

    setReportedBankEntryInStorage(a, entry);

    setOptimisticReportedBank((prev) => {
      const next = new Set(prev);
      next.add(a);
      return next;
    });
  }, []);

  const removeReportedBankEntry = React.useCallback((account: string) => {
    const a = normalizeBank(account);
    if (!a) return;

    removeReportedBankEntryInStorage(a);

    setOptimisticReportedBank((prev) => {
      const next = new Set(prev);
      next.delete(a);
      return next;
    });
  }, []);

  return {
    blockedTelSet,
    reportedBankSet,
    isBlockedTel,
    isReportedBank,
    getBlockedTelEntry,
    setBlockedTelEntry,
    removeBlockedTelEntry,
    getReportedBankEntry,
    setReportedBankEntry,
    removeReportedBankEntry,
    refresh,
  };
}
