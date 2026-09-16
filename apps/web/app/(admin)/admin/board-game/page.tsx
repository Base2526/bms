"use client";

import {
  Alert, Button, Descriptions, Empty, Form, Input, InputNumber, List, Modal,
  Select, Space, Spin, Switch, Table, Tabs, Tag, Typography, message,
} from "antd";
import {
  ClockCircleOutlined, DollarOutlined, EditOutlined, EyeOutlined, PlusOutlined,
  EnvironmentOutlined, ReloadOutlined, StopOutlined, SwapOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useI18n } from "@/lib/i18nContext";
import styles from "./page.module.css";

type Location = { id: string; code: string; name: string; active: boolean };
type Rate = {
  id: string; code: string; name: string; customerType: string; pricePerHour: number;
  minimumMinutes: number; roundingMinutes: number; graceMinutes: number; active: boolean; sortOrder: number;
};
type OpenSession = {
  id: string; status: "OPEN" | "CLOSING"; billingMode: "OPEN_ENDED" | "FIXED_DURATION";
  seatingId?: string; sessionIds?: string[]; sessionCount?: number;
  guestCount: number; startedAt: string; expectedEndAt: string | null;
  alertStatus: "NORMAL" | "ENDING_SOON" | "OVERDUE"; amountDue: number;
  billingGroupCount?: number; awaitingPaymentCount?: number;
};
/** กลุ่มบิล (`9.89`) — โต๊ะหนึ่งออกได้หลายใบ และแต่ละใบเก็บเงินแยกกัน */
type BillingGroup = {
  id: string; groupNo: number; status: "OPEN" | "CLOSING" | "PAID" | "CANCELLED";
  /** ค่าเล่นที่แช่ไว้ตอนปิด */
  amountDue: number;
  /** ของที่สั่งเข้าบิลระหว่างเล่น (`9.90`) */
  tabAmount: number;
  endedAt: string | null; currentOrderId: string | null;
};
type FloorArea = { id: string; name: string; sortOrder: number };
type FloorTable = {
  id: string; areaId: string; code: string; name: string; seats: number; sortOrder: number;
  blocked: boolean; openSession: OpenSession | null;
};
type Floor = { areas: FloorArea[]; tables: FloorTable[]; openCounts: Record<string, number> };
type Participant = {
  id: string; displayName: string | null; participantType: string; billable: boolean;
  hourlyRate: number; billingGroupNo: number; billingGroupId: string;
  billingGroupStatus: "OPEN" | "CLOSING" | "PAID" | "CANCELLED";
  joinedAt: string; leftAt: string | null;
};
type SessionDetail = OpenSession & {
  tableId: string; seatingId: string; locationId: string; endedAt: string | null;
  billingGroups: BillingGroup[];
  participants: Participant[];
  games: Array<{ id: string; copyId: string; copyCode: string; title: string; status: string; checkedOutAt: string }>;
  identityHolds: IdentityHold[];
};
/**
 * บัตรที่ร้านถือไว้ค้ำกล่องเกม (`9.93`) — เลขเต็มไม่เคยมาถึงรูปนี้ · มีแต่สี่ตัวท้ายไว้จับคู่กับ
 * บัตรในลิ้นชัก และการอ่านเลขกลับออกมาเป็นคำขอของตัวเองที่ต้องมี `board_game.identity.reveal`
 */
/**
 * เวลาที่ร้านติดค้างสมาชิกอยู่ + ตัวจับ drift ของยอดที่แคชไว้ (`9.92`)
 * — รูปเดียวกับ `balanceMismatchCount` ของแต้มและเครดิตร้าน
 */
type PassOutstanding = {
  activeMinutePasses: number; activeUnlimitedPasses: number;
  outstandingMinutes: number; expiringIn30Days: number; balanceMismatchCount: number;
};
type IdentityHold = {
  id: string; loanId: string | null; documentKind: string;
  holderName: string | null; documentNumberTail: string | null; hasDocumentNumber: boolean;
  status: "HELD" | "RETURNED"; note: string | null;
  takenAt: string; returnedAt: string | null;
};
type GameTitle = {
  id: string; title: string; minPlayers: number | null; maxPlayers: number | null;
  typicalMinutes: number | null; difficulty: string | null; language: string | null;
  publicVisible: boolean;
  copies: Array<{ id: string; locationId: string; copyCode: string; status: string; conditionNote: string | null }>;
};
type PublicProfile = {
  locationId: string; publicVisible: boolean; displayName: string; summary: string | null;
  publicAddress: string | null; publicPhone: string | null; openingHours: string | null;
  latitude: number | null; longitude: number | null; publishRates: boolean; publishAvailability: boolean;
};
type MemberOption = { customerId: string; name: string; memberNo: string | null };
type PassPlan = {
  id: string; locationId: string | null; code: string; name: string;
  kind: "UNLIMITED" | "MINUTES"; price: number; durationDays: number;
  includedMinutes: number | null; active: boolean; sortOrder: number; note: string | null;
};
type MemberPass = {
  id: string; locationId: string | null; customerId: string; customerName: string | null; planName: string;
  kind: "UNLIMITED" | "MINUTES"; remainingMinutes: number | null; pricePaid: number;
  startsAt: string; expiresAt: string; status: "ACTIVE" | "EXPIRED" | "CANCELLED";
};

const emptyFloor: Floor = { areas: [], tables: [], openCounts: {} };
const key = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body as T;
}

export default function BoardGamePage() {
  const { t, lang } = useI18n();
  const { can, loading: permissionsLoading } = useBmsPermissions();
  const canManageSession = can("board_game.session.manage");
  const canManageFloor = can("board_game.floor.manage");
  const canManageRate = can("board_game.rate.manage");
  const canManagePass = can("board_game.pass.manage");
  const canRevealIdentity = can("board_game.identity.reveal");
  const canManageLibrary = can("board_game.library.manage");
  const canCancel = can("board_game.session.cancel");
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [floor, setFloor] = useState<Floor>(emptyFloor);
  const [rates, setRates] = useState<Rate[]>([]);
  const [library, setLibrary] = useState<GameTitle[]>([]);
  const [loading, setLoading] = useState(false);
  const [openTable, setOpenTable] = useState<FloorTable | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [relocateTargetId, setRelocateTargetId] = useState("");
  const [rateModal, setRateModal] = useState<Rate | "new" | null>(null);
  const [areaModal, setAreaModal] = useState(false);
  const [tableModal, setTableModal] = useState(false);
  const [titleModal, setTitleModal] = useState(false);
  const [copyTitle, setCopyTitle] = useState<GameTitle | null>(null);
  const [passPlans, setPassPlans] = useState<PassPlan[]>([]);
  const [memberPasses, setMemberPasses] = useState<MemberPass[]>([]);
  const [passOutstanding, setPassOutstanding] = useState<PassOutstanding | null>(null);
  const [planModal, setPlanModal] = useState<PassPlan | "new" | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [memberSearching, setMemberSearching] = useState(false);
  const notifiedAlerts = useRef(new Set<string>());
  const memberSearchSequence = useRef(0);
  const [openForm] = Form.useForm();
  const [participantForm] = Form.useForm();
  const [rateForm] = Form.useForm();
  const [areaForm] = Form.useForm();
  const [tableForm] = Form.useForm();
  const [titleForm] = Form.useForm();
  const [copyForm] = Form.useForm();
  const [discoveryForm] = Form.useForm();
  const [planForm] = Form.useForm();
  const [issueForm] = Form.useForm();
  const [identityForm] = Form.useForm();
  const [heldCards, setHeldCards] = useState<IdentityHold[]>([]);

  const activeRates = useMemo(() => rates.filter((rate) => rate.active), [rates]);
  const availableCopies = useMemo(() => library.flatMap((title) =>
    title.copies.filter((copy) => copy.status === "AVAILABLE").map((copy) => ({
      value: copy.id, label: `${title.title} · ${copy.copyCode}`,
    }))
  ), [library]);

  // แพ็กเกจสมาชิก (`9.92`) — แคตตาล็อกที่ร้านขาย และสัญญาที่สมาชิกถืออยู่
  const refreshPasses = useCallback(async () => {
    if (!canManageSession) return;
    const data = await api<{ plans: PassPlan[]; passes: MemberPass[]; outstanding: PassOutstanding }>(
      "/api/bms/board-game/passes"
    );
    setPassPlans(data.plans);
    setMemberPasses(data.passes);
    setPassOutstanding(data.outstanding ?? null);
  }, [canManageSession]);

  async function savePlan(values: any) {
    try {
      await api("/api/bms/board-game/passes", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          action: "plan",
          id: planModal === "new" ? null : planModal?.id ?? null,
        }),
      });
      setPlanModal(null);
      await refreshPasses();
      message.success(t("common.saved"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("common.save_failed"));
    }
  }

  async function issuePass(values: any) {
    setIssuing(true);
    try {
      // คีย์ใหม่ต่อการกดหนึ่งครั้ง · กดซ้ำเพราะเน็ตช้าต้องได้สัญญาใบเดิม ไม่ใช่ใบที่สอง
      const { pass } = await api<{ pass: MemberPass }>("/api/bms/board-game/passes", {
        method: "POST",
        body: JSON.stringify({ ...values, action: "issue", idempotencyKey: crypto.randomUUID() }),
      });
      issueForm.resetFields();
      await refreshPasses();
      message.success(t("admin_board_game.pass_sold", { plan: pass.planName }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("common.save_failed"));
    } finally {
      setIssuing(false);
    }
  }

  function cancelPass(pass: MemberPass) {
    let reason = "";
    Modal.confirm({
      title: t("admin_board_game.cancel_pass_title"),
      // ยกเลิกแพ็กเกจไม่คืนเงินให้เอง — การคืนเงินเดินทางคืนเงินของ POS เหมือนของอย่างอื่น
      content: (
        <div>
          <Typography.Paragraph type="secondary">{t("admin_board_game.cancel_pass_hint")}</Typography.Paragraph>
          <Input.TextArea rows={2} onChange={(event) => { reason = event.target.value; }}
            placeholder={t("admin_board_game.cancel_pass_reason")} />
        </div>
      ),
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!reason.trim()) {
          message.error(t("admin_board_game.cancel_pass_reason"));
          throw new Error("reason required");
        }
        await api("/api/bms/board-game/passes", {
          method: "POST",
          body: JSON.stringify({ action: "cancel", passId: pass.id, reason }),
        });
        await refreshPasses();
        message.success(t("common.saved"));
      },
    });
  }

  const refreshBase = useCallback(async () => {
    if (!canManageSession) return;
    const [locationData, rateData] = await Promise.all([
      api<{ locations: Location[] }>("/api/bms/board-game/locations"),
      api<{ rates: Rate[] }>("/api/bms/board-game/rates"),
    ]);
    const activeLocations = locationData.locations.filter((location) => location.active);
    setLocations(activeLocations);
    setRates(rateData.rates);
    setLocationId((current) => activeLocations.some((row) => row.id === current) ? current : activeLocations[0]?.id ?? "");
  }, [canManageSession]);

  const refreshLocation = useCallback(async (selectedLocationId = locationId) => {
    if (!selectedLocationId) return;
    setLoading(true);
    try {
      const [floorData, libraryData, holdsData] = await Promise.all([
        api<{ floor: Floor }>(`/api/bms/board-game/floor?locationId=${encodeURIComponent(selectedLocationId)}`),
        api<{ titles: GameTitle[] }>(`/api/bms/board-game/library?locationId=${encodeURIComponent(selectedLocationId)}`),
        // "ตอนนี้เราถือบัตรใครอยู่บ้าง" เป็นคำถามของลิ้นชัก ไม่ใช่ของโต๊ะใดโต๊ะหนึ่ง — ดูทีละโต๊ะ
        // แปลว่าต้องเปิดทุกโต๊ะเพื่อจะรู้ว่ามีบัตรค้างไหม ซึ่งไม่มีใครทำตอนปิดร้าน
        api<{ holds: IdentityHold[] }>(
          `/api/bms/board-game/identity?locationId=${encodeURIComponent(selectedLocationId)}&openOnly=1`
        ),
      ]);
      setFloor(floorData.floor);
      setLibrary(libraryData.titles);
      setHeldCards(holdsData.holds);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("admin_board_game.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [locationId, t]);

  const refreshDiscovery = useCallback(async (selectedLocationId = locationId) => {
    if (!selectedLocationId || !canManageFloor) return;
    const data = await api<{ profile: PublicProfile }>(
      `/api/bms/board-game/discovery?locationId=${encodeURIComponent(selectedLocationId)}`
    );
    discoveryForm.setFieldsValue(data.profile);
  }, [canManageFloor, discoveryForm, locationId]);

  useEffect(() => { void refreshBase().catch((error) => message.error(String(error?.message ?? error))); }, [refreshBase]);
  useEffect(() => { void refreshPasses().catch(() => undefined); }, [refreshPasses]);
  useEffect(() => { if (locationId) void refreshLocation(locationId); }, [locationId, refreshLocation]);
  useEffect(() => {
    if (locationId && canManageFloor) {
      void refreshDiscovery(locationId).catch((error) => message.error(String(error?.message ?? error)));
    }
  }, [canManageFloor, locationId, refreshDiscovery]);
  useEffect(() => {
    if (!locationId) return;
    const timer = window.setInterval(() => void refreshLocation(locationId), 15_000);
    return () => window.clearInterval(timer);
  }, [locationId, refreshLocation]);
  useEffect(() => {
    const active = new Set<string>();
    for (const table of floor.tables) {
      const session = table.openSession;
      if (!session || session.status !== "OPEN" || session.alertStatus === "NORMAL") continue;
      const signature = `${session.id}:${session.alertStatus}`;
      active.add(signature);
      if (!notifiedAlerts.current.has(signature)) {
        message.warning(
          t("admin_board_game.alert_popup", {
            table: table.name,
            status: t(`admin_board_game.alert_${session.alertStatus.toLowerCase()}`),
          }),
          8
        );
      }
    }
    notifiedAlerts.current = active;
  }, [floor.tables, t]);

  async function refreshDetail(sessionId: string) {
    setDetailLoading(true);
    try {
      const data = await api<{ session: SessionDetail }>(`/api/bms/board-game/sessions/${sessionId}`);
      setDetail(data.session);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("admin_board_game.load_failed"));
    } finally {
      setDetailLoading(false);
    }
  }

  async function searchMemberOptions(rawSearch: string) {
    const search = rawSearch.trim();
    const sequence = ++memberSearchSequence.current;
    if (search.length < 2) {
      setMemberSearching(false);
      return;
    }
    setMemberSearching(true);
    try {
      const data = await api<{ members: MemberOption[] }>(
        `/api/bms/board-game/members?q=${encodeURIComponent(search)}`
      );
      if (sequence !== memberSearchSequence.current) return;
      setMemberOptions((current) => {
        const merged = new Map(current.map((member) => [member.customerId, member]));
        for (const member of data.members) merged.set(member.customerId, member);
        return [...merged.values()];
      });
    } catch (error) {
      if (sequence === memberSearchSequence.current) {
        message.error(error instanceof Error ? error.message : t("admin_board_game.member_search_failed"));
      }
    } finally {
      if (sequence === memberSearchSequence.current) setMemberSearching(false);
    }
  }

  const memberSelectOptions = memberOptions.map((member) => ({
    value: member.customerId,
    label: `${member.memberNo ?? "-"} · ${member.name}`,
  }));

  function showOpen(table: FloorTable) {
    const firstRate = activeRates[0];
    openForm.setFieldsValue({
      billingMode: "OPEN_ENDED", expectedDurationMinutes: 120, alertBeforeMinutes: 15,
      participants: [{ rateId: firstRate?.id, billingGroupNo: 1 }],
    });
    setOpenTable(table);
  }

  async function submitOpen() {
    if (!openTable || !locationId) return;
    const values = await openForm.validateFields();
    await api("/api/bms/board-game/sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...values,
        expectedDurationMinutes: values.billingMode === "FIXED_DURATION" ? values.expectedDurationMinutes : null,
        locationId, tableId: openTable.id, idempotencyKey: key("open"),
      }),
    });
    message.success(t("admin_board_game.open_success"));
    setOpenTable(null);
    await refreshLocation();
  }

  async function sessionAction(action: string, body: Record<string, unknown> = {}) {
    if (!detail) return null;
    const data = await api<any>(`/api/bms/board-game/sessions/${detail.id}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, idempotencyKey: key(action), ...body }),
    });
    await Promise.all([refreshDetail(detail.id), refreshLocation()]);
    return data;
  }

  async function closeForBilling() {
    if (!detail) return;
    const data = await sessionAction("close_for_billing");
    const groups = (data.billing?.groups ?? []) as BillingGroup[];
    message.success(t("admin_board_game.close_success", { amount: Number(data.billing.amountDue).toFixed(2) }));
    if (groups.length > 1) {
      // โต๊ะที่แยกบิลต้องเก็บเงินทีละใบ ปุ่มเดียวจึงพาไปได้ไม่ครบ
      message.info(t("admin_board_game.close_split_hint", { count: groups.length }));
    }
  }

  async function closeGroupForBilling(group: BillingGroup) {
    const data = await sessionAction("close_group_for_billing", { billingGroupId: group.id });
    const closed = (data.billing?.groups ?? [])[0] as BillingGroup | undefined;
    message.success(t("admin_board_game.close_group_success", { group: group.groupNo }));
    if (closed) {
      window.location.href = `/pos?boardGameBillingGroupId=${encodeURIComponent(closed.id)}`;
    }
  }

  async function relocateSeating() {
    if (!detail || !relocateTargetId) return;
    const target = floor.tables.find((table) => table.id === relocateTargetId);
    if (!target) return;
    const merging = Boolean(target.openSession);
    await sessionAction(merging ? "merge_seating" : "move_seating", {
      targetTableId: target.id,
    });
    setRelocateTargetId("");
    message.success(t(merging
      ? "admin_board_game.merge_seating_success"
      : "admin_board_game.move_seating_success", { table: target.name }));
  }

  function cancelSession() {
    if (!detail) return;
    let reason = "";
    Modal.confirm({
      title: t("admin_board_game.cancel_title"),
      content: <Input.TextArea autoFocus rows={3} placeholder={t("admin_board_game.cancel_reason")} onChange={(event) => { reason = event.target.value; }} />,
      okText: t("admin_board_game.cancel_confirm"), cancelText: t("common.cancel"), okButtonProps: { danger: true },
      onOk: async () => {
        if (!reason.trim()) throw new Error(t("admin_board_game.cancel_reason_required"));
        await sessionAction("cancel", { reason });
        setDetail(null);
        message.success(t("admin_board_game.cancel_success"));
      },
    });
  }

  async function addParticipant() {
    const values = await participantForm.validateFields();
    await sessionAction("add_participant", values);
    participantForm.resetFields();
    message.success(t("admin_board_game.participant_added"));
  }

  async function leaveParticipant(participantId: string) {
    await sessionAction("leave_participant", { participantId });
    message.success(t("admin_board_game.participant_left"));
  }

  async function checkoutGame(copyId: string) {
    if (!detail) return;
    await api("/api/bms/board-game/library/loans", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "checkout", sessionId: detail.id, copyId, idempotencyKey: key("checkout") }),
    });
    await Promise.all([refreshDetail(detail.id), refreshLocation()]);
    message.success(t("admin_board_game.game_checked_out"));
  }

  async function returnGame(loanId: string) {
    await api("/api/bms/board-game/library/loans", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "return", loanId, idempotencyKey: key("return") }),
    });
    if (detail) await Promise.all([refreshDetail(detail.id), refreshLocation()]);
    message.success(t("admin_board_game.game_returned"));
  }

  async function takeIdentityHold() {
    if (!detail) return;
    const values = await identityForm.validateFields();
    await api("/api/bms/board-game/identity", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "take",
        sessionId: detail.id,
        idempotencyKey: key("identity-hold"),
        documentKind: values.documentKind,
        holderName: values.holderName,
        documentNumber: values.documentNumber ?? "",
        loanId: values.loanId ?? null,
      }),
    });
    identityForm.resetFields();
    await Promise.all([refreshDetail(detail.id), refreshLocation()]);
    message.success(t("admin_board_game.identity_taken"));
  }

  async function releaseIdentityHold(holdId: string) {
    await api("/api/bms/board-game/identity", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "release", holdId }),
    });
    await Promise.all([detail ? refreshDetail(detail.id) : Promise.resolve(), refreshLocation()]);
    message.success(t("admin_board_game.identity_released"));
  }

  /**
   * อ่านเลขกลับออกมา — ลง audit ทุกครั้งฝั่ง server · แสดงด้วย `message` ที่หายไปเอง แทนการ
   * เก็บลง state เพราะเลขที่ค้างอยู่บนจอคือเลขที่คนถัดไปที่เดินผ่านก็อ่านได้
   */
  async function revealIdentityNumber(holdId: string) {
    const data = await api<{ documentNumber: string | null }>("/api/bms/board-game/identity", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reveal", holdId }),
    });
    message.info(data.documentNumber ?? t("admin_board_game.identity_no_number"), 12);
  }

  async function saveRate() {
    const values = await rateForm.validateFields();
    await api("/api/bms/board-game/rates", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...values, id: rateModal === "new" ? null : rateModal?.id }),
    });
    setRateModal(null);
    await refreshBase();
    message.success(t("admin_board_game.saved"));
  }

  async function saveFloor(target: "area" | "table") {
    const form = target === "area" ? areaForm : tableForm;
    const values = await form.validateFields();
    await api("/api/bms/board-game/floor", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, locationId, ...values }),
    });
    target === "area" ? setAreaModal(false) : setTableModal(false);
    form.resetFields();
    await refreshLocation();
    message.success(t("admin_board_game.saved"));
  }

  async function saveTitle() {
    const values = await titleForm.validateFields();
    await api("/api/bms/board-game/library", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "title", ...values }),
    });
    setTitleModal(false); titleForm.resetFields(); await refreshLocation(); message.success(t("admin_board_game.saved"));
  }

  async function saveCopy() {
    if (!copyTitle) return;
    const values = await copyForm.validateFields();
    await api("/api/bms/board-game/library", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "copy", titleId: copyTitle.id, locationId, ...values }),
    });
    setCopyTitle(null); copyForm.resetFields(); await refreshLocation(); message.success(t("admin_board_game.saved"));
  }

  async function saveDiscovery() {
    if (!locationId) return;
    const values = await discoveryForm.validateFields();
    const data = await api<{ profile: PublicProfile }>("/api/bms/board-game/discovery", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...values, locationId }),
    });
    discoveryForm.setFieldsValue(data.profile);
    message.success(t("admin_board_game.discovery_saved"));
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      message.error(t("admin_board_game.location_unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        discoveryForm.setFieldsValue({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
        });
        message.success(t("admin_board_game.location_set"));
      },
      () => message.error(t("admin_board_game.location_unavailable")),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
    );
  }

  const locale = lang === "en" ? "en-GB" : "th-TH";
  const time = (value: string | null) => value ? new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "-";
  const day = (value: string | null) => value ? new Date(value).toLocaleDateString(locale) : "-";
  const elapsed = (startedAt: string) => Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000));
  const tableStatus = (table: FloorTable) => table.blocked ? "BLOCKED" : table.openSession?.status ?? "AVAILABLE";

  if (permissionsLoading) return <div className={styles.center}><Spin /></div>;
  if (!canManageSession) return <Alert type="error" showIcon closable message={t("common.no_permission")} />;

  return (
    <div className={styles.page}>
      <AdminPageHeader title={t("admin_board_game.title")}>
        <Space wrap>
          <Select value={locationId || undefined} className={styles.locationSelect} placeholder={t("admin_board_game.select_location")}
            options={locations.map((location) => ({ value: location.id, label: location.name }))} onChange={setLocationId} />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refreshLocation()}>{t("common.refresh")}</Button>
        </Space>
      </AdminPageHeader>

      {!locations.length ? <Empty description={t("admin_board_game.no_locations")} /> : (
        <Tabs items={[
          { key: "floor", label: t("admin_board_game.tab_floor"), children: (
            <>
              <div className={styles.metrics}>
                <div><span>{t("admin_board_game.metric_available")}</span><strong>{floor.tables.filter((row) => tableStatus(row) === "AVAILABLE").length}</strong></div>
                <div><span>{t("admin_board_game.metric_playing")}</span><strong>{floor.openCounts.OPEN ?? 0}</strong></div>
                <div><span>{t("admin_board_game.metric_billing")}</span><strong>{floor.openCounts.CLOSING ?? 0}</strong></div>
                <div><span>{t("admin_board_game.metric_alerts")}</span><strong>{floor.tables.filter((row) => ["ENDING_SOON", "OVERDUE"].includes(row.openSession?.alertStatus ?? "")).length}</strong></div>
              </div>
              {floor.areas.map((area) => (
                <section key={area.id} className={styles.area}>
                  <Typography.Title level={4}>{area.name}</Typography.Title>
                  <div className={styles.tableGrid}>
                    {floor.tables.filter((table) => table.areaId === area.id).map((table) => {
                      const session = table.openSession;
                      const status = tableStatus(table);
                      return (
                        <button key={table.id} type="button" className={`${styles.tableCard} ${styles[`status_${status}`]}`}
                          onClick={() => session ? void refreshDetail(session.id) : !table.blocked && showOpen(table)}>
                          <div className={styles.tableTop}><strong>{table.name}</strong><Tag>{table.seats} {t("admin_board_game.seats")}</Tag></div>
                          {!session ? <span>{table.blocked ? t("admin_board_game.blocked") : t("admin_board_game.available")}</span> : (
                            <>
                              <span><ClockCircleOutlined /> {elapsed(session.startedAt)} {t("admin_board_game.minutes")}</span>
                              <span>{session.guestCount} {t("admin_board_game.people")}{session.expectedEndAt ? ` · ${t("admin_board_game.ends_at")} ${time(session.expectedEndAt)}` : ""}</span>
                              {session.alertStatus !== "NORMAL" && <b>{t(`admin_board_game.alert_${session.alertStatus.toLowerCase()}`)}</b>}
                              {session.status === "CLOSING" && <b>฿{session.amountDue.toFixed(2)}</b>}
                              {(session.sessionCount ?? 1) > 1 && <b>
                                {t("admin_board_game.merged_session_count", { count: session.sessionCount ?? 1 })}
                              </b>}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {/* บัตรที่ค้างอยู่ทั้งสาขา (`9.93`) — อยู่บนแท็บผังโต๊ะเพราะเป็นสิ่งที่ต้องเห็นตอนปิดร้าน
                  โดยไม่ต้องเปิดทีละโต๊ะ · เลขเต็มไม่มาถึงจอนี้ มีแต่สี่ตัวท้าย */}
              {heldCards.length > 0 && (
                <section className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <Typography.Title level={4}>
                      {t("admin_board_game.identity_open_title", { count: heldCards.length })}
                    </Typography.Title>
                  </div>
                  <List size="small" dataSource={heldCards} renderItem={(hold) => (
                    <List.Item actions={canManageSession ? [
                      <Button key="release" size="small" icon={<SwapOutlined />}
                        onClick={() => void releaseIdentityHold(hold.id)}>
                        {t("admin_board_game.identity_release")}
                      </Button>,
                    ] : []}>
                      <span>
                        {hold.holderName ?? "-"} · {t(`admin_board_game.identity_kind_${hold.documentKind.toLowerCase()}`)}
                        {hold.documentNumberTail
                          ? ` · ${t("admin_board_game.identity_tail", { tail: hold.documentNumberTail })}`
                          : ` · ${t("admin_board_game.identity_no_number")}`}
                        {" · "}{time(hold.takenAt)}
                      </span>
                    </List.Item>
                  )} />
                </section>
              )}
              {!floor.areas.length && <Empty description={t("admin_board_game.no_floor")} />}
            </>
          ) },
          { key: "library", label: t("admin_board_game.tab_library"), children: (
            <section className={styles.panel}>
              <div className={styles.panelHeader}><Typography.Title level={4}>{t("admin_board_game.library_title")}</Typography.Title>
                {canManageLibrary && <Button icon={<PlusOutlined />} type="primary" onClick={() => setTitleModal(true)}>{t("admin_board_game.add_title")}</Button>}
              </div>
              <List dataSource={library} locale={{ emptyText: t("admin_board_game.no_games") }} renderItem={(title) => (
                <List.Item actions={canManageLibrary ? [<Button key="copy" icon={<PlusOutlined />} onClick={() => setCopyTitle(title)}>{t("admin_board_game.add_copy")}</Button>] : []}>
                  <List.Item.Meta title={title.title} description={`${title.minPlayers ?? "-"}-${title.maxPlayers ?? "-"} ${t("admin_board_game.players")} · ${title.typicalMinutes ?? "-"} ${t("admin_board_game.minutes")}`} />
                  <Space wrap>{title.copies.map((copy) => <Tag key={copy.id} color={copy.status === "AVAILABLE" ? "green" : copy.status === "IN_USE" ? "blue" : "orange"}>{copy.copyCode} · {t(`admin_board_game.copy_${copy.status.toLowerCase()}`)}</Tag>)}</Space>
                </List.Item>
              )} />
            </section>
          ) },
          { key: "passes", label: t("admin_board_game.tab_passes"), forceRender: true, children: (
            <div className={styles.settingsGrid}>
              {/* เวลาที่ร้านติดค้างสมาชิกอยู่ — ต้องส่งให้บัญชีก่อนปิดงบ เหมือนแต้มและเครดิตร้าน ·
                  `balanceMismatchCount` ต้องเป็น 0 เสมอ ไม่ 0 = มีเส้นทางเขียนที่ลืมคิดยอดใหม่
                  จาก ledger แล้ว **ห้ามปิดงบ** จนกว่าจะรู้ว่าเริ่มเพี้ยนตรงไหน */}
              {passOutstanding && (
                <section className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <Typography.Title level={4}>{t("admin_board_game.pass_outstanding_title")}</Typography.Title>
                  </div>
                  <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }} items={[
                    {
                      key: "minutes",
                      label: t("admin_board_game.pass_outstanding_minutes"),
                      children: t("admin_board_game.pass_minutes_of", { minutes: passOutstanding.outstandingMinutes }),
                    },
                    {
                      key: "unlimited",
                      // ไม่อั้นไม่มีจำนวนนาทีให้นับ — รายงานเป็นจำนวนใบ ไม่ใช่ยัดเป็น 0
                      label: t("admin_board_game.pass_outstanding_unlimited"),
                      children: passOutstanding.activeUnlimitedPasses,
                    },
                    {
                      key: "expiring",
                      label: t("admin_board_game.pass_outstanding_expiring"),
                      children: t("admin_board_game.pass_minutes_of", { minutes: passOutstanding.expiringIn30Days }),
                    },
                    {
                      key: "mismatch",
                      label: t("admin_board_game.pass_outstanding_mismatch"),
                      children: passOutstanding.balanceMismatchCount === 0
                        ? <Tag color="green">0</Tag>
                        : <Tag color="red">{passOutstanding.balanceMismatchCount}</Tag>,
                    },
                  ]} />
                  {passOutstanding.balanceMismatchCount > 0 && (
                    <Alert type="error" showIcon closable
                      message={t("admin_board_game.pass_outstanding_mismatch_warning")} />
                  )}
                </section>
              )}
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <Typography.Title level={4}>{t("admin_board_game.pass_plans_title")}</Typography.Title>
                    <Typography.Text type="secondary">{t("admin_board_game.pass_plans_description")}</Typography.Text>
                  </div>
                  {canManagePass && <Button icon={<PlusOutlined />}
                    onClick={() => { planForm.resetFields(); planForm.setFieldsValue({ kind: "UNLIMITED", durationDays: 30 }); setPlanModal("new"); }}>
                    {t("admin_board_game.add_pass_plan")}
                  </Button>}
                </div>
                <Table rowKey="id" size="small" pagination={false} dataSource={passPlans} columns={[
                  { title: t("admin_board_game.pass_plan_name"), render: (_, row) => <>{row.name}{row.active ? null : <Tag>{t("admin_board_game.inactive")}</Tag>}</> },
                  {
                    title: t("admin_board_game.pass_kind"),
                    render: (_, row) => row.kind === "UNLIMITED"
                      ? t("admin_board_game.pass_unlimited")
                      : t("admin_board_game.pass_minutes_of", { minutes: row.includedMinutes ?? 0 }),
                  },
                  {
                    // แพ็กเกจของสาขาที่ขายได้เฉพาะสาขานั้น (`9.92`) — ไม่บอกก็มองไม่ออกว่าทำไม
                    // แพ็กเกจใบหนึ่งขายที่นี่ไม่ได้
                    title: t("admin_board_game.pass_plan_branch"),
                    render: (_, row) => row.locationId
                      ? (locations.find((location) => location.id === row.locationId)?.name
                         ?? t("admin_board_game.pass_plan_branch_unknown"))
                      : t("admin_board_game.pass_plan_all_branches"),
                  },
                  { title: t("admin_board_game.price"), render: (_, row) => `฿${row.price.toFixed(2)}` },
                  { title: t("admin_board_game.pass_duration"), render: (_, row) => t("admin_board_game.pass_days", { days: row.durationDays }) },
                  { title: "", render: (_, row) => canManagePass
                    ? <Button aria-label={t("common.edit")} icon={<EditOutlined />}
                        onClick={() => { planForm.setFieldsValue(row); setPlanModal(row); }} />
                    : null },
                ]} />
              </section>

              {canManagePass && <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <Typography.Title level={4}>{t("admin_board_game.sell_pass_title")}</Typography.Title>
                </div>
                <Typography.Text type="secondary">{t("admin_board_game.sell_pass_hint")}</Typography.Text>
                <Form form={issueForm} layout="vertical" onFinish={issuePass} style={{ marginTop: 12 }}>
                  <Form.Item name="customerId" label={t("admin_board_game.member")}
                    rules={[{ required: true, message: t("admin_board_game.member_required") }]}>
                    <Select showSearch allowClear filterOption={false} loading={memberSearching}
                      onSearch={searchMemberOptions} options={memberSelectOptions}
                      placeholder={t("admin_board_game.member_search_placeholder")} />
                  </Form.Item>
                  <Form.Item name="planId" label={t("admin_board_game.pass_plan")}
                    rules={[{ required: true, message: t("admin_board_game.pass_plan_required") }]}>
                    <Select options={passPlans.filter((row) => row.active).map((row) => ({
                      value: row.id,
                      label: `${row.name} · ฿${row.price.toFixed(2)} · ${t("admin_board_game.pass_days", { days: row.durationDays })}`,
                    }))} />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" loading={issuing}>{t("admin_board_game.sell_pass")}</Button>
                </Form>
              </section>}

              <section className={`${styles.panel} ${styles.discoveryPanel}`}>
                <div className={styles.panelHeader}>
                  <Typography.Title level={4}>{t("admin_board_game.member_passes_title")}</Typography.Title>
                </div>
                <Table rowKey="id" size="small" pagination={{ pageSize: 10 }} dataSource={memberPasses} columns={[
                  { title: t("admin_board_game.member"), render: (_, row) => row.customerName ?? row.customerId },
                  { title: t("admin_board_game.pass_plan"), dataIndex: "planName" },
                  {
                    title: t("admin_board_game.pass_plan_branch"),
                    render: (_, row) => row.locationId
                      ? (locations.find((location) => location.id === row.locationId)?.name
                         ?? t("admin_board_game.pass_plan_branch_unknown"))
                      : t("admin_board_game.pass_plan_all_branches"),
                  },
                  {
                    title: t("admin_board_game.pass_remaining"),
                    render: (_, row) => row.kind === "UNLIMITED"
                      ? t("admin_board_game.pass_unlimited")
                      : t("admin_board_game.pass_minutes_of", { minutes: row.remainingMinutes ?? 0 }),
                  },
                  { title: t("admin_board_game.pass_expires"), render: (_, row) => time(row.expiresAt) },
                  {
                    title: t("common.status"),
                    render: (_, row) => <Tag>{t(`admin_board_game.pass_status_${row.status.toLowerCase()}`)}</Tag>,
                  },
                  { title: "", render: (_, row) => canManagePass && row.status === "ACTIVE"
                    ? <Button danger size="small" onClick={() => cancelPass(row)}>{t("common.cancel")}</Button>
                    : null },
                ]} />
              </section>
            </div>
          ) },
          { key: "settings", label: t("admin_board_game.tab_settings"), forceRender: true, children: (
            <div className={styles.settingsGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><Typography.Title level={4}>{t("admin_board_game.rates_title")}</Typography.Title>
                  {canManageRate && <Button icon={<PlusOutlined />} onClick={() => { rateForm.resetFields(); setRateModal("new"); }}>{t("admin_board_game.add_rate")}</Button>}
                </div>
                <Table rowKey="id" size="small" pagination={false} dataSource={rates} columns={[
                  { title: t("admin_board_game.rate_name"), dataIndex: "name" },
                  { title: t("admin_board_game.price_hour"), render: (_, row) => `฿${row.pricePerHour.toFixed(2)}` },
                  { title: t("admin_board_game.rounding"), render: (_, row) => `${row.roundingMinutes} ${t("admin_board_game.minutes")}` },
                  { title: "", render: (_, row) => canManageRate ? <Button aria-label={t("common.edit")} icon={<EditOutlined />} onClick={() => { rateForm.setFieldsValue(row); setRateModal(row); }} /> : null },
                ]} />
              </section>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><Typography.Title level={4}>{t("admin_board_game.floor_setup")}</Typography.Title></div>
                <Space wrap>
                  <Button disabled={!canManageFloor} icon={<PlusOutlined />} onClick={() => setAreaModal(true)}>{t("admin_board_game.add_area")}</Button>
                  <Button disabled={!canManageFloor || !floor.areas.length} icon={<PlusOutlined />} onClick={() => setTableModal(true)}>{t("admin_board_game.add_table")}</Button>
                </Space>
              </section>
              {canManageFloor && <section className={`${styles.panel} ${styles.discoveryPanel}`}>
                <div className={styles.panelHeader}>
                  <div>
                    <Typography.Title level={4}>{t("admin_board_game.discovery_title")}</Typography.Title>
                    <Typography.Text type="secondary">{t("admin_board_game.discovery_description")}</Typography.Text>
                  </div>
                  <Button type="link" href="/board-game" target="_blank">{t("admin_board_game.discovery_preview")}</Button>
                </div>
                <Form form={discoveryForm} layout="vertical">
                  <div className={styles.formGrid}>
                    <Form.Item name="displayName" label={t("admin_board_game.discovery_name")}><Input maxLength={120} /></Form.Item>
                    <Form.Item name="publicPhone" label={t("admin_board_game.discovery_phone")}><Input maxLength={40} /></Form.Item>
                    <Form.Item name="openingHours" label={t("admin_board_game.discovery_hours")}><Input maxLength={300} /></Form.Item>
                  </div>
                  <Form.Item name="summary" label={t("admin_board_game.discovery_summary")}><Input.TextArea rows={2} maxLength={500} showCount /></Form.Item>
                  <Form.Item name="publicAddress" label={t("admin_board_game.discovery_address")}><Input maxLength={300} /></Form.Item>
                  <div className={styles.coordinateRow}>
                    <Form.Item name="latitude" label={t("admin_board_game.latitude")}><InputNumber min={-90} max={90} precision={6} /></Form.Item>
                    <Form.Item name="longitude" label={t("admin_board_game.longitude")}><InputNumber min={-180} max={180} precision={6} /></Form.Item>
                    <Button icon={<EnvironmentOutlined />} onClick={useCurrentLocation}>{t("admin_board_game.use_current_location")}</Button>
                  </div>
                  <Space wrap size="large">
                    <Form.Item name="publishRates" valuePropName="checked" label={t("admin_board_game.publish_rates")}><Switch /></Form.Item>
                    <Form.Item name="publishAvailability" valuePropName="checked" label={t("admin_board_game.publish_availability")}><Switch /></Form.Item>
                    <Form.Item name="publicVisible" valuePropName="checked" label={t("admin_board_game.public_visible_location")}><Switch /></Form.Item>
                  </Space>
                  <Alert type="info" showIcon closable message={t("admin_board_game.discovery_privacy")} className={styles.discoveryNotice} />
                  <Button type="primary" onClick={() => void saveDiscovery()}>{t("admin_board_game.save_discovery")}</Button>
                </Form>
              </section>}
            </div>
          ) },
        ]} />
      )}

      <Modal open={Boolean(openTable)} title={t("admin_board_game.open_table", { table: openTable?.name ?? "" })} onCancel={() => setOpenTable(null)} onOk={() => void submitOpen()} okText={t("admin_board_game.open_now")} width={720}>
        <Form form={openForm} layout="vertical">
          <div className={styles.formGrid}>
            <Form.Item name="billingMode" label={t("admin_board_game.billing_mode")} rules={[{ required: true }]}><Select options={[{ value: "OPEN_ENDED", label: t("admin_board_game.open_ended") }, { value: "FIXED_DURATION", label: t("admin_board_game.fixed_duration") }]} /></Form.Item>
            <Form.Item noStyle shouldUpdate={(a, b) => a.billingMode !== b.billingMode}>{({ getFieldValue }) => getFieldValue("billingMode") === "FIXED_DURATION" ? <Form.Item name="expectedDurationMinutes" label={t("admin_board_game.duration_minutes")} rules={[{ required: true }]}><InputNumber min={1} max={1440} /></Form.Item> : <div />}</Form.Item>
            <Form.Item name="alertBeforeMinutes" label={t("admin_board_game.alert_before")}><InputNumber min={0} max={120} /></Form.Item>
          </div>
          <Typography.Title level={5}>{t("admin_board_game.participants")}</Typography.Title>
          <Form.List name="participants">{(fields, { add, remove }) => <Space direction="vertical" className={styles.full}>
            {fields.map((field) => <div className={styles.participantRow} key={field.key}>
              <Form.Item {...field} name={[field.name, "displayName"]}><Input placeholder={t("admin_board_game.display_name")} /></Form.Item>
              <Form.Item {...field} name={[field.name, "rateId"]} rules={[{ required: true }]}><Select placeholder={t("admin_board_game.rate_name")} options={activeRates.map((rate) => ({ value: rate.id, label: `${rate.name} · ฿${rate.pricePerHour}` }))} /></Form.Item>
              <Form.Item noStyle shouldUpdate={(previous, current) =>
                previous.participants?.[field.name]?.rateId !== current.participants?.[field.name]?.rateId
              }>{({ getFieldValue }) => activeRates.find((rate) =>
                rate.id === getFieldValue(["participants", field.name, "rateId"])
              )?.customerType === "MEMBER" ? <Form.Item {...field} name={[field.name, "customerId"]}
                rules={[{ required: true, message: t("admin_board_game.member_required") }]}>
                <Select showSearch allowClear filterOption={false} loading={memberSearching}
                  placeholder={t("admin_board_game.member_search")} onSearch={(value) => void searchMemberOptions(value)}
                  options={memberSelectOptions} notFoundContent={t("admin_board_game.member_search_hint")} />
              </Form.Item> : <div />}</Form.Item>
              <Form.Item {...field} name={[field.name, "billingGroupNo"]} initialValue={1}><InputNumber min={1} max={20} addonBefore={t("admin_board_game.bill_group")} /></Form.Item>
              <Button danger disabled={fields.length === 1} onClick={() => remove(field.name)}>{t("common.delete")}</Button>
            </div>)}
            <Button icon={<PlusOutlined />} onClick={() => add({ rateId: activeRates[0]?.id, billingGroupNo: 1 })}>{t("admin_board_game.add_participant")}</Button>
          </Space>}</Form.List>
        </Form>
      </Modal>

      <Modal open={Boolean(detail)} title={detail ? t("admin_board_game.session_title", { table: floor.tables.find((row) => row.id === detail.tableId)?.name ?? "" }) : ""} footer={null} onCancel={() => { setDetail(null); setRelocateTargetId(""); }} width={820}>
        {detailLoading || !detail ? <Spin /> : <Space direction="vertical" size="large" className={styles.full}>
          {(() => {
            const currentTable = floor.tables.find((row) => row.id === detail.tableId);
            const sessionIds = currentTable?.openSession?.sessionIds ?? [detail.id];
            const targets = floor.tables.filter((row) => !row.blocked && row.id !== detail.tableId);
            return <Space direction="vertical" className={styles.full}>
              {sessionIds.length > 1 && <Space wrap>
                <Typography.Text type="secondary">{t("admin_board_game.sessions_at_seating")}</Typography.Text>
                {sessionIds.map((id, index) => <Button key={id} size="small"
                  type={id === detail.id ? "primary" : "default"}
                  onClick={() => void refreshDetail(id)}>
                  {t("admin_board_game.session_number", { number: index + 1 })}
                </Button>)}
              </Space>}
              <Alert type="info" showIcon closable message={t(sessionIds.length > 1
                ? "admin_board_game.relocate_hint_shared"
                : "admin_board_game.relocate_hint")} />
              <Space wrap>
                <Select value={relocateTargetId || undefined} className={styles.rateSelect}
                  placeholder={t("admin_board_game.target_table")}
                  options={targets.map((row) => ({
                    value: row.id,
                    label: `${row.name} · ${t(row.openSession
                      ? "admin_board_game.target_merge"
                      : "admin_board_game.target_move")}`,
                  }))}
                  onChange={setRelocateTargetId} />
                <Button icon={<SwapOutlined />} disabled={!relocateTargetId}
                  onClick={() => void relocateSeating()}>
                  {t("admin_board_game.relocate_confirm")}
                </Button>
              </Space>
            </Space>;
          })()}
          <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
            { key: "status", label: t("common.status"), children: <Tag>{t(`admin_board_game.session_${detail.status.toLowerCase()}`)}</Tag> },
            { key: "start", label: t("admin_board_game.started_at"), children: time(detail.startedAt) },
            { key: "end", label: t("admin_board_game.ends_at"), children: time(detail.expectedEndAt) },
            { key: "amount", label: t("admin_board_game.amount_due"), children: `฿${detail.amountDue.toFixed(2)}` },
          ]} />
          <div>
            <Typography.Title level={5}>{t("admin_board_game.participants")}</Typography.Title>
            <List size="small" dataSource={detail.participants} renderItem={(row) => <List.Item actions={row.billingGroupStatus === "OPEN" && !row.leftAt ? [<Button key="leave" onClick={() => void leaveParticipant(row.id)}>{t("admin_board_game.mark_left")}</Button>] : []}>
              <span>{row.displayName || t(`admin_board_game.type_${row.participantType.toLowerCase()}`)} · ฿{row.hourlyRate}/{t("admin_board_game.hour_short")} · {t("admin_board_game.bill_group")} {row.billingGroupNo}</span>
            </List.Item>} />
            {detail.status === "OPEN" && <Form form={participantForm} layout="inline" className={styles.inlineForm} onFinish={() => void addParticipant()}>
              <Form.Item name="displayName"><Input placeholder={t("admin_board_game.display_name")} /></Form.Item>
              <Form.Item name="rateId" rules={[{ required: true }]}><Select className={styles.rateSelect} placeholder={t("admin_board_game.rate_name")} options={activeRates.map((rate) => ({ value: rate.id, label: rate.name }))} /></Form.Item>
              <Form.Item noStyle shouldUpdate={(previous, current) => previous.rateId !== current.rateId}>
                {({ getFieldValue }) => activeRates.find((rate) => rate.id === getFieldValue("rateId"))?.customerType === "MEMBER"
                  ? <Form.Item name="customerId" rules={[{ required: true, message: t("admin_board_game.member_required") }]}>
                    <Select showSearch allowClear filterOption={false} loading={memberSearching}
                      className={styles.memberSelect} placeholder={t("admin_board_game.member_search")}
                      onSearch={(value) => void searchMemberOptions(value)} options={memberSelectOptions}
                      notFoundContent={t("admin_board_game.member_search_hint")} />
                  </Form.Item>
                  : null}
              </Form.Item>
              <Form.Item name="billingGroupNo" initialValue={1}><InputNumber min={1} max={20} /></Form.Item>
              <Button htmlType="submit" icon={<PlusOutlined />}>{t("admin_board_game.add_participant")}</Button>
            </Form>}
          </div>
          <div>
            <Typography.Title level={5}>{t("admin_board_game.games_at_table")}</Typography.Title>
            <List size="small" locale={{ emptyText: t("admin_board_game.no_games_at_table") }} dataSource={detail.games} renderItem={(game) => <List.Item actions={game.status === "CHECKED_OUT" ? [<Button key="return" icon={<SwapOutlined />} onClick={() => void returnGame(game.id)}>{t("admin_board_game.return_game")}</Button>] : []}>{game.title} · {game.copyCode} · {t(`admin_board_game.loan_${game.status.toLowerCase()}`)}</List.Item>} />
            {detail.status === "OPEN" && <Select showSearch optionFilterProp="label" className={styles.gameSelect} placeholder={t("admin_board_game.checkout_game")} options={availableCopies} onSelect={(copyId) => void checkoutGame(copyId)} />}
          </div>
          {/* บัตรที่รับไว้ค้ำกล่องเกม (`9.93`)
              คืนบัตร = ล้างชื่อ/เลข/สี่ตัวท้ายทิ้งในทรานแซกชันเดียวกัน แถวที่เหลือตอบได้แค่ว่า
              "รับไว้แล้วคืนไปแล้ว ใครเป็นคนยื่นให้" ซึ่งเป็นคำถามที่ต้องตอบได้เมื่อลูกค้ากลับมาทวง */}
          <div>
            <Typography.Title level={5}>{t("admin_board_game.identity_holds")}</Typography.Title>
            <List size="small" locale={{ emptyText: t("admin_board_game.identity_none") }}
              dataSource={detail.identityHolds}
              renderItem={(hold) => <List.Item actions={hold.status === "HELD" ? [
                ...(canRevealIdentity && hold.hasDocumentNumber
                  ? [<Button key="reveal" size="small" icon={<EyeOutlined />}
                      onClick={() => void revealIdentityNumber(hold.id)}>
                      {t("admin_board_game.identity_reveal")}
                    </Button>]
                  : []),
                ...(canManageSession
                  ? [<Button key="release" size="small" icon={<SwapOutlined />}
                      onClick={() => void releaseIdentityHold(hold.id)}>
                      {t("admin_board_game.identity_release")}
                    </Button>]
                  : []),
              ] : []}>
                {hold.status === "RETURNED"
                  ? <span>
                      <Tag>{t("admin_board_game.identity_returned")}</Tag>
                      {t(`admin_board_game.identity_kind_${hold.documentKind.toLowerCase()}`)} · {time(hold.returnedAt)}
                    </span>
                  : <span>
                      {hold.holderName ?? "-"} · {t(`admin_board_game.identity_kind_${hold.documentKind.toLowerCase()}`)}
                      {hold.documentNumberTail
                        ? ` · ${t("admin_board_game.identity_tail", { tail: hold.documentNumberTail })}`
                        : ` · ${t("admin_board_game.identity_no_number")}`}
                    </span>}
              </List.Item>} />
            {detail.status === "OPEN" && canManageSession && (
              <Form form={identityForm} layout="inline" className={styles.inlineForm}
                onFinish={() => void takeIdentityHold()}>
                <Form.Item name="documentKind" initialValue="NATIONAL_ID" rules={[{ required: true }]}>
                  <Select className={styles.rateSelect}
                    options={["NATIONAL_ID", "STUDENT_ID", "DRIVER_LICENSE", "PASSPORT", "OTHER"].map((value) => ({
                      value, label: t(`admin_board_game.identity_kind_${value.toLowerCase()}`),
                    }))} />
                </Form.Item>
                <Form.Item name="holderName" rules={[{ required: true }]}>
                  <Input placeholder={t("admin_board_game.identity_holder_name")} />
                </Form.Item>
                {/* เลขไม่บังคับโดยตั้งใจ — อ่านเหตุผลที่หัวไฟล์ lib/bms/boardGameIdentity.ts */}
                <Form.Item name="documentNumber">
                  <Input placeholder={t("admin_board_game.identity_number_optional")} />
                </Form.Item>
                <Form.Item name="loanId">
                  <Select allowClear className={styles.gameSelect}
                    placeholder={t("admin_board_game.identity_for_loan")}
                    options={detail.games
                      .filter((game) => game.status === "CHECKED_OUT")
                      .map((game) => ({ value: game.id, label: `${game.title} · ${game.copyCode}` }))} />
                </Form.Item>
                <Button htmlType="submit" icon={<PlusOutlined />}>
                  {t("admin_board_game.identity_take")}
                </Button>
              </Form>
            )}
          </div>
          <Space wrap>
            {detail.billingGroups.length > 1 && detail.billingGroups
              .filter((group) => group.status === "OPEN")
              .map((group) => (
                <Button key={`close-${group.id}`} icon={<DollarOutlined />}
                  onClick={() => void closeGroupForBilling(group)}>
                  {t("admin_board_game.close_group_for_billing", { group: group.groupNo })}
                </Button>
              ))}
            {detail.status === "OPEN" && <Button type="primary" icon={<DollarOutlined />} onClick={() => void closeForBilling()}>
              {detail.billingGroups.length > 1
                ? t("admin_board_game.close_all_groups")
                : t("admin_board_game.close_for_billing")}
            </Button>}
            {detail.billingGroups
              .filter((group) => group.status === "CLOSING")
              .map((group) => (
                <Button key={group.id} type="primary" icon={<DollarOutlined />}
                  href={`/pos?boardGameBillingGroupId=${encodeURIComponent(group.id)}`}>
                  {detail.billingGroups.length > 1
                    ? `${t("admin_board_game.open_pos")} · ${t("admin_board_game.bill_group")} ${group.groupNo} (฿${(group.amountDue + group.tabAmount).toFixed(2)})`
                    : t("admin_board_game.open_pos")}
                </Button>
              ))}
            {canCancel && <Button danger icon={<StopOutlined />} onClick={cancelSession}>{t("admin_board_game.cancel_session")}</Button>}
          </Space>
        </Space>}
      </Modal>

      <Modal open={Boolean(rateModal)} title={t("admin_board_game.rate_editor")} onCancel={() => setRateModal(null)} onOk={() => void saveRate()}>
        <Form form={rateForm} layout="vertical" initialValues={{ customerType: "GENERAL", pricePerHour: 50, minimumMinutes: 60, roundingMinutes: 30, graceMinutes: 0, active: true, sortOrder: 0 }}>
          <Form.Item name="name" label={t("admin_board_game.rate_name")} rules={[{ required: true }]}><Input /></Form.Item>
          <div className={styles.formGrid}><Form.Item name="customerType" label={t("admin_board_game.customer_type")}><Select options={["GENERAL", "STUDENT", "MEMBER", "CHILD", "CUSTOM"].map((value) => ({ value, label: t(`admin_board_game.type_${value.toLowerCase()}`) }))} /></Form.Item><Form.Item name="pricePerHour" label={t("admin_board_game.price_hour")} rules={[{ required: true }]}><InputNumber min={0} /></Form.Item></div>
          <div className={styles.formGrid}><Form.Item name="minimumMinutes" label={t("admin_board_game.minimum_minutes")}><InputNumber min={0} /></Form.Item><Form.Item name="roundingMinutes" label={t("admin_board_game.rounding")}><InputNumber min={1} /></Form.Item><Form.Item name="graceMinutes" label={t("admin_board_game.grace_minutes")}><InputNumber min={0} /></Form.Item></div>
          <Form.Item name="active" label={t("common.active")} valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
      <Modal open={Boolean(planModal)} title={t("admin_board_game.pass_plan_editor")}
        onCancel={() => setPlanModal(null)} onOk={() => void planForm.submit()}>
        <Form form={planForm} layout="vertical" onFinish={savePlan}
          initialValues={{ kind: "UNLIMITED", price: 0, durationDays: 30, active: true, sortOrder: 0 }}>
          <Form.Item name="name" label={t("admin_board_game.pass_plan_name")} rules={[{ required: true }]}><Input /></Form.Item>
          {/* ว่าง = ขายได้ทุกสาขา · เลือกสาขา = แพ็กเกจของสาขานั้นสาขาเดียว (`9.92` ประกาศกฎนี้
              ไว้ที่คอลัมน์เอง) · ตัวเลือกมีเฉพาะสาขาที่บัญชีนี้ดูแล ไม่งั้นจะผูกให้สาขาที่ตัวเองแตะไม่ได้ */}
          <Form.Item name="locationId" label={t("admin_board_game.pass_plan_branch")}>
            <Select allowClear placeholder={t("admin_board_game.pass_plan_all_branches")}
              options={locations.map((location) => ({ value: location.id, label: location.name }))} />
          </Form.Item>
          <div className={styles.formGrid}>
            <Form.Item name="kind" label={t("admin_board_game.pass_kind")}>
              <Select options={["UNLIMITED", "MINUTES"].map((value) => ({
                value, label: t(`admin_board_game.pass_kind_${value.toLowerCase()}`),
              }))} />
            </Form.Item>
            <Form.Item name="price" label={t("admin_board_game.price")} rules={[{ required: true }]}><InputNumber min={0} /></Form.Item>
            <Form.Item name="durationDays" label={t("admin_board_game.pass_duration")} rules={[{ required: true }]}><InputNumber min={1} max={3650} /></Form.Item>
          </div>
          {/* แบบไม่อั้นไม่มีโควตาให้กรอก — ช่องที่กรอกแล้วไม่มีผลคือช่องที่สอนให้คนเลิกเชื่อฟอร์ม */}
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.kind !== next.kind}>
            {({ getFieldValue }) => getFieldValue("kind") === "MINUTES" ? (
              <Form.Item name="includedMinutes" label={t("admin_board_game.pass_included_minutes")}
                rules={[{ required: true }]}><InputNumber min={1} /></Form.Item>
            ) : null}
          </Form.Item>
          <Form.Item name="active" label={t("common.active")} valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
      <Modal open={areaModal} title={t("admin_board_game.add_area")} onCancel={() => setAreaModal(false)} onOk={() => void saveFloor("area")}><Form form={areaForm} layout="vertical"><Form.Item name="name" label={t("admin_board_game.area_name")} rules={[{ required: true }]}><Input /></Form.Item></Form></Modal>
      <Modal open={tableModal} title={t("admin_board_game.add_table")} onCancel={() => setTableModal(false)} onOk={() => void saveFloor("table")}><Form form={tableForm} layout="vertical" initialValues={{ seats: 4 }}><Form.Item name="areaId" label={t("admin_board_game.area_name")} rules={[{ required: true }]}><Select options={floor.areas.map((area) => ({ value: area.id, label: area.name }))} /></Form.Item><Form.Item name="code" label={t("admin_board_game.table_code")} rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="name" label={t("admin_board_game.table_name")}><Input /></Form.Item><Form.Item name="seats" label={t("admin_board_game.seats")}><InputNumber min={1} max={100} /></Form.Item></Form></Modal>
      <Modal open={titleModal} title={t("admin_board_game.add_title")} onCancel={() => setTitleModal(false)} onOk={() => void saveTitle()}><Form form={titleForm} layout="vertical"><Form.Item name="title" label={t("admin_board_game.game_title")} rules={[{ required: true }]}><Input /></Form.Item><div className={styles.formGrid}><Form.Item name="minPlayers" label={t("admin_board_game.min_players")}><InputNumber min={1} /></Form.Item><Form.Item name="maxPlayers" label={t("admin_board_game.max_players")}><InputNumber min={1} /></Form.Item><Form.Item name="typicalMinutes" label={t("admin_board_game.typical_minutes")}><InputNumber min={1} /></Form.Item></div><Form.Item name="difficulty" label={t("admin_board_game.difficulty")}><Select allowClear options={["LIGHT", "MEDIUM", "HEAVY", "CUSTOM"].map((value) => ({ value, label: t(`admin_board_game.difficulty_${value.toLowerCase()}`) }))} /></Form.Item><Form.Item name="publicVisible" label={t("admin_board_game.public_visible")} valuePropName="checked"><Switch /></Form.Item></Form></Modal>
      <Modal open={Boolean(copyTitle)} title={t("admin_board_game.add_copy_for", { title: copyTitle?.title ?? "" })} onCancel={() => setCopyTitle(null)} onOk={() => void saveCopy()}><Form form={copyForm} layout="vertical"><Form.Item name="copyCode" label={t("admin_board_game.copy_code")} rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="purchaseCost" label={t("admin_board_game.purchase_cost")}><InputNumber min={0} /></Form.Item></Form></Modal>
    </div>
  );
}
