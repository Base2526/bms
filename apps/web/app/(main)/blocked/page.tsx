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
