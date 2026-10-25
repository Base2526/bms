"use client";
import { gql, useQuery } from "@apollo/client";
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
} from "antd";
import { useI18n } from "@/lib/i18nContext";
import { useBmsPermissions } from "@/app/hooks/useBmsPermissions";
import { useTeamCommand } from "@/components/operations/useTeamCommand";
import styles from "./operations.module.css";
import StandardReadiness from "@/components/operations/StandardReadiness";
const WORK = gql`
  query OperationTeam($filter: BmsTeamFilter!) {
    bmsOperationTeam(filter: $filter) {
      staff {
        id
        name
      }
      actorId
      rosterTotal
      handoverTotal
      missingTotal
      rosters {
        id
        locationId
        dutyKey
        dutyName
        assignedTo
        startsAt
        endsAt
        status
        version
        acceptedAt
        endedAt
      }
      handovers {
        id
        locationId
        rosterId
        sender
        recipient
        note
        dueAt
        status
        version
        items
        dutyName
      }
      missing {
        id
        snapshot
        dueAt
        version
        status
        assignmentEvidence
      }
      policies {
        locationId
        version
        useDutySupervisor
        supervisorDutyKey
      }
    }
  }
`;
const DETAIL = gql`
  query OperationHandover($id: ID!) {
    bmsOperationHandover(id: $id) {
      id
      locationId
      rosterId
      sender
      recipient
      note
      dueAt
      status
      version
      items
      liveItems
      submittedAt
      receivedAt
      events {
        id
        action
        actor
        note
        details
        createdAt
      }
    }
  }
`;
const ROSTER = gql`
  query OperationRoster($id: ID!) {
    bmsOperationRoster(id: $id) {
      id
      locationId
      dutyKey
      dutyName
      assignedTo
      startsAt
      endsAt
      status
      version
      acceptedAt
      endedAt
    }
  }
`;
const SUMMARY = gql`
  query OperationSummary($locationId: ID!, $date: String!) {
    bmsOperationSummary(locationId: $locationId, date: $date) {
      date
      locationId
      timezone
      asOf
      fingerprint
      changed
      counts {
        duties
        vacancies
        unaccepted
        runs
        approved
        overdue
        unassigned
        review
        actions
        handoverDraft
        handoverWaiting
        handoverReceived
        escalations
      }
      previous {
        id
        version
        fingerprint
        note
        reviewedBy
        createdAt
        snapshot
      }
    }
  }
`;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const local = (v: string) => {
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export default function TeamPanel({
  locationId,
  locations,
  staff: fallbackStaff,
  onOpenRun,
}: {
  locationId?: string;
  locations: any[];
  staff: any[];
  onOpenRun: (id: string) => void;
}) {
  const { t, lang } = useI18n(),
    tr = (k: string) => t(`operation_team.${k}`),
    { can } = useBmsPermissions();
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [focusedRoster, setFocusedRoster] = useState<string>(),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string>(),
    [tab, setTab] = useState("rosters"),
    [dialog, setDialog] = useState<any>(null),
    [form] = Form.useForm(),
    [summaryDate, setSummaryDate] = useState(today),
    [summaryBranch, setSummaryBranch] = useState(locationId);
  const q = useQuery(WORK, {
    variables: { filter: { locationId, from, to, offset: (page - 1) * 25 } },
    fetchPolicy: "network-only",
    pollInterval: 30000,
  });
  const rosterQuery = useQuery(ROSTER, {
    variables: { id: focusedRoster },
    skip: !focusedRoster,
    fetchPolicy: "network-only",
  });
  const d = useQuery(DETAIL, {
    variables: { id: selected },
    skip: !selected,
    fetchPolicy: "network-only",
  });
  const summary = useQuery(SUMMARY, {
    variables: { locationId: summaryBranch, date: summaryDate },
    skip:
      !summaryBranch || !can("operations.summary.review") || tab !== "summary",
    fetchPolicy: "network-only",
  });
  const w = q.data?.bmsOperationTeam,
    staff: any[] = w?.staff ?? fallbackStaff,
    h = d.data?.bmsOperationHandover,
    day = summary.data?.bmsOperationSummary;
  const refresh = async () => {
    await Promise.all([
      q.refetch(),
      ...(focusedRoster ? [rosterQuery.refetch()] : []),
      ...(selected ? [d.refetch()] : []),
      ...(summaryBranch && can("operations.summary.review") && tab === "summary"
        ? [summary.refetch()]
        : []),
    ]);
  };
  const m = useTeamCommand(refresh, () => setDialog(null)),
    name = (id: string) =>
      staff.find((x) => x.id === id)?.name ?? id ?? tr("vacant"),
    fmt = (v: string) =>
      new Date(v).toLocaleString(lang === "th" ? "th-TH" : "en-GB"),
    branch = (id: string) => locations.find((x) => x.id === id)?.name ?? id;
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("roster")) setFocusedRoster(p.get("roster")!);
    if (p.get("handover")) {
      setSelected(p.get("handover")!);
      setTab("handovers");
    }
  }, []);
  function ask(action: string, row: any = {}, extra: any = {}) {
    if (action === "CONFIRM_DAY")
      extra = {
        locationId: summaryBranch,
        date: summaryDate,
        fingerprint: day.fingerprint,
        version: day.previous?.version ?? 0,
      };
    form.resetFields();
    form.setFieldsValue({
      locationId: row.locationId ?? locationId,
      dutyKey: row.dutyKey,
      dutyName: row.dutyName,
      assignedTo: row.assignedTo ?? undefined,
      startsAt: local(row.startsAt ?? new Date().toISOString()),
      endsAt: local(
        row.endsAt ?? new Date(Date.now() + 8 * 3600000).toISOString(),
      ),
      recipient: row.recipient,
      dueAt: local(
        row.dueAt ?? row.endsAt ?? new Date(Date.now() + 3600000).toISOString(),
      ),
      note: action === "REFRESH_HANDOVER" ? row.note : undefined,
      enabled: row.useDutySupervisor,
      dutySupervisor: row.supervisorDutyKey,
    });
    setDialog({ action, row, extra });
  }
  async function submit() {
    const v = await form.validateFields(),
      { action, row, extra } = dialog;
    let input: any = {
      action,
      id: row.id,
      version: row.version,
      confirmed: true,
      ...extra,
    };
    if (action === "SAVE_ROSTER")
      input = {
        ...input,
        locationId: v.locationId,
        dutyKey: v.dutyKey,
        dutyName: v.dutyName,
        assignedTo: v.assignedTo ?? null,
        startsAt: new Date(v.startsAt).toISOString(),
        endsAt: new Date(v.endsAt).toISOString(),
      };
    else if (action === "CREATE_HANDOVER")
      input = {
        action,
        rosterId: row.id,
        version: row.version,
        recipient: v.recipient,
        dueAt: new Date(v.dueAt).toISOString(),
        note: v.note,
        confirmed: true,
      };
    else if (action === "REFRESH_HANDOVER")
      input = {
        ...input,
        recipient: v.recipient,
        dueAt: new Date(v.dueAt).toISOString(),
        note: v.note,
      };
    else if (action === "REROUTE_HANDOVER")
      input = { ...input, recipient: v.recipient, note: v.note };
    else if (action === "CONFIRM_DAY")
      input = {
        action,
        ...extra,
        note: v.note,
        confirmed: true,
      };
    else if (action === "SAVE_SUPERVISOR_DUTY")
      input = {
        action,
        locationId: row.locationId,
        version: row.version,
        enabled: v.enabled ?? false,
        dutyKey: v.dutySupervisor,
        confirmed: true,
      };
    else input.note = v.note;
    if (await m.command(input)) setDialog(null);
  }
  const title: Record<string, string> = {
    SAVE_ROSTER: "new_roster",
    PUBLISH_ROSTER: "publish",
    CANCEL_ROSTER: "cancel",
    ACCEPT_DUTY: "accept",
    END_DUTY: "end_duty",
    CREATE_HANDOVER: "create_handover",
    REFRESH_HANDOVER: "refresh",
    SUBMIT_HANDOVER: "submit",
    RECEIVE_HANDOVER: "receive",
    REROUTE_HANDOVER: "reroute",
    CANCEL_HANDOVER: "cancel",
    APPEND_NOTE: "append",
    TRANSFER_ITEM: "transfer",
    CONFIRM_DAY: "confirm_day",
    SAVE_SUPERVISOR_DUTY: "supervisor",
  };
  const btn = (action: string, row: any, label?: string, extra?: any) => (
    <Button
      disabled={m.busy || m.uncertain}
      onClick={() => ask(action, row, extra)}
    >
      {tr(label ?? title[action])}
    </Button>
  );
  const paging = (total: number) => ({
    current: page,
    pageSize: 25,
    total,
    showSizeChanger: false,
    onChange: setPage,
  });
  const status = (v: string) => <Tag>{tr(v)}</Tag>;
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert closable type="info" message={tr("hint")} />
      <Space wrap>
        <label>
          {tr("from")}{" "}
          <Input
            aria-label={tr("from")}
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          {tr("to")}{" "}
          <Input
            aria-label={tr("to")}
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <Button onClick={refresh}>{tr("reload")}</Button>
      </Space>
      {q.error && <Alert closable type="error" message={tr("failed")} />}
      {focusedRoster && (
        <Card
          title={tr("rosters")}
          extra={
            <Button onClick={() => setFocusedRoster(undefined)}>
              {tr("close")}
            </Button>
          }
        >
          {rosterQuery.error ? (
            <Alert closable type="error" message={tr("failed")} />
          ) : !rosterQuery.data?.bmsOperationRoster ? (
            <Spin />
          ) : (
            (() => {
              const r = rosterQuery.data.bmsOperationRoster;
              return (
                <Space direction="vertical">
                  <p>
                    {r.dutyName} · {branch(r.locationId)} · {name(r.assignedTo)}
                  </p>
                  <p>
                    {fmt(r.startsAt)} → {fmt(r.endsAt)} · {status(r.status)}
                  </p>
                  <Space wrap>
                    {r.status === "PUBLISHED" &&
                      r.assignedTo === w?.actorId &&
                      can("operations.roster.accept") &&
                      (!r.acceptedAt
                        ? btn("ACCEPT_DUTY", r)
                        : !r.endedAt && btn("END_DUTY", r))}
                    {r.status === "PUBLISHED" &&
                      can("operations.roster.accept") &&
                      r.assignedTo &&
                      (r.assignedTo === w?.actorId ||
                        can("operations.handover.manage")) &&
                      btn("CREATE_HANDOVER", r)}
                  </Space>
                </Space>
              );
            })()
          )}
        </Card>
      )}
      <Tabs
        activeKey={tab}
        onChange={(v) => {
          setTab(v);
          setPage(1);
        }}
        items={[
          {
            key: "rosters",
            label: tr("rosters"),
            children: (
              <>
                {can("operations.roster.manage") && btn("SAVE_ROSTER", {})}
                <Table
                  rowKey="id"
                  loading={q.loading}
                  scroll={{ x: 1000 }}
                  dataSource={w?.rosters ?? []}
                  pagination={paging(w?.rosterTotal ?? 0)}
                  columns={[
                    {
                      title: tr("duty_name"),
                      render: (_, r: any) => (
                        <>
                          {r.dutyName}
                          <br />
                          <code>{r.dutyKey}</code>
                          <br />
                          {branch(r.locationId)}
                        </>
                      ),
                    },
                    {
                      title: tr("person"),
                      render: (_, r: any) => (
                        <>
                          {name(r.assignedTo)}
                          <br />
                          {r.acceptedAt &&
                            `${tr("accept")}: ${fmt(r.acceptedAt)}`}
                        </>
                      ),
                    },
                    {
                      title: tr("start"),
                      render: (_, r: any) => (
                        <>
                          {fmt(r.startsAt)}
                          <br />
                          {fmt(r.endsAt)}
                        </>
                      ),
                    },
                    {
                      title: tr("status"),
                      dataIndex: "status",
                      render: status,
                    },
                    {
                      title: tr("open"),
                      render: (_, r: any) => (
                        <Space wrap>
                          {can("operations.roster.manage") &&
                            r.status === "DRAFT" && (
                              <>
                                {btn("SAVE_ROSTER", r, "edit")}
                                {btn("PUBLISH_ROSTER", r)}
                              </>
                            )}
                          {can("operations.roster.manage") &&
                            r.status !== "CANCELLED" &&
                            btn("CANCEL_ROSTER", r)}
                          {r.status === "PUBLISHED" && (
                            <>
                              {can("operations.roster.accept") &&
                                r.assignedTo === w?.actorId &&
                                (!r.acceptedAt
                                  ? btn("ACCEPT_DUTY", r)
                                  : !r.endedAt && btn("END_DUTY", r))}
                              {can("operations.roster.accept") &&
                                (r.assignedTo === w?.actorId ||
                                  can("operations.handover.manage")) &&
                                r.assignedTo &&
                                btn("CREATE_HANDOVER", r)}
                            </>
                          )}
                        </Space>
                      ),
                    },
                  ]}
                />
                <h3>{tr("missing")}</h3>
                <Table
                  rowKey="id"
                  dataSource={w?.missing ?? []}
                  pagination={paging(w?.missingTotal ?? 0)}
                  columns={[
                    {
                      title: tr("items"),
                      render: (_, r: any) => (
                        <Button onClick={() => onOpenRun(r.id)}>
                          {r.snapshot.name}
                        </Button>
                      ),
                    },
                    {
                      title: tr("evidence"),
                      render: (_, r: any) => (
                        <>
                          {r.assignmentEvidence.dutyKey}:{" "}
                          {r.assignmentEvidence.status}
                        </>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: "handovers",
            label: tr("handovers"),
            children: (
              <Table
                rowKey="id"
                loading={q.loading}
                scroll={{ x: 760 }}
                dataSource={w?.handovers ?? []}
                pagination={paging(w?.handoverTotal ?? 0)}
                columns={[
                  { title: tr("duty_name"), dataIndex: "dutyName" },
                  {
                    title: tr("person"),
                    render: (_, r: any) => (
                      <>
                        {name(r.sender)} → {name(r.recipient)}
                      </>
                    ),
                  },
                  { title: tr("due"), dataIndex: "dueAt", render: fmt },
                  { title: tr("status"), dataIndex: "status", render: status },
                  {
                    title: tr("open"),
                    render: (_, r: any) => (
                      <Button onClick={() => setSelected(r.id)}>
                        {tr("open")}
                      </Button>
                    ),
                  },
                ]}
              />
            ),
          },
          ...(can("operations.summary.review")
            ? [
                {
                  key: "summary",
                  label: tr("summary"),
                  children: (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Alert closable type="info" message={tr("review_hint")} />
                      <Space wrap>
                        <Select
                          aria-label={tr("branch")}
                          placeholder={tr("branch")}
                          style={{ minWidth: 180 }}
                          value={summaryBranch}
                          onChange={setSummaryBranch}
                          options={locations.map((l) => ({
                            value: l.id,
                            label: l.name,
                          }))}
                        />
                        <Input
                          aria-label={tr("summary")}
                          type="date"
                          value={summaryDate}
                          onChange={(e) => setSummaryDate(e.target.value)}
                        />
                      </Space>
                      {summary.error ? (
                        <Alert closable type="error" message={tr("failed")} />
                      ) : summary.loading ? (
                        <Spin />
                      ) : (
                        day && (
                          <>
                            <Tag color={day.changed ? "orange" : "blue"}>
                              {tr(
                                day.previous
                                  ? day.changed
                                    ? "changed"
                                    : "unchanged"
                                  : "no_snapshot",
                              )}
                            </Tag>
                            <p>
                              {fmt(day.asOf)} · {day.timezone}
                            </p>
                            <Table
                              rowKey="key"
                              pagination={false}
                              dataSource={Object.entries(day.counts)
                                .filter(([k]) => k !== "__typename")
                                .map(([key, value]) => ({
                                  key,
                                  value,
                                  saved:
                                    day.previous?.snapshot?.counts?.[key] ??
                                    "—",
                                }))}
                              columns={[
                                {
                                  title: tr("items"),
                                  dataIndex: "key",
                                  render: tr,
                                },
                                { title: tr("live"), dataIndex: "value" },
                                { title: tr("saved"), dataIndex: "saved" },
                              ]}
                            />
                            {day.previous && (
                              <p>
                                {day.previous.note} ·{" "}
                                {name(day.previous.reviewedBy)} ·{" "}
                                {fmt(day.previous.createdAt)}
                              </p>
                            )}
                            {btn("CONFIRM_DAY", {})}
                          </>
                        )
                      )}
                    </Space>
                  ),
                },
              ]
            : []),
          ...(can("operations.checklist.manage")
            ? [
                {
                  key: "supervisor",
                  label: tr("supervisor"),
                  children: (
                    <>
                      <p>{tr("supervisor_hint")}</p>
                      {w?.policies.map((p: any) => (
                        <Card key={p.locationId} title={branch(p.locationId)}>
                          <p>
                            {p.useDutySupervisor
                              ? p.supervisorDutyKey
                              : tr("fixed")}
                          </p>
                          {btn("SAVE_SUPERVISOR_DUTY", p)}
                        </Card>
                      ))}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      <small>{tr("bounds")}</small>
      <Drawer
        title={tr("handovers")}
        width="min(900px, 100vw)"
        open={!!selected}
        onClose={() => setSelected(undefined)}
      >
        {d.error ? (
          <Alert closable type="error" message={tr("failed")} />
        ) : !h ? (
          <Spin />
        ) : (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Alert closable message={tr("received_hint")} type="info" />
            <p>
              {name(h.sender)} → {name(h.recipient)} · {status(h.status)} ·{" "}
              {tr("version")} {h.version}
            </p>
            <p>{h.note}</p>
            <Space wrap>
              {h.status === "DRAFT" &&
                can("operations.roster.accept") &&
                (h.sender === w?.actorId ||
                  can("operations.handover.manage")) && (
                  <>
                    {btn("REFRESH_HANDOVER", h)}
                    {btn("SUBMIT_HANDOVER", h)}
                  </>
                )}
              {h.status === "SUBMITTED" &&
                h.recipient === w?.actorId &&
                can("operations.handover.receive") &&
                btn("RECEIVE_HANDOVER", h)}
              {h.status === "SUBMITTED" &&
                can("operations.handover.manage") &&
                btn("REROUTE_HANDOVER", h)}
              {["DRAFT", "SUBMITTED"].includes(h.status) &&
                can("operations.handover.manage") &&
                btn("CANCEL_HANDOVER", h)}
              {["SUBMITTED", "RECEIVED"].includes(h.status) &&
                can("operations.handover.receive") &&
                btn("APPEND_NOTE", h)}
            </Space>
            <Table
              rowKey={(r: any) => `${r.kind}:${r.id}`}
              pagination={false}
              scroll={{ x: 700 }}
              dataSource={h.liveItems ?? []}
              columns={[
                {
                  title: tr("items"),
                  render: (_, r: any) => (
                    <Button
                      onClick={() => {
                        setSelected(undefined);
                        onOpenRun(r.runId);
                      }}
                    >
                      {r.name}
                    </Button>
                  ),
                },
                { title: tr("saved"), dataIndex: "status" },
                {
                  title: tr("live"),
                  render: (_, r: any) => (
                    <>
                      {r.currentStatus}
                      <br />
                      {name(r.currentAssignedTo)}
                    </>
                  ),
                },
                {
                  title: tr("transfer"),
                  render: (_, r: any) =>
                    h.status === "RECEIVED" &&
                    ["RUN", "ACTION"].includes(r.kind) &&
                    r.currentAssignedTo === h.sender &&
                    can("operations.handover.manage") &&
                    can("operations.checklist.manage") &&
                    btn("TRANSFER_ITEM", h, undefined, {
                      itemId: r.id,
                      itemKind: r.kind,
                      itemVersion: r.currentVersion,
                    }),
                },
              ]}
            />
            <h3>{tr("history")}</h3>
            {h.events?.map((e: any) => (
              <p key={e.id}>
                {fmt(e.createdAt)} · {name(e.actor)} ·{" "}
                {tr(title[e.action] ?? e.action)} · {e.note}
              </p>
            ))}
          </Space>
        )}
      </Drawer>
      <Modal
        open={!!dialog}
        title={tr(title[dialog?.action] ?? "confirm")}
        onCancel={() => !m.busy && !m.uncertain && setDialog(null)}
        onOk={submit}
        confirmLoading={m.busy}
        okText={tr("confirm")}
        cancelText={tr("close")}
        destroyOnClose
      >
        <p>
          {dialog?.row?.dutyName ?? dialog?.extra?.itemId}{" "}
          {dialog?.row?.version && `${tr("version")} ${dialog.row.version}`}
        </p>
        {dialog?.row?.recipient && (
          <p>
            {name(dialog.row.sender)} → {name(dialog.row.recipient)} ·{" "}
            {tr("due")}: {fmt(dialog.row.dueAt)}
          </p>
        )}
        {dialog?.extra?.date && (
          <p>
            {branch(dialog.extra.locationId)} · {dialog.extra.date} ·{" "}
            {tr("version")} {dialog.extra.version}
          </p>
        )}
        <Form name="operationTeamCommand" form={form} layout="vertical">
          {dialog?.action === "SAVE_ROSTER" && (
            <>
              <Form.Item
                name="locationId"
                label={tr("branch")}
                rules={[{ required: true }]}
              >
                <Select
                  aria-label={tr("branch")}
                  disabled={!!dialog.row.id}
                  options={locations.map((l) => ({
                    value: l.id,
                    label: l.name,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="dutyKey"
                label={tr("duty_key")}
                rules={[
                  { required: true, pattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/ },
                ]}
              >
                <Input aria-label={tr("duty_key")} maxLength={60} />
              </Form.Item>
              <Form.Item
                name="dutyName"
                label={tr("duty_name")}
                rules={[{ required: true }]}
              >
                <Input aria-label={tr("duty_name")} maxLength={200} />
              </Form.Item>
              <Form.Item name="assignedTo" label={tr("person")}>
                <Select
                  aria-label={tr("person")}
                  allowClear
                  options={staff.map((x) => ({ label: x.name, value: x.id }))}
                />
              </Form.Item>
              <Form.Item
                name="startsAt"
                label={tr("start")}
                rules={[{ required: true }]}
              >
                <Input aria-label={tr("start")} type="datetime-local" />
              </Form.Item>
              <Form.Item
                name="endsAt"
                label={tr("end")}
                rules={[{ required: true }]}
              >
                <Input aria-label={tr("end")} type="datetime-local" />
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {({getFieldValue})=><StandardReadiness locationId={getFieldValue('locationId')} staffId={getFieldValue('assignedTo')} dutyKey={getFieldValue('dutyKey')}/>}
              </Form.Item>
            </>
          )}
          {["CREATE_HANDOVER", "REFRESH_HANDOVER", "REROUTE_HANDOVER"].includes(
            dialog?.action,
          ) && (
            <Form.Item
              name="recipient"
              label={tr("recipient")}
              rules={[{ required: true }]}
            >
              <Select
                aria-label={tr("recipient")}
                options={staff.map((x) => ({ label: x.name, value: x.id }))}
              />
            </Form.Item>
          )}
          {["CREATE_HANDOVER", "REFRESH_HANDOVER"].includes(dialog?.action) && (
            <Form.Item
              name="dueAt"
              label={tr("due")}
              rules={[{ required: true }]}
            >
              <Input aria-label={tr("due")} type="datetime-local" />
            </Form.Item>
          )}
          {[
            "CREATE_HANDOVER",
            "REFRESH_HANDOVER",
            "REROUTE_HANDOVER",
            "CANCEL_HANDOVER",
            "CANCEL_ROSTER",
            "APPEND_NOTE",
            "TRANSFER_ITEM",
            "CONFIRM_DAY",
          ].includes(dialog?.action) && (
            <Form.Item
              name="note"
              label={tr("note")}
              rules={[{ required: true }]}
            >
              <Input.TextArea aria-label={tr("note")} maxLength={2000} />
            </Form.Item>
          )}
          {dialog?.action === "SAVE_SUPERVISOR_DUTY" && (
            <>
              <Form.Item
                name="enabled"
                valuePropName="checked"
                label={tr("enabled")}
              >
                <Switch aria-label={tr("enabled")} />
              </Form.Item>
              <Form.Item name="dutySupervisor" label={tr("duty_key")}>
                <Input aria-label={tr("duty_key")} maxLength={60} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
      {m.retry}
    </Space>
  );
}
