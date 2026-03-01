"use client";

import * as React from "react";

import {
  getBlockedTelSet,
  getBlockedTelEntry as getBlockedTelEntryInStorage,
  getReportedBankSet,
  getReportedBankEntry as getReportedBankEntryInStorage,
  normalizeBank,
  normalizeTel,
  removeBlockedTelEntry as removeBlockedTelEntryInStorage,
  removeReportedBankEntry as removeReportedBankEntryInStorage,
  setBlockedTelEntry as setBlockedTelEntryInStorage,
  setReportedBankEntry as setReportedBankEntryInStorage,
  subscribeSync,
  toggleBlockedTel as toggleBlockedTelInStorage,
  toggleReportedBank as toggleReportedBankInStorage,
} from "../lib/jachoeiLocalState";

import type { StoredBlockedTelEntry, StoredReportedBankEntry } from "../lib/jachoeiLocalState";

export type JachoeiLocalState = {
  blockedTelSet: ReadonlySet<string>;
  reportedBankSet: ReadonlySet<string>;
  isBlockedTel: (tel: string) => boolean;
  isReportedBank: (account: string) => boolean;
  toggleBlockedTel: (tel: string) => { blocked: boolean };
  toggleReportedBank: (account: string) => { reported: boolean };
  getBlockedTelEntry: (tel: string) => StoredBlockedTelEntry | null;
  setBlockedTelEntry: (tel: string, entry: StoredBlockedTelEntry) => void;
  removeBlockedTelEntry: (tel: string) => void;
  getReportedBankEntry: (account: string) => StoredReportedBankEntry | null;
  setReportedBankEntry: (account: string, entry: StoredReportedBankEntry) => void;
  removeReportedBankEntry: (account: string) => void;
  refresh: () => void;
};

export function useJachoeiLocalState(): JachoeiLocalState {
  const [blockedTelSet, setBlockedTelSet] = React.useState<Set<string>>(() => new Set());
  const [reportedBankSet, setReportedBankSet] = React.useState<Set<string>>(() => new Set());

  const refresh = React.useCallback(() => {
    setBlockedTelSet(getBlockedTelSet());
    setReportedBankSet(getReportedBankSet());
  }, []);

  React.useEffect(() => {
    refresh();
    return subscribeSync(() => refresh());
  }, [refresh]);

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

  const toggleBlockedTel = React.useCallback(
    (tel: string) => {
      const t = normalizeTel(tel);
      if (!t) return { blocked: false };
      const res = toggleBlockedTelInStorage(t);

      setBlockedTelSet((prev) => {
        const next = new Set(prev);
        if (res.blocked) next.add(t);
        else next.delete(t);
        return next;
      });

      return res;
    },
    []
  );

  const toggleReportedBank = React.useCallback(
    (account: string) => {
      const a = normalizeBank(account);
      if (!a) return { reported: false };
      const res = toggleReportedBankInStorage(a);

      setReportedBankSet((prev) => {
        const next = new Set(prev);
        if (res.reported) next.add(a);
        else next.delete(a);
        return next;
      });

      return res;
    },
    []
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
    setBlockedTelSet((prev) => {
      const next = new Set(prev);
      next.add(t);
      return next;
    });
  }, []);

  const removeBlockedTelEntry = React.useCallback((tel: string) => {
    const t = normalizeTel(tel);
    if (!t) return;

    removeBlockedTelEntryInStorage(t);
    setBlockedTelSet((prev) => {
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
    setReportedBankSet((prev) => {
      const next = new Set(prev);
      next.add(a);
      return next;
    });
  }, []);

  const removeReportedBankEntry = React.useCallback((account: string) => {
    const a = normalizeBank(account);
    if (!a) return;

    removeReportedBankEntryInStorage(a);
    setReportedBankSet((prev) => {
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
    toggleBlockedTel,
    toggleReportedBank,
    getBlockedTelEntry,
    setBlockedTelEntry,
    removeBlockedTelEntry,
    getReportedBankEntry,
    setReportedBankEntry,
    removeReportedBankEntry,
    refresh,
  };
}
