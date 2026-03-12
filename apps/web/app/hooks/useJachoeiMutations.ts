"use client";

import * as React from "react";
import { gql, useMutation } from "@apollo/client";

import {
  getJachoeiClientId,
  normalizeBank,
  normalizeTel,
} from "../lib/jachoeiLocalState";

export type ScamPhoneReportCategory = "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";

export type ScamBankReportCategory = "SCAM" | "MONEY_MULE" | "SALES_ADS" | "DISPUTE" | "OTHER";

export type PhoneSafetyStatus = {
  phone: string;
  phone_normalized: string;
  my_blocked: boolean;
  my_blocked_at?: string | null;
  blocked_by_count?: number;
  last_blocked_at?: string | null;
  report_count?: number;
  last_report_at?: string | null;
  risk_level?: number;
  updated_at?: string;
};

export type ReportScamPhoneInput = {
  phone: string;
  note?: string | null;
  local_blocked: boolean;
  client_id: string;
  device_model?: string | null;
  os_version?: string | null;
  app_version?: string | null;
  category?: ScamPhoneReportCategory | null;
};

export type UnblockScamPhoneInput = {
  phone: string;
  client_id: string;
  device_model?: string | null;
  os_version?: string | null;
  app_version?: string | null;
};

export type ReportScamBankAccountInput = {
  bank_name: string;
  account: string;
  note?: string | null;
  client_id: string;
  device_model?: string | null;
  os_version?: string | null;
  app_version?: string | null;
};

export type UnreportScamBankAccountInput = {
  bank_name: string;
  account: string;
  client_id: string;
  device_model?: string | null;
  os_version?: string | null;
  app_version?: string | null;
  reason?: string | null;
};

const REPORT_SCAM_PHONE = gql`
  mutation ReportScamPhone($input: ReportScamPhoneInput!) {
    reportScamPhone(input: $input) {
      phone
      report_count
      last_report_at
      risk_level
      tags
      ctx
      updated_at
      is_deleted
    }
  }
`;

const UNBLOCK_SCAM_PHONE = gql`
  mutation UnblockScamPhone($input: UnblockScamPhoneInput!) {
    unblockScamPhone(input: $input) {
      phone
      report_count
      last_report_at
      risk_level
      tags
      ctx
      updated_at
      is_deleted
    }
  }
`;

const BLOCK_PHONE = gql`
  mutation BlockPhone($input: BlockPhoneInput!) {
    blockPhone(input: $input) {
      ok
      status {
        phone
        phone_normalized
        my_blocked
        my_blocked_at
        blocked_by_count
        last_blocked_at
        report_count
        last_report_at
        risk_level
        updated_at
      }
    }
  }
`;

const UNBLOCK_PHONE = gql`
  mutation UnblockPhone($input: UnblockPhoneInput!) {
    unblockPhone(input: $input) {
      ok
      status {
        phone
        phone_normalized
        my_blocked
        my_blocked_at
        blocked_by_count
        last_blocked_at
        report_count
        last_report_at
        risk_level
        updated_at
      }
    }
  }
`;

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

const M_REPORT_SCAM_BANK_ACCOUNT = gql`
  mutation ReportScamBankAccount($input: ReportScamBankAccountInput!) {
    reportScamBankAccount(input: $input) {
      account
      bank_name
      report_count
      last_report_at
      risk_level
      tags
      ctx
      updated_at
      is_deleted
    }
  }
`;

const M_UNREPORT_SCAM_BANK_ACCOUNT = gql`
  mutation UnreportScamBankAccount($input: UnreportScamBankAccountInput!) {
    unreportScamBankAccount(input: $input) {
      account
      bank_name
      report_count
      last_report_at
      risk_level
      tags
      ctx
      updated_at
      is_deleted
    }
  }
`;

type ReportScamPhoneData = {
  reportScamPhone: {
    phone: string;
    report_count?: number;
    last_report_at?: string | null;
    risk_level?: number;
    tags?: string[];
    ctx?: unknown;
    updated_at?: string;
    is_deleted?: boolean;
  };
};

type UnblockScamPhoneData = {
  unblockScamPhone: {
    phone: string;
    report_count?: number;
    last_report_at?: string | null;
    risk_level?: number;
    tags?: string[];
    ctx?: unknown;
    updated_at?: string;
    is_deleted?: boolean;
  };
};

type BlockPhoneData = {
  blockPhone: {
    ok: boolean;
    status: PhoneSafetyStatus;
  };
};

type UnblockPhoneData = {
  unblockPhone: {
    ok: boolean;
    status: PhoneSafetyStatus;
  };
};

type ReportScamBankAccountData = {
  reportScamBankAccount: {
    account: string;
    bank_name: string;
    report_count?: number;
    last_report_at?: string | null;
    risk_level?: number;
    tags?: string[];
    ctx?: unknown;
    updated_at?: string;
    is_deleted?: boolean;
  };
};

type UnreportScamBankAccountData = {
  unreportScamBankAccount: {
    account: string;
    bank_name: string;
    report_count?: number;
    last_report_at?: string | null;
    risk_level?: number;
    tags?: string[];
    ctx?: unknown;
    updated_at?: string;
    is_deleted?: boolean;
  };
};

export type JachoeiMutations = {
  blockPhone: (args: { phone: string; note?: string | null; postId?: string | null }) => Promise<PhoneSafetyStatus>;
  reportPhone: (args: {
    phone: string;
    category?: ScamPhoneReportCategory;
    note?: string | null;
  }) => Promise<ReportScamPhoneData["reportScamPhone"]>;
  unblockPhone: (args: { phone: string }) => Promise<PhoneSafetyStatus>;
  unblockScamPhone: (args: { phone: string }) => Promise<UnblockScamPhoneData["unblockScamPhone"]>;
  reportBank: (args: {
    account: string;
    bankName: string | null | undefined;
    category?: ScamBankReportCategory;
    note?: string | null;
  }) => Promise<ReportScamBankAccountData["reportScamBankAccount"]>;
  unreportBank: (args: {
    account: string;
    bankName: string | null | undefined;
    category?: ScamBankReportCategory;
    reason?: string | null;
  }) => Promise<UnreportScamBankAccountData["unreportScamBankAccount"]>;
  loading: {
    blockPhone: boolean;
    reportPhone: boolean;
    unblockPhone: boolean;
    unblockScamPhone: boolean;
    reportBank: boolean;
    unreportBank: boolean;
    any: boolean;
  };
};

export function useJachoeiMutations(): JachoeiMutations {
  const [mutBlockPhone, stBlockPhone] = useMutation<BlockPhoneData, { input: { phone: string; note?: string | null; postId?: string | null } }>(
    BLOCK_PHONE
  );
  const [mutUnblockPhone, stUnblockPhone] = useMutation<UnblockPhoneData, { input: { phone: string } }>(
    UNBLOCK_PHONE
  );
  const [mutReportPhone, stReportPhone] = useMutation<ReportScamPhoneData, { input: ReportScamPhoneInput }>(
    REPORT_SCAM_PHONE
  );
  const [mutUnblockScamPhone, stUnblockScamPhone] = useMutation<UnblockScamPhoneData, { input: UnblockScamPhoneInput }>(
    UNBLOCK_SCAM_PHONE
  );
  const [mutReportBank, stReportBank] = useMutation<ReportScamBankAccountData, { input: ReportScamBankAccountInput }>(
    M_REPORT_SCAM_BANK_ACCOUNT
  );
  const [mutUnreportBank, stUnreportBank] = useMutation<UnreportScamBankAccountData, { input: UnreportScamBankAccountInput }>(
    M_UNREPORT_SCAM_BANK_ACCOUNT
  );

  const reportPhone = React.useCallback(
    async ({ phone, category, note }: { phone: string; category?: ScamPhoneReportCategory; note?: string | null }) => {
      const p = normalizeTel(phone);
      if (!p) throw new Error("Invalid phone");

      const clientId = getJachoeiClientId();
      if (!clientId) throw new Error("Missing client_id");

      const res = await mutReportPhone({
        variables: {
          input: {
            phone: p,
            local_blocked: true,
            client_id: clientId,
            category: category ?? null,
            note: note?.trim() ? note.trim() : null,
          },
        },
      });

      const payload = res.data?.reportScamPhone;
      if (!payload) throw new Error("Missing reportScamPhone result");
      return payload;
    },
    [mutReportPhone]
  );

  const blockPhone = React.useCallback(
    async ({ phone, note, postId }: { phone: string; note?: string | null; postId?: string | null }) => {
      const p = normalizeTel(phone);
      if (!p) throw new Error("Invalid phone");

      const res = await mutBlockPhone({
        variables: {
          input: {
            phone: p,
            note: note?.trim() ? note.trim() : null,
            postId: postId ?? null,
          },
        },
        refetchQueries: [{ query: Q_MY_BLOCKED_PHONE_KEYS }],
        awaitRefetchQueries: true,
      });

      const payload = res.data?.blockPhone;
      if (!payload?.ok || !payload.status) throw new Error("Missing blockPhone result");
      return payload.status;
    },
    [mutBlockPhone]
  );

  const unblockPhone = React.useCallback(
    async ({ phone }: { phone: string }) => {
      const p = normalizeTel(phone);
      if (!p) throw new Error("Invalid phone");

      const res = await mutUnblockPhone({
        variables: {
          input: {
            phone: p,
          },
        },
        refetchQueries: [{ query: Q_MY_BLOCKED_PHONE_KEYS }],
        awaitRefetchQueries: true,
      });

      const payload = res.data?.unblockPhone;
      if (!payload?.ok || !payload.status) throw new Error("Missing unblockPhone result");
      return payload.status;
    },
    [mutUnblockPhone]
  );

  const unblockScamPhone = React.useCallback(
    async ({ phone }: { phone: string }) => {
      const p = normalizeTel(phone);
      if (!p) throw new Error("Invalid phone");

      const clientId = getJachoeiClientId();
      if (!clientId) throw new Error("Missing client_id");

      const res = await mutUnblockScamPhone({
        variables: {
          input: {
            phone: p,
            client_id: clientId,
          },
        },
      });

      const payload = res.data?.unblockScamPhone;
      if (!payload) throw new Error("Missing unblockScamPhone result");
      return payload;
    },
    [mutUnblockScamPhone]
  );

  const reportBank = React.useCallback(
    async ({
      account,
      bankName,
      category,
      note,
    }: {
      account: string;
      bankName: string | null | undefined;
      category?: ScamBankReportCategory;
      note?: string | null;
    }) => {
      const acc = normalizeBank(account);
      if (!acc) throw new Error("Invalid account");

      const clientId = getJachoeiClientId();
      if (!clientId) throw new Error("Missing client_id");

      const bank_name = String(bankName ?? "UNKNOWN").trim() || "UNKNOWN";

      const noteTrim = note?.trim() ? note.trim() : "";
      const noteWithCategory = category
        ? `[${category}]${noteTrim ? ` ${noteTrim}` : ""}`
        : noteTrim || null;

      const res = await mutReportBank({
        variables: {
          input: {
            bank_name,
            account: acc,
            client_id: clientId,
            note: noteWithCategory,
          },
        },
        refetchQueries: [{ query: Q_MY_REPORTED_BANK_ACCOUNT_KEYS }],
        awaitRefetchQueries: true,
      });

      const payload = res.data?.reportScamBankAccount;
      if (!payload) throw new Error("Missing reportScamBankAccount result");
      return payload;
    },
    [mutReportBank]
  );

  const unreportBank = React.useCallback(
    async ({
      account,
      bankName,
      category,
      reason,
    }: {
      account: string;
      bankName: string | null | undefined;
      category?: ScamBankReportCategory;
      reason?: string | null;
    }) => {
      const acc = normalizeBank(account);
      if (!acc) throw new Error("Invalid account");

      const clientId = getJachoeiClientId();
      if (!clientId) throw new Error("Missing client_id");

      const bank_name = String(bankName ?? "UNKNOWN").trim() || "UNKNOWN";

      const reasonTrim = reason?.trim() ? reason.trim() : "";
      const reasonWithCategory = category
        ? `[UNDO:${category}]${reasonTrim ? ` ${reasonTrim}` : ""}`
        : reasonTrim || null;

      const res = await mutUnreportBank({
        variables: {
          input: {
            bank_name,
            account: acc,
            client_id: clientId,
            reason: reasonWithCategory,
          },
        },
        refetchQueries: [{ query: Q_MY_REPORTED_BANK_ACCOUNT_KEYS }],
        awaitRefetchQueries: true,
      });

      const payload = res.data?.unreportScamBankAccount;
      if (!payload) throw new Error("Missing unreportScamBankAccount result");
      return payload;
    },
    [mutUnreportBank]
  );

  const loading = React.useMemo(
    () => {
      const l = {
        blockPhone: !!stBlockPhone.loading,
        reportPhone: !!stReportPhone.loading,
        unblockPhone: !!stUnblockPhone.loading,
        unblockScamPhone: !!stUnblockScamPhone.loading,
        reportBank: !!stReportBank.loading,
        unreportBank: !!stUnreportBank.loading,
      };
      return {
        ...l,
        any:
          l.blockPhone || l.reportPhone || l.unblockPhone || l.unblockScamPhone || l.reportBank || l.unreportBank,
      };
    },
    [
      stBlockPhone.loading,
      stReportPhone.loading,
      stUnblockPhone.loading,
      stUnblockScamPhone.loading,
      stReportBank.loading,
      stUnreportBank.loading,
    ]
  );

  return { blockPhone, reportPhone, unblockPhone, unblockScamPhone, reportBank, unreportBank, loading };
}
