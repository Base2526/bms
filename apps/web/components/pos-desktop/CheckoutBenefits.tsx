"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Input, InputNumber, Select } from "antd";
import { posGraphqlRequest } from "@/lib/pos/mobileFlowGraphql";
import styles from "./CheckoutBenefits.module.css";

type Member = { customerId: string; name: string; phone: string | null; memberNo: string | null; pointsBalance: number; pointsUsable: number };
export type BenefitsPreview = {
  status: string; reason: string | null; couponError: string | null;
  netTotal: number | null; amountDue: number | null; totalDiscount: number;
  tierDiscount: number; couponDiscount: number; pointsDiscount: number; pointsUsed: number;
  reservationDepositApplied: number | null;
  loyaltyEnabled: boolean; pointsWillEarn: number | null; member: Member | null;
};
export const MEMBER_SEARCH = `query DesktopMemberSearch($q: String) {
  bmsPosMemberSearch(q: $q) { members { customerId name phone memberNo pointsBalance pointsUsable } }
}`;
export const BENEFITS_PREVIEW = `query DesktopBenefitsPreview($input: BmsPosMemberPreviewInput!) {
  bmsPosMemberPreview(input: $input) {
    status reason couponError netTotal amountDue totalDiscount tierDiscount couponDiscount pointsDiscount pointsUsed
    reservationDepositApplied loyaltyEnabled pointsWillEarn
    member { customerId name phone memberNo pointsBalance pointsUsable }
  }
}`;

export function benefitsPayable(preview: BenefitsPreview | null): number | null {
  if (!preview || preview.status !== "READY" || preview.couponError) return null;
  const amount = preview.amountDue ?? preview.netTotal;
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function benefitsSelectionError(preview: BenefitsPreview, customerId: string | null, points: number): string {
  if (customerId && preview.member?.customerId !== customerId) return "ไม่พบสมาชิกนี้ในร้าน กรุณาเลือกสมาชิกใหม่";
  if (points > 0 && preview.pointsUsed !== points) return `ใช้แต้มจำนวนนี้กับบิลนี้ไม่ได้ ใช้ได้ ${preview.pointsUsed} แต้ม`;
  return "";
}

export function useCheckoutBenefits(token: string, subtotal: number, groupId: string | null, active: boolean, revision: number) {
  const [member, setMember] = useState<Member | null>(null);
  const [coupon, setCoupon] = useState("");
  const [points, setPoints] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; preview: BenefitsPreview | null; error: string } | null>(null);
  useEffect(() => { setMember(null); setCoupon(""); setPoints(0); setResult(null); }, [token, groupId]);
  const input = useMemo(() => ({ subtotal, boardGameBillingGroupId: groupId,
    customerId: member?.customerId ?? null, couponCode: coupon.trim() || null, pointsToRedeem: points, lines: [] }),
  [subtotal, groupId, member?.customerId, coupon, points]);
  const key = JSON.stringify([token, input, retry, revision]);
  useEffect(() => {
    if (!active || !token) { setResult(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      void posGraphqlRequest<{ bmsPosMemberPreview: BenefitsPreview }>(token, BENEFITS_PREVIEW, { input })
        .then(({ bmsPosMemberPreview: preview }) => {
          if (!cancelled) setResult({ key, preview, error: benefitsPayable(preview) === null
            ? preview.reason || preview.couponError || "ตรวจสอบส่วนลดไม่สำเร็จ"
            : benefitsSelectionError(preview, input.customerId, input.pointsToRedeem) });
        }).catch((cause) => {
          if (!cancelled) setResult({ key, preview: null, error: cause instanceof Error ? cause.message : "ตรวจสอบส่วนลดไม่สำเร็จ" });
        });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, token, key, input]);
  const current = result?.key === key ? result : null;
  const preview = current?.preview ?? null;
  return {
    token, member, coupon, points, preview,
    ready: active && current !== null && !current.error && benefitsPayable(preview) !== null,
    pending: active && current === null,
    error: current?.error ?? "",
    chooseMember: (next: Member | null) => { setMember(next); setPoints(0); },
    setCoupon, setPoints,
    retry: () => setRetry((value) => value + 1),
    clear: () => { setMember(null); setCoupon(""); setPoints(0); setResult(null); },
    saleFields: { customerId: member?.customerId ?? null, couponCode: coupon.trim() || null, pointsToRedeem: points },
  };
}

export default function CheckoutBenefits({ benefits, disabled }: { benefits: ReturnType<typeof useCheckoutBenefits>; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setMembers([]);
    setSearchError("");
    setSearching(query.trim().length >= 3);
    if (query.trim().length < 3) return;
    const timer = setTimeout(() => {
      void posGraphqlRequest<{ bmsPosMemberSearch: { members: Member[] } }>(benefits.token, MEMBER_SEARCH, { q: query.trim() })
        .then((data) => { if (!cancelled) setMembers(data.bmsPosMemberSearch.members); })
        .catch(() => { if (!cancelled) setSearchError("ค้นหาสมาชิกไม่สำเร็จ กรุณาลองใหม่"); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [benefits.token, query]);
  const preview = benefits.preview;
  const selected = preview?.member ?? benefits.member;
  return <section className={styles.root} aria-label="สมาชิก คูปอง และแต้ม">
    <label>สมาชิก
      <Select showSearch allowClear filterOption={false} disabled={disabled} loading={searching}
        aria-label="ค้นหาสมาชิก" placeholder="ชื่อ / เบอร์โทร / เลขสมาชิก (3 ตัวขึ้นไป)"
        value={benefits.member?.customerId} searchValue={query}
        onSearch={setQuery}
        onChange={(id) => { benefits.chooseMember(members.find((item) => item.customerId === id) ?? null); setQuery(""); }}
        options={[...(benefits.member && !members.some((item) => item.customerId === benefits.member?.customerId) ? [benefits.member] : []), ...members]
          .map((item) => ({ value: item.customerId, label: `${item.name} · ${item.memberNo || item.phone || ""}` }))}
        notFoundContent={searchError || (searching ? "กำลังค้นหา…" : query.trim().length >= 3 ? "ไม่พบสมาชิก" : "พิมพ์อย่างน้อย 3 ตัวอักษร")} />
    </label>
    {selected ? <div className={styles.balance}>
      <span>แต้มคงเหลือ <b>{selected.pointsBalance}</b></span><span>ใช้ได้ <b>{selected.pointsUsable}</b></span>
      {preview?.pointsWillEarn != null ? <span>บิลนี้ได้รับ <b>{preview.pointsWillEarn}</b> แต้ม</span> : null}
    </div> : null}
    <div className={styles.inputs}>
      <label>รหัสคูปอง<Input allowClear aria-label="รหัสคูปอง" disabled={disabled} value={benefits.coupon} onChange={(event) => benefits.setCoupon(event.target.value)} /></label>
      <label>ใช้แต้ม<InputNumber aria-label="ใช้แต้ม" min={0} precision={0} max={selected?.pointsUsable ?? 0}
        disabled={disabled || !benefits.member || preview?.loyaltyEnabled === false}
        value={benefits.points} onChange={(value) => benefits.setPoints(value ?? 0)} /></label>
    </div>
    {benefits.member && preview && !preview.loyaltyEnabled ? <div>ร้านยังไม่เปิดใช้แต้มสะสม</div> : null}
    {benefits.pending ? <div role="status">กำลังตรวจสอบยอดและส่วนลด…</div> : null}
    {benefits.error ? <div role="alert" className={styles.error}>{benefits.error} <Button disabled={disabled} onClick={benefits.retry}>ลองใหม่</Button></div> : null}
    {benefits.ready && preview ? <div className={styles.discounts}>
      {[["ส่วนลดสมาชิก", preview.tierDiscount], ["ส่วนลดคูปอง", preview.couponDiscount], [`ใช้ ${preview.pointsUsed} แต้ม`, preview.pointsDiscount], ["หักมัดจำแล้ว", preview.reservationDepositApplied ?? 0]].map(([label, amount]) => Number(amount) > 0
        ? <div key={label}><span>{label}</span><strong>−฿{Number(amount).toFixed(2)}</strong></div> : null)}
    </div> : null}
  </section>;
}
