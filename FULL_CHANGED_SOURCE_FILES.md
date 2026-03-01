# Full changed source files
- Repo: `/Users/s0mkidd/Desktop/Projects/next-apollo-pg-ws`
- Git HEAD: `0a9388a9`
- Generated (UTC): `2026-03-01T07:50:51.038093+00:00`
- Extensions: `js, jsx, ts, tsx`

## apps/web/app/(main)/blocked/page.tsx

```tsx
"use client";

import * as React from "react";

import { gql, useQuery } from "@apollo/client";
import {
  Badge,
  Button,
  Card,
  Divider,
  Empty,
  Grid,
  Input,
  List,
  Segmented,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import {
  ExclamationCircleOutlined,
  SearchOutlined,
  PhoneOutlined,
  BankOutlined,
  LockOutlined,
  SoundOutlined,
} from "@ant-design/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useSessionCtx } from "@/lib/session-context";

import { TelBlockDialog } from "@/components/jachoei/TelBlockDialog";
import type { TelBlockDialogValue } from "@/components/jachoei/TelBlockDialog";

import { BankReportDialog } from "@/components/jachoei/BankReportDialog";
import type { BankReportDialogValue } from "@/components/jachoei/BankReportDialog";

import { useJachoeiLocalState } from "@/app/hooks/useJachoeiLocalState";
import { useJachoeiMutations } from "@/app/hooks/useJachoeiMutations";
import {
  getDontAskAgainForTel,
  normalizeBank,
  normalizeTel,
  setDontAskAgainForTel,
} from "@/app/lib/jachoeiLocalState";

const { useBreakpoint } = Grid;

const Q_MY_BLOCKED_PHONES = gql`
  query MyBlockedPhones($limit: Int, $offset: Int) {
    myBlockedPhones(limit: $limit, offset: $offset) {
      phone
      phone_normalized
      my_blocked
      my_blocked_at
      report_count
      last_report_at
      risk_level
      updated_at
    }
  }
`;

const Q_MY_REPORTED_PHONES = gql`
  query MyReportedPhones($limit: Int!, $offset: Int!) {
    myReportedPhones(limit: $limit, offset: $offset) {
      phone
      created_at
      updated_at
      report_count
      risk_level
      tags
      category
      note
      post_id
    }
  }
`;

const Q_MY_REPORTED_BANK_ACCOUNTS = gql`
  query MyReportedBankAccounts($limit: Int!, $offset: Int!) {
    myReportedBankAccounts(limit: $limit, offset: $offset) {
      account
      bank_name
      created_at
      updated_at
      report_count
      risk_level
      tags
      category
      note
      post_id
    }
  }
`;

type PhoneSafetyStatus = {
  phone: string;
  phone_normalized: string;
  my_blocked: boolean;
  my_blocked_at?: string | null;
  report_count: number;
  last_report_at?: string | null;
  risk_level: number;
  updated_at: string;
};

type MyBlockedPhonesResponse = {
  myBlockedPhones: PhoneSafetyStatus[];
};

type MyReportedPhone = {
  phone: string;
  created_at: string;
  updated_at: string;
  report_count: number;
  risk_level: number;
  tags: string[];
  category: string;
  note?: string | null;
  post_id?: string | null;
};

type MyReportedBankAccount = {
  account: string;
  bank_name: string;
  created_at: string;
  updated_at: string;
  report_count: number;
  risk_level: number;
  tags: string[];
  category?: string | null;
  note?: string | null;
  post_id?: string | null;
};

type MyReportedPhonesResponse = {
  myReportedPhones: MyReportedPhone[];
};

type MyReportedBankAccountsResponse = {
  myReportedBankAccounts: MyReportedBankAccount[];
};

type RiskFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW";

type SortMode = "Latest" | "Risk" | "Reports";

type TabKey = "blocked" | "reports";

type TelDialogState = {
  open: boolean;
  tel: string;
  dontAskStored: boolean;
};

type BankDialogState = {
  open: boolean;
  bankName: string | null;
  account: string;
};

function toDigitsForSearch(input: string): string {
  return String(input ?? "").replace(/[^\d+]/g, "");
}

function riskBucket(score: number): Exclude<RiskFilter, "ALL"> {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function riskLabel(score: number): { text: string; color: "red" | "gold" | "green" } {
  const bucket = riskBucket(score);
  if (bucket === "HIGH") return { text: "HIGH", color: "red" };
  if (bucket === "MEDIUM") return { text: "MEDIUM", color: "gold" };
  return { text: "LOW", color: "green" };
}

function parseIsoToMs(iso?: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function formatDateShort(iso?: string | null): string {
  const ms = parseIsoToMs(iso);
  if (!ms) return "-";
  return new Date(ms).toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export default function BlockedPage() {
  const { user } = useSessionCtx();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const jachoei = useJachoeiLocalState();
  const jachoeiMut = useJachoeiMutations();

  const nextUrl = React.useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  const tab = React.useMemo<TabKey>(() => {
    const raw = String(searchParams.get("tab") ?? "blocked").toLowerCase();
    return raw === "reports" ? "reports" : "blocked";
  }, [searchParams]);

  const setTab = React.useCallback(
    (next: TabKey) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  const requireAuthOrRedirect = React.useCallback((): boolean => {
    if (user) return true;
    router.push(`/login?next=${encodeURIComponent(nextUrl)}`);
    return false;
  }, [nextUrl, router, user]);

  React.useEffect(() => {
    if (!user) router.push(`/login?next=${encodeURIComponent(nextUrl)}`);
  }, [nextUrl, router, user]);

  const {
    data: blockedData,
    loading: blockedLoading,
    error: blockedError,
    refetch: refetchBlocked,
  } = useQuery<MyBlockedPhonesResponse>(Q_MY_BLOCKED_PHONES, {
    variables: { limit: 200, offset: 0 },
    skip: !user || tab !== "blocked",
    fetchPolicy: "cache-and-network",
  });

  const {
    data: reportedPhonesData,
    loading: reportedPhonesLoading,
    error: reportedPhonesError,
    refetch: refetchReportedPhones,
  } = useQuery<MyReportedPhonesResponse>(Q_MY_REPORTED_PHONES, {
    variables: { limit: 200, offset: 0 },
    skip: !user || tab !== "reports",
    fetchPolicy: "cache-and-network",
  });

  const {
    data: reportedBanksData,
    loading: reportedBanksLoading,
    error: reportedBanksError,
    refetch: refetchReportedBanks,
  } = useQuery<MyReportedBankAccountsResponse>(Q_MY_REPORTED_BANK_ACCOUNTS, {
    variables: { limit: 200, offset: 0 },
    skip: !user || tab !== "reports",
    fetchPolicy: "cache-and-network",
  });

  const [search, setSearch] = React.useState<string>("");
  const [risk, setRisk] = React.useState<RiskFilter>("ALL");
  const [sort, setSort] = React.useState<SortMode>("Latest");

  const [optimisticallyRemoved, setOptimisticallyRemoved] = React.useState<Set<string>>(() => new Set());
  const [optimisticallyRemovedBanks, setOptimisticallyRemovedBanks] = React.useState<Set<string>>(() => new Set());

  const [telDialog, setTelDialog] = React.useState<TelDialogState>({
    open: false,
    tel: "",
    dontAskStored: false,
  });

  const [bankDialog, setBankDialog] = React.useState<BankDialogState>({
    open: false,
    bankName: null,
    account: "",
  });

  const performTelConfirm = React.useCallback(
    async (telRaw: string, value: TelBlockDialogValue): Promise<boolean> => {
      const tel = normalizeTel(telRaw);
      if (!tel) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getBlockedTelEntry(tel);
      const wasBlocked = jachoei.isBlockedTel(tel);

      const wantReport = !!value.wantReport;
      const nextCategory = wantReport ? value.category : undefined;
      const nextNote = wantReport ? value.note : "";

      const optimisticEntry = {
        wantReport,
        category: nextCategory,
        note: nextNote,
        blockedAt: prevEntry?.blockedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      jachoei.setBlockedTelEntry(tel, optimisticEntry);
      setOptimisticallyRemoved((prev) => {
        const next = new Set(prev);
        next.delete(tel);
        return next;
      });

      try {
        const payload = await jachoeiMut.reportPhone({
          phone: tel,
          category: nextCategory,
          note: wantReport ? nextNote : null,
        });

        jachoei.setBlockedTelEntry(tel, {
          ...optimisticEntry,
          blockedAt: payload.updated_at ?? optimisticEntry.blockedAt,
          ctx: payload.ctx ?? optimisticEntry.ctx,
          tags: payload.tags ?? optimisticEntry.tags,
        });

        message.success(wasBlocked ? "Updated report" : "Blocked");
        void refetchBlocked?.();
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setBlockedTelEntry(tel, prevEntry);
        else jachoei.removeBlockedTelEntry(tel);

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, refetchBlocked, requireAuthOrRedirect]
  );

  const performTelUndo = React.useCallback(
    async (telRaw: string): Promise<boolean> => {
      const tel = normalizeTel(telRaw);
      if (!tel) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getBlockedTelEntry(tel);
      const wasBlocked = jachoei.isBlockedTel(tel);

      // optimistic hide + local remove
      setOptimisticallyRemoved((prev) => {
        const next = new Set(prev);
        next.add(tel);
        return next;
      });
      jachoei.removeBlockedTelEntry(tel);

      try {
        await jachoeiMut.unblockPhone({ phone: tel });
        message.success("Unblocked");
        void refetchBlocked?.();
        return true;
      } catch (err: unknown) {
        // rollback UI + local
        setOptimisticallyRemoved((prev) => {
          const next = new Set(prev);
          next.delete(tel);
          return next;
        });

        if (prevEntry) jachoei.setBlockedTelEntry(tel, prevEntry);
        else if (wasBlocked) jachoei.setBlockedTelEntry(tel, {});

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, refetchBlocked, requireAuthOrRedirect]
  );

  const openTelManage = React.useCallback(
    (telRaw: string) => {
      const tel = normalizeTel(telRaw);
      if (!tel) return;
      if (!requireAuthOrRedirect()) return;

      const skipConfirm = getDontAskAgainForTel(tel);
      setTelDialog({ open: true, tel, dontAskStored: skipConfirm });
    },
    [requireAuthOrRedirect]
  );

  const apiItems = React.useMemo<PhoneSafetyStatus[]>(() => {
    const rows = blockedData?.myBlockedPhones ?? [];
    return Array.isArray(rows) ? rows.filter((r) => r && r.my_blocked) : [];
  }, [blockedData]);

  const mergedItems = React.useMemo(() => {
    const byTel = new Map<string, PhoneSafetyStatus>();

    for (const r of apiItems) {
      const key = normalizeTel(r.phone_normalized || r.phone);
      if (!key) continue;
      byTel.set(key, {
        ...r,
        phone: r.phone || key,
        phone_normalized: key,
        report_count: Number(r.report_count || 0),
        risk_level: Number(r.risk_level || 0),
        updated_at: r.updated_at || new Date().toISOString(),
      });
    }

    // fallback / merge in local-only entries
    for (const tel of jachoei.blockedTelSet) {
      const key = normalizeTel(tel);
      if (!key) continue;
      if (byTel.has(key)) continue;

      const entry = jachoei.getBlockedTelEntry(key);
      const ts = entry?.blockedAt ?? null;

      byTel.set(key, {
        phone: key,
        phone_normalized: key,
        my_blocked: true,
        my_blocked_at: ts,
        report_count: 0,
        last_report_at: null,
        risk_level: 0,
        updated_at: ts ?? new Date().toISOString(),
      });
    }

    const list = Array.from(byTel.values()).filter((r) => {
      const key = normalizeTel(r.phone_normalized || r.phone);
      return key ? !optimisticallyRemoved.has(key) : false;
    });

    return list;
  }, [apiItems, jachoei, optimisticallyRemoved]);

  const filtered = React.useMemo(() => {
    const q = toDigitsForSearch(search);

    const out = mergedItems.filter((r) => {
      const tel = String(r.phone ?? "");
      const matchSearch = !q || toDigitsForSearch(tel).includes(q);

      if (!matchSearch) return false;

      if (risk === "ALL") return true;
      return riskBucket(Number(r.risk_level || 0)) === risk;
    });

    out.sort((a, b) => {
      if (sort === "Reports") return Number(b.report_count || 0) - Number(a.report_count || 0);
      if (sort === "Risk") return Number(b.risk_level || 0) - Number(a.risk_level || 0);

      // Latest
      const ta = parseIsoToMs(a.my_blocked_at || a.updated_at);
      const tb = parseIsoToMs(b.my_blocked_at || b.updated_at);
      return tb - ta;
    });

    return out;
  }, [mergedItems, risk, search, sort]);

  const count = mergedItems.length;

  const reportItems = React.useMemo(() => {
    const phones = Array.isArray(reportedPhonesData?.myReportedPhones) ? reportedPhonesData?.myReportedPhones ?? [] : [];
    const banks = Array.isArray(reportedBanksData?.myReportedBankAccounts)
      ? reportedBanksData?.myReportedBankAccounts ?? []
      : [];

    const combined: Array<
      | { kind: "TEL"; key: string; phone: string; updated_at: string; created_at: string; report_count: number; risk_level: number }
      | { kind: "BANK"; key: string; account: string; bank_name: string; updated_at: string; created_at: string; report_count: number; risk_level: number }
    > = [];

    for (const p of phones) {
      const phone = String(p.phone ?? "").trim();
      if (!phone) continue;
      combined.push({
        kind: "TEL",
        key: `TEL:${phone}`,
        phone,
        created_at: String(p.created_at ?? ""),
        updated_at: String(p.updated_at ?? ""),
        report_count: Number(p.report_count ?? 0),
        risk_level: Number(p.risk_level ?? 0),
      });
    }

    for (const b of banks) {
      const account = normalizeBank(String(b.account ?? "").trim()) ?? "";
      const bank_name = String(b.bank_name ?? "").trim() || "UNKNOWN";
      if (!account) continue;
      if (optimisticallyRemovedBanks.has(account)) continue;

      combined.push({
        kind: "BANK",
        key: `BANK:${bank_name}:${account}`,
        account,
        bank_name,
        created_at: String(b.created_at ?? ""),
        updated_at: String(b.updated_at ?? ""),
        report_count: Number(b.report_count ?? 0),
        risk_level: Number(b.risk_level ?? 0),
      });
    }

    combined.sort((a, b) => parseIsoToMs(b.updated_at) - parseIsoToMs(a.updated_at));
    return combined;
  }, [optimisticallyRemovedBanks, reportedBanksData, reportedPhonesData]);

  const reportCount = reportItems.length;

  const openBankManage = React.useCallback(
    (bankName: string | null | undefined, accountRaw: string) => {
      if (!requireAuthOrRedirect()) return;
      const account = normalizeBank(String(accountRaw ?? "").trim()) ?? "";
      if (!account) return;
      setBankDialog({ open: true, bankName: bankName ?? null, account });
    },
    [requireAuthOrRedirect]
  );

  const performBankConfirm = React.useCallback(
    async (bankName: string | null | undefined, accountRaw: string, value: BankReportDialogValue): Promise<boolean> => {
      const account = normalizeBank(String(accountRaw ?? "").trim()) ?? "";
      if (!account) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getReportedBankEntry(account);
      const wasReported = jachoei.isReportedBank(account);

      const optimisticEntry = {
        bank_name: bankName ?? prevEntry?.bank_name ?? null,
        category: value.category,
        note: value.note,
        reportedAt: prevEntry?.reportedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      jachoei.setReportedBankEntry(account, optimisticEntry);
      setOptimisticallyRemovedBanks((prev) => {
        const next = new Set(prev);
        next.delete(account);
        return next;
      });

      try {
        const payload = await jachoeiMut.reportBank({
          account,
          bankName,
          category: value.category,
          note: value.note,
        });

        jachoei.setReportedBankEntry(account, {
          ...optimisticEntry,
          bank_name: payload.bank_name ?? optimisticEntry.bank_name,
          reportedAt: payload.updated_at ?? optimisticEntry.reportedAt,
          ctx: payload.ctx ?? optimisticEntry.ctx,
          tags: payload.tags ?? optimisticEntry.tags,
        });

        message.success(wasReported ? "Updated report" : "Reported");
        void refetchReportedPhones?.();
        void refetchReportedBanks?.();
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setReportedBankEntry(account, prevEntry);
        else jachoei.removeReportedBankEntry(account);

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, refetchReportedBanks, refetchReportedPhones, requireAuthOrRedirect]
  );

  const performBankUndo = React.useCallback(
    async (bankName: string | null | undefined, accountRaw: string): Promise<boolean> => {
      const account = normalizeBank(String(accountRaw ?? "").trim()) ?? "";
      if (!account) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getReportedBankEntry(account);
      const wasReported = jachoei.isReportedBank(account);

      setOptimisticallyRemovedBanks((prev) => {
        const next = new Set(prev);
        next.add(account);
        return next;
      });
      jachoei.removeReportedBankEntry(account);

      try {
        await jachoeiMut.unreportBank({
          account,
          bankName,
          category: prevEntry?.category,
          reason: prevEntry?.note ?? null,
        });
        message.success("Unreported");
        void refetchReportedPhones?.();
        void refetchReportedBanks?.();
        return true;
      } catch (err: unknown) {
        setOptimisticallyRemovedBanks((prev) => {
          const next = new Set(prev);
          next.delete(account);
          return next;
        });

        if (prevEntry) jachoei.setReportedBankEntry(account, prevEntry);
        else if (wasReported) jachoei.setReportedBankEntry(account, { bank_name: bankName ?? null });

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, refetchReportedBanks, refetchReportedPhones, requireAuthOrRedirect]
  );

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 900,
        margin: "0 auto",
        padding: isMobile ? 12 : 24,
      }}
    >
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
        <Segmented
          size={isMobile ? "small" : "middle"}
          value={tab}
          options={[
            {
              value: "blocked",
              label: (
                <Space size={6} align="center">
                  <LockOutlined />
                  <span>Blocked</span>
                </Space>
              ),
            },
            {
              value: "reports",
              label: (
                <Space size={6} align="center">
                  <SoundOutlined />
                  <span>My Reports</span>
                </Space>
              ),
            },
          ] satisfies Array<{ value: TabKey; label: React.ReactNode }>}
          onChange={(v) => setTab(v as TabKey)}
        />
      </div>

      <Card
        title={
          <Space size={10} align="center">
            <Typography.Text strong style={{ fontSize: isMobile ? 16 : 18 }}>
              {tab === "blocked" ? "Blocked (เบอร์ที่บล็อก)" : "My Reports (รายการที่ฉันรายงาน)"}
            </Typography.Text>
            <Badge count={tab === "blocked" ? count : reportCount} showZero />
          </Space>
        }
        loading={
          tab === "blocked"
            ? blockedLoading && !blockedError && !blockedData
            : (reportedPhonesLoading || reportedBanksLoading) && !reportedPhonesError && !reportedBanksError
        }
        bodyStyle={{ padding: isMobile ? 12 : 16 }}
      >
        {tab === "blocked" ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Search blocked phone numbers"
            />

            <Space size={6} wrap>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Filter:
              </Typography.Text>
              {(["ALL", "HIGH", "MEDIUM", "LOW"] as const).map((k) => (
                <Tag.CheckableTag
                  key={k}
                  checked={risk === k}
                  onChange={() => setRisk(k)}
                  style={{ userSelect: "none" }}
                >
                  {k}
                </Tag.CheckableTag>
              ))}
            </Space>

            <Space size={10} wrap align="center">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Sort:
              </Typography.Text>
              <Segmented
                size={isMobile ? "small" : "middle"}
                value={sort}
                options={["Latest", "Risk", "Reports"] satisfies SortMode[]}
                onChange={(v) => setSort(v as SortMode)}
              />
            </Space>

            <Divider style={{ margin: "8px 0" }} />

            {blockedError && jachoei.blockedTelSet.size > 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                <ExclamationCircleOutlined /> ใช้ข้อมูลจากเครื่อง (local) ชั่วคราว เพราะโหลดจากเซิร์ฟเวอร์ไม่สำเร็จ
              </Typography.Text>
            ) : null}

            {filtered.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space direction="vertical" size={4}>
                    <Typography.Text strong>ยังไม่มีรายการ</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      เมื่อคุณบล็อกเบอร์โทรศัพท์ รายการจะมาแสดงที่หน้านี้
                    </Typography.Text>
                  </Space>
                }
              />
            ) : (
              <List
                dataSource={filtered}
                itemLayout="horizontal"
                renderItem={(item) => {
                  const telRaw = String(item.phone || "");
                  const telNorm = normalizeTel(item.phone_normalized || telRaw);
                  const { text: rText, color: rColor } = riskLabel(Number(item.risk_level || 0));

                  const canAct = !!telNorm;

                  return (
                    <List.Item
                      actions={[
                        <Button
                          key="manage"
                          size={isMobile ? "small" : "middle"}
                          disabled={!canAct}
                          onClick={() => openTelManage(telRaw)}
                        >
                          Manage
                        </Button>,
                        <Button
                          key="unblock"
                          size={isMobile ? "small" : "middle"}
                          danger
                          disabled={!canAct}
                          loading={jachoeiMut.loading.unblockPhone}
                          onClick={() => {
                            void performTelUndo(telRaw);
                          }}
                        >
                          Unblock
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<PhoneOutlined style={{ fontSize: 18 }} />}
                        title={
                          <Space size={8} wrap>
                            <Typography.Text strong>{telRaw}</Typography.Text>
                            <Tag color={rColor} style={{ marginInlineEnd: 0 }}>
                              {rText}
                            </Tag>
                          </Space>
                        }
                        description={
                          <Space size={10} wrap>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              Reports: {Number(item.report_count || 0).toLocaleString("th-TH")}
                            </Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              Last: {formatDateShort(item.last_report_at)}
                            </Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              Blocked: {formatDateShort(item.my_blocked_at)}
                            </Typography.Text>
                          </Space>
                        }
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </Space>
        ) : (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {reportedPhonesError || reportedBanksError ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                <ExclamationCircleOutlined /> โหลดข้อมูล My Reports ไม่สำเร็จ
              </Typography.Text>
            ) : null}

            <Divider style={{ margin: "8px 0" }} />

            {reportItems.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space direction="vertical" size={4}>
                    <Typography.Text strong>ยังไม่มีรายการ</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      เมื่อคุณรายงานเบอร์โทรหรือบัญชีธนาคาร รายการจะมาแสดงที่หน้านี้
                    </Typography.Text>
                  </Space>
                }
              />
            ) : (
              <List
                dataSource={reportItems}
                itemLayout="horizontal"
                renderItem={(item) => {
                  const { text: rText, color: rColor } = riskLabel(Number(item.risk_level || 0));

                  if (item.kind === "TEL") {
                    const tel = item.phone;
                    const isBlocked = jachoei.isBlockedTel(tel);
                    return (
                      <List.Item
                        actions={[
                          <Button
                            key="manage"
                            size={isMobile ? "small" : "middle"}
                            onClick={() => openTelManage(tel)}
                          >
                            Manage
                          </Button>,
                          isBlocked ? (
                            <Button
                              key="unblock"
                              size={isMobile ? "small" : "middle"}
                              danger
                              loading={jachoeiMut.loading.unblockPhone}
                              onClick={() => void performTelUndo(tel)}
                            >
                              Unblock
                            </Button>
                          ) : null,
                        ].filter(Boolean)}
                      >
                        <List.Item.Meta
                          avatar={<PhoneOutlined style={{ fontSize: 18 }} />}
                          title={
                            <Space size={8} wrap>
                              <Tag style={{ marginInlineEnd: 0 }}>TEL</Tag>
                              <Typography.Text strong>{tel}</Typography.Text>
                              <Tag color={rColor} style={{ marginInlineEnd: 0 }}>
                                {rText}
                              </Tag>
                            </Space>
                          }
                          description={
                            <Space size={10} wrap>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                Reports: {Number(item.report_count || 0).toLocaleString("th-TH")}
                              </Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                Updated: {formatDateShort(item.updated_at)}
                              </Typography.Text>
                            </Space>
                          }
                        />
                      </List.Item>
                    );
                  }

                  const account = item.account;
                  const bankName = item.bank_name;
                  const reportedOnDevice = jachoei.isReportedBank(account);

                  return (
                    <List.Item
                      actions={[
                        <Button
                          key="manage"
                          size={isMobile ? "small" : "middle"}
                          onClick={() => openBankManage(bankName, account)}
                        >
                          Manage
                        </Button>,
                        <Button
                          key="undo"
                          size={isMobile ? "small" : "middle"}
                          danger
                          loading={jachoeiMut.loading.unreportBank}
                          onClick={() => void performBankUndo(bankName, account)}
                        >
                          Undo report
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<BankOutlined style={{ fontSize: 18 }} />}
                        title={
                          <Space size={8} wrap>
                            <Tag style={{ marginInlineEnd: 0 }}>BANK</Tag>
                            <Typography.Text strong>
                              {bankName} · {account}
                            </Typography.Text>
                            <Tag color={rColor} style={{ marginInlineEnd: 0 }}>
                              {rText}
                            </Tag>
                            {reportedOnDevice ? (
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                (device)
                              </Typography.Text>
                            ) : null}
                          </Space>
                        }
                        description={
                          <Space size={10} wrap>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              Reports: {Number(item.report_count || 0).toLocaleString("th-TH")}
                            </Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              Updated: {formatDateShort(item.updated_at)}
                            </Typography.Text>
                          </Space>
                        }
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </Space>
        )}
      </Card>

      <TelBlockDialog
        open={telDialog.open}
        tel={telDialog.tel}
        blocked={telDialog.tel ? jachoei.isBlockedTel(normalizeTel(telDialog.tel)) : false}
        defaultDontAskAgain={telDialog.dontAskStored}
        initialWantReport={jachoei.getBlockedTelEntry(telDialog.tel)?.wantReport}
        initialCategory={jachoei.getBlockedTelEntry(telDialog.tel)?.category}
        initialNote={jachoei.getBlockedTelEntry(telDialog.tel)?.note}
        confirmLoading={jachoeiMut.loading.reportPhone}
        undoLoading={jachoeiMut.loading.unblockPhone}
        onCancel={() => setTelDialog({ open: false, tel: "", dontAskStored: false })}
        onConfirm={(value) => {
          const tel = normalizeTel(telDialog.tel);
          if (!tel) return;
          if (!requireAuthOrRedirect()) return;

          setDontAskAgainForTel(tel, value.dontAskAgain);
          void performTelConfirm(tel, value).then((ok) => {
            if (ok) setTelDialog({ open: false, tel: "", dontAskStored: false });
          });
        }}
        onUndo={() => {
          const tel = normalizeTel(telDialog.tel);
          if (!tel) return;
          if (!requireAuthOrRedirect()) return;

          void performTelUndo(tel).then((ok) => {
            if (ok) setTelDialog({ open: false, tel: "", dontAskStored: false });
          });
        }}
      />

      <BankReportDialog
        open={bankDialog.open}
        bankName={bankDialog.bankName}
        account={bankDialog.account}
        reported={jachoei.isReportedBank(bankDialog.account)}
        initialCategory={jachoei.getReportedBankEntry(bankDialog.account)?.category}
        initialNote={jachoei.getReportedBankEntry(bankDialog.account)?.note}
        confirmLoading={jachoeiMut.loading.reportBank}
        undoLoading={jachoeiMut.loading.unreportBank}
        onCancel={() => setBankDialog({ open: false, bankName: null, account: "" })}
        onConfirm={(value) => {
          const account = normalizeBank(String(bankDialog.account ?? "").trim()) ?? "";
          if (!account) return;
          if (!requireAuthOrRedirect()) return;

          void performBankConfirm(bankDialog.bankName, account, value).then((ok) => {
            if (ok) setBankDialog({ open: false, bankName: null, account: "" });
          });
        }}
        onUndo={() => {
          const account = normalizeBank(String(bankDialog.account ?? "").trim()) ?? "";
          if (!account) return;
          if (!requireAuthOrRedirect()) return;

          void performBankUndo(bankDialog.bankName, account).then((ok) => {
            if (ok) setBankDialog({ open: false, bankName: null, account: "" });
          });
        }}
      />
    </div>
  );
}
```

## apps/web/app/(main)/page.tsx

```tsx
"use client";

import { gql, useQuery, useMutation } from "@apollo/client";
import {
  Table,
  Space,
  Button,
  Tag,
  Popconfirm,
  message,
  Tooltip,
  Typography,
  Badge,
  Grid,
  List,
  Card,
  Modal,
  Divider,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import {
  CommentOutlined,
  EditOutlined,
  DeleteOutlined,
  MessageOutlined,
  PhoneOutlined,
  BankOutlined,
  FacebookFilled,
  ShareAltOutlined,
  CopyOutlined,
  LinkOutlined,
  LockOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";

import ThumbGrid from "@/components/ThumbGrid";
import BookmarkButton from "@/components/BookmarkButton";
import { useSessionCtx } from "@/lib/session-context";

import { TelBlockDialog } from "@/components/jachoei/TelBlockDialog";
import { BankReportDialog } from "@/components/jachoei/BankReportDialog";

import type { BankReportDialogValue } from "@/components/jachoei/BankReportDialog";
import type { TelBlockDialogValue } from "@/components/jachoei/TelBlockDialog";

import { useJachoeiLocalState } from "../hooks/useJachoeiLocalState";
import { useJachoeiMutations } from "../hooks/useJachoeiMutations";
import {
  getDontAskAgainForTel,
  normalizeBank,
  normalizeTel,
  setDontAskAgainForTel,
} from "../lib/jachoeiLocalState";

const { Text, Paragraph } = Typography;
const { useBreakpoint } = Grid;

const DELETE_POST = gql`
  mutation ($id: ID!) {
    deletePost(id: $id)
  }
`;

const Q_POSTS_PAGED = gql`
  query ($q: String, $limit: Int!, $offset: Int!) {
    postsPaged(search: $q, limit: $limit, offset: $offset) {
      total
      items {
        id
        title
        detail
        status
        is_bookmarked
        created_at
        images {
          id
          url
        }
        author {
          id
          name
          avatar
        }
        tel_numbers {
          id
          tel
        }
        seller_accounts {
          id
          bank_name
          seller_account
        }
        comments_count

        fb_permalink_url
        fb_published_at
        fb_status
        fb_social_post_id
      }
    }
  }
`;

type PostImage = { id: string; url: string };
type PostAuthor = { id: string; name?: string | null; avatar?: string | null };
type PostTelNumber = { id: string; tel: string };
type PostSellerAccount = {
  id: string;
  bank_name?: string | null;
  seller_account?: string | null;
};

type PostsPagedItem = {
  id: string;
  title?: string | null;
  detail?: string | null;
  status?: string | null;
  is_bookmarked?: boolean | null;
  created_at?: string | null;
  images?: PostImage[] | null;
  author?: PostAuthor | null;
  tel_numbers?: PostTelNumber[] | null;
  seller_accounts?: PostSellerAccount[] | null;
  comments_count?: number | null;
  fb_permalink_url?: string | null;
  fb_published_at?: string | null;
  fb_status?: string | null;
  fb_social_post_id?: string | null;
};

type PostsPagedResponse = {
  postsPaged: {
    total: number;
    items: PostsPagedItem[];
  };
};

type PostsPagedVars = {
  q?: string | null;
  limit: number;
  offset: number;
};

// map status -> tag color
const statusColor = (status?: string | null) => {
  switch ((status || "").toUpperCase()) {
    case "PENDING":
      return "gold";
    case "BLOCKED":
    case "BANNED":
      return "red";
    case "VERIFIED":
    case "OK":
      return "green";
    default:
      return "default";
  }
};

const fbStatusColor = (status?: string | null) => {
  switch ((status || "").toUpperCase()) {
    case "PUBLISHED":
      return "green";
    case "PENDING":
      return "gold";
    case "FAILED":
    case "DELETED_FAILED":
      return "red";
    case "SKIPPED":
      return "default";
    default:
      return "default";
  }
};

function isFacebookPublished(r: PostsPagedItem) {
  return String(r?.fb_status ?? "").toUpperCase() === "PUBLISHED" && !!r?.fb_permalink_url;
}

function maskAccountForDisplay(accountRaw: string): string {
  const s = String(accountRaw ?? "").trim();
  if (!s) return "";

  const digits = s.replace(/[^\d]/g, "");
  if (digits.length <= 6) return s;

  const head = digits.slice(0, 3);
  const tail = digits.slice(-3);
  return `${head} •••• ${tail}`;
}

// Tel list helper (ใช้ได้ทั้ง desktop + mobile)
const TelList = ({
  items,
  isBlocked,
  onOpenBlock,
}: {
  items: PostTelNumber[] | undefined;
  isBlocked: (telRaw: string) => boolean;
  onOpenBlock: (telRaw: string) => void;
}) => {
  const { token } = theme.useToken();
  const list = (items || []).filter(Boolean);
  if (!list.length) return <Text type="secondary">-</Text>;

  const visible = list.slice(0, 3);
  const hidden = list.slice(3);

  const renderChip = (telRaw: string) => {
    const blocked = isBlocked(telRaw);

    return (
      <div
        style={{
          height: 42,
          width: "100%",
          borderRadius: 10,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
          padding: "6px 10px",
          display: "table-cell",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Space size={8} style={{ minWidth: 0, flex: 1 }}>
          <PhoneOutlined style={{ color: token.colorTextSecondary }} />
          <Text ellipsis={{ tooltip: telRaw }} style={{ minWidth: 0, flex: 1, fontSize: 13 }}>
            {telRaw}
          </Text>

          <Tooltip title="Copy">
            <Button
              aria-label={`Copy tel ${telRaw}`}
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  await navigator.clipboard.writeText(String(telRaw ?? "").trim());
                  message.success("Copied");
                } catch {
                  message.error("Copy failed");
                }
              }}
            />
          </Tooltip>
        </Space>

        <Space size={8} align="center">
          {blocked ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 26,
                padding: "0 10px",
                borderRadius: 999,
                border: `1px solid ${token.colorErrorBorder}`,
                background: token.colorBgContainer,
                color: token.colorErrorText,
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              <LockOutlined />
              <span>บล็อกแล้ว</span>
            </div>
          ) : null}

          <Button
            aria-label={blocked ? `Manage tel ${telRaw}` : `Block tel ${telRaw}`}
            type="text"
            size="small"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenBlock(telRaw);
            }}
            style={{
              paddingInline: 8,
              height: 28,
              borderRadius: 999,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
            }}
          >
            {blocked ? "จัดการ" : "บล็อก"}
          </Button>
        </Space>
      </div>
    );
  };

  return (
    <>
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        {visible.map((t) => (
          <div key={t.id || t.tel}>{renderChip(t.tel)}</div>
        ))}
      </Space>

      {hidden.length > 0 && (
        <Tooltip
          placement="bottom"
          title={
            <Space direction="vertical" size={6} style={{ width: 320, maxWidth: "100%" }}>
              {hidden.map((t) => (
                <div key={t.id || t.tel}>{renderChip(t.tel)}</div>
              ))}
            </Space>
          }
        >
          <span style={{ fontSize: 12, color: "#999" }}>+{hidden.length} more</span>
        </Tooltip>
      )}
    </>
  );
};

const BankList = ({
  items,
  isReported,
  onOpenReport,
}: {
  items: PostSellerAccount[] | undefined;
  isReported: (accountRaw: string) => boolean;
  onOpenReport: (bankName: string | null | undefined, accountRaw: string) => void;
}) => {
  const { token } = theme.useToken();
  const list = (items || []).filter(Boolean);
  if (!list.length) return <Text type="secondary">-</Text>;

  const visible = list.slice(0, 3);
  const hidden = list.slice(3);

  const renderChip = (bankName: string | null | undefined, accountRaw: string) => {
    const reported = isReported(accountRaw);
    const bankLabel = String(bankName ?? "").trim();
    const accountLabel = maskAccountForDisplay(accountRaw) || String(accountRaw ?? "").trim();
    const displayText = bankLabel ? `${bankLabel} • ${accountLabel}` : accountLabel;

    return (
      <div
        style={{
          height: 42,
          width: "100%",
          borderRadius: 10,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
          padding: "6px 10px",
          display: "table-cell",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Space size={8} style={{ minWidth: 0, flex: 1 }}>
          <BankOutlined style={{ color: token.colorTextSecondary }} />
          <Text ellipsis={{ tooltip: displayText }} style={{ minWidth: 0, flex: 1, fontSize: 13 }}>
            {displayText || "-"}
          </Text>

          <Tooltip title="Copy">
            <Button
              aria-label={`Copy bank account ${accountRaw}`}
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  await navigator.clipboard.writeText(String(accountRaw ?? "").trim());
                  message.success("Copied");
                } catch {
                  message.error("Copy failed");
                }
              }}
            />
          </Tooltip>
        </Space>

        <Space size={8} align="center">
          {reported ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 26,
                padding: "0 10px",
                borderRadius: 999,
                border: `1px solid ${token.colorSuccessBorder}`,
                background: token.colorBgContainer,
                color: token.colorSuccessText,
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              <CheckCircleOutlined />
              <span>รายงานแล้ว</span>
            </div>
          ) : null}

          <Button
            aria-label={
              reported
                ? `Undo report bank account ${accountRaw}`
                : `Report bank account ${accountRaw}`
            }
            type="text"
            size="small"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenReport(bankName ?? null, accountRaw);
            }}
            style={{
              paddingInline: 8,
              height: 28,
              borderRadius: 999,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
            }}
          >
            {reported ? "ยกเลิกรายงาน" : "รายงาน"}
          </Button>
        </Space>
      </div>
    );
  };

  const renderList = (data: PostSellerAccount[]) => (
    <Space direction="vertical" size={6} style={{ width: "100%" }}>
      {data.map((acc) => (
        <div key={acc.id || `${acc.bank_name || ""}-${acc.seller_account || ""}`}
          style={{ width: "100%" }}
        >
          {renderChip(acc.bank_name ?? null, acc.seller_account ?? "")}
        </div>
      ))}
    </Space>
  );

  return (
    <>
      {renderList(visible)}
      {hidden.length > 0 && (
        <Tooltip placement="bottom" title={renderList(hidden)}>
          <span style={{ fontSize: 12, color: "#999" }}>+{hidden.length} more</span>
        </Tooltip>
      )}
    </>
  );
};

function FacebookIconAction({ r }: { r: PostsPagedItem }) {
  const published = isFacebookPublished(r);
  const href = r?.fb_permalink_url;

  const tooltip = published
    ? "Open Facebook post"
    : r?.fb_status
      ? `Facebook: ${r.fb_status}`
      : "Facebook: not published";

  if (published && href) {
    return (
      <Tooltip title={tooltip}>
        <Button
          type="text"
          size="small"
          icon={<FacebookFilled />}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.open(href, "_blank", "noopener,noreferrer");
          }}
        />
      </Tooltip>
    );
  }

  return (
    <Tooltip title={tooltip}>
      <Button type="text" size="small" icon={<FacebookFilled />} disabled />
    </Tooltip>
  );
}

/** =========================
 *  Share helpers + component
 *  ========================= */
type SharePayload = {
  url: string;
  title: string;
  text: string;
};

function buildSharePayload(r: PostsPagedItem, baseUrl: string): SharePayload {
  const url = `${baseUrl}/post/${r.id}`;
  const title = r?.title ? String(r.title) : "จ่าเฉย (Jachoei)";
  const detail = r?.detail ? String(r.detail).replace(/\s+/g, " ").trim() : "";
  const text = detail ? `${title}\n\n${detail.slice(0, 180)}${detail.length > 180 ? "..." : ""}` : title;

  return { url, title, text };
}

async function copyToClipboard(text: string) {
  if (!text) return;
  // clipboard API needs https/localhost
  await navigator.clipboard.writeText(text);
}

function ShareActionButton({ r, baseUrl }: { r: PostsPagedItem; baseUrl: string }) {
  const [open, setOpen] = useState(false);
  const payload = useMemo(() => buildSharePayload(r, baseUrl), [r, baseUrl]);

  const openFacebookShare = (shareUrl: string) => {
    const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    window.open(fb, "_blank", "noopener,noreferrer");
  };

  const handleShare = async (e: MouseEvent<HTMLElement>) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    try {
      // ✅ Native share (mobile)
      const nav = navigator as Navigator & {
        share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
      };
      if (nav?.share) {
        await nav.share({
          title: payload.title,
          text: payload.text,
          url: payload.url,
        });
        return;
      }

      // ✅ fallback modal
      setOpen(true);
    } catch (err: unknown) {
      // ผู้ใช้กด cancel จะ throw บาง browser → ไม่ต้อง error
      const name = err instanceof Error ? (err as Error & { name?: string }).name : undefined;
      if (String(name || "").toLowerCase().includes("abort")) return;
      setOpen(true);
    }
  };

  return (
    <>
      <Tooltip title="Share">
        <Button
          type="text"
          size="small"
          icon={<ShareAltOutlined />}
          onClick={handleShare}
        />
      </Tooltip>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        title="Share post"
        footer={null}
        destroyOnClose
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <Text strong>{payload.title}</Text>
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {payload.url}
              </Text>
            </div>
          </div>

          <Divider style={{ margin: "8px 0" }} />

          <Space wrap>
            <Button
              icon={<LinkOutlined />}
              onClick={async () => {
                try {
                  await copyToClipboard(payload.url);
                  message.success("Copied link");
                } catch {
                  message.error("Copy failed (clipboard permission)");
                }
              }}
            >
              Copy link
            </Button>

            <Button
              icon={<CopyOutlined />}
              onClick={async () => {
                try {
                  await copyToClipboard(`${payload.title}\n${payload.url}`);
                  message.success("Copied text");
                } catch {
                  message.error("Copy failed (clipboard permission)");
                }
              }}
            >
              Copy text
            </Button>

            <Button
              icon={<FacebookFilled />}
              onClick={() => openFacebookShare(payload.url)}
            >
              Share to Facebook
            </Button>

            <Button
              onClick={() => {
                window.open(payload.url, "_blank", "noopener,noreferrer");
              }}
            >
              Open link
            </Button>
          </Space>

          <div style={{ marginTop: 10 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Tip: บนมือถือจะเปิด native share ให้เอง ถ้าเครื่องรองรับ
            </Text>
          </div>
        </div>
      </Modal>
    </>
  );
}

type TelDialogState = { open: boolean; tel: string; dontAskStored: boolean };
type BankDialogState = { open: boolean; bankName: string | null; account: string };

function PostsList() {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { user } = useSessionCtx();

  const router = useRouter();

  const requireAuthOrRedirect = useCallback((): boolean => {
    if (user) return true;

    const nextPath =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search || ""}`
        : "/";

    router.push(`/login?next=${encodeURIComponent(nextPath)}`);
    return false;
  }, [router, user]);

  const jachoei = useJachoeiLocalState();
  const jachoeiMut = useJachoeiMutations();
  const [telDialog, setTelDialog] = useState<TelDialogState>({ open: false, tel: "", dontAskStored: false });
  const [bankDialog, setBankDialog] = useState<BankDialogState>({ open: false, bankName: null, account: "" });

  // ✅ base url สำหรับแชร์ (client-only)
  const BASE_URL =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://jachoei.com");

  const { data, loading, refetch } = useQuery<PostsPagedResponse, PostsPagedVars>(Q_POSTS_PAGED, {
    variables: { q: null, limit: pageSize, offset: (page - 1) * pageSize },
    fetchPolicy: "cache-and-network",
  });

  const [deletePost, { loading: deleting }] = useMutation(DELETE_POST);

  useEffect(() => {
    console.log("[data] =", data);
  }, [data]);

  const handleDelete = async (id: string) => {
    try {
      const { data: res } = await deletePost({ variables: { id } });
      if (res?.deletePost) {
        message.success("Deleted successfully");
        refetch();
      } else {
        message.warning("Delete failed");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Delete error";
      message.error(msg);
    }
  };

  const items: PostsPagedItem[] = data?.postsPaged?.items || [];
  const total = data?.postsPaged?.total || 0;

  const performTelConfirm = useCallback(
    async (telRaw: string, value: TelBlockDialogValue): Promise<boolean> => {
      const tel = normalizeTel(telRaw);
      if (!tel) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getBlockedTelEntry(tel);
      const wasBlocked = jachoei.isBlockedTel(tel);

      const wantReport = !!value.wantReport;
      const nextCategory = wantReport ? value.category : undefined;
      const nextNote = wantReport ? value.note : "";

      const optimisticEntry = {
        wantReport,
        category: nextCategory,
        note: nextNote,
        blockedAt: prevEntry?.blockedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      jachoei.setBlockedTelEntry(tel, optimisticEntry);

      try {
        const payload = await jachoeiMut.reportPhone({
          phone: tel,
          category: nextCategory,
          note: wantReport ? nextNote : null,
        });

        jachoei.setBlockedTelEntry(tel, {
          ...optimisticEntry,
          blockedAt: payload.updated_at ?? optimisticEntry.blockedAt,
          ctx: payload.ctx ?? optimisticEntry.ctx,
          tags: payload.tags ?? optimisticEntry.tags,
        });

        message.success(wasBlocked ? "Updated report" : "Blocked");
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setBlockedTelEntry(tel, prevEntry);
        else jachoei.removeBlockedTelEntry(tel);

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const performTelUndo = useCallback(
    async (telRaw: string): Promise<boolean> => {
      const tel = normalizeTel(telRaw);
      if (!tel) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getBlockedTelEntry(tel);
      const wasBlocked = jachoei.isBlockedTel(tel);

      jachoei.removeBlockedTelEntry(tel);

      try {
        await jachoeiMut.unblockPhone({ phone: tel });
        message.success("Unblocked");
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setBlockedTelEntry(tel, prevEntry);
        else if (wasBlocked) jachoei.setBlockedTelEntry(tel, {});

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const openTelBlockFlow = useCallback(
    (telRaw: string) => {
      const tel = normalizeTel(telRaw);
      if (!tel) return;

      if (!requireAuthOrRedirect()) return;

      const skipConfirm = getDontAskAgainForTel(tel);
      const blockedNow = jachoei.isBlockedTel(tel);

      // parity-ish with RN fast mode, but keep web UX for managing blocked numbers
      if (skipConfirm && !blockedNow) {
        setDontAskAgainForTel(tel, true);
        void performTelConfirm(tel, { wantReport: true, category: "SCAM", note: "", dontAskAgain: true });
        return;
      }

      setTelDialog({ open: true, tel, dontAskStored: skipConfirm });
    },
    [jachoei, performTelConfirm, requireAuthOrRedirect]
  );

  const performBankConfirm = useCallback(
    async (bankName: string | null | undefined, accountRaw: string, value: BankReportDialogValue): Promise<boolean> => {
      const account = normalizeBank(accountRaw);
      if (!account) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getReportedBankEntry(account);
      const wasReported = jachoei.isReportedBank(account);

      const optimisticEntry = {
        bank_name: bankName ?? prevEntry?.bank_name ?? null,
        category: value.category,
        note: value.note,
        reportedAt: prevEntry?.reportedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      jachoei.setReportedBankEntry(account, optimisticEntry);

      try {
        const payload = await jachoeiMut.reportBank({
          account,
          bankName,
          category: value.category,
          note: value.note,
        });

        jachoei.setReportedBankEntry(account, {
          ...optimisticEntry,
          bank_name: payload.bank_name ?? optimisticEntry.bank_name,
          reportedAt: payload.updated_at ?? optimisticEntry.reportedAt,
          ctx: payload.ctx ?? optimisticEntry.ctx,
          tags: payload.tags ?? optimisticEntry.tags,
        });

        message.success(wasReported ? "Updated report" : "Reported");
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setReportedBankEntry(account, prevEntry);
        else jachoei.removeReportedBankEntry(account);

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const performBankUndo = useCallback(
    async (bankName: string | null | undefined, accountRaw: string): Promise<boolean> => {
      const account = normalizeBank(accountRaw);
      if (!account) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getReportedBankEntry(account);
      const wasReported = jachoei.isReportedBank(account);

      jachoei.removeReportedBankEntry(account);

      try {
        await jachoeiMut.unreportBank({
          account,
          bankName,
          category: prevEntry?.category,
          reason: prevEntry?.note ?? null,
        });
        message.success("Unreported");
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setReportedBankEntry(account, prevEntry);
        else if (wasReported) jachoei.setReportedBankEntry(account, { bank_name: bankName ?? null });

        const msg = err instanceof Error ? err.message : "Action failed";
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const openBankReportFlow = useCallback((bankName: string | null | undefined, accountRaw: string) => {
    const account = normalizeBank(accountRaw);
    if (!account) return;

    if (!requireAuthOrRedirect()) return;
    setBankDialog({ open: true, bankName: bankName ?? null, account });
  }, [requireAuthOrRedirect]);

  // ===== Desktop columns (Table) =====
  const columns: ColumnsType<PostsPagedItem> = [
    {
      title: "Images",
      dataIndex: "images",
      width: 190,
      render: (imgs: PostsPagedItem["images"]) => <ThumbGrid images={imgs ?? []} width={170} height={120} />,
    },
    {
      title: "Title",
      onCell: () => ({ style: { verticalAlign: "top" } }),
      render: (_: unknown, r) => {
        const ts = String(r.created_at).trim();

        return (
          <div style={{ paddingRight: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/post/${r.id}`} prefetch={false}>
                  <Text strong style={{ fontSize: 14 }}>
                    {r.title || "-"}
                  </Text>
                </Link>

                <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {r.status && (
                    <Tag color={statusColor(r.status)} style={{ marginRight: 0 }}>
                      {r.status}
                    </Tag>
                  )}

                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {ts ? new Date(Number(ts)).toLocaleString() : ""}
                  </Text>
                </div>

                {r.author && (
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      by{" "}
                      <Link href={`/profile/${r.author.id}`} prefetch={false}>
                        {r.author.name}
                      </Link>
                    </Text>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      title: "Detail",
      dataIndex: "detail",
      onCell: () => ({ style: { verticalAlign: "top" } }),
      render: (detail: string) => (
        <Paragraph style={{ marginBottom: 0, maxWidth: 420 }} ellipsis={{ rows: 4, expandable: false }}>
          {detail}
        </Paragraph>
      ),
    },
    {
      title: "Tel",
      width: 220,
      dataIndex: "tel_numbers",
      onCell: () => ({ style: { verticalAlign: "top" } }),
      render: (tels) => (
        <TelList
          items={tels ?? undefined}
          isBlocked={jachoei.isBlockedTel}
          onOpenBlock={openTelBlockFlow}
        />
      ),
    },
    {
      title: "Seller Accounts",
      dataIndex: "seller_accounts",
      onCell: () => ({ style: { verticalAlign: "top" } }),
      render: (list) => (
        <BankList items={list ?? undefined} isReported={jachoei.isReportedBank} onOpenReport={openBankReportFlow} />
      ),
    },
    {
      title: "Action",
      fixed: "right" as const,
      width: 230,
      render: (_: unknown, r) => {
        const authorId = r.author?.id;
        const userId = user?.id != null ? String(user.id) : undefined;

        return (
          <Space size={4}>
            {/* ✅ FB icon (clickable only if PUBLISHED) */}
            <FacebookIconAction r={r} />

            {userId !== authorId && <BookmarkButton postId={r.id} defaultBookmarked={r?.is_bookmarked ?? false} />}

            {userId === authorId && (
              <>
                <Tooltip title="Edit">
                  <Link href={`/post/${r.id}/edit`} prefetch={false}>
                    <Button type="text" size="small" icon={<EditOutlined />} />
                  </Link>
                </Tooltip>

                <Popconfirm title="Confirm delete?" okText="Yes" cancelText="No" onConfirm={() => handleDelete(r.id)}>
                  <Tooltip title="Delete">
                    <Button type="text" size="small" danger loading={deleting} icon={<DeleteOutlined />} />
                  </Tooltip>
                </Popconfirm>
              </>
            )}

            {authorId && userId !== authorId && (
              <Tooltip title="Chat with author">
                <Link href={`/chat?to=${authorId}`} prefetch={false}>
                  <Button type="text" size="small" icon={<MessageOutlined />} />
                </Link>
              </Tooltip>
            )}

            <Tooltip title={`Comments (${r.comments_count || 0})`}>
              <Link href={`/post/${r.id}`} prefetch={false}>
                <Badge count={r.comments_count || 0} size="small" showZero={false} offset={[0, 4]}>
                  <Button type="text" size="small" icon={<CommentOutlined />} />
                </Badge>
              </Link>
            </Tooltip>

            {/* ✅ Share */}
            <ShareActionButton r={r} baseUrl={BASE_URL} />
          </Space>
        );
      },
    },
  ];

  // ===== Mobile view: List + Card =====
  if (isMobile) {
    return (
      <>
        <TelBlockDialog
          open={telDialog.open}
          tel={telDialog.tel}
          blocked={jachoei.isBlockedTel(telDialog.tel)}
          defaultDontAskAgain={telDialog.dontAskStored}
            initialWantReport={jachoei.getBlockedTelEntry(telDialog.tel)?.wantReport}
            initialCategory={jachoei.getBlockedTelEntry(telDialog.tel)?.category}
            initialNote={jachoei.getBlockedTelEntry(telDialog.tel)?.note}
            confirmLoading={jachoeiMut.loading.reportPhone}
            undoLoading={jachoeiMut.loading.unblockPhone}
          onCancel={() => setTelDialog({ open: false, tel: "", dontAskStored: false })}
          onConfirm={(value) => {
            if (!requireAuthOrRedirect()) return;
            setDontAskAgainForTel(telDialog.tel, value.dontAskAgain);
              void performTelConfirm(telDialog.tel, value).then((ok) => {
              if (ok) setTelDialog({ open: false, tel: "", dontAskStored: false });
            });
          }}
            onUndo={() => {
              if (!requireAuthOrRedirect()) return;
              void performTelUndo(telDialog.tel).then((ok) => {
                if (ok) setTelDialog({ open: false, tel: "", dontAskStored: false });
              });
            }}
        />

        <BankReportDialog
          open={bankDialog.open}
          bankName={bankDialog.bankName}
          account={bankDialog.account}
          reported={jachoei.isReportedBank(bankDialog.account)}
          initialCategory={jachoei.getReportedBankEntry(bankDialog.account)?.category}
          initialNote={jachoei.getReportedBankEntry(bankDialog.account)?.note}
          confirmLoading={jachoeiMut.loading.reportBank}
          undoLoading={jachoeiMut.loading.unreportBank}
          onCancel={() => setBankDialog({ open: false, bankName: null, account: "" })}
          onConfirm={(value: BankReportDialogValue) => {
            if (!requireAuthOrRedirect()) return;
            void performBankConfirm(bankDialog.bankName, bankDialog.account, value).then((ok) => {
              if (ok) setBankDialog({ open: false, bankName: null, account: "" });
            });
          }}
          onUndo={() => {
            if (!requireAuthOrRedirect()) return;
            void performBankUndo(bankDialog.bankName, bankDialog.account).then((ok) => {
              if (ok) setBankDialog({ open: false, bankName: null, account: "" });
            });
          }}
        />

        <div style={{ padding: 8 }}>
          <List
            loading={loading}
            dataSource={items}
            rowKey="id"
            pagination={
              items?.length
                ? {
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: true,
                    onChange: (p, ps) => {
                      setPage(p);
                      setPageSize(ps);
                      refetch({ q: null, limit: ps, offset: (p - 1) * ps });
                    },
                  }
                : false
            }
            renderItem={(r) => {
              const authorId = r.author?.id;
              const userId = user?.id != null ? String(user.id) : undefined;

              return (
                <List.Item style={{ padding: 8 }}>
                  <Card style={{ width: "100%" }} bodyStyle={{ padding: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flexShrink: 0 }}>
                        <ThumbGrid images={r.images ?? []} width={120} height={90} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <Link href={`/post/${r.id}`} prefetch={false}>
                              <Text strong style={{ fontSize: 14 }} ellipsis>
                                {r.title || "-"}
                              </Text>
                            </Link>

                            <div style={{ marginTop: 4 }}>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {r.created_at ? new Date(Number(r.created_at)).toLocaleString() : ""}
                              </Text>
                            </div>
                          </div>
                        </div>

                      {r.author && (
                        <div style={{ marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            by{" "}
                            <Link href={`/profile/${r.author.id}`} prefetch={false}>
                              {r.author.name}
                            </Link>
                          </Text>
                        </div>
                      )}

                      {r.detail && (
                        <Paragraph style={{ marginTop: 4, marginBottom: 4, fontSize: 12 }} ellipsis={{ rows: 2 }}>
                          {r.detail}
                        </Paragraph>
                      )}

                      <div style={{ marginTop: 4 }}>
                        <Text strong style={{ fontSize: 12 }}>
                          Tel:
                        </Text>{" "}
                        <span style={{ fontSize: 12 }}>
                          {r.tel_numbers?.[0]?.tel || "-"}
                          {r.tel_numbers && r.tel_numbers.length > 1 && (
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {" "}
                              (+{r.tel_numbers.length - 1} more)
                            </Text>
                          )}
                        </span>

                        {r.tel_numbers?.[0]?.tel ? (
                          <Space size={6} wrap style={{ marginLeft: 8 }}>
                            {jachoei.isBlockedTel(r.tel_numbers[0].tel) ? <Tag color="red">Blocked</Tag> : null}
                            <Button size="small" type="default" onClick={() => openTelBlockFlow(r.tel_numbers![0]!.tel)}>
                              {jachoei.isBlockedTel(r.tel_numbers[0].tel) ? "Manage" : "Block"}
                            </Button>
                          </Space>
                        ) : null}
                      </div>

                      <div style={{ marginTop: 2 }}>
                        <Text strong style={{ fontSize: 12 }}>
                          Bank:
                        </Text>{" "}
                        <span style={{ fontSize: 12 }}>
                          {r.seller_accounts?.[0]
                            ? `${r.seller_accounts[0].bank_name || "-"}: ${r.seller_accounts[0].seller_account || "-"}`
                            : "-"}
                          {r.seller_accounts && r.seller_accounts.length > 1 && (
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {" "}
                              (+{r.seller_accounts.length - 1} more)
                            </Text>
                          )}
                        </span>

                        {r.seller_accounts?.[0]?.seller_account ? (
                          <Space size={6} wrap style={{ marginLeft: 8 }}>
                            {jachoei.isReportedBank(r.seller_accounts[0].seller_account) ? (
                              <Tag color="green">Reported</Tag>
                            ) : null}
                            <Button
                              size="small"
                              type="default"
                              onClick={() =>
                                openBankReportFlow(
                                  r.seller_accounts![0]!.bank_name ?? null,
                                  r.seller_accounts![0]!.seller_account ?? ""
                                )
                              }
                            >
                              {jachoei.isReportedBank(r.seller_accounts[0].seller_account) ? "Manage" : "Report"}
                            </Button>
                          </Space>
                        ) : null}
                      </div>

                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: 4,
                        }}
                      >
                        <Space size={4}>
                          {userId !== authorId && (
                            <BookmarkButton postId={r.id} defaultBookmarked={r?.is_bookmarked ?? false} />
                          )}

                          {userId === authorId && (
                            <>
                              <Tooltip title="Edit">
                                <Link href={`/post/${r.id}/edit`} prefetch={false}>
                                  <Button type="text" size="small" icon={<EditOutlined />} />
                                </Link>
                              </Tooltip>

                              <Popconfirm
                                title="Confirm delete?"
                                okText="Yes"
                                cancelText="No"
                                onConfirm={() => handleDelete(r.id)}
                              >
                                <Tooltip title="Delete">
                                  <Button type="text" size="small" danger loading={deleting} icon={<DeleteOutlined />} />
                                </Tooltip>
                              </Popconfirm>
                            </>
                          )}

                          {authorId && userId !== authorId && (
                            <Tooltip title="Chat with author">
                              <Link href={`/chat?to=${authorId}`} prefetch={false}>
                                <Button type="text" size="small" icon={<MessageOutlined />} />
                              </Link>
                            </Tooltip>
                          )}

                          {/* ✅ Facebook icon (clickable only if PUBLISHED) */}
                          <FacebookIconAction r={r} />
                        </Space>

                        <Tooltip title={`Comments (${r.comments_count || 0})`}>
                          <Link href={`/post/${r.id}`} prefetch={false}>
                            <Badge count={r.comments_count || 0} size="small" showZero={false} offset={[0, 4]}>
                              <Button type="text" size="small" icon={<CommentOutlined />} />
                            </Badge>
                          </Link>
                          {/* ✅ Share */}
                          <ShareActionButton r={r} baseUrl={BASE_URL} />
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </Card>
              </List.Item>
              );
            }}
          />
        </div>
      </>
    );
  }

  // ===== Desktop view: Table =====
  return (
    <div style={{ padding: 5 }}>
      <TelBlockDialog
        open={telDialog.open}
        tel={telDialog.tel}
        blocked={jachoei.isBlockedTel(telDialog.tel)}
        defaultDontAskAgain={telDialog.dontAskStored}
        initialWantReport={jachoei.getBlockedTelEntry(telDialog.tel)?.wantReport}
        initialCategory={jachoei.getBlockedTelEntry(telDialog.tel)?.category}
        initialNote={jachoei.getBlockedTelEntry(telDialog.tel)?.note}
        confirmLoading={jachoeiMut.loading.reportPhone}
        undoLoading={jachoeiMut.loading.unblockPhone}
        onCancel={() => setTelDialog({ open: false, tel: "", dontAskStored: false })}
        onConfirm={(value) => {
          if (!requireAuthOrRedirect()) return;
          setDontAskAgainForTel(telDialog.tel, value.dontAskAgain);
          void performTelConfirm(telDialog.tel, value).then((ok) => {
            if (ok) setTelDialog({ open: false, tel: "", dontAskStored: false });
          });
        }}
        onUndo={() => {
          if (!requireAuthOrRedirect()) return;
          void performTelUndo(telDialog.tel).then((ok) => {
            if (ok) setTelDialog({ open: false, tel: "", dontAskStored: false });
          });
        }}
      />

      <BankReportDialog
        open={bankDialog.open}
        bankName={bankDialog.bankName}
        account={bankDialog.account}
        reported={jachoei.isReportedBank(bankDialog.account)}
        initialCategory={jachoei.getReportedBankEntry(bankDialog.account)?.category}
        initialNote={jachoei.getReportedBankEntry(bankDialog.account)?.note}
        confirmLoading={jachoeiMut.loading.reportBank}
        undoLoading={jachoeiMut.loading.unreportBank}
        onCancel={() => setBankDialog({ open: false, bankName: null, account: "" })}
        onConfirm={(value: BankReportDialogValue) => {
          if (!requireAuthOrRedirect()) return;
          void performBankConfirm(bankDialog.bankName, bankDialog.account, value).then((ok) => {
            if (ok) setBankDialog({ open: false, bankName: null, account: "" });
          });
        }}
        onUndo={() => {
          if (!requireAuthOrRedirect()) return;
          void performBankUndo(bankDialog.bankName, bankDialog.account).then((ok) => {
            if (ok) setBankDialog({ open: false, bankName: null, account: "" });
          });
        }}
      />

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        size="middle"
        tableLayout="fixed"
        scroll={{ x: 1100 }}
        rowClassName={(_, index) => (index % 2 === 0 ? "row-even" : "row-odd")}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (tot, range) => `${range[0]}-${range[1]} of ${tot} items`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
            refetch({ q: null, limit: ps, offset: (p - 1) * ps });
          },
        }}
      />
    </div>
  );
}

export default function Page() {
  const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://jachoei.com";

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "จ่าเฉย (Jachoei)",
            alternateName: "จ่าเฉย (Jachoei)",
            url: SITE_URL,
            description: "ฐานข้อมูลการโกงออนไลน์",
            potentialAction: {
              "@type": "SearchAction",
              target: `${SITE_URL}/search?q={query}`,
              "query-input": "required name=query",
            },
          }),
        }}
      />
      <PostsList />
    </>
  );
}
```

## apps/web/app/api/dev/fake/posts/route.ts

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrInternal } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import { nanoid } from "nanoid";
import { persistWebFile } from "@/lib/storage";
import dayjs from "dayjs";

export const runtime = "nodejs";

// ดึง type return ของ persistWebFile มาใช้
type StoredFileRow = Awaited<ReturnType<typeof persistWebFile>>;

// =============================
// Create Random Image
// =============================
async function createRandomImageBuffer(
  w = 800,
  h = 500,
  fmt: "png" | "jpeg" = "png"
): Promise<Buffer> {
  const { default: sharp } = await import("sharp");

  const bg = randomHexColor();
  const image = sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: bg,
    },
  });
  return fmt === "png"
    ? image.png().toBuffer()
    : image.jpeg({ quality: 85 }).toBuffer();
}

function randomHexColor(): string {
  const n = Math.floor(Math.random() * 0xffffff);
  return `#${n.toString(16).padStart(6, "0")}`;
}

// Simulate File object
function makeWebFileFromBuffer(buf: Buffer, filename: string, mime: string) {
  return {
    name: filename,
    type: mime,
    size: buf.length,
    async arrayBuffer(): Promise<ArrayBuffer> {
      const ab = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
      );
      return ab as ArrayBuffer;
    },
  } as unknown as File;
}

export async function POST(req: NextRequest) {
  console.log("[POST] - dev fake posts with images + new fields");

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
  }

  const body = await req.json();
  const { count = 5 } = body;

  // Admin only
  const guard = requireAdminOrInternal(req);
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // =============================
  // 🟦 NEW: Random author from users
  // =============================
  const usersRows = await query(
    `SELECT id, name FROM users ORDER BY random() LIMIT 100`
  );

  const pickRandomUser = () => {
    if (!usersRows.rows?.length) return guard.actor?.id ?? null;
    const randomIndex = Math.floor(Math.random() * usersRows.rows.length);
    return usersRows.rows[randomIndex].id;
  };

  // list will store created posts
  const created: any[] = [];
  const IMAGES_PER_POST = 3;

  // Province sample IDs
  const provinceIds = [
    "a0f9a3b6-3a42-4c61-924d-14e3a9e4c2d1",
    "b27f6c4a-7f53-4a77-bb12-83211d9e62a3",
    "c913aef8-4581-4b40-90d8-5c3efde0b61a",
    "d57a89e3-f2e4-4fa4-a38a-14cc6bcbf879",
    "e89db1cf-9a12-4e7f-b354-67a8e1b58a50",
  ];

  for (let i = 0; i < count; i++) {
    // 🟦 AUTHOR RANDOM
    const author_id = pickRandomUser();
    const meta = JSON.stringify({ generated_by: author_id });

    const title = `Fake Report ${nanoid(6)}`;
    const status = Math.random() > 0.5 ? "public" : "unpublic";

    // New fields
    const first_last_name = `สมคิด ทดสอบ${i}`;
    const id_card = `1234567890${String(100 + i).padStart(3, "0")}`;
    const transfer_amount = (Math.random() * 50000 + 5000).toFixed(2);
    const transfer_date = dayjs().subtract(i, "day").toISOString();
    const website = ["facebook.com", "shopee.co.th", "lazada.co.th"][i % 3];
    const province_id = provinceIds[i % provinceIds.length];
    const detail = "โพสต์จำลองสำหรับ dev testing.";

    const insertSql = `
      INSERT INTO posts (
        title, status, author_id, meta,
        first_last_name, id_card, 
        transfer_amount, transfer_date, website,
        province_id, detail,
        created_at, updated_at, fake_test
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,
        $10,$11,
        NOW(),NOW(),true
      )
      RETURNING *
    `;

    const { rows } = await query(insertSql, [
      title,
      status,
      author_id,
      meta,
      first_last_name,
      id_card,
      transfer_amount,
      transfer_date,
      website,
      province_id,
      detail,
    ]);

    const post = rows[0];
    created.push(post);

    // Telephone
    const telCount = Math.ceil(Math.random() * 2);
    for (let t = 0; t < telCount; t++) {
      const tel = `09${Math.floor(10000000 + Math.random() * 90000000)}`;
      await query(
        `INSERT INTO post_tel_numbers (post_id, tel) VALUES ($1,$2)`,
        [post.id, tel]
      );
    }

    // Seller Accounts
    const banks = [
      { id: "002", name: "ธ.กรุงเทพ" },
      { id: "004", name: "ธ.กสิกรไทย" },
      { id: "014", name: "ธ.ไทยพาณิชย์" },
      { id: "025", name: "ธ.กรุงไทย" },
    ];
    const bank = banks[i % banks.length];
    await query(
      `INSERT INTO post_seller_accounts (post_id, bank_id, bank_name, seller_account)
       VALUES ($1,$2,$3,$4)`,
      [post.id, bank.id, bank.name, `123-45${i}-6789`]
    );

    // Fake Upload Images
    const fileRows: StoredFileRow[] = [];
    for (let k = 0; k < IMAGES_PER_POST; k++) {
      const usePng = Math.random() < 0.5;
      const mime = usePng ? "image/png" : "image/jpeg";
      const ext = usePng ? "png" : "jpg";
      const buf = await createRandomImageBuffer(
        800,
        500,
        usePng ? "png" : "jpeg"
      );
      const filename = `fake_${nanoid(8)}.${ext}`;
      const webFile = makeWebFileFromBuffer(buf, filename, mime);
      const fileRow = await persistWebFile(webFile);
      fileRows.push(fileRow);
    }

    if (fileRows.length) {
      const values = fileRows.map((_, i) => `($1, $${i + 2})`).join(", ");
      await query(
        `INSERT INTO post_images (post_id, file_id) VALUES ${values}`,
        [post.id, ...fileRows.map((r) => r.id)]
      );
    }
  }

  return NextResponse.json({
    ok: true,
    created_count: created.length,
    created,
  });
}
```

## apps/web/app/hooks/useJachoeiLocalState.ts

```ts
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
```

## apps/web/app/hooks/useJachoeiMutations.ts

```ts
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
```

## apps/web/app/lib/jachoeiLocalState.ts

```ts
export const BLOCKED_TEL_STORE_KEY = "jachoei.blocked_tel_v1";
export const REPORTED_BANK_STORE_KEY = "jachoei.reported_bank_v1";
export const TEL_BLOCK_DONT_ASK_PREFIX = "jachoei.block_confirm_skip.v1."; // + normalizedTel

export const JACHOEI_CLIENT_ID_KEY = "jachoei.client_id_v1";

export const JACHOEI_SYNC_EVENT = "jachoei-storage-sync";

export type StoredBlockedTelEntry = {
  wantReport?: boolean;
  category?: "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";
  note?: string;
  blockedAt?: string;
  ctx?: unknown;
  tags?: string[];
};

export type StoredReportedBankEntry = {
  bank_name?: string | null;
  category?: "SCAM" | "MONEY_MULE" | "SALES_ADS" | "DISPUTE" | "OTHER";
  note?: string;
  reportedAt?: string;
  ctx?: unknown;
  tags?: string[];
};

export type StoredBlockedTelMap = Record<string, StoredBlockedTelEntry>;
export type StoredReportedBankMap = Record<string, StoredReportedBankEntry>;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function normalizeTel(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

export function normalizeBank(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  return s.replace(/[^\d]/g, "");
}

function readLocalJson(key: string): unknown {
  if (!isBrowser()) return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeLocalJson(key: string, value: unknown): void {
  if (!isBrowser()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function sanitizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: string[] = [];
  for (const v of input) {
    if (typeof v === "string" && v.trim()) out.push(v);
  }
  return out;
}

function sanitizeBlockedTelEntry(input: unknown): StoredBlockedTelEntry {
  const base = (input && typeof input === "object") ? (input as Record<string, unknown>) : {};

  const wantReport = typeof base.wantReport === "boolean" ? base.wantReport : undefined;
  const categoryRaw = typeof base.category === "string" ? base.category : undefined;
  const category =
    categoryRaw === "SPAM" || categoryRaw === "SCAM" || categoryRaw === "SALES" || categoryRaw === "HARASS" || categoryRaw === "OTHER"
      ? categoryRaw
      : undefined;
  const note = typeof base.note === "string" ? base.note : undefined;
  const blockedAt = typeof base.blockedAt === "string" ? base.blockedAt : undefined;
  const tags = sanitizeStringArray(base.tags);
  const ctx = "ctx" in base ? base.ctx : undefined;

  return {
    wantReport,
    category,
    note,
    blockedAt,
    tags,
    ctx,
  };
}

function sanitizeReportedBankEntry(input: unknown): StoredReportedBankEntry {
  const base = (input && typeof input === "object") ? (input as Record<string, unknown>) : {};

  const bank_name = typeof base.bank_name === "string" ? base.bank_name : base.bank_name === null ? null : undefined;
  const categoryRaw = typeof base.category === "string" ? base.category : undefined;
  const category =
    categoryRaw === "SCAM" || categoryRaw === "MONEY_MULE" || categoryRaw === "SALES_ADS" || categoryRaw === "DISPUTE" || categoryRaw === "OTHER"
      ? categoryRaw
      : undefined;
  const note = typeof base.note === "string" ? base.note : undefined;
  const reportedAt = typeof base.reportedAt === "string" ? base.reportedAt : undefined;
  const tags = sanitizeStringArray(base.tags);
  const ctx = "ctx" in base ? base.ctx : undefined;

  return {
    bank_name,
    category,
    note,
    reportedAt,
    tags,
    ctx,
  };
}

function getBlockedTelMapRaw(): StoredBlockedTelMap {
  const parsed = readLocalJson(BLOCKED_TEL_STORE_KEY);

  const out: StoredBlockedTelMap = {};

  if (Array.isArray(parsed)) {
    // legacy: ["tel", ...]
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const k = normalizeTel(v);
      if (!k) continue;
      out[k] = {};
    }
    // migrate
    writeLocalJson(BLOCKED_TEL_STORE_KEY, out);
    return out;
  }

  if (parsed && typeof parsed === "object") {
    for (const [k0, v] of Object.entries(parsed as Record<string, unknown>)) {
      const k = normalizeTel(k0);
      if (!k) continue;

      if (typeof v === "boolean") {
        if (v) out[k] = {};
        continue;
      }

      if (v && typeof v === "object") {
        out[k] = sanitizeBlockedTelEntry(v);
        continue;
      }

      if (v) {
        // truthy legacy values
        out[k] = {};
      }
    }

    // heal keys if normalization changed
    writeLocalJson(BLOCKED_TEL_STORE_KEY, out);
    return out;
  }

  return out;
}

function getReportedBankMapRaw(): StoredReportedBankMap {
  const parsed = readLocalJson(REPORTED_BANK_STORE_KEY);

  const out: StoredReportedBankMap = {};

  if (Array.isArray(parsed)) {
    // legacy: ["account", ...]
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const k = normalizeBank(v);
      if (!k) continue;
      out[k] = {};
    }
    // migrate
    writeLocalJson(REPORTED_BANK_STORE_KEY, out);
    return out;
  }

  if (parsed && typeof parsed === "object") {
    for (const [k0, v] of Object.entries(parsed as Record<string, unknown>)) {
      const k = normalizeBank(k0);
      if (!k) continue;

      if (typeof v === "boolean") {
        if (v) out[k] = {};
        continue;
      }

      if (v && typeof v === "object") {
        out[k] = sanitizeReportedBankEntry(v);
        continue;
      }

      if (v) {
        out[k] = {};
      }
    }

    writeLocalJson(REPORTED_BANK_STORE_KEY, out);
    return out;
  }

  return out;
}

export function emitSync(): void {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event(JACHOEI_SYNC_EVENT));
}

export function subscribeSync(cb: () => void): () => void {
  if (!isBrowser()) return () => undefined;

  const onCustom = () => cb();
  const onStorage = (e: StorageEvent) => {
    if (e.storageArea !== window.localStorage) return;
    if (!e.key) return;
    if (e.key === BLOCKED_TEL_STORE_KEY || e.key === REPORTED_BANK_STORE_KEY) {
      cb();
    }

    if (e.key.startsWith(TEL_BLOCK_DONT_ASK_PREFIX)) {
      cb();
    }
  };

  window.addEventListener(JACHOEI_SYNC_EVENT, onCustom);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(JACHOEI_SYNC_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

export function isBlockedTel(tel: string): boolean {
  const t = normalizeTel(tel);
  if (!t) return false;
  const map = getBlockedTelMapRaw();
  return !!map[t];
}

export function toggleBlockedTel(tel: string): { blocked: boolean } {
  const t = normalizeTel(tel);
  if (!t) return { blocked: false };

  const map = getBlockedTelMapRaw();
  let blocked: boolean;

  if (map[t]) {
    delete map[t];
    blocked = false;
  } else {
    map[t] = {};
    blocked = true;
  }

  writeLocalJson(BLOCKED_TEL_STORE_KEY, map);
  emitSync();

  return { blocked };
}

export function isReportedBank(account: string): boolean {
  const acc = normalizeBank(account);
  if (!acc) return false;
  const map = getReportedBankMapRaw();
  return !!map[acc];
}

export function toggleReportedBank(account: string): { reported: boolean } {
  const acc = normalizeBank(account);
  if (!acc) return { reported: false };

  const map = getReportedBankMapRaw();
  let reported: boolean;

  if (map[acc]) {
    delete map[acc];
    reported = false;
  } else {
    map[acc] = {};
    reported = true;
  }

  writeLocalJson(REPORTED_BANK_STORE_KEY, map);
  emitSync();

  return { reported };
}

export function getBlockedTelSet(): Set<string> {
  const map = getBlockedTelMapRaw();
  return new Set(Object.keys(map));
}

export function getReportedBankSet(): Set<string> {
  const map = getReportedBankMapRaw();
  return new Set(Object.keys(map));
}

export function getBlockedTelEntry(tel: string): StoredBlockedTelEntry | null {
  const t = normalizeTel(tel);
  if (!t) return null;
  const map = getBlockedTelMapRaw();
  return map[t] ? { ...map[t] } : null;
}

export function setBlockedTelEntry(tel: string, entry: StoredBlockedTelEntry): void {
  const t = normalizeTel(tel);
  if (!t) return;

  const map = getBlockedTelMapRaw();
  map[t] = sanitizeBlockedTelEntry(entry);
  writeLocalJson(BLOCKED_TEL_STORE_KEY, map);
  emitSync();
}

export function removeBlockedTelEntry(tel: string): void {
  const t = normalizeTel(tel);
  if (!t) return;

  const map = getBlockedTelMapRaw();
  if (map[t]) {
    delete map[t];
    writeLocalJson(BLOCKED_TEL_STORE_KEY, map);
    emitSync();
  }
}

export function getReportedBankEntry(account: string): StoredReportedBankEntry | null {
  const acc = normalizeBank(account);
  if (!acc) return null;
  const map = getReportedBankMapRaw();
  return map[acc] ? { ...map[acc] } : null;
}

export function setReportedBankEntry(account: string, entry: StoredReportedBankEntry): void {
  const acc = normalizeBank(account);
  if (!acc) return;

  const map = getReportedBankMapRaw();
  map[acc] = sanitizeReportedBankEntry(entry);
  writeLocalJson(REPORTED_BANK_STORE_KEY, map);
  emitSync();
}

export function removeReportedBankEntry(account: string): void {
  const acc = normalizeBank(account);
  if (!acc) return;

  const map = getReportedBankMapRaw();
  if (map[acc]) {
    delete map[acc];
    writeLocalJson(REPORTED_BANK_STORE_KEY, map);
    emitSync();
  }
}

export function getDontAskAgainKeyForTel(tel: string): string {
  const t = normalizeTel(tel);
  return `${TEL_BLOCK_DONT_ASK_PREFIX}${t}`;
}

export function getDontAskAgainForTel(tel: string): boolean {
  if (!isBrowser()) return false;
  const key = getDontAskAgainKeyForTel(tel);
  if (key === TEL_BLOCK_DONT_ASK_PREFIX) return false;

  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function setDontAskAgainForTel(tel: string, value: boolean): void {
  if (!isBrowser()) return;
  const key = getDontAskAgainKeyForTel(tel);
  if (key === TEL_BLOCK_DONT_ASK_PREFIX) return;

  try {
    if (value) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // ignore
  }

  emitSync();
}

export function getJachoeiClientId(): string {
  if (!isBrowser()) return "";

  try {
    const existing = window.localStorage.getItem(JACHOEI_CLIENT_ID_KEY);
    if (existing && existing.trim()) return existing;

    const uuid =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = Math.floor(Math.random() * 16);
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });

    window.localStorage.setItem(JACHOEI_CLIENT_ID_KEY, uuid);
    return uuid;
  } catch {
    return "";
  }
}
```

## apps/web/components/HeaderBar.tsx

```tsx
"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import {
  Layout,
  Button,
  Tooltip,
  Space,
  Avatar,
  Typography,
  Dropdown,
  message,
  AutoComplete,
  Input,
  Modal,
  Image,
  theme
} from "antd";
import type { InputRef } from "antd";
import {
  UserOutlined,
  SettingOutlined,
  ReloadOutlined,
  LoginOutlined,
  MessageOutlined,
  BellOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  HistoryOutlined,
  CloseCircleFilled,
  PlusOutlined,
  SafetyOutlined
} from "@ant-design/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MenuProps } from "antd";
import { gql, useQuery } from "@apollo/client";

import { useSession } from "@/lib/useSession";
import { useGlobalChatStore } from "@/store/globalChatStore";
import { useI18n } from "@/lib/i18nContext";
import type { Lang } from "@/i18n";

const { Header } = Layout;
const { Text } = Typography;

const labelOf: Record<Lang, string> = { th: "ไทย", en: "English" };
const flagOf: Record<Lang, string> = { th: "🇹🇭", en: "🇺🇸" };

// ===== GraphQL =====
const Q_ME = gql`
  query {
    me {
      id
      name
      email
      phone
      username
      language
      role
      avatar
      created_at
    }
  }
`;

const Q_UNREAD_NOTIFICATION_COUNT = gql`
  query MyUnreadNotificationCount {
    myUnreadNotificationCount
  }
`;

type HeaderBarProps = {
  initialLang?: Lang;
  isMobile?: boolean; // 👈 รับจาก AppLayout
};

export default function HeaderBar({ initialLang = "th", isMobile = false }: HeaderBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user: userSession, refreshSession } = useSession();
  const { t, lang, setLang } = useI18n();
  const { token } = theme.useToken();

  const isBlockedActive = pathname.startsWith("/blocked");
  const [blockedHover, setBlockedHover] = useState<boolean>(false);

  // console.log("[HeaderBar] isMobile =", isMobile);

  // ===== User / unread =====
  const { data: meData } = useQuery(Q_ME, {
    skip: !userSession,
    fetchPolicy: "cache-first",
  });
  const me = meData?.me;

  const totalUnread = useGlobalChatStore((s) =>
    Object.values(s.unreadByChat || {}).reduce((sum, n) => sum + (n || 0), 0)
  );

  const { data: notifData } = useQuery(Q_UNREAD_NOTIFICATION_COUNT, {
    skip: !userSession,
    fetchPolicy: "cache-and-network",
  });
  const notifUnreadCount = notifData?.myUnreadNotificationCount ?? 0;

  // ===== Language =====
  const [currentLang, setCurrentLang] = useState<Lang>(lang ?? initialLang);

  useEffect(() => {
    setCurrentLang(lang);
  }, [lang]);

  const changeLang = (nextLang: Lang) => {
    if (nextLang === currentLang) return;
    document.cookie = `lang=${nextLang}; path=/; samesite=lax`;
    setCurrentLang(nextLang);
    setLang?.(nextLang);
    router.refresh();
  };

  // sync cookie หลัง mount
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )lang=([^;]+)/);
    const c = (m ? decodeURIComponent(m[1]) : null) as Lang | null;
    if (c && c !== currentLang) setCurrentLang(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onLogout() {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (res.ok) {
      message.success("Logged out");
      try {
        refreshSession();
      } catch {}
      router.replace("/");
      setTimeout(() => window.location.reload(), 100);
    } else {
      message.error("Logout failed");
    }
  }

  const languageMenu: MenuProps["items"] = (["th", "en"] as Lang[]).map((lng) => ({
    key: lng,
    disabled: lng === currentLang,
    label: (
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          opacity: lng === currentLang ? 0.45 : 1,
        }}
      >
        <span style={{ fontSize: 18 }}>{flagOf[lng]}</span>
        <span>{labelOf[lng]}</span>
      </span>
    ),
    onClick: () => changeLang(lng),
  }));

  const profileMenu: MenuProps["items"] = [
    {
      key: "settings",
      label: <Link href="/settings">Settings</Link>,
      icon: <SettingOutlined />,
    },
    { type: "divider" },
    {
      key: "logout",
      label: <span onClick={showConfirmLogout}>Logout</span>,
      icon: <ReloadOutlined />,
    },
  ];

  // ====== Search + History ======
  const [searchValue, setSearchValue] = useState("");
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const searchInputRef = useRef<InputRef | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  // load history จาก localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("globalSearchHistory");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSearchHistory(parsed.filter((x) => typeof x === "string"));
        }
      }
    } catch (e) {
      console.warn("[Search] load history error", e);
    }
  }, []);

  function showConfirmLogout() {
    Modal.confirm({
      title: "Confirm Logout",
      content: "Are you sure you want to logout?",
      okText: "Logout",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      centered: true,
      onOk: onLogout,
    });
  }

  const saveHistory = (list: string[]) => {
    setSearchHistory(list);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("globalSearchHistory", JSON.stringify(list));
    }
  };

  const addToHistory = (term: string) => {
    const tVal = term.trim();
    if (!tVal) return;
    const next = [tVal, ...searchHistory.filter((x) => x !== tVal)].slice(0, 10);
    saveHistory(next);
  };

  const clearHistory = () => {
    saveHistory([]);
    setSearchValue("");
  };

  const handleSearchSubmit = (raw?: string) => {
    const q = (raw ?? searchValue).trim();
    if (!q) return;

    addToHistory(q);
    setSearchValue(q);

    router.push(`/search?q=${encodeURIComponent(q)}`, { scroll: false });
  };

  const handleSearchSelect = (value: string) => {
    if (value === "__clear__") {
      clearHistory();
      return;
    }
    setSearchValue(value);
    handleSearchSubmit(value);
  };

  const clearSearchInput = () => {
    setSearchValue("");
    searchInputRef.current?.focus?.();
  };

  const searchOptions = useMemo(() => {
    const historyOptions = searchHistory.map((h) => ({
      value: h,
      label: (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>
            <HistoryOutlined style={{ marginRight: 8, color: "#999" }} />
            {h}
          </span>
        </div>
      ),
    }));

    const clearOption =
      searchHistory.length > 0
        ? [
            {
              value: "__clear__",
              label: (
                <div
                  style={{
                    textAlign: "right",
                    fontSize: 12,
                    color: "#999",
                  }}
                >
                  {t("header.searchClearHistory")}
                </div>
              ),
            },
          ]
        : [];

    return [...historyOptions, ...clearOption];
  }, [searchHistory, t]);

  // Ctrl+K / Cmd+K → focus search (desktop only)
  useEffect(() => {
    if (isMobile) return; // มือถือไม่ต้องสนใจ shortcut
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const metaPressed = isMac ? e.metaKey : e.ctrlKey;
      if (metaPressed && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isMobile]);

  return (
    <Header
      style={{
        background: "#fff",
        padding: isMobile ? "0 8px" : "0 16px",
        height: isMobile ? 52 : 64,
        borderBottom: "1px solid #f0f0f0",
        position: "sticky",
        top: 0,
        zIndex: 1000,
      }}
    >
      {/* ชั้นใน: flex row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 8 : 16,
          height: "100%",
        }}
      >
        {/* ซ้าย: Logo / Title */}
        <div style={{ flexShrink: 0 }}>
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              textDecoration: "none",
            }}
          >
            {isMobile ? (
              // ================================
              // 📱 MOBILE → แสดงเป็น Icon
              // ================================
              <Avatar size={35} shape="circle" alt="จ่าเฉย (JACHOEI)">
                <img
                  src="/icons/icon.svg"
                  width={35}
                  height={35}
                  alt="จ่าเฉย (JACHOEI)"
                  style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    // borderRadius: "50%",
                    objectFit: "cover",
                    transform: "scale(1.25)",
                    transformOrigin: "center",
                  }}
                  loading="eager"
                  decoding="async"
                />
              </Avatar>

            ) : (
              // ================================
              // 🖥 DESKTOP → แสดงชื่อ Title
              // ================================
              <Link
      href="/"
      aria-label="Go to home"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 8px",
        textDecoration: "none",
        lineHeight: 1,
      }}
    >
      {/* ICON */}
      <Avatar size={50} shape="circle" alt="จ่าเฉย (JACHOEI)">
        <img
          src="/icons/icon.svg"
          width={50}
          height={50}
          alt="จ่าเฉย (JACHOEI)"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            // borderRadius: "50%",
            objectFit: "cover",
            transform: "scale(1.25)",
            transformOrigin: "center",
          }}
          loading="eager"
          decoding="async"
        />
      </Avatar>

      {/* TITLE */}
      <Text
        style={{
          color: "#000",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 1,
          whiteSpace: "nowrap",
          lineHeight: 1,
          margin: 0,
        }}
      >
        {t("header.title")}
      </Text>
    </Link>
            
            )}
          </Link>
        </div>

        {/* กลาง: Search */}
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: isMobile ? 360 : 650,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <AutoComplete
              value={searchValue}
              onChange={setSearchValue}
              onSelect={handleSearchSelect}
              options={searchOptions}
              popupMatchSelectWidth={true}
            >
              <Input
                ref={searchInputRef}
                size={isMobile ? "small" : "middle"}
                placeholder={t("header.searchPlaceholder")}
                prefix={
                  <SearchOutlined
                    style={{
                      color: searchFocused ? "#1677ff" : "#999",
                      transition: "color .18s ease",
                    }}
                  />
                }
                suffix={
                  isMobile ? (
                    // มือถือ: แสดงแค่ปุ่มเคลียร์ถ้ามี text
                    searchValue && (
                      <CloseCircleFilled
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          clearSearchInput();
                        }}
                        style={{
                          fontSize: 14,
                          cursor: "pointer",
                          color: "#bfbfbf",
                        }}
                      />
                    )
                  ) : (
                    // Desktop: ปุ่มเคลียร์ + Ctrl+K hint
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        color: "#999",
                      }}
                    >
                      {searchValue && (
                        <CloseCircleFilled
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            clearSearchInput();
                          }}
                          style={{
                            fontSize: 14,
                            cursor: "pointer",
                            color: "#bfbfbf",
                          }}
                        />
                      )}

                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: 6,
                            background: "#f0f0f0",
                            border: "1px solid #e1e1e1",
                            boxShadow: "0 1px 0 rgba(255,255,255,0.6)",
                          }}
                        >
                          Ctrl
                        </span>
                        <span style={{ opacity: 0.7 }}>+</span>
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: 6,
                            background: "#f0f0f0",
                            border: "1px solid #e1e1e1",
                            boxShadow: "0 1px 0 rgba(255,255,255,0.6)",
                          }}
                        >
                          K
                        </span>
                      </span>
                    </span>
                  )
                }
                style={{
                  width: "100%",
                  borderRadius: 999,
                  paddingInline: isMobile ? 10 : 16,
                  background: searchFocused ? "#ffffff" : "#f5f5f5",
                  border: searchFocused
                    ? "1px solid rgba(22,119,255,0.35)"
                    : "1px solid transparent",
                  boxShadow: searchFocused
                    ? "0 0 0 1px rgba(22,119,255,0.18), 0 6px 18px rgba(15,23,42,0.08)"
                    : "0 2px 6px rgba(15,23,42,0.04)",
                  transition: "all .18s ease",
                }}
                onPressEnter={() => handleSearchSubmit()}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
              />
            </AutoComplete>
          </div>
        </div>

        {/* ขวา: ปุ่มต่าง ๆ */}
        <div style={{ flexShrink: 0 }}>
          <Space size={isMobile ? 4 : 8} align="center">
            {userSession && (
              <>
                <Tooltip title={t("header.chat") || "สร้างโพสใหม่"}>
                  <Button
                    type="text"
                    size={isMobile ? "small" : "middle"}
                    onClick={() => router.push("/post/new")}
                    icon={
                      <span style={{ position: "relative", display: "inline-block" }}>
                        <PlusOutlined style={{ fontSize: isMobile ? 18 : 18, color: "#000" }} />
                      </span>
                    }
                  />
                </Tooltip>
                {/* Chat */}
                <Tooltip title={t("header.chat") || "ข้อความ"}>
                  <Button
                    type="text"
                    size={isMobile ? "small" : "middle"}
                    onClick={() => router.push("/chat")}
                    icon={
                      <span style={{ position: "relative", display: "inline-block" }}>
                        <MessageOutlined style={{ fontSize: isMobile ? 18 : 18, color: "#000" }} />
                        {totalUnread > 0 && (
                          <span
                            style={{
                              position: "absolute",
                              top: 10,
                              right: -10,
                              minWidth: 18,
                              height: 18,
                              padding: "0 5px",
                              background: "#ff4d4f",
                              borderRadius: 999,
                              color: "#fff",
                              fontSize: 11,
                              fontWeight: 600,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: "0 0 4px rgba(0, 0, 0, 0.3)",
                            }}
                          >
                            {totalUnread > 99 ? "99+" : totalUnread}
                          </span>
                        )}
                      </span>
                    }
                  />
                </Tooltip>

                {/* Blocked (Jachoei) */}
                <Tooltip title="Blocked">
                  <Button
                    aria-label="Blocked"
                    shape="circle"
                    type="text"
                    icon={<SafetyOutlined />}
                    onClick={() => router.push("/blocked?tab=blocked")}
                    style={{
                      background: blockedHover
                        ? token.colorFillTertiary
                        : isBlockedActive
                          ? token.colorFillSecondary
                          : "transparent",
                      color: token.colorText,
                      border: `1px solid ${isBlockedActive ? token.colorBorder : token.colorBorderSecondary}`,
                      boxShadow: "none",
                      transition: "background-color .18s ease, border-color .18s ease",
                    }}
                    onMouseEnter={() => setBlockedHover(true)}
                    onMouseLeave={() => setBlockedHover(false)}
                  />
                </Tooltip>

                {/* Notifications */}
                <Tooltip title={t("header.notifications") || "แจ้งเตือน"}>
                  <Button
                    type="text"
                    size={isMobile ? "small" : "middle"}
                    onClick={() => router.push("/notification")}
                    icon={
                      <span style={{ position: "relative", display: "inline-block" }}>
                        <BellOutlined style={{ fontSize: isMobile ? 18 : 18, color: "#000" }} />
                        {notifUnreadCount > 0 && (
                          <span
                            style={{
                              position: "absolute",
                              top: 10,
                              right: -10,
                              minWidth: 18,
                              height: 18,
                              padding: "0 5px",
                              background: "#ff4d4f",
                              borderRadius: 999,
                              color: "#fff",
                              fontSize: 11,
                              fontWeight: 600,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: "0 0 4px rgba(0, 0, 0, 0.3)",
                            }}
                          >
                            {notifUnreadCount > 99 ? "99+" : notifUnreadCount}
                          </span>
                        )}
                      </span>
                    }
                  />
                </Tooltip>
              </>
            )}

            {/* Language */}
            <Dropdown
              menu={{ items: languageMenu }}
              trigger={["click"]}
              placement="bottomRight"
              arrow
              overlayStyle={{ minWidth: 180 }}
            >
              <Button
                type="text"
                size={isMobile ? "small" : "middle"}
                onClick={(e) => e.preventDefault()}
              >
                <span style={{ fontSize: 18, marginRight: isMobile ? 0 : 6 }}>
                  {flagOf[currentLang]}
                </span>
                {!isMobile && <span>{labelOf[currentLang]}</span>}
              </Button>
            </Dropdown>

            {/* Help */}
            {!isMobile && (
              <Tooltip title={t("header.help") || "ศูนย์ช่วยเหลือ"}>
                <Button
                  type="text"
                  onClick={() => router.push("/help")}
                  icon={<QuestionCircleOutlined style={{ fontSize: 18, color: "#000" }} />}
                />
              </Tooltip>
            )}

            {/* User Avatar / Login */}
            {userSession ? (
              <Dropdown
                menu={{ items: profileMenu }}
                trigger={["click"]}
                placement="bottomRight"
                arrow
              >
                <Avatar
                  size={isMobile ? 32 : 36}
                  src={me?.avatar}
                  style={{ background: "#666", cursor: "pointer" }}
                  icon={<UserOutlined />}
                />
              </Dropdown>
            ) : (
              <Space>
                <Button
                  icon={<LoginOutlined />}
                  size={isMobile ? "small" : "middle"}
                  onClick={() => router.push("/login")}
                >
                  {!isMobile && "Login"}
                </Button>
              </Space>
            )}
          </Space>
        </div>
      </div>
    </Header>
  );
}
```

## apps/web/components/jachoei/BankReportDialog.tsx

```tsx
"use client";

import * as React from "react";
import { Modal, Typography, Input, Space, Tag, Divider, Button } from "antd";

export type BankReportCategory = "SCAM" | "MONEY_MULE" | "SALES_ADS" | "DISPUTE" | "OTHER";

export type BankReportDialogValue = {
  category: BankReportCategory;
  note: string;
};

type Props = {
  open: boolean;
  bankName: string | null;
  account: string;
  reported: boolean;
  initialCategory?: BankReportCategory;
  initialNote?: string;
  confirmLoading?: boolean;
  undoLoading?: boolean;
  onCancel: () => void;
  onConfirm: (value: BankReportDialogValue) => void;
  onUndo?: () => void;
};

const BANK_CATEGORIES: Array<{ label: string; value: BankReportCategory }> = [
  { label: "Scam", value: "SCAM" },
  { label: "Money Mule", value: "MONEY_MULE" },
  { label: "Sales/Ads", value: "SALES_ADS" },
  { label: "Dispute", value: "DISPUTE" },
  { label: "Other", value: "OTHER" },
];

export function BankReportDialog({ open, bankName, account, reported, initialCategory, initialNote, confirmLoading, undoLoading, onCancel, onConfirm, onUndo }: Props) {
  const [category, setCategory] = React.useState<BankReportCategory>("SCAM");
  const [note, setNote] = React.useState<string>("");

  React.useEffect(() => {
    if (!open) return;
    setCategory(initialCategory ?? "SCAM");
    setNote(initialNote ?? "");
  }, [open, initialCategory, initialNote]);

  const primaryLabel = reported ? "Update Report" : "Report";

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="Report bank account"
      destroyOnClose
      footer={null}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div>
          <Typography.Text type="secondary">Account</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Typography.Text strong>
              {bankName ? `${bankName} · ` : ""}
              {account || "-"}
            </Typography.Text>
          </div>
          {reported ? (
            <Typography.Text type="success" style={{ display: "block", marginTop: 6 }}>
              Reported (on this device)
            </Typography.Text>
          ) : null}
        </div>

        <Divider style={{ margin: "6px 0" }} />

        <div>
          <Typography.Text type="secondary">Category</Typography.Text>
          <div style={{ marginTop: 6 }}>
            <Space size={[6, 6]} wrap>
              {BANK_CATEGORIES.map((c) => (
                <Tag.CheckableTag
                  key={c.value}
                  checked={category === c.value}
                  onChange={() => setCategory(c.value)}
                >
                  {c.label}
                </Tag.CheckableTag>
              ))}
            </Space>
          </div>
        </div>

        <div>
          <Typography.Text type="secondary">Note (optional)</Typography.Text>
          <Input.TextArea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. scam transfer / money mule..."
            maxLength={160}
            showCount
            autoSize={{ minRows: 3, maxRows: 5 }}
            style={{ marginTop: 6 }}
          />
        </div>

        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={onCancel}>Cancel</Button>
          {reported ? (
            <Button
              danger
              loading={!!undoLoading}
              disabled={!!confirmLoading || !!undoLoading}
              onClick={() => onUndo?.()}
            >
              Undo report
            </Button>
          ) : null}
          <Button
            type="primary"
            loading={!!confirmLoading}
            disabled={!!confirmLoading || !!undoLoading}
            onClick={() => onConfirm({ category, note })}
          >
            {primaryLabel}
          </Button>
        </Space>
      </Space>
    </Modal>
  );
}
```

## apps/web/components/jachoei/TelBlockDialog.tsx

```tsx
"use client";

import * as React from "react";
import { Modal, Typography, Checkbox, Input, Space, Tag, Divider, Button } from "antd";

export type TelReportCategory = "SPAM" | "SCAM" | "SALES" | "HARASS" | "OTHER";

export type TelBlockDialogValue = {
  wantReport: boolean;
  category: TelReportCategory;
  note: string;
  dontAskAgain: boolean;
};

type Props = {
  open: boolean;
  tel: string;
  blocked: boolean;
  defaultDontAskAgain?: boolean;
  initialWantReport?: boolean;
  initialCategory?: TelReportCategory;
  initialNote?: string;
  confirmLoading?: boolean;
  undoLoading?: boolean;
  onCancel: () => void;
  onConfirm: (value: TelBlockDialogValue) => void;
  onUndo?: () => void;
};

const TEL_CATEGORIES: Array<{ label: string; value: TelReportCategory }> = [
  { label: "Spam", value: "SPAM" },
  { label: "Scam", value: "SCAM" },
  { label: "Sales/Ads", value: "SALES" },
  { label: "Harassment", value: "HARASS" },
  { label: "Other", value: "OTHER" },
];

export function TelBlockDialog({ open, tel, blocked, defaultDontAskAgain, initialWantReport, initialCategory, initialNote, confirmLoading, undoLoading, onCancel, onConfirm, onUndo }: Props) {
  const [wantReport, setWantReport] = React.useState<boolean>(true);
  const [category, setCategory] = React.useState<TelReportCategory>("SCAM");
  const [note, setNote] = React.useState<string>("");
  const [dontAskAgain, setDontAskAgain] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!open) return;
    setWantReport(initialWantReport ?? true);
    setCategory(initialCategory ?? "SCAM");
    setNote(initialNote ?? "");
    setDontAskAgain(!!defaultDontAskAgain);
  }, [open, defaultDontAskAgain, initialWantReport, initialCategory, initialNote]);

  const title = blocked ? "Manage blocked number" : "Before blocking, please confirm";
  const primaryLabel = blocked ? "Update Report" : wantReport ? "Block + Report" : "Block";

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={title}
      destroyOnClose
      footer={null}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <div>
          <Typography.Text type="secondary">Number</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Typography.Text strong>{tel || "-"}</Typography.Text>
          </div>
        </div>

        <>
          <Divider style={{ margin: "6px 0" }} />

          <Checkbox checked={wantReport} onChange={(e) => setWantReport(e.target.checked)}>
            Report to help others
          </Checkbox>

          {wantReport ? (
            <>
              <div>
                <Typography.Text type="secondary">Category</Typography.Text>
                <div style={{ marginTop: 6 }}>
                  <Space size={[6, 6]} wrap>
                    {TEL_CATEGORIES.map((c) => (
                      <Tag.CheckableTag
                        key={c.value}
                        checked={category === c.value}
                        onChange={() => setCategory(c.value)}
                      >
                        {c.label}
                      </Tag.CheckableTag>
                    ))}
                  </Space>
                </div>
              </div>

              <div>
                <Typography.Text type="secondary">Note (optional)</Typography.Text>
                <Input.TextArea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. sales call / scam / harassment..."
                  maxLength={120}
                  showCount
                  autoSize={{ minRows: 3, maxRows: 5 }}
                  style={{ marginTop: 6 }}
                />
              </div>
            </>
          ) : null}
        </>

        <Divider style={{ margin: "6px 0" }} />

        <Checkbox checked={dontAskAgain} onChange={(e) => setDontAskAgain(e.target.checked)}>
          Don&apos;t ask again for this number
        </Checkbox>

        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={onCancel}>Cancel</Button>
          {blocked ? (
            <Button
              danger
              loading={!!undoLoading}
              disabled={!!confirmLoading || !!undoLoading}
              onClick={() => onUndo?.()}
            >
              Unblock
            </Button>
          ) : null}
          <Button
            type="primary"
            loading={!!confirmLoading}
            disabled={!!confirmLoading || !!undoLoading}
            onClick={() => onConfirm({ wantReport, category, note, dontAskAgain })}
          >
            {primaryLabel}
          </Button>
        </Space>
      </Space>
    </Modal>
  );
}
```

## apps/web/components/post/PostView.tsx

```tsx
'use client';

import React from 'react';

import {
  Card,
  Descriptions,
  Image,
  Divider,
  Typography,
  Button,
  Space,
  Tooltip,
  Popconfirm,
  Row,
  Col,
  Grid,
  Modal,
  message,
  theme,
} from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MessageOutlined,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined,
  FacebookFilled,
  ShareAltOutlined,
  LinkOutlined,
  PhoneOutlined,
  BankOutlined,
  LockOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';

import type { PostRecord } from './PostForm';
import { useSessionCtx } from '@/lib/session-context';
import BookmarkButton from '@/components/BookmarkButton';
import { formatDate } from '@/lib/date';
import { CommentsSection } from '@/components/comments/CommentsSection';

import { TelBlockDialog } from '@/components/jachoei/TelBlockDialog';
import { BankReportDialog } from '@/components/jachoei/BankReportDialog';

import type { TelBlockDialogValue } from '@/components/jachoei/TelBlockDialog';
import type { BankReportDialogValue } from '@/components/jachoei/BankReportDialog';

import { useJachoeiLocalState } from '@/app/hooks/useJachoeiLocalState';
import { useJachoeiMutations } from '@/app/hooks/useJachoeiMutations';
import {
  getDontAskAgainForTel,
  normalizeBank,
  normalizeTel,
  setDontAskAgainForTel,
} from '@/app/lib/jachoeiLocalState';

const { useBreakpoint } = Grid;

type Props = {
  post: PostRecord | null;
  loading?: boolean;
  onDelete?: (id: string) => void;
  deleting?: boolean;
  title?: string;

  onClone?: (id: string) => void;
  cloning?: boolean;
};

/** =========================
 *  Share helpers
 *  ========================= */
type SharePayload = {
  url: string;
  title: string;
  text: string;
};

function buildSharePayload(post: PostRecord, baseUrl: string): SharePayload {
  const url = `${baseUrl}/post/${String(post?.id ?? '')}`;
  const title = post?.title ? String(post.title) : 'จ่าเฉย (Jachoei)';
  const detail = post?.detail ? String(post.detail).replace(/\s+/g, ' ').trim() : '';
  const text = detail
    ? `${title}\n\n${detail.slice(0, 180)}${detail.length > 180 ? '...' : ''}`
    : title;

  return { url, title, text };
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

function maskAccountForDisplay(accountRaw: string): string {
  const s = String(accountRaw ?? '').trim();
  if (!s) return '';

  const digits = s.replace(/[^\d]/g, '');
  if (digits.length <= 6) return s;

  const head = digits.slice(0, 3);
  const tail = digits.slice(-3);
  return `${head} •••• ${tail}`;
}

function TelChipRow({
  tel,
  blocked,
  onAction,
}: {
  tel: string;
  blocked: boolean;
  onAction: (telRaw: string) => void;
}) {
  const { token } = theme.useToken();
  const telRaw = String(tel ?? '');

  return (
    <div
      style={{
        height: 42,
        width: '100%',
        borderRadius: 999,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <Space size={8} style={{ minWidth: 0, flex: 1 }}>
        <PhoneOutlined style={{ color: token.colorTextSecondary }} />
        <Typography.Text
          ellipsis={{ tooltip: telRaw }}
          style={{ minWidth: 0, flex: 1, fontSize: 13 }}
        >
          {telRaw}
        </Typography.Text>

        <Tooltip title="Copy">
          <Button
            aria-label={`Copy tel ${telRaw}`}
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();

              try {
                await copyToClipboard(telRaw);
                message.success('Copied');
              } catch {
                message.error('Copy failed');
              }
            }}
          />
        </Tooltip>
      </Space>

      <Space size={8} align="center">
        {blocked ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 26,
              padding: '0 10px',
              borderRadius: 999,
              border: `1px solid ${token.colorErrorBorder}`,
              background: token.colorBgContainer,
              color: token.colorErrorText,
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            <LockOutlined />
            <span>บล็อกแล้ว</span>
          </div>
        ) : null}

        <Button
          aria-label={blocked ? `Manage tel ${telRaw}` : `Block tel ${telRaw}`}
          type="text"
          size="small"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAction(telRaw);
          }}
          style={{
            paddingInline: 8,
            height: 28,
            borderRadius: 999,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
          }}
        >
          {blocked ? 'จัดการ' : 'บล็อก'}
        </Button>
      </Space>
    </div>
  );
}

function BankChipRow({
  bankName,
  account,
  reported,
  onAction,
}: {
  bankName: string | null | undefined;
  account: string;
  reported: boolean;
  onAction: (bankName: string | null | undefined, accountRaw: string) => void;
}) {
  const { token } = theme.useToken();
  const bankLabel = String(bankName ?? '').trim();
  const accountRaw = String(account ?? '').trim();
  const displayAccount = maskAccountForDisplay(accountRaw);
  const displayText = bankLabel ? `${bankLabel} • ${displayAccount || accountRaw}` : displayAccount || accountRaw;

  return (
    <div
      style={{
        height: 42,
        width: '100%',
        borderRadius: 999,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <Space size={8} style={{ minWidth: 0, flex: 1 }}>
        <BankOutlined style={{ color: token.colorTextSecondary }} />
        <Typography.Text
          ellipsis={{ tooltip: displayText }}
          style={{ minWidth: 0, flex: 1, fontSize: 13 }}
        >
          {displayText || '-'}
        </Typography.Text>

        <Tooltip title="Copy">
          <Button
            aria-label={`Copy bank account ${accountRaw}`}
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();

              try {
                await copyToClipboard(accountRaw);
                message.success('Copied');
              } catch {
                message.error('Copy failed');
              }
            }}
          />
        </Tooltip>
      </Space>

      <Space size={8} align="center">
        {reported ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 26,
              padding: '0 10px',
              borderRadius: 999,
              border: `1px solid ${token.colorSuccessBorder}`,
              background: token.colorBgContainer,
              color: token.colorSuccessText,
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            <CheckCircleOutlined />
            <span>รายงานแล้ว</span>
          </div>
        ) : null}

        <Button
          aria-label={reported ? `Undo report bank account ${accountRaw}` : `Report bank account ${accountRaw}`}
          type="text"
          size="small"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAction(bankName ?? null, accountRaw);
          }}
          style={{
            paddingInline: 8,
            height: 28,
            borderRadius: 999,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
          }}
        >
          {reported ? 'ยกเลิกรายงาน' : 'รายงาน'}
        </Button>
      </Space>
    </div>
  );
}

function ShareActionButton({
  post,
  baseUrl,
  isMobile,
}: {
  post: PostRecord;
  baseUrl: string;
  isMobile: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  const payload = React.useMemo(() => buildSharePayload(post, baseUrl), [post, baseUrl]);

  const openFacebookShare = (shareUrl: string) => {
    const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    window.open(fb, '_blank', 'noopener,noreferrer');
  };

  const handleShare = async (e: React.MouseEvent<HTMLElement>) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    try {
      const nav = navigator as Navigator & {
        share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
      };

      if (nav?.share) {
        await nav.share({
          title: payload.title,
          text: payload.text,
          url: payload.url,
        });
        return;
      }

      setOpen(true);
    } catch (err: unknown) {
      const name = err instanceof Error ? (err as Error & { name?: string }).name : undefined;
      if (String(name || '').toLowerCase().includes('abort')) return;
      setOpen(true);
    }
  };

  return (
    <>
      <Tooltip title="Share">
        <Button
          type="text"
          size={isMobile ? 'small' : 'middle'}
          icon={<ShareAltOutlined />}
          onClick={handleShare}
        />
      </Tooltip>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        title="Share post"
        footer={null}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <Typography.Text strong>{payload.title}</Typography.Text>
            <div style={{ marginTop: 6 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {payload.url}
              </Typography.Text>
            </div>
          </div>

          <Space wrap>
            <Button
              icon={<LinkOutlined />}
              onClick={async () => {
                try {
                  await copyToClipboard(payload.url);
                  message.success('Copied link');
                } catch {
                  message.error('Copy failed');
                }
              }}
            >
              Copy link
            </Button>

            <Button
              icon={<CopyOutlined />}
              onClick={async () => {
                try {
                  await copyToClipboard(`${payload.title}\n${payload.url}`);
                  message.success('Copied text');
                } catch {
                  message.error('Copy failed');
                }
              }}
            >
              Copy text
            </Button>

            <Button icon={<FacebookFilled />} onClick={() => openFacebookShare(payload.url)}>
              Share to Facebook
            </Button>

            <Button
              onClick={() => {
                window.open(payload.url, '_blank', 'noopener,noreferrer');
              }}
            >
              Open link
            </Button>
          </Space>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Tip: บนมือถือจะเปิด native share ให้เองถ้าเครื่องรองรับ
          </Typography.Text>
        </div>
      </Modal>
    </>
  );
}

type TelDialogState = { open: boolean; tel: string; dontAskStored: boolean };
type BankDialogState = { open: boolean; bankName: string | null; account: string };

type PostDetails = PostRecord & {
  id: string | number;
  transfer_amount?: number | null;
  transfer_date?: string | null;
  website?: string | null;
  province_name?: string | null;
  province_id?: string | null;
  fb_published_at?: string | null;
  fb_status?: string | null;
  fb_permalink_url?: string | null;
  fb_social_post_id?: string | null;
  author?: { id: string | number; name?: string | null } | null;
  is_bookmarked?: boolean | null;
};

export default function PostView({
  post,
  loading,
  onDelete,
  deleting,
  title,
  onClone,
  cloning,
}: Props) {
  // ✅ Hooks MUST be called unconditionally (before any return)
  const { user } = useSessionCtx();
  const router = useRouter();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const jachoei = useJachoeiLocalState();
  const jachoeiMut = useJachoeiMutations();

  const requireAuthOrRedirect = React.useCallback((): boolean => {
    if (user) return true;

    const nextPath =
      typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search || ''}`
        : '/';

    router.push(`/login?next=${encodeURIComponent(nextPath)}`);
    return false;
  }, [router, user]);

  const [telDialog, setTelDialog] = React.useState<TelDialogState>({
    open: false,
    tel: '',
    dontAskStored: false,
  });
  const [bankDialog, setBankDialog] = React.useState<BankDialogState>({
    open: false,
    bankName: null,
    account: '',
  });

  const BASE_URL = React.useMemo(() => {
    return (
      process.env.NEXT_PUBLIC_BASE_URL ||
      (typeof window !== 'undefined' ? window.location.origin : 'https://jachoei.com')
    );
  }, []);

  // ✅ Derived safe values (work even when post is null)
  const p = React.useMemo<PostDetails | null>(() => {
    if (!post || post.id == null) return null;
    return { ...post, id: post.id } as PostDetails;
  }, [post]);

  const postId = React.useMemo(() => (p?.id != null ? String(p.id) : ''), [p]);
  const authorId = React.useMemo(() => {
    const id = p?.author?.id;
    return id != null ? String(id) : null;
  }, [p]);
  const userId = React.useMemo(() => {
    const id = user?.id;
    return id != null ? String(id) : null;
  }, [user]);

  const telNumbers = React.useMemo(() => p?.tel_numbers ?? [], [p]);
  const sellerAccounts = React.useMemo(() => p?.seller_accounts ?? [], [p]);

  const fbStatus = React.useMemo(() => String(p?.fb_status ?? '').toUpperCase(), [p]);
  const fbPermalinkUrl = React.useMemo(() => String(p?.fb_permalink_url ?? '').trim(), [p]);
  const isFbPublished = React.useMemo(
    () => fbStatus === 'PUBLISHED' && !!fbPermalinkUrl,
    [fbStatus, fbPermalinkUrl]
  );

  const performTelConfirm = React.useCallback(
    async (telRaw: string, value: TelBlockDialogValue): Promise<boolean> => {
      const tel = normalizeTel(telRaw);
      if (!tel) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getBlockedTelEntry(tel);
      const wasBlocked = jachoei.isBlockedTel(tel);

      const wantReport = !!value.wantReport;
      const nextCategory = wantReport ? value.category : undefined;
      const nextNote = wantReport ? value.note : '';

      const optimisticEntry = {
        wantReport,
        category: nextCategory,
        note: nextNote,
        blockedAt: prevEntry?.blockedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      jachoei.setBlockedTelEntry(tel, optimisticEntry);

      try {
        const payload = await jachoeiMut.reportPhone({
          phone: tel,
          category: nextCategory,
          note: wantReport ? nextNote : null,
        });

        jachoei.setBlockedTelEntry(tel, {
          ...optimisticEntry,
          blockedAt: payload.updated_at ?? optimisticEntry.blockedAt,
          ctx: payload.ctx ?? optimisticEntry.ctx,
          tags: payload.tags ?? optimisticEntry.tags,
        });

        message.success(wasBlocked ? 'Updated report' : 'Blocked');
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setBlockedTelEntry(tel, prevEntry);
        else jachoei.removeBlockedTelEntry(tel);

        const msg = err instanceof Error ? err.message : 'Action failed';
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const performTelUndo = React.useCallback(
    async (telRaw: string): Promise<boolean> => {
      const tel = normalizeTel(telRaw);
      if (!tel) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getBlockedTelEntry(tel);
      const wasBlocked = jachoei.isBlockedTel(tel);

      jachoei.removeBlockedTelEntry(tel);

      try {
        await jachoeiMut.unblockPhone({ phone: tel });
        message.success('Unblocked');
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setBlockedTelEntry(tel, prevEntry);
        else if (wasBlocked) jachoei.setBlockedTelEntry(tel, {});

        const msg = err instanceof Error ? err.message : 'Action failed';
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const performBankConfirm = React.useCallback(
    async (bankName: string | null | undefined, accountRaw: string, value: BankReportDialogValue): Promise<boolean> => {
      const account = normalizeBank(accountRaw);
      if (!account) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getReportedBankEntry(account);
      const wasReported = jachoei.isReportedBank(account);

      const optimisticEntry = {
        bank_name: bankName ?? prevEntry?.bank_name ?? null,
        category: value.category,
        note: value.note,
        reportedAt: prevEntry?.reportedAt ?? new Date().toISOString(),
        ctx: prevEntry?.ctx,
        tags: prevEntry?.tags,
      };

      jachoei.setReportedBankEntry(account, optimisticEntry);

      try {
        const payload = await jachoeiMut.reportBank({
          account,
          bankName,
          category: value.category,
          note: value.note,
        });

        jachoei.setReportedBankEntry(account, {
          ...optimisticEntry,
          bank_name: payload.bank_name ?? optimisticEntry.bank_name,
          reportedAt: payload.updated_at ?? optimisticEntry.reportedAt,
          ctx: payload.ctx ?? optimisticEntry.ctx,
          tags: payload.tags ?? optimisticEntry.tags,
        });

        message.success(wasReported ? 'Updated report' : 'Reported');
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setReportedBankEntry(account, prevEntry);
        else jachoei.removeReportedBankEntry(account);

        const msg = err instanceof Error ? err.message : 'Action failed';
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const performBankUndo = React.useCallback(
    async (bankName: string | null | undefined, accountRaw: string): Promise<boolean> => {
      const account = normalizeBank(accountRaw);
      if (!account) return false;
      if (!requireAuthOrRedirect()) return false;

      const prevEntry = jachoei.getReportedBankEntry(account);
      const wasReported = jachoei.isReportedBank(account);

      jachoei.removeReportedBankEntry(account);

      try {
        await jachoeiMut.unreportBank({
          account,
          bankName,
          category: prevEntry?.category,
          reason: prevEntry?.note ?? null,
        });
        message.success('Unreported');
        return true;
      } catch (err: unknown) {
        if (prevEntry) jachoei.setReportedBankEntry(account, prevEntry);
        else if (wasReported) jachoei.setReportedBankEntry(account, { bank_name: bankName ?? null });

        const msg = err instanceof Error ? err.message : 'Action failed';
        message.error(msg);
        return false;
      }
    },
    [jachoei, jachoeiMut, requireAuthOrRedirect]
  );

  const openTelBlockFlow = React.useCallback(
    (telRaw: string) => {
      const tel = normalizeTel(telRaw);
      if (!tel) return;

      if (!requireAuthOrRedirect()) return;

      const skipConfirm = getDontAskAgainForTel(tel);
      const blockedNow = jachoei.isBlockedTel(tel);

      if (skipConfirm && !blockedNow) {
        setDontAskAgainForTel(tel, true);
        void performTelConfirm(tel, { wantReport: true, category: 'SCAM', note: '', dontAskAgain: true });
        return;
      }

      setTelDialog({ open: true, tel, dontAskStored: skipConfirm });
    },
    [jachoei, performTelConfirm, requireAuthOrRedirect]
  );

  const openBankReportFlow = React.useCallback((bankName: string | null | undefined, accountRaw: string) => {
    const account = normalizeBank(accountRaw);
    if (!account) return;

    if (!requireAuthOrRedirect()) return;
    setBankDialog({ open: true, bankName: bankName ?? null, account });
  }, [requireAuthOrRedirect]);

  // ✅ Early returns AFTER hooks are defined
  if (!post) {
    return (
      <Card loading={loading} title={title ?? 'Post [x]'}>
        No data.
      </Card>
    );
  }

  if (!p) {
    return (
      <Card loading={loading} title={title ?? 'Post [x]'}>
        Invalid post.
      </Card>
    );
  }

  const fbBtn = (
    <Button
      type="text"
      size={isMobile ? 'small' : 'middle'}
      icon={<FacebookFilled />}
      disabled={!isFbPublished}
      aria-label="Facebook"
      style={{
        opacity: isFbPublished ? 1 : 0.35,
        cursor: isFbPublished ? 'pointer' : 'not-allowed',
      }}
    />
  );

  return (
    <Card
      title={title ?? 'รายละเอียดโพสต์'}
      loading={loading}
      headStyle={{
        padding: isMobile ? '8px 12px' : '12px 16px',
      }}
      bodyStyle={{
        padding: isMobile ? 12 : 16,
      }}
      extra={
        <Space size={isMobile ? 4 : 8} wrap>
          <Tooltip
            title={isFbPublished ? 'Open Facebook post' : `Facebook: ${fbStatus || 'NOT PUBLISHED'}`}
          >
            {isFbPublished ? (
              <a href={fbPermalinkUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex' }}>
                {fbBtn}
              </a>
            ) : (
              fbBtn
            )}
          </Tooltip>

          {userId !== authorId && (
            <BookmarkButton postId={postId} defaultBookmarked={p.is_bookmarked ?? false} />
          )}

          {userId !== authorId && authorId && (
            <Link href={`/chat?to=${authorId}`} prefetch={false}>
              <Button type="text" size={isMobile ? 'small' : 'middle'} icon={<MessageOutlined />} title="Chat with" />
            </Link>
          )}

          {userId === authorId && (
            <>
              <Tooltip title="Clone">
                <Button
                  type="text"
                  size={isMobile ? 'small' : 'middle'}
                  onClick={() => onClone?.(postId)}
                  loading={cloning}
                  icon={<CopyOutlined />}
                />
              </Tooltip>

              <Tooltip title="Edit">
                <Link href={`/post/${postId}/edit`} prefetch={false}>
                  <Button type="text" size={isMobile ? 'small' : 'middle'} icon={<EditOutlined />} />
                </Link>
              </Tooltip>

              <Popconfirm title="Confirm delete?" okText="Yes" cancelText="No" onConfirm={() => onDelete?.(postId)}>
                <Tooltip title="Delete">
                  <Button
                    type="text"
                    size={isMobile ? 'small' : 'middle'}
                    danger
                    loading={deleting}
                    icon={<DeleteOutlined />}
                  />
                </Tooltip>
              </Popconfirm>
            </>
          )}

          <ShareActionButton post={post} baseUrl={BASE_URL} isMobile={isMobile} />
        </Space>
      }
    >
      {/* Dialogs */}
      <TelBlockDialog
        open={telDialog.open}
        tel={telDialog.tel}
        blocked={telDialog.tel ? jachoei.isBlockedTel(normalizeTel(telDialog.tel)) : false}
        defaultDontAskAgain={telDialog.dontAskStored}
        initialWantReport={jachoei.getBlockedTelEntry(telDialog.tel)?.wantReport}
        initialCategory={jachoei.getBlockedTelEntry(telDialog.tel)?.category}
        initialNote={jachoei.getBlockedTelEntry(telDialog.tel)?.note}
        confirmLoading={jachoeiMut.loading.reportPhone}
        undoLoading={jachoeiMut.loading.unblockPhone}
        onCancel={() => setTelDialog({ open: false, tel: '', dontAskStored: false })}
        onConfirm={(value) => {
          const tel = normalizeTel(telDialog.tel);
          if (!tel) return;

          if (!requireAuthOrRedirect()) return;

          setDontAskAgainForTel(tel, value.dontAskAgain);
          void performTelConfirm(tel, value).then((ok) => {
            if (ok) setTelDialog({ open: false, tel: '', dontAskStored: false });
          });
        }}
        onUndo={() => {
          const tel = normalizeTel(telDialog.tel);
          if (!tel) return;
          if (!requireAuthOrRedirect()) return;

          void performTelUndo(tel).then((ok) => {
            if (ok) setTelDialog({ open: false, tel: '', dontAskStored: false });
          });
        }}
      />

      <BankReportDialog
        open={bankDialog.open}
        bankName={bankDialog.bankName}
        account={bankDialog.account}
        reported={bankDialog.account ? jachoei.isReportedBank(normalizeBank(bankDialog.account)) : false}
        initialCategory={jachoei.getReportedBankEntry(bankDialog.account)?.category}
        initialNote={jachoei.getReportedBankEntry(bankDialog.account)?.note}
        confirmLoading={jachoeiMut.loading.reportBank}
        undoLoading={jachoeiMut.loading.unreportBank}
        onCancel={() => setBankDialog({ open: false, bankName: null, account: '' })}
        onConfirm={(value) => {
          if (!requireAuthOrRedirect()) return;
          void performBankConfirm(bankDialog.bankName, bankDialog.account, value).then((ok) => {
            if (ok) setBankDialog({ open: false, bankName: null, account: '' });
          });
        }}
        onUndo={() => {
          if (!requireAuthOrRedirect()) return;
          void performBankUndo(bankDialog.bankName, bankDialog.account).then((ok) => {
            if (ok) setBankDialog({ open: false, bankName: null, account: '' });
          });
        }}
      />

      {/* Layout */}
      <Row gutter={isMobile ? 12 : 24} align="top">
        <Col xs={24} md={14}>
          <Descriptions
            column={1}
            bordered={!isMobile}
            size={isMobile ? 'small' : 'middle'}
            labelStyle={{
              width: isMobile ? 130 : 200,
              fontSize: isMobile ? 12 : 14,
              padding: isMobile ? '6px 8px' : undefined,
            }}
            contentStyle={{
              fontSize: isMobile ? 13 : 14,
              padding: isMobile ? '6px 8px' : undefined,
            }}
          >
            <Descriptions.Item label="สินค้า/บริการ ที่สั่งซื้อ">{p.title || '-'}</Descriptions.Item>
            <Descriptions.Item label="รายละเอียดเพิ่มเติม">{p.detail || '-'}</Descriptions.Item>
            <Descriptions.Item label="ชื่อ-นามสกุล คนขาย">{p.first_last_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="เลขบัตรประชาชน / พาสปอร์ต">
              {p.id_card ? <Typography.Text copyable>{p.id_card}</Typography.Text> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="ยอดโอน">
              {p.transfer_amount != null
                ? Number(p.transfer_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="วันโอนเงิน">{p.transfer_date ? formatDate(p.transfer_date) : '-'}</Descriptions.Item>
            <Descriptions.Item label="เว็บประกาศขายของ">{p.website || '-'}</Descriptions.Item>
            <Descriptions.Item label="จังหวัดของคนสร้างรายงาน">{p.province_name || p.province_id || '-'}</Descriptions.Item>

            <Descriptions.Item label="Facebook">
              {isFbPublished ? (
                <Space size={8} wrap>
                  <Typography.Text>Published</Typography.Text>
                  {p.fb_published_at ? (
                    <Typography.Text type="secondary">{formatDate(p.fb_published_at)}</Typography.Text>
                  ) : null}
                  <Typography.Text type="secondary" copyable>
                    {fbPermalinkUrl}
                  </Typography.Text>
                </Space>
              ) : (
                <Typography.Text type="secondary">{fbStatus || 'NOT PUBLISHED'}</Typography.Text>
              )}
            </Descriptions.Item>
          </Descriptions>

          {/* Tel table */}
          {telNumbers.length > 0 && (
            <>
              <Divider orientation="left" style={{ margin: isMobile ? '12px 0' : '16px 0' }}>
                เบอร์โทรศัพท์ / ไอดีไลน์
              </Divider>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {telNumbers.map((t: { id?: string | number | null; tel?: string | null }, i: number) => {
                  const telRaw = String(t?.tel ?? '').trim();
                  const telNorm = normalizeTel(telRaw);
                  const blocked = telNorm ? jachoei.isBlockedTel(telNorm) : false;

                  return (
                    <TelChipRow
                      key={String(t?.id ?? telRaw ?? i)}
                      tel={telRaw}
                      blocked={blocked}
                      onAction={(raw) => {
                        if (!raw) return;
                        openTelBlockFlow(raw);
                      }}
                    />
                  );
                })}
              </Space>
            </>
          )}

          {/* Bank table */}
          {sellerAccounts.length > 0 && (
            <>
              <Divider orientation="left" style={{ margin: isMobile ? '12px 0' : '16px 0' }}>
                บัญชีคนขาย
              </Divider>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {sellerAccounts.map(
                  (
                    row: { seller_account?: string | null; bank_name?: string | null; id?: string | number | null },
                    i: number
                  ) => {
                    const accountRaw = String(row?.seller_account ?? '').trim();
                    const accountNorm = normalizeBank(accountRaw);
                    const reported = accountNorm ? jachoei.isReportedBank(accountNorm) : false;

                    return (
                      <BankChipRow
                        key={String(row?.id ?? accountRaw ?? row?.bank_name ?? i)}
                        bankName={row?.bank_name ?? null}
                        account={accountRaw}
                        reported={reported}
                        onAction={(bn, acc) => {
                          if (!acc) return;
                          openBankReportFlow(bn ?? null, acc);
                        }}
                      />
                    );
                  }
                )}
              </Space>
            </>
          )}

          {/* Images */}
          {(post.images || []).length > 0 && (
            <>
              <Divider orientation="left" style={{ margin: isMobile ? '12px 0' : '16px 0' }}>
                ไฟล์แนบ / รูปภาพ
              </Divider>
              <div
                style={{
                  marginTop: 8,
                  display: 'grid',
                  gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 110 : 160}px, 1fr))`,
                  gap: isMobile ? 8 : 12,
                }}
              >
                {(post.images || []).map((img) => (
                  <Image
                    key={String(img.id)}
                    src={img.url}
                    width={isMobile ? 110 : 160}
                    height={isMobile ? 110 : 160}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                  />
                ))}
              </div>
            </>
          )}
        </Col>

        {/* Comments */}
        <Col xs={24} md={10} style={{ marginTop: isMobile ? 16 : 0 }}>
          <Divider orientation="left" style={{ margin: isMobile ? '0 0 8px' : '0 0 12px' }}>
            ความคิดเห็น
          </Divider>
          <CommentsSection postId={postId} currentUserId={user?.id} />
        </Col>
      </Row>
    </Card>
  );
}
```

## apps/web/graphql/resolvers.ts

```ts
import crypto, { randomUUID }  from "crypto";
import { GraphQLError } from "graphql/error";
import bcrypt from 'bcryptjs';
import { query, runInTransaction } from "@/lib/db";
import { pubsub } from "@/lib/pubsub";
import * as jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import path from "path";
import GraphQLJSON from "graphql-type-json";

import { USER_COOKIE, ADMIN_COOKIE, JWT_SECRET } from "@/lib/auth/token";
import { createResetToken, sendPasswordResetEmail } from "@/lib/passwordReset";
import { buildFileUrlById, persistUploadStream } from "@/lib/storage";
import { requireAuth, sha256Hex, generateRawToken } from "@/lib/auth"
import { addLog } from '@/lib/log/log';
import { v4 as uuidv4 } from 'uuid';

import { verifyGoogle, verifyFacebook } from "@/lib/auth/social";
// import { signUserToken } from "@/lib/auth/jwt";

import { GraphQLUpload } from "graphql-upload-nextjs";
import sgMail from "@sendgrid/mail";
import { createNotification } from '@/lib/notifications/service'; 

import { getLatestEmailTemplate, renderEmailTemplate } from "@/lib/emailTemplates";
import { sendEmail } from "@/lib/mailer";

import { emitPostEvent } from "@events/emit.server";

import { phoneResolvers } from "@/graphql/phoneBlock";

import { normalizeAccountNo } from "@/lib/phone";

export const COMMENT_ADDED = 'COMMENT_ADDED';
export const COMMENT_UPDATED = 'COMMENT_UPDATED';
export const COMMENT_DELETED = 'COMMENT_DELETED';
export const NOTI_CREATED   = 'NOTI_CREATED';

export const INCOMING_MESSAGE  = 'INCOMING_MESSAGE';

sgMail.setApiKey(process.env.NEXT_PUBLIC_SENDGRID_API_KEY!);

// (async () => {
//   const resp = await sgMail.send({
//     to: "android.somkid@gmail.com",
//     from: process.env.NEXT_PUBLIC_SENDGRID_FROM_EMAIL!,
//     subject: "SendGrid test",
//     html: "<b>Hello</b>",
//   });
//   console.log("=====> OK", resp[0].statusCode);
// })();

const isDev = process.env.NODE_ENV !== "production";
const useSecureCookie = process.env.COOKIE_SECURE === "true";

type GraphQLUploadFile = {
  filename: string;
  mimetype?: string | null;
  encoding?: string | null;
  createReadStream: () => NodeJS.ReadableStream;
};

// setInterval(() => {
//   const now = new Date().toISOString();

//   console.log("[appResolvers.ts][TIME_TICK]");
//   pubsub.publish("TIME_TICK", { time: now });

// }, 50000);

const TOKEN_TTL_DAYS = 7;
const topicChat = (chat_id: string) => `MSG_CHAT_${chat_id}`;
const topicUser = (user_id: string) => `MSG_USER_${user_id}`;
type Iso = string;

function normalizeStr(input: string): string {
  return input
    .toLowerCase()              // เป็นตัวเล็ก
    .normalize("NFD")           // แยก accent (รองรับไทย/ภาษายุโรป)
    .replace(/[\u0300-\u036f]/g, "") // ลบ accent
    .replace(/[^a-z0-9]+/g, "_") // อะไรที่ไม่ใช่ a-z 0-9 → _
    .replace(/_+/g, "_")         // แทน _ ซ้อนหลายตัวด้วย _
    .replace(/^_+|_+$/g, "");    // ตัด _ หน้า/หลัง
}

async function getUserById(id: string) {
  const { rows } = await query(
    `SELECT * FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

function buildLike(term: string) {
  // escape % และ _ กัน LIKE แตก
  return `%${term.replace(/[%_]/g, (m) => "\\" + m)}%`;
}

// ป้องกัน tsquery ระเบิดถ้ามี symbol แปลก
function buildTsQuery(term: string) {
  // ถ้าอยากโหดกว่านี้ แยกเป็น token & join ด้วย AND ก็ได้
  return term
    .trim()
    .replace(/[':]/g, " ") // เอา symbol ที่ tsquery ไม่ชอบออก
    .replace(/\s+/g, " ");
}

// helper
function maskAccount(account: any) {
  if (!account) return "";
  return account.replace(/.(?=.{4})/g, "x");
}

function calcRisk(reportCount: number): number {
  if (reportCount >= 20) return 90;
  if (reportCount >= 10) return 60;
  if (reportCount >= 5)  return 40;
  return 10;
}

function baseData(locale: string) {
  return {
    app_name: process.env.NEXT_PUBLIC_WEB_NAME ?? "Jachoei",
    year: new Date().getFullYear(),
    support_url: process.env.NEXT_PUBLIC_SUPPORT_URL ?? "https://jachoei.com/support",
    locale,
  };
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeTel(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (!hasPlus && digits.startsWith("0") && digits.length === 10) return "66" + digits.slice(1);
  return hasPlus ? `+${digits}` : digits;
}

function normalizePhone(raw: string) {
  const s = String(raw || "").trim();
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (!hasPlus && digits.startsWith("0") && digits.length === 10) return "66" + digits.slice(1);
  return hasPlus ? `+${digits}` : digits;
}

function toIsoOrNull(v: any) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function uuidArrayToStringArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

function toIso(v: any, fallback?: any) {
  const d1 = v ? new Date(v) : null;
  if (d1 && !Number.isNaN(d1.getTime())) return d1.toISOString();

  const d2 = fallback ? new Date(fallback) : null;
  if (d2 && !Number.isNaN(d2.getTime())) return d2.toISOString();

  return new Date().toISOString();
}

function shapeScamBankAccount(row: any) {
  // DB summary มี: bank_name, account_no, account_norm, report_count, last_report_at, risk_level, updated_at
  return {
    bank_name: String(row?.bank_name || "UNKNOWN"),
    account: String(row?.account_norm || row?.account_no || ""),
    report_count: Number(row?.report_count || 0),
    last_report_at: row?.last_report_at ? new Date(row.last_report_at).toISOString() : null,
    risk_level: Number(row?.risk_level || 0),
    updated_at: row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    is_deleted: false,
    post_ids: [],
    ctx: null,
    tags: [],
  };
}

function normalizeBankAccount(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/[^\d]/g, "");
}

export const resolvers = {
  JSON: GraphQLJSON,
  Upload: GraphQLUpload,
  Query: {
    _health: async() =>{
      await emitPostEvent("post.created", {
        postId: "result.id",
        actorId: "author_id",
        title: "result.title",
        summary: undefined,
        url: undefined,
        revisionId: "revisionId",
        eventId: randomUUID(),
        occurredAt: new Date().toISOString()
      });

      console.error("[health] called");

      return `ok`;
    } ,
    me: async (_: any, {  }: { }, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, { optional: true });
      console.log("[Query] me :", author_id);

      const { rows } = await query(`SELECT * FROM users WHERE id=$1 LIMIT 1`, [author_id]);
      return rows[0];
    },
    meRole: async (_:any, __:any, ctx:any) => ctx.role || "Subscriber",
    // resolver: posts
    posts: async (_: any, { search }: { search?: string }, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, {  optionalWeb: true, optionalAndroid: true });
      console.log("[Query] posts :", author_id);

      const params: any[] = [];
      let sql = `
        SELECT
          p.*,
          row_to_json(u) AS author_json,

          -- images
          (
            SELECT COALESCE(json_agg(json_build_object('id', f.id, 'relpath', f.relpath)), '[]'::json)
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id = p.id
          ) AS images,

          -- bookmarks
          COALESCE(
            JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('user_id', bm.user_id))
            FILTER (WHERE bm.user_id IS NOT NULL),
            '[]'::JSONB
          ) AS bookmarks

        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN bookmarks bm ON bm.post_id = p.id
      `;

      if (search) {
        sql += ` WHERE p.title ILIKE $1 OR p.phone ILIKE $1 `;
        params.push(`%${search}%`);
      }

      sql += ` GROUP BY p.id, u.id ORDER BY p.created_at DESC`;

      const { rows } = await query(sql, params);

      return rows.map((r: any) => ({
        ...r,
        author: r.author_json,
        images: (r.images || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),
        bookmarks: r.bookmarks || [],
        isBookmarked:
          Array.isArray(r.bookmarks) && author_id
            ? r.bookmarks.some((b: any) => b.user_id === author_id)
            : false,
      }));
    },
    postsPaged: async (
      _: any,
      { search, limit, offset }: { search?: string; limit: number; offset: number },
      ctx: any
    ) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      console.log("[Query] postsPaged :", author_id);

      const params: any[] = [];
      let whereSql = "";

      /* --------------------------------------
      * 🔎 SEARCH: title, phone, bank account
      * -------------------------------------- */
      if (search) {
        params.push(`%${search}%`); // $1
        const idx = params.length;

        whereSql = `
          WHERE (
            p.title ILIKE $${idx}
            OR EXISTS (
              SELECT 1 FROM post_tel_numbers t
              WHERE t.post_id = p.id
              AND t.tel ILIKE $${idx}
            )
            OR EXISTS (
              SELECT 1 FROM post_seller_accounts s
              WHERE s.post_id = p.id
              AND (
                s.seller_account ILIKE $${idx}
                OR s.bank_name ILIKE $${idx}
                OR s.bank_id ILIKE $${idx}
              )
            )
          )
        `;
      }

      /* --------------------------------------
      * 💡 ALWAYS enforce public status
      * -------------------------------------- */
      if (whereSql.trim() === "") {
        whereSql = `WHERE p.status = 'public'`;
      } else {
        whereSql += ` AND p.status = 'public'`;
      }

      /* --------------------------------------
      * ⭐ is_bookmarked (current user)
      * -------------------------------------- */
      let isBookmarkedSelect = `false AS is_bookmarked`;
      if (author_id) {
        params.push(author_id);
        const meIdx = params.length;

        isBookmarkedSelect = `
          EXISTS (
            SELECT 1 FROM bookmarks bm
            WHERE bm.post_id = p.id
              AND bm.user_id = $${meIdx}
          ) AS is_bookmarked
        `;
      }

      /* --------------------------------------
      * LIMIT / OFFSET
      * -------------------------------------- */
      params.push(limit, offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const sql = `
        SELECT
          COUNT(*) OVER() AS total,
          p.*,
          row_to_json(u) AS author_json,

          -- ✅ facebook permalink (จาก social_posts)
          sp_fb.permalink_url AS fb_permalink_url,
          sp_fb.published_at  AS fb_published_at,
          sp_fb.status        AS fb_status,
          sp_fb.social_post_id AS fb_social_post_id,

          -- images
          (
            SELECT json_agg(json_build_object('id', f.id, 'relpath', f.relpath) ORDER BY pi.id)
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id = p.id
          ) AS images_json,

          -- tel numbers
          (
            SELECT json_agg(json_build_object('id', t.id, 'tel', t.tel) ORDER BY t.created_at)
            FROM post_tel_numbers t
            WHERE t.post_id = p.id
          ) AS tel_numbers_json,

          -- seller accounts
          (
            SELECT json_agg(
              json_build_object(
                'id', s.id,
                'bank_id', s.bank_id,
                'bank_name', s.bank_name,
                'seller_account', s.seller_account
              )
              ORDER BY s.created_at
            )
            FROM post_seller_accounts s
            WHERE s.post_id = p.id
          ) AS seller_accounts_json,

          -- 🔢 comments count
          (
            SELECT COUNT(*)
            FROM comments c
            WHERE c.post_id = p.id
          ) AS comments_count,

          -- is_bookmarked
          ${isBookmarkedSelect}

        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id

        -- ✅ JOIN social_posts เฉพาะ facebook (แถวเดียว)
        LEFT JOIN social_posts sp_fb
          ON sp_fb.post_id = p.id
        AND sp_fb.platform = 'facebook'

        ${whereSql}
        ORDER BY p.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;

      const { rows } = await query(sql, params);
      const total = rows[0]?.total ? Number(rows[0].total) : 0;

      const items = rows.map((r: any) => ({
        ...r,
        author: r.author_json,

        images: (r.images_json || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),

        tel_numbers: (r.tel_numbers_json || []).map((t: any) => ({
          id: t.id,
          tel: t.tel,
        })),

        seller_accounts: (r.seller_accounts_json || []).map((s: any) => ({
          id: s.id,
          bank_id: s.bank_id,
          bank_name: s.bank_name,
          seller_account: s.seller_account,
        })),

        comments_count: Number(r.comments_count || 0),
        is_bookmarked: !!r.is_bookmarked,

        // ✅ เพิ่ม fields สำหรับหน้า list
        fb_permalink_url: r.fb_permalink_url ?? null,
        fb_published_at: r.fb_published_at ?? null,
        fb_status: r.fb_status ?? null,
        fb_social_post_id: r.fb_social_post_id ?? null,
      }));

      return { items, total };
    },
    post: async (_: any, { id }: { id: string }, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, {  optionalWeb: true, optionalAndroid: true });
      console.log("[Query] post :", author_id);

      // ✅ 1) ดึง post + author + province + is_bookmarked + social_posts (facebook)
      const { rows } = await query(
        `
        SELECT
          p.*,
          row_to_json(u) AS author_json,
          pr.name_th AS province_name,

          -- ✅ social (facebook)
          sp_fb.permalink_url AS fb_permalink_url,
          sp_fb.published_at  AS fb_published_at,
          sp_fb.status        AS fb_status,
          sp_fb.social_post_id AS fb_social_post_id,

          -- ✅ คำนวณ is_bookmarked แบบไม่เป็น null
          CASE
            WHEN $2::uuid IS NULL THEN false
            ELSE EXISTS (
              SELECT 1 FROM bookmarks b
              WHERE b.post_id = p.id AND b.user_id = $2::uuid
            )
          END AS is_bookmarked

        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN provinces pr ON pr.id = p.province_id

        -- ✅ JOIN social_posts เฉพาะ facebook (แถวเดียว)
        LEFT JOIN social_posts sp_fb
          ON sp_fb.post_id = p.id
        AND sp_fb.platform = 'facebook'

        WHERE p.id = $1
        `,
        [id, author_id ?? null]
      );

      const r = rows[0];
      if (!r) return null;

      // ✅ 2) images
      const { rows: imgs } = await query(
        `
        SELECT f.id, f.relpath
        FROM post_images pi
        JOIN files f ON f.id = pi.file_id
        WHERE pi.post_id = $1
        ORDER BY pi.id
        `,
        [id]
      );

      // ✅ 3) tel_numbers
      const { rows: telNumbers } = await query(
        `
        SELECT id, tel, created_at
        FROM post_tel_numbers
        WHERE post_id = $1
        ORDER BY created_at ASC
        `,
        [id]
      );

      // ✅ 4) seller_accounts
      const { rows: sellerAccounts } = await query(
        `
        SELECT id, bank_id, bank_name, seller_account, created_at
        FROM post_seller_accounts
        WHERE post_id = $1
        ORDER BY created_at ASC
        `,
        [id]
      );

      return {
        ...r,

        // ✅ เพิ่มฟิลด์ auto_publish (กัน null -> boolean เสมอ)
        auto_publish: !!r.auto_publish,

        author: r.author_json,
        province_name: r.province_name || null,
        is_bookmarked: !!r.is_bookmarked,

        images: (imgs || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),

        tel_numbers: telNumbers || [],
        seller_accounts: sellerAccounts || [],

        // ✅ social (facebook) ที่เว็บจะใช้ทำปุ่ม "ไปที่โพสต์"
        fb_permalink_url: r.fb_permalink_url ?? null,
        fb_published_at: r.fb_published_at ?? null,
        fb_status: r.fb_status ?? null,
        fb_social_post_id: r.fb_social_post_id ?? null,
      };
    },


    myPosts: async (_:any, { search }:{search?:string}, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] myPosts :", ctx, author_id);

      if (search) {
        const { rows } = await query(
          `SELECT p.*, row_to_json(u.*) as author_json
           FROM posts p LEFT JOIN users u ON p.author_id = u.id
           WHERE p.author_id=$1 AND (p.title ILIKE $2 OR p.phone ILIKE $2)
           ORDER BY p.created_at DESC`, [author_id, '%' + search + '%']
        );
        return rows.map((r :any)=>({ ...r, author: r.author_json }));
      }
      const { rows } = await query(
        `SELECT p.*, row_to_json(u.*) as author_json
         FROM posts p LEFT JOIN users u ON p.author_id = u.id
         WHERE p.author_id=$1
         ORDER BY p.created_at DESC`, [author_id]
      );
      return rows.map((r :any)=>({ ...r, author: r.author_json }));
    },
    getOrCreateDm: async (_:any, { user_id }:{user_id:string}, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] getOrCreateDm :", ctx, author_id);

      if (!author_id) throw new Error("No demo user found");
      const { rows:exist } = await query(
        `SELECT c.* FROM chats c
         JOIN chat_members m1 ON m1.chat_id=c.id AND m1.user_id=$1
         JOIN chat_members m2 ON m2.chat_id=c.id AND m2.user_id=$2
         WHERE c.is_group=false LIMIT 1`, [author_id, user_id]
      );
      if (exist[0]) return exist[0];
      const { rows:crows } = await query(
        `INSERT INTO chats(is_group, created_by) VALUES(false, $1) RETURNING *`, [author_id]
      );
      const chat = crows[0];

      console.log("[getOrCreateDm]" , chat.id, author_id, user_id);
      // await query(`INSERT INTO chat_members(chat_id, user_id) VALUES ($1,$2),($1,$3)`, [chat.id, meId, user_id]);
      return chat;
    },
    myChats: async (_: any, { }: {}, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);

      const { rows } = await query(
        `
        SELECT
          c.*,
          row_to_json(uc.*) AS creator_json,

          -- last message + images
          (
            SELECT json_build_object(
              'id', lm.id,
              'chat_id', lm.chat_id,
              'text', lm.text,
              'created_at', lm.created_at,
              'sender_id', lm.sender_id,
              'images',
              (
                SELECT COALESCE(json_agg(row_to_json(mi.*)), '[]'::json)
                FROM message_images mi
                WHERE mi.message_id = lm.id
              )
            )
            FROM messages lm
            WHERE lm.chat_id = c.id
            ORDER BY lm.created_at DESC
            LIMIT 1
          ) AS last_message_json

        FROM chats c
        LEFT JOIN users uc ON c.created_by = uc.id
        WHERE EXISTS (
          SELECT 1
          FROM chat_members m
          WHERE m.chat_id = c.id AND m.user_id = $1
        )
        ORDER BY c.created_at DESC
        `,
        [author_id]
      );

      const out: any[] = [];

      for (const c of rows) {
        const mem = await query(
          `
          SELECT 
            u.id, u.name, u.avatar, u.phone, u.email,
            u.role, u.created_at, u.username, u.language
          FROM chat_members m
          JOIN users u ON m.user_id = u.id
          WHERE m.chat_id = $1
          `,
          [c.id]
        );

        let lastMessage = null;
        let lastMessageAt: string | null = null;

        if (c.last_message_json) {
          const lm = c.last_message_json;

          lastMessageAt = lm.created_at;//new Date(lm.created_at).toISOString();

          // แปลง images ให้เป็น array เสมอ
          const rawImages = Array.isArray(lm.images) ? lm.images : [];

          lastMessage = {
            id: lm.id,
            chat_id: lm.chat_id,
            text: lm.text || "",
            created_at: lastMessageAt,
            sender_id: lm.sender_id,

            images: rawImages.map((img: any) => ({
              id: img.id,
              url: img.url,
              file_id: img.file_id ?? null,
              mime: img.mime ?? null,
              width: img.width ?? null,
              height: img.height ?? null,
            })),

            // ฟิลด์อื่น ๆ เดี๋ยวให้ resolver ของ Message จัดการต่อ
            to_user_ids: [],
            is_deleted: false,
            deleted_at: null,
            myReceipt: null,
            readers: [],
            readersCount: 0,
          };
        }

        out.push({
          id: c.id,
          name: c.name,
          is_group: c.is_group,
          created_at: new Date(c.created_at).toISOString(),
          created_by: c.creator_json,
          members: mem.rows,
          last_message: lastMessage,
          last_message_at: lastMessageAt,
        });
      }
      // console.log("[Query] myChats :", out);
      return out;
    },
    myBookmarks: async (_: any, { limit = 20, offset = 0 }: any, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] myBookmarks :",  author_id);

      const { rows } = await query(
        `
        SELECT p.*, row_to_json(u) AS author_json,
               (
                 SELECT json_agg(json_build_object('id', f.id, 'relpath', f.relpath))
                 FROM post_images pi
                 JOIN files f ON f.id = pi.file_id
                 WHERE pi.post_id = p.id
               ) AS images_json
        FROM bookmarks b
        JOIN posts p ON b.post_id = p.id
        LEFT JOIN users u ON p.author_id = u.id
        WHERE b.user_id = $1
        ORDER BY b.created_at DESC
        LIMIT $2 OFFSET $3
        `,
        [author_id, limit, offset]
      );

      return rows.map((r: any) => ({
        ...r,
        author: r.author_json,
        images: (r.images_json || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),
        is_bookmarked: true
      }));
    },
    messages: async (
      _: any,
      {
        chat_id,
        limit = 50,
        offset = 0,
        includeDeleted = false,
      }: {
        chat_id: string;
        limit?: number;
        offset?: number;
        includeDeleted?: boolean;
      },
      ctx: any
    ) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);

      console.log("[Query] messages :", author_id, limit, offset);

      const filter = includeDeleted ? "" : "AND m.deleted_at IS NULL";

      // ===== MAIN MESSAGE FETCH =====
      const { rows } = await query(
        `
        SELECT
          m.*,
          (m.deleted_at IS NOT NULL) AS is_deleted,
          row_to_json(u.*) AS sender_json,

          (
            SELECT COALESCE(json_agg(row_to_json(mi.*)), '[]'::json)
            FROM message_images mi
            WHERE mi.message_id = m.id
          ) AS images_json,

          (
            SELECT json_build_object(
              'delivered_at', r.delivered_at,
              'read_at',      r.read_at,
              'is_read',      (r.read_at IS NOT NULL)
            )
            FROM message_receipts r
            WHERE r.message_id = m.id AND r.user_id = $2
            LIMIT 1
          ) AS my_receipt_json,

          (
            SELECT COALESCE(json_agg(row_to_json(ru.*) ORDER BY r2.read_at ASC), '[]'::json)
            FROM message_receipts r2
            JOIN users ru ON ru.id = r2.user_id
            WHERE r2.message_id = m.id AND r2.read_at IS NOT NULL
          ) AS readers_json,

          (
            SELECT COUNT(*)::INT
            FROM message_receipts r3
            WHERE r3.message_id = m.id AND r3.read_at IS NOT NULL
          ) AS readers_count

        FROM messages m
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = $1 ${filter}
        ORDER BY m.created_at DESC
        LIMIT $3 OFFSET $4
        `,
        [chat_id, author_id, limit, offset]
      );

      // ===== FETCH all reply_to messages =====
      const replyIds = rows
        .map((r: any) => r.reply_to_id)
        .filter((x: any) => !!x);

      let replyMap: Record<string, any> = {};

      if (replyIds.length > 0) {
        const replyQuery = await query(
          `
          SELECT
            m.*,
            row_to_json(u.*) AS sender_json,
            (
              SELECT COALESCE(json_agg(row_to_json(mi.*)), '[]'::json)
              FROM message_images mi
              WHERE mi.message_id = m.id
            ) AS images_json
          FROM messages m
          LEFT JOIN users u ON u.id = m.sender_id
          WHERE m.id = ANY($1::uuid[])
          `,
          [replyIds]
        );

        replyQuery.rows.forEach((m: any) => {
          replyMap[m.id] = {
            id: m.id,
            text: m.text,
            sender: m.sender_json,
            images: Array.isArray(m.images_json)
              ? m.images_json.map((i: any) => ({
                  id: i.id,
                  url: i.url,
                  file_id: i.file_id ?? null,
                  mime: i.mime ?? null,
                  width: i.width ?? null,
                  height: i.height ?? null,
                }))
              : [],
          };
        });
      }

      // ===== PACK FINAL RESULTS =====
      const results = rows.map((r: any) => {
        const createdISO = new Date(r.created_at).toISOString();
        const mr = r.my_receipt_json || null;

        return {
          id: r.id,
          chat_id: r.chat_id,
          created_at: createdISO,
          sender: r.sender_json,

          images: Array.isArray(r.images_json)
            ? r.images_json.map((img: any) => ({
                id: img.id,
                url: img.url,
                file_id: img.file_id,
                mime: img.mime || null,
                width: img.width || null,
                height: img.height || null,
              }))
            : [],

          text: r.is_deleted ? "" : r.text,
          to_user_ids: r.to_user_ids || [],

          myReceipt: {
            deliveredAt: mr?.delivered_at
              ? new Date(mr.delivered_at).toISOString()
              : createdISO,
            readAt: mr?.read_at ? new Date(mr.read_at).toISOString() : null,
            isRead: !!mr?.is_read,
          },

          readers: Array.isArray(r.readers_json) ? r.readers_json : [],
          readersCount: Number(r.readers_count) || 0,

          is_deleted: r.is_deleted ?? false,
          deleted_at: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,

          reply_to_id: r.reply_to_id || null,
          reply_to: r.reply_to_id ? replyMap[r.reply_to_id] : null,
        };
      });

      console.log("[Query] messages", chat_id, results.length);
      return results;
    },
    users: async (
      _: any,
      { search, limit = 10, offset = 0 }: { search?: string; limit?: number; offset?: number },
      ctx: any
    ) => {
      const { author_id } = requireAuth(ctx);
      console.log("[Query] users :", author_id, { search, limit, offset });

      // กัน limit โหด ๆ
      const safeLimit = Math.min(Math.max(limit || 10, 1), 100);
      const safeOffset = Math.max(offset || 0, 0);

      const where = search
        ? `WHERE name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1`
        : ``;

      const params: any[] = [];
      if (search) params.push(`%${search}%`);

      // total
      const totalRes = await query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM users ${where}`,
        params
      );
      const total = Number(totalRes.rows[0]?.total || 0);

      // items
      const itemsParams = [...params, safeLimit, safeOffset];
      const limitIdx = itemsParams.length - 1;     // not used directly
      // ใช้ตำแหน่งจริง: (params+1)=limit, (params+2)=offset
      const limitPos = params.length + 1;
      const offsetPos = params.length + 2;

      const itemsRes = await query(
        `
        SELECT *
        FROM users
        ${where}
        ORDER BY created_at DESC
        LIMIT $${limitPos} OFFSET $${offsetPos}
        `,
        itemsParams
      );

      return { items: itemsRes.rows, total };
    },
    user: async (_: any, { id }: { id: string }, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, {  optionalWeb: true, optionalAndroid: true });
      console.log("[Query] user", id, author_id);

      return await getUserById(id);
    },
    postsByUserId: async (_: any, { user_id }: { user_id: string }, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, {  optionalWeb: true, optionalAndroid: true });
      console.log("[Query] postsByUserId :", author_id, "target:", user_id);

      const params: any[] = [user_id];
      const sql = `
        SELECT
          p.*,
          row_to_json(u) AS author_json,

          -- tel_numbers
          (
            SELECT COALESCE(
              json_agg(
                json_build_object(
                  'id', t.id,
                  'tel', t.tel
                )
              ),
              '[]'::json
            )
            FROM post_tel_numbers t
            WHERE t.post_id = p.id
          ) AS tel_numbers,

          -- seller_accounts
          (
            SELECT COALESCE(
              json_agg(
                json_build_object(
                  'id', sa.id,
                  'bank_id', sa.bank_id,
                  'bank_name', sa.bank_name,
                  'seller_account', sa.seller_account
                )
              ),
              '[]'::json
            )
            FROM post_seller_accounts sa
            WHERE sa.post_id = p.id
          ) AS seller_accounts,

          -- images
          (
            SELECT COALESCE(
              json_agg(
                json_build_object('id', f.id, 'relpath', f.relpath)
              ),
              '[]'::json
            )
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id = p.id
          ) AS images,

          -- bookmarks
          COALESCE(
            JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('user_id', bm.user_id))
            FILTER (WHERE bm.user_id IS NOT NULL),
            '[]'::JSONB
          ) AS bookmarks

        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN bookmarks bm ON bm.post_id = p.id
        WHERE p.author_id = $1
        GROUP BY p.id, u.id
        ORDER BY p.created_at DESC
      `;

      const { rows } = await query(sql, params);

      return rows.map((r: any) => ({
        ...r,
        author: r.author_json,
        images: (r.images || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),

        // ✅ ไม่ให้เป็น null
        tel_numbers: (r.tel_numbers || []).map((it: any) => ({
          id: it.id,
          tel: it.tel,
        })),

        seller_accounts: (r.seller_accounts || []).map((it: any) => ({
          id: it.id,
          bank_id: it.bank_id,
          bank_name: it.bank_name,
          seller_account: it.seller_account,
        })),

        bookmarks: r.bookmarks || [],
        isBookmarked:
          Array.isArray(r.bookmarks) && author_id
            ? r.bookmarks.some((b: any) => b.user_id === author_id)
            : false,
      }));
    },
    unreadCount: async (_:any, { chatId }:{ chatId: string }, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] unreadCount :", author_id);

      const { rows } = await query(
        `SELECT unread_count FROM chat_unread_counts WHERE user_id=$1 AND chat_id=$2`,
        [author_id, chatId]
      ).catch(()=>({ rows:[] as any[] }));
      if (rows[0]) return Number(rows[0].unread_count || 0);

      const { rows:rows2 } = await query(
        `SELECT COUNT(*)::BIGINT AS unread_count
         FROM messages m
         LEFT JOIN message_receipts r ON r.message_id=m.id AND r.user_id=$1
         WHERE m.chat_id=$2 
          AND m.sender_id <> $1 
          AND (r.read_at IS NULL)
          AND m.deleted_at IS NULL`,
        [author_id, chatId]
      );
      return Number(rows2[0]?.unread_count || 0);
    },
    whoRead: async (_:any, { messageId }:{messageId:string}, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] whoRead :", author_id);

      const { rows } = await query(
        `SELECT u.* FROM message_receipts r
         JOIN users u ON u.id = r.user_id
         WHERE r.message_id=$1 AND r.read_at IS NOT NULL
         ORDER BY r.read_at ASC`,
        [messageId]
      );
      return rows;
    },
    stats: async (_:any, __:any, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] stats :", author_id);

      const results = await Promise.all([
        query(`SELECT COUNT(*)::int AS c FROM users`),
        query(`SELECT COUNT(*)::int AS c FROM posts`),
        query(`SELECT COUNT(*)::int AS c FROM files WHERE deleted_at IS NULL`),
        query(`SELECT COUNT(*)::int AS c FROM system_logs`),
      ]);

      const [users, posts, files, logs] = results.map(( r:any)=> r.rows[0].c);

      return { users, posts, files, logs };
    },
    latestUsers: async (_: any, { limit = 5 }: any, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] latestUsers :", author_id);

      const { rows } = await query(
        `SELECT id, name, email, role, created_at, avatar
        FROM users
        ORDER BY created_at DESC
        LIMIT $1`,
        [limit]
      );

      return rows.map((u: any) => ({
        ...u,
        avatar: u.avatar || null, // ถ้าไม่มีค่าให้เป็น null
      }));
    },
    latestPosts: async (_: any, { limit = 5 }: any, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] latestPosts :", author_id);

      const { rows } = await query(
        `
        SELECT 
          p.id, p.title, p.status, p.created_at,
          (
            SELECT json_agg(json_build_object('id', f.id, 'relpath', f.relpath) ORDER BY pi.id)
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id = p.id
          ) AS images_json
        FROM posts p
        ORDER BY p.created_at DESC
        LIMIT $1
        `,
        [limit]
      );

      return rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        created_at: r.created_at,
        images: (r.images_json || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),
      }));
    },
    pending: async (_:any, __:any, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] pending :", author_id);

      const [posts, users, files, logs] = await Promise.all([
        query(`SELECT COUNT(*)::int AS c FROM posts WHERE status = 'pending'`),
        query(`SELECT COUNT(*)::int AS c FROM users WHERE status = 'invited' OR email_verified = false`),
        query(`SELECT COUNT(*)::int AS c FROM files WHERE category IS NULL AND deleted_at IS NULL`),
        query(`SELECT COUNT(*)::int AS c FROM system_logs WHERE level = 'error' AND created_at >= NOW() - INTERVAL '24 hours'`)
      ]);

      return {
        posts_awaiting_approval: posts.rows[0]?.c || 0,
        users_pending_invite: users.rows[0]?.c || 0,
        files_unclassified: files.rows[0]?.c || 0,
        errors_last24h: logs.rows[0]?.c || 0,
      };
    },
    filesPaged: async (_: any, { search, limit, offset }: any, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] pending :", author_id);

      const params: any[] = [];
      let where = '';
      if (search && search.trim()) {
        params.push(`%${search}%`);
        where = `WHERE f.original_name ILIKE $${params.length} OR f.filename ILIKE $${params.length}`;
      }
      params.push(limit, offset);

      const sql = `
        SELECT
          COUNT(*) OVER() AS total,
          f.*
        FROM files f
        ${where}
        ORDER BY f.created_at DESC
        LIMIT $${params.length-1} OFFSET $${params.length}
      `;
      const { rows } = await query(sql, params);
      const total = rows[0]?.total ? Number(rows[0].total) : 0;

      const items = rows.map((r: any) => ({
        ...r,
        url: buildFileUrlById(r.id),
        thumb: r.mimetype && r.mimetype.startsWith('image/')
          ? buildFileUrlById(r.id)
          : null,
      }));

      return { items, total };
    },

    // 
    myNotifications: async (
      _: any,
      args: { limit?: number; offset?: number },
      ctx: any
    ) => {
      const user = ctx.user; // สมมติ auth middleware ใส่มาแล้ว
      if (!user) throw new Error('Unauthorized');

      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;

      const { rows } = await query(
        `
        SELECT
          id,
          user_id,
          type,
          title,
          message,
          entity_type,
          entity_id,
          data,
          is_read,
          created_at
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        OFFSET $3
        `,
        [user.id, limit, offset]
      );

      return rows;
    },
    myUnreadNotificationCount: async (_: any, __: any, ctx: any) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');

      const { rows } = await query(
        `
        SELECT COUNT(*)::int AS count
        FROM notifications
        WHERE user_id = $1
          AND is_read = FALSE
        `,
        [user.id]
      );

      return rows[0]?.count ?? 0;
    },
    comments: async (_: any, { post_id }: { post_id: string }) => {
      const { rows } = await query(
        `
        SELECT
          c.id,
          c.post_id,
          c.user_id,
          c.parent_id,
          c.content,
          c.created_at,
          c.updated_at,
          u.id   AS u_id,
          u.name AS u_name,
          u.avatar AS u_avatar
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.post_id = $1
        ORDER BY c.created_at ASC
        `,
        [post_id]
      );

      // สร้าง comment object พร้อม user + replies array
      const byId = new Map<string, any>();

      for (const r of rows) {
        const comment = {
          id: r.id,
          post_id: r.post_id,
          user_id: r.user_id,
          parent_id: r.parent_id,
          content: r.content,
          created_at: r.created_at ? new Date(r.created_at).toISOString() : null, // r.created_at,
          updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null, // r.updated_at,
          user: {
            id: r.u_id,
            name: r.u_name,
            avatar: r.u_avatar,
          },
          replies: [] as any[],
        };

        byId.set(comment.id, comment);
      }

      // ประกอบ tree: ใครมี parent_id ก็ใส่เข้า replies ของ parent
      const roots: any[] = [];

      for (const comment of byId.values()) {
        if (comment.parent_id && byId.has(comment.parent_id)) {
          const parent = byId.get(comment.parent_id);
          parent.replies.push(comment);
        } else {
          roots.push(comment);
        }
      }

      return roots;
    },
    globalSearch: async (_: any, { q }: { q: string }, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, {  optionalWeb: true, optionalAndroid: true });
      console.log("[Query] globalSearch (pro) :", author_id, q);

      const term = (q || "").trim();
      if (!term) {
        return { posts: [], users: [], phones: [], bank_accounts: [] };
      }

      const like = buildLike(term);
      const useTrgm = term.length >= 3;

      // ============================
      // 1) POSTS (posts + title/detail_unaccent)
      // ============================
      const postsPromise = query(
        `
        SELECT
          s.id,
          s.title,
          s.snippet,
          s.created_at
        FROM (
          SELECT
            p.id,
            p.title,
            p.detail AS snippet,
            p.created_at,

            -- full-text rank (title A, detail C)
            ts_rank(
              tsvector_concat(
                setweight(to_tsvector('simple', coalesce(p.title_unaccent,  '')), 'A'),
                setweight(to_tsvector('simple', coalesce(p.detail_unaccent, '')), 'C')
              ),
              plainto_tsquery('simple', unaccent($1))
            ) AS ft_rank,

            -- trigram similarity
            GREATEST(
              similarity(coalesce(p.title_unaccent,  ''), unaccent($1)),
              similarity(coalesce(p.detail_unaccent, ''), unaccent($1))
            ) AS sim
          FROM posts p
          WHERE
                tsvector_concat(
                  setweight(to_tsvector('simple', coalesce(p.title_unaccent,  '')), 'A'),
                  setweight(to_tsvector('simple', coalesce(p.detail_unaccent, '')), 'C')
                ) @@ plainto_tsquery('simple', unaccent($1))
             OR p.title_unaccent  ILIKE unaccent($2)
             OR p.detail_unaccent ILIKE unaccent($2)
             -- เผื่อ row เก่าที่ยังไม่ได้ backfill
             OR p.title  ILIKE $2
             OR p.detail ILIKE $2
        ) AS s
        ORDER BY
          (s.ft_rank * 2.0 + s.sim * 5.0) DESC,
          s.created_at DESC
        LIMIT 20
        `,
        [term, like]
      );

      // ============================
      // 2) USERS (users + name/email_unaccent)
      // ============================
      const usersPromise = query(
        `
        SELECT
          s.id,
          s.name,
          s.email,
          s.phone,
          s.avatar
        FROM (
          SELECT
            u.id,
            u.name,
            u.email,
            u.phone,
            u.avatar,

            ts_rank(
              tsvector_concat(
                setweight(to_tsvector('simple', coalesce(u.name_unaccent,  '')), 'A'),
                setweight(to_tsvector('simple', coalesce(u.email_unaccent, '')), 'B')
              ),
              plainto_tsquery('simple', unaccent($1))
            ) AS ft_rank,

            GREATEST(
              similarity(coalesce(u.email_unaccent, ''), unaccent($1)),
              similarity(coalesce(u.phone,          ''), $1)
            ) AS sim
          FROM users u
          WHERE
                tsvector_concat(
                  setweight(to_tsvector('simple', coalesce(u.name_unaccent,  '')), 'A'),
                  setweight(to_tsvector('simple', coalesce(u.email_unaccent, '')), 'B')
                ) @@ plainto_tsquery('simple', unaccent($1))
             OR u.name_unaccent  ILIKE unaccent($2)
             OR u.email_unaccent ILIKE unaccent($2)
             OR u.phone ILIKE $2
        ) AS s
        ORDER BY
          (s.ft_rank * 2.5 + s.sim * 4.0) DESC
        LIMIT 20
        `,
        [term, like]
      );

      // ============================
      // 3) PHONES = post_tel_numbers
      // ============================

      const phonesSql = `
        SELECT
          array_agg(DISTINCT post_id::text) AS ids,
          tel                               AS phone,
          COUNT(*)                          AS report_count,
          MAX(created_at)                   AS last_report_at
        FROM post_tel_numbers
        WHERE
          ${useTrgm ? "tel % $1" : "tel ILIKE $1"}
        GROUP BY tel
        ORDER BY
          report_count   DESC,
          last_report_at DESC
        LIMIT 20
      `;

      const phonesParams = [useTrgm ? term : like];

      const phonesPromise = query(phonesSql, phonesParams);

      // ============================
      // 4) BANK ACCOUNTS = post_seller_accounts
      // ============================

      const banksSql = `
        SELECT
          array_agg(DISTINCT post_id::text) AS ids,
          bank_name,
          seller_account,
          COUNT(*)            AS report_count,
          MAX(created_at)     AS last_report_at
        FROM post_seller_accounts
        WHERE
          ${
            useTrgm
              ? "(account_unaccent % $1 OR bank_unaccent % $1)"
              : "(account_unaccent ILIKE $1 OR bank_unaccent ILIKE $1)"
          }
        GROUP BY bank_name, seller_account
        ORDER BY
          report_count   DESC,
          last_report_at DESC
        LIMIT 20
      `;

      const banksParams = [useTrgm ? term : like];

      const banksPromise = query(banksSql, banksParams);


      // run พร้อมกัน
      const [postsRes, usersRes, phonesRes, banksRes] = await Promise.all([
        postsPromise,
        usersPromise,
        phonesPromise,
        banksPromise,
      ]);

      const posts = postsRes.rows.map((row: any) => ({
        id: row.id,
        entity_id: row.id,
        title: row.title,
        snippet: row.snippet,
        created_at: row.created_at,
      }));

      const users = usersRes.rows.map((row: any) => ({
        id: row.id,
        entity_id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        avatar: row.avatar,
      }));

      const phones = phonesRes.rows.map((row: any) => ({
        // id: row.id,
        // entity_id: row.id,

        id: row.ids?.[0] ?? row.phone,
        entity_id: row.ids?.[0] ?? row.phone,

        // รวม post_id ทั้งหมดที่มีเบอร์นี้
        ids: row.ids ?? [],
        phone: row.phone,
        report_count: row.report_count,
        last_report_at: row.last_report_at,
      }));

      const bank_accounts = banksRes.rows.map((row: any) => ({
        // id: row.id,
        // entity_id: row.id,
        id: row.ids?.[0] ?? row.bank_name,
        entity_id: row.ids?.[0] ?? row.bank_name,
        ids: row.ids ?? [],     
        bank_name: row.bank_name,
        account_no_masked: row.seller_account,
        report_count: row.report_count,
        last_report_at: row.last_report_at,
      }));

      return { posts, users, phones, bank_accounts };
    },
    scamPhonesSnapshot: async (
        _: any,
        { cursor, limit }: { cursor?: string | null; limit: number },
        ctx: any
      ) => {
      console.log("[Query] scamPhonesSnapshot");

      const since = cursor || "1970-01-01T00:00:00Z";

      const { rows } = await query(
        `
        SELECT *
        FROM scam_phones_summary
        WHERE updated_at > $1
        ORDER BY updated_at ASC
        LIMIT $2
        `,
        [since, limit]
      );

      const items = rows.map((r: any) => ({
        phone: r.phone,
        report_count: r.report_count,
        last_report_at: r.last_report_at,
        risk_level: r.risk_level,
        tags: [],
        updated_at: r.updated_at,
        is_deleted: r.is_deleted,   // 👈 ใช้จาก DB เลย
        post_ids: r.post_ids,
      }));

      const nextCursor =
        rows.length === limit ? rows[rows.length - 1].updated_at : null;

      return { cursor: nextCursor, items };
    },
    scamPhonesDelta: async (
      _: any,
      {
        cursor,
        limit,
        sinceVersion,
      }: { cursor?: string | null; limit: number; sinceVersion: string },
      ctx: any
    ) => {
      console.log("[Query] scamPhonesDelta", { cursor, sinceVersion, limit });

      // เลือก source ก่อน: cursor > sinceVersion
      const rawSince = cursor || sinceVersion;

      // รองรับ 2 แบบ:
      // 1) ISO string เช่น "2025-11-28T03:20:00.000Z"
      // 2) epoch milliseconds เช่น "1763734660728"
      let sinceParam: string;

      if (/^\d+$/.test(rawSince)) {
        // เป็นตัวเลขล้วน → แปลว่า epoch (ms หรือ s)
        const num = Number(rawSince);
        // ถ้าใหญ่กว่า 1e12 นิด ๆ ส่วนใหญ่คือ ms → แปลงเป็นวินาทีให้ JS
        const ms = num > 1e12 ? num : num * 1000;
        sinceParam = new Date(ms).toISOString();
      } else {
        // สมมติว่าเป็น ISO อยู่แล้ว
        sinceParam = rawSince;
      }

      const { rows } = await query(
        `
        SELECT
          tel,
          COUNT(*)               AS report_count,
          MAX(created_at)        AS last_report_at,
          MAX(created_at)        AS updated_at,
          ARRAY_AGG(DISTINCT post_id) AS post_ids
        FROM post_tel_numbers
        WHERE created_at > $1
        GROUP BY tel
        ORDER BY updated_at ASC
        LIMIT $2
        `,
        [sinceParam, limit]
      );

      const items = rows.map((r: any) => ({
        phone: r.tel,
        report_count: Number(r.report_count),
        last_report_at: r.last_report_at,
        risk_level: calcRisk(Number(r.report_count)),
        tags: [],
        updated_at: r.updated_at,
        is_deleted: false,
        post_ids: r.post_ids,
      }));

      // cursor หน้าใหม่ ส่งกลับเป็น ISO (string)
      const nextCursor =
        rows.length === limit && rows.length > 0
          ? rows[rows.length - 1].updated_at
          : null;

      return {
        cursor: nextCursor,
        items,
      };
    },
    searchScamPhones: async (_: any, { q, limit }: any, ctx: any) => {
      // const auth = requireAuth(ctx);
      // if (!auth.isAuthenticated) throw new Error("Unauthenticated");

      const term = normalizePhone(q) || String(q || "").trim();
      const lim = Math.max(1, Math.min(Number(limit || 30), 50));

      // ✅ เลือกเฉพาะคอลัมน์ที่ "มีจริง" ใน scam_phones_summary
      const { rows } = await query(
        `
        SELECT
          phone,
          report_count,
          last_report_at,
          risk_level,
          updated_at
        FROM scam_phones_summary
        WHERE phone ILIKE $1
        ORDER BY report_count DESC, last_report_at DESC NULLS LAST
        LIMIT $2
        `,
        [`%${term}%`, lim]
      );

      // ✅ เติม fields ที่ schema ต้องการ แต่ DB ไม่มี
      return rows.map((r: any) => ({
        phone: r.phone,
        report_count: Number(r.report_count || 0),
        last_report_at: r.last_report_at ? new Date(r.last_report_at).toISOString() : null,
        risk_level: Number(r.risk_level || 0),
        tags: [],            // <<<<<< สำคัญ
        is_deleted: false,   // <<<<<< สำคัญ (ถ้าไม่มีใน DB)
        post_ids: [],        // <<<<<< สำคัญ
        ctx: null,           // <<<<<< สำคัญ
        updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
      }));
    },
    searchBankAccounts: async (
      _: any,
      { q, limit = 20 }: { q: string; limit: number },
      ctx: any
    ) => {
      console.log("[Query] searchBankAccounts", { q, limit });

      const term = String(q || "").trim();
      if (!term) return [];

      const safeLimit = Math.min(Math.max(limit || 20, 1), 50);
      const qNorm = normalizeAccountNo(term);

      console.log("[Query][qNorm] searchBankAccounts", qNorm);

      const mapRow = (r: any) => {
        const masked = maskAccount(r.account_no || r.account_norm);

        const lastReportISO = r.last_report_at
          ? new Date(r.last_report_at).toISOString()
          : null;

        const updatedISO = r.updated_at
          ? new Date(r.updated_at).toISOString()
          : lastReportISO;

        return {
          id: `${r.bank_name}:${r.account_norm}`,
          entity_id: `${r.bank_name}:${r.account_norm}`,
          ids: [],

          bank_name: r.bank_name,
          account_no_masked: masked,
          report_count: Number(r.report_count || 0),
          last_report_at: lastReportISO,

          // ✅ client fields
          account: masked,
          risk_level:
            r.risk_level != null
              ? Number(r.risk_level)
              : calcRisk(Number(r.report_count || 0)),
          tags: [],
          updated_at: updatedISO,

          // ✅ ไม่มีคอลัมน์ใน DB ก็คืน default ไปเลย
          is_deleted: false,
          post_ids: [],
          ctx: null,
        };
      };

      // -------------------------
      // case 1) query เป็นเลข -> exact + prefix
      // -------------------------
      if (qNorm.length > 0) {
        const { rows } = await query(
          `
          SELECT
            bank_name,
            account_norm,
            account_no,
            report_count,
            last_report_at,
            risk_level,
            updated_at
          FROM scam_bank_accounts_summary
          WHERE
                account_norm = $1
            OR  account_norm LIKE ($1 || '%')
          ORDER BY
            CASE WHEN account_norm = $1 THEN 0 ELSE 1 END,
            report_count DESC,
            last_report_at DESC NULLS LAST
          LIMIT $2
          `,
          [qNorm, safeLimit]
        );

        return rows.map(mapRow);
      }

      // -------------------------
      // case 2) ไม่ใช่เลข -> bank_name prefix
      // -------------------------
      const likePrefix = `${term}%`;

      const { rows } = await query(
        `
        SELECT
          bank_name,
          account_norm,
          account_no,
          report_count,
          last_report_at,
          risk_level,
          updated_at
        FROM scam_bank_accounts_summary
        WHERE bank_name ILIKE $1
        ORDER BY report_count DESC, last_report_at DESC NULLS LAST
        LIMIT $2
        `,
        [likePrefix, safeLimit]
      );

      return rows.map(mapRow);
    },
    searchScamBankAccounts: async (_: any, { q, limit }: { q: string; limit: number }, ctx: any) => {
      return resolvers.Query.searchBankAccounts(_, { q, limit }, ctx);
    },
    myReportedPhones: async (
      _: any,
      { limit, offset }: { limit: number; offset: number },
      ctx: any
    ) => {
      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new GraphQLError("Unauthenticated");
      }

      const userId = String(auth.author_id);
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const safeOffset = Math.max(Number(offset) || 0, 0);

      const { rows } = await query(
        `
        SELECT
          r.phone,
          r.phone_normalized,
          r.category,
          r.note,
          r.created_at,
          s.updated_at,
          COALESCE(s.report_count, 0) AS report_count,
          COALESCE(s.risk_level, 0) AS risk_level
        FROM scam_phone_reports r
        LEFT JOIN scam_phones_summary s
          ON s.phone = r.phone_normalized
        WHERE r.user_id = $1::uuid
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3
        `,
        [userId, safeLimit, safeOffset]
      );

      return (rows || []).map((row: any) => ({
        phone: String(row.phone || row.phone_normalized || ""),
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at, row.created_at),
        report_count: Number(row.report_count || 0),
        risk_level: Number(row.risk_level || 0),

        // ✅ DB ไม่มี tags ใน summary -> ให้ default เป็น []
        tags: [],

        // ✅ category ใน DB เป็น text -> ให้ normalize เป็น enum ที่ GraphQL รู้จัก
        category: (() => {
          const c = String(row.category || "").toUpperCase();
          if (["SPAM", "SCAM", "SALES", "HARASS", "OTHER"].includes(c)) return c;
          return "OTHER";
        })(),

        note: row.note ?? null,

        // ✅ DB ไม่มี post_id ใน reports -> ให้ null
        post_id: null,
      }));
    },
    myReportedBankAccounts: async (
        _: any,
        { limit, offset }: { limit: number; offset: number },
        ctx: any
      ) => {
      const auth = requireAuth(ctx);
      if (!auth?.isAuthenticated || !auth?.author_id) {
        throw new GraphQLError("Unauthenticated");
      }

      const userId = String(auth.author_id);
      const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), 200);
      const safeOffset = Math.max(Number(offset) || 0, 0);

      // ✅ IMPORTANT: ตารางคุณชื่อ scam_bank_account_reports + scam_bank_accounts_summary
      // ✅ IMPORTANT: reports มี account_norm / created_at / note
      // ✅ IMPORTANT: summary มี report_count / risk_level / updated_at / last_report_at
      const { rows } = await query(
        `
        SELECT
          r.bank_name,
          r.account_no,
          r.account_norm,
          r.note,
          r.created_at,
          s.updated_at AS summary_updated_at,
          COALESCE(s.report_count, 0) AS report_count,
          COALESCE(s.risk_level, 0) AS risk_level
        FROM scam_bank_account_reports r
        LEFT JOIN scam_bank_accounts_summary s
          ON s.bank_name = r.bank_name
         AND s.account_norm = r.account_norm
        WHERE r.user_id = $1::uuid
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3
        `,
        [userId, safeLimit, safeOffset]
      );

      return rows.map((r: any) => {
        const acc = normalizeBankAccount(r.account_no || r.account_norm || "");
        const bankName = String(r.bank_name || "UNKNOWN");
        const createdAt = toIso(r.created_at) || new Date().toISOString();
        const updatedAt = toIso(r.summary_updated_at) || createdAt;

        return {
          account: acc,
          bank_name: bankName,
          created_at: createdAt,
          updated_at: updatedAt,
          report_count: Number(r.report_count || 0),
          risk_level: Number(r.risk_level || 0),

          // DB ไม่มี tags ใน summary ตามรูป
          tags: [],

          // DB ไม่มี category/post_id ใน reports ตามรูป
          category: null,
          post_id: null,

          note: r.note ?? null,
        };
      });
    },
    ...phoneResolvers.Query
  },
  Mutation: {
    login: async (_: any, { input }: { input: { email?: string; username?: string; password: string } }, ctx: any) => {
      
      console.log("[login]");
      const { email, username, password } = input || {};
      if (!password || (!email && !username)) {
        throw new Error("Email/Username and password are required");
      }

      // เลือกฟิลด์ที่ใช้ล็อกอิน: email (แนะนำ) หรือ username (ถ้ามีคอลัมน์นี้ใน users)
      // ตัวอย่างนี้ใช้ email เป็นหลัก
      const identifier = email?.trim().toLowerCase() || username?.trim();
      const idField = email ? "email" : "name"; // ถ้าอยากใช้ username จริง ๆ ให้มีคอลัมน์ username แยก

      // ตรวจสอบรหัสผ่านด้วย pgcrypto (bcrypt)
      const { rows } = await query(
        `
        SELECT id, name, email, role, avatar, phone
        FROM users
        WHERE ${idField} = $1
          AND password_hash = crypt($2, password_hash)
        LIMIT 1
        `,
        [identifier, password]
      );

      const user = rows[0];
      if (!user) {
        // ป้องกันการเดารหัส/บัญชี โดยไม่บอกว่า email หรือ password ผิด
        return { ok: false, message: "Invalid credentials" };
      }

      // // สร้าง token อย่างง่าย (ควรเปลี่ยนเป็น JWT/Session จริงในงานจริง)
      // const token = crypto.randomBytes(24).toString("base64url");

      // // ถ้าต้องการเก็บ session/token ใน DB ให้สร้างตาราง sessions แล้ว INSERT ที่นี่
      // // await query(`INSERT INTO sessions(user_id, token, expired_at) VALUES ($1,$2,NOW() + interval '7 days')`, [user.id, token]);

      // // ถ้าใช้ Next.js API route สามารถตั้ง cookie httpOnly ที่ layer ของ API ได้
      // // ctx.res?.setHeader("Set-Cookie", `token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);


      // สร้าง token ใหม่
      const token = crypto.randomBytes(32).toString("base64url");
      const ttlDays = TOKEN_TTL_DAYS;
      const ua = ctx?.req?.headers?.get?.("user-agent") || null;
      const ip =
        (ctx?.req?.headers?.get?.("x-forwarded-for") || "").split(",")[0].trim() ||
        ctx?.req?.ip ||
        null;

      // (ทางเลือก) ยกเลิก session เดิมของผู้ใช้ (ให้มี 1 session ต่อคน)
      // await query(`DELETE FROM sessions WHERE user_id=$1`, [user.id]);

      // แทรก session ใหม่
      await query(
        `
        INSERT INTO sessions (token, user_id, user_agent, ip, expired_at)
        VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval)
        `,
        [token, user.id, ua, ip, String(ttlDays)]
      );

      // (ทางเลือกแนะนำ) ตั้ง httpOnly cookie ที่ชั้น Route/Handler
      // ctx.res?.setHeader("Set-Cookie", `token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlDays*86400}`);


      return {
        ok: true,
        message: "Login success",
        token,
        user,
      };
    },
    loginUser: async (_: any, { input }: { input: { email?: string; username?: string; password: string } }, ctx: any) => {
      console.log("[loginUser] @1 ", input)
      const { email, username, password } = input || {};
      if (!password || (!email && !username)) {
        throw new Error("Email/Username and password are required");
      }

      const { rows } = await query("SELECT * FROM users WHERE email=$1", [email]);
      const user = rows[0];

      console.log("[loginUser] @2 ", user, JWT_SECRET, process.env.COOKIE_SECURE);
      if (!user) throw new Error("Invalid credentials");
      // if (user.password_hash !== hash(password)) throw new Error("Invalid credentials");

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      cookies().set(USER_COOKIE, token, { httpOnly: true, secure: useSecureCookie && !isDev, sameSite: "lax", path: "/" });
      return {
        ok: true,
        message: "Login success",
        token,
        user,
      };
    },
    loginWithSocial: async (_: any, { input }: any, ctx: any) => {
      const { provider, accessToken } = input;

      let socialData = null;

      if (provider === "google") {
        socialData = await verifyGoogle(accessToken);
      } else if (provider === "facebook") {
        socialData = await verifyFacebook(accessToken);
      } else {
        throw new GraphQLError("Invalid provider");
      }

      if (!socialData) {
        throw new GraphQLError("Social token invalid");
      }

      const { email, name, picture, provider_id } = socialData;

      /* ======================================================
            1) หา user ถ้ามี email อยู่แล้ว → login เลย
         ====================================================== */
      const { rows: existing } = await query(
        `SELECT * FROM users WHERE email = $1 LIMIT 1`,
        [email]
      );

      let user = existing[0];

      /* ======================================================
            2) ถ้ายังไม่มี user → สร้างใหม่
         ====================================================== */
      if (!user) {
        const randomPassword = crypto.randomBytes(16).toString("hex");

        const { rows: newUser } = await query(
          `
          INSERT INTO users (name, username, email, avatar, role, password_hash, provider, provider_id, meta)
          VALUES ($1,$2,$3,$4,'Subscriber', crypt($5, gen_salt('bf')),$6,$7,$8)
          RETURNING *
        `,
          [name, normalizeStr(email), email, picture, randomPassword, provider, provider_id, JSON.stringify(socialData || {})]
        );

        user = newUser[0];
      }

      /*
      web-1       | [loginWithSocial] @1 =  {
      web-1       |   email: 'android.somkid@gmail.com',
      web-1       |   name: 'Somkid Simajarn',
      web-1       |   picture: 'https://lh3.googleusercontent.com/a/ACg8ocJ1XvMZgNQRmpi7ceC4dIhQMd6f2AumSMhVvTXilWF8y7hVkJ8b=s96-c',
      web-1       |   provider: 'google',
      web-1       |   provider_id: 'xxxx'
      web-1       | }
      */

      /*
      web-1       | [loginWithSocial] =  {
      web-1       |   id: 'c2570057-d8bd-4506-9f00-0c7fc6996d52',
      web-1       |   name: 'Somkid Simajarn',
      web-1       |   avatar: 'https://lh3.googleusercontent.com/a/ACg8ocJ1XvMZgNQRmpi7ceC4dIhQMd6f2AumSMhVvTXilWF8y7hVkJ8b=s96-c',
      web-1       |   phone: null,
      web-1       |   email: 'android.somkid@gmail.com',
      web-1       |   role: 'Subscriber',
      web-1       |   created_at: 2025-11-13T16:57:50.060Z,
      web-1       |   password_hash: '$2a$06$owU1d10euSYJdLhqxZGyFekkLyJzgz9eIox9c7mv1pwGHRmvyTk0a',
      web-1       |   meta: null,
      web-1       |   fake_test: null,
      web-1       |   username: null,
      web-1       |   language: 'en',
      web-1       |   updated_at: 2025-11-13T16:57:50.060Z
      web-1       | }
      */

      /* ======================================================
            3) ออก JWT token
         ====================================================== */
         /*
      const token = signUserToken(user);

      return jwt.sign(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        JWT_SECRET,
        { expiresIn: "30d" }
      );
      */

      //  id: user.id, email: user.email, role: user.role

      console.log("[loginWithSocial] @1 = ", socialData);
      console.log("[loginWithSocial] @2 = ", user);

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      cookies().set(USER_COOKIE, token, { httpOnly: true, secure: useSecureCookie && !isDev, sameSite: "lax", path: "/" });

      // แนะนำ: set cookie httpOnly ใน production
      // ctx.res.cookie("token", token, {
      //   httpOnly: true,
      //   sameSite: 'lax',
      //   path: '/'
      // });


      return {
        ok: true,
        message: "Login success",
        token,
        user,
      };
    },
    loginAdmin: async (_: any, { input }: { input: { email?: string; username?: string; password: string } }, ctx: any) => {
      console.log("[loginAdmin] @1 ", input)
      const { email, username, password } = input || {};
      if (!password || (!email && !username)) {
        throw new Error("Email/Username and password are required");
      }

      const { rows } = await query("SELECT * FROM users WHERE email=$1", [email]);
      const user = rows[0];

      console.log("[loginAdmin] @2 ", user)
      if (!user) throw new Error("Invalid credentials");
      // if (user.password_hash !== hash(password)) throw new Error("Invalid credentials");

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "1d" }
      );

      cookies().set(ADMIN_COOKIE, token, { httpOnly: true, secure: useSecureCookie && !isDev, sameSite: "lax", path: "/" });
      return {
        ok: true,
        message: "Login success",
        token,
        user,
      };
    },
    registerUser: async(_: any, { input }: any) => {
      const { username, email, phone, password, agree } = input;
      if (!agree) throw new Error('Please accept terms');
      const { rows: exists } = await query('SELECT 1 FROM users WHERE email=$1', [email]);
      if (exists.length) throw new Error('Email already registered');

      const password_hash = await bcrypt.hash(password, 10);
      const { rows: [u] } = await query(
        `INSERT INTO users(name,email,phone,role,password_hash)
        VALUES($1,$2,$3,'Subscriber',$4) RETURNING id,email,role`,
        [username, email, phone, password_hash]
      );

      /* =========================
        CREATE VERIFY TOKEN
      ========================= */
      const rawToken = generateRawToken();        // ส่งให้ user
      const tokenHash = sha256Hex(rawToken);         // เก็บใน DB
      const expiryMinutes = 30;

      await query(
        `INSERT INTO email_verify_tokens(user_id, token_hash, expires_at)
        VALUES ($1, $2, now() + interval '${expiryMinutes} minutes')`,
        [u.id, tokenHash]
      );

      const verify_url =`${process.env.NEXT_PUBLIC_BASE_URL}/verify-email?token=${rawToken}`;

      /* =========================
        SEND EMAIL (template)
      ========================= */
      const locale = "en";
      const tpl = await getLatestEmailTemplate("auth.verify", locale);

      const rendered = renderEmailTemplate(tpl, {
        ...baseData(locale),
        user_name: u.name,
        verify_url,
        expiry_minutes: expiryMinutes,
      });

      await sendEmail({
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });

      // sendMail

      const token = jwt.sign({ id: u.id, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: '7d' });
      cookies().set(USER_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: useSecureCookie && !isDev, path: '/' });

      return true;
    },
    requestPasswordReset: async (_: any, { email }: { email: string }, ctx: any) => {
      // 1) หา user จากอีเมล (อย่า leak ว่ามี/ไม่มี)
      const { rows } = await query(
        `SELECT id, email, name, language FROM users WHERE email = $1 LIMIT 1`,
        [email]
      );

      if (rows.length === 0) {
        return true; // กัน enumeration
      }

      const user = rows[0];

      // 2) สร้าง token + insert (ของคุณมีอยู่แล้ว)
      const { token, expiresAt } = await createResetToken(user.id);
      // ถ้า createResetToken ของคุณยังไม่ return expiresAt -> ไม่เป็นไร (ใช้ default 30 นาทีใน email ได้)

      // 3) สร้างลิงก์ไปหน้า /reset
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://yourapp.com";
      const resetUrl = `${baseUrl}/reset?token=${encodeURIComponent(token)}`;

      // 4) meta สำหรับ email (optional)
      const requestIp =
        ctx?.ip ||
        ctx?.req?.headers?.["x-forwarded-for"] ||
        ctx?.req?.socket?.remoteAddress ||
        "-";

      const requestDevice = ctx?.req?.headers?.["user-agent"] || "-";

      // 5) ส่งเมลผ่าน template ใน PG + SendGrid
      await sendPasswordResetEmail({
        to: user.email,
        locale: user.language ?? "en",
        userName: user.name ?? user.email,
        resetUrl,
        expiryMinutes: 30, // หรือคำนวณจาก expiresAt ถ้ามี
        requestIp: String(requestIp),
        requestDevice: String(requestDevice),
        requestTime: new Date().toISOString(),
      });

      return true;
    },
    resetPassword: async(_: any, { token, newPassword }: { token: string; newPassword: string }, ctx: any)=>{
      // 1) หา token
      const { rows } = await query(
        `SELECT prt.id, prt.user_id, prt.expires_at, prt.used
           FROM password_reset_tokens prt
           WHERE prt.token = $1`,
        [token]
      );
      if (rows.length === 0) throw new Error("Invalid token");

      const t = rows[0];
      if (t.used) throw new Error("Token already used");
      if (new Date(t.expires_at).getTime() < Date.now()) throw new Error("Token expired");

      // 2) อัปเดตรหัสผ่าน (แนะนำใช้ bcrypt/argon2; ที่นี่ตัวอย่าง sha256 เพื่อความง่าย)
      const password_hash = sha256Hex(newPassword);
      await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [password_hash, t.user_id]);

      // 3) มาร์ค token เป็นใช้แล้ว
      await query(`UPDATE password_reset_tokens SET used = true WHERE id = $1`, [t.id]);

      // (ออปชัน) revoke sessions อื่นๆ ของ user นี้

      return true;
    },
    verifyEmail: async (_: any, { token }: { token: string }) => {
      const tokenHash = sha256Hex(token);

      const { rows } = await query(
        `
        SELECT evt.id, evt.user_id
        FROM email_verify_tokens evt
        WHERE evt.token_hash = $1
          AND evt.used_at IS NULL
          AND evt.expires_at > now()
        LIMIT 1
        `,
        [tokenHash]
      );

      if (!rows[0]) {
        return { ok: false, message: "Invalid or expired token" };
      }

      const { id: tokenId, user_id } = rows[0];

      await query(`UPDATE users SET is_email_verified = true WHERE id = $1`, [
        user_id,
      ]);

      await query(
        `UPDATE email_verify_tokens SET used_at = now() WHERE id = $1`,
        [tokenId]
      );

      return { ok: true, message: "Email verified successfully" };
    },
    // resolver ตัวอย่าง
    updateMe: async (_:any, { data }: { data: any }, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const { name, phone, username, language } = data;

      console.log("[Mutation] updateMe :", author_id, name, phone, username, language );
      const { rows } = await query(
        `UPDATE users SET
          name = COALESCE($1, name),
          phone = COALESCE($2, phone),
          language = COALESCE($3, language),
          updated_at = NOW()
        WHERE id = $4
        RETURNING id, name, email, phone, username, language, avatar`,
        [name, phone, language, author_id]
      );
      return rows[0];
    },
    // upsertPost: async (
    //   _: any,
    //   { id, data, images, image_ids_delete }: {
    //     id?: string;
    //     data: any;
    //     images?: Array<Promise<GraphQLUploadFile>>;
    //     image_ids_delete?: Array<string | number>;
    //   },
    //   ctx: any
    // ) => {
    //   const { author_id, scope, isAuthenticated } = requireAuth(ctx);
    //   console.log("[Mutation] upsertPost :", author_id, data, image_ids_delete);

    //   const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
    //     let postId: string;

    //     // ============================================================
    //     // 1) UPSERT POSTS
    //     // ============================================================
    //     const commonFields = [
    //       data.first_last_name || null,
    //       data.id_card || null,
    //       data.title || null,
    //       data.transfer_amount || 0,
    //       data.transfer_date ? new Date(data.transfer_date) : null,
    //       data.website || null,
    //       data.province_id || null,
    //       data.detail || null,
    //       data.status || "public",
    //     ];

    //     if (id) {
    //       const { rows } = await client.query(
    //         `UPDATE posts
    //           SET first_last_name=$1, id_card=$2, title=$3,
    //               transfer_amount=$4, transfer_date=$5, website=$6,
    //               province_id=$7, detail=$8, status=$9,
    //               updated_at=NOW()
    //         WHERE id=$10
    //         RETURNING id`,
    //         [...commonFields, id]
    //       );
    //       postId = rows[0].id;
    //     } else {
    //       const { rows } = await client.query(
    //         `INSERT INTO posts (
    //           first_last_name, id_card, title,
    //           transfer_amount, transfer_date, website,
    //           province_id, detail,
    //           status, author_id, created_at, updated_at
    //         ) VALUES (
    //           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()
    //         )
    //         RETURNING id`,
    //         [...commonFields, author_id]
    //       );
    //       postId = rows[0].id;
    //     }

    //     // ============================================================
    //     // 2) TEL NUMBERS (insert/update/delete)
    //     // ============================================================
    //     if (Array.isArray(data.tel_numbers)) {
    //       console.log(`[TEL_SYNC] Incoming tel_numbers count = ${data.tel_numbers.length}`);

    //       for (const tel of data.tel_numbers) {
    //         const mode = tel.mode?.toLowerCase();
    //         const telId = tel.id;
    //         const phone = tel.tel;
    //         const post = postId;

    //         console.log(
    //           `[TEL_SYNC] mode=${mode} | id=${telId} | tel="${phone}" | postId=${post}`
    //         );

    //         if (mode === "deleted") {
    //           console.log(
    //             `[TEL_DELETE] DELETE FROM post_tel_numbers WHERE id=${telId} AND post_id=${post}`
    //           );

    //           await client.query(
    //             `DELETE FROM post_tel_numbers WHERE id=$1 AND post_id=$2`,
    //             [telId, post]
    //           );

    //           console.log(`[TEL_DELETE] success id=${telId}`);

    //         } else if (mode === "edited") {
    //           console.log(
    //             `[TEL_UPDATE] UPDATE post_tel_numbers SET tel="${phone}" WHERE id=${telId} AND post_id=${post}`
    //           );

    //           await client.query(
    //             `UPDATE post_tel_numbers SET tel=$1 WHERE id=$2 AND post_id=$3`,
    //             [phone, telId, post]
    //           );

    //           console.log(`[TEL_UPDATE] success id=${telId}, newTel="${phone}"`);

    //         } else if (mode === "new") {
    //           console.log(
    //             `[TEL_INSERT] INSERT INTO post_tel_numbers (post_id, tel) VALUES (${post}, "${phone}")`
    //           );

    //           await client.query(
    //             `INSERT INTO post_tel_numbers (post_id, tel)
    //             VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    //             [post, phone]
    //           );

    //           console.log(`[TEL_INSERT] success tel="${phone}"`);
    //         } else {
    //           console.warn(`[TEL_SYNC] Unknown mode="${mode}" for id=${telId}`);
    //         }
    //       }
    //     }


    //     // ============================================================
    //     // 3) SELLER ACCOUNTS (insert/update/delete)
    //     // ============================================================
    //     if (Array.isArray(data.seller_accounts)) {
    //       for (const acc of data.seller_accounts) {
    //         if (acc.mode === "deleted") {
    //           await client.query(`DELETE FROM post_seller_accounts WHERE id=$1 AND post_id=$2`, [acc.id, postId]);
    //         } else if (acc.mode === "edited") {
    //           await client.query(
    //             `UPDATE post_seller_accounts
    //               SET bank_id=$1, bank_name=$2, seller_account=$3
    //             WHERE id=$4 AND post_id=$5`,
    //             [acc.bank_id, acc.bank_name, acc.seller_account || "", acc.id, postId]
    //           );
    //         } else if (acc.mode === "new") {
    //           await client.query(
    //             `INSERT INTO post_seller_accounts (post_id, bank_id, bank_name, seller_account)
    //             VALUES ($1,$2,$3,$4)
    //             ON CONFLICT DO NOTHING`,
    //             [postId, acc.bank_id, acc.bank_name, acc.seller_account || ""]
    //           );
    //         }
    //       }
    //     }

    //     // ============================================================
    //     // 4) ลบรูปเก่า (ถ้ามี)
    //     // ============================================================
    //     if (image_ids_delete?.length) {
    //       await client.query(
    //         `DELETE FROM post_images WHERE post_id = $1 AND file_id = ANY($2::int[])`,
    //         [postId, image_ids_delete.map((id: any) => parseInt(id, 10))]
    //       );
    //     }

    //     // ============================================================
    //     // 5) เพิ่มรูปใหม่ (stream)
    //     // ============================================================
    //     if (images?.length) {
    //       const fileRows: any[] = [];

    //       for (const pf of images) {
    //         const upload = await pf; // GraphQLUploadFile

    //         const ext = path.extname(upload.filename || "");
    //         const renameTo = `post-${postId}-${Date.now()}${ext || ""}`;

    //         const row = await persistUploadStream(upload, renameTo);
    //         fileRows.push(row);
    //       }

    //       if (fileRows.length) {
    //         const values = fileRows.map((_, i) => `($1, $${i + 2})`).join(", ");
    //         await client.query(
    //           `INSERT INTO post_images (post_id, file_id) VALUES ${values}`,
    //           [postId, ...fileRows.map((r) => r.id)]
    //         );
    //       }
    //     }

    //     // ============================================================
    //     // 6) ดึงข้อมูลโพสต์กลับพร้อมรูป
    //     // ============================================================
    //     const { rows: posts } = await client.query(`SELECT * FROM posts WHERE id=$1`, [postId]);
    //     const { rows: imgs } = await client.query(
    //       `SELECT f.id, f.relpath
    //         FROM post_images pi
    //         JOIN files f ON f.id = pi.file_id
    //         WHERE pi.post_id=$1
    //         ORDER BY pi.id`,
    //       [postId]
    //     );

    //     // ============================================================
    //     // 7) LOG
    //     // ============================================================
    //     await addLog(
    //       "info",
    //       id ? "post-update" : "post-create",
    //       id ? "User updated a post" : "User created a post",
    //       { author_id, postId }
    //     );

    //     // ============================================================
    //     // RETURN
    //     // ============================================================
    //     return {
    //       ...posts[0],
    //       images: imgs.map((r: any) => ({
    //         id: r.id,
    //         url: buildFileUrlById(r.id),
    //       })),
    //     };
    //   });

    //   return result;
    // },

  upsertPost: async (
      _: any,
      {
        id,
        data,
        images,
        image_ids_delete,
      }: {
        id?: string;
        data: any;
        images?: Array<Promise<GraphQLUploadFile>>;
        image_ids_delete?: Array<string | number>;
      },
      ctx: any
    ) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] upsertPost :", author_id, data, image_ids_delete);

      // ✅ ให้เก็บ postId ไว้ใช้ emit หลัง commit
      let finalPostId: string | null = null;
      let finalTitle: string | null = null;
      let finalSummary: string | null = null;
      let finalUrl: string | null = null;
      let finalAutoPublish: boolean | null = null;

      // ✅ NEW: เก็บ tel_numbers ที่ “สถานะล่าสุดหลัง sync”
      let finalTelNumbers: Array<{ id: number; tel: string }> | null = null;

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        let postId: string;

        // ============================================================
        // 1) UPSERT POSTS
        // ============================================================
        // ✅ normalize auto_publish ให้เป็น boolean แน่นอน
        const autoPublish =
          typeof data.auto_publish === "boolean"
            ? data.auto_publish
            : data.auto_publish == null
              ? true
              : String(data.auto_publish).toLowerCase() === "true" || String(data.auto_publish) === "1";

        const commonFields = [
          data.first_last_name || null, // $1
          data.id_card || null, // $2
          data.title || null, // $3
          data.transfer_amount || 0, // $4
          data.transfer_date ? new Date(data.transfer_date) : null, // $5
          data.website || null, // $6
          data.province_id || null, // $7
          data.detail || null, // $8
          data.status || "public", // $9
          autoPublish, // $10 ✅ NEW
        ];

        if (id) {
          const { rows } = await client.query(
            `UPDATE posts
              SET first_last_name=$1, id_card=$2, title=$3,
                  transfer_amount=$4, transfer_date=$5, website=$6,
                  province_id=$7, detail=$8, status=$9,
                  auto_publish=$10,
                  updated_at=NOW()
            WHERE id=$11
            RETURNING id`,
            [...commonFields, id]
          );
          postId = rows[0].id;
        } else {
          const { rows } = await client.query(
            `INSERT INTO posts (
              first_last_name, id_card, title,
              transfer_amount, transfer_date, website,
              province_id, detail,
              status, auto_publish,
              author_id, created_at, updated_at
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()
            )
            RETURNING id`,
            [...commonFields, author_id]
          );
          postId = rows[0].id;
        }

        // ============================================================
        // 2) TEL NUMBERS (insert/update/delete)
        // ============================================================
        const hasTelNumbers = Array.isArray(data.tel_numbers);

        if (hasTelNumbers) {
          console.log(`[TEL_SYNC] Incoming tel_numbers count = ${data.tel_numbers.length}`);

          for (const tel of data.tel_numbers) {
            const mode = String(tel.mode ?? "").toLowerCase();
            const telId = tel.id;
            const phone = tel.tel;
            const post = postId;

            console.log(`[TEL_SYNC] mode=${mode} | id=${telId} | tel="${phone}" | postId=${post}`);

            if (mode === "deleted") {
              console.log(`[TEL_DELETE] DELETE FROM post_tel_numbers WHERE id=${telId} AND post_id=${post}`);
              await client.query(`DELETE FROM post_tel_numbers WHERE id=$1 AND post_id=$2`, [telId, post]);
              console.log(`[TEL_DELETE] success id=${telId}`);
            } else if (mode === "edited") {
              console.log(`[TEL_UPDATE] UPDATE post_tel_numbers SET tel="${phone}" WHERE id=${telId} AND post_id=${post}`);
              await client.query(`UPDATE post_tel_numbers SET tel=$1 WHERE id=$2 AND post_id=$3`, [
                phone,
                telId,
                post,
              ]);
              console.log(`[TEL_UPDATE] success id=${telId}, newTel="${phone}"`);
            } else if (mode === "new") {
              console.log(`[TEL_INSERT] INSERT INTO post_tel_numbers (post_id, tel) VALUES (${post}, "${phone}")`);
              await client.query(
                `INSERT INTO post_tel_numbers (post_id, tel)
                VALUES ($1,$2) ON CONFLICT DO NOTHING`,
                [post, phone]
              );
              console.log(`[TEL_INSERT] success tel="${phone}"`);
            } else {
              console.warn(`[TEL_SYNC] Unknown mode="${mode}" for id=${telId}`);
            }
          }
        }

        // ✅ NEW: ดึง tel_numbers ล่าสุดจาก DB (หลัง sync) เพื่อเอาไป emit
        let telRows: Array<{ id: number; tel: string }> = [];
        if (hasTelNumbers) {
          const { rows } = await client.query(
            `SELECT id, tel
            FROM post_tel_numbers
            WHERE post_id=$1
            ORDER BY id`,
            [postId]
          );
          telRows = rows ?? [];
        }

        // ============================================================
        // 3) SELLER ACCOUNTS (insert/update/delete)
        // ============================================================
        if (Array.isArray(data.seller_accounts)) {
          for (const acc of data.seller_accounts) {
            const mode = String(acc.mode ?? "").toLowerCase();

            if (mode === "deleted") {
              await client.query(`DELETE FROM post_seller_accounts WHERE id=$1 AND post_id=$2`, [acc.id, postId]);
            } else if (mode === "edited") {
              await client.query(
                `UPDATE post_seller_accounts
                  SET bank_id=$1, bank_name=$2, seller_account=$3
                WHERE id=$4 AND post_id=$5`,
                [acc.bank_id, acc.bank_name, acc.seller_account || "", acc.id, postId]
              );
            } else if (mode === "new") {
              await client.query(
                `INSERT INTO post_seller_accounts (post_id, bank_id, bank_name, seller_account)
                VALUES ($1,$2,$3,$4)
                ON CONFLICT DO NOTHING`,
                [postId, acc.bank_id, acc.bank_name, acc.seller_account || ""]
              );
            }
          }
        }

        // ============================================================
        // 4) ลบรูปเก่า (ถ้ามี)
        // ============================================================
        if (image_ids_delete?.length) {
          await client.query(
            `DELETE FROM post_images WHERE post_id = $1 AND file_id = ANY($2::int[])`,
            [postId, image_ids_delete.map((id: any) => parseInt(id, 10))]
          );
        }

        // ============================================================
        // 5) เพิ่มรูปใหม่ (stream)
        // ============================================================
        if (images?.length) {
          const fileRows: any[] = [];

          for (const pf of images) {
            const upload = await pf; // GraphQLUploadFile
            const ext = path.extname(upload.filename || "");
            const renameTo = `post-${postId}-${Date.now()}${ext || ""}`;

            const row = await persistUploadStream(upload, renameTo);
            fileRows.push(row);
          }

          if (fileRows.length) {
            const values = fileRows.map((_, i) => `($1, $${i + 2})`).join(", ");
            await client.query(`INSERT INTO post_images (post_id, file_id) VALUES ${values}`, [
              postId,
              ...fileRows.map((r) => r.id),
            ]);
          }
        }

        // ============================================================
        // 6) ดึงข้อมูลโพสต์กลับพร้อมรูป
        // ============================================================
        const { rows: posts } = await client.query(`SELECT * FROM posts WHERE id=$1`, [postId]);
        const { rows: imgs } = await client.query(
          `SELECT f.id, f.relpath
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id=$1
            ORDER BY pi.id`,
          [postId]
        );

        // ============================================================
        // 7) LOG
        // ============================================================
        await addLog("info", id ? "post-update" : "post-create", id ? "User updated a post" : "User created a post", {
          author_id,
          postId,
        });

        // ============================================================
        // RETURN
        // ============================================================
        const out: any = {
          ...posts[0],
          images: imgs.map((r: any) => ({
            id: r.id,
            url: buildFileUrlById(r.id),
          })),
        };

        // ✅ ใส่ tel_numbers ในผลลัพธ์ด้วย (ถ้ามีส่งมา)
        if (hasTelNumbers) {
          out.tel_numbers = telRows.map((t) => ({ id: t.id, tel: t.tel }));
        }

        // ✅ เก็บค่าที่ต้องใช้หลัง commit
        finalPostId = out.id;
        finalTitle = out.title ?? null;
        finalSummary = out.detail ?? null;
        finalUrl = out.website ?? null;
        finalAutoPublish = typeof out.auto_publish === "boolean" ? out.auto_publish : null;

        // ✅ NEW: เก็บ tel_numbers ล่าสุดเพื่อ emit
        finalTelNumbers = hasTelNumbers ? out.tel_numbers ?? [] : null;

        return out;
      });

      console.log("[upsertPost] = ", result);

      // ============================================================
      // ✅ EMIT EVENT (หลัง commit เท่านั้น)
      // ============================================================
      try {
        const eventName = id ? "post.updated" : "post.created";

        if (finalPostId) {
          const payload: any = {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),

            postId: finalPostId,
            actorId: String(author_id),
            revisionId,

            title: finalTitle ?? null,
            summary: finalSummary ?? null,
            url: finalUrl ?? null,

            // ✅ สำคัญ: ส่ง auto_publish ให้ worker
            auto_publish: finalAutoPublish ?? null,

            images: (result?.images ?? []).map((img: any) => ({
              id: img.id,
              url: img.url,
            })),
          };

          // ✅ NEW: ถ้า request มี data.tel_numbers ให้ emit tel_numbers ไปด้วย
          if (Array.isArray(data?.tel_numbers)) {
            payload.tel_numbers = Array.isArray(finalTelNumbers) ? finalTelNumbers : [];
          }

          console.log("[upsertPost][payload] = ", payload);

          await emitPostEvent(eventName, payload);
        }
      } catch (e: any) {
        console.error("[events] emit failed (ignored)", e?.message ?? e);
      }

      return result;
    },
    deletePost: async (_: any, { id }: { id: string }, ctx: any) => {
      // const { author_id } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] deletePost :", author_id, id);

      type PostSnap = {
        postId: string;
        title?: string | null;
        summary?: string | null;
        url?: string | null;
        images?: Array<{ id: number | string; url: string }>;
        auto_publish?: boolean | null;
      };

      const { revisionId, result } = await runInTransaction<{ ok: boolean; snap: PostSnap | null }>(
        author_id,
        async (client) => {
          // ✅ 0) snapshot ก่อนลบ
          const { rows: posts } = await client.query(
            `SELECT id, title, detail, website, auto_publish
            FROM posts
            WHERE id = $1`,
            [id]
          );

          if (!posts?.[0]) {
            return { ok: false, snap: null };
          }

          const p = posts[0];

          const { rows: imgs } = await client.query(
            `SELECT f.id, f.relpath
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id = $1
            ORDER BY pi.id`,
            [id]
          );

          const snap: PostSnap = {
            postId: p.id,
            title: p.title ?? null,
            summary: p.detail ?? null,
            url: p.website ?? null,
            auto_publish: p.auto_publish ?? null,
            images: imgs.map((r: any) => ({
              id: r.id,
              url: buildFileUrlById(r.id),
            })),
          };

          // ✅ 1) ลบโพสต์
          const res = await client.query(`DELETE FROM posts WHERE id = $1`, [id]);

          // ✅ 2) log
          await addLog("info", "post-delete", "User deleted post", {
            author_id,
            postId: id,
            affectedRows: res.rowCount,
          });

          const ok = (res.rowCount ?? 0) === 1;
          return { ok, snap: ok ? snap : null };
        }
      );

      // ✅ 3) emit หลัง commit เท่านั้น
      try {
        if (result.ok && result.snap) {
          const snap = result.snap;
          await emitPostEvent("post.deleted", {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),

            postId: snap.postId,
            actorId: String(author_id),
            revisionId,

            title: snap.title ?? null,
            summary: snap.summary ?? null,
            url: snap.url ?? null,
            auto_publish: snap.auto_publish ?? null,
            images: snap.images ?? [],
          });
        }
      } catch (e: any) {
        console.error("[events] emit post.deleted failed (ignored)", e?.message ?? e);
      }

      return result.ok;
    },
    deletePosts: async (_: any, { ids }: { ids: string[] }, ctx: any) => {
      // const { author_id } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] deletePosts :", author_id, ids?.length);

      if (!Array.isArray(ids) || ids.length === 0) {
        throw new GraphQLError("No IDs provided", { extensions: { code: "BAD_USER_INPUT" } });
      }

      const validIds = ids.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id));
      if (validIds.length === 0) {
        throw new GraphQLError("Invalid UUIDs", { extensions: { code: "BAD_USER_INPUT" } });
      }

      // เก็บ snapshot หลัง commit
      let snaps: Array<{
        postId: string;
        title?: string | null;
        summary?: string | null;
        url?: string | null;
        images?: Array<{ id: number | string; url: string }>;
        auto_publish?: boolean | null;
      }> = [];

      const { revisionId, result } = await runInTransaction<boolean>(author_id, async (client, ctx) => {
        // ✅ 0) snapshot ของทุก post ก่อนลบ
        const { rows: posts } = await client.query(
          `SELECT id, title, detail, website, auto_publish
          FROM posts
          WHERE id = ANY($1::uuid[])`,
          [validIds]
        );

        if (!posts?.length) return false;

        const postIds = posts.map((p: any) => p.id);

        const { rows: imgs } = await client.query(
          `SELECT pi.post_id, f.id AS file_id
          FROM post_images pi
          JOIN files f ON f.id = pi.file_id
          WHERE pi.post_id = ANY($1::uuid[])
          ORDER BY pi.id`,
          [postIds]
        );

        const imagesByPost = new Map<string, Array<{ id: number | string; url: string }>>();
        for (const r of imgs) {
          const arr = imagesByPost.get(r.post_id) ?? [];
          arr.push({ id: r.file_id, url: buildFileUrlById(r.file_id) });
          imagesByPost.set(r.post_id, arr);
        }

        snaps = posts.map((p: any) => ({
          postId: p.id,
          title: p.title ?? null,
          summary: p.detail ?? null,
          url: p.website ?? null,
          auto_publish: p.auto_publish ?? null,
          images: imagesByPost.get(p.id) ?? [],
        }));

        // ✅ 1) ลบ
        const res = await client.query(`DELETE FROM posts WHERE id = ANY($1::uuid[])`, [validIds]);
        const deletedCount = res.rowCount ?? 0;

        // ✅ 2) log
        await addLog("info", "post-delete", `Deleted ${deletedCount} posts`, {
          userId: author_id,
          deletedCount,
          postIds: validIds,
        });

        return deletedCount > 0;
      });

      // ✅ 3) emit หลัง commit: ยิงทีละโพสต์
      try {
        if (result && snaps.length) {
          for (const s of snaps) {
            await emitPostEvent("post.deleted", {
              eventId: randomUUID(),
              occurredAt: new Date().toISOString(),

              postId: s.postId,
              actorId: String(author_id),
              revisionId,

              title: s.title ?? null,
              summary: s.summary ?? null,
              url: s.url ?? null,
              auto_publish: s.auto_publish ?? null,
              images: s.images ?? [],
            });
          }
        }
      } catch (e: any) {
        console.error("[events] emit post.deleted (bulk) failed (ignored)", e?.message ?? e);
      }

      return result;
    },
    clonePost: async (
      _: any,
      { id }: { id: string },
      ctx: any
    ) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] clonePost :", author_id, id);

      const { revisionId, result } =  await runInTransaction(author_id, async (client, ctx) => {
        // ==================================
        // 1) หา source post
        // ==================================
        const { rows: srcPosts } = await client.query(
          `SELECT *
          FROM posts
          WHERE id = $1`,
          [id]
        );
        if (!srcPosts.length) {
          throw new Error("Source post not found");
        }
        const src = srcPosts[0];

        // ==================================
        // 2) insert post ใหม่
        // ==================================
        const { rows: newPostRows } = await client.query(
          `INSERT INTO posts (
            first_last_name,
            id_card,
            title,
            transfer_amount,
            transfer_date,
            website,
            province_id,
            detail,
            status,
            author_id,
            created_at,
            updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()
          )
          RETURNING id`,
          [
            src.first_last_name,
            src.id_card,
            (src.title || "") + " Clone",
            src.transfer_amount,
            src.transfer_date,
            src.website,
            src.province_id,
            src.detail,
            src.status,
            author_id,
          ]
        );

        const newPostId = newPostRows[0].id;

        // ==================================
        // 3) clone tel_numbers
        // ==================================
        const { rows: srcTels } = await client.query(
          `SELECT tel FROM post_tel_numbers WHERE post_id=$1`,
          [id]
        );
        if (srcTels.length) {
          const values = srcTels.map((_:any, i:any) => `($1, $${i + 2})`).join(", ");
          await client.query(
            `INSERT INTO post_tel_numbers (post_id, tel)
            VALUES ${values}`,
            [newPostId, ...srcTels.map((r:any) => r.tel)]
          );
        }

        // ==================================
        // 4) clone seller_accounts
        // ==================================
        const { rows: srcAccs } = await client.query(
          `SELECT bank_id, bank_name, seller_account
          FROM post_seller_accounts
          WHERE post_id=$1`,
          [id]
        );
        if (srcAccs.length) {
          const values = srcAccs
            .map((_:any, i:any) => {
              const base = 1 + i * 3;
              return `($1, $${base + 1}, $${base + 2}, $${base + 3})`;
            })
            .join(", ");

          const params: any[] = [newPostId];
          srcAccs.forEach((r:any) => {
            params.push(r.bank_id, r.bank_name, r.seller_account || "");
          });

          await client.query(
            `INSERT INTO post_seller_accounts
              (post_id, bank_id, bank_name, seller_account)
            VALUES ${values}`,
            params
          );
        }

        // ==================================
        // 5) clone images
        // ==================================
        const { rows: srcImgs } = await client.query(
          `SELECT file_id
          FROM post_images
          WHERE post_id=$1
          ORDER BY id`,
          [id]
        );
        if (srcImgs.length) {
          const values = srcImgs.map((_:any, i:any) => `($1, $${i + 2})`).join(", ");
          await client.query(
            `INSERT INTO post_images (post_id, file_id)
            VALUES ${values}`,
            [newPostId, ...srcImgs.map((r:any) => r.file_id)]
          );
        }

        // ==================================
        // 6) LOG
        // ==================================
        await addLog(
          "info",
          "post-clone",
          "User cloned a post",
          { author_id, source_post_id: id, cloned_post_id: newPostId }
        );

        // ❗ สำคัญ: RETURN เป็น string ตรง ๆ ไม่ห่อ object ใด ๆ
        return newPostId;
      });

      return result;
    },
    createChat: async (
      _: any,
      { name, isGroup, memberIds }: { name?: string; isGroup: boolean; memberIds: string[] },
      ctx: any
    ) => {
      // const { author_id } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] createChat :", author_id);

      const { result } = await runInTransaction(author_id, async (client, ctx) => {
        // 1) normalize members (รวม creator)
        const incoming = Array.isArray(memberIds) ? memberIds.filter(Boolean) : [];
        const allMembers = Array.from(new Set([author_id, ...incoming]));

        // 2) directKey สำหรับ 1:1
        let directKey: string | null = null;

        if (!isGroup) {
          if (allMembers.length !== 2) {
            throw new Error("1:1 chat ต้องมีสมาชิก 2 คน (รวมผู้สร้าง)");
          }
          const [a, b] = [...allMembers].sort();
          directKey = `${a}:${b}`;
        }

        // 3) INSERT / UPSERT กันซ้ำ
        // no-op update เพื่อให้ RETURNING ทำงาน โดยไม่ต้องมี updated_at
        const { rows: chatRows } = await client.query(
          `
          INSERT INTO chats (name, is_group, created_by, direct_key)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (direct_key)
          DO UPDATE SET direct_key = chats.direct_key
          RETURNING *, (xmax = 0) AS is_new
          `,
          [
            isGroup ? (name || null) : null, // 1:1 ไม่ตั้ง name (กันสับสน)
            isGroup,
            author_id,
            directKey,
          ]
        );

        const chat = chatRows[0];
        const isNew = !!chat.is_new;

        // 4) เพิ่มสมาชิก
        for (const uid of allMembers) {
          await client.query(
            `
            INSERT INTO chat_members (chat_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            `,
            [chat.id, uid]
          );
        }

        // 5) ดึง creator + members
        const creator = await client.query(`SELECT * FROM users WHERE id = $1`, [chat.created_by]);

        const mem = await client.query(
          `
          SELECT u.*
          FROM chat_members m
          JOIN users u ON m.user_id = u.id
          WHERE m.chat_id = $1
          `,
          [chat.id]
        );

        // 6) log
        await addLog("info", "chat-create", isNew ? "Chat created" : "Chat reused", {
          chatId: chat.id,
          userId: author_id,
          isGroup,
          directKey,
          members: allMembers.length,
          isNew,
        });

        return {
          ...chat,
          is_new: isNew,
          created_by: creator.rows[0],
          members: mem.rows,
        };
      });

      // ✅ Notification นอก txn (ส่งเฉพาะสร้างใหม่จริง)
      const chat = result as any;
      const creatorUser = chat.created_by;
      const members = chat.members as any[];

      const recipients = members.filter((m: any) => m.id !== author_id);

      if (chat.is_new) {
        await Promise.all(
          recipients.map((m: any) =>
            createNotification({
              user_id: m.id,
              type: "CHAT_CREATED",
              title: chat.is_group
                ? `คุณถูกเพิ่มในกลุ่ม "${chat.name || ""}"`
                : `เริ่มแชทใหม่กับ ${creatorUser.name}`,
              message: chat.is_group
                ? `${creatorUser.name} สร้างห้องและเพิ่มคุณเข้ากลุ่ม`
                : `${creatorUser.name} เริ่มคุยกับคุณ`,
              entity_type: "chat",
              entity_id: chat.id,
              data: {
                chat_id: chat.id,
                chat_name: chat.name,
                is_group: chat.is_group,
                actor_id: creatorUser.id,
                actor_name: creatorUser.name,
              },
            })
          )
        );
      }

      delete chat.is_new;
      return chat;
    },
    addMember: async (_:any, { chat_id, user_id }:{chat_id:string, user_id:string}, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] addMember :", ctx, author_id);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        await client.query(
          `INSERT INTO chat_members (chat_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [chat_id, user_id]
        );

        await addLog('info', 'add-member', 'Add members', { chat_id,  user_id});

        return true;
      });

      return result;
    },
    sendMessage: async (
      _: any,
      {
        chat_id,
        text,
        to_user_ids,
        images,
        reply_to_id
      }: {
        chat_id: string;
        text: string;
        to_user_ids: string[];
        images?: Promise<any>[]; // Upload scalar list
        reply_to_id?: string | null;
      },
      ctx: any
    ) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.info("[sendMessage] =", author_id, chat_id, to_user_ids);

      // กรอง to_user_ids ให้ไม่ซ้ำ + ไม่รวมตัวเอง
      const cleanTo = Array.from(
        new Set(
          (to_user_ids || [])
            .filter(Boolean)
            .filter((id) => id !== author_id)
        )
      );

      // ===== Step 1: Pre-upload images (no transaction) =====
      let uploadedFiles: {
        id: number;
        relpath: string;
        mimetype: string | null;
        filename: string;
      }[] = [];

      if (images && images.length > 0) {
        uploadedFiles = await Promise.all(
          images.map(async (imgPromise) => {
            const upload = await imgPromise; // Upload object (Upload scalar)

            const renameTo = `chat_${chat_id}_${Date.now()}_${upload.fileName}`;
            const fileRow = await persistUploadStream(upload, renameTo);

            return {
              id: fileRow.id,
              relpath: fileRow.relpath,
              mimetype: fileRow.mimetype,
              filename: fileRow.filename,
            };
          })
        );
      }

      // ===== Step 2: Use transaction for DB operations =====
      const { revisionId, result: fullMessage } = await runInTransaction(author_id, async (client, ctx) => {
        // 1) Insert message (เพิ่ม reply_to_id เข้าไป)
        const msgRes = await client.query(
          `
          INSERT INTO messages (chat_id, sender_id, text, reply_to_id)
          VALUES ($1,$2,$3,$4)
          RETURNING *
          `,
          [chat_id, author_id, text, reply_to_id || null]
        );
        const msg = msgRes.rows[0];

        // 2) Insert message_images
        if (uploadedFiles.length > 0) {
          for (const f of uploadedFiles) {
            await client.query(
              `
              INSERT INTO message_images (message_id, file_id, url, mime)
              VALUES ($1,$2,$3,$4)
              `,
              [
                msg.id,
                f.id,
                `/${f.relpath}`,
                f.mimetype,
              ]
            );
          }
        }

        // 3) Insert receipts for recipients
        if (cleanTo.length > 0) {
          await client.query(
            `
            INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
            SELECT $1, uid, NOW(), NULL
            FROM UNNEST($2::uuid[]) AS u(uid)
            ON CONFLICT (message_id, user_id) DO NOTHING
            `,
            [msg.id, cleanTo]
          );
        }

        // 4) sender receipt
        await client.query(
          `
          INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
          VALUES ($1,$2,NOW(),NOW())
          ON CONFLICT (message_id, user_id) DO NOTHING
          `,
          [msg.id, author_id]
        );

        // 5) Hydrate images (ให้เป็น [] แน่นอน ไม่ใช่ null)
        const imgRows = (
          await client.query(
            `
            SELECT id, file_id, url, mime, width, height
            FROM message_images
            WHERE message_id=$1
            `,
            [msg.id]
          )
        ).rows;

        const imagesSafe = Array.isArray(imgRows)
          ? imgRows.map((img: any) => ({
              id: img.id,
              url: img.url,
              file_id: img.file_id ?? null,
              mime: img.mime ?? null,
              width: img.width ?? null,
              height: img.height ?? null,
            }))
          : [];

        // 6) Hydrate sender + readers + receipt data
        const senderQ = await client.query(`SELECT * FROM users WHERE id=$1`, [
          author_id,
        ]);

        const readersQ = await client.query(
          `
          SELECT u.*
          FROM message_receipts r
          JOIN users u ON u.id=r.user_id
          WHERE r.message_id=$1 AND r.read_at IS NOT NULL
          `,
          [msg.id]
        );

        const cntQ = await client.query(
          `
          SELECT COUNT(*)::int AS c
          FROM message_receipts
          WHERE message_id=$1 AND read_at IS NOT NULL
          `,
          [msg.id]
        );

        const myRecQ = await client.query(
          `
          SELECT delivered_at, read_at, (read_at IS NOT NULL) AS is_read
          FROM message_receipts
          WHERE message_id=$1 AND user_id=$2
          `,
          [msg.id, author_id]
        );
        const mr = myRecQ.rows[0] || {};

        const createdISO = new Date(msg.created_at).toISOString();

        const myReceipt = {
          deliveredAt: mr?.delivered_at
            ? new Date(mr.delivered_at).toISOString()
            : createdISO,
          readAt: mr?.read_at ? new Date(mr.read_at).toISOString() : null,
          isRead: !!mr?.is_read,
        };

        return {
          id: msg.id,
          chat_id: msg.chat_id,
          sender: senderQ.rows[0],
          text: msg.text || "",
          created_at: createdISO,
          to_user_ids: cleanTo,

          images: imagesSafe,            // ✅ ไม่เป็น null แน่นอน

          myReceipt,
          readers: readersQ.rows,
          readersCount: Number(cntQ.rows[0]?.c || 0),
          is_deleted: false,
          deleted_at: null,

          reply_to_id: msg.reply_to_id,  // ✅ payload มี reply_to_id
        };
      });

      // ===== Step 3: publish realtime =====
      await pubsub.publish(topicChat(fullMessage.chat_id), {
        messageAdded: fullMessage, // ✅ รูปแบบเดียวกับที่ return ให้ client
      });

      const targetUserIds = [...cleanTo, author_id]; // คนรับทุกคน + คนส่งเอง (จะใช้เช็คว่า tab ไหนเปิดอยู่)
      await pubsub.publish(INCOMING_MESSAGE, {
        incomingMessage: fullMessage,
        targetUserIds,
      });

      console.info("[sendMessage][fullMessage] :", fullMessage);

      return fullMessage;
    },
    upsertUser: async (_: any, { id, data }: { id?: string, data: any }, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] upsertUser :", ctx, author_id);

      // 2️⃣ ทำความสะอาดข้อมูล
      const name = (data.name ?? '').trim();
      const avatar = data.avatar ?? null;
      const phone = data.phone ?? null;
      const email = data.email ? String(data.email).trim().toLowerCase() : null;
      const role = (data.role ?? 'Subscriber').trim();
      const passwordHash = data.passwordHash ?? null;

      // ✅ ใช้ transaction wrapper เพื่อ ensure COMMIT/ROLLBACK และ SET LOCAL app.editor_id
      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        let resultUser = null;

        if (id) {
          // 🧩 UPDATE: อัปเดต password_hash เฉพาะเมื่อส่งมา
          const { rows } = await client.query(
            `
            UPDATE users
               SET name = $1,
                   avatar = $2,
                   phone = $3,
                   role = $4,
                   password_hash = COALESCE($5::text, password_hash)
             WHERE id = $6
             RETURNING *;
            `,
            [name, avatar, phone, role, passwordHash, id]
          );

          resultUser = rows[0] || null;

          if (resultUser) {
            await addLog(
              "info",
              "user-update",
              "User profile updated",
              { userId: resultUser.id, editorId: author_id }
            );
          }
        } else {
          // 🧩 INSERT: ต้องมี email
          if (!email) throw new GraphQLError("email is required");

          const { rows } = await client.query(
            `
            INSERT INTO users (name, avatar, phone, email, role, password_hash)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
            `,
            [name, avatar, phone, email, role, passwordHash]
          );

          resultUser = rows[0] || null;

          if (resultUser) {
            // 📘 ตัวอย่าง: log ว่า user ถูกสร้างใหม่ (หรือ login สำเร็จ)
            await addLog(
              "info",
              "upsert-user", 
              "Upsert User",
              { userId: resultUser.id }
            );
          }
        }

        return resultUser;
      });

      return result;
    },
    uploadAvatar: async (_: any, { user_id, file }: { user_id: string, file: Promise<GraphQLUploadFile> }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] uploadAvatar :", author_id);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        const f = await file; // { filename, mimetype, encoding, createReadStream }

        // สร้างชื่อใหม่ เช่น avatar-<user_id>.ext
        const ext = path.extname(f.filename || "");
        const renameTo = `avatar-${user_id}${ext || ""}`;

        const row = await persistUploadStream(f, renameTo); // 👈 ใช้ stream

        const avatarUrl = buildFileUrlById(row.id);

        await client.query(`UPDATE users SET avatar=$1 WHERE id=$2`, [
          avatarUrl,
          user_id,
        ]);

        await addLog("info", "upload-avatar", "Upload avatar", {
          userId: user_id,
          fileId: row.id,
        });

        return avatarUrl;
      });

      return result;
    },
    deleteUser: async (_: any, { id }: { id: string }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] deleteUser:", id, author_id);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        const res = await client.query(`DELETE FROM users WHERE id=$1`, [id]);
        const ok = res.rowCount === 1;

        if (ok) {
          await addLog('info', 'user-delete', 'User deleted', {
            deletedId: id,
            author_id,
          });
        }

        return ok;
      });

      return result;
    },
    deleteUsers: async (_: any, { ids }: { ids: string[] }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] deleteUsers :", ctx, author_id);

      if (!ids || ids.length === 0) return false;

      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const uuidIds = ids.filter((i) => uuidPattern.test(i));

      if (uuidIds.length === 0) return false;

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        const res = await client.query(
          `DELETE FROM users WHERE id = ANY($1::uuid[])`,
          [uuidIds]
        );

        const affected = res.rowCount ?? 0; // กัน null ที่นี่

        if (affected > 0) {
          await addLog(
            "info",
            "user-delete",
            `Deleted ${affected} user(s)`,
            { userId: author_id, deletedIds: uuidIds }
          );
        }

        return affected > 0;
      });

      return result;
    },
    updateMyProfile: async (_:any, { data }:{ data: { name?: string, avatar?: string, phone?: string }}, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] updateMyProfile :", author_id, data);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        const { rows } = await client.query(
          `UPDATE users SET 
              name   = COALESCE($1, name),
              avatar = COALESCE($2, avatar),
              phone  = COALESCE($3, phone),
              updated_at = NOW()
          WHERE id = $4
          RETURNING *`,
          [data.name ?? null, data.avatar ?? null, data.phone ?? null, author_id]
        );

        return rows[0];
      });

      // ✅ log event หลัง transaction สำเร็จ
      await addLog(
        'info',
        'user-update-profile',
        'User updated profile',
        { userId: author_id, changed: Object.keys(data) }
      );

      return result;
    },
    renameChat: async (_:any, { chat_id, name }:{chat_id:string, name?:string}, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx); // ✅ ตรวจสิทธิ์
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log('[Mutation] renameChat :', chat_id, name, author_id);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        await client.query(
          `UPDATE chats SET name=$1 WHERE id=$2`,
          [name || null, chat_id]
        );

        await addLog('info', 'chat-rename', 'Chat renamed', {
          chatId: chat_id,
          userId: author_id,
          newName: name || null,
        });

        return true;
      });

      return result;
    },
    deleteChat: async (_:any, { chat_id }:{chat_id:string}, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        await client.query(`DELETE FROM chats WHERE id = $1`, [chat_id]);

        await addLog(
          "info",
          "chat-delete",
          `User ${author_id} deleted chat ${chat_id}`,
          { author_id, chatId: chat_id }
        );

        return true;
      });

      return result;
    },
    markMessageRead: async (_:any, { message_id }:{ message_id:string }, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] markMessageRead :", message_id, "by", author_id);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        await client.query(
          `UPDATE message_receipts
            SET read_at = COALESCE(read_at, NOW())
          WHERE message_id = $1 AND user_id = $2`,
          [message_id, author_id]
        );

        await addLog(
          "info",                  // ระดับ log
          "message-read",          // หมวดหมู่
          "User marked message as read", // ข้อความหลัก
          { userId: author_id, messageId: message_id } // meta เพิ่มเติม
        );

        return true;
      });

      return result;
    },
    markChatReadUpTo: async (_:any, { chat_id, cursor }:{ chat_id:string, cursor:string }, ctx:any) => {
      // 1️⃣ ตรวจสอบสิทธิ์ผู้ใช้
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log('[Mutation] markChatReadUpTo :', author_id, chat_id, cursor);

      // 2️⃣ ทำงานใน transaction
      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        await client.query(
          `
          UPDATE message_receipts r
            SET read_at = COALESCE(r.read_at, NOW())
            FROM messages m
          WHERE r.message_id = m.id
            AND r.user_id = $1
            AND m.chat_id = $2
            AND m.created_at <= ($3::timestamptz + interval '1 millisecond')
          `,
          [author_id, chat_id, cursor]
        );

        // 3️⃣ log ลงระบบ
        await addLog(
          'info',
          'chat-read',
          'User marked chat messages as read',
          { userId: author_id, chatId: chat_id, cursor }
        );

        return true;
      });

      return result;
    },
    deleteMessage: async (_:any, { message_id }:{ message_id:string }, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);
      console.log("[Mutation] deleteMessage :", ctx, author_id);

      const { revisionId, result } =  await runInTransaction(author_id, async (client, ctx) => {
        const { rows } = await client.query(
          `SELECT id, chat_id, sender_id, deleted_at FROM messages WHERE id=$1 LIMIT 1`,
          [message_id]
        );
        const msg = rows[0];
        if (!msg) return false;

        // 2️⃣ ตรวจสิทธิ์ (optional)
        // const canDelete = (msg.sender_id === author_id) || ctx?.admin?.role === 'Administrator';
        // if (!canDelete) throw new GraphQLError('FORBIDDEN', { extensions: { code: 'FORBIDDEN' } });

        // 3️⃣ ลบ (soft delete)
        const { rowCount } = await client.query(
          `UPDATE messages SET deleted_at = NOW() WHERE id=$1 AND deleted_at IS NULL`,
          [message_id]
        );

        if (!rowCount) {
          console.warn(`[deleteMessage] message already deleted: ${message_id}`);
          return false;
        }

        // 4️⃣ Publish event สำหรับ subscribers
        await pubsub.publish(topicChat(msg.chat_id), { messageDeleted: message_id });

        // 5️⃣ บันทึก log
        await addLog(
          'info',
          'message-delete',
          'User deleted message',
          { userId: author_id, messageId: message_id, chatId: msg.chat_id }
        );

        return true;
      });

      console.log("revisionId =", revisionId, "result =", result);
      return result;
    },
    deleteFile: async (_: any, { id }: { id: string }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] deleteFile :", { id, author_id });

      const { revisionId, result } =  await runInTransaction(author_id, async (client, ctx) => {
        const res = await client.query(`DELETE FROM files WHERE id = $1`, [id]);

        if (res.rowCount === 1) {
          await addLog(
            "info",
            "file-delete",
            "User deleted a file",
            { author_id, fileId: id }
          );
          return true;
        } else {
          return false;
        }
      });

      console.log("revisionId =", revisionId, "result =", result);

      return result;
    },
    deleteFiles: async (_: any, { ids }: { ids: string[] }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] deleteFiles :", ids, "by", author_id);

      if (!ids?.length) return false;

      const intIds = ids
        .map((n) => parseInt(String(n), 10))
        .filter((n) => !isNaN(n));

      if (!intIds.length) return false;

      const { revisionId, result } =  await runInTransaction(author_id, async (client, ctx) => {
        const res = await client.query(
          `DELETE FROM files WHERE id = ANY($1::int[])`,
          [intIds]
        );

        // rowCount: number | null → ใช้ ?? 0 ป้องกัน null
        const deleted = (res.rowCount ?? 0) > 0;

        if (deleted) {
          await addLog(
            "info",
            "file-delete",
            "User deleted files",
            { author_id, ids: intIds }
          );
        }

        return deleted;
      });

      console.log("revisionId =", revisionId, "result =", result);

      return result;
    },
    renameFile: async (_: any, { id, name }: { id: string, name: string }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx); // ✅ ตรวจสิทธิ์ก่อน
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);
      console.log("[Mutation] renameFile by:", author_id);

      // ✅ ใช้ transaction helper
      const { revisionId, result } =  await runInTransaction(author_id, async (client, ctx) => {
        const res = await client.query(
          `UPDATE files 
             SET original_name = $1, updated_at = NOW()
           WHERE id = $2`,
          [name, id]
        );

        return res.rowCount === 1;
      });

      // ✅ บันทึก log หลัง commit
      if (result) {
        await addLog(
          'info',
          'file-rename',
          'User renamed a file',
          { author_id, fileId: id, newName: name }
        );
      }

      return result;
    },
    toggleBookmark: async (_: any, { postId }: { postId: string }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);

      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      const start = Date.now();

      console.log("[toggleBookmark] :: ", author_id, postId);

      // ✅ ทำงานใน transaction
      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        // ตรวจว่ามี bookmark อยู่แล้วไหม
        const { rowCount: exists } = await client.query(
          `SELECT 1 FROM bookmarks WHERE post_id = $1 AND user_id = $2`,
          [postId, author_id]
        );

        let isBookmarked: boolean;

        if (exists) {
          // ถ้ามี → ลบออก
          await client.query(
            `DELETE FROM bookmarks WHERE post_id = $1 AND user_id = $2`,
            [postId, author_id]
          );
          isBookmarked = false;
        } else {
          // ถ้ายังไม่มี → เพิ่มใหม่
          await client.query(
            `INSERT INTO bookmarks (post_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (post_id, user_id) DO NOTHING`,
            [postId, author_id]
          );
          isBookmarked = true;
        }

        return isBookmarked;
      });

      // ✅ หลัง transaction commit → addLog สำหรับ external service (optional)
      await addLog(
        'info',
        'bookmark',
        'User toggled bookmark',
        { author_id, postId, isBookmarked: result }
      );

      return {
        status: true,
        isBookmarked: result,
        executionTime: `${((Date.now() - start) / 1000).toFixed(3)}s`,
      };
    },
    markNotificationRead: async ( _: any, args: { id: string }, ctx: any ) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');
      const { rows } = await query(
        `
        UPDATE notifications
        SET is_read = TRUE
        WHERE id = $1
          AND user_id = $2
        RETURNING id
        `,
        [args.id, user.id]
      );

      return rows.length > 0;
    },
    markAllNotificationsRead: async (_: any, __: any, ctx: any) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');

      await query(
        `
        UPDATE notifications
        SET is_read = TRUE
        WHERE user_id = $1
          AND is_read = FALSE
        `,
        [user.id]
      );

      return true;
    },
    addComment: async (_: any, { post_id, content }: any, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx); 

      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);
      
      const user = await getUserById(author_id); // { id, name, avatar, ... }

      console.log("[Mutation] addComment:", author_id, user);

      const id = uuidv4();

      // insert comment
      const { rows } = await query(
        `
        INSERT INTO comments (id, post_id, user_id, content)
        VALUES ($1,$2,$3,$4)
        RETURNING *
        `,
        [id, post_id, user.id, content]
      );
      const comment = rows[0];

      console.log("[Mutation] addComment-comment", comment);

      // หาเจ้าของโพสต์เพื่อแจ้งเตือน
      const postRes = await query(
        `SELECT id, author_id FROM posts WHERE id = $1`,
        [post_id]
      );
      const post = postRes.rows[0];

      if (post && post.author_id !== user.id) {
        await createNotification({
          user_id: post.author_id,
          type: 'POST_COMMENT',
          title: 'มีคอมเมนต์ใหม่ในโพสต์ของคุณ',
          message: `${user.name}: ${content.substring(0, 80)}`,
          entity_type: 'post',
          entity_id: post_id,
          data: {
            post_id,
            comment_id: comment.id,
            actor_id: user.id,
            actor_name: user.name,
          },
        });
      }

      // 👇 สร้าง object เวอร์ชัน GraphQL ที่มี user + replies
      const gqlComment = {
        ...comment,        // id, post_id, user_id, parent_id, content, created_at, updated_at
        user: {
          id: user.id,
          name: user.name,
          avatar: user.avatar ?? null,
          // ถ้ามี field อื่นใน type User ก็เติมได้
        },
        replies: [] as any[],
      };

      // broadcast subscription → ส่ง object แบบเดียวกับที่ mutation คืน
      await pubsub.publish(COMMENT_ADDED, {
        commentAdded: gqlComment,
      });

      // คืนค่า object ที่พร้อม field user + replies
      return gqlComment;
    },
    replyComment: async (_: any, { comment_id, content }: any, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);

      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      const user = await getUserById(author_id);

      console.log("[replyComment]", author_id, user);

      const id = uuidv4();

      const { rows: baseRows } = await query(
        `SELECT * FROM comments WHERE id = $1`,
        [comment_id]
      );
      const parent = baseRows[0];
      if (!parent) throw new Error('Comment not found');

      const { rows } = await query(
        `
        INSERT INTO comments (id, post_id, user_id, parent_id, content)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING *
        `,
        [id, parent.post_id, user.id, comment_id, content]
      );
      const reply = rows[0];

      // noti เหมือนเดิม
      if (parent.user_id !== user.id) {
        await createNotification({
          user_id: parent.user_id,
          type: 'POST_COMMENT_REPLY',
          title: 'มีคนตอบคอมเมนต์ของคุณ',
          message: `${user.name}: ${content.substring(0, 80)}`,
          entity_type: 'comment',
          entity_id: comment_id,
          data: {
            post_id: parent.post_id,
            comment_id,
            reply_id: reply.id,
            actor_id: user.id,
            actor_name: user.name,
          },
        });
      }

      const gqlReply = {
        ...reply,
        user: {
          id: user.id,
          name: user.name,
          avatar: user.avatar ?? null,
        },
        replies: [] as any[], // reply ใหม่ยังไม่มีลูกตัวเอง
      };

      await pubsub.publish(COMMENT_ADDED, {
        commentAdded: gqlReply,
      });

      return gqlReply;
    },
    updateComment: async (_: any, { id, content }: any, ctx: any) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');

      // ตรวจว่าเป็นเจ้าของคอมเมนต์
      const { rows: ownRows } = await query(
        `SELECT * FROM comments WHERE id = $1`,
        [id]
      );
      const c = ownRows[0];
      if (!c) throw new Error('Comment not found');
      if (c.user_id !== user.id) throw new Error('Forbidden');

      const { rows } = await query(
        `
        UPDATE comments
        SET content = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [id, content]
      );

      const updated = rows[0];

      await pubsub.publish(COMMENT_UPDATED, {
        commentUpdated: updated,
      });

      return updated;
    },
    deleteComment: async (_: any, { id }: any, ctx: any) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');

      const { rows: ownRows } = await query(
        `SELECT * FROM comments WHERE id = $1`,
        [id]
      );
      const c = ownRows[0];
      if (!c) return false;
      if (c.user_id !== user.id) throw new Error('Forbidden');

      await query(`DELETE FROM comments WHERE id = $1`, [id]);

      await pubsub.publish(COMMENT_DELETED, {
        commentDeleted: id,
      });

      return true;
    },
    
    reportScamPhone: async (_: any, { input }: any, ctx: any) => {
      const {
        phone,
        category,
        note,
        client_id,
        device_model,
        os_version,
        app_version,
      } = input;

      console.log("[reportScamPhone] input:", input);

      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) throw new Error("Unauthenticated");
      const author_id = String(auth.author_id);

      const normalized = normalizeTel(phone);
      if (!normalized) throw new Error("Invalid phone");

      const cat = String(category || "SCAM");

      const { result } = await runInTransaction(author_id, async (client: any) => {
        // 1) INSERT -> scam_phone_reports
        //    (มี phone_normalized เป็น NOT NULL ตาม error ที่คุณเจอ)
        await client.query(
          `
          INSERT INTO scam_phone_reports
            (user_id, phone, phone_normalized, category, note, client_id, device_model, os_version, app_version)
          VALUES
            ($1::uuid, $2, $3, $4, $5, $6::uuid, $7, $8, $9)
          `,
          [
            author_id,
            normalized,
            normalized,
            cat,
            note ?? null,
            client_id,
            device_model ?? null,
            os_version ?? null,
            app_version ?? null,
          ]
        );

        // 2) UPSERT -> scam_phones_summary (ตัด source_reports ออก)
        const { rows } = await client.query(
          `
          INSERT INTO scam_phones_summary
            (phone, report_count, last_report_at, risk_level, updated_at)
          VALUES
            ($1, 1, now(), 10, now())
          ON CONFLICT (phone)
          DO UPDATE SET
              report_count   = scam_phones_summary.report_count + 1,
              last_report_at = now(),
              risk_level     = GREATEST(scam_phones_summary.risk_level, 10),
              updated_at     = now()
          RETURNING
            phone,
            report_count,
            last_report_at,
            risk_level,
            post_ids,
            is_deleted,
            updated_at;
          `,
          [normalized]
        );

        const row = rows[0];

        // 3) เติม fields ที่ GraphQL schema/app ต้องการ แต่ DB ไม่มีจริง
        return {
          phone: row.phone,
          report_count: Number(row.report_count || 0),
          last_report_at: row.last_report_at ? new Date(row.last_report_at).toISOString() : null,
          risk_level: Number(row.risk_level || 0),
          updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
          is_deleted: !!row.is_deleted,
          post_ids: Array.isArray(row.post_ids) ? row.post_ids : [],
          tags: [],   // ✅ DB ไม่มี tags
          ctx: null,  // ✅ DB ไม่มี ctx
        };
      });

      return result;
    },

    unblockScamPhone: async (_: any, { input }: any, ctx: any) => {
      const { phone, client_id, device_model, os_version, app_version } = input;

      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id)
        throw new Error("Unauthenticated");

      const author_id = String(auth.author_id);

      const normalized = normalizeTel(phone);
      if (!normalized) throw new Error("Invalid phone");

      const { result } = await runInTransaction(author_id, async (client: any) => {

        // ✅ (1) log unblock event (ถ้ามี table นี้)
        await client.query(
          `
          INSERT INTO scam_phone_unblocks
            (user_id, phone, client_id, device_model, os_version, app_version)
          VALUES
            ($1::uuid, $2, $3::uuid, $4, $5, $6)
          `,
          [
            author_id,
            normalized,
            client_id,
            device_model ?? null,
            os_version ?? null,
            app_version ?? null,
          ]
        );

        // ✅ (2) update summary
        // ❌ เอา ctx ออก
        const { rows } = await client.query(
          `
          INSERT INTO scam_phones_summary
            (phone, report_count, last_report_at, risk_level, updated_at)
          VALUES
            ($1, 0, NULL, 0, now())
          ON CONFLICT (phone)
          DO UPDATE SET
              risk_level = GREATEST(COALESCE(scam_phones_summary.risk_level, 0) - 10, 0),
              updated_at = now()
          RETURNING
            phone,
            report_count,
            last_report_at,
            risk_level,
            updated_at,
            COALESCE(is_deleted, false) AS is_deleted,
            COALESCE(post_ids, ARRAY[]::uuid[]) AS post_ids;
          `,
          [normalized]
        );

        const row = rows?.[0] || {};

        return {
          phone: String(row.phone || normalized),
          report_count: Number(row.report_count || 0),
          last_report_at: toIsoOrNull(row.last_report_at),
          risk_level: Number(row.risk_level || 0),
          updated_at:
            toIsoOrNull(row.updated_at) || new Date().toISOString(),

          // เติม default field ให้ GraphQL
          tags: [],                 // ถ้าไม่มีใน DB
          is_deleted: !!row.is_deleted,
          post_ids: uuidArrayToStringArray(row.post_ids),
          ctx: null,                // 🔥 ใส่ null แทน (ไม่ต้อง SELECT จาก DB)
        };
      });

      return result;
    },
    createSupportTicket: async (_: any, { input }: any, ctx: any) => {
      // ticketId แบบง่าย
      const ticketId = `SUP-${Date.now()}`;

      const subject = `[${ticketId}] ${input.topic.toUpperCase()}: ${input.subject}`;

      const html = `
        <h2>New Support Ticket</h2>
        <p><b>Ticket:</b> ${ticketId}</p>
        <p><b>Name:</b> ${input.name}</p>
        <p><b>Email:</b> ${input.email}</p>
        <p><b>Phone:</b> ${input.phone ?? "-"}</p>
        <p><b>Topic:</b> ${input.topic}</p>
        <p><b>Ref:</b> ${input.ref ?? "-"}</p>
        <p><b>Page:</b> ${input.pageUrl ?? "-"}</p>
        <p><b>User-Agent:</b> ${input.userAgent ?? "-"}</p>
        <hr />
        <pre style="white-space:pre-wrap">${escapeHtml(input.message)}</pre>
      `;

      await sendEmail({
        to: process.env.SUPPORT_TO_EMAIL ?? "support@yourdomain.com",
        subject,
        html,
        text: `${input.message}\n\nFrom: ${input.name} <${input.email}>`,
      });

      return { ok: true, message: "Received. We will reply soon.", ticketId };
    },

    reportBankAccount: async (_: any, { input }: any, ctx: any) => {
      const {
        bank_name,
        account_no,
        note,
        client_id,
        device_model,
        os_version,
        app_version,
      } = input;

      // const { author_id } = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });

      const auth =  requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      const bankName = String(bank_name || "").trim();
      const accRaw = String(account_no || "").trim();
      const accNorm = normalizeAccountNo(accRaw);

      if (!bankName || !accNorm) {
        throw new GraphQLError("bank_name and account_no are required", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

      const { result } = await runInTransaction(author_id, async (client: any) => {
        // 1) insert report (กันยิงซ้ำด้วย client_id unique)
        try {
          await client.query(
            `
            INSERT INTO scam_bank_account_reports
              (bank_name, account_no, account_norm, note, client_id, device_model, os_version, app_version)
            VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8)
            `,
            [bankName, accRaw, accNorm, note || null, client_id, device_model || null, os_version || null, app_version || null]
          );
        } catch (e: any) {
          // ถ้า client_id ซ้ำ -> ถือว่า idempotent: ไปอ่าน summary คืนได้เลย
          const msg = String(e?.message || "");
          const isDup = msg.includes("scam_bank_account_reports_client_id_ux") || msg.includes("duplicate key");
          if (!isDup) throw e;
        }

        // 2) trigger จะ upsert summary แล้ว -> read summary กลับ
        const { rows } = await client.query(
          `
          SELECT
            bank_name,
            account_no,
            account_norm,
            report_count,
            last_report_at,
            risk_level,
            updated_at
          FROM scam_bank_accounts_summary
          WHERE bank_name = $1 AND account_norm = $2
          LIMIT 1
          `,
          [bankName, accNorm]
        );

        const s = rows[0];
        if (!s) {
          // safety fallback (ไม่น่าเกิด)
          return {
            bank_name: bankName,
            account_no_masked: maskAccount(accNorm),
            account_norm: accNorm,
            report_count: 1,
            last_report_at: new Date().toISOString(),
            risk_level: 10,
            updated_at: new Date().toISOString(),
          };
        }

        return {
          bank_name: s.bank_name,
          account_no_masked: maskAccount(s.account_no || s.account_norm),
          account_norm: s.account_norm,
          report_count: Number(s.report_count || 0),
          last_report_at: s.last_report_at ? new Date(s.last_report_at).toISOString() : null,
          risk_level: Number(s.risk_level || calcRisk(Number(s.report_count || 0))),
          updated_at: s.updated_at ? new Date(s.updated_at).toISOString() : new Date().toISOString(),
        };
      });

      return result;
    },

    reportScamBankAccount: async (_: any, { input }: any, ctx: any) => {
      const { bank_name, account, note, client_id, device_model, os_version, app_version } = input;

      console.log("[reportScamBankAccount] input:", input);

      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) throw new Error("Unauthenticated");

      const bankNameSafe = String(bank_name || "").trim() || "UNKNOWN";
      const accNorm = normalizeBankAccount(account);
      if (!accNorm) throw new Error("Invalid account");

      const accountNoSafe = String(account || "").trim();
      const accountNormSafe = accNorm;
      const noteSafe = note?.trim() ? note.trim() : null;

      const { result } = await runInTransaction(String(auth.author_id), async (client: any) => {
        // 1) insert report
        // await client.query(
        //   `
        //   INSERT INTO scam_bank_account_reports
        //     (bank_name, account_no, account_norm, note, client_id, device_model, os_version, app_version)
        //   VALUES
        //     ($1, $2, $3, $4, $5, $6, $7, $8)
        //   `,
        //   [
        //     bankNameSafe,
        //     String(account || "").trim(),
        //     accNorm,
        //     note?.trim() ? note.trim() : null,
        //     String(client_id),
        //     device_model ?? null,
        //     os_version ?? null,
        //     app_version ?? null,
        //   ]
        // );

        await client.query(
          `
          INSERT INTO scam_bank_account_reports
            (id, user_id, bank_name, account_no, account_norm, note, client_id, device_model, os_version, app_version, created_at)
          VALUES
            (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, now())
          ON CONFLICT (client_id) DO NOTHING
          `,
          [
            String(auth.author_id),
            bankNameSafe,
            accountNoSafe,
            accountNormSafe,
            noteSafe,
            String(client_id || ""),
            device_model ?? null,
            os_version ?? null,
            app_version ?? null,
          ]
        );

        // 2) upsert summary (ไม่มี source_reports / tags / ctx ใน DB)
        const { rows } = await client.query(
          `
          INSERT INTO scam_bank_accounts_summary
            (bank_name, account_no, account_norm, report_count, last_report_at, risk_level, updated_at)
          VALUES
            ($1, $2, $3, 1, now(), 10, now())
          ON CONFLICT (bank_name, account_norm)
          DO UPDATE SET
            account_no     = EXCLUDED.account_no,
            report_count   = COALESCE(scam_bank_accounts_summary.report_count,0) + 1,
            last_report_at = now(),
            risk_level     = GREATEST(COALESCE(scam_bank_accounts_summary.risk_level,0), 10),
            updated_at     = now()
          RETURNING
            bank_name, account_no, account_norm, report_count, last_report_at, risk_level, updated_at
          `,
          [bankNameSafe, String(account || "").trim(), accNorm]
        );

        return shapeScamBankAccount(rows[0]);
      });

      return result;
    },

    unreportScamBankAccount: async (_: any, { input }: any, ctx: any) => {
      const { bank_name, account, client_id, device_model, os_version, app_version } = input;

      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) throw new Error("Unauthenticated");

      const bankNameSafe = String(bank_name || "").trim() || "UNKNOWN";
      const accNorm = normalizeBankAccount(account);
      if (!accNorm) throw new Error("Invalid account");

      const { result } = await runInTransaction(String(auth.author_id), async (client: any) => {
        // 1) ลบ report ล่าสุดของ “เครื่องนี้” (client_id)
        //    (DB ไม่มี user_id ใน reports → ใช้ client_id เป็นตัวแทน)
        await client.query(
          `
          DELETE FROM scam_bank_account_reports
          WHERE id IN (
            SELECT id
            FROM scam_bank_account_reports
            WHERE bank_name = $1
              AND account_norm = $2
              AND client_id = $3
            ORDER BY created_at DESC
            LIMIT 1
          )
          `,
          [bankNameSafe, accNorm, String(client_id)]
        );

        // 2) rebuild summary จาก reports ที่เหลือ
        const { rows: aggRows } = await client.query(
          `
          SELECT
            COUNT(*)::int AS cnt,
            MAX(created_at) AS last_at
          FROM scam_bank_account_reports
          WHERE bank_name = $1 AND account_norm = $2
          `,
          [bankNameSafe, accNorm]
        );

        const cnt = Number(aggRows?.[0]?.cnt || 0);
        const lastAt = aggRows?.[0]?.last_at || null;

        if (cnt <= 0) {
          // ไม่มีรายงานเหลือ → ลบ summary ทิ้งเลย
          await client.query(
            `DELETE FROM scam_bank_accounts_summary WHERE bank_name = $1 AND account_norm = $2`,
            [bankNameSafe, accNorm]
          );

          return shapeScamBankAccount({
            bank_name: bankNameSafe,
            account_no: String(account || "").trim(),
            account_norm: accNorm,
            report_count: 0,
            last_report_at: null,
            risk_level: 0,
            updated_at: new Date().toISOString(),
          });
        }

        const nextRisk = Math.min(cnt * 10, 100);

        const { rows: upRows } = await client.query(
          `
          UPDATE scam_bank_accounts_summary
          SET
            report_count   = $3,
            last_report_at = $4,
            risk_level     = $5,
            updated_at     = now()
          WHERE bank_name = $1 AND account_norm = $2
          RETURNING
            bank_name, account_no, account_norm, report_count, last_report_at, risk_level, updated_at
          `,
          [bankNameSafe, accNorm, cnt, lastAt, nextRisk]
        );

        // ถ้าดันไม่มีแถว (edge) → insert ใหม่
        const row = upRows?.[0];
        if (row) return shapeScamBankAccount(row);

        const { rows: insRows } = await client.query(
          `
          INSERT INTO scam_bank_accounts_summary
            (bank_name, account_no, account_norm, report_count, last_report_at, risk_level, updated_at)
          VALUES
            ($1, $2, $3, $4, $5, $6, now())
          RETURNING
            bank_name, account_no, account_norm, report_count, last_report_at, risk_level, updated_at
          `,
          [bankNameSafe, String(account || "").trim(), accNorm, cnt, lastAt, nextRisk]
        );

        return shapeScamBankAccount(insRows[0]);
      });

      return result;
    },

    ...phoneResolvers.Mutation
  },
};
```

## apps/web/lib/date.ts

```ts
// utils/date.ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);

export function formatDate(timestamp: number | string, format = 'DD/MM/YYYY') {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (typeof timestamp === 'number') {
        return dayjs(timestamp).tz(tz).format(format);
    }

    const asNumber = Number(timestamp);
    if (Number.isFinite(asNumber)) {
        return dayjs(asNumber).tz(tz).format(format);
    }

    return dayjs(timestamp).tz(tz).format(format);
}
```

