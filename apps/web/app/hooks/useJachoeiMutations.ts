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
  reportPhone: (args: {
    phone: string;
    category?: ScamPhoneReportCategory;
    note?: string | null;
  }) => Promise<ReportScamPhoneData["reportScamPhone"]>;
  unblockPhone: (args: { phone: string }) => Promise<UnblockScamPhoneData["unblockScamPhone"]>;
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
    reportPhone: boolean;
    unblockPhone: boolean;
    reportBank: boolean;
    unreportBank: boolean;
    any: boolean;
  };
};

export function useJachoeiMutations(): JachoeiMutations {
  const [mutReportPhone, stReportPhone] = useMutation<ReportScamPhoneData, { input: ReportScamPhoneInput }>(
    REPORT_SCAM_PHONE
  );
  const [mutUnblockPhone, stUnblockPhone] = useMutation<UnblockScamPhoneData, { input: UnblockScamPhoneInput }>(
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

  const unblockPhone = React.useCallback(
    async ({ phone }: { phone: string }) => {
      const p = normalizeTel(phone);
      if (!p) throw new Error("Invalid phone");

      const clientId = getJachoeiClientId();
      if (!clientId) throw new Error("Missing client_id");

      const res = await mutUnblockPhone({
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
    [mutUnblockPhone]
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
        reportPhone: !!stReportPhone.loading,
        unblockPhone: !!stUnblockPhone.loading,
        reportBank: !!stReportBank.loading,
        unreportBank: !!stUnreportBank.loading,
      };
      return { ...l, any: l.reportPhone || l.unblockPhone || l.reportBank || l.unreportBank };
    },
    [stReportPhone.loading, stUnblockPhone.loading, stReportBank.loading, stUnreportBank.loading]
  );

  return { reportPhone, unblockPhone, reportBank, unreportBank, loading };
}
